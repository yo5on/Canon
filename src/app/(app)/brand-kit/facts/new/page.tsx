import type { Metadata } from "next";
import { PageHeader, Unauthorized } from "@/components/ui";
import { requireWorkspace } from "@/lib/workspace";
import { FactForm } from "../../forms";

export const metadata: Metadata = { title: "New fact" };

export default async function NewFact() {
  const { active } = await requireWorkspace();
  if (active.role !== "brand_manager") return <Unauthorized need="Brand Manager" />;
  return (
    <>
      <PageHeader crumb="Brand Kit / Approved facts" title="New fact" />
      <FactForm id={null} />
    </>
  );
}
