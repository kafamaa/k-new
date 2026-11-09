-- Final plan 5.4: claim status and publication status are separate.
-- REVIEW ONLY. Not applied. The owner applies it after review.
--
-- A published team may be run by the tournament organizer before any team manager
-- accepts it. The public page then says "Managed by tournament organizer" instead of
-- implying that a team account owns it. This function returns only that neutral
-- label for a published team: no account, membership or organization identifiers.
--
--   'team'      a manager outside every linked organization runs the team
--   'organizer' the team is linked to an organization and has no such manager
--   null        unpublished, unknown, or not linked to an organization
--
-- Players need no function: player_profiles.is_claimed is already a public field.

create or replace function public.get_public_team_management(p_team_id uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (
      select 1 from public.team_memberships m
      where m.team_id = t.id and m.role = 'manager'
        and not exists (
          select 1 from public.organization_team_links l
          join public.organization_memberships om on om.organization_id = l.organization_id and om.user_id = m.user_id
          where l.team_id = t.id
        )
    ) then 'team'
    when exists (select 1 from public.organization_team_links l where l.team_id = t.id) then 'organizer'
    else null
  end
  from public.teams t
  where t.id = p_team_id and t.is_published and t.deactivated_at is null;
$$;
revoke execute on function public.get_public_team_management(uuid) from public;
grant execute on function public.get_public_team_management(uuid) to anon, authenticated, service_role;
