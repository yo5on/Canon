"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl, deliver, WEBHOOK_EVENTS, type Hook } from "@/lib/webhooks";
import { requireWorkspace } from "@/lib/workspace";

export type IntState = { error?: string; ok?: string; token?: string };

async function manager() {
  const ctx = await requireWorkspace();
  return ctx.active.role === "brand_manager" ? ctx : null;
}
const audit = (org: string, actor: string, action: string, detail: object) => createAdminClient().from("audit_log").insert({ org_id: org, actor_id: actor, action, detail });

const hookInput = z.object({
  url: z.url({ protocol: /^https$/, message: "Use a full https:// webhook URL" }).max(500),
  format: z.enum(["json", "slack"]),
});

export async function addWebhook(_prev: IntState, form: FormData): Promise<IntState> {
  const ctx = await manager();
  if (!ctx) return { error: "Only a Brand Manager can add integrations." };
  const parsed = hookInput.safeParse({ url: String(form.get("url") ?? "").trim(), format: form.get("format") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const events = form.getAll("events").map(String).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e) && e !== "ping");
  if (!events.length) return { error: "Choose at least one event." };
  const { error } = await ctx.supabase.from("webhooks").insert({ org_id: ctx.active.orgId, url: parsed.data.url, format: parsed.data.format, events });
  if (error) return { error: "Could not save the webhook. Try again." };
  await audit(ctx.active.orgId, ctx.user.id, "webhook_added", { host: new URL(parsed.data.url).host, events });
  revalidatePath("/integrations");
  return { ok: "Webhook added. Send a test event to confirm it works." };
}

export async function setWebhookActive(form: FormData) {
  const ctx = await manager();
  const id = z.uuid().safeParse(form.get("id"));
  if (!ctx || !id.success) return;
  const active = form.get("active") === "true";
  await ctx.supabase.from("webhooks").update({ active }).eq("id", id.data).eq("org_id", ctx.active.orgId);
  await audit(ctx.active.orgId, ctx.user.id, active ? "webhook_enabled" : "webhook_disabled", { id: id.data });
  revalidatePath("/integrations");
}

export async function testWebhook(_prev: IntState, form: FormData): Promise<IntState> {
  const ctx = await manager();
  const id = z.uuid().safeParse(form.get("id"));
  if (!ctx || !id.success) return { error: "Only a Brand Manager can test integrations." };
  // RLS proves the webhook belongs to this workspace; the secret is read with it.
  const { data: hook } = await ctx.supabase.from("webhooks").select("id, org_id, url, format, secret, events").eq("id", id.data).maybeSingle();
  if (!hook) return { error: "Webhook not found." };
  const row = await deliver(hook as Hook, "ping", { title: `Test event from Canon (${ctx.active.orgName})`, link: `${appUrl()}/integrations` });
  await createAdminClient().from("webhook_deliveries").insert(row);
  revalidatePath("/integrations");
  return row.ok ? { ok: `Delivered: HTTP ${row.status_code} in ${row.duration_ms} ms.` } : { error: `Not delivered: ${row.error}` };
}

export async function createToken(_prev: IntState, form: FormData): Promise<IntState> {
  const ctx = await manager();
  if (!ctx) return { error: "Only a Brand Manager can create API tokens." };
  const name = z.string().trim().min(1, "Name the token, e.g. CMS publish gate").max(80).safeParse(form.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };
  const token = `canon_${randomBytes(24).toString("base64url")}`;
  const { error } = await createAdminClient()
    .from("api_tokens")
    .insert({ org_id: ctx.active.orgId, name: name.data, token_hash: createHash("sha256").update(token).digest("hex"), prefix: token.slice(0, 12), created_by: ctx.user.id });
  if (error) return { error: "Could not create the token. Try again." };
  await audit(ctx.active.orgId, ctx.user.id, "api_token_created", { name: name.data, prefix: token.slice(0, 12) });
  revalidatePath("/integrations");
  return { ok: "Copy this token now. Canon stores only its hash and cannot show it again.", token };
}

export async function revokeToken(form: FormData) {
  const ctx = await manager();
  const id = z.uuid().safeParse(form.get("id"));
  if (!ctx || !id.success) return;
  const { data } = await ctx.supabase.from("api_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id.data).eq("org_id", ctx.active.orgId).is("revoked_at", null).select("prefix").maybeSingle();
  if (data) await audit(ctx.active.orgId, ctx.user.id, "api_token_revoked", { prefix: data.prefix });
  revalidatePath("/integrations");
}
