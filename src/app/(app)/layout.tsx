import { getContext, ROLE_LABEL } from "@/lib/workspace";
import { signOut } from "../login/actions";
import { switchWorkspace } from "./actions";
import { Nav } from "./nav";
import { WorkspaceShell } from "./workspace-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, memberships, active } = await getContext();
  const name = active?.displayName || user.email || "Member";
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
  return (
    <WorkspaceShell
      workspace={active?.orgName ?? "Workspace"}
      sidebar={
        <>
          <Nav />
          <div className="mt-auto border-t border-line p-3">
            {memberships.length > 1 && (
              <form action={switchWorkspace} className="mb-3 space-y-2">
                <select
                  aria-label="Switch workspace"
                  name="org"
                  defaultValue={active?.orgId}
                  className="field !py-1.5 !text-xs"
                >
                  {memberships.map((m) => (
                    <option key={m.orgId} value={m.orgId}>
                      {m.orgName}
                    </option>
                  ))}
                </select>
                <button className="text-xs text-muted hover:text-ink">
                  Switch workspace
                </button>
              </form>
            )}
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded p-1.5 hover:bg-raised">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-raised text-[11px] font-medium">
                  {initials}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">
                    {name}
                  </span>
                  <span className="block text-[11px] text-muted">
                    {active ? ROLE_LABEL[active.role] : "No workspace"}
                  </span>
                </span>
              </summary>
              <div className="absolute bottom-full left-0 z-20 mb-2 w-full rounded-md border border-line bg-panel p-2 shadow-sm">
                <p className="truncate px-2 py-2 text-xs text-muted">
                  {user.email}
                </p>
                <form action={signOut}>
                  <button className="w-full rounded px-2 py-2 text-left text-sm hover:bg-secondary">
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </>
      }
    >
      {active ? (
        children
      ) : (
        <div className="py-12">
          <h1 className="text-xl font-semibold">No workspace yet</h1>
          <p className="mt-2 text-sm text-muted">
            Ask a Brand Manager to add {user.email} to their workspace.
          </p>
        </div>
      )}
    </WorkspaceShell>
  );
}
