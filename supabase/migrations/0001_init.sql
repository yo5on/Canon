-- Canon Round 2 schema. Permissions live in the database (Round 1 spec p.25):
-- RLS on every table, status changes only through functions, approval trigger, append-only audit log.

create extension if not exists pgcrypto;
create schema if not exists private;

create type role_t as enum ('creator', 'reviewer', 'brand_manager');
create type item_status as enum ('draft', 'in_review', 'changes_requested', 'approved', 'rejected');
create type decision_t as enum ('approved', 'rejected', 'changes_requested');

-- ── Tenancy ──────────────────────────────────────────────────────────────
create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table memberships (
  org_id uuid not null references organisations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role role_t not null,
  display_name text not null default '',
  primary key (org_id, user_id)
);

create or replace function private.has_role(org uuid, roles role_t[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
    where m.org_id = org and m.user_id = auth.uid() and m.role = any(roles));
$$;
create or replace function private.is_member(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.org_id = org and m.user_id = auth.uid());
$$;
grant usage on schema private to authenticated;

-- ── Module A · Brand knowledge (versioned; a new version is a new row) ──────
create table rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations on delete cascade,
  code text not null check (code ~ '^[A-Z]+-[0-9]+$'),
  version int not null default 1,
  is_current boolean not null default true,
  text text not null check (length(text) between 3 and 2000),
  category text not null check (category in ('tone', 'terminology', 'claim', 'messaging', 'accessibility')),
  severity text not null check (severity in ('blocking', 'advisory')),
  check_kind text not null check (check_kind in ('ai', 'code')),
  banned_term text,       -- code terminology checks
  replacement text,
  source_ref text,        -- e.g. "voice-guide-v4.pdf p.6 §2.1"
  created_by uuid references auth.users,
  created_at timestamptz not null default now(),
  unique (org_id, code, version),
  check (check_kind <> 'code' or banned_term is not null)
);
create unique index rules_one_current on rules (org_id, code) where is_current;

create table facts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations on delete cascade,
  code text not null check (code ~ '^FACT-[0-9]+$'),
  version int not null default 1,
  is_current boolean not null default true,
  text text not null check (length(text) between 2 and 1000),
  value numeric,
  tolerance numeric not null default 0 check (tolerance >= 0),
  valid_from date,
  valid_until date,
  replaced_by text,
  owner text not null default '',
  source_ref text,
  confidential boolean not null default false, -- never sent to the external AI
  created_by uuid references auth.users,
  created_at timestamptz not null default now(),
  unique (org_id, code, version),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);
create unique index facts_one_current on facts (org_id, code) where is_current;

-- ── Module B · Content ────────────────────────────────────────────────────
create table content_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations on delete cascade,
  author_id uuid not null references auth.users default auth.uid(),
  title text not null check (length(title) between 1 and 200),
  channel text not null default 'LinkedIn',
  audience text not null default '',
  goal text not null default '' check (length(goal) <= 300),
  publish_date date not null,
  reviewer_id uuid references auth.users,
  status item_status not null default 'draft',
  current_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table content_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations on delete cascade,
  item_id uuid not null references content_items on delete cascade,
  version int not null,
  body text not null check (length(body) between 1 and 40000), -- ~6,000 words
  created_by uuid not null references auth.users default auth.uid(),
  created_at timestamptz not null default now(),
  unique (item_id, version)
);

-- ── Modules C/D/E · Analysis (written only by the server pipeline) ─────────
create table analysis_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations on delete cascade,
  version_id uuid not null references content_versions on delete cascade,
  status text not null check (status in ('running', 'done', 'ai_failed', 'ai_skipped')),
  model text,
  prompt_version text not null,
  ai_note text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  duration_ms int,
  created_at timestamptz not null default now()
);

create table findings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations on delete cascade,
  run_id uuid not null references analysis_runs on delete cascade,
  origin text not null check (origin in ('code', 'ai')),
  source_code text,
  source_version int,
  source_text text,         -- copied from OUR database, never from the model
  source_quote text,
  draft_quote text not null,
  draft_start int,
  draft_end int,
  category text not null,
  severity text not null check (severity in ('blocking', 'advisory')),
  verified boolean not null,
  failed_checks text[] not null default '{}',
  explanation text not null default '',
  fix_replace text,
  fix_with text,
  confidence real,
  check (verified or severity = 'advisory') -- unverified findings never block
);

create table claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations on delete cascade,
  run_id uuid not null references analysis_runs on delete cascade,
  text text not null,
  type text not null,
  status text check (status in ('HUMAN_JUDGEMENT', 'CONTRADICTED', 'SUPPORTED', 'OUTDATED', 'UNSUPPORTED')),
  fact_code text,
  reason text not null default '',
  finding_id uuid references findings on delete set null
);

