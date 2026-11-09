-- Onboarding additions. Review-only; do not apply or push without explicit authorization.
-- Existing team/organization creation policies are sufficient. This adds the missing
-- legitimate personal-profile insert/update path and invitation persistence.
-- The first policy may already exist from a reviewed/manual local application.
-- Replace only the policy definition; preserve its verified check exactly and
-- prevent anonymous inserts/updates.
drop policy if exists "users create own claimed player profile" on public.player_profiles;
create policy "users create own claimed player profile" on public.player_profiles for insert to authenticated with check (
  created_by = auth.uid() and account_id = auth.uid() and is_claimed = true
);
drop policy if exists "players update own profile fields" on public.player_profiles;
create policy "players update own profile fields" on public.player_profiles for update to authenticated using (account_id = auth.uid()) with check (account_id = auth.uid());

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_type text not null check (workspace_type in ('team','organization')),
  team_id uuid references public.teams(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  invited_email text,
  token_digest bytea not null unique,
  role text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((workspace_type = 'team' and team_id is not null and organization_id is null) or (workspace_type = 'organization' and organization_id is not null and team_id is null)),
  check (expires_at > created_at)
);
alter table public.workspace_invitations enable row level security;
drop policy if exists "invitation creators read workspace invitations" on public.workspace_invitations;
create policy "invitation creators read workspace invitations" on public.workspace_invitations for select to authenticated using (created_by = auth.uid());
-- Token creation and acceptance must use a trusted Edge Function; raw tokens are never stored.
