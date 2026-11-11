// Live checks against the real Supabase API with real sign-ins (publishable key + demo accounts).
// Read-only except for writes that must be rejected, so demo data is never changed.
// Skipped when the env files are missing (e.g. CI without secrets).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

for (const f of [".env.local", ".env.demo-accounts.local"]) {
  try {
    process.loadEnvFile(f);
  } catch {}
}
const env = process.env;
const ready = !!(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && env.DEMO_MANAGER_EMAIL);

const anon = () =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function signIn(who: "MANAGER" | "REVIEWER" | "CREATOR" | "OUTSIDER") {
  const c = anon();
  const { error } = await c.auth.signInWithPassword({
    email: env[`DEMO_${who}_EMAIL`]!,
    password: env[`DEMO_${who}_PASSWORD`]!,
  });
  if (error) throw error;
  return c;
}

async function myMemberships(c: SupabaseClient) {
  const { data: u } = await c.auth.getUser();
  const { data, error } = await c.from("memberships").select("org_id, role").eq("user_id", u.user!.id);
  if (error) throw error;
  return data;
}

describe.skipIf(!ready)("live RLS via the real API", { timeout: 30_000 }, () => {
  let manager: SupabaseClient, reviewer: SupabaseClient, creator: SupabaseClient, outsider: SupabaseClient;
  let canonOrg: string;

  beforeAll(async () => {
    [manager, reviewer, creator, outsider] = await Promise.all([
      signIn("MANAGER"),
      signIn("REVIEWER"),
      signIn("CREATOR"),
      signIn("OUTSIDER"),
    ]);
    canonOrg = (await myMemberships(manager))[0].org_id;
  }, 30_000);

  it("rejects a wrong password", async () => {
    const { error } = await anon().auth.signInWithPassword({ email: env.DEMO_MANAGER_EMAIL!, password: "wrong-password" });
    expect(error).not.toBeNull();
  });

  it("roles come from the database", async () => {
    expect((await myMemberships(manager)).map((m) => m.role)).toEqual(["brand_manager"]);
    expect((await myMemberships(reviewer)).map((m) => m.role)).toEqual(["reviewer"]);
    expect((await myMemberships(creator)).map((m) => m.role)).toEqual(["creator"]);
  });

  it("signed-out callers read nothing", async () => {
    const { data, error } = await anon().from("rules").select("id");
    expect(error !== null || data!.length === 0).toBe(true);
  });

  it("outsider sees no Canon workspace data", async () => {
    for (const t of ["organisations", "memberships", "rules", "facts", "content_items", "audit_log"]) {
      const col = t === "organisations" ? "id" : "org_id";
      const { data, error } = await outsider.from(t).select("*").eq(col, canonOrg);
      expect(error).toBeNull();
      expect(data, t).toHaveLength(0);
    }
  });

  it("Canon members see only Canon rules", async () => {
    const { data } = await creator.from("rules").select("org_id");
    expect(data!.length).toBeGreaterThan(0);
    expect(new Set(data!.map((r) => r.org_id))).toEqual(new Set([canonOrg]));
  });

  it("confidential facts: hidden from Creators, visible to Reviewers and Brand Managers", async () => {
    const conf = async (c: SupabaseClient) =>
      (await c.from("facts").select("id").eq("org_id", canonOrg).eq("confidential", true)).data!.length;
    expect(await conf(creator)).toBe(0);
    expect(await conf(reviewer)).toBeGreaterThan(0);
    expect(await conf(manager)).toBeGreaterThan(0);
    const all = await creator.from("facts").select("id").eq("org_id", canonOrg);
    expect(all.data!.length).toBeGreaterThan(0);
  });

  it("only Brand Managers can write rules and facts", async () => {
    for (const c of [creator, reviewer, outsider]) {
      const rule = await c.from("rules").insert({ org_id: canonOrg, code: "LIVE-1", text: "should fail", category: "tone", severity: "advisory", check_kind: "ai" });
      expect(rule.error?.code).toBe("42501");
      const fact = await c.from("facts").insert({ org_id: canonOrg, code: "FACT-999", text: "should fail" });
      expect(fact.error?.code).toBe("42501");
      const upd = await c.from("rules").update({ text: "hijacked" }).eq("org_id", canonOrg).select("id");
      expect(upd.data ?? []).toHaveLength(0);
    }
  });

  it("nobody can change memberships directly (no client-supplied roles)", async () => {
    const { data: u } = await creator.auth.getUser();
    const r = await creator.from("memberships").update({ role: "brand_manager" }).eq("user_id", u.user!.id).select();
    expect(r.error).not.toBeNull();
  });

  it("sign-out ends the session", async () => {
    const c = await signIn("CREATOR");
    await c.auth.signOut();
    const { data } = await c.from("rules").select("id");
    expect(data ?? []).toHaveLength(0);
  });
});
