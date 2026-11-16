# Round 3 submission — change log

Changes from the draft write-up to `Canon_Round3_Final_Submission` (16 Nov 2026).

## Corrections you asked for

1. **Section 6, Backend.** Replaced the old backend line with:
   "Backend: Next.js server-side API routes. (The earlier Python/FastAPI prototype was retired.)"
2. **Section 4, Claims Ledger.** Changed "SUPPORTED — Claim has supporting evidence" to
   "SUPPORTED — Matches an approved fact that is current on the publish date", and added a sentence saying
   SUPPORTED reflects the organisation's approved facts, not independently established truth.

## Claims I qualified

| Draft claim | What the final version says | Why |
|---|---|---|
| Security hardening items (token hash access, one-way revocation, notification scoping, Storage folder validation) | Applied to the production database as a separate step. The SQL is in `supabase/round3-production/hardening/`, which was **not committed** at that point (since committed in `c831826` on `round3-final-readiness`) and is not part of `87904388`. | `git status` shows that folder as untracked. The production application was reported by the team's logs and was not re-checked in this review. |
| "Build, lint and type checks passed" | Vercel build READY (checked through the Vercel API). `tsc` passed; lint passed with 0 errors and 3 warnings; 110/110 unit tests passed in 13 files, with the live RLS test excluded. | These checks were re-run during this review. The draft did not mention the lint warnings or what the test run covered. |
| "Smoke-tested using Brand Manager, Reviewer and Creator demo sign-in flows" | Brand Manager sign-in and read-only pages were checked during this review. The Reviewer and Creator checks are credited to the team's earlier smoke test. | Only the Brand Manager sign-in was repeated here. |
| "Does not currently have an Anthropic API key configured" | The production login page reports the mock provider, and every report viewed is labelled DEMO/MOCK. The code records a run as `mock` only when `CANON_AI_MOCK=1`. Environment variables were not inspected. | The login page shows mock mode when `CANON_AI_MOCK=1` **or** no key is set, so whether a key is configured was not confirmed. |
| "Restricted API token hash access…" stated as fact | Marked inline as reported by the team, not independently verified. | Only the team's migration logs support it. |
| Analyse step: "claims are extracted and decided by code" | The provider (mock in production) proposes claims; code verifies the quotes and decides each status. | Code does not extract claims; it decides their status. |
| "Database Row Level Security" | RLS is enabled on all 20 tables created by the migrations (13 + 7). | Counted `create table` against `enable row level security` in `supabase/migrations/`. |
| "Live Fact Verification" | Kept, but described precisely: https-only retrieval of approved domains through `safeFetch`; code decides one of five outcomes; retrieved text never makes a claim SUPPORTED on its own. | Matches `src/lib/sources.ts`. |
| "Integration and webhook infrastructure" | Lists the actual events, the Slack and signed-JSON formats, and the read-only publish-gate API. | Makes the claim specific and checkable. |

## Added

- Workflow table, request flow and analysis-pipeline description (Section 6), plus diagrams in the PDF.
- Limitations (Section 10) and Future Scope (Section 11).
- Appendix: a verification-status table that separates repository-verified, review-verified, observed and team-reported claims.
- Six screenshots captured from https://canon-rose.vercel.app on 16 Nov 2026 (demo workspace, Brand Manager role): overview, submit form, audit report, Governance, Claims Ledger and Audit history. The login page was **not** included, because it shows the demo account passwords.
- A "What is real in this deployment" table, summarised from the production login page.
- The PDF's editable source is `Canon_Round3_Final_Submission.html` (images in `img/`).
- Screenshots recaptured at high resolution (same pages, same data, same framing): 1440×900 CSS viewport at device scale factor 2, saved as lossless 2880×1800 PNG and embedded at full size (≈420 ppi at the printed figure width). They replace the earlier 800×500 JPEGs. Captured headless in a separate browser profile that the team signed into by hand, without the demo button, so the demo accounts were not reset.

## Unchanged

- Production commit `87904388`, team details, links and the five ledger statuses (exact spelling).
- No application code, Supabase or Vercel settings were changed. No migrations were run and nothing was committed or pushed.
- One production side effect: the screenshots needed the app's one-click demo Brand Manager sign-in. That flow resets the demo account's email and password to their configured values (`src/app/login/actions.ts`) before signing in. No other data was written.

## Final readiness review (16 Nov 2026, later)

- Section 7 and Appendix A: production hardening is now **verified** with a read-only catalog query, not just reported by the team. It is also written as migration `0007_round3_hardening.sql`, which was not yet committed at that point (superseded: since committed as `c831826` on branch `round3-final-readiness`; not merged into `main`).
- Section 7: added a row with the check results for the working copy (113/113 tests in 14 files; the 0007 test passed 27/27).
- Section 5: says where the override reason is enforced (the server action and the `finding_decisions` CHECK constraint).
- Section 10: added "No native CMS integration". Section 11: the hardening item now refers to 0007.
- New **Appendix B** (page 14) maps each Round 2 promise to delivered, partial or not done. The page is added at the end, so no earlier page numbers change.
- Appendix A note: the "nothing changed" statement now applies to production. Application code in the working copy was changed in this review.
- PDF regenerated with `msedge --headless --print-to-pdf --no-pdf-header-footer`: 14 pages, the same 6 screenshots, and no clipped pages.

## Migration publication status correction (16 Nov 2026, after push)

- Section 7 note, Section 7 checks table, Section 10 and Section 11 no longer say migration `0007_round3_hardening.sql` is uncommitted.
  They now say it is committed and public on GitHub branch `round3-final-readiness` (commit `c831826`), not merged into `main`, and not re-applied to production because the hardening was already verified as present there.
- Section 10 row renamed from "Hardening migration uncommitted" to "Hardening migration not on `main`". Section 11 now says "Merge" instead of "Commit".
- Production is unchanged: deployment commit `87904388`. Appendix B is unchanged.
- PDF regenerated with `msedge --headless --print-to-pdf --no-pdf-header-footer`: 14 pages; only pages 10 and 12 changed, and both were rendered and checked: no clipping.
