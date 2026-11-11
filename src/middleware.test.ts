import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));
import { middleware } from "./middleware";

it("returns JSON 401 for signed-out API calls", async () => {
  const result = await middleware(new NextRequest("http://localhost/api/items/123/analyze"));
  expect(result.status).toBe(401);
  expect(await result.json()).toEqual({ error: "Sign in first" });
  expect(result.headers.has("location")).toBe(false);
});
it("continues redirecting signed-out page visits to login", async () => {
  const result = await middleware(new NextRequest("http://localhost/submissions"));
  expect(result.status).toBe(307);
  expect(result.headers.get("location")).toBe("http://localhost/login");
});
