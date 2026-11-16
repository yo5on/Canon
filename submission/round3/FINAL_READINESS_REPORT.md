# Canon: Round 3 Final Readiness Report

Date: 16 Nov 2026 · Repository: `E:\codetitans\canon`, branch `main` @ `8790438` (`87904388…`) · Production: https://canon-rose.vercel.app

## 1. Executive verdict: **READY WITH CAVEATS**

The application deployed on `87904388` works and discloses its limits honestly. The production database hardening is live, and I verified it read-only today. The caveats:

- AI analysis is DEMO/MOCK in production, as disclosed.
- Several Round 2 promises are partial or not done. This is now stated in Appendix B of the PDF.
- Everything changed in this review is **uncommitted** (superseded: since committed as `c831826` on branch `round3-final-readiness`; not merged into `main`). Only you can decide whether to commit or push, and a push to `main` redeploys production (§11).

## 2. Critical issues found and fixed (working copy only, uncommitted)

| # | Issue | Fix |
|---|---|---|
| 1 | The production hardening (token-hash access, one-way revocation, workspace-scoped notifications, membership-aware notification reads, Storage folder validation) was in no numbered migration. A fresh database built from `supabase/migrations/` would therefore lack it. | New `supabase/migrations/0007_round3_hardening.sql`: the same SQL as the four applied scripts, without the production fingerprint guards, re-runnable, with postcondition asserts. |
| 2 | The submission called the hardening "team-reported, not independently verified". | I verified it read-only on production (§4) and updated §7 and Appendix A. |
| 3 | The submission had no line-by-line mapping of the Round 2 promises. Items not delivered (logo checks, policy-change preview, live inference, Canon Bench) or only partly delivered (native CMS integration, fact-owner notification, background jobs) were never stated. | New Appendix B (page 14) and a limitation row for "No native CMS integration". |
| 4 | The submission said "Overriding a finding requires a written reason" without saying where this is enforced. | Wording made precise: it is checked by the server action (`actions.ts:38`) **and** by the `finding_decisions_check` constraint (`decision = 'accepted' OR length(trim(reason)) >= 3`), which I confirmed read-only on production. (An earlier draft of this review wrongly reported a database gap here, because only the function body had been checked. That was corrected before finishing.) |
| 5 | The login page said mock mode means "no AI key configured". The code actually uses mock whenever `CANON_AI_MOCK=1`, and calls no provider at all when there is neither the flag nor a key. | `src/lib/demo.ts` `aiMode()` now returns `mock`, `live` or `off`, matching `aiClient()`. The login text now says "fixed sample responses, not general AI analysis. No AI model is called". The SUPPORTED meaning was added to the capability table. **This only reaches production after a deploy.** |
| 6 | No test covered the publish-gate API or API-token rejection. | New `src/app/api/v1/items/[id]/gate/route.test.ts` (3 tests). Its mock applies the route's `eq`/`is` filters. I checked that it can fail: removing `.is("revoked_at", null)` from `apitoken.ts`, or `.eq("org_id", org)` from the route, each makes one test fail. Both files were restored with `git checkout`. |

## 3. Critical issues still unresolved

No critical issue remains open. The cover and §8 "this review" smoke-test statements come from the earlier document review; I did not use the production UI in this session. The remaining items are:
1. Nothing in this review is committed or deployed. That includes `0007`, the login disclosure fix, the gate test and the document fixes. See §11.
2. The lower-severity security items in §7.

## 4. Hardening migration status

**Files in `supabase/round3-production/hardening/` (untracked):** `1-token-hardening.sql` (+ `.rollback.sql`), `2a-notify-workspace.sql`, `2b-notifications-membership.sql`, `2c-storage-folder.sql` and `verify.sql`. Each one is wrapped in a transaction and pinned to production by `system_identifier`.

