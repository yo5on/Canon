import type { Metadata } from "next";
import { Card, EmptyState, PageHeader, formatDateTime, td, th } from "@/components/ui";
import { memberNames, requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Audit history" };

export default async function AuditHistory() {
  const { supabase, active } = await requireWorkspace();
  const [{ data, error }, names] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, action, actor_id, detail, at, content_items(title)")
      .eq("org_id", active.orgId)
      .order("at", { ascending: false })
      .limit(100),
    memberNames(active.orgId),
  ]);
  if (error) throw new Error("Could not load audit history.");

  return (
    <>
      <PageHeader
        crumb="Governance"
        title="Audit history"
        subtitle="Append-only. Nobody, including administrators, can edit or delete these entries."
      />
      <Card className="overflow-x-auto">
        {data.length === 0 ? (
          <EmptyState title="No events yet" body="Workspace changes, submissions, overrides and approvals are recorded here." />
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>When</th>
                <th className={th}>Who</th>
                <th className={th}>Action</th>
                <th className={th}>Item</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((a) => (
                <tr key={a.id}>
                  <td className={`${td} whitespace-nowrap text-muted`}>{formatDateTime(a.at)}</td>
                  <td className={td}>{a.actor_id ? names.get(a.actor_id) ?? "Former member" : "System"}</td>
                  <td className={`${td} font-mono text-xs`}>{a.action}</td>
                  <td className={td}>{(a.content_items as unknown as { title: string } | null)?.title ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
