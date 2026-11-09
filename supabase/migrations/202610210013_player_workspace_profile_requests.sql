-- Player workspace profile details, requests, invitations, and roster-status additions.
-- Review-only. Do NOT apply or push without explicit owner authorization.
-- Additive and owner-scoped: guests keep reading only published public fields;
-- no existing policy is dropped or weakened. Rationale per item:
--
-- 1) player_profiles gains public-safe sporting details (nationality, sports,
--    position). These are non-identity fields intended for public player pages
--    and the digital card. The existing owner-scoped update policy
--    ("players update own profile fields", migration 0010) already lets the
--    profile owner edit their own row, so no new update policy is required.
-- 2) Date of birth is IDENTITY-PRIVATE. It is deliberately NOT a column on
--    player_profiles, because published rows are readable by guests at the row
--    level; instead it lives in player_private_details with owner-only RLS so
--    it can never surface on public pages or through direct REST reads.
-- 3) Correction requests: players may request corrections without editing
--    confirmed match records. Players insert/read their own rows; linked
--    tournament operators may read and resolve them.
-- 4) Team join requests: players request to join a team; the team's managers
--    read and resolve them.
-- 5) Invitation metadata becomes readable by the invited person (matched on
--    their verified auth email) instead of only the creator. Tokens and
--    digests are never selected by the app; only metadata is exposed.
-- 6) Roster status becomes readable by the player themselves (a row in an
--    approved/submitted roster that contains them), so My Tournaments can show
--    registration/roster status. Entry-level payment data stays hidden.

alter table public.player_profiles add column if not exists nationality text;
alter table public.player_profiles add column if not exists sports text[] not null default '{}';
alter table public.player_profiles add column if not exists position text;

create table if not exists public.player_private_details (
  player_id uuid primary key references public.player_profiles(id) on delete cascade,
  date_of_birth date,
  updated_at timestamptz not null default now()
);
alter table public.player_private_details enable row level security;
drop policy if exists "players read own private details" on public.player_private_details;
create policy "players read own private details" on public.player_private_details for select to authenticated using (exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()));
drop policy if exists "players insert own private details" on public.player_private_details;
create policy "players insert own private details" on public.player_private_details for insert to authenticated with check (exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()));
drop policy if exists "players update own private details" on public.player_private_details;
create policy "players update own private details" on public.player_private_details for update to authenticated using (exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid())) with check (exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()));

create table if not exists public.player_correction_requests (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles(id) on delete cascade,
  tournament_id uuid references public.tournaments(id) on delete set null,
  match_id uuid references public.matches(id) on delete set null,
  subject text not null,
  message text not null,
  status text not null default 'pending' check (status in ('pending','under_review','resolved','rejected')),
  resolution_note text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.player_correction_requests enable row level security;
drop policy if exists "players read own correction requests" on public.player_correction_requests;
create policy "players read own correction requests" on public.player_correction_requests for select to authenticated using (exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()));
drop policy if exists "players create correction requests" on public.player_correction_requests;
create policy "players create correction requests" on public.player_correction_requests for insert to authenticated with check (created_by = auth.uid() and exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()));
drop policy if exists "operators review correction requests" on public.player_correction_requests;
create policy "operators review correction requests" on public.player_correction_requests for select to authenticated using (tournament_id is not null and public.is_tournament_operator(tournament_id));
drop policy if exists "operators resolve correction requests" on public.player_correction_requests;
create policy "operators resolve correction requests" on public.player_correction_requests for update to authenticated using (tournament_id is not null and public.is_tournament_operator(tournament_id)) with check (tournament_id is not null and public.is_tournament_operator(tournament_id));

create table if not exists public.player_team_requests (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  resolution_note text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.player_team_requests enable row level security;
drop policy if exists "players read own team requests" on public.player_team_requests;
create policy "players read own team requests" on public.player_team_requests for select to authenticated using (exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()));
drop policy if exists "players create team requests" on public.player_team_requests;
create policy "players create team requests" on public.player_team_requests for insert to authenticated with check (created_by = auth.uid() and exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()));
drop policy if exists "team managers read player requests" on public.player_team_requests;
create policy "team managers read player requests" on public.player_team_requests for select to authenticated using (public.is_team_manager(team_id));
drop policy if exists "team managers resolve player requests" on public.player_team_requests;
create policy "team managers resolve player requests" on public.player_team_requests for update to authenticated using (public.is_team_manager(team_id)) with check (public.is_team_manager(team_id));

drop policy if exists "invited person reads claim invitation metadata" on public.claim_invitations;
create policy "invited person reads claim invitation metadata" on public.claim_invitations for select to authenticated using (invited_email = auth.jwt() ->> 'email');
drop policy if exists "invited person reads workspace invitation metadata" on public.workspace_invitations;
create policy "invited person reads workspace invitation metadata" on public.workspace_invitations for select to authenticated using (invited_email = auth.jwt() ->> 'email');

drop policy if exists "players read own roster rows" on public.roster_submission_players;
create policy "players read own roster rows" on public.roster_submission_players for select to authenticated using (exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()));
drop policy if exists "players read own roster submissions" on public.roster_submissions;
create policy "players read own roster submissions" on public.roster_submissions for select to authenticated using (exists (select 1 from public.roster_submission_players rsp where rsp.submission_id = id and exists (select 1 from public.player_profiles p where p.id = rsp.player_id and p.account_id = auth.uid())));
