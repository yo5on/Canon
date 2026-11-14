-- create_item_from_source becomes server-only: the server has validated the stored file and computed the
-- extraction (including measured contrast and palette), so a client must not be able to submit its own.
drop function public.create_item_from_source(uuid, text, text, text, text, date, uuid, text, jsonb);
create or replace function public.create_item_from_source(p_author uuid, p_org uuid, p_title text, p_channel text, p_audience text,
  p_goal text, p_publish date, p_reviewer uuid, p_body text, p_source jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i uuid; k text := p_source->>'kind';
begin
  if not exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = p_author) then raise exception 'forbidden'; end if;
  if p_reviewer = p_author then raise exception 'you cannot review your own item'; end if;
  if k not in ('pdf', 'docx', 'image') then raise exception 'bad source kind'; end if;
  if coalesce(p_source->>'path', '') not like p_org::text || '/%' then raise exception 'bad source path'; end if;
  insert into public.content_items (org_id, author_id, title, channel, audience, goal, publish_date, reviewer_id)
    values (p_org, p_author, p_title, p_channel, p_audience, p_goal, p_publish, p_reviewer) returning id into i;
  insert into public.content_versions (org_id, item_id, version, body, created_by, source_kind, source_name, source_mime,
      source_bytes, source_path, source_sha256, extraction, alt_text)
    values (p_org, i, 1, p_body, p_author, k, p_source->>'name', p_source->>'mime', (p_source->>'bytes')::int,
      p_source->>'path', p_source->>'sha256', p_source->'extraction', nullif(trim(p_source->>'alt_text'), ''));
  insert into public.audit_log (org_id, item_id, actor_id, action, detail)
    values (p_org, i, p_author, 'created', jsonb_build_object('version', 1, 'source', k, 'file', p_source->>'name'));
  return i;
end $$;
revoke execute on function public.create_item_from_source(uuid, uuid, text, text, text, text, date, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_item_from_source(uuid, uuid, text, text, text, text, date, uuid, text, jsonb) to service_role;
