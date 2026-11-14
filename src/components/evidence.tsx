import type { Evidence } from "@/lib/pipeline";
import { Badge, formatDate, formatDateTime, type Tone } from "./ui";

const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  confirmed: { label: "Source confirms the fact", tone: "ok" },
  not_found: { label: "Source does not state this fact", tone: "amber" },
  changed: { label: "Source changed: no longer confirms", tone: "danger" },
  unavailable: { label: "Source unavailable: not checked", tone: "muted" },
  blocked: { label: "Not retrieved (not a trusted https source)", tone: "muted" },
  mentioned: { label: "Mentioned on a trusted source", tone: "amber" },
};
export const outcomeBadge = (o: string) => OUTCOME[o] ?? { label: o, tone: "muted" as Tone };

type Candidate = { fact_id: string; relation: string; quote: string };

/**
 * Evidence on a claim, in three visibly separate kinds:
 * approved register (our database), retrieved source (fetched by code, with URL and time),
 * and the AI's suggestion (never evidence, shown last and labelled).
 */
export function EvidenceList({ evidence, candidates, compact = false }: { evidence: Evidence[]; candidates?: Candidate[] | null; compact?: boolean }) {
  if (!evidence.length && !candidates?.length) return <p className="text-xs text-muted">No evidence recorded for this claim.</p>;
  return (
    <ul className="space-y-2 text-xs leading-5">
      {evidence.map((e, i) =>
        e.kind === "register" ? (
          <li key={i} className="rounded border border-line px-2.5 py-2">
            <p className="label mb-1">Approved register · retrieved from Canon’s database</p>
            <p>
              <span className="font-mono text-muted">
                {e.fact_code} v{e.fact_version}
              </span>{" "}
              “{e.text}”
            </p>
            {!compact && (
              <p className="mt-1 text-muted">
                Owner {e.owner || "—"} · valid {formatDate(e.valid_from)} → {e.valid_until ? formatDate(e.valid_until) : "open"}
                {e.source_ref && ` · ${e.source_ref}`}
              </p>
            )}
          </li>
        ) : (
          <li key={i} className="rounded border border-line px-2.5 py-2">
            <p className="label mb-1 flex flex-wrap items-center gap-2">
              {e.role === "fact_source" ? "External source of the fact" : "External source · not an approved fact"}
              <Badge tone={outcomeBadge(e.outcome).tone}>{outcomeBadge(e.outcome).label}</Badge>
            </p>
            <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent hover:underline">
              {e.url}
            </a>
            <p className="text-muted">
              Retrieved by Canon {formatDateTime(e.retrieved_at)}
              {e.http_status ? ` · HTTP ${e.http_status}` : ""}
              {e.error ? ` · ${e.error}` : ""}
            </p>
            {e.excerpt && (
              <blockquote className="mt-1 border-l-2 border-line pl-2 text-ink">
                {e.excerpt}
                <span className="block text-[10px] text-faint">Words copied from the retrieved page</span>
              </blockquote>
            )}
          </li>
        ),
      )}
      {!!candidates?.length && !compact && (
        <li className="rounded border border-dashed border-line px-2.5 py-2 text-muted">
          <p className="label mb-1">AI suggestion · not evidence</p>
          {candidates.map((c, i) => (
            <p key={i}>
              The model suggested <span className="font-mono">{c.fact_id}</span> {c.relation.toLowerCase()} this claim
              {c.quote && <> (quoting “{c.quote}”)</>}. Code re-checked this before deciding the status.
            </p>
          ))}
        </li>
      )}
    </ul>
  );
}
