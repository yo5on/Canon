import { describe, expect, it } from "vitest";
import { factSchema, factState, fieldErrors, ruleSchema } from "./brandkit";

const rule = {
  code: "tone-2",
  text: "Plain words.",
  category: "tone",
  severity: "advisory",
  check_kind: "ai",
  banned_term: "",
  replacement: "",
  source_ref: "",
};
const fact = {
  code: "FACT-3",
  text: "We have 40 staff.",
  value: "40",
  tolerance: "",
  valid_from: "2026-01-01",
  valid_until: "",
  replaced_by: "",
  owner: "HR",
  source_ref: "",
  confidential: false,
};

describe("ruleSchema", () => {
  it("normalises code and blanks", () => {
    const r = ruleSchema.parse(rule);
    expect(r.code).toBe("TONE-2");
    expect(r.banned_term).toBeNull();
  });
  it("rejects bad codes, unknown enums and short text", () => {
    const r = ruleSchema.safeParse({ ...rule, code: "tone", category: "vibes", text: "x" });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(fieldErrors(r.error)).sort()).toEqual(["category", "code", "text"]);
  });
  it("code checks need a banned term (matches the DB check)", () => {
    const r = ruleSchema.safeParse({ ...rule, check_kind: "code" });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).banned_term).toMatch(/banned term/);
    expect(ruleSchema.safeParse({ ...rule, check_kind: "code", banned_term: "users" }).success).toBe(true);
  });
});

describe("factSchema", () => {
  it("parses numbers and defaults tolerance to 0", () => {
    const f = factSchema.parse(fact);
    expect(f.value).toBe(40);
    expect(f.tolerance).toBe(0);
    expect(f.valid_until).toBeNull();
  });
  it("rejects non-FACT codes, negative tolerance, bad dates and reversed ranges", () => {
    expect(factSchema.safeParse({ ...fact, code: "TONE-1" }).success).toBe(false);
    expect(factSchema.safeParse({ ...fact, tolerance: "-1" }).success).toBe(false);
    expect(factSchema.safeParse({ ...fact, value: "abc" }).success).toBe(false);
    expect(factSchema.safeParse({ ...fact, valid_from: "31/12/2026" }).success).toBe(false);
    const r = factSchema.safeParse({ ...fact, valid_until: "2025-12-31" });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).valid_until).toBeDefined();
  });
});

describe("factState", () => {
  const t = "2026-11-08";
  const f = (valid_from: string | null, valid_until: string | null, replaced_by: string | null = null) => ({
    valid_from,
    valid_until,
    replaced_by,
  });
  it("classifies validity", () => {
    expect(factState(f("2026-01-01", null), t)).toBe("active");
    expect(factState(f(null, "2026-11-20"), t)).toBe("expiring");
    expect(factState(f(null, "2026-11-07"), t)).toBe("expired");
    expect(factState(f("2026-12-01", null), t)).toBe("scheduled");
    expect(factState(f(null, null, "FACT-9"), t)).toBe("replaced");
    expect(factState(f(null, "2026-12-31"), t)).toBe("active");
  });
});