**What they change:**
- `api_tokens`: removes all table privileges from anon and authenticated. Authenticated then gets column SELECT on the 8 metadata columns (not `token_hash`) and UPDATE on `revoked_at` only. `tok_update` becomes one-way (live → revoked).
- The 7 Round 3 tables: TRUNCATE, REFERENCES, TRIGGER and MAINTAIN are revoked from clients.
- `private.notify_from_audit`: the item lookup is limited to the audit row's own workspace, and nothing is sent when the item is missing.
- `notif_read`: also requires `private.is_member(org_id)`.
- `content_sources_read`: the CASE expression casts to uuid only when the name is uuid-shaped. Other names are denied instead of raising an error.

**None of this was in migrations 0001–0006.** It now is, as `0007_round3_hardening.sql`.

**Production state, verified read-only today** (`PGOPTIONS=-c default_transaction_read_only=on`, `verify.sql` plus catalog queries; output saved to `D:\Backups\Canon-Production\verify-final-readiness-20261116.txt` and `D:\Backups\Canon-Production\catalog-final-readiness-20261116.txt`):
- `is_canon_prod = t` and `read_only = on`.
- `token_hash`: no client access. Authenticated can UPDATE `revoked_at` only.
- `tok_update`, `notif_read` and `content_sources_read` match the hardened definitions.
- No TRUNCATE, REFERENCES, TRIGGER or MAINTAIN for clients on the 7 tables.
- `notify_from_audit` contains the workspace filter, and `md5(prosrc)` = `bf9ac2ff…d6ac`, byte-identical to 0007.
- Row Level Security is on for all 20 public tables, with none off.
- No `supabase_migrations` table exists: production does not track migrations.
- Data: 1 token (revoked), 0 notifications, 59 audit rows.

**Testing of 0007** (`supabase/tests/pglite/0007-hardening.mjs`, in-memory PGlite, no network): **27/27 PASS on PostgreSQL 17.5 and 27/27 on 18.6.**
- The schema built from 0001–0007 is structurally identical to the production path (`apply-round3-production.sql` Section 2 followed by the four hardening scripts). Compared: table and column ACLs, policies, function bodies and ACLs, triggers, RLS.
- Re-running 0007 changes nothing. Running it on an already-hardened database changes nothing.
- Negative controls fail without 0007, as they should.
- Behaviour checks: tokens, cross-workspace isolation, notifications after leaving a workspace, storage names.

**Limits:** PGlite emulates Supabase's roles, `auth` and `storage`; it is not Supabase. Supautils, PostgREST and the Storage API were not exercised. MAINTAIN needs PostgreSQL 17 or later.

**Manual application:** **do not apply 0007 to production. Production already has it.** Production does not track migrations, so nothing needs recording. If you want to re-confirm at any time (read-only):
```bash
PGOPTIONS="-c default_transaction_read_only=on" psql -X -h db.fkxrmppwaaryljmzznym.supabase.co -U postgres -d postgres -f supabase/round3-production/hardening/verify.sql
```
On a fresh or local database, 0007 runs in order after 0006. If it is ever re-run on production, it is a no-op: only REVOKE/GRANT, `DROP … IF EXISTS` + CREATE and `CREATE OR REPLACE`, no row changes. It does take short locks on `api_tokens`, `notifications` and `storage.objects`.

## 5. Round 2 commitment-to-delivery mapping

Source: Round 2 submission, §08 "Round 3 roadmap" (`docs/round2/Canon_CodeTitans_Round2_Submission.html`). The same table is Appendix B of the PDF.

