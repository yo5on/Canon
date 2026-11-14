// GET /api/cron/monitor — daily continuous monitoring for every workspace (vercel.json "crons").
// Vercel sends "Authorization: Bearer $CRON_SECRET". Without CRON_SECRET configured the endpoint refuses to run,
// and monitoring is available on demand from Governance instead.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { monitorWorkspace } from "@/lib/monitor";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured; run monitoring from Governance." }, { status: 503 });
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: orgs } = await admin.from("organisations").select("id");
  const summary = [];
  for (const o of orgs ?? []) {
    try {
      const r = await monitorWorkspace(admin, o.id, null);
      summary.push({ org: o.id, policy_version: r.policy_version, rechecked: r.results.filter((x) => x.rechecked).length, alerts: r.results.filter((x) => x.new_issues.length).length });
    } catch (e) {
      summary.push({ org: o.id, error: (e as Error).message });
    }
  }
  return NextResponse.json({ ran_at: new Date().toISOString(), workspaces: summary });
}
