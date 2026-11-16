// Disposable in-memory test of supabase/migrations/0007_round3_hardening.sql. No network, no Supabase project.
// Checks: 0001-0007 equals the production path (Section 2 of apply-round3-production.sql + round3-production/hardening/*),
// 0007 is re-runnable and a no-op on an already-hardened database, and the hardened behaviour (tokens, notifications, storage).
// PGlite is not an app dependency. Run from a scratch folder that has it installed:
//   npm i @electric-sql/pglite pglite17@npm:@electric-sql/pglite@^0.3.16
//   node <repo>/supabase/tests/pglite/0007-hardening.mjs pglite17     (PostgreSQL 17)
//   node <repo>/supabase/tests/pglite/0007-hardening.mjs              (PostgreSQL 18)
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG = process.argv[2] ?? '@electric-sql/pglite';
const req = createRequire(process.cwd() + '/'); // resolve PGlite from the scratch folder, not the repo
const { PGlite } = await import(pathToFileURL(req.resolve(PKG)).href);
const { pgcrypto } = await import(pathToFileURL(req.resolve(PKG + '/contrib/pgcrypto')).href);
const SB = fileURLToPath(new URL('../../', import.meta.url)).replaceAll('\\', '/');
const H = SB + 'round3-production/hardening/';
const read = (f) => fs.readFileSync(f, 'utf8');
const PATH = `"$user", public, extensions`;
const PROD_NOTIFY_MD5 = 'bf9ac2ff8061fa07a2db62f6da82d6ac'; // md5(prosrc) read-only from production 2026-11-16

const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002';
const U = { bmA: '00000000-0000-4000-8000-0000000000a1', creA: '00000000-0000-4000-8000-0000000000a2',
  revA: '00000000-0000-4000-8000-0000000000a3', leaver: '00000000-0000-4000-8000-0000000000a5',
  bmB: '00000000-0000-4000-8000-0000000000b1', revB: '00000000-0000-4000-8000-0000000000b2' };
const ITEM_A = 'cccccccc-0000-4000-8000-00000000000a', ITEM_B = 'cccccccc-0000-4000-8000-00000000000b';
const T = { A1: 'dddddddd-0000-4000-8000-0000000000a1', A2: 'dddddddd-0000-4000-8000-0000000000a2' };

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const seed = `
  insert into auth.users (id, email) values ('${U.bmA}','a'),('${U.creA}','b'),('${U.revA}','c'),('${U.leaver}','d'),('${U.bmB}','e'),('${U.revB}','f');
  insert into organisations (id, name) values ('${A}','Org A'),('${B}','Org B');
  insert into memberships (org_id, user_id, role) values ('${A}','${U.bmA}','brand_manager'),('${A}','${U.creA}','creator'),
    ('${A}','${U.revA}','reviewer'),('${A}','${U.leaver}','creator'),('${B}','${U.bmB}','brand_manager'),('${B}','${U.revB}','reviewer');
  insert into content_items (id, org_id, author_id, title, publish_date, reviewer_id) values
    ('${ITEM_A}','${A}','${U.creA}','A item','2026-12-01','${U.revA}'),('${ITEM_B}','${B}','${U.bmB}','B item','2026-12-01','${U.revB}');`;
const tokens = `insert into public.api_tokens (id, org_id, name, token_hash, prefix, created_by, revoked_at) values
  ('${T.A1}','${A}','A live','hashA1','canon_A1','${U.bmA}',null),('${T.A2}','${A}','A revoked','hashA2','canon_A2','${U.bmA}',now());`;

async function base() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(read(SB + 'tests/pglite/bootstrap.sql'));
  await db.exec(`set search_path = ${PATH}`);
  for (const m of ['0001_init', '0002_revoke_public_execute', '0003_security_hardening', '0004_confidential_facts'])
    await db.exec(read(`${SB}migrations/${m}.sql`));
  await db.exec(seed);
  return db;
}
// Fresh build from the numbered migrations only.
async function fromMigrations(upTo7 = true) {
  const db = await base();
  for (const m of ['0005_round3', '0006_server_only_file_items', ...(upTo7 ? ['0007_round3_hardening'] : [])])
    await db.exec(read(`${SB}migrations/${m}.sql`));
  await db.exec(tokens);
  return db;
}
// Production path: apply-round3-production.sql Section 2, then the 4 hardening scripts with the fingerprint guard shimmed.
async function productionPath() {
  const db = await base();
  const s = read(SB + 'apply-round3-production.sql');
  await db.exec(s.slice(s.indexOf('-- ── SECTION 2'), s.indexOf('-- ── SECTION 3')));
  await db.exec(tokens);
  await db.exec(`create schema testshim;
    create function testshim.pg_control_system() returns table(system_identifier bigint) language sql as $$ select 7703759698107299042::bigint $$;
    create function testshim.current_database() returns name language sql as $$ select 'postgres'::name $$;`);
  for (const f of ['1-token-hardening', '2a-notify-workspace', '2b-notifications-membership', '2c-storage-folder']) {
    await db.exec(`set search_path = testshim, ${PATH}, pg_catalog`);
    await db.exec(read(H + f + '.sql'));
  }
  await db.exec(`set search_path = ${PATH}; drop schema testshim cascade`);
  return db;
}

