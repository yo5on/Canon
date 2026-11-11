import Link from "next/link";

export function PageHeader({
  crumb,
  title,
  subtitle,
  actions,
}: {
  crumb: string;
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="font-mono text-xs text-muted">{crumb}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-panel ${className}`}>{children}</section>;
}

const TONES = {
  accent: "border-accent/30 bg-accent/10 text-accent",
  amber: "border-amber/30 bg-amber/10 text-amber",
  danger: "border-danger/30 bg-danger/10 text-danger",
  ok: "border-ok/30 bg-ok/10 text-ok",
  muted: "border-line bg-raised text-muted",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "muted", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div aria-hidden className="mb-4 grid h-10 w-10 place-items-center rounded-lg border border-line font-mono text-faint">
        ∅
      </div>
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Unauthorized({ need }: { need: string }) {
  return (
    <Card className="mx-auto max-w-lg">
      <div className="px-6 py-12 text-center">
        <p className="label !text-danger">Not permitted</p>
        <p className="mt-2 text-lg font-medium">Only a {need} can do this</p>
        <p className="mt-1 text-sm text-muted">
          Your role in this workspace doesn’t allow it. Ask a Brand Manager if you need access.
        </p>
        <Link href="/" className="mt-5 inline-block text-sm text-accent hover:underline">
          Back to overview
        </Link>
      </div>
    </Card>
  );
}

export function ButtonLink({
  href,
  children,
  primary,
}: {
  href: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink hover:bg-accent/90"
          : "rounded-lg border border-line px-3.5 py-2 text-sm text-ink hover:border-accent/50 hover:text-accent"
      }
    >
      {children}
    </Link>
  );
}

export const ITEM_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "muted" },
  in_review: { label: "In review", tone: "accent" },
  changes_requested: { label: "Changes requested", tone: "amber" },
  approved: { label: "Approved", tone: "ok" },
  rejected: { label: "Rejected", tone: "danger" },
};

// Status ladder from src/lib/ledger.ts. "Supported" means it matches an approved fact, not "true in the world".
export const CLAIM_STATUS: Record<string, { label: string; tone: Tone }> = {
  SUPPORTED: { label: "Supported", tone: "ok" },
  CONTRADICTED: { label: "Contradicted", tone: "danger" },
  OUTDATED: { label: "Outdated", tone: "amber" },
  UNSUPPORTED: { label: "Unsupported", tone: "amber" },
  HUMAN_JUDGEMENT: { label: "Human judgement", tone: "muted" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = ITEM_STATUS[status] ?? { label: status, tone: "muted" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const th ="px-4 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-accent";
export const td = "px-4 py-3 align-top";

export function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDateTime(d: string) {
  return new Date(d).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}
