import { describe, expect, it, vi } from "vitest";
import { assemble, type FactRow, type SourceCheck } from "./pipeline";
import { assertFetchable, domainAllowed, findClaimInPages, findFactInPage, htmlToText, isPrivateIp, outcomeFor, safeFetch, SourceError } from "./sources";

const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
const privateDns = async () => [{ address: "10.0.0.5", family: 4 }];
const html = (body: string, init: ResponseInit = {}) => new Response(`<html><head><style>x{}</style><script>alert(1)</script></head><body>${body}</body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });

describe("SSRF guard", () => {
  it("blocks private, loopback and link-local addresses", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateIp(ip)).toBe(true);
    expect(isPrivateIp("93.184.216.34")).toBe(false);
  });

  it("only fetches https URLs on the workspace's trusted domains", async () => {
    expect(domainAllowed("docs.example.org", ["example.org"])).toBe(true);
    expect(domainAllowed("evilexample.org", ["example.org"])).toBe(false);
    await expect(assertFetchable("http://example.org/a", ["example.org"], publicDns as never)).rejects.toThrow(/https/);
    await expect(assertFetchable("https://other.org/a", ["example.org"], publicDns as never)).rejects.toThrow(/trusted source list/);
    await expect(assertFetchable("https://example.org/a", ["example.org"], privateDns as never)).rejects.toThrow(/private address/);
    await expect(assertFetchable("https://example.org/a", ["example.org"], publicDns as never)).resolves.toBeInstanceOf(URL);
  });

  it("re-checks every redirect hop against the allowlist", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://attacker.test/x" } }));
    await expect(safeFetch("https://example.org/a", ["example.org"], fetcher as never, publicDns as never)).rejects.toMatchObject({ outcome: "blocked" });
  });
});

describe("source failures are reported, never guessed", () => {
  it.each([
    ["timeout", async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }, /No response within 8 s/],
    ["network", async () => { throw new TypeError("fetch failed"); }, /Network error/],
    ["HTTP 503", async () => new Response("down", { status: 503 }), /HTTP 503/],
    ["binary", async () => new Response("x", { headers: { "content-type": "application/pdf" } }), /content type/],
  ])("%s → unavailable", async (_n, fetcher, msg) => {
    const err = await safeFetch("https://example.org/a", ["example.org"], fetcher as never, publicDns as never).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.outcome).toBe("unavailable");
    expect(err.message).toMatch(msg);
  });

  it("returns page text without scripts or styles", async () => {
    const r = await safeFetch("https://example.org/a", ["example.org"], (async () => html("<p>Canon Demo Co. serves <b>1,200</b> customers.</p>")) as never, publicDns as never);
    expect(r.text).toBe("Canon Demo Co. serves 1,200 customers.");
    expect(htmlToText("a&amp;b &#8217; &nbsp;c")).toBe("a&b ’ c");
  });
});

describe("matching retrieved text to facts and claims", () => {
  const fact = { text: "Canon Demo Co. serves 1,200 customers.", value: 1200, tolerance: 0 };

  it("confirms a fact only when the number appears next to its own words", () => {
    expect(findFactInPage(fact, "As of Q3, Canon Demo Co. serves 1,200 customers in 9 countries.")).toMatchObject({ found: true });
    expect(findFactInPage(fact, "Canon Demo Co. serves 1,500 customers.").found).toBe(false);
    expect(findFactInPage(fact, "Our office has 1,200 chairs.").found).toBe(false);
    expect(findFactInPage({ text: "Canon Demo Co. is ISO 27001 certified.", value: null, tolerance: 0 }, "Today Canon Demo Co. is ISO 27001 certified!").found).toBe(true);
  });

  it("classifies a page that stopped confirming a fact as changed", () => {
    expect(outcomeFor(true, null)).toBe("confirmed");
    expect(outcomeFor(false, null)).toBe("not_found");
    expect(outcomeFor(false, "confirmed")).toBe("changed");
    expect(outcomeFor(false, "unavailable")).toBe("not_found");
  });

  it("finds a claim on a trusted page and copies the words", () => {
    const hit = findClaimInPages("the fastest-growing platform in India", [{ url: "https://x.org", retrieved_at: "2026-11-14T00:00:00Z", page_text: "Analysts call it the fastest-growing platform in India this year." }]);
    expect(hit?.excerpt).toContain("fastest-growing platform in india");
    expect(findClaimInPages("now available in 12 countries", [{ url: "u", retrieved_at: "t", page_text: "We operate in 9 countries." }])).toBeNull();
  });
});

describe("Claims Ledger with source evidence", () => {
  const facts: FactRow[] = [
    { code: "FACT-1", version: 2, text: "Canon Demo Co. serves 1,200 customers.", value: 1200, tolerance: 0, valid_from: null, valid_until: null, replaced_by: null, confidential: false, source_url: "https://demo.test/q3", owner: "Finance" },
  ];
  const ai = {
    findings: [],
    claims: [
      { text: "Trusted by over 1,000 customers", type: "number" as const, candidates: [{ fact_id: "FACT-1", relation: "ENTAILS" as const, quote: "serves 1,200 customers" }] },
      { text: "the fastest-growing platform in India", type: "superlative" as const, candidates: [] },
    ],
  };
  const draft = "Trusted by over 1,000 customers. We are the fastest-growing platform in India.";
  const check = (outcome: SourceCheck["outcome"], version = 2): SourceCheck => ({ fact_code: "FACT-1", fact_version: version, url: "https://demo.test/q3", retrieved_at: "2026-11-14T08:00:00Z", outcome, excerpt: outcome === "confirmed" ? "serves 1,200 customers" : null, http_status: 200, error: null });

  it("keeps SUPPORTED and attaches register and retrieved evidence separately", () => {
    const { claims } = assemble(draft, [], facts, "2026-12-01", ai, { sourceChecks: new Map([["FACT-1", check("confirmed")]]) });
    expect(claims[0].status).toBe("SUPPORTED");
    expect(claims[0].evidence.map((e) => e.kind)).toEqual(["register", "external"]);
    expect(claims[0].ai_candidates).toEqual(ai.claims[0].candidates);
  });

  it("marks the claim OUTDATED when the fact's source changed", () => {
    const { claims, findings } = assemble(draft, [], facts, "2026-12-01", ai, { sourceChecks: new Map([["FACT-1", check("changed")]]) });
    expect(claims[0].status).toBe("OUTDATED");
    expect(claims[0].reason).toMatch(/no longer confirmed by its source/);
    expect(findings.some((f) => f.severity === "blocking" && f.draft_quote === "Trusted by over 1,000 customers")).toBe(true);
  });

  it("never changes a status because a source was unreachable, and says it was not checked", () => {
    const { claims } = assemble(draft, [], facts, "2026-12-01", ai, { sourceChecks: new Map([["FACT-1", check("unavailable")]]) });
    expect(claims[0].status).toBe("SUPPORTED");
    expect(claims[0].reason).toMatch(/could not be retrieved .* it was not checked/);
  });

  it("ignores a check made against an older fact version", () => {
    const { claims } = assemble(draft, [], facts, "2026-12-01", ai, { sourceChecks: new Map([["FACT-1", check("changed", 1)]]) });
    expect(claims[0].status).toBe("SUPPORTED");
  });

  it("an external mention leaves an unsupported claim UNSUPPORTED, with the evidence attached for a reviewer", () => {
    const pages = [{ url: "https://press.test/a", retrieved_at: "2026-11-14T08:00:00Z", page_text: "Analysts call it the fastest-growing platform in India." }];
    const { claims } = assemble(draft, [], facts, "2026-12-01", ai, { externalPages: pages });
    expect(claims[1].status).toBe("UNSUPPORTED");
    expect(claims[1].evidence[0]).toMatchObject({ kind: "external", role: "claim_mention", url: "https://press.test/a" });
    expect(claims[1].reason).toMatch(/evidence for a reviewer, not an approved fact/);
  });
});
