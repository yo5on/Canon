import Link from "next/link";
import { Icon, type IconName } from "./icon";

export function PageHeader({
  crumb,
  title,
  subtitle,
  actions,
  icon = "file",
}: {
  crumb: string;
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: IconName;
}) {
  return (
    <header className="page-header">
      <div className="min-w-0 max-w-3xl">
        <p className="mb-3 flex items-center gap-2 text-xs text-muted"><Icon name={icon} size={16} />{crumb}</p>
        <h1>{title}</h1>
        {subtitle && <p className="mt-2 text-[13px] leading-6 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`surface ${className}`}>{children}</section>;
}

const TONES = {
  accent: "bg-green-soft text-ok",
  amber: "bg-amber/10 text-amber",
  danger: "bg-danger/10 text-danger",
  ok: "bg-green-soft text-ok",
  muted: "bg-secondary text-muted",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "muted", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="px-5 py-8">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-lg text-[13px] leading-6 text-muted">{body}</p>
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
          ? "rounded bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:bg-accent/90"
          : "rounded border border-line px-3 py-1.5 text-[13px] text-ink hover:bg-secondary"
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

export const th = "px-3 py-2 text-left text-xs font-normal text-muted";
export const td = "px-3 py-2.5 align-top text-[13px] leading-6";

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
