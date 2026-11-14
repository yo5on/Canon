// Turns code-check hits and the model's proposals into the rows we store (ROUND2_PLAN §3–4).
// Pure: no I/O. Severity always comes from our rule rows; the model's quotes are checked by verifier.ts
// and every claim status is decided by ledger.ts.
import type { ModelOutput } from "./ai";
import { bannedTermHits, type CodeRule } from "./codechecks";
import { decideClaim, isBlocking, type ClaimStatus, type Fact } from "./ledger";
import { findClaimInPages } from "./sources";
import { normalize, verifyFinding, type CheckName, type Source } from "./verifier";

export type Severity = "blocking" | "advisory";

export interface RuleRow {
  code: string;
  version: number;
  text: string;
  category: string;
  severity: Severity;
  check_kind: "ai" | "code";
  banned_term: string | null;
  replacement: string | null;
  check_type?: string;
  params?: Record<string, unknown> | null;
}

export interface FactRow {
  code: string;
  version: number;
  text: string;
  value: number | string | null;
  tolerance: number | string;
  valid_from: string | null;
  valid_until: string | null;
  replaced_by: string | null;
  confidential: boolean;
  source_url?: string | null;
  source_ref?: string | null;
  owner?: string;
}

/** Latest retrieval of a fact's cited source (source_checks row). */
export interface SourceCheck {
  fact_code: string;
  fact_version: number;
  url: string;
  retrieved_at: string;
  outcome: "confirmed" | "not_found" | "changed" | "unavailable" | "blocked";
  excerpt: string | null;
  http_status: number | null;
  error: string | null;
}

/** Evidence copied onto a claim at run time. "register" comes from our database; "external" was retrieved by code. */
export type Evidence =
  | { kind: "register"; fact_code: string; fact_version: number; text: string; owner: string; source_ref: string | null; valid_from: string | null; valid_until: string | null }
  | { kind: "external"; role: "fact_source" | "claim_mention"; url: string; retrieved_at: string; outcome: string; excerpt: string | null; http_status: number | null; error: string | null; fact_code?: string };

export interface FindingRow {
  origin: "code" | "ai";
  source_code: string | null;
  source_version: number | null;
  source_text: string | null; // from OUR database, never from the model
  source_quote: string | null;
  draft_quote: string;
  draft_start: number | null;
  draft_end: number | null;
  category: string;
  severity: Severity;
  verified: boolean;
  failed_checks: CheckName[];
  explanation: string;
  fix_replace: string | null;
  fix_with: string | null;
  confidence: number | null;
  region?: Record<string, number> | null;
}

export interface ClaimRow {
  text: string;
  type: string;
  status: ClaimStatus | null;
  fact_code: string | null;
  reason: string;
  finding_index: number | null; // index into findings, for claims.finding_id
  evidence: Evidence[];
  ai_candidates: unknown; // the model's suggestion, stored apart from evidence and never shown as evidence
}

export interface AssembleOptions {
  sourceChecks?: Map<string, SourceCheck>; // keyed by fact code, current version only
  externalPages?: { url: string; retrieved_at: string; page_text: string }[];
}

export const aiRules = (rules: RuleRow[]) => rules.filter((r) => r.check_kind === "ai");

const toLedgerFact = (f: FactRow, check?: SourceCheck): Fact => ({
  id: f.code,
  text: f.text,
  value: f.value === null ? null : Number(f.value),
  tolerance: Number(f.tolerance),
  valid_from: f.valid_from,
  valid_until: f.valid_until,
  replaced_by: f.replaced_by,
  // Only a page that confirmed the fact before and no longer does retires it. An unreachable source changes nothing.
  source_changed: check?.outcome === "changed" ? `${check.url} (retrieved ${check.retrieved_at.slice(0, 10)})` : null,
});

const ruleSource = (r: RuleRow): Source => ({ id: r.code, kind: "rule", version: r.version, text: r.text, category: r.category });

