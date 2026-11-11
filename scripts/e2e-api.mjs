// API-level workflow check against the live project, signed in as the demo users (RLS applies).
// Covers request-changes, revise, reject, self-approval and workspace isolation. Creates "[E2E]" items.
//   node scripts/e2e-api.mjs
import { createClient } from "@supabase/supabase-js";

for (const f of [".env.local", ".env.demo-accounts.local"]) {
  try {
    process.loadEnvFile(f);
  } catch {}
}
const env = process.env;
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, env.SUPABASE_SECRET_KEY, opts);
async function as(who) {
  const c = createClient(url, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, opts);
  const { error } = await c.auth.signInWithPassword({ email: env[`DEMO_${who}_EMAIL`], password: env[`DEMO_${who}_PASSWORD`] });
  if (error) throw error;
  return c;
}
const [M, R, C, O] = await Promise.all(["MANAGER", "REVIEWER", "CREATOR", "OUTSIDER"].map(as));
const RAVI = "00000000-0000-4000-a000-000000000002";
const org = (await C.from("memberships").select("org_id")).data[0].org_id;

let pass = 0, fail = 0;
const check = (label, ok, got) => (ok ? pass++ : fail++, console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` | got ${JSON.stringify(got)}`}`));
const errMsg = (r) => r.error?.message ?? null;
const status = async (id) => (await R.from("content_items").select("status").eq("id", id).single()).data?.status;
// Stand-in for the analysis route (service role), so submit_for_review sees a finished run.
async function finishedRun(item) {
  const { data: it } = await admin.from("content_items").select("current_version").eq("id", item).single();
  const { data: v } = await admin.from("content_versions").select("id").eq("item_id", item).eq("version", it.current_version).single();
  const r = await admin.from("analysis_runs").insert({ org_id: org, version_id: v.id, status: "ai_skipped", prompt_version: "e2e" });
  if (r.error) throw r.error;
}
const newItem = async (c, title, reviewer) =>
  c.rpc("create_item", { p_org: org, p_title: title, p_channel: "Blog", p_audience: "", p_goal: "", p_publish: "2026-12-15", p_reviewer: reviewer, p_body: "E2E test body. Plain text." });

// Request changes → revise → reject
const a = await newItem(C, "[E2E] request changes then reject", RAVI);
check("creator creates item", !a.error, a.error);
check("creator cannot submit before checks", /run checks/.test(errMsg(await C.rpc("submit_for_review", { p_item: a.data })) ?? ""));
await finishedRun(a.data);
check("creator submits", !(await C.rpc("submit_for_review", { p_item: a.data })).error);
check("creator cannot approve own submission", /nobody can approve their own/.test(errMsg(await C.rpc("decide_item", { p_item: a.data, p_decision: "approved", p_reason: "" })) ?? ""));
check("changes need a reason", /reason is required/.test(errMsg(await R.rpc("decide_item", { p_item: a.data, p_decision: "changes_requested", p_reason: "" })) ?? ""));
check("reviewer requests changes", !(await R.rpc("decide_item", { p_item: a.data, p_decision: "changes_requested", p_reason: "Please cite a source" })).error);
check("status changes_requested", (await status(a.data)) === "changes_requested", await status(a.data));
check("reviewer cannot revise creator's item", /only the author/.test(errMsg(await R.rpc("revise_item", { p_item: a.data, p_body: "x" })) ?? ""));
check("creator revises to v2", (await C.rpc("revise_item", { p_item: a.data, p_body: "Revised E2E body." })).data === 2);
await finishedRun(a.data);
check("creator resubmits", !(await C.rpc("submit_for_review", { p_item: a.data })).error);
check("reviewer rejects", !(await R.rpc("decide_item", { p_item: a.data, p_decision: "rejected", p_reason: "Off-brand for Q4" })).error);
check("status rejected", (await status(a.data)) === "rejected", await status(a.data));

// Self-approval: the Brand Manager authors an item, then tries to approve it.
const b = await newItem(M, "[E2E] self-approval attempt", RAVI);
await finishedRun(b.data);
await M.rpc("submit_for_review", { p_item: b.data });
check("author cannot approve own item", /nobody can approve their own/.test(errMsg(await M.rpc("decide_item", { p_item: b.data, p_decision: "approved", p_reason: "" })) ?? ""));
check("creator cannot pick self as reviewer", /cannot review your own/.test(errMsg(await newItem(C, "[E2E] self review", "00000000-0000-4000-a000-000000000003")) ?? ""));

// Workspace isolation and confidential facts
check("outsider sees no Canon items", (await O.from("content_items").select("id").eq("org_id", org)).data.length === 0);
check("outsider cannot decide Canon item", !!(await O.rpc("decide_item", { p_item: b.data, p_decision: "rejected", p_reason: "not mine" })).error);
check("outsider sees no Canon findings", (await O.from("findings").select("id").eq("org_id", org)).data.length === 0);
check("creator sees no confidential facts", (await C.from("facts").select("id").eq("confidential", true)).data.length === 0);
check("reviewer sees confidential facts", (await R.from("facts").select("id").eq("confidential", true)).data.length > 0);
check("creator cannot write status directly", !!(await C.from("content_items").update({ status: "approved" }).eq("id", b.data).select()).error);
const audit = await R.from("audit_log").select("action").eq("item_id", a.data);
check("audit log records the workflow", ["created", "submitted", "changes_requested", "revised", "rejected"].every((x) => audit.data.some((r) => r.action === x)), audit.data);

console.log(`\nE2E API: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
