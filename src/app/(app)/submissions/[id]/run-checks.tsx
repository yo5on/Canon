"use client";

import { useState } from "react";

export function RunChecks({ itemId, label }: { itemId: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      // The server stops at 60 s; give up slightly later so the button never hangs.
      const res = await fetch(`/api/items/${itemId}/analyze`, { method: "POST", signal: AbortSignal.timeout(75_000) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Checks failed. Try again.");
      else window.location.reload();
    } catch (e) {
      setError((e as Error).name === "TimeoutError" ? "Checks are taking too long. Reload the page in a minute to see if they finished." : "Could not reach Canon. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const pending = busy;
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent/90 disabled:opacity-60"
      >
        {pending ? "Running checks…" : label}
      </button>
      <p aria-live="polite" className="max-w-xs text-right text-xs text-danger">
        {error}
      </p>
    </div>
  );
}
