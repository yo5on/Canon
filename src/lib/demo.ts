// Seeded demo accounts for the fictional Canon Demo Co. workspace, read from server env vars
// (DEMO_MANAGER_EMAIL, DEMO_MANAGER_PASSWORD, ...). Nothing is hardcoded here.
export type DemoKey = "manager" | "reviewer" | "creator";

export const DEMO_ACCOUNTS: { key: DemoKey; role: string }[] = [
  { key: "manager", role: "Brand Manager" },
  { key: "reviewer", role: "Reviewer" },
  { key: "creator", role: "Creator" },
];

export function demoAccount(key: DemoKey) {
  const email = process.env[`DEMO_${key.toUpperCase()}_EMAIL`];
  const password = process.env[`DEMO_${key.toUpperCase()}_PASSWORD`];
  return email && password ? { email, password } : null;
}
