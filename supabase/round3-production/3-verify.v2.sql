-- Canon · Round 3 POST-MIGRATION VERIFICATION for production fkxrmppwaaryljmzznym. READ-ONLY.
-- Run: PGOPTIONS='-c default_transaction_read_only=on' psql -v ON_ERROR_STOP=1 -f 3-verify.sql
-- v2: adds the least-privilege, token, function and notification checks from the 2026-11-14 security review. Every row
--   in the "SECURITY: expect 0 rows" queries below is a failure.
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

-- Expected: audit_log = 52 (50 + one 'policy_version' baseline row per workspace), all other counts unchanged.
-- rules check constraints exactly these seven:
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.rules'::regclass and contype = 'c' order by 1;
-- New tables: no anon privileges (expect 0 rows).
select t from unnest(array['trusted_sources','source_checks','policy_versions','notifications','webhooks','webhook_deliveries','api_tokens']) t
where has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE');
-- Baseline policy versions and their audit rows (expect one each per workspace).
select o.name, p.version, p.note, jsonb_array_length(p.rules) rules, jsonb_array_length(p.facts) facts
from public.policy_versions p join public.organisations o on o.id = p.org_id order by 1;
select action, count(*) from public.audit_log where action = 'policy_version' group by 1;
-- Existing data untouched by defaults: every existing row got the default values.
select (select count(*) from public.content_versions where source_kind <> 'text') cv_non_text,
       (select count(*) from public.rules where check_type <> 'banned_term' or params <> '{}') rules_non_default,
       (select count(*) from public.analysis_runs where purpose <> 'review') runs_non_review,
       (select count(*) from public.notifications) notifications;

-- ── SECURITY: expect 0 rows from each query below ─────────────────────────────
-- Client roles: no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN/DELETE anywhere on new tables; anon nothing at all.
select r, t, p from unnest(array['trusted_sources','source_checks','policy_versions','notifications','webhooks','webhook_deliveries','api_tokens']) t,
  unnest(array['anon','authenticated']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
where has_table_privilege(r, 'public.' || t, p)
  and not (r = 'authenticated' and p = 'SELECT' and t <> 'api_tokens');   -- table-level SELECT is the only expected grant
-- Column-level writes beyond the intended ones (expected: trusted_sources org_id/name/domain/active insert+update,
-- webhooks org_id/url/format/events insert + active update, api_tokens revoked_at update).
select table_name, column_name, privilege_type from information_schema.column_privileges
where grantee in ('anon', 'authenticated', 'PUBLIC') and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE')
  and table_name in ('trusted_sources','source_checks','policy_versions','notifications','webhooks','webhook_deliveries','api_tokens')
  and (table_name, column_name, privilege_type) not in (
    ('trusted_sources','org_id','INSERT'),('trusted_sources','name','INSERT'),('trusted_sources','domain','INSERT'),('trusted_sources','active','INSERT'),
    ('trusted_sources','org_id','UPDATE'),('trusted_sources','name','UPDATE'),('trusted_sources','domain','UPDATE'),('trusted_sources','active','UPDATE'),
    ('webhooks','org_id','INSERT'),('webhooks','url','INSERT'),('webhooks','format','INSERT'),('webhooks','events','INSERT'),
    ('webhooks','active','UPDATE'),('api_tokens','revoked_at','UPDATE'));
-- token_hash invisible and unwritable for clients; webhook secret not client-settable; identity sequence closed.
select 'token_hash' x where has_column_privilege('authenticated', 'public.api_tokens', 'token_hash', 'SELECT,INSERT,UPDATE')
union all select 'webhook secret' where has_column_privilege('authenticated', 'public.webhooks', 'secret', 'INSERT,UPDATE')
union all select 'sequence ' || r from unnest(array['anon','authenticated']) r
  where has_sequence_privilege(r, 'public.webhook_deliveries_id_seq', 'USAGE,SELECT,UPDATE');
-- New/changed functions: owner postgres, SECURITY DEFINER, search_path pinned to ''; server-only ones closed to clients.
select p.oid::regprocedure, pg_get_userbyid(p.proowner) owner, p.prosecdef, p.proconfig from pg_proc p
where p.oid in ('public.create_item_from_source(uuid,uuid,text,text,text,text,date,uuid,text,jsonb)'::regprocedure,
  'public.snapshot_policy(uuid,text)'::regprocedure, 'public.mark_notifications_read(uuid[])'::regprocedure,
  'public.submit_for_review(uuid)'::regprocedure, 'public.decide_finding(uuid,text,text)'::regprocedure,
  'private.open_blocking_count(uuid)'::regprocedure, 'private.notify_from_audit()'::regprocedure)
  and (pg_get_userbyid(p.proowner) <> 'postgres' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']);
select f, r from unnest(array['public.create_item_from_source(uuid,uuid,text,text,text,text,date,uuid,text,jsonb)',
    'private.notify_from_audit()', 'private.open_blocking_count(uuid)']) f, unnest(array['anon','authenticated']) r
where has_function_privilege(r, f, 'execute')
union all select f, 'anon' from unnest(array['public.snapshot_policy(uuid,text)', 'public.mark_notifications_read(uuid[])']) f
where has_function_privilege('anon', f, 'execute')
union all select 'old 9-arg create_item_from_source still exists', ''
where to_regprocedure('public.create_item_from_source(uuid,text,text,text,text,date,uuid,text,jsonb)') is not null;
-- Policies on new tables and storage are exactly the reviewed ones (compare definitions by eye; 13 rows expected).
select tablename, policyname, cmd, qual, with_check from pg_policies
where (schemaname = 'public' and tablename in ('trusted_sources','source_checks','policy_versions','notifications','webhooks','webhook_deliveries','api_tokens'))
   or (schemaname = 'storage' and policyname = 'content_sources_read') order by 1, 2;
-- Notifications never point at another workspace's item (expect 0 rows).
select n.id from public.notifications n join public.content_items ci on ci.id = n.item_id where ci.org_id <> n.org_id;
