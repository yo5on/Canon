import Link from "next/link";
import { Card, EmptyState, PageHeader, StatusBadge, formatDateTime } from "@/components/ui";
import { factState } from "@/lib/brandkit";
import { ROLE_LABEL, requireWorkspace } from "@/lib/workspace";

export default async function Overview() {
  const { supabase, user, active } = await requireWorkspace();
  const org = active.orgId;
  const today = new Date().toISOString().slice(0, 10);

  const [items, rules, facts, audit] = await Promise.all([
    supabase.from("content_items").select("id, title, status, reviewer_id, author_id, updated_at").eq("org_id", org).order("updated_at", { ascending: false }),
    supabase.from("rules").select("severity").eq("org_id", org).eq("is_current", true),
    supabase.from("facts").select("valid_from, valid_until, replaced_by").eq("org_id", org).eq("is_current", true),
    supabase.from("audit_log").select("id, action, at").eq("org_id", org).order("at", { ascending: false }).limit(6),
  ]);
  for (const r of [items, rules, facts, audit]) if (r.error) throw new Error("Could not load the overview.");

  const list = items.data!;
  const mine = list.filter((i) => i.status === "in_review" && i.reviewer_id === user.id).length;
  const states = facts.data!.map((f) => factState(f, today));
  const stats = [
    { label: "Content items", value: list.length, note: `${list.filter((i) => i.status === "approved").length} approved`, href: "/submissions" },
    { label: "Awaiting review", value: list.filter((i) => i.status === "in_review").length, note: active.role === "creator" ? "across the workspace" : `${mine} assigned to you`, href: "/review" },
    { label: "Brand rules", value: rules.data!.length, note: `${rules.data!.filter((r) => r.severity === "blocking").length} blocking`, href: "/brand-kit" },
    { label: "Approved facts", value: states.length, note: `${states.filter((s) => s === "expiring").length} expiring · ${states.filter((s) => s === "expired").length} expired`, href: "/brand-kit?tab=facts" },
  ];

  return (
    <>
      <PageHeader
        crumb={active.orgName}
        title={`Welcome back, ${active.displayName.split(" ")[0]}`}
        subtitle={`Signed in as ${ROLE_LABEL[active.role]}. Here’s where the workspace stands.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="group rounded-xl border border-line bg-panel p-5 hover:border-accent/40">
            <p className="label">{s.label}</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{s.value}</p>
            <p className="mt-1 text-xs text-muted group-hover:text-ink">{s.note}</p>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-sm font-medium">Recent content</h2>
            <Link href="/submissions" className="text-xs text-accent hover:underline">
              All submissions
            </Link>
          </div>
          {list.length === 0 ? (
            <EmptyState
              title="No content yet"
              body="Submitted drafts will appear here with their check results and review status."
            />
          ) : (
            <ul className="divide-y divide-line">
              {list.slice(0, 6).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="truncate">{i.title}</span>
                  <StatusBadge status={i.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-sm font-medium">Latest activity</h2>
            <Link href="/audit" className="text-xs text-accent hover:underline">
              Audit history
            </Link>
          </div>
          {audit.data!.length === 0 ? (
            <EmptyState title="No activity yet" body="Every submission, decision and override is logged here." />
          ) : (
            <ul className="divide-y divide-line">
              {audit.data!.map((a) => (
                <li key={a.id} className="flex justify-between gap-3 px-5 py-3 text-sm">
                  <span className="font-mono text-xs">{a.action}</span>
                  <span className="text-xs text-muted">{formatDateTime(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
