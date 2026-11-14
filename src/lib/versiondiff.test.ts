import { expect, it } from "vitest";
import { fieldChanges, textDiff } from "./versiondiff";

it("diffs wording by whole words", () => {
  const d = textDiff("Canon serves 1,200 customers.", "Canon serves 1,450 customers.");
  expect(d.filter((p) => p.op !== 0).map((p) => [p.op, p.text])).toEqual([[-1, "1,200"], [1, "1,450"]]);
  expect(textDiff("same", "same")).toEqual([{ op: 0, text: "same" }]);
});

it("lists changed fields and ignores bookkeeping columns", () => {
  const a = { id: "1", version: 1, text: "x", severity: "advisory", params: { min_ratio: 4.5 }, source_url: null };
  const b = { id: "2", version: 2, text: "y", severity: "blocking", params: { min_ratio: 3 }, source_url: null };
  expect(fieldChanges(a, b)).toEqual([
    { field: "severity", from: "advisory", to: "blocking" },
    { field: "params", from: '{"min_ratio":4.5}', to: '{"min_ratio":3}' },
  ]);
  expect(fieldChanges(null, b).map((c) => c.field)).toEqual(["severity", "params"]);
});
