-- Read-only verification for the hardening scripts. Run before and after each script:
--   PGOPTIONS="-c default_transaction_read_only=on" psql -X -h db.fkxrmppwaaryljmzznym.supabase.co -U postgres -d postgres -f verify.sql
\pset pager off
select (select system_identifier from pg_control_system()) = 7703759698107299042 as is_canon_prod,
       current_setting('transaction_read_only') as read_only;

\echo == 1. client privilege matrix on the 7 Round 3 tables (expect after: no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN)
select t, r,
  has_table_privilege(r, 'public.'||t, 'SELECT') sel, has_table_privilege(r, 'public.'||t, 'INSERT') ins,
  has_table_privilege(r, 'public.'||t, 'UPDATE') upd, has_table_privilege(r, 'public.'||t, 'DELETE') del,
  has_table_privilege(r, 'public.'||t, 'TRUNCATE') trunc, has_table_privilege(r, 'public.'||t, 'REFERENCES') refs,
  has_table_privilege(r, 'public.'||t, 'TRIGGER') trig, has_table_privilege(r, 'public.'||t, 'MAINTAIN') maint
from unnest(array['trusted_sources','source_checks','policy_versions','notifications','webhooks','webhook_deliveries','api_tokens']) t,
     unnest(array['anon','authenticated','service_role']) r order by 1, 2;

\echo == 2. api_tokens column privileges (expect after: authenticated token_hash f/f/f; UPDATE only revoked_at)
select r, a.attname,
  has_column_privilege(r, 'public.api_tokens', a.attname, 'SELECT') sel,
  has_column_privilege(r, 'public.api_tokens', a.attname, 'INSERT') ins,
  has_column_privilege(r, 'public.api_tokens', a.attname, 'UPDATE') upd
from unnest(array['anon','authenticated','service_role']) r, pg_attribute a
where a.attrelid = 'public.api_tokens'::regclass and a.attnum > 0 and not a.attisdropped order by 1, a.attnum;

\echo == 3. expect 0 rows: any client access to token_hash
select r from unnest(array['anon','authenticated']) r
where has_column_privilege(r, 'public.api_tokens', 'token_hash', 'SELECT,INSERT,UPDATE,REFERENCES');

\echo == 4. policies under review
select schemaname, tablename, policyname, cmd, roles, qual, with_check from pg_policies
where (schemaname = 'public' and tablename in ('api_tokens','notifications'))
   or (schemaname = 'storage' and policyname = 'content_sources_read') order by 1, 2, 3;

\echo == 5. service_role (expect bypassrls t, all t)
select rolbypassrls,
  has_table_privilege('service_role','public.api_tokens','SELECT') s, has_table_privilege('service_role','public.api_tokens','INSERT') i,
  has_table_privilege('service_role','public.api_tokens','UPDATE') u, has_table_privilege('service_role','public.api_tokens','DELETE') d,
  has_column_privilege('service_role','public.api_tokens','token_hash','SELECT') hash_sel
from pg_roles where rolname = 'service_role';

\echo == 6. notify_from_audit: workspace filter present, ACL, trigger
select position('and org_id = new.org_id' in pg_get_functiondef('private.notify_from_audit()'::regprocedure)) > 0 as scoped,
       p.prosecdef, p.proacl, p.proconfig,
       (select tgenabled from pg_trigger where tgname = 'audit_notify' and tgrelid = 'public.audit_log'::regclass) trigger_enabled
from pg_proc p where p.oid = 'private.notify_from_audit()'::regprocedure;

\echo == 7. data untouched (compare with pre-run values)
select (select count(*) from public.api_tokens) tokens, (select count(*) from public.api_tokens where revoked_at is null) live,
       (select count(*) from public.notifications) notifications, (select count(*) from public.audit_log) audit_rows;
