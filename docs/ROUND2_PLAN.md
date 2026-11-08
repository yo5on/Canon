# Canon — Round 2 build plan (72 h)

Build window: 8 Nov 2026 10:00 IST → 11 Nov 2026 10:00 IST. Round 1 PDF (`../submission/CODEX_Canon_Round1_Submission_final_v2.pdf`) is the source of truth; this file records only what changes and why.

## 1. Where we started (audit, 8 Nov 13:00 IST)

- No product code existed. Only Round 1 documents, 6 wireframes and 6 diagrams in `../submission/`.
- Supabase account is connected but has **no project**. Vercel account is connected but has **no project**. No Anthropic API key is configured. The GitHub CLI is signed in as `yo5on`.

## 2. Scope: Round 1 assumed 10–14 days, we have 3

| Round 1 item | Round 2 decision | Reason |
|---|---|---|
| M1 Brand Kit, manual rules | **Build** | Core workflow |
| M1 AI import of PDF guide into draft rules | **Round 3** | Not on the judged path |
| M2 Facts register with owner, expiry, tolerance, replaced-by | **Build** | Claims Ledger depends on it |
| M3 Asset library (palette, logo, fonts) | **Round 3** | Image checks are cut |
| M4 Content submission | **Build: pasted text only** | DOCX/PDF/image only once text is stable |
| M5 Code checks | **Build: banned terms only** | Contrast and palette need images |
| M6–M8 AI checks, finding cards, fixes | **Build** | Core |
| M9–M10 Review workflow, roles, RLS | **Build** | Core |
| M11 Insights | **Should**: counts only, if day 3 allows | |
| M12 AI disclosure, audit log | **Build** | |
| D1 Citation verifier | **Built** (`src/lib/verifier.ts`, tested) | Improvement 1 |
| D2 Claims Ledger | **Built** (`src/lib/ledger.ts`, tested) | Improvement 2 |
| D3 Gap Radar | **Round 3**. Round 2 only stores rejection/override reasons per rule | Improvement 3 needs data first |
| D4 Confidential mode | **Build**: confidential facts are never sent; a confidential item runs code checks only | Cheap to do |
| Haiku extraction + Sonnet relation (two calls) | **One Sonnet 5.5 call** returns findings and claims with candidate facts | Halves the latency and the failure modes. Code still decides every status |
| pgvector fact retrieval | **Send all current non-confidential facts** | The demo kit has about 30 facts and fits in one prompt. `shortcut:` upgrade to retrieval at more than 200 facts |
| Job table + `after()` + `SKIP LOCKED` | **Synchronous route handler**, `maxDuration = 60` | One AI call fits easily, so the queue is not needed yet |
| Magic-link sign-in | **Email + password**, with seeded **demo accounts** shown on the login page | Judges must get in without an inbox |
| Python/FastAPI | **Not used** | Nothing needs it |

## 3. Module structure

```
src/lib/verifier.ts      D · citation verifier (pure, unit-tested)
src/lib/ledger.ts        E · Claims Ledger status ladder (pure, unit-tested)
src/lib/codechecks.ts    C · deterministic checks (banned terms) — verified by construction
src/lib/ai.ts            C · Claude call: prompt, JSON schema with enum IDs, timeout/retry/budget
src/lib/pipeline.ts      C+D+E · orchestration: code checks → AI → verify → ledger → store
src/lib/supabase/*       DB clients: user-scoped (RLS) and service-role (pipeline writes only)
src/app/...              UI: workspaces, brand kit, submit, report, ledger, review, history
supabase/migrations/     schema, RLS, state functions, approval trigger
```

## 4. Contracts

**State changes: Postgres functions only** (`supabase/migrations/0001_init.sql`). No client can update `status` directly.

| Function | Who | Effect |
|---|---|---|
| `create_workspace(name, display)` | any signed-in user | new org, caller becomes Brand Manager |
| `add_member(org, email, role)` | Brand Manager | add an existing user |
| `create_item(org, title, channel, audience, goal, publish_date, reviewer, body)` | member | item + version 1; you cannot be your own reviewer |
| `revise_item(item, body, note)` | author | new version, status → draft |
| `submit_for_review(item)` | author | needs a reviewer and a finished run on the current version |
| `decide_finding(finding, accepted\|rejected\|overridden, reason)` | author (accept/reject), reviewer who is not the author (override) | reason required except for accept |
| `decide_item(item, approved\|rejected\|changes_requested, reason)` | Reviewer/BM | trigger blocks self-approval, non-reviewers and approval while blocking issues remain |

Rules and facts: plain inserts, gated by RLS to the Brand Manager. Editing creates a new version row.

**`POST /api/items/:id/analyze`** (server, user must be a workspace member)
→ `200 { run_id, status: "done"|"ai_failed"|"ai_skipped", findings: n, claims: n }`
→ `4xx { error }` for bad input or permissions; `429` when the daily budget is used up.

**Model output (structured outputs, JSON schema)**

```json
{ "findings": [{ "source_id": "<enum of rule codes sent>", "source_quote": "...", "draft_quote": "...",
                 "category": "tone|terminology|claim|messaging|accessibility", "confidence": 0.0,
                 "explanation": "...", "fix": { "replace": "...", "with": "..." } }],
  "claims":   [{ "text": "...", "type": "number|superlative|comparison|certification|date|opinion",
                 "candidates": [{ "fact_id": "<enum of fact codes sent>", "relation": "ENTAILS|CONTRADICTS|UNRELATED", "quote": "..." }] }] }
```

Severity is taken from the cited rule in our database, never from the model. Claims with status CONTRADICTED, OUTDATED or UNSUPPORTED become blocking findings that cite the fact (or rule CLAIM-02 for unsupported superlatives).

## 5. Schedule

- **Day 1 (8 Nov):** done: scaffold, verifier, ledger, schema. Next: Supabase project, sign-in, Brand Kit, submit, first AI run, report UI.
- **Day 2 (9 Nov):** fixes and revisions, review and approve, history and audit log, first Vercel deploy, RLS tests.
- **Day 3 (10 Nov):** failure-path tests, usability, insights (Should), README, Round 2 PDF. Submit before **11 Nov 10:00 IST**. Our own target is 10 Nov 22:00.

## 6. Honest-reporting rules

- Nothing written here is a test result. Test evidence is the `npm test` output and the SQL permission tests, recorded with dates.
- Canon Bench numbers are reported only if we actually run them. Otherwise they stay Round 3 targets.
- This code was written with AI assistance (Claude Code). This must be disclosed in the Round 2 PDF alongside each member's real contribution.
