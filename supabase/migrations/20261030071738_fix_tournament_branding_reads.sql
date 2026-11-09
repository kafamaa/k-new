-- Review-only. NOT APPLIED. Do not run against production without the owner's
-- explicit approval. Repairs read access to the private `tournament-media`
-- bucket. No table, column, row, or Storage object is changed; the bucket stays
-- private. Migration 202610240023 is already applied and is left untouched.
--
-- Defect being repaired (verified against the live pg_policies definition):
-- "tournament media public read for published" was written as
--     exists (select 1 from public.tournaments t
--             where t.is_published = true
--               and t.logo_path = name or t.cover_path = name)
-- Inside that subquery the unqualified `name` resolves to tournaments.name (the
-- tournament's display name), not storage.objects.name, and the missing
-- parentheses make the `or` escape the published check. Postgres stored it as
--     ((t.is_published AND t.logo_path = t.name) OR t.cover_path = t.name)
-- so it never matches a real object (guests can never sign a URL), and if any
-- tournament's cover_path ever equalled its own name the policy would expose
-- every object in the bucket regardless of publication.
--
-- Replacement: one SECURITY DEFINER read helper with a fixed search_path that
-- validates the uploaded path shape
--     organizations/{organization_id}/tournaments/{tournament_id}/{logo|cover}/{file}
-- and allows SELECT only when
--   * the caller is a member of the owning organization (same audience as the
--     "organization operators read tournaments" table policy, so draft branding
--     stays visible to the organizers who can already see the draft), or
--   * the tournament is publicly visible (is_published and status <> 'draft',
--     matching "published tournaments are public") AND the object is the
--     tournament's *current* logo_path or cover_path. Replaced or orphaned
--     objects are never readable by guests.
-- The existing write/update/delete policies and the owner/operations read
-- policy are unchanged.

create or replace function public.tournament_media_read_allowed(p_object_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  parts text[];
  org_id uuid;
  tourn_id uuid;
begin
  parts := regexp_match(
    p_object_name,
    '^organizations/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/tournaments/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(logo|cover)/[A-Za-z0-9._-]+$'
  );
  if parts is null then
    return false;
  end if;
  org_id := parts[1]::uuid;
  tourn_id := parts[2]::uuid;
  return exists (
    select 1 from public.tournaments t
    where t.id = tourn_id
      and t.organization_id = org_id
      and (
        exists (
          select 1 from public.organization_memberships om
          where om.organization_id = t.organization_id and om.user_id = auth.uid()
        )
        or (
          t.is_published and t.status <> 'draft'
          and (t.logo_path = p_object_name or t.cover_path = p_object_name)
        )
      )
  );
end;
$$;
revoke execute on function public.tournament_media_read_allowed(text) from public;
grant execute on function public.tournament_media_read_allowed(text) to anon, authenticated, service_role;

drop policy if exists "tournament media public read for published" on storage.objects;

-- `name` here is storage.objects.name: the helper receives the object path, so
-- there is no subquery for the column to be captured by.
create policy "tournament media read for members or published" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'tournament-media' and public.tournament_media_read_allowed(name));
