"use client";

import { useActionState, useEffect } from "react";
import { reviewAction, type ActionState } from "./actions";

export function ReviseForm({ itemId, body }: { itemId: string; body: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reviewAction, {});
  useEffect(() => {
    if (state.ok) window.location.reload();
  }, [state.ok]);
  return (
    <details className="border-t border-line px-5 py-4">
      <summary className="text-sm font-medium text-accent">Edit draft</summary>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="kind" value="revise" />
        <input type="hidden" name="item" value={itemId} />
        <label className="block text-sm">
          Revised draft
          <textarea name="body" required maxLength={40000} rows={10} defaultValue={body} className="field mt-2" />
        </label>
        <p className="text-xs text-muted">Saving creates a new version. Run checks again before submitting for review.</p>
        <button disabled={pending} className="rounded-md bg-accent px-3 py-2 text-sm text-accent-ink disabled:opacity-60">
          {pending ? "Saving…" : "Save new version"}
        </button>
        <p role="status" className={`text-xs ${state.error ? "text-danger" : "text-ok"}`}>{state.error ?? (state.ok ? "New version saved. Run checks to continue." : "")}</p>
      </form>
    </details>
  );
}
