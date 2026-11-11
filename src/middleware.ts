import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session on every request and keeps signed-out users on /login.
// Pages re-check the user server-side too, so this is not the only gate.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(toSet, headers) {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const onLogin = request.nextUrl.pathname === "/login";

  if (!user && !onLogin) return redirectKeepingCookies(request, response, "/login");
  if (user && onLogin) return redirectKeepingCookies(request, response, "/");
  return response;
}

function redirectKeepingCookies(request: NextRequest, from: NextResponse, path: string) {
  const to = NextResponse.redirect(new URL(path, request.url));
  from.cookies.getAll().forEach((c) => to.cookies.set(c));
  return to;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
