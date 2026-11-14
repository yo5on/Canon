import { beforeEach, expect, it, vi } from "vitest";

const { rpc, dispatch, pending } = vi.hoisted(() => ({ rpc: vi.fn(), dispatch: vi.fn(), pending: [] as Promise<unknown>[] }));
const single = async () => ({ data: { title: "Launch post", current_version: 2 } });
const from = () => ({ select: () => ({ eq: () => ({ single }) }) });
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async () => ({ supabase: { rpc, from }, active: { orgId: "org-1" } }) }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<unknown>) => pending.push(fn()) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/webhooks", () => ({ dispatch, appUrl: () => "https://canon.test" }));
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

it("tells connected webhooks after a decision is saved, never before", async () => {
  rpc.mockResolvedValue({ error: null });
  await reviewAction({}, form({ kind: "item", item, decision: "changes_requested", reason: "Fix the claim" }));
  await Promise.all(pending);
  expect(dispatch).toHaveBeenCalledWith({}, "org-1", "changes_requested", expect.objectContaining({ item_id: item, reason: "Fix the claim" }));
  dispatch.mockClear();
  rpc.mockResolvedValue({ error: { message: "you cannot review your own submission" } });
  await reviewAction({}, form({ kind: "item", item, decision: "approved", reason: "" }));
  expect(dispatch).not.toHaveBeenCalled();
});
