-- Canon production — v2 follow-up B: a user sees their notifications only while still a member of that workspace.
-- Independent of the other scripts. NOT YET APPROVED FOR EXECUTION.
-- Production today: notif_read USING (user_id = auth.uid()). Read 2026-11-15: 0 notifications belong to ex-members,
-- so no currently visible row disappears. App reads (layout.tsx, inbox/page.tsx) already filter by the active org.
-- mark_notifications_read (SECURITY DEFINER) is unaffected: it bypasses this policy and still only touches auth.uid()'s rows.
-- Rollback: block at the bottom.

begin;
set local lock_timeout = '5s';

do $$ begin
  if (select system_identifier from pg_control_system()) <> 7703759698107299042 then
    raise exception 'PRE: not the Canon production cluster'; end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'notifications') <> 1 then
    raise exception 'PRE: expected exactly one policy (notif_read) on notifications'; end if;
  if not has_function_privilege('authenticated', 'private.is_member(uuid)', 'execute') then
    raise exception 'PRE: authenticated cannot execute private.is_member'; end if;
end $$;

drop policy notif_read on public.notifications;
create policy notif_read on public.notifications for select
  using (user_id = auth.uid() and private.is_member(org_id));

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications'
                   and policyname = 'notif_read' and cmd = 'SELECT' and qual like '%auth.uid()%' and qual like '%private.is_member(org_id)%')
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'notifications') <> 1 then
    raise exception 'POST: notif_read not as expected'; end if;
end $$;

commit;

-- ── ROLLBACK ──
-- begin;
-- drop policy notif_read on public.notifications;
-- create policy notif_read on public.notifications for select using (user_id = auth.uid());
-- commit;
