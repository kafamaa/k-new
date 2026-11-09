-- ===========================================================================
-- Manual team and roster entry (created with: supabase migration new manual_team_and_roster_entry)
-- ===========================================================================
-- Review-only. Depends on 031 (team_has_permission, submit_roster_players).
--
--   1. Team managers add an existing UNCLAIMED player to their team directly.
--      A claimed player (one with an account) must still be invited and
--      accept, so nobody joins a team without their consent.
--   2. Tournament organizers add players to a team entered in their
--      tournament: an unclaimed player, or a player already in that team.
--      They then submit the roster with the existing submit_roster_players.
--   3. Organizers read the active squad of an entered team (names, numbers,
--      positions only) to build its roster.
--   4. Searching unclaimed players returns names and islands only, and only
--      records the caller may already know about.
--   5. Closes a gap: the old insert policy let any team staff member add ANY
--      player, claimed or not, straight into their team. Direct inserts now
--      need the player to be unclaimed, or to have asked to join that team.
-- Every add is written to audit_events.
-- ===========================================================================

-- 5. Tighter direct-insert policy ------------------------------------------------
drop policy if exists "authorized users create player history" on public.player_team_memberships;
create policy "authorized users create player history" on public.player_team_memberships for insert to authenticated with check (
  created_by = (select auth.uid())
  and (
    exists (select 1 from public.teams t where t.id = player_team_memberships.team_id and t.created_by = (select auth.uid()))
    or exists (select 1 from public.team_memberships tm where tm.team_id = player_team_memberships.team_id and tm.user_id = (select auth.uid()))
  )
  and exists (
    select 1 from public.player_profiles p
    where p.id = player_team_memberships.player_id
      and (p.account_id is null
        or exists (select 1 from public.player_team_requests r where r.player_id = p.id and r.team_id = player_team_memberships.team_id and r.status in ('pending', 'info_requested')))
  )
);

-- Shared checks for adding one player to one team.
create or replace function public.add_player_membership(p_team_id uuid, p_player_id uuid, p_position text, p_jersey integer, p_source text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  claimed boolean;
  new_id uuid;
begin
  select p.account_id is not null into claimed from public.player_profiles p where p.id = p_player_id;
  if claimed is null then raise exception 'player_not_found'; end if;
  if exists (select 1 from public.player_team_memberships ms where ms.player_id = p_player_id and ms.team_id = p_team_id and ms.status in ('active', 'loaned') and ms.effective_to is null) then
    raise exception 'already_member';
  end if;
  if claimed then raise exception 'player_claimed_invite_instead'; end if;
  if p_jersey is not null and (p_jersey < 0 or p_jersey > 99) then raise exception 'invalid_jersey'; end if;
  if p_jersey is not null and exists (select 1 from public.player_team_memberships ms where ms.team_id = p_team_id and ms.status in ('active', 'loaned') and ms.effective_to is null and ms.jersey_number = p_jersey) then
    raise exception 'duplicate_jersey';
  end if;
  insert into public.player_team_memberships(player_id, team_id, status, effective_from, source, created_by, position, jersey_number)
  values (p_player_id, p_team_id, 'active', current_date, p_source, auth.uid(), nullif(left(trim(coalesce(p_position, '')), 40), ''), p_jersey)
  returning id into new_id;
  -- Squad members and their team are part of the public record.
  update public.player_profiles set is_published = true where id = p_player_id and is_published is not true;
  update public.teams set is_published = true where id = p_team_id and is_published is not true;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), 'team_player_added', 'team', p_team_id, p_source);
  return new_id;
end;
$$;
revoke execute on function public.add_player_membership(uuid, uuid, text, integer, text) from public, anon, authenticated;

