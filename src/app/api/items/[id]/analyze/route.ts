// POST /api/items/:id/analyze (ROUND2_PLAN §4). Reads go through the user's RLS-scoped client, so a
// non-member gets 404; only the final writes use the service role.
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildPrompt, createAnthropic, MODEL, PROMPT_VERSION, runAi, type AiClient, type AiResult } from "@/lib/ai";
import { mockClient } from "@/lib/ai.mock";
import { aiRules, assemble, type FactRow, type RuleRow } from "@/lib/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// SDK: 60 s per attempt, 2 retries; plus one retry on malformed output.
export const maxDuration = 300;

const DAILY_TOKEN_BUDGET = Number(process.env.CANON_DAILY_TOKEN_BUDGET) || 2_000_000;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/** The AI client for this request: the explicit DEMO/MOCK provider, the real API, or none. */
function aiClient(): { client: AiClient; model: string } | null {
  // Opt-in only; runs are stored with model "mock" and the report labels them DEMO/MOCK, never as Claude output.
  if (process.env.CANON_AI_MOCK === "1") return { client: mockClient, model: "mock" };
  const client = createAnthropic();
  return client ? { client, model: MODEL } : null;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return fail(400, "Bad item id");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "Sign in first");

  const { data: item } = await supabase
    .from("content_items")
    .select("id, org_id, status, current_version, channel, audience, goal, publish_date")
    .eq("id", id)
    .maybeSingle();
  if (!item) return fail(404, "Item not found");
  // A new run changes what blocks approval, so results are frozen once the item is in review.
  if (!["draft", "changes_requested"].includes(item.status)) return fail(409, `Checks can’t run while the item is ${item.status.replace("_", " ")}`);

  const { data: version } = await supabase
    .from("content_versions")
    .select("id, body")
    .eq("item_id", id)
    .eq("version", item.current_version)
    .single();
  if (!version) return fail(404, "Item not found");

  const ai = aiClient();
  const model = ai?.model ?? null;

  // Same version + prompt + model already finished: reuse it, no second charge.
  if (ai) {
    const { data: prev } = await supabase
      .from("analysis_runs")
      .select("id")
      .eq("version_id", version.id)
      .eq("prompt_version", PROMPT_VERSION)
      .eq("model", ai.model)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prev) {
      const [f, c] = await Promise.all([
        supabase.from("findings").select("id", { count: "exact", head: true }).eq("run_id", prev.id),
        supabase.from("claims").select("id", { count: "exact", head: true }).eq("run_id", prev.id),
      ]);
      return NextResponse.json({ run_id: prev.id, status: "done", findings: f.count ?? 0, claims: c.count ?? 0, reused: true });
    }

    const since = new Date().toISOString().slice(0, 10);
    const { data: today } = await supabase
      .from("analysis_runs")
      .select("input_tokens, output_tokens")
      .eq("org_id", item.org_id)
      .gte("created_at", since);
    const used = (today ?? []).reduce((n, r) => n + r.input_tokens + r.output_tokens, 0);
    if (used >= DAILY_TOKEN_BUDGET) return fail(429, "AI checks paused: today’s workspace budget is used up. Try again tomorrow.");
  }

  const [rulesRes, factsRes] = await Promise.all([
    supabase
      .from("rules")
      .select("code, version, text, category, severity, check_kind, banned_term, replacement")
      .eq("org_id", item.org_id)
      .eq("is_current", true),
    // Confidential facts are excluded here explicitly: RLS still shows them to Reviewers and Brand Managers.
    supabase
      .from("facts")
      .select("code, version, text, value, tolerance, valid_from, valid_until, replaced_by, confidential")
      .eq("org_id", item.org_id)
      .eq("is_current", true)
      .eq("confidential", false),
  ]);
  if (rulesRes.error || factsRes.error) return fail(500, "Could not load the Brand Kit");
  const rules = rulesRes.data as RuleRow[];
  const facts = factsRes.data as FactRow[];

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return fail(503, "Checks can’t save results: the server is missing its Supabase service key.");
  }
  const started = Date.now();
  const { data: run, error: runErr } = await admin
    .from("analysis_runs")
    .insert({ org_id: item.org_id, version_id: version.id, status: "running", model, prompt_version: PROMPT_VERSION })
    .select("id")
    .single();
  if (runErr || !run) return fail(500, "Could not start the check run");

  let result: AiResult | null = null;
  if (ai) {
    const sent = aiRules(rules);
    result = await runAi(ai.client, ai.model, buildPrompt({ ...item, body: version.body }, sent, facts));
  }
  const { findings, claims } = assemble(version.body, rules, facts, item.publish_date, result?.output ?? null);
  const status = !result ? "ai_skipped" : result.status;
  const note = !result ? "AI checks are not configured. Code checks only." : result.note;

  const findingRows = findings.map((f) => ({ id: crypto.randomUUID(), org_id: item.org_id, run_id: run.id, ...f }));
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
          .update({
            status,
            ai_note: note,
            input_tokens: result?.usage.input ?? 0,
            output_tokens: result?.usage.output ?? 0,
            duration_ms: Date.now() - started,
          })
          .eq("id", run.id)
      : { error: saveF.error ?? saveC.error };
  if (done.error) {
    // Never leave a finished-looking run with missing findings: it would let the item be submitted unchecked.
    await admin.from("analysis_runs").delete().eq("id", run.id);
    return fail(500, "Could not save the check results. Try again.");
  }

  await admin.from("audit_log").insert({
    org_id: item.org_id,
    item_id: item.id,
    actor_id: user.id,
    action: "checks_run",
    detail: { run_id: run.id, version: item.current_version, status, model, prompt_version: PROMPT_VERSION },
  });

  return NextResponse.json({ run_id: run.id, status, findings: findings.length, claims: claims.length });
}
