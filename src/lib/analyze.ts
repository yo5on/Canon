// One analysis run, shared by the review route (POST /api/items/:id/analyze) and continuous monitoring.
// Reads go through `reader` (the user's RLS client for reviews; the service client for scheduled monitoring);
// writes always use the service client. Every run records the exact policy version (rule and fact versions) it applied.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPrompt, createAnthropic, MODEL, PROMPT_VERSION, runAi, type AiClient, type AiResult } from "./ai";
import { createMockClient, MOCK_PROMPT_VERSION } from "./ai.mock";
import type { Extraction } from "./extract";
import { aiRules, assemble, relevantFacts, type FactRow, type FindingRow, type RuleRow, type SourceCheck } from "./pipeline";
import { visualFindings, type VisualRule } from "./visualchecks";

export const DAILY_TOKEN_BUDGET = Number(process.env.CANON_DAILY_TOKEN_BUDGET) || 2_000_000;

export interface AnalyzeItem {
  id: string;
  org_id: string;
  current_version: number;
  channel: string;
  audience: string;
  goal: string;
  publish_date: string;
}
export interface AnalyzeVersion {
  id: string;
  body: string;
  extraction: Extraction | null;
  alt_text: string | null;
}

export type AnalyzeResult =
  | { ok: true; run_id: string; status: string; findings: number; claims: number; blocking: number; reused?: boolean; policy_version: number | null }
  | { ok: false; status: number; error: string };

/** The AI client for this request: the explicit DEMO/MOCK provider, the real API, or none. */
export function aiClient(draft: string): { client: AiClient; model: string } | null {
  // Opt-in only; runs are stored with model "mock" and the report labels them DEMO/MOCK, never as Claude output.
  if (process.env.CANON_AI_MOCK === "1") return { client: createMockClient(draft), model: "mock" };
  const client = createAnthropic();
  return client ? { client, model: MODEL } : null;
}

const fail = (status: number, error: string): AnalyzeResult => ({ ok: false, status, error });

/** Latest retrieval per fact code, and the latest retrieved text per URL (for claims with no approved fact). */
export async function loadSourceEvidence(reader: SupabaseClient, orgId: string) {
  const { data, error } = await reader
    .from("source_checks")
    .select("fact_code, fact_version, url, retrieved_at, outcome, excerpt, http_status, error, page_text")
    .eq("org_id", orgId)
    .order("retrieved_at", { ascending: false })
    .limit(300);
  if (error) throw new Error("Could not load source checks");
  const checks = new Map<string, SourceCheck>();
  const pages = new Map<string, { url: string; retrieved_at: string; page_text: string }>();
  for (const r of data ?? []) {
    if (!checks.has(r.fact_code)) checks.set(r.fact_code, r as SourceCheck);
    if (r.page_text && !pages.has(r.url)) pages.set(r.url, { url: r.url, retrieved_at: r.retrieved_at, page_text: r.page_text });
  }
  return { checks, pages: [...pages.values()] };
}

