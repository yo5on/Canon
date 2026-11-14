// Visual and accessibility code checks for image assets (Round 3 · Improvement 1). Pure code, no AI:
// contrast ratio of each OCR line (WCAG 2.2), dominant colours against the brand palette, and alt text.
// Every finding cites the rule row it came from and a region of the asset that code checks lies inside the image.
import { fromHex, type Extraction, type Region } from "./extract";
import type { FindingRow, RuleRow } from "./pipeline";

export interface VisualRule extends RuleRow {
  check_type: "banned_term" | "contrast" | "palette" | "alt_text";
  params: Record<string, unknown> | null;
}

/** CIE76 ΔE between two sRGB colours (good enough to tell "brand green" from "orange"). */
export function deltaE(a: number[], b: number[]) {
  const lab = (rgb: number[]) => {
    const [r, g, bl] = rgb.map((c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    const x = (r * 0.4124 + g * 0.3576 + bl * 0.1805) / 0.95047;
    const y = r * 0.2126 + g * 0.7152 + bl * 0.0722;
    const z = (r * 0.0193 + g * 0.1192 + bl * 0.9505) / 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

export const regionInside = (r: Region | undefined, w: number, h: number) =>
  !!r && r.w > 0 && r.h > 0 && r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : d);

/** Brand palette from a rule's params: ["#28645A", ...] or [{hex}]. Invalid entries are ignored. */
export function paletteOf(params: Record<string, unknown> | null): string[] {
  const raw = Array.isArray(params?.colors) ? params.colors : [];
  return raw.map((c) => (typeof c === "string" ? c : (c as { hex?: string })?.hex ?? "")).filter((c) => fromHex(c));
}

function base(rule: VisualRule, quote: string, explanation: string, region: Region | null, w: number, h: number, start: number | null = null, end: number | null = null): FindingRow & { region: (Region & { image_w: number; image_h: number }) | null } {
  const ok = region === null || regionInside(region, w, h);
  return {
    origin: "code",
    source_code: rule.code,
    source_version: rule.version,
    source_text: rule.text,
    source_quote: rule.text,
    draft_quote: quote,
    draft_start: start,
    draft_end: end,
    category: rule.category,
    severity: ok ? rule.severity : "advisory",
    verified: ok,
    failed_checks: ok ? [] : (["region_in_asset"] as never[]),
    explanation,
    fix_replace: null,
    fix_with: null,
    confidence: null,
    region: region ? { ...region, image_w: w, image_h: h } : null,
  };
}

export function visualFindings(rules: VisualRule[], body: string, ex: Extraction | null, altText: string | null) {
  if (!ex || ex.kind !== "image" || !ex.image) return [];
  const { width: w, height: h, palette } = ex.image;
  const out: ReturnType<typeof base>[] = [];

  for (const rule of rules.filter((r) => r.check_kind === "code")) {
    if (rule.check_type === "contrast") {
      const min = num(rule.params?.min_ratio, 4.5);
      for (const s of ex.segments) {
        if (s.contrast === undefined || s.contrast >= min) continue;
        out.push(
          base(
            rule,
            body.slice(s.start, s.end),
            `Text contrast is ${s.contrast.toFixed(2)}:1 (${s.fg} on ${s.bg}); the rule needs at least ${min}:1. Measured by code from the image pixels.`,
            s.region ?? null,
            w,
            h,
            s.start,
            s.end,
          ),
        );
      }
    } else if (rule.check_type === "palette") {
      const brand = paletteOf(rule.params).map((hex) => ({ hex, rgb: fromHex(hex)! }));
      if (!brand.length) continue;
      const maxDelta = num(rule.params?.max_delta, 12);
      const minShare = num(rule.params?.min_share, 0.03);
      for (const c of palette) {
        if (c.share < minShare) continue;
        const rgb = fromHex(c.hex)!;
        const near = brand.map((b) => ({ ...b, d: deltaE(rgb, b.rgb) })).sort((a, b) => a.d - b.d)[0];
        if (near.d <= maxDelta) continue;
        out.push(
          base(
            rule,
            `Colour ${c.hex} · ${Math.round(c.share * 100)}% of the image`,
            `${c.hex} is not in the brand palette. Nearest brand colour is ${near.hex} (ΔE ${near.d.toFixed(1)}, allowed ${maxDelta}).`,
            c.region,
            w,
            h,
          ),
        );
      }
    } else if (rule.check_type === "alt_text") {
      const minLen = num(rule.params?.min_length, 10);
      const alt = (altText ?? "").trim();
      if (alt.length >= minLen) continue;
      out.push(
        base(
          rule,
          alt ? `Alt text: “${alt}”` : "No alt text provided",
          alt ? `Alt text is ${alt.length} characters; the rule asks for a description of at least ${minLen}.` : "The image has no alt text, so screen-reader users get nothing.",
          null,
          w,
          h,
        ),
      );
    }
  }
  return out;
}
