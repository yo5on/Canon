# Canon

Brand compliance with citations. A Creator submits marketing text; Canon runs code checks and an AI audit,
verifies every quote against the Brand Kit, decides each claim's status in the **Claims Ledger**
(SUPPORTED, CONTRADICTED, OUTDATED, UNSUPPORTED, HUMAN_JUDGEMENT), and a Reviewer approves, requests changes or rejects.
Permissions live in Postgres (RLS, state-change functions, approval trigger, append-only audit log).
See `docs/ROUND2_PLAN.md` and `docs/SECURITY_HARDENING.md`.

## DEMO/MOCK mode

With `CANON_AI_MOCK=1`, the AI call is replaced by deterministic sample checks
(`src/lib/ai.mock.ts`). **No AI model is called.** Runs are stored with model `mock` and every report is labelled
DEMO/MOCK. The verifier, Claims Ledger, findings and review workflow all run for real on that response. The new-submission
form is prefilled with the matching demo draft. Only recognised sample phrases still present in the submitted
text produce mock findings or claims; other wording needs manual review. This is not general AI analysis.

## Setup

1. `npm install`
2. `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `CANON_AI_MOCK=1`.
   Demo logins go in `.env.demo-accounts.local` (`DEMO_MANAGER_EMAIL`/`_PASSWORD`, `DEMO_REVIEWER_*`, `DEMO_CREATOR_*`, `DEMO_OUTSIDER_*`).
   Both files are gitignored. In a deployment, set the same variables in the host.
3. Apply `supabase/migrations/0001`–`0004` in order (SQL editor or `supabase db push`).
4. `node scripts/seed-demo.mjs` creates the demo users, the fictional "Canon Demo Co." workspace (Brand Kit rules and facts,
   one confidential) and a "Rival Demo Ltd." workspace for isolation tests. It is idempotent.
5. `npm run dev`

## Checks

- `npm test` unit tests, plus live RLS tests when the env files are present
- `node scripts/e2e-api.mjs` workflow and permission checks against the live project (creates `[E2E]` items)
- `supabase/tests/security.sql` paste into the SQL editor; everything rolls back
- `npm run lint`, `npx tsc --noEmit`, `npm run build`

On Windows networks that use the system certificate store, set `NODE_USE_SYSTEM_CA=1` before running Node checks.

## Demo accounts

| Role | Email |
|---|---|
| Brand Manager | manager@canon-demo.test |
| Reviewer | reviewer@canon-demo.test |
| Creator | creator@canon-demo.test |

The login page has one-click demo sign-in; passwords stay on the server.
