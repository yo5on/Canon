import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader, Unauthorized } from "@/components/ui";
import { requireWorkspace } from "@/lib/workspace";
import { FactForm } from "../../forms";

export const metadata: Metadata = { title: "Edit fact" };

export default async function EditFact({ params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  const { supabase, active } = await requireWorkspace();
  if (active.role !== "brand_manager") return <Unauthorized need="Brand Manager" />;
  if (!id.success) notFound();

  const { data, error } = await supabase
    .from("facts")
    .select("code, version, text, value, tolerance, valid_from, valid_until, replaced_by, owner, source_ref, confidential")
    .eq("id", id.data)
    .eq("org_id", active.orgId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw new Error("Could not load the fact.");
  if (!data) notFound();

  return (
    <>
      <PageHeader
        crumb="Brand Kit / Approved facts"
        title={`Edit ${data.code}`}
        subtitle={`Currently v${data.version}. Saving creates v${data.version + 1}; earlier versions stay on record.`}
      />
      <FactForm id={id.data} initial={data} />
    </>
  );
}
