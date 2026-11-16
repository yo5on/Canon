# Round 3 v2 migration: local restore test (2026-11-15)

**Result: PASSED on the disposable local copy.** No production connection was made; nothing was pushed or deployed.

## Environment
- Backup: `D:\Backups\Canon-Production\canon-prod-fkxrmppwaaryljmzznym-20261114-pre-round3.dump`.
  SHA-256 `C77901D6…8BCC` matched the `.sha256` file before the restore and again after all tests. Both files are untouched.
- Server: PostgreSQL 17.12 (EDB binaries, `D:\Tools\PostgreSQL17-full`); production runs 17.11. Cluster at `D:\Scratch\canon-r3-test\data`, listening on 127.0.0.1:54329 only. `pg_hba` allows loopback only. The server is now stopped.
- Local system_identifier: 7708392357843159252.
- Supabase roles were recreated with Supabase's attributes. `supabase_admin` is the bootstrap superuser; `postgres` is NOSUPERUSER with CREATEROLE, CREATEDB, REPLICATION and BYPASSRLS. Every database is owned by `postgres`, and the migration ran as `postgres`.
- The restore used the full dump: schema, data, ACLs, default ACLs, the 6 event triggers and the `supabase_realtime` publication. `pg_restore` exited 0 with no errors.
- Extensions restored: pgcrypto, uuid-ossp and pg_stat_statements, all in `extensions`.

## Differences from Supabase (stated, not hidden)
| Item | What was done | Affects migration? |
|---|---|---|
| `supabase_vault` extension, its secrets data and 5 vault ACLs | Excluded (not installable locally) | No. Round 3 never references vault. |
| `supautils.policy_grants` (lets `postgres` create policies on `storage.objects`, owned by `supabase_storage_admin`) | Emulated with `grant supabase_storage_admin to postgres` | **Yes.** On production this depends on supautils. 1-preflight checks `storage_policy_grant`. |
| Database owner = `postgres` | Inferred: `postgres` only has USAGE on `public`, yet created every table in 0001–0004 without being a superuser. My first run with owner `supabase_admin` failed at line 126 ("permission denied for schema public") and rolled back cleanly. | Yes, if wrong. It would fail safely. |
| Production fingerprint guard (line 22) | Test copy differs **only** in that literal (diff recorded) | The unmodified file was also run; see test A. |
| PostgREST, Auth, Storage API services | Not running | `notify pgrst` was sent but has no listener locally. |

## Tests (logs in `D:\Scratch\canon-r3-test\`)
All runs used `psql -X -v ON_ERROR_STOP=1`.

| # | Test | Exit | Result |
|---|---|---|---|
| A | Unmodified `2-migration.v2.sql` on a copy | 3 | Guard raised "Not the Canon production database". The dump is identical to the base. |
| B | Test copy on `r3_main` | 0 | COMMIT. 2 policy versions, audit_log 50 → 52, 0 notifications. |
| C | `3-verify.v2.sql` (read-only) | 0 | Every expectation met (details below). |
| D | Re-run on the migrated DB | 0 | No new rows (2/52/0). The full dump after run 2 is **identical** to the dump after run 1, and the verify output is identical. |
| E | Error injected just before COMMIT | 3 | Schema, data and ACLs identical to base. The only difference is `audit_log_id_seq` 50 → 52: sequences are never rolled back, which leaves an ID gap. |
| F | `lock_timeout`: another session holds a lock on `content_versions` | 3 | "canceling statement due to lock timeout" at line 71. The dump is identical to base. |
| G | 81 behavioural security tests as anon, authenticated (4 users, 2 workspaces) and service_role, all in one transaction then rolled back | 0 | 81/81 PASS |

### 3-verify.v2.sql results
- confidential_policy_0004 = t; round3_tables = 7; round3_columns = 7; rls_on_new_tables = 7; new_policies = 12.
- bucket = t; storage_policy = t; audit_trigger = t; workspaces = 2; policy_versions = 2.
- cifs_authenticated = f; cifs_service_role = t; rpcs_authenticated = t; rpcs_anon = f.
- constraints = `content_versions_body_check, rules_category_check, rules_code_needs_params` (no `rules_check`).
- row_counts_after: organisations 2, items 7, versions 11, runs 11, findings 18, claims 20, rules 6, facts 6, approvals 15, audit_log 52, auth_users 4.
- Exactly 7 rules check constraints, as expected. Baseline versions: Canon Demo Co. v1 (5 rules, 5 facts); Rival Demo Ltd. v1 (1, 1). policy_version audit rows = 2.
- Defaults on existing rows: 0 non-text versions, 0 non-default rules, 0 non-review runs, 0 notifications.
- Every "expect 0 rows" security query returned 0 rows. 13 policies are listed and match the reviewed definitions.

### Security behaviour covered by G
- **anon:** denied on all 7 new tables and the RPCs; sees 0 storage objects.
- **authenticated:** denied TRUNCATE and DELETE on all 7 new tables. Denied INSERT on notifications, policy_versions, source_checks and api_tokens. Denied setting a webhook secret, using the identity sequence, and calling `create_item_from_source`, `notify_from_audit` and `open_blocking_count`.
- **Tokens:** `token_hash` is unreadable. A brand manager sees and revokes only their own workspace's live token, cannot un-revoke it and cannot rename it. A creator sees and revokes nothing.
- **trusted_sources / webhooks:** a brand manager writes only in their own workspace; a creator cannot; the webhook URL can't be edited after creation. No reads across workspaces.
- **`snapshot_policy`:** forbidden for non-members; an unchanged policy creates no new version.
- **Append-only:** `source_checks` and `policy_versions` reject UPDATE and DELETE.
- **`create_item_from_source`:** works for service_role. It rejects a path outside the workspace, an author who isn't a member, and a bad kind.
- **Notifications:**
  - `submitted` notifies the reviewer.
  - `submitted`, `approved` and `monitor_alert` audit rows whose `item_id` belongs to *another* workspace notify nobody.
  - `monitor_alert` notifies the author and brand managers; `source_changed` notifies only that workspace's brand managers.
  - Users see only their own notifications. `mark_notifications_read` touches only the caller's rows, and a direct UPDATE is denied.
  - After a user leaves a workspace, they see none of its notifications.
- **Storage:** members see only their own workspace's folder in `content-sources`. Non-uuid and root-level names are denied without a cast error. Clients cannot upload.
- **Constraints:** rejected an empty text body, a bad `source_kind`, a non-http `source_url` and a non-https webhook URL.

A first run of G had one FAIL. It was a test bug: I passed a null `publish_date`, which the app never sends because `itemFields` requires a date. After the fix, all 81 passed.

## Not covered
- The real supautils, PostgREST schema reload, Supabase Auth/Storage HTTP APIs, and the app end-to-end against the new schema.
- Changed function bodies (`submit_for_review`, `decide_finding`, `open_blocking_count`) were tested only for privileges and ownership, not for workflow behaviour.
- Production rows written after the backup (2026-11-14 11:07). The guard and the relative row-count checks handle drift, but the "audit_log = 52" comment in verify assumes production still has 50.
