// Outgoing webhooks (Round 3 · Improvement 3). Canon tells other tools what happened; it never publishes anything.
// "json" payloads are signed with HMAC-SHA256 (header x-canon-signature: sha256=<hex> over the raw body).
// "slack" payloads use the Slack incoming-webhook shape ({ text }), which Slack, Mattermost and Discord's
// /slack endpoint accept. Every attempt is logged in webhook_deliveries. Server-only.
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertFetchable, SourceError } from "./sources";

export const WEBHOOK_EVENTS = ["submitted", "approved", "rejected", "changes_requested", "monitor_alert", "source_changed", "ping"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface EventData {
  title: string; // one line a person can read
  item_id?: string;
  link?: string; // absolute URL into Canon
  [k: string]: unknown;
}

export const sign = (secret: string, body: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

export function payload(format: "json" | "slack", event: WebhookEvent, data: EventData, at = new Date().toISOString()) {
  if (format === "slack") return JSON.stringify({ text: `*Canon* · ${data.title}${data.link ? `\n<${data.link}|Open in Canon>` : ""}` });
  return JSON.stringify({ event, at, data });
}

export interface Hook {
  id: string;
  org_id: string;
  url: string;
  format: "json" | "slack";
  secret: string;
  events: string[];
}

/** Sends one event to one webhook and returns the delivery row (not yet saved). Never throws. */
export async function deliver(hook: Hook, event: WebhookEvent, data: EventData, fetcher: typeof fetch = fetch, resolve?: Parameters<typeof assertFetchable>[2]) {
  const body = payload(hook.format, event, data);
  const started = Date.now();
  const row = { org_id: hook.org_id, webhook_id: hook.id, event, status_code: null as number | null, ok: false, error: null as string | null, duration_ms: 0 };
  try {
    const host = new URL(hook.url).hostname.toLowerCase();
    // Same SSRF guard as source retrieval: https only, public addresses only.
    const url = await assertFetchable(hook.url, [host], resolve);
    const res = await fetcher(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
      headers: { "content-type": "application/json", "user-agent": "Canon-Webhooks/1.0", "x-canon-event": event, "x-canon-signature": sign(hook.secret, body) },
      body,
    });
    row.status_code = res.status;
    row.ok = res.ok;
    if (!res.ok) row.error = `HTTP ${res.status}`;
  } catch (e) {
    row.error = e instanceof SourceError ? e.message : (e as Error)?.name === "TimeoutError" ? "No response within 5 s" : "Network error";
  }
  row.duration_ms = Date.now() - started;
  return row;
}

/** Delivers an event to every active webhook of the workspace subscribed to it, and logs each attempt. */
export async function dispatch(admin: SupabaseClient, orgId: string, event: WebhookEvent, data: EventData) {
  const { data: hooks } = await admin.from("webhooks").select("id, org_id, url, format, secret, events").eq("org_id", orgId).eq("active", true);
  const targets = ((hooks ?? []) as Hook[]).filter((h) => event === "ping" || h.events.includes(event));
  const rows = await Promise.all(targets.map((h) => deliver(h, event, data)));
  if (rows.length) await admin.from("webhook_deliveries").insert(rows);
  return rows;
}

export const appUrl = () =>
  process.env.CANON_APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
