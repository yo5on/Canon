// POST /api/items/from-file: reads the uploaded original back from storage, validates it by its bytes, extracts the
// text (PDF, DOCX) or runs OCR and pixel measurements (images), then creates the item. The extracted text becomes
// version 1's body, so the existing checks, verifier and Claims Ledger run on it unchanged.
import { NextResponse } from "next/server";
import { z } from "zod";
import { extract, ExtractError, sha256 } from "@/lib/extract";
import { itemFields } from "@/lib/items";
import { createAdminClient } from "@/lib/supabase/admin";
import { getContext } from "@/lib/workspace";

export const maxDuration = 60;

const input = itemFields.extend({
  path: z.string().max(300),
  name: z.string().trim().min(1).max(255),
  alt_text: z.string().trim().max(1000).default(""),
});
const fail = (status: number, error: string, field?: string) => NextResponse.json({ error, field }, { status });

export async function POST(req: Request) {
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail(400, i.message, String(i.path[0] ?? ""));
  }
  const d = parsed.data;
  const { user, active } = await getContext();
  if (!active) return fail(403, "Join a workspace first");
  // The path was issued for this user and workspace by /api/uploads.
  if (!d.path.startsWith(`${active.orgId}/${user.id}/`) || d.path.includes("..")) return fail(403, "That upload does not belong to you");
  if (d.reviewer === user.id) return fail(422, "Choose a Reviewer or Brand Manager other than yourself.", "reviewer");

  const admin = createAdminClient();
  const bucket = admin.storage.from("content-sources");
  const { data: blob, error: dlErr } = await bucket.download(d.path);
  if (dlErr || !blob) return fail(404, "The upload did not finish. Choose the file again.");
  const buf = new Uint8Array(await blob.arrayBuffer());

  let result: Awaited<ReturnType<typeof extract>>;
  try {
    result = await extract(d.name, buf);
  } catch (e) {
    await bucket.remove([d.path]);
    if (e instanceof ExtractError) return fail(e.status, e.message, "file");
    console.error("extract failed:", (e as Error)?.message);
    return fail(500, "Canon could not process this file. Try again, or paste the text instead.", "file");
  }

  const { data: id, error } = await admin.rpc("create_item_from_source", {
    p_author: user.id,
    p_org: active.orgId,
    p_title: d.title,
    p_channel: d.channel,
    p_audience: d.audience,
    p_goal: d.goal,
    p_publish: d.publish_date,
    p_reviewer: d.reviewer,
    p_body: result.body,
    p_source: {
      kind: result.extraction.kind,
      name: d.name,
      mime: result.extraction.mime,
      bytes: buf.length,
      path: d.path,
      sha256: sha256(buf),
      extraction: result.extraction,
      alt_text: d.alt_text,
    },
  });
  if (error || !id) {
    await bucket.remove([d.path]);
    if (/review/.test(error?.message ?? "")) return fail(422, "Choose a Reviewer or Brand Manager in this workspace, other than yourself.", "reviewer");
    console.error("create_item_from_source:", error?.message);
    return fail(500, "Could not save the item. Try again.");
  }
  return NextResponse.json({ id, kind: result.extraction.kind, chars: result.body.length, warnings: result.extraction.warnings });
}
