import { beforeEach, expect, it, vi } from "vitest";

const { client, admin, removed } = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), removed: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: admin }));
import { POST } from "./route";

// Query-shaped fixtures keep these checks at the HTTP boundary without a live service-role write.
function query(data: unknown) {
  const result = { data, error: null };
  const chain: Record<string, unknown> = {};
  for (const key of ["select", "eq", "gte", "order", "limit"]) chain[key] = () => chain;
  chain.single = chain.maybeSingle = async () => result;
  chain.then = (resolve: (r: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}
const id = "00000000-0000-4000-a000-000000000001";
const request = () => POST(new Request(`http://localhost/api/items/${id}/analyze`, { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CANON_AI_MOCK", "1");
  client.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "creator" } } }) },
    from: (table: string) => query(({
      content_items: { id, org_id: "org", status: "draft", current_version: 1, channel: "LinkedIn", audience: "Customers", goal: "Launch", publish_date: "2026-12-15" },
      content_versions: { id: "version", body: "A campaign for our customers." },
      analysis_runs: null, rules: [], facts: [],
    } as Record<string, unknown>)[table]),
  });
});

function writes(auditError: { message: string } | null) {
  removed.mockResolvedValue({ error: null });
  admin.mockReturnValue({ from: (table: string) => table === "analysis_runs" ? {
    insert: () => query({ id: "run" }),
    update: () => ({ eq: async () => ({ error: null }) }),
    delete: () => ({ eq: removed }),
  } : { insert: async () => ({ error: auditError }) } });
}

it("never reports success when audit recording fails", async () => {
  writes({ message: "audit unavailable" });
  const response = await request();
  expect(response.status).toBe(500);
  expect((await response.json()).error).toContain("audit history");
  expect(removed).toHaveBeenCalledWith("id", "run");
});
it("returns the saved demo run when audit recording succeeds", async () => {
  writes(null);
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ run_id: "run", status: "done", claims: 0 });
  expect(removed).not.toHaveBeenCalled();
});
it("requires authentication before reading or writing analysis", async () => {
  client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
  expect((await request()).status).toBe(401);
  expect(admin).not.toHaveBeenCalled();
});
