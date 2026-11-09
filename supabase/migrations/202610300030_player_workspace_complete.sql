-- Player workspace completion (review-only; the owner applies it).
--
-- 1) get_player_workspace_matches: the player's own fixtures and results.
--    Existing policies only expose a match to a player after its result is
--    confirmed, so upcoming fixtures, live and postponed matches were invisible
--    in the workspace. This owner-only function returns the matches of the
--    teams the player belonged to on the match date, plus matches they took part
--    in. Scores and personal numbers come only from the latest confirmed result
--    version, so a corrected result replaces the old one and is never counted
--    twice.
-- 2) Requests: correction requests gain a type, an optional team, the statuses
--    "changes requested" and "cancelled", and a reviewer for every type:
--    tournament operators (tournament set), team managers (team set) and
--    platform admins (everything else, e.g. impersonation or account support).
--    Players can cancel or resubmit their own requests and withdraw team join
--    requests through two owner-checked functions. A trigger stops players
--    from inserting a request that is already resolved.
-- 3) notification_preferences: per-user muted categories and email opt-in.
-- 4) player_private_details.hidden_bio: hiding the biography moves it into the
--    owner-only table, so it truly leaves the public row (the photo is hidden by
--    clearing photo_url while photo_path keeps the file).

-- 1 -------------------------------------------------------------------------
create or replace function public.get_player_workspace_matches(p_player_id uuid)
returns table(
  match_id uuid, tournament_id uuid, tournament_name text, tournament_slug text, sport text,
  scheduled_at timestamptz, venue text, status text, team_id uuid,
  home_team_id uuid, home_team_name text, home_team_logo text,
  away_team_id uuid, away_team_name text, away_team_logo text,
  home_score numeric, away_score numeric, result_confirmed boolean, participated boolean,
  starter boolean, minutes integer, goals bigint, assists bigint, yellow_cards bigint, red_cards bigint
)
-- Body between the column list and "order by" was lost in a file-editing
-- accident on 3 Nov 2026 and rebuilt from the surviving query, the header
-- comment above and migration 031's team feed. Compare with the live
-- definition (pg_get_functiondef) before re-applying this migration anywhere.
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.player_profiles p where p.id = p_player_id and p.account_id = auth.uid()) then
    raise exception 'not_profile_owner';
  end if;
  return query
  with scoped as (
    -- One row per match: the team the player actually played for wins;
    -- otherwise the team they were a dated member of on the match date.
    select distinct on (x.match_id) x.match_id, x.team_id
    from (
      select mp.match_id, mp.team_id, 0 as priority
      from public.match_player_participants mp
      where mp.player_id = p_player_id
      union all
      select m.id, ptm.team_id, 1
      from public.player_team_memberships ptm
      join public.matches m on ptm.team_id in (m.home_team_id, m.away_team_id)
      where ptm.player_id = p_player_id
        and ptm.effective_from <= coalesce((m.scheduled_at at time zone 'Indian/Maldives')::date, current_date)
        and (ptm.effective_to is null or ptm.effective_to >= coalesce((m.scheduled_at at time zone 'Indian/Maldives')::date, current_date))
    ) x
    order by x.match_id, x.priority
  ), latest as (
    select distinct on (v.match_id) v.match_id, v.score
    from public.match_result_versions v join scoped s on s.match_id = v.match_id
    where v.status = 'confirmed'
    order by v.match_id, v.version desc
  ), events as (
    select e.match_id,
      count(*) filter (where e.event_type in ('goal','point','one_point','two_point','three_point')) as goals,
      count(*) filter (where e.event_type = 'assist') as assists,
      count(*) filter (where e.event_type = 'yellow_card') as yellow_cards,
      count(*) filter (where e.event_type in ('red_card','blue_card')) as red_cards
    from public.match_events e join latest l on l.match_id = e.match_id
    where e.player_id = p_player_id
    group by e.match_id
  )
  select m.id, m.tournament_id, tr.name, tr.slug, tr.sport,
    m.scheduled_at, m.venue, m.status, s.team_id,
    m.home_team_id, ht.name, ht.logo_url, m.away_team_id, awt.name, awt.logo_url,
    case when m.status = 'confirmed' and jsonb_typeof(l.score->'home') = 'number' then (l.score->>'home')::numeric end,
    case when m.status = 'confirmed' and jsonb_typeof(l.score->'away') = 'number' then (l.score->>'away')::numeric end,
    (m.status = 'confirmed' and l.match_id is not null),
    (m.status = 'confirmed' and l.match_id is not null and mp.match_id is not null),
    case when m.status = 'confirmed' and l.match_id is not null then mp.starter end,
    case when m.status = 'confirmed' and l.match_id is not null then mp.minutes end,
    case when m.status = 'confirmed' then coalesce(ev.goals, 0) else 0 end::bigint,
    case when m.status = 'confirmed' then coalesce(ev.assists, 0) else 0 end::bigint,
    case when m.status = 'confirmed' then coalesce(ev.yellow_cards, 0) else 0 end::bigint,
    case when m.status = 'confirmed' then coalesce(ev.red_cards, 0) else 0 end::bigint
  from scoped s
  join public.matches m on m.id = s.match_id
  join public.tournaments tr on tr.id = m.tournament_id
  left join public.teams ht on ht.id = m.home_team_id
  left join public.teams awt on awt.id = m.away_team_id
  left join latest l on l.match_id = m.id
  left join public.match_player_participants mp on mp.match_id = m.id and mp.player_id = p_player_id
  left join events ev on ev.match_id = m.id
  order by m.scheduled_at desc nulls last;
