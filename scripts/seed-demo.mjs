// Seeds the fictional Canon Demo Co. workspace (plus a "Rival Demo Ltd." outsider workspace for isolation tests)
// into the Supabase project in .env.local, using the service key. Run after the migrations:
//   node scripts/seed-demo.mjs
// Idempotent, and also a reset: re-running it restores the demo passwords, the baseline Brand Kit (a changed rule or
// fact gets a new version with the baseline text, so history is kept) and the trusted sources. Never prints secrets.
// DEMO_SOURCE_BASE (default https://canon-rose.vercel.app) is where public/demo-sources/*.html is served.
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

const SRC = (process.env.DEMO_SOURCE_BASE ?? "https://canon-rose.vercel.app").replace(/\/$/, "");
RULES.canon.push(
  { code: "ACC-2", category: "accessibility", severity: "blocking", check_kind: "code", check_type: "contrast", params: { min_ratio: 4.5 },
    source_ref: "Accessibility checklist §2 (WCAG 2.2 AA 1.4.3)", text: "Text in images must have a contrast ratio of at least 4.5:1 against its background." },
  { code: "ACC-3", category: "accessibility", severity: "advisory", check_kind: "code", check_type: "alt_text", params: { min_length: 10 },
    source_ref: "Accessibility checklist §5", text: "Every image needs alt text of at least 10 characters that describes it." },
  { code: "BRAND-1", category: "visual", severity: "advisory", check_kind: "code", check_type: "palette",
    params: { colors: ["#28645A", "#FFFFFF", "#E6EFEB", "#1F2328"], max_delta: 12, min_share: 0.03 },
    source_ref: "Brand guidelines 2026 §6 Colour", text: "Images use only the brand palette: Canon green #28645A, white, mist #E6EFEB and ink #1F2328." },
);
const URLS = { "FACT-1": "/demo-sources/about.html", "FACT-2": "/demo-sources/survey-2025.html", "FACT-3": "/demo-sources/coverage.html", "FACT-4": "/demo-sources/about.html" };
for (const f of FACTS.canon) if (URLS[f.code]) f.source_url = SRC + URLS[f.code];
const SOURCES = { canon: [{ name: "Canon Demo Co. public site (fictional demo pages)", domain: new URL(SRC).host }], rival: [] };
const FIELDS = {
  rules: ["text", "category", "severity", "check_kind", "banned_term", "replacement", "check_type", "params", "source_ref"],
  facts: ["text", "value", "valid_from", "valid_until", "owner", "source_ref", "source_url", "confidential"],
};
const DEFAULTS = { banned_term: null, replacement: null, check_type: "banned_term", params: {}, source_ref: null, source_url: null, valid_from: null, valid_until: null, confidential: false };
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || (a != null && b != null && Number(a) === Number(b) && typeof b === "number");

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
    await must(db.auth.admin.updateUserById(u.id, { email, password, email_confirm: true }), `reset ${email}`);
    console.log(`user ${email}: exists, login restored`);
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
    const current = await must(db.from(table).select("*").eq("org_id", org.id).eq("is_current", true), table);
    let added = 0, restored = 0;
    for (const r of rows) {
      const want = { ...DEFAULTS, ...r };
      if (table === "rules") (delete want.source_url, delete want.valid_from, delete want.valid_until, delete want.confidential);
      else (delete want.banned_term, delete want.replacement, delete want.check_type, delete want.params);
      const cur = current.find((c) => c.code === r.code);
      if (!cur) {
        await must(db.from(table).insert({ ...want, org_id: org.id, created_by: creator, version: 1, is_current: true }), `insert ${table} ${r.code}`);
        added++;
        continue;
      }
      if (FIELDS[table].filter((k) => k in want).every((k) => same(cur[k], want[k]))) continue;
      // Same order as the app: new version not current → retire old → promote new.
      const [nv] = await must(db.from(table).insert({ ...want, org_id: org.id, created_by: creator, code: r.code, version: cur.version + 1, is_current: false }).select("id"), `version ${r.code}`);
      await must(db.from(table).update({ is_current: false }).eq("id", cur.id), `retire ${r.code}`);
      await must(db.from(table).update({ is_current: true }).eq("id", nv.id), `promote ${r.code}`);
      restored++;
    }
    console.log(`  ${table}: ${added} added, ${restored} restored to baseline`);
  }
  for (const t of SOURCES[key]) await must(db.from("trusted_sources").upsert({ org_id: org.id, ...t, active: true, added_by: creator }, { onConflict: "org_id,domain" }), "trusted source");
  await must(db.rpc("snapshot_policy", { p_org: org.id, p_note: "Demo baseline (seed script)" }), "snapshot");
}
console.log("seed done");
