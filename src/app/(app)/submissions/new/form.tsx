"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { ACCEPT, EXT_MIME, extOf } from "@/lib/items";
import { createItem, type SubmitState } from "../actions";

const CHANNELS = ["LinkedIn", "Blog", "Email", "Website", "X", "Print", "Social image"];
const MAX_MB = 10;
const SAMPLES = [
  { href: "/samples/canon-demo-launch-brochure.pdf", label: "Launch brochure (PDF, 2 pages)" },
  { href: "/samples/canon-demo-partner-newsletter.docx", label: "Partner newsletter (DOCX)" },
  { href: "/samples/canon-demo-social-banner.png", label: "Social banner (PNG, for OCR + visual checks)" },
];

function Field({ label, name, error, hint, children }: { label: string; name: string; error?: string; hint?: React.ReactNode; children: React.ReactNode }) {
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

type Phase = { step: "idle" } | { step: "uploading"; pct: number } | { step: "extracting" } | { step: "done" };

/** PUT to the signed storage URL with real progress events. */
function putWithProgress(url: string, file: File, contentType: string, onPct: (n: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.timeout = 120_000;
    xhr.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(xhr.status === 413 ? "The file is too large for storage." : "Upload was refused by storage.")));
    xhr.onerror = () => reject(new Error("Network error during upload. Check your connection and try again."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Try again on a faster connection."));
    xhr.send(file);
  });
}