// Structural fingerprint of everything 0007 can touch, plus data hashes.
async function snap(db, withData = true) {
  const r = await db.query(`
    select string_agg(x, E'\\n' order by x) s from (
      select format('tbl %s %s %s', c.oid::regclass, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type) x
        from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a where n.nspname in ('public','storage')
      union all
      select format('col %s.%s %s %s', at.attrelid::regclass, at.attname, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type)
        from pg_attribute at join pg_class c on c.oid = at.attrelid join pg_namespace n on n.oid = c.relnamespace, aclexplode(at.attacl) a
        where n.nspname in ('public','storage')
      union all
      select format('pol %s.%s %s %s %s using=%s check=%s', schemaname, tablename, policyname, cmd, roles,
        regexp_replace(qual, '\\s+', ' ', 'g'), regexp_replace(with_check, '\\s+', ' ', 'g')) from pg_policies
      union all
      select format('fn %s %s %s %s %s', p.oid::regprocedure, md5(p.prosrc), p.proacl, p.prosecdef, p.proconfig)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')
      union all
      select format('trg %s %s %s %s', tgrelid::regclass, tgname, tgfoid::regprocedure, tgenabled) from pg_trigger where not tgisinternal
      union all
      select format('rls %s %s', oid::regclass, relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
      ${withData ? `union all select 'data api_tokens ' || md5(coalesce(string_agg(t::text, '|' order by id), '')) from public.api_tokens t
      union all select 'data notifications ' || md5(coalesce(string_agg(t::text, '|' order by id), '')) from public.notifications t
      union all select 'data audit_log ' || md5(coalesce(string_agg(t::text, '|' order by id), '')) from public.audit_log t` : ''}
    ) z`);
  return r.rows[0].s;
}
const diff = (a, b) => { const X = new Set(a.split('\n')), Y = new Set(b.split('\n'));
  return [...[...X].filter((x) => !Y.has(x)).map((x) => '- ' + x), ...[...Y].filter((x) => !X.has(x)).map((x) => '+ ' + x)]; };

// One client request, always rolled back.
async function as(db, role, uid, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role, sub: uid })]);
    await db.exec(`set local role ${role}`);
    try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.fields?.length ? r.rows.length : r.affectedRows }; } // SELECT/RETURNING → rows; plain DML → affected
    catch (e) { return { ok: false, code: e.code, err: e.message }; }
  } finally { await db.exec('rollback'); }
}
const denied = (r) => !r.ok && r.code === '42501';

console.log(`\n### ${(await (await PGlite.create()).query('select version() v')).rows[0].v}\n`);

// 1. Equivalence: migrations 0001–0007 vs. what production received (Section 2 + 4 hardening scripts).
const prod = await productionPath();
const mig = await fromMigrations();
const d = diff(await snap(prod, false), await snap(mig, false));
check('0001–0007 structure == production path (Section 2 + hardening 1, 2a, 2b, 2c)', d.length === 0, d.slice(0, 12).join(' | '));
const md5 = (await mig.query(`select md5(prosrc) m from pg_proc where oid = 'private.notify_from_audit()'::regprocedure`)).rows[0].m;
check('notify_from_audit body is byte-identical to production (md5 of prosrc)', md5 === PROD_NOTIFY_MD5, md5);

// 2. Idempotency on a fresh build and a no-op on a production-like database.
{
  const before = await snap(mig);
  await mig.exec(read(`${SB}migrations/0007_round3_hardening.sql`));
  const d2 = diff(before, await snap(mig));
  check('0007 re-run on its own result: structure and data unchanged', d2.length === 0, d2.join(' | '));
  const p0 = await snap(prod);
  await prod.exec(read(`${SB}migrations/0007_round3_hardening.sql`));
  const d3 = diff(p0, await snap(prod));
  check('0007 on a production-like (already hardened) database: no change', d3.length === 0, d3.join(' | '));
}

// 3. Before 0007 the holes exist (negative control), after 0007 they are closed.
{
  const pre = await fromMigrations(false);
  check('control: without 0007 a Brand Manager can read token_hash', (await as(pre, 'authenticated', U.bmA, 'select token_hash from public.api_tokens')).ok);
  check('control: without 0007 a Brand Manager can un-revoke a token',
    (await as(pre, 'authenticated', U.bmA, `update public.api_tokens set revoked_at = null where id = '${T.A2}'`)).n === 1);
}
const db = mig;
check('BM: select token_hash denied', denied(await as(db, 'authenticated', U.bmA, 'select token_hash from public.api_tokens')));
check('BM: select * denied (includes token_hash)', denied(await as(db, 'authenticated', U.bmA, 'select * from public.api_tokens')));
{ const r = await as(db, 'authenticated', U.bmA, 'select id, name, prefix, created_at, last_used_at, revoked_at from public.api_tokens where org_id = $1', [A]);
  check('BM: integrations page columns readable (2 own tokens)', r.ok && r.rows.length === 2, JSON.stringify(r.rows?.length ?? r.err)); }
