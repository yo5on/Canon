import type { Metadata } from "next";
import { Badge, Card, EmptyState, PageHeader, formatDate, td, th } from "@/components/ui";
import { memberNames, requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Review queue" };

export default async function ReviewQueue() {
  const { supabase, user, active } = await requireWorkspace();
  const [{ data, error }, names] = await Promise.all([
    supabase
      .from("content_items")
      .select("id, title, channel, author_id, reviewer_id, publish_date, current_version")
      .eq("org_id", active.orgId)
      .eq("status", "in_review")
      .order("publish_date"),
    memberNames(active.orgId),
  ]);
  if (error) throw new Error("Could not load the review queue.");
  const canDecide = active.role !== "creator";

  return (
    <>
      <PageHeader
        crumb="Review"
        title="Review queue"
        subtitle={
          canDecide
            ? "Items waiting for a decision. You can’t approve your own work, and blocking issues must be fixed or overridden with a reason."
            : "Items in review. Creators can follow progress here; Reviewers and Brand Managers decide."
        }
      />
      <Card className="overflow-x-auto">
        {data.length === 0 ? (
          <EmptyState title="Nothing waiting for review" body="Items appear here once their author submits them with a finished check run." />
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Item</th>
                <th className={th}>Author</th>
                <th className={th}>Reviewer</th>
                <th className={th}>Publish</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((i) => (
                <tr key={i.id}>
                  <td className={td}>
                    {i.title} <span className="font-mono text-xs text-faint">v{i.current_version}</span>
                  </td>
                  <td className={td}>{names.get(i.author_id) ?? "—"}</td>
                  <td className={td}>
                    {names.get(i.reviewer_id) ?? "—"} {i.reviewer_id === user.id && <Badge tone="accent">You</Badge>}
                  </td>
                  <td className={`${td} text-muted`}>{formatDate(i.publish_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
