"use server";

// Review workflow (ROUND2_PLAN §4). Every state change goes through the Postgres functions in 0001_init.sql,
// called as the signed-in user: they and the approvals trigger enforce roles, "no self-approval" and the audit log.
import { z } from "zod";
import { requireWorkspace } from "@/lib/workspace";

export type ActionState = { error?: string; ok?: boolean };

const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("submit"), item: z.uuid() }),
  z.object({ kind: z.literal("revise"), item: z.uuid(), body: z.string().trim().min(1, "Enter the revised draft").max(40000, "Drafts are limited to 40,000 characters") }),
  z.object({ kind: z.literal("finding"), item: z.uuid(), finding: z.uuid(), decision: z.enum(["accepted", "rejected", "overridden"]), reason: z.string().trim().max(1000) }),
  z.object({ kind: z.literal("item"), item: z.uuid(), decision: z.enum(["approved", "rejected", "changes_requested"]), reason: z.string().trim().max(1000) }),
]);

// Postgres exception text → what the user sees. Unknown errors stay generic.
const KNOWN = [
  "only the author",
  "only a reviewer other than the author",
  "nobody can approve their own submission",
  "approver must be a Reviewer or Brand Manager",
  "blocking issues remain",
  "a reason is required",
  "run checks on the current version",
  "choose a reviewer first",
  "item is",
];

export async function reviewAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = schema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if ((d.kind === "finding" || d.kind === "item") && d.decision !== "accepted" && d.decision !== "approved" && d.reason.length < 3)
    return { error: "Give a reason (at least 3 characters)." };

  const { supabase } = await requireWorkspace();
  const { error } =
    d.kind === "revise"
      ? await supabase.rpc("revise_item", { p_item: d.item, p_body: d.body })
      : d.kind === "submit"
      ? await supabase.rpc("submit_for_review", { p_item: d.item })
      : d.kind === "finding"
        ? await supabase.rpc("decide_finding", { p_finding: d.finding, p_decision: d.decision, p_reason: d.reason })
        : await supabase.rpc("decide_item", { p_item: d.item, p_decision: d.decision, p_reason: d.reason });
  if (error) {
    const known = KNOWN.find((k) => error.message.includes(k));
    return { error: known ? error.message : "Could not save that decision. Try again." };
  }
  return { ok: true };
}