| Area | Promise | Status | Evidence / gap |
|---|---|---|---|
| A Multimodal | PDF/DOCX extraction mapped to page and position | Partial | Page and paragraph refs; no layout coordinates (`src/lib/extract.ts`) |
| | Palette, contrast, text in images | Delivered | `src/lib/visualchecks.ts`, OCR in `extract.ts` |
| | Logo-use checks | Not done | No code |
| | Accessibility in code (contrast, alt text) | Delivered | Rule rows `check_type` contrast / alt_text |
| | Visual findings cite a verified region | Delivered | Region outside image → downgraded (`governance.test.ts`) |
| | Brand Kit asset library (logos, palette, fonts) | Partial | Palette as rule params only |
| B Sources | Trusted-source allowlist, SSRF guard | Delivered | `src/lib/sources.ts` `safeFetch`/`assertFetchable` (https, private IPs, each redirect) |
| | Source ref on facts, shown on claims | Delivered | `facts.source_url`, `claims.evidence` |
| | Changed / unavailable / unsupported outcomes | Delivered | Outcomes `confirmed/not_found/changed/unavailable/blocked`; an unreachable source never changes a status (`ledger.test.ts`) |
| | Detect outdated claims on source change; notify fact owner | Partial | Source checks run on demand. A `changed` outcome alerts the workspace's Brand Managers; the named owner is not notified; the cron does not re-fetch sources |
| | Retrieved source ≠ automatic SUPPORTED | Delivered | `ledger.ts`, tests |
| | Relevant-fact retrieval | Delivered | Overlap ranking; unused in production (mock) |
| C Governance | Native publishing-platform integrations | **Partial: no native CMS integration** | Publish-gate API (`src/app/api/v1/items/[id]/gate`), webhooks (Slack-compatible, HMAC JSON) |
| | Policy versioning and change history | Delivered | `policy_versions`, `snapshot_policy`, history pages |
| | Preview policy change against content | Not done | — |
| | Continuous monitoring | Delivered | `src/lib/monitor.ts`, `/api/cron/monitor`, `vercel.json` daily |
| | Notifications | Delivered | `notifications` + `notify_from_audit` trigger, inbox |
| | Webhooks | Delivered | `src/lib/webhooks.ts` |
| | Background jobs with retries | Partial | Daily cron; analysis is synchronous; no queue |
| | Guideline Gap Radar | Delivered | `governance/page.tsx` |
| Reliability | Live inference in production | Not done | Mock in production |
| | Canon Bench measurement | Not done | No accuracy claims |

## 6. Test results

### Commands executed

| Command | Result |
|---|---|
| `npx tsc --noEmit` | PASS, exit 0 |
| `npm run lint` | PASS: 0 errors, 3 warnings (pre-existing, in `scripts/e2e-http.mjs` and `scripts/seed-demo.mjs`) |
| `npx vitest run --exclude src/lib/rls.live.test.ts --exclude "**/node_modules/**"` | PASS: **113/113 in 14 files**. Before this review's changes: 110/110 in 13 files. One warning: Tesseract "Invalid resolution 25 dpi", from a test fixture. |
| `npm run build` (Next 15.5.29) | PASS, exit 0, all routes compiled |
| `node supabase/tests/pglite/0007-hardening.mjs pglite17` / `… (PG18)` | PASS 27/27 and 27/27 |
| Read-only `verify.sql` on production | All hardening postconditions true |

**Not executed:**
- `src/lib/rls.live.test.ts` (9 tests): it signs in to production.
- `supabase/tests/security.sql`: it writes fixtures, though it rolls them back, and is meant for the production SQL editor.
- `scripts/e2e-http.mjs`, `scripts/e2e-api.mjs`, `scripts/seed-demo.mjs`: they write to production.
- No browser run of the app: a local `next dev` uses the production `.env.local`, and the demo sign-in resets production accounts.

### Journey

| Step | Result | Evidence |
|---|---|---|
| Creator submission (end to end) | NOT TESTED | Needs the live database |
| PDF and DOCX extraction | PASS | `extract.test.ts` (page map, paragraph refs) |
| Image OCR | PASS | `extract.test.ts` (banner fixture) |
| Analysis and Claims Ledger | PASS (unit) | `pipeline.test.ts`, `ledger.test.ts`, `analyze/route.test.ts` |
| Reviewer decision | PASS (unit, mocked DB) | `submissions/[id]/actions.test.ts` |
| Override reason enforcement | PASS (server action) / verified by inspection (DB) | `actions.ts:38`; `finding_decisions_check` constraint present on production (read-only). The constraint was not exercised with a write |
| Audit history | PASS (unit: success never reported without an audit row) | `analyze/route.test.ts`. `audit_log` immutability not re-tested |
| Policy version changes | PASS (unit) | `governance.test.ts` |
| Monitoring | PASS (unit) | `governance.test.ts` (only new blocking issues alert) |
| Notifications | PASS (PGlite) | 0007 test: own workspace only; hidden after leaving |
| API token creation | NOT TESTED | Server action not covered |
| API token use | PASS (unit) | Gate route test |
| API token revocation | PASS (PGlite) | One-way, Brand Manager only, `returning prefix` works |
| Webhook signing and delivery failure | PASS (unit) | `governance.test.ts`: HMAC, HTTP errors, network failures, blocked targets |
| Publish-gate API | PASS (unit) | New gate test |

