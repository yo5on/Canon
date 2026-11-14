"use server";

import { revalidatePath } from "next/cache";
import { monitorWorkspace, type MonitorResult } from "@/lib/monitor";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireWorkspace } from "@/lib/workspace";

export type MonitorState = { error?: string; results?: MonitorResult[]; policy?: number; at?: string };

/** Brand Managers run monitoring on demand; the daily cron runs the same code. */
export async function runMonitoring(_prev: MonitorState, form: FormData): Promise<MonitorState> {
  const { user, active } = await requireWorkspace();
  if (active.role !== "brand_manager") return { error: "Only a Brand Manager can run monitoring." };
  try {
    const r = await monitorWorkspace(createAdminClient(), active.orgId, user.id, { force: form.get("force") === "on" });
    revalidatePath("/governance");
    return { results: r.results, policy: r.policy_version, at: new Date().toISOString() };
  } catch (e) {
    console.error("monitoring failed:", (e as Error)?.message);
    return { error: "Monitoring could not finish. Try again." };
  }
}
