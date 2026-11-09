-- Stage 6 histories/statistics/milestones. Review-only; do not apply to production.
alter table public.tournaments add column if not exists season_id uuid references public.seasons(id) on delete set null;

create table if not exists public.match_player_participants (
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.player_profiles(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete restrict,
  starter boolean not null default false,
  minutes integer check (minutes is null or minutes >= 0),
  created_at timestamptz not null default now(),
  primary key (match_id, player_id)
);
create table if not exists public.sport_milestones (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references public.player_profiles(id) on delete restrict,
  team_id uuid references public.teams(id) on delete restrict,
  tournament_id uuid references public.tournaments(id) on delete restrict,
  season_id uuid references public.seasons(id) on delete restrict,
  milestone_type text not null,
  label text not null,
  state text not null default 'reached' check (state in ('upcoming','reached','delayed','not_applicable')),
  reached_at timestamptz,
  source_match_id uuid references public.matches(id) on delete set null,
  source_result_version_id uuid references public.match_result_versions(id) on delete set null,
  is_manual boolean not null default false,
  created_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((player_id is not null) or (team_id is not null))
);
alter table public.match_player_participants enable row level security;
alter table public.sport_milestones enable row level security;
create policy "participants read confirmed appearances" on public.match_player_participants for select using (
  exists (select 1 from public.match_result_versions rv where rv.match_id = match_id and rv.status = 'confirmed')
  and (public.is_match_participant(match_id) or (exists (select 1 from public.player_profiles p where p.id = player_id and p.is_published) and exists (select 1 from public.matches m join public.tournaments t on t.id = m.tournament_id where m.id = match_id and t.is_published)))
);
create policy "operators manage participants" on public.match_player_participants for all using (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id))) with check (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id)));
create policy "published milestones are public" on public.sport_milestones for select using (
  (player_id is not null and exists (select 1 from public.player_profiles p where p.id = player_id and p.is_published))
  or (team_id is not null and exists (select 1 from public.teams t where t.id = team_id and t.is_published))
);
create policy "operators manage milestones" on public.sport_milestones for all using (tournament_id is null or public.is_tournament_operator(tournament_id)) with check (created_by = auth.uid() and (tournament_id is null or public.is_tournament_operator(tournament_id)));

-- Public-safe, confirmed-only statistics contract. Private profiles are only visible to their account.
create or replace function public.get_player_official_statistics(p_player_id uuid, p_team_type text default null, p_tournament_id uuid default null, p_season_id uuid default null, p_sport text default null)
returns table(team_id uuid, team_type text, tournament_id uuid, season_id uuid, sport text, appearances bigint, starts bigint, minutes bigint, goals bigint, assists bigint, yellow_cards bigint, red_cards bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.player_profiles p where p.id = p_player_id and (p.is_published or p.account_id = auth.uid())) then raise exception 'player_not_public'; end if;
  return query
  with confirmed_matches as (select distinct match_id from public.match_result_versions where status = 'confirmed'), event_totals as (
    select ev.match_id, ev.player_id,
      count(*) filter (where ev.event_type in ('goal','point','one_point','two_point','three_point')) as goals,
      count(*) filter (where ev.event_type = 'assist') as assists,
      count(*) filter (where ev.event_type = 'yellow_card') as yellow_cards,
      count(*) filter (where ev.event_type in ('red_card','blue_card')) as red_cards
    from public.match_events ev group by ev.match_id, ev.player_id
  )
  select mp.team_id, t.team_type, m.tournament_id, tr.season_id, tr.sport,
    count(distinct mp.match_id), count(distinct mp.match_id) filter (where mp.starter), sum(mp.minutes),
    coalesce(sum(et.goals), 0), coalesce(sum(et.assists), 0), coalesce(sum(et.yellow_cards), 0), coalesce(sum(et.red_cards), 0)
  from public.match_player_participants mp
  join public.matches m on m.id = mp.match_id
  join public.tournaments tr on tr.id = m.tournament_id
  join public.teams t on t.id = mp.team_id
  join confirmed_matches cm on cm.match_id = m.id
  left join event_totals et on et.match_id = m.id and et.player_id = p_player_id
  where mp.player_id = p_player_id and tr.is_published and (p_team_type is null or t.team_type = p_team_type) and (p_tournament_id is null or m.tournament_id = p_tournament_id) and (p_season_id is null or tr.season_id = p_season_id) and (p_sport is null or tr.sport = p_sport)
  group by mp.team_id, t.team_type, m.tournament_id, tr.season_id, tr.sport;
end;
$$;
grant execute on function public.get_player_official_statistics(uuid, text, uuid, uuid, text) to anon, authenticated, service_role;
