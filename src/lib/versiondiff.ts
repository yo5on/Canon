// What changed between two versions of a rule or fact: field by field, with a word-level diff of the wording.
import DiffMatchPatch from "diff-match-patch";

export type Row = Record<string, unknown>;
export type Part = { op: -1 | 0 | 1; text: string };

const SKIP = new Set(["id", "org_id", "version", "is_current", "created_at", "created_by", "text"]);
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function fieldChanges(before: Row | null, after: Row) {
  return Object.keys(after)
    .filter((k) => !SKIP.has(k) && show(before?.[k]) !== show(after[k]))
    .map((k) => ({ field: k, from: before ? show(before[k]) : "—", to: show(after[k]) }));
}

/** Word-level diff (words are mapped to characters so the diff never splits a word). */
export function textDiff(a: string, b: string): Part[] {
  const dmp = new DiffMatchPatch();
  const words: string[] = [];
  const index = new Map<string, number>();
  const encode = (s: string) =>
    (s.match(/\s+|[^\s]+/g) ?? [])
      .map((w) => {
        if (!index.has(w)) {
          index.set(w, words.length);
          words.push(w);
        }
        return String.fromCharCode(index.get(w)! + 256);
      })
      .join("");
  const diffs = dmp.diff_main(encode(a), encode(b));
  dmp.diff_cleanupSemantic(diffs);
  return diffs.map(([op, chars]) => ({ op: op as Part["op"], text: [...chars].map((c) => words[c.charCodeAt(0) - 256]).join("") }));
}
