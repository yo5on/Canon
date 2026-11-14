-- ════════════════════════════════════════════════════════════════════════════
-- Canon · Round 3 schema for PRODUCTION
-- Target: Supabase project ref  fkxrmppwaaryljmzznym
--   Before running, check the dashboard URL reads
--   https://supabase.com/dashboard/project/fkxrmppwaaryljmzznym/sql/...
--
-- What this is: migrations 0005_round3.sql + 0006_server_only_file_items.sql rewritten so they
--   • run as ONE transaction (any error rolls back everything; nothing is half-applied),
--   • can be re-run safely (IF NOT EXISTS / drop-if-exists-then-create / definition-based constraint lookup),
--   • never delete or rewrite existing rows (checked by an assertion before COMMIT),
--   • drop only the three old CHECK constraints they replace, found by their definition, never by guessing a name,
--   • grant execute only on the functions they create (no blanket re-grant).
-- End state is identical to 0001–0006 applied in order.
--
-- How to run: paste the whole file into SQL Editor → Run. Section 1 is read-only, Section 2 is the migration,
-- Section 3 is read-only. Or highlight one section and run it alone (run Section 1 first if you want to look before
-- changing anything).
-- ════════════════════════════════════════════════════════════════════════════


-- ── SECTION 1 · PREFLIGHT (read-only) ────────────────────────────────────────
-- Expected on a not-yet-migrated production database:
--   base_tables = 13, hardening_0003 = true, confidential_policy_0004 = true (if false, Section 2 re-applies 0004's
--   policy), round3_tables = 0, round3_columns = 0,
--   pgcrypto_ok = true, helpers_ok = true, and old_constraints listing exactly
--   content_versions_body_check, rules_category_check, rules_check.
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in
     ('organisations','memberships','rules','facts','content_items','content_versions','analysis_runs','findings',
      'claims','finding_decisions','comments','approvals','audit_log'))                              as base_tables,
  exists (select 1 from pg_trigger where tgname = 'items_reviewer_guard'
          and tgrelid = 'public.content_items'::regclass)                                             as hardening_0003,
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'facts' and policyname = 'facts_read'
          and qual like '%confidential%')                                                             as confidential_policy_0004,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in
     ('trusted_sources','source_checks','policy_versions','notifications','webhooks','webhook_deliveries','api_tokens'))
                                                                                                      as round3_tables,
  (select count(*) from information_schema.columns where table_schema = 'public' and
     (table_name, column_name) in (('content_versions','source_kind'),('rules','check_type'),('rules','params'),
       ('findings','region'),('facts','source_url'),('claims','evidence'),('analysis_runs','purpose')))  as round3_columns,
  to_regprocedure('gen_random_bytes(integer)') is not null
    or to_regprocedure('extensions.gen_random_bytes(integer)') is not null                            as pgcrypto_ok,
  to_regprocedure('private.is_member(uuid)') is not null and to_regprocedure('private.log(uuid,uuid,text,jsonb)') is not null
    and to_regprocedure('private.no_change()') is not null and to_regtype('public.role_t') is not null as helpers_ok,
  (select string_agg(conname || ' = ' || pg_get_constraintdef(oid), E'\n' order by conname) from pg_constraint
     where contype = 'c' and conrelid in ('public.rules'::regclass, 'public.content_versions'::regclass)
       and (pg_get_constraintdef(oid) like '%banned_term%' or pg_get_constraintdef(oid) like '%category%'
            or pg_get_constraintdef(oid) like '%length(body)%'))                                      as old_constraints,
  (select json_build_object('organisations', (select count(*) from organisations), 'items', (select count(*) from content_items),
     'versions', (select count(*) from content_versions), 'runs', (select count(*) from analysis_runs),
     'findings', (select count(*) from findings), 'claims', (select count(*) from claims), 'rules', (select count(*) from rules),
     'facts', (select count(*) from facts), 'approvals', (select count(*) from approvals),
     'audit_log', (select count(*) from audit_log), 'auth_users', (select count(*) from auth.users)))  as row_counts_before;


-- ── SECTION 2 · MIGRATION (one transaction) ─────────────────────────────────
begin;
set local lock_timeout = '10s';       -- never queue behind live traffic for long; just fails and rolls back
set local statement_timeout = '120s';

