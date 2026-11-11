import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type Role = "brand_manager" | "reviewer" | "creator";
export const ROLE_LABEL: Record<Role, string> = {
  brand_manager: "Brand Manager",
  reviewer: "Reviewer",
  creator: "Creator",
};
export const WS_COOKIE = "canon_ws";

export interface Membership {
  orgId: string;
  orgName: string;
  role: Role;
  displayName: string;
}

/**
 * The signed-in user and their workspace memberships, read from Supabase as that user (RLS applies).
 * The role always comes from the database; the cookie only picks among workspaces the user belongs to.
 */
export const getContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("memberships")
    .select("org_id, role, display_name, organisations(name)")
    .eq("user_id", user.id);
  if (error) throw new Error("Could not load your workspaces.");

  const memberships: Membership[] = (data ?? [])
    .map((m) => ({
      orgId: m.org_id as string,
      orgName: (m.organisations as unknown as { name: string } | null)?.name ?? "Workspace",
      role: m.role as Role,
      displayName: (m.display_name as string) || user.email || "",
    }))
    .sort((a, b) => a.orgName.localeCompare(b.orgName));

  const wanted = (await cookies()).get(WS_COOKIE)?.value;
  const active = memberships.find((m) => m.orgId === wanted) ?? memberships[0] ?? null;
  return { supabase, user, memberships, active };
});

/** Display names of everyone in the workspace, keyed by user id (RLS: members only see their own workspace). */
export async function memberNames(orgId: string) {
  const { supabase } = await getContext();
  const { data, error } = await supabase.from("memberships").select("user_id, display_name").eq("org_id", orgId);
  if (error) throw new Error("Could not load workspace members.");
  return new Map((data ?? []).map((m) => [m.user_id as string, (m.display_name as string) || "Member"]));
}

/** Same as getContext, but the user must belong to a workspace. */
export async function requireWorkspace() {
  const ctx = await getContext();
  if (!ctx.active) redirect("/");
  return { ...ctx, active: ctx.active };
}
