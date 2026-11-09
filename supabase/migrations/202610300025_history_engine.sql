-- History engine: confirmed results now write standings and automatic
-- milestones, officials record match lineups (appearances), and only assigned
-- officials or tournament operators may record events or submit scores.
-- Review-only; do not apply or push without explicit owner authorization.
--
-- Rules kept from the product specification:
--   * Only confirmed result versions count. Standings and milestones are
--     derived data and are rebuilt from source records on every confirmation
--     or correction, so they can always be recalculated.
--   * Shootout scores (score.homeShootout / score.awayShootout) never count
--     toward regulation totals; standings read score.home / score.away only.
--   * Manual (organizer-entered) milestones are never touched by recalculation.

-- 1. Assigned official helper. Team membership alone no longer authorizes
--    writing match data: a team manager must not submit their own result.
create or replace function public.is_match_official(p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.match_official_assignments oa where oa.match_id = p_match_id and oa.user_id = auth.uid());
$$;
revoke execute on function public.is_match_official(uuid) from public, anon;
grant execute on function public.is_match_official(uuid) to authenticated, service_role;

alter table public.standings_snapshots add column if not exists group_id uuid references public.competition_groups(id) on delete set null;

-- 2. Standings for one stage, rebuilt from the latest confirmed version of
--    every confirmed match. The previous snapshot is replaced; the version
--    number keeps increasing so a recalculation is always distinguishable.
create or replace function public.recalculate_stage_standings(p_stage_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  stage_row public.competition_stages;
  win_points integer;
  draw_points integer;
  loss_points integer;
  next_version integer;
begin
  select * into stage_row from public.competition_stages where id = p_stage_id;
  if stage_row.id is null then return; end if;
  win_points := coalesce(nullif(stage_row.rules->>'points_win', '')::integer, 3);
  draw_points := coalesce(nullif(stage_row.rules->>'points_draw', '')::integer, 1);
  loss_points := coalesce(nullif(stage_row.rules->>'points_loss', '')::integer, 0);
  select coalesce(max(calculated_from_version), 0) + 1 into next_version from public.standings_snapshots where stage_id = p_stage_id;
  delete from public.standings_snapshots where stage_id = p_stage_id;
  insert into public.standings_snapshots(stage_id, team_id, group_id, played, wins, draws, losses, scored, conceded, points, calculated_from_version)
  with latest as (
    select distinct on (v.match_id) v.match_id, v.score
    from public.match_result_versions v join public.matches m on m.id = v.match_id
    where m.stage_id = p_stage_id and v.status = 'confirmed'
    order by v.match_id, v.version desc
  ), results as (
    select m.home_team_id, m.away_team_id, (l.score->>'home')::numeric::integer as home_score, (l.score->>'away')::numeric::integer as away_score
    from public.matches m join latest l on l.match_id = m.id
    where m.status = 'confirmed' and m.home_team_id is not null and m.away_team_id is not null
      and jsonb_typeof(l.score->'home') = 'number' and jsonb_typeof(l.score->'away') = 'number'
  ), sides as (
    select home_team_id as side_team, home_score as scored, away_score as conceded from results
    union all
    select away_team_id, away_score, home_score from results
  ), stage_teams as (
    select side_team, (array_agg(group_id) filter (where group_id is not null))[1] as group_id from (
      select home_team_id as side_team, group_id from public.matches where stage_id = p_stage_id and home_team_id is not null
      union all
      select away_team_id, group_id from public.matches where stage_id = p_stage_id and away_team_id is not null
    ) appearances group by side_team
  )
  select p_stage_id, st.side_team, st.group_id,
    count(s.side_team)::integer,
    (count(*) filter (where s.scored > s.conceded))::integer,
    (count(*) filter (where s.scored = s.conceded))::integer,
    (count(*) filter (where s.scored < s.conceded))::integer,
    coalesce(sum(s.scored), 0)::integer,
    coalesce(sum(s.conceded), 0)::integer,
    coalesce(sum(case when s.scored > s.conceded then win_points when s.scored = s.conceded then draw_points when s.scored < s.conceded then loss_points else 0 end), 0)::integer,
    next_version
  from stage_teams st left join sides s on s.side_team = st.side_team
  group by st.side_team, st.group_id;
end;
$$;
revoke execute on function public.recalculate_stage_standings(uuid) from public, anon, authenticated;
grant execute on function public.recalculate_stage_standings(uuid) to service_role;

-- 3. Automatic milestones for every player and team in one match, rebuilt
--    across all of their confirmed history so a correction re-dates or removes
--    milestones that no longer hold.
create or replace function public.recalculate_match_milestones(p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  player_ids uuid[];
  team_ids uuid[];
begin
  select coalesce(array_agg(distinct mp.player_id), '{}') into player_ids from public.match_player_participants mp where mp.match_id = p_match_id;
  select array_remove(array[m.home_team_id, m.away_team_id], null) into team_ids from public.matches m where m.id = p_match_id;
  team_ids := coalesce(team_ids, '{}');

  delete from public.sport_milestones sm
  where sm.is_manual = false
    and sm.milestone_type in ('first_appearance', 'appearances_10', 'appearances_25', 'appearances_50', 'appearances_100', 'first_goal', 'first_points', 'team_first_match', 'team_first_win')
    and ((sm.player_id = any(player_ids)) or (sm.player_id is null and sm.team_id = any(team_ids)));

  -- Player appearances: the 1st, 10th, 25th, 50th and 100th confirmed match.
  insert into public.sport_milestones(player_id, team_id, tournament_id, season_id, milestone_type, label, state, reached_at, source_match_id, source_result_version_id, is_manual)
  with confirmed as (
    select distinct on (v.match_id) v.match_id, v.id as version_id, m.tournament_id, tr.season_id, coalesce(m.scheduled_at, v.created_at) as played_at
    from public.match_result_versions v join public.matches m on m.id = v.match_id join public.tournaments tr on tr.id = m.tournament_id
    where v.status = 'confirmed' and m.status = 'confirmed'
    order by v.match_id, v.version desc
  ), appearances as (
    select mp.player_id, mp.team_id, c.match_id, c.version_id, c.tournament_id, c.season_id, c.played_at,
      row_number() over (partition by mp.player_id order by c.played_at, c.match_id) as appearance_number
    from public.match_player_participants mp join confirmed c on c.match_id = mp.match_id
    where mp.player_id = any(player_ids)
  )
  select a.player_id, a.team_id, a.tournament_id, a.season_id,
    case a.appearance_number when 1 then 'first_appearance' else 'appearances_' || a.appearance_number end,
    case a.appearance_number when 1 then 'First confirmed appearance' else a.appearance_number || ' confirmed appearances' end,
    'reached', a.played_at, a.match_id, a.version_id, false
  from appearances a where a.appearance_number in (1, 10, 25, 50, 100);

  -- First scoring event: a goal for goal sports, points for basketball/volleyball.
  insert into public.sport_milestones(player_id, team_id, tournament_id, season_id, milestone_type, label, state, reached_at, source_match_id, source_result_version_id, is_manual)
  with confirmed as (
    select distinct on (v.match_id) v.match_id, v.id as version_id, m.tournament_id, tr.season_id, coalesce(m.scheduled_at, v.created_at) as played_at
    from public.match_result_versions v join public.matches m on m.id = v.match_id join public.tournaments tr on tr.id = m.tournament_id
    where v.status = 'confirmed' and m.status = 'confirmed'
    order by v.match_id, v.version desc
  ), scoring as (
    select ev.player_id, ev.team_id, c.match_id, c.version_id, c.tournament_id, c.season_id, c.played_at,
      case when ev.event_type = 'goal' then 'first_goal' else 'first_points' end as kind,
      row_number() over (partition by ev.player_id, case when ev.event_type = 'goal' then 'first_goal' else 'first_points' end order by c.played_at, ev.event_minute nulls last, ev.created_at) as n
    from public.match_events ev join confirmed c on c.match_id = ev.match_id
    where ev.player_id = any(player_ids) and ev.event_type in ('goal', 'point', 'one_point', 'two_point', 'three_point')
  )
  select s.player_id, s.team_id, s.tournament_id, s.season_id, s.kind,
    case s.kind when 'first_goal' then 'First confirmed goal' else 'First confirmed points' end,
    'reached', s.played_at, s.match_id, s.version_id, false
  from scoring s where s.n = 1;

  -- Team firsts: first confirmed match and first confirmed win.
  insert into public.sport_milestones(player_id, team_id, tournament_id, season_id, milestone_type, label, state, reached_at, source_match_id, source_result_version_id, is_manual)
  with confirmed as (
    select distinct on (v.match_id) v.match_id, v.id as version_id, v.score, m.tournament_id, tr.season_id, m.home_team_id, m.away_team_id, coalesce(m.scheduled_at, v.created_at) as played_at
    from public.match_result_versions v join public.matches m on m.id = v.match_id join public.tournaments tr on tr.id = m.tournament_id
    where v.status = 'confirmed' and m.status = 'confirmed'
    order by v.match_id, v.version desc
  ), sides as (
    select c.home_team_id as side_team, c.match_id, c.version_id, c.tournament_id, c.season_id, c.played_at,
      case when jsonb_typeof(c.score->'home') = 'number' and jsonb_typeof(c.score->'away') = 'number' then (c.score->>'home')::numeric > (c.score->>'away')::numeric else false end as won
    from confirmed c where c.home_team_id = any(team_ids)
    union all
    select c.away_team_id, c.match_id, c.version_id, c.tournament_id, c.season_id, c.played_at,
      case when jsonb_typeof(c.score->'home') = 'number' and jsonb_typeof(c.score->'away') = 'number' then (c.score->>'away')::numeric > (c.score->>'home')::numeric else false end
    from confirmed c where c.away_team_id = any(team_ids)
  ), ranked as (
    select s.*, row_number() over (partition by s.side_team order by s.played_at, s.match_id) as match_n,
      row_number() over (partition by s.side_team, s.won order by s.played_at, s.match_id) as win_n
    from sides s
  )
  select null::uuid, r.side_team, r.tournament_id, r.season_id, 'team_first_match', 'First confirmed match', 'reached', r.played_at, r.match_id, r.version_id, false
  from ranked r where r.match_n = 1
  union all
  select null::uuid, r.side_team, r.tournament_id, r.season_id, 'team_first_win', 'First confirmed win', 'reached', r.played_at, r.match_id, r.version_id, false
  from ranked r where r.won and r.win_n = 1;
end;
$$;
revoke execute on function public.recalculate_match_milestones(uuid) from public, anon, authenticated;
grant execute on function public.recalculate_match_milestones(uuid) to service_role;

-- 4. Lineups (appearances). Officials record who played before confirmation;
--    an operator may still correct a confirmed lineup, which re-derives the
--    affected milestones.
create or replace function public.record_match_participants(p_match_id uuid, p_participants jsonb, p_actor_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare match_row public.matches; operator boolean; inserted integer;
begin
  if p_actor_id <> auth.uid() then raise exception 'actor_mismatch'; end if;
  if jsonb_typeof(p_participants) <> 'array' then raise exception 'invalid_participants'; end if;
  select * into match_row from public.matches where id = p_match_id for update;
  if match_row.id is null then raise exception 'match_not_assigned'; end if;
  operator := public.is_tournament_operator(match_row.tournament_id);
  if not (operator or public.is_match_official(p_match_id)) then raise exception 'match_not_assigned'; end if;
  if match_row.status = 'confirmed' and not operator then raise exception 'match_already_confirmed'; end if;
  delete from public.match_player_participants where match_id = p_match_id;
  insert into public.match_player_participants(match_id, player_id, team_id, starter, minutes)
  select p_match_id, (x->>'player_id')::uuid, (x->>'team_id')::uuid, coalesce((x->>'starter')::boolean, false), nullif(x->>'minutes', '')::integer
  from jsonb_array_elements(p_participants) x
  where (x->>'team_id')::uuid in (match_row.home_team_id, match_row.away_team_id)
  on conflict (match_id, player_id) do nothing;
  get diagnostics inserted = row_count;
  if match_row.status = 'confirmed' then
    perform public.recalculate_match_milestones(p_match_id);
    insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (p_actor_id, 'match_lineup_corrected', 'match', p_match_id, 'Confirmed lineup corrected by operator');
  end if;
  return inserted;
end;
$$;
revoke execute on function public.record_match_participants(uuid, jsonb, uuid) from public, anon;
grant execute on function public.record_match_participants(uuid, jsonb, uuid) to authenticated, service_role;

-- Lineup candidates: players on each team's latest approved or locked roster
-- for this tournament. Returns nothing to callers who are not the assigned
-- official or a tournament operator.
create or replace function public.get_match_lineup_candidates(p_match_id uuid)
returns table(player_id uuid, team_id uuid, display_name text, shirt_number text)
language sql stable security definer set search_path = public as $$
  select rsp.player_id, e.team_id, p.display_name, rsp.shirt_number
  from public.matches m
  join public.tournament_entries e on e.tournament_id = m.tournament_id and e.team_id in (m.home_team_id, m.away_team_id)
  join lateral (
    select rs.id from public.roster_submissions rs
    where rs.entry_id = e.id and rs.status in ('approved', 'locked')
    order by rs.version desc limit 1
  ) latest on true
  join public.roster_submission_players rsp on rsp.submission_id = latest.id
  join public.player_profiles p on p.id = rsp.player_id
  where m.id = p_match_id and (public.is_match_official(p_match_id) or public.is_tournament_operator(m.tournament_id))
  order by e.team_id, p.display_name;
$$;
revoke execute on function public.get_match_lineup_candidates(uuid) from public, anon;
grant execute on function public.get_match_lineup_candidates(uuid) to authenticated, service_role;

-- 5. Event and score writes: assigned officials or operators only.
create or replace function public.record_match_event(
  p_match_id uuid, p_team_id uuid, p_player_id uuid, p_event_type text,
  p_event_minute integer, p_payload jsonb, p_idempotency_key uuid, p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare match_row public.matches; event_id uuid; allowed boolean := false; sport text;
begin
  if p_actor_id <> auth.uid() then raise exception 'actor_mismatch'; end if;
  select m.* into match_row from public.matches m where m.id = p_match_id for update;
  if match_row.id is null or not (public.is_match_official(p_match_id) or public.is_tournament_operator(match_row.tournament_id)) then raise exception 'match_not_assigned'; end if;
  if match_row.status = 'confirmed' then raise exception 'match_already_confirmed'; end if;
  select t.sport into sport from public.tournaments t where t.id = match_row.tournament_id;
  allowed := case sport
    when 'football' then p_event_type in ('goal','assist','yellow_card','red_card','substitution','own_goal','unassigned_goal','shootout_score')
    when 'futsal' then p_event_type in ('goal','assist','yellow_card','red_card','substitution','team_foul','own_goal','unassigned_goal','shootout_score')
    when 'handball' then p_event_type in ('goal','assist','yellow_card','red_card','blue_card','two_minute_suspension')
    when 'volleyball' then p_event_type in ('point','ace','attack_point','block','dig','recorded_error')
    when 'basketball' then p_event_type in ('one_point','two_point','three_point','rebound','assist','steal','block','foul')
    when 'basketball_3x3' then p_event_type in ('one_point','two_point','rebound','assist','steal','block','foul')
    else false end;
  if not allowed then raise exception 'unsupported_event_type'; end if;
  insert into public.match_events(match_id, team_id, player_id, event_type, event_minute, payload, recorded_by, idempotency_key)
    values (p_match_id, p_team_id, p_player_id, p_event_type, p_event_minute, p_payload, p_actor_id, p_idempotency_key)
    on conflict (match_id, idempotency_key) do nothing returning id into event_id;
  if event_id is null then select id into event_id from public.match_events where match_id = p_match_id and idempotency_key = p_idempotency_key; end if;
  return event_id;
end;
$$;

create or replace function public.submit_match_result(p_match_id uuid, p_score jsonb, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare next_version integer; result_id uuid; match_row public.matches;
begin
  if p_actor_id <> auth.uid() then raise exception 'actor_mismatch'; end if;
  select * into match_row from public.matches where id = p_match_id for update;
  if match_row.id is null or match_row.status = 'confirmed' or not (public.is_match_official(p_match_id) or public.is_tournament_operator(match_row.tournament_id)) then raise exception 'result_not_allowed'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.match_result_versions where match_id = p_match_id;
  insert into public.match_result_versions(match_id, version, score, status, submitted_by, confirmed_by) values (p_match_id, next_version, p_score, 'confirmed', p_actor_id, p_actor_id) returning id into result_id;
  update public.matches set status = 'confirmed' where id = p_match_id;
  update public.player_profiles set is_published = true where id in (select player_id from public.match_player_participants where match_id = p_match_id);
  perform public.recalculate_stage_standings(match_row.stage_id);
  perform public.recalculate_match_milestones(match_row.id);
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (p_actor_id, 'match_result_confirmed', 'match_result_version', result_id, 'Automatic confirmation');
  return result_id;
end;
$$;

-- 6. Confirmation and correction now rebuild the derived history.
create or replace function public.confirm_match_result(p_result_id uuid, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare result_row public.match_result_versions; match_row public.matches;
begin
  if p_actor_id <> auth.uid() then raise exception 'actor_mismatch'; end if;
  select * into result_row from public.match_result_versions where id = p_result_id for update;
  select * into match_row from public.matches where id = result_row.match_id for update;
  if result_row.id is null or match_row.id is null or not public.is_tournament_operator(match_row.tournament_id) or result_row.status <> 'submitted' then raise exception 'confirmation_not_allowed'; end if;
  update public.match_result_versions set status = 'confirmed', confirmed_by = p_actor_id where id = p_result_id;
  -- Older submissions for the same match can no longer be confirmed.
  update public.match_result_versions set status = 'rejected' where match_id = match_row.id and status = 'submitted' and id <> p_result_id;
  update public.matches set status = 'confirmed' where id = match_row.id;
  perform public.recalculate_stage_standings(match_row.stage_id);
  perform public.recalculate_match_milestones(match_row.id);
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (p_actor_id, 'match_result_confirmed', 'match_result_version', p_result_id, 'Organizer confirmation');
  return p_result_id;
end;
$$;

create or replace function public.correct_match_result(p_match_id uuid, p_score jsonb, p_reason text, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare next_version integer; result_id uuid; match_row public.matches;
begin
  if p_actor_id <> auth.uid() or nullif(trim(p_reason), '') is null then raise exception 'correction_reason_required'; end if;
  select * into match_row from public.matches where id = p_match_id for update;
  if match_row.id is null or not public.is_tournament_operator(match_row.tournament_id) then raise exception 'correction_not_allowed'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.match_result_versions where match_id = p_match_id;
  update public.match_result_versions set status = 'rejected', correction_reason = trim(p_reason) where match_id = p_match_id and status in ('confirmed', 'submitted');
  insert into public.match_result_versions(match_id, version, score, status, submitted_by, confirmed_by, correction_reason) values (p_match_id, next_version, p_score, 'confirmed', p_actor_id, p_actor_id, trim(p_reason)) returning id into result_id;
  update public.matches set status = 'confirmed' where id = p_match_id;
  perform public.recalculate_stage_standings(match_row.stage_id);
  perform public.recalculate_match_milestones(match_row.id);
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (p_actor_id, 'match_result_corrected', 'match_result_version', result_id, trim(p_reason));
  return result_id;
end;
$$;

-- 7. Seasons. RLS was enabled in 0005 with no policies, so no one could read
--    or create a season. Names are public labels; organization owners and
--    operations staff may create them.
drop policy if exists "seasons are public" on public.seasons;
create policy "seasons are public" on public.seasons for select using (true);
drop policy if exists "organizers create seasons" on public.seasons;
create policy "organizers create seasons" on public.seasons for insert to authenticated with check (
  created_by = auth.uid() and exists (select 1 from public.organization_memberships om where om.user_id = auth.uid() and om.role in ('owner', 'operations'))
);

-- 8. Close direct-write paths that bypassed the trusted functions above.
--    Before this, any member of either team could insert a result version with
--    any status (including 'confirmed') and insert, edit or delete match events
--    directly, even on a confirmed match. Participants keep their reads; every
--    write now goes through record_match_event / submit_match_result /
--    confirm_match_result / correct_match_result, which check assignment.
drop policy if exists "officials submit results" on public.match_result_versions;
drop policy if exists "assigned officials manage events" on public.match_events;
drop policy if exists "participants read events" on public.match_events;
create policy "participants read events" on public.match_events for select to authenticated using (public.is_match_participant(match_id));
drop policy if exists "assigned actors manage sync operations" on public.offline_sync_operations;
create policy "assigned actors manage sync operations" on public.offline_sync_operations for all to authenticated
  using (actor_id = auth.uid() and (public.is_match_official(match_id) or exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id))))
  with check (actor_id = auth.uid() and (public.is_match_official(match_id) or exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id))));
