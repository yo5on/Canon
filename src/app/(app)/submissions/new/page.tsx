import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { ROLE_LABEL, requireWorkspace, type Role } from "@/lib/workspace";
import { MOCK_DRAFT } from "@/lib/ai.mock";
import { SubmitForm } from "./form";

export const metadata: Metadata = { title: "Submit content" };

export default async function NewSubmission() {
  const { supabase, user, active } = await requireWorkspace();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, display_name, role")
    .eq("org_id", active.orgId)
    .in("role", ["reviewer", "brand_manager"])
    .neq("user_id", user.id);
  if (error) throw new Error("Could not load reviewers.");
  const reviewers = (data ?? []).map((m) => ({ id: m.user_id as string, name: (m.display_name as string) || "Member", role: ROLE_LABEL[m.role as Role] }));

  return (
    <>
      <PageHeader crumb="Content / Submissions" title="Submit content for checks" subtitle="Saved as draft v1. You run checks on the next screen." />
      <SubmitForm reviewers={reviewers} today={new Date().toISOString().slice(0, 10)} mockDraft={process.env.CANON_AI_MOCK === "1" ? MOCK_DRAFT : null} />
    </>
  );
}
