import { describe, expect, it } from "vitest";
import { normalize, verifyFinding, type Source } from "./verifier";

const sources = new Map<string, Source>([
  ["VOICE-03", { id: "VOICE-03", kind: "rule", version: 1, text: "Be confident, not arrogant.", category: "tone" }],
  ["TERM-11", { id: "TERM-11", kind: "rule", version: 1, text: "Avoid jargon in social posts.", category: "terminology" }],
  ["FACT-014", { id: "FACT-014", kind: "fact", version: 1, text: "Active customer teams: 8,200", category: "claim" }],
]);

const draft =
  "Meet Canon Insights — the fastest platform in India, trusted by 10,000 teams. It’s cheap to start.";

describe("normalize", () => {
  it("folds case, curly quotes, dashes and whitespace", () => {
    expect(normalize("  It’s  “Great” — OK\n")).toBe(`it's "great" - ok`);
  });
  it("applies NFKC", () => {
    expect(normalize("ﬁne")).toBe("fine");
  });
});

describe("verifyFinding", () => {
  it("passes a genuine citation and finds offsets in the original draft", () => {
    const r = verifyFinding(
      { source_id: "FACT-014", source_quote: "Active customer teams: 8,200", draft_quote: "trusted by 10,000 teams", category: "claim" },
      sources,
      draft,
    );
    expect(r.verified).toBe(true);
    expect(draft.slice(r.draftStart!, r.draftEnd!)).toBe("trusted by 10,000 teams");
  });

  it("matches across curly/straight quote differences", () => {
    const r = verifyFinding(
      { source_id: "VOICE-03", source_quote: "be confident, not arrogant", draft_quote: "It's cheap", category: "tone" },
      sources,
      draft,
    );
    expect(r.verified).toBe(true);
    expect(draft.slice(r.draftStart!, r.draftEnd!)).toBe("It’s cheap");
  });

  it("rejects an invented ID", () => {
    const r = verifyFinding({ source_id: "TERM-99", source_quote: "x", draft_quote: "cheap", category: "terminology" }, sources, draft);
    expect(r.failed).toContain("id_current");
    expect(r.verified).toBe(false);
  });

  it("rejects a quote that is not in the cited rule (wireframe example)", () => {
    const r = verifyFinding(
      { source_id: "TERM-11", source_quote: "avoid buzzwords", draft_quote: "cheap", category: "terminology" },
      sources,
      draft,
    );
    expect(r.failed).toEqual(["quote_in_source"]);
  });

  it("rejects a paraphrased (altered) quote — no fuzzy matching", () => {
    const r = verifyFinding(
      { source_id: "FACT-014", source_quote: "Active customer teams: 8,300", draft_quote: "10,000 teams", category: "claim" },
      sources,
      draft,
    );
    expect(r.failed).toContain("quote_in_source");
  });

  it("rejects a too-short quote fragment", () => {
    const r = verifyFinding({ source_id: "VOICE-03", source_quote: "not", draft_quote: "cheap", category: "tone" }, sources, draft);
    expect(r.failed).toContain("quote_in_source");
  });

  it("rejects draft words that are not in this version", () => {
    const r = verifyFinding(
      { source_id: "VOICE-03", source_quote: "Be confident, not arrogant.", draft_quote: "the only tool you need", category: "tone" },
      sources,
      draft,
    );
    expect(r.failed).toEqual(["words_in_draft"]);
    expect(r.draftStart).toBeNull();
  });

  it("rejects a category mismatch", () => {
    const r = verifyFinding(
      { source_id: "VOICE-03", source_quote: "Be confident, not arrogant.", draft_quote: "cheap", category: "claim" },
      sources,
      draft,
    );
    expect(r.failed).toEqual(["type_fits"]);
  });
});
