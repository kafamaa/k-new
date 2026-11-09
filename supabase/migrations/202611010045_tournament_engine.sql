-- Review-only (owner, 2026-11-03). Do not apply without the owner's approval.
-- Apply after 202611010043 (the archive uses its player statistics) and 044.
--
-- Tournament Engine support. Everything reuses the existing competition tables;
-- this only adds what they cannot hold today:
--
--   1. standings_snapshot_history: recalculate_stage_standings deletes the
--      previous snapshot before writing the new one. Previous snapshots are now
--      copied here first, so every earlier table stays available for audit.
--   2. matches.live_phase + set_match_phase: the lifecycle shows Half-time and
--      Finished while a match is live. Only tournament operators and the match's
--      assigned officials can change it, and only while the match is live.
--   3. replace_match_participants: when a corrected result changes who qualified,
--      a later-round match that has not been played may have its teams replaced,
--      with a reason and an audit record. Played matches are never changed.
--   4. tournament_archives + publish_tournament_archive: "Finish and Publish
--      Archive" writes one immutable snapshot (final standings, bracket and
--      results, awards, team and player statistics) and marks the tournament
--      completed. Earlier snapshots are kept as versions; nothing is deleted.
--
-- Additive only. RLS on both new tables; writes only through the functions.

-- ---------------------------------------------------------------------------
-- 1. Standings snapshot history
-- ---------------------------------------------------------------------------
create table if not exists public.standings_snapshot_history (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.competition_stages(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete restrict,
  group_id uuid references public.competition_groups(id) on delete set null,
  played integer not null, wins integer not null, draws integer not null, losses integer not null,
  scored integer not null, conceded integer not null, points integer not null,
  calculated_from_version integer not null,
  calculated_at timestamptz not null,
  archived_at timestamptz not null default now()
);
create index if not exists standings_snapshot_history_stage_idx on public.standings_snapshot_history(stage_id, calculated_from_version);
alter table public.standings_snapshot_history enable row level security;
drop policy if exists "tournament operators read standings history" on public.standings_snapshot_history;
create policy "tournament operators read standings history" on public.standings_snapshot_history for select to authenticated
  using (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id)));
revoke all on public.standings_snapshot_history from anon;
grant select on public.standings_snapshot_history to authenticated;

-- Same calculation as migration 036, plus the copy into history before the
-- previous snapshot is replaced.
create or replace function public.recalculate_stage_standings(p_stage_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
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
  insert into public.standings_snapshot_history(stage_id, team_id, group_id, played, wins, draws, losses, scored, conceded, points, calculated_from_version, calculated_at)
    select s.stage_id, s.team_id, s.group_id, s.played, s.wins, s.draws, s.losses, s.scored, s.conceded, s.points, s.calculated_from_version, s.created_at
    from public.standings_snapshots s where s.stage_id = p_stage_id;
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
      select home_team_id as side_team, group_id from public.matches where stage_id = p_stage_id and home_team_id is not null and status <> 'cancelled'
      union all
      select away_team_id, group_id from public.matches where stage_id = p_stage_id and away_team_id is not null and status <> 'cancelled'
    ) appearances group by side_team
  ), adjustments as (
    select a.team_id, sum(a.points)::integer as points from public.standings_adjustments a
    where a.stage_id = p_stage_id and a.revoked_at is null group by a.team_id
  )
  select p_stage_id, st.side_team, st.group_id,
    count(s.side_team)::integer,
    (count(*) filter (where s.scored > s.conceded))::integer,
    (count(*) filter (where s.scored = s.conceded))::integer,
    (count(*) filter (where s.scored < s.conceded))::integer,
    coalesce(sum(s.scored), 0)::integer,
    coalesce(sum(s.conceded), 0)::integer,
    (coalesce(sum(case when s.scored > s.conceded then win_points when s.scored = s.conceded then draw_points when s.scored < s.conceded then loss_points else 0 end), 0)
      + coalesce(max(adj.points), 0))::integer,
    next_version
  from stage_teams st left join sides s on s.side_team = st.side_team left join adjustments adj on adj.team_id = st.side_team
  group by st.side_team, st.group_id;
