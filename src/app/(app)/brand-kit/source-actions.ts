"use server";

// Trusted sources and fact source checks (Round 3 · Improvement 2). Managing the list goes through the user's client
// (RLS: Brand Manager only). Retrieval results are written by the service role, because source_checks is append-only
// evidence nobody may edit; the manager check below plus RLS on the facts read keep it to Brand Managers.
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { findFactInPage, MAX_STORED_TEXT, outcomeFor, safeFetch, sha, SourceError, type Outcome } from "@/lib/sources";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl, dispatch } from "@/lib/webhooks";
import { requireWorkspace } from "@/lib/workspace";

export type SourceState = { error?: string; ok?: string };

async function manager() {
  const ctx = await requireWorkspace();
  return ctx.active.role === "brand_manager" ? ctx : null;
}

/** "https://www.Example.org/path" → "www.example.org". */
function normaliseDomain(input: string) {
  const raw = input.trim().toLowerCase();
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).host;
  } catch {
    return "";
  }
}

const sourceInput = z.object({
  name: z.string().trim().min(1, "Name the source").max(120),
  domain: z.string().trim().min(3, "Enter a domain such as data.gov.in").max(200),
});

export async function addTrustedSource(_prev: SourceState, form: FormData): Promise<SourceState> {
  const ctx = await manager();
  if (!ctx) return { error: "Only a Brand Manager can change trusted sources." };
  const parsed = sourceInput.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const domain = normaliseDomain(parsed.data.domain);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?$/.test(domain)) return { error: "That doesn’t look like a domain." };
  const { error } = await ctx.supabase
    .from("trusted_sources")
    .upsert({ org_id: ctx.active.orgId, name: parsed.data.name, domain, active: true }, { onConflict: "org_id,domain" });
  if (error) return { error: error.code === "42501" ? "Only a Brand Manager can change trusted sources." : "Could not save the source. Try again." };
  await createAdminClient().from("audit_log").insert({ org_id: ctx.active.orgId, actor_id: ctx.user.id, action: "trusted_source_added", detail: { domain, name: parsed.data.name } });
  revalidatePath("/brand-kit");
  return { ok: `${domain} is now trusted.` };
}

export async function setTrustedSourceActive(form: FormData) {
  const ctx = await manager();
  if (!ctx) return;
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return;
  const active = form.get("active") === "true";
  const { data } = await ctx.supabase.from("trusted_sources").update({ active }).eq("id", id.data).eq("org_id", ctx.active.orgId).select("domain").maybeSingle();
  if (data) await createAdminClient().from("audit_log").insert({ org_id: ctx.active.orgId, actor_id: ctx.user.id, action: active ? "trusted_source_enabled" : "trusted_source_disabled", detail: { domain: data.domain } });
  revalidatePath("/brand-kit");
}

type FactForCheck = { code: string; version: number; text: string; value: number | null; tolerance: number; source_url: string };

/** Retrieves one fact's source and records what code found. Never throws; failures are recorded as such. */
async function checkOne(orgId: string, actor: string, fact: FactForCheck, domains: string[]) {
  const admin = createAdminClient();
  const { data: prev } = await admin
    .from("source_checks")
    .select("outcome")
    .eq("org_id", orgId)
    .eq("fact_code", fact.code)
    .eq("url", fact.source_url)
    .in("outcome", ["confirmed", "not_found", "changed"])
    .order("retrieved_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = {
    org_id: orgId,
    fact_code: fact.code,
    fact_version: fact.version,
    url: fact.source_url,
    checked_by: actor,
    http_status: null as number | null,
    outcome: "unavailable" as Outcome,
    excerpt: null as string | null,
    content_sha256: null as string | null,
    page_text: null as string | null,
    error: null as string | null,
  };
  try {
    const page = await safeFetch(fact.source_url, domains);
    const hit = findFactInPage({ text: fact.text, value: fact.value === null ? null : Number(fact.value), tolerance: Number(fact.tolerance) }, page.text);
    row.http_status = page.status;
    row.outcome = outcomeFor(hit.found, (prev?.outcome as Outcome) ?? null);
    row.excerpt = hit.excerpt;
    row.content_sha256 = sha(page.text);
    row.page_text = page.text.slice(0, MAX_STORED_TEXT);
  } catch (e) {
    if (e instanceof SourceError) {
      row.outcome = e.outcome;
      row.error = e.message;
      row.http_status = e.status;
    } else {
      row.error = "Unexpected error while retrieving the source.";
    }
  }
  await admin.from("source_checks").insert(row);
  if (row.outcome === "changed") {
    const summary = `${fact.code} (“${fact.text}”) is no longer stated at ${fact.source_url}. Claims citing it are now OUTDATED on their next check.`;
    await admin.from("audit_log").insert({ org_id: orgId, actor_id: actor, action: "source_changed", detail: { fact: fact.code, url: fact.source_url, summary } });
    after(() => dispatch(admin, orgId, "source_changed", { title: summary, fact: fact.code, url: fact.source_url, link: `${appUrl()}/brand-kit?tab=sources` }));
  }
  return row.outcome;
}

/** Check one fact (form field "code") or every fact with a source URL. */
export async function checkSources(_prev: SourceState, form: FormData): Promise<SourceState> {
  const ctx = await manager();
  if (!ctx) return { error: "Only a Brand Manager can check sources." };
  const code = form.get("code");
  let q = ctx.supabase
    .from("facts")
    .select("code, version, text, value, tolerance, source_url")
    .eq("org_id", ctx.active.orgId)
    .eq("is_current", true)
    .eq("confidential", false)
    .not("source_url", "is", null);
  if (typeof code === "string" && code) q = q.eq("code", code);
  const [{ data: facts, error }, { data: trusted }] = await Promise.all([
    q.limit(25),
    ctx.supabase.from("trusted_sources").select("domain").eq("org_id", ctx.active.orgId).eq("active", true),
  ]);
  if (error) return { error: "Could not load facts." };
  if (!facts?.length) return { error: "No non-confidential fact has a source URL yet. Edit a fact and add its https:// source." };
  const domains = (trusted ?? []).map((t) => t.domain as string);
  const outcomes = await Promise.all(facts.map((f) => checkOne(ctx.active.orgId, ctx.user.id, f as FactForCheck, domains)));
  revalidatePath("/brand-kit");
  const n = (o: Outcome) => outcomes.filter((x) => x === o).length;
  return { ok: `Checked ${outcomes.length} source${outcomes.length > 1 ? "s" : ""}: ${n("confirmed")} confirmed, ${n("not_found")} not stated, ${n("changed")} changed, ${n("unavailable")} unavailable, ${n("blocked")} not on the trusted list.` };
}
