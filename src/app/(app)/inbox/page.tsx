import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Badge, Card, EmptyState, PageHeader, formatDateTime } from "@/components/ui";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Inbox" };

const KIND: Record<string, { label: string; tone: "accent" | "amber" | "danger" | "ok" | "muted" }> = {
  review_requested: { label: "Review requested", tone: "accent" },
  decision: { label: "Decision", tone: "ok" },
  monitor_alert: { label: "Monitoring alert", tone: "danger" },
  source_changed: { label: "Source changed", tone: "amber" },
};

async function markAllRead() {
  "use server";
  const { supabase } = await requireWorkspace();
  await supabase.rpc("mark_notifications_read", { p_ids: null });
  revalidatePath("/", "layout");
}

export default async function Inbox() {
  const { supabase, user, active } = await requireWorkspace();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, title, body, link, created_at, read_at")
    .eq("user_id", user.id)
    .eq("org_id", active.orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Could not load your inbox.");
  const unread = data.filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader
        icon="check"
        crumb="Workspace"
        title="Inbox"
        subtitle="Review requests, decisions on your content, monitoring alerts and source changes. Every notification comes from an entry in the audit history."
        actions={
          unread > 0 && (
            <form action={markAllRead}>
              <button className="rounded border border-line px-3 py-1.5 text-[13px] hover:bg-secondary">Mark all {unread} as read</button>
            </form>
          )
        }
      />
      <Card>
        {data.length === 0 ? (
          <EmptyState title="Nothing here yet" body="When someone asks you to review content, decides on yours, or monitoring finds a new issue, it appears here." />
        ) : (
          <ul className="divide-y divide-line">
            {data.map((n) => (
              <li key={n.id} className={`px-5 py-3 text-[13px] ${n.read_at ? "" : "bg-green-soft/40"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={KIND[n.kind]?.tone ?? "muted"}>{KIND[n.kind]?.label ?? n.kind}</Badge>
                  <Link href={n.link} className="font-medium hover:underline">
                    {n.title}
                  </Link>
                  {!n.read_at && <span className="text-[11px] text-ok">New</span>}
                  <span className="ml-auto text-xs text-faint">{formatDateTime(n.created_at)}</span>
                </div>
                {n.body && <p className="mt-1 text-xs text-muted">{n.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
