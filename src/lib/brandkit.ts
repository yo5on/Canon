// Brand Kit input validation. Mirrors the CHECK constraints in supabase/migrations/0001_init.sql
// so users get a readable message before the database rejects the row.
import { z } from "zod";

export const CATEGORIES = ["tone", "terminology", "claim", "messaging", "accessibility"] as const;
export const SEVERITIES = ["blocking", "advisory"] as const;
export const CHECK_KINDS = ["ai", "code"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null);

const optionalDate = z
  .string()
  .trim()
  .transform((s) => s || null)
  .pipe(z.iso.date({ message: "Use a valid date" }).nullable());

export const ruleSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z]+-[0-9]+$/, "Code looks like TONE-1 or CLAIM-02"),
    text: z.string().trim().min(3, "Rule text needs at least 3 characters").max(2000),
    category: z.enum(CATEGORIES),
    severity: z.enum(SEVERITIES),
    check_kind: z.enum(CHECK_KINDS),
    banned_term: optionalText(200),
    replacement: optionalText(200),
    source_ref: optionalText(300),
  })
  .refine((r) => r.check_kind !== "code" || r.banned_term, {
    message: "Code checks need a banned term",
    path: ["banned_term"],
  });

export const factSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^FACT-[0-9]+$/, "Code looks like FACT-1"),
    text: z.string().trim().min(2, "Fact text needs at least 2 characters").max(1000),
    value: z
      .string()
      .trim()
      .transform((s) => (s === "" ? null : Number(s)))
      .refine((n) => n === null || Number.isFinite(n), "Value must be a number"),
    tolerance: z
      .string()
      .trim()
      .transform((s) => (s === "" ? 0 : Number(s)))
      .refine((n) => Number.isFinite(n) && n >= 0, "Tolerance must be 0 or more"),
    valid_from: optionalDate,
    valid_until: optionalDate,
    replaced_by: optionalText(40),
    owner: z.string().trim().max(120),
    source_ref: optionalText(300),
    confidential: z.boolean(),
  })
  .refine((f) => !f.valid_from || !f.valid_until || f.valid_until >= f.valid_from, {
    message: "Valid until must be on or after valid from",
    path: ["valid_until"],
  });

export type RuleInput = z.infer<typeof ruleSchema>;
export type FactInput = z.infer<typeof factSchema>;

/** Field errors keyed by field name, first message only. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

export type FactState = "active" | "expiring" | "expired" | "scheduled" | "replaced";

/** Where a fact stands on a given day (ISO date). Expiring = ends within 14 days. */
export function factState(
  f: { valid_from: string | null; valid_until: string | null; replaced_by: string | null },
  today: string,
): FactState {
  if (f.replaced_by) return "replaced";
  if (f.valid_until && f.valid_until < today) return "expired";
  if (f.valid_from && f.valid_from > today) return "scheduled";
  if (f.valid_until) {
    const days = (Date.parse(f.valid_until) - Date.parse(today)) / 86_400_000;
    if (days <= 14) return "expiring";
  }
  return "active";
}
