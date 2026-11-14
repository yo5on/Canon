// Source intelligence (Round 3 · Improvement 2). Retrieves a fact's cited web page from a workspace-approved domain
// and lets code — not a model — decide whether the page still states the fact. Retrieved text is evidence for a
// human: it never turns a claim SUPPORTED on its own. Server-only.
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parseNumber } from "./ledger";
import { normalize } from "./verifier";

export type Outcome = "confirmed" | "not_found" | "changed" | "unavailable" | "blocked";

export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_PAGE_BYTES = 1_500_000;
export const MAX_STORED_TEXT = 200_000;

export class SourceError extends Error {
  constructor(
    message: string,
    public outcome: "unavailable" | "blocked",
    public status: number | null = null,
  ) {
    super(message);
  }
}

/** Private, loopback, link-local and other non-public addresses: never fetched (SSRF guard). */
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

export const domainAllowed = (host: string, domains: string[]) =>
  domains.some((d) => host === d || host.endsWith("." + d));

/** Throws SourceError("blocked") unless the URL is https on an approved domain that resolves to public addresses. */
export async function assertFetchable(raw: string, domains: string[], resolve = lookup) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SourceError("Not a valid URL.", "blocked");
  }
  if (url.protocol !== "https:") throw new SourceError("Only https sources are retrieved.", "blocked");
  if (url.username || url.password) throw new SourceError("URLs with credentials are not retrieved.", "blocked");
  const host = url.hostname.toLowerCase();
  if (!domainAllowed(host, domains)) throw new SourceError(`${host} is not on this workspace’s trusted source list.`, "blocked");
  const addrs = isIP(host) ? [{ address: host }] : await resolve(host, { all: true }).catch(() => {
    throw new SourceError(`Could not resolve ${host}.`, "unavailable");
  });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new SourceError(`${host} resolves to a private address.`, "blocked");
  return url;
}

/** GET with timeout, size cap and manual redirects (each hop re-checked against the allowlist). */
export async function safeFetch(raw: string, domains: string[], fetcher: typeof fetch = fetch, resolve = lookup) {
  let url = await assertFetchable(raw, domains, resolve);
  for (let hop = 0; hop < 4; hop++) {
    let res: Response;
    try {
      res = await fetcher(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "user-agent": "CanonSourceCheck/1.0 (+brand fact verification)", accept: "text/html,text/plain;q=0.9,*/*;q=0.1" },
      });
    } catch (e) {
      const timeout = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
      throw new SourceError(timeout ? `No response within ${FETCH_TIMEOUT_MS / 1000} s.` : "Network error while retrieving the source.", "unavailable");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertFetchable(new URL(res.headers.get("location")!, url).toString(), domains, resolve);
      continue;
    }
    if (!res.ok) throw new SourceError(`The source answered HTTP ${res.status}.`, "unavailable", res.status);
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/|json|xml/.test(type)) throw new SourceError(`Unsupported content type ${type || "unknown"}.`, "unavailable", res.status);
    const text = await readCapped(res);
    return { url: url.toString(), status: res.status, text: /html|xml/.test(type) ? htmlToText(text) : text };
  }
  throw new SourceError("Too many redirects.", "unavailable");
}

async function readCapped(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let n = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > MAX_PAGE_BYTES) {
      await reader.cancel();
      throw new SourceError("The page is larger than 1.5 MB.", "unavailable");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–" };
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m,
    )
    .replace(/[ \t\f\r]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim();
}

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const STOP = new Set(["this", "that", "with", "from", "have", "more", "than", "over", "they", "your", "their", "into", "about", "been", "were", "will", "only", "also", "now", "and", "the", "for", "our", "are", "out"]);
const words = (s: string) => normalize(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d/.test(w));

const excerptAt = (text: string, at: number, len: number) => {
  const a = Math.max(0, at - 140);
  const b = Math.min(text.length, at + len + 140);
  return (a > 0 ? "…" : "") + text.slice(a, b).replace(/\s+/g, " ").trim() + (b < text.length ? "…" : "");
};

/** Every number written in the text, with its position: "1,200", "4.8", "12". */
function numbersIn(text: string) {
  const out: { value: number; at: number; len: number }[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?\s*(?:k|thousand|m|million)?\b/gi)) {
    const p = parseNumber(m[0]);
    if (p) out.push({ value: p.value, at: m.index!, len: m[0].length });
  }
  return out;
}

/**
 * Does the page state the fact? With a numeric value: the same number (within tolerance) near at least one of the
 * fact's own content words. Without one: the fact's text appears verbatim (after normalisation).
 * Returns the excerpt copied from the page, so the report shows retrieved words, not a summary.
 */
export function findFactInPage(fact: { text: string; value: number | null; tolerance: number }, page: string): { found: boolean; excerpt: string | null } {
  if (fact.value === null) {
    const n = normalize(page);
    const q = normalize(fact.text).replace(/\.$/, "");
    const at = n.indexOf(q);
    return at >= 0 ? { found: true, excerpt: excerptAt(n, at, q.length) } : { found: false, excerpt: null };
  }
  const keys = words(fact.text);
  for (const num of numbersIn(page)) {
    if (Math.abs(num.value - fact.value) > Math.max(fact.tolerance, 1e-9)) continue;
    const near = normalize(page.slice(Math.max(0, num.at - 160), num.at + num.len + 160));
    if (!keys.length || keys.some((k) => near.includes(k))) return { found: true, excerpt: excerptAt(page, num.at, num.len) };
  }
  return { found: false, excerpt: null };
}

/** A page that confirmed the fact before and no longer does has "changed": that is what makes a claim OUTDATED. */
export function outcomeFor(found: boolean, previous: Outcome | null): Outcome {
  if (found) return "confirmed";
  return previous === "confirmed" || previous === "changed" ? "changed" : "not_found";
}

/**
 * For a claim with no approved fact: is it stated on a trusted page Canon has retrieved? Matching is by code
 * (the claim's number plus one of its words nearby, or the exact phrase). The result is evidence for a reviewer only.
 */
export function findClaimInPages(claim: string, pages: { url: string; retrieved_at: string; page_text: string; name?: string }[]) {
  const num = parseNumber(claim);
  const keys = words(claim);
  for (const p of pages) {
    if (num) {
      for (const n of numbersIn(p.page_text)) {
        if (n.value !== num.value) continue;
        const near = normalize(p.page_text.slice(Math.max(0, n.at - 160), n.at + n.len + 160));
        if (keys.some((k) => near.includes(k))) return { url: p.url, retrieved_at: p.retrieved_at, excerpt: excerptAt(p.page_text, n.at, n.len) };
      }
    } else {
      const t = normalize(p.page_text);
      const at = t.indexOf(normalize(claim));
      if (at >= 0) return { url: p.url, retrieved_at: p.retrieved_at, excerpt: excerptAt(t, at, claim.length) };
    }
  }
  return null;
}
