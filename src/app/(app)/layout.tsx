import { getContext, ROLE_LABEL } from "@/lib/workspace";
import { signOut } from "../login/actions";
import { switchWorkspace } from "./actions";
import { Nav } from "./nav";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, memberships, active } = await getContext();
  const name = active?.displayName || user.email || "";
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className="flex flex-col border-b border-line bg-panel md:sticky md:top-0 md:h-screen md:border-r md:border-b-0">
        <div className="px-5 py-6">
          <Link href="/" aria-label="Canon overview" className="flex items-center gap-3">
            <span className="canon-mark" aria-hidden="true">c</span>
            <span className="canon-wordmark">canon<span className="text-brass">.</span></span>
          </Link>
          <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">Brand governance</p>
        </div>
        <Nav />
        <div className="mt-auto hidden border-t border-line px-5 py-4 md:block">
          <p className="text-xs text-faint">Workspace</p>
          {memberships.length > 1 ? (
            <form action={switchWorkspace} className="mt-1">
              <label className="sr-only" htmlFor="ws">
                Switch workspace
              </label>
              <select id="ws" name="org" defaultValue={active?.orgId} className="field !py-1.5 !text-sm">
                {memberships.map((m) => (
                  <option key={m.orgId} value={m.orgId}>
                    {m.orgName}
                  </option>
                ))}
              </select>
              <button className="mt-2 text-xs text-accent hover:underline">Switch</button>
            </form>
          ) : (
            <p className="mt-0.5 text-sm">{active?.orgName ?? "None"}</p>
          )}
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3 sm:px-8">
          <p className="truncate text-xs text-muted">{active?.orgName ?? "Canon"}</p>
          <div className="flex items-center gap-3">
          {active && (
            <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-xs text-accent">
              {ROLE_LABEL[active.role]}
            </span>
          )}
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1 hover:bg-raised">
              <span className="hidden text-sm sm:inline">{name}</span>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-accent/20 font-mono text-xs text-accent">
                {initials}
              </span>
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-line bg-panel p-2 shadow-lg shadow-black/5">
              <div className="px-3 py-2">
                <p className="text-sm font-medium">{name}</p>
                <p className="truncate font-mono text-xs text-muted">{user.email}</p>
                {active && (
                  <p className="mt-1 text-xs text-faint">
                    {ROLE_LABEL[active.role]} · {active.orgName}
                  </p>
                )}
              </div>
              {memberships.length > 1 && (
                <form action={switchWorkspace} className="border-t border-line px-3 py-2 md:hidden">
                  <select name="org" defaultValue={active?.orgId} className="field !py-1.5" aria-label="Switch workspace">
                    {memberships.map((m) => (
                      <option key={m.orgId} value={m.orgId}>
                        {m.orgName}
                      </option>
                    ))}
                  </select>
                  <button className="mt-2 text-xs text-accent">Switch</button>
                </form>
              )}
              <form action={signOut} className="border-t border-line pt-1">
                <button className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-panel">Sign out</button>
              </form>
            </div>
          </details>
          </div>
        </header>
        <main id="main-content" className="mx-auto max-w-[1500px] px-4 py-6 sm:px-8">
          {active ? (
            children
          ) : (
            <div className="mx-auto max-w-md rounded-xl border border-line bg-panel px-6 py-12 text-center">
              <p className="text-lg font-medium">You’re not in a workspace yet</p>
              <p className="mt-1 text-sm text-muted">Ask a Brand Manager to add {user.email} to their workspace.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
