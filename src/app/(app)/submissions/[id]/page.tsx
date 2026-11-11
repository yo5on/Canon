import type { Metadata } from "next";
import { Icon } from "@/components/icon";
import { notFound } from "next/navigation";
import { Badge, CLAIM_STATUS, Card, EmptyState, PageHeader, StatusBadge, formatDate, formatDateTime, td, th, type Tone } from "@/components/ui";
import { memberNames, requireWorkspace } from "@/lib/workspace";
import { ReviewForm } from "./review-form";
import { RunChecks } from "./run-checks";
import { ReviseForm } from "./revise-form";

export const metadata: Metadata = { title: "Audit report" };

interface Finding {
  id: string;
  origin: "code" | "ai";
  source_code: string | null;
  source_version: number | null;
  source_text: string | null;
  source_quote: string | null;
  draft_quote: string;
  draft_start: number | null;
  draft_end: number | null;
  category: string;
  severity: "blocking" | "advisory";
  verified: boolean;
  failed_checks: string[];
  explanation: string;
  fix_replace: string | null;
  fix_with: string | null;
  confidence: number | null;
}

// The verifier's four checks (src/lib/verifier.ts), in plain words.
const CHECKS: { key: string; ok: string; bad: string }[] = [
  { key: "id_current", ok: "Cites a current rule or fact that was sent with this check", bad: "Cited ID is not a current rule or fact that was sent" },
  { key: "quote_in_source", ok: "Quoted words appear exactly in that source", bad: "Quoted words are not in the source, or are too short to check" },
  { key: "words_in_draft", ok: "Flagged words appear exactly in this draft version", bad: "Flagged words are not in this draft version" },
  { key: "type_fits", ok: "Finding type matches the source's category", bad: "Finding type doesn't match the source's category" },
];

const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  done: { label: "AI checks ran", tone: "ok" },
  ai_skipped: { label: "AI checks skipped", tone: "amber" },
  ai_failed: { label: "AI checks failed", tone: "danger" },
  running: { label: "Running", tone: "accent" },
};

function kind(f: Finding): { label: string; tone: Tone } {
  if (!f.verified) return { label: "Needs human judgement", tone: "muted" };
  return f.severity === "blocking" ? { label: "Blocking", tone: "danger" } : { label: "Advisory", tone: "amber" };
}

const MARK: Record<string, string> = {
  Blocking: "bg-danger/20 decoration-danger",
  Advisory: "bg-amber/15 decoration-amber",
  "Needs human judgement": "bg-raised decoration-faint",
};

/** The draft with each located finding underlined and numbered. Overlapping spans keep the first one. */
function Draft({ body, findings }: { body: string; findings: Finding[] }) {
  const spans = findings
    .map((f, i) => ({ f, n: i + 1 }))
    .filter(({ f }) => f.draft_start !== null && f.draft_end !== null)
    .sort((a, b) => a.f.draft_start! - b.f.draft_start!);
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const { f, n } of spans) {
    if (f.draft_start! < at) continue;
    parts.push(body.slice(at, f.draft_start!));
    parts.push(
      <a key={f.id} href={`#f-${n}`} className={`rounded-sm underline decoration-2 underline-offset-4 ${MARK[kind(f).label]}`}>
        {body.slice(f.draft_start!, f.draft_end!)}
        <sup className="ml-0.5 font-mono text-[10px] text-muted">{n}</sup>
      </a>,
    );
    at = f.draft_end!;
  }
  parts.push(body.slice(at));
  return <div className="whitespace-pre-wrap px-5 py-4 text-sm leading-7">{parts}</div>;
}

type Decision = { finding_id: string; decision: string; reason: string; decided_by: string; created_at: string };
type Perms = { itemId: string; author: boolean; reviewer: boolean; editable: boolean; inReview: boolean; names: Map<string, string> };

type FactInfo = { owner: string; valid_from: string | null; valid_until: string | null; replaced_by: string | null };

