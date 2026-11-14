import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, formatDateTime, td, th } from "@/components/ui";
import { memberNames, requireWorkspace } from "@/lib/workspace";
import { MonitorForm } from "./monitor-form";

export const metadata: Metadata = { title: "Governance" };

type Decision = { decision: string; reason: string; findings: { source_code: string | null } | null };

export default async function Governance() {
  const { supabase, active } = await requireWorkspace();
  const isManager = active.role === "brand_manager";
  const [policies, monitorLog, decisions, alerts, names] = await Promise.all([
    supabase.from("policy_versions").select("version, rules, facts, note, created_by, created_at").eq("org_id", active.orgId).order("version", { ascending: false }).limit(30),
    supabase.from("audit_log").select("detail, at, actor_id").eq("org_id", active.orgId).eq("action", "monitoring_completed").order("at", { ascending: false }).limit(5),
    supabase
      .from("finding_decisions")
      .select("decision, reason, findings(source_code)")
      .eq("org_id", active.orgId)
      .in("decision", ["rejected", "overridden"])
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("audit_log").select("item_id, detail, at, content_items(title)").eq("org_id", active.orgId).eq("action", "monitor_alert").order("at", { ascending: false }).limit(10),
    memberNames(active.orgId),
  ]);
  if (policies.error || monitorLog.error || decisions.error || alerts.error) throw new Error("Could not load governance data.");

  // Guideline Gap Radar: rules whose findings people most often reject or override, with their stated reasons.
  const radar = new Map<string, { rejected: number; overridden: number; reasons: string[] }>();
  for (const d of decisions.data as unknown as Decision[]) {
    const code = d.findings?.source_code;
    if (!code) continue;
    const r = radar.get(code) ?? { rejected: 0, overridden: 0, reasons: [] };
    if (d.decision === "rejected") r.rejected++;
    else r.overridden++;
    if (d.reason && r.reasons.length < 3) r.reasons.push(d.reason);
    radar.set(code, r);
  }
  const gaps = [...radar.entries()].sort((a, b) => b[1].rejected + b[1].overridden - (a[1].rejected + a[1].overridden)).slice(0, 10);

  return (
    <>
      <PageHeader icon="history" crumb="Governance" title="Governance" subtitle="Policy versions, continuous monitoring of approved content, and where the guidelines cause friction." />

      <section className="document-section">
        <h2 className="mb-1 text-sm font-medium">Continuous monitoring</h2>
        <p className="mb-3 max-w-3xl text-xs leading-5 text-muted">
          Approved and in-review content is re-checked when a rule or fact it relied on gets a new version, a cited fact expires, or a fact’s source stops
          confirming it. New blocking issues notify the author and Brand Managers in their inbox and through webhooks. Monitoring never changes an approval.
          It also runs daily when the deployment’s scheduled job is configured.
        </p>
        {isManager ? <MonitorForm /> : <p className="text-xs text-muted">A Brand Manager can run monitoring on demand.</p>}
        {monitorLog.data.length > 0 && (
          <ul className="mt-4 space-y-1 text-xs text-muted">
            {monitorLog.data.map((m, i) => {
              const d = m.detail as { policy_version: number; checked: number; rechecked: number; alerts: number };
              return (
                <li key={i}>
                  {formatDateTime(m.at)} · {m.actor_id ? names.get(m.actor_id) ?? "Member" : "Scheduled job"} · policy v{d.policy_version} · {d.checked} looked at,{" "}
                  {d.rechecked} re-checked, {d.alerts} alert{d.alerts === 1 ? "" : "s"}
                </li>
              );
            })}
          </ul>
        )}
        {alerts.data.length > 0 && (
          <div className="mt-4">
            <p className="label mb-1">Recent alerts</p>
            <ul className="space-y-1 text-xs">
              {alerts.data.map((a, i) => (
                <li key={i}>
                  <Link href={`/submissions/${a.item_id}`} className="font-medium hover:underline">
                    {(a.content_items as unknown as { title: string } | null)?.title ?? "Item"}
                  </Link>{" "}
                  <span className="text-muted">
                    · {formatDateTime(a.at)} · {(a.detail as { summary?: string }).summary}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Card className="mt-6 overflow-x-auto">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-medium">Policy versions</h2>
          <p className="mt-0.5 text-xs text-muted">A policy version is the exact set of rule and fact versions in force. Every check records the one it applied.</p>
        </div>
        {policies.data.length === 0 ? (
          <EmptyState title="No policy versions yet" body="The first one is recorded when the Brand Kit changes or a check runs." />
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Version</th>
                <th className={th}>Recorded</th>
                <th className={th}>Change</th>
                <th className={th}>Contents</th>
                <th className={th}>
                  <span className="sr-only">Compare</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {policies.data.map((p, i) => (
                <tr key={p.version}>
                  <td className={`${td} whitespace-nowrap font-mono`}>
                    v{p.version} {i === 0 && <Badge tone="ok">Current</Badge>}
                  </td>
                  <td className={`${td} text-muted`}>
                    {formatDateTime(p.created_at)}
                    <br />
                    {p.created_by ? names.get(p.created_by) ?? "Member" : "System"}
                  </td>
                  <td className={td}>{p.note || <span className="text-muted">Recorded at check time</span>}</td>
                  <td className={`${td} whitespace-nowrap text-muted`}>
                    {(p.rules as unknown[]).length} rules · {(p.facts as unknown[]).length} facts
                  </td>
                  <td className={`${td} text-right`}>
                    <Link href={`/governance/policy/${p.version}`} className="whitespace-nowrap text-xs text-accent hover:underline">
                      {p.version > 1 ? `Compare with v${p.version - 1}` : "View"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="mt-6 overflow-x-auto">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-medium">Guideline Gap Radar</h2>
          <p className="mt-0.5 text-xs text-muted">
            Rules whose findings are most often rejected by creators or overridden by reviewers, with their reasons. Frequent friction suggests unclear wording.
          </p>
        </div>
        {gaps.length === 0 ? (
          <EmptyState title="No friction recorded yet" body="When creators reject a suggested fix or reviewers override a blocking issue, the reason is counted here against the rule or fact." />
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Rule or fact</th>
                <th className={th}>Fixes rejected</th>
                <th className={th}>Overridden</th>
                <th className={th}>Recent reasons</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {gaps.map(([code, g]) => (
                <tr key={code}>
                  <td className={`${td} font-mono text-xs`}>
                    <Link href={`/brand-kit/history/${code.startsWith("FACT-") ? "facts" : "rules"}/${code}`} className="hover:underline">
                      {code}
                    </Link>
                  </td>
                  <td className={td}>{g.rejected}</td>
                  <td className={td}>{g.overridden}</td>
                  <td className={`${td} text-xs text-muted`}>{g.reasons.map((r) => `“${r}”`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
