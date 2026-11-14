"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Badge } from "@/components/ui";
import { runMonitoring, type MonitorState } from "./actions";

export function MonitorForm() {
  const [state, action, pending] = useActionState<MonitorState, FormData>(runMonitoring, {});
  return (
    <div>
      <form action={action} className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className="rounded bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-60">
          {pending ? "Re-checking…" : "Run monitoring now"}
        </button>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" name="force" /> Re-check everything, even if nothing changed
        </label>
      </form>
      <p aria-live="polite" className="mt-2 text-xs text-danger">
        {state.error}
      </p>
      {state.results && (
        <div className="mt-3 text-xs">
          <p className="text-muted">
            Policy v{state.policy} · {state.results.length} approved or in-review item{state.results.length === 1 ? "" : "s"} looked at ·{" "}
            {state.results.filter((r) => r.rechecked).length} re-checked · {state.results.filter((r) => r.new_issues.length).length} with new blocking issues
          </p>
          {state.results.length > 0 && (
            <ul className="mt-2 divide-y divide-line rounded border border-line">
              {state.results.map((r) => (
                <li key={r.item_id} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/submissions/${r.item_id}`} className="font-medium hover:underline">
                      {r.title}
                    </Link>
                    <Badge tone={r.error || r.new_issues.length ? "danger" : r.rechecked ? "ok" : "muted"}>
                      {r.error
                        ? "Failed"
                        : r.new_issues.length
                          ? `${r.new_issues.length} new issue${r.new_issues.length > 1 ? "s" : ""}`
                          : r.rechecked
                            ? "Re-checked · no new issues"
                            : "Unchanged · not re-checked"}
                    </Badge>
                  </div>
                  {r.reasons.length > 0 && <p className="mt-1 text-muted">{r.reasons.join(" · ")}</p>}
                  {r.new_issues.map((n) => (
                    <p key={n} className="mt-1 text-danger">
                      {n}
                    </p>
                  ))}
                  {r.error && <p className="mt-1 text-danger">{r.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
