import { describe, expect, it } from "vitest";
import { compareNumber, decideClaim, parseNumber, type Fact } from "./ledger";

const F = (f: Partial<Fact> & Pick<Fact, "id" | "text">): Fact => ({
  value: null, tolerance: 0, valid_from: null, valid_until: null, replaced_by: null, ...f,
});

const facts = new Map<string, Fact>(
  [
    F({ id: "FACT-014", text: "Active customer teams: 8,200", value: 8200, valid_until: "2026-12-31" }),
    F({ id: "FACT-007", text: "Free trial length: 14 days", value: 14 }),
    F({ id: "FACT-031", text: "ISO 27001 certified", valid_from: "2023-04-01", valid_until: "2026-03-31" }),
    F({ id: "FACT-040", text: "Supported languages: 12", value: 12, replaced_by: "FACT-041" }),
    F({ id: "FACT-050", text: "SOC 2 Type II report available", valid_from: "2027-01-01" }),
  ].map((f) => [f.id, f]),
);
const DATE = "2026-11-18";

describe("parseNumber", () => {
  it("reads qualifiers, commas and k-suffixes", () => {
    expect(parseNumber("trusted by more than 8,000 teams")).toEqual({ value: 8000, qualifier: "more than" });
    expect(parseNumber("nearly 10k teams")).toEqual({ value: 10000, qualifier: "nearly" });
    expect(parseNumber("no numbers here")).toBeNull();
  });
});

describe("compareNumber (spec edge cases)", () => {
  it("'more than 8,000' vs 8,200 is supported", () => {
    expect(compareNumber({ value: 8000, qualifier: "more than" }, 8200, 0)).toBe("ENTAILS");
  });
  it("'nearly 10,000' vs 8,200 is contradicted", () => {
    expect(compareNumber({ value: 10000, qualifier: "nearly" }, 8200, 0)).toBe("CONTRADICTS");
  });
  it("exact is exact unless tolerance set", () => {
    expect(compareNumber({ value: 8250, qualifier: "exact" }, 8200, 0)).toBe("CONTRADICTS");
    expect(compareNumber({ value: 8250, qualifier: "exact" }, 8200, 100)).toBe("ENTAILS");
  });
});

describe("decideClaim ladder", () => {
  it("opinions are not ledgered", () => {
    expect(decideClaim({ text: "you'll wonder how you ever worked without it", type: "opinion", candidates: [] }, facts, DATE).status).toBeNull();
  });

  it("CONTRADICTED: 10,000 teams vs 8,200", () => {
    const r = decideClaim(
      { text: "trusted by 10,000 teams", type: "number", candidates: [{ fact_id: "FACT-014", relation: "CONTRADICTS", quote: "Active customer teams: 8,200" }] },
      facts, DATE,
    );
    expect(r).toMatchObject({ status: "CONTRADICTED", fact_id: "FACT-014" });
  });

  it("SUPPORTED: free 14-day trial", () => {
    const r = decideClaim(
      { text: "free 14-day trial", type: "number", candidates: [{ fact_id: "FACT-007", relation: "ENTAILS", quote: "14 days" }] },
      facts, DATE,
    );
    expect(r.status).toBe("SUPPORTED");
  });

  it("OUTDATED: fact expired before the planned publish date", () => {
    const r = decideClaim(
      { text: "ISO 27001 certified", type: "certification", candidates: [{ fact_id: "FACT-031", relation: "ENTAILS", quote: "ISO 27001 certified" }] },
      facts, DATE,
    );
    expect(r).toMatchObject({ status: "OUTDATED", fact_id: "FACT-031" });
  });

  it("OUTDATED: fact valid today but expiring before publish date", () => {
    const r = decideClaim(
      { text: "8,200 teams", type: "number", candidates: [{ fact_id: "FACT-014", relation: "ENTAILS", quote: "8,200" }] },
      facts, "2027-02-01",
    );
    expect(r.status).toBe("OUTDATED");
  });

  it("OUTDATED: replaced fact", () => {
    const r = decideClaim(
      { text: "available in 12 languages", type: "number", candidates: [{ fact_id: "FACT-040", relation: "ENTAILS", quote: "12" }] },
      facts, DATE,
    );
    expect(r.reason).toContain("replaced by FACT-041");
  });

  it("embargoed fact cannot support a claim yet", () => {
    const r = decideClaim(
      { text: "SOC 2 Type II report available", type: "certification", candidates: [{ fact_id: "FACT-050", relation: "ENTAILS", quote: "SOC 2 Type II" }] },
      facts, DATE,
    );
    expect(r.status).not.toBe("SUPPORTED");
  });

  it("UNSUPPORTED: superlative with no related fact", () => {
    const r = decideClaim({ text: "the fastest platform in India", type: "superlative", candidates: [] }, facts, DATE);
    expect(r.status).toBe("UNSUPPORTED");
  });

  it("HUMAN_JUDGEMENT: AI and code disagree on the numbers", () => {
    const r = decideClaim(
      { text: "trusted by 10,000 teams", type: "number", candidates: [{ fact_id: "FACT-014", relation: "ENTAILS", quote: "8,200" }] },
      facts, DATE,
    );
    expect(r.status).toBe("HUMAN_JUDGEMENT");
  });

  it("HUMAN_JUDGEMENT: quote not in fact", () => {
    const r = decideClaim(
      { text: "trusted by 10,000 teams", type: "number", candidates: [{ fact_id: "FACT-014", relation: "CONTRADICTS", quote: "9,000 teams" }] },
      facts, DATE,
    );
    expect(r.status).toBe("HUMAN_JUDGEMENT");
  });

  it("HUMAN_JUDGEMENT: invented fact id", () => {
    const r = decideClaim(
      { text: "x", type: "number", candidates: [{ fact_id: "FACT-999", relation: "ENTAILS", quote: "x" }] },
      facts, DATE,
    );
    expect(r.status).toBe("HUMAN_JUDGEMENT");
  });
});
