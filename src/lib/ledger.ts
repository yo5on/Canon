// Claims Ledger status ladder (Round 1 spec p.18). Code — not the model — decides the status.
// First match wins: HUMAN_JUDGEMENT → CONTRADICTED → SUPPORTED → OUTDATED → UNSUPPORTED.
// "SUPPORTED" means "matches the organisation's approved register", not "true in the world".

import { normalize } from "./verifier";

export type ClaimType = "number" | "superlative" | "comparison" | "certification" | "date" | "opinion";
export type Relation = "ENTAILS" | "CONTRADICTS" | "UNRELATED";
export type ClaimStatus = "HUMAN_JUDGEMENT" | "CONTRADICTED" | "SUPPORTED" | "OUTDATED" | "UNSUPPORTED";

export interface Fact {
  id: string;
  text: string;
  value: number | null; // numeric value for code comparison, if the fact is a number
  tolerance: number; // absolute; 0 = exact unless the owner sets one
  valid_from: string | null; // ISO date
  valid_until: string | null; // ISO date
  replaced_by: string | null; // id of the newer fact, if replaced
}

export interface Candidate {
  fact_id: string;
  relation: Relation; // the model's label
  quote: string; // the model's quote from the fact
}

export interface ClaimInput {
  text: string;
  type: ClaimType;
  candidates: Candidate[];
}

export interface ClaimResult {
  status: ClaimStatus | null; // null = opinion, not ledgered
  fact_id: string | null;
  reason: string;
}

const QUALIFIERS = [
  "more than", "over", "at least", "up to", "under", "less than", "nearly", "almost", "about", "around",
] as const;
type Qualifier = (typeof QUALIFIERS)[number] | "exact";

/** Parse the first number in a claim plus the qualifier right before it. "10k" and "1.2 million" are handled. */
export function parseNumber(text: string): { value: number; qualifier: Qualifier } | null {
  const t = normalize(text);
  const m = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|m|million)?\b/);
  if (!m) return null;
  let value = Number(m[1].replace(/,/g, ""));
  if (m[2] === "k" || m[2] === "thousand") value *= 1_000;
  if (m[2] === "m" || m[2] === "million") value *= 1_000_000;
  const before = t.slice(0, m.index).trimEnd();
  const qualifier = QUALIFIERS.find((q) => before.endsWith(q)) ?? "exact";
  return { value, qualifier };
}

/** Does the fact's value make the claim true? Code's own relation, independent of the model. */
export function compareNumber(claim: { value: number; qualifier: Qualifier }, fact: number, tol: number): Relation {
  const c = claim.value;
  const ok = (() => {
    switch (claim.qualifier) {
      case "more than":
      case "over":
        return fact > c;
      case "at least":
        return fact >= c;
      case "up to":
        return fact <= c + tol;
      case "under":
      case "less than":
        return fact < c;
      // shortcut: "nearly"/"about" use fixed 5% bands; upgrade to owner-set bands if fact owners ask
      case "nearly":
      case "almost":
        return fact < c && fact >= c * 0.95;
      case "about":
      case "around":
        return Math.abs(fact - c) <= c * 0.05;
      case "exact":
        return Math.abs(fact - c) <= tol;
    }
  })();
  return ok ? "ENTAILS" : "CONTRADICTS";
}

export function isValidOn(f: Fact, date: string): boolean {
  if (f.replaced_by) return false;
  if (f.valid_from && date < f.valid_from) return false; // embargoed fact cannot support a claim yet
  if (f.valid_until && date > f.valid_until) return false;
  return true;
}

export function decideClaim(claim: ClaimInput, facts: Map<string, Fact>, publishDate: string): ClaimResult {
  if (claim.type === "opinion") return { status: null, fact_id: null, reason: "Opinion or puffery — left to tone rules" };

  const num = parseNumber(claim.text);
  const related: { fact: Fact; relation: Relation; valid: boolean }[] = [];

  for (const c of claim.candidates) {
    if (c.relation === "UNRELATED") continue;
    const fact = facts.get(c.fact_id);
    // 1. Quote fails verification → human judgement
    if (!fact) return { status: "HUMAN_JUDGEMENT", fact_id: c.fact_id, reason: `AI cited unknown fact ${c.fact_id}` };
    const q = normalize(c.quote);
    if (!q || !normalize(fact.text).includes(q))
      return { status: "HUMAN_JUDGEMENT", fact_id: fact.id, reason: `Quote not found in ${fact.id}` };

    let relation = c.relation;
    if (num && fact.value !== null) {
      const codeRel = compareNumber(num, fact.value, fact.tolerance);
      // 1. Code and AI disagree on the numbers → human judgement
      if (codeRel !== c.relation)
        return {
          status: "HUMAN_JUDGEMENT",
          fact_id: fact.id,
          reason: `AI said ${c.relation}, code comparison of ${num.value} vs ${fact.value} says ${codeRel}`,
        };
      relation = codeRel;
    }
    related.push({ fact, relation, valid: isValidOn(fact, publishDate) });
  }

  const validRel = related.filter((r) => r.valid);
  const contra = validRel.find((r) => r.relation === "CONTRADICTS");
  if (contra) return { status: "CONTRADICTED", fact_id: contra.fact.id, reason: `Conflicts with ${contra.fact.id}: "${contra.fact.text}"` };
  const sup = validRel.find((r) => r.relation === "ENTAILS");
  if (sup) return { status: "SUPPORTED", fact_id: sup.fact.id, reason: `Matches ${sup.fact.id}, valid on ${publishDate}` };
  const old = related[0];
  if (old) {
    const why = old.fact.replaced_by ? `replaced by ${old.fact.replaced_by}` : `not valid on ${publishDate}`;
    return { status: "OUTDATED", fact_id: old.fact.id, reason: `${old.fact.id} is ${why}` };
  }
  return { status: "UNSUPPORTED", fact_id: null, reason: "No approved fact supports this claim" };
}

/** Contradicted, outdated and unsupported objective claims are blocking by default. */
export const isBlocking = (s: ClaimStatus | null) => s === "CONTRADICTED" || s === "OUTDATED" || s === "UNSUPPORTED";
