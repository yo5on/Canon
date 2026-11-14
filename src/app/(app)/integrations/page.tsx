import type { Metadata } from "next";
import { Badge, Card, EmptyState, PageHeader, Unauthorized, formatDateTime, td, th } from "@/components/ui";
import { appUrl } from "@/lib/webhooks";
import { requireWorkspace } from "@/lib/workspace";
import { revokeToken, setWebhookActive } from "./actions";
import { AddWebhookForm, CreateTokenForm, TestWebhookButton } from "./forms";

export const metadata: Metadata = { title: "Integrations" };

export default async function Integrations() {
  const { supabase, active } = await requireWorkspace();
  if (active.role !== "brand_manager") return <Unauthorized need="Brand Manager" />;
  const [hooks, deliveries, tokens] = await Promise.all([
    supabase.from("webhooks").select("id, url, format, events, active, secret, created_at").eq("org_id", active.orgId).order("created_at"),
    supabase.from("webhook_deliveries").select("id, webhook_id, event, status_code, ok, error, duration_ms, at").eq("org_id", active.orgId).order("at", { ascending: false }).limit(20),
    supabase.from("api_tokens").select("id, name, prefix, created_at, last_used_at, revoked_at").eq("org_id", active.orgId).order("created_at", { ascending: false }),
  ]);
  if (hooks.error || deliveries.error || tokens.error) throw new Error("Could not load integrations.");
  const base = appUrl();

  return (
    <>
      <PageHeader
        icon="panel"
        crumb="Governance"
        title="Integrations"
        subtitle="Send Canon’s review and monitoring events to your tools, and let publishing systems ask Canon whether content is approved before it goes live. Canon never publishes anything itself."
      />

      <Card>
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-medium">Webhooks · collaboration</h2>
          <p className="mt-0.5 text-xs text-muted">
            “Slack message” posts <code>{"{ text }"}</code> to a Slack (or Mattermost) incoming-webhook URL. “Signed JSON” posts{" "}
            <code>{"{ event, at, data }"}</code> with an <code>x-canon-signature: sha256=…</code> HMAC of the body using the webhook’s secret. Only public https endpoints
            are called. Every attempt is logged below.
          </p>
        </div>
        {hooks.data.length === 0 ? (
          <EmptyState title="No webhooks yet" body="Add a Slack incoming-webhook URL, or a test endpoint such as webhook.site, to receive events." />
        ) : (
          <ul className="divide-y divide-line">
            {hooks.data.map((h) => (
              <li key={h.id} className="flex flex-wrap items-start gap-3 px-5 py-3 text-[13px]">
                <div className="min-w-0 flex-1">
                  <p className="break-all font-mono text-xs">{h.url.replace(/(\/services\/[^/]+\/[^/]+\/).+$/, "$1•••")}</p>
                  <p className="mt-1 text-xs text-muted">
                    {h.format === "slack" ? "Slack message" : "Signed JSON"} · {(h.events as string[]).join(", ")}
                  </p>
                  {h.format === "json" && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-accent">Signing secret</summary>
                      <code className="break-all font-mono">{h.secret}</code>
                    </details>
                  )}
                </div>
                <Badge tone={h.active ? "ok" : "muted"}>{h.active ? "Active" : "Paused"}</Badge>
                <TestWebhookButton id={h.id} />
                <form action={setWebhookActive}>
                  <input type="hidden" name="id" value={h.id} />
                  <input type="hidden" name="active" value={String(!h.active)} />
                  <button className="text-xs text-muted hover:underline">{h.active ? "Pause" : "Resume"}</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line px-5 py-4">
          <AddWebhookForm />
        </div>
      </Card>

      {deliveries.data.length > 0 && (
        <Card className="mt-6 overflow-x-auto">
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="text-sm font-medium">Recent deliveries</h2>
          </div>
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>When</th>
                <th className={th}>Event</th>
                <th className={th}>Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {deliveries.data.map((d) => (
                <tr key={d.id}>
                  <td className={`${td} whitespace-nowrap text-muted`}>{formatDateTime(d.at)}</td>
                  <td className={`${td} font-mono text-xs`}>{d.event}</td>
                  <td className={td}>
                    <Badge tone={d.ok ? "ok" : "danger"}>{d.ok ? `HTTP ${d.status_code}` : d.error ?? "Failed"}</Badge>
                    <span className="ml-2 text-xs text-faint">{d.duration_ms} ms</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="mt-6">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-medium">Publish gate API · publishing</h2>
          <p className="mt-0.5 text-xs text-muted">
            A CMS or deployment pipeline can ask whether an item is approved, at which version, and whether its text is exactly what was approved. Tokens are
            read-only, scoped to this workspace, and stored as hashes.
          </p>
        </div>
        <div className="px-5 py-4 text-xs">
          <pre className="overflow-x-auto rounded bg-secondary p-3 font-mono leading-5">{`curl -H "Authorization: Bearer <token>" \\
  ${base}/api/v1/items/<item-id>/gate

{ "item_id": "…", "status": "approved", "publishable": true,
  "approved_version": 2, "current_version": 2, "body_sha256": "…",
  "open_blocking": 0, "policy_version": 7, "monitoring": { "new_blocking": 0, … } }`}</pre>
          <p className="mt-2 text-muted">
            Send <code>?sha256=&lt;hash of the text you are about to publish&gt;</code> and <code>publishable</code> is only true if it matches the approved version. List
            items with <code>GET /api/v1/items?status=approved</code>.
          </p>
        </div>
        {tokens.data.length > 0 && (
          <ul className="divide-y divide-line border-t border-line">
            {tokens.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-[13px]">
                <span className="font-medium">{t.name}</span>
                <span className="font-mono text-xs text-muted">{t.prefix}…</span>
                <span className="text-xs text-muted">
                  created {formatDateTime(t.created_at)} · {t.last_used_at ? `last used ${formatDateTime(t.last_used_at)}` : "never used"}
                </span>
                {t.revoked_at ? (
                  <Badge tone="muted">Revoked</Badge>
                ) : (
                  <form action={revokeToken} className="ml-auto">
                    <input type="hidden" name="id" value={t.id} />
                    <button className="text-xs text-danger hover:underline">Revoke</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line px-5 py-4">
          <CreateTokenForm />
        </div>
      </Card>
    </>
  );
}
