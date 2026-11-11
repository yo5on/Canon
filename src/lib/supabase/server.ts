import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** User-scoped client: every query runs as the signed-in user, so RLS applies. */
export async function createClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll(toSet) {
          try {
            toSet.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Called from a Server Component, where cookies are read-only. The middleware refreshes the session.
          }
        },
      },
    },
  );
}
