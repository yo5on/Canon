-- Canon production — v2 follow-up C: content-sources read policy denies non-uuid folder names instead of erroring.
-- Independent of the other scripts. NOT YET APPROVED FOR EXECUTION.
-- Production today: ((storage.foldername(name))[1])::uuid — a non-uuid or root-level object name raises
-- "invalid input syntax for type uuid", failing the whole list/select for that user rather than just hiding the row.
-- Read 2026-11-15: 0 objects in content-sources, 0 non-uuid folders. Uploads are server-side with an org uuid prefix.
-- CASE guarantees the cast is only reached for a uuid-shaped folder (AND has no evaluation-order guarantee).
-- ~* accepts upper-case uuids too, which ::uuid also accepts.
-- Rollback: block at the bottom.

begin;
set local lock_timeout = '5s';   -- storage.objects is busy; fail fast rather than block uploads

do $$ begin
  if (select system_identifier from pg_control_system()) <> 7703759698107299042 then
    raise exception 'PRE: not the Canon production cluster'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'content_sources_read' and cmd = 'SELECT' and roles = '{authenticated}') then
    raise exception 'PRE: content_sources_read not found as expected'; end if;
end $$;

drop policy content_sources_read on storage.objects;
create policy content_sources_read on storage.objects for select to authenticated
  using (bucket_id = 'content-sources' and case
           when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then private.is_member(((storage.foldername(name))[1])::uuid) else false end);

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'content_sources_read' and roles = '{authenticated}' and qual like '%CASE%private.is_member%') then
    raise exception 'POST: content_sources_read not as expected'; end if;
end $$;

commit;

-- ── ROLLBACK ──
-- begin;
-- drop policy content_sources_read on storage.objects;
-- create policy content_sources_read on storage.objects for select to authenticated
--   using (bucket_id = 'content-sources' and private.is_member(((storage.foldername(name))[1])::uuid));
-- commit;
