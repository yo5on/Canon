// POST /api/uploads: a one-time signed URL so the browser uploads the original file straight to the private
// "content-sources" bucket (Vercel functions cap request bodies at 4.5 MB; Canon accepts 10 MB).
// The file is only trusted after /api/items/from-file re-reads it and checks its bytes.
import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_FILE_BYTES } from "@/lib/extract";
import { EXT_MIME, extOf } from "@/lib/items";
import { createAdminClient } from "@/lib/supabase/admin";
import { getContext } from "@/lib/workspace";

const body = z.object({ name: z.string().min(1).max(255), size: z.number().int() });
const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Bad upload request");
  const { name, size } = parsed.data;
  if (size <= 0) return fail(422, "The file is empty.");
  if (size > MAX_FILE_BYTES) return fail(413, `The file is ${(size / 1048576).toFixed(1)} MB. The limit is 10 MB.`);
  const ext = extOf(name);
  if (!EXT_MIME[ext]) return fail(415, ext === ".doc" ? "Old Word .doc files aren’t supported. Save it as .docx." : "Upload a PDF, a Word .docx, or a PNG, JPEG or WebP image.");

  const { user, active } = await getContext();
  if (!active) return fail(403, "Join a workspace first");
  const path = `${active.orgId}/${user.id}/${crypto.randomUUID()}${ext}`;
  const { data, error } = await createAdminClient().storage.from("content-sources").createSignedUploadUrl(path);
  if (error || !data) return fail(503, "File storage is unavailable. Try again, or paste the text instead.");
  return NextResponse.json({ path, signedUrl: data.signedUrl, contentType: EXT_MIME[ext] });
}
