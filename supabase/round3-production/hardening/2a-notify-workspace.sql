-- Canon production — v2 follow-up A: notify_from_audit only notifies about an item in the audit row's own workspace.
-- Independent of 1-token-hardening.sql. NOT YET APPROVED FOR EXECUTION.
-- Changes vs production (read 2026-11-15):
--   * item lookup adds `and org_id = new.org_id`; an audit row whose item_id is in another workspace notifies nobody.
--   * decision / monitor_alert branches require the item to exist (today an approved/rejected audit row with a null
--     or missing item would try to insert user_id NULL → NOT NULL error → the audit insert itself fails).
-- CREATE OR REPLACE keeps owner, ACL {postgres=X/postgres} and the audit_notify trigger binding.
-- Rollback: re-run the "ROLLBACK" block at the bottom (exact production body as of 2026-11-15).

begin;
set local lock_timeout = '5s';

do $$ begin
  if (select system_identifier from pg_control_system()) <> 7703759698107299042 then
    raise exception 'PRE: not the Canon production cluster'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit_notify' and tgrelid = 'public.audit_log'::regclass
                   and tgfoid = 'private.notify_from_audit()'::regprocedure) then
    raise exception 'PRE: audit_notify trigger not bound to private.notify_from_audit()'; end if;
end $$;

create or replace function private.notify_from_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare it public.content_items; link text;
begin
  -- Only an item in the audit row's own workspace; otherwise no item-based notification is sent.
  if new.item_id is not null then select * into it from public.content_items where id = new.item_id and org_id = new.org_id; end if;
  if new.item_id is not null and it.id is null then return new; end if;
  link := case when new.item_id is not null then '/submissions/' || new.item_id else '/governance' end;
  if new.action = 'submitted' and it.reviewer_id is not null then
    insert into public.notifications (org_id, user_id, item_id, kind, title, body, link)
      values (new.org_id, it.reviewer_id, it.id, 'review_requested', 'Review requested: ' || it.title,
              'Submitted for review at v' || coalesce(new.detail->>'version', '?') || '.', link);
  elsif new.action in ('approved', 'rejected', 'changes_requested') and it.id is not null then
    insert into public.notifications (org_id, user_id, item_id, kind, title, body, link)
      values (new.org_id, it.author_id, it.id, 'decision', initcap(replace(new.action, '_', ' ')) || ': ' || it.title,
              coalesce(new.detail->>'reason', ''), link);
  elsif new.action = 'monitor_alert' and it.id is not null then
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

do $$ begin
  if position('and org_id = new.org_id' in pg_get_functiondef('private.notify_from_audit()'::regprocedure)) = 0 then
    raise exception 'POST: workspace filter missing'; end if;
  if not (select prosecdef from pg_proc where oid = 'private.notify_from_audit()'::regprocedure)
     or (select proconfig from pg_proc where oid = 'private.notify_from_audit()'::regprocedure) <> array['search_path=""']
     or has_function_privilege('authenticated', 'private.notify_from_audit()', 'execute')
     or has_function_privilege('anon', 'private.notify_from_audit()', 'execute') then
    raise exception 'POST: security attributes / ACL changed'; end if;
end $$;

commit;

-- ── ROLLBACK (run separately only if needed) ──────────────────────────────────────────────────────────────
-- begin;
-- create or replace function private.notify_from_audit()
-- returns trigger language plpgsql security definer set search_path = '' as $$
-- declare it public.content_items; link text;
-- begin
--   if new.item_id is not null then select * into it from public.content_items where id = new.item_id; end if;
--   link := case when new.item_id is not null then '/submissions/' || new.item_id else '/governance' end;
--   if new.action = 'submitted' and it.reviewer_id is not null then
--     insert into public.notifications (org_id, user_id, item_id, kind, title, body, link)
--       values (new.org_id, it.reviewer_id, it.id, 'review_requested', 'Review requested: ' || it.title,
--               'Submitted for review at v' || coalesce(new.detail->>'version', '?') || '.', link);
--   elsif new.action in ('approved', 'rejected', 'changes_requested') then
--     insert into public.notifications (org_id, user_id, item_id, kind, title, body, link)
--       values (new.org_id, it.author_id, it.id, 'decision', initcap(replace(new.action, '_', ' ')) || ': ' || it.title,
--               coalesce(new.detail->>'reason', ''), link);
--   elsif new.action = 'monitor_alert' then
--     insert into public.notifications (org_id, user_id, item_id, kind, title, body, link)
--       select distinct new.org_id, u, it.id, 'monitor_alert', 'Re-check found new issues: ' || it.title,
--              coalesce(new.detail->>'summary', ''), link
--       from unnest(array[it.author_id] || array(select m.user_id from public.memberships m
--                   where m.org_id = new.org_id and m.role = 'brand_manager')) u where u is not null;
--   elsif new.action = 'source_changed' then
--     insert into public.notifications (org_id, user_id, kind, title, body, link)
--       select new.org_id, m.user_id, 'source_changed', 'Source no longer confirms ' || coalesce(new.detail->>'fact', 'a fact'),
--              coalesce(new.detail->>'summary', ''), '/brand-kit?tab=sources'
--       from public.memberships m where m.org_id = new.org_id and m.role = 'brand_manager';
--   end if;
--   return new;
-- end $$;
-- commit;
