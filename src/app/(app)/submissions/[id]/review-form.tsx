"use client";

import { useActionState } from "react";
import { reviewAction, type ActionState } from "./actions";

type Choice = { value: string; label: string; tone?: "danger" | "ok" | "plain" };

const TONE = {
  ok: "bg-ok/15 text-ok hover:bg-ok/25",
  danger: "bg-danger/15 text-danger hover:bg-danger/25",
  plain: "bg-raised text-ink hover:bg-raised/70",
};

/** One small form for every review action. Hidden fields pick the RPC; the clicked button sets the decision. */
export function ReviewForm({ fields, choices, reason }: { fields: Record<string, string>; choices: Choice[]; reason?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reviewAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {reason && <input name="reason" placeholder={reason} maxLength={1000} aria-label={reason} className="field text-sm" />}
      <div className="flex flex-wrap gap-2">
        {choices.map((c) => (
          <button
            key={c.value}
            name="decision"
            value={c.value}
            disabled={pending}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-60 ${TONE[c.tone ?? "plain"]}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p aria-live="polite" className="text-xs text-danger">
        {state.error}
      </p>
    </form>
  );
}
