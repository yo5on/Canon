import Link from "next/link";
import { Icon } from "@/components/icon";
import {
  ButtonLink,
  EmptyState,
  PageHeader,
  StatusBadge,
  formatDateTime,
} from "@/components/ui";
import { factState } from "@/lib/brandkit";
import { requireWorkspace } from "@/lib/workspace";

export default async function Overview() {
  const { supabase, user, active } = await requireWorkspace();
  const org = active.orgId;
  const today = new Date().toISOString().slice(0, 10);

  const [items, rules, facts, audit] = await Promise.all([
    supabase
      .from("content_items")
      .select("id, title, channel, status, reviewer_id, author_id, updated_at")
      .eq("org_id", org)
      .order("updated_at", { ascending: false }),
    supabase
      .from("rules")
      .select("severity")
      .eq("org_id", org)
      .eq("is_current", true),
    supabase
      .from("facts")
      .select("valid_from, valid_until, replaced_by")
      .eq("org_id", org)
      .eq("is_current", true),
    supabase
      .from("audit_log")
      .select("id, action, at")
      .eq("org_id", org)
      .order("at", { ascending: false })
      .limit(6),
  ]);
  for (const r of [items, rules, facts, audit])
    if (r.error) throw new Error("Could not load the overview.");

  const list = items.data!;
  const mine = list.filter(
    (i) => i.status === "in_review" && i.reviewer_id === user.id,
  ).length;
  const states = facts.data!.map((f) => factState(f, today));
  const stats = [
    {
      label: "Content items",
      value: list.length,
      note: `${list.filter((i) => i.status === "approved").length} approved`,
      href: "/submissions",
    },
    {
      label: "Awaiting review",
      value: list.filter((i) => i.status === "in_review").length,
      note:
        active.role === "creator"
          ? "across the workspace"
          : `${mine} assigned to you`,
      href: "/review",
    },
    {
      label: "Brand rules",
      value: rules.data!.length,
      note: `${rules.data!.filter((r) => r.severity === "blocking").length} blocking`,
      href: "/brand-kit",
    },
    {
      label: "Approved facts",
      value: states.length,
      note: `${states.filter((s) => s === "expiring").length} expiring · ${states.filter((s) => s === "expired").length} expired`,
      href: "/brand-kit?tab=facts",
    },
  ];

  const pending = list.filter((i) => i.status === "in_review");
  return (
    <>
      <PageHeader
        crumb={active.orgName}
        title="Workspace overview"
        icon="home"
        subtitle="Your content, brand knowledge and review decisions in one place."
        actions={
          <ButtonLink href="/submissions/new" primary>
            New submission
          </ButtonLink>
        }
      />
      <div className="mb-9 grid grid-cols-2 border-y border-line sm:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="summary-item hover:bg-secondary"
          >
            <p className="text-xs text-muted">{s.label}</p>
            <p className="my-1 text-xl font-semibold tabular-nums">{s.value}</p>
            <p className="text-[11px] text-muted">{s.note}</p>
          </Link>
        ))}
      </div>
      <section>
        <div className="section-heading">
          <h2>Recent submissions</h2>
          <Link
            href="/submissions"
            className="text-xs font-normal text-muted hover:text-ink"
          >
            View all
          </Link>
        </div>
        {list.length === 0 ? (
          <EmptyState
            title="No content yet"
            body="Submitted drafts will appear here with their check results and review status."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px] text-[13px]">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-normal text-muted">
                    Name
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-normal text-muted">
                    Channel
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-normal text-muted">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-normal text-muted">
                    Last edited
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.slice(0, 5).map((i) => (
                  <tr key={i.id}>
                    <td className="px-3 py-3">
                      <Link
                        href={`/submissions/${i.id}`}
                        className="flex items-center gap-2 hover:underline"
                      >
                        <Icon name="file" size={15} />
                        {i.title}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-muted">{i.channel}</td>
                    <td className="px-3 py-3">
                      <StatusBadge status={i.status} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted">
                      {formatDateTime(i.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="mt-9 grid gap-8 xl:grid-cols-2">
        <section>
          <div className="section-heading">
            <h2>Pending reviews</h2>
            <Link
              href="/review"
              className="text-xs font-normal text-muted hover:text-ink"
            >
              Open queue
            </Link>
          </div>
          {pending.length === 0 ? (
            <div className="mt-4 flex items-start gap-3 rounded bg-secondary p-4">
              <Icon name="check" />
              <div>
                <p className="text-[13px] font-medium">
                  No submissions waiting for review
                </p>
                <p className="mt-1 text-xs text-muted">
                  Submitted drafts will appear here when they need a decision.
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {pending.slice(0, 4).map((i) => (
                <li key={i.id} className="py-3">
                  <Link
                    href={`/submissions/${i.id}`}
                    className="text-[13px] hover:underline"
                  >
                    {i.title}
                  </Link>
                  <p className="mt-1 text-xs text-muted">
                    {i.reviewer_id === user.id
                      ? "Assigned to you"
                      : "Awaiting a reviewer decision"}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6">
            <p className="mb-3 text-xs font-medium text-muted">
              Workspace resources
            </p>
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/brand-kit">Brand rules</ButtonLink>
              <ButtonLink href="/brand-kit?tab=facts">
                Approved facts
              </ButtonLink>
            </div>
          </div>
        </section>
        <section>
          <div className="section-heading">
            <h2>Recent activity</h2>
            <Link
              href="/audit"
              className="text-xs font-normal text-muted hover:text-ink"
            >
              View history
            </Link>
          </div>
          {audit.data!.length === 0 ? (
            <EmptyState
              title="No activity yet"
              body="Submissions, decisions and overrides are recorded here."
            />
          ) : (
            <ul className="divide-y divide-line">
              {audit.data!.slice(0, 5).map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 py-3 text-[13px]"
                >
                  <span className="flex items-center gap-2 capitalize">
                    <Icon name="history" size={14} />
                    {a.action.replaceAll("_", " ")}
                  </span>
                  <span className="whitespace-nowrap text-xs text-muted">
                    {formatDateTime(a.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
