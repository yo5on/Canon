# Security hardening pass (2026-11-08)

Status: migration `0003_security_hardening` has been applied to the Supabase project `canon`. Nothing is committed or deployed to Vercel yet.

## Changes

### 1. `open_blocking` leaked data across workspaces
- **Bug:** the function is `SECURITY DEFINER`, so it skips RLS. Any signed-in user could pass any item id and get its blocking count. The baseline run proved it: the Rival outsider got `1` for a Canon item, and an unknown id returned `0`, which told callers whether an id existed.
- **Fix:** the raw count now lives in `private.open_blocking_count`. No client role can execute it. The public `open_blocking` returns `NULL` unless the caller is a member of the item's workspace. An item you can't access and an item that doesn't exist now give the same answer.
- `private.check_approval` (the approval trigger) now calls the private count, so it still blocks approvals when there is no user. Without this, a service-role insert would get `NULL > 0`, which is not true, and the approval would go through.

### 2. Reviewer assignment
- **Bug:** `create_item` accepted any user id as reviewer: someone from another workspace, a creator, or an id that doesn't exist (only the foreign key caught that one).
- **Fix:** a new trigger `items_reviewer_guard`, backed by `private.check_reviewer`, runs `BEFORE INSERT OR UPDATE OF reviewer_id, org_id, author_id` on `content_items`. The reviewer must be a `reviewer` or `brand_manager` in the item's workspace and must not be the author. Because the check is a trigger, it also applies to the service role and to any future function. `NULL` is still allowed for "no reviewer yet", and `submit_for_review` still requires one.

### 3. `private.no_change` search_path
- `alter function private.no_change() set search_path = ''`. The function body only uses `tg_table_name`, so its behaviour is the same. I checked this after the migration: `UPDATE audit_log` still raises `audit_log is append-only`.

### 4. Why migration 0002 was needed
In Postgres, every new function gets `EXECUTE` granted to `PUBLIC` by default. Every role is a member of `PUBLIC`, including `anon`. Migration 0001 ran `revoke execute ... from anon`, which only removes a direct grant to `anon`. The grant through `PUBLIC` stayed, so signed-out callers could still call `/rest/v1/rpc/open_blocking` and the other RPCs.

0002 does three things:
- revokes from `PUBLIC` and `anon`;
- grants back explicitly to `authenticated` and `service_role`;
- changes the default privileges so future functions don't get the `PUBLIC` grant either.

The suite confirms that no function in `public` or `private` has a `PUBLIC` grant or `anon` execute, including the two new ones. It also confirms that authenticated workflows still work: create_workspace, create_item, submit, override, approve and add_member. Service-role pipeline inserts into `analysis_runs` and `findings` also still work. No protection was removed.

### 5. Leaked-password protection: not enabled
- The organisation is on the **Free** plan. Supabase offers leaked-password protection (the HaveIBeenPwned check) on Pro and above ([docs](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)), so it can't be enabled without a paid upgrade.
- **Impact:** users can sign up with, or change to, a password that is known from breaches, which makes credential-stuffing attacks easier. For this demo it is low risk: the accounts are fictional and use generated passwords.
- **Free mitigations (Dashboard → Auth → Providers → Email):** set a minimum length of 12 or more, require digits, upper and lower case and symbols, and turn on "require current password when changing password". Turn on leaked-password protection if the project moves to Pro.

### Advisor warning left on purpose
Lint `0029 authenticated_security_definer_function_executable` lists the 8 public RPCs. This is by design: they are the only way content state can change. Each one checks `auth.uid()` and the caller's role inside the function. Removing `EXECUTE` would break the app.

## Test results
The suite is in `supabase/tests/security.sql`. It is a single DO block that always ends by raising an exception. The report is the error message, and every fixture row is rolled back.

| Run | Result |
|---|---|
| Before 0003 (baseline) | 100 passed, 16 failed. 6 failures were real `open_blocking` leaks and reviewer holes; the rest were bugs in the suite itself, since fixed |
| After 0003 | 121 passed, 1 failed. The failure was a test bug in how the search_path array was compared, now fixed. A direct check confirmed `search_path=""` is set and `no_change` still raises |
| Final (after the test fix) | **122 passed, 0 failed** |

What the suite covers:
- **Roles:** creator, reviewer, manager, outsider (another workspace), anon and service_role.
- **Cross-workspace reads:** 9 tables, plus `open_blocking`.
- **Cross-workspace writes:** create/revise/submit, override, add_member, comments, rules, facts, and direct table writes.
- **Invalid reviewers:** another workspace, self, unknown id, a creator colleague, and service-role insert/update. Valid cases also tested: reviewer, manager, and no reviewer.
- **Anonymous execution:** every function in `public` and `private`.
- **Approvals:** self-approval by RPC and by service role; approval with a blocking finding by RPC and by service role; override rules; approval after an override.
- **Append-only tables:** `audit_log`, `approvals` and `finding_decisions` reject update and delete from service role, members and even postgres.

Demo data row counts were the same before and after (orgs 2, memberships 4, rules 4, facts 2, all other tables 0).

## Known limits
- **Real API and sign-in not tested.** The suite runs in SQL as `postgres` and fakes each role with `SET ROLE` plus JWT claims. It has not gone through the real web API (PostgREST `/rest/v1`) or Supabase Auth sign-up/sign-in with real tokens. Those paths should give the same result because they use the same roles and `auth.uid()`, but that is not proven yet.
- **Reviewer demotion is not re-checked.** If an assigned reviewer is later demoted to creator or removed from the workspace, the existing `reviewer_id` stays and the item can still be submitted to them. `check_approval` still stops them approving, so nothing unsafe gets approved, but the item waits until another Reviewer or Brand Manager decides it.
- `open_blocking` returns `NULL` (it used to return `0`) for items the caller can't see and for ids that don't exist. Nothing in `src/` calls it yet.
