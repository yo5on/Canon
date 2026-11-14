import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader, formatDateTime } from "@/components/ui";
import { fieldChanges, textDiff, type Row } from "@/lib/versiondiff";
import { memberNames, requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Version history" };

export default async function History({ params }: { params: Promise<{ kind: string; code: string }> }) {
  const { kind, code: raw } = await params;
  const code = decodeURIComponent(raw).toUpperCase();
  if ((kind !== "rules" && kind !== "facts") || !/^[A-Z]+-[0-9]+$/.test(code)) notFound();
  const { supabase, active } = await requireWorkspace();
  const [{ data, error }, names] = await Promise.all([
    supabase.from(kind).select("*").eq("org_id", active.orgId).eq("code", code).order("version", { ascending: false }),
    memberNames(active.orgId),
  ]);
  if (error) throw new Error("Could not load the history.");
  if (!data?.length) notFound();
  const rows = data as (Row & { id: string; version: number; text: string; is_current: boolean; created_at: string; created_by: string | null })[];

  return (
    <>
      <PageHeader
        icon="history"
        crumb={`Brand Kit / ${kind === "rules" ? "Rules" : "Facts"}`}
        title={`${code} · version history`}
        subtitle="Editing never overwrites: each save adds a version. Audits record which version they applied, so earlier reports stay explainable."
      />
      <ol className="grid gap-4">
        {rows.map((r, i) => {
          const prev = rows[i + 1] ?? null;
          const changes = fieldChanges(prev, r);
          return (
            <li key={r.id}>
              <Card>
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 text-[13px]">
                  <span className="font-mono">v{r.version}</span>
                  {r.is_current && <Badge tone="ok">Current</Badge>}
                  <span className="text-muted">
                    {formatDateTime(r.created_at)} · {r.created_by ? names.get(r.created_by) ?? "Former member" : "Seed data"}
                  </span>
                </div>
                <div className="px-5 py-3 text-sm leading-6">
                  {prev ? (
                    <p>
                      {textDiff(prev.text, r.text).map((p, j) =>
                        p.op === 0 ? (
                          <span key={j}>{p.text}</span>
                        ) : p.op === -1 ? (
                          <del key={j} className="rounded bg-danger/15 px-0.5 text-danger">
                            {p.text}
                          </del>
                        ) : (
                          <ins key={j} className="rounded bg-ok/15 px-0.5 text-ok no-underline">
                            {p.text}
                          </ins>
                        ),
                      )}
                    </p>
                  ) : (
                    <p>{r.text}</p>
                  )}
                  {prev && changes.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-muted">
                      {changes.map((c) => (
                        <li key={c.field}>
                          <span className="font-mono">{c.field}</span>: <del>{c.from}</del> → <span className="text-ink">{c.to}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {prev && changes.length === 0 && prev.text === r.text && <p className="mt-1 text-xs text-muted">No visible change.</p>}
                  {!prev && <p className="mt-1 text-xs text-muted">First version.</p>}
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-sm">
        <Link href={kind === "rules" ? "/brand-kit" : "/brand-kit?tab=facts"} className="text-accent hover:underline">
          Back to Brand Kit
        </Link>
      </p>
    </>
  );
}
