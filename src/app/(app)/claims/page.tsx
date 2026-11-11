import type { Metadata } from "next";
import Link from "next/link";
import {
  Badge,
  CLAIM_STATUS as STATUS,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  td,
  th,
} from "@/components/ui";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Claims Ledger" };

type Review = {
  version: number;
  decision: string;
  reason: string;
  created_at: string;
};
type ClaimRun = {
  model: string | null;
  content_versions: {
    item_id: string;
    version: number;
    content_items: { title: string; approvals: Review[] } | null;
  } | null;
};
type ClaimFinding = {
  source_text: string | null;
  finding_decisions: { decision: string; reason: string; created_at: string }[];
};

export default async function ClaimsLedger() {
  const { supabase, active } = await requireWorkspace();
  const [claims, facts] = await Promise.all([
    supabase
      .from("claims")
      .select(
        "id, text, type, status, fact_code, reason, findings(source_text, finding_decisions(decision, reason, created_at)), analysis_runs(model, content_versions(item_id, version, content_items(title, approvals(version, decision, reason, created_at))))",
      )
      .eq("org_id", active.orgId)
      .not("status", "is", null)
      .limit(200),
    supabase
      .from("facts")
      .select("code, text")
      .eq("org_id", active.orgId)
      .eq("is_current", true),
  ]);
  if (claims.error || facts.error)
    throw new Error("Could not load the Claims Ledger.");
  const data = claims.data;
  const factByCode = new Map(
    facts.data.map((f) => [f.code as string, f.text as string]),
  );
  const counts = Object.keys(STATUS).map((k) => ({
    k,
    n: data.filter((c) => c.status === k).length,
  }));

  return (
    <>
      <PageHeader
        crumb="Brand knowledge"
        title="Claims Ledger"
        icon="table"
        subtitle="A record of what your content claims, the evidence behind it and the decisions made."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-line pb-4">
        <span className="mr-2 text-xs text-muted">{data.length} records</span>
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
            body="Checked drafts appear here with their evidence, related fact and review decision."
          />
        ) : (
          <table className="w-full min-w-[1060px] table-fixed">
            <thead>
              <tr>
                <th className={`${th} w-[24%]`}>Claim</th>
                <th className={`${th} w-[13%]`}>Status</th>
                <th className={`${th} w-[26%]`}>Supporting evidence</th>
                <th className={`${th} w-[20%]`}>Related brand fact</th>
                <th className={`${th} w-[17%]`}>Review decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((c) => {
                const run = c.analysis_runs as unknown as ClaimRun | null;
                const version = run?.content_versions;
                const finding = c.findings as unknown as ClaimFinding | null;
                const findingDecision = [
                  ...(finding?.finding_decisions ?? []),
                ].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
                const review = version?.content_items?.approvals
                  .filter((r) => r.version === version.version)
                  .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
                return (
                  <tr key={c.id}>
                    <td className={td}>
                      <p className="font-medium">{c.text}</p>
                      <p className="mt-1 text-[11px] capitalize text-muted">
                        {c.type}
                        {run?.model === "mock" && " · Demo / mock"}
                      </p>
                      {version && (
                        <p className="mt-2 text-xs text-muted">
                          {version.content_items?.title ?? "Submission"} · v
                          {version.version}
                          <br />
                          <Link
                            href={`/submissions/${version.item_id}`}
                            className="underline decoration-line underline-offset-4 hover:text-ink"
                          >
                            Current report
                          </Link>
                        </p>
                      )}
                    </td>
                    <td className={td}>
                      <Badge tone={STATUS[c.status]?.tone ?? "muted"}>
                        {STATUS[c.status]?.label ?? c.status}
                      </Badge>
                    </td>
                    <td className={td}>
                      {finding?.source_text && (
                        <p className="mb-2">
                          <q>{finding.source_text}</q>
                        </p>
                      )}
                      <p className="text-xs leading-5 text-muted">{c.reason}</p>
                    </td>
                    <td className={td}>
                      {c.fact_code ? (
                        <>
                          <Link
                            href={`/brand-kit?tab=facts#fact-${encodeURIComponent(c.fact_code)}`}
                            className="font-mono text-xs hover:underline"
                          >
                            {c.fact_code}
                          </Link>
                          <p className="mt-1 text-xs leading-5 text-muted">
                            {factByCode.get(c.fact_code) ??
                              "Fact is not currently available to your role."}
                          </p>
                          <p className="mt-1 text-[10px] text-muted">
                            Current register text
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-muted">
                          No related fact
                        </span>
                      )}
                    </td>
                    <td className={td}>
                      {review ? (
                        <>
                          <StatusBadge status={review.decision} />
                          {review.reason && (
                            <p className="mt-2 text-xs leading-5 text-muted">
                              {review.reason}
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-muted">Not reviewed</span>
                      )}
                      {findingDecision && (
                        <p className="mt-2 text-xs text-muted">
                          Finding {findingDecision.decision}
                          {findingDecision.reason &&
                            ` · ${findingDecision.reason}`}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">
        Showing up to 200 records across draft versions. Evidence reflects the
        recorded analysis; related facts show the current register.
      </p>
    </>
  );
}