-- 1. Team managers ------------------------------------------------------------------
create or replace function public.add_team_player(p_team_id uuid, p_player_id uuid, p_position text default null, p_jersey integer default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if not public.team_has_permission(p_team_id, 'manage_players') then raise exception 'team_permission_required'; end if;
  return public.add_player_membership(p_team_id, p_player_id, p_position, p_jersey, 'manager');
end;
$$;
revoke execute on function public.add_team_player(uuid, uuid, text, integer) from public, anon;
grant execute on function public.add_team_player(uuid, uuid, text, integer) to authenticated, service_role;

-- 2. Organizers -------------------------------------------------------------------------
create or replace function public.organizer_add_team_player(p_entry_id uuid, p_player_id uuid, p_position text default null, p_jersey integer default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  entry record;
  existing uuid;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  select e.team_id, e.tournament_id, e.roster_status into entry from public.tournament_entries e where e.id = p_entry_id;
  if entry.team_id is null or not public.is_tournament_operator(entry.tournament_id) then raise exception 'organizer_permission_required'; end if;
  if entry.roster_status = 'locked' then raise exception 'roster_locked'; end if;
  -- Already in the squad: nothing to add; the roster step picks them.
  select ms.id into existing from public.player_team_memberships ms
  where ms.player_id = p_player_id and ms.team_id = entry.team_id and ms.status in ('active', 'loaned') and ms.effective_to is null limit 1;
  if existing is not null then return existing; end if;
  return public.add_player_membership(entry.team_id, p_player_id, p_position, p_jersey, 'organizer');
end;
$$;
revoke execute on function public.organizer_add_team_player(uuid, uuid, text, integer) from public, anon;
grant execute on function public.organizer_add_team_player(uuid, uuid, text, integer) to authenticated, service_role;

-- 3. Squad of an entered team, for its organizer -----------------------------------------------
create or replace function public.get_entry_team_players(p_entry_id uuid)
-- "position" is a reserved word in Postgres, so the output column is player_position.
returns table(player_id uuid, display_name text, claimed boolean, player_position text, jersey_number smallint, squad_role text)
language plpgsql stable security definer set search_path = public as $$
declare
  entry record;
begin
  select e.team_id, e.tournament_id into entry from public.tournament_entries e where e.id = p_entry_id;
  if entry.team_id is null or not (public.is_tournament_operator(entry.tournament_id) or public.team_has_permission(entry.team_id, 'manage_rosters')) then
    raise exception 'organizer_permission_required';
  end if;
  return query
  select p.id, coalesce(nullif(p.display_name, ''), 'Player'), p.account_id is not null, ms.position, ms.jersey_number, ms.squad_role
  from public.player_team_memberships ms
  join public.player_profiles p on p.id = ms.player_id
  where ms.team_id = entry.team_id and ms.status in ('active', 'loaned') and ms.effective_to is null
  order by ms.jersey_number nulls last, p.display_name;
end;
$$;
revoke execute on function public.get_entry_team_players(uuid) from public, anon;
grant execute on function public.get_entry_team_players(uuid) to authenticated, service_role;

-- 4. Finding unclaimed players ----------------------------------------------------------------
-- Names and islands only, at most 10, for records the caller can already
-- see: published players, players they created, and players already in a
-- team they manage or in a team entered in a tournament they run.
create or replace function public.search_unclaimed_players(p_query text, p_team_id uuid default null, p_entry_id uuid default null)
returns table(player_id uuid, display_name text, island text)
language plpgsql stable security definer set search_path = public as $$
declare
  term text := left(regexp_replace(trim(coalesce(p_query, '')), '[%_\\]', '', 'g'), 60);
  entry_tournament uuid;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if length(term) < 2 then return; end if;
  if p_entry_id is not null then
    select e.tournament_id into entry_tournament from public.tournament_entries e where e.id = p_entry_id;
    if entry_tournament is null or not public.is_tournament_operator(entry_tournament) then raise exception 'organizer_permission_required'; end if;
  elsif p_team_id is null or not public.team_has_permission(p_team_id, 'manage_players') then
    raise exception 'team_permission_required';
  end if;
  return query
  select p.id, p.display_name, p.island
  from public.player_profiles p
  where p.account_id is null and p.display_name ilike '%' || term || '%'
    and (p.is_published or p.created_by = auth.uid()
      or exists (select 1 from public.player_team_memberships ms where ms.player_id = p.id
        and ((p_team_id is not null and public.team_has_permission(ms.team_id, 'manage_players'))
          or (entry_tournament is not null and exists (select 1 from public.tournament_entries e2 where e2.team_id = ms.team_id and e2.tournament_id = entry_tournament)))))
  order by p.display_name
  limit 10;
end;
$$;
revoke execute on function public.search_unclaimed_players(text, uuid, uuid) from public, anon;
grant execute on function public.search_unclaimed_players(text, uuid, uuid) to authenticated, service_role;
