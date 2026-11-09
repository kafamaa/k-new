-- Stage 4 competition engine foundation. Review-only; requires local/target Supabase validation before deployment.
create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  starts_on date,
  ends_on date,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table if not exists public.tournament_categories (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  age_group text,
  gender text,
  team_limit smallint check (team_limit is null or team_limit > 0),
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tournament_id, name)
);
create table if not exists public.competition_stages (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category_id uuid not null references public.tournament_categories(id) on delete cascade,
  name text not null,
  format text not null check (format in ('round_robin','group_stage','knockout','groups_knockout','two_leg')),
  stage_order smallint not null default 1,
  rules jsonb not null default '{}'::jsonb,
  fixture_version integer not null default 1,
  published_at timestamptz,
  unique (tournament_id, category_id, name)
);
alter table public.competition_stages add column if not exists draw_mode text not null default 'automatic';
alter table public.competition_stages drop constraint if exists competition_stages_draw_mode_check;
alter table public.competition_stages add constraint competition_stages_draw_mode_check check (draw_mode in ('automatic','manual'));
create table if not exists public.competition_fixture_versions (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.competition_stages(id) on delete cascade,
  version integer not null,
  draw_mode text not null check (draw_mode in ('automatic','manual')),
  fixture_payload jsonb not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (stage_id, version)
);
create table if not exists public.competition_groups (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.competition_stages(id) on delete cascade,
  name text not null,
  unique (stage_id, name)
);
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete restrict,
  stage_id uuid not null references public.competition_stages(id) on delete restrict,
  category_id uuid not null references public.tournament_categories(id) on delete restrict,
  group_id uuid references public.competition_groups(id) on delete restrict,
  home_team_id uuid references public.teams(id) on delete restrict,
  away_team_id uuid references public.teams(id) on delete restrict,
  leg smallint not null default 1 check (leg in (1,2)),
  scheduled_at timestamptz,
  venue text,
  status text not null default 'scheduled' check (status in ('scheduled','live','awaiting_confirmation','confirmed','postponed','abandoned','cancelled')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table if not exists public.match_official_assignments (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role in ('official','reviewer','staff')),
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id, role)
);
create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  team_id uuid references public.teams(id) on delete restrict,
  player_id uuid references public.player_profiles(id) on delete restrict,
  event_type text not null,
  event_minute integer check (event_minute is null or event_minute >= 0),
  payload jsonb not null default '{}'::jsonb,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (match_id, idempotency_key)
);
create table if not exists public.match_result_versions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  version integer not null,
  score jsonb not null,
  status text not null check (status in ('submitted','confirmed','rejected','conflict')),
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  confirmed_by uuid references public.profiles(id) on delete restrict,
  correction_reason text,
  created_at timestamptz not null default now(),
  unique (match_id, version)
);
create table if not exists public.standings_snapshots (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.competition_stages(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete restrict,
  played integer not null default 0,
  wins integer not null default 0,
  draws integer not null default 0,
  losses integer not null default 0,
  scored integer not null default 0,
  conceded integer not null default 0,
  points integer not null default 0,
  calculated_from_version integer not null,
  created_at timestamptz not null default now(),
  unique (stage_id, team_id, calculated_from_version)
);

create or replace function public.is_match_participant(p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.matches m join public.team_memberships tm on tm.team_id in (m.home_team_id, m.away_team_id) where m.id = p_match_id and tm.user_id = auth.uid())
  or exists (select 1 from public.match_official_assignments oa where oa.match_id = p_match_id and oa.user_id = auth.uid());
$$;
revoke execute on function public.is_match_participant(uuid) from public, anon;
grant execute on function public.is_match_participant(uuid) to authenticated, service_role;

alter table public.seasons enable row level security;
alter table public.tournament_categories enable row level security;
alter table public.competition_stages enable row level security;
alter table public.competition_fixture_versions enable row level security;
alter table public.competition_groups enable row level security;
alter table public.matches enable row level security;
alter table public.match_official_assignments enable row level security;
alter table public.match_events enable row level security;
alter table public.match_result_versions enable row level security;
alter table public.standings_snapshots enable row level security;

create policy "published matches are public" on public.matches for select using (status = 'confirmed' and exists (select 1 from public.tournaments t where t.id = tournament_id and t.is_published));
create policy "operators manage competition setup" on public.tournament_categories for all using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
create policy "operators manage stages" on public.competition_stages for all using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
create policy "operators manage fixture versions" on public.competition_fixture_versions for all using (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id))) with check (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id)));
create policy "operators append fixture audit" on public.audit_events for insert with check (
  actor_id = auth.uid() and (
    (entity_type = 'fixture_version' and exists (select 1 from public.competition_fixture_versions fv join public.competition_stages s on s.id = fv.stage_id where fv.id = entity_id and public.is_tournament_operator(s.tournament_id)))
    or (entity_type = 'competition_stage' and exists (select 1 from public.competition_stages s where s.id = entity_id and public.is_tournament_operator(s.tournament_id)))
  )
);
create policy "operators manage groups" on public.competition_groups for all using (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id))) with check (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id)));
create policy "operators manage matches" on public.matches for all using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
create policy "assigned officials read matches" on public.matches for select using (public.is_match_participant(id));
create policy "operators manage assignments" on public.match_official_assignments for all using (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id))) with check (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id)));
create policy "assigned officials manage events" on public.match_events for all using (public.is_match_participant(match_id)) with check (recorded_by = auth.uid() and public.is_match_participant(match_id));
create policy "participants read results" on public.match_result_versions for select using (public.is_match_participant(match_id));
create policy "officials submit results" on public.match_result_versions for insert with check (submitted_by = auth.uid() and public.is_match_participant(match_id));
create policy "operators confirm results" on public.match_result_versions for update using (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id))) with check (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id)));
create policy "published standings are public" on public.standings_snapshots for select using (exists (select 1 from public.competition_stages s join public.tournaments t on t.id = s.tournament_id where s.id = stage_id and t.is_published));
create policy "operators manage standings" on public.standings_snapshots for all using (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id))) with check (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id)));