export async function runAnalysis(opts: {
  reader: SupabaseClient;
  admin: SupabaseClient;
  item: AnalyzeItem;
  version: AnalyzeVersion;
  purpose: "review" | "monitor";
  actorId: string | null;
}): Promise<AnalyzeResult> {
  const { reader, admin, item, version, purpose, actorId } = opts;
  const ai = aiClient(version.body);
  const model = ai?.model ?? null;
  const promptVersion = model === "mock" ? MOCK_PROMPT_VERSION : PROMPT_VERSION;

  // The policy version this run applies. A new rule or fact version makes a new policy version.
  const { data: policyId, error: polErr } = await reader.rpc("snapshot_policy", { p_org: item.org_id, p_note: "" });
  if (polErr || !policyId) return fail(500, "Could not record the policy version");
  const { data: policy } = await reader.from("policy_versions").select("id, version, rules, facts").eq("id", policyId).single();
  if (!policy) return fail(500, "Could not load the policy version");

  if (ai && purpose === "review") {
    // Same version + prompt + model + policy already finished: reuse it, no second charge.
    const { data: prev } = await reader
      .from("analysis_runs")
      .select("id")
      .eq("version_id", version.id)
      .eq("prompt_version", promptVersion)
      .eq("model", ai.model)
      .eq("policy_version_id", policy.id)
      .eq("purpose", "review")
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prev) {
      const [f, c, b] = await Promise.all([
        reader.from("findings").select("id", { count: "exact", head: true }).eq("run_id", prev.id),
        reader.from("claims").select("id", { count: "exact", head: true }).eq("run_id", prev.id),
        reader.from("findings").select("id", { count: "exact", head: true }).eq("run_id", prev.id).eq("severity", "blocking").eq("verified", true),
      ]);
      return { ok: true, run_id: prev.id, status: "done", findings: f.count ?? 0, claims: c.count ?? 0, blocking: b.count ?? 0, reused: true, policy_version: policy.version };
    }
  }

  if (ai) {
    const since = new Date().toISOString().slice(0, 10);
    const { data: today } = await admin.from("analysis_runs").select("input_tokens, output_tokens").eq("org_id", item.org_id).gte("created_at", since);
    const used = (today ?? []).reduce((n, r) => n + r.input_tokens + r.output_tokens, 0);
    if (used >= DAILY_TOKEN_BUDGET) return fail(429, "AI checks paused: today’s workspace budget is used up. Try again tomorrow.");
  }

  // The run uses exactly the rule and fact rows named by the policy version.
  const ruleIds = (policy.rules as { id: string }[]).map((r) => r.id);
  const factIds = (policy.facts as { id: string }[]).map((r) => r.id);
  const [rulesRes, factsRes] = await Promise.all([
    ruleIds.length
      ? reader.from("rules").select("code, version, text, category, severity, check_kind, check_type, params, banned_term, replacement").in("id", ruleIds)
      : Promise.resolve({ data: [], error: null }),
    // Confidential facts are excluded explicitly: RLS still shows them to Reviewers and Brand Managers.
    factIds.length
      ? reader.from("facts").select("code, version, text, value, tolerance, valid_from, valid_until, replaced_by, confidential, source_url, source_ref, owner").in("id", factIds).eq("confidential", false)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (rulesRes.error || factsRes.error) return fail(500, "Could not load the Brand Kit");
  const rules = rulesRes.data as VisualRule[];
  const facts = factsRes.data as FactRow[];
  let evidence: Awaited<ReturnType<typeof loadSourceEvidence>>;
  try {
    evidence = await loadSourceEvidence(reader, item.org_id);
  } catch {
    return fail(500, "Could not load source evidence");
  }

  const started = Date.now();
  const { data: run, error: runErr } = await admin
    .from("analysis_runs")
    .insert({
      org_id: item.org_id,
      version_id: version.id,
      status: "running",
      model,
      prompt_version: promptVersion,
      purpose,
      policy_version_id: policy.id,
      policy: { version: policy.version, rules: policy.rules, facts: policy.facts },
    })
    .select("id")
    .single();
  if (runErr || !run) return fail(500, "Could not start the check run");

  let result: AiResult | null = null;
  if (ai && version.body.trim()) {
    const sent = aiRules(rules as RuleRow[]);
    result = await runAi(ai.client, ai.model, buildPrompt({ ...item, body: version.body }, sent, relevantFacts(version.body, facts)));
  }
  const { findings, claims } = assemble(version.body, rules as RuleRow[], facts, item.publish_date, result?.output ?? null, {
    sourceChecks: evidence.checks,
    externalPages: evidence.pages,
  });
  const visual: FindingRow[] = visualFindings(rules, version.body, version.extraction, version.alt_text);
  // Visual findings first so claim finding indexes stay valid.
  const all = [...findings, ...visual];
  const status = !result ? "ai_skipped" : result.status;
  const note = !result ? (version.body.trim() ? "AI checks are not configured. Code checks only." : "No text to send to AI checks. Visual code checks only.") : result.note;

  const findingRows = all.map((f) => ({ id: crypto.randomUUID(), org_id: item.org_id, run_id: run.id, region: null, ...f }));
  const claimRows = claims.map(({ finding_index, ...c }) => ({
    org_id: item.org_id,
    run_id: run.id,
    ...c,
    finding_id: finding_index === null ? null : findingRows[finding_index].id,
  }));

  const saveF = findingRows.length ? await admin.from("findings").insert(findingRows) : { error: null };
  const saveC = !saveF.error && claimRows.length ? await admin.from("claims").insert(claimRows) : { error: saveF.error };
  const done =
    !saveF.error && !saveC.error
      ? await admin
          .from("analysis_runs")
          .update({ status, ai_note: note, input_tokens: result?.usage.input ?? 0, output_tokens: result?.usage.output ?? 0, duration_ms: Date.now() - started })
          .eq("id", run.id)
      : { error: saveF.error ?? saveC.error };
  if (done.error) {
    console.error("save run failed:", done.error.message);
    // Never leave a finished-looking run with missing findings: it would let the item be submitted unchecked.
    await admin.from("analysis_runs").delete().eq("id", run.id);
    return fail(500, "Could not save the check results. Try again.");
  }

  const blocking = all.filter((f) => f.verified && f.severity === "blocking").length;
  const audit = await admin.from("audit_log").insert({
    org_id: item.org_id,
    item_id: item.id,
    actor_id: actorId,
    action: purpose === "review" ? "checks_run" : "monitor_run",
    detail: { run_id: run.id, version: item.current_version, status, model, prompt_version: promptVersion, policy_version: policy.version, blocking },
  });
  if (audit.error) {
    await admin.from("analysis_runs").delete().eq("id", run.id);
    return fail(500, "Could not record the check in audit history. Run checks again.");
  }
  return { ok: true, run_id: run.id, status, findings: all.length, claims: claims.length, blocking, policy_version: policy.version };
}
