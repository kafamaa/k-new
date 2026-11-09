-- Public site pages, the remaining parts (match timeline and lineups, tournament draw,
-- organization teams).
-- Review-only. Do not apply, push or deploy without explicit owner authorization.
-- Apply after 202611010037_follows_and_account_profile.sql.
-- Created with `supabase migration new public_pages_complete`, renamed from
-- 20261101115631_… to 202611010038_… to match the other migrations.
--
-- Read-only functions for guests. No table, column or policy changes. Each function
-- uses the visibility rules of get_public_match_feed (032/035):
--   * the tournament is published and not a draft, and the stage is published;
--   * a team's name shows when the team is published or has an approved entry;
--   * a player's name shows only when the player's profile is published;
--   * the timeline and lineups show only after the result is confirmed and while
--     the result is not frozen, so an unconfirmed score is never public;
--   * no internal fields leave the database (event payloads, recorders, entry rows).
--
--   1. get_public_match_detail(match): one fixture, its official score, timeline and lineups.
--   2. get_public_tournament_draw(tournament): published stages, groups and their teams.
--   3. get_public_organization_teams(organization): published teams linked to the
--      organization or approved in one of its published tournaments.

-- ---------------------------------------------------------------------------------
-- 1. Match detail
-- ---------------------------------------------------------------------------------
create or replace function public.get_public_match_detail(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_match public.matches;
  v_official boolean;
  v_score jsonb;
  v_events jsonb := '[]'::jsonb;
  v_lineups jsonb := '[]'::jsonb;
  v_hidden integer := 0;
begin
  select m.* into v_match
  from public.matches m
  join public.tournaments tr on tr.id = m.tournament_id and tr.is_published and tr.status <> 'draft'
  join public.competition_stages st on st.id = m.stage_id and st.published_at is not null
  where m.id = p_match_id;
  if v_match.id is null then return null; end if;

  v_official := v_match.status = 'confirmed'
    and not exists (select 1 from public.match_result_freezes f where f.match_id = v_match.id and f.lifted_at is null);

  if v_official then
    select v.score into v_score from public.match_result_versions v
    where v.match_id = v_match.id and v.status = 'confirmed' order by v.version desc limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
        'minute', e.event_minute,
        'type', e.event_type,
        'side', case when e.team_id = v_match.home_team_id then 'home' when e.team_id = v_match.away_team_id then 'away' end,
        'player', case when p.is_published then p.display_name end,
        'player_slug', case when p.is_published then p.slug end
      ) order by e.event_minute nulls last, e.created_at), '[]'::jsonb)
    into v_events
    from (select * from public.match_events where match_id = v_match.id order by event_minute nulls last, created_at limit 400) e
    left join public.player_profiles p on p.id = e.player_id;

    select coalesce(jsonb_agg(jsonb_build_object(
        'side', case when mp.team_id = v_match.home_team_id then 'home' else 'away' end,
        'player', p.display_name,
        'player_slug', p.slug,
        'starter', mp.starter
      ) order by mp.starter desc, p.display_name), '[]'::jsonb)
    into v_lineups
    from public.match_player_participants mp
    join public.player_profiles p on p.id = mp.player_id and p.is_published
    where mp.match_id = v_match.id;

    select count(*) into v_hidden
    from public.match_player_participants mp
    join public.player_profiles p on p.id = mp.player_id and not p.is_published
    where mp.match_id = v_match.id;
  end if;

  return jsonb_build_object(
    'id', v_match.id,
    'tournament_id', v_match.tournament_id,
    'home_team_id', v_match.home_team_id,
    'away_team_id', v_match.away_team_id,
    'scheduled_at', v_match.scheduled_at,
    'venue', v_match.venue,
    'status', v_match.status,
    'official', v_official,
    'home_score', case when v_official and jsonb_typeof(v_score->'home') = 'number' then (v_score->>'home')::numeric end,
    'away_score', case when v_official and jsonb_typeof(v_score->'away') = 'number' then (v_score->>'away')::numeric end,
    'outcome', case when v_official and v_score->>'outcome' in ('walkover', 'forfeit', 'abandoned') then v_score->>'outcome' end,
    'events', v_events,
    'lineups', v_lineups,
    'private_players', v_hidden
  );
end;
$$;
revoke execute on function public.get_public_match_detail(uuid) from public;
grant execute on function public.get_public_match_detail(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- 2. Tournament draw
-- ---------------------------------------------------------------------------------
-- Groups come from the published fixtures themselves: a team belongs to the group of
-- the matches it plays in. A knockout stage has no groups (group_name is null).
create or replace function public.get_public_tournament_draw(p_tournament_id uuid)
returns table(
  stage_id uuid, stage_name text, stage_format text, stage_order smallint, category_name text,
  group_name text, team_id uuid, team_name text, team_slug text, team_logo text
)
language sql stable security definer set search_path = '' as $$
  with stages as (
    select st.id, st.name, st.format, st.stage_order, c.name as category_name
    from public.competition_stages st
    join public.tournaments tr on tr.id = st.tournament_id and tr.is_published and tr.status <> 'draft'
    left join public.tournament_categories c on c.id = st.category_id
    where st.tournament_id = p_tournament_id and st.published_at is not null
  ), sides as (
    select m.stage_id, m.group_id, m.tournament_id, m.home_team_id as team_id from public.matches m join stages s on s.id = m.stage_id where m.home_team_id is not null
    union
    select m.stage_id, m.group_id, m.tournament_id, m.away_team_id from public.matches m join stages s on s.id = m.stage_id where m.away_team_id is not null
  )
  select distinct s.id, s.name, s.format, s.stage_order, s.category_name, g.name, t.id,
    case when t.is_published or exists (select 1 from public.tournament_entries e where e.team_id = t.id and e.tournament_id = sd.tournament_id and e.application_status = 'approved') then t.name end,
    case when t.is_published then t.slug end,
    case when t.is_published then t.logo_url end
  from sides sd
  join stages s on s.id = sd.stage_id
  join public.teams t on t.id = sd.team_id
  left join public.competition_groups g on g.id = sd.group_id
  order by s.stage_order, s.name, g.name nulls first
  limit 1000;
$$;
revoke execute on function public.get_public_tournament_draw(uuid) from public;
grant execute on function public.get_public_tournament_draw(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- 3. Organization teams
-- ---------------------------------------------------------------------------------
create or replace function public.get_public_organization_teams(p_organization_id uuid)
returns table(team_id uuid, name text, slug text, logo_url text, team_type text, island text, tournament_count bigint)
language sql stable security definer set search_path = '' as $$
  with org as (
    select o.id from public.organizations o where o.id = p_organization_id and o.is_published
  ), linked as (
    select l.team_id, null::uuid as tournament_id from public.organization_team_links l join org on org.id = l.organization_id
    union
    select e.team_id, e.tournament_id
    from public.tournament_entries e
    join public.tournaments tr on tr.id = e.tournament_id and tr.is_published and tr.status <> 'draft'
    join org on org.id = tr.organization_id
    where e.application_status = 'approved'
  )
  select t.id, t.name, t.slug, t.logo_url, t.team_type, t.island, count(distinct l.tournament_id)
  from linked l
  join public.teams t on t.id = l.team_id and t.is_published
  group by t.id, t.name, t.slug, t.logo_url, t.team_type, t.island
  order by t.name
  limit 200;
$$;
revoke execute on function public.get_public_organization_teams(uuid) from public;
grant execute on function public.get_public_organization_teams(uuid) to anon, authenticated, service_role;
