-- Canon security regression suite.
-- Runs as postgres, impersonates anon / authenticated users / service_role via SET ROLE + JWT claims.
-- Everything happens in one DO block that ALWAYS ends by raising: the report is the error message and
-- every fixture row is rolled back, so the fictional demo data is never changed.
-- Run: paste into the SQL editor (or execute_sql). Expect "SECURITY SUITE: N passed, 0 failed".

create or replace function pg_temp.act(p_role text, p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', p_role, 'sub', p_uid)::text, true);
  perform set_config('role', p_role, true);
  begin
    execute p_sql into r;
  exception when others then
    perform set_config('role', 'postgres', true);
    return 'ERR: ' || sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  return coalesce(r, '<null>');
end $$;

create or replace function pg_temp.expect(p_label text, p_got text, p_pattern text) returns text
language sql as $$
  select case when coalesce(p_got, '<null>') like p_pattern then 'PASS ' || p_label
              else 'FAIL ' || p_label || ' | expected ' || p_pattern || ' | got ' || coalesce(p_got, '<null>') end;
$$;

do $$
declare
  M constant uuid := '00000000-0000-4000-a000-000000000001'; -- Maya, brand_manager, Canon
  R constant uuid := '00000000-0000-4000-a000-000000000002'; -- Ravi, reviewer, Canon
  C constant uuid := '00000000-0000-4000-a000-000000000003'; -- Chloe, creator, Canon
  O constant uuid := '00000000-0000-4000-a000-000000000004'; -- Omar, brand_manager, Rival (outsider)
  canon uuid; rival uuid;
  item1 uuid; item2 uuid; item_m uuid; f1 uuid; f2 uuid; run1 uuid;
  res text[] := '{}'; pass int; fail int; x text;
  fn record;
  item_args constant text := '%L, ''T'', ''LinkedIn'', '''', '''', current_date + 7, %L, ''Body text''';
begin
  select id into canon from organisations where name = 'Canon Demo Co.';
  select id into rival from organisations where name = 'Rival Demo Ltd.';

  -- ── Fixtures (rolled back) ───────────────────────────────────────────────
  item1 := pg_temp.act('authenticated', C, format('select public.create_item(' || item_args || ')', canon, R));
  item_m := pg_temp.act('authenticated', M, format('select public.create_item(' || item_args || ')', canon, R));
  item2 := pg_temp.act('authenticated', O, format('select public.create_item(' || item_args || ')', rival, null));
  res := res || pg_temp.expect('fixture: creator creates item with reviewer', item1::text, '________-____-____-____-____________');
  res := res || pg_temp.expect('fixture: manager creates item', item_m::text, '________-____-____-____-____________');
  res := res || pg_temp.expect('fixture: outsider creates item in own workspace', item2::text, '________-____-____-____-____________');

  -- pipeline writes (service role): a run with one verified blocking finding on item1 and item2,
  -- a clean run on item_m
  run1 := pg_temp.act('service_role', null, format($q$
    with r as (insert into public.analysis_runs (org_id, version_id, status, prompt_version)
      select org_id, id, 'done', 'test' from public.content_versions where item_id = %L returning id)
    select id from r$q$, item1));
  res := res || pg_temp.expect('service role: pipeline inserts analysis run', run1::text, '________-%');
  f1 := pg_temp.act('service_role', null, format($q$
    with f as (insert into public.findings (org_id, run_id, origin, draft_quote, category, severity, verified)
      values (%L, %L, 'code', 'x', 'claim', 'blocking', true) returning id) select id from f$q$, canon, run1));
  res := res || pg_temp.expect('service role: pipeline inserts finding', f1::text, '________-%');
  f2 := pg_temp.act('service_role', null, format($q$
    with r as (insert into public.analysis_runs (org_id, version_id, status, prompt_version)
      select org_id, id, 'done', 'test' from public.content_versions where item_id = %L returning id),
    f as (insert into public.findings (org_id, run_id, origin, draft_quote, category, severity, verified)
      select %L, id, 'code', 'x', 'claim', 'blocking', true from r returning id) select id from f$q$, item2, rival));
  perform pg_temp.act('service_role', null, format($q$
    with r as (insert into public.analysis_runs (org_id, version_id, status, prompt_version)
      select org_id, id, 'done', 'test' from public.content_versions where item_id = %L returning id)
    select count(*) from r$q$, item_m));

  -- ── 1. open_blocking: no cross-workspace information ─────────────────────
  res := res || pg_temp.expect('open_blocking: creator sees own item count', pg_temp.act('authenticated', C, format('select public.open_blocking(%L)', item1)), '1');
  res := res || pg_temp.expect('open_blocking: reviewer sees count', pg_temp.act('authenticated', R, format('select public.open_blocking(%L)', item1)), '1');
  res := res || pg_temp.expect('open_blocking: manager sees count', pg_temp.act('authenticated', M, format('select public.open_blocking(%L)', item1)), '1');
  res := res || pg_temp.expect('open_blocking: outsider gets nothing for Canon item', pg_temp.act('authenticated', O, format('select public.open_blocking(%L)', item1)), '<null>');
  res := res || pg_temp.expect('open_blocking: Canon creator gets nothing for Rival item', pg_temp.act('authenticated', C, format('select public.open_blocking(%L)', item2)), '<null>');
  res := res || pg_temp.expect('open_blocking: unknown item looks identical (null)', pg_temp.act('authenticated', O, format('select public.open_blocking(%L)', gen_random_uuid())), '<null>');
  res := res || pg_temp.expect('open_blocking: anon denied', pg_temp.act('anon', null, format('select public.open_blocking(%L)', item1)), 'ERR: permission denied%');
  res := res || pg_temp.expect('open_blocking: service role (no user) gets nothing', pg_temp.act('service_role', null, format('select public.open_blocking(%L)', item1)), '<null>');
  res := res || pg_temp.expect('open_blocking: internal count not callable by users', pg_temp.act('authenticated', C, format('select private.open_blocking_count(%L)', item1)), 'ERR: permission denied%');

  -- ── 2. Cross-workspace reads ─────────────────────────────────────────────
  foreach x in array array['content_items', 'content_versions', 'analysis_runs', 'findings', 'audit_log', 'rules', 'facts', 'memberships', 'organisations'] loop
    res := res || pg_temp.expect('outsider reads 0 Canon rows: ' || x,
      pg_temp.act('authenticated', O, format('select count(*) from public.%I where %s = %L', x, case when x = 'organisations' then 'id' else 'org_id' end, canon)), '0');
    res := res || pg_temp.expect('anon cannot read: ' || x, pg_temp.act('anon', null, format('select count(*) from public.%I', x)), 'ERR: permission denied%');
  end loop;
  res := res || pg_temp.expect('Canon creator reads 0 Rival items', pg_temp.act('authenticated', C, format('select count(*) from public.content_items where org_id = %L', rival)), '0');
  res := res || pg_temp.expect('Canon member reads own items', pg_temp.act('authenticated', R, format('select count(*) from public.content_items where org_id = %L', canon)), '2');

  -- ── 3. Cross-workspace writes ────────────────────────────────────────────
  res := res || pg_temp.expect('outsider cannot create item in Canon', pg_temp.act('authenticated', O, format('select public.create_item(' || item_args || ')', canon, R)), 'ERR: forbidden');
  res := res || pg_temp.expect('outsider cannot add member to Canon', pg_temp.act('authenticated', O, format('select public.add_member(%L, ''x@example.com'', ''creator'')', canon)), 'ERR: forbidden');
  res := res || pg_temp.expect('outsider cannot revise Canon item', pg_temp.act('authenticated', O, format('select public.revise_item(%L, ''hijack'')', item1)), 'ERR: only the author%');
  res := res || pg_temp.expect('outsider cannot submit Canon item', pg_temp.act('authenticated', O, format('select public.submit_for_review(%L)', item1)), 'ERR: only the author%');
  res := res || pg_temp.expect('outsider cannot override Canon finding', pg_temp.act('authenticated', O, format('select public.decide_finding(%L, ''overridden'', ''not mine'')', f1)), 'ERR: forbidden');
  res := res || pg_temp.expect('outsider cannot comment on Canon item', pg_temp.act('authenticated', O, format('insert into public.comments (org_id, item_id, body) values (%L, %L, ''hi'') returning 1', canon, item1)), 'ERR: new row violates row-level security%');
  res := res || pg_temp.expect('outsider cannot add Canon rule', pg_temp.act('authenticated', O, format('insert into public.rules (org_id, code, text, category, severity, check_kind) values (%L, ''X-1'', ''rule text'', ''tone'', ''advisory'', ''ai'') returning 1', canon)), 'ERR: new row violates row-level security%');
  res := res || pg_temp.expect('outsider updates 0 Canon rules', pg_temp.act('authenticated', O, format('with u as (update public.rules set text = text where org_id = %L returning 1) select count(*) from u', canon)), '0');
  res := res || pg_temp.expect('outsider updates 0 Canon facts', pg_temp.act('authenticated', O, format('with u as (update public.facts set text = text where org_id = %L returning 1) select count(*) from u', canon)), '0');
  res := res || pg_temp.expect('user cannot write content_items directly', pg_temp.act('authenticated', C, format('update public.content_items set status = ''approved'' where id = %L returning 1', item1)), 'ERR: permission denied%');
  res := res || pg_temp.expect('user cannot write memberships directly', pg_temp.act('authenticated', O, format('insert into public.memberships values (%L, %L, ''brand_manager'') returning 1', canon, O)), 'ERR: permission denied%');

  -- ── 4. Reviewer assignment ───────────────────────────────────────────────
  res := res || pg_temp.expect('reviewer from another workspace rejected', pg_temp.act('authenticated', C, format('select public.create_item(' || item_args || ')', canon, O)), 'ERR: reviewer must be%');
  res := res || pg_temp.expect('self as reviewer rejected', pg_temp.act('authenticated', C, format('select public.create_item(' || item_args || ')', canon, C)), 'ERR: you cannot review your own item');
  res := res || pg_temp.expect('unknown user as reviewer rejected', pg_temp.act('authenticated', C, format('select public.create_item(' || item_args || ')', canon, gen_random_uuid())), 'ERR: reviewer must be%');
  res := res || pg_temp.expect('reviewer role accepted', pg_temp.act('authenticated', C, format('select public.create_item(' || item_args || ') is not null', canon, R)), 'true');
  res := res || pg_temp.expect('brand manager as reviewer accepted', pg_temp.act('authenticated', C, format('select public.create_item(' || item_args || ') is not null', canon, M)), 'true');
  res := res || pg_temp.expect('no reviewer yet accepted', pg_temp.act('authenticated', C, format('select public.create_item(' || item_args || ') is not null', canon, null)), 'true');
  res := res || pg_temp.expect('service role: invalid reviewer on insert rejected', pg_temp.act('service_role', null, format('insert into public.content_items (org_id, author_id, title, publish_date, reviewer_id) values (%L, %L, ''T'', current_date, %L) returning 1', canon, C, O)), 'ERR: reviewer must be%');
  res := res || pg_temp.expect('service role: invalid reviewer on update rejected', pg_temp.act('service_role', null, format('update public.content_items set reviewer_id = %L where id = %L returning 1', O, item1)), 'ERR: reviewer must be%');
  res := res || pg_temp.expect('service role: author as reviewer on update rejected', pg_temp.act('service_role', null, format('update public.content_items set reviewer_id = %L where id = %L returning 1', C, item1)), 'ERR: you cannot review your own item');

  -- ── 5. Anonymous function execution ──────────────────────────────────────
  for fn in select p.oid, p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private') loop
    res := res || pg_temp.expect('anon has no execute: ' || fn.sig, has_function_privilege('anon', fn.oid, 'execute')::text, 'false');
    res := res || pg_temp.expect('no PUBLIC execute grant: ' || fn.sig,
      (select coalesce(bool_or(a.grantee = 0), false) from pg_proc p, aclexplode(p.proacl) a where p.oid = fn.oid)::text, 'false');
  end loop;
  res := res || pg_temp.expect('anon cannot call create_workspace', pg_temp.act('anon', null, 'select public.create_workspace(''x'', ''x'')'), 'ERR: permission denied%');
  res := res || pg_temp.expect('anon cannot call decide_item', pg_temp.act('anon', null, format('select public.decide_item(%L, ''approved'', '''')', item1)), 'ERR: permission denied%');
  res := res || pg_temp.expect('anon cannot call is_member', pg_temp.act('anon', null, format('select private.is_member(%L)', canon)), 'ERR: permission denied%');

  -- ── 6. Legitimate authenticated workflow (migration 0002 kept these working) ──
  res := res || pg_temp.expect('authenticated: create_workspace works', pg_temp.act('authenticated', R, 'select public.create_workspace(''Scratch'', ''Ravi'') is not null'), 'true');
  res := res || pg_temp.expect('authenticated: creator submits item', pg_temp.act('authenticated', C, format('select public.submit_for_review(%L)', item1)), '');  -- void RPC returns ''
  res := res || pg_temp.expect('authenticated: manager submits item', pg_temp.act('authenticated', M, format('select public.submit_for_review(%L)', item_m)), '');  -- void RPC returns ''

  -- ── 7. Self-approval ─────────────────────────────────────────────────────
  res := res || pg_temp.expect('author cannot approve own item', pg_temp.act('authenticated', M, format('select public.decide_item(%L, ''approved'', '''')', item_m)), 'ERR: nobody can approve their own submission');
  res := res || pg_temp.expect('service role cannot insert self-approval', pg_temp.act('service_role', null, format('insert into public.approvals (org_id, item_id, version, approver_id, decision) values (%L, %L, 1, %L, ''approved'') returning 1', canon, item_m, M)), 'ERR: nobody can approve their own submission');
  res := res || pg_temp.expect('service role cannot insert approval without approver', pg_temp.act('service_role', null, format('insert into public.approvals (org_id, item_id, version, approver_id, decision) values (%L, %L, 1, null, ''approved'') returning 1', canon, item_m)), 'ERR: %');
  res := res || pg_temp.expect('creator role cannot approve', pg_temp.act('authenticated', C, format('select public.decide_item(%L, ''approved'', '''')', item_m)), 'ERR: approver must be a Reviewer%');
  res := res || pg_temp.expect('outsider cannot approve', pg_temp.act('service_role', null, format('insert into public.approvals (org_id, item_id, version, approver_id, decision) values (%L, %L, 1, %L, ''approved'') returning 1', canon, item_m, O)), 'ERR: approver must be a Reviewer%');
  res := res || pg_temp.expect('reviewer approves clean item', pg_temp.act('authenticated', R, format('select public.decide_item(%L, ''approved'', '''')', item_m)), '');  -- void RPC returns ''

  -- ── 8. Approval with unresolved blocking findings ────────────────────────
  res := res || pg_temp.expect('reviewer cannot approve with blocking finding', pg_temp.act('authenticated', R, format('select public.decide_item(%L, ''approved'', '''')', item1)), 'ERR: blocking issues remain%');
  res := res || pg_temp.expect('service role cannot approve with blocking finding', pg_temp.act('service_role', null, format('insert into public.approvals (org_id, item_id, version, approver_id, decision) values (%L, %L, 1, %L, ''approved'') returning 1', canon, item1, R)), 'ERR: blocking issues remain%');
  res := res || pg_temp.expect('author cannot override own blocking finding', pg_temp.act('authenticated', C, format('select public.decide_finding(%L, ''overridden'', ''looks fine to me'')', f1)), 'ERR: only a reviewer other than the author%');
  res := res || pg_temp.expect('override needs a reason', pg_temp.act('authenticated', R, format('select public.decide_finding(%L, ''overridden'', '''')', f1)), 'ERR: %check%');
  res := res || pg_temp.expect('reviewer overrides with reason', pg_temp.act('authenticated', R, format('select public.decide_finding(%L, ''overridden'', ''claim verified with legal'')', f1)), '');  -- void RPC returns ''
  res := res || pg_temp.expect('open_blocking drops to 0 after override', pg_temp.act('authenticated', C, format('select public.open_blocking(%L)', item1)), '0');
  res := res || pg_temp.expect('reviewer approves after override', pg_temp.act('authenticated', R, format('select public.decide_item(%L, ''approved'', '''')', item1)), '');  -- void RPC returns ''
  res := res || pg_temp.expect('item1 status approved', (select status::text from content_items where id = item1), 'approved');

  -- ── 9. Audit-log / append-only immutability ──────────────────────────────
  res := res || pg_temp.expect('audit rows were written', (select (count(*) > 0)::text from audit_log where item_id = item1), 'true');
  foreach x in array array['audit_log', 'approvals', 'finding_decisions'] loop
    res := res || pg_temp.expect('service role cannot update ' || x, pg_temp.act('service_role', null, format('with u as (update public.%I set org_id = org_id returning 1) select count(*) from u', x)), 'ERR: % is append-only');
    res := res || pg_temp.expect('service role cannot delete ' || x, pg_temp.act('service_role', null, format('with d as (delete from public.%I returning 1) select count(*) from d', x)), 'ERR: % is append-only');
    res := res || pg_temp.expect('member cannot update ' || x, pg_temp.act('authenticated', M, format('with u as (update public.%I set org_id = org_id returning 1) select count(*) from u', x)), 'ERR: permission denied%');
    res := res || pg_temp.expect('member cannot delete ' || x, pg_temp.act('authenticated', M, format('with d as (delete from public.%I returning 1) select count(*) from d', x)), 'ERR: permission denied%');
  end loop;
  res := res || pg_temp.expect('even postgres cannot update audit_log', pg_temp.act('postgres', null, 'with u as (update public.audit_log set action = action returning 1) select count(*) from u'), 'ERR: audit_log is append-only');
  res := res || pg_temp.expect('member cannot insert audit_log directly', pg_temp.act('authenticated', M, format('insert into public.audit_log (org_id, action) values (%L, ''forged'') returning 1', canon)), 'ERR: permission denied%');
  res := res || pg_temp.expect('no_change has pinned search_path',
    (select (proconfig = array['search_path=""'])::text from pg_proc where oid = 'private.no_change()'::regprocedure), 'true');

  -- ── 10. Same-workspace creator is not an eligible reviewer (needs a 2nd creator; last, it changes membership) ──
  perform pg_temp.act('authenticated', M, format('select public.add_member(%L, %L, ''creator'')', canon, (select email from auth.users where id = O)));
  res := res || pg_temp.expect('manager add_member works (outsider joins as creator)', (select role::text from memberships where org_id = canon and user_id = O), 'creator');
  res := res || pg_temp.expect('creator-role colleague as reviewer rejected', pg_temp.act('authenticated', C, format('select public.create_item(' || item_args || ')', canon, O)), 'ERR: reviewer must be%');

  select count(*) filter (where l like 'PASS%'), count(*) filter (where l like 'FAIL%') into pass, fail from unnest(res) l;
  raise exception E'SECURITY SUITE: % passed, % failed (all changes rolled back)\n%', pass, fail,
    (select string_agg(l, E'\n') from unnest(res) l);
end $$;