-- 2.0 Guards, and a snapshot of row counts so the end of the transaction can prove nothing was removed.
do $$
begin
  if to_regclass('public.rules') is null or to_regclass('public.content_versions') is null
     or to_regclass('public.audit_log') is null or to_regprocedure('private.is_member(uuid)') is null
     or to_regprocedure('private.log(uuid,uuid,text,jsonb)') is null or to_regprocedure('private.no_change()') is null
     or to_regtype('public.role_t') is null
  then raise exception 'Canon base schema (0001) not found: this is not the Canon database. Nothing was changed.'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'items_reviewer_guard' and tgrelid = 'public.content_items'::regclass)
  then raise exception 'Migration 0003 (security hardening) is missing. Apply 0002 and 0003 first. Nothing was changed.'; end if;
end $$;

-- 0004, re-asserted (idempotent, no data change): Creators read only non-confidential facts.
drop policy if exists facts_read on public.facts;
create policy facts_read on public.facts for select using (
  private.is_member(org_id)
  and (not confidential or private.has_role(org_id, '{reviewer,brand_manager}')));

create temp table r3_counts on commit drop as
select t, n from (values
  ('organisations', (select count(*) from public.organisations)), ('memberships', (select count(*) from public.memberships)),
  ('rules', (select count(*) from public.rules)), ('facts', (select count(*) from public.facts)),
  ('content_items', (select count(*) from public.content_items)), ('content_versions', (select count(*) from public.content_versions)),
  ('analysis_runs', (select count(*) from public.analysis_runs)), ('findings', (select count(*) from public.findings)),
  ('claims', (select count(*) from public.claims)), ('finding_decisions', (select count(*) from public.finding_decisions)),
  ('comments', (select count(*) from public.comments)), ('approvals', (select count(*) from public.approvals)),
  ('audit_log', (select count(*) from public.audit_log)), ('auth.users', (select count(*) from auth.users)),
  ('storage.objects', (select count(*) from storage.objects))
) v(t, n);

-- 2.1 Multimodal content (PDF, DOCX, image) ────────────────────────────────
alter table public.content_versions
  add column if not exists source_kind text not null default 'text',
  add column if not exists source_name text,
  add column if not exists source_mime text,
  add column if not exists source_bytes int,
  add column if not exists source_path text,      -- object in the private "content-sources" bucket
  add column if not exists source_sha256 text,
  add column if not exists extraction jsonb,      -- segments (page / paragraph / OCR line) mapped to body offsets
  add column if not exists alt_text text;
alter table public.content_versions drop constraint if exists content_versions_source_kind_check;
alter table public.content_versions add constraint content_versions_source_kind_check check (source_kind in ('text', 'pdf', 'docx', 'image'));
alter table public.content_versions drop constraint if exists content_versions_source_name_check;
alter table public.content_versions add constraint content_versions_source_name_check check (length(source_name) <= 255);
alter table public.content_versions drop constraint if exists content_versions_source_bytes_check;
alter table public.content_versions add constraint content_versions_source_bytes_check check (source_bytes >= 0);
alter table public.content_versions drop constraint if exists content_versions_alt_text_check;
alter table public.content_versions add constraint content_versions_alt_text_check check (length(alt_text) <= 1000);

-- Replaces only CHECK constraints on content_versions that test length(body) (0001: "length(body) between 1 and 40000"),
-- whatever they are called. An image may contain no text, so its body may be empty.
do $$
declare c record;
begin
  for c in select conname, pg_get_constraintdef(oid) d from pg_constraint
           where conrelid = 'public.content_versions'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%length(body)%'
  loop
    execute format('alter table public.content_versions drop constraint %I', c.conname);
    raise notice 'dropped content_versions.% (%)', c.conname, c.d;
  end loop;
end $$;
alter table public.content_versions add constraint content_versions_body_check
  check (length(body) <= 40000 and (length(body) >= 1 or source_kind = 'image'));

-- Rules: visual category, typed code checks with parameters.
alter table public.rules
  add column if not exists check_type text not null default 'banned_term',
  add column if not exists params jsonb not null default '{}';
alter table public.rules drop constraint if exists rules_check_type_check;
alter table public.rules add constraint rules_check_type_check check (check_type in ('banned_term', 'contrast', 'palette', 'alt_text'));

