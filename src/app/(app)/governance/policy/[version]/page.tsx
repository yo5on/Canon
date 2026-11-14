import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader, formatDateTime } from "@/components/ui";
import { policyDiff, type Policy } from "@/lib/monitor";
import { textDiff, type Part } from "@/lib/versiondiff";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Policy version" };

type Ref = { code: string; version: number; id: string };

function Diff({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((p, j) =>
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
    </>
  );
}

export default async function PolicyVersion({ params, searchParams }: { params: Promise<{ version: string }>; searchParams: Promise<{ with?: string }> }) {
  const v = Number((await params).version);
  if (!Number.isInteger(v) || v < 1) notFound();
  const other = Number((await searchParams).with ?? v - 1);
  const { supabase, active } = await requireWorkspace();
  const { data: pv } = await supabase.from("policy_versions").select("version, rules, facts, note, created_at").eq("org_id", active.orgId).in("version", [v, other]);
  const cur = pv?.find((p) => p.version === v);
  if (!cur) notFound();
  const base = pv?.find((p) => p.version === other) ?? null;
  const d = policyDiff(base as Policy | null, cur as Policy);

  // Text of every rule/fact version involved, so changes are shown word for word. RLS hides confidential facts from Creators.
  const refs = [...(cur.rules as Ref[]), ...(cur.facts as Ref[]), ...((base?.rules ?? []) as Ref[]), ...((base?.facts ?? []) as Ref[])];
  const ids = [...new Set(refs.map((r) => r.id))];
  const [rules, facts] = await Promise.all([supabase.from("rules").select("id, text").in("id", ids), supabase.from("facts").select("id, text").in("id", ids)]);
  const text = new Map([...(rules.data ?? []), ...(facts.data ?? [])].map((r) => [r.id as string, r.text as string]));
  const find = (list: unknown, code: string) => (list as Ref[] | undefined)?.find((r) => r.code === code);

  const section = (kind: "rules" | "facts") => {
    const x = d[kind];
    const now = cur[kind] as Ref[];
    return (
      <Card className="mb-4">
        <div className="border-b border-line px-5 py-3 text-sm font-medium">
          {kind === "rules" ? "Rules" : "Facts"} · {now.length}
          {base && (
            <span className="ml-2 text-xs font-normal text-muted">
              {x.added.length} added · {x.changed.length} changed · {x.removed.length} removed
            </span>
          )}
        </div>
        <ul className="divide-y divide-line text-sm">
          {now.map((r) => {
            const old = find(base?.[kind], r.code);
            const state = !base ? "same" : !old ? "added" : old.version !== r.version ? "changed" : "same";
            return (
              <li key={r.code} className="px-5 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/brand-kit/history/${kind}/${r.code}`} className="font-mono text-xs hover:underline">
                    {r.code} v{r.version}
                  </Link>
                  {state === "added" && <Badge tone="ok">Added</Badge>}
                  {state === "changed" && <Badge tone="amber">Changed from v{old!.version}</Badge>}
                </div>
                <p className="mt-1 leading-6">
                  {state === "changed" ? (
                    <Diff parts={textDiff(text.get(old!.id) ?? "", text.get(r.id) ?? "")} />
                  ) : (
                    text.get(r.id) ?? <span className="text-xs text-muted">Not visible to your role</span>
                  )}
                </p>
              </li>
            );
          })}
          {x.removed.map((code) => (
            <li key={code} className="px-5 py-2.5">
              <span className="font-mono text-xs">{code}</span> <Badge tone="danger">Removed</Badge>
              <p className="mt-1 text-muted line-through">{text.get(find(base?.[kind], code)?.id ?? "") ?? ""}</p>
            </li>
          ))}
        </ul>
      </Card>
    );
  };

  return (
    <>
      <PageHeader
        icon="history"
        crumb="Governance / Policy versions"
        title={`Policy v${v}`}
        subtitle={
          <>
            Recorded {formatDateTime(cur.created_at)}
            {cur.note && ` · ${cur.note}`} · {base ? `compared with v${base.version}` : "first version"}
          </>
        }
      />
      {section("rules")}
      {section("facts")}
      <Link href="/governance" className="text-sm text-accent hover:underline">
        Back to Governance
      </Link>
    </>
  );
}
