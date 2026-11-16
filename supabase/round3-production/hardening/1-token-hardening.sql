-- Canon production — api_tokens hardening + client TRUNCATE/REFERENCES/TRIGGER/MAINTAIN removal on the 7 Round 3 tables.
-- Target: fkxrmppwaaryljmzznym ONLY (guarded by cluster system_identifier). NOT YET APPROVED FOR EXECUTION.
--
-- Run:  psql -X -v ON_ERROR_STOP=1 -h db.fkxrmppwaaryljmzznym.supabase.co -U postgres -d postgres -f 1-token-hardening.sql
-- Any failed check raises → the whole transaction rolls back; nothing is committed unless every postcondition passes.
--
-- Scope (nothing else is touched):
--   * public.api_tokens: authenticated loses table-wide SELECT/UPDATE; gets column SELECT on 8 metadata columns
--     (not token_hash) and column UPDATE on revoked_at only. Policy tok_update becomes one-way (live → revoked).
--   * The 7 Round 3 tables: anon/authenticated lose TRUNCATE, REFERENCES, TRIGGER, MAINTAIN (PG17 'm').
--   * service_role, postgres, RLS-bypass, functions, data: unchanged (asserted below).
--
-- App queries this preserves (read 2026-11-15, commit 1388d7f):
--   integrations/page.tsx  (user session) select id,name,prefix,created_at,last_used_at,revoked_at where org_id
--   integrations/actions.ts revokeToken (user session) update {revoked_at} where id,org_id,revoked_at is null returning prefix
--   integrations/actions.ts createToken (service_role) insert org_id,name,token_hash,prefix,created_by
--   lib/apitoken.ts tokenOrg (service_role) select id,org_id where token_hash, revoked_at is null; update last_used_at
--   Rotation = createToken + revokeToken (no dedicated function exists).

begin;
set local lock_timeout = '5s';          -- fail fast instead of queueing behind app traffic

-- has_*_privilege('A,B') is true if ANY is held; these require ALL.
create function pg_temp.all_tbl(r text, t text, p text) returns bool language sql as
  $$ select bool_and(has_table_privilege(r, t, x)) from unnest(string_to_array(p, ',')) x $$;
create function pg_temp.all_col(r text, t text, c text, p text) returns bool language sql as
  $$ select bool_and(has_column_privilege(r, t, c, x)) from unnest(string_to_array(p, ',')) x $$;
set local statement_timeout = '60s';

-- ── 1. Preconditions ─────────────────────────────────────────────────────────────────────────────────────
do $$
declare cols text;
begin
  if (select system_identifier from pg_control_system()) <> 7703759698107299042 or current_database() <> 'postgres' then
    raise exception 'PRE: not the Canon production cluster (fkxrmppwaaryljmzznym): aborting';
  end if;
  if (select count(*) from pg_tables where schemaname = 'public' and tablename in
       ('trusted_sources','source_checks','policy_versions','notifications','webhooks','webhook_deliveries','api_tokens')) <> 7 then
    raise exception 'PRE: expected the 7 Round 3 tables';
  end if;
  select string_agg(attname, ',' order by attnum) into cols from pg_attribute
   where attrelid = 'public.api_tokens'::regclass and attnum > 0 and not attisdropped;
  if cols <> 'id,org_id,name,token_hash,prefix,created_by,created_at,last_used_at,revoked_at' then
    raise exception 'PRE: api_tokens columns changed: %', cols;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.api_tokens'::regclass) then
    raise exception 'PRE: RLS is off on api_tokens';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'api_tokens' and policyname = 'tok_read'
                   and cmd = 'SELECT' and qual = 'private.has_role(org_id, ''{brand_manager}''::role_t[])') then
    raise exception 'PRE: tok_read is not the reviewed definition';
  end if;
  -- tok_update must be either the current v1 definition or already hardened (re-run safe).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'api_tokens' and policyname = 'tok_update'
                   and cmd = 'UPDATE') then
    raise exception 'PRE: tok_update missing';
  end if;
  if not (select rolbypassrls from pg_roles where rolname = 'service_role')
     or not pg_temp.all_tbl('service_role', 'public.api_tokens', 'SELECT,INSERT,UPDATE') then
    raise exception 'PRE: service_role cannot already read/insert/update api_tokens';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.api_tokens'::regclass and not tgisinternal) then
    raise exception 'PRE: unexpected trigger on api_tokens';
  end if;
end $$;

-- Data fingerprint: proves no token row is changed by this script.
create temp table hardening_fp on commit drop as
  select count(*) n, coalesce(md5(string_agg(t::text, '|' order by id)), '') h from public.api_tokens t;

-- ── 2. api_tokens: column-level client access ────────────────────────────────────────────────────────────
-- Table-level REVOKE also clears any column grants, so the GRANTs below are the complete client surface.
revoke all on public.api_tokens from public, anon, authenticated;
grant select (id, org_id, name, prefix, created_by, created_at, last_used_at, revoked_at),
      update (revoked_at)
  on public.api_tokens to authenticated;

-- One-way revocation: a Brand Manager may only move a live token to revoked.
drop policy if exists tok_update on public.api_tokens;
create policy tok_update on public.api_tokens for update
  using      (private.has_role(org_id, '{brand_manager}') and revoked_at is null)
  with check (private.has_role(org_id, '{brand_manager}') and revoked_at is not null);