/** Unsupported claims cite the kit's claim rule, but only when exactly one exists; otherwise a human decides. */
// shortcut: no per-claim-type rule mapping; add one when kits have several claim rules
function claimRule(rules: RuleRow[]) {
  const claimRules = rules.filter((r) => r.category === "claim");
  return claimRules.length === 1 ? claimRules[0] : null;
}

export function assemble(
  draft: string,
  rules: RuleRow[],
  facts: FactRow[],
  publishDate: string,
  ai: ModelOutput | null,
  opts: AssembleOptions = {},
): { findings: FindingRow[]; claims: ClaimRow[] } {
  const findings: FindingRow[] = [];
  const claims: ClaimRow[] = [];

  const codeRules = rules.filter((r): r is RuleRow & CodeRule => r.check_kind === "code" && (r.check_type ?? "banned_term") === "banned_term" && !!r.banned_term);
  for (const h of bannedTermHits(draft, codeRules)) {
    findings.push({
      origin: "code",
      source_code: h.rule.code,
      source_version: h.rule.version,
      source_text: h.rule.text,
      source_quote: h.rule.text,
      draft_quote: h.quote,
      draft_start: h.start,
      draft_end: h.end,
      category: h.rule.category,
      severity: h.rule.severity,
      verified: true,
      failed_checks: [],
      explanation: `“${h.quote}” is a banned term.`,
      fix_replace: h.rule.replacement ? h.quote : null,
      fix_with: h.rule.replacement,
      confidence: null,
    });
  }
  if (!ai) return { findings, claims };

  const sent = aiRules(rules);
  const ruleByCode = new Map(sent.map((r) => [r.code, r]));
  const sources = new Map(sent.map((r) => [r.code, ruleSource(r)]));
  const normDraft = normalize(draft);

  for (const f of ai.findings) {
    const v = verifyFinding(f, sources, draft);
    const rule = ruleByCode.get(f.source_id);
    // A fix is only offered if the words it replaces really are in the draft.
    const fixOk = !!f.fix && !!normalize(f.fix.replace) && normDraft.includes(normalize(f.fix.replace));
    findings.push({
      origin: "ai",
      source_code: f.source_id,
      source_version: rule?.version ?? null,
      source_text: rule?.text ?? null,
      source_quote: f.source_quote,
      draft_quote: f.draft_quote,
      draft_start: v.draftStart,
      draft_end: v.draftEnd,
      category: f.category,
      severity: v.verified && rule ? rule.severity : "advisory", // unverified never blocks
      verified: v.verified,
      failed_checks: v.failed,
      explanation: f.explanation,
      fix_replace: fixOk ? f.fix!.replace : null,
      fix_with: fixOk ? f.fix!.with : null,
      confidence: f.confidence,
    });
  }

  const sendable = facts.filter((f) => !f.confidential);
  const checks = opts.sourceChecks ?? new Map<string, SourceCheck>();
  const checkFor = (f: FactRow) => {
    const c = checks.get(f.code);
    return c && c.fact_version === f.version ? c : undefined;
  };
  const ledgerFacts = new Map(sendable.map((f) => [f.code, toLedgerFact(f, checkFor(f))]));
  const factByCode = new Map(sendable.map((f) => [f.code, f]));
  const fallbackRule = claimRule(sent);

  for (const c of ai.claims) {
    // A proposal about words absent from the draft must never enter the ledger.
    if (!normalize(c.text) || !normDraft.includes(normalize(c.text))) continue;
    const res = decideClaim(c, ledgerFacts, publishDate);
    let finding_index: number | null = null;

    if (isBlocking(res.status)) {
      const fact = res.fact_id ? factByCode.get(res.fact_id) : undefined;
      const rule = fact ? null : fallbackRule;
      const src: Source | null = fact
        ? { id: fact.code, kind: "fact", version: fact.version, text: fact.text, category: "claim" }
        : rule && ruleSource(rule);
      // The ledger already checked the model's fact quote; the finding quotes the whole source from our DB.
      const quote = src?.text ?? "";
      // Code re-checks that the claim's words are in the draft and finds their offsets.
      const v = verifyFinding(
        { source_id: src?.id ?? "", source_quote: quote, draft_quote: c.text, category: "claim" },
        new Map(src ? [[src.id, src]] : []),
        draft,
      );
      finding_index =
        findings.push({
          origin: "ai",
          source_code: src?.id ?? null,
          source_version: src?.version ?? null,
          source_text: src?.text ?? null,
          source_quote: src ? quote : null,
          draft_quote: c.text,
          draft_start: v.draftStart,
          draft_end: v.draftEnd,
          category: "claim",
          severity: v.verified ? (rule ? rule.severity : "blocking") : "advisory",
          verified: v.verified,
          failed_checks: v.failed,
          explanation: `Claim is ${res.status!.toLowerCase()}: ${res.reason}`,
          fix_replace: null,
          fix_with: null,
          confidence: null,
        }) - 1;
    }
    // Evidence is copied from our database and from pages code retrieved — never from the model.
    const evidence: Evidence[] = [];
    let reason = res.reason;
    const fact = res.fact_id ? factByCode.get(res.fact_id) : undefined;
    if (fact) {
      evidence.push({ kind: "register", fact_code: fact.code, fact_version: fact.version, text: fact.text, owner: fact.owner ?? "", source_ref: fact.source_ref ?? null, valid_from: fact.valid_from, valid_until: fact.valid_until });
      const chk = checkFor(fact);
      if (chk) {
        evidence.push({ kind: "external", role: "fact_source", url: chk.url, retrieved_at: chk.retrieved_at, outcome: chk.outcome, excerpt: chk.excerpt, http_status: chk.http_status, error: chk.error, fact_code: fact.code });
        if (chk.outcome === "unavailable") reason += `. Source ${chk.url} could not be retrieved on ${chk.retrieved_at.slice(0, 10)}; it was not checked`;
        if (chk.outcome === "not_found") reason += `. Note: the cited source does not state this fact (retrieved ${chk.retrieved_at.slice(0, 10)})`;
      } else if (fact.source_url) reason += ". Its source URL has not been retrieved yet";
    }
    if (res.status === "UNSUPPORTED" && opts.externalPages?.length) {
      const hit = findClaimInPages(c.text, opts.externalPages);
      if (hit) {
        evidence.push({ kind: "external", role: "claim_mention", url: hit.url, retrieved_at: hit.retrieved_at, outcome: "mentioned", excerpt: hit.excerpt, http_status: null, error: null });
        reason += `. A trusted source mentions it (${hit.url}); that is evidence for a reviewer, not an approved fact`;
      }
    }
    if (finding_index !== null) findings[finding_index].explanation = `Claim is ${res.status!.toLowerCase()}: ${reason}`;
    claims.push({ text: c.text, type: c.type, status: res.status, fact_code: res.fact_id, reason, finding_index, evidence, ai_candidates: c.candidates });
  }
  return { findings, claims };
}

const FACT_WORD = /[\p{L}\p{N}][\p{L}\p{N},.]*/gu;
const factWords = (s: string) => new Set((normalize(s).match(FACT_WORD) ?? []).map((w) => w.replace(/[,.]+$/, "")).filter((w) => w.length >= 3));

/**
 * Facts worth sending with this draft: ranked by shared words and numbers, capped at `limit`.
 * Small registers are sent whole, so nothing changes until a kit outgrows one prompt.
 */
export function relevantFacts<T extends { text: string }>(draft: string, facts: T[], limit = 60): T[] {
  if (facts.length <= limit) return facts;
  const d = factWords(draft);
  return facts
    .map((f, i) => ({ f, i, score: [...factWords(f.text)].filter((w) => d.has(w)).length }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.f);
}
