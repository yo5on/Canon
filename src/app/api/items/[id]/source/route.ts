// GET /api/items/:id/source → short-lived signed link to the original uploaded file of the current version.
// Both reads use the user's client: RLS on content_versions and on storage.objects limit it to workspace members.
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Bad item id" }, { status: 400 });
  const supabase = await createClient();
  const { data: item } = await supabase.from("content_items").select("current_version").eq("id", id).maybeSingle();
  const { data: v } = item
    ? await supabase.from("content_versions").select("source_path, source_name").eq("item_id", id).eq("version", item.current_version).maybeSingle()
    : { data: null };
  // Revisions are pasted text; the original file lives on the version it was uploaded with.
  const { data: first } = item && !v?.source_path
    ? await supabase.from("content_versions").select("source_path, source_name").eq("item_id", id).not("source_path", "is", null).order("version", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const src = v?.source_path ? v : first;
  if (!src?.source_path) return NextResponse.json({ error: "No original file for this item" }, { status: 404 });
  const { data } = await supabase.storage.from("content-sources").createSignedUrl(src.source_path, 120, { download: src.source_name ?? true });
  if (!data) return NextResponse.json({ error: "No original file for this item" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, 307);
}
