"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/submissions", label: "Submissions" },
  { href: "/brand-kit", label: "Brand Kit" },
  { href: "/claims", label: "Claims Ledger" },
  { href: "/review", label: "Review queue" },
  { href: "/audit", label: "Audit history" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
      {ITEMS.map((i) => {
        const on = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={on ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg border-l-2 px-3 py-2 text-sm transition-colors ${
              on ? "border-accent bg-raised text-ink" : "border-transparent text-muted hover:bg-raised/60 hover:text-ink"
            }`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
