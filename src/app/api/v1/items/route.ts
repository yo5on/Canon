// GET /api/v1/items?status=approved — items of the token's workspace, newest first (read-only, max 100).
import { NextResponse } from "next/server";
import { tokenOrg } from "@/lib/apitoken";
import { createAdminClient } from "@/lib/supabase/admin";

const STATUSES = ["draft", "in_review", "changes_requested", "approved", "rejected"];

export async function GET(req: Request) {
  const admin = createAdminClient();
  const org = await tokenOrg(admin, req);
  if (!org) return NextResponse.json({ error: "Send a valid workspace API token: Authorization: Bearer canon_…" }, { status: 401 });
  const status = new URL(req.url).searchParams.get("status");
  if (status && !STATUSES.includes(status)) return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
  let q = admin.from("content_items").select("id, title, channel, status, current_version, publish_date, updated_at").eq("org_id", org).order("updated_at", { ascending: false }).limit(100);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: "Could not list items" }, { status: 500 });
  return NextResponse.json({ items: data });
}
