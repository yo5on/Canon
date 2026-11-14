import { describe, expect, it } from "vitest";
import { factSchema, factState, fieldErrors, parsePalette, ruleSchema } from "./brandkit";

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

describe("Round 3 rule types", () => {
  it("stores visual check parameters on the rule row", () => {
    const c = ruleSchema.parse({ ...rule, code: "ACC-2", category: "accessibility", check_kind: "code", check_type: "contrast", min_ratio: "4.5", banned_term: "ignored" });
    expect(c).toMatchObject({ check_type: "contrast", params: { min_ratio: 4.5 }, banned_term: null });
    const p = ruleSchema.parse({ ...rule, code: "BRAND-1", category: "visual", check_kind: "code", check_type: "palette", palette: "Canon Green #28645a, white #FFFFFF" });
    expect(p.params).toMatchObject({ colors: ["#28645A", "#FFFFFF"] });
    expect(ruleSchema.parse(rule)).toMatchObject({ check_type: "banned_term", params: {} });
  });

  it("rejects bad palettes, visual checks marked as AI and out-of-range ratios", () => {
    const bad = (extra: object) => {
      const r = ruleSchema.safeParse({ ...rule, check_kind: "code", ...extra });
      return r.success ? {} : fieldErrors(r.error);
    };
    expect(bad({ check_type: "palette", palette: "#12 green" }).palette).toMatch(/hex/);
    expect(bad({ check_type: "palette", palette: "" }).palette).toBeDefined();
    expect(bad({ check_type: "contrast", min_ratio: "40" }).min_ratio).toBeDefined();
    expect(bad({ check_kind: "ai", check_type: "alt_text" }).check_type).toBeDefined();
    expect(parsePalette("#ABCDEF #abcdef").colors).toEqual(["#ABCDEF"]);
  });

  it("accepts only https source URLs on facts", () => {
    expect(factSchema.parse({ ...fact, source_url: "https://example.org/report" }).source_url).toBe("https://example.org/report");
    expect(factSchema.parse(fact).source_url).toBeNull();
    expect(factSchema.safeParse({ ...fact, source_url: "http://example.org" }).success).toBe(false);
    expect(factSchema.safeParse({ ...fact, source_url: "javascript:alert(1)" }).success).toBe(false);
  });
});
