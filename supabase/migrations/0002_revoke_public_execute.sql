-- 0001 revoked execute from anon, but Postgres also grants it to PUBLIC (which anon inherits),
-- so signed-out callers could still run these functions (open_blocking returned data).
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon;