function FindingCard({ f, n, fact, claimReason, decisions, p }: { f: Finding; n: number; fact?: FactInfo; claimReason?: string; decisions: Decision[]; p: Perms }) {
  const overridden = decisions.some((d) => d.decision === "overridden");
  const k = kind(f);
  const isFact = f.source_code?.startsWith("FACT-");
  return (
    <li id={`f-${n}`} className="scroll-mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted">Issue {String(n).padStart(2, "0")}</span>
        <Badge tone={k.tone}>{k.label}</Badge>
        <span className="text-[11px] capitalize text-muted">{f.category}</span>
        <span className="text-xs text-faint">
          {f.origin === "code" ? "code check" : `AI${f.confidence !== null ? ` · confidence ${f.confidence.toFixed(2)}` : ""}`}
        </span>
      </div>

      <p className="mt-3 text-[14px] font-medium leading-6">{f.explanation}</p>
      <p className="mt-1 text-sm text-muted">
        Flagged text: <q className="text-ink">{f.draft_quote}</q>
      </p>

      <div className="evidence-quote mt-4 text-[13px] leading-6">
        {f.source_text ? (
          <>
            <p>
              <span className="font-mono text-xs text-muted">
                {f.source_code} v{f.source_version}
              </span>{" "}
              “{f.source_text}”
            </p>
            {fact && (
              <p className="mt-1 text-xs text-muted">
                Owner: {fact.owner || "—"} · valid {fact.valid_from ? formatDate(fact.valid_from) : "—"} → {fact.valid_until ? formatDate(fact.valid_until) : "open"}
                {fact.replaced_by && ` · replaced by ${fact.replaced_by}`}
              </p>
            )}
            <p className={`mt-1 text-xs ${f.verified ? "text-ok" : "text-muted"}`}>
              {f.verified ? `✓ ${isFact ? "fact" : "rule"} text from Canon’s database; quotes verified by code` : "✗ citation not verified — this does not block"}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted">
            {f.source_code ? (
              <>
                The AI cited <span className="font-mono">{f.source_code}</span>, which is not a current rule or fact sent with this check.
              </>
            ) : (
              "No rule or fact in the Brand Kit could be cited for this. A reviewer decides."
            )}
          </p>
        )}
      </div>

      {f.fix_replace && f.fix_with !== null && (
        <p className="mt-3 text-sm">
          <span className="label mr-2">Suggested fix</span>
          <del className="rounded bg-danger/15 px-1 text-danger">{f.fix_replace}</del> → <ins className="rounded bg-ok/15 px-1 text-ok no-underline">{f.fix_with}</ins>
        </p>
      )}

      {decisions.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-muted">
          {decisions.map((d, i) => (
            <li key={i}>
              <Badge tone={d.decision === "overridden" ? "accent" : d.decision === "accepted" ? "ok" : "muted"}>{d.decision}</Badge> by {p.names.get(d.decided_by) ?? "—"} ·{" "}
              {formatDateTime(d.created_at)}
              {d.reason && <> · “{d.reason}”</>}
            </li>
          ))}
        </ul>
      )}
      {p.author && p.editable && decisions.length === 0 && (
        <div className="mt-3">
          <ReviewForm
            fields={{ kind: "finding", item: p.itemId, finding: f.id }}
            reason="Reason (needed to reject)"
            choices={[
              { value: "accepted", label: "Accept finding", tone: "ok" },
              { value: "rejected", label: "Reject finding", tone: "plain" },
            ]}
          />
        </div>
      )}
      {p.reviewer && p.inReview && f.verified && f.severity === "blocking" && !overridden && (
        <div className="mt-3">
          <ReviewForm fields={{ kind: "finding", item: p.itemId, finding: f.id }} reason="Override reason (required)" choices={[{ value: "overridden", label: "Override (resolve)", tone: "danger" }]} />
        </div>
      )}

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-accent hover:underline">Why was this raised?</summary>
        <div className="mt-2 space-y-2 rounded-lg border border-line px-3 py-2 text-muted">
          {f.origin === "code" ? (
            <p>Found by an exact, case-insensitive match of the rule’s banned term. No AI was involved, so it is verified by construction.</p>
          ) : (
            <>
              {claimReason && <p>Claims Ledger (decided by code, not the model): {claimReason}</p>}
              {f.source_quote && f.source_quote !== f.source_text && (
                <p>
                  The AI quoted the source as <q className="text-ink">{f.source_quote}</q>.
                </p>
              )}
              <ul className="space-y-1">
                {CHECKS.map((c) => {
                  const bad = f.failed_checks.includes(c.key);
                  return (
                    <li key={c.key} className={bad ? "text-danger" : "text-ok"}>
                      {bad ? "✗" : "✓"} {bad ? c.bad : c.ok}
                      {c.key === "words_in_draft" && !bad && f.draft_start !== null && (
                        <span className="text-faint">
                          {" "}
                          (characters {f.draft_start}–{f.draft_end})
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="text-faint">Code proves the citation is real, not that the rule applies. That is the reviewer’s call.</p>
            </>
          )}
        </div>
      </details>
    </li>
  );
}

export default async function ItemReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, active } = await requireWorkspace();

  const { data: item } = await supabase
    .from("content_items")
    .select("id, org_id, title, channel, audience, goal, publish_date, status, current_version, author_id, reviewer_id")
    .eq("id", id)
    .eq("org_id", active.orgId)
    .maybeSingle();
  if (!item) notFound();

  const { data: version } = await supabase
    .from("content_versions")
    .select("id, body")
    .eq("item_id", id)
    .eq("version", item.current_version)
    .single();
  if (!version) notFound();

  const [runResult, names, reviews] = await Promise.all([
    supabase
      .from("analysis_runs")
      .select("id, status, model, prompt_version, ai_note, duration_ms, created_at")
      .eq("version_id", version.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    memberNames(active.orgId),
    supabase.from("approvals").select("id, version, approver_id, decision, reason, created_at").eq("item_id", id).order("created_at", { ascending: false }).limit(10),
  ]);
  if (runResult.error || reviews.error) throw new Error("Could not load the audit report.");
  const run = runResult.data;

  const [{ data: findingData, error: findingError }, { data: claimData, error: claimError }] = run
    ? await Promise.all([
        supabase.from("findings").select("*").eq("run_id", run.id),
        supabase.from("claims").select("id, text, type, status, fact_code, reason, finding_id").eq("run_id", run.id),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (findingError || claimError) throw new Error("Could not load findings and claims.");

  // Blocking first, then advisory, then needs-judgement; draft order within each.
  const rank = (f: Finding) => (!f.verified ? 2 : f.severity === "blocking" ? 0 : 1);
  const findings = ((findingData ?? []) as Finding[]).sort((a, b) => rank(a) - rank(b) || (a.draft_start ?? 1e9) - (b.draft_start ?? 1e9));
  const claims = claimData ?? [];
  const { data: decisionData, error: decisionError } = findings.length
    ? await supabase.from("finding_decisions").select("finding_id, decision, reason, decided_by, created_at").in("finding_id", findings.map((f) => f.id)).order("created_at")
    : { data: [], error: null };
  if (decisionError) throw new Error("Could not load finding decisions.");
  const decisionsFor = (fid: string) => ((decisionData ?? []) as Decision[]).filter((d) => d.finding_id === fid);
  const claimFor = new Map(claims.filter((c) => c.finding_id).map((c) => [c.finding_id as string, c.reason as string]));

  // Owner and validity of cited facts. RLS keeps confidential facts hidden from Creators.
  const factCodes = [...new Set(findings.map((f) => f.source_code).filter((c): c is string => !!c?.startsWith("FACT-")))];
  const { data: factData, error: factError } = factCodes.length
    ? await supabase.from("facts").select("code, owner, valid_from, valid_until, replaced_by").eq("org_id", item.org_id).eq("is_current", true).in("code", factCodes)
    : { data: [], error: null };
  if (factError) throw new Error("Could not load cited facts.");
  const facts = new Map((factData ?? []).map((f) => [f.code as string, f as FactInfo]));

  const blocking = findings.filter((f) => f.verified && f.severity === "blocking" && !decisionsFor(f.id).some((d) => d.decision === "overridden")).length;
  const advisory = findings.filter((f) => f.verified && f.severity === "advisory").length;
  const judgement = findings.filter((f) => !f.verified).length;
  const ai = findings.filter((f) => f.origin === "ai");
  const canRun = ["draft", "changes_requested"].includes(item.status);
  const rs = run?.model === "mock" && run.status === "done" ? { label: "Demo checks complete", tone: "amber" as Tone } : run ? RUN_STATUS[run.status] : null;
  const isAuthor = item.author_id === user.id;
  // UI hint only: decide_finding / decide_item and the approvals trigger enforce the same rules in Postgres.
  const perms: Perms = {
    itemId: item.id,
    author: isAuthor,
    reviewer: !isAuthor && active.role !== "creator",
    editable: canRun,
    inReview: item.status === "in_review",
    names,
  };

  return (
    <>
      <PageHeader
        crumb="Content / Submissions"
        title={item.title}
        subtitle={
          <>
            v{item.current_version} · {item.channel}
            {item.audience && ` · ${item.audience}`} · publishes {formatDate(item.publish_date)} · reviewer{" "}
            {item.reviewer_id ? names.get(item.reviewer_id) ?? "—" : "not chosen"} · by {names.get(item.author_id) ?? "—"}
          </>
        }
        actions={
          <div className="flex flex-wrap items-start gap-2">
            <div className="pt-2">
              <StatusBadge status={item.status} />
            </div>
            {canRun && <RunChecks itemId={item.id} label={run ? "Run checks again" : "Run checks"} />}
            {canRun && isAuthor && run && run.status !== "running" && (
              <ReviewForm fields={{ kind: "submit", item: item.id }} choices={[{ value: "submit", label: "Submit for review", tone: "ok" }]} />
            )}
          </div>
        }
      />

      {item.goal && (
        <p className="-mt-3 mb-5 text-sm text-muted">
          <span className="label mr-2">Goal</span>
          {item.goal}
        </p>
      )}

      {run && rs && (
        <section className="mb-5 rounded bg-secondary px-4 py-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="label">Audit report · v{item.current_version}</span>
            <span className="text-muted">Code checks ran</span>
            <Badge tone={rs.tone}>{rs.label}</Badge>
            {run.status === "done" && (
              <span className="text-muted">
                {run.model === "mock" ? "DEMO/MOCK provider (no AI call)" : run.model} · prompt {run.prompt_version} · {ai.filter((f) => f.verified).length} of {ai.length} AI findings verified
              </span>
            )}
            {run.duration_ms !== null && <span className="text-faint">{(run.duration_ms / 1000).toFixed(1)} s</span>}
            <span className="text-faint">{formatDateTime(run.created_at)}</span>
          </div>
          {run.model === "mock" && (
            <p className="mt-2 rounded-md border border-amber/30 bg-amber/10 px-2 py-1 text-xs text-amber">
              DEMO / MOCK MODE: only recognised sample phrases are checked; other wording needs manual review. No AI model was called. Evidence verification and ledger classification run against your Brand Kit.
            </p>
          )}
          {run.ai_note && <p className="mt-2 text-xs text-muted">{run.ai_note} Tone, messaging and claim checks did not run; a reviewer should check them by hand.</p>}
        </section>
      )}

      {run && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Badge tone={blocking ? "danger" : "muted"}>Open blocking · {blocking}</Badge>
          <Badge tone="amber">Advisory · {advisory}</Badge>
          <Badge tone="muted">Needs human judgement · {judgement}</Badge>
          <Badge tone="accent">Claims · {claims.filter((c) => c.status).length}</Badge>
        </div>
      )}

      <div className="report-layout document-section">
        <section className="report-draft-column">
          <div className="document-title">
            <Icon name="file" size={18} /><h2 className="text-sm font-medium">Submitted content · v{item.current_version}</h2>
          </div>
          <div className="report-draft">
            <Draft body={version.body} findings={findings} />
            {isAuthor && canRun && <ReviseForm key={version.id} itemId={item.id} body={version.body} />}
          </div>
        </section>

        <section className="min-w-0">
          <div className="document-title">
            <Icon name="check" size={18} /><h2 className="text-sm font-medium">Detected issues</h2><span className="text-xs font-normal text-muted">{findings.length}</span>
          </div>
          {!run ? (
            <EmptyState
              title="No checks yet"
              body={canRun ? "Run checks to get code and AI findings for this version." : "Checks can only run while the item is a draft or has changes requested."}
            />
          ) : findings.length === 0 ? (
            <EmptyState title="No findings recorded" body={run?.model === "mock" ? "No matching demo findings or code violations. This is not a full AI review; check other wording manually." : "The completed checks reported no findings. Claims, if any, are listed below."} />
          ) : (
            <ol className="report-findings">
              {findings.map((f, i) => (
                <FindingCard
                  key={f.id}
                  f={f}
                  n={i + 1}
                  fact={f.source_code ? facts.get(f.source_code) : undefined}
                  claimReason={claimFor.get(f.id)}
                  decisions={decisionsFor(f.id)}
                  p={perms}
                />
              ))}
            </ol>
          )}
        </section>
      </div>

      {claims.length > 0 && (
        <Card className="mt-6 overflow-x-auto">
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="text-sm font-medium">Claims in this draft</h2>
            <p className="mt-0.5 text-xs text-muted">
              Checked by code against approved facts valid on {formatDate(item.publish_date)}. “Supported” means it matches the approved register.
            </p>
          </div>
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
              {claims.map((c) => (
                <tr key={c.id}>
                  <td className={td}>
                    “{c.text}”<p className="mt-1 text-xs text-muted">{c.reason}</p>
                  </td>
                  <td className={`${td} text-muted`}>{c.type}</td>
                  <td className={`${td} font-mono text-xs`}>{c.fact_code ?? "—"}</td>
                  <td className={td}>
                    {c.status ? <Badge tone={CLAIM_STATUS[c.status]?.tone ?? "muted"}>{CLAIM_STATUS[c.status]?.label ?? c.status}</Badge> : <span className="text-xs text-faint">Opinion · not ledgered</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {perms.reviewer && perms.inReview && (
        <section className="document-section">
          <h2 className="mb-2 text-sm font-medium">Reviewer decision</h2>
          <p className="mb-3 text-xs text-muted">Approval is blocked while verified blocking findings remain; override them above with a reason, or request changes.</p>
          <ReviewForm
            fields={{ kind: "item", item: item.id }}
            reason="Reason (required unless approving)"
            choices={[
              { value: "approved", label: "Approve", tone: "ok" },
              { value: "changes_requested", label: "Request changes", tone: "plain" },
              { value: "rejected", label: "Reject", tone: "danger" },
            ]}
          />
        </section>
      )}
      {isAuthor && perms.inReview && <p className="mb-4 text-xs text-muted">Waiting for a Reviewer. You can’t approve your own submission.</p>}

      {reviews.data.length > 0 && (
        <section className="document-section">
          <h2 className="mb-3 text-sm font-medium">Review history</h2>
          <ul className="space-y-3">
            {reviews.data.map((review) => (
              <li key={review.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={review.decision} />
                  <span className="text-xs text-muted">v{review.version} · {names.get(review.approver_id) ?? "Reviewer"} · {formatDateTime(review.created_at)}</span>
                </div>
                {review.reason && <p className="mt-1 text-sm">{review.reason}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

    </>
  );
}
