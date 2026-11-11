import type { Metadata } from "next";
import { PageHeader, Unauthorized } from "@/components/ui";
import { requireWorkspace } from "@/lib/workspace";
import { RuleForm } from "../../forms";

export const metadata: Metadata = { title: "New rule" };

export default async function NewRule() {
  const { active } = await requireWorkspace();
  if (active.role !== "brand_manager") return <Unauthorized need="Brand Manager" />;
  return (
    <>
      <PageHeader crumb="Brand Kit / Rules" title="New rule" />
      <RuleForm id={null} />
    </>
  );
}
