"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icon";

const GROUPS: {
  label: string;
  items: { href: string; label: string; icon: IconName }[];
}[] = [
  {
    label: "Workspace",
    items: [
      { href: "/", label: "Overview", icon: "home" },
      { href: "/submissions", label: "Submissions", icon: "file" },
      { href: "/review", label: "Review queue", icon: "check" },
    ],
  },
  {
    label: "Brand knowledge",
    items: [
      { href: "/brand-kit", label: "Brand Kit", icon: "book" },
      { href: "/claims", label: "Claims Ledger", icon: "table" },
    ],
  },
  {
    label: "Governance",
    items: [{ href: "/audit", label: "Audit history", icon: "history" }],
  },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="space-y-5 px-2 py-3">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-2 text-[11px] font-medium text-muted">
            {group.label}
          </p>
          {group.items.map((item) => {
            const active =
              item.href === "/" ? path === "/" : path.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`my-0.5 flex items-center gap-2.5 rounded px-2 py-2 text-[13px] transition-colors ${active ? "bg-raised font-medium text-ink" : "text-muted hover:bg-raised hover:text-ink"}`}
              >
                <Icon name={item.icon} size={17} />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
