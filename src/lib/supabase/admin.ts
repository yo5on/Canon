import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client: bypasses RLS. Server only — SUPABASE_SECRET_KEY has no NEXT_PUBLIC_ prefix, so Next never
 * ships it to the browser. Used only by the analysis route to write runs, findings, claims and the audit entry,
 * after the user-scoped client has proved the caller can see the item.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
