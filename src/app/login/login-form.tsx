"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

type Demo = { key: string; role: string; email: string; password: string };

export function LoginForm({ demos }: { demos: Demo[] }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});

  return (
    <>
      <form action={action} className="mt-6 space-y-4">
        <label className="block text-sm">
          <span className="mb-1.5 block text-muted">Email</span>
          <input name="email" type="email" required autoComplete="email" defaultValue={state.email} className="field" />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-muted">Password</span>
          <input name="password" type="password" required autoComplete="current-password" className="field" />
        </label>
        {state.error && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {state.error}
          </p>
        )}
        <button
          disabled={pending}
          className="w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-accent-ink hover:bg-accent/90 disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {demos.length > 0 && (
        <div className="mt-10">
          <p className="label">Demo accounts · Canon Demo Co.</p>
          <ul className="mt-3 space-y-2">
            {demos.map((d) => (
              <li key={d.key}>
                <form action={action} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel px-3 py-2.5">
                  <input type="hidden" name="demo" value={d.key} />
                  <div className="min-w-0 text-xs">
                    <p className="text-sm font-medium">{d.role}</p>
                    <p className="truncate font-mono text-muted">{d.email}</p>
                    <p className="truncate font-mono text-faint">{d.password}</p>
                  </div>
                  <button
                    disabled={pending}
                    aria-label={`Sign in as ${d.role}`}
                    className="shrink-0 rounded-md border border-accent/40 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-60"
                  >
                    Sign in
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
