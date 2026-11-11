// Turns code-check hits and the model's proposals into the rows we store (ROUND2_PLAN §3–4).
// Pure: no I/O. Severity always comes from our rule rows; the model's quotes are checked by verifier.ts
// and every claim status is decided by ledger.ts.
import type { ModelOutput } from "./ai";
import { bannedTermHits, type CodeRule } from "./codechecks";
import { decideClaim, isBlocking, type ClaimStatus, type Fact } from "./ledger";
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
}

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
}

export interface ClaimRow {
  text: string;
  type: string;
  status: ClaimStatus | null;
  fact_code: string | null;
  reason: string;
  finding_index: number | null; // index into findings, for claims.finding_id
}

export const aiRules = (rules: RuleRow[]) => rules.filter((r) => r.check_kind === "ai");

const toLedgerFact = (f: FactRow): Fact => ({
  id: f.code,
  text: f.text,
  value: f.value === null ? null : Number(f.value),
  tolerance: Number(f.tolerance),
  valid_from: f.valid_from,
  valid_until: f.valid_until,
  replaced_by: f.replaced_by,
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
): { findings: FindingRow[]; claims: ClaimRow[] } {
  const findings: FindingRow[] = [];
  const claims: ClaimRow[] = [];

  const codeRules = rules.filter((r): r is RuleRow & CodeRule => r.check_kind === "code" && !!r.banned_term);
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
  const ledgerFacts = new Map(sendable.map((f) => [f.code, toLedgerFact(f)]));
  const factByCode = new Map(sendable.map((f) => [f.code, f]));
  const fallbackRule = claimRule(sent);

  for (const c of ai.claims) {
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
    claims.push({ text: c.text, type: c.type, status: res.status, fact_code: res.fact_id, reason: res.reason, finding_index });
  }
  return { findings, claims };
}
