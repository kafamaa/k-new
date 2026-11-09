-- Public tournament page: Players and Statistics tabs.
-- REVIEW ONLY. Not applied. The owner applies it after review.
--
-- Two read-only functions for a published (non-draft) tournament. They return
-- public fields only: player and team names and page addresses (slugs), shirt
-- numbers and counted statistics. No account, identity, contact, document,
-- payment or internal identifier is returned. Unpublished players are left out;
-- an unpublished team is shown without its name.

-- Players on each approved team's latest approved or locked squad list.
create or replace function public.get_public_tournament_players(p_tournament uuid)
returns table(player_slug text, player_name text, photo_url text, team_name text, team_slug text, shirt_number text, player_position text)
language sql stable security definer set search_path = '' as $$
  with latest as (
    select distinct on (rs.entry_id) rs.id, rs.entry_id
    from public.roster_submissions rs
    join public.tournament_entries e on e.id = rs.entry_id
    where e.tournament_id = p_tournament and e.application_status = 'approved' and rs.status in ('approved', 'locked')
    order by rs.entry_id, rs.version desc
  )
  select p.slug, p.display_name, p.photo_url,
    case when t.is_published then t.name end, case when t.is_published then t.slug end,
    rsp.shirt_number, rsp.position
  from latest l
  join public.roster_submission_players rsp on rsp.submission_id = l.id
  join public.player_profiles p on p.id = rsp.player_id and p.is_published
  join public.tournament_entries e on e.id = l.entry_id
  join public.teams t on t.id = e.team_id
  join public.tournaments tr on tr.id = e.tournament_id and tr.is_published and tr.status <> 'draft'
  order by t.name, p.display_name;
$$;
revoke execute on function public.get_public_tournament_players(uuid) from public;
grant execute on function public.get_public_tournament_players(uuid) to anon, authenticated, service_role;

-- Player rankings from confirmed matches only, counted the same way as
-- get_player_official_statistics (migrations 008 and 014).
create or replace function public.get_public_tournament_player_statistics(p_tournament uuid)
returns table(player_slug text, player_name text, team_name text, appearances bigint, goals bigint, assists bigint, yellow_cards bigint, red_cards bigint)
language sql stable security definer set search_path = '' as $$
  with confirmed_matches as (
    select distinct v.match_id from public.match_result_versions v
    join public.matches m on m.id = v.match_id
    where v.status = 'confirmed' and m.tournament_id = p_tournament
  ), event_totals as (
    select ev.player_id,
      count(*) filter (where ev.event_type in ('goal', 'point', 'one_point', 'two_point', 'three_point')) as goals,
      count(*) filter (where ev.event_type = 'assist') as assists,
      count(*) filter (where ev.event_type = 'yellow_card') as yellow_cards,
      count(*) filter (where ev.event_type in ('red_card', 'blue_card')) as red_cards
    from public.match_events ev
    join confirmed_matches cm on cm.match_id = ev.match_id
    where ev.player_id is not null
    group by ev.player_id
  ), appearances as (
    select mp.player_id, max(mp.team_id::text)::uuid as team_id, count(distinct mp.match_id) as appearances
    from public.match_player_participants mp
    join confirmed_matches cm on cm.match_id = mp.match_id
    group by mp.player_id
  )
  select p.slug, p.display_name, case when t.is_published then t.name end,
    coalesce(a.appearances, 0)::bigint, coalesce(et.goals, 0)::bigint, coalesce(et.assists, 0)::bigint,
    coalesce(et.yellow_cards, 0)::bigint, coalesce(et.red_cards, 0)::bigint
  from public.tournaments tr
  join (select player_id from appearances union select player_id from event_totals) who on true
  join public.player_profiles p on p.id = who.player_id and p.is_published
  left join appearances a on a.player_id = who.player_id
  left join event_totals et on et.player_id = who.player_id
  left join public.teams t on t.id = a.team_id
  where tr.id = p_tournament and tr.is_published and tr.status <> 'draft'
  order by coalesce(et.goals, 0) desc, coalesce(et.assists, 0) desc, p.display_name;
$$;
revoke execute on function public.get_public_tournament_player_statistics(uuid) from public;
grant execute on function public.get_public_tournament_player_statistics(uuid) to anon, authenticated, service_role;