-- ── Module F · Review ─────────────────────────────────────────────────────
create table finding_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations on delete cascade,
  finding_id uuid not null references findings on delete cascade,
  decided_by uuid not null references auth.users,
  decision text not null check (decision in ('accepted', 'rejected', 'overridden')),
  reason text not null default '',
  created_at timestamptz not null default now(),
  check (decision = 'accepted' or length(trim(reason)) >= 3)
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations on delete cascade,
  item_id uuid not null references content_items on delete cascade,
  author_id uuid not null references auth.users default auth.uid(),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations on delete cascade,
  item_id uuid not null references content_items on delete cascade,
  version int not null,
  approver_id uuid not null references auth.users,
  decision decision_t not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references organisations on delete cascade,
  item_id uuid references content_items on delete cascade,
  actor_id uuid,
  action text not null,
  detail jsonb not null default '{}',
  at timestamptz not null default now()
);

create index on content_items (org_id, status);
create index on content_versions (item_id);
create index on analysis_runs (version_id, created_at desc);
create index on findings (run_id);
create index on claims (run_id);
create index on finding_decisions (finding_id);
create index on audit_log (item_id, at);

-- ── Helpers ────────────────────────────────────────────────────────────────
create or replace function private.log(org uuid, item uuid, act text, det jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (org_id, item_id, actor_id, action, detail) values (org, item, auth.uid(), act, det);
$$;

-- Unresolved blocking findings on the latest run of the item's current version.
create or replace function public.open_blocking(p_item uuid)
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

-- ── State-change functions (the only way status moves) ───────────────────────
create or replace function public.create_workspace(p_name text, p_display text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.organisations (name) values (p_name) returning id into o;
  insert into public.memberships values (o, auth.uid(), 'brand_manager', coalesce(p_display, ''));
  perform private.log(o, null, 'workspace_created', jsonb_build_object('name', p_name));
  return o;
end $$;

-- Brand managers add an existing user (by email) to their workspace.
create or replace function public.add_member(p_org uuid, p_email text, p_role role_t)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid; n text;
begin
  if not private.has_role(p_org, array['brand_manager']::public.role_t[]) then raise exception 'forbidden'; end if;
  select id, coalesce(raw_user_meta_data->>'display_name', email) into u, n from auth.users where lower(email) = lower(p_email);
  if u is null then raise exception 'no user with that email'; end if;
  insert into public.memberships values (p_org, u, p_role, n)
    on conflict (org_id, user_id) do update set role = excluded.role;
  perform private.log(p_org, null, 'member_added', jsonb_build_object('email', p_email, 'role', p_role));
end $$;

create or replace function public.create_item(p_org uuid, p_title text, p_channel text, p_audience text,
  p_goal text, p_publish date, p_reviewer uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i uuid;
begin
  if not private.is_member(p_org) then raise exception 'forbidden'; end if;
  if p_reviewer = auth.uid() then raise exception 'you cannot review your own item'; end if;
  insert into public.content_items (org_id, author_id, title, channel, audience, goal, publish_date, reviewer_id)
    values (p_org, auth.uid(), p_title, p_channel, p_audience, p_goal, p_publish, p_reviewer) returning id into i;
  insert into public.content_versions (org_id, item_id, version, body, created_by) values (p_org, i, 1, p_body, auth.uid());
  perform private.log(p_org, i, 'created', jsonb_build_object('version', 1));
  return i;
end $$;

-- Creator revises: new version, status back to draft.
create or replace function public.revise_item(p_item uuid, p_body text, p_note text default '')
returns int language plpgsql security definer set search_path = '' as $$
declare it public.content_items; nv int;
begin
  select * into it from public.content_items where id = p_item for update;
  if it.author_id is distinct from auth.uid() then raise exception 'only the author can revise'; end if;
  if it.status not in ('draft', 'changes_requested') then raise exception 'item is %', it.status; end if;
  nv := it.current_version + 1;
  insert into public.content_versions (org_id, item_id, version, body, created_by) values (it.org_id, p_item, nv, p_body, auth.uid());
  update public.content_items set current_version = nv, status = 'draft', updated_at = now() where id = p_item;
  perform private.log(it.org_id, p_item, 'revised', jsonb_build_object('version', nv, 'note', p_note));
  return nv;
end $$;

create or replace function public.submit_for_review(p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare it public.content_items;
begin
  select * into it from public.content_items where id = p_item for update;
  if it.author_id is distinct from auth.uid() then raise exception 'only the author can submit'; end if;
  if it.status not in ('draft', 'changes_requested') then raise exception 'item is %', it.status; end if;
  if it.reviewer_id is null then raise exception 'choose a reviewer first'; end if;
  if not exists (select 1 from public.analysis_runs ar join public.content_versions cv on cv.id = ar.version_id
                 where cv.item_id = p_item and cv.version = it.current_version and ar.status <> 'running')
    then raise exception 'run checks on the current version before submitting'; end if;
  update public.content_items set status = 'in_review', updated_at = now() where id = p_item;
  perform private.log(it.org_id, p_item, 'submitted', jsonb_build_object('version', it.current_version));
end $$;

-- Creator accepts/rejects a fix; reviewer overrides a blocking issue. Reasons required except accept.
create or replace function public.decide_finding(p_finding uuid, p_decision text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.findings; it public.content_items;
begin
  select * into f from public.findings where id = p_finding;
  select ci.* into it from public.content_items ci join public.content_versions cv on cv.item_id = ci.id
    join public.analysis_runs ar on ar.version_id = cv.id where ar.id = f.run_id;
  if not private.is_member(f.org_id) then raise exception 'forbidden'; end if;
  if p_decision = 'overridden' then
    if not private.has_role(f.org_id, array['reviewer', 'brand_manager']::public.role_t[]) or it.author_id = auth.uid()
      then raise exception 'only a reviewer other than the author can override'; end if;
  elsif p_decision in ('accepted', 'rejected') then
    if it.author_id is distinct from auth.uid() then raise exception 'only the author decides on fixes'; end if;
  else raise exception 'bad decision';
  end if;
  insert into public.finding_decisions (org_id, finding_id, decided_by, decision, reason)
    values (f.org_id, p_finding, auth.uid(), p_decision, coalesce(p_reason, ''));
  perform private.log(f.org_id, it.id, 'finding_' || p_decision,
    jsonb_build_object('finding', p_finding, 'source', f.source_code, 'reason', p_reason));
end $$;

create or replace function public.decide_item(p_item uuid, p_decision decision_t, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare it public.content_items;
begin
  select * into it from public.content_items where id = p_item for update;
  if it.status <> 'in_review' then raise exception 'item is not in review'; end if;
  if p_decision <> 'approved' and length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required'; end if;
  -- the approvals trigger enforces who may decide
  insert into public.approvals (org_id, item_id, version, approver_id, decision, reason)
    values (it.org_id, p_item, it.current_version, auth.uid(), p_decision, coalesce(p_reason, ''));
  update public.content_items set status = p_decision::text::public.item_status, updated_at = now() where id = p_item;
  perform private.log(it.org_id, p_item, p_decision::text, jsonb_build_object('version', it.current_version, 'reason', p_reason));
end $$;

-- ── The approval trigger: runs even for the service role ─────────────────────
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
  if new.decision = 'approved' and public.open_blocking(new.item_id) > 0
    then raise exception 'blocking issues remain: fix them or override with a reason'; end if;
  return new;
end $$;
create trigger approvals_guard before insert on approvals for each row execute function private.check_approval();

create or replace function private.no_change() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;
create trigger audit_append_only before update or delete on audit_log for each row execute function private.no_change();
create trigger approvals_append_only before update or delete on approvals for each row execute function private.no_change();
create trigger decisions_append_only before update or delete on finding_decisions for each row execute function private.no_change();

-- ── Row-level security ────────────────────────────────────────────────────
alter table organisations enable row level security;
alter table memberships enable row level security;
alter table rules enable row level security;
alter table facts enable row level security;
alter table content_items enable row level security;
alter table content_versions enable row level security;
alter table analysis_runs enable row level security;
alter table findings enable row level security;
alter table claims enable row level security;
alter table finding_decisions enable row level security;
alter table comments enable row level security;
alter table approvals enable row level security;
alter table audit_log enable row level security;

create policy org_read on organisations for select using (private.is_member(id));
create policy mem_read on memberships for select using (private.is_member(org_id));

create policy rules_read on rules for select using (private.is_member(org_id));
create policy rules_write on rules for insert with check (private.has_role(org_id, '{brand_manager}'));
create policy rules_update on rules for update using (private.has_role(org_id, '{brand_manager}'));
create policy facts_read on facts for select using (private.is_member(org_id));
create policy facts_write on facts for insert with check (private.has_role(org_id, '{brand_manager}'));
create policy facts_update on facts for update using (private.has_role(org_id, '{brand_manager}'));

create policy items_read on content_items for select using (private.is_member(org_id));
create policy versions_read on content_versions for select using (private.is_member(org_id));
create policy runs_read on analysis_runs for select using (private.is_member(org_id));
create policy findings_read on findings for select using (private.is_member(org_id));
create policy claims_read on claims for select using (private.is_member(org_id));
create policy fd_read on finding_decisions for select using (private.is_member(org_id));
create policy approvals_read on approvals for select using (private.is_member(org_id));
create policy audit_read on audit_log for select using (private.is_member(org_id));
create policy comments_read on comments for select using (private.is_member(org_id));
-- Creators comment on their own items only; reviewers/managers on any item in the workspace.
create policy comments_write on comments for insert with check (
  author_id = auth.uid() and (
    private.has_role(org_id, '{reviewer,brand_manager}')
    or exists (select 1 from content_items ci where ci.id = item_id and ci.author_id = auth.uid())));

-- Content, runs, findings, decisions and approvals have no direct write policies:
-- writes go through the functions above (or the server pipeline with the service key).
revoke insert, update, delete on content_items, content_versions, analysis_runs, findings, claims,
  finding_decisions, approvals, audit_log, organisations, memberships from anon, authenticated;
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema private from anon, public;
grant execute on function private.has_role, private.is_member to authenticated;
