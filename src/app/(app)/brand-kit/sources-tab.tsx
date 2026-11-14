import { Badge, Card, EmptyState, formatDateTime, td, th } from "@/components/ui";
import { outcomeBadge } from "@/components/evidence";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setTrustedSourceActive } from "./source-actions";
import { AddSourceForm, CheckSourcesButton } from "./source-forms";

type Check = { fact_code: string; fact_version: number; url: string; retrieved_at: string; outcome: string; excerpt: string | null; error: string | null; http_status: number | null };

export async function SourcesTab({ supabase, orgId, isManager }: { supabase: SupabaseClient; orgId: string; isManager: boolean }) {
  const [trusted, facts, checks] = await Promise.all([
    supabase.from("trusted_sources").select("id, name, domain, active, created_at").eq("org_id", orgId).order("created_at"),
    supabase.from("facts").select("code, version, text, source_url, source_ref, confidential").eq("org_id", orgId).eq("is_current", true).order("code"),
    supabase.from("source_checks").select("fact_code, fact_version, url, retrieved_at, outcome, excerpt, error, http_status").eq("org_id", orgId).order("retrieved_at", { ascending: false }).limit(200),
  ]);
  if (trusted.error || facts.error || checks.error) throw new Error("Could not load sources.");
  const latest = new Map<string, Check>();
  const history = new Map<string, Check[]>();
  for (const c of checks.data as Check[]) {
    if (!latest.has(c.fact_code)) latest.set(c.fact_code, c);
    history.set(c.fact_code, [...(history.get(c.fact_code) ?? []), c]);
  }

  return (
    <div className="grid gap-6">
      <p className="max-w-3xl text-[13px] leading-6 text-muted">
        Canon retrieves each fact’s cited web page from a domain on this list and code checks whether the page still states the fact. A page that
        confirmed a fact and later stops stating it makes claims citing that fact <b>Outdated</b>. A page Canon could not reach changes nothing and is
        reported as “not checked”. A retrieved page is evidence for a reviewer; it never approves a claim by itself.
      </p>

      <Card>
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-medium">Trusted sources</h2>
          <p className="mt-0.5 text-xs text-muted">Only https pages on these domains (and their subdomains) are retrieved. Private network addresses are always refused.</p>
        </div>
        {trusted.data.length === 0 ? (
          <EmptyState title="No trusted sources yet" body="Add the domains your facts are published on, such as your investor-relations site or a government statistics portal." />
        ) : (
          <ul className="divide-y divide-line">
            {trusted.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-[13px]">
                <span className="font-medium">{t.name}</span>
                <span className="font-mono text-xs text-muted">{t.domain}</span>
                <Badge tone={t.active ? "ok" : "muted"}>{t.active ? "Trusted" : "Disabled"}</Badge>
                {isManager && (
                  <form action={setTrustedSourceActive} className="ml-auto">
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="active" value={String(!t.active)} />
                    <button className="text-xs text-accent hover:underline">{t.active ? "Disable" : "Enable"}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {isManager && (
          <div className="border-t border-line px-5 py-4">
            <AddSourceForm />
          </div>
        )}
      </Card>

      <Card className="overflow-x-auto">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-sm font-medium">Fact sources</h2>
            <p className="mt-0.5 text-xs text-muted">Latest retrieval per fact. Each check is stored with its URL, time, HTTP status and the words found.</p>
          </div>
          {isManager && <CheckSourcesButton label="Check all sources now" />}
        </div>
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-line">
            <tr>
              <th className={th}>Fact</th>
              <th className={th}>Source</th>
              <th className={th}>Latest retrieval</th>
              {isManager && <th className={th}><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {facts.data.map((f) => {
              const c = latest.get(f.code);
              const stale = c && c.fact_version !== f.version;
              return (
                <tr key={f.code}>
                  <td className={`${td} w-[32%]`}>
                    <span className="font-mono text-xs text-muted">
                      {f.code} v{f.version}
                    </span>
                    <p>{f.text}</p>
                  </td>
                  <td className={`${td} w-[24%] break-all text-xs`}>
                    {f.confidential ? (
                      <span className="text-muted">Confidential · never retrieved</span>
                    ) : f.source_url ? (
                      <a href={f.source_url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">
                        {f.source_url}
                      </a>
                    ) : (
                      <span className="text-muted">No source URL{f.source_ref ? ` · cites “${f.source_ref}”` : ""}</span>
                    )}
                  </td>
                  <td className={`${td} text-xs`}>
                    {c ? (
                      <>
                        <Badge tone={outcomeBadge(c.outcome).tone}>{outcomeBadge(c.outcome).label}</Badge>
                        <p className="mt-1 text-muted">
                          {formatDateTime(c.retrieved_at)}
                          {c.http_status ? ` · HTTP ${c.http_status}` : ""}
                          {stale && ` · checked v${c.fact_version}, re-check for v${f.version}`}
                        </p>
                        {c.excerpt && <blockquote className="mt-1 border-l-2 border-line pl-2">{c.excerpt}</blockquote>}
                        {c.error && <p className="mt-1 text-muted">{c.error}</p>}
                        {(history.get(f.code)?.length ?? 0) > 1 && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-accent">History ({history.get(f.code)!.length})</summary>
                            <ul className="mt-1 space-y-0.5 text-muted">
                              {history.get(f.code)!.slice(1, 10).map((h, i) => (
                                <li key={i}>
                                  {formatDateTime(h.retrieved_at)} · v{h.fact_version} · {outcomeBadge(h.outcome).label}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </>
                    ) : (
                      <span className="text-muted">{f.source_url ? "Not retrieved yet" : "—"}</span>
                    )}
                  </td>
                  {isManager && <td className={`${td} text-right`}>{f.source_url && !f.confidential && <CheckSourcesButton code={f.code} label="Check now" />}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
