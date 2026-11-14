// GET /api/v1/items/:id/gate — publish gate for CMSs and deployment pipelines (Round 3 · Improvement 3).
// Answers "may this be published?" from Canon's records. It never publishes and never changes anything.
// publishable = approved, the approved version is the current one, no open blocking issues, and (if ?sha256= is
// given) the text about to be published is byte-for-byte the approved text.
import { NextResponse } from "next/server";
import { z } from "zod";
import { bodyHash, tokenOrg } from "@/lib/apitoken";
import { newIssues } from "@/lib/monitor";
import { createAdminClient } from "@/lib/supabase/admin";

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();
  const org = await tokenOrg(admin, req);
  if (!org) return fail(401, "Send a valid workspace API token: Authorization: Bearer canon_…");
  if (!z.uuid().safeParse(id).success) return fail(400, "Bad item id");

  const { data: item } = await admin.from("content_items").select("id, title, status, current_version, publish_date").eq("id", id).eq("org_id", org).maybeSingle();
  if (!item) return fail(404, "Item not found in this workspace");
  const [{ data: version }, { data: approval }] = await Promise.all([
    admin.from("content_versions").select("id, body, source_kind, source_sha256").eq("item_id", id).eq("version", item.current_version).single(),
    admin.from("approvals").select("version, created_at").eq("item_id", id).eq("decision", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!version) return fail(404, "Item not found in this workspace");
  const { data: runs } = await admin.from("analysis_runs").select("id, purpose, policy, created_at").eq("version_id", version.id).neq("status", "running").order("created_at", { ascending: false }).limit(10);
  const review = runs?.find((r) => r.purpose === "review");
  const monitor = runs?.find((r) => r.purpose === "monitor");
  let newBlocking = 0;
  if (review && monitor && monitor.created_at > review.created_at) {
    const [{ data: a }, { data: b }] = await Promise.all([
      admin.from("findings").select("source_code, draft_quote, severity, verified").eq("run_id", review.id),
      admin.from("findings").select("source_code, draft_quote, severity, verified").eq("run_id", monitor.id),
    ]);
    newBlocking = newIssues(a ?? [], b ?? []).length;
  }
  // Same rule as the approval trigger: verified blocking findings of the latest review run, minus overridden ones.
  let open: number | null = null;
  if (review) {
    const { data: fs } = await admin.from("findings").select("id, finding_decisions(decision)").eq("run_id", review.id).eq("severity", "blocking").eq("verified", true);
    open = (fs ?? []).filter((f) => !(f.finding_decisions as { decision: string }[]).some((d) => d.decision === "overridden")).length;
  }
  const hash = bodyHash(version.body);
  const asked = new URL(req.url).searchParams.get("sha256");
  const approvedCurrent = item.status === "approved" && approval?.version === item.current_version;
  const textMatches = asked ? asked.toLowerCase() === hash : null;
  return NextResponse.json({
    item_id: item.id,
    title: item.title,
    status: item.status,
    publishable: approvedCurrent && (open ?? 0) === 0 && newBlocking === 0 && textMatches !== false,
    approved_version: approval?.version ?? null,
    approved_at: approval?.created_at ?? null,
    current_version: item.current_version,
    body_sha256: hash,
    text_matches: textMatches,
    source_kind: version.source_kind,
    source_file_sha256: version.source_sha256,
    open_blocking: open,
    policy_version: (review?.policy as { version?: number } | null)?.version ?? null,
    monitoring: { last_checked: monitor?.created_at ?? null, policy_version: (monitor?.policy as { version?: number } | null)?.version ?? null, new_blocking: newBlocking },
    publish_date: item.publish_date,
  });
}
