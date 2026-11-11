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
    <main id="main-content" className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <section className="hidden flex-col justify-between border-r border-line bg-ink p-12 text-white lg:flex">
        <div className="flex items-center gap-3"><span className="canon-mark" aria-hidden="true">c</span><p className="canon-wordmark">canon<span className="text-brass">.</span></p></div>
        <div className="max-w-md">
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-brass">The standard behind every word</p>
          <h1 className="mt-5 font-serif text-4xl leading-tight tracking-tight">
            Your brand has standards.<br />Put them to work.
          </h1>
          <p className="mt-5 text-sm leading-7 text-white/75">Check drafts against your approved rules and facts. Review the evidence. Keep a record of every decision.</p>
          <div className="mt-10 border-t border-white/20 pt-5 text-xs text-white/75">01 &nbsp; Set the standard <span className="mx-3 text-brass">/</span> 02 &nbsp; Check the work <span className="mx-3 text-brass">/</span> 03 &nbsp; Decide</div>
        </div>
        <p className="text-xs text-white/65">Demo workspace: Canon Demo Co. · Fictional brand and data.</p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <p className="canon-wordmark lg:hidden">canon<span className="text-brass">.</span></p>
          <p className="label mt-6 lg:mt-0">Workspace access</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Sign in to Canon</h2>
          <p className="mt-1 text-sm text-muted">Use your workspace account.</p>
          <LoginForm demos={demos} />
        </div>
      </section>
    </main>
  );
}
