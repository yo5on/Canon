// Deterministic code checks (Module C): banned terms only in Round 2. Verified by construction:
// code finds the term at exact offsets in the draft, so no AI quote is involved.

export interface CodeRule {
  code: string;
  version: number;
  text: string;
  category: string;
  severity: "blocking" | "advisory";
  banned_term: string;
  replacement: string | null;
}

export interface CodeHit {
  rule: CodeRule;
  start: number;
  end: number;
  quote: string; // the draft's own spelling, e.g. "Users"
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every whole-word, case-insensitive occurrence of each banned term, in draft order. */
export function bannedTermHits(draft: string, rules: CodeRule[]): CodeHit[] {
  const hits: CodeHit[] = [];
  for (const rule of rules) {
    const term = rule.banned_term.trim();
    if (!term) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, "giu");
    for (const m of draft.matchAll(re)) hits.push({ rule, start: m.index, end: m.index + m[0].length, quote: m[0] });
  }
  return hits.sort((a, b) => a.start - b.start);
}
