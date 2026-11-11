// Seeds the fictional Canon Demo Co. workspace (plus a "Rival Demo Ltd." outsider workspace for isolation tests)
// into the Supabase project in .env.local, using the service key. Run after the migrations:
//   node scripts/seed-demo.mjs
// Idempotent: existing users, workspaces, memberships, rules and facts are left as they are. Never prints secrets.
// User ids are fixed because supabase/tests/security.sql refers to them.
import { createClient } from "@supabase/supabase-js";

for (const f of [".env.local", ".env.demo-accounts.local"]) {
  try {
    process.loadEnvFile(f);
  } catch {}
}
const env = process.env;
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) if (!env[k]) throw new Error(`${k} is not set`);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const USERS = [
  { key: "MANAGER", id: "00000000-0000-4000-a000-000000000001", name: "Maya Patel", org: "canon", role: "brand_manager" },
  { key: "REVIEWER", id: "00000000-0000-4000-a000-000000000002", name: "Ravi Kumar", org: "canon", role: "reviewer" },
  { key: "CREATOR", id: "00000000-0000-4000-a000-000000000003", name: "Chloe Martin", org: "canon", role: "creator" },
  { key: "OUTSIDER", id: "00000000-0000-4000-a000-000000000004", name: "Omar Haddad", org: "rival", role: "brand_manager" },
];

const RULES = {
  canon: [
    { code: "TONE-1", category: "tone", severity: "advisory", check_kind: "ai", source_ref: "Voice guide v4 §2.1",
      text: "Write in confident, plain language: no hype words such as revolutionary, game-changing or world-class." },
    { code: "TERM-1", category: "terminology", severity: "advisory", check_kind: "code", banned_term: "users", replacement: "customers",
      source_ref: "Voice guide v4 §3.2", text: "Call the people we serve “customers”, never “users”." },
    { code: "CLAIM-02", category: "claim", severity: "blocking", check_kind: "ai", source_ref: "Legal claims policy 2026 §1",
      text: "Superlatives and rankings (fastest, best, #1, leading) need an approved fact in the register before they are published." },
    { code: "MSG-1", category: "messaging", severity: "advisory", check_kind: "ai", source_ref: "Messaging house 2026",
      text: "Lead with the customer outcome, then the feature that delivers it." },
    { code: "ACC-1", category: "accessibility", severity: "advisory", check_kind: "ai", source_ref: "Accessibility checklist §4",
      text: "Spell out every acronym the first time it appears." },
  ],
  rival: [
    { code: "VOICE-1", category: "tone", severity: "advisory", check_kind: "ai", text: "Rival Demo Ltd. writes in a formal register." },
  ],
};

const FACTS = {
  canon: [
    { code: "FACT-1", text: "Canon Demo Co. serves 1,200 customers.", value: 1200, valid_from: "2026-01-01", valid_until: "2027-12-31",
      owner: "Finance · Priya N.", source_ref: "Q3 2026 board pack p.4" },
    { code: "FACT-2", text: "Canon Demo Co. is rated 4.8 out of 5 in the 2025 customer survey.", value: 4.8, valid_from: "2025-07-01",
      valid_until: "2026-06-30", owner: "Customer Insights · Leo T.", source_ref: "2025 customer survey summary" },
    { code: "FACT-3", text: "Canon Demo Co. is available in 9 countries.", value: 9, valid_from: "2026-03-01", owner: "Operations · Sam K.",
      source_ref: "Country launch tracker" },
    { code: "FACT-4", text: "Campaign approvals take a median of 2 days.", value: 2, valid_from: "2026-01-01", owner: "Marketing Ops · Ana P.",
      source_ref: "Workflow report H1 2026" },
    { code: "FACT-5", text: "Series B funding of 40 million closes in Q1 2027 and is not public.", value: 40000000, confidential: true,
      owner: "Finance · Priya N.", source_ref: "Board minutes (restricted)" },
  ],
  rival: [{ code: "FACT-1", text: "Rival Demo Ltd. has 300 customers.", value: 300, owner: "Rival Finance" }],
};

const ORGS = { canon: "Canon Demo Co.", rival: "Rival Demo Ltd." };

async function must(p, what) {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

// 1. Auth users (confirmed, so they can sign in at once)
const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
for (const u of USERS) {
  const email = env[`DEMO_${u.key}_EMAIL`];
  const password = env[`DEMO_${u.key}_PASSWORD`];
  if (!email || !password) throw new Error(`DEMO_${u.key}_EMAIL / _PASSWORD missing`);
  if (list.users.some((x) => x.id === u.id)) {
    console.log(`user ${email}: exists`);
    continue;
  }
  await must(
    db.auth.admin.createUser({ id: u.id, email, password, email_confirm: true, user_metadata: { display_name: u.name } }),
    `create ${email}`,
  );
  console.log(`user ${email}: created`);
}

// 2. Workspaces, memberships, Brand Kit
for (const [key, name] of Object.entries(ORGS)) {
  let org = (await must(db.from("organisations").select("id").eq("name", name), "find org"))[0];
  if (!org) org = (await must(db.from("organisations").insert({ name }).select("id"), "create org"))[0];
  console.log(`workspace ${name}: ${org.id}`);

  const members = USERS.filter((u) => u.org === key).map((u) => ({ org_id: org.id, user_id: u.id, role: u.role, display_name: u.name }));
  await must(db.from("memberships").upsert(members, { onConflict: "org_id,user_id", ignoreDuplicates: true }), "memberships");

  const creator = USERS.find((u) => u.org === key && u.role === "brand_manager").id;
  for (const [table, rows] of [["rules", RULES[key]], ["facts", FACTS[key]]]) {
    const have = new Set((await must(db.from(table).select("code").eq("org_id", org.id), table)).map((r) => r.code));
    const missing = rows.filter((r) => !have.has(r.code)).map((r) => ({ ...(table === "facts" ? { confidential: false } : {}), ...r, org_id: org.id, created_by: creator }));
    if (missing.length) await must(db.from(table).insert(missing), `insert ${table}`);
    console.log(`  ${table}: ${missing.length} added, ${have.size} already there`);
  }
}
console.log("seed done");