end;
$$;
revoke execute on function public.get_player_workspace_matches(uuid) from public, anon;
grant execute on function public.get_player_workspace_matches(uuid) to authenticated, service_role;

-- 2 -------------------------------------------------------------------------
alter table public.player_correction_requests
  add column if not exists request_type text not null default 'profile',
  add column if not exists team_id uuid references public.teams(id) on delete set null,
  add column if not exists updated_at timestamptz;
alter table public.player_correction_requests drop constraint if exists player_correction_requests_request_type_check;
alter table public.player_correction_requests add constraint player_correction_requests_request_type_check
  check (request_type in ('profile', 'statistics', 'team_history', 'document', 'verification', 'impersonation', 'team_contact', 'organizer_contact', 'account_support'));
alter table public.player_correction_requests drop constraint if exists player_correction_requests_status_check;
alter table public.player_correction_requests add constraint player_correction_requests_status_check
  check (status in ('pending', 'under_review', 'changes_requested', 'resolved', 'rejected', 'cancelled'));
create index if not exists player_correction_requests_team_idx on public.player_correction_requests(team_id) where team_id is not null;

create or replace function public.protect_correction_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.resolution_note := null;
    new.resolved_at := null;
  else
    new.updated_at := now();
    if new.status in ('resolved', 'rejected', 'cancelled') and old.status is distinct from new.status then new.resolved_at := now(); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_correction_request on public.player_correction_requests;
create trigger protect_correction_request before insert or update on public.player_correction_requests
  for each row execute function public.protect_correction_request();

drop policy if exists "team managers review correction requests" on public.player_correction_requests;
create policy "team managers review correction requests" on public.player_correction_requests for select to authenticated
  using (team_id is not null and public.is_team_manager(team_id));
drop policy if exists "team managers resolve correction requests" on public.player_correction_requests;
create policy "team managers resolve correction requests" on public.player_correction_requests for update to authenticated
  using (team_id is not null and public.is_team_manager(team_id)) with check (team_id is not null and public.is_team_manager(team_id));
drop policy if exists "platform admins review correction requests" on public.player_correction_requests;
create policy "platform admins review correction requests" on public.player_correction_requests for select to authenticated
  using (public.is_platform_admin());
drop policy if exists "platform admins resolve correction requests" on public.player_correction_requests;
create policy "platform admins resolve correction requests" on public.player_correction_requests for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Owner actions. Reviewers keep using their update policies above.
create or replace function public.cancel_player_request(p_kind text, p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'correction' then
    update public.player_correction_requests r set status = 'cancelled'
    where r.id = p_request_id and r.status in ('pending', 'changes_requested')
      and exists (select 1 from public.player_profiles p where p.id = r.player_id and p.account_id = auth.uid());
  elsif p_kind = 'team' then
    update public.player_team_requests r set status = 'withdrawn', resolved_at = now()
    where r.id = p_request_id and r.status = 'pending'
      and exists (select 1 from public.player_profiles p where p.id = r.player_id and p.account_id = auth.uid());
  else
    raise exception 'unknown_request_kind';
  end if;
  if not found then raise exception 'request_not_cancellable'; end if;
end;
$$;
revoke execute on function public.cancel_player_request(text, uuid) from public, anon;
grant execute on function public.cancel_player_request(text, uuid) to authenticated, service_role;

create or replace function public.resubmit_correction_request(p_request_id uuid, p_message text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(btrim(p_message), '') = '' then raise exception 'message_required'; end if;
  update public.player_correction_requests r set status = 'pending', message = btrim(p_message)
  where r.id = p_request_id and r.status = 'changes_requested'
    and exists (select 1 from public.player_profiles p where p.id = r.player_id and p.account_id = auth.uid());
  if not found then raise exception 'request_not_resubmittable'; end if;
end;
$$;
revoke execute on function public.resubmit_correction_request(uuid, text) from public, anon;
grant execute on function public.resubmit_correction_request(uuid, text) to authenticated, service_role;

-- 3 -------------------------------------------------------------------------
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  muted_categories text[] not null default '{}',
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
drop policy if exists "users read own notification preferences" on public.notification_preferences;
create policy "users read own notification preferences" on public.notification_preferences for select to authenticated using (user_id = auth.uid());
drop policy if exists "users create own notification preferences" on public.notification_preferences;
create policy "users create own notification preferences" on public.notification_preferences for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "users update own notification preferences" on public.notification_preferences;
create policy "users update own notification preferences" on public.notification_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 4 -------------------------------------------------------------------------
alter table public.player_private_details add column if not exists hidden_bio text;
alter table public.player_private_details drop constraint if exists player_private_details_hidden_bio_length;
alter table public.player_private_details add constraint player_private_details_hidden_bio_length check (hidden_bio is null or char_length(hidden_bio) <= 400);
