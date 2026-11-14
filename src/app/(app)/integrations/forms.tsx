"use client";

import { useActionState } from "react";
import { addWebhook, createToken, testWebhook, type IntState } from "./actions";

const EVENTS = [
  ["submitted", "Submitted for review"],
  ["approved", "Approved"],
  ["changes_requested", "Changes requested"],
  ["rejected", "Rejected"],
  ["monitor_alert", "Monitoring alert"],
  ["source_changed", "Fact source changed"],
] as const;

function Result({ state }: { state: IntState }) {
  return (
    <p aria-live="polite" className={`text-xs ${state.error ? "text-danger" : "text-ok"}`}>
      {state.error ?? state.ok}
    </p>
  );
}

export function AddWebhookForm() {
  const [state, action, pending] = useActionState(addWebhook, {});
  return (
    <form action={action} className="grid gap-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input name="url" type="url" required placeholder="https://hooks.slack.com/services/… or https://webhook.site/…" aria-label="Webhook URL" className="field" />
        <select name="format" aria-label="Payload format" className="field" defaultValue="json">
          <option value="json">Signed JSON</option>
          <option value="slack">Slack message</option>
        </select>
      </div>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <legend className="sr-only">Events</legend>
        {EVENTS.map(([v, l]) => (
          <label key={v} className="flex items-center gap-1.5">
            <input type="checkbox" name="events" value={v} defaultChecked /> {l}
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-60">
          {pending ? "Saving…" : "Add webhook"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function TestWebhookButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(testWebhook, {});
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <button disabled={pending} className="text-xs text-accent hover:underline disabled:opacity-60">
        {pending ? "Sending…" : "Send test event"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function CreateTokenForm() {
  const [state, action, pending] = useActionState(createToken, {});
  return (
    <form action={action} className="grid gap-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <input name="name" required maxLength={80} placeholder="Token name, e.g. CMS publish gate" aria-label="Token name" className="field max-w-xs" />
        <button disabled={pending} className="rounded bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-60">
          {pending ? "Creating…" : "Create token"}
        </button>
      </div>
      <Result state={state} />
      {state.token && (
        <code className="block break-all rounded border border-amber/40 bg-amber/10 px-3 py-2 font-mono text-xs" aria-label="New API token">
          {state.token}
        </code>
      )}
    </form>
  );
}
