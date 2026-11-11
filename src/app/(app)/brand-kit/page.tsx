import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, formatDate, td, th, type Tone } from "@/components/ui";
import { factState, type FactState } from "@/lib/brandkit";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Brand Kit" };

const FACT_STATE: Record<FactState, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "ok" },
  expiring: { label: "Expires soon", tone: "amber" },
  expired: { label: "Expired", tone: "danger" },
  scheduled: { label: "Not yet valid", tone: "muted" },
  replaced: { label: "Replaced", tone: "muted" },
};

export default async function BrandKit({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === "facts" ? "facts" : "rules";
  const { supabase, active } = await requireWorkspace();
  const isManager = active.role === "brand_manager";
  const today = new Date().toISOString().slice(0, 10);

  // RLS scopes both queries to this workspace and hides confidential facts from Creators.
  const [rules, facts] = await Promise.all([
    supabase
      .from("rules")
      .select("id, code, version, text, category, severity, check_kind, banned_term, replacement, source_ref")
      .eq("org_id", active.orgId)
      .eq("is_current", true)
      .order("code"),
    supabase
      .from("facts")
      .select("id, code, version, text, value, tolerance, valid_from, valid_until, replaced_by, owner, source_ref, confidential")
      .eq("org_id", active.orgId)
      .eq("is_current", true)
      .order("code"),
  ]);
  if (rules.error || facts.error) throw new Error("Could not load the Brand Kit.");

  const states = facts.data.map((f) => factState(f, today));
  const expiring = states.filter((s) => s === "expiring").length;
  const expired = states.filter((s) => s === "expired").length;

  const tabCls = (on: boolean) =>
    `-mb-px border-b-2 px-1 pb-2.5 text-sm ${on ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`;

  return (
    <>
      <PageHeader
        crumb="Brand Kit"
        title="Brand Kit"
        subtitle={`${rules.data.length} rules · ${facts.data.length} approved facts${isManager ? "" : " · read-only for your role"}`}
        actions={
          isManager &&
          (tab === "rules" ? (
            <ButtonLink href="/brand-kit/rules/new" primary>
              + New rule
            </ButtonLink>
          ) : (
            <ButtonLink href="/brand-kit/facts/new" primary>
              + New fact
            </ButtonLink>
          ))
        }
      />

      <nav aria-label="Brand Kit sections" className="mb-5 flex gap-6 border-b border-line">
        <Link href="/brand-kit" aria-current={tab === "rules" ? "page" : undefined} className={tabCls(tab === "rules")}>
          Rules <span className="text-faint">{rules.data.length}</span>
        </Link>
        <Link href="/brand-kit?tab=facts" aria-current={tab === "facts" ? "page" : undefined} className={tabCls(tab === "facts")}>
          Approved facts <span className="text-faint">{facts.data.length}</span>
        </Link>
      </nav>

      {tab === "rules" ? (
        <Card className="overflow-x-auto">
          {rules.data.length === 0 ? (
            <EmptyState
              title="No rules yet"
              body="Rules are what every check cites. Each one has a code, a severity and the exact wording findings must quote."
              action={isManager && <ButtonLink href="/brand-kit/rules/new">Add the first rule</ButtonLink>}
            />
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-line">
                <tr>
                  <th className={th}>ID</th>
                  <th className={th}>Rule</th>
                  <th className={th}>Category</th>
                  <th className={th}>Check</th>
                  <th className={th}>Severity</th>
                  {isManager && <th className={th}><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rules.data.map((r) => (
                  <tr key={r.id} className="hover:bg-raised/40">
                    <td className={`${td} whitespace-nowrap font-mono text-xs`}>
                      {r.code} <span className="text-faint">v{r.version}</span>
                    </td>
                    <td className={td}>
                      {r.text}
                      {r.check_kind === "code" && r.banned_term && (
                        <p className="mt-1 text-xs text-muted">
                          Flags “{r.banned_term}”{r.replacement && <> → “{r.replacement}”</>}
                        </p>
                      )}
                      {r.source_ref && <p className="mt-1 text-xs text-faint">Source: {r.source_ref}</p>}
                    </td>
                    <td className={`${td} capitalize text-muted`}>{r.category}</td>
                    <td className={`${td} text-muted`}>{r.check_kind === "ai" ? "AI" : "Code"}</td>
                    <td className={td}>
                      <Badge tone={r.severity === "blocking" ? "danger" : "muted"}>
                        {r.severity === "blocking" ? "Blocking" : "Advisory"}
                      </Badge>
                    </td>
                    {isManager && (
                      <td className={`${td} text-right`}>
                        <Link href={`/brand-kit/rules/${r.id}`} className="text-xs text-accent hover:underline">
                          Edit
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <>
          {(expiring > 0 || expired > 0) && (
            <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-amber/30 bg-amber/5 px-4 py-3 text-sm">
              <span className="label !text-amber">Fact validity</span>
              {expiring > 0 && <span className="text-amber">● {expiring} expire within 14 days</span>}
              {expired > 0 && <span className="text-danger">● {expired} expired</span>}
            </div>
          )}
          <Card className="overflow-x-auto">
            {facts.data.length === 0 ? (
              <EmptyState
                title="No approved facts yet"
                body="Facts are what claims are checked against: a figure, its owner and how long it stays true."
                action={isManager && <ButtonLink href="/brand-kit/facts/new">Add the first fact</ButtonLink>}
              />
            ) : (
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-line">
                  <tr>
                    <th className={th}>ID</th>
                    <th className={th}>Fact</th>
                    <th className={th}>Owner</th>
                    <th className={th}>Valid</th>
                    <th className={th}>Status</th>
                    {isManager && <th className={th}><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {facts.data.map((f, i) => (
                    <tr key={f.id} className="hover:bg-raised/40">
                      <td className={`${td} whitespace-nowrap font-mono text-xs`}>
                        {f.code} <span className="text-faint">v{f.version}</span>
                      </td>
                      <td className={td}>
                        {f.text}
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                          {f.value !== null && (
                            <span>
                              Value {Number(f.value).toLocaleString("en-GB")}
                              {Number(f.tolerance) > 0 && ` ± ${f.tolerance}`}
                            </span>
                          )}
                          {f.source_ref && <span className="text-faint">Source: {f.source_ref}</span>}
                        </div>
                        {f.confidential && (
                          <div className="mt-1.5">
                            <Badge tone="amber">Confidential · never sent to AI</Badge>
                          </div>
                        )}
                      </td>
                      <td className={`${td} text-muted`}>{f.owner || "—"}</td>
                      <td className={`${td} whitespace-nowrap text-muted`}>
                        {formatDate(f.valid_from)} → {f.valid_until ? formatDate(f.valid_until) : "open"}
                        {f.replaced_by && <p className="text-xs">Replaced by {f.replaced_by}</p>}
                      </td>
                      <td className={td}>
                        <Badge tone={FACT_STATE[states[i]].tone}>{FACT_STATE[states[i]].label}</Badge>
                      </td>
                      {isManager && (
                        <td className={`${td} text-right`}>
                          <Link href={`/brand-kit/facts/${f.id}`} className="text-xs text-accent hover:underline">
                            Edit
                          </Link>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </>
  );
}
