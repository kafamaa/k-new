-- Organizer tournament pages 28-39 (all-pages specification sections 34-45).
-- Review-only. Do not apply, push or deploy without explicit owner authorization.
-- Apply after 202611010035_super_admin_release_two.sql.
--
-- Created with `supabase migration new tournament_pages_complete`, then renamed from
-- 20261031212718_… to 202611010036_… so it sorts after 035.
--
-- What this adds:
--   1. A tournament activity timeline (tournament_events), written only by triggers
--      and functions, readable by the tournament's operators.
--   2. Applications: a waitlist status, a "rejected" payment status, an audited
--      status timeline, and roster unlocking only through a reasoned, audited action.
--   3. Setup: sport changes are locked once fixtures exist; setup and tournament
--      changes are recorded.
--   4. Draw and fixtures: publishing, schedule and status changes are recorded, and
--      the two teams' managers are notified when a published fixture changes.
--   5. Standings: manual point adjustments with a reason, included in every
--      recalculation; changing a stage's points recalculates it; an explicit
--      "recalculate now" for operators.
--   6. Operations: match-day checklists and incident reports.
--   7. Finance and sponsors: sponsors as their own records (logo, level, public
--      description, public/private, private agreement notes), sponsorship and
--      donation income, and a public sponsor list with public fields only.
--   8. Media: news can be linked to a team, player or match.
--   9. Completion: a server-side completion check; completing and archiving are
--      guarded, and nothing is deleted.
--
-- Every new function checks the caller, uses an empty search_path with qualified
-- names, and has EXECUTE revoked from public and anon.

