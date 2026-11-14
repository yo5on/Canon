// HTTP end-to-end check of the Round 3 journeys against a running Canon (local or deployed), signed in as the demo
// users with real session cookies, exactly like a browser. Creates "[E2E]" items in the demo workspace.
//   BASE_URL=https://canon-rose.vercel.app node scripts/e2e-http.mjs
// Needs .env.local (Supabase URL + publishable key) and .env.demo-accounts.local (demo logins).
import { readFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

for (const f of [".env.local", ".env.demo-accounts.local"]) {
  try {
    process.loadEnvFile(f);
  } catch {}
}
const env = process.env;
const BASE = (env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
let pass = 0, fail = 0;
const check = (label, ok, got) => (ok ? pass++ : fail++, console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` | got ${JSON.stringify(got)?.slice(0, 400)}`}`));

/** Signs in through @supabase/ssr so the cookies are exactly what the app's middleware expects. */
async function session(who) {
  const jar = new Map();
  const sb = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) },
  });
  const { error } = await sb.auth.signInWithPassword({ email: env[`DEMO_${who}_EMAIL`], password: env[`DEMO_${who}_PASSWORD`] });
  if (error) throw new Error(`${who}: ${error.message}`);
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const http = (path, init = {}) => fetch(BASE + path, { ...init, redirect: "manual", headers: { cookie, ...(init.headers ?? {}) } });
  const json = async (path, body) => {
    const r = await http(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email: env[`DEMO_${who}_EMAIL`], password: env[`DEMO_${who}_PASSWORD`] });
  return { http, json, db };
}

const RAVI = "00000000-0000-4000-a000-000000000002";
const MIME = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", png: "image/png" };
const fields = (title) => ({ title: `[E2E] ${title}`, channel: "Blog", audience: "Customers", goal: "Launch", publish_date: "2026-12-15", reviewer: RAVI });

async function uploadItem(c, name, buf, extra = {}) {
  const s = await c.json("/api/uploads", { name, size: buf.length });
  if (s.status !== 200) return { stage: "sign", ...s };
  const put = await fetch(s.body.signedUrl, { method: "PUT", headers: { "content-type": s.body.contentType, "x-upsert": "false" }, body: buf });
  if (!put.ok) return { stage: "put", status: put.status, body: await put.text() };
  const r = await c.json("/api/items/from-file", { ...fields(name), path: s.body.path, name, ...extra });
  return { stage: "create", ...r };
}

const C = await session("CREATOR");
const R = await session("REVIEWER");

// Pages render for a signed-in user
for (const p of ["/", "/submissions", "/submissions/new", "/brand-kit", "/claims", "/review", "/audit", "/governance", "/inbox"]) {
  const r = await C.http(p);
  check(`GET ${p} renders`, r.status === 200, r.status);
}
check("login page shows demo credentials", /manager@canon-demo\.test/.test(await (await fetch(BASE + "/login")).text()));

// Validation: empty, oversized, unsupported, corrupt
check("rejects empty file at signing", (await C.json("/api/uploads", { name: "a.pdf", size: 0 })).status === 422);
check("rejects >10 MB at signing", (await C.json("/api/uploads", { name: "a.pdf", size: 11 * 1048576 })).status === 413);
check("rejects .txt at signing", (await C.json("/api/uploads", { name: "notes.txt", size: 10 })).status === 415);
const corrupt = await uploadItem(C, "corrupt.pdf", readFileSync("src/lib/__fixtures__/corrupt.pdf"));
check("corrupt PDF gives a readable 422", corrupt.status === 422 && /could not be read|no text layer/.test(corrupt.body.error), corrupt);
const fake = await uploadItem(C, "fake.png", Buffer.from("this is not an image at all, just text"));
check("text renamed .png is refused by its bytes", fake.status === 415 || fake.stage === "put", fake);

// Each format through extraction → checks → findings
const cases = [
  ["canon-demo-launch-brochure.pdf", "pdf", {}],
  ["canon-demo-partner-newsletter.docx", "docx", {}],
  ["canon-demo-social-banner.png", "png", { alt_text: "" }],
];
const ids = {};
for (const [file, kind, extra] of cases) {
  const r = await uploadItem(C, file, readFileSync(`public/samples/${file}`), extra);
  check(`${kind}: upload + extraction creates the item`, r.status === 200 && r.body.id, r);
  if (!r.body?.id) continue;
  ids[kind] = r.body.id;
  const run = await C.json(`/api/items/${r.body.id}/analyze`, {});
  check(`${kind}: checks run`, run.status === 200 && run.body.run_id, run);
  const dup = await C.json(`/api/items/${r.body.id}/analyze`, {});
  check(`${kind}: second run on unchanged version is reused, not duplicated`, dup.body.reused === true && dup.body.run_id === run.body.run_id, dup);
  const { data: v } = await C.db.from("content_versions").select("source_kind, source_path, extraction, body").eq("item_id", r.body.id).single();
  check(`${kind}: original file and segments are stored`, v?.source_path && v.extraction?.segments?.length > 0, v?.extraction);
  const { data: f } = await C.db.from("findings").select("source_code, draft_quote, severity, verified, region").eq("run_id", run.body.run_id);
  const { data: cl } = await C.db.from("claims").select("text, status, evidence").eq("run_id", run.body.run_id);
  const { data: ar } = await C.db.from("analysis_runs").select("policy_version_id, policy").eq("id", run.body.run_id).single();
  check(`${kind}: run records its policy version`, !!ar?.policy_version_id && ar.policy?.version > 0, ar);
  if (kind === "pdf") {
    check("pdf: banned term found on page 1 text", f.some((x) => x.source_code === "TERM-1"), f);
    check("pdf: contradicted claim from page 2 in ledger", cl.some((c) => c.status === "CONTRADICTED"), cl);
  }
  if (kind === "docx") check("docx: supported claim has register evidence", cl.some((c) => c.status === "SUPPORTED" && c.evidence.some((e) => e.kind === "register")), cl);
  if (kind === "png") {
    check("png: OCR text reached the ledger", cl.length > 0 || f.some((x) => x.source_code === "TONE-1"), { f, cl });
    check("png: low contrast flagged with a region", f.some((x) => x.source_code === "ACC-2" && x.region?.w > 0), f);
    check("png: off-palette colour flagged", f.some((x) => x.source_code === "BRAND-1"), f);
    check("png: missing alt text flagged", f.some((x) => x.source_code === "ACC-3"), f);
  }
  const page = await C.http(`/submissions/${r.body.id}`);
  const html = await page.text();
  check(`${kind}: report page renders with source panel`, page.status === 200 && /Original file/.test(html), page.status);
}

// Signed download of the original is limited to members
if (ids.pdf) {
  const r = await C.http(`/api/items/${ids.pdf}/source`);
  check("member gets a signed link to the original", r.status === 307 || r.status === 302, r.status);
  const O = await session("OUTSIDER").catch(() => null);
  if (O) check("outsider cannot download the original", (await O.http(`/api/items/${ids.pdf}/source`)).status === 404);
}

// Reviewer cannot run the creator's checks on an item in review; self approval is still impossible
if (ids.docx) {
  const sub = await C.db.rpc("submit_for_review", { p_item: ids.docx });
  check("creator submits the DOCX item", !sub.error, sub.error);
  const self = await C.db.rpc("decide_item", { p_item: ids.docx, p_decision: "approved", p_reason: "" });
  check("creator cannot approve own item", /nobody can approve their own/.test(self.error?.message ?? ""), self.error);
  const { data: n } = await R.db.from("notifications").select("kind, item_id").eq("item_id", ids.docx);
  check("reviewer is notified of the review request", n?.some((x) => x.kind === "review_requested"), n);
  check("checks are frozen while in review", (await C.json(`/api/items/${ids.docx}/analyze`, {})).status === 409);
}

console.log(`\nE2E HTTP (${BASE}): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
