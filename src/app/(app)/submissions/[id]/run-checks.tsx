"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function RunChecks({ itemId, label }: { itemId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${itemId}/analyze`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Checks failed. Try again.");
      else startTransition(() => router.refresh());
    } catch {
      setError("Could not reach Canon. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const pending = busy || refreshing;
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
