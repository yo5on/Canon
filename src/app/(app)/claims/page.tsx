import type { Metadata } from "next";
import { Badge, CLAIM_STATUS as STATUS, Card, EmptyState, PageHeader, td, th } from "@/components/ui";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Claims Ledger" };


export default async function ClaimsLedger() {
  const { supabase, active } = await requireWorkspace();
  const { data, error } = await supabase
    .from("claims")
    .select("id, text, type, status, fact_code, reason")
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
        subtitle="Every factual claim found in submitted content, checked by code against your approved facts."
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
            body="Claims appear once content has been checked. Each one links to the fact that supports or contradicts it."
          />
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Claim</th>
                <th className={th}>Type</th>
                <th className={th}>Fact</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((c) => (
                <tr key={c.id}>
                  <td className={td}>
                    “{c.text}”{c.reason && <p className="mt-1 text-xs text-muted">{c.reason}</p>}
                  </td>
                  <td className={`${td} text-muted`}>{c.type}</td>
                  <td className={`${td} font-mono text-xs`}>{c.fact_code ?? "—"}</td>
                  <td className={td}>
                    <Badge tone={STATUS[c.status]?.tone ?? "muted"}>{STATUS[c.status]?.label ?? c.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
