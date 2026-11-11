"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { factSchema, fieldErrors, ruleSchema } from "@/lib/brandkit";
import { requireWorkspace } from "@/lib/workspace";

export type FormState = { errors?: Record<string, string>; values?: Record<string, string>; n?: number };

const DUPLICATE = "23505";
const RLS_DENIED = "42501";

function readForm(form: FormData) {
  return Object.fromEntries([...form.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]));
}

// The role check here is for a friendly message only. RLS (rules_write/facts_write: brand_manager) is the real gate.
async function managerContext() {
  const ctx = await requireWorkspace();
  if (ctx.active.role !== "brand_manager") return null;
  return ctx;
}

function dbError(code: string | undefined, what: string): FormState {
  if (code === DUPLICATE) return { errors: { code: `A ${what} with this code already exists.` } };
  if (code === RLS_DENIED) return { errors: { form: "Only a Brand Manager can change the Brand Kit." } };
  return { errors: { form: `Could not save the ${what}. Try again.` } };
}

/**
 * Editing never overwrites: it adds version n+1 and moves the "current" flag.
 * Order matters because only one row per code may be current: insert the new row as not current,
 * retire the old one, then promote the new one. A failure at any step leaves at least the old row usable
 * except between the last two, which a retry fixes.
 */
async function saveVersion(table: "rules" | "facts", id: string | null, values: Record<string, unknown>, what: string) {
  const ctx = await managerContext();
  if (!ctx) return { errors: { form: "Only a Brand Manager can change the Brand Kit." } };
  const { supabase, user, active } = ctx;
  const base = { ...values, org_id: active.orgId, created_by: user.id };

  if (!id) {
    const { error } = await supabase.from(table).insert({ ...base, version: 1, is_current: true });
    if (error) return dbError(error.code, what);
    return null;
  }

  const { data: old, error: readErr } = await supabase
    .from(table)
    .select("id, code, version")
    .eq("id", id)
    .eq("org_id", active.orgId)
    .eq("is_current", true)
    .maybeSingle();
  if (readErr || !old) return { errors: { form: `This ${what} no longer exists or was changed by someone else.` } };

  // The code is the identity across versions; it can't change on edit.
  const { data: created, error: insErr } = await supabase
    .from(table)
    .insert({ ...base, code: old.code, version: old.version + 1, is_current: false })
    .select("id")
    .single();
  if (insErr) return dbError(insErr.code, what);

  const retire = await supabase.from(table).update({ is_current: false }).eq("id", old.id).select("id");
  if (retire.error || retire.data.length !== 1) return { errors: { form: `Could not update the ${what}. Try again.` } };
  const promote = await supabase.from(table).update({ is_current: true }).eq("id", created.id).select("id");
  if (promote.error || promote.data.length !== 1) return { errors: { form: `Saved, but the new version isn’t live yet. Try again.` } };
  return null;
}

// Errors carry the submitted values back (React resets the form after an action);
// n changes on every failed submit so the form remounts and selects pick the values up too.
export async function saveRule(id: string | null, prev: FormState, form: FormData): Promise<FormState> {
  const values = readForm(form);
  const parsed = ruleSchema.safeParse(values);
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values, n: (prev.n ?? 0) + 1 };
  const failed = await saveVersion("rules", id, parsed.data, "rule");
  if (failed) return { ...failed, values, n: (prev.n ?? 0) + 1 };
  revalidatePath("/brand-kit");
  redirect("/brand-kit");
}

export async function saveFact(id: string | null, prev: FormState, form: FormData): Promise<FormState> {
  const values = readForm(form);
  const parsed = factSchema.safeParse({ ...values, confidential: values.confidential === "on" });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values, n: (prev.n ?? 0) + 1 };
  const failed = await saveVersion("facts", id, parsed.data, "fact");
  if (failed) return { ...failed, values, n: (prev.n ?? 0) + 1 };
  revalidatePath("/brand-kit");
  redirect("/brand-kit?tab=facts");
}
