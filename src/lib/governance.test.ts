import { describe, expect, it, vi } from "vitest";
import type { Extraction } from "./extract";
import { diffSummary, newIssues, policyDiff } from "./monitor";
import { relevantFacts } from "./pipeline";
import { deltaE, paletteOf, regionInside, visualFindings, type VisualRule } from "./visualchecks";
import { deliver, payload, sign } from "./webhooks";

const rule = (check_type: VisualRule["check_type"], params: Record<string, unknown>, code = "ACC-2"): VisualRule => ({
  code, version: 1, text: "rule text", category: "accessibility", severity: "blocking", check_kind: "code", banned_term: null, replacement: null, check_type, params,
});
const body = "Our revolutionary dashboard\nTrusted by over 1,000 customers";
const ex: Extraction = {
  kind: "image", mime: "image/png", method: "ocr", warnings: [],
  segments: [
    { label: "Line 1", start: 0, end: 27, region: { x: 70, y: 190, w: 860, h: 70 }, contrast: 6.86, fg: "#FFFFFF", bg: "#28645A" },
    { label: "Line 2", start: 28, end: 59, region: { x: 70, y: 410, w: 700, h: 50 }, contrast: 2.31, fg: "#6E9C93", bg: "#28645A" },
  ],
  image: { width: 1200, height: 628, ocr_confidence: 90, palette: [
    { hex: "#28645A", share: 0.8, region: { x: 0, y: 0, w: 1200, h: 628 } },
    { hex: "#F28C28", share: 0.05, region: { x: 860, y: 60, w: 280, h: 120 } },
  ] },
};

describe("visual code checks", () => {
  it("flags low-contrast text with its measured ratio and region", () => {
    const [f, ...rest] = visualFindings([rule("contrast", { min_ratio: 4.5 })], body, ex, "A banner");
    expect(rest).toHaveLength(0);
    expect(f).toMatchObject({ draft_quote: "Trusted by over 1,000 customers", verified: true, severity: "blocking", draft_start: 28 });
    expect(f.explanation).toMatch(/2\.31:1/);
    expect(f.region).toMatchObject({ x: 70, y: 410, image_w: 1200 });
  });

  it("flags off-palette colours and accepts brand colours", () => {
    const fs = visualFindings([rule("palette", { colors: ["#28645A", "#FFFFFF"] }, "BRAND-1")], body, ex, null);
    expect(fs.map((f) => f.draft_quote)).toEqual(["Colour #F28C28 · 5% of the image"]);
    expect(deltaE([40, 100, 90], [40, 100, 90])).toBe(0);
    expect(paletteOf({ colors: ["#28645A", "nope", { hex: "#FFFFFF" }] })).toEqual(["#28645A", "#FFFFFF"]);
  });

  it("requires alt text", () => {
    expect(visualFindings([rule("alt_text", { min_length: 10 })], body, ex, "")[0].draft_quote).toBe("No alt text provided");
    expect(visualFindings([rule("alt_text", { min_length: 10 })], body, ex, "Green launch banner with headline")).toHaveLength(0);
  });

  it("downgrades a finding whose region is outside the asset, and skips non-images", () => {
    const bad = { ...ex, segments: [{ ...ex.segments[1], region: { x: 1100, y: 600, w: 400, h: 100 } }] };
    const [f] = visualFindings([rule("contrast", {})], body, bad, "alt text here");
    expect(f).toMatchObject({ verified: false, severity: "advisory", failed_checks: ["region_in_asset"] });
    expect(regionInside({ x: 0, y: 0, w: 10, h: 10 }, 10, 10)).toBe(true);
    expect(visualFindings([rule("contrast", {})], body, { ...ex, kind: "pdf" }, null)).toEqual([]);
  });
});

describe("policy versions", () => {
  const v1 = { version: 1, rules: [{ code: "TONE-1", version: 1 }, { code: "TERM-1", version: 1 }], facts: [{ code: "FACT-1", version: 1 }] };
  const v2 = { version: 2, rules: [{ code: "TONE-1", version: 2 }, { code: "ACC-2", version: 1 }], facts: [{ code: "FACT-1", version: 1 }] };

  it("lists added, removed and changed rules and facts", () => {
    const d = policyDiff(v1, v2);
    expect(d.rules).toEqual({ added: ["ACC-2"], removed: ["TERM-1"], changed: ["TONE-1 v1→v2"] });
    expect(d.facts).toEqual({ added: [], removed: [], changed: [] });
    expect(diffSummary(d)).toEqual(["rule TONE-1 v1→v2", "rule ACC-2 added", "rule TERM-1 removed"]);
  });

  it("reports only blocking issues the approved run did not have", () => {
    const base = [{ source_code: "FACT-1", draft_quote: "over 1,000 customers", severity: "blocking", verified: true }];
    const now = [...base, { source_code: "FACT-2", draft_quote: "Rated 4.8", severity: "blocking", verified: true }, { source_code: "TONE-1", draft_quote: "x", severity: "advisory", verified: true }];
    expect(newIssues(base, now).map((f) => f.source_code)).toEqual(["FACT-2"]);
  });

  it("sends small registers whole and ranks large ones by overlap with the draft", () => {
    const few = [{ text: "a" }, { text: "b" }];
    expect(relevantFacts("draft", few)).toBe(few);
    const many = Array.from({ length: 80 }, (_, i) => ({ text: `Filler fact number ${i}` })).concat({ text: "Canon serves 1,200 customers" });
    expect(relevantFacts("We serve 1,200 customers", many, 5)[0].text).toBe("Canon serves 1,200 customers");
  });
});

describe("webhooks", () => {
  const hook = { id: "h", org_id: "o", url: "https://hooks.example.org/x", format: "json" as const, secret: "s3cret", events: ["approved"] };
  const dns = async () => [{ address: "93.184.216.34", family: 4 }];

  it("signs JSON payloads and formats Slack messages", () => {
    const body = payload("json", "approved", { title: "Approved: Launch post" }, "2026-11-14T00:00:00Z");
    expect(JSON.parse(body)).toEqual({ event: "approved", at: "2026-11-14T00:00:00Z", data: { title: "Approved: Launch post" } });
    expect(sign("s3cret", body)).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(JSON.parse(payload("slack", "approved", { title: "Approved", link: "https://c/x" })).text).toContain("<https://c/x|Open in Canon>");
  });

  it("records success, HTTP errors, network failures and blocked targets without throwing", async () => {
    const ok = vi.fn(async (_u: unknown, init: RequestInit) => {
      expect((init.headers as Record<string, string>)["x-canon-signature"]).toBe(sign("s3cret", String(init.body)));
      return new Response("ok");
    });
    expect(await deliver(hook, "approved", { title: "t" }, ok as never, dns as never)).toMatchObject({ ok: true, status_code: 200 });
    expect(await deliver(hook, "approved", { title: "t" }, (async () => new Response("", { status: 500 })) as never, dns as never)).toMatchObject({ ok: false, error: "HTTP 500" });
    expect(await deliver(hook, "approved", { title: "t" }, (async () => { throw new TypeError("x"); }) as never, dns as never)).toMatchObject({ ok: false, error: "Network error" });
    const priv = await deliver({ ...hook, url: "https://internal.example.org" }, "approved", { title: "t" }, ok as never, (async () => [{ address: "127.0.0.1", family: 4 }]) as never);
    expect(priv).toMatchObject({ ok: false });
    expect(priv.error).toMatch(/private address/);
  });
});
