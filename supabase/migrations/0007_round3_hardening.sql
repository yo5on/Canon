-- Round 3 hardening: brings the migrations in line with what production received separately on 2026-11-16
-- (supabase/round3-production/hardening/1-token-hardening, 2a, 2b, 2c). Same SQL, minus the production
-- fingerprint guards and data fingerprints, so it also builds a fresh database.
-- Re-runnable: every statement is a REVOKE/GRANT, DROP ... IF EXISTS + CREATE, or CREATE OR REPLACE.
-- On production it is a no-op re-apply; it changes no rows. Needs PostgreSQL 17+ (MAINTAIN privilege),
-- and on Supabase the storage policy relies on supautils letting `postgres` manage storage.objects policies.

-- ── 1 · api_tokens: token_hash is server-only; revocation is one-way ──────────
-- Table-level REVOKE also clears column grants, so the GRANT below is the complete client surface.
revoke all on public.api_tokens from public, anon, authenticated;
grant select (id, org_id, name, prefix, created_by, created_at, last_used_at, revoked_at),
      update (revoked_at)
  on public.api_tokens to authenticated;

drop policy if exists tok_update on public.api_tokens;
create policy tok_update on public.api_tokens for update
  using      (private.has_role(org_id, '{brand_manager}') and revoked_at is null)
  with check (private.has_role(org_id, '{brand_manager}') and revoked_at is not null);

-- TRUNCATE bypasses RLS; none of these are used by the app.
revoke truncate, references, trigger, maintain
  on public.trusted_sources, public.source_checks, public.policy_versions, public.notifications,
     public.webhooks, public.webhook_deliveries, public.api_tokens
  from public, anon, authenticated;

-- ── 2 · Notifications only about items in the audit row's own workspace ──────
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
revoke execute on function private.notify_from_audit() from public, anon, authenticated;

-- ── 3 · A user sees their notifications only while still a member of that workspace ──
drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications for select
  using (user_id = auth.uid() and private.is_member(org_id));

-- ── 4 · content-sources: non-uuid folder names are denied instead of raising a cast error ──
-- CASE guarantees the cast is only reached for a uuid-shaped folder (AND has no evaluation-order guarantee).
drop policy if exists content_sources_read on storage.objects;
create policy content_sources_read on storage.objects for select to authenticated
  using (bucket_id = 'content-sources' and case
           when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then private.is_member(((storage.foldername(name))[1])::uuid) else false end);

-- ── Postconditions: any failure aborts the migration ─────────────────────────
do $$
declare t text; r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_column_privilege(r, 'public.api_tokens', 'token_hash', 'SELECT,INSERT,UPDATE,REFERENCES') then
      raise exception '0007: % can still touch api_tokens.token_hash', r; end if;
    foreach t in array array['trusted_sources','source_checks','policy_versions','notifications','webhooks','webhook_deliveries','api_tokens'] loop
      if has_table_privilege(r, 'public.' || t, 'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
        raise exception '0007: % still has TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on %', r, t; end if;
    end loop;
  end loop;
  if not has_column_privilege('authenticated', 'public.api_tokens', 'revoked_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.api_tokens', 'name', 'UPDATE') then
    raise exception '0007: authenticated must be able to update revoked_at and nothing else'; end if;
  if not has_column_privilege('service_role', 'public.api_tokens', 'token_hash', 'SELECT') then
    raise exception '0007: service_role lost token_hash'; end if;
end $$;
