import type { Metadata } from "next";
import { DEMO_ACCOUNTS, aiMode, demoAccount } from "@/lib/demo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const CAPABILITIES: [string, string][] = [
  ["Sign-in, roles, row-level security", "Real (Supabase)"],
  ["PDF, DOCX text and image OCR", "Real, runs on the server"],
  ["Banned terms, contrast, palette, alt text", "Real, deterministic code checks"],
  ["Fact register and claim statuses", "Real, decided by code from approved facts"],
  ["Trusted-source retrieval", "Real https fetch of approved domains"],
  ["Policy versions, monitoring, webhooks, publish-gate API", "Real"],
];

export default function LoginPage() {
  const ai = aiMode();
  const demos = DEMO_ACCOUNTS.flatMap((d) => {
    const acc = demoAccount(d.key);
    // Shown on purpose (fictional workspace, restricted roles); the button still sends only the account key.
    return acc ? [{ key: d.key, role: d.role, can: d.can, email: acc.email, password: acc.password }] : [];
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
        <section className="mt-8 border-t border-line pt-4 text-xs leading-5 text-muted">
          <p>
            Demo accounts open the fictional Canon Demo Co. workspace. Signing in with a demo button restores that
            account’s login, so changes by one visitor can’t lock out the next. A Creator can’t approve their own work.
          </p>
          <p className="label mt-4">What is real in this deployment</p>
          <table className="mt-2 w-full text-left">
            <tbody className="divide-y divide-line">
              {CAPABILITIES.map(([what, how]) => (
                <tr key={what}>
                  <td className="py-1.5 pr-3 text-ink">{what}</td>
                  <td className="py-1.5">{how}</td>
                </tr>
              ))}
              <tr>
                <td className="py-1.5 pr-3 text-ink">AI rule and claim review</td>
                <td className="py-1.5">
                  {ai === "live" ? "Live Claude model" : "Demo / mock provider (no AI key configured). Every report says so."}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
