-- ===========================================================================
-- 033 — Organization publishing
-- ===========================================================================
-- Review-only. The owner applies it after 032.
--
-- Problem: organizations.is_published defaults to false and no policy or
-- function ever lets anyone change it, so the public Organizations directory
-- (#organizations) is always empty and organizer names never appear on
-- public tournament cards.
--
-- Fix: one narrow function that lets an organization OWNER publish or
-- unpublish their own organization. No general update policy is added, so
-- nothing else about the organization row becomes editable here.
-- ===========================================================================

create or replace function public.set_organization_published(p_organization_id uuid, p_publish boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.role = 'owner'
  ) then
    raise exception 'organization_owner_required';
  end if;
  update public.organizations set is_published = coalesce(p_publish, false) where id = p_organization_id;
  return coalesce(p_publish, false);
end;
$$;
revoke execute on function public.set_organization_published(uuid, boolean) from public, anon;
grant execute on function public.set_organization_published(uuid, boolean) to authenticated, service_role;
