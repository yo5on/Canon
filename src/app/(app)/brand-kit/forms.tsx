"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CATEGORIES, CHECK_KINDS, SEVERITIES } from "@/lib/brandkit";
import { saveFact, saveRule, type FormState } from "./actions";

type Values = Record<string, string | number | boolean | null>;

function Field({
  label,
  name,
  error,
  hint,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
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

function Shell({
  state,
  pending,
  cancel,
  children,
}: {
  state: FormState;
  pending: boolean;
  cancel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-2xl border-t border-line pt-6">
      <div className="grid gap-5 sm:grid-cols-2">{children}</div>
      {state.errors?.form && (
        <p role="alert" className="mt-5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.errors.form}
        </p>
      )}
      <div className="mt-6 flex items-center gap-3 border-t border-line pt-5">
        <button
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent/90 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <Link href={cancel} className="text-sm text-muted hover:text-ink">
          Cancel
        </Link>
      </div>
    </div>
  );
}

const str = (v: Values[string] | undefined) => (v === null || v === undefined ? "" : String(v));
const aria = (errors: FormState["errors"], name: string) =>
  errors?.[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {};

export function RuleForm({ id, initial = {} }: { id: string | null; initial?: Values }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveRule.bind(null, id), {});
  const e = state.errors;
  const v: Values = state.values ?? initial;

  return (
    <form action={action} key={state.n ?? 0}>
      <Shell state={state} pending={pending} cancel="/brand-kit">
        <Field label="Code" name="code" error={e?.code} hint={id ? "The code stays the same across versions." : "e.g. TONE-2"}>
          <input id="code" name="code" required defaultValue={str(v.code)} readOnly={!!id} className="field font-mono read-only:opacity-60" {...aria(e, "code")} />
        </Field>
        <Field label="Category" name="category" error={e?.category}>
          <select id="category" name="category" defaultValue={str(v.category) || "tone"} className="field capitalize">
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Rule wording" name="text" error={e?.text} hint="Stored word for word. Findings must quote it exactly.">
            <textarea id="text" name="text" required rows={3} defaultValue={str(v.text)} className="field" {...aria(e, "text")} />
          </Field>
        </div>
        <Field label="Severity" name="severity" error={e?.severity}>
          <select id="severity" name="severity" defaultValue={str(v.severity) || "advisory"} className="field capitalize">
            {SEVERITIES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Check" name="check_kind" error={e?.check_kind} hint="Code checks match a banned term exactly.">
          <select id="check_kind" name="check_kind" defaultValue={str(v.check_kind) || "ai"} className="field">
            {CHECK_KINDS.map((k) => (
              <option key={k} value={k}>
                {k === "ai" ? "AI judgement" : "Code (banned term)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Banned term" name="banned_term" error={e?.banned_term} hint="Required for code checks.">
          <input id="banned_term" name="banned_term" defaultValue={str(v.banned_term)} className="field" {...aria(e, "banned_term")} />
        </Field>
        <Field label="Replacement" name="replacement" error={e?.replacement} hint="What to say instead (optional).">
          <input id="replacement" name="replacement" defaultValue={str(v.replacement)} className="field" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Source" name="source_ref" error={e?.source_ref} hint="Where this rule comes from, e.g. voice-guide-v4.pdf p.6 §2.1">
            <input id="source_ref" name="source_ref" defaultValue={str(v.source_ref)} className="field" />
          </Field>
        </div>
      </Shell>
    </form>
  );
}

export function FactForm({ id, initial = {} }: { id: string | null; initial?: Values }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveFact.bind(null, id), {});
  const e = state.errors;
  const v: Values = state.values ?? initial;

  return (
    <form action={action} key={state.n ?? 0}>
      <Shell state={state} pending={pending} cancel="/brand-kit?tab=facts">
        <Field label="Code" name="code" error={e?.code} hint={id ? "The code stays the same across versions." : "e.g. FACT-3"}>
          <input id="code" name="code" required defaultValue={str(v.code)} readOnly={!!id} className="field font-mono read-only:opacity-60" {...aria(e, "code")} />
        </Field>
        <Field label="Owner" name="owner" error={e?.owner} hint="Who confirms this fact is still true.">
          <input id="owner" name="owner" defaultValue={str(v.owner)} className="field" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Fact" name="text" error={e?.text}>
            <textarea id="text" name="text" required rows={2} defaultValue={str(v.text)} className="field" {...aria(e, "text")} />
          </Field>
        </div>
        <Field label="Numeric value" name="value" error={e?.value} hint="Optional. Lets code compare numbers in claims.">
          <input id="value" name="value" inputMode="decimal" defaultValue={str(v.value)} className="field" {...aria(e, "value")} />
        </Field>
        <Field label="Tolerance" name="tolerance" error={e?.tolerance} hint="Absolute. 0 means exact.">
          <input id="tolerance" name="tolerance" inputMode="decimal" defaultValue={str(v.tolerance)} className="field" {...aria(e, "tolerance")} />
        </Field>
        <Field label="Valid from" name="valid_from" error={e?.valid_from}>
          <input id="valid_from" name="valid_from" type="date" defaultValue={str(v.valid_from)} className="field" />
        </Field>
        <Field label="Valid until" name="valid_until" error={e?.valid_until} hint="Leave empty if it doesn’t expire.">
          <input id="valid_until" name="valid_until" type="date" defaultValue={str(v.valid_until)} className="field" {...aria(e, "valid_until")} />
        </Field>
        <Field label="Replaced by" name="replaced_by" error={e?.replaced_by} hint="Code of the newer fact, if any.">
          <input id="replaced_by" name="replaced_by" defaultValue={str(v.replaced_by)} className="field font-mono" />
        </Field>
        <Field label="Source" name="source_ref" error={e?.source_ref}>
          <input id="source_ref" name="source_ref" defaultValue={str(v.source_ref)} className="field" />
        </Field>
        <label className="flex items-start gap-3 rounded-lg border border-amber/30 bg-amber/5 p-3 text-sm sm:col-span-2">
          <input type="checkbox" name="confidential" defaultChecked={v.confidential === true || v.confidential === "on"} className="mt-0.5 accent-[#f2b54b]" />
          <span>
            <span className="font-medium">Confidential</span>
            <span className="block text-xs text-muted">
              Never sent to the AI, and hidden from Creators. Content citing it gets code checks only.
            </span>
          </span>
        </label>
      </Shell>
    </form>
  );
}
