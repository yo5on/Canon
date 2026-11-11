// The DEMO/MOCK response, run through the real pipeline against the seeded demo kit, shows all five ledger statuses.
import { describe, expect, it } from "vitest";
import { MOCK_DRAFT, createMockClient } from "./ai.mock";
import { modelOutputSchema } from "./ai";
import { assemble, type FactRow, type RuleRow } from "./pipeline";

const rule = (code: string, category: string, text: string, extra: Partial<RuleRow> = {}): RuleRow => ({
  code, version: 1, text, category, severity: "advisory", check_kind: "ai", banned_term: null, replacement: null, ...extra,
});
const fact = (code: string, text: string, value: number, valid_until: string | null = null): FactRow => ({
  code, version: 1, text, value, tolerance: 0, valid_from: null, valid_until, replaced_by: null, confidential: false,
});

describe("DEMO/MOCK run", () => {
  it("does not invent sample findings or claims for a different draft", async () => {
    const res = await createMockClient("Our new campaign is ready for review.").messages.create({} as never);
    const text = res.content[0];
    if (text.type !== "text") throw new Error("Expected mock text");
    expect(JSON.parse(text.text)).toEqual({ findings: [], claims: [] });
  });
  it("checks only sample phrases still present after a revision", async () => {
    const res = await createMockClient("Trusted by over 1,000 customers.").messages.create({} as never);
    const text = res.content[0];
    if (text.type !== "text") throw new Error("Expected mock text");
    const output = modelOutputSchema.parse(JSON.parse(text.text));
    expect(output.findings).toHaveLength(0);
    expect(output.claims.map((c) => c.text)).toEqual(["Trusted by over 1,000 customers"]);
  });
  it("covers SUPPORTED, CONTRADICTED, OUTDATED, UNSUPPORTED and HUMAN_JUDGEMENT", async () => {
    const res = (await createMockClient(MOCK_DRAFT).messages.create({} as never)) as unknown as { content: { text: string }[] };
    const ai = modelOutputSchema.parse(JSON.parse(res.content[0].text));
    const rules = [
      rule("TONE-1", "tone", "Write in confident, plain language: no hype words such as revolutionary."),
      rule("CLAIM-02", "claim", "Superlatives need an approved fact.", { severity: "blocking" }),
      rule("TERM-1", "terminology", "Say customers, not users.", { check_kind: "code", banned_term: "users", replacement: "customers" }),
    ];
    const facts = [
      fact("FACT-1", "Canon Demo Co. serves 1,200 customers.", 1200),
      fact("FACT-2", "Canon Demo Co. is rated 4.8 out of 5 in the 2025 customer survey.", 4.8, "2026-06-30"),
      fact("FACT-3", "Canon Demo Co. is available in 9 countries.", 9),
    ];
    const { findings, claims } = assemble(MOCK_DRAFT, rules, facts, "2026-12-01", ai);
    expect(new Set(claims.map((c) => c.status))).toEqual(
      new Set(["SUPPORTED", "CONTRADICTED", "OUTDATED", "UNSUPPORTED", "HUMAN_JUDGEMENT", null]),
    );
    expect(findings.some((f) => f.origin === "code" && f.source_code === "TERM-1")).toBe(true);
    expect(findings.filter((f) => f.severity === "blocking" && f.verified)).toHaveLength(3);
  });
});
