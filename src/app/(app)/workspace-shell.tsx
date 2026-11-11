"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";

export function WorkspaceShell({
  workspace,
  sidebar,
  children,
}: {
  workspace: string;
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const mobile = useRef<HTMLDialogElement>(null);
  const path = usePathname();
  const section = path.startsWith("/submissions")
    ? "Submissions"
    : path.startsWith("/brand-kit")
      ? "Brand Kit"
      : path.startsWith("/claims")
        ? "Claims Ledger"
        : path.startsWith("/review")
          ? "Review queue"
          : path.startsWith("/audit")
            ? "Audit history"
            : "Overview";

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const close = () => {
      if (desktop.matches) mobile.current?.close();
    };
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, []);

  const identity = (
    <Link
      href="/"
      className="flex min-w-0 items-center gap-2.5 rounded px-1 py-1 hover:bg-raised"
    >
      <span className="canon-mark">C</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">Canon</span>
        <span className="block truncate text-xs text-muted">{workspace}</span>
      </span>
    </Link>
  );

  return (
    <div className={`workspace-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      {!collapsed && (
        <aside className="workspace-sidebar">
          <div className="flex items-center justify-between gap-1 px-3 py-4">
            {identity}
            <button
              aria-label="Collapse sidebar"
              aria-expanded="true"
              className="icon-button shrink-0"
              onClick={() => setCollapsed(true)}
            >
              <Icon name="panel" />
            </button>
          </div>
          {sidebar}
        </aside>
      )}
      <dialog
        ref={mobile}
        aria-label="Workspace navigation"
        className="mobile-navigation"
        onClick={(e) => {
          if (e.target === e.currentTarget) mobile.current?.close();
        }}
      >
        <div
          className="flex h-full w-[272px] flex-col bg-secondary"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) mobile.current?.close();
          }}
        >
          <div className="flex items-center justify-between px-3 py-4">
            {identity}
            <button
              aria-label="Close navigation"
              className="icon-button"
              onClick={() => mobile.current?.close()}
            >
              <Icon name="close" />
            </button>
          </div>
          {sidebar}
        </div>
      </dialog>
      <div className="min-w-0">
        <header className="workspace-toolbar">
          <button
            aria-label="Open navigation"
            aria-haspopup="dialog"
            className="icon-button md:hidden"
            onClick={() => mobile.current?.showModal()}
          >
            <Icon name="menu" />
          </button>
          {collapsed && (
            <button
              aria-label="Expand sidebar"
              aria-expanded="false"
              className="icon-button hidden md:grid"
              onClick={() => setCollapsed(false)}
            >
              <Icon name="panel" />
            </button>
          )}
          <span className="hidden truncate text-xs text-muted sm:block">
            {workspace}
          </span>
          <span className="hidden text-xs text-faint sm:block">/</span>
          <span className="flex items-center gap-2 text-xs">
            <Icon name="file" size={14} />
            {section}
          </span>
          <Link
            href="/submissions/new"
            className="ml-auto flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-muted hover:bg-secondary hover:text-ink"
          >
            <Icon name="plus" size={15} />
            <span>New submission</span>
          </Link>
        </header>
        <main id="main-content" className="workspace-content">
          {children}
        </main>
      </div>
    </div>
  );
}
