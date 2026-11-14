"use client";

import { useActionState } from "react";
import { addTrustedSource, checkSources, type SourceState } from "./source-actions";

function Result({ state }: { state: SourceState }) {
  return (
    <p aria-live="polite" className={`text-xs ${state.error ? "text-danger" : "text-ok"}`}>
      {state.error ?? state.ok}
    </p>
  );
}

export function AddSourceForm() {
  const [state, action, pending] = useActionState(addTrustedSource, {});
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
      <input name="name" required maxLength={120} placeholder="Name, e.g. Q3 board pack" aria-label="Source name" className="field text-sm" />
      <input name="domain" required maxLength={200} placeholder="Domain, e.g. canon-rose.vercel.app" aria-label="Source domain" className="field text-sm" />
      <button disabled={pending} className="rounded bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-60">
        {pending ? "Adding…" : "Trust domain"}
      </button>
      <div className="sm:col-span-3">
        <Result state={state} />
      </div>
    </form>
  );
}

export function CheckSourcesButton({ code, label }: { code?: string; label: string }) {
  const [state, action, pending] = useActionState(checkSources, {});
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      {code && <input type="hidden" name="code" value={code} />}
      <button disabled={pending} className={code ? "text-xs text-accent hover:underline disabled:opacity-60" : "rounded bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-60"}>
        {pending ? "Retrieving…" : label}
      </button>
      <Result state={state} />
    </form>
  );
}
