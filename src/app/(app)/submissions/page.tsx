import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Card, EmptyState, PageHeader, StatusBadge, formatDate, td, th } from "@/components/ui";
import { memberNames, requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Submissions" };

export default async function Submissions() {
  const { supabase, active } = await requireWorkspace();
  const [{ data, error }, names] = await Promise.all([
    supabase
      .from("content_items")
      .select("id, title, channel, status, author_id, reviewer_id, publish_date, current_version, updated_at")
      .eq("org_id", active.orgId)
      .order("updated_at", { ascending: false }),
    memberNames(active.orgId),
  ]);
  if (error) throw new Error("Could not load submissions.");

  return (
    <>
      <PageHeader
        crumb="Content"
        title="Submissions"
        subtitle="Drafts submitted for checks and review. Pasted text only in this release."
        actions={<ButtonLink href="/submissions/new" primary>New submission</ButtonLink>}
      />
      <Card className="overflow-x-auto">
        {data.length === 0 ? (
          <EmptyState
            title="No submissions yet"
            body="When a creator submits a draft, it shows up here with its version, reviewer and status."
          />
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Title</th>
                <th className={th}>Channel</th>
                <th className={th}>Author</th>
                <th className={th}>Reviewer</th>
                <th className={th}>Publish</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((i) => (
                <tr key={i.id}>
                  <td className={td}>
                    <Link href={`/submissions/${i.id}`} className="hover:text-accent hover:underline">
                      {i.title}
                    </Link>{" "}
                    <span className="font-mono text-xs text-faint">v{i.current_version}</span>
                  </td>
                  <td className={`${td} text-muted`}>{i.channel}</td>
                  <td className={td}>{names.get(i.author_id) ?? "—"}</td>
                  <td className={td}>{i.reviewer_id ? names.get(i.reviewer_id) ?? "—" : <span className="text-faint">Unassigned</span>}</td>
                  <td className={`${td} text-muted`}>{formatDate(i.publish_date)}</td>
                  <td className={td}>
                    <StatusBadge status={i.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
