import type { Metadata } from "next";
import Link from "next/link";
import { Badge, CLAIM_STATUS as STATUS, Card, EmptyState, PageHeader, td, th } from "@/components/ui";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Claims Ledger" };

type ClaimRun = { model: string | null; content_versions: { item_id: string; version: number; content_items: { title: string } | null } | null };

export default async function ClaimsLedger() {
  const { supabase, active } = await requireWorkspace();
  const { data, error } = await supabase
    .from("claims")
    .select("id, text, type, status, fact_code, reason, analysis_runs(model, content_versions(item_id, version, content_items(title)))")
    .eq("org_id", active.orgId)
    .not("status", "is", null)
    .limit(200);
  if (error) throw new Error("Could not load the Claims Ledger.");

  const counts = Object.keys(STATUS).map((k) => ({ k, n: data.filter((c) => c.status === k).length }));

  return (
    <>
      <PageHeader
        crumb="Claims"
        title="Claims Ledger"
        subtitle="Recorded claims across draft versions, checked against approved facts. Showing up to 200 records."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {counts.map(({ k, n }) => (
          <Badge key={k} tone={STATUS[k].tone}>
            {STATUS[k].label} · {n}
          </Badge>
        ))}
      </div>
      <Card className="overflow-x-auto">
        {data.length === 0 ? (
          <EmptyState
            title="No claims recorded yet"
            body="Claims appear once content has been checked, with their source fact and classification."
          />
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Claim</th>
                <th className={th}>Draft / provider</th>
                <th className={th}>Type</th>
                <th className={th}>Fact</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((c) => {
                const run = c.analysis_runs as unknown as ClaimRun | null;
                const version = run?.content_versions;
                return (
                <tr key={c.id}>
                  <td className={td}>
                    “{c.text}”{c.reason && <p className="mt-1 text-xs text-muted">{c.reason}</p>}
                  </td>
                  <td className={td}>
                    {version && <><p>{version.content_items?.title ?? "Submission"} · v{version.version}</p><Link href={`/submissions/${version.item_id}`} className="text-xs text-accent hover:underline">Current report</Link></>}
                    {run?.model === "mock" && <p className="mt-1 text-xs text-amber">Demo / mock</p>}
                  </td>
                  <td className={`${td} text-muted`}>{c.type}</td>
                  <td className={`${td} font-mono text-xs`}>{c.fact_code ?? "—"}</td>
                  <td className={td}>
                    <Badge tone={STATUS[c.status]?.tone ?? "muted"}>{STATUS[c.status]?.label ?? c.status}</Badge>
                  </td>
                </tr>
              ); })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