-- Replaces only: (a) the CHECK listing allowed categories, (b) the CHECK "code rules need a banned_term"
-- (0001's unnamed table check, auto-named rules_check). Both found by definition; nothing else on rules is touched.
do $$
declare c record;
begin
  for c in select conname, pg_get_constraintdef(oid) d from pg_constraint
           where conrelid = 'public.rules'::regclass and contype = 'c'
             and (   (pg_get_constraintdef(oid) like '%category%' and pg_get_constraintdef(oid) like '%tone%')
                  or (pg_get_constraintdef(oid) like '%check_kind%' and pg_get_constraintdef(oid) like '%banned_term%'))
  loop
    execute format('alter table public.rules drop constraint %I', c.conname);
    raise notice 'dropped rules.% (%)', c.conname, c.d;
  end loop;
end $$;
alter table public.rules add constraint rules_category_check
  check (category in ('tone', 'terminology', 'claim', 'messaging', 'accessibility', 'visual'));
-- Same rule as before for every existing row (they all get check_type = 'banned_term').
alter table public.rules add constraint rules_code_needs_params
  check (check_kind <> 'code' or check_type <> 'banned_term' or banned_term is not null);

alter table public.findings add column if not exists region jsonb; -- {x, y, w, h, image_w, image_h}, verified in bounds by code

-- Items created from a file: server-only (the server stored and validated the file and computed the extraction).
drop function if exists public.create_item_from_source(uuid, text, text, text, text, date, uuid, text, jsonb); -- 0005's client-callable form
create or replace function public.create_item_from_source(p_author uuid, p_org uuid, p_title text, p_channel text, p_audience text,
  p_goal text, p_publish date, p_reviewer uuid, p_body text, p_source jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i uuid; k text := p_source->>'kind';
begin
  if not exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = p_author) then raise exception 'forbidden'; end if;
  if p_reviewer = p_author then raise exception 'you cannot review your own item'; end if;
  if k not in ('pdf', 'docx', 'image') then raise exception 'bad source kind'; end if;
  if coalesce(p_source->>'path', '') not like p_org::text || '/%' then raise exception 'bad source path'; end if;
  insert into public.content_items (org_id, author_id, title, channel, audience, goal, publish_date, reviewer_id)
    values (p_org, p_author, p_title, p_channel, p_audience, p_goal, p_publish, p_reviewer) returning id into i;
  insert into public.content_versions (org_id, item_id, version, body, created_by, source_kind, source_name, source_mime,
      source_bytes, source_path, source_sha256, extraction, alt_text)
    values (p_org, i, 1, p_body, p_author, k, p_source->>'name', p_source->>'mime', (p_source->>'bytes')::int,
      p_source->>'path', p_source->>'sha256', p_source->'extraction', nullif(trim(p_source->>'alt_text'), ''));
  insert into public.audit_log (org_id, item_id, actor_id, action, detail)
    values (p_org, i, p_author, 'created', jsonb_build_object('version', 1, 'source', k, 'file', p_source->>'name'));
  return i;
end $$;
revoke execute on function public.create_item_from_source(uuid, uuid, text, text, text, text, date, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_item_from_source(uuid, uuid, text, text, text, text, date, uuid, text, jsonb) to service_role;

-- Private bucket for original files. Workspace members (first path segment = org id) may read; only the server writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('content-sources', 'content-sources', false, 10485760,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists content_sources_read on storage.objects;
create policy content_sources_read on storage.objects for select to authenticated
  using (bucket_id = 'content-sources' and private.is_member(((storage.foldername(name))[1])::uuid));

-- 2.2 Source intelligence ──────────────────────────────────────────────────
alter table public.facts add column if not exists source_url text;
alter table public.facts drop constraint if exists facts_source_url_check;
alter table public.facts add constraint facts_source_url_check check (source_url is null or source_url ~ '^https?://');

create table if not exists public.trusted_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations on delete cascade,
  name text not null check (length(name) between 1 and 120),
  domain text not null check (domain ~ '^[a-z0-9.-]+(:[0-9]+)?$'),
  active boolean not null default true,
  added_by uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now(),
  unique (org_id, domain)
);

-- One row per retrieval. Written only by the server; never edited.
create table if not exists public.source_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations on delete cascade,
  fact_code text not null,
  fact_version int not null,
  url text not null,
  retrieved_at timestamptz not null default now(),
  http_status int,
  outcome text not null check (outcome in ('confirmed', 'not_found', 'changed', 'unavailable', 'blocked')),
  excerpt text,
  content_sha256 text,
  page_text text,
  error text,
  checked_by uuid
);
create index if not exists source_checks_org_id_fact_code_retrieved_at_idx on public.source_checks (org_id, fact_code, retrieved_at desc);

alter table public.claims
  add column if not exists evidence jsonb not null default '[]', -- retrieved evidence copied at run time
  add column if not exists ai_candidates jsonb;                  -- the model's suggestions, kept apart from evidence

-- 2.3 Policy versions and monitoring ─────────────────────────────────────────
create table if not exists public.policy_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations on delete cascade,
  version int not null,
  rules jsonb not null,
  facts jsonb not null,
  note text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, version)
);

