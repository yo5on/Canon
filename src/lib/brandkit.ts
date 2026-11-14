// Brand Kit input validation. Mirrors the CHECK constraints in supabase/migrations/0001_init.sql
// so users get a readable message before the database rejects the row.
import { z } from "zod";

export const CATEGORIES = ["tone", "terminology", "claim", "messaging", "accessibility", "visual"] as const;
// Code checks: banned terms run on all text; contrast, palette and alt text run on image assets.
export const CHECK_TYPES = ["banned_term", "contrast", "palette", "alt_text"] as const;
const HEX = /^#[0-9a-f]{6}$/i;

/** "Canon Green #28645A, #FFFFFF" → ["#28645A", "#FFFFFF"]; anything that is not a 6-digit hex is reported. */
export function parsePalette(s: string): { colors: string[]; bad: string[] } {
  const tokens = s.split(/[\s,;]+/).filter((t) => t.startsWith("#"));
  return { colors: [...new Set(tokens.filter((t) => HEX.test(t)).map((t) => t.toUpperCase()))], bad: tokens.filter((t) => !HEX.test(t)) };
}
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
    check_type: z.enum(CHECK_TYPES).default("banned_term"),
    min_ratio: z.string().trim().default(""),
    palette: z.string().trim().max(1000).default(""),
    min_length: z.string().trim().default(""),
  })
  .superRefine((r, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", message, path: [path] });
    if (r.check_kind === "ai" && r.check_type !== "banned_term") issue("check_type", "Visual checks run in code: choose the Code check");
    if (r.check_kind === "code" && r.check_type === "banned_term" && !r.banned_term) issue("banned_term", "Code checks need a banned term");
    if (r.check_type === "contrast" && r.min_ratio && !(Number(r.min_ratio) >= 1 && Number(r.min_ratio) <= 21)) issue("min_ratio", "Contrast ratio is between 1 and 21");
    if (r.check_type === "palette") {
      const p = parsePalette(r.palette);
      if (p.bad.length) issue("palette", `Not a 6-digit hex colour: ${p.bad[0]}`);
      else if (!p.colors.length) issue("palette", "List the brand colours, e.g. #28645A, #FFFFFF");
    }
    if (r.check_type === "alt_text" && r.min_length && !(Number(r.min_length) >= 1)) issue("min_length", "Use a number of characters");
  })
  // Parameters are stored on the rule row, so they are versioned with it.
  .transform(({ min_ratio, palette, min_length, ...r }) => ({
    ...r,
    banned_term: r.check_type === "banned_term" ? r.banned_term : null,
    params:
      r.check_type === "contrast"
        ? { min_ratio: Number(min_ratio) || 4.5 }
        : r.check_type === "palette"
          ? { colors: parsePalette(palette).colors, max_delta: 12, min_share: 0.03 }
          : r.check_type === "alt_text"
            ? { min_length: Number(min_length) || 10 }
            : {},
  }));

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
    source_url: z.string().trim().max(500).default("").transform((s) => s || null).pipe(z.url({ protocol: /^https$/, message: "Use a full https:// address" }).nullable()),
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
