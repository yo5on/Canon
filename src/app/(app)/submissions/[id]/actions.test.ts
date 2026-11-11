import { beforeEach, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async () => ({ supabase: { rpc } }) }));
import { reviewAction } from "./actions";

const item = "00000000-0000-4000-a000-000000000001";
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  Object.entries(fields).forEach(([k, v]) => data.set(k, v));
  return data;
};
beforeEach(() => vi.resetAllMocks());

it("saves revisions through the authorized database RPC", async () => {
  rpc.mockResolvedValue({ error: null });
  expect(await reviewAction({}, form({ kind: "revise", item, body: " Revised draft " }))).toEqual({ ok: true });
  expect(rpc).toHaveBeenCalledWith("revise_item", { p_item: item, p_body: "Revised draft" });
});
it("rejects empty revisions before writing", async () => {
  expect(await reviewAction({}, form({ kind: "revise", item, body: "  " }))).toHaveProperty("error");
  expect(rpc).not.toHaveBeenCalled();
});
it("preserves server authorization failures", async () => {
  rpc.mockResolvedValue({ error: { message: "only the author can revise" } });
  expect(await reviewAction({}, form({ kind: "revise", item, body: "Draft" }))).toEqual({ error: "only the author can revise" });
});
it("requires a reason for rejection", async () => {
  expect(await reviewAction({}, form({ kind: "item", item, decision: "rejected", reason: "" }))).toHaveProperty("error");
  expect(rpc).not.toHaveBeenCalled();
});
it.each(["submit", "item"])("confirms the saved %s action before the client reloads", async (kind) => {
  rpc.mockResolvedValue({ error: null });
  expect(await reviewAction({}, form({ kind, item, decision: "approved", reason: "" }))).toEqual({ ok: true });
  expect(rpc).toHaveBeenCalledWith(kind === "item" ? "decide_item" : "submit_for_review", kind === "item" ? { p_item: item, p_decision: "approved", p_reason: "" } : { p_item: item });
});
