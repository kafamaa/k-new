-- Review-only (owner, 2026-11-03). Do not apply without the owner's approval.
--
-- Why this is needed:
--   1. The Match Center's Full Career Record mode records penalty misses. The
--      event validator in record_match_event has no such type, so it is added
--      here (football, futsal, handball). Penalty goals stay 'goal' events with
--      payload.method = 'penalty', so every goal count stays correct. A second
--      yellow is recorded as yellow_card + red_card with payload.second_yellow,
--      so it needs no new type. Injuries go to the private incidents log.
--   2. Suspensions: nothing in the schema records them. player_suspensions is
--      new and additive. Automatic suspensions come only from cards in
--      CONFIRMED matches (a red card, or every Nth yellow card, N = the
--      tournament's yellowCardLimit setting, default 3) and are marked served
--      after the team's next confirmed matches. Manual suspensions and
--      overturning need a reason and write an audit event. Nothing is deleted.
--
-- Additive only: one new table, one replaced function (same signature and
-- behaviour plus one event type), three new functions. RLS on the new table;
-- writes only through the functions below.

-- ---------------------------------------------------------------------------
-- 1. record_match_event: add 'penalty_miss'
-- ---------------------------------------------------------------------------
create or replace function public.record_match_event(
  p_match_id uuid, p_team_id uuid, p_player_id uuid, p_event_type text, p_event_minute integer,
  p_payload jsonb, p_idempotency_key uuid, p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare match_row public.matches; event_id uuid; allowed boolean := false; v_sport text;
begin
  if p_actor_id <> auth.uid() then raise exception 'actor_mismatch'; end if;
  select m.* into match_row from public.matches m where m.id = p_match_id for update;
  if match_row.id is null or not (public.is_match_official(p_match_id) or public.is_tournament_operator(match_row.tournament_id)) then raise exception 'match_not_assigned'; end if;
  if match_row.status = 'confirmed' then raise exception 'match_already_confirmed'; end if;
  select t.sport into v_sport from public.tournaments t where t.id = match_row.tournament_id;
  allowed := case v_sport
    when 'football' then p_event_type in ('goal','assist','yellow_card','red_card','substitution','own_goal','unassigned_goal','shootout_score','penalty_miss')
    when 'futsal' then p_event_type in ('goal','assist','yellow_card','red_card','substitution','team_foul','own_goal','unassigned_goal','shootout_score','penalty_miss')
    when 'handball' then p_event_type in ('goal','assist','yellow_card','red_card','blue_card','two_minute_suspension','penalty_miss')
    when 'volleyball' then p_event_type in ('point','ace','attack_point','block','dig','recorded_error')
    when 'basketball' then p_event_type in ('one_point','two_point','three_point','rebound','assist','steal','block','foul')
    when 'basketball_3x3' then p_event_type in ('one_point','two_point','rebound','assist','steal','block','foul')
    else false end;
  if not allowed then raise exception 'unsupported_event_type'; end if;
  insert into public.match_events(match_id, team_id, player_id, event_type, event_minute, payload, recorded_by, idempotency_key)
    values (p_match_id, p_team_id, p_player_id, p_event_type, p_event_minute, coalesce(p_payload, '{}'::jsonb), p_actor_id, p_idempotency_key)
    on conflict (match_id, idempotency_key) do nothing returning id into event_id;
  if event_id is null then select e.id into event_id from public.match_events e where e.match_id = p_match_id and e.idempotency_key = p_idempotency_key; end if;
  return event_id;
end;
$$;
revoke execute on function public.record_match_event(uuid, uuid, uuid, text, integer, jsonb, uuid, uuid) from public, anon;
grant execute on function public.record_match_event(uuid, uuid, uuid, text, integer, jsonb, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Suspensions
-- ---------------------------------------------------------------------------
create table if not exists public.player_suspensions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete restrict,
  player_id uuid not null references public.player_profiles(id) on delete restrict,
  team_id uuid references public.teams(id) on delete restrict,
  source_match_id uuid references public.matches(id) on delete restrict,
  reason text not null check (reason in ('red_card', 'yellow_cards', 'manual')),
  matches_banned smallint not null default 1 check (matches_banned between 1 and 20),
  status text not null default 'active' check (status in ('active', 'served', 'overturned')),
  note text check (note is null or length(note) <= 500),
  created_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolved_at timestamptz,
  resolution_reason text check (resolution_reason is null or length(resolution_reason) <= 500)
);
create unique index if not exists player_suspensions_automatic_idx on public.player_suspensions(tournament_id, player_id, source_match_id, reason) where reason <> 'manual';
create index if not exists player_suspensions_tournament_idx on public.player_suspensions(tournament_id, status);
alter table public.player_suspensions enable row level security;
-- Discipline records are private to the tournament's operators.
drop policy if exists "tournament operators read suspensions" on public.player_suspensions;
create policy "tournament operators read suspensions" on public.player_suspensions for select using (public.is_tournament_operator(tournament_id));
revoke all on public.player_suspensions from anon;
grant select on public.player_suspensions to authenticated;

-- Recomputes automatic suspensions and marks served ones. Safe to call again:
-- existing rows are never duplicated, overturned rows are never revived.
create or replace function public.refresh_tournament_suspensions(p_tournament uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_limit integer := 3; v_raw text; v_before integer; v_after integer;
begin
  if not public.is_tournament_operator(p_tournament) then raise exception 'organizer_permission_required'; end if;
  select s.data->>'yellowCardLimit' into v_raw from public.tournament_setup_steps s where s.tournament_id = p_tournament and s.step_number = 7;
  if v_raw ~ '^[0-9]{1,2}$' and v_raw::integer between 1 and 20 then v_limit := v_raw::integer; end if;
  select count(*) into v_before from public.player_suspensions where tournament_id = p_tournament;

  insert into public.player_suspensions(tournament_id, player_id, team_id, source_match_id, reason, matches_banned, created_by)
  select distinct on (e.match_id, e.player_id) p_tournament, e.player_id, e.team_id, e.match_id, 'red_card', 1, auth.uid()
  from public.match_events e join public.matches m on m.id = e.match_id
  where m.tournament_id = p_tournament and m.status = 'confirmed' and e.event_type = 'red_card' and e.player_id is not null
  on conflict (tournament_id, player_id, source_match_id, reason) where reason <> 'manual' do nothing;

  insert into public.player_suspensions(tournament_id, player_id, team_id, source_match_id, reason, matches_banned, created_by)
  select p_tournament, y.player_id, y.team_id, y.match_id, 'yellow_cards', 1, auth.uid()
  from (
    select e.player_id, e.team_id, e.match_id,
      row_number() over (partition by e.player_id order by coalesce(m.scheduled_at, m.created_at), m.id, e.created_at) as n
    from public.match_events e join public.matches m on m.id = e.match_id
    where m.tournament_id = p_tournament and m.status = 'confirmed' and e.event_type = 'yellow_card' and e.player_id is not null
      and coalesce(e.payload->>'second_yellow', '') <> 'true'
  ) y
  where y.n % v_limit = 0
  on conflict (tournament_id, player_id, source_match_id, reason) where reason <> 'manual' do nothing;

  update public.player_suspensions s set status = 'served', resolved_at = now(), resolution_reason = 'Served'
  where s.tournament_id = p_tournament and s.status = 'active' and s.source_match_id is not null and s.team_id is not null
    and (select count(*) from public.matches later join public.matches src on src.id = s.source_match_id
         where later.tournament_id = p_tournament and later.status = 'confirmed' and later.id <> src.id
           and (later.home_team_id = s.team_id or later.away_team_id = s.team_id)
           and coalesce(later.scheduled_at, later.created_at) > coalesce(src.scheduled_at, src.created_at)) >= s.matches_banned;

  select count(*) into v_after from public.player_suspensions where tournament_id = p_tournament;
  if v_after > v_before then
    insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
    values (auth.uid(), 'suspensions_refreshed', 'tournament', p_tournament, format('%s new suspension(s) from confirmed cards', v_after - v_before));
  end if;
  return v_after - v_before;
end;
$$;
revoke execute on function public.refresh_tournament_suspensions(uuid) from public, anon;
grant execute on function public.refresh_tournament_suspensions(uuid) to authenticated, service_role;

create or replace function public.add_player_suspension(p_tournament uuid, p_player uuid, p_team uuid, p_matches integer, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_tournament_operator(p_tournament) then raise exception 'organizer_permission_required'; end if;
  if p_note is null or length(trim(p_note)) < 5 then raise exception 'reason_required'; end if;
  if p_matches is null or p_matches not between 1 and 20 then raise exception 'invalid_matches'; end if;
  insert into public.player_suspensions(tournament_id, player_id, team_id, reason, matches_banned, note, created_by)
  values (p_tournament, p_player, p_team, 'manual', p_matches, left(trim(p_note), 500), auth.uid()) returning id into v_id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (auth.uid(), 'suspension_added', 'player_suspension', v_id, left(trim(p_note), 500));
  return v_id;
end;
$$;
revoke execute on function public.add_player_suspension(uuid, uuid, uuid, integer, text) from public, anon;
grant execute on function public.add_player_suspension(uuid, uuid, uuid, integer, text) to authenticated, service_role;

create or replace function public.resolve_player_suspension(p_suspension uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.player_suspensions;
begin
  select * into v_row from public.player_suspensions where id = p_suspension for update;
  if v_row.id is null or not public.is_tournament_operator(v_row.tournament_id) then raise exception 'organizer_permission_required'; end if;
  if p_status not in ('served', 'overturned') then raise exception 'invalid_status'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  update public.player_suspensions set status = p_status, resolved_by = auth.uid(), resolved_at = now(), resolution_reason = left(trim(p_reason), 500) where id = p_suspension;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (auth.uid(), 'suspension_' || p_status, 'player_suspension', p_suspension, left(trim(p_reason), 500));
end;
$$;
revoke execute on function public.resolve_player_suspension(uuid, text, text) from public, anon;
grant execute on function public.resolve_player_suspension(uuid, text, text) to authenticated, service_role;
