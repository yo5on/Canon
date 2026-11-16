import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";

const { admin } = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: admin }));
import { GET } from "./route";

const id = "00000000-0000-4000-a000-0000000000c1";
const TOKEN = "canon_" + "a".repeat(32);
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const BODY = "Approved launch copy.";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;

// A tiny query builder that really applies eq/is filters, so dropping a filter in the route makes a test fail.
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = [];
  const chain: Record<string, unknown> = {};
  for (const key of ["select", "order", "limit", "neq"]) chain[key] = () => chain;
  chain.eq = (col: string, v: unknown) => (preds.push((r) => r[col] === v), chain);
  chain.is = (col: string, v: unknown) => (preds.push((r) => (r[col] ?? null) === v), chain);
  const rows = () => (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
  chain.single = chain.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
  chain.then = (resolve: (r: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve);
  return chain;
}

beforeEach(() => {
  vi.resetAllMocks();
  tables = {
    api_tokens: [{ id: "tok", org_id: "org", token_hash: sha(TOKEN), revoked_at: null }],
    content_items: [{ id, org_id: "org", title: "Launch", status: "approved", current_version: 2, publish_date: "2026-12-15" }],
    content_versions: [{ id: "v2", item_id: id, version: 2, body: BODY, source_kind: "text", source_sha256: null }],
    approvals: [{ item_id: id, decision: "approved", version: 2, created_at: "2026-11-15T10:00:00Z" }],
    analysis_runs: [{ id: "run", version_id: "v2", purpose: "review", policy: { version: 3 }, created_at: "2026-11-15T09:00:00Z" }],
    findings: [],
  };
  admin.mockReturnValue({ from: (t: string) => ({ ...query(t), update: () => ({ eq: async () => ({ error: null }) }) }) });
});

const gate = (auth: string | null, qs = "") =>
  GET(new Request(`http://localhost/api/v1/items/${id}/gate${qs}`, { headers: auth ? { authorization: auth } : {} }), {
    params: Promise.resolve({ id }),
  });

it("rejects a missing, malformed, unknown or revoked token with 401", async () => {
  expect((await gate(`Bearer ${TOKEN}`)).status).toBe(200);
  expect((await gate(null)).status).toBe(401);
  expect((await gate("Bearer not-a-canon-token")).status).toBe(401);
  expect((await gate(`Bearer canon_${"b".repeat(32)}`)).status).toBe(401);
  tables.api_tokens[0].revoked_at = "2026-11-16T00:00:00Z";
  expect((await gate(`Bearer ${TOKEN}`)).status).toBe(401);
});

it("is publishable only when the current version is the approved one and the text matches", async () => {
  const ok = await (await gate(`Bearer ${TOKEN}`, `?sha256=${sha(BODY)}`)).json();
  expect(ok).toMatchObject({ publishable: true, text_matches: true, approved_version: 2, current_version: 2, open_blocking: 0 });

  const edited = await (await gate(`Bearer ${TOKEN}`, `?sha256=${sha(BODY + " edited")}`)).json();
  expect(edited).toMatchObject({ publishable: false, text_matches: false });

  tables.approvals[0].version = 1; // approval is for an older version
  expect(await (await gate(`Bearer ${TOKEN}`)).json()).toMatchObject({ publishable: false, approved_version: 1, current_version: 2 });
});

it("does not answer for a bad id or an item in another workspace", async () => {
  tables.content_items[0].org_id = "other-org";
  expect((await gate(`Bearer ${TOKEN}`)).status).toBe(404);
  const bad = await GET(new Request("http://localhost/api/v1/items/x/gate", { headers: { authorization: `Bearer ${TOKEN}` } }), {
    params: Promise.resolve({ id: "x" }),
  });
  expect(bad.status).toBe(400);
});