-- ── 3. Unneeded client privileges on all 7 Round 3 tables ────────────────────────────────────────────────
-- None of these are used by the app; TRUNCATE bypasses RLS. SELECT/INSERT/UPDATE on the other 6 are left as-is.
revoke truncate, references, trigger, maintain
  on public.trusted_sources, public.source_checks, public.policy_versions, public.notifications,
     public.webhooks, public.webhook_deliveries, public.api_tokens
  from public, anon, authenticated;

-- ── 4. Postconditions ────────────────────────────────────────────────────────────────────────────────────
do $$
declare safe text[] := array['id','org_id','name','prefix','created_by','created_at','last_used_at','revoked_at'];
        c text; t text; r text;
begin
  -- token_hash: no client access of any kind
  foreach r in array array['anon','authenticated'] loop
    if has_column_privilege(r, 'public.api_tokens', 'token_hash', 'SELECT,INSERT,UPDATE,REFERENCES') then
      raise exception 'POST: % can still touch token_hash', r; end if;
    if has_table_privilege(r, 'public.api_tokens', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
      raise exception 'POST: % still has a table-level privilege on api_tokens', r; end if;
  end loop;
  -- authenticated: exactly the safe metadata readable, only revoked_at writable, nothing insertable
  foreach c in array safe loop
    if not has_column_privilege('authenticated', 'public.api_tokens', c, 'SELECT') then
      raise exception 'POST: authenticated lost SELECT on %', c; end if;
    if has_column_privilege('authenticated', 'public.api_tokens', c, 'INSERT')
       or (c <> 'revoked_at' and has_column_privilege('authenticated', 'public.api_tokens', c, 'UPDATE')) then
      raise exception 'POST: authenticated can write %', c; end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.api_tokens', 'revoked_at', 'UPDATE') then
    raise exception 'POST: authenticated cannot revoke'; end if;
  if has_any_column_privilege('anon', 'public.api_tokens', 'SELECT,INSERT,UPDATE') then
    raise exception 'POST: anon has column access to api_tokens'; end if;
  -- policy is exactly one-way
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'api_tokens' and policyname = 'tok_update'
       and qual       = '(private.has_role(org_id, ''{brand_manager}''::role_t[]) AND (revoked_at IS NULL))'
       and with_check = '(private.has_role(org_id, ''{brand_manager}''::role_t[]) AND (revoked_at IS NOT NULL))') then
    raise exception 'POST: tok_update is not the one-way definition'; end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'api_tokens') <> 2 then
    raise exception 'POST: api_tokens must have exactly tok_read + tok_update'; end if;
  -- 7 tables: no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for clients
  foreach t in array array['trusted_sources','source_checks','policy_versions','notifications','webhooks','webhook_deliveries','api_tokens'] loop
    foreach r in array array['anon','authenticated'] loop
      if has_table_privilege(r, 'public.' || t, 'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
        raise exception 'POST: % still has TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on %', r, t; end if;
    end loop;
  end loop;
  -- unchanged client grants the app relies on (other 6 tables)
  if not pg_temp.all_tbl('authenticated', 'public.trusted_sources', 'SELECT,INSERT,UPDATE')
     or not pg_temp.all_tbl('authenticated', 'public.webhooks', 'SELECT,INSERT,UPDATE')
     or not pg_temp.all_tbl('authenticated', 'public.source_checks', 'SELECT')
     or not pg_temp.all_tbl('authenticated', 'public.policy_versions', 'SELECT')
     or not pg_temp.all_tbl('authenticated', 'public.notifications', 'SELECT')
     or not pg_temp.all_tbl('authenticated', 'public.webhook_deliveries', 'SELECT') then
    raise exception 'POST: a client grant the app uses was removed'; end if;
  -- service_role untouched: full DML on every api_tokens column, RLS bypass intact
  if not (select rolbypassrls from pg_roles where rolname = 'service_role')
     or not pg_temp.all_tbl('service_role', 'public.api_tokens', 'SELECT,INSERT,UPDATE,DELETE')
     or not pg_temp.all_col('service_role', 'public.api_tokens', 'token_hash', 'SELECT,INSERT,UPDATE')
     or not has_column_privilege('service_role', 'public.api_tokens', 'last_used_at', 'UPDATE') then
    raise exception 'POST: service_role lost access to api_tokens'; end if;
  foreach t in array array['trusted_sources','source_checks','policy_versions','notifications','webhooks','webhook_deliveries'] loop
    if not pg_temp.all_tbl('service_role', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'POST: service_role lost DML on %', t; end if;
  end loop;
  -- no token row changed
  if (select (n, h) from hardening_fp) is distinct from
     (select (count(*), coalesce(md5(string_agg(tk::text, '|' order by id)), '')) from public.api_tokens tk) then
    raise exception 'POST: api_tokens data changed'; end if;
end $$;

-- Behavioural check as the real client role (read-only; no rows written): selecting token_hash must be denied.
do $$
begin
  set local role authenticated;
  begin
    perform token_hash from public.api_tokens limit 0;
    raise exception 'POST: authenticated could select token_hash';
  exception when insufficient_privilege then null;  -- expected
  end;
  perform id, org_id, name, prefix, created_at, last_used_at, revoked_at from public.api_tokens limit 0;  -- page.tsx columns
  reset role;
end $$;

notify pgrst, 'reload schema';  -- delivered only on COMMIT; PostgREST picks up the new column grants immediately
commit;