export function SubmitForm({ reviewers, today, mockDraft }: { reviewers: { id: string; name: string; role: string }[]; today: string; mockDraft: string | null }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<SubmitState, FormData>(createItem, {});
  const [mode, setMode] = useState<"text" | "file">("text");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const busy = pending || phase.step === "uploading" || phase.step === "extracting" || phase.step === "done";
  const e = mode === "file" ? fileErrors : state.errors;
  const v = state.values ?? {};
  const aria = (name: string) => (e?.[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {});
  const isImage = !!file && [".png", ".jpg", ".jpeg", ".webp"].includes(extOf(file.name));

  function pick(f: File | null) {
    setFileErrors({});
    setPhase({ step: "idle" });
    if (!f) return setFile(null);
    const ext = extOf(f.name);
    if (!EXT_MIME[ext]) {
      setFile(null);
      return setFileErrors({ file: ext === ".doc" ? "Old Word .doc files aren’t supported. Save it as .docx." : "Choose a PDF, a Word .docx, or a PNG, JPEG or WebP image." });
    }
    if (f.size === 0) return setFileErrors({ file: "That file is empty." });
    if (f.size > MAX_MB * 1048576) return setFileErrors({ file: `That file is ${(f.size / 1048576).toFixed(1)} MB. The limit is ${MAX_MB} MB.` });
    setFile(f);
  }

  async function upload(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (busy) return; // a second click must not create a second item
    const form = Object.fromEntries(new FormData(ev.currentTarget).entries()) as Record<string, string>;
    const missing: Record<string, string> = {};
    if (!file) missing.file = "Choose a file to upload";
    if (!form.title?.trim()) missing.title = "Give the item a title";
    if (!form.publish_date) missing.publish_date = "Choose the planned publish date";
    if (!form.reviewer) missing.reviewer = "Choose a reviewer before saving";
    if (Object.keys(missing).length) return setFileErrors(missing);
    setFileErrors({});
    try {
      setPhase({ step: "uploading", pct: 0 });
      const signed = await fetch("/api/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: file!.name, size: file!.size }) });
      const s = await signed.json().catch(() => ({}));
      if (!signed.ok) throw Object.assign(new Error(s.error ?? "Could not start the upload."), { field: "file" });
      await putWithProgress(s.signedUrl, file!, s.contentType, (pct) => setPhase({ step: "uploading", pct }));
      setPhase({ step: "extracting" });
      const res = await fetch("/api/items/from-file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({ ...form, path: s.path, name: file!.name }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(r.error ?? "Canon could not process this file."), { field: r.field || "file" });
      setPhase({ step: "done" });
      router.push(`/submissions/${r.id}`);
    } catch (err) {
      const x = err as Error & { field?: string };
      const msg = x.name === "TimeoutError" ? "Text extraction took too long. Try a smaller file or paste the text." : x.message;
      setPhase({ step: "idle" });
      setFileErrors({ [x.field && x.field !== "" ? x.field : "file"]: msg });
    }
  }

  const tab = (on: boolean) => `rounded px-3 py-1.5 text-[13px] ${on ? "bg-raised font-medium text-ink" : "text-muted hover:text-ink"}`;

  return (
    <form action={mode === "text" ? action : undefined} onSubmit={mode === "file" ? upload : undefined} key={state.n ?? 0} className="grid gap-8 xl:grid-cols-[1.6fr_1fr]">
      <div className="min-w-0">
        <div className="grid gap-5">
          <Field label="Title" name="title" error={e?.title}>
            <input id="title" name="title" required maxLength={200} defaultValue={v.title} className="field" {...aria("title")} />
          </Field>

          <div role="tablist" aria-label="Content source" className="flex gap-1">
            <button type="button" role="tab" aria-selected={mode === "text"} onClick={() => setMode("text")} className={tab(mode === "text")} disabled={busy}>
              Paste text
            </button>
            <button type="button" role="tab" aria-selected={mode === "file"} onClick={() => setMode("file")} className={tab(mode === "file")} disabled={busy}>
              Upload a file
            </button>
          </div>

          {mode === "text" ? (
            <Field label="Draft text" name="body" error={e?.body} hint="Checked word for word.">
              <textarea id="body" name="body" required rows={14} maxLength={40000} defaultValue={v.body ?? mockDraft ?? undefined} className="field !bg-secondary !p-4 text-[15px] leading-7" {...aria("body")} />
            </Field>
          ) : (
            <div className="grid gap-4">
              <Field
                label="File"
                name="file"
                error={e?.file}
                hint="PDF, Word .docx, or PNG / JPEG / WebP image · up to 10 MB. Text is extracted on the server (images by OCR) and checked like pasted text; the original is kept with the item."
              >
                <input
                  id="file"
                  type="file"
                  accept={ACCEPT}
                  disabled={busy}
                  onChange={(ev) => pick(ev.target.files?.[0] ?? null)}
                  className="field file:mr-3 file:rounded file:border-0 file:bg-raised file:px-2 file:py-1 file:text-xs"
                  {...aria("file")}
                />
              </Field>
              {file && (
                <p className="text-xs text-muted">
                  {file.name} · {(file.size / 1024).toFixed(0)} KB
                </p>
              )}
              {isImage && (
                <Field label="Alt text" name="alt_text" error={e?.alt_text} hint="Describe the image for screen-reader users. Checked by the alt-text rule.">
                  <input id="alt_text" name="alt_text" maxLength={1000} className="field" placeholder="e.g. Green launch banner: ‘Our dashboard’, rated 4.8 out of 5" />
                </Field>
              )}
              {phase.step !== "idle" && (
                <div role="status" aria-live="polite" className="rounded-lg border border-line bg-canvas p-3 text-xs">
                  {phase.step === "uploading" && (
                    <>
                      <p>Uploading… {phase.pct}%</p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded bg-raised">
                        <div className="h-full bg-accent transition-all" style={{ width: `${phase.pct}%` }} />
                      </div>
                    </>
                  )}
                  {phase.step === "extracting" && <p>Uploaded. {isImage ? "Reading text from the image (OCR) and measuring colours…" : "Extracting text…"} This can take up to 30 seconds.</p>}
                  {phase.step === "done" && <p className="text-ok">Done. Opening the item…</p>}
                </div>
              )}
              <div className="rounded-lg border border-line bg-canvas p-3 text-xs text-muted">
                <p className="label mb-1.5">No file to hand? Download a sample (fictional Canon Demo Co.)</p>
                <ul className="space-y-1">
                  {SAMPLES.map((s) => (
                    <li key={s.href}>
                      <a href={s.href} download className="text-accent hover:underline">
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="min-w-0 border-t border-line pt-5 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-7">
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
            <select id="reviewer" name="reviewer" required defaultValue={v.reviewer ?? ""} className="field" {...aria("reviewer")}>
              <option value="" disabled>
                Choose a reviewer
              </option>
              {reviewers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.role}
                </option>
              ))}
            </select>
          </Field>

          <div className="rounded-lg border border-line bg-canvas p-3 text-xs text-muted">
            <p className="label mb-1.5">What will run</p>
            <p>● Code checks: banned terms; for images also contrast (WCAG), brand palette and alt text. Free, always run.</p>
            {mockDraft ? (
              <p className="mt-1">● DEMO/MOCK checks: only recognised sample phrases are checked. Other wording needs manual review. No AI model is called.</p>
            ) : (
              <p className="mt-1">● AI checks: tone, messaging, claims. One Claude Sonnet call, with your rules and non-confidential facts only.</p>
            )}
            <p className="mt-1">● Claims Ledger: claims compared by code with approved facts and their retrieved sources.</p>
          </div>

          {e?.form && (
            <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {e.form}
            </p>
          )}
          <div className="flex items-center gap-3 border-t border-line pt-5">
            <button disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent/90 disabled:opacity-60">
              {mode === "file" ? (busy ? "Working…" : "Upload and save draft") : pending ? "Saving…" : "Save draft"}
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
