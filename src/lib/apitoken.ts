import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Workspace of a valid, unrevoked "Authorization: Bearer canon_…" token, or null. Only hashes are stored. */
export async function tokenOrg(admin: SupabaseClient, req: Request): Promise<string | null> {
  const m = /^Bearer\s+(canon_[A-Za-z0-9_-]{20,80})$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return null;
  const hash = createHash("sha256").update(m[1]).digest("hex");
  const { data } = await admin.from("api_tokens").select("id, org_id").eq("token_hash", hash).is("revoked_at", null).maybeSingle();
  if (!data) return null;
  await admin.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data.org_id as string;
}

export const bodyHash = (body: string) => createHash("sha256").update(body, "utf8").digest("hex");
