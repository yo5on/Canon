import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader, Unauthorized } from "@/components/ui";
import { requireWorkspace } from "@/lib/workspace";
import { RuleForm } from "../../forms";

export const metadata: Metadata = { title: "Edit rule" };

export default async function EditRule({ params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  const { supabase, active } = await requireWorkspace();
  if (active.role !== "brand_manager") return <Unauthorized need="Brand Manager" />;
  if (!id.success) notFound();

  const { data, error } = await supabase
    .from("rules")
    .select("code, version, text, category, severity, check_kind, banned_term, replacement, source_ref")
    .eq("id", id.data)
    .eq("org_id", active.orgId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw new Error("Could not load the rule.");
  if (!data) notFound();

  return (
    <>
      <PageHeader
        crumb="Brand Kit / Rules"
        title={`Edit ${data.code}`}
        subtitle={`Currently v${data.version}. Saving creates v${data.version + 1}; earlier versions stay on record.`}
      />
      <RuleForm id={id.data} initial={data} />
    </>
  );
}
