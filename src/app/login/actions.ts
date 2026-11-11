"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { demoAccount, type DemoKey } from "@/lib/demo";

export type SignInState = { error?: string; email?: string };

const credentials = z.object({
  email: z.email("Enter a valid email address").max(254),
  password: z.string().min(1, "Enter your password").max(200),
});

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  // A demo button sends only which account; the password stays on the server.
  const demo = z.enum(["manager", "reviewer", "creator"]).safeParse(form.get("demo"));
  const input = demo.success
    ? demoAccount(demo.data as DemoKey)
    : { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") };
  if (!input) return { error: "That demo account is not configured on this server." };

  const parsed = credentials.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message, email: input.email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "invalid_credentials") return { error: "Email or password is incorrect.", email: parsed.data.email };
    // Not a credentials problem (network, config, rate limit): say so instead of blaming the password.
    console.error("sign-in failed:", error.status, error.code, error.message);
    return { error: "Sign-in is unavailable right now. Try again shortly.", email: parsed.data.email };
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
