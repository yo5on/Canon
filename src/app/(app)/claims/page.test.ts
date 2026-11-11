import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const { workspace } = vi.hoisted(() => ({ workspace: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: workspace }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", props, children),
}));
import ClaimsLedger from "./page";

const claim = {
  id: "claim",
  text: "Serves 5,000 customers",
  type: "number",
  status: "CONTRADICTED",
  fact_code: "FACT-1",
  reason: "Conflicts with the approved customer count.",
  findings: {
    source_text: "Original evidence: 1,200 customers.",
    finding_decisions: [
      {
        decision: "overridden",
        reason: "Exception recorded",
        created_at: "2026-11-11",
      },
    ],
  },
  analysis_runs: {
    model: "mock",
    content_versions: {
      item_id: "item",
      version: 1,
      content_items: {
        title: "Customer update",
        approvals: [
          {
            version: 2,
            decision: "approved",
            reason: "Corrected",
            created_at: "2026-11-12",
          },
          {
            version: 1,
            decision: "changes_requested",
            reason: "Correct the count",
            created_at: "2026-11-11",
          },
        ],
      },
    },
  },
};

function setup(
  facts = [{ code: "FACT-1", text: "Current fact text: 1,300 customers." }],
  error: { message: string } | null = null,
) {
  workspace.mockResolvedValue({
    active: { orgId: "org" },
    supabase: {
      from: (table: string) => {
        const result = { data: table === "claims" ? [claim] : facts, error };
        const query: Record<string, unknown> = {};
        for (const method of ["select", "eq", "not", "limit"])
          query[method] = () => query;
        query.then = (resolve: (r: typeof result) => unknown) =>
          Promise.resolve(result).then(resolve);
        return query;
      },
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  setup();
});

it("keeps recorded evidence and decisions separate from newer facts and approvals", async () => {
  const html = renderToStaticMarkup(await ClaimsLedger());
  for (const text of [
    "Contradicted",
    "Original evidence: 1,200",
    "Current fact text: 1,300",
    "Current register text",
    "Changes requested",
    "Finding overridden",
    "Demo / mock",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain(">Approved<");
  expect(html).toContain("/brand-kit?tab=facts#fact-FACT-1");
});

it("does not invent a fact when the role-scoped query cannot see it", async () => {
  setup([]);
  const html = renderToStaticMarkup(await ClaimsLedger());
  expect(html).toContain("Fact is not currently available to your role.");
  expect(html).not.toContain("Current fact text: 1,300");
});

it("reports query errors instead of displaying an empty ledger", async () => {
  setup([], { message: "Unavailable" });
  await expect(ClaimsLedger()).rejects.toThrow(
    "Could not load the Claims Ledger.",
  );
});
