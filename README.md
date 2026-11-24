<div align="center">
<samp><b>Canon</b></samp>
</div>

---

<samp>Brand compliance with citations. A Creator submits marketing text; Canon runs code checks and an AI audit,</samp>
<samp>verifies every quote against the Brand Kit, decides each claim's status in the **Claims Ledger**</samp>
<samp>(SUPPORTED, CONTRADICTED, OUTDATED, UNSUPPORTED, HUMAN_JUDGEMENT), and a Reviewer approves, requests changes or rejects.</samp>
<samp>Permissions live in Postgres (RLS, state-change functions, approval trigger, append-only audit log).</samp>
<samp>See `docs/ROUND2_PLAN.md` and `docs/SECURITY_HARDENING.md`.</samp>


---

<div align="center"><samp><b>DEMO/MOCK mode</b></samp></div>

<samp>With `CANON_AI_MOCK=1`, the AI call is replaced by deterministic sample checks</samp>
<samp>(`src/lib/ai.mock.ts`). **No AI model is called.** Runs are stored with model `mock` and every report is labelled</samp>
<samp>DEMO/MOCK. The verifier, Claims Ledger, findings and review workflow all run for real on that response. The new-submission</samp>
<samp>form is prefilled with the matching demo draft. Only recognised sample phrases still present in the submitted</samp>
<samp>text produce mock findings or claims; other wording needs manual review. This is not general AI analysis.</samp>


---

<div align="center"><samp><b>Setup</b></samp></div>

1. <samp>`npm install`</samp>
2. <samp>`.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `CANON_AI_MOCK=1`.</samp>
<samp>   Demo logins go in `.env.demo-accounts.local` (`DEMO_MANAGER_EMAIL`/`_PASSWORD`, `DEMO_REVIEWER_*`, `DEMO_CREATOR_*`, `DEMO_OUTSIDER_*`).</samp>
<samp>   Both files are gitignored. In a deployment, set the same variables in the host.</samp>
3. <samp>Apply `supabase/migrations/0001`–`0004` in order (SQL editor or `supabase db push`).</samp>
4. <samp>`node scripts/seed-demo.mjs` creates the demo users, the fictional "Canon Demo Co." workspace (Brand Kit rules and facts,</samp>
<samp>   one confidential) and a "Rival Demo Ltd." workspace for isolation tests. It is idempotent.</samp>
5. <samp>`npm run dev`</samp>


---

<div align="center"><samp><b>Checks</b></samp></div>

- <samp>`npm test` unit tests, plus live RLS tests when the env files are present</samp>
- <samp>`node scripts/e2e-api.mjs` workflow and permission checks against the live project (creates `[E2E]` items)</samp>
- <samp>`supabase/tests/security.sql` paste into the SQL editor; everything rolls back</samp>
- <samp>`npm run lint`, `npx tsc --noEmit`, `npm run build`</samp>

<samp>On Windows networks that use the system certificate store, set `NODE_USE_SYSTEM_CA=1` before running Node checks.</samp>


---

<div align="center"><samp><b>Demo accounts</b></samp></div>

| Role | Email |
|---|---|
| Brand Manager | manager@canon-demo.test |
| Reviewer | reviewer@canon-demo.test |
| Creator | creator@canon-demo.test |

<samp>The login page has one-click demo sign-in; passwords stay on the server.</samp>
