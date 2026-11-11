import type { Metadata } from "next";
import { DEMO_ACCOUNTS, demoAccount } from "@/lib/demo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const demos = DEMO_ACCOUNTS.flatMap((d) => {
    const acc = demoAccount(d.key);
    return acc ? [{ ...d, ...acc }] : [];
  });

  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <section className="hidden flex-col justify-between border-r border-line bg-panel p-12 lg:flex">
        <p className="font-mono text-sm font-semibold tracking-[0.35em]">CANON</p>
        <div className="max-w-md">
          <p className="label">Brand compliance, cited</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight">
            Every finding quotes the rule it breaks. Every claim checks against a fact you approved.
          </h1>
          <ul className="mt-8 space-y-3 text-sm text-muted">
            <li>· Brand Kit of versioned rules and owned facts</li>
            <li>· Claims Ledger: supported, contradicted, outdated</li>
            <li>· Human approval, with reasons on every override</li>
          </ul>
        </div>
        <p className="text-xs text-faint">Demo data is invented for the fictional “Canon Demo Co.”</p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <p className="font-mono text-sm font-semibold tracking-[0.35em] lg:hidden">CANON</p>
          <h2 className="mt-6 text-2xl font-semibold tracking-tight lg:mt-0">Sign in</h2>
          <p className="mt-1 text-sm text-muted">Use your workspace account.</p>
          <LoginForm demos={demos} />
        </div>
      </section>
    </main>
  );
}
