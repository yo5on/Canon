// Seeded demo accounts for the fictional Canon Demo Co. workspace, read from server env vars
// (DEMO_MANAGER_EMAIL, DEMO_MANAGER_PASSWORD, ...). Nothing is hardcoded here. These are throwaway logins for a
// fictional workspace and are shown on the login page on purpose; they grant no access to any real data.
export type DemoKey = "manager" | "reviewer" | "creator";

// Fixed ids from scripts/seed-demo.mjs, so a demo sign-in can restore the account if someone changed it.
export const DEMO_ACCOUNTS: { key: DemoKey; role: string; id: string; can: string }[] = [
  { key: "manager", role: "Brand Manager", id: "00000000-0000-4000-a000-000000000001", can: "Brand Kit, trusted sources, policy versions, monitoring, integrations" },
  { key: "reviewer", role: "Reviewer", id: "00000000-0000-4000-a000-000000000002", can: "Review queue, decisions on findings and submissions" },
  { key: "creator", role: "Creator", id: "00000000-0000-4000-a000-000000000003", can: "Submit text, PDF, DOCX or images and run checks" },
];

export function demoAccount(key: DemoKey) {
  const email = process.env[`DEMO_${key.toUpperCase()}_EMAIL`];
  const password = process.env[`DEMO_${key.toUpperCase()}_PASSWORD`];
  return email && password ? { email, password } : null;
}

/** Same choice as aiClient() in analyze.ts: mock flag first, then a real key, else no AI provider at all. */
export const aiMode = () => (process.env.CANON_AI_MOCK === "1" ? "mock" : process.env.ANTHROPIC_API_KEY ? "live" : "off");