create or replace function public.snapshot_policy(p_org uuid, p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare r jsonb; f jsonb; last public.policy_versions; nid uuid;
begin
  if auth.uid() is not null and not private.is_member(p_org) then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtext('policy:' || p_org::text));
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'version', version, 'id', id) order by code), '[]') into r
    from public.rules where org_id = p_org and is_current;
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'version', version, 'id', id) order by code), '[]') into f
    from public.facts where org_id = p_org and is_current;
  select * into last from public.policy_versions where org_id = p_org order by version desc limit 1;
  if last.id is not null and last.rules = r and last.facts = f then return last.id; end if;
  insert into public.policy_versions (org_id, version, rules, facts, note, created_by)
    values (p_org, coalesce(last.version, 0) + 1, r, f, coalesce(p_note, ''), auth.uid()) returning id into nid;
  perform private.log(p_org, null, 'policy_version', jsonb_build_object('version', coalesce(last.version, 0) + 1, 'note', p_note));
  return nid;
end $$;
revoke execute on function public.snapshot_policy(uuid, text) from public, anon;
grant execute on function public.snapshot_policy(uuid, text) to authenticated, service_role;

alter table public.analysis_runs
  add column if not exists purpose text not null default 'review',
  add column if not exists policy_version_id uuid references public.policy_versions,
  add column if not exists policy jsonb; -- copy of the rule/fact versions this run applied
alter table public.analysis_runs drop constraint if exists analysis_runs_purpose_check;
alter table public.analysis_runs add constraint analysis_runs_purpose_check check (purpose in ('review', 'monitor'));

-- Monitoring runs never change what blocks approval: only review runs count. (Existing runs are all 'review'.)
create or replace function private.open_blocking_count(p_item uuid)
returns int language sql stable security definer set search_path = '' as $$
  with v as (
    select cv.id from public.content_versions cv join public.content_items ci on ci.id = cv.item_id
    where ci.id = p_item and cv.version = ci.current_version),
  r as (select ar.id from public.analysis_runs ar where ar.version_id = (select id from v) and ar.purpose = 'review'
        order by ar.created_at desc limit 1)
  select count(*)::int from public.findings f
  where f.run_id = (select id from r) and f.severity = 'blocking' and f.verified
    and not exists (select 1 from public.finding_decisions d where d.finding_id = f.id and d.decision = 'overridden');
$$;
revoke execute on function private.open_blocking_count(uuid) from public, anon, authenticated;

