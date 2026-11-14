"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fieldErrors } from "@/lib/brandkit";
import { itemFields } from "@/lib/items";
import { requireWorkspace } from "@/lib/workspace";

export type SubmitState = { errors?: Record<string, string>; values?: Record<string, string>; n?: number };

const itemSchema = itemFields.extend({
  body: z.string().trim().min(1, "Paste the draft text").max(40000, "Drafts are limited to about 6,000 words"),
});

/** Creates the item and version 1 through the create_item RPC, which checks membership and the reviewer. */
export async function createItem(prev: SubmitState, form: FormData): Promise<SubmitState> {
  const values = Object.fromEntries([...form.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]));
  const parsed = itemSchema.safeParse(values);
  const again = (errors: Record<string, string>) => ({ errors, values, n: (prev.n ?? 0) + 1 });
  if (!parsed.success) return again(fieldErrors(parsed.error));

  const { supabase, active } = await requireWorkspace();
  const d = parsed.data;
  const { data: id, error } = await supabase.rpc("create_item", {
    p_org: active.orgId,
    p_title: d.title,
    p_channel: d.channel,
    p_audience: d.audience,
    p_goal: d.goal,
    p_publish: d.publish_date,
    p_reviewer: d.reviewer,
    p_body: d.body,
  });
  if (error) {
    if (/review/.test(error.message)) return again({ reviewer: "Choose a Reviewer or Brand Manager other than yourself." });
    return again({ form: "Could not save the draft. Try again." });
  }
  revalidatePath("/submissions");
  redirect(`/submissions/${id}`);
}
