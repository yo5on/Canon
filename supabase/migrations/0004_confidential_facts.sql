-- Confidential facts were readable by every workspace member, including Creators, through the API.
-- Creators now see only non-confidential facts; Reviewers and Brand Managers still see all of them.
-- Write policies are unchanged (Brand Manager only).
drop policy facts_read on facts;
create policy facts_read on facts for select using (
  private.is_member(org_id)
  and (not confidential or private.has_role(org_id, '{reviewer,brand_manager}')));
