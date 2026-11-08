-- Security hardening pass.

-- 1. open_blocking leaked blocking counts for items in other workspaces (SECURITY DEFINER skips RLS).
--    The raw count moves to private (used by the approval trigger, which must keep working for the
--    service role). The public RPC returns NULL unless the caller is a member of the item's workspace,
--    so an inaccessible item and a non-existent item are indistinguishable.
create or replace function private.open_blocking_count(p_item uuid)
returns int language sql stable security definer set search_path = '' as $$
  with v as (
    select cv.id from public.content_versions cv join public.content_items ci on ci.id = cv.item_id
    where ci.id = p_item and cv.version = ci.current_version),
  r as (select ar.id from public.analysis_runs ar where ar.version_id = (select id from v)
        order by ar.created_at desc limit 1)
  select count(*)::int from public.findings f
  where f.run_id = (select id from r) and f.severity = 'blocking' and f.verified
    and not exists (select 1 from public.finding_decisions d where d.finding_id = f.id and d.decision = 'overridden');
$$;
revoke execute on function private.open_blocking_count(uuid) from public, anon, authenticated;

create or replace function public.open_blocking(p_item uuid)
returns int language sql stable security definer set search_path = '' as $$
  select private.open_blocking_count(ci.id) from public.content_items ci
  where ci.id = p_item and private.is_member(ci.org_id);
$$;

create or replace function private.check_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
declare it public.content_items;
begin
  select * into it from public.content_items where id = new.item_id;
  if new.approver_id is null then raise exception 'approvals need a human approver'; end if;
  if new.approver_id = it.author_id then raise exception 'nobody can approve their own submission'; end if;
  if not exists (select 1 from public.memberships m where m.org_id = it.org_id and m.user_id = new.approver_id
                 and m.role in ('reviewer', 'brand_manager'))
    then raise exception 'approver must be a Reviewer or Brand Manager in this workspace'; end if;
  if new.decision = 'approved' and private.open_blocking_count(new.item_id) > 0
    then raise exception 'blocking issues remain: fix them or override with a reason'; end if;
  return new;
end $$;

-- 2. Reviewer assignment: enforced by trigger so create_item, any future function and the service
--    role are all held to it. Reviewer must be a Reviewer/Brand Manager in the item's workspace
--    and not the author.
create or replace function private.check_reviewer()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reviewer_id is null then return new; end if;
  if new.reviewer_id = new.author_id then raise exception 'you cannot review your own item'; end if;
  if not exists (select 1 from public.memberships m where m.org_id = new.org_id and m.user_id = new.reviewer_id
                 and m.role in ('reviewer', 'brand_manager'))
    then raise exception 'reviewer must be a Reviewer or Brand Manager in this workspace'; end if;
  return new;
end $$;
revoke execute on function private.check_reviewer() from public, anon, authenticated;
create trigger items_reviewer_guard before insert or update of reviewer_id, org_id, author_id on content_items
  for each row execute function private.check_reviewer();

-- 3. Pin search_path (body only uses tg_table_name, so behaviour is unchanged).
alter function private.no_change() set search_path = '';
