"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-lg rounded-xl border border-danger/30 bg-panel px-6 py-12 text-center">
      <p className="label !text-danger">Something went wrong</p>
      <p className="mt-2 text-lg font-medium">We couldn’t load this page</p>
      <p className="mt-1 text-sm text-muted">
        {error.digest ? `Reference ${error.digest}. ` : ""}Check your connection and try again.
      </p>
      <button
        onClick={reset}
        className="mt-5 rounded-lg border border-line px-3.5 py-2 text-sm hover:border-accent/50 hover:text-accent"
      >
        Try again
      </button>
    </div>
  );
}