### Failure cases

| Case | Result | Evidence |
|---|---|---|
| Invalid file type | PASS | `extract.test.ts` (magic bytes, unsupported) |
| File over size limit | PASS | `extract.test.ts`; `/api/uploads` also rejects over 10 MB (code read) |
| Empty or unreadable file | PASS | Empty file; corrupt PDF; zip that is not DOCX |
| Invalid source URL | PASS | Non-https and off-allowlist rejected (`sources.test.ts`, `brandkit.test.ts`) |
| Private or internal IP | PASS | `sources.test.ts` (private, loopback, link-local; redirect hops) |
| Expired fact | PASS | `ledger.test.ts` OUTDATED cases |
| Changed source content | PASS | `sources.test.ts` "changed" |
| Unauthorised workspace access | PASS (scoped) | PGlite: tokens, notifications, storage across workspaces; gate 404 for another org's item. Full live RLS suite not run |
| Creator approving own content | PASS (PGlite) | Even a privileged insert into `approvals` with approver = author is rejected by the `approvals_guard` trigger (0007 test) |
| Invalid or revoked API token | PASS | Gate test: 401 for missing, malformed, unknown and revoked |
| Stale approval or modified content | PASS | Gate test: approval for an older version → `publishable:false`; SHA mismatch → `text_matches:false` |

## 7. Security findings

| Severity | Finding | Status |
|---|---|---|
| Low–Med | No application-level rate limiting on `/api/uploads`, `/api/v1/*` or analysis (mock mode has no token cost) | Open |
| Low | `safeFetch` and webhooks resolve DNS, then fetch, which leaves a DNS-rebinding window | Open |
| Low | anon/authenticated hold USAGE/SELECT/UPDATE on `webhook_deliveries_id_seq` (production). No INSERT on the table, so the impact is ID burn at most | Open |
| Low | Supabase leaked-password protection is off (Free plan) | Open, disclosed |
| Info | Supabase default TRUNCATE/TRIGGER/REFERENCES on pre-Round-3 public tables for `authenticated`. Not reachable through PostgREST | Open |
| OK | RLS on all 20 tables (production verified). Tokens are SHA-256 hashed, the hash is unreadable to clients and revocation is one-way (production verified). HMAC webhook signing. The cron uses `timingSafeEqual` and returns 503 without a secret. Uploads go through server-signed paths prefixed with the org; content is re-verified by magic bytes | — |

## 8. Production verification and limitations

**Verified today (read-only):**
- Vercel: `canon-rose.vercel.app` → deployment `dpl_ESN4CMvsktdr4dzcj94hF4HbM6uR`, READY, production, commit `87904388c04d…`.
- Database hardening and RLS, as in §4.

**Not verified today:** the production UI and sign-in flows, the AI mode env vars, and `CRON_SECRET` (a previous session observed that the cron returns 401).

**Limitations, all disclosed:**
- Mock AI.
- SUPPORTED means "matches an approved fact".
- English-only OCR.
- HTML-only retrieval.
- No native CMS integration.
- Items not done in Appendix B.

## 9. PDF and submission document audit

