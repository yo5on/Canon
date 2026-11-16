-- Canon · Round 3 PREFLIGHT for production fkxrmppwaaryljmzznym. READ-ONLY.
-- Run: PGOPTIONS='-c default_transaction_read_only=on' psql -v ON_ERROR_STOP=1 -f 1-preflight.sql
-- Expected (as inspected 2026-11-14): is_production = true, base_tables = 13, hardening_0003 = true,
--   confidential_policy_0004 = true, round3_tables = 0, round3_columns = 0, pgcrypto_ok = true, helpers_ok = true,
--   old_constraints = exactly content_versions_body_check, rules_category_check, rules_check,
--   storage_policy_grant = true, active_sessions low.
select (select system_identifier from pg_control_system()) = 7703759698107299042                    as is_production,
       current_setting('transaction_read_only')                                                       as read_only_session;
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
select coalesce(current_setting('supautils.policy_grants', true), '') like '%storage.objects%'          as storage_policy_grant,
       (select count(*) from pg_stat_activity where datname = current_database() and state = 'active'
          and pid <> pg_backend_pid())                                                                  as active_sessions;
