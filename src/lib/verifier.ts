// Citation verifier (Round 1 spec p.24). Pure code, no AI: a finding is shown as
// fact only if all four checks pass; otherwise it becomes "needs human judgement".

export type SourceKind = "rule" | "fact";

export interface Source {
  id: string; // e.g. "VOICE-03", "FACT-014"
  kind: SourceKind;
  version: number;
  text: string; // stored word for word
  category: string; // rules: tone | terminology | claim | messaging | ... ; facts: always "claim"
}

export interface RawFinding {
  source_id: string;
  source_quote: string;
  draft_quote: string;
  category: string;
}

export type CheckName = "id_current" | "quote_in_source" | "words_in_draft" | "type_fits";

export interface VerifyResult {
  verified: boolean;
  failed: CheckName[];
  // offsets into the ORIGINAL draft text, found by code (the model never counts characters)
  draftStart: number | null;
  draftEnd: number | null;
  source: Source | null;
}

export const MIN_QUOTE_CHARS = 12;

const CHAR_MAP: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
};

/**
 * Normalise text (NFKC, lowercase, curly quotes/dashes, collapsed whitespace) and keep,
 * for every output char, the index of the original char it came from.
 */
export function normalizeWithMap(input: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let lastWasSpace = true; // trims leading whitespace
  let i = 0;
  for (const ch of input) {
    let n = ch.normalize("NFKC").toLowerCase();
    n = Array.from(n).map((c) => CHAR_MAP[c] ?? c).join("");
    for (const c of n) {
      if (/\s/.test(c)) {
        if (lastWasSpace) continue;
        text += " ";
        map.push(i);
        lastWasSpace = true;
      } else {
        text += c;
        map.push(i);
        lastWasSpace = false;
      }
    }
    i += ch.length;
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    map.pop();
  }
  map.push(input.length); // sentinel for end offsets
  return { text, map };
}

export const normalize = (s: string) => normalizeWithMap(s).text;

export function verifyFinding(
  f: RawFinding,
  sentSources: Map<string, Source>,
  draft: string,
): VerifyResult {
  const failed: CheckName[] = [];
  const source = sentSources.get(f.source_id) ?? null;

  // 1. ID is current: it must be one of the sources sent in this request (at their current version).
  if (!source) failed.push("id_current");

  // 2. Quote is in the source: exact substring after normalisation, >= 12 chars or the whole text.
  if (source) {
    const q = normalize(f.source_quote);
    const s = normalize(source.text);
    const longEnough = q.length >= Math.min(MIN_QUOTE_CHARS, s.length);
    if (!q || !longEnough || !s.includes(q)) failed.push("quote_in_source");
  }

  // 3. Words are in the draft: exact substring of this version; code finds offsets.
  let draftStart: number | null = null;
  let draftEnd: number | null = null;
  const d = normalizeWithMap(draft);
  const dq = normalize(f.draft_quote);
  const at = dq ? d.text.indexOf(dq) : -1;
  if (at < 0) failed.push("words_in_draft");
  else {
    draftStart = d.map[at];
    // end = original index just after the last matched char
    const lastOrig = d.map[at + dq.length - 1];
    draftEnd = lastOrig + (draft.codePointAt(lastOrig)! > 0xffff ? 2 : 1);
  }

  // 4. Type fits: a tone finding cannot cite a palette rule.
  if (source && source.category !== f.category) failed.push("type_fits");

  return { verified: failed.length === 0, failed, draftStart, draftEnd, source };
}
