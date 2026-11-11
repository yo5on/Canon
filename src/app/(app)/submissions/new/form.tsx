"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createItem, type SubmitState } from "../actions";

const CHANNELS = ["LinkedIn", "Blog", "Email", "Website", "X"];

function Field({ label, name, error, hint, children }: { label: string; name: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="text-sm">
      <label htmlFor={name} className="mb-1.5 block text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${name}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-xs text-faint">{hint}</p>
      )}
    </div>
  );
}

export function SubmitForm({ reviewers, today }: { reviewers: { id: string; name: string; role: string }[]; today: string }) {
  const [state, action, pending] = useActionState<SubmitState, FormData>(createItem, {});
  const e = state.errors;
  const v = state.values ?? {};
  const aria = (name: string) => (e?.[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {});

  return (
    <form action={action} key={state.n ?? 0} className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
      <div className="rounded-xl border border-line bg-panel p-6">
        <div className="grid gap-5">
          <Field label="Title" name="title" error={e?.title}>
            <input id="title" name="title" required maxLength={200} defaultValue={v.title} className="field" {...aria("title")} />
          </Field>
          <Field label="Draft text" name="body" error={e?.body} hint="Pasted text only in this release. Checked word for word.">
            <textarea id="body" name="body" required rows={14} maxLength={40000} defaultValue={v.body} className="field leading-relaxed" {...aria("body")} />
          </Field>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-panel p-6">
        <div className="grid gap-5">
          <Field label="Channel" name="channel" error={e?.channel}>
            <select id="channel" name="channel" defaultValue={v.channel || "LinkedIn"} className="field">
              {CHANNELS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Audience" name="audience" error={e?.audience}>
            <input id="audience" name="audience" maxLength={120} defaultValue={v.audience} placeholder="e.g. Existing customers" className="field" />
          </Field>
          <Field label="Goal in one line" name="goal" error={e?.goal} hint="Sent with every fix suggestion so it keeps your message.">
            <input id="goal" name="goal" maxLength={300} defaultValue={v.goal} className="field" {...aria("goal")} />
          </Field>
          <Field label="Publish date" name="publish_date" error={e?.publish_date} hint="Facts are checked as valid on this date.">
            <input id="publish_date" name="publish_date" type="date" required min={today} defaultValue={v.publish_date} className="field" {...aria("publish_date")} />
          </Field>
          <Field label="Reviewer" name="reviewer" error={e?.reviewer} hint="You can’t review your own item.">
            <select id="reviewer" name="reviewer" defaultValue={v.reviewer ?? ""} className="field" {...aria("reviewer")}>
              <option value="">Choose later</option>
              {reviewers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.role}
                </option>
              ))}
            </select>
          </Field>

          <div className="rounded-lg border border-line bg-canvas p-3 text-xs text-muted">
            <p className="label mb-1.5">What will run</p>
            <p>● Code checks: banned terms. Free, always run.</p>
            <p className="mt-1">● AI checks: tone, messaging, claims. One Claude Sonnet call, with your rules and non-confidential facts only.</p>
          </div>

          {e?.form && (
            <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {e.form}
            </p>
          )}
          <div className="flex items-center gap-3 border-t border-line pt-5">
            <button disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent/90 disabled:opacity-60">
              {pending ? "Saving…" : "Save draft"}
            </button>
            <Link href="/submissions" className="text-sm text-muted hover:text-ink">
              Cancel
            </Link>
          </div>
        </div>
      </div>
    </form>
  );
}