-- ---------------------------------------------------------------------------------
-- 1. Tournament activity timeline
-- ---------------------------------------------------------------------------------
create table if not exists public.tournament_events (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  entity_type text not null check (entity_type in ('tournament', 'setup', 'entry', 'roster', 'stage', 'match', 'standings', 'sponsor', 'income', 'incident')),
  entity_id uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  note text,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists tournament_events_time_idx on public.tournament_events(tournament_id, created_at desc);
create index if not exists tournament_events_entity_idx on public.tournament_events(entity_id, created_at desc);
alter table public.tournament_events enable row level security;
drop policy if exists "operators read tournament events" on public.tournament_events;
create policy "operators read tournament events" on public.tournament_events for select to authenticated
  using (public.is_tournament_operator(tournament_id)
    or (entity_type in ('sponsor', 'income') and public.has_tournament_permission(tournament_id, 'finance')));

create or replace function public.log_tournament_event(p_tournament uuid, p_type text, p_entity uuid, p_action text, p_detail jsonb default '{}'::jsonb, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tournament_events (tournament_id, entity_type, entity_id, action, detail, note, actor_id)
  values (p_tournament, p_type, p_entity, p_action, coalesce(p_detail, '{}'::jsonb), left(p_note, 1000), (select auth.uid()));
end;
$$;

-- ---------------------------------------------------------------------------------
-- 2. Applications, payments and rosters
-- ---------------------------------------------------------------------------------
alter table public.tournament_entries drop constraint if exists tournament_entries_application_status_check;
alter table public.tournament_entries add constraint tournament_entries_application_status_check
  check (application_status in ('draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'withdrawn', 'waitlisted'));
alter table public.tournament_entries drop constraint if exists tournament_entries_payment_status_check;
alter table public.tournament_entries add constraint tournament_entries_payment_status_check
  check (payment_status in ('not_required', 'unpaid', 'proof_submitted', 'under_review', 'paid', 'waived', 'refunded', 'overdue', 'rejected'));

-- Every status change on an entry is recorded with the review note.
create or replace function public.track_entry_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.application_status is distinct from old.application_status then
    perform public.log_tournament_event(new.tournament_id, 'entry', new.id, 'application_' || new.application_status, jsonb_build_object('from', old.application_status), new.review_notes);
  end if;
  if new.roster_status is distinct from old.roster_status then
    perform public.log_tournament_event(new.tournament_id, 'roster', new.id, 'roster_' || new.roster_status, jsonb_build_object('from', old.roster_status), new.review_notes);
  end if;
  if new.payment_status is distinct from old.payment_status then
    perform public.log_tournament_event(new.tournament_id, 'entry', new.id, 'payment_' || new.payment_status, jsonb_build_object('from', old.payment_status), new.review_notes);
  end if;
  return new;
end;
$$;
drop trigger if exists track_entry_changes_trigger on public.tournament_entries;
create trigger track_entry_changes_trigger after update on public.tournament_entries for each row execute function public.track_entry_changes();

-- A locked roster can only be reopened through unlock_entry_roster, which needs a reason.
create or replace function public.protect_locked_roster()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.roster_status = 'locked' and new.roster_status <> 'locked'
     and coalesce(current_setting('kulhivaru.roster_unlock', true), '') <> old.id::text then
    raise exception 'roster_unlock_requires_reason';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_locked_roster_trigger on public.tournament_entries;
create trigger protect_locked_roster_trigger before update on public.tournament_entries for each row execute function public.protect_locked_roster();

create or replace function public.unlock_entry_roster(p_entry uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_entry public.tournament_entries;
begin
  if (select auth.uid()) is null then raise exception 'sign_in_required'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  select * into v_entry from public.tournament_entries where id = p_entry for update;
  if v_entry.id is null or not public.is_tournament_operator(v_entry.tournament_id) then raise exception 'organizer_permission_required'; end if;
  if v_entry.roster_status <> 'locked' then raise exception 'roster_not_locked'; end if;
  perform set_config('kulhivaru.roster_unlock', p_entry::text, true);
  update public.tournament_entries set roster_status = 'approved', review_notes = left('Roster unlocked: ' || trim(p_reason), 1000) where id = p_entry;
  perform set_config('kulhivaru.roster_unlock', '', true);
end;
$$;

-- ---------------------------------------------------------------------------------
-- 3. Setup: locking and change records
-- ---------------------------------------------------------------------------------
-- The sport decides scoring and standings, so it cannot change once fixtures exist.
create or replace function public.protect_tournament_setup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.sport is distinct from old.sport and exists (select 1 from public.matches m where m.tournament_id = old.id) then
    raise exception 'sport_locked_after_fixtures';
  end if;
  -- Completing needs every fixture resolved and a champion recorded; archiving needs a finished tournament.
  if new.status = 'completed' and old.status <> 'completed' then
    if exists (select 1 from public.matches m where m.tournament_id = old.id and m.status in ('scheduled', 'live', 'awaiting_confirmation', 'postponed')) then
      raise exception 'completion_blocked_unresolved_fixtures';
    end if;
    if not exists (select 1 from public.sport_milestones s where s.tournament_id = old.id and s.milestone_type = 'award_champion') then
      raise exception 'completion_blocked_no_champion';
    end if;
  end if;
  if new.status = 'archived' and old.status <> 'archived' and old.status not in ('completed', 'cancelled') then
    raise exception 'archive_requires_completion';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_tournament_setup_trigger on public.tournaments;
create trigger protect_tournament_setup_trigger before update on public.tournaments for each row execute function public.protect_tournament_setup();

create or replace function public.track_tournament_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_changed text[] := '{}';
begin
  if new.name is distinct from old.name then v_changed := array_append(v_changed, 'name'::text); end if;
  if new.sport is distinct from old.sport then v_changed := array_append(v_changed, 'sport'::text); end if;
  if new.is_published is distinct from old.is_published then v_changed := array_append(v_changed, 'publication'::text); end if;
  if new.logo_path is distinct from old.logo_path or new.cover_path is distinct from old.cover_path then v_changed := array_append(v_changed, 'branding'::text); end if;
  if new.status is distinct from old.status then
    perform public.log_tournament_event(new.id, 'tournament', new.id, 'status_' || new.status, jsonb_build_object('from', old.status), null);
  end if;
  if cardinality(v_changed) > 0 then
    perform public.log_tournament_event(new.id, 'tournament', new.id, 'details_changed', jsonb_build_object('fields', to_jsonb(v_changed), 'published', old.is_published), null);
  end if;
  return new;
end;
$$;
drop trigger if exists track_tournament_changes_trigger on public.tournaments;
create trigger track_tournament_changes_trigger after update on public.tournaments for each row execute function public.track_tournament_changes();

create or replace function public.track_setup_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_published boolean;
begin
  if tg_op = 'UPDATE' and new.data is not distinct from old.data and new.status is not distinct from old.status then return new; end if;
  select t.is_published into v_published from public.tournaments t where t.id = new.tournament_id;
  perform public.log_tournament_event(new.tournament_id, 'setup', null, 'setup_step_saved',
    jsonb_build_object('step', new.step_number, 'status', new.status, 'afterPublication', coalesce(v_published, false)), null);
  return new;
end;
$$;
drop trigger if exists track_setup_changes_trigger on public.tournament_setup_steps;
create trigger track_setup_changes_trigger after insert or update on public.tournament_setup_steps for each row execute function public.track_setup_changes();

-- ---------------------------------------------------------------------------------
-- 4. Draw and fixtures: records and notifications
-- ---------------------------------------------------------------------------------
create or replace function public.track_stage_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_tournament_event(new.tournament_id, 'stage', new.id, 'draw_saved', jsonb_build_object('name', new.name, 'format', new.format, 'drawMode', new.draw_mode), null);
    return new;
  end if;
  if new.published_at is distinct from old.published_at then
    perform public.log_tournament_event(new.tournament_id, 'stage', new.id, case when new.published_at is null then 'draw_unpublished' else 'draw_published' end, jsonb_build_object('name', new.name), null);
  end if;
  if new.rules is distinct from old.rules then
    perform public.log_tournament_event(new.tournament_id, 'stage', new.id, 'stage_rules_changed', jsonb_build_object('name', new.name, 'rules', new.rules), null);
    -- New points or tie-breakers apply to the table at once.
    perform public.recalculate_stage_standings(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists track_stage_changes_trigger on public.competition_stages;
create trigger track_stage_changes_trigger after insert or update on public.competition_stages for each row execute function public.track_stage_changes();

-- Schedule, venue and status changes are recorded; once the draw is published the
-- two teams' managers get an in-app notification.
create or replace function public.track_match_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_published boolean;
  v_label text;
  v_message text;
  v_note text;
begin
  if tg_op = 'INSERT' then
    perform public.log_tournament_event(new.tournament_id, 'match', new.id, 'fixture_added', jsonb_build_object('scheduledAt', new.scheduled_at, 'venue', new.venue), null);
    return new;
  end if;
  if new.scheduled_at is not distinct from old.scheduled_at and new.venue is not distinct from old.venue and new.status is not distinct from old.status then return new; end if;
  -- change_fixture passes the organizer's reason through a transaction-local setting.
  v_note := nullif(current_setting('kulhivaru.change_note', true), '');
  perform public.log_tournament_event(new.tournament_id, 'match', new.id,
    case when new.status is distinct from old.status then 'fixture_' || new.status else 'fixture_rescheduled' end,
    jsonb_build_object('from', jsonb_build_object('scheduledAt', old.scheduled_at, 'venue', old.venue, 'status', old.status), 'to', jsonb_build_object('scheduledAt', new.scheduled_at, 'venue', new.venue, 'status', new.status)), v_note);
  select s.published_at is not null into v_published from public.competition_stages s where s.id = new.stage_id;
  if not coalesce(v_published, false) then return new; end if;
  if new.status in ('live', 'awaiting_confirmation', 'confirmed') and new.scheduled_at is not distinct from old.scheduled_at and new.venue is not distinct from old.venue then return new; end if;
  select coalesce(h.name, 'To be decided') || ' vs ' || coalesce(a.name, 'To be decided') into v_label
    from public.matches m left join public.teams h on h.id = m.home_team_id left join public.teams a on a.id = m.away_team_id where m.id = new.id;
  v_message := case
    when new.status = 'postponed' and old.status <> 'postponed' then 'This match has been postponed. A new date will follow.'
    when new.status = 'cancelled' and old.status <> 'cancelled' then 'This match has been cancelled.'
    when new.status = 'abandoned' and old.status <> 'abandoned' then 'This match was abandoned. The organizer will confirm what happens next.'
    else 'The date, time or venue of this match has changed. '
      || coalesce('New time: ' || to_char(new.scheduled_at at time zone 'Indian/Maldives', 'DD Mon YYYY HH24:MI') || ' (Maldives time). ', '')
      || coalesce('Venue: ' || new.venue || '.', '')
  end || coalesce(' Reason: ' || v_note, '');
  insert into public.notifications (recipient_id, tournament_id, notification_type, title, body, channel, created_by)
  select distinct tm.user_id, new.tournament_id, 'fixture_change', 'Fixture update: ' || v_label, v_message, 'in_app', (select auth.uid())
  from public.team_memberships tm where tm.team_id in (new.home_team_id, new.away_team_id);
  return new;
end;
$$;
drop trigger if exists track_match_changes_trigger on public.matches;
create trigger track_match_changes_trigger after insert or update on public.matches for each row execute function public.track_match_changes();

-- Reschedule, postpone, cancel, abandon or reinstate a fixture with a recorded reason.
-- Confirmed results are changed only through result correction.
create or replace function public.change_fixture(p_match uuid, p_status text, p_scheduled_at timestamptz, p_venue text, p_reason text, p_set_schedule boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_match public.matches;
begin
  select * into v_match from public.matches where id = p_match for update;
  if v_match.id is null or not public.is_tournament_operator(v_match.tournament_id) then raise exception 'organizer_permission_required'; end if;
  if v_match.status = 'confirmed' then raise exception 'result_not_allowed'; end if;
  if p_status is not null and p_status not in ('scheduled', 'postponed', 'cancelled', 'abandoned') then raise exception 'invalid_status'; end if;
  if p_status in ('postponed', 'cancelled', 'abandoned') and (p_reason is null or length(trim(p_reason)) < 5) then raise exception 'reason_required'; end if;
  perform set_config('kulhivaru.change_note', left(coalesce(trim(p_reason), ''), 500), true);
  update public.matches set
    status = coalesce(p_status, status),
    scheduled_at = case when p_set_schedule then p_scheduled_at else scheduled_at end,
    venue = case when p_set_schedule then nullif(trim(coalesce(p_venue, '')), '') else venue end
  where id = p_match;
  perform set_config('kulhivaru.change_note', '', true);
end;
$$;

-- ---------------------------------------------------------------------------------
-- 5. Standings adjustments and recalculation
-- ---------------------------------------------------------------------------------
create table if not exists public.standings_adjustments (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.competition_stages(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete restrict,
  points integer not null check (points between -100 and 100 and points <> 0),
  reason text not null check (length(trim(reason)) between 5 and 500),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text
);
create index if not exists standings_adjustments_stage_idx on public.standings_adjustments(stage_id) where revoked_at is null;
alter table public.standings_adjustments enable row level security;
drop policy if exists "operators read standings adjustments" on public.standings_adjustments;
create policy "operators read standings adjustments" on public.standings_adjustments for select to authenticated
  using (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id)));

-- Same as migration 025, plus active adjustments added to each team's points.
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

create or replace function public.adjust_standings(p_stage uuid, p_team uuid, p_points integer, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tournament uuid;
  v_id uuid;
begin
  select s.tournament_id into v_tournament from public.competition_stages s where s.id = p_stage;
  if v_tournament is null or not public.is_tournament_operator(v_tournament) then raise exception 'organizer_permission_required'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  if not exists (select 1 from public.matches m where m.stage_id = p_stage and p_team in (m.home_team_id, m.away_team_id)) then raise exception 'team_not_in_stage'; end if;
  insert into public.standings_adjustments (stage_id, team_id, points, reason, created_by) values (p_stage, p_team, p_points, trim(p_reason), (select auth.uid())) returning id into v_id;
  perform public.recalculate_stage_standings(p_stage);
  perform public.log_tournament_event(v_tournament, 'standings', p_stage, 'points_adjusted', jsonb_build_object('team', p_team, 'points', p_points), p_reason);
  return v_id;
end;
$$;

create or replace function public.revoke_standings_adjustment(p_adjustment uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row public.standings_adjustments;
  v_tournament uuid;
begin
  select * into v_row from public.standings_adjustments where id = p_adjustment for update;
  select s.tournament_id into v_tournament from public.competition_stages s where s.id = v_row.stage_id;
  if v_row.id is null or v_tournament is null or not public.is_tournament_operator(v_tournament) then raise exception 'organizer_permission_required'; end if;
  if v_row.revoked_at is not null then raise exception 'already_revoked'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  update public.standings_adjustments set revoked_at = now(), revoked_by = (select auth.uid()), revoke_reason = trim(p_reason) where id = p_adjustment;
  perform public.recalculate_stage_standings(v_row.stage_id);
  perform public.log_tournament_event(v_tournament, 'standings', v_row.stage_id, 'adjustment_revoked', jsonb_build_object('team', v_row.team_id, 'points', v_row.points), p_reason);
end;
$$;

-- Rebuilds every stage's table and every confirmed match's milestones once.
create or replace function public.recalculate_tournament(p_tournament uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_stage uuid;
  v_match uuid;
  v_count integer := 0;
begin
  if not public.is_tournament_operator(p_tournament) then raise exception 'organizer_permission_required'; end if;
  for v_stage in select s.id from public.competition_stages s where s.tournament_id = p_tournament loop
    perform public.recalculate_stage_standings(v_stage); v_count := v_count + 1;
  end loop;
  for v_match in select m.id from public.matches m where m.tournament_id = p_tournament and m.status = 'confirmed' loop
    perform public.recalculate_match_milestones(v_match);
  end loop;
  perform public.log_tournament_event(p_tournament, 'standings', null, 'recalculated', jsonb_build_object('stages', v_count), null);
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------
-- 6. Operations: match-day checklists and incidents
-- ---------------------------------------------------------------------------------
create table if not exists public.match_day_checklists (
  match_id uuid primary key references public.matches(id) on delete cascade,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 40),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.match_day_checklists enable row level security;
create or replace function public.can_run_match_day(p_match uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.matches m where m.id = p_match and (public.is_tournament_operator(m.tournament_id) or public.has_tournament_permission(m.tournament_id, 'operations')))
    or public.is_match_official(p_match);
$$;
drop policy if exists "match day staff read checklists" on public.match_day_checklists;
create policy "match day staff read checklists" on public.match_day_checklists for select to authenticated using (public.can_run_match_day(match_id));
drop policy if exists "match day staff create checklists" on public.match_day_checklists;
create policy "match day staff create checklists" on public.match_day_checklists for insert to authenticated
  with check (public.can_run_match_day(match_id) and updated_by = (select auth.uid()));
drop policy if exists "match day staff update checklists" on public.match_day_checklists;
create policy "match day staff update checklists" on public.match_day_checklists for update to authenticated
  using (public.can_run_match_day(match_id)) with check (public.can_run_match_day(match_id) and updated_by = (select auth.uid()));

create table if not exists public.tournament_incidents (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  category text not null check (category in ('injury', 'discipline', 'venue', 'security', 'equipment', 'weather', 'other')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  description text not null check (length(trim(description)) between 3 and 2000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text check (resolution is null or length(resolution) <= 2000),
  reported_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists tournament_incidents_idx on public.tournament_incidents(tournament_id, status, created_at desc);
alter table public.tournament_incidents enable row level security;
-- Incidents are private to the tournament's operators and the match's assigned officials.
drop policy if exists "operations staff read incidents" on public.tournament_incidents;
create policy "operations staff read incidents" on public.tournament_incidents for select to authenticated
  using (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'operations') or (match_id is not null and public.is_match_official(match_id)));
drop policy if exists "operations staff report incidents" on public.tournament_incidents;
create policy "operations staff report incidents" on public.tournament_incidents for insert to authenticated
  with check (reported_by = (select auth.uid()) and status = 'open'
    and (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'operations') or (match_id is not null and public.is_match_official(match_id)))
    and (match_id is null or exists (select 1 from public.matches m where m.id = match_id and m.tournament_id = tournament_incidents.tournament_id)));
drop policy if exists "operators resolve incidents" on public.tournament_incidents;
create policy "operators resolve incidents" on public.tournament_incidents for update to authenticated
  using (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'operations'))
  with check (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'operations'));

create or replace function public.track_incident_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_tournament_event(new.tournament_id, 'incident', new.id, 'incident_reported', jsonb_build_object('category', new.category, 'severity', new.severity), null);
  elsif new.status is distinct from old.status then
    perform public.log_tournament_event(new.tournament_id, 'incident', new.id, 'incident_' || new.status, '{}'::jsonb, new.resolution);
  end if;
  return new;
end;
$$;
drop trigger if exists track_incident_changes_trigger on public.tournament_incidents;
create trigger track_incident_changes_trigger after insert or update on public.tournament_incidents for each row execute function public.track_incident_changes();

-- ---------------------------------------------------------------------------------
-- 7. Sponsors and tournament income
-- ---------------------------------------------------------------------------------
create table if not exists public.tournament_sponsors (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  level text not null default 'Partner' check (level in ('Title sponsor', 'Gold', 'Silver', 'Partner', 'Supporter')),
  website text check (website is null or website ~ '^https?://[A-Za-z0-9.-]+'),
  description text check (description is null or length(description) <= 400),
  logo_path text check (logo_path is null or logo_path ~ '^tournaments/[0-9a-f-]{36}/sponsors/[A-Za-z0-9_.-]{1,160}$'),
  is_public boolean not null default true,
  agreement_notes text check (agreement_notes is null or length(agreement_notes) <= 2000),
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tournament_sponsors_idx on public.tournament_sponsors(tournament_id, sort_order);
alter table public.tournament_sponsors enable row level security;
-- The table (with private agreement notes) is staff-only; visitors use get_public_tournament_sponsors.
drop policy if exists "finance staff read sponsors" on public.tournament_sponsors;
create policy "finance staff read sponsors" on public.tournament_sponsors for select to authenticated
  using (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'finance'));
drop policy if exists "finance staff add sponsors" on public.tournament_sponsors;
create policy "finance staff add sponsors" on public.tournament_sponsors for insert to authenticated
  with check (created_by = (select auth.uid()) and (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'finance')));
drop policy if exists "finance staff update sponsors" on public.tournament_sponsors;
create policy "finance staff update sponsors" on public.tournament_sponsors for update to authenticated
  using (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'finance'))
  with check (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'finance'));
drop policy if exists "finance staff remove sponsors" on public.tournament_sponsors;
create policy "finance staff remove sponsors" on public.tournament_sponsors for delete to authenticated
  using (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'finance'));

create table if not exists public.tournament_income (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  kind text not null check (kind in ('sponsorship', 'donation', 'other')),
  sponsor_id uuid references public.tournament_sponsors(id) on delete set null,
  amount_mvr numeric(12, 2) not null check (amount_mvr > 0),
  status text not null default 'pledged' check (status in ('pledged', 'received', 'cancelled')),
  description text not null check (length(trim(description)) between 2 and 300),
  received_on date,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'received' or received_on is not null)
);
create index if not exists tournament_income_idx on public.tournament_income(tournament_id, created_at desc);
alter table public.tournament_income enable row level security;
-- Finance-only, separate from organization and team finance. Nothing is deleted; cancel instead.
drop policy if exists "finance staff read income" on public.tournament_income;
create policy "finance staff read income" on public.tournament_income for select to authenticated
  using (public.has_tournament_permission(tournament_id, 'finance'));
drop policy if exists "finance staff record income" on public.tournament_income;
create policy "finance staff record income" on public.tournament_income for insert to authenticated
  with check (created_by = (select auth.uid()) and public.has_tournament_permission(tournament_id, 'finance')
    and (sponsor_id is null or exists (select 1 from public.tournament_sponsors s where s.id = sponsor_id and s.tournament_id = tournament_income.tournament_id)));
drop policy if exists "finance staff update income" on public.tournament_income;
create policy "finance staff update income" on public.tournament_income for update to authenticated
  using (public.has_tournament_permission(tournament_id, 'finance'))
  with check (public.has_tournament_permission(tournament_id, 'finance'));

create or replace function public.track_finance_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'tournament_sponsors' then
    if tg_op = 'DELETE' then
      perform public.log_tournament_event(old.tournament_id, 'sponsor', old.id, 'sponsor_removed', jsonb_build_object('name', old.name), null);
      return old;
    end if;
    perform public.log_tournament_event(new.tournament_id, 'sponsor', new.id, case when tg_op = 'INSERT' then 'sponsor_added' else 'sponsor_updated' end, jsonb_build_object('name', new.name, 'public', new.is_public), null);
    return new;
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.amount_mvr is distinct from old.amount_mvr then
    perform public.log_tournament_event(new.tournament_id, 'income', new.id, 'income_' || case when tg_op = 'INSERT' then 'recorded' else new.status end, jsonb_build_object('kind', new.kind, 'amount', new.amount_mvr, 'status', new.status), null);
  end if;
  return new;
end;
$$;
drop trigger if exists track_sponsor_changes_trigger on public.tournament_sponsors;
create trigger track_sponsor_changes_trigger after insert or update or delete on public.tournament_sponsors for each row execute function public.track_finance_changes();
drop trigger if exists track_income_changes_trigger on public.tournament_income;
create trigger track_income_changes_trigger after insert or update on public.tournament_income for each row execute function public.track_finance_changes();

-- Public fields only, for published tournaments.
create or replace function public.get_public_tournament_sponsors(p_tournament uuid)
returns table (sponsor_name text, sponsor_level text, website text, description text, logo_path text)
language sql stable security definer set search_path = '' as $$
  select s.name, s.level, s.website, s.description, s.logo_path
  from public.tournament_sponsors s join public.tournaments t on t.id = s.tournament_id
  where s.tournament_id = p_tournament and s.is_public and t.is_published and t.status <> 'draft'
  order by case s.level when 'Title sponsor' then 0 when 'Gold' then 1 when 'Silver' then 2 when 'Partner' then 3 else 4 end, s.sort_order, s.name;
$$;

-- Sponsors recorded in setup step 10 before this migration become sponsor records once.
insert into public.tournament_sponsors (tournament_id, name, level, website, created_by)
select s.tournament_id, left(trim(x ->> 'name'), 120),
  case when x ->> 'tier' in ('Title sponsor', 'Gold', 'Silver', 'Partner', 'Supporter') then x ->> 'tier' else 'Partner' end,
  case when coalesce(x ->> 'website', '') ~ '^https?://[A-Za-z0-9.-]+' then x ->> 'website' end,
  t.created_by
from public.tournament_setup_steps s
join public.tournaments t on t.id = s.tournament_id
cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data -> 'sponsors') = 'array' then s.data -> 'sponsors' else '[]'::jsonb end) x
where s.step_number = 10 and length(trim(coalesce(x ->> 'name', ''))) >= 2
  and not exists (select 1 from public.tournament_sponsors ts where ts.tournament_id = s.tournament_id);

-- Sponsor logos and news covers are public images under public-media/tournaments/<id>/(sponsors|news)/.
-- Sponsor logos: operators and finance staff. News covers: operators and media staff.
drop policy if exists "tournament operators write sponsor logos" on storage.objects;
create policy "tournament operators write sponsor logos" on storage.objects for insert to authenticated
  with check (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'tournaments' and (storage.foldername(name))[3] in ('sponsors', 'news')
    and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
    and (public.is_tournament_operator(((storage.foldername(name))[2])::uuid)
      or ((storage.foldername(name))[3] = 'sponsors' and public.has_tournament_permission(((storage.foldername(name))[2])::uuid, 'finance'))
      or ((storage.foldername(name))[3] = 'news' and public.has_tournament_permission(((storage.foldername(name))[2])::uuid, 'media'))));

-- ---------------------------------------------------------------------------------
-- 8. News linked to a team, player or match
-- ---------------------------------------------------------------------------------
alter table public.news_articles add column if not exists related_team_id uuid references public.teams(id) on delete set null;
alter table public.news_articles add column if not exists related_player_id uuid references public.player_profiles(id) on delete set null;
alter table public.news_articles add column if not exists related_match_id uuid references public.matches(id) on delete set null;

-- ---------------------------------------------------------------------------------
-- 9. Completion checks (read-only)
-- ---------------------------------------------------------------------------------
create or replace function public.tournament_completion_checks(p_tournament uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_unresolved integer;
  v_awaiting integer;
  v_conflicts integer;
  v_unfinished_tables integer;
  v_final_id uuid;
  v_final_total integer := 0;
  v_final_confirmed integer := 0;
  v_awards text[];
  v_requests integer;
  v_reports integer;
  v_incidents integer;
begin
  if not public.is_tournament_operator(p_tournament) then raise exception 'organizer_permission_required'; end if;
  select count(*) into v_unresolved from public.matches m where m.tournament_id = p_tournament and m.status in ('scheduled', 'live', 'postponed');
  select count(*) into v_awaiting from public.matches m where m.tournament_id = p_tournament and m.status = 'awaiting_confirmation';
  select (select count(*) from public.offline_sync_operations o join public.matches m on m.id = o.match_id where m.tournament_id = p_tournament and o.status = 'conflict')
       + (select count(*) from public.match_result_versions v join public.matches m on m.id = v.match_id where m.tournament_id = p_tournament and v.status = 'conflict')
    into v_conflicts;
  -- A league or group stage with confirmed results must have a calculated table.
  select count(*) into v_unfinished_tables from public.competition_stages s
    where s.tournament_id = p_tournament and s.format <> 'knockout'
      and exists (select 1 from public.matches m where m.stage_id = s.id and m.status = 'confirmed')
      and not exists (select 1 from public.standings_snapshots x where x.stage_id = s.id);
  -- The last knockout stage, if any, must be a single confirmed final.
  select s.id into v_final_id from public.competition_stages s where s.tournament_id = p_tournament and s.format = 'knockout' order by s.stage_order desc, s.name desc limit 1;
  if v_final_id is not null then
    select count(*), count(*) filter (where m.status = 'confirmed') into v_final_total, v_final_confirmed from public.matches m where m.stage_id = v_final_id;
  end if;
  select coalesce(array_agg(distinct s.milestone_type), '{}') into v_awards from public.sport_milestones s where s.tournament_id = p_tournament and s.milestone_type like 'award_%';
  select count(*) into v_requests from public.player_correction_requests q where q.tournament_id = p_tournament and q.status in ('pending', 'under_review');
  select count(*) into v_reports from public.team_result_reports r where r.tournament_id = p_tournament and r.status in ('pending', 'under_review');
  select count(*) into v_incidents from public.tournament_incidents i where i.tournament_id = p_tournament and i.status = 'open';
  return jsonb_build_array(
    jsonb_build_object('key', 'fixtures', 'label', 'No unresolved fixtures', 'ok', v_unresolved = 0, 'blocking', true, 'detail', v_unresolved || ' fixture(s) still scheduled, live or postponed'),
    jsonb_build_object('key', 'results', 'label', 'Every result confirmed', 'ok', v_awaiting = 0, 'blocking', true, 'detail', v_awaiting || ' result(s) awaiting confirmation'),
    jsonb_build_object('key', 'conflicts', 'label', 'No result conflicts', 'ok', v_conflicts = 0, 'blocking', true, 'detail', v_conflicts || ' conflicting result or sync record(s)'),
    jsonb_build_object('key', 'standings', 'label', 'Standings final', 'ok', v_unfinished_tables = 0, 'blocking', true, 'detail', v_unfinished_tables || ' stage(s) without a calculated table'),
    jsonb_build_object('key', 'bracket', 'label', 'Bracket complete', 'ok', v_final_id is null or (v_final_total = 1 and v_final_confirmed = 1), 'blocking', v_final_id is not null,
      'detail', case when v_final_id is null then 'No knockout stage' when v_final_total = 1 then 'Final ' || (case when v_final_confirmed = 1 then 'confirmed' else 'not confirmed' end) else 'The last knockout round has ' || v_final_total || ' matches; create the next round' end),
    jsonb_build_object('key', 'champion', 'label', 'Champion recorded', 'ok', 'award_champion' = any(v_awards), 'blocking', true, 'detail', case when 'award_champion' = any(v_awards) then 'Recorded' else 'Record the champion in Awards' end),
    jsonb_build_object('key', 'runner_up', 'label', 'Runner-up recorded', 'ok', 'award_runner_up' = any(v_awards), 'blocking', false, 'detail', case when 'award_runner_up' = any(v_awards) then 'Recorded' else 'Not recorded' end),
    jsonb_build_object('key', 'third_place', 'label', 'Third place recorded', 'ok', 'award_third_place' = any(v_awards), 'blocking', false, 'detail', case when 'award_third_place' = any(v_awards) then 'Recorded' else 'Not recorded (only needed if a third place was decided)' end),
    jsonb_build_object('key', 'corrections', 'label', 'Outstanding corrections reviewed', 'ok', v_requests + v_reports = 0, 'blocking', false, 'detail', (v_requests + v_reports) || ' player or team correction request(s) open'),
    jsonb_build_object('key', 'incidents', 'label', 'Incidents closed', 'ok', v_incidents = 0, 'blocking', false, 'detail', v_incidents || ' incident(s) still open'),
    jsonb_build_object('key', 'statistics', 'label', 'Statistics recalculated', 'ok', v_awaiting = 0 and v_conflicts = 0, 'blocking', false, 'detail', 'Statistics are rebuilt from confirmed results only; use Recalculate now if in doubt'));
end;
$$;

-- ---------------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------------
revoke execute on function public.log_tournament_event(uuid, text, uuid, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.track_entry_changes() from public, anon, authenticated;
revoke execute on function public.protect_locked_roster() from public, anon, authenticated;
revoke execute on function public.protect_tournament_setup() from public, anon, authenticated;
revoke execute on function public.track_tournament_changes() from public, anon, authenticated;
revoke execute on function public.track_setup_changes() from public, anon, authenticated;
revoke execute on function public.track_stage_changes() from public, anon, authenticated;
revoke execute on function public.track_match_changes() from public, anon, authenticated;
revoke execute on function public.track_incident_changes() from public, anon, authenticated;
revoke execute on function public.track_finance_changes() from public, anon, authenticated;

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.unlock_entry_roster(uuid, text)', 'public.change_fixture(uuid, text, timestamptz, text, text, boolean)', 'public.adjust_standings(uuid, uuid, integer, text)', 'public.revoke_standings_adjustment(uuid, text)',
    'public.recalculate_tournament(uuid)', 'public.can_run_match_day(uuid)', 'public.tournament_completion_checks(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;
end;
$$;
revoke execute on function public.get_public_tournament_sponsors(uuid) from public;
grant execute on function public.get_public_tournament_sponsors(uuid) to anon, authenticated, service_role;

revoke insert, update, delete, truncate on public.tournament_events, public.standings_adjustments from anon, authenticated;
revoke all on public.tournament_events, public.standings_adjustments, public.match_day_checklists, public.tournament_incidents, public.tournament_sponsors, public.tournament_income from anon;
