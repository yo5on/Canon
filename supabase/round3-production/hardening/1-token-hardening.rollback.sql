-- ROLLBACK for 1-token-hardening.sql — restores the exact pre-hardening ACLs/policy captured read-only on 2026-11-15:
--   api_tokens      authenticated=rwDxtm   (SELECT,UPDATE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN), no column ACLs
--   other 6 tables  authenticated keeps its current r/a/w; regains D,x,t,m
--   anon            had nothing on any of the 7 tables → nothing to restore
--   tok_update      USING (private.has_role(org_id, '{brand_manager}')) with no WITH CHECK
-- WARNING: this re-opens token_hash reads and un-revoke. Prefer rolling forward. Use only if the app breaks.
-- Does not touch data, service_role, or anything else.

begin;
set local lock_timeout = '5s';

-- has_*_privilege('A,B') is true if ANY is held; these require ALL.
create function pg_temp.all_tbl(r text, t text, p text) returns bool language sql as
  $$ select bool_and(has_table_privilege(r, t, x)) from unnest(string_to_array(p, ',')) x $$;
create function pg_temp.all_col(r text, t text, c text, p text) returns bool language sql as
  $$ select bool_and(has_column_privilege(r, t, c, x)) from unnest(string_to_array(p, ',')) x $$;

do $$ begin
  if (select system_identifier from pg_control_system()) <> 7703759698107299042 then
    raise exception 'not the Canon production cluster: aborting'; end if;
end $$;

revoke all on public.api_tokens from authenticated;   -- clears the column grants
grant select, update, truncate, references, trigger, maintain on public.api_tokens to authenticated;

grant truncate, references, trigger, maintain
  on public.trusted_sources, public.source_checks, public.policy_versions, public.notifications,
     public.webhooks, public.webhook_deliveries
  to authenticated;

drop policy if exists tok_update on public.api_tokens;
create policy tok_update on public.api_tokens for update using (private.has_role(org_id, '{brand_manager}'));

do $$ begin
  -- ACL item order may differ from the original; compare privileges, not text.
  if not pg_temp.all_tbl('authenticated', 'public.api_tokens', 'SELECT,UPDATE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     or has_table_privilege('authenticated', 'public.api_tokens', 'INSERT,DELETE')
     or not pg_temp.all_tbl('service_role', 'public.api_tokens', 'SELECT,INSERT,UPDATE,DELETE')
  then raise exception 'rollback did not restore the previous api_tokens privileges'; end if;
end $$;

commit;