end;
$$;
revoke execute on function public.recalculate_stage_standings(uuid) from public, anon, authenticated;
grant execute on function public.recalculate_stage_standings(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Live phase (Half-time, Finished)
-- ---------------------------------------------------------------------------
alter table public.matches add column if not exists live_phase text;
alter table public.matches drop constraint if exists matches_live_phase_check;
alter table public.matches add constraint matches_live_phase_check check (live_phase is null or live_phase in ('first_half', 'half_time', 'second_half', 'extra_time', 'penalties', 'finished'));

create or replace function public.set_match_phase(p_match uuid, p_phase text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_match public.matches;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  select * into v_match from public.matches where id = p_match for update;
  if v_match.id is null or not (public.is_tournament_operator(v_match.tournament_id) or public.is_match_official(p_match)) then raise exception 'organizer_permission_required'; end if;
  if v_match.status <> 'live' then raise exception 'match_not_live'; end if;
  if p_phase is null or p_phase not in ('first_half', 'half_time', 'second_half', 'extra_time', 'penalties', 'finished') then raise exception 'invalid_phase'; end if;
  update public.matches set live_phase = p_phase where id = p_match;
end;
$$;
revoke execute on function public.set_match_phase(uuid, text) from public, anon;
grant execute on function public.set_match_phase(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Controlled replacement after a progression conflict
-- ---------------------------------------------------------------------------
create or replace function public.replace_match_participants(p_match uuid, p_home uuid, p_away uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_match public.matches;
begin
  select * into v_match from public.matches where id = p_match for update;
  if v_match.id is null or not public.is_tournament_operator(v_match.tournament_id) then raise exception 'organizer_permission_required'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  if p_home is null or p_away is null or p_home = p_away then raise exception 'invalid_teams'; end if;
  if v_match.status not in ('scheduled', 'postponed') or exists (select 1 from public.match_result_versions r where r.match_id = p_match) then raise exception 'match_already_played'; end if;
  if exists (select 1 from public.match_events e where e.match_id = p_match) then raise exception 'events_recorded'; end if;
  if (select count(*) from public.tournament_entries te where te.tournament_id = v_match.tournament_id and te.application_status = 'approved' and te.team_id in (p_home, p_away)) <> 2 then raise exception 'team_not_confirmed'; end if;
  update public.matches set home_team_id = p_home, away_team_id = p_away where id = p_match;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
    values (auth.uid(), 'progression_conflict_resolved', 'match', p_match, left(format('%s (was %s v %s)', trim(p_reason), v_match.home_team_id, v_match.away_team_id), 500));
end;
$$;
revoke execute on function public.replace_match_participants(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.replace_match_participants(uuid, uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Permanent archive
-- ---------------------------------------------------------------------------
create table if not exists public.tournament_archives (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete restrict,
  version integer not null,
  snapshot jsonb not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (tournament_id, version)
);
alter table public.tournament_archives enable row level security;
drop policy if exists "published tournament archives are public" on public.tournament_archives;
create policy "published tournament archives are public" on public.tournament_archives for select
  using (exists (select 1 from public.tournaments t where t.id = tournament_id and t.is_published and t.status in ('completed', 'archived')));
drop policy if exists "tournament operators read archives" on public.tournament_archives;
create policy "tournament operators read archives" on public.tournament_archives for select to authenticated using (public.is_tournament_operator(tournament_id));
grant select on public.tournament_archives to anon, authenticated;

create or replace function public.publish_tournament_archive(p_tournament uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_tournament public.tournaments;
  v_version integer;
  v_snapshot jsonb;
begin
  select * into v_tournament from public.tournaments where id = p_tournament for update;
  if v_tournament.id is null or not public.is_tournament_operator(p_tournament) then raise exception 'organizer_permission_required'; end if;
  if exists (select 1 from public.matches m join public.competition_stages s on s.id = m.stage_id
             where m.tournament_id = p_tournament and m.status in ('scheduled', 'live', 'awaiting_confirmation', 'postponed')
               and coalesce(s.rules->>'superseded', 'false') <> 'true') then raise exception 'matches_unresolved'; end if;
  if not exists (select 1 from public.sport_milestones a where a.tournament_id = p_tournament and a.milestone_type = 'award_champion') then raise exception 'champion_required'; end if;

  -- Published, then the snapshot: public statistics read published tournaments only.
  update public.tournaments set status = 'completed', is_published = true, updated_at = now() where id = p_tournament;

  select jsonb_build_object(
    'tournament', jsonb_build_object('name', v_tournament.name, 'slug', v_tournament.slug, 'sport', v_tournament.sport),
    'generated_at', now(),
    'standings', coalesce((
      select jsonb_agg(jsonb_build_object('stage', s.name, 'group', g.name, 'team', case when t.is_published then t.name end, 'team_slug', case when t.is_published then t.slug end,
        'played', x.played, 'wins', x.wins, 'draws', x.draws, 'losses', x.losses, 'for', x.scored, 'against', x.conceded, 'points', x.points) order by s.stage_order, g.name, x.points desc, x.scored - x.conceded desc, x.scored desc)
      from public.standings_snapshots x join public.competition_stages s on s.id = x.stage_id join public.teams t on t.id = x.team_id left join public.competition_groups g on g.id = x.group_id
      where s.tournament_id = p_tournament and coalesce(s.rules->>'superseded', 'false') <> 'true'), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object('stage', s.name, 'leg', m.leg, 'scheduled_at', m.scheduled_at, 'venue', m.venue,
        'home', case when ht.is_published then ht.name end, 'away', case when at.is_published then at.name end,
        'home_score', case when jsonb_typeof(l.score->'home') = 'number' then l.score->'home' end,
        'away_score', case when jsonb_typeof(l.score->'away') = 'number' then l.score->'away' end,
        'home_shootout', case when jsonb_typeof(l.score->'homeShootout') = 'number' then l.score->'homeShootout' end,
        'away_shootout', case when jsonb_typeof(l.score->'awayShootout') = 'number' then l.score->'awayShootout' end,
        'outcome', case when l.score->>'outcome' in ('walkover', 'forfeit', 'abandoned') then l.score->>'outcome' end,
        'corrected', l.version > 1) order by s.stage_order, m.scheduled_at nulls last)
      from public.matches m join public.competition_stages s on s.id = m.stage_id
        join lateral (select v.score, v.version from public.match_result_versions v where v.match_id = m.id and v.status = 'confirmed' order by v.version desc limit 1) l on true
        left join public.teams ht on ht.id = m.home_team_id left join public.teams at on at.id = m.away_team_id
      where m.tournament_id = p_tournament and m.status = 'confirmed'), '[]'::jsonb),
    'awards', coalesce((
      select jsonb_agg(jsonb_build_object('kind', replace(a.milestone_type, 'award_', ''), 'label', a.label,
        'team', case when t.is_published then t.name end, 'player', case when p.is_published then p.display_name end) order by a.created_at)
      from public.sport_milestones a left join public.teams t on t.id = a.team_id left join public.player_profiles p on p.id = a.player_id
      where a.tournament_id = p_tournament and a.milestone_type like 'award\_%' and a.is_manual), '[]'::jsonb),
    'team_statistics', coalesce((
      select jsonb_agg(jsonb_build_object('team', t.name, 'team_slug', t.slug, 'played', sum_played, 'wins', sum_wins, 'draws', sum_draws, 'losses', sum_losses, 'for', sum_for, 'against', sum_against) order by sum_wins desc)
      from (select x.team_id, sum(x.played) sum_played, sum(x.wins) sum_wins, sum(x.draws) sum_draws, sum(x.losses) sum_losses, sum(x.scored) sum_for, sum(x.conceded) sum_against
            from public.standings_snapshots x join public.competition_stages s on s.id = x.stage_id
            where s.tournament_id = p_tournament and coalesce(s.rules->>'superseded', 'false') <> 'true' group by x.team_id) totals
      join public.teams t on t.id = totals.team_id where t.is_published), '[]'::jsonb),
    'player_statistics', coalesce((select jsonb_agg(to_jsonb(ps)) from public.get_public_tournament_player_statistics(p_tournament) ps), '[]'::jsonb)
  ) into v_snapshot;

  select coalesce(max(version), 0) + 1 into v_version from public.tournament_archives where tournament_id = p_tournament;
  insert into public.tournament_archives(tournament_id, version, snapshot, created_by) values (p_tournament, v_version, v_snapshot, auth.uid());
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (auth.uid(), 'tournament_archive_published', 'tournament', p_tournament, format('Archive version %s', v_version));
  return v_version;
end;
$$;
revoke execute on function public.publish_tournament_archive(uuid) from public, anon;
grant execute on function public.publish_tournament_archive(uuid) to authenticated, service_role;
