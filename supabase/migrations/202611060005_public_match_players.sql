-- Show match event and lineup player names regardless of publication status.
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
        'player', p.display_name,
        'player_slug', p.slug
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
    join public.player_profiles p on p.id = mp.player_id
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
