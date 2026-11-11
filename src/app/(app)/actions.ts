"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext, WS_COOKIE } from "@/lib/workspace";

export async function switchWorkspace(form: FormData) {
  const org = z.uuid().safeParse(form.get("org"));
  const { memberships } = await getContext();
  // Only workspaces the database says this user belongs to.
  if (!org.success || !memberships.some((m) => m.orgId === org.data)) return;
  (await cookies()).set(WS_COOKIE, org.data, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  revalidatePath("/", "layout");
}
