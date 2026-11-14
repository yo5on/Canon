// Continuous monitoring (Round 3 · Improvement 3). Re-checks approved and in-review content when something it relied
// on changed: a new policy version (rule or fact edited), a cited fact expiring, or a cited fact's source no longer
// confirming it. Monitoring runs are stored with purpose "monitor": they never change approval or what blocks it.
// New blocking issues raise a monitor_alert (audit log → inbox notifications → webhooks). Server-only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAnalysis } from "./analyze";
import { appUrl, dispatch } from "./webhooks";

export const MONITOR_BATCH = 20;

type PolicyRef = { code: string; version: number };
export interface Policy {
  version: number;
  rules: PolicyRef[];
  facts: PolicyRef[];
}

/** Codes whose version differs between two policies, plus codes added or removed. */
export function policyDiff(from: Policy | null, to: Policy) {
  const diff = (a: PolicyRef[], b: PolicyRef[]) => {
    const old = new Map(a.map((r) => [r.code, r.version]));
    const now = new Map(b.map((r) => [r.code, r.version]));
    return {
      added: b.filter((r) => !old.has(r.code)).map((r) => r.code),
      removed: a.filter((r) => !now.has(r.code)).map((r) => r.code),
      changed: b.filter((r) => old.has(r.code) && old.get(r.code) !== r.version).map((r) => `${r.code} v${old.get(r.code)}→v${r.version}`),
    };
  };
  return { rules: diff(from?.rules ?? [], to.rules), facts: diff(from?.facts ?? [], to.facts) };
}

export const diffSummary = (d: ReturnType<typeof policyDiff>) =>
  [
    ...d.rules.changed.map((c) => `rule ${c}`),
    ...d.rules.added.map((c) => `rule ${c} added`),
    ...d.rules.removed.map((c) => `rule ${c} removed`),
    ...d.facts.changed.map((c) => `fact ${c}`),
    ...d.facts.added.map((c) => `fact ${c} added`),
    ...d.facts.removed.map((c) => `fact ${c} removed`),
  ];

/** Blocking findings in the new run that the approved run did not have (same rule/fact and same words). */
export function newIssues<T extends { source_code: string | null; draft_quote: string; severity: string; verified: boolean }>(baseline: T[], latest: T[]) {
  const key = (f: T) => `${f.source_code}|${f.draft_quote.trim().toLowerCase()}`;
  const had = new Set(baseline.filter((f) => f.verified && f.severity === "blocking").map(key));
  return latest.filter((f) => f.verified && f.severity === "blocking" && !had.has(key(f)));
}

export interface MonitorResult {
  item_id: string;
  title: string;
  status: string;
  rechecked: boolean;
  reasons: string[];
  new_issues: string[];
  run_id?: string;
  error?: string;
}

export async function monitorWorkspace(admin: SupabaseClient, orgId: string, actorId: string | null, opts: { force?: boolean; today?: string } = {}) {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const { data: pid, error: pe } = await admin.rpc("snapshot_policy", { p_org: orgId, p_note: "" });
  if (pe) throw new Error("Could not record the policy version");
  const { data: current } = await admin.from("policy_versions").select("id, version, rules, facts").eq("id", pid).single();
  if (!current) throw new Error("Could not load the policy version");

  const { data: items } = await admin
    .from("content_items")
    .select("id, org_id, title, status, current_version, channel, audience, goal, publish_date")
    .eq("org_id", orgId)
    .in("status", ["approved", "in_review"])
    .order("updated_at", { ascending: false })
    .limit(MONITOR_BATCH);

  const results: MonitorResult[] = [];
  for (const item of items ?? []) {
    const r: MonitorResult = { item_id: item.id, title: item.title, status: item.status, rechecked: false, reasons: [], new_issues: [] };
    results.push(r);
    const { data: version } = await admin.from("content_versions").select("id, body, extraction, alt_text").eq("item_id", item.id).eq("version", item.current_version).single();
    if (!version) continue;
    const { data: runs } = await admin
      .from("analysis_runs")
      .select("id, purpose, policy, created_at")
      .eq("version_id", version.id)
      .neq("status", "running")
      .order("created_at", { ascending: false })
      .limit(20);
    const review = runs?.find((x) => x.purpose === "review");
    const last = runs?.[0];
    if (!review || !last) {
      r.reasons.push("No completed review run to compare against");
      continue;
    }

    // What changed since the last check of this version?
    const lastPolicy = (last.policy ?? null) as Policy | null;
    if (!lastPolicy || lastPolicy.version !== current.version) r.reasons.push(...diffSummary(policyDiff(lastPolicy, current as Policy)).map((s) => `Policy v${lastPolicy?.version ?? "?"}→v${current.version}: ${s}`));
    const { data: cited } = await admin.from("claims").select("fact_code").eq("run_id", last.id).not("fact_code", "is", null);
    const codes = [...new Set((cited ?? []).map((c) => c.fact_code as string))];
    if (codes.length) {
      const lastDay = String(last.created_at).slice(0, 10);
      const { data: facts } = await admin.from("facts").select("code, valid_until").eq("org_id", orgId).eq("is_current", true).in("code", codes);
      for (const f of facts ?? []) if (f.valid_until && f.valid_until >= lastDay && f.valid_until < today) r.reasons.push(`${f.code} expired on ${f.valid_until}`);
      const { data: changed } = await admin.from("source_checks").select("fact_code, url").eq("org_id", orgId).in("fact_code", codes).eq("outcome", "changed").gt("retrieved_at", last.created_at);
      for (const c of changed ?? []) r.reasons.push(`${c.fact_code}: source ${c.url} no longer confirms it`);
    }
    if (!r.reasons.length && !opts.force) continue;
    if (!r.reasons.length) r.reasons.push("Manual re-check");

    const res = await runAnalysis({ reader: admin, admin, item, version, purpose: "monitor", actorId });
    if (!res.ok) {
      r.error = res.error;
      continue;
    }
    r.rechecked = true;
    r.run_id = res.run_id;
    const [{ data: base }, { data: now }] = await Promise.all([
      admin.from("findings").select("source_code, draft_quote, severity, verified").eq("run_id", review.id),
      admin.from("findings").select("source_code, draft_quote, severity, verified, explanation").eq("run_id", res.run_id),
    ]);
    const fresh = newIssues(base ?? [], now ?? []);
    r.new_issues = fresh.map((f) => `${f.source_code ?? "—"}: ${(f as { explanation?: string }).explanation ?? f.draft_quote}`);
    if (fresh.length) {
      const summary = `${fresh.length} new blocking issue${fresh.length > 1 ? "s" : ""} after: ${r.reasons.slice(0, 3).join("; ")}`;
      await admin.from("audit_log").insert({ org_id: orgId, item_id: item.id, actor_id: actorId, action: "monitor_alert", detail: { run_id: res.run_id, summary, reasons: r.reasons } });
      await dispatch(admin, orgId, "monitor_alert", { title: `${item.title}: ${summary}`, item_id: item.id, status: item.status, link: `${appUrl()}/submissions/${item.id}` });
    }
  }
  await admin.from("audit_log").insert({
    org_id: orgId,
    actor_id: actorId,
    action: "monitoring_completed",
    detail: { policy_version: current.version, checked: results.length, rechecked: results.filter((x) => x.rechecked).length, alerts: results.filter((x) => x.new_issues.length).length },
  });
  return { policy_version: current.version, results };
}
