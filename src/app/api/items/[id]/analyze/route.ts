// POST /api/items/:id/analyze (ROUND2_PLAN §4). Reads go through the user's RLS-scoped client, so a
// non-member gets 404; only the final writes use the service role. The run itself lives in src/lib/analyze.ts.
import { NextResponse } from "next/server";
import { z } from "zod";
import { runAnalysis } from "@/lib/analyze";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// SDK: 60 s per attempt, 2 retries; plus one retry on malformed output.
export const maxDuration = 300;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

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
    .select("id, body, extraction, alt_text")
    .eq("item_id", id)
    .eq("version", item.current_version)
    .single();
  if (!version) return fail(404, "Item not found");

  // A second click or tab while a run is in progress would create a duplicate run.
  const { data: running } = await supabase
    .from("analysis_runs")
    .select("id")
    .eq("version_id", version.id)
    .eq("status", "running")
    .gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString())
    .limit(1)
    .maybeSingle();
  if (running) return fail(409, "Checks are already running for this version. Refresh in a moment.");

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return fail(503, "Checks can’t save results: the server is missing its Supabase service key.");
  }
  const res = await runAnalysis({ reader: supabase, admin, item, version, purpose: "review", actorId: user.id });
  if (!res.ok) return fail(res.status, res.error);
  return NextResponse.json({ ...res, ok: undefined });
}