create or replace function public.submit_for_review(p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare it public.content_items;
begin
  select * into it from public.content_items where id = p_item for update;
  if it.author_id is distinct from auth.uid() then raise exception 'only the author can submit'; end if;
  if it.status not in ('draft', 'changes_requested') then raise exception 'item is %', it.status; end if;
  if it.reviewer_id is null then raise exception 'choose a reviewer first'; end if;
  if not exists (select 1 from public.analysis_runs ar join public.content_versions cv on cv.id = ar.version_id
                 where cv.item_id = p_item and cv.version = it.current_version and ar.status <> 'running' and ar.purpose = 'review')
    then raise exception 'run checks on the current version before submitting'; end if;
  update public.content_items set status = 'in_review', updated_at = now() where id = p_item;
  perform private.log(it.org_id, p_item, 'submitted', jsonb_build_object('version', it.current_version));
end $$;

-- A finding gets one decision per kind: a double click or a second tab cannot record it twice.
create or replace function public.decide_finding(p_finding uuid, p_decision text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.findings; it public.content_items;
begin
  select * into f from public.findings where id = p_finding;
  if f.id is null or not private.is_member(f.org_id) then raise exception 'forbidden'; end if;
  select ci.* into it from public.content_items ci join public.content_versions cv on cv.item_id = ci.id
    join public.analysis_runs ar on ar.version_id = cv.id where ar.id = f.run_id for update of ci;
  if p_decision = 'overridden' then
    if not private.has_role(f.org_id, array['reviewer', 'brand_manager']::public.role_t[]) or it.author_id = auth.uid()
      then raise exception 'only a reviewer other than the author can override'; end if;
    if it.status <> 'in_review' then raise exception 'item is %', it.status; end if;
    if exists (select 1 from public.finding_decisions d where d.finding_id = p_finding and d.decision = 'overridden')
      then raise exception 'already decided'; end if;
  elsif p_decision in ('accepted', 'rejected') then
    if it.author_id is distinct from auth.uid() then raise exception 'only the author decides on fixes'; end if;
    if it.status not in ('draft', 'changes_requested') then raise exception 'item is %', it.status; end if;
    if exists (select 1 from public.finding_decisions d where d.finding_id = p_finding and d.decision in ('accepted', 'rejected'))
      then raise exception 'already decided'; end if;
  else raise exception 'bad decision';
  end if;
  insert into public.finding_decisions (org_id, finding_id, decided_by, decision, reason)
    values (f.org_id, p_finding, auth.uid(), p_decision, coalesce(p_reason, ''));
  perform private.log(f.org_id, it.id, 'finding_' || p_decision,
    jsonb_build_object('finding', p_finding, 'source', f.source_code, 'reason', p_reason));
end $$;

-- 2.4 Notifications (in-app inbox) ───────────────────────────────────────────
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  item_id uuid references public.content_items on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  link text not null default '/',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_id_created_at_idx on public.notifications (user_id, created_at desc);

-- Every notification comes from an audit entry, so nothing notifies without being on the record.
create or replace function private.notify_from_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare it public.content_items; link text;
begin
  if new.item_id is not null then select * into it from public.content_items where id = new.item_id; end if;
  link := case when new.item_id is not null then '/submissions/' || new.item_id else '/governance' end;
  if new.action = 'submitted' and it.reviewer_id is not null then
    insert into public.notifications (org_id, user_id, item_id, kind, title, body, link)
      values (new.org_id, it.reviewer_id, it.id, 'review_requested', 'Review requested: ' || it.title,
              'Submitted for review at v' || coalesce(new.detail->>'version', '?') || '.', link);
  elsif new.action in ('approved', 'rejected', 'changes_requested') then
    insert into public.notifications (org_id, user_id, item_id, kind, title, body, link)
      values (new.org_id, it.author_id, it.id, 'decision', initcap(replace(new.action, '_', ' ')) || ': ' || it.title,
              coalesce(new.detail->>'reason', ''), link);
  elsif new.action = 'monitor_alert' then
    insert into public.notifications (org_id, user_id, item_id, kind, title, body, link)
      select distinct new.org_id, u, it.id, 'monitor_alert', 'Re-check found new issues: ' || it.title,
             coalesce(new.detail->>'summary', ''), link
      from unnest(array[it.author_id] || array(select m.user_id from public.memberships m
                  where m.org_id = new.org_id and m.role = 'brand_manager')) u where u is not null;
  elsif new.action = 'source_changed' then
    insert into public.notifications (org_id, user_id, kind, title, body, link)
      select new.org_id, m.user_id, 'source_changed', 'Source no longer confirms ' || coalesce(new.detail->>'fact', 'a fact'),
             coalesce(new.detail->>'summary', ''), '/brand-kit?tab=sources'
      from public.memberships m where m.org_id = new.org_id and m.role = 'brand_manager';
  end if;
  return new;
end $$;
revoke execute on function private.notify_from_audit() from public, anon, authenticated;
drop trigger if exists audit_notify on public.audit_log;
create trigger audit_notify after insert on public.audit_log for each row execute function private.notify_from_audit();

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
$$;
revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated, service_role;

-- 2.5 Integrations: outgoing webhooks and publish-gate API tokens ──────────────
create table if not exists public.webhooks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations on delete cascade,
  url text not null check (url ~ '^https://' and length(url) <= 500),
  format text not null default 'json' check (format in ('json', 'slack')),
  events text[] not null default '{submitted,approved,rejected,changes_requested,monitor_alert,source_changed}',
  secret text not null default encode(gen_random_bytes(24), 'hex'),
  active boolean not null default true,
  created_by uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_deliveries (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organisations on delete cascade,
  webhook_id uuid references public.webhooks on delete cascade,
  event text not null,
  status_code int,
  ok boolean not null,
  error text,
  duration_ms int,
  at timestamptz not null default now()
);
create index if not exists webhook_deliveries_org_id_at_idx on public.webhook_deliveries (org_id, at desc);

create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations on delete cascade,
  name text not null check (length(name) between 1 and 80),
  token_hash text not null unique, -- sha256 of the token; the token itself is shown once
  prefix text not null,
  created_by uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- 2.6 Row-level security and privileges on the new tables ─────────────────────
alter table public.trusted_sources enable row level security;
alter table public.source_checks enable row level security;
alter table public.policy_versions enable row level security;
alter table public.notifications enable row level security;
alter table public.webhooks enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.api_tokens enable row level security;

drop policy if exists ts_read on public.trusted_sources;
create policy ts_read on public.trusted_sources for select using (private.is_member(org_id));
drop policy if exists ts_write on public.trusted_sources;
create policy ts_write on public.trusted_sources for insert with check (private.has_role(org_id, '{brand_manager}'));
drop policy if exists ts_update on public.trusted_sources;
create policy ts_update on public.trusted_sources for update using (private.has_role(org_id, '{brand_manager}'));
drop policy if exists sc_read on public.source_checks;
create policy sc_read on public.source_checks for select using (private.is_member(org_id));
drop policy if exists pv_read on public.policy_versions;
create policy pv_read on public.policy_versions for select using (private.is_member(org_id));
drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications for select using (user_id = auth.uid());
drop policy if exists wh_read on public.webhooks;
create policy wh_read on public.webhooks for select using (private.has_role(org_id, '{brand_manager}'));
drop policy if exists wh_write on public.webhooks;
create policy wh_write on public.webhooks for insert with check (private.has_role(org_id, '{brand_manager}'));
drop policy if exists wh_update on public.webhooks;
create policy wh_update on public.webhooks for update using (private.has_role(org_id, '{brand_manager}'));
drop policy if exists whd_read on public.webhook_deliveries;
create policy whd_read on public.webhook_deliveries for select using (private.has_role(org_id, '{brand_manager}'));
drop policy if exists tok_read on public.api_tokens;
create policy tok_read on public.api_tokens for select using (private.has_role(org_id, '{brand_manager}'));
drop policy if exists tok_update on public.api_tokens;
create policy tok_update on public.api_tokens for update using (private.has_role(org_id, '{brand_manager}'));

revoke insert, update, delete on public.source_checks, public.policy_versions, public.notifications, public.webhook_deliveries from anon, authenticated;
revoke delete on public.trusted_sources, public.webhooks, public.api_tokens from anon, authenticated;
revoke insert on public.api_tokens from anon, authenticated; -- tokens are minted by the server so the hash is computed there
revoke all on public.trusted_sources, public.source_checks, public.policy_versions, public.notifications, public.webhooks,
  public.webhook_deliveries, public.api_tokens from anon;
drop trigger if exists source_checks_append_only on public.source_checks;
create trigger source_checks_append_only before update or delete on public.source_checks for each row execute function private.no_change();
drop trigger if exists policy_versions_append_only on public.policy_versions;
create trigger policy_versions_append_only before update or delete on public.policy_versions for each row execute function private.no_change();

-- 2.7 Baseline policy version per workspace. Re-running adds nothing: snapshot_policy returns the latest version
--     when the current rules and facts have not changed. (First run writes one 'policy_version' audit row per workspace.)
select public.snapshot_policy(id, 'Baseline (Round 2 Brand Kit)') from public.organisations;

-- 2.8 Proof before COMMIT: no existing row was removed; only audit_log may grow (baseline entries above).
do $$
declare c record; now_n bigint;
begin
  for c in select * from r3_counts loop
    execute format('select count(*) from %s', case when c.t like '%.%' then c.t else 'public.' || c.t end) into now_n;
    if (c.t = 'audit_log' and now_n < c.n) or (c.t <> 'audit_log' and now_n <> c.n) then
      raise exception 'row count changed for % (% → %): rolling back', c.t, c.n, now_n;
    end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid = 'public.rules'::regclass and conname in ('rules_category_check', 'rules_code_needs_params')) <> 2
     or not exists (select 1 from pg_constraint where conrelid = 'public.content_versions'::regclass and conname = 'content_versions_body_check')
  then raise exception 'replacement constraints missing: rolling back'; end if;
end $$;

notify pgrst, 'reload schema'; -- PostgREST picks up the new tables and columns (sent at COMMIT)
commit;


-- ── SECTION 3 · POST-MIGRATION VERIFICATION (read-only) ─────────────────────
-- Expected: confidential_policy_0004 = true, round3_tables = 7, round3_columns = 7, rls_on_new_tables = 7, new_policies = 12, bucket = true,
--   storage_policy = true, audit_trigger = true, policy_versions >= number of workspaces,
--   create_item_from_source callable by authenticated = false and by service_role = true,
--   snapshot_policy and mark_notifications_read callable by authenticated = true, anon = false,
--   and constraints listing content_versions_body_check, rules_category_check, rules_code_needs_params (no rules_check).
select
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'facts' and policyname = 'facts_read'
          and qual like '%confidential%')                                                                         as confidential_policy_0004,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in
     ('trusted_sources','source_checks','policy_versions','notifications','webhooks','webhook_deliveries','api_tokens')) as round3_tables,
  (select count(*) from information_schema.columns where table_schema = 'public' and
     (table_name, column_name) in (('content_versions','source_kind'),('rules','check_type'),('rules','params'),
       ('findings','region'),('facts','source_url'),('claims','evidence'),('analysis_runs','purpose')))            as round3_columns,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity and relname in
     ('trusted_sources','source_checks','policy_versions','notifications','webhooks','webhook_deliveries','api_tokens')) as rls_on_new_tables,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in
     ('trusted_sources','source_checks','policy_versions','notifications','webhooks','webhook_deliveries','api_tokens')) as new_policies,
  exists (select 1 from storage.buckets where id = 'content-sources' and not public)                              as bucket,
  exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'content_sources_read')                                                               as storage_policy,
  exists (select 1 from pg_trigger where tgname = 'audit_notify' and tgrelid = 'public.audit_log'::regclass)      as audit_trigger,
  (select count(*) from public.organisations)                                                                    as workspaces,
  (select count(*) from public.policy_versions)                                                                  as policy_versions,
  has_function_privilege('authenticated', 'public.create_item_from_source(uuid,uuid,text,text,text,text,date,uuid,text,jsonb)', 'execute') as cifs_authenticated,
  has_function_privilege('service_role', 'public.create_item_from_source(uuid,uuid,text,text,text,text,date,uuid,text,jsonb)', 'execute') as cifs_service_role,
  has_function_privilege('authenticated', 'public.snapshot_policy(uuid,text)', 'execute')
    and has_function_privilege('authenticated', 'public.mark_notifications_read(uuid[])', 'execute')             as rpcs_authenticated,
  has_function_privilege('anon', 'public.snapshot_policy(uuid,text)', 'execute')
    or has_function_privilege('anon', 'public.mark_notifications_read(uuid[])', 'execute')                      as rpcs_anon,
  (select string_agg(conname, ', ' order by conname) from pg_constraint where contype = 'c'
     and conrelid in ('public.rules'::regclass, 'public.content_versions'::regclass)
     and conname in ('rules_check', 'rules_category_check', 'rules_code_needs_params', 'content_versions_body_check')) as constraints,
  (select json_build_object('organisations', (select count(*) from organisations), 'items', (select count(*) from content_items),
     'versions', (select count(*) from content_versions), 'runs', (select count(*) from analysis_runs),
     'findings', (select count(*) from findings), 'claims', (select count(*) from claims), 'rules', (select count(*) from rules),
     'facts', (select count(*) from facts), 'approvals', (select count(*) from approvals),
     'audit_log', (select count(*) from audit_log), 'auth_users', (select count(*) from auth.users)))             as row_counts_after;