check('BM: revoke live token (update revoked_at ... returning prefix)',
  (await as(db, 'authenticated', U.bmA, `update public.api_tokens set revoked_at = now() where id = $1 and revoked_at is null returning prefix`, [T.A1])).n === 1);
check('BM: un-revoke affects 0 rows', (await as(db, 'authenticated', U.bmA, `update public.api_tokens set revoked_at = null where id = $1`, [T.A2])).n === 0);
check('BM: rename denied', denied(await as(db, 'authenticated', U.bmA, `update public.api_tokens set name = 'x' where id = $1`, [T.A1])));
check('BM: insert token denied', denied(await as(db, 'authenticated', U.bmA, `insert into public.api_tokens (org_id, name, token_hash, prefix) values ($1,'x','h','p')`, [A])));
check('Creator: sees 0 tokens', (await as(db, 'authenticated', U.creA, 'select id from public.api_tokens')).n === 0);
check('Creator: revoke affects 0 rows', (await as(db, 'authenticated', U.creA, `update public.api_tokens set revoked_at = now() where id = $1`, [T.A1])).n === 0);
check('Other workspace BM: sees 0 of A\'s tokens', (await as(db, 'authenticated', U.bmB, 'select id from public.api_tokens')).n === 0);
check('authenticated: TRUNCATE trusted_sources denied', denied(await as(db, 'authenticated', U.bmA, 'truncate public.trusted_sources')));
check('anon: select api_tokens denied', denied(await as(db, 'anon', null, 'select id from public.api_tokens')));
{ const r = await db.query(`select token_hash from public.api_tokens where id = $1`, [T.A1]);
  await db.exec('set role service_role'); const s = await db.query(`select token_hash from public.api_tokens where id = $1`, [T.A1]); await db.exec('reset role');
  check('service_role: token lookup by hash still works', s.rows[0]?.token_hash === 'hashA1' && r.rows.length === 1); }

// Notifications
await db.exec(`insert into audit_log (org_id, item_id, actor_id, action, detail) values ('${A}','${ITEM_B}','${U.bmA}','submitted','{}')`);
check('audit row in A naming B\'s item notifies nobody',
  (await db.query(`select count(*)::int n from notifications where item_id = '${ITEM_B}'`)).rows[0].n === 0);
await db.exec(`insert into audit_log (org_id, item_id, actor_id, action, detail) values ('${A}', null, '${U.bmA}', 'approved', '{}')`);
check('decision audit row with no item does not fail and notifies nobody',
  (await db.query(`select count(*)::int n from notifications where kind = 'decision'`)).rows[0].n === 0);
await db.exec(`insert into audit_log (org_id, item_id, actor_id, action, detail) values ('${A}','${ITEM_A}','${U.creA}','submitted','{"version":1}')`);
check('submitted in own workspace notifies the reviewer',
  (await db.query(`select count(*)::int n from notifications where user_id = '${U.revA}' and kind = 'review_requested'`)).rows[0].n === 1);
await db.exec(`insert into notifications (org_id, user_id, kind, title) values ('${A}','${U.leaver}','decision','x')`);
check('member sees own notification', (await as(db, 'authenticated', U.leaver, 'select id from notifications')).n === 1);
await db.exec(`delete from memberships where user_id = '${U.leaver}'`);
check('after leaving the workspace, 0 notifications visible', (await as(db, 'authenticated', U.leaver, 'select id from notifications')).n === 0);
check('direct UPDATE of notifications denied', denied(await as(db, 'authenticated', U.revA, `update notifications set read_at = now()`)));

// Storage
await db.exec(`insert into storage.buckets (id, name) values ('content-sources','content-sources') on conflict do nothing;
  insert into storage.objects (bucket_id, name) values ('content-sources', '${A}/f.pdf'), ('content-sources', '${B}/g.pdf'),
    ('content-sources', 'not-a-uuid/x.pdf'), ('content-sources', 'root.pdf');`);
{ const r = await as(db, 'authenticated', U.bmA, `select name from storage.objects where bucket_id = 'content-sources'`);
  check('storage: member lists only own folder; non-uuid / root names hidden without a cast error',
    r.ok && r.rows.length === 1 && r.rows[0].name === `${A}/f.pdf`, JSON.stringify(r.rows ?? r.err)); }

// Approval guard (0001/0003 trigger): even an RLS-bypassing writer cannot record a self-approval.
{ let err = '';
  try { await db.query(`insert into approvals (org_id, item_id, version, approver_id, decision) values ($1, $2, 1, $3, 'approved')`, [A, ITEM_A, U.creA]); }
  catch (e) { err = e.message; }
  check('approvals: author cannot approve their own item', err.includes('nobody can approve their own submission'), err); }

console.log(`\n### ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