- **Claims vs code:** correct, except the four corrections in §2 (rows 2–4) and the appendix "nothing changed" sentence, which is now scoped to production.
- **Deployment commit:** `87904388` is correct (Vercel API).
- **Test counts:** the original 110/110 in 13 files is accurate for `87904388`. A new row gives the working-copy results.
- **Mock AI:** disclosed in §2, §6, §9 and §10.
- **Limitations:** visible.
- **Secrets:** none found by pattern scan. The login page with demo passwords is not included.
- **Screenshots:** six 2880×1800 lossless PNGs from production, embedded at about 420 ppi; not upscaled. They were captured in an earlier session, and I did not re-capture them.
- **Layout:** the PDF was regenerated with the documented workflow (headless Edge `--print-to-pdf --no-pdf-header-footer`). It has 14 pages, and every page fits within its footer, measured with the screenshots at their real heights (smallest margin about 22px, on page 11). Pages 8, 10, 11, 13 and 14 were also rendered as images with headless Edge and checked by eye: no clipping or overlap.
- **Numbering:** Appendix B was added on a new last page, so the earlier page numbers and table-of-contents references are unchanged, and the TOC lists Appendix B on page 14. The Markdown source was updated to match.

## 10. Files modified or created (all uncommitted at the time; since committed in `c831826`)

**Created:**
- `supabase/migrations/0007_round3_hardening.sql`
- `supabase/tests/pglite/0007-hardening.mjs`
- `supabase/tests/pglite/bootstrap.sql` (copied from the earlier disposable harness)
- `src/app/api/v1/items/[id]/gate/route.test.ts`
- `submission/round3/FINAL_READINESS_REPORT.md`

**Modified:**
- `src/lib/demo.ts`
- `src/app/login/page.tsx`
- `submission/round3/Canon_Round3_Final_Submission.html`
- `submission/round3/Canon_Round3_Final_Submission.md`
- `submission/round3/Canon_Round3_Final_Submission.pdf`
- `submission/round3/CHANGELOG.md`

`submission/` and `supabase/round3-production/` were already untracked before this review. Pre-edit copies of the three submission files are in `C:/Users/yo5on/AppData/Local/Temp/claude/22eac97b0ab00b4e/e0eec69b-2c42-4816-8746-36cc2e8405d4/scratchpad/submission.before.{html,md,pdf}`.

Outside the repo: `D:\Scratch\canon-pglite-round3\run-0007.mjs` and `out-0007-pg1{7,8}.log`.

## 11. Manual actions before submission

1. **Review the diff and decide what to commit.** Suggested: 0007 with its test, the gate test, the login fix and the submission files.
   - `supabase/tests/pglite/0007-hardening.mjs` reads `supabase/round3-production/` (`apply-round3-production.sql` and `hardening/`). If you commit the test without that folder, it breaks.
   - `supabase/round3-production/` contains host and fingerprint values but no secrets. Whether to publish it is your call.
   - Stage files by name. **Do not use `git add -A`**: `.claude/` is untracked and should not be committed.
2. **Pushing to `main` redeploys production on Vercel**, which changes the deployed commit from `87904388`. If you push:
   - update "Production commit" on the cover and in §8;
   - re-run the Vercel check and a smoke test;
   - regenerate the PDF.

   Alternatively, push to a branch, or submit `87904388` as it stands. Note that the document says 0007 is "not yet committed", so that sentence must be updated if you commit it. (Done: the submission was corrected after `c831826` was pushed.)
3. **Do not apply 0007 to production.** It is already applied.
4. The login-page disclosure fix is only visible after a deploy.
5. The smoke-test token "ROUND3-SMOKE-TEST delete-me" (revoked) and its 2 audit rows are still in production. Leaving them is consistent with the append-only audit log.
6. Optionally run a manual Reviewer and Creator smoke test on production. Note that the demo buttons reset the demo accounts.

## 12. Confirmation

- No production deployment was made.
- No production data or schema was changed. The only production access was read-only `psql` sessions (`default_transaction_read_only=on`) and one read-only Vercel API lookup.
- Nothing was committed, amended, rebased or pushed.
- Production environment variables were not read or changed.
- Supabase project `eurclqtmojtobcyohygy` was not touched.
