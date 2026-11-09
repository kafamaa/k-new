-- Stage 2 additive migration. Review against the live schema before deployment.
-- Never store readable national IDs or claim tokens; only keyed digests belong here.

create table if not exists public.organization_team_links (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  linked_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (organization_id, team_id)
);

create table if not exists public.player_team_memberships (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete restrict,
  status text not null default 'active' check (status in ('active','ended','loaned')),
  effective_from date not null default current_date,
  effective_to date,
  source text not null default 'organizer' check (source in ('organizer','manager','import','claim')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists player_team_memberships_player_idx on public.player_team_memberships(player_id, effective_from desc);
create index if not exists player_team_memberships_team_idx on public.player_team_memberships(team_id, effective_from desc);

create table if not exists public.player_identity_keys (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null unique references public.player_profiles(id) on delete restrict,
  identifier_type text not null check (identifier_type in ('maldivian_national_id','foreign_document')),
  issuing_country text,
  keyed_digest bytea not null unique,
  linked_account_id uuid unique references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((identifier_type = 'maldivian_national_id' and issuing_country is null) or (identifier_type = 'foreign_document' and issuing_country is not null))
);

create table if not exists public.claim_invitations (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles(id) on delete restrict,
  invited_email text,
  token_digest bytea not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  confirmation_method text check (confirmation_method in ('verified_email','organizer_review')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index if not exists claim_invitations_player_idx on public.claim_invitations(player_id, expires_at desc);

alter table public.organization_team_links enable row level security;
alter table public.player_team_memberships enable row level security;
alter table public.player_identity_keys enable row level security;
alter table public.claim_invitations enable row level security;

-- Public pages may show only a roster row where both linked records are published.
create policy "users create organizations" on public.organizations for insert with check (created_by = auth.uid());
create policy "organization creator assigns self owner" on public.organization_memberships for insert with check (
  user_id = auth.uid() and role = 'owner' and exists (select 1 from public.organizations o where o.id = organization_id and o.created_by = auth.uid())
);
create policy "record creators read their unclaimed players" on public.player_profiles for select using (created_by = auth.uid());
create policy "published player team history is public" on public.player_team_memberships for select using (
  exists (select 1 from public.player_profiles p where p.id = player_id and p.is_published)
  and exists (select 1 from public.teams t where t.id = team_id and t.is_published)
);
create policy "team managers read their player history" on public.player_team_memberships for select using (
  exists (select 1 from public.team_memberships tm where tm.team_id = team_id and tm.user_id = auth.uid())
);

-- A creator may link a team only through an organization they manage.
create policy "organization operators read team links" on public.organization_team_links for select using (
  exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid())
);
create policy "organization operators create team links" on public.organization_team_links for insert with check (
  linked_by = auth.uid() and exists (
    select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','operations')
  )
);

-- Identity keys and invitations are never public. Claim reads/writes occur in the trusted Edge Function.
create policy "no client access to identity keys" on public.player_identity_keys for all using (false) with check (false);
create policy "invitation creator reads invitation metadata" on public.claim_invitations for select using (created_by = auth.uid());
-- Invitation insertion is intentionally reserved for the trusted invite-player Edge Function.

-- Organizer-created records are unclaimed and cannot grant the creator control of an account.
create policy "authorized users create unclaimed players" on public.player_profiles for insert with check (
  created_by = auth.uid() and account_id is null and is_claimed = false
);
create policy "authorized users create teams" on public.teams for insert with check (created_by = auth.uid());
create policy "team creator assigns self as manager" on public.team_memberships for insert with check (
  user_id = auth.uid() and role = 'manager' and exists (select 1 from public.teams t where t.id = team_id and t.created_by = auth.uid())
);
create policy "authorized users create player history" on public.player_team_memberships for insert with check (
  created_by = auth.uid() and (
    exists (select 1 from public.teams t where t.id = team_id and t.created_by = auth.uid())
    or exists (select 1 from public.team_memberships tm where tm.team_id = team_id and tm.user_id = auth.uid())
  )
);

-- Claiming is one transaction: the row lock and unique account link prevent two
-- verified accounts from claiming the same profile or one account claiming two profiles.
create or replace function public.claim_player_profile(p_invitation_id uuid, p_player_id uuid, p_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.claim_invitations;
  player public.player_profiles;
begin
  select * into invitation from public.claim_invitations where id = p_invitation_id for update;
  if invitation.id is null or invitation.player_id <> p_player_id or invitation.revoked_at is not null or invitation.accepted_at is not null or invitation.expires_at <= now() then
    raise exception 'invalid_or_expired_invitation';
  end if;
  select * into player from public.player_profiles where id = p_player_id for update;
  if player.id is null or player.account_id is not null or player.is_claimed then
    raise exception 'profile_already_claimed';
  end if;
  update public.player_profiles set account_id = p_account_id, is_claimed = true where id = p_player_id and account_id is null and is_claimed = false;
  if not found then raise exception 'profile_claim_conflict'; end if;
  update public.claim_invitations set accepted_at = now(), confirmation_method = 'verified_email' where id = p_invitation_id and accepted_at is null and revoked_at is null;
  if not found then raise exception 'invitation_claim_conflict'; end if;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (p_account_id, 'player_profile_claimed', 'player_profile', p_player_id, 'Verified invitation claim');
  return p_player_id;
end;
$$;
revoke execute on function public.claim_player_profile(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_player_profile(uuid, uuid, uuid) to service_role;
