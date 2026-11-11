import type { Metadata } from "next";
import { DEMO_ACCOUNTS, demoAccount } from "@/lib/demo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const demos = DEMO_ACCOUNTS.flatMap((d) => {
    const acc = demoAccount(d.key);
    // The password stays on the server: the demo button sends only the account key.
    return acc ? [{ ...d, email: acc.email }] : [];
  });

  return (
    <main id="main-content" className="min-h-screen bg-canvas">
      <header className="flex items-center gap-2 px-6 py-5">
        <span className="canon-mark">C</span>
        <span className="text-sm font-semibold">Canon</span>
      </header>
      <div className="mx-auto w-full max-w-sm px-6 pb-12 pt-8 sm:pt-14">
        <h1 className="text-2xl font-semibold tracking-tight">
          Sign in to Canon
        </h1>
        <p className="mt-2 text-sm text-muted">
          Your workspace for brand governance.
        </p>
        <LoginForm demos={demos} />
        <p className="mt-8 border-t border-line pt-4 text-xs leading-5 text-muted">
          Demo accounts open the fictional Canon Demo Co. workspace. Analysis is
          clearly labelled when using the mock provider.
        </p>
      </div>
    </main>
  );
}
