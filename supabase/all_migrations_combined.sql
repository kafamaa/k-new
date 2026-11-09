
-- ===== 202610210001_foundation.sql =====
-- Reviewed, additive foundation migration. Do not apply to production without explicit authorization.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null default '',
  avatar_url text,
  phone text,
  locale text not null default 'en',
  timezone text not null default 'Indian/Maldives',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles are readable by owner" on public.profiles for select using (auth.uid() = id);
create policy "users create own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "users update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  description text, is_published boolean not null default false, created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role in ('owner','staff','finance','operations','media')),
  created_at timestamptz not null default now(), primary key (organization_id, user_id)
);
alter table public.organizations enable row level security; alter table public.organization_memberships enable row level security;
create policy "published organizations are public" on public.organizations for select using (is_published or exists (select 1 from public.organization_memberships m where m.organization_id = id and m.user_id = auth.uid()));
create policy "members read memberships" on public.organization_memberships for select using (user_id = auth.uid());

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  team_type text not null default 'club' check (team_type in ('club','island','national','school','other')),
  island text, description text, logo_url text, is_published boolean not null default false,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), deactivated_at timestamptz
);
create table if not exists public.team_memberships (
  team_id uuid not null references public.teams(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role in ('manager','staff')), created_at timestamptz not null default now(), primary key (team_id, user_id)
);
alter table public.teams enable row level security; alter table public.team_memberships enable row level security;
create policy "published teams are public" on public.teams for select using (is_published or exists (select 1 from public.team_memberships m where m.team_id = id and m.user_id = auth.uid()));
create policy "team members read memberships" on public.team_memberships for select using (user_id = auth.uid());

create table if not exists public.player_profiles (
  id uuid primary key default gen_random_uuid(), display_name text not null, slug text not null unique, island text,
  photo_url text, is_claimed boolean not null default false, is_published boolean not null default false,
  account_id uuid unique references public.profiles(id) on delete set null, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), deactivated_at timestamptz
);
alter table public.player_profiles enable row level security;
create policy "published players are public" on public.player_profiles for select using (is_published or account_id = auth.uid());

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id), action text not null,
  entity_type text not null, entity_id uuid not null, reason text, created_at timestamptz not null default now()
);
alter table public.audit_events enable row level security;
create policy "users read own audit events" on public.audit_events for select using (actor_id = auth.uid());


-- ===== 202610210002_persistent_records.sql =====
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


-- ===== 202610210003_tournament_drafts.sql =====
-- Stage 3 first slice: private, resumable tournament drafts.
-- Additive and review-only; do not apply to production without authorization.
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  slug text not null unique,
  sport text not null check (sport in ('football','futsal','handball','volleyball','basketball','basketball_3x3')),
  status text not null default 'draft' check (status in ('draft','setup','registration_open','registration_closed','in_progress','completed','archived','cancelled')),
  setup_stage smallint not null default 1 check (setup_stage between 1 and 11),
  is_published boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tournaments_organization_idx on public.tournaments(organization_id, updated_at desc);
alter table public.tournaments enable row level security;
create policy "published tournaments are public" on public.tournaments for select using (is_published and status <> 'draft');
create policy "organization operators read tournaments" on public.tournaments for select using (
  exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid())
);
create policy "organization operators create tournaments" on public.tournaments for insert with check (
  created_by = auth.uid() and exists (
    select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','operations')
  )
);
create policy "organization operators update tournaments" on public.tournaments for update using (
  exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','operations'))
);


-- ===== 202610210004_tournament_registration.sql =====
-- Stage 3 registration slice. Additive and review-only; do not apply to production without authorization.
create or replace function public.is_tournament_operator(p_tournament_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournaments t
    join public.organization_memberships om on om.organization_id = t.organization_id
    where t.id = p_tournament_id and om.user_id = auth.uid() and om.role in ('owner','operations')
  );
$$;
create or replace function public.is_team_manager(p_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_memberships where team_id = p_team_id and user_id = auth.uid());
$$;
revoke execute on function public.is_tournament_operator(uuid) from public, anon;
revoke execute on function public.is_team_manager(uuid) from public, anon;
grant execute on function public.is_tournament_operator(uuid) to authenticated, service_role;
grant execute on function public.is_team_manager(uuid) to authenticated, service_role;

create table if not exists public.tournament_setup_steps (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  step_number smallint not null check (step_number between 1 and 11),
  status text not null default 'not_started' check (status in ('not_started','in_progress','complete','blocked')),
  data jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (tournament_id, step_number)
);

create table if not exists public.tournament_registration_settings (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  opens_at timestamptz,
  closes_at timestamptz,
  application_method text not null default 'team_application' check (application_method in ('team_application','invite_only','both')),
  entry_requirements text,
  contact_instructions text,
  roster_min smallint check (roster_min is null or roster_min >= 0),
  roster_max smallint check (roster_max is null or roster_max >= coalesce(roster_min, 0)),
  roster_deadline timestamptz,
  documents_required boolean not null default false,
  change_rules text,
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table if not exists public.tournament_registration_questions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  field_key text not null,
  prompt text not null,
  response_type text not null default 'text' check (response_type in ('text','long_text','number','boolean','select')),
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  sort_order smallint not null default 0,
  unique (tournament_id, field_key)
);

create table if not exists public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete restrict,
  application_status text not null default 'draft' check (application_status in ('draft','submitted','under_review','changes_requested','approved','rejected','withdrawn')),
  roster_status text not null default 'not_started' check (roster_status in ('not_started','draft','submitted','under_review','changes_requested','approved','locked','rejected')),
  payment_status text not null default 'not_required' check (payment_status in ('not_required','unpaid','proof_submitted','under_review','paid','waived','refunded','overdue')),
  submitted_by uuid references public.profiles(id) on delete restrict,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, team_id)
);

create table if not exists public.tournament_registration_answers (
  entry_id uuid not null references public.tournament_entries(id) on delete cascade,
  question_id uuid not null references public.tournament_registration_questions(id) on delete cascade,
  answer jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (entry_id, question_id)
);

create table if not exists public.roster_submissions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.tournament_entries(id) on delete cascade,
  version integer not null,
  status text not null default 'draft' check (status in ('draft','submitted','under_review','changes_requested','approved','locked','rejected')),
  submitted_by uuid references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  review_notes text,
  created_at timestamptz not null default now(),
  unique (entry_id, version)
);

create table if not exists public.roster_submission_players (
  submission_id uuid not null references public.roster_submissions(id) on delete cascade,
  player_id uuid not null references public.player_profiles(id) on delete restrict,
  shirt_number text,
  position text,
  primary key (submission_id, player_id)
);

create table if not exists public.tournament_fees (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  label text not null,
  amount_mvr numeric(12,2) not null check (amount_mvr >= 0),
  due_at timestamptz,
  required boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict
);
create table if not exists public.tournament_payments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.tournament_entries(id) on delete cascade,
  fee_id uuid not null references public.tournament_fees(id) on delete restrict,
  amount_mvr numeric(12,2) not null check (amount_mvr >= 0),
  status text not null default 'proof_submitted' check (status in ('proof_submitted','under_review','paid','waived','refunded','rejected')),
  proof_document_id uuid,
  verified_by uuid references public.profiles(id) on delete restrict,
  verified_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.private_documents (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete restrict,
  entry_id uuid references public.tournament_entries(id) on delete restrict,
  player_id uuid references public.player_profiles(id) on delete restrict,
  document_type text not null,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  retention_until timestamptz,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (entry_id is not null or player_id is not null)
);

alter table public.tournament_setup_steps enable row level security;
alter table public.tournament_registration_settings enable row level security;
alter table public.tournament_registration_questions enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_registration_answers enable row level security;
alter table public.roster_submissions enable row level security;
alter table public.roster_submission_players enable row level security;
alter table public.tournament_fees enable row level security;
alter table public.tournament_payments enable row level security;
alter table public.private_documents enable row level security;

create policy "operators manage setup steps" on public.tournament_setup_steps for all using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
create policy "operators manage registration settings" on public.tournament_registration_settings for all using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
create policy "published registration questions are public" on public.tournament_registration_questions for select using (exists (select 1 from public.tournaments t where t.id = tournament_id and t.is_published));
create policy "operators manage registration questions" on public.tournament_registration_questions for all using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));

create policy "operators read entries" on public.tournament_entries for select using (public.is_tournament_operator(tournament_id));
create policy "team managers read own entries" on public.tournament_entries for select using (public.is_team_manager(team_id));
create policy "team managers submit applications" on public.tournament_entries for insert with check (
  public.is_team_manager(team_id) and exists (
    select 1 from public.tournaments t left join public.tournament_registration_settings rs on rs.tournament_id = t.id
    where t.id = tournament_id and t.status = 'registration_open' and coalesce(rs.application_method, 'team_application') in ('team_application','both')
  )
);
create policy "operators add tournament entries" on public.tournament_entries for insert with check (public.is_tournament_operator(tournament_id));
create policy "team managers update own applications" on public.tournament_entries for update using (public.is_team_manager(team_id)) with check (public.is_team_manager(team_id));
create policy "operators review entries" on public.tournament_entries for update using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));

create or replace function public.protect_entry_statuses()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_tournament_operator(old.tournament_id) and new.application_status is distinct from old.application_status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  if not public.is_tournament_operator(old.tournament_id) then
    if new.tournament_id <> old.tournament_id or new.team_id <> old.team_id then raise exception 'team_manager_cannot_move_entry_scope'; end if;
    if new.roster_status <> old.roster_status or new.payment_status <> old.payment_status or new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at or new.review_notes is distinct from old.review_notes then
      raise exception 'team_manager_cannot_change_roster_payment_or_review_status';
    end if;
    if new.application_status not in ('draft','submitted','changes_requested') then raise exception 'team_manager_cannot_approve_application'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_entry_statuses_trigger on public.tournament_entries;
create trigger protect_entry_statuses_trigger before update on public.tournament_entries for each row execute function public.protect_entry_statuses();

create policy "entry participants read answers" on public.tournament_registration_answers for select using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));
create policy "entry participants write answers" on public.tournament_registration_answers for all using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id)))) with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));

create policy "participants read rosters" on public.roster_submissions for select using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));
create policy "participants write rosters" on public.roster_submissions for all using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id)))) with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));
create policy "participants read roster players" on public.roster_submission_players for select using (exists (select 1 from public.roster_submissions r where r.id = submission_id));
create policy "participants write roster players" on public.roster_submission_players for all using (exists (select 1 from public.roster_submissions r where r.id = submission_id)) with check (exists (select 1 from public.roster_submissions r where r.id = submission_id));

create policy "operators manage fees" on public.tournament_fees for all using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
create policy "operators manage payments" on public.tournament_payments for all using (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_tournament_operator(e.tournament_id))) with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_tournament_operator(e.tournament_id)));
create policy "team managers read payments" on public.tournament_payments for select using (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_team_manager(e.team_id)));
create policy "private documents are scoped" on public.private_documents for all using (public.is_tournament_operator(tournament_id) or exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_team_manager(e.team_id))) with check (uploaded_by = auth.uid() and (public.is_tournament_operator(tournament_id) or exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_team_manager(e.team_id))));

insert into storage.buckets (id, name, public) values ('tournament-private-documents', 'tournament-private-documents', false) on conflict (id) do nothing;
create policy "authorized users upload tournament documents" on storage.objects for insert with check (
  bucket_id = 'tournament-private-documents' and (
    public.is_tournament_operator((storage.foldername(name))[1]::uuid)
    or exists (select 1 from public.tournament_entries e where e.id = (storage.foldername(name))[2]::uuid and public.is_team_manager(e.team_id))
  )
);
create policy "authorized users read tournament documents" on storage.objects for select using (
  bucket_id = 'tournament-private-documents' and (
    public.is_tournament_operator((storage.foldername(name))[1]::uuid)
    or exists (select 1 from public.tournament_entries e where e.id = (storage.foldername(name))[2]::uuid and public.is_team_manager(e.team_id))
  )
);

create or replace function public.submit_roster(p_entry_id uuid, p_player_ids uuid[], p_actor_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  entry public.tournament_entries;
  next_version integer;
  roster_id uuid;
  player_id uuid;
begin
  if p_actor_id <> auth.uid() then raise exception 'actor_mismatch'; end if;
  select * into entry from public.tournament_entries where id = p_entry_id for update;
  if entry.id is null or not (public.is_tournament_operator(entry.tournament_id) or public.is_team_manager(entry.team_id)) or entry.roster_status = 'locked' then
    raise exception 'roster_not_authorized_or_locked';
  end if;
  select coalesce(max(version), 0) + 1 into next_version from public.roster_submissions where entry_id = p_entry_id;
  insert into public.roster_submissions(entry_id, version, status, submitted_by) values (p_entry_id, next_version, 'submitted', p_actor_id) returning id into roster_id;
  foreach player_id in array p_player_ids loop
    insert into public.roster_submission_players(submission_id, player_id) values (roster_id, player_id);
  end loop;
  update public.tournament_entries set roster_status = 'submitted', updated_at = now() where id = p_entry_id;
  return roster_id;
end;
$$;
revoke execute on function public.submit_roster(uuid, uuid[], uuid) from public, anon;
grant execute on function public.submit_roster(uuid, uuid[], uuid) to authenticated, service_role;


-- ===== 202610210005_competition_engine.sql =====
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


-- ===== 202610210006_match_operations.sql =====
-- Stage 5 match operations. Review-only; do not apply without local/target validation.
create table if not exists public.offline_sync_operations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  operation_id uuid not null unique,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  operation_type text not null check (operation_type in ('event','score_submission','status_change')),
  payload jsonb not null,
  base_result_version integer,
  status text not null default 'queued' check (status in ('queued','synced','conflict','rejected')),
  conflict_reason text,
  resolved_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  synced_at timestamptz
);
create index if not exists offline_sync_operations_match_idx on public.offline_sync_operations(match_id, created_at);
alter table public.offline_sync_operations enable row level security;
create policy "assigned actors manage sync operations" on public.offline_sync_operations for all using (actor_id = auth.uid() and public.is_match_participant(match_id)) with check (actor_id = auth.uid() and public.is_match_participant(match_id));
create policy "operators resolve sync conflicts" on public.offline_sync_operations for update using (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id))) with check (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id)));


-- ===== 202610210007_match_center.sql =====
-- Stage 5 match-center trusted operations. Review-only; do not apply to production.
create or replace function public.record_match_event(
  p_match_id uuid, p_team_id uuid, p_player_id uuid, p_event_type text,
  p_event_minute integer, p_payload jsonb, p_idempotency_key uuid, p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare match_row public.matches; event_id uuid; allowed boolean := false; sport text;
begin
  if p_actor_id <> auth.uid() then raise exception 'actor_mismatch'; end if;
  select m.* into match_row from public.matches m where m.id = p_match_id for update;
  if match_row.id is null or not public.is_match_participant(p_match_id) then raise exception 'match_not_assigned'; end if;
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
revoke execute on function public.record_match_event(uuid, uuid, uuid, text, integer, jsonb, uuid, uuid) from public, anon;
grant execute on function public.record_match_event(uuid, uuid, uuid, text, integer, jsonb, uuid, uuid) to authenticated, service_role;

create or replace function public.submit_match_result(p_match_id uuid, p_score jsonb, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare next_version integer; result_id uuid; match_row public.matches;
begin
  if p_actor_id <> auth.uid() then raise exception 'actor_mismatch'; end if;
  select * into match_row from public.matches where id = p_match_id for update;
  if match_row.id is null or not public.is_match_participant(p_match_id) or match_row.status = 'confirmed' then raise exception 'result_not_allowed'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.match_result_versions where match_id = p_match_id;
  insert into public.match_result_versions(match_id, version, score, status, submitted_by) values (p_match_id, next_version, p_score, 'submitted', p_actor_id) returning id into result_id;
  update public.matches set status = 'awaiting_confirmation' where id = p_match_id;
  return result_id;
end;
$$;
revoke execute on function public.submit_match_result(uuid, jsonb, uuid) from public, anon;
grant execute on function public.submit_match_result(uuid, jsonb, uuid) to authenticated, service_role;

create or replace function public.confirm_match_result(p_result_id uuid, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare result_row public.match_result_versions; match_row public.matches;
begin
  if p_actor_id <> auth.uid() then raise exception 'actor_mismatch'; end if;
  select * into result_row from public.match_result_versions where id = p_result_id for update;
  select * into match_row from public.matches where id = result_row.match_id for update;
  if result_row.id is null or match_row.id is null or not public.is_tournament_operator(match_row.tournament_id) or result_row.status <> 'submitted' then raise exception 'confirmation_not_allowed'; end if;
  update public.match_result_versions set status = 'confirmed', confirmed_by = p_actor_id where id = p_result_id;
  update public.matches set status = 'confirmed' where id = match_row.id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (p_actor_id, 'match_result_confirmed', 'match_result_version', p_result_id, 'Organizer confirmation');
  return p_result_id;
end;
$$;
revoke execute on function public.confirm_match_result(uuid, uuid) from public, anon;
grant execute on function public.confirm_match_result(uuid, uuid) to authenticated, service_role;

create or replace function public.correct_match_result(p_match_id uuid, p_score jsonb, p_reason text, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare next_version integer; result_id uuid; match_row public.matches;
begin
  if p_actor_id <> auth.uid() or nullif(trim(p_reason), '') is null then raise exception 'correction_reason_required'; end if;
  select * into match_row from public.matches where id = p_match_id for update;
  if match_row.id is null or not public.is_tournament_operator(match_row.tournament_id) then raise exception 'correction_not_allowed'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.match_result_versions where match_id = p_match_id;
  update public.match_result_versions set status = 'rejected', correction_reason = trim(p_reason) where match_id = p_match_id and status = 'confirmed';
  insert into public.match_result_versions(match_id, version, score, status, submitted_by, confirmed_by, correction_reason) values (p_match_id, next_version, p_score, 'confirmed', p_actor_id, p_actor_id, trim(p_reason)) returning id into result_id;
  update public.matches set status = 'confirmed' where id = p_match_id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (p_actor_id, 'match_result_corrected', 'match_result_version', result_id, trim(p_reason));
  return result_id;
end;
$$;
revoke execute on function public.correct_match_result(uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.correct_match_result(uuid, jsonb, text, uuid) to authenticated, service_role;


-- ===== 202610210008_histories_statistics.sql =====
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


-- ===== 202610210009_operations_finance_notifications.sql =====
-- Stage 7 operations. Additive and review-only; never apply to production from this workspace.
create table if not exists public.tournament_staff_assignments (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  permission text not null check (permission in ('registration','finance','media','operations','match_data')),
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id, permission)
);
create or replace function public.has_tournament_permission(p_tournament_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_tournament_operator(p_tournament_id) or exists (select 1 from public.tournament_staff_assignments a where a.tournament_id = p_tournament_id and a.user_id = auth.uid() and a.permission = p_permission);
$$;
revoke execute on function public.has_tournament_permission(uuid, text) from public, anon;
grant execute on function public.has_tournament_permission(uuid, text) to authenticated, service_role;

create table if not exists public.finance_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  tournament_id uuid references public.tournaments(id) on delete restrict,
  category text not null,
  description text not null,
  amount_mvr numeric(12,2) not null check (amount_mvr > 0),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','refunded')),
  proof_document_id uuid references public.private_documents(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table if not exists public.finance_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  tournament_id uuid references public.tournaments(id) on delete restrict,
  payment_id uuid references public.tournament_payments(id) on delete restrict,
  expense_id uuid references public.finance_expenses(id) on delete restrict,
  receipt_number text not null unique,
  amount_mvr numeric(12,2) not null check (amount_mvr >= 0),
  receipt_path text,
  issued_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (payment_id is not null or expense_id is not null)
);
create table if not exists public.finance_adjustments (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.tournament_payments(id) on delete cascade,
  kind text not null check (kind in ('waiver','refund')),
  amount_mvr numeric(12,2) not null check (amount_mvr > 0),
  reason text not null,
  approved_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  tournament_id uuid references public.tournaments(id) on delete set null,
  notification_type text not null,
  title text not null,
  body text not null,
  channel text not null check (channel in ('in_app','email')),
  state text not null default 'queued' check (state in ('queued','read','sent','failed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel text not null check (channel in ('in_app','email')),
  state text not null default 'queued' check (state in ('queued','sent','failed')),
  attempts integer not null default 0,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.tournament_staff_assignments enable row level security;
alter table public.finance_expenses enable row level security;
alter table public.finance_receipts enable row level security;
alter table public.finance_adjustments enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;

create policy "operators manage tournament staff" on public.tournament_staff_assignments for all using (public.is_tournament_operator(tournament_id)) with check (assigned_by = auth.uid() and public.is_tournament_operator(tournament_id));
create policy "finance staff manage expenses" on public.finance_expenses for all using (public.has_tournament_permission(tournament_id, 'finance') or (tournament_id is null and exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance')))) with check (created_by = auth.uid() and (public.has_tournament_permission(tournament_id, 'finance') or (tournament_id is null and exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance')))));
create policy "finance staff manage receipts" on public.finance_receipts for all using (public.has_tournament_permission(tournament_id, 'finance') or exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance'))) with check (issued_by = auth.uid() and (public.has_tournament_permission(tournament_id, 'finance') or exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance'))));
create policy "finance staff manage adjustments" on public.finance_adjustments for all using (exists (select 1 from public.tournament_payments p join public.tournament_entries e on e.id = p.entry_id where p.id = payment_id and public.has_tournament_permission(e.tournament_id, 'finance'))) with check (approved_by = auth.uid());
create policy "recipients read notifications" on public.notifications for select using (recipient_id = auth.uid());
create policy "recipients update notifications" on public.notifications for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy "authorized staff create notifications" on public.notifications for insert with check (created_by = auth.uid() and (tournament_id is null or public.has_tournament_permission(tournament_id, 'operations')));
create policy "recipients read delivery state" on public.notification_deliveries for select using (exists (select 1 from public.notifications n where n.id = notification_id and n.recipient_id = auth.uid()));
create policy "trusted delivery updates" on public.notification_deliveries for update using (false) with check (false);

-- Team managers may submit manual proof through the existing private-document flow;
-- finance staff alone changes payment verification, waivers, and refunds.
create policy "team managers submit payment proof" on public.tournament_payments for insert with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_team_manager(e.team_id)) and created_by = auth.uid());
create policy "finance staff update payment state" on public.tournament_payments for update using (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.has_tournament_permission(e.tournament_id, 'finance'))) with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.has_tournament_permission(e.tournament_id, 'finance')));

create policy "finance staff append audit" on public.audit_events for insert with check (actor_id = auth.uid() and entity_type in ('finance_expense','finance_receipt','finance_adjustment','tournament_payment'));
create or replace function public.audit_finance_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (auth.uid(), tg_op || '_finance_record', tg_table_name, new.id, 'Finance record change');
  return new;
end;
$$;
drop trigger if exists audit_finance_expenses on public.finance_expenses;
create trigger audit_finance_expenses after insert or update on public.finance_expenses for each row execute function public.audit_finance_change();
drop trigger if exists audit_finance_receipts on public.finance_receipts;
create trigger audit_finance_receipts after insert or update on public.finance_receipts for each row execute function public.audit_finance_change();
drop trigger if exists audit_finance_adjustments on public.finance_adjustments;
create trigger audit_finance_adjustments after insert or update on public.finance_adjustments for each row execute function public.audit_finance_change();


-- ===== 202610210010_onboarding_invitations.sql =====
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


-- ===== 202610210011_public_rls_policy_split.sql =====
-- Public RLS policy split. Review-only; do not apply without explicit authorization.
-- Keep is_tournament_operator/is_match_participant unavailable to anon. Policies
-- that call them are authenticated-only; published reads remain separate.

-- Registration policies that call scoped helper functions.
drop policy if exists "operators manage setup steps" on public.tournament_setup_steps;
create policy "operators manage setup steps" on public.tournament_setup_steps for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "operators manage registration settings" on public.tournament_registration_settings;
create policy "operators manage registration settings" on public.tournament_registration_settings for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "operators manage registration questions" on public.tournament_registration_questions;
create policy "operators manage registration questions" on public.tournament_registration_questions for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "operators read entries" on public.tournament_entries;
create policy "operators read entries" on public.tournament_entries for select to authenticated using (public.is_tournament_operator(tournament_id));
drop policy if exists "team managers read own entries" on public.tournament_entries;
create policy "team managers read own entries" on public.tournament_entries for select to authenticated using (public.is_team_manager(team_id));
drop policy if exists "team managers submit applications" on public.tournament_entries;
create policy "team managers submit applications" on public.tournament_entries for insert to authenticated with check (public.is_team_manager(team_id) and exists (select 1 from public.tournaments t left join public.tournament_registration_settings rs on rs.tournament_id = t.id where t.id = tournament_id and t.status = 'registration_open' and coalesce(rs.application_method, 'team_application') in ('team_application','both')));
drop policy if exists "operators add tournament entries" on public.tournament_entries;
create policy "operators add tournament entries" on public.tournament_entries for insert to authenticated with check (public.is_tournament_operator(tournament_id));
drop policy if exists "team managers update own applications" on public.tournament_entries;
create policy "team managers update own applications" on public.tournament_entries for update to authenticated using (public.is_team_manager(team_id)) with check (public.is_team_manager(team_id));
drop policy if exists "operators review entries" on public.tournament_entries;
create policy "operators review entries" on public.tournament_entries for update to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "entry participants read answers" on public.tournament_registration_answers;
create policy "entry participants read answers" on public.tournament_registration_answers for select to authenticated using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));
drop policy if exists "entry participants write answers" on public.tournament_registration_answers;
create policy "entry participants write answers" on public.tournament_registration_answers for all to authenticated using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id)))) with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));
drop policy if exists "participants read rosters" on public.roster_submissions;
create policy "participants read rosters" on public.roster_submissions for select to authenticated using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));
drop policy if exists "participants write rosters" on public.roster_submissions;
create policy "participants write rosters" on public.roster_submissions for all to authenticated using (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id)))) with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and (public.is_tournament_operator(e.tournament_id) or public.is_team_manager(e.team_id))));
drop policy if exists "participants read roster players" on public.roster_submission_players;
create policy "participants read roster players" on public.roster_submission_players for select to authenticated using (exists (select 1 from public.roster_submissions r where r.id = submission_id));
drop policy if exists "participants write roster players" on public.roster_submission_players;
create policy "participants write roster players" on public.roster_submission_players for all to authenticated using (exists (select 1 from public.roster_submissions r where r.id = submission_id)) with check (exists (select 1 from public.roster_submissions r where r.id = submission_id));
drop policy if exists "operators manage fees" on public.tournament_fees;
create policy "operators manage fees" on public.tournament_fees for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "operators manage payments" on public.tournament_payments;
create policy "operators manage payments" on public.tournament_payments for all to authenticated using (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_tournament_operator(e.tournament_id))) with check (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_tournament_operator(e.tournament_id)));
drop policy if exists "team managers read payments" on public.tournament_payments;
create policy "team managers read payments" on public.tournament_payments for select to authenticated using (exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_team_manager(e.team_id)));
drop policy if exists "private documents are scoped" on public.private_documents;
create policy "private documents are scoped" on public.private_documents for all to authenticated using (public.is_tournament_operator(tournament_id) or exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_team_manager(e.team_id))) with check (uploaded_by = auth.uid() and (public.is_tournament_operator(tournament_id) or exists (select 1 from public.tournament_entries e where e.id = entry_id and public.is_team_manager(e.team_id))));
drop policy if exists "authorized users upload tournament documents" on storage.objects;
create policy "authorized users upload tournament documents" on storage.objects for insert to authenticated with check (bucket_id = 'tournament-private-documents' and (public.is_tournament_operator((storage.foldername(name))[1]::uuid) or exists (select 1 from public.tournament_entries e where e.id = (storage.foldername(name))[2]::uuid and public.is_team_manager(e.team_id))));
drop policy if exists "authorized users read tournament documents" on storage.objects;
create policy "authorized users read tournament documents" on storage.objects for select to authenticated using (bucket_id = 'tournament-private-documents' and (public.is_tournament_operator((storage.foldername(name))[1]::uuid) or exists (select 1 from public.tournament_entries e where e.id = (storage.foldername(name))[2]::uuid and public.is_team_manager(e.team_id))));

-- Competition/match policies. Published reads from migrations 005 remain
-- independent of these authenticated-only operator/participant policies.
drop policy if exists "operators manage competition setup" on public.tournament_categories;
create policy "operators manage competition setup" on public.tournament_categories for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "operators manage stages" on public.competition_stages;
create policy "operators manage stages" on public.competition_stages for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "operators manage fixture versions" on public.competition_fixture_versions;
create policy "operators manage fixture versions" on public.competition_fixture_versions for all to authenticated using (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id))) with check (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id)));
drop policy if exists "operators manage groups" on public.competition_groups;
create policy "operators manage groups" on public.competition_groups for all to authenticated using (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id))) with check (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id)));
drop policy if exists "operators manage matches" on public.matches;
create policy "operators manage matches" on public.matches for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));
drop policy if exists "assigned officials read matches" on public.matches;
create policy "assigned officials read matches" on public.matches for select to authenticated using (public.is_match_participant(id));
drop policy if exists "operators manage assignments" on public.match_official_assignments;
create policy "operators manage assignments" on public.match_official_assignments for all to authenticated using (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id))) with check (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id)));
drop policy if exists "assigned officials manage events" on public.match_events;
create policy "assigned officials manage events" on public.match_events for all to authenticated using (public.is_match_participant(match_id)) with check (recorded_by = auth.uid() and public.is_match_participant(match_id));
drop policy if exists "participants read results" on public.match_result_versions;
create policy "participants read results" on public.match_result_versions for select to authenticated using (public.is_match_participant(match_id));
drop policy if exists "officials submit results" on public.match_result_versions;
create policy "officials submit results" on public.match_result_versions for insert to authenticated with check (submitted_by = auth.uid() and public.is_match_participant(match_id));
drop policy if exists "operators confirm results" on public.match_result_versions;
create policy "operators confirm results" on public.match_result_versions for update to authenticated using (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id))) with check (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id)));
drop policy if exists "operators manage standings" on public.standings_snapshots;
create policy "operators manage standings" on public.standings_snapshots for all to authenticated using (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id))) with check (exists (select 1 from public.competition_stages s where s.id = stage_id and public.is_tournament_operator(s.tournament_id)));

drop policy if exists "assigned actors manage sync operations" on public.offline_sync_operations;
create policy "assigned actors manage sync operations" on public.offline_sync_operations for all to authenticated using (actor_id = auth.uid() and public.is_match_participant(match_id)) with check (actor_id = auth.uid() and public.is_match_participant(match_id));
drop policy if exists "operators resolve sync conflicts" on public.offline_sync_operations;
create policy "operators resolve sync conflicts" on public.offline_sync_operations for update to authenticated using (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id))) with check (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id)));

drop policy if exists "participants read confirmed appearances" on public.match_player_participants;
create policy "participants read confirmed appearances" on public.match_player_participants for select to authenticated using (exists (select 1 from public.match_result_versions rv where rv.match_id = match_id and rv.status = 'confirmed') and (public.is_match_participant(match_id) or (exists (select 1 from public.player_profiles p where p.id = player_id and p.is_published) and exists (select 1 from public.matches m join public.tournaments t on t.id = m.tournament_id where m.id = match_id and t.is_published))));
drop policy if exists "operators manage participants" on public.match_player_participants;
create policy "operators manage participants" on public.match_player_participants for all to authenticated using (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id))) with check (exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_operator(m.tournament_id)));

-- Stage 7 private policies are authenticated-only; notification recipient reads
-- and the published policies from earlier migrations stay public where intended.
drop policy if exists "operators manage tournament staff" on public.tournament_staff_assignments;
create policy "operators manage tournament staff" on public.tournament_staff_assignments for all to authenticated using (public.is_tournament_operator(tournament_id)) with check (assigned_by = auth.uid() and public.is_tournament_operator(tournament_id));
drop policy if exists "finance staff manage expenses" on public.finance_expenses;
create policy "finance staff manage expenses" on public.finance_expenses for all to authenticated using (public.has_tournament_permission(tournament_id, 'finance') or (tournament_id is null and exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance')))) with check (created_by = auth.uid() and (public.has_tournament_permission(tournament_id, 'finance') or (tournament_id is null and exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance')))));
drop policy if exists "finance staff manage receipts" on public.finance_receipts;
create policy "finance staff manage receipts" on public.finance_receipts for all to authenticated using (public.has_tournament_permission(tournament_id, 'finance') or exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance'))) with check (issued_by = auth.uid() and (public.has_tournament_permission(tournament_id, 'finance') or exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','finance'))));
drop policy if exists "finance staff manage adjustments" on public.finance_adjustments;
create policy "finance staff manage adjustments" on public.finance_adjustments for all to authenticated using (exists (select 1 from public.tournament_payments p join public.tournament_entries e on e.id = p.entry_id where p.id = payment_id and public.has_tournament_permission(e.tournament_id, 'finance'))) with check (approved_by = auth.uid());
drop policy if exists "authorized staff create notifications" on public.notifications;
create policy "authorized staff create notifications" on public.notifications for insert to authenticated with check (created_by = auth.uid() and (tournament_id is null or public.has_tournament_permission(tournament_id, 'operations')));


-- ===== 202610210012_player_workspace_access.sql =====
-- Player workspace access additions. Review-only; do not apply or push without authorization.
-- The profile owner may read their own history and confirmed related records;
-- guests still receive only published public records through existing policies.
create policy "players read own team history" on public.player_team_memberships for select to authenticated using (exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()));
create policy "players read own confirmed appearances" on public.match_player_participants for select to authenticated using (exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()) and exists (select 1 from public.match_result_versions rv where rv.match_id = match_id and rv.status = 'confirmed'));
create policy "players read own confirmed matches" on public.matches for select to authenticated using (exists (select 1 from public.match_player_participants mp where mp.match_id = id and mp.player_id in (select p.id from public.player_profiles p where p.account_id = auth.uid())) and status = 'confirmed');
create policy "players read own milestones" on public.sport_milestones for select to authenticated using (player_id in (select p.id from public.player_profiles p where p.account_id = auth.uid()));


-- ===== 202610210013_player_workspace_profile_requests.sql =====
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


-- ===== 202610220014_public_player_statistics_fixes.sql =====
-- Review-only. NOT APPLIED — NOT PUSHED. Do not run against production without
-- the owner's explicit approval. This file fixes two pre-existing defects that
-- block real data on the public player page, the homepage player card, and the
-- player workspace statistics.
--
-- Everything below was verified read-only against the live project (anonymous
-- REST/PostgREST calls only) plus the local migration history. No DDL was
-- executed against production.
--
-- ===========================================================================
-- Item 1 — get_player_official_statistics: result-type mismatch
-- ===========================================================================
--
-- Live inspection (read-only):
--   * The function exists and every call returns HTTP 400:
--       {"code":"42804",
--        "message":"structure of query does not match function result type",
--        "details":"Returned type numeric does not match expected type bigint in column 9."}
--     Reproduced for both real published players and for an empty uuid.
--   * It is callable by anon: the failure is a runtime type error, not
--     "permission denied", so the existing EXECUTE grant to anon is intact.
--   * Local migration history: 202610210008_histories_statistics.sql is the only
--     migration that ever declares this function (no later migration creates,
--     replaces, or drops it), so the live definition is that one.
--   * Its declared return shape there is:
--       team_id uuid, team_type text, tournament_id uuid, season_id uuid,
--       sport text, appearances bigint, starts bigint, minutes bigint,
--       goals bigint, assists bigint, yellow_cards bigint, red_cards bigint
--
-- Root cause (confirmed against the real column DDL):
--   * count(...)                    -> bigint, matches declared bigint   (cols 6,7)
--   * sum(match_player_participants.minutes) where minutes is integer
--                                   -> bigint, matches declared bigint   (col 8)
--   * sum(bigint) -> numeric, but the four event totals are declared bigint
--                                                       (cols 9,10,11,12)  MISMATCH
--   Postgres reports the FIRST mismatching column and names column 9, which
--   independently proves columns 1-8 already match at runtime. teams.team_type
--   and tournaments.sport are plain text (check-constrained), so cols 2 and 5
--   are correct as declared.
--
-- Fix: preserve the EXACT existing return shape and add explicit, safe ::bigint
-- casts only to the four expressions that actually resolve to numeric.
--   * The values are whole-number non-negative counts, so numeric -> bigint is
--     lossless and cannot overflow in practice.
--   * Columns 6-8 are deliberately left byte-identical to 0008 so the diff is
--     trivially reviewable and no semantics change (including that
--     sum(mp.minutes) may still return NULL when every minutes value is NULL,
--     exactly as today).
--   * The guard, CTEs, joins, filters, GROUP BY, language/volatility,
--     security-definer, search_path and the grant list are all unchanged.
--
-- Why no versioned replacement is needed: CREATE OR REPLACE FUNCTION cannot
-- change an existing function's return type anyway (it raises SQLSTATE 42P13
-- "cannot change return type of existing function"), so keeping the original
-- shape is both required for the migration to apply and the correct way to keep
-- the RPC contract stable for every existing client (src/lib/publicData.ts,
-- src/lib/playerWorkspace.ts, src/lib/statistics.ts). PostgREST serialises int8
-- and numeric identically for whole-number values, so no client update is
-- required and the wire shape is unchanged.
--
-- Dependencies (read via local history; no views depend on this function):
--   reads: player_profiles, match_result_versions, match_events,
--          match_player_participants, matches, tournaments, teams
--   calls: auth.uid()
--   grants: anon, authenticated, service_role (EXECUTE) — preserved
--   callers: src/lib/publicData.ts, src/lib/playerWorkspace.ts,
--            src/lib/statistics.ts
-- ===========================================================================

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
    coalesce(sum(et.goals), 0)::bigint, coalesce(sum(et.assists), 0)::bigint, coalesce(sum(et.yellow_cards), 0)::bigint, coalesce(sum(et.red_cards), 0)::bigint
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
-- Re-stating the existing grants is idempotent and keeps the public RPC
-- contract explicit (CREATE OR REPLACE preserves existing ACLs regardless).
grant execute on function public.get_player_official_statistics(uuid, text, uuid, uuid, text) to anon, authenticated, service_role;

-- ===========================================================================
-- Item 2 — sport_milestones: guest reads of published achievements fail
-- ===========================================================================
--
-- Live inspection (read-only): an anonymous read of sport_milestones returns
-- HTTP 401 {"code":"42501","message":"permission denied for function
-- is_tournament_operator"}. The "operators manage milestones" policy created by
-- 0008 carries no TO clause, so it applies to anon and references a helper that
-- 202610210004 revoked from anon (granted only to authenticated, service_role).
-- Migration 202610210011 fixed this exact pattern on other tables but never
-- touched sport_milestones, and 202610210012 (unapplied) only adds a separate
-- authenticated-only policy.
--
-- Fix: recreate the same policy with an explicit "to authenticated" clause so
-- it is excluded from anon's policy set, letting the untouched
-- "published milestones are public" select policy serve guest reads cleanly.
-- USING/WITH CHECK expressions, policy name, and table are unchanged; the other
-- two policies ("published milestones are public", and
-- "players read own milestones" once 0012 is applied) are not modified.
-- ===========================================================================

drop policy if exists "operators manage milestones" on public.sport_milestones;
create policy "operators manage milestones" on public.sport_milestones for all to authenticated using (tournament_id is null or public.is_tournament_operator(tournament_id)) with check (created_by = auth.uid() and (tournament_id is null or public.is_tournament_operator(tournament_id)));


-- ===== 202610230015_organization_team_creator_read.sql =====
-- Workspace-creation RLS fix. Additive and review-only: do not apply to production
-- without explicit approval. Independent of the pending 014 review; filename order
-- means 014 must be applied first if both are approved.
--
-- Bug being fixed: the insert policies "organization creator assigns self owner" and
-- "team creator assigns self as manager" (202610210002) each require, inside their
-- WITH CHECK expression,
--   exists (select 1 from public.organizations/teams o where o.id = ... and o.created_by = auth.uid())
-- Subqueries inside policy expressions run as the current user and are subject to
-- row-level security on the referenced table. The only SELECT policies on
-- organizations and teams (202610210001) are the "published ... are public" ones,
-- which require the row to be published (new rows default to is_published = false)
-- or already linked to an existing membership row. A brand-new workspace is neither
-- visible to its creator nor yet a member of itself, so the exists() check is always
-- false and every "Create workspace" attempt fails with:
--   new row violates row-level security policy for table "organization_memberships"
--   (and identically for "team_memberships" when creating a Team).
--
-- Fix: let the signed-in creator read the workspace rows they created. created_by can
-- only equal their own auth.uid(), so no other account gains access; "to authenticated"
-- keeps the policies out of the anon policy set, and public guest pages keep using the
-- unchanged published-only policies. Tournament creation (202610210003) needs no change:
-- its operator checks read organization_memberships, which is visible once the owner
-- membership row exists.

create policy "creators read their organizations" on public.organizations for select to authenticated using (created_by = auth.uid());

create policy "creators read their teams" on public.teams for select to authenticated using (created_by = auth.uid());


-- ===== 202610230016_matches_policy_recursion_fix.sql =====
-- Review-only. NOT APPLIED -- NOT PUSHED. Do not run against production without
-- the owner's explicit approval. This fixes a live error the owner hit in the
-- Organizer Workspace on 23 October 2026:
--
--   Unable to load this workspace: infinite recursion detected in policy for
--   relation "matches"
--
-- Everything below was derived read-only from the local migration history. No DDL
-- was executed against the project by the assistant.
--
-- ===========================================================================
-- Root cause: an RLS policy cycle on public.matches
-- ===========================================================================
--
-- Migration 202610210012 created on public.matches:
--
--   create policy "players read own confirmed matches" ...
--     using (exists (select 1 from public.match_player_participants mp
--                    where mp.match_id = id and mp.player_id in (...))
--            and status = 'confirmed');
--
-- A subquery inside a policy expression runs with row-level security applied to
-- the referenced table, so evaluating that policy also evaluates the policies on
-- public.match_player_participants. Migration 202610210011 defines those as:
--
--   "participants read confirmed appearances" -> exists (... public.matches m ...)
--   "participants read confirmed appearances" -> exists (... public.match_result_versions ...)
--   "operators manage participants"           -> exists (... public.matches m ...)
--
-- and public.match_result_versions' own "operators confirm results" policy also
-- reads public.matches. Evaluation therefore re-enters the policy set of
-- public.matches, which Postgres detects and rejects:
--
--   matches (202610210012 policy)
--     -> match_player_participants (202610210011 policies)
--       -> matches                                <- recursion
--         (and one hop further, via match_result_versions -> matches)
--
-- Affected surface: any SELECT on public.matches, public.match_player_participants
-- or public.match_result_versions by a role whose policy evaluation reaches that
-- path -- which includes the Organizer Workspace overview query
-- (src/lib/organizer.ts, loadOrganizationWorkflowCounts:
--   client.from('matches').select('id,tournament_id,status').in('tournament_id', ids)).
-- The other two policies on public.matches are not implicated, because both of
-- their callees are SECURITY DEFINER and therefore do not re-apply RLS:
--   "operators manage matches"        -> public.is_tournament_operator(uuid)
--   "assigned officials read matches" -> public.is_match_participant(uuid)
-- Guest (anon) queries are unaffected: the 202610210012 policy is `to authenticated`.
--
-- The failure is order-dependent rather than unconditional, because Postgres ORs
-- the policy expressions and can short-circuit on a true earlier policy. That is
-- why some authenticated reads of matches have succeeded while others abort; the
-- defect is latent until the evaluation order happens to reach the recursive
-- policy, which is exactly what happened on the workspace overview.
--
-- ===========================================================================
-- Fix
-- ===========================================================================
--
-- Move the participation lookup into a SECURITY DEFINER helper. A definer
-- function executes as its owner and does not apply RLS to the tables it reads,
-- so the helper cannot re-enter the matches policy set. The predicate, and the
-- resulting row visibility, are unchanged; only the recursion is removed. This
-- mirrors the two helpers the other matches policies already use
-- (is_tournament_operator, is_match_participant).
--
-- Breaking the cycle at this single point fixes every path into it:
--   matches -> match_player_participants   now reads through the definer helper
--   match_player_participants -> matches   re-enters matches, whose policy no
--                                          longer re-enters that table
--   match_result_versions -> matches       same
--   match_official_assignments / offline_sync_operations -> matches  same
--
-- The helper is scoped to auth.uid() and returns a single boolean. It exposes no
-- column of any table, and is executable by authenticated and service_role only
-- (revoked from public and anon), matching the existing helpers.

create or replace function public.player_plays_in_match(p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.match_player_participants mp
    where mp.match_id = p_match_id
      and mp.player_id in (
        select p.id from public.player_profiles p where p.account_id = auth.uid()
      )
  );
$$;

revoke execute on function public.player_plays_in_match(uuid) from public, anon;
grant execute on function public.player_plays_in_match(uuid) to authenticated, service_role;

drop policy if exists "players read own confirmed matches" on public.matches;
create policy "players read own confirmed matches" on public.matches
  for select to authenticated
  using (public.player_plays_in_match(id) and status = 'confirmed');


-- ===== 202610230017_roster_policy_recursion_fix.sql =====
-- Review-only. NOT APPLIED -- NOT PUSHED. Do not run against production without
-- the owner's explicit approval. This fixes a live error the owner hit in the
-- Organizer Workspace tournament cockpit on 23 October 2026:
--
--   Tournament workspace unavailable
--   infinite recursion detected in policy for relation "roster_submissions"
--
-- Everything below was derived read-only from the local migration history. No DDL
-- was executed against the project by the assistant.
--
-- ===========================================================================
-- Root cause: an RLS policy cycle between roster_submissions and
--             roster_submission_players
-- ===========================================================================
--
-- Migration 202610210013 created on public.roster_submissions:
--
--   create policy "players read own roster submissions" ...
--     using (exists (select 1 from public.roster_submission_players rsp
--                    where rsp.submission_id = id
--                      and exists (select 1 from public.player_profiles p
--                                  where p.id = rsp.player_id
--                                    and p.account_id = auth.uid())));
--
-- A subquery inside a policy expression runs with row-level security applied to
-- the referenced table, so evaluating that policy also evaluates the policies on
-- public.roster_submission_players. Migration 202610210011 defines those as:
--
--   "participants read roster players"  -> exists (... public.roster_submissions ...)
--   "participants write roster players" -> exists (... public.roster_submissions ...)
--                                          (in both USING and WITH CHECK)
--
-- Evaluation therefore re-enters the policy set of public.roster_submissions:
--
--   roster_submissions (202610210013 policy)
--     -> roster_submission_players (202610210011 policies)
--       -> roster_submissions                <- recursion
--
-- This is the same defect class as 202610230016 (matches -> match_player_participants
-- -> matches), fixed there the same way.
--
-- ===========================================================================
-- This is the last known cycle
-- ===========================================================================
--
-- A script was run over the local migration history that (a) replays every
-- `create policy` / `drop policy if exists` in filename order to reconstruct the
-- FINAL live policy set, (b) builds a directed edge T -> U for every policy on T
-- whose USING or WITH CHECK reads table U, (c) excludes calls to SECURITY DEFINER
-- functions, which execute as their owner and do not re-apply RLS, and (d) runs
-- Tarjan strongly-connected-component detection over the result. Over 45 tables
-- and 103 live policies it found exactly one remaining cycle, the one fixed here.
--
-- The `matches` cycle that migration 202610230016 addresses is already absent
-- from that final set, because `player_plays_in_match` is recognised as a
-- SECURITY DEFINER function -- i.e. 016 breaks its cycle by construction.
--
-- No cycle is reported involving player_profiles, tournament_entries,
-- organization_memberships, team_memberships, tournaments, matches,
-- match_result_versions, match_player_participants, or any other table; their
-- policies either read only auth.uid() columns or reach other tables through
-- SECURITY DEFINER helpers (is_tournament_operator, is_team_manager,
-- is_match_participant, has_tournament_permission, claim_player_profile,
-- submit_roster, protect_entry_statuses, record_match_event, submit_match_result,
-- confirm_match_result, correct_match_result, get_player_official_statistics,
-- audit_finance_change).
--
-- Note: the defect is order-dependent rather than unconditional, because Postgres
-- ORs the policy expressions and can short-circuit on a true earlier policy. That
-- is why authenticated roster reads have sometimes succeeded and sometimes
-- aborted; the defect is latent until evaluation happens to reach the recursive
-- policy.
--
-- ===========================================================================
-- Fix
-- ===========================================================================
--
-- Move the ownership lookup into a SECURITY DEFINER helper, which runs as the
-- function owner and therefore does not apply RLS to the tables it reads, so it
-- cannot re-enter the roster_submissions policy set. The predicate, and the
-- resulting row visibility, are unchanged; only the recursion is removed. This
-- mirrors 202610230016 and the helpers the matches policies already use.
--
-- Only the roster_submissions side is rewritten. The roster_submission_players
-- policies ("participants read roster players", "participants write roster
-- players") are left untouched: they are a plain parent-row-exists check, they
-- were written first, and breaking the cycle at one point is sufficient.
--
-- The helper is scoped to auth.uid() and returns a single boolean. It exposes no
-- column of any table, and is executable by authenticated and service_role only
-- (revoked from public and anon), matching the existing helpers.

create or replace function public.player_owns_roster_submission(p_submission_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.roster_submission_players rsp
    join public.player_profiles p on p.id = rsp.player_id
    where rsp.submission_id = p_submission_id
      and p.account_id = auth.uid()
  );
$$;

revoke execute on function public.player_owns_roster_submission(uuid) from public, anon;
grant execute on function public.player_owns_roster_submission(uuid) to authenticated, service_role;

drop policy if exists "players read own roster submissions" on public.roster_submissions;
create policy "players read own roster submissions" on public.roster_submissions
  for select to authenticated
  using (public.player_owns_roster_submission(id));


-- ===== 202610230018_phase2_draft_optional_fields.sql =====
-- Tournament workflow Phase 2 (owner's "Complete Tournament Workflow: Creation
-- to Archive", 2026-10-23): optional creation-form fields.
--
-- The Phase 2 form "Only require: Tournament name, Sport. Optional when already
-- known: Season, Start date, Island/atoll."
--
--   * Season   - no new column. `tournaments.season_id` already exists,
--     added by `202610210008_histories_statistics.sql` (review-only) and
--     referencing `public.seasons(id) on delete set null`.
--   * Start date - new nullable `starts_at`. Kept on `date` because the
--     specification calls it a start *date* and validates a date range; the
--     later Stage 1 (Phase 3) migration can widen it if day precision is not
--     enough. No end date here: end dates arrive with Stage 1 per the same
--     one-migration-per-phase decision.
--   * Island/atoll - new nullable free-text `island`. Maldivian atoll and
--     island names are alphanumeric (Te'n, HA Ihavandhu), so plain text is the
--     honest shape; no reference table exists to constrain it.
--
-- Everything is nullable, so no existing row, policy, or query changes value or
-- behaviour. No policy, table, or privilege is touched. Nothing is seeded.
--
-- Review-only. Apply in the Supabase Dashboard SQL Editor.

alter table public.tournaments
  add column if not exists starts_at date,
  add column if not exists island text;


-- ===== 202610230019_setup_wizard_nine_stage_fields.sql =====
-- Migration 019 — Setup wizard additive fields (REVIEW ONLY — do not run without owner approval)
--
-- Implements the owner's 2026-10-23 nine-stage setup specification. The wizard
-- previously only had columns for the few fields the 11-step version collected;
-- the new stages explicitly ask for category descriptions, registration caps,
-- and structured roster policies. Safe upserts and retries are preserved because
-- every new column is nullable or has a default, and no existing row changes.
--
-- 1. tournament_setup_steps.status — widen the CHECK to accept two new
--    app-written statuses used by the new wizard:
--      'deferred'     — an explicit "Set later"decision (never counted complete)
--      'needs_review' — an earlier change invalidated a later stage
--    The constraint is widened in place; no stored status value changes.
-- 2. tournament_categories — description, active state, a stable display
--    order for reordering (Stage 2), and free-text eligibility instructions
--    with the required cutoff-date rule.
-- 3. tournament_registration_settings — application caps and structured roster
--    policy fields (Stages 3 and 5). 'Maximum approved teams' deliberately does
--    NOT get a new column: tournament_categories.team_limit already carries it.
--    The entries insert policy now enforces the opens/closes window itself, so
--    closing happens even with no organizer signed in.
-- 4. tournament_registration_questions — organizer help text (`instructions`)
--    and response_type gains 'date'. 'file' is NOT added yet: uploads need
--    storage wiring first.

-- 1. Status vocabulary --------------------------------------------------------
alter table public.tournament_setup_steps
  drop constraint if exists tournament_setup_steps_status_check;
alter table public.tournament_setup_steps
  add constraint tournament_setup_steps_status_check
  check (status in ('not_started','in_progress','complete','blocked','deferred','needs_review'));

-- 2. Category fields (Stage 2) ------------------------------------------------
alter table public.tournament_categories
  add column if not exists description text;
alter table public.tournament_categories
  add column if not exists is_active boolean not null default true;
alter table public.tournament_categories
  add column if not exists sort_order smallint not null default 0;

-- 3. Registration caps and roster policy (Stages 3 and 5) ---------------------
alter table public.tournament_registration_settings
  add column if not exists max_applications smallint
  check (max_applications is null or max_applications > 0);
alter table public.tournament_registration_settings
  add column if not exists allow_late_applications boolean not null default false;
alter table public.tournament_registration_settings
  add column if not exists roster_officials_count smallint
  check (roster_officials_count is null or roster_officials_count >= 0);
alter table public.tournament_registration_settings
  add column if not exists roster_submission_timing text
  check (roster_submission_timing in ('with_application','after_approval'));
alter table public.tournament_registration_settings
  add column if not exists roster_changes_allowed boolean not null default true;
alter table public.tournament_registration_settings
  add column if not exists roster_requires_approval boolean not null default true;
alter table public.tournament_registration_settings
  add column if not exists roster_locks_after_approval boolean not null default true;

-- 2b. Category eligibility (Stage 2) ------------------------------------------
-- Free-text eligibility instructions ("cutoff date 31 Dec 2011 for Under-18").
-- Age eligibility that cannot be checked without a cutoff is recorded here;
-- automatic eligibility *calculation* needs real birth dates, which stay
-- private by design, so the checker flags records for review rather than
-- rejecting them.
alter table public.tournament_categories
  add column if not exists eligibility_instructions text;

-- 3b. Backend-enforced registration window (Status decisions in section 5) ----
-- The status flip is the organizer's action, but the WINDOW is enforced by the
-- database: once closes_at passes, applications are refused even if the
-- tournament status still says open (a closed browser or inactive organizer
-- cannot prevent closing). Scheduled auto-OPENING remains a known limitation:
-- Postgres has no timer trigger, so a scheduled opening still needs the
-- organizer's confirmed Open action (or pg_cron later) - accepting applications
-- merely because a stored timestamp passed would bypass the organizer's launch
-- control and is deliberately not added.
drop policy if exists "team managers submit applications" on public.tournament_entries;
create policy "team managers submit applications" on public.tournament_entries for insert to authenticated with check (
  public.is_team_manager(team_id)
  and exists (
    select 1 from public.tournaments t
    left join public.tournament_registration_settings rs on rs.tournament_id = t.id
    where t.id = tournament_id
      and t.status = 'registration_open'
      and coalesce(rs.application_method, 'team_application') in ('team_application','both')
      -- Backend window: no opening before opens_at, no submission at/after closes_at.
      and (rs.opens_at is null or rs.opens_at <= now())
      and (rs.closes_at is null or rs.closes_at > now())
  )
);

-- 4. Question types (Stage 4) -------------------------------------------------
-- `instructions` carries the organizer's help text shown beside the field on
-- the application form; `response_type` gains `date`. `file` is NOT added
-- yet: uploads need storage wiring first.
alter table public.tournament_registration_questions
  add column if not exists instructions text;
alter table public.tournament_registration_questions
  drop constraint if exists tournament_registration_questions_response_type_check;
alter table public.tournament_registration_questions
  add constraint tournament_registration_questions_response_type_check
  check (response_type in ('text','long_text','number','boolean','select','date'));

-- RLS is unchanged: all three tables keep their existing operator-only
-- policies, so the new columns are writable only through the same grants.


-- ===== 202610240020_public_registration_reads.sql =====
-- 2026-10-24 — Migration 020 (REVIEW-ONLY: apply in the Supabase Dashboard SQL
-- Editor, like 017-019; this file is never applied by the app).
--
-- Public reads for the applicant-facing registration information on the public
-- tournament page (spec section 6): state, dates, requirements, form questions,
-- and the category choice. Only *published* tournaments expose them — a draft
-- keeps its planning private by construction, matching the questions policy
-- "published registration questions are public" (already shipped in the base
-- schema; this migration does not touch it).
--
-- Column boundary note: `tournament_registration_settings` holds only
-- applicant-facing fields (dates, method, requirements, contact instructions,
-- roster limits, documents flag, change rules) plus `updated_by`, a profile id
-- with no name content. If the owner prefers, a narrow view is a later hardening
-- step; the row-level policy is the minimal change that makes the public page
-- work without restructuring.

-- 1. Registration settings readable to the public for published tournaments ---
create policy "published registration settings are public"
  on public.tournament_registration_settings
  for select
  using (exists (select 1 from public.tournaments t where t.id = tournament_id and t.is_published));

-- 2. Categories readable to the public for published tournaments ---------------
-- Applicants must be able to see the category list (with per-category team
-- caps) to pick one; eligibility instructions stay in `tournament_categories`
-- and are read with the same row.
create policy "published tournament categories are public"
  on public.tournament_categories
  for select
  using (exists (select 1 from public.tournaments t where t.id = tournament_id and t.is_published));


-- ===== 202610240021_team_official_workspace_access.sql =====
-- Review-only. NOT APPLIED. Do not run against production without the owner's
-- explicit approval; prefer the Supabase SQL Editor, statement by statement.
--
-- Owner batch 2026-10-24: Team workspace + Official/Staff workspace +
-- withdrawal. This migration only completes access that the applied schema
-- already structurally implies. Its guarantees:
--   * every new policy is self-scoped to auth.uid() or the exact team the
--     caller already manages — nobody gains access to another workspace's data;
--   * the anon/public role is never involved (all statements are
--     `to authenticated`, including the new table's policies);
--   * no existing policy is dropped except the entries trigger recreation in
--     part 6, whose predicate list only ever GROWS (adds "withdrawn") and adds
--     one stricter guard (withdrawn rows stay withdrawn for team managers);
--   * no readable national ID, token, or private document surface is touched.
-- Prior state it depends on (already applied): is_team_manager(uuid) from
-- migration 0004; team_memberships SELECT policy from 0001.
--
-- 1. Assigned officials must list their own match assignments.
--    Today `match_official_assignments` has only "operators manage
--    assignments", so an assigned official cannot enumerate where they are
--    assigned and an Official workspace cannot load. The handle they already
--    rely on elsewhere, is_match_participant (0005), reads this same table
--    through a SECURITY DEFINER helper and is unaffected.
create policy "officials read own assignments" on public.match_official_assignments
  for select to authenticated
  using (user_id = auth.uid());

-- 2. Assigned tournament staff must list their own staff assignments.
create policy "assigned staff read own assignments" on public.tournament_staff_assignments
  for select to authenticated
  using (user_id = auth.uid());

-- 3. Team managers must edit their own team's profile fields
--    (name/island/team_type/description/logo_url/island, publication toggle).
--   Matches the player-workspace precedent: the owner of the workspace may
--    publish it (`players update own profile fields`, migration 0010).
create policy "team managers update their team" on public.teams
  for update to authenticated
  using (public.is_team_manager(id)) with check (public.is_team_manager(id));

-- 4. Team managers must be able to end a player membership they manage
--    (status -> 'ended' + effective_to). The insert path (0002) already allows
--    managers; there is no update path. The update policy is scoped to the
--    exact membership rows of teams the caller manages. RLS cannot restrict
--    COLUMNS, so the application agrees — and the clerk of record below may
--    verify — that this policy is used only to end memberships; every other
--    field change through the app is rejected by input validation.
create policy "team managers end player memberships" on public.player_team_memberships
  for update to authenticated
  using (exists (select 1 from public.team_memberships tm where tm.team_id = team_id and tm.user_id = auth.uid()))
  with check (exists (select 1 from public.team_memberships tm where tm.team_id = team_id and tm.user_id = auth.uid()));

-- 5. Team managers must be able to withdraw their own application
--    (Product Specification, Tournament Applications: "Withdraw where
--    permitted"). The trigger blocks every application_status except
--    draft/submitted/changes_requested for a team manager, so "withdrawn" is
--    impossible today even for an application nobody has approved. Recreation
--    below keeps every existing guard verbatim and adds:
--      * 'withdrawn' to the allowed set;
--      * withdrawal only from draft/submitted/changes_requested;
--      * withdrawn stays withdrawn for team managers (an operator may still
--        review such an entry); scope moves and roster/payment/review field
--        changes remain forbidden exactly as before.
create or replace function public.protect_entry_statuses()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_tournament_operator(old.tournament_id) and new.application_status is distinct from old.application_status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  if not public.is_tournament_operator(old.tournament_id) then
    if new.tournament_id <> old.tournament_id or new.team_id <> old.team_id then raise exception 'team_manager_cannot_move_entry_scope'; end if;
    if new.roster_status <> old.roster_status or new.payment_status <> old.payment_status or new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at or new.review_notes is distinct from old.review_notes then
      raise exception 'team_manager_cannot_change_roster_payment_or_review_status';
    end if;
    if old.application_status = 'withdrawn' and new.application_status is distinct from 'withdrawn' then raise exception 'team_manager_cannot_reopen_withdrawn_entry'; end if;
    if new.application_status not in ('draft','submitted','changes_requested','withdrawn') then raise exception 'team_manager_cannot_approve_application'; end if;
    if new.application_status = 'withdrawn' and old.application_status not in ('draft','submitted','changes_requested') then raise exception 'team_manager_withdrawal_not_permitted_from_current_status'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_entry_statuses_trigger on public.tournament_entries;
create trigger protect_entry_statuses_trigger before update on public.tournament_entries
  for each row execute function public.protect_entry_statuses();

-- 6. Officials keep their own availability (Official workspace, Availability).
--    Owner-only table; every policy is the caller's own row.
create table if not exists public.official_availability (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  available_from date,
  available_to date,
  note text,
  updated_at timestamptz not null default now(),
  check (available_to is null or available_from is null or available_to >= available_from)
);
alter table public.official_availability enable row level security;
create policy "officials manage own availability" on public.official_availability
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ===== 202610240022_news_media.sql =====
-- Review-only. NOT APPLIED. Do not run against production without the owner's
-- explicit approval. Additive only: new table + RLS + indexes. No existing
-- table, policy, or column is altered. No seed data.
--
-- News, announcements and media (Product Specification section 3.3 / J).
-- Public reads are published-only; authoring is limited to organizer media
-- roles (has_tournament_permission 'media' or operations) or the owner of the
-- owning organization. Draft/scheduled/published/archived states are real.
-- Cover images and media links are stored as URLs; binary assets belong in
-- Storage buckets governed by separate (future) policies.
create table if not exists public.news_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text,
  body text not null default '',
  content_type text not null default 'news' check (content_type in ('news','announcement','match_report','photo_gallery','video_link','highlight','organizer_update')),
  cover_image_url text,
  media_url text,
  tournament_id uuid references public.tournaments(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  author_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','scheduled','published','archived')),
  featured boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or published_at is not null)
);
alter table public.news_articles enable row level security;
create index if not exists news_articles_status_idx on public.news_articles(status, published_at desc);
create index if not exists news_articles_tournament_idx on public.news_articles(tournament_id);
create index if not exists news_articles_organization_idx on public.news_articles(organization_id);

-- Public read: published rows only, and scheduled publication time has passed.
create policy "published news is public" on public.news_articles
  for select to anon, authenticated
  using (status = 'published' and (published_at is null or published_at <= now()));

-- Authors read their own drafts.
create policy "authors read own news" on public.news_articles
  for select to authenticated
  using (author_id = auth.uid());

-- Organization operators with media/operations/owner role manage news for
-- their organization. Tournament-scoped news is managed by tournament
-- operators or staff with the media permission.
create policy "media roles manage organization news" on public.news_articles
  for all to authenticated
  using (
    (organization_id is not null and exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','media','operations')))
    or (tournament_id is not null and (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'media')))
    or author_id = auth.uid()
  )
  with check (
    (organization_id is not null and exists (select 1 from public.organization_memberships om where om.organization_id = organization_id and om.user_id = auth.uid() and om.role in ('owner','media','operations')))
    or (tournament_id is not null and (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'media')))
    or author_id = auth.uid()
  );


-- ===== 202610240023_tournament_branding.sql =====
-- Review-only. NOT APPLIED. Do not run against production without the owner's
-- explicit approval. Additive only: two columns + one private Storage bucket +
-- self-scoped Storage policies. No existing table, policy, or column is altered
-- beyond the two new nullable columns. No seed data.
--
-- Tournament branding images (Stage 1 — Basics). Object *paths* are stored in
-- the database; expiring signed URLs are generated at read time and never
-- persisted. The bucket is private; public reads are mediated by the
-- tournament's published state (see the helper below), so draft branding stays
-- private.
alter table public.tournaments
  add column if not exists logo_path text,
  add column if not exists cover_path text;

-- Private bucket for tournament media. Created idempotently.
insert into storage.buckets (id, name, public)
values ('tournament-media', 'tournament-media', false)
on conflict (id) do nothing;

-- Helper: an organization operator (owner/operations) for the tournament's
-- organization may write/delete objects under
--   organizations/{organization_id}/tournaments/{tournament_id}/...
-- The path's first two segments must match an organization and tournament the
-- caller operates. Anonymous and cross-organization writes are impossible.
create or replace function public.tournament_media_write_allowed(p_object_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  org_id uuid;
  tourn_id uuid;
begin
  -- Object name: organizations/{org}/tournaments/{tourn}/logo|cover/{file}
  if p_object_name !~ '^organizations/[0-9a-f-]{36}/tournaments/[0-9a-f-]{36}/(logo|cover)/[A-Za-z0-9._-]+$' then
    return false;
  end if;
  org_id := (regexp_match(p_object_name, '^organizations/([0-9a-f-]{36})/'))[1]::uuid;
  tourn_id := (regexp_match(p_object_name, 'tournaments/([0-9a-f-]{36})/'))[1]::uuid;
  return exists (
    select 1 from public.tournaments t
    join public.organization_memberships om on om.organization_id = t.organization_id
    where t.id = tourn_id and t.organization_id = org_id
      and om.user_id = auth.uid() and om.role in ('owner','operations')
  );
end;
$$;
revoke execute on function public.tournament_media_write_allowed(text) from public, anon;
grant execute on function public.tournament_media_write_allowed(text) to authenticated, service_role;

-- Storage policies: only authorized operators write; only authorized operators
-- (and, for published tournaments, anyone via the read helper) read.
create policy "tournament media authorized upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tournament-media' and public.tournament_media_write_allowed(name));

create policy "tournament media authorized update" on storage.objects
  for update to authenticated
  using (bucket_id = 'tournament-media' and public.tournament_media_write_allowed(name))
  with check (bucket_id = 'tournament-media' and public.tournament_media_write_allowed(name));

create policy "tournament media authorized delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tournament-media' and public.tournament_media_write_allowed(name));

-- Read policy: authorized operators always; everyone else only when the
-- owning tournament is published (path is validated by the helper).
create policy "tournament media authorized read" on storage.objects
  for select to authenticated
  using (bucket_id = 'tournament-media' and public.tournament_media_write_allowed(name));

create policy "tournament media public read for published" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'tournament-media'
    and exists (
      select 1 from public.tournaments t
      where t.is_published = true
        and t.logo_path = name or t.cover_path = name
    )
  );


-- ===== 202610240024_app_wide_upload_paths.sql =====
-- Review-only. NOT APPLIED. Do not run against production without the owner's
-- explicit approval. Additive only: nullable path columns + one public-media
-- Storage bucket + narrowly scoped policies. No existing table/policy/column
-- is altered destructively. No seed data.
--
-- App-wide file upload system (path-based, never URL-based). Object *paths* are
-- stored; display URLs are generated at read time. The bucket is public for
-- reads of published media only; writes/deletes require ownership of the
-- related record.
alter table public.profiles add column if not exists avatar_path text;
alter table public.player_profiles add column if not exists photo_path text;
alter table public.teams add column if not exists logo_path text;
alter table public.teams add column if not exists cover_path text;
alter table public.organizations add column if not exists logo_path text;
alter table public.organizations add column if not exists cover_path text;
alter table public.news_articles add column if not exists cover_path text;

insert into storage.buckets (id, name, public)
values ('public-media', 'public-media', true)
on conflict (id) do nothing;

-- Owner of the account may write their own avatar path.
create policy "account avatar owner write" on storage.objects
  for all to authenticated
  using (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'accounts' and (storage.foldername(name))[2] = auth.uid()::text)
  with check (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'accounts' and (storage.foldername(name))[2] = auth.uid()::text);

-- Player owner may write their own photo.
create policy "player photo owner write" on storage.objects
  for all to authenticated
  using (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'players' and exists (select 1 from public.player_profiles p where p.id::text = (storage.foldername(name))[2] and p.account_id = auth.uid()))
  with check (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'players' and exists (select 1 from public.player_profiles p where p.id::text = (storage.foldername(name))[2] and p.account_id = auth.uid()));

-- Team manager may write team branding.
create policy "team branding manager write" on storage.objects
  for all to authenticated
  using (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'teams' and public.is_team_manager(((storage.foldername(name))[2])::uuid))
  with check (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'teams' and public.is_team_manager(((storage.foldername(name))[2])::uuid));

-- Organization owner/admin may write organization branding.
create policy "organization branding owner write" on storage.objects
  for all to authenticated
  using (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'organizations' and exists (select 1 from public.organization_memberships om where om.organization_id::text = (storage.foldername(name))[2] and om.user_id = auth.uid() and om.role in ('owner','admin')))
  with check (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'organizations' and exists (select 1 from public.organization_memberships om where om.organization_id::text = (storage.foldername(name))[2] and om.user_id = auth.uid() and om.role in ('owner','admin')));


-- ===== 202610300025_history_engine.sql =====
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


-- ===== 202610300026_identity_guardian_import.sql =====
-- Identity check, guardian approval for minors, and import provenance.
-- Review-only; do not apply or push without explicit owner authorization.
--
-- Product Specification 6.4 / 16.3:
--   * A national ID (or foreign document) is turned into a keyed HMAC digest by
--     the trusted `register-identity` Edge Function. The readable number is
--     never sent to or stored in these tables; player_identity_keys keeps its
--     "no client access" policy from 0002.
--   * A minor's profile may be recorded by an authorized organizer or team
--     manager, but a guardian must approve before the account claim and before
--     the profile can be made public.

-- 1. Minor flag. Only the record creator (organizer / team manager who added
--    the person) may change it; the player themself cannot clear it.
alter table public.player_profiles add column if not exists is_minor boolean not null default false;

create table if not exists public.guardian_approvals (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles(id) on delete restrict,
  guardian_name text not null check (length(trim(guardian_name)) > 0),
  relationship text not null check (relationship in ('parent','legal_guardian','other_authorized')),
  guardian_contact text,
  approves_claim boolean not null default true,
  approves_public_profile boolean not null default false,
  note text,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete restrict
);
create index if not exists guardian_approvals_player_idx on public.guardian_approvals(player_id, created_at desc);
alter table public.guardian_approvals enable row level security;

-- Who may record or revoke an approval: the person who created the player
-- record (organizer or team manager). Reads: that person and the player's own
-- linked account. Rows are never deleted; revocation sets revoked_at.
create or replace function public.can_manage_minor_record(p_player_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.player_profiles p where p.id = p_player_id and p.created_by = auth.uid());
$$;
revoke execute on function public.can_manage_minor_record(uuid) from public, anon;
grant execute on function public.can_manage_minor_record(uuid) to authenticated, service_role;

create or replace function public.has_guardian_approval(p_player_id uuid, p_scope text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.guardian_approvals g
    where g.player_id = p_player_id and g.revoked_at is null
      and ((p_scope = 'claim' and g.approves_claim) or (p_scope = 'public' and g.approves_public_profile))
  );
$$;
revoke execute on function public.has_guardian_approval(uuid, text) from public, anon;
grant execute on function public.has_guardian_approval(uuid, text) to authenticated, service_role;

drop policy if exists "record creators manage guardian approvals" on public.guardian_approvals;
create policy "record creators manage guardian approvals" on public.guardian_approvals for select to authenticated
  using (public.can_manage_minor_record(player_id) or exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()));
drop policy if exists "record creators record guardian approvals" on public.guardian_approvals;
create policy "record creators record guardian approvals" on public.guardian_approvals for insert to authenticated
  with check (recorded_by = auth.uid() and revoked_at is null and public.can_manage_minor_record(player_id));
drop policy if exists "record creators revoke guardian approvals" on public.guardian_approvals;
create policy "record creators revoke guardian approvals" on public.guardian_approvals for update to authenticated
  using (public.can_manage_minor_record(player_id))
  with check (public.can_manage_minor_record(player_id) and revoked_by = auth.uid() and revoked_at is not null);

-- Record creators may set the minor flag on records they created and that are
-- not yet claimed (they have no other update path on player_profiles).
drop policy if exists "record creators set minor flag" on public.player_profiles;
create policy "record creators set minor flag" on public.player_profiles for update to authenticated
  using (created_by = auth.uid() and account_id is null)
  with check (created_by = auth.uid() and account_id is null);

-- 2. Guard rails enforced in the database, whichever client writes.
create or replace function public.protect_minor_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_minor is distinct from old.is_minor and old.created_by is distinct from auth.uid() and auth.role() <> 'service_role' then
    raise exception 'only_record_creator_changes_minor_flag';
  end if;
  if new.is_minor and new.is_published and not old.is_published and not public.has_guardian_approval(new.id, 'public') then
    raise exception 'guardian_approval_required_for_public_profile';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_minor_profile_trigger on public.player_profiles;
create trigger protect_minor_profile_trigger before update on public.player_profiles for each row execute function public.protect_minor_profile();

-- 3. Claiming: unchanged except that a minor needs an active guardian approval.
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
  if player.is_minor and not public.has_guardian_approval(p_player_id, 'claim') then
    raise exception 'guardian_approval_required';
  end if;
  update public.player_profiles set account_id = p_account_id, is_claimed = true where id = p_player_id and account_id is null and is_claimed = false;
  if not found then raise exception 'profile_claim_conflict'; end if;
  update public.claim_invitations set accepted_at = now(), confirmation_method = 'verified_email' where id = p_invitation_id and accepted_at is null and revoked_at is null;
  if not found then raise exception 'invitation_claim_conflict'; end if;
  -- An identity key registered against this record now belongs to the account.
  update public.player_identity_keys set linked_account_id = p_account_id where player_id = p_player_id and linked_account_id is null;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (p_account_id, 'player_profile_claimed', 'player_profile', p_player_id, 'Verified invitation claim');
  return p_player_id;
end;
$$;
revoke execute on function public.claim_player_profile(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_player_profile(uuid, uuid, uuid) to service_role;

-- Whether a player record already has an identity key, without exposing it.
create or replace function public.player_identity_status(p_player_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.player_identity_keys k where k.player_id = p_player_id) then 'registered' else 'not_registered' end
  where exists (select 1 from public.player_profiles p where p.id = p_player_id and (p.account_id = auth.uid() or p.created_by = auth.uid()));
$$;
revoke execute on function public.player_identity_status(uuid) from public, anon;
grant execute on function public.player_identity_status(uuid) to authenticated, service_role;

-- 4. Reviewed CSV import provenance: the importer appends one audit row per
--    created record. Only their own rows, only these entity types.
drop policy if exists "importers append import audit" on public.audit_events;
create policy "importers append import audit" on public.audit_events for insert to authenticated
  with check (actor_id = auth.uid() and action = 'csv_import' and entity_type in ('team', 'player_profile'));


-- ===== 202610300027_platform_admin_highlights.sql =====
-- Platform administration and homepage highlights.
-- Review-only; do not apply or push without explicit owner authorization.
--
-- Super Admin is an internal platform role (Product Specification 3.5): it is
-- never available through signup or any client write. The owner grants it by
-- running, in the Supabase SQL editor:
--   insert into public.platform_admins (user_id, note) values ('<auth user id>', 'Owner');
-- Platform admins manage the homepage highlight panel: platform notices,
-- sponsors, promoted tournaments and announcements.

create table if not exists public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
-- A signed-in person may only see whether they themselves are an admin.
-- There is deliberately no insert/update/delete policy: grants happen only
-- through the SQL editor (service role).
drop policy if exists "admins read own admin row" on public.platform_admins;
create policy "admins read own admin row" on public.platform_admins for select to authenticated using (user_id = auth.uid());

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid());
$$;
revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

create table if not exists public.platform_highlights (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('notice', 'sponsor', 'tournament', 'promotion')),
  title text not null check (length(trim(title)) between 1 and 120),
  body text check (body is null or length(body) <= 400),
  image_url text check (image_url is null or image_url ~ '^https://'),
  link_url text check (link_url is null or link_url ~ '^(https://|#)'),
  link_label text check (link_label is null or length(link_label) <= 40),
  tournament_id uuid references public.tournaments(id) on delete set null,
  starts_at timestamptz,
  ends_at timestamptz,
  priority integer not null default 0,
  is_active boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists platform_highlights_live_idx on public.platform_highlights(is_active, priority desc);
alter table public.platform_highlights enable row level security;

-- Everyone (guests included) sees only active highlights inside their window.
drop policy if exists "live highlights are public" on public.platform_highlights;
create policy "live highlights are public" on public.platform_highlights for select to anon, authenticated
  using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
-- Platform admins see and manage every highlight, including drafts.
drop policy if exists "platform admins manage highlights" on public.platform_highlights;
create policy "platform admins manage highlights" on public.platform_highlights for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin() and created_by is not null);

-- Highlight images in the public-media bucket (migration 024), under
-- platform/highlights/. Only platform admins may write there.
drop policy if exists "platform admins upload highlight images" on storage.objects;
create policy "platform admins upload highlight images" on storage.objects for insert to authenticated
  with check (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'platform' and public.is_platform_admin());
drop policy if exists "platform admins remove highlight images" on storage.objects;
create policy "platform admins remove highlight images" on storage.objects for delete to authenticated
  using (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'platform' and public.is_platform_admin());


-- ===== 202610300028_player_profile_details.sql =====
-- Player profile details editable by the player: atoll, preferred foot/hand,
-- jersey number preference, short public biography and social media links.
-- Review-only; do not apply or push without explicit owner authorization.
--
-- These are optional public sports details. They are written through the
-- existing "players update own profile fields" policy (owner only) and are
-- public only when the profile itself is published. Private identity data
-- (date of birth, ID, contact details) stays in player_private_details.

alter table public.player_profiles
  add column if not exists atoll text check (atoll is null or length(atoll) <= 60),
  add column if not exists preferred_side text check (preferred_side is null or preferred_side in ('left', 'right', 'both')),
  add column if not exists jersey_number smallint check (jersey_number is null or jersey_number between 0 and 99),
  add column if not exists bio text check (bio is null or length(bio) <= 400),
  add column if not exists social_links jsonb not null default '{}'::jsonb check (jsonb_typeof(social_links) = 'object');

-- Social links may only point to the supported networks over https; the app
-- validates the same rule before saving.
create or replace function public.valid_social_links(p_links jsonb)
returns boolean language sql immutable as $$
  select coalesce(bool_and(
    key in ('instagram', 'facebook', 'tiktok', 'x', 'youtube')
    and jsonb_typeof(value) = 'string'
    and length(value #>> '{}') <= 200
    and (value #>> '{}') ~ '^https://([a-z0-9-]+\.)?(instagram\.com|facebook\.com|fb\.com|tiktok\.com|x\.com|twitter\.com|youtube\.com|youtu\.be)/'
  ), true)
  from jsonb_each(p_links);
$$;

alter table public.player_profiles drop constraint if exists player_profiles_social_links_valid;
alter table public.player_profiles add constraint player_profiles_social_links_valid check (public.valid_social_links(social_links));


-- ===== 202610300029_player_workspace_sections.sql =====
-- Player workspace sections: team invitations, trophy images and visibility,
-- player documents with review status, and the digital card style.
-- Review-only; do not apply or push without explicit owner authorization.

-- ---------------------------------------------------------------------------
-- 1. Team invitations to a player profile.
--    A team manager invites a player; the player accepts, declines, or reports
--    the invitation as incorrect. Accepting creates a NEW dated membership row
--    and never edits or removes earlier team history.
-- ---------------------------------------------------------------------------
create table if not exists public.player_team_invitations (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  message text check (message is null or length(message) <= 400),
  position text check (position is null or length(position) <= 40),
  jersey_number smallint check (jersey_number is null or jersey_number between 0 and 99),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'reported', 'withdrawn', 'expired')),
  response_note text check (response_note is null or length(response_note) <= 400),
  invited_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days')
);
create unique index if not exists player_team_invitations_one_pending on public.player_team_invitations(player_id, team_id) where status = 'pending';
alter table public.player_team_invitations enable row level security;

drop policy if exists "players read own team invitations" on public.player_team_invitations;
create policy "players read own team invitations" on public.player_team_invitations for select to authenticated
  using (exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()));
drop policy if exists "team managers read team invitations" on public.player_team_invitations;
create policy "team managers read team invitations" on public.player_team_invitations for select to authenticated using (public.is_team_manager(team_id));
drop policy if exists "team managers send invitations" on public.player_team_invitations;
create policy "team managers send invitations" on public.player_team_invitations for insert to authenticated
  with check (invited_by = auth.uid() and status = 'pending' and public.is_team_manager(team_id));
drop policy if exists "team managers withdraw invitations" on public.player_team_invitations;
create policy "team managers withdraw invitations" on public.player_team_invitations for update to authenticated
  using (public.is_team_manager(team_id) and status = 'pending') with check (public.is_team_manager(team_id) and status = 'withdrawn');

-- Players answer only through this function, which also writes the membership.
create or replace function public.respond_team_invitation(p_invitation_id uuid, p_response text, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare invitation public.player_team_invitations;
begin
  if p_response not in ('accepted', 'declined', 'reported') then raise exception 'invalid_response'; end if;
  select * into invitation from public.player_team_invitations where id = p_invitation_id for update;
  if invitation.id is null or not exists (select 1 from public.player_profiles p where p.id = invitation.player_id and p.account_id = auth.uid()) then raise exception 'invitation_not_found'; end if;
  if invitation.status <> 'pending' then raise exception 'invitation_already_answered'; end if;
  if invitation.expires_at <= now() then
    update public.player_team_invitations set status = 'expired' where id = invitation.id;
    raise exception 'invitation_expired';
  end if;
  update public.player_team_invitations set status = p_response, response_note = nullif(trim(coalesce(p_note, '')), ''), responded_at = now() where id = invitation.id;
  if p_response = 'accepted' and not exists (select 1 from public.player_team_memberships m where m.player_id = invitation.player_id and m.team_id = invitation.team_id and m.status = 'active') then
    insert into public.player_team_memberships(player_id, team_id, status, effective_from, source, created_by)
      values (invitation.player_id, invitation.team_id, 'active', current_date, 'manager', invitation.invited_by);
  end if;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
    values (auth.uid(), 'team_invitation_' || p_response, 'player_profile', invitation.player_id, nullif(trim(coalesce(p_note, '')), ''));
  return p_response;
end;
$$;
revoke execute on function public.respond_team_invitation(uuid, text, text) from public, anon;
grant execute on function public.respond_team_invitation(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Trophy cabinet: award images and player-controlled visibility.
-- ---------------------------------------------------------------------------
alter table public.sport_milestones
  add column if not exists image_url text check (image_url is null or image_url ~ '^https://'),
  add column if not exists is_public boolean not null default true;

drop policy if exists "published milestones are public" on public.sport_milestones;
create policy "published milestones are public" on public.sport_milestones for select using (
  is_public and (
    (player_id is not null and exists (select 1 from public.player_profiles p where p.id = player_id and p.is_published))
    or (team_id is not null and exists (select 1 from public.teams t where t.id = team_id and t.is_published))
  )
);

-- The player may hide or show their own achievements; nothing else changes.
create or replace function public.set_milestone_visibility(p_milestone_id uuid, p_public boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.sport_milestones m set is_public = p_public
  where m.id = p_milestone_id and exists (select 1 from public.player_profiles p where p.id = m.player_id and p.account_id = auth.uid());
  if not found then raise exception 'milestone_not_found'; end if;
end;
$$;
revoke execute on function public.set_milestone_visibility(uuid, boolean) from public, anon;
grant execute on function public.set_milestone_visibility(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Player documents with review status.
--    Players upload their own eligibility documents to the private bucket
--    under players/<playerId>/. Only tournament operators change the status.
-- ---------------------------------------------------------------------------
alter table public.private_documents alter column tournament_id drop not null;
alter table public.private_documents
  add column if not exists status text not null default 'uploaded' check (status in ('uploaded', 'under_review', 'changes_requested', 'verified', 'rejected', 'expired')),
  add column if not exists reviewer_note text check (reviewer_note is null or length(reviewer_note) <= 400),
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

drop policy if exists "players manage own documents" on public.private_documents;
create policy "players manage own documents" on public.private_documents for select to authenticated
  using (player_id is not null and exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()));
drop policy if exists "players upload own documents" on public.private_documents;
create policy "players upload own documents" on public.private_documents for insert to authenticated
  with check (uploaded_by = auth.uid() and status = 'uploaded' and player_id is not null and storage_path like 'players/' || player_id::text || '/%'
    and exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()));
drop policy if exists "players remove unreviewed documents" on public.private_documents;
create policy "players remove unreviewed documents" on public.private_documents for delete to authenticated
  using (status in ('uploaded', 'changes_requested', 'rejected') and exists (select 1 from public.player_profiles p where p.id = player_id and p.account_id = auth.uid()));

create or replace function public.protect_document_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.status, new.reviewer_note, new.reviewed_by) is distinct from (old.status, old.reviewer_note, old.reviewed_by)
     and auth.role() <> 'service_role'
     and (new.tournament_id is null or not public.is_tournament_operator(new.tournament_id)) then
    raise exception 'only_tournament_operators_review_documents';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_document_review_trigger on public.private_documents;
create trigger protect_document_review_trigger before update on public.private_documents for each row execute function public.protect_document_review();

-- The original tournament-document policies (0004, 0011) cast the first two
-- path folders to uuid. A players/<id>/ path would make that cast raise and
-- block the upload, so they are recreated with the casts guarded by CASE.
drop policy if exists "authorized users upload tournament documents" on storage.objects;
create policy "authorized users upload tournament documents" on storage.objects for insert to authenticated with check (
  bucket_id = 'tournament-private-documents' and case when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$' then (
    public.is_tournament_operator(((storage.foldername(name))[1])::uuid)
    or (case when (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$' then exists (select 1 from public.tournament_entries e where e.id = ((storage.foldername(name))[2])::uuid and public.is_team_manager(e.team_id)) else false end)
  ) else false end
);
drop policy if exists "authorized users read tournament documents" on storage.objects;
create policy "authorized users read tournament documents" on storage.objects for select to authenticated using (
  bucket_id = 'tournament-private-documents' and case when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$' then (
    public.is_tournament_operator(((storage.foldername(name))[1])::uuid)
    or (case when (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$' then exists (select 1 from public.tournament_entries e where e.id = ((storage.foldername(name))[2])::uuid and public.is_team_manager(e.team_id)) else false end)
  ) else false end
);
drop policy if exists "players upload own document files" on storage.objects;
create policy "players upload own document files" on storage.objects for insert to authenticated
  with check (bucket_id = 'tournament-private-documents' and (storage.foldername(name))[1] = 'players'
    and exists (select 1 from public.player_profiles p where p.id::text = (storage.foldername(name))[2] and p.account_id = auth.uid()));
drop policy if exists "players and operators read player document files" on storage.objects;
create policy "players and operators read player document files" on storage.objects for select to authenticated
  using (bucket_id = 'tournament-private-documents' and (storage.foldername(name))[1] = 'players' and (
    exists (select 1 from public.player_profiles p where p.id::text = (storage.foldername(name))[2] and p.account_id = auth.uid())
    or exists (select 1 from public.private_documents d where d.storage_path = name and d.tournament_id is not null and public.is_tournament_operator(d.tournament_id))
  ));
drop policy if exists "players remove own document files" on storage.objects;
create policy "players remove own document files" on storage.objects for delete to authenticated
  using (bucket_id = 'tournament-private-documents' and (storage.foldername(name))[1] = 'players'
    and exists (select 1 from public.player_profiles p where p.id::text = (storage.foldername(name))[2] and p.account_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Digital card style (one of the approved designs).
-- ---------------------------------------------------------------------------
alter table public.player_profiles add column if not exists card_style text not null default 'classic' check (card_style in ('classic', 'ocean', 'gold', 'night'));


-- ===== 202610300030_player_workspace_complete.sql =====
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


-- ===== 20261030071738_fix_tournament_branding_reads.sql =====
-- Review-only. NOT APPLIED. Do not run against production without the owner's
-- explicit approval. Repairs read access to the private `tournament-media`
-- bucket. No table, column, row, or Storage object is changed; the bucket stays
-- private. Migration 202610240023 is already applied and is left untouched.
--
-- Defect being repaired (verified against the live pg_policies definition):
-- "tournament media public read for published" was written as
--     exists (select 1 from public.tournaments t
--             where t.is_published = true
--               and t.logo_path = name or t.cover_path = name)
-- Inside that subquery the unqualified `name` resolves to tournaments.name (the
-- tournament's display name), not storage.objects.name, and the missing
-- parentheses make the `or` escape the published check. Postgres stored it as
--     ((t.is_published AND t.logo_path = t.name) OR t.cover_path = t.name)
-- so it never matches a real object (guests can never sign a URL), and if any
-- tournament's cover_path ever equalled its own name the policy would expose
-- every object in the bucket regardless of publication.
--
-- Replacement: one SECURITY DEFINER read helper with a fixed search_path that
-- validates the uploaded path shape
--     organizations/{organization_id}/tournaments/{tournament_id}/{logo|cover}/{file}
-- and allows SELECT only when
--   * the caller is a member of the owning organization (same audience as the
--     "organization operators read tournaments" table policy, so draft branding
--     stays visible to the organizers who can already see the draft), or
--   * the tournament is publicly visible (is_published and status <> 'draft',
--     matching "published tournaments are public") AND the object is the
--     tournament's *current* logo_path or cover_path. Replaced or orphaned
--     objects are never readable by guests.
-- The existing write/update/delete policies and the owner/operations read
-- policy are unchanged.

create or replace function public.tournament_media_read_allowed(p_object_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  parts text[];
  org_id uuid;
  tourn_id uuid;
begin
  parts := regexp_match(
    p_object_name,
    '^organizations/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/tournaments/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(logo|cover)/[A-Za-z0-9._-]+$'
  );
  if parts is null then
    return false;
  end if;
  org_id := parts[1]::uuid;
  tourn_id := parts[2]::uuid;
  return exists (
    select 1 from public.tournaments t
    where t.id = tourn_id
      and t.organization_id = org_id
      and (
        exists (
          select 1 from public.organization_memberships om
          where om.organization_id = t.organization_id and om.user_id = auth.uid()
        )
        or (
          t.is_published and t.status <> 'draft'
          and (t.logo_path = p_object_name or t.cover_path = p_object_name)
        )
      )
  );
end;
$$;
revoke execute on function public.tournament_media_read_allowed(text) from public;
grant execute on function public.tournament_media_read_allowed(text) to anon, authenticated, service_role;

drop policy if exists "tournament media public read for published" on storage.objects;

-- `name` here is storage.objects.name: the helper receives the object path, so
-- there is no subquery for the column to be captured by.
create policy "tournament media read for members or published" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'tournament-media' and public.tournament_media_read_allowed(name));


-- ===== 20261030074639_fix_self_join_rls_policies.sql =====
-- Review-only. NOT APPLIED. Do not run against production without the owner's
-- explicit approval. Policy-only: no table, column, row, or function changes.
--
-- Defect being repaired (verified against live pg_policies on 2026-10-30):
-- these policies compare an unqualified column inside an EXISTS subquery, e.g.
--     exists (select 1 from organization_memberships om
--             where om.organization_id = organization_id and ...)
-- Postgres resolves the bare `organization_id` to the subquery's own table, so
-- the stored predicate is `om.organization_id = om.organization_id` - always
-- true. The policy then only checks "the caller has *some* membership", which
-- crosses organization / team boundaries. Live effect before this fix:
--   * tournaments: any member of any organization reads every tournament
--     (including other organizations' private drafts); any owner/operations
--     member of any organization can create tournaments for, and UPDATE,
--     any organization's tournaments.
--   * finance_receipts / finance_expenses: any owner/finance member of any
--     organization can read and write every organization's finance rows.
--   * news_articles: any owner/media/operations member of any organization can
--     manage any organization's news.
--   * organization_team_links: any organization member reads, and any
--     owner/operations member creates, links for every organization.
--   * player_team_memberships: any team member reads/updates/creates player
--     history for every team.
--   * match_player_participants: the "match has a confirmed result" condition
--     is satisfied by any confirmed result anywhere.
--
-- Each policy is recreated with the SAME name, command, roles and conditions;
-- the only change is qualifying the outer column with its table name so the
-- join means what it was written to mean. Nothing is widened.

-- tournaments --------------------------------------------------------------
drop policy if exists "organization operators read tournaments" on public.tournaments;
create policy "organization operators read tournaments" on public.tournaments for select using (
  exists (select 1 from public.organization_memberships om
          where om.organization_id = tournaments.organization_id and om.user_id = auth.uid())
);

drop policy if exists "organization operators create tournaments" on public.tournaments;
create policy "organization operators create tournaments" on public.tournaments for insert with check (
  created_by = auth.uid() and exists (
    select 1 from public.organization_memberships om
    where om.organization_id = tournaments.organization_id and om.user_id = auth.uid() and om.role in ('owner','operations')
  )
);

drop policy if exists "organization operators update tournaments" on public.tournaments;
create policy "organization operators update tournaments" on public.tournaments for update using (
  exists (select 1 from public.organization_memberships om
          where om.organization_id = tournaments.organization_id and om.user_id = auth.uid() and om.role in ('owner','operations'))
);

-- finance ------------------------------------------------------------------
drop policy if exists "finance staff manage receipts" on public.finance_receipts;
create policy "finance staff manage receipts" on public.finance_receipts for all to authenticated
  using (
    public.has_tournament_permission(tournament_id, 'finance')
    or exists (select 1 from public.organization_memberships om
               where om.organization_id = finance_receipts.organization_id and om.user_id = auth.uid() and om.role in ('owner','finance'))
  )
  with check (
    issued_by = auth.uid() and (
      public.has_tournament_permission(tournament_id, 'finance')
      or exists (select 1 from public.organization_memberships om
                 where om.organization_id = finance_receipts.organization_id and om.user_id = auth.uid() and om.role in ('owner','finance'))
    )
  );

drop policy if exists "finance staff manage expenses" on public.finance_expenses;
create policy "finance staff manage expenses" on public.finance_expenses for all to authenticated
  using (
    public.has_tournament_permission(tournament_id, 'finance')
    or (tournament_id is null and exists (select 1 from public.organization_memberships om
        where om.organization_id = finance_expenses.organization_id and om.user_id = auth.uid() and om.role in ('owner','finance')))
  )
  with check (
    created_by = auth.uid() and (
      public.has_tournament_permission(tournament_id, 'finance')
      or (tournament_id is null and exists (select 1 from public.organization_memberships om
          where om.organization_id = finance_expenses.organization_id and om.user_id = auth.uid() and om.role in ('owner','finance')))
    )
  );

-- news ---------------------------------------------------------------------
drop policy if exists "media roles manage organization news" on public.news_articles;
create policy "media roles manage organization news" on public.news_articles for all to authenticated
  using (
    (news_articles.organization_id is not null and exists (select 1 from public.organization_memberships om
      where om.organization_id = news_articles.organization_id and om.user_id = auth.uid() and om.role in ('owner','media','operations')))
    or (tournament_id is not null and (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'media')))
    or author_id = auth.uid()
  )
  with check (
    (news_articles.organization_id is not null and exists (select 1 from public.organization_memberships om
      where om.organization_id = news_articles.organization_id and om.user_id = auth.uid() and om.role in ('owner','media','operations')))
    or (tournament_id is not null and (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'media')))
    or author_id = auth.uid()
  );

-- organization team links --------------------------------------------------
drop policy if exists "organization operators read team links" on public.organization_team_links;
create policy "organization operators read team links" on public.organization_team_links for select using (
  exists (select 1 from public.organization_memberships om
          where om.organization_id = organization_team_links.organization_id and om.user_id = auth.uid())
);

drop policy if exists "organization operators create team links" on public.organization_team_links;
create policy "organization operators create team links" on public.organization_team_links for insert with check (
  linked_by = auth.uid() and exists (
    select 1 from public.organization_memberships om
    where om.organization_id = organization_team_links.organization_id and om.user_id = auth.uid() and om.role in ('owner','operations')
  )
);

-- player team memberships --------------------------------------------------
drop policy if exists "team managers read their player history" on public.player_team_memberships;
create policy "team managers read their player history" on public.player_team_memberships for select using (
  exists (select 1 from public.team_memberships tm
          where tm.team_id = player_team_memberships.team_id and tm.user_id = auth.uid())
);

drop policy if exists "team managers end player memberships" on public.player_team_memberships;
create policy "team managers end player memberships" on public.player_team_memberships for update to authenticated
  using (exists (select 1 from public.team_memberships tm
                 where tm.team_id = player_team_memberships.team_id and tm.user_id = auth.uid()))
  with check (exists (select 1 from public.team_memberships tm
                      where tm.team_id = player_team_memberships.team_id and tm.user_id = auth.uid()));

drop policy if exists "authorized users create player history" on public.player_team_memberships;
create policy "authorized users create player history" on public.player_team_memberships for insert with check (
  created_by = auth.uid() and (
    exists (select 1 from public.teams t where t.id = player_team_memberships.team_id and t.created_by = auth.uid())
    or exists (select 1 from public.team_memberships tm where tm.team_id = player_team_memberships.team_id and tm.user_id = auth.uid())
  )
);

-- match appearances --------------------------------------------------------
drop policy if exists "participants read confirmed appearances" on public.match_player_participants;
create policy "participants read confirmed appearances" on public.match_player_participants for select to authenticated using (
  exists (select 1 from public.match_result_versions rv
          where rv.match_id = match_player_participants.match_id and rv.status = 'confirmed')
  and (
    public.is_match_participant(match_id)
    or (
      exists (select 1 from public.player_profiles p where p.id = match_player_participants.player_id and p.is_published)
      and exists (select 1 from public.matches m join public.tournaments t on t.id = m.tournament_id
                  where m.id = match_player_participants.match_id and t.is_published)
    )
  )
);

drop policy if exists "players read own confirmed appearances" on public.match_player_participants;
create policy "players read own confirmed appearances" on public.match_player_participants for select to authenticated using (
  exists (select 1 from public.player_profiles p where p.id = match_player_participants.player_id and p.account_id = auth.uid())
  and exists (select 1 from public.match_result_versions rv
              where rv.match_id = match_player_participants.match_id and rv.status = 'confirmed')
);


-- ===== 20261030213640_player_workspace_final.sql =====
-- ===========================================================================
-- Player Workspace, final specification (created with: supabase migration new player_workspace_final)
-- ===========================================================================
-- Review-only. Depends on 013, 026, 029 and 030 (it does not depend on 031–033).
--
--   1. Public player code (KHP-000184): a stable public identifier for the
--      digital card. It is not the database key, not the national ID, and it
--      cannot be changed once issued.
--   2. Request types for identity, roster, duplicate-profile, privacy,
--      data-copy and account-closure requests.
--   3. Player activity: a private log written by the database itself when
--      the player's own records change, so the history cannot be forged from
--      the browser. It records labels only — never claim tokens, national IDs,
--      file paths or other users' information.
--   4. Match availability: the player's own answer for an upcoming match.
--      A private reason is readable only by the player and the managers of
--      the team the player plays for in that match.
--   5. Digital card choices: published team shown, photo position and the
--      statistics row. The card itself is always built from official data.
-- ===========================================================================

-- 1. Public player code ----------------------------------------------------------
create sequence if not exists public.player_public_code_seq;
alter table public.player_profiles add column if not exists public_code text;

-- Existing players get codes in creation order.
with ordered as (
  select id from public.player_profiles where public_code is null order by created_at, id
)
update public.player_profiles p set public_code = 'KHP-' || lpad(nextval('public.player_public_code_seq')::text, 6, '0')
from ordered where p.id = ordered.id;

alter table public.player_profiles alter column public_code set default ('KHP-' || lpad(nextval('public.player_public_code_seq')::text, 6, '0'));
alter table public.player_profiles alter column public_code set not null;
create unique index if not exists player_profiles_public_code_key on public.player_profiles(public_code);

create or replace function public.protect_player_public_code()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.public_code is distinct from old.public_code then raise exception 'public_code_is_permanent'; end if;
  return new;
end;
$$;
drop trigger if exists protect_player_public_code_trigger on public.player_profiles;
create trigger protect_player_public_code_trigger before update of public_code on public.player_profiles for each row execute function public.protect_player_public_code();

-- 2. More request types ------------------------------------------------------------
alter table public.player_correction_requests drop constraint if exists player_correction_requests_request_type_check;
alter table public.player_correction_requests add constraint player_correction_requests_request_type_check
  check (request_type in ('profile', 'statistics', 'team_history', 'document', 'verification', 'impersonation', 'team_contact', 'organizer_contact', 'account_support',
    'identity', 'roster', 'duplicate_profile', 'privacy', 'data_copy', 'account_closure'));

-- 3. Player activity -----------------------------------------------------------------
create table if not exists public.player_activity (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event text not null check (event ~ '^[a-z_]{3,48}$'),
  detail text check (detail is null or length(detail) <= 160),
  created_at timestamptz not null default now()
);
create index if not exists player_activity_player_idx on public.player_activity(player_id, created_at desc);
alter table public.player_activity enable row level security;
drop policy if exists "players read own activity" on public.player_activity;
create policy "players read own activity" on public.player_activity for select to authenticated
  using (exists (select 1 from public.player_profiles p where p.id = player_activity.player_id and p.account_id = (select auth.uid())));
-- The only events the browser may add are the player's own card actions.
drop policy if exists "players log own card actions" on public.player_activity;
create policy "players log own card actions" on public.player_activity for insert to authenticated
  with check (actor_id = (select auth.uid()) and event in ('card_downloaded', 'card_shared', 'card_printed') and detail is null
    and exists (select 1 from public.player_profiles p where p.id = player_activity.player_id and p.account_id = (select auth.uid())));

create or replace function public.log_player_activity(p_player_id uuid, p_event text, p_detail text)
returns void language sql security definer set search_path = public as $$
  insert into public.player_activity(player_id, actor_id, event, detail) values (p_player_id, auth.uid(), p_event, left(p_detail, 160));
$$;
revoke execute on function public.log_player_activity(uuid, text, text) from public, anon, authenticated;

-- Profile: publish/unpublish, or a change to the sports profile.
create or replace function public.track_player_profile_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ignored text[] := array['updated_at', 'is_published', 'card_style', 'card_team_id', 'card_photo_y', 'card_stat_variant', 'account_id', 'public_code', 'is_claimed'];
begin
  if new.is_published is distinct from old.is_published then
    perform public.log_player_activity(new.id, case when new.is_published then 'profile_published' else 'profile_unpublished' end, null);
  end if;
  if new.account_id is distinct from old.account_id and new.account_id is not null then
    perform public.log_player_activity(new.id, 'profile_claimed', null);
  end if;
  if (to_jsonb(new) - ignored) is distinct from (to_jsonb(old) - ignored) then
    perform public.log_player_activity(new.id, 'profile_updated', null);
  end if;
  return new;
end;
$$;
drop trigger if exists track_player_profile_activity_trigger on public.player_profiles;
create trigger track_player_profile_activity_trigger after update on public.player_profiles for each row execute function public.track_player_profile_activity();

-- Privacy: hiding or showing the biography (hidden_bio, migration 030).
create or replace function public.track_player_privacy_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (to_jsonb(new)->>'hidden_bio') is distinct from (to_jsonb(old)->>'hidden_bio') then
    perform public.log_player_activity(new.player_id, 'privacy_changed', case when to_jsonb(new)->>'hidden_bio' is null then 'Biography shown' else 'Biography hidden' end);
  end if;
  return new;
end;
$$;
drop trigger if exists track_player_privacy_activity_trigger on public.player_private_details;
create trigger track_player_privacy_activity_trigger after update on public.player_private_details for each row execute function public.track_player_privacy_activity();

-- Team invitations: the player's answer.
create or replace function public.track_player_invitation_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('accepted', 'declined', 'reported') then
    perform public.log_player_activity(new.player_id, 'invitation_' || new.status, (select t.name from public.teams t where t.id = new.team_id));
  end if;
  return new;
end;
$$;
drop trigger if exists track_player_invitation_activity_trigger on public.player_team_invitations;
create trigger track_player_invitation_activity_trigger after update on public.player_team_invitations for each row execute function public.track_player_invitation_activity();

-- Join requests: sent, and the team's decision.
create or replace function public.track_player_join_request_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_player_activity(new.player_id, 'join_request_submitted', (select t.name from public.teams t where t.id = new.team_id));
  elsif new.status is distinct from old.status then
    perform public.log_player_activity(new.player_id, 'join_request_' || new.status, (select t.name from public.teams t where t.id = new.team_id));
  end if;
  return new;
end;
$$;
drop trigger if exists track_player_join_request_activity_trigger on public.player_team_requests;
create trigger track_player_join_request_activity_trigger after insert or update on public.player_team_requests for each row execute function public.track_player_join_request_activity();

-- Documents: uploaded, reviewed, removed. The label is the document type, never the file path.
create or replace function public.track_player_document_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.player_id is not null then
    perform public.log_player_activity(new.player_id, 'document_uploaded', new.document_type);
  elsif tg_op = 'UPDATE' and new.player_id is not null and new.status is distinct from old.status then
    perform public.log_player_activity(new.player_id, 'document_' || new.status, new.document_type);
  elsif tg_op = 'DELETE' and old.player_id is not null then
    perform public.log_player_activity(old.player_id, 'document_removed', old.document_type);
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists track_player_document_activity_trigger on public.private_documents;
create trigger track_player_document_activity_trigger after insert or update or delete on public.private_documents for each row execute function public.track_player_document_activity();

-- Correction and other requests: sent, and each decision.
create or replace function public.track_player_request_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_player_activity(new.player_id, 'request_submitted', new.request_type);
  elsif new.status is distinct from old.status then
    perform public.log_player_activity(new.player_id, 'request_' || new.status, new.request_type);
  end if;
  return new;
end;
$$;
drop trigger if exists track_player_request_activity_trigger on public.player_correction_requests;
create trigger track_player_request_activity_trigger after insert or update on public.player_correction_requests for each row execute function public.track_player_request_activity();

-- 4. Match availability ------------------------------------------------------------------
create table if not exists public.player_match_availability (
  player_id uuid not null references public.player_profiles(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  status text not null check (status in ('available', 'unavailable', 'maybe', 'injured', 'suspended', 'other')),
  private_reason text check (private_reason is null or length(private_reason) <= 200),
  updated_at timestamptz not null default now(),
  primary key (player_id, match_id)
);
alter table public.player_match_availability enable row level security;

-- The player, for a match of a team they actively belong to, before it is played.
create or replace function public.can_set_match_availability(p_player_id uuid, p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.player_profiles p
    join public.matches m on m.id = p_match_id and m.status in ('scheduled', 'postponed')
    join public.player_team_memberships ms on ms.player_id = p.id and ms.status in ('active', 'loaned') and ms.team_id in (m.home_team_id, m.away_team_id)
    where p.id = p_player_id and p.account_id = auth.uid()
  );
$$;
revoke execute on function public.can_set_match_availability(uuid, uuid) from public, anon;
grant execute on function public.can_set_match_availability(uuid, uuid) to authenticated, service_role;

-- Team managers of the player's team in that match.
create or replace function public.manages_player_in_match(p_player_id uuid, p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.matches m
    join public.player_team_memberships ms on ms.player_id = p_player_id and ms.status in ('active', 'loaned') and ms.team_id in (m.home_team_id, m.away_team_id)
    where m.id = p_match_id and public.is_team_manager(ms.team_id)
  );
$$;
revoke execute on function public.manages_player_in_match(uuid, uuid) from public, anon;
grant execute on function public.manages_player_in_match(uuid, uuid) to authenticated, service_role;

drop policy if exists "players read own availability" on public.player_match_availability;
create policy "players read own availability" on public.player_match_availability for select to authenticated
  using (exists (select 1 from public.player_profiles p where p.id = player_match_availability.player_id and p.account_id = (select auth.uid())));
drop policy if exists "team managers read player availability" on public.player_match_availability;
create policy "team managers read player availability" on public.player_match_availability for select to authenticated
  using (public.manages_player_in_match(player_match_availability.player_id, player_match_availability.match_id));
drop policy if exists "players set own availability" on public.player_match_availability;
create policy "players set own availability" on public.player_match_availability for insert to authenticated
  with check (public.can_set_match_availability(player_match_availability.player_id, player_match_availability.match_id));
drop policy if exists "players change own availability" on public.player_match_availability;
create policy "players change own availability" on public.player_match_availability for update to authenticated
  using (public.can_set_match_availability(player_match_availability.player_id, player_match_availability.match_id))
  with check (public.can_set_match_availability(player_match_availability.player_id, player_match_availability.match_id));

-- 5. Digital card choices -------------------------------------------------------------------
alter table public.player_profiles
  add column if not exists card_team_id uuid references public.teams(id) on delete set null,
  add column if not exists card_photo_y smallint check (card_photo_y is null or card_photo_y between 0 and 100),
  add column if not exists card_stat_variant text check (card_stat_variant is null or card_stat_variant in ('attack', 'discipline'));

-- The card may only show a published team the player belongs (or belonged) to.
create or replace function public.protect_player_card_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.card_team_id is not null and new.card_team_id is distinct from old.card_team_id and not exists (
    select 1 from public.player_team_memberships ms join public.teams t on t.id = ms.team_id and t.is_published
    where ms.player_id = new.id and ms.team_id = new.card_team_id
  ) then
    raise exception 'card_team_not_allowed';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_player_card_team_trigger on public.player_profiles;
create trigger protect_player_card_team_trigger before update of card_team_id on public.player_profiles for each row execute function public.protect_player_card_team();


-- ===== 202610310031_team_workspace_complete.sql =====
-- Team workspace completion (review-only; the owner applies it).
--
-- 1) Team profile: atoll, sports, founding year, colours, home venue, social
--    links, optional public contact, logo/cover storage paths, verification
--    (platform admins only) and the extra team types. Manager-only private
--    details live in team_private_details.
-- 2) Staff and permissions: new staff roles with per-member permissions.
--    The team owner is teams.created_by. is_team_manager keeps its meaning for
--    the existing roles (manager, staff) and the new management roles; coach,
--    medical, media and finance staff get only the permissions they are given.
--    Staff, ownership, archive and leave actions go through audited functions.
-- 3) Players: position, jersey number and captaincy on a membership; ending a
--    membership takes a date and a private reason (kept in the audit log); a
--    record creator may delete an unclaimed record that has no history (used
--    when the identity check finds a duplicate); join requests can ask for
--    more information.
-- 4) get_team_workspace_matches / get_team_match_participants: the team's own
--    fixtures with opponent, stage and group names and confirmed scores,
--    readable by team staff even when the opponent is not published.
-- 5) Rosters: captain and goalkeeper flags, and submit_roster_players, which
--    validates limits, unique shirt numbers, active membership and a single
--    captain before writing a new version (older versions are kept).
-- 6) team_result_reports: a team's correction report on a result; the
--    tournament's operators decide.
-- 7) Team finance and team documents in a private bucket, visible only to
--    staff with the matching permission. Finance rows are voided, never deleted.

-- 1 -------------------------------------------------------------------------
alter table public.teams
  add column if not exists atoll text,
  add column if not exists sports text[] not null default '{}',
  add column if not exists established_year smallint,
  add column if not exists primary_color text,
  add column if not exists secondary_color text,
  add column if not exists home_venue text,
  add column if not exists social_links jsonb not null default '{}'::jsonb,
  add column if not exists public_contact text,
  add column if not exists show_public_contact boolean not null default false,
  add column if not exists logo_path text,
  add column if not exists cover_path text,
  add column if not exists cover_url text,
  add column if not exists is_verified boolean not null default false;
alter table public.teams drop constraint if exists teams_team_type_check;
alter table public.teams add constraint teams_team_type_check
  check (team_type in ('club', 'island', 'atoll', 'national', 'school', 'community', 'corporate', 'other'));
alter table public.teams drop constraint if exists teams_established_year_check;
alter table public.teams add constraint teams_established_year_check check (established_year is null or established_year between 1900 and 2100);
alter table public.teams drop constraint if exists teams_colors_check;
alter table public.teams add constraint teams_colors_check
  check ((primary_color is null or primary_color ~ '^#[0-9a-fA-F]{6}$') and (secondary_color is null or secondary_color ~ '^#[0-9a-fA-F]{6}$'));
alter table public.teams drop constraint if exists teams_social_links_check;
alter table public.teams add constraint teams_social_links_check check (jsonb_typeof(social_links) = 'object');

create or replace function public.protect_team_verification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_verified is distinct from old.is_verified and not public.is_platform_admin() and auth.role() <> 'service_role' then
    raise exception 'only_platform_admins_verify_teams';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_team_verification on public.teams;
create trigger protect_team_verification before update on public.teams for each row execute function public.protect_team_verification();

-- 2 -------------------------------------------------------------------------
alter table public.team_memberships add column if not exists permissions text[] not null default '{}';
alter table public.team_memberships drop constraint if exists team_memberships_role_check;
alter table public.team_memberships add constraint team_memberships_role_check
  check (role in ('manager', 'staff', 'assistant_manager', 'coach', 'medical', 'media', 'finance', 'roster_admin'));
alter table public.team_memberships drop constraint if exists team_memberships_permissions_check;
alter table public.team_memberships add constraint team_memberships_permissions_check
  check (permissions <@ array['edit_profile', 'manage_players', 'send_invitations', 'manage_applications', 'manage_rosters', 'view_documents', 'manage_finance', 'publish_content', 'manage_staff']::text[]);

create or replace function public.team_role_default_permissions(p_role text)
returns text[] language sql immutable as $$
  select case p_role
    when 'manager' then array['edit_profile', 'manage_players', 'send_invitations', 'manage_applications', 'manage_rosters', 'view_documents', 'manage_finance', 'publish_content', 'manage_staff']
    when 'staff' then array['edit_profile', 'manage_players', 'send_invitations', 'manage_applications', 'manage_rosters', 'view_documents', 'publish_content']
    when 'assistant_manager' then array['edit_profile', 'manage_players', 'send_invitations', 'manage_applications', 'manage_rosters', 'view_documents']
    when 'roster_admin' then array['manage_players', 'manage_rosters']
    when 'coach' then array['manage_rosters']
    when 'medical' then array['view_documents']
    when 'media' then array['publish_content']
    when 'finance' then array['manage_finance']
    else array[]::text[] end;
$$;

create or replace function public.team_effective_permissions(p_role text, p_permissions text[])
returns text[] language sql immutable as $$
  select case when p_role = 'manager' then public.team_role_default_permissions('manager')
              when coalesce(array_length(p_permissions, 1), 0) = 0 then public.team_role_default_permissions(p_role)
              else p_permissions end;
$$;

create or replace function public.is_team_owner(p_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teams t where t.id = p_team_id and t.created_by = auth.uid());
$$;
revoke execute on function public.is_team_owner(uuid) from public, anon;
grant execute on function public.is_team_owner(uuid) to authenticated, service_role;

create or replace function public.team_has_permission(p_team_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_team_owner(p_team_id) or exists (
    select 1 from public.team_memberships tm
    where tm.team_id = p_team_id and tm.user_id = auth.uid()
      and p_permission = any(public.team_effective_permissions(tm.role, tm.permissions))
  );
$$;
revoke execute on function public.team_has_permission(uuid, text) from public, anon;
grant execute on function public.team_has_permission(uuid, text) to authenticated, service_role;

-- Broad management keeps working for the existing roles; specialist staff
-- receive only their own permissions.
create or replace function public.is_team_manager(p_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_memberships where team_id = p_team_id and user_id = auth.uid() and role in ('manager', 'staff', 'assistant_manager', 'roster_admin'));
$$;

drop policy if exists "team managers update their team" on public.teams;
create policy "team managers update their team" on public.teams for update to authenticated
  using (public.team_has_permission(id, 'edit_profile')) with check (public.team_has_permission(id, 'edit_profile'));

create table if not exists public.team_private_details (
  team_id uuid primary key references public.teams(id) on delete cascade,
  manager_legal_name text,
  manager_phone text,
  internal_email text,
  private_notes text check (private_notes is null or char_length(private_notes) <= 2000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.team_private_details enable row level security;
drop policy if exists "team profile editors read private details" on public.team_private_details;
create policy "team profile editors read private details" on public.team_private_details for select to authenticated using (public.team_has_permission(team_id, 'edit_profile'));
drop policy if exists "team profile editors write private details" on public.team_private_details;
create policy "team profile editors write private details" on public.team_private_details for insert to authenticated with check (public.team_has_permission(team_id, 'edit_profile'));
drop policy if exists "team profile editors update private details" on public.team_private_details;
create policy "team profile editors update private details" on public.team_private_details for update to authenticated using (public.team_has_permission(team_id, 'edit_profile')) with check (public.team_has_permission(team_id, 'edit_profile'));

create or replace function public.get_team_staff(p_team_id uuid)
returns table(user_id uuid, display_name text, role text, permissions text[], is_owner boolean, is_self boolean, joined_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.team_memberships m where m.team_id = p_team_id and m.user_id = auth.uid()) and not public.is_team_owner(p_team_id) then
    raise exception 'not_team_staff';
  end if;
  return query
  select tm.user_id, coalesce(nullif(p.display_name, ''), 'Team member'), tm.role, public.team_effective_permissions(tm.role, tm.permissions),
    (t.created_by = tm.user_id), (tm.user_id = auth.uid()), tm.created_at
  from public.team_memberships tm
  join public.teams t on t.id = tm.team_id
  left join public.profiles p on p.id = tm.user_id
  where tm.team_id = p_team_id
  order by (t.created_by = tm.user_id) desc, tm.created_at;
end;
$$;
revoke execute on function public.get_team_staff(uuid) from public, anon;
grant execute on function public.get_team_staff(uuid) to authenticated, service_role;

create or replace function public.set_team_staff(p_team_id uuid, p_user_id uuid, p_role text, p_permissions text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  permission text;
  wanted text[] := coalesce(p_permissions, '{}');
begin
  if not public.team_has_permission(p_team_id, 'manage_staff') then raise exception 'manage_staff_required'; end if;
  if exists (select 1 from public.teams t where t.id = p_team_id and t.created_by = p_user_id) and not public.is_team_owner(p_team_id) then raise exception 'owner_cannot_be_changed'; end if;
  if p_role = 'manager' and not public.is_team_owner(p_team_id) and not exists (select 1 from public.team_memberships m where m.team_id = p_team_id and m.user_id = auth.uid() and m.role = 'manager') then
    raise exception 'only_managers_appoint_managers';
  end if;
  -- Staff cannot hand out a permission they do not hold themselves.
  foreach permission in array public.team_effective_permissions(p_role, wanted) loop
    if not public.team_has_permission(p_team_id, permission) then raise exception 'cannot_grant_%', permission; end if;
  end loop;
  update public.team_memberships set role = p_role, permissions = case when p_role = 'manager' then '{}' else wanted end
  where team_id = p_team_id and user_id = p_user_id;
  if not found then raise exception 'not_team_staff'; end if;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), 'team_staff_permissions_changed', 'team', p_team_id, format('%s → %s (%s)', p_user_id, p_role, array_to_string(public.team_effective_permissions(p_role, wanted), ', ')));
end;
$$;
revoke execute on function public.set_team_staff(uuid, uuid, text, text[]) from public, anon;
grant execute on function public.set_team_staff(uuid, uuid, text, text[]) to authenticated, service_role;

create or replace function public.remove_team_staff(p_team_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.teams t where t.id = p_team_id and t.created_by = p_user_id) then raise exception 'owner_must_transfer_first'; end if;
  if p_user_id <> auth.uid() and not public.team_has_permission(p_team_id, 'manage_staff') then raise exception 'manage_staff_required'; end if;
  delete from public.team_memberships where team_id = p_team_id and user_id = p_user_id;
  if not found then raise exception 'not_team_staff'; end if;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), case when p_user_id = auth.uid() then 'team_staff_left' else 'team_staff_removed' end, 'team', p_team_id, p_user_id::text);
end;
$$;
revoke execute on function public.remove_team_staff(uuid, uuid) from public, anon;
grant execute on function public.remove_team_staff(uuid, uuid) to authenticated, service_role;

create or replace function public.transfer_team_ownership(p_team_id uuid, p_new_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_owner(p_team_id) then raise exception 'only_owner_transfers'; end if;
  if not exists (select 1 from public.team_memberships m where m.team_id = p_team_id and m.user_id = p_new_owner) then raise exception 'new_owner_must_be_staff'; end if;
  update public.teams set created_by = p_new_owner where id = p_team_id;
  update public.team_memberships set role = 'manager', permissions = '{}' where team_id = p_team_id and user_id = p_new_owner;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (auth.uid(), 'team_ownership_transferred', 'team', p_team_id, p_new_owner::text);
end;
$$;
revoke execute on function public.transfer_team_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_team_ownership(uuid, uuid) to authenticated, service_role;

-- Archiving keeps every record; it only unpublishes and marks the team inactive.
create or replace function public.set_team_archived(p_team_id uuid, p_archived boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_team_owner(p_team_id) or exists (select 1 from public.team_memberships m where m.team_id = p_team_id and m.user_id = auth.uid() and m.role = 'manager')) then raise exception 'only_owner_or_manager_archives'; end if;
  if p_archived and coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  update public.teams set deactivated_at = case when p_archived then now() else null end, is_published = case when p_archived then false else is_published end where id = p_team_id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (auth.uid(), case when p_archived then 'team_archived' else 'team_restored' end, 'team', p_team_id, nullif(btrim(p_reason), ''));
end;
$$;
revoke execute on function public.set_team_archived(uuid, boolean, text) from public, anon;
grant execute on function public.set_team_archived(uuid, boolean, text) to authenticated, service_role;

create or replace function public.get_team_audit(p_team_id uuid)
returns table(action text, reason text, actor_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.team_has_permission(p_team_id, 'manage_staff') then raise exception 'manage_staff_required'; end if;
  return query
  select a.action, a.reason, coalesce(nullif(p.display_name, ''), 'Team member'), a.created_at
  from public.audit_events a left join public.profiles p on p.id = a.actor_id
  where (a.entity_type = 'team' and a.entity_id = p_team_id)
     or (a.entity_type = 'team_membership' and a.entity_id in (select ms.id from public.player_team_memberships ms where ms.team_id = p_team_id))
  order by a.created_at desc limit 100;
end;
$$;
revoke execute on function public.get_team_audit(uuid) from public, anon;
grant execute on function public.get_team_audit(uuid) to authenticated, service_role;

-- 3 -------------------------------------------------------------------------
alter table public.player_team_memberships
  add column if not exists position text,
  add column if not exists jersey_number smallint,
  add column if not exists squad_role text not null default 'player';
alter table public.player_team_memberships drop constraint if exists player_team_memberships_details_check;
alter table public.player_team_memberships add constraint player_team_memberships_details_check
  check ((jersey_number is null or jersey_number between 0 and 99) and squad_role in ('player', 'captain', 'vice_captain') and (position is null or char_length(position) <= 40));

create or replace function public.update_team_membership(p_membership_id uuid, p_position text, p_jersey_number smallint, p_squad_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  membership public.player_team_memberships;
begin
  select * into membership from public.player_team_memberships where id = p_membership_id for update;
  if membership.id is null or not public.team_has_permission(membership.team_id, 'manage_players') then raise exception 'manage_players_required'; end if;
  if membership.status = 'ended' then raise exception 'membership_ended'; end if;
  if p_jersey_number is not null and exists (select 1 from public.player_team_memberships o where o.team_id = membership.team_id and o.id <> membership.id and o.status <> 'ended' and o.jersey_number = p_jersey_number) then
    raise exception 'jersey_number_taken';
  end if;
  -- One captain and one vice-captain at a time.
  if p_squad_role in ('captain', 'vice_captain') then
    update public.player_team_memberships set squad_role = 'player' where team_id = membership.team_id and id <> membership.id and squad_role = p_squad_role;
  end if;
  update public.player_team_memberships set position = nullif(btrim(p_position), ''), jersey_number = p_jersey_number, squad_role = coalesce(p_squad_role, 'player') where id = membership.id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (auth.uid(), 'team_membership_updated', 'team_membership', membership.id, format('position=%s jersey=%s role=%s', coalesce(p_position, '-'), coalesce(p_jersey_number::text, '-'), coalesce(p_squad_role, 'player')));
end;
$$;
revoke execute on function public.update_team_membership(uuid, text, smallint, text) from public, anon;
grant execute on function public.update_team_membership(uuid, text, smallint, text) to authenticated, service_role;

create or replace function public.end_team_membership(p_membership_id uuid, p_end_date date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  membership public.player_team_memberships;
begin
  select * into membership from public.player_team_memberships where id = p_membership_id for update;
  if membership.id is null or not public.team_has_permission(membership.team_id, 'manage_players') then raise exception 'manage_players_required'; end if;
  if membership.status = 'ended' then raise exception 'membership_already_ended'; end if;
  if p_end_date is null or p_end_date < membership.effective_from then raise exception 'end_date_before_start'; end if;
  update public.player_team_memberships set status = 'ended', effective_to = p_end_date, squad_role = 'player' where id = membership.id;
  -- The reason stays private: audit rows are readable only through get_team_audit.
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (auth.uid(), 'team_membership_ended', 'team_membership', membership.id, nullif(btrim(p_reason), ''));
end;
$$;
revoke execute on function public.end_team_membership(uuid, date, text) from public, anon;
grant execute on function public.end_team_membership(uuid, date, text) to authenticated, service_role;

drop policy if exists "record creators delete unused unclaimed players" on public.player_profiles;
create policy "record creators delete unused unclaimed players" on public.player_profiles for delete to authenticated using (
  created_by = auth.uid() and account_id is null and is_claimed = false and created_at > now() - interval '1 day'
  and not exists (select 1 from public.player_team_memberships ms where ms.player_id = player_profiles.id)
  and not exists (select 1 from public.match_player_participants mp where mp.player_id = player_profiles.id)
);

-- Invitations may name the sport the player is invited for.
alter table public.player_team_invitations add column if not exists sport text;

alter table public.player_team_requests drop constraint if exists player_team_requests_status_check;
alter table public.player_team_requests add constraint player_team_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'info_requested'));

-- 4 -------------------------------------------------------------------------
create or replace function public.get_team_workspace_matches(p_team_id uuid)
returns table(
  match_id uuid, tournament_id uuid, tournament_name text, tournament_slug text, tournament_published boolean, sport text,
  stage_name text, group_name text, scheduled_at timestamptz, venue text, status text, is_home boolean,
  opponent_id uuid, opponent_name text, opponent_logo text, team_score numeric, opponent_score numeric,
  result_confirmed boolean, confirmed_at timestamptz, yellow_cards bigint, red_cards bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.team_memberships m where m.team_id = p_team_id and m.user_id = auth.uid()) and not public.is_team_owner(p_team_id) then
    raise exception 'not_team_staff';
  end if;
  return query
  with mine as (
    select m.* from public.matches m where p_team_id in (m.home_team_id, m.away_team_id)
  ), latest as (
    select distinct on (v.match_id) v.match_id, v.score, v.created_at
    from public.match_result_versions v join mine on mine.id = v.match_id
    where v.status = 'confirmed' order by v.match_id, v.version desc
  ), cards as (
    select e.match_id,
      count(*) filter (where e.event_type = 'yellow_card') as yellow,
      count(*) filter (where e.event_type in ('red_card', 'blue_card')) as red
    from public.match_events e join latest l on l.match_id = e.match_id
    where e.team_id = p_team_id group by e.match_id
  )
  select m.id, m.tournament_id, tr.name, tr.slug, (tr.is_published and tr.status <> 'draft'), tr.sport,
    st.name, g.name, m.scheduled_at, m.venue, m.status, (m.home_team_id = p_team_id),
    o.id, o.name, o.logo_url,
    case when m.status = 'confirmed' and jsonb_typeof(l.score->'home') = 'number' and jsonb_typeof(l.score->'away') = 'number'
      then (case when m.home_team_id = p_team_id then l.score->>'home' else l.score->>'away' end)::numeric end,
    case when m.status = 'confirmed' and jsonb_typeof(l.score->'home') = 'number' and jsonb_typeof(l.score->'away') = 'number'
      then (case when m.home_team_id = p_team_id then l.score->>'away' else l.score->>'home' end)::numeric end,
    (m.status = 'confirmed' and l.match_id is not null), l.created_at,
    coalesce(c.yellow, 0)::bigint, coalesce(c.red, 0)::bigint
  from mine m
  join public.tournaments tr on tr.id = m.tournament_id
  left join public.competition_stages st on st.id = m.stage_id
  left join public.competition_groups g on g.id = m.group_id
  left join public.teams o on o.id = case when m.home_team_id = p_team_id then m.away_team_id else m.home_team_id end
  left join latest l on l.match_id = m.id
  left join cards c on c.match_id = m.id
  order by m.scheduled_at nulls last;
end;
$$;
revoke execute on function public.get_team_workspace_matches(uuid) from public, anon;
grant execute on function public.get_team_workspace_matches(uuid) to authenticated, service_role;

create or replace function public.get_team_match_participants(p_team_id uuid, p_match_id uuid)
returns table(player_id uuid, display_name text, starter boolean, minutes integer, goals bigint, assists bigint, yellow_cards bigint, red_cards bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.team_memberships m where m.team_id = p_team_id and m.user_id = auth.uid()) and not public.is_team_owner(p_team_id) then
    raise exception 'not_team_staff';
  end if;
  if not exists (select 1 from public.matches m join public.match_result_versions v on v.match_id = m.id and v.status = 'confirmed'
                 where m.id = p_match_id and m.status = 'confirmed' and p_team_id in (m.home_team_id, m.away_team_id)) then
    return;
  end if;
  return query
  select mp.player_id, coalesce(nullif(p.display_name, ''), 'Player'), mp.starter, mp.minutes,
    count(e.id) filter (where e.event_type in ('goal','point','one_point','two_point','three_point')),
    count(e.id) filter (where e.event_type = 'assist'),
    count(e.id) filter (where e.event_type = 'yellow_card'),
    count(e.id) filter (where e.event_type in ('red_card','blue_card'))
  from public.match_player_participants mp
  join public.player_profiles p on p.id = mp.player_id
  left join public.match_events e on e.match_id = mp.match_id and e.player_id = mp.player_id
  where mp.match_id = p_match_id and mp.team_id = p_team_id
  group by mp.player_id, p.display_name, mp.starter, mp.minutes
  order by mp.starter desc, p.display_name;
end;
$$;
revoke execute on function public.get_team_match_participants(uuid, uuid) from public, anon;
grant execute on function public.get_team_match_participants(uuid, uuid) to authenticated, service_role;

-- 5 -------------------------------------------------------------------------
alter table public.roster_submission_players
  add column if not exists is_captain boolean not null default false,
  add column if not exists is_goalkeeper boolean not null default false;

create or replace function public.submit_roster_players(p_entry_id uuid, p_players jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  entry public.tournament_entries;
  settings public.tournament_registration_settings;
  next_version integer;
  roster_id uuid;
  item jsonb;
  total integer := coalesce(jsonb_array_length(p_players), 0);
begin
  select * into entry from public.tournament_entries where id = p_entry_id for update;
  if entry.id is null or not (public.is_tournament_operator(entry.tournament_id) or public.team_has_permission(entry.team_id, 'manage_rosters')) then raise exception 'roster_not_authorized'; end if;
  if entry.roster_status = 'locked' then raise exception 'roster_locked'; end if;
  if entry.application_status <> 'approved' and not public.is_tournament_operator(entry.tournament_id) then raise exception 'application_not_approved'; end if;
  select * into settings from public.tournament_registration_settings where tournament_id = entry.tournament_id;
  if settings.roster_min is not null and total < settings.roster_min then raise exception 'roster_below_minimum'; end if;
  if settings.roster_max is not null and total > settings.roster_max then raise exception 'roster_above_maximum'; end if;
  if total = 0 then raise exception 'roster_empty'; end if;
  if (select count(distinct (value->>'player_id')) from jsonb_array_elements(p_players)) <> total then raise exception 'duplicate_player'; end if;
  if exists (select 1 from jsonb_array_elements(p_players) value where coalesce(value->>'shirt_number', '') <> '' group by value->>'shirt_number' having count(*) > 1) then raise exception 'duplicate_shirt_number'; end if;
  if (select count(*) from jsonb_array_elements(p_players) value where (value->>'is_captain')::boolean is true) > 1 then raise exception 'more_than_one_captain'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_players) value
    where not exists (select 1 from public.player_team_memberships ms where ms.player_id = (value->>'player_id')::uuid and ms.team_id = entry.team_id and ms.status in ('active', 'loaned'))
  ) then raise exception 'player_not_active_member'; end if;

  select coalesce(max(version), 0) + 1 into next_version from public.roster_submissions where entry_id = p_entry_id;
  insert into public.roster_submissions(entry_id, version, status, submitted_by) values (p_entry_id, next_version, 'submitted', auth.uid()) returning id into roster_id;
  for item in select value from jsonb_array_elements(p_players) loop
    insert into public.roster_submission_players(submission_id, player_id, shirt_number, position, is_captain, is_goalkeeper)
    values (roster_id, (item->>'player_id')::uuid, nullif(btrim(item->>'shirt_number'), ''), nullif(btrim(item->>'position'), ''), coalesce((item->>'is_captain')::boolean, false), coalesce((item->>'is_goalkeeper')::boolean, false));
  end loop;
  update public.tournament_entries set roster_status = 'submitted', updated_at = now() where id = p_entry_id;
  return roster_id;
end;
$$;
revoke execute on function public.submit_roster_players(uuid, jsonb) from public, anon;
grant execute on function public.submit_roster_players(uuid, jsonb) to authenticated, service_role;

-- 6 -------------------------------------------------------------------------
create table if not exists public.team_result_reports (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  report_type text not null check (report_type in ('score', 'goal_scorer', 'assist', 'card', 'appearance', 'result_status')),
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending', 'under_review', 'resolved', 'rejected')),
  resolution_note text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists team_result_reports_tournament_idx on public.team_result_reports(tournament_id, created_at desc);
alter table public.team_result_reports enable row level security;
create or replace function public.protect_team_result_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'pending'; new.resolution_note := null; new.resolved_at := null;
    if not exists (select 1 from public.matches m where m.id = new.match_id and m.tournament_id = new.tournament_id and new.team_id in (m.home_team_id, m.away_team_id)) then
      raise exception 'match_not_for_this_team';
    end if;
  elsif new.status in ('resolved', 'rejected') and old.status is distinct from new.status then
    new.resolved_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists protect_team_result_report on public.team_result_reports;
create trigger protect_team_result_report before insert or update on public.team_result_reports for each row execute function public.protect_team_result_report();
drop policy if exists "team staff read own result reports" on public.team_result_reports;
create policy "team staff read own result reports" on public.team_result_reports for select to authenticated using (public.is_team_manager(team_id));
drop policy if exists "team staff send result reports" on public.team_result_reports;
create policy "team staff send result reports" on public.team_result_reports for insert to authenticated with check (created_by = auth.uid() and public.is_team_manager(team_id));
drop policy if exists "operators review result reports" on public.team_result_reports;
create policy "operators review result reports" on public.team_result_reports for select to authenticated using (public.is_tournament_operator(tournament_id));
drop policy if exists "operators resolve result reports" on public.team_result_reports;
create policy "operators resolve result reports" on public.team_result_reports for update to authenticated using (public.is_tournament_operator(tournament_id)) with check (public.is_tournament_operator(tournament_id));

-- 7 -------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('team-private', 'team-private', false) on conflict (id) do nothing;

create table if not exists public.team_finance_records (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  category text not null check (category in ('sponsorship', 'donation', 'membership', 'prize_money', 'other_income', 'registration_fee', 'travel', 'accommodation', 'equipment', 'uniforms', 'food', 'medical', 'venue', 'other_expense')),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  amount_mvr numeric(12,2) not null check (amount_mvr > 0),
  occurred_on date not null,
  tournament_id uuid references public.tournaments(id) on delete set null,
  counterparty text,
  receipt_path text,
  status text not null default 'recorded' check (status in ('draft', 'recorded', 'void')),
  void_reason text,
  private_notes text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'income') = (category in ('sponsorship', 'donation', 'membership', 'prize_money', 'other_income')))
);
create index if not exists team_finance_records_team_idx on public.team_finance_records(team_id, occurred_on desc);
alter table public.team_finance_records enable row level security;
drop policy if exists "team finance staff read records" on public.team_finance_records;
create policy "team finance staff read records" on public.team_finance_records for select to authenticated using (public.team_has_permission(team_id, 'manage_finance'));
drop policy if exists "team finance staff add records" on public.team_finance_records;
create policy "team finance staff add records" on public.team_finance_records for insert to authenticated with check (created_by = auth.uid() and status <> 'void' and public.team_has_permission(team_id, 'manage_finance'));
drop policy if exists "team finance staff update records" on public.team_finance_records;
create policy "team finance staff update records" on public.team_finance_records for update to authenticated using (public.team_has_permission(team_id, 'manage_finance')) with check (public.team_has_permission(team_id, 'manage_finance'));

-- Drafts may be edited; a recorded entry may only be voided, with a reason;
-- a void entry never changes again. Every change is audited.
create or replace function public.protect_team_finance_record()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'void' then raise exception 'void_records_are_final'; end if;
    if old.status = 'recorded' and not (new.status = 'void' and coalesce(btrim(new.void_reason), '') <> ''
        and (new.kind, new.category, new.description, new.amount_mvr, new.occurred_on) is not distinct from (old.kind, old.category, old.description, old.amount_mvr, old.occurred_on)) then
      raise exception 'recorded_entries_can_only_be_voided_with_reason';
    end if;
    if new.team_id <> old.team_id or new.created_by <> old.created_by then raise exception 'immutable_fields'; end if;
    new.updated_at := now();
  end if;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), case when tg_op = 'INSERT' then 'team_finance_added' when new.status = 'void' then 'team_finance_voided' else 'team_finance_edited' end, 'team', new.team_id,
    format('%s %s MVR %s%s', new.kind, new.category, new.amount_mvr, case when new.status = 'void' then ' · ' || coalesce(new.void_reason, '') else '' end));
  return new;
end;
$$;
drop trigger if exists protect_team_finance_record on public.team_finance_records;
create trigger protect_team_finance_record before insert or update on public.team_finance_records for each row execute function public.protect_team_finance_record();

create table if not exists public.team_documents (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  tournament_id uuid references public.tournaments(id) on delete set null,
  category text not null check (category in ('registration_certificate', 'authorization_letter', 'manager_identification', 'tournament_document', 'payment_proof', 'sponsor_agreement', 'player_eligibility', 'other')),
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  status text not null default 'uploaded' check (status in ('uploaded', 'under_review', 'changes_requested', 'verified', 'rejected', 'expired')),
  reviewer_note text,
  expires_at date,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists team_documents_team_idx on public.team_documents(team_id, created_at desc);
alter table public.team_documents enable row level security;
drop policy if exists "team document staff read" on public.team_documents;
create policy "team document staff read" on public.team_documents for select to authenticated using (public.team_has_permission(team_id, 'view_documents'));
drop policy if exists "team document staff upload" on public.team_documents;
create policy "team document staff upload" on public.team_documents for insert to authenticated with check (uploaded_by = auth.uid() and status = 'uploaded' and public.team_has_permission(team_id, 'view_documents'));
drop policy if exists "team document staff remove unreviewed" on public.team_documents;
create policy "team document staff remove unreviewed" on public.team_documents for delete to authenticated using (status in ('uploaded', 'changes_requested', 'rejected') and public.team_has_permission(team_id, 'view_documents'));
drop policy if exists "operators read team documents" on public.team_documents;
create policy "operators read team documents" on public.team_documents for select to authenticated using (tournament_id is not null and public.is_tournament_operator(tournament_id));
drop policy if exists "operators review team documents" on public.team_documents;
create policy "operators review team documents" on public.team_documents for update to authenticated using (tournament_id is not null and public.is_tournament_operator(tournament_id)) with check (tournament_id is not null and public.is_tournament_operator(tournament_id));

-- Private bucket paths: teams/<team_id>/finance/... and teams/<team_id>/documents/...
-- The uuid cast is guarded so a malformed path is refused instead of erroring.
drop policy if exists "team private files" on storage.objects;
create policy "team private files" on storage.objects for all to authenticated
  using (bucket_id = 'team-private' and (storage.foldername(name))[1] = 'teams' and case when (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$' then (
    ((storage.foldername(name))[3] = 'finance' and public.team_has_permission(((storage.foldername(name))[2])::uuid, 'manage_finance'))
    or ((storage.foldername(name))[3] = 'documents' and public.team_has_permission(((storage.foldername(name))[2])::uuid, 'view_documents'))
  ) else false end)
  with check (bucket_id = 'team-private' and (storage.foldername(name))[1] = 'teams' and case when (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$' then (
    ((storage.foldername(name))[3] = 'finance' and public.team_has_permission(((storage.foldername(name))[2])::uuid, 'manage_finance'))
    or ((storage.foldername(name))[3] = 'documents' and public.team_has_permission(((storage.foldername(name))[2])::uuid, 'view_documents'))
  ) else false end);
drop policy if exists "operators read team tournament files" on storage.objects;
create policy "operators read team tournament files" on storage.objects for select to authenticated
  using (bucket_id = 'team-private' and exists (select 1 from public.team_documents d where d.storage_path = name and d.tournament_id is not null and public.is_tournament_operator(d.tournament_id)));


-- ===== 20261031063946_manual_team_and_roster_entry.sql =====
-- ===========================================================================
-- Manual team and roster entry (created with: supabase migration new manual_team_and_roster_entry)
-- ===========================================================================
-- Review-only. Depends on 031 (team_has_permission, submit_roster_players).
--
--   1. Team managers add an existing UNCLAIMED player to their team directly.
--      A claimed player (one with an account) must still be invited and
--      accept, so nobody joins a team without their consent.
--   2. Tournament organizers add players to a team entered in their
--      tournament: an unclaimed player, or a player already in that team.
--      They then submit the roster with the existing submit_roster_players.
--   3. Organizers read the active squad of an entered team (names, numbers,
--      positions only) to build its roster.
--   4. Searching unclaimed players returns names and islands only, and only
--      records the caller may already know about.
--   5. Closes a gap: the old insert policy let any team staff member add ANY
--      player, claimed or not, straight into their team. Direct inserts now
--      need the player to be unclaimed, or to have asked to join that team.
-- Every add is written to audit_events.
-- ===========================================================================

-- 5. Tighter direct-insert policy ------------------------------------------------
drop policy if exists "authorized users create player history" on public.player_team_memberships;
create policy "authorized users create player history" on public.player_team_memberships for insert to authenticated with check (
  created_by = (select auth.uid())
  and (
    exists (select 1 from public.teams t where t.id = player_team_memberships.team_id and t.created_by = (select auth.uid()))
    or exists (select 1 from public.team_memberships tm where tm.team_id = player_team_memberships.team_id and tm.user_id = (select auth.uid()))
  )
  and exists (
    select 1 from public.player_profiles p
    where p.id = player_team_memberships.player_id
      and (p.account_id is null
        or exists (select 1 from public.player_team_requests r where r.player_id = p.id and r.team_id = player_team_memberships.team_id and r.status in ('pending', 'info_requested')))
  )
);

-- Shared checks for adding one player to one team.
create or replace function public.add_player_membership(p_team_id uuid, p_player_id uuid, p_position text, p_jersey integer, p_source text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  claimed boolean;
  new_id uuid;
begin
  select p.account_id is not null into claimed from public.player_profiles p where p.id = p_player_id;
  if claimed is null then raise exception 'player_not_found'; end if;
  if exists (select 1 from public.player_team_memberships ms where ms.player_id = p_player_id and ms.team_id = p_team_id and ms.status in ('active', 'loaned') and ms.effective_to is null) then
    raise exception 'already_member';
  end if;
  if claimed then raise exception 'player_claimed_invite_instead'; end if;
  if p_jersey is not null and (p_jersey < 0 or p_jersey > 99) then raise exception 'invalid_jersey'; end if;
  if p_jersey is not null and exists (select 1 from public.player_team_memberships ms where ms.team_id = p_team_id and ms.status in ('active', 'loaned') and ms.effective_to is null and ms.jersey_number = p_jersey) then
    raise exception 'duplicate_jersey';
  end if;
  insert into public.player_team_memberships(player_id, team_id, status, effective_from, source, created_by, position, jersey_number)
  values (p_player_id, p_team_id, 'active', current_date, p_source, auth.uid(), nullif(left(trim(coalesce(p_position, '')), 40), ''), p_jersey)
  returning id into new_id;
  -- Squad members and their team are part of the public record.
  update public.player_profiles set is_published = true where id = p_player_id and is_published is not true;
  update public.teams set is_published = true where id = p_team_id and is_published is not true;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), 'team_player_added', 'team', p_team_id, p_source);
  return new_id;
end;
$$;
revoke execute on function public.add_player_membership(uuid, uuid, text, integer, text) from public, anon, authenticated;

-- 1. Team managers ------------------------------------------------------------------
create or replace function public.add_team_player(p_team_id uuid, p_player_id uuid, p_position text default null, p_jersey integer default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if not public.team_has_permission(p_team_id, 'manage_players') then raise exception 'team_permission_required'; end if;
  return public.add_player_membership(p_team_id, p_player_id, p_position, p_jersey, 'manager');
end;
$$;
revoke execute on function public.add_team_player(uuid, uuid, text, integer) from public, anon;
grant execute on function public.add_team_player(uuid, uuid, text, integer) to authenticated, service_role;

-- 2. Organizers -------------------------------------------------------------------------
create or replace function public.organizer_add_team_player(p_entry_id uuid, p_player_id uuid, p_position text default null, p_jersey integer default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  entry record;
  existing uuid;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  select e.team_id, e.tournament_id, e.roster_status into entry from public.tournament_entries e where e.id = p_entry_id;
  if entry.team_id is null or not public.is_tournament_operator(entry.tournament_id) then raise exception 'organizer_permission_required'; end if;
  if entry.roster_status = 'locked' then raise exception 'roster_locked'; end if;
  -- Already in the squad: nothing to add; the roster step picks them.
  select ms.id into existing from public.player_team_memberships ms
  where ms.player_id = p_player_id and ms.team_id = entry.team_id and ms.status in ('active', 'loaned') and ms.effective_to is null limit 1;
  if existing is not null then return existing; end if;
  return public.add_player_membership(entry.team_id, p_player_id, p_position, p_jersey, 'organizer');
end;
$$;
revoke execute on function public.organizer_add_team_player(uuid, uuid, text, integer) from public, anon;
grant execute on function public.organizer_add_team_player(uuid, uuid, text, integer) to authenticated, service_role;

-- 3. Squad of an entered team, for its organizer -----------------------------------------------
create or replace function public.get_entry_team_players(p_entry_id uuid)
-- "position" is a reserved word in Postgres, so the output column is player_position.
returns table(player_id uuid, display_name text, claimed boolean, player_position text, jersey_number smallint, squad_role text)
language plpgsql stable security definer set search_path = public as $$
declare
  entry record;
begin
  select e.team_id, e.tournament_id into entry from public.tournament_entries e where e.id = p_entry_id;
  if entry.team_id is null or not (public.is_tournament_operator(entry.tournament_id) or public.team_has_permission(entry.team_id, 'manage_rosters')) then
    raise exception 'organizer_permission_required';
  end if;
  return query
  select p.id, coalesce(nullif(p.display_name, ''), 'Player'), p.account_id is not null, ms.position, ms.jersey_number, ms.squad_role
  from public.player_team_memberships ms
  join public.player_profiles p on p.id = ms.player_id
  where ms.team_id = entry.team_id and ms.status in ('active', 'loaned') and ms.effective_to is null
  order by ms.jersey_number nulls last, p.display_name;
end;
$$;
revoke execute on function public.get_entry_team_players(uuid) from public, anon;
grant execute on function public.get_entry_team_players(uuid) to authenticated, service_role;

-- 4. Finding unclaimed players ----------------------------------------------------------------
-- Names and islands only, at most 10, for records the caller can already
-- see: published players, players they created, and players already in a
-- team they manage or in a team entered in a tournament they run.
create or replace function public.search_unclaimed_players(p_query text, p_team_id uuid default null, p_entry_id uuid default null)
returns table(player_id uuid, display_name text, island text)
language plpgsql stable security definer set search_path = public as $$
declare
  term text := left(regexp_replace(trim(coalesce(p_query, '')), '[%_\\]', '', 'g'), 60);
  entry_tournament uuid;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if length(term) < 2 then return; end if;
  if p_entry_id is not null then
    select e.tournament_id into entry_tournament from public.tournament_entries e where e.id = p_entry_id;
    if entry_tournament is null or not public.is_tournament_operator(entry_tournament) then raise exception 'organizer_permission_required'; end if;
  elsif p_team_id is null or not public.team_has_permission(p_team_id, 'manage_players') then
    raise exception 'team_permission_required';
  end if;
  return query
  select p.id, p.display_name, p.island
  from public.player_profiles p
  where p.account_id is null and p.display_name ilike '%' || term || '%'
    and (p.is_published or p.created_by = auth.uid()
      or exists (select 1 from public.player_team_memberships ms where ms.player_id = p.id
        and ((p_team_id is not null and public.team_has_permission(ms.team_id, 'manage_players'))
          or (entry_tournament is not null and exists (select 1 from public.tournament_entries e2 where e2.team_id = ms.team_id and e2.tournament_id = entry_tournament)))))
  order by p.display_name
  limit 10;
end;
$$;
revoke execute on function public.search_unclaimed_players(text, uuid, uuid) from public, anon;
grant execute on function public.search_unclaimed_players(text, uuid, uuid) to authenticated, service_role;


-- ===== 202611010032_landing_page_complete.sql =====
-- ===========================================================================
-- 032 — Public Landing Page: public feeds, announcements, reports, info pages
-- ===========================================================================
-- Review-only. The owner applies it after 024 and 026–031.
--
-- Why this exists: guests can read only CONFIRMED matches (policy "published
-- matches are public"), and official scores live in match_result_versions,
-- which has no guest read policy. So the landing page could not show live
-- matches, today's schedule, or any score. Rather than widening table
-- policies, a narrow SECURITY DEFINER function returns exactly the public
-- columns, for published tournaments and published draws only.
--
-- Public boundaries kept here:
--   * Only tournaments that are published and not draft.
--   * Only matches in stages whose draw is published (competition_stages.published_at).
--   * Scores only for confirmed matches, from the LATEST confirmed version, so a
--     corrected result replaces the earlier one and never appears twice.
--     Submitted, rejected or conflicting versions are never read.
--   * Team names only for published teams, or teams with an approved entry in
--     that published tournament (their participation is already public there).
--   * No ids of accounts, no notes, no documents, no payment or finance data.
-- ===========================================================================

-- 1. Public match feed -------------------------------------------------------
create or replace function public.get_public_match_feed(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_statuses text[] default null,
  p_tournament_id uuid default null,
  p_limit integer default 60,
  p_newest_first boolean default false
)
returns table(
  match_id uuid, tournament_id uuid, tournament_name text, tournament_slug text, sport text,
  stage_id uuid, stage_name text, stage_format text, stage_order smallint, group_name text, leg smallint,
  scheduled_at timestamptz, venue text, status text,
  home_team_id uuid, home_name text, home_slug text, home_logo text,
  away_team_id uuid, away_name text, away_slug text, away_logo text,
  home_score numeric, away_score numeric, result_outcome text, confirmed_at timestamptz, corrected boolean
)
language sql stable security definer set search_path = public as $$
  with visible as (
    select m.* from public.matches m
    join public.tournaments tr on tr.id = m.tournament_id and tr.is_published and tr.status <> 'draft'
    join public.competition_stages st on st.id = m.stage_id and st.published_at is not null
    where (p_from is null or m.scheduled_at >= p_from)
      and (p_to is null or m.scheduled_at < p_to)
      and (p_statuses is null or m.status = any(p_statuses))
      and (p_tournament_id is null or m.tournament_id = p_tournament_id)
    order by
      case when p_newest_first then m.scheduled_at end desc nulls last,
      case when not p_newest_first then m.scheduled_at end asc nulls last
    limit least(greatest(coalesce(p_limit, 60), 1), 200)
  ), latest as (
    select distinct on (v.match_id) v.match_id, v.score, v.created_at, v.version
    from public.match_result_versions v join visible on visible.id = v.match_id
    where v.status = 'confirmed'
    order by v.match_id, v.version desc
  )
  select m.id, m.tournament_id, tr.name, tr.slug, tr.sport,
    st.id, st.name, st.format, st.stage_order, g.name, m.leg,
    m.scheduled_at, m.venue, m.status,
    m.home_team_id, case when hm.shown then hm.name end, case when hm.is_published then hm.slug end, case when hm.shown then hm.logo_url end,
    m.away_team_id, case when aw.shown then aw.name end, case when aw.is_published then aw.slug end, case when aw.shown then aw.logo_url end,
    case when m.status = 'confirmed' and jsonb_typeof(l.score->'home') = 'number' then (l.score->>'home')::numeric end,
    case when m.status = 'confirmed' and jsonb_typeof(l.score->'away') = 'number' then (l.score->>'away')::numeric end,
    case when m.status = 'confirmed' and l.score->>'outcome' in ('walkover', 'forfeit', 'abandoned') then l.score->>'outcome' end,
    case when m.status = 'confirmed' then l.created_at end,
    coalesce(m.status = 'confirmed' and l.version > 1 and exists (
      select 1 from public.match_result_versions older where older.match_id = m.id and older.status = 'confirmed' and older.version < l.version
    ), false)
  from visible m
  join public.tournaments tr on tr.id = m.tournament_id
  join public.competition_stages st on st.id = m.stage_id
  left join public.competition_groups g on g.id = m.group_id
  left join lateral (
    select t.name, t.slug, t.logo_url, t.is_published,
      (t.is_published or exists (select 1 from public.tournament_entries e where e.team_id = t.id and e.tournament_id = m.tournament_id and e.application_status = 'approved')) as shown
    from public.teams t where t.id = m.home_team_id
  ) hm on true
  left join lateral (
    select t.name, t.slug, t.logo_url, t.is_published,
      (t.is_published or exists (select 1 from public.tournament_entries e where e.team_id = t.id and e.tournament_id = m.tournament_id and e.application_status = 'approved')) as shown
    from public.teams t where t.id = m.away_team_id
  ) aw on true
  left join latest l on l.match_id = m.id
  order by
    case when p_newest_first then m.scheduled_at end desc nulls last,
    case when not p_newest_first then m.scheduled_at end asc nulls last;
$$;
revoke execute on function public.get_public_match_feed(timestamptz, timestamptz, text[], uuid, integer, boolean) from public;
grant execute on function public.get_public_match_feed(timestamptz, timestamptz, text[], uuid, integer, boolean) to anon, authenticated, service_role;

-- 2. Top players from confirmed official statistics --------------------------
-- Same counting as get_player_official_statistics (confirmed results only),
-- for published players only. The browser applies the documented rating
-- formula (src/lib/playerRating.ts); players under the minimum number of
-- appearances are not returned, so they can never be ranked.
create or replace function public.get_public_top_players(p_sport text default null, p_min_appearances integer default 3, p_limit integer default 60)
returns table(player_id uuid, display_name text, slug text, photo_url text, sport text, team_name text, team_slug text,
  appearances bigint, goals bigint, assists bigint, yellow_cards bigint, red_cards bigint)
language sql stable security definer set search_path = public as $$
  with confirmed as (
    select m.id, m.tournament_id from public.matches m
    join public.tournaments tr on tr.id = m.tournament_id and tr.is_published and tr.status <> 'draft'
    where m.status = 'confirmed'
      and exists (select 1 from public.match_result_versions v where v.match_id = m.id and v.status = 'confirmed')
      and (p_sport is null or tr.sport = p_sport)
  ), events as (
    select ev.match_id, ev.player_id,
      count(*) filter (where ev.event_type in ('goal','point','one_point','two_point','three_point')) as goals,
      count(*) filter (where ev.event_type = 'assist') as assists,
      count(*) filter (where ev.event_type = 'yellow_card') as yellow,
      count(*) filter (where ev.event_type in ('red_card','blue_card')) as red
    from public.match_events ev join confirmed c on c.id = ev.match_id
    group by ev.match_id, ev.player_id
  ), totals as (
    select mp.player_id,
      count(distinct mp.match_id) as appearances,
      coalesce(sum(e.goals), 0)::bigint as goals, coalesce(sum(e.assists), 0)::bigint as assists,
      coalesce(sum(e.yellow), 0)::bigint as yellow, coalesce(sum(e.red), 0)::bigint as red,
      mode() within group (order by tr.sport) as sport
    from public.match_player_participants mp
    join confirmed c on c.id = mp.match_id
    join public.tournaments tr on tr.id = c.tournament_id
    left join events e on e.match_id = mp.match_id and e.player_id = mp.player_id
    group by mp.player_id
  )
  select p.id, p.display_name, p.slug, p.photo_url, t.sport, team.name, team.slug,
    t.appearances, t.goals, t.assists, t.yellow, t.red
  from totals t
  join public.player_profiles p on p.id = t.player_id and p.is_published
  left join lateral (
    select tm.name, tm.slug from public.player_team_memberships ms
    join public.teams tm on tm.id = ms.team_id and tm.is_published
    where ms.player_id = p.id and ms.status = 'active'
    order by ms.effective_from desc nulls last limit 1
  ) team on true
  where t.appearances >= greatest(coalesce(p_min_appearances, 3), 1)
  order by t.appearances desc
  limit least(greatest(coalesce(p_limit, 60), 1), 200);
$$;
revoke execute on function public.get_public_top_players(text, integer, integer) from public;
grant execute on function public.get_public_top_players(text, integer, integer) to anon, authenticated, service_role;

-- 3. Registration window and places, as aggregates only ----------------------
-- Entry rows stay private; only counts of APPROVED entries leave the database.
-- team_limit_total is null when any category has no limit (places unknown).
create or replace function public.get_public_registration_capacity(p_tournament_ids uuid[])
returns table(tournament_id uuid, opens_at timestamptz, closes_at timestamptz, category_count bigint, team_limit_total bigint, approved_count bigint)
language sql stable security definer set search_path = public as $$
  select tr.id, rs.opens_at, rs.closes_at,
    (select count(*) from public.tournament_categories c where c.tournament_id = tr.id),
    (select case when count(*) = 0 or bool_or(c.team_limit is null) then null else sum(c.team_limit) end from public.tournament_categories c where c.tournament_id = tr.id)::bigint,
    (select count(*) from public.tournament_entries e where e.tournament_id = tr.id and e.application_status = 'approved')
  from public.tournaments tr
  left join public.tournament_registration_settings rs on rs.tournament_id = tr.id
  where tr.id = any(coalesce(p_tournament_ids, '{}')) and tr.is_published and tr.status <> 'draft'
  limit 60;
$$;
revoke execute on function public.get_public_registration_capacity(uuid[]) from public;
grant execute on function public.get_public_registration_capacity(uuid[]) to anon, authenticated, service_role;

-- 4. Service announcements (banner above the header) -------------------------
create table if not exists public.public_announcements (
  id uuid primary key default gen_random_uuid(),
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title text not null check (length(trim(title)) between 1 and 160),
  title_dv text check (title_dv is null or length(title_dv) <= 160),
  body text check (body is null or length(body) <= 400),
  body_dv text check (body_dv is null or length(body_dv) <= 400),
  link_url text check (link_url is null or link_url ~ '^(https://|#)'),
  link_label text check (link_label is null or length(link_label) <= 40),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
alter table public.public_announcements enable row level security;
drop policy if exists "live announcements are public" on public.public_announcements;
create policy "live announcements are public" on public.public_announcements for select to anon, authenticated
  using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
drop policy if exists "platform admins manage announcements" on public.public_announcements;
create policy "platform admins manage announcements" on public.public_announcements for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create or replace function public.touch_public_announcement()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists touch_public_announcement_trigger on public.public_announcements;
create trigger touch_public_announcement_trigger before update on public.public_announcements for each row execute function public.touch_public_announcement();

-- 5. Content reports (private moderation requests) ---------------------------
-- Reporting never edits the record. Reporters are signed in, see only their
-- own reports, and are rate limited; nobody else but platform admins reads them.
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  entity_type text not null check (entity_type in ('tournament', 'team', 'player', 'match', 'news', 'organization')),
  entity_ref text not null check (length(entity_ref) between 1 and 200),
  entity_label text check (entity_label is null or length(entity_label) <= 200),
  reason text not null check (reason in ('incorrect_information', 'duplicate_player', 'impersonated_team', 'inappropriate_content', 'incorrect_match', 'privacy_concern', 'other')),
  details text check (details is null or length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  admin_note text check (admin_note is null or length(admin_note) <= 1000),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists content_reports_status_idx on public.content_reports(status, created_at desc);
create index if not exists content_reports_reporter_idx on public.content_reports(reporter_id, created_at desc);
alter table public.content_reports enable row level security;
drop policy if exists "reporters read own reports" on public.content_reports;
create policy "reporters read own reports" on public.content_reports for select to authenticated using (reporter_id = auth.uid());
drop policy if exists "platform admins read reports" on public.content_reports;
create policy "platform admins read reports" on public.content_reports for select to authenticated using (public.is_platform_admin());
drop policy if exists "platform admins resolve reports" on public.content_reports;
create policy "platform admins resolve reports" on public.content_reports for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
-- No insert policy: reports go through submit_content_report so limits apply.

create or replace function public.submit_content_report(p_entity_type text, p_entity_ref text, p_entity_label text, p_reason text, p_details text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if (select count(*) from public.content_reports r where r.reporter_id = auth.uid() and r.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'report_limit_reached';
  end if;
  if exists (select 1 from public.content_reports r where r.reporter_id = auth.uid() and r.entity_type = p_entity_type and r.entity_ref = p_entity_ref and r.status in ('open', 'reviewing')) then
    raise exception 'report_already_open';
  end if;
  insert into public.content_reports (reporter_id, entity_type, entity_ref, entity_label, reason, details)
  values (auth.uid(), p_entity_type, left(trim(p_entity_ref), 200), nullif(left(trim(coalesce(p_entity_label, '')), 200), ''), p_reason, nullif(left(trim(coalesce(p_details, '')), 1000), ''))
  returning id into new_id;
  return new_id;
end;
$$;
revoke execute on function public.submit_content_report(text, text, text, text, text) from public, anon;
grant execute on function public.submit_content_report(text, text, text, text, text) to authenticated, service_role;

create or replace function public.protect_content_report()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Admins change only the moderation fields; what was reported stays as sent.
  if new.reporter_id <> old.reporter_id or new.entity_type <> old.entity_type or new.entity_ref <> old.entity_ref
     or new.reason <> old.reason or coalesce(new.details, '') <> coalesce(old.details, '') or new.created_at <> old.created_at then
    raise exception 'report_contents_are_fixed';
  end if;
  if new.status in ('resolved', 'dismissed') and old.status not in ('resolved', 'dismissed') then
    new.resolved_by := auth.uid(); new.resolved_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists protect_content_report_trigger on public.content_reports;
create trigger protect_content_report_trigger before update on public.content_reports for each row execute function public.protect_content_report();

-- 6. Platform information pages (Privacy, Terms, guidelines…) ----------------
-- Legal text is the owner's to write; the app never invents it. Until a page
-- is published the site says so.
create table if not exists public.platform_pages (
  slug text primary key check (slug in ('privacy', 'terms', 'community-guidelines', 'child-safety', 'contact', 'account-deletion', 'image-consent', 'help', 'data-correction')),
  title text not null check (length(trim(title)) between 1 and 120),
  body text not null check (length(body) <= 20000),
  body_dv text check (body_dv is null or length(body_dv) <= 20000),
  is_published boolean not null default false,
  updated_by uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.platform_pages enable row level security;
drop policy if exists "published platform pages are public" on public.platform_pages;
create policy "published platform pages are public" on public.platform_pages for select to anon, authenticated using (is_published);
drop policy if exists "platform admins manage platform pages" on public.platform_pages;
create policy "platform admins manage platform pages" on public.platform_pages for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());


-- ===== 202611010033_organization_publishing.sql =====
-- ===========================================================================
-- 033 — Organization publishing
-- ===========================================================================
-- Review-only. The owner applies it after 032.
--
-- Problem: organizations.is_published defaults to false and no policy or
-- function ever lets anyone change it, so the public Organizations directory
-- (#organizations) is always empty and organizer names never appear on
-- public tournament cards.
--
-- Fix: one narrow function that lets an organization OWNER publish or
-- unpublish their own organization. No general update policy is added, so
-- nothing else about the organization row becomes editable here.
-- ===========================================================================

create or replace function public.set_organization_published(p_organization_id uuid, p_publish boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.role = 'owner'
  ) then
    raise exception 'organization_owner_required';
  end if;
  update public.organizations set is_published = coalesce(p_publish, false) where id = p_organization_id;
  return coalesce(p_publish, false);
end;
$$;
revoke execute on function public.set_organization_published(uuid, boolean) from public, anon;
grant execute on function public.set_organization_published(uuid, boolean) to authenticated, service_role;


-- ===== 202611010034_super_admin_release_one.sql =====
-- Super Admin, Release One (Super Admin specification sections 3-6, 8-18, 24, 25, 28-30, 49-55).
-- Review-only. Do not apply, push or deploy without explicit owner authorization.
-- Apply after 032 (content reports, announcements, platform pages) and 033.
--
-- Created with `supabase migration new super_admin_release_one`, then renamed from
-- 20261031131637_… to 202611010034_… so it sorts after 032/033, which it depends on.
--
-- What this adds:
--   1. Admin roles and granular permissions with expiry, suspension and revocation.
--      platform_admins rows (migration 027, granted only by SQL) stay the bootstrap
--      Platform Owners. Nothing here lets anyone grant themselves anything.
--   2. An append-only platform audit log.
--   3. Unified cases with private internal notes.
--   4. Moderation: hide and restore organizations, teams, players, tournaments and
--      news without deleting anything; hidden records cannot be re-published by
--      their owners until the restriction is lifted.
--   5. Account suspension (Supabase Auth ban) and session revocation.
--   6. Directory, overview and result-integrity read functions for admins.
--   7. Admin management: Platform Owner grants need a second owner.
--   8. Versioned app customization (theme, landing copy and section visibility)
--      with draft, review, publish and rollback.
--
-- Every privileged function: checks the caller and exact permission, requires a
-- reason, writes the audit log, uses an empty search_path with qualified names,
-- and has EXECUTE revoked from public and anon.

-- ---------------------------------------------------------------------------------
-- 1. Roles and permissions
-- ---------------------------------------------------------------------------------
create or replace function public.admin_all_permissions()
returns text[] language sql immutable set search_path = '' as $$
  select array[
    'admin.dashboard.read', 'admin.cases.manage', 'admin.cases.child_safety',
    'admin.accounts.read', 'admin.accounts.suspend', 'admin.sessions.revoke',
    'admin.identities.review', 'admin.organizations.moderate', 'admin.teams.moderate',
    'admin.players.moderate', 'admin.tournaments.moderate', 'admin.results.review',
    'admin.content.moderate', 'admin.support.manage', 'admin.data_requests.manage',
    'admin.finance.audit', 'admin.notifications.manage', 'admin.audit.read', 'admin.audit.export',
    'admin.security.manage', 'admin.system.read', 'admin.configuration.manage',
    'admin.customization.edit', 'admin.customization.publish', 'admin.customization.rollback',
    'admin.admins.manage'
  ]::text[];
$$;

-- Default permissions per role (specification section 4). Child-safety cases are
-- Platform Owner only unless granted separately.
create or replace function public.admin_role_permissions(p_role text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_role
    when 'platform_owner' then public.admin_all_permissions()
    when 'security_admin' then array['admin.dashboard.read', 'admin.cases.manage', 'admin.accounts.read', 'admin.accounts.suspend', 'admin.sessions.revoke', 'admin.security.manage', 'admin.audit.read', 'admin.system.read']
    when 'identity_reviewer' then array['admin.dashboard.read', 'admin.cases.manage', 'admin.identities.review', 'admin.players.moderate', 'admin.accounts.read']
    when 'moderator' then array['admin.dashboard.read', 'admin.cases.manage', 'admin.content.moderate', 'admin.organizations.moderate', 'admin.teams.moderate', 'admin.players.moderate', 'admin.tournaments.moderate']
    when 'support_agent' then array['admin.dashboard.read', 'admin.cases.manage', 'admin.support.manage', 'admin.accounts.read']
    when 'finance_auditor' then array['admin.dashboard.read', 'admin.finance.audit', 'admin.audit.read']
    when 'content_admin' then array['admin.dashboard.read', 'admin.content.moderate']
    when 'customization_designer' then array['admin.dashboard.read', 'admin.customization.edit']
    when 'customization_publisher' then array['admin.dashboard.read', 'admin.customization.edit', 'admin.customization.publish', 'admin.customization.rollback']
    when 'technical_operator' then array['admin.dashboard.read', 'admin.system.read', 'admin.notifications.manage', 'admin.results.review']
    else array[]::text[]
  end;
$$;

create table if not exists public.platform_admin_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('platform_owner', 'security_admin', 'identity_reviewer', 'moderator', 'support_agent', 'finance_auditor', 'content_admin', 'customization_designer', 'customization_publisher', 'technical_operator')),
  extra_permissions text[] not null default '{}',
  status text not null default 'proposed' check (status in ('proposed', 'active', 'suspended', 'revoked', 'rejected')),
  reason text not null check (length(trim(reason)) between 5 and 500),
  proposed_by uuid not null references public.profiles(id) on delete restrict,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at),
  check (extra_permissions <@ public.admin_all_permissions())
);
create unique index if not exists platform_admin_assignments_live_idx on public.platform_admin_assignments(user_id, role) where status in ('proposed', 'active', 'suspended');
create index if not exists platform_admin_assignments_user_idx on public.platform_admin_assignments(user_id, status);
alter table public.platform_admin_assignments enable row level security;

-- The caller's effective permissions: bootstrap owners (platform_admins) plus active,
-- started and unexpired assignments. Revocation, suspension and expiry take effect
-- on the next request because nothing is cached in the token.
create or replace function public.admin_permissions()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct permission order by permission), '{}'::text[]) from (
    select unnest(public.admin_role_permissions('platform_owner')) as permission
      from public.platform_admins a where a.user_id = (select auth.uid())
    union
    select unnest(public.admin_role_permissions(x.role) || x.extra_permissions)
      from public.platform_admin_assignments x
      where x.user_id = (select auth.uid()) and x.status = 'active' and x.starts_at <= now() and (x.expires_at is null or x.expires_at > now())
  ) granted;
$$;

create or replace function public.admin_has(p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and p_permission = any(public.admin_permissions());
$$;

create or replace function public.admin_is_owner(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = p_user)
    or exists (select 1 from public.platform_admin_assignments x where x.user_id = p_user and x.role = 'platform_owner' and x.status = 'active' and x.starts_at <= now() and (x.expires_at is null or x.expires_at > now()));
$$;

create or replace function public.admin_is_staff(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = p_user)
    or exists (select 1 from public.platform_admin_assignments x where x.user_id = p_user and x.status = 'active' and x.starts_at <= now() and (x.expires_at is null or x.expires_at > now()));
$$;

create or replace function public.admin_role_names(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select nullif(concat_ws(', ',
    case when exists (select 1 from public.platform_admins a where a.user_id = p_user) then 'platform_owner (bootstrap)' end,
    (select string_agg(x.role, ', ' order by x.role) from public.platform_admin_assignments x where x.user_id = p_user and x.status = 'active' and (x.expires_at is null or x.expires_at > now()))
  ), '');
$$;

create or replace function public.admin_assert(p_permission text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not_signed_in'; end if;
  if not public.admin_has(p_permission) then raise exception 'admin_permission_denied'; end if;
end;
$$;

create or replace function public.admin_require_reason(p_reason text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  if length(p_reason) > 1000 then raise exception 'reason_too_long'; end if;
end;
$$;

-- High-impact actions need a recent sign-in (30 minutes) or a second factor (aal2).
create or replace function public.admin_require_recent_auth()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'aal', '') = 'aal2' then return; end if;
  if not exists (select 1 from auth.sessions s where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid and s.created_at > now() - interval '30 minutes') then
    raise exception 'reauthentication_required';
  end if;
end;
$$;

drop policy if exists "admins read own assignments" on public.platform_admin_assignments;
create policy "admins read own assignments" on public.platform_admin_assignments for select to authenticated
  using (user_id = (select auth.uid()) or (select public.admin_has('admin.admins.manage')));
-- No insert, update or delete policies: changes go through the admin functions below.

-- ---------------------------------------------------------------------------------
-- 2. Append-only audit log
-- ---------------------------------------------------------------------------------
create table if not exists public.platform_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_roles text,
  action text not null,
  target_type text not null,
  target_id text,
  target_label text,
  reason text,
  case_id uuid,
  before_summary jsonb,
  after_summary jsonb,
  approval_ref uuid,
  environment text not null default 'production',
  created_at timestamptz not null default now()
);
create index if not exists platform_audit_events_time_idx on public.platform_audit_events(created_at desc, id desc);
create index if not exists platform_audit_events_target_idx on public.platform_audit_events(target_type, target_id, created_at desc);
create index if not exists platform_audit_events_actor_idx on public.platform_audit_events(actor_id, created_at desc);
alter table public.platform_audit_events enable row level security;
drop policy if exists "admins read audit" on public.platform_audit_events;
create policy "admins read audit" on public.platform_audit_events for select to authenticated
  using ((select public.admin_has('admin.audit.read')));

-- Nobody, administrators included, can change or erase audit rows through the API.
create or replace function public.platform_audit_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_append_only';
end;
$$;
drop trigger if exists platform_audit_no_change on public.platform_audit_events;
create trigger platform_audit_no_change before update or delete on public.platform_audit_events for each row execute function public.platform_audit_append_only();
drop trigger if exists platform_audit_no_truncate on public.platform_audit_events;
create trigger platform_audit_no_truncate before truncate on public.platform_audit_events for each statement execute function public.platform_audit_append_only();

create or replace function public.admin_audit(p_action text, p_target_type text, p_target_id text, p_target_label text, p_reason text, p_case uuid, p_before jsonb, p_after jsonb, p_approval uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
begin
  insert into public.platform_audit_events (actor_id, actor_roles, action, target_type, target_id, target_label, reason, case_id, before_summary, after_summary, approval_ref)
  values (v_actor, public.admin_role_names(v_actor), p_action, p_target_type, p_target_id, left(p_target_label, 200), p_reason, p_case, p_before, p_after, p_approval);
  update public.platform_admin_assignments set last_used_at = now() where user_id = v_actor and status = 'active';
end;
$$;

-- ---------------------------------------------------------------------------------
-- 3. Cases
-- ---------------------------------------------------------------------------------
create sequence if not exists public.platform_case_seq;
create table if not exists public.platform_cases (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('KC-' || lpad(nextval('public.platform_case_seq')::text, 6, '0')),
  case_type text not null check (case_type in ('content_report', 'duplicate_player', 'claim_dispute', 'identity_correction', 'impersonation', 'account_compromise', 'team_ownership', 'organization_ownership', 'result_dispute', 'privacy_request', 'data_request', 'account_closure', 'child_safety', 'technical_support')),
  status text not null default 'new' check (status in ('new', 'triaged', 'assigned', 'under_review', 'waiting_user', 'waiting_organization', 'escalated', 'resolved', 'rejected', 'closed', 'reopened')),
  severity text not null default 'normal' check (severity in ('low', 'normal', 'high', 'critical')),
  title text not null check (length(trim(title)) between 3 and 160),
  summary text check (summary is null or length(summary) <= 2000),
  subject_type text check (subject_type is null or subject_type in ('account', 'organization', 'team', 'player', 'tournament', 'match', 'news', 'platform')),
  subject_ref text check (subject_ref is null or length(subject_ref) <= 200),
  subject_label text check (subject_label is null or length(subject_label) <= 200),
  reporter_id uuid references public.profiles(id) on delete set null,
  source_report_id uuid unique references public.content_reports(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  decision text check (decision is null or length(decision) <= 2000),
  user_response text check (user_response is null or length(user_response) <= 2000),
  related_case_ids uuid[] not null default '{}',
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists platform_cases_queue_idx on public.platform_cases(status, severity, created_at desc);
create index if not exists platform_cases_assignee_idx on public.platform_cases(assigned_to, status);
alter table public.platform_cases enable row level security;

create or replace function public.admin_can_see_case_type(p_type text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.admin_has('admin.cases.manage') and (p_type <> 'child_safety' or public.admin_has('admin.cases.child_safety'));
$$;

drop policy if exists "admins read cases" on public.platform_cases;
create policy "admins read cases" on public.platform_cases for select to authenticated
  using ((select public.admin_has('admin.cases.manage')) and (case_type <> 'child_safety' or (select public.admin_has('admin.cases.child_safety'))));

create table if not exists public.platform_case_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.platform_cases(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (length(trim(body)) between 1 and 4000),
  is_internal boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists platform_case_messages_case_idx on public.platform_case_messages(case_id, created_at);
alter table public.platform_case_messages enable row level security;
-- Visible only to admins who can see the case (the subquery runs under case RLS).
drop policy if exists "admins read case messages" on public.platform_case_messages;
create policy "admins read case messages" on public.platform_case_messages for select to authenticated
  using (exists (select 1 from public.platform_cases c where c.id = case_id));

create or replace function public.admin_open_case(p_type text, p_title text, p_summary text, p_severity text default 'normal', p_subject_type text default null, p_subject_ref text default null, p_subject_label text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_ref text;
begin
  perform public.admin_assert('admin.cases.manage');
  if not public.admin_can_see_case_type(p_type) then raise exception 'admin_permission_denied'; end if;
  insert into public.platform_cases (case_type, title, summary, severity, subject_type, subject_ref, subject_label, created_by)
  values (p_type, trim(p_title), nullif(trim(p_summary), ''), coalesce(p_severity, 'normal'), p_subject_type, p_subject_ref, p_subject_label, (select auth.uid()))
  returning id, reference into v_id, v_ref;
  perform public.admin_audit('case_opened', 'case', v_id::text, v_ref, p_title, v_id, null, jsonb_build_object('type', p_type, 'severity', p_severity));
  return v_id;
end;
$$;

-- Null arguments leave a field unchanged. Resolving or rejecting needs a decision.
create or replace function public.admin_update_case(p_case uuid, p_reason text, p_status text default null, p_severity text default null, p_assignee uuid default null, p_unassign boolean default false, p_decision text default null, p_user_response text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_case public.platform_cases;
  v_status text;
  v_done constant text[] := array['resolved', 'rejected', 'closed'];
begin
  perform public.admin_assert('admin.cases.manage');
  perform public.admin_require_reason(p_reason);
  select * into v_case from public.platform_cases where id = p_case for update;
  if not found or not public.admin_can_see_case_type(v_case.case_type) then raise exception 'not_found'; end if;
  v_status := coalesce(p_status, v_case.status);
  if v_case.status = any(v_done) and v_status <> v_case.status and v_status not in ('reopened', 'closed') then raise exception 'invalid_transition'; end if;
  if v_status in ('resolved', 'rejected') and coalesce(nullif(trim(p_decision), ''), v_case.decision) is null then raise exception 'decision_required'; end if;
  if p_assignee is not null and not public.admin_is_staff(p_assignee) then raise exception 'assignee_not_admin'; end if;
  update public.platform_cases set
    status = case when p_assignee is not null and p_status is null and v_case.status in ('new', 'triaged') then 'assigned' else v_status end,
    severity = coalesce(p_severity, severity),
    assigned_to = case when p_unassign then null else coalesce(p_assignee, assigned_to) end,
    decision = coalesce(nullif(trim(p_decision), ''), decision),
    user_response = coalesce(nullif(trim(p_user_response), ''), user_response),
    resolved_at = case when v_status = any(v_done) then coalesce(resolved_at, now()) when v_status = 'reopened' then null else resolved_at end,
    updated_at = now()
  where id = p_case;
  perform public.admin_audit('case_updated', 'case', p_case::text, v_case.reference, p_reason, p_case,
    jsonb_build_object('status', v_case.status, 'severity', v_case.severity, 'assigned', v_case.assigned_to is not null),
    jsonb_build_object('status', v_status, 'severity', coalesce(p_severity, v_case.severity), 'assigned', not p_unassign and coalesce(p_assignee, v_case.assigned_to) is not null));
end;
$$;

create or replace function public.admin_add_case_note(p_case uuid, p_body text, p_internal boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_case public.platform_cases;
  v_id uuid;
begin
  perform public.admin_assert('admin.cases.manage');
  select * into v_case from public.platform_cases where id = p_case;
  if not found or not public.admin_can_see_case_type(v_case.case_type) then raise exception 'not_found'; end if;
  insert into public.platform_case_messages (case_id, author_id, body, is_internal) values (p_case, (select auth.uid()), trim(p_body), coalesce(p_internal, true)) returning id into v_id;
  update public.platform_cases set updated_at = now() where id = p_case;
  -- The note text itself stays in the case; the audit records only that one was added.
  perform public.admin_audit(case when coalesce(p_internal, true) then 'case_internal_note' else 'case_user_message' end, 'case', p_case::text, v_case.reference, null, p_case, null, null);
  return v_id;
end;
$$;

create or replace function public.admin_link_cases(p_case uuid, p_other uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_assert('admin.cases.manage');
  perform public.admin_require_reason(p_reason);
  if p_case = p_other then raise exception 'invalid_target'; end if;
  if (select count(*) from public.platform_cases c where c.id in (p_case, p_other) and public.admin_can_see_case_type(c.case_type)) <> 2 then raise exception 'not_found'; end if;
  update public.platform_cases set related_case_ids = array(select distinct unnest(related_case_ids || p_other)), updated_at = now() where id = p_case;
  update public.platform_cases set related_case_ids = array(select distinct unnest(related_case_ids || p_case)), updated_at = now() where id = p_other;
  perform public.admin_audit('cases_linked', 'case', p_case::text, null, p_reason, p_case, null, jsonb_build_object('linked', p_other));
end;
$$;

-- Turn a public content report (migration 032) into a case; returns the existing case if one was opened.
create or replace function public.admin_case_from_report(p_report uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_report public.content_reports;
  v_id uuid;
  v_ref text;
  v_type text;
begin
  perform public.admin_assert('admin.cases.manage');
  perform public.admin_assert('admin.content.moderate');
  select id into v_id from public.platform_cases where source_report_id = p_report;
  if found then return v_id; end if;
  select * into v_report from public.content_reports where id = p_report for update;
  if not found then raise exception 'not_found'; end if;
  v_type := case v_report.reason when 'duplicate_player' then 'duplicate_player' when 'impersonated_team' then 'impersonation' when 'privacy_concern' then 'privacy_request' when 'incorrect_match' then 'result_dispute' else 'content_report' end;
  insert into public.platform_cases (case_type, title, summary, subject_type, subject_ref, subject_label, reporter_id, source_report_id, created_by)
  values (v_type, left('Report: ' || coalesce(v_report.entity_label, v_report.entity_type), 160), v_report.details, v_report.entity_type, v_report.entity_ref, v_report.entity_label, v_report.reporter_id, p_report, (select auth.uid()))
  returning id, reference into v_id, v_ref;
  update public.content_reports set status = 'reviewing' where id = p_report and status = 'open';
  perform public.admin_audit('case_opened_from_report', 'case', v_id::text, v_ref, 'Opened from a public report', v_id, null, jsonb_build_object('type', v_type));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------
-- 4. Moderation: hide and restore without deleting
-- ---------------------------------------------------------------------------------
create table if not exists public.platform_restrictions (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('organization', 'team', 'player', 'tournament', 'news')),
  target_id uuid not null,
  target_label text,
  kind text not null default 'hidden' check (kind in ('hidden')),
  reason text not null check (length(trim(reason)) between 5 and 1000),
  case_id uuid references public.platform_cases(id) on delete set null,
  previous_state text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  lifted_by uuid references public.profiles(id) on delete set null,
  lifted_at timestamptz,
  lift_reason text
);
create unique index if not exists platform_restrictions_active_idx on public.platform_restrictions(target_type, target_id, kind) where lifted_at is null;
alter table public.platform_restrictions enable row level security;

create or replace function public.admin_moderation_permission(p_target_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_target_type
    when 'organization' then 'admin.organizations.moderate'
    when 'team' then 'admin.teams.moderate'
    when 'player' then 'admin.players.moderate'
    when 'tournament' then 'admin.tournaments.moderate'
    when 'news' then 'admin.content.moderate'
  end;
$$;

drop policy if exists "moderators read restrictions" on public.platform_restrictions;
create policy "moderators read restrictions" on public.platform_restrictions for select to authenticated
  using (public.admin_has(public.admin_moderation_permission(target_type)));

-- Owners cannot re-publish a record a platform admin has hidden.
create or replace function public.enforce_platform_hidden()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.platform_restrictions r where r.target_type = tg_argv[0] and r.target_id = new.id and r.kind = 'hidden' and r.lifted_at is null) then
    if tg_argv[0] = 'news' then
      if new.status in ('published', 'scheduled') and new.status is distinct from old.status then raise exception 'hidden_by_platform'; end if;
    elsif new.is_published and not old.is_published then
      raise exception 'hidden_by_platform';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_platform_hidden_trigger on public.organizations;
create trigger enforce_platform_hidden_trigger before update on public.organizations for each row execute function public.enforce_platform_hidden('organization');
drop trigger if exists enforce_platform_hidden_trigger on public.teams;
create trigger enforce_platform_hidden_trigger before update on public.teams for each row execute function public.enforce_platform_hidden('team');
drop trigger if exists enforce_platform_hidden_trigger on public.player_profiles;
create trigger enforce_platform_hidden_trigger before update on public.player_profiles for each row execute function public.enforce_platform_hidden('player');
drop trigger if exists enforce_platform_hidden_trigger on public.tournaments;
create trigger enforce_platform_hidden_trigger before update on public.tournaments for each row execute function public.enforce_platform_hidden('tournament');
drop trigger if exists enforce_platform_hidden_trigger on public.news_articles;
create trigger enforce_platform_hidden_trigger before update on public.news_articles for each row execute function public.enforce_platform_hidden('news');

create or replace function public.admin_set_visibility(p_target_type text, p_target_id uuid, p_hide boolean, p_reason text, p_case uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_permission text := public.admin_moderation_permission(p_target_type);
  v_label text;
  v_state text;
  v_restriction public.platform_restrictions;
begin
  if v_permission is null then raise exception 'invalid_target'; end if;
  perform public.admin_assert(v_permission);
  perform public.admin_require_reason(p_reason);
  case p_target_type
    when 'organization' then select name, case when is_published then 'published' else 'unpublished' end into v_label, v_state from public.organizations where id = p_target_id for update;
    when 'team' then select name, case when is_published then 'published' else 'unpublished' end into v_label, v_state from public.teams where id = p_target_id for update;
    when 'player' then select display_name, case when is_published then 'published' else 'unpublished' end into v_label, v_state from public.player_profiles where id = p_target_id for update;
    when 'tournament' then select name, case when is_published then 'published' else 'unpublished' end into v_label, v_state from public.tournaments where id = p_target_id for update;
    else select title, status into v_label, v_state from public.news_articles where id = p_target_id for update;
  end case;
  if v_label is null then raise exception 'not_found'; end if;
  select * into v_restriction from public.platform_restrictions where target_type = p_target_type and target_id = p_target_id and kind = 'hidden' and lifted_at is null for update;

  if p_hide then
    if v_restriction.id is not null then raise exception 'already_hidden'; end if;
    insert into public.platform_restrictions (target_type, target_id, target_label, reason, case_id, previous_state, created_by)
    values (p_target_type, p_target_id, v_label, trim(p_reason), p_case, v_state, (select auth.uid()));
    case p_target_type
      when 'organization' then update public.organizations set is_published = false where id = p_target_id;
      when 'team' then update public.teams set is_published = false where id = p_target_id;
      when 'player' then update public.player_profiles set is_published = false where id = p_target_id;
      when 'tournament' then update public.tournaments set is_published = false where id = p_target_id;
      else update public.news_articles set status = 'archived' where id = p_target_id;
    end case;
    perform public.admin_audit('record_hidden', p_target_type, p_target_id::text, v_label, p_reason, p_case, jsonb_build_object('state', v_state), jsonb_build_object('state', 'hidden'));
  else
    if v_restriction.id is null then raise exception 'not_hidden'; end if;
    update public.platform_restrictions set lifted_at = now(), lifted_by = (select auth.uid()), lift_reason = trim(p_reason) where id = v_restriction.id;
    -- Restore exactly what was there before; an unpublished record stays unpublished.
    case p_target_type
      when 'organization' then update public.organizations set is_published = (v_restriction.previous_state = 'published') where id = p_target_id;
      when 'team' then update public.teams set is_published = (v_restriction.previous_state = 'published') where id = p_target_id;
      when 'player' then update public.player_profiles set is_published = (v_restriction.previous_state = 'published') where id = p_target_id;
      when 'tournament' then update public.tournaments set is_published = (v_restriction.previous_state = 'published') where id = p_target_id;
      else update public.news_articles set status = v_restriction.previous_state where id = p_target_id;
    end case;
    perform public.admin_audit('record_restored', p_target_type, p_target_id::text, v_label, p_reason, coalesce(p_case, v_restriction.case_id), jsonb_build_object('state', 'hidden'), jsonb_build_object('state', v_restriction.previous_state));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------
-- 5. Accounts and sessions
-- ---------------------------------------------------------------------------------
create table if not exists public.platform_account_status (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null check (status in ('active', 'suspended')),
  reason text not null,
  case_id uuid references public.platform_cases(id) on delete set null,
  set_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.platform_account_status enable row level security;
-- A person can see their own status (so the app can explain a suspension); admins with account access see all.
drop policy if exists "account status readable" on public.platform_account_status;
create policy "account status readable" on public.platform_account_status for select to authenticated
  using (user_id = (select auth.uid()) or (select public.admin_has('admin.accounts.read')));

-- Owners are never actionable from the app; other administrators only by someone who manages admins.
create or replace function public.admin_assert_account_target(p_user uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user = (select auth.uid()) then raise exception 'self_action_not_allowed'; end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then raise exception 'not_found'; end if;
  if public.admin_is_owner(p_user) then raise exception 'protected_account'; end if;
  if public.admin_is_staff(p_user) and not public.admin_has('admin.admins.manage') then raise exception 'protected_account'; end if;
end;
$$;

-- Ends refresh tokens; already-issued access tokens stop working when they expire (one hour by default).
create or replace function public.admin_revoke_sessions(p_user uuid, p_reason text, p_case uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform public.admin_assert('admin.sessions.revoke');
  perform public.admin_require_reason(p_reason);
  perform public.admin_assert_account_target(p_user);
  delete from auth.refresh_tokens where user_id = p_user::text;
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  perform public.admin_audit('sessions_revoked', 'account', p_user::text, null, p_reason, p_case, null, jsonb_build_object('sessions', v_count));
  return v_count;
end;
$$;

-- Suspension bans sign-in through Supabase Auth and ends sessions. Records are kept.
create or replace function public.admin_set_account_status(p_user uuid, p_status text, p_reason text, p_case uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before text;
begin
  perform public.admin_assert('admin.accounts.suspend');
  perform public.admin_require_reason(p_reason);
  perform public.admin_require_recent_auth();
  perform public.admin_assert_account_target(p_user);
  if p_status not in ('active', 'suspended') then raise exception 'invalid_status'; end if;
  select status into v_before from public.platform_account_status where user_id = p_user;
  insert into public.platform_account_status (user_id, status, reason, case_id, set_by) values (p_user, p_status, trim(p_reason), p_case, (select auth.uid()))
  on conflict (user_id) do update set status = excluded.status, reason = excluded.reason, case_id = excluded.case_id, set_by = excluded.set_by, updated_at = now();
  if p_status = 'suspended' then
    update auth.users set banned_until = 'infinity'::timestamptz where id = p_user;
    delete from auth.refresh_tokens where user_id = p_user::text;
    delete from auth.sessions where user_id = p_user;
  else
    update auth.users set banned_until = null where id = p_user;
  end if;
  perform public.admin_audit(case when p_status = 'suspended' then 'account_suspended' else 'account_restored' end, 'account', p_user::text, null, p_reason, p_case, jsonb_build_object('status', coalesce(v_before, 'active')), jsonb_build_object('status', p_status));
end;
$$;

create or replace function public.admin_search_accounts(p_query text default null, p_limit integer default 20, p_offset integer default 0)
returns table (id uuid, display_name text, email text, email_verified boolean, created_at timestamptz, last_sign_in_at timestamptz, status text, session_count integer, player_profiles integer, teams integer, organizations integer, is_admin boolean, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_query text := nullif(trim(coalesce(p_query, '')), '');
begin
  perform public.admin_assert('admin.accounts.read');
  return query
  select u.id, coalesce(nullif(p.display_name, ''), 'Unnamed account'), u.email::text, u.email_confirmed_at is not null, u.created_at, u.last_sign_in_at,
    coalesce(s.status, 'active'),
    (select count(*)::integer from auth.sessions x where x.user_id = u.id),
    (select count(*)::integer from public.player_profiles pp where pp.account_id = u.id),
    (select count(*)::integer from public.team_memberships tm where tm.user_id = u.id),
    (select count(*)::integer from public.organization_memberships om where om.user_id = u.id),
    public.admin_is_staff(u.id),
    count(*) over ()
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.platform_account_status s on s.user_id = u.id
  where v_query is null or u.email ilike '%' || v_query || '%' or p.display_name ilike '%' || v_query || '%'
  order by u.created_at desc, u.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------------------
-- 6. Directory, overview and result integrity (read-only)
-- ---------------------------------------------------------------------------------
create or replace function public.admin_open_reports(p_type text, p_id uuid, p_slug text)
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.content_reports r where r.entity_type = p_type and r.entity_ref in (p_id::text, p_slug) and r.status in ('open', 'reviewing');
$$;

create or replace function public.admin_directory(p_type text, p_query text default null, p_filter text default 'all', p_limit integer default 20, p_offset integer default 0)
returns table (id uuid, label text, slug text, published boolean, hidden boolean, created_at timestamptz, detail jsonb, open_reports bigint, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_query text := nullif(trim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if public.admin_moderation_permission(p_type) is null then raise exception 'invalid_target'; end if;
  perform public.admin_assert(public.admin_moderation_permission(p_type));
  if p_type = 'organization' then
    return query select r.* from (
      select o.id, o.name, o.slug, o.is_published, exists (select 1 from public.platform_restrictions x where x.target_type = 'organization' and x.target_id = o.id and x.lifted_at is null) as hidden, o.created_at,
        jsonb_build_object('tournaments', (select count(*) from public.tournaments t where t.organization_id = o.id), 'members', (select count(*) from public.organization_memberships m where m.organization_id = o.id),
          'owner', (select pr.display_name from public.organization_memberships m join public.profiles pr on pr.id = m.user_id where m.organization_id = o.id and m.role = 'owner' limit 1)),
        public.admin_open_reports('organization', o.id, o.slug), count(*) over ()
      from public.organizations o
      where (v_query is null or o.name ilike '%' || v_query || '%' or o.slug ilike '%' || v_query || '%')
    ) r where p_filter = 'all' or (p_filter = 'published' and r.is_published) or (p_filter = 'unpublished' and not r.is_published) or (p_filter = 'hidden' and r.hidden)
    order by r.created_at desc, r.id limit v_limit offset v_offset;
  elsif p_type = 'team' then
    return query select r.* from (
      select t.id, t.name, t.slug, t.is_published, exists (select 1 from public.platform_restrictions x where x.target_type = 'team' and x.target_id = t.id and x.lifted_at is null) as hidden, t.created_at,
        jsonb_build_object('teamType', t.team_type, 'island', t.island, 'players', (select count(*) from public.player_team_memberships m where m.team_id = t.id and m.status = 'active'),
          'tournaments', (select count(*) from public.tournament_entries e where e.team_id = t.id), 'managers', (select count(*) from public.team_memberships m where m.team_id = t.id)),
        public.admin_open_reports('team', t.id, t.slug), count(*) over ()
      from public.teams t
      where (v_query is null or t.name ilike '%' || v_query || '%' or t.slug ilike '%' || v_query || '%')
    ) r where p_filter = 'all' or (p_filter = 'published' and r.is_published) or (p_filter = 'unpublished' and not r.is_published) or (p_filter = 'hidden' and r.hidden)
    order by r.created_at desc, r.id limit v_limit offset v_offset;
  elsif p_type = 'player' then
    -- Names, public code and status only; no identity, contact or document data.
    return query select r.* from (
      select p.id, p.display_name, p.slug, p.is_published, exists (select 1 from public.platform_restrictions x where x.target_type = 'player' and x.target_id = p.id and x.lifted_at is null) as hidden, p.created_at,
        jsonb_build_object('code', p.public_code, 'claimed', p.account_id is not null, 'minor', p.is_minor, 'island', p.island,
          'teams', (select coalesce(jsonb_agg(t.name order by t.name), '[]'::jsonb) from public.player_team_memberships m join public.teams t on t.id = m.team_id where m.player_id = p.id and m.status = 'active'),
          'openRequests', (select count(*) from public.player_correction_requests q where q.player_id = p.id and q.status in ('pending', 'under_review'))),
        public.admin_open_reports('player', p.id, p.slug), count(*) over ()
      from public.player_profiles p
      where (v_query is null or p.display_name ilike '%' || v_query || '%' or p.public_code ilike '%' || v_query || '%' or p.slug ilike '%' || v_query || '%')
    ) r where p_filter = 'all' or (p_filter = 'published' and r.is_published) or (p_filter = 'unpublished' and not r.is_published) or (p_filter = 'hidden' and r.hidden)
    order by r.created_at desc, r.id limit v_limit offset v_offset;
  elsif p_type = 'tournament' then
    return query select r.* from (
      select t.id, t.name, t.slug, t.is_published, exists (select 1 from public.platform_restrictions x where x.target_type = 'tournament' and x.target_id = t.id and x.lifted_at is null) as hidden, t.created_at,
        jsonb_build_object('sport', t.sport, 'status', t.status, 'organization', o.name, 'entries', (select count(*) from public.tournament_entries e where e.tournament_id = t.id),
          'matches', (select count(*) from public.matches m where m.tournament_id = t.id)),
        public.admin_open_reports('tournament', t.id, t.slug), count(*) over ()
      from public.tournaments t join public.organizations o on o.id = t.organization_id
      where (v_query is null or t.name ilike '%' || v_query || '%' or t.slug ilike '%' || v_query || '%' or o.name ilike '%' || v_query || '%')
    ) r where p_filter = 'all' or (p_filter = 'published' and r.is_published) or (p_filter = 'unpublished' and not r.is_published) or (p_filter = 'hidden' and r.hidden)
    order by r.created_at desc, r.id limit v_limit offset v_offset;
  else
    return query select r.* from (
      select n.id, n.title, n.slug, n.status = 'published' as published, exists (select 1 from public.platform_restrictions x where x.target_type = 'news' and x.target_id = n.id and x.lifted_at is null) as hidden, n.created_at,
        jsonb_build_object('status', n.status, 'type', n.content_type, 'organization', (select o.name from public.organizations o where o.id = n.organization_id)),
        public.admin_open_reports('news', n.id, n.slug), count(*) over ()
      from public.news_articles n
      where (v_query is null or n.title ilike '%' || v_query || '%' or n.slug ilike '%' || v_query || '%')
    ) r where p_filter = 'all' or (p_filter = 'published' and r.published) or (p_filter = 'unpublished' and not r.published) or (p_filter = 'hidden' and r.hidden)
    order by r.created_at desc, r.id limit v_limit offset v_offset;
  end if;
end;
$$;

-- Matches that need integrity attention: conflicting result versions, sync conflicts or corrections.
create or replace function public.admin_result_issues(p_filter text default 'all', p_limit integer default 20, p_offset integer default 0)
returns table (match_id uuid, tournament_name text, tournament_slug text, home_name text, away_name text, status text, scheduled_at timestamptz, versions integer, conflicts integer, sync_conflicts integer, corrected boolean, total bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_assert('admin.results.review');
  return query select r.* from (
    select m.id as match_ref, t.name as tournament_label, t.slug as tournament_key, h.name as home_label, a.name as away_label, m.status as match_status, m.scheduled_at as kickoff,
      (select count(*)::integer from public.match_result_versions v where v.match_id = m.id) as version_count,
      (select count(*)::integer from public.match_result_versions v where v.match_id = m.id and v.status = 'conflict') as conflicts,
      (select count(*)::integer from public.offline_sync_operations o where o.match_id = m.id and o.status = 'conflict') as sync_conflicts,
      exists (select 1 from public.match_result_versions v where v.match_id = m.id and v.correction_reason is not null) as corrected,
      count(*) over () as total_rows
    from public.matches m
    join public.tournaments t on t.id = m.tournament_id
    left join public.teams h on h.id = m.home_team_id
    left join public.teams a on a.id = m.away_team_id
    where exists (select 1 from public.match_result_versions v where v.match_id = m.id and (v.status = 'conflict' or v.correction_reason is not null))
       or exists (select 1 from public.offline_sync_operations o where o.match_id = m.id and o.status = 'conflict')
  ) r
  where p_filter = 'all' or (p_filter = 'conflicts' and (r.conflicts > 0 or r.sync_conflicts > 0)) or (p_filter = 'corrected' and r.corrected)
  order by r.kickoff desc nulls last, r.match_ref
  limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Counts only, and only the ones the caller is allowed to see (absent keys mean "not permitted").
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v jsonb := '{}'::jsonb;
begin
  perform public.admin_assert('admin.dashboard.read');
  if public.admin_has('admin.cases.manage') then
    v := v || jsonb_build_object(
      'openCases', (select count(*) from public.platform_cases c where c.status not in ('resolved', 'rejected', 'closed') and public.admin_can_see_case_type(c.case_type)),
      'criticalCases', (select count(*) from public.platform_cases c where c.status not in ('resolved', 'rejected', 'closed') and c.severity = 'critical' and public.admin_can_see_case_type(c.case_type)),
      'myCases', (select count(*) from public.platform_cases c where c.assigned_to = v_me and c.status not in ('resolved', 'rejected', 'closed')),
      'overdueCases', (select count(*) from public.platform_cases c where c.due_at < now() and c.status not in ('resolved', 'rejected', 'closed') and public.admin_can_see_case_type(c.case_type)),
      'supportCases', (select count(*) from public.platform_cases c where c.case_type = 'technical_support' and c.status not in ('resolved', 'rejected', 'closed')));
  end if;
  if public.admin_has('admin.content.moderate') then
    v := v || jsonb_build_object('openReports', (select count(*) from public.content_reports r where r.status = 'open'));
  end if;
  if public.admin_has('admin.identities.review') then
    v := v || jsonb_build_object('identityRequests', (select count(*) from public.player_correction_requests q where q.status in ('pending', 'under_review') and q.request_type in ('identity', 'verification', 'impersonation', 'duplicate_profile', 'roster')));
  end if;
  if public.admin_has('admin.data_requests.manage') then
    v := v || jsonb_build_object('dataRequests', (select count(*) from public.player_correction_requests q where q.status in ('pending', 'under_review') and q.request_type in ('privacy', 'data_copy', 'account_closure')));
  end if;
  if public.admin_has('admin.notifications.manage') then
    v := v || jsonb_build_object('deliveryFailures', (select count(*) from public.notification_deliveries d where d.state = 'failed'));
  end if;
  if public.admin_has('admin.results.review') then
    v := v || jsonb_build_object('syncConflicts', (select count(*) from public.offline_sync_operations o where o.status = 'conflict') + (select count(*) from public.match_result_versions r where r.status = 'conflict'));
  end if;
  if public.admin_has('admin.admins.manage') then
    v := v || jsonb_build_object('pendingAdminApprovals', (select count(*) from public.platform_admin_assignments x where x.status = 'proposed' and x.proposed_by <> v_me and x.user_id <> v_me));
  end if;
  if public.admin_has('admin.accounts.read') then
    v := v || jsonb_build_object('suspendedAccounts', (select count(*) from public.platform_account_status s where s.status = 'suspended'));
  end if;
  if public.admin_has('admin.customization.publish') then
    v := v || jsonb_build_object('customizationReviews', (select count(*) from public.app_configuration_versions c where c.status = 'in_review'));
  end if;
  v := v || jsonb_build_object('hiddenRecords', (select count(*) from public.platform_restrictions r where r.lifted_at is null and public.admin_has(public.admin_moderation_permission(r.target_type))));
  return v;
end;
$$;

-- Exports are themselves audited: the app records the export before it builds the file.
create or replace function public.admin_record_export(p_scope text, p_rows integer, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_assert('admin.audit.export');
  perform public.admin_require_reason(p_reason);
  perform public.admin_audit('audit_exported', 'audit', null, left(p_scope, 200), p_reason, null, null, jsonb_build_object('rows', p_rows));
end;
$$;

-- ---------------------------------------------------------------------------------
-- 7. Admin management
-- ---------------------------------------------------------------------------------
create or replace function public.admin_list_admins()
returns table (assignment_id uuid, user_id uuid, display_name text, email text, role text, extra_permissions text[], status text, reason text, proposed_by_name text, decided_by_name text, starts_at timestamptz, expires_at timestamptz, last_used_at timestamptz, created_at timestamptz, bootstrap boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_assert('admin.admins.manage');
  return query
  select null::uuid, a.user_id, coalesce(nullif(p.display_name, ''), 'Unnamed account'), u.email::text, 'platform_owner', '{}'::text[], 'active', coalesce(a.note, 'Granted in the database'), null::text, null::text, a.created_at, null::timestamptz, null::timestamptz, a.created_at, true
    from public.platform_admins a join auth.users u on u.id = a.user_id left join public.profiles p on p.id = a.user_id
  union all
  select x.id, x.user_id, coalesce(nullif(p.display_name, ''), 'Unnamed account'), u.email::text, x.role, x.extra_permissions,
    case when x.status = 'active' and x.expires_at is not null and x.expires_at <= now() then 'expired' else x.status end,
    x.reason, pb.display_name, db.display_name, x.starts_at, x.expires_at, x.last_used_at, x.created_at, false
    from public.platform_admin_assignments x join auth.users u on u.id = x.user_id left join public.profiles p on p.id = x.user_id
    left join public.profiles pb on pb.id = x.proposed_by left join public.profiles db on db.id = x.decided_by
  order by 15 desc, 14 desc;
end;
$$;

-- Nobody can give out permissions they do not hold or promote themselves. Platform
-- Owner proposals wait for a different owner; other roles start immediately.
create or replace function public.admin_propose_assignment(p_email text, p_role text, p_reason text, p_expires_at timestamptz default null, p_extra text[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_user uuid;
  v_id uuid;
  v_grant text[] := public.admin_role_permissions(p_role) || coalesce(p_extra, '{}');
  v_status text;
begin
  perform public.admin_assert('admin.admins.manage');
  perform public.admin_require_reason(p_reason);
  perform public.admin_require_recent_auth();
  if cardinality(public.admin_role_permissions(p_role)) = 0 then raise exception 'invalid_role'; end if;
  if not (coalesce(p_extra, '{}') <@ public.admin_all_permissions()) then raise exception 'invalid_permission'; end if;
  if not (v_grant <@ public.admin_permissions()) then raise exception 'cannot_grant_more_than_you_hold'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'invalid_expiry'; end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_user is null or not exists (select 1 from public.profiles p where p.id = v_user) then raise exception 'account_not_found'; end if;
  if v_user = v_me then raise exception 'self_action_not_allowed'; end if;
  if exists (select 1 from public.platform_admin_assignments x where x.user_id = v_user and x.role = p_role and x.status in ('proposed', 'active', 'suspended')) then raise exception 'already_assigned'; end if;
  v_status := case when p_role = 'platform_owner' then 'proposed' else 'active' end;
  insert into public.platform_admin_assignments (user_id, role, extra_permissions, status, reason, proposed_by, decided_by, decided_at, expires_at)
  values (v_user, p_role, coalesce(p_extra, '{}'), v_status, trim(p_reason), v_me, case when v_status = 'active' then v_me end, case when v_status = 'active' then now() end, p_expires_at)
  returning id into v_id;
  perform public.admin_audit(case when v_status = 'active' then 'admin_granted' else 'admin_proposed' end, 'admin_assignment', v_id::text, p_role, p_reason, null, null,
    jsonb_build_object('role', p_role, 'extra', coalesce(p_extra, '{}'), 'expires', p_expires_at, 'status', v_status), v_id);
  return v_id;
end;
$$;

create or replace function public.admin_decide_assignment(p_assignment uuid, p_approve boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_row public.platform_admin_assignments;
begin
  perform public.admin_assert('admin.admins.manage');
  perform public.admin_require_reason(p_reason);
  perform public.admin_require_recent_auth();
  select * into v_row from public.platform_admin_assignments where id = p_assignment for update;
  if not found or v_row.status <> 'proposed' then raise exception 'not_found'; end if;
  if v_row.proposed_by = v_me or v_row.user_id = v_me then raise exception 'self_approval_not_allowed'; end if;
  if v_row.role = 'platform_owner' and not public.admin_is_owner(v_me) then raise exception 'admin_permission_denied'; end if;
  update public.platform_admin_assignments set status = case when p_approve then 'active' else 'rejected' end, decided_by = v_me, decided_at = now(), decision_note = trim(p_reason), starts_at = case when p_approve then greatest(starts_at, now()) else starts_at end, updated_at = now()
  where id = p_assignment;
  perform public.admin_audit(case when p_approve then 'admin_approved' else 'admin_rejected' end, 'admin_assignment', p_assignment::text, v_row.role, p_reason, null,
    jsonb_build_object('status', 'proposed', 'proposed_by', v_row.proposed_by), jsonb_build_object('status', case when p_approve then 'active' else 'rejected' end), p_assignment);
end;
$$;

create or replace function public.admin_change_assignment(p_assignment uuid, p_action text, p_reason text, p_expires_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_row public.platform_admin_assignments;
  v_status text;
begin
  perform public.admin_assert('admin.admins.manage');
  perform public.admin_require_reason(p_reason);
  perform public.admin_require_recent_auth();
  select * into v_row from public.platform_admin_assignments where id = p_assignment for update;
  if not found then raise exception 'not_found'; end if;
  if v_row.user_id = v_me then raise exception 'self_action_not_allowed'; end if;
  if v_row.role = 'platform_owner' and not public.admin_is_owner(v_me) then raise exception 'admin_permission_denied'; end if;
  if p_action = 'suspend' and v_row.status = 'active' then v_status := 'suspended';
  elsif p_action = 'reactivate' and v_row.status = 'suspended' then v_status := 'active';
  elsif p_action = 'revoke' and v_row.status in ('active', 'suspended', 'proposed') then v_status := 'revoked';
  elsif p_action = 'extend' and v_row.status in ('active', 'suspended') then
    if p_expires_at is null or p_expires_at <= now() then raise exception 'invalid_expiry'; end if;
    v_status := v_row.status;
  else raise exception 'invalid_transition';
  end if;
  update public.platform_admin_assignments set status = v_status, expires_at = case when p_action = 'extend' then p_expires_at else expires_at end, updated_at = now() where id = p_assignment;
  perform public.admin_audit('admin_' || p_action, 'admin_assignment', p_assignment::text, v_row.role, p_reason, null,
    jsonb_build_object('status', v_row.status, 'expires', v_row.expires_at), jsonb_build_object('status', v_status, 'expires', case when p_action = 'extend' then p_expires_at else v_row.expires_at end), p_assignment);
end;
$$;

-- ---------------------------------------------------------------------------------
-- 8. App customization: versioned, reviewed, published atomically, rolled back as a new version
-- ---------------------------------------------------------------------------------
create table if not exists public.app_configuration_versions (
  id uuid primary key default gen_random_uuid(),
  version bigint generated always as identity unique,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'rejected', 'published', 'superseded')),
  config jsonb not null,
  summary text not null check (length(trim(summary)) between 3 and 300),
  created_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_note text check (review_note is null or length(review_note) <= 500),
  reviewed_at timestamptz,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  rollback_of bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists app_configuration_one_published on public.app_configuration_versions(status) where status = 'published';
alter table public.app_configuration_versions enable row level security;
drop policy if exists "customization admins read versions" on public.app_configuration_versions;
create policy "customization admins read versions" on public.app_configuration_versions for select to authenticated
  using ((select public.admin_has('admin.customization.edit')) or (select public.admin_has('admin.customization.publish')));

-- Only presentation values with fixed shapes are accepted: no HTML, scripts, links, CSS or private fields.
create or replace function public.app_config_problem(p_config jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_key text;
  v_value jsonb;
  v_colours constant text[] := array['accent', 'accentStrong', 'ink', 'ink2', 'live', 'ok', 'warn'];
  v_copy constant text[] := array['heroEyebrow', 'heroTitle', 'heroTitleAccent', 'heroLede'];
  v_sections constant text[] := array['sports', 'live-today', 'featured', 'recently-active', 'upcoming', 'standings-bracket', 'top-players', 'active-teams', 'recent-results', 'news', 'recently-viewed', 'organizer-cta', 'how-it-works', 'install'];
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then return 'config_not_object'; end if;
  if octet_length(p_config::text) > 8000 then return 'config_too_large'; end if;
  for v_key in select jsonb_object_keys(p_config) loop
    if v_key not in ('theme', 'landing') then return 'unknown_key:' || v_key; end if;
  end loop;
  if p_config ? 'theme' then
    if jsonb_typeof(p_config -> 'theme') <> 'object' then return 'theme_not_object'; end if;
    for v_key, v_value in select * from jsonb_each(p_config -> 'theme') loop
      if v_key = any(v_colours) then
        if jsonb_typeof(v_value) <> 'string' or (v_value #>> '{}') !~ '^#[0-9a-fA-F]{6}$' then return 'invalid_colour:' || v_key; end if;
      elsif v_key = 'radius' then
        if jsonb_typeof(v_value) <> 'number' or (v_value #>> '{}')::numeric not between 4 and 28 then return 'invalid_radius'; end if;
      else return 'unknown_theme_key:' || v_key;
      end if;
    end loop;
  end if;
  if p_config ? 'landing' then
    if jsonb_typeof(p_config -> 'landing') <> 'object' then return 'landing_not_object'; end if;
    for v_key, v_value in select * from jsonb_each(p_config -> 'landing') loop
      if v_key = any(v_copy) then
        if jsonb_typeof(v_value) <> 'string' or length(v_value #>> '{}') > (case when v_key = 'heroLede' then 200 else 60 end) then return 'invalid_text:' || v_key; end if;
        if (v_value #>> '{}') ~ '[<>{}]' or (v_value #>> '{}') ~* '(javascript|data|vbscript):' then return 'unsafe_text:' || v_key; end if;
      elsif v_key = 'hiddenSections' then
        if jsonb_typeof(v_value) <> 'array' then return 'invalid_sections'; end if;
        if exists (select 1 from jsonb_array_elements(v_value) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') <> all(v_sections)) then return 'invalid_sections'; end if;
      else return 'unknown_landing_key:' || v_key;
      end if;
    end loop;
  end if;
  return null;
end;
$$;

create or replace function public.app_config_assert(p_config jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare
  v_problem text := public.app_config_problem(p_config);
begin
  if v_problem is not null then raise exception 'invalid_configuration: %', v_problem; end if;
end;
$$;

-- The published presentation configuration is public (it is shown to every visitor).
create or replace function public.get_active_configuration()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('version', c.version, 'config', c.config, 'publishedAt', c.published_at)
  from public.app_configuration_versions c where c.status = 'published' limit 1;
$$;

create or replace function public.admin_save_config_draft(p_id uuid, p_config jsonb, p_summary text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_row public.app_configuration_versions;
begin
  perform public.admin_assert('admin.customization.edit');
  perform public.app_config_assert(p_config);
  if p_id is null then
    insert into public.app_configuration_versions (config, summary, created_by) values (p_config, trim(p_summary), (select auth.uid())) returning id into v_id;
    perform public.admin_audit('customization_draft_created', 'configuration', v_id::text, trim(p_summary), null, null, null, null);
    return v_id;
  end if;
  select * into v_row from public.app_configuration_versions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_row.status not in ('draft', 'rejected') then raise exception 'version_locked'; end if;
  update public.app_configuration_versions set config = p_config, summary = trim(p_summary), status = 'draft', reviewed_by = null, reviewed_at = null, review_note = null, updated_at = now() where id = p_id;
  perform public.admin_audit('customization_draft_saved', 'configuration', p_id::text, trim(p_summary), null, null, null, null);
  return p_id;
end;
$$;

create or replace function public.admin_submit_config(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row public.app_configuration_versions;
begin
  perform public.admin_assert('admin.customization.edit');
  select * into v_row from public.app_configuration_versions where id = p_id for update;
  if not found or v_row.status <> 'draft' then raise exception 'invalid_transition'; end if;
  perform public.app_config_assert(v_row.config);
  update public.app_configuration_versions set status = 'in_review', updated_at = now() where id = p_id;
  perform public.admin_audit('customization_submitted', 'configuration', p_id::text, v_row.summary, null, null, null, jsonb_build_object('version', v_row.version));
end;
$$;

-- The reviewer must be someone other than the author, except a Platform Owner (so a
-- single-owner platform is not locked out); a self-approval is recorded as such.
create or replace function public.admin_review_config(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_row public.app_configuration_versions;
begin
  perform public.admin_assert('admin.customization.publish');
  perform public.admin_require_reason(p_note);
  select * into v_row from public.app_configuration_versions where id = p_id for update;
  if not found or v_row.status <> 'in_review' then raise exception 'invalid_transition'; end if;
  if v_row.created_by = v_me and not public.admin_is_owner(v_me) then raise exception 'self_approval_not_allowed'; end if;
  update public.app_configuration_versions set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = v_me, reviewed_at = now(), review_note = trim(p_note), updated_at = now() where id = p_id;
  perform public.admin_audit(case when p_approve then 'customization_approved' else 'customization_rejected' end, 'configuration', p_id::text, v_row.summary, p_note, null, null,
    jsonb_build_object('version', v_row.version, 'self_approved', v_row.created_by = v_me));
end;
$$;

create or replace function public.admin_publish_config(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row public.app_configuration_versions;
  v_previous bigint;
begin
  perform public.admin_assert('admin.customization.publish');
  perform public.admin_require_reason(p_reason);
  select * into v_row from public.app_configuration_versions where id = p_id for update;
  if not found or v_row.status <> 'approved' then raise exception 'invalid_transition'; end if;
  perform public.app_config_assert(v_row.config);
  -- One transaction: the old version is superseded and the new one goes live together.
  update public.app_configuration_versions set status = 'superseded', updated_at = now() where status = 'published' returning version into v_previous;
  update public.app_configuration_versions set status = 'published', published_by = (select auth.uid()), published_at = now(), updated_at = now() where id = p_id;
  perform public.admin_audit('customization_published', 'configuration', p_id::text, v_row.summary, p_reason, null, jsonb_build_object('version', v_previous), jsonb_build_object('version', v_row.version));
end;
$$;

-- Rollback copies an earlier version into a new one that goes through review again.
create or replace function public.admin_rollback_config(p_version bigint, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row public.app_configuration_versions;
  v_id uuid;
begin
  perform public.admin_assert('admin.customization.rollback');
  perform public.admin_require_reason(p_reason);
  select * into v_row from public.app_configuration_versions where version = p_version and status in ('published', 'superseded');
  if not found then raise exception 'not_found'; end if;
  insert into public.app_configuration_versions (config, summary, created_by, status, rollback_of)
  values (v_row.config, left('Rollback to version ' || p_version || ': ' || trim(p_reason), 300), (select auth.uid()), 'in_review', p_version)
  returning id into v_id;
  perform public.admin_audit('customization_rollback_proposed', 'configuration', v_id::text, null, p_reason, null, null, jsonb_build_object('rollback_of', p_version));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------
-- 9. Existing admin tools: also open them to the matching scoped roles
-- (027/030/032 policies keep working for bootstrap owners).
-- ---------------------------------------------------------------------------------
drop policy if exists "content admins manage highlights" on public.platform_highlights;
create policy "content admins manage highlights" on public.platform_highlights for all to authenticated
  using ((select public.admin_has('admin.content.moderate'))) with check ((select public.admin_has('admin.content.moderate')) and created_by is not null);
drop policy if exists "content admins manage announcements" on public.public_announcements;
create policy "content admins manage announcements" on public.public_announcements for all to authenticated
  using ((select public.admin_has('admin.content.moderate'))) with check ((select public.admin_has('admin.content.moderate')));
drop policy if exists "content admins manage platform pages" on public.platform_pages;
create policy "content admins manage platform pages" on public.platform_pages for all to authenticated
  using ((select public.admin_has('admin.content.moderate'))) with check ((select public.admin_has('admin.content.moderate')));
drop policy if exists "moderators read reports" on public.content_reports;
create policy "moderators read reports" on public.content_reports for select to authenticated using ((select public.admin_has('admin.content.moderate')));
drop policy if exists "moderators resolve reports" on public.content_reports;
create policy "moderators resolve reports" on public.content_reports for update to authenticated
  using ((select public.admin_has('admin.content.moderate'))) with check ((select public.admin_has('admin.content.moderate')));
drop policy if exists "identity reviewers read player requests" on public.player_correction_requests;
create policy "identity reviewers read player requests" on public.player_correction_requests for select to authenticated
  using ((select public.admin_has('admin.identities.review')) or (select public.admin_has('admin.data_requests.manage')));
drop policy if exists "identity reviewers resolve player requests" on public.player_correction_requests;
create policy "identity reviewers resolve player requests" on public.player_correction_requests for update to authenticated
  using ((select public.admin_has('admin.identities.review')) or (select public.admin_has('admin.data_requests.manage')))
  with check ((select public.admin_has('admin.identities.review')) or (select public.admin_has('admin.data_requests.manage')));

-- ---------------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------------
-- Internal helpers: not callable from the API at all.
revoke execute on function public.admin_audit(text, text, text, text, text, uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.admin_assert_account_target(uuid) from public, anon, authenticated;
revoke execute on function public.admin_open_reports(text, uuid, text) from public, anon, authenticated;
revoke execute on function public.platform_audit_append_only() from public, anon, authenticated;
revoke execute on function public.enforce_platform_hidden() from public, anon, authenticated;
revoke execute on function public.admin_role_names(uuid) from public, anon, authenticated;
revoke execute on function public.admin_is_owner(uuid) from public, anon, authenticated;
revoke execute on function public.admin_is_staff(uuid) from public, anon, authenticated;
revoke execute on function public.admin_assert(text) from public, anon, authenticated;
revoke execute on function public.admin_require_recent_auth() from public, anon, authenticated;
revoke execute on function public.app_config_assert(jsonb) from public, anon, authenticated;

-- Signed-in callers; each function checks the exact permission itself.
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.admin_all_permissions()', 'public.admin_role_permissions(text)', 'public.admin_permissions()', 'public.admin_has(text)',
    'public.admin_require_reason(text)', 'public.admin_can_see_case_type(text)', 'public.admin_moderation_permission(text)', 'public.app_config_problem(jsonb)',
    'public.admin_open_case(text, text, text, text, text, text, text)', 'public.admin_update_case(uuid, text, text, text, uuid, boolean, text, text)',
    'public.admin_add_case_note(uuid, text, boolean)', 'public.admin_link_cases(uuid, uuid, text)', 'public.admin_case_from_report(uuid)',
    'public.admin_set_visibility(text, uuid, boolean, text, uuid)', 'public.admin_revoke_sessions(uuid, text, uuid)', 'public.admin_set_account_status(uuid, text, text, uuid)',
    'public.admin_search_accounts(text, integer, integer)', 'public.admin_directory(text, text, text, integer, integer)', 'public.admin_result_issues(text, integer, integer)',
    'public.admin_overview()', 'public.admin_record_export(text, integer, text)', 'public.admin_list_admins()', 'public.admin_propose_assignment(text, text, text, timestamptz, text[])',
    'public.admin_decide_assignment(uuid, boolean, text)', 'public.admin_change_assignment(uuid, text, text, timestamptz)',
    'public.admin_save_config_draft(uuid, jsonb, text)', 'public.admin_submit_config(uuid)', 'public.admin_review_config(uuid, boolean, text)',
    'public.admin_publish_config(uuid, text)', 'public.admin_rollback_config(bigint, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;
end;
$$;

-- Visitors need the published theme only.
revoke execute on function public.get_active_configuration() from public;
grant execute on function public.get_active_configuration() to anon, authenticated, service_role;

-- Table privileges: reads go through RLS above; there are no write grants for API roles.
revoke insert, update, delete, truncate on public.platform_admin_assignments, public.platform_audit_events, public.platform_cases, public.platform_case_messages,
  public.platform_restrictions, public.platform_account_status, public.app_configuration_versions from anon, authenticated;
revoke all on public.platform_admin_assignments, public.platform_audit_events, public.platform_cases, public.platform_case_messages,
  public.platform_restrictions, public.platform_account_status, public.app_configuration_versions from anon;
revoke usage on sequence public.platform_case_seq from anon, authenticated;


-- ===== 202611010035_super_admin_release_two.sql =====
-- Super Admin, Release Two (Super Admin specification sections 13, 18, 20-23, 27-47, 52).
-- Review-only. Do not apply, push or deploy without explicit owner authorization.
-- Apply after 202611010034_super_admin_release_one.sql.
--
-- Created with `supabase migration new super_admin_release_two`, then renamed from
-- 20261031135545_… to 202611010035_… so it sorts after 034, which it depends on.
--
-- What this adds:
--   1. Two-person critical actions: exceptional result correction, restoring an
--      earlier result version, and duplicate-player merge. Admin A proposes, a
--      different admin B approves, the server executes once, both are audited.
--   2. Freezing a public result (hides the score publicly; history untouched).
--   3. Case replies delivered to the person as in-app notifications.
--   4. Finance audit: read-only records, findings, and freezing a record.
--   5. Notification operations: delivery list and safe retry.
--   6. Platform configuration (maintenance, feature display, help contacts,
--      sports display) as a second configuration kind with the same
--      draft → review → publish → rollback workflow.
--   7. Wider customization: brand, fonts, navigation, templates, SEO, install
--      prompt text and translation overrides; a media library with a public
--      platform-media bucket.
--
-- Same rules as 034: exact permission checks, reasons, audit, empty search_path,
-- EXECUTE revoked from public and anon, no write grants on admin tables.

-- ---------------------------------------------------------------------------------
-- 1. Two-person critical actions
-- ---------------------------------------------------------------------------------
alter table public.player_profiles add column if not exists merged_into uuid references public.player_profiles(id) on delete restrict;

-- A merged (archived) duplicate can never be published again.
create or replace function public.protect_merged_player()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.merged_into is not null and new.is_published then raise exception 'merged_profile'; end if;
  if old.merged_into is not null and new.merged_into is distinct from old.merged_into then raise exception 'merged_profile'; end if;
  return new;
end;
$$;
drop trigger if exists protect_merged_player_trigger on public.player_profiles;
create trigger protect_merged_player_trigger before update on public.player_profiles for each row execute function public.protect_merged_player();

create sequence if not exists public.admin_action_seq;
create table if not exists public.admin_action_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('KA-' || lpad(nextval('public.admin_action_seq')::text, 6, '0')),
  action_type text not null check (action_type in ('result_correction', 'result_restore', 'player_merge')),
  target_label text,
  payload jsonb not null,
  reason text not null check (length(trim(reason)) between 5 and 1000),
  case_id uuid references public.platform_cases(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'executed', 'rejected', 'cancelled')),
  proposed_by uuid not null references public.profiles(id) on delete restrict,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_action_requests_status_idx on public.admin_action_requests(status, created_at desc);
alter table public.admin_action_requests enable row level security;

create or replace function public.admin_action_permission(p_type text)
returns text language sql immutable set search_path = '' as $$
  select case when p_type in ('result_correction', 'result_restore') then 'admin.results.review' when p_type = 'player_merge' then 'admin.identities.review' end;
$$;

drop policy if exists "admins read action requests" on public.admin_action_requests;
create policy "admins read action requests" on public.admin_action_requests for select to authenticated
  using (public.admin_has(public.admin_action_permission(action_type)));

-- What a merge would move, and anything that makes it unsafe. Nothing is changed.
create or replace function public.admin_merge_preview(p_canonical uuid, p_duplicate uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.player_profiles;
  v_d public.player_profiles;
  v_blockers text[] := '{}';
  v_warnings text[] := '{}';
begin
  perform public.admin_assert('admin.identities.review');
  select * into v_c from public.player_profiles where id = p_canonical;
  select * into v_d from public.player_profiles where id = p_duplicate;
  if v_c.id is null or v_d.id is null then raise exception 'not_found'; end if;
  if p_canonical = p_duplicate then v_blockers := array_append(v_blockers, 'same_profile'::text); end if;
  if v_c.merged_into is not null or v_d.merged_into is not null then v_blockers := array_append(v_blockers, 'already_merged'::text); end if;
  if v_c.account_id is not null and v_d.account_id is not null and v_c.account_id <> v_d.account_id then v_blockers := array_append(v_blockers, 'both_claimed'::text); end if;
  if v_d.account_id is not null and v_c.account_id is null then v_blockers := array_append(v_blockers, 'duplicate_is_claimed'::text); end if;
  if exists (select 1 from public.player_identity_keys k where k.player_id = p_duplicate) then
    v_blockers := array_append(v_blockers, case when exists (select 1 from public.player_identity_keys k where k.player_id = p_canonical) then 'both_have_identity' else 'duplicate_has_identity' end::text);
  end if;
  if exists (select 1 from public.match_player_participants a join public.match_player_participants b on b.match_id = a.match_id where a.player_id = p_canonical and b.player_id = p_duplicate) then v_blockers := array_append(v_blockers, 'same_match'::text); end if;
  if exists (select 1 from public.roster_submission_players a join public.roster_submission_players b on b.submission_id = a.submission_id where a.player_id = p_canonical and b.player_id = p_duplicate) then v_blockers := array_append(v_blockers, 'same_roster'::text); end if;
  if v_c.is_minor <> v_d.is_minor then v_warnings := array_append(v_warnings, 'minor_flag_differs'::text); end if;
  if v_c.display_name <> v_d.display_name then v_warnings := array_append(v_warnings, 'names_differ'::text); end if;
  return jsonb_build_object(
    'canonical', jsonb_build_object('name', v_c.display_name, 'code', v_c.public_code, 'claimed', v_c.account_id is not null, 'published', v_c.is_published),
    'duplicate', jsonb_build_object('name', v_d.display_name, 'code', v_d.public_code, 'claimed', v_d.account_id is not null, 'published', v_d.is_published),
    'memberships', (select count(*) from public.player_team_memberships x where x.player_id = p_duplicate),
    'rosters', (select count(*) from public.roster_submission_players x where x.player_id = p_duplicate),
    'matches', (select count(*) from public.match_player_participants x where x.player_id = p_duplicate),
    'events', (select count(*) from public.match_events x where x.player_id = p_duplicate),
    'milestones', (select count(*) from public.sport_milestones x where x.player_id = p_duplicate),
    'availability', (select count(*) from public.player_match_availability x where x.player_id = p_duplicate),
    'blockers', to_jsonb(v_blockers), 'warnings', to_jsonb(v_warnings));
end;
$$;

-- Validates a proposal's payload; returns a label for the target.
create or replace function public.admin_action_validate(p_type text, p_payload jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_match uuid;
  v_label text;
  v_preview jsonb;
begin
  if p_type in ('result_correction', 'result_restore') then
    begin v_match := (p_payload ->> 'matchId')::uuid; exception when others then raise exception 'invalid_payload'; end;
    select coalesce(h.name, 'To be decided') || ' vs ' || coalesce(a.name, 'To be decided') || ' · ' || t.name into v_label
      from public.matches m join public.tournaments t on t.id = m.tournament_id left join public.teams h on h.id = m.home_team_id left join public.teams a on a.id = m.away_team_id where m.id = v_match;
    if v_label is null then raise exception 'not_found'; end if;
    if p_type = 'result_correction' then
      if jsonb_typeof(p_payload -> 'score') <> 'object' or jsonb_typeof(p_payload #> '{score,home}') <> 'number' or jsonb_typeof(p_payload #> '{score,away}') <> 'number'
        or (p_payload #>> '{score,home}')::numeric < 0 or (p_payload #>> '{score,away}')::numeric < 0 then raise exception 'invalid_score'; end if;
    elsif not exists (select 1 from public.match_result_versions v where v.match_id = v_match and v.version = (p_payload ->> 'version')::integer and v.status in ('confirmed', 'rejected')) then
      raise exception 'not_found';
    end if;
    return v_label;
  elsif p_type = 'player_merge' then
    v_preview := public.admin_merge_preview((p_payload ->> 'canonicalId')::uuid, (p_payload ->> 'duplicateId')::uuid);
    if jsonb_array_length(v_preview -> 'blockers') > 0 then raise exception 'merge_blocked'; end if;
    return (v_preview #>> '{duplicate,name}') || ' into ' || (v_preview #>> '{canonical,name}');
  end if;
  raise exception 'invalid_action';
end;
$$;

create or replace function public.admin_propose_action(p_type text, p_payload jsonb, p_reason text, p_case uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_label text;
  v_id uuid;
  v_ref text;
begin
  if public.admin_action_permission(p_type) is null then raise exception 'invalid_action'; end if;
  perform public.admin_assert(public.admin_action_permission(p_type));
  perform public.admin_require_reason(p_reason);
  v_label := public.admin_action_validate(p_type, p_payload);
  if exists (select 1 from public.admin_action_requests r where r.status = 'pending' and r.action_type = p_type and (
      (p_type <> 'player_merge' and r.payload ->> 'matchId' = p_payload ->> 'matchId')
      or (p_type = 'player_merge' and (r.payload ->> 'duplicateId' = p_payload ->> 'duplicateId' or r.payload ->> 'canonicalId' = p_payload ->> 'duplicateId')))) then
    raise exception 'already_pending';
  end if;
  insert into public.admin_action_requests (action_type, target_label, payload, reason, case_id, proposed_by)
  values (p_type, v_label, p_payload, trim(p_reason), p_case, (select auth.uid())) returning id, reference into v_id, v_ref;
  perform public.admin_audit('action_proposed', 'admin_action', v_id::text, v_ref || ' ' || p_type || ': ' || v_label, p_reason, p_case, null, p_payload - 'score' || jsonb_build_object('type', p_type), v_id);
  return v_id;
end;
$$;

create or replace function public.admin_cancel_action(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row public.admin_action_requests;
begin
  perform public.admin_require_reason(p_reason);
  select * into v_row from public.admin_action_requests where id = p_id for update;
  if not found or v_row.status <> 'pending' then raise exception 'invalid_transition'; end if;
  perform public.admin_assert(public.admin_action_permission(v_row.action_type));
  if v_row.proposed_by <> (select auth.uid()) then raise exception 'admin_permission_denied'; end if;
  update public.admin_action_requests set status = 'cancelled', decided_by = (select auth.uid()), decided_at = now(), decision_note = trim(p_reason) where id = p_id;
  perform public.admin_audit('action_cancelled', 'admin_action', p_id::text, v_row.reference, p_reason, v_row.case_id, null, null, p_id);
end;
$$;

-- Exceptional result change: a new confirmed version, never an overwrite. Mirrors
-- correct_match_result (migration 025): earlier versions are kept, marked superseded
-- by status, and standings and milestones are rebuilt once.
create or replace function public.admin_execute_result_change(p_row public.admin_action_requests, p_approver uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_match public.matches;
  v_score jsonb;
  v_next integer;
  v_result uuid;
  v_reason text := 'Platform ' || replace(p_row.action_type, '_', ' ') || ' ' || p_row.reference || ': ' || p_row.reason;
begin
  select * into v_match from public.matches where id = (p_row.payload ->> 'matchId')::uuid for update;
  if v_match.id is null then raise exception 'not_found'; end if;
  if p_row.action_type = 'result_correction' then v_score := p_row.payload -> 'score';
  else select v.score into v_score from public.match_result_versions v where v.match_id = v_match.id and v.version = (p_row.payload ->> 'version')::integer;
  end if;
  if v_score is null then raise exception 'not_found'; end if;
  select coalesce(max(version), 0) + 1 into v_next from public.match_result_versions where match_id = v_match.id;
  update public.match_result_versions set status = 'rejected' where match_id = v_match.id and status in ('confirmed', 'submitted');
  insert into public.match_result_versions (match_id, version, score, status, submitted_by, confirmed_by, correction_reason)
  values (v_match.id, v_next, v_score, 'confirmed', p_row.proposed_by, p_approver, left(v_reason, 1000)) returning id into v_result;
  update public.matches set status = 'confirmed' where id = v_match.id;
  perform public.recalculate_stage_standings(v_match.stage_id);
  perform public.recalculate_match_milestones(v_match.id);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, reason) values (p_approver, 'match_result_corrected_by_platform', 'match_result_version', v_result, left(v_reason, 1000));
  return jsonb_build_object('version', v_next);
end;
$$;

-- Duplicate merge: sports history moves to the canonical profile, personal records
-- (identity, documents, requests, invitations) stay with the archived duplicate.
-- Blockers (same match, same roster, identity or account conflicts) stop it.
create or replace function public.admin_execute_merge(p_row public.admin_action_requests)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_c uuid := (p_row.payload ->> 'canonicalId')::uuid;
  v_d uuid := (p_row.payload ->> 'duplicateId')::uuid;
  v_preview jsonb := public.admin_merge_preview(v_c, v_d);
  v_matches uuid[];
  v_match uuid;
  v_moved jsonb;
begin
  if jsonb_array_length(v_preview -> 'blockers') > 0 then raise exception 'merge_blocked'; end if;
  perform 1 from public.player_profiles where id in (v_c, v_d) for update;
  select coalesce(array_agg(distinct match_id), '{}') into v_matches from (
    select match_id from public.match_player_participants where player_id = v_d
    union select match_id from public.match_events where player_id = v_d and match_id is not null) affected;
  v_moved := v_preview - 'blockers' - 'warnings' - 'canonical' - 'duplicate';
  -- A duplicate's active membership of a team the canonical player is already in is ended, not deleted.
  update public.player_team_memberships d set status = 'ended', effective_to = greatest(d.effective_from, current_date)
    where d.player_id = v_d and d.status = 'active' and exists (select 1 from public.player_team_memberships c where c.player_id = v_c and c.team_id = d.team_id and c.status = 'active');
  update public.player_team_memberships set player_id = v_c where player_id = v_d;
  update public.roster_submission_players set player_id = v_c where player_id = v_d;
  update public.match_player_participants set player_id = v_c where player_id = v_d;
  update public.match_events set player_id = v_c where player_id = v_d;
  update public.sport_milestones set player_id = v_c where player_id = v_d;
  delete from public.player_match_availability a where a.player_id = v_d and exists (select 1 from public.player_match_availability c where c.player_id = v_c and c.match_id = a.match_id);
  update public.player_match_availability set player_id = v_c where player_id = v_d;
  update public.player_profiles set is_published = false, deactivated_at = coalesce(deactivated_at, now()), merged_into = v_c where id = v_d;
  -- Rebuild automatic milestones once per affected match so nothing is counted twice.
  foreach v_match in array v_matches loop perform public.recalculate_match_milestones(v_match); end loop;
  return v_moved || jsonb_build_object('recalculatedMatches', cardinality(v_matches));
end;
$$;

create or replace function public.admin_decide_action(p_id uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_row public.admin_action_requests;
  v_result jsonb;
begin
  perform public.admin_require_reason(p_note);
  select * into v_row from public.admin_action_requests where id = p_id for update;
  if not found or v_row.status <> 'pending' then raise exception 'invalid_transition'; end if;
  perform public.admin_assert(public.admin_action_permission(v_row.action_type));
  perform public.admin_require_recent_auth();
  -- Two people, always: no exception for owners.
  if v_row.proposed_by = v_me then raise exception 'self_approval_not_allowed'; end if;
  if p_approve then
    v_result := case when v_row.action_type = 'player_merge' then public.admin_execute_merge(v_row) else public.admin_execute_result_change(v_row, v_me) end;
  end if;
  update public.admin_action_requests set status = case when p_approve then 'executed' else 'rejected' end, decided_by = v_me, decided_at = now(), decision_note = trim(p_note), result = v_result where id = p_id;
  perform public.admin_audit(case when p_approve then 'action_approved_executed' else 'action_rejected' end, 'admin_action', p_id::text, v_row.reference || ': ' || coalesce(v_row.target_label, ''), p_note, v_row.case_id,
    jsonb_build_object('proposed_by', v_row.proposed_by), coalesce(v_result, '{}'::jsonb) || jsonb_build_object('type', v_row.action_type), p_id);
  return coalesce(v_result, '{}'::jsonb);
end;
$$;

create or replace function public.admin_list_actions(p_status text default 'pending', p_limit integer default 20, p_offset integer default 0)
returns table (id uuid, reference text, action_type text, target_label text, payload jsonb, reason text, status text, proposed_by_me boolean, proposed_by_name text, decided_by_name text, decision_note text, result jsonb, created_at timestamptz, decided_at timestamptz, total bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.admin_has('admin.results.review') or public.admin_has('admin.identities.review')) then raise exception 'admin_permission_denied'; end if;
  return query
  select r.id, r.reference, r.action_type, r.target_label, r.payload, r.reason, r.status, r.proposed_by = (select auth.uid()), p.display_name, d.display_name, r.decision_note, r.result, r.created_at, r.decided_at, count(*) over ()
  from public.admin_action_requests r left join public.profiles p on p.id = r.proposed_by left join public.profiles d on d.id = r.decided_by
  where public.admin_has(public.admin_action_permission(r.action_type)) and (p_status = 'all' or r.status = p_status)
  order by r.created_at desc, r.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Result versions of one match, for choosing a correction or a restore (admins only).
create or replace function public.admin_match_versions(p_match uuid)
returns table (version integer, status text, home numeric, away numeric, correction_reason text, created_at timestamptz, frozen boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_assert('admin.results.review');
  return query select v.version, v.status,
    case when jsonb_typeof(v.score -> 'home') = 'number' then (v.score ->> 'home')::numeric end,
    case when jsonb_typeof(v.score -> 'away') = 'number' then (v.score ->> 'away')::numeric end,
    v.correction_reason, v.created_at,
    exists (select 1 from public.match_result_freezes f where f.match_id = p_match and f.lifted_at is null)
  from public.match_result_versions v where v.match_id = p_match order by v.version desc;
end;
$$;

-- Find player profiles for a merge (names and public codes only).
create or replace function public.admin_find_players(p_query text)
returns table (id uuid, display_name text, public_code text, island text, claimed boolean, published boolean, merged boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_assert('admin.identities.review');
  if length(trim(coalesce(p_query, ''))) < 2 then return; end if;
  return query select p.id, p.display_name, p.public_code, p.island, p.account_id is not null, p.is_published, p.merged_into is not null
  from public.player_profiles p where p.display_name ilike '%' || trim(p_query) || '%' or p.public_code ilike '%' || trim(p_query) || '%'
  order by p.display_name, p.id limit 20;
end;
$$;

-- ---------------------------------------------------------------------------------
-- 2. Freezing a public result
-- ---------------------------------------------------------------------------------
create table if not exists public.match_result_freezes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  reason text not null check (length(trim(reason)) between 5 and 1000),
  case_id uuid references public.platform_cases(id) on delete set null,
  frozen_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  lifted_by uuid references public.profiles(id) on delete set null,
  lifted_at timestamptz,
  lift_reason text
);
create unique index if not exists match_result_freezes_active_idx on public.match_result_freezes(match_id) where lifted_at is null;
alter table public.match_result_freezes enable row level security;
drop policy if exists "result reviewers read freezes" on public.match_result_freezes;
create policy "result reviewers read freezes" on public.match_result_freezes for select to authenticated using ((select public.admin_has('admin.results.review')));

-- Used by the restrictive policy below; callable by visitors, reveals only a yes/no.
create or replace function public.can_read_match_result(p_match uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.match_result_freezes f where f.match_id = p_match and f.lifted_at is null)
    or (select auth.uid()) is not null and (
      public.is_tournament_operator((select m.tournament_id from public.matches m where m.id = p_match))
      or public.is_match_official(p_match)
      or public.admin_has('admin.results.review'));
$$;

-- Restrictive: applies on top of every existing read policy for these roles.
drop policy if exists "frozen results are not public" on public.match_result_versions;
create policy "frozen results are not public" on public.match_result_versions as restrictive for select to anon, authenticated
  using (public.can_read_match_result(match_id));

create or replace function public.admin_freeze_result(p_match uuid, p_freeze boolean, p_reason text, p_case uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_label text;
  v_active uuid;
begin
  perform public.admin_assert('admin.results.review');
  perform public.admin_require_reason(p_reason);
  select coalesce(h.name, 'To be decided') || ' vs ' || coalesce(a.name, 'To be decided') into v_label
    from public.matches m left join public.teams h on h.id = m.home_team_id left join public.teams a on a.id = m.away_team_id where m.id = p_match;
  if v_label is null then raise exception 'not_found'; end if;
  select id into v_active from public.match_result_freezes where match_id = p_match and lifted_at is null for update;
  if p_freeze then
    if v_active is not null then raise exception 'already_frozen'; end if;
    insert into public.match_result_freezes (match_id, reason, case_id, frozen_by) values (p_match, trim(p_reason), p_case, (select auth.uid()));
  else
    if v_active is null then raise exception 'not_frozen'; end if;
    update public.match_result_freezes set lifted_at = now(), lifted_by = (select auth.uid()), lift_reason = trim(p_reason) where id = v_active;
  end if;
  perform public.admin_audit(case when p_freeze then 'result_frozen' else 'result_unfrozen' end, 'match', p_match::text, v_label, p_reason, p_case, null, null);
end;
$$;

-- The public match feed (032) leaves out the score of a frozen result. Otherwise unchanged.
create or replace function public.get_public_match_feed(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_statuses text[] default null,
  p_tournament_id uuid default null,
  p_limit integer default 60,
  p_newest_first boolean default false
)
returns table(
  match_id uuid, tournament_id uuid, tournament_name text, tournament_slug text, sport text,
  stage_id uuid, stage_name text, stage_format text, stage_order smallint, group_name text, leg smallint,
  scheduled_at timestamptz, venue text, status text,
  home_team_id uuid, home_name text, home_slug text, home_logo text,
  away_team_id uuid, away_name text, away_slug text, away_logo text,
  home_score numeric, away_score numeric, result_outcome text, confirmed_at timestamptz, corrected boolean
)
language sql stable security definer set search_path = public as $$
  with visible as (
    select m.* from public.matches m
    join public.tournaments tr on tr.id = m.tournament_id and tr.is_published and tr.status <> 'draft'
    join public.competition_stages st on st.id = m.stage_id and st.published_at is not null
    where (p_from is null or m.scheduled_at >= p_from)
      and (p_to is null or m.scheduled_at < p_to)
      and (p_statuses is null or m.status = any(p_statuses))
      and (p_tournament_id is null or m.tournament_id = p_tournament_id)
    order by
      case when p_newest_first then m.scheduled_at end desc nulls last,
      case when not p_newest_first then m.scheduled_at end asc nulls last
    limit least(greatest(coalesce(p_limit, 60), 1), 200)
  ), latest as (
    select distinct on (v.match_id) v.match_id, v.score, v.created_at, v.version
    from public.match_result_versions v join visible on visible.id = v.match_id
    where v.status = 'confirmed'
      and not exists (select 1 from public.match_result_freezes f where f.match_id = v.match_id and f.lifted_at is null)
    order by v.match_id, v.version desc
  )
  select m.id, m.tournament_id, tr.name, tr.slug, tr.sport,
    st.id, st.name, st.format, st.stage_order, g.name, m.leg,
    m.scheduled_at, m.venue, m.status,
    m.home_team_id, case when hm.shown then hm.name end, case when hm.is_published then hm.slug end, case when hm.shown then hm.logo_url end,
    m.away_team_id, case when aw.shown then aw.name end, case when aw.is_published then aw.slug end, case when aw.shown then aw.logo_url end,
    case when m.status = 'confirmed' and jsonb_typeof(l.score->'home') = 'number' then (l.score->>'home')::numeric end,
    case when m.status = 'confirmed' and jsonb_typeof(l.score->'away') = 'number' then (l.score->>'away')::numeric end,
    case when m.status = 'confirmed' and l.score->>'outcome' in ('walkover', 'forfeit', 'abandoned') then l.score->>'outcome' end,
    case when m.status = 'confirmed' then l.created_at end,
    coalesce(m.status = 'confirmed' and l.version > 1 and exists (
      select 1 from public.match_result_versions older where older.match_id = m.id and older.status = 'confirmed' and older.version < l.version
    ), false)
  from visible m
  join public.tournaments tr on tr.id = m.tournament_id
  join public.competition_stages st on st.id = m.stage_id
  left join public.competition_groups g on g.id = m.group_id
  left join lateral (
    select t.name, t.slug, t.logo_url, t.is_published,
      (t.is_published or exists (select 1 from public.tournament_entries e where e.team_id = t.id and e.tournament_id = m.tournament_id and e.application_status = 'approved')) as shown
    from public.teams t where t.id = m.home_team_id
  ) hm on true
  left join lateral (
    select t.name, t.slug, t.logo_url, t.is_published,
      (t.is_published or exists (select 1 from public.tournament_entries e where e.team_id = t.id and e.tournament_id = m.tournament_id and e.application_status = 'approved')) as shown
    from public.teams t where t.id = m.away_team_id
  ) aw on true
  left join latest l on l.match_id = m.id
  order by
    case when p_newest_first then m.scheduled_at end desc nulls last,
    case when not p_newest_first then m.scheduled_at end asc nulls last;
$$;

-- ---------------------------------------------------------------------------------
-- 3. Case replies reach the person
-- ---------------------------------------------------------------------------------
alter table public.platform_cases add column if not exists requester_id uuid references public.profiles(id) on delete set null;

create or replace function public.admin_notify_case_person(p_case public.platform_cases, p_body text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_to uuid := coalesce(p_case.requester_id, p_case.reporter_id);
begin
  if v_to is null or p_case.case_type = 'child_safety' then return false; end if;
  insert into public.notifications (recipient_id, notification_type, title, body, channel, created_by)
  values (v_to, 'platform_case_update', 'Update on your request ' || p_case.reference, left(p_body, 1000), 'in_app', (select auth.uid()));
  return true;
end;
$$;

create or replace function public.admin_set_case_requester(p_case uuid, p_email text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_ref text;
begin
  perform public.admin_assert('admin.cases.manage');
  perform public.admin_require_reason(p_reason);
  select reference into v_ref from public.platform_cases c where c.id = p_case and public.admin_can_see_case_type(c.case_type);
  if v_ref is null then raise exception 'not_found'; end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_user is null then raise exception 'account_not_found'; end if;
  update public.platform_cases set requester_id = v_user, updated_at = now() where id = p_case;
  perform public.admin_audit('case_requester_set', 'case', p_case::text, v_ref, p_reason, p_case, null, null);
end;
$$;

-- Same as 034, plus: a note for the person is delivered as an in-app notification.
create or replace function public.admin_add_case_note(p_case uuid, p_body text, p_internal boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_case public.platform_cases;
  v_id uuid;
  v_sent boolean := false;
begin
  perform public.admin_assert('admin.cases.manage');
  select * into v_case from public.platform_cases where id = p_case;
  if not found or not public.admin_can_see_case_type(v_case.case_type) then raise exception 'not_found'; end if;
  insert into public.platform_case_messages (case_id, author_id, body, is_internal) values (p_case, (select auth.uid()), trim(p_body), coalesce(p_internal, true)) returning id into v_id;
  if not coalesce(p_internal, true) then v_sent := public.admin_notify_case_person(v_case, trim(p_body)); end if;
  update public.platform_cases set updated_at = now() where id = p_case;
  perform public.admin_audit(case when coalesce(p_internal, true) then 'case_internal_note' else 'case_user_message' end, 'case', p_case::text, v_case.reference, null, p_case, null, jsonb_build_object('delivered', v_sent));
  return v_id;
end;
$$;

-- Same as 034, plus: a new user-visible response is delivered to the person.
create or replace function public.admin_update_case(p_case uuid, p_reason text, p_status text default null, p_severity text default null, p_assignee uuid default null, p_unassign boolean default false, p_decision text default null, p_user_response text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_case public.platform_cases;
  v_status text;
  v_done constant text[] := array['resolved', 'rejected', 'closed'];
  v_response text := nullif(trim(p_user_response), '');
begin
  perform public.admin_assert('admin.cases.manage');
  perform public.admin_require_reason(p_reason);
  select * into v_case from public.platform_cases where id = p_case for update;
  if not found or not public.admin_can_see_case_type(v_case.case_type) then raise exception 'not_found'; end if;
  v_status := coalesce(p_status, v_case.status);
  if v_case.status = any(v_done) and v_status <> v_case.status and v_status not in ('reopened', 'closed') then raise exception 'invalid_transition'; end if;
  if v_status in ('resolved', 'rejected') and coalesce(nullif(trim(p_decision), ''), v_case.decision) is null then raise exception 'decision_required'; end if;
  if p_assignee is not null and not public.admin_is_staff(p_assignee) then raise exception 'assignee_not_admin'; end if;
  update public.platform_cases set
    status = case when p_assignee is not null and p_status is null and v_case.status in ('new', 'triaged') then 'assigned' else v_status end,
    severity = coalesce(p_severity, severity),
    assigned_to = case when p_unassign then null else coalesce(p_assignee, assigned_to) end,
    decision = coalesce(nullif(trim(p_decision), ''), decision),
    user_response = coalesce(v_response, user_response),
    resolved_at = case when v_status = any(v_done) then coalesce(resolved_at, now()) when v_status = 'reopened' then null else resolved_at end,
    updated_at = now()
  where id = p_case;
  if v_response is not null and v_response is distinct from v_case.user_response then perform public.admin_notify_case_person(v_case, v_response); end if;
  perform public.admin_audit('case_updated', 'case', p_case::text, v_case.reference, p_reason, p_case,
    jsonb_build_object('status', v_case.status, 'severity', v_case.severity, 'assigned', v_case.assigned_to is not null),
    jsonb_build_object('status', v_status, 'severity', coalesce(p_severity, v_case.severity), 'assigned', not p_unassign and coalesce(p_assignee, v_case.assigned_to) is not null, 'responded', v_response is not null));
end;
$$;

-- ---------------------------------------------------------------------------------
-- 4. Finance audit
-- ---------------------------------------------------------------------------------
create table if not exists public.platform_finance_findings (
  id uuid primary key default gen_random_uuid(),
  record_kind text not null check (record_kind in ('tournament_payment', 'finance_expense', 'finance_adjustment', 'team_finance')),
  record_id uuid not null,
  status text not null default 'open' check (status in ('open', 'frozen', 'closed')),
  reason text not null check (length(trim(reason)) between 5 and 1000),
  case_id uuid references public.platform_cases(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  close_note text
);
create unique index if not exists platform_finance_findings_active_idx on public.platform_finance_findings(record_kind, record_id) where status <> 'closed';
alter table public.platform_finance_findings enable row level security;
drop policy if exists "finance auditors read findings" on public.platform_finance_findings;
create policy "finance auditors read findings" on public.platform_finance_findings for select to authenticated using ((select public.admin_has('admin.finance.audit')));

-- A frozen record cannot be edited or deleted by anyone through the API until the finding is unfrozen.
create or replace function public.enforce_finance_freeze()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.platform_finance_findings f where f.record_kind = tg_argv[0] and f.record_id = old.id and f.status = 'frozen') then
    raise exception 'finance_record_frozen';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists enforce_finance_freeze_trigger on public.tournament_payments;
create trigger enforce_finance_freeze_trigger before update or delete on public.tournament_payments for each row execute function public.enforce_finance_freeze('tournament_payment');
drop trigger if exists enforce_finance_freeze_trigger on public.finance_expenses;
create trigger enforce_finance_freeze_trigger before update or delete on public.finance_expenses for each row execute function public.enforce_finance_freeze('finance_expense');
drop trigger if exists enforce_finance_freeze_trigger on public.finance_adjustments;
create trigger enforce_finance_freeze_trigger before update or delete on public.finance_adjustments for each row execute function public.enforce_finance_freeze('finance_adjustment');
drop trigger if exists enforce_finance_freeze_trigger on public.team_finance_records;
create trigger enforce_finance_freeze_trigger before update or delete on public.team_finance_records for each row execute function public.enforce_finance_freeze('team_finance');

-- Amounts, status, related names, actor and whether a receipt exists. Receipt files,
-- private notes and document paths are never returned.
create or replace function public.admin_finance_records(p_kind text, p_filter text default 'all', p_limit integer default 20, p_offset integer default 0)
returns table (record_id uuid, amount_mvr numeric, record_status text, related text, actor text, description text, has_receipt boolean, created_at timestamptz, finding_status text, finding_reason text, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.admin_assert('admin.finance.audit');
  return query select r.* from (
    select x.id as rid, x.amount, x.state, x.related_name, x.actor_name, x.note, x.receipt, x.created, f.status as fstatus, f.reason as freason, count(*) over () as total_rows
    from (
      select p.id, p.amount_mvr as amount, p.status as state, t.name || ' · ' || tm.name as related_name, pr.display_name as actor_name, fee.label as note,
        (p.proof_document_id is not null or exists (select 1 from public.finance_receipts rc where rc.payment_id = p.id)) as receipt, p.created_at as created
      from public.tournament_payments p join public.tournament_entries e on e.id = p.entry_id join public.tournaments t on t.id = e.tournament_id join public.teams tm on tm.id = e.team_id
      join public.tournament_fees fee on fee.id = p.fee_id left join public.profiles pr on pr.id = p.created_by where p_kind = 'tournament_payment'
      union all
      select x2.id, x2.amount_mvr, x2.status, o.name || coalesce(' · ' || t.name, ''), pr.display_name, x2.category || ': ' || x2.description, x2.proof_document_id is not null, x2.created_at
      from public.finance_expenses x2 join public.organizations o on o.id = x2.organization_id left join public.tournaments t on t.id = x2.tournament_id left join public.profiles pr on pr.id = x2.created_by where p_kind = 'finance_expense'
      union all
      select a.id, a.amount_mvr, a.kind, t.name || ' · ' || tm.name, pr.display_name, a.reason, false, a.created_at
      from public.finance_adjustments a join public.tournament_payments p on p.id = a.payment_id join public.tournament_entries e on e.id = p.entry_id join public.tournaments t on t.id = e.tournament_id join public.teams tm on tm.id = e.team_id
      left join public.profiles pr on pr.id = a.approved_by where p_kind = 'finance_adjustment'
      union all
      select tf.id, tf.amount_mvr, tf.kind || ' · ' || tf.status, tm.name, pr.display_name, tf.category || ': ' || tf.description, tf.receipt_path is not null, tf.created_at
      from public.team_finance_records tf join public.teams tm on tm.id = tf.team_id left join public.profiles pr on pr.id = tf.created_by where p_kind = 'team_finance'
    ) x
    left join public.platform_finance_findings f on f.record_kind = p_kind and f.record_id = x.id and f.status <> 'closed'
    where p_filter = 'all' or (p_filter = 'flagged' and f.id is not null)
  ) r order by r.created desc, r.rid limit v_limit offset v_offset;
end;
$$;

create or replace function public.admin_finance_finding(p_kind text, p_record uuid, p_action text, p_reason text, p_case uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_finding public.platform_finance_findings;
begin
  perform public.admin_assert('admin.finance.audit');
  perform public.admin_require_reason(p_reason);
  if p_kind not in ('tournament_payment', 'finance_expense', 'finance_adjustment', 'team_finance') then raise exception 'invalid_target'; end if;
  select * into v_finding from public.platform_finance_findings where record_kind = p_kind and record_id = p_record and status <> 'closed' for update;
  if p_action = 'flag' then
    if v_finding.id is not null then raise exception 'already_flagged'; end if;
    insert into public.platform_finance_findings (record_kind, record_id, reason, case_id, created_by) values (p_kind, p_record, trim(p_reason), p_case, (select auth.uid()));
  elsif p_action in ('freeze', 'unfreeze', 'close') then
    if v_finding.id is null then raise exception 'not_found'; end if;
    if p_action = 'freeze' then perform public.admin_require_recent_auth(); end if;
    update public.platform_finance_findings set
      status = case p_action when 'freeze' then 'frozen' when 'unfreeze' then 'open' else 'closed' end,
      closed_by = case when p_action = 'close' then (select auth.uid()) end, closed_at = case when p_action = 'close' then now() end,
      close_note = case when p_action = 'close' then trim(p_reason) else close_note end, updated_at = now()
    where id = v_finding.id;
  else raise exception 'invalid_action';
  end if;
  perform public.admin_audit('finance_' || p_action, 'finance_record', p_record::text, replace(p_kind, '_', ' '), p_reason, p_case, null, null);
end;
$$;

create or replace function public.admin_record_finance_export(p_kind text, p_rows integer, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_assert('admin.finance.audit');
  perform public.admin_require_reason(p_reason);
  perform public.admin_audit('finance_exported', 'finance_record', null, replace(p_kind, '_', ' '), p_reason, null, null, jsonb_build_object('rows', p_rows));
end;
$$;

-- ---------------------------------------------------------------------------------
-- 5. Notification operations
-- ---------------------------------------------------------------------------------
create or replace function public.admin_list_deliveries(p_state text default 'failed', p_limit integer default 20, p_offset integer default 0)
returns table (delivery_id uuid, channel text, state text, attempts integer, problem text, created_at timestamptz, delivered_at timestamptz, notification_type text, title text, total bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_assert('admin.notifications.manage');
  return query select d.id, d.channel, d.state, d.attempts, left(d.last_error, 200), d.created_at, d.delivered_at, n.notification_type, n.title, count(*) over ()
  from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
  where p_state = 'all' or d.state = p_state
  order by d.created_at desc, d.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Retry re-queues a failed delivery; it never marks anything as delivered.
create or replace function public.admin_retry_delivery(p_delivery uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_assert('admin.notifications.manage');
  perform public.admin_require_reason(p_reason);
  update public.notification_deliveries set state = 'queued' where id = p_delivery and state = 'failed';
  if not found then raise exception 'invalid_transition'; end if;
  perform public.admin_audit('delivery_requeued', 'notification_delivery', p_delivery::text, null, p_reason, null, null, null);
end;
$$;

-- ---------------------------------------------------------------------------------
-- 6 and 7. Configuration kinds and wider customization
-- ---------------------------------------------------------------------------------
alter table public.app_configuration_versions add column if not exists kind text not null default 'appearance';
do $$ begin
  alter table public.app_configuration_versions add constraint app_configuration_versions_kind_check check (kind in ('appearance', 'platform'));
exception when duplicate_object then null; end $$;
drop index if exists public.app_configuration_one_published;
create unique index if not exists app_configuration_one_published_per_kind on public.app_configuration_versions(kind) where status = 'published';

create or replace function public.config_permission(p_kind text, p_step text)
returns text language sql immutable set search_path = '' as $$
  select case when p_kind = 'platform' then 'admin.configuration.manage'
    when p_step = 'edit' then 'admin.customization.edit'
    when p_step = 'publish' then 'admin.customization.publish'
    when p_step = 'rollback' then 'admin.customization.rollback' end;
$$;

drop policy if exists "customization admins read versions" on public.app_configuration_versions;
create policy "customization admins read versions" on public.app_configuration_versions for select to authenticated
  using ((kind = 'appearance' and ((select public.admin_has('admin.customization.edit')) or (select public.admin_has('admin.customization.publish'))))
    or (kind = 'platform' and (select public.admin_has('admin.configuration.manage'))));

-- Value checks shared by both kinds.
create or replace function public.cfg_text_ok(p_value jsonb, p_max integer)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_value) = 'string' and length(p_value #>> '{}') <= p_max
    and (p_value #>> '{}') !~ '[<>{}]' and (p_value #>> '{}') !~* '(javascript|data|vbscript):';
$$;
create or replace function public.cfg_https_ok(p_value jsonb, p_max integer)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_value) = 'string' and length(p_value #>> '{}') <= p_max and (p_value #>> '{}') ~ '^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~%/?=&#-]*)?$';
$$;
create or replace function public.cfg_media_ok(p_value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^https://[A-Za-z0-9.-]+/storage/v1/object/public/platform-media/[A-Za-z0-9/_.-]{1,200}$';
$$;
create or replace function public.cfg_unknown_key(p_object jsonb, p_allowed text[])
returns text language sql immutable set search_path = '' as $$
  select k from jsonb_object_keys(p_object) k where k <> all(p_allowed) limit 1;
$$;
create or replace function public.cfg_id_list_ok(p_value jsonb, p_allowed text[], p_max integer)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_value) = 'array' and jsonb_array_length(p_value) <= p_max
    and not exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') <> all(p_allowed));
$$;

-- Appearance: theme, landing (034) plus fonts, brand, navigation, templates, SEO,
-- install prompt and translation overrides. Platform: maintenance, features, help, sports.
create or replace function public.app_config_problem_for(p_kind text, p_config jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_key text;
  v_value jsonb;
  v_section jsonb;
  v_nav constant text[] := array['tournaments', 'live', 'teams', 'players', 'news', 'organizations', 'matches', 'standings', 'bracket', 'how-it-works'];
  v_sports constant text[] := array['football', 'futsal', 'handball', 'volleyball', 'basketball', 'basketball_3x3'];
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then return 'config_not_object'; end if;
  if octet_length(p_config::text) > 60000 then return 'config_too_large'; end if;
  if p_kind = 'appearance' then
    v_key := public.cfg_unknown_key(p_config, array['theme', 'landing', 'fonts', 'brand', 'navigation', 'templates', 'seo', 'pwa', 'translations']);
    if v_key is not null then return 'unknown_key:' || v_key; end if;
    -- theme and landing keep the 034 rules.
    v_key := public.app_config_problem(p_config - array['fonts', 'brand', 'navigation', 'templates', 'seo', 'pwa', 'translations']);
    if v_key is not null then return v_key; end if;
    v_section := p_config -> 'fonts';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['heading', 'body', 'dhivehi']) is not null then return 'invalid_fonts'; end if;
      if v_section ? 'heading' and (v_section ->> 'heading') not in ('space-grotesk', 'inter', 'poppins', 'montserrat', 'system') then return 'invalid_fonts'; end if;
      if v_section ? 'body' and (v_section ->> 'body') not in ('plus-jakarta', 'inter', 'noto-sans', 'system') then return 'invalid_fonts'; end if;
      if v_section ? 'dhivehi' and (v_section ->> 'dhivehi') not in ('noto-sans-thaana', 'system') then return 'invalid_fonts'; end if;
    end if;
    v_section := p_config -> 'brand';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['appName', 'tagline', 'copyright', 'supportEmail', 'logoUrl', 'logoAlt', 'social']) is not null then return 'invalid_brand'; end if;
      if v_section ? 'appName' and not (public.cfg_text_ok(v_section -> 'appName', 30) and length(trim(v_section ->> 'appName')) >= 2) then return 'invalid_brand_name'; end if;
      if v_section ? 'tagline' and not public.cfg_text_ok(v_section -> 'tagline', 80) then return 'invalid_brand_text'; end if;
      if v_section ? 'copyright' and not public.cfg_text_ok(v_section -> 'copyright', 80) then return 'invalid_brand_text'; end if;
      if v_section ? 'logoAlt' and not public.cfg_text_ok(v_section -> 'logoAlt', 80) then return 'invalid_brand_text'; end if;
      if v_section ? 'supportEmail' and not (jsonb_typeof(v_section -> 'supportEmail') = 'string' and (v_section ->> 'supportEmail') ~ '^[^@\s<>]{1,64}@[A-Za-z0-9.-]{1,120}\.[A-Za-z]{2,}$') then return 'invalid_email'; end if;
      if v_section ? 'logoUrl' and not public.cfg_media_ok(v_section -> 'logoUrl') then return 'invalid_logo'; end if;
      if v_section ? 'logoUrl' and not (v_section ? 'logoAlt') then return 'logo_alt_required'; end if;
      if v_section ? 'social' then
        if jsonb_typeof(v_section -> 'social') <> 'array' or jsonb_array_length(v_section -> 'social') > 6 then return 'invalid_social'; end if;
        for v_value in select * from jsonb_array_elements(v_section -> 'social') loop
          if jsonb_typeof(v_value) <> 'object' or public.cfg_unknown_key(v_value, array['label', 'url']) is not null
            or (v_value ->> 'label') not in ('Facebook', 'Instagram', 'X', 'YouTube', 'TikTok', 'Website') or not public.cfg_https_ok(v_value -> 'url', 200) then return 'invalid_social'; end if;
        end loop;
      end if;
    end if;
    v_section := p_config -> 'navigation';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['hidden', 'order', 'labels']) is not null then return 'invalid_navigation'; end if;
      if v_section ? 'hidden' and not public.cfg_id_list_ok(v_section -> 'hidden', v_nav, 10) then return 'invalid_navigation'; end if;
      if v_section ? 'order' and not public.cfg_id_list_ok(v_section -> 'order', v_nav, 10) then return 'invalid_navigation'; end if;
      if v_section ? 'labels' then
        if jsonb_typeof(v_section -> 'labels') <> 'object' or public.cfg_unknown_key(v_section -> 'labels', v_nav) is not null then return 'invalid_navigation'; end if;
        for v_key, v_value in select * from jsonb_each(v_section -> 'labels') loop
          if not (public.cfg_text_ok(v_value, 24) and length(trim(v_value #>> '{}')) >= 2) then return 'invalid_navigation_label'; end if;
        end loop;
      end if;
    end if;
    v_section := p_config -> 'templates';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['publicHero', 'cards', 'density']) is not null then return 'invalid_templates'; end if;
      if v_section ? 'publicHero' and (v_section ->> 'publicHero') not in ('standard', 'compact', 'image-led') then return 'invalid_templates'; end if;
      if v_section ? 'cards' and (v_section ->> 'cards') not in ('elevated', 'flat', 'outlined') then return 'invalid_templates'; end if;
      if v_section ? 'density' and (v_section ->> 'density') not in ('compact', 'comfortable', 'spacious') then return 'invalid_templates'; end if;
    end if;
    v_section := p_config -> 'seo';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['titleSuffix', 'description']) is not null then return 'invalid_seo'; end if;
      if v_section ? 'titleSuffix' and not public.cfg_text_ok(v_section -> 'titleSuffix', 40) then return 'invalid_seo'; end if;
      if v_section ? 'description' and not public.cfg_text_ok(v_section -> 'description', 160) then return 'invalid_seo'; end if;
    end if;
    v_section := p_config -> 'pwa';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['installTitle', 'installText']) is not null then return 'invalid_pwa'; end if;
      if v_section ? 'installTitle' and not public.cfg_text_ok(v_section -> 'installTitle', 60) then return 'invalid_pwa'; end if;
      if v_section ? 'installText' and not public.cfg_text_ok(v_section -> 'installText', 160) then return 'invalid_pwa'; end if;
    end if;
    v_section := p_config -> 'translations';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' then return 'invalid_translations'; end if;
      if (select count(*) from jsonb_object_keys(v_section)) > 400 then return 'too_many_translations'; end if;
      for v_key, v_value in select * from jsonb_each(v_section) loop
        if v_key !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_-]+)+$' or jsonb_typeof(v_value) <> 'object' or public.cfg_unknown_key(v_value, array['en', 'dv']) is not null then return 'invalid_translation_key'; end if;
        if (v_value ? 'en' and not public.cfg_text_ok(v_value -> 'en', 200)) or (v_value ? 'dv' and not public.cfg_text_ok(v_value -> 'dv', 200)) then return 'invalid_translation_text'; end if;
      end loop;
    end if;
    return null;
  elsif p_kind = 'platform' then
    v_key := public.cfg_unknown_key(p_config, array['maintenance', 'features', 'help', 'sports']);
    if v_key is not null then return 'unknown_key:' || v_key; end if;
    v_section := p_config -> 'maintenance';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['enabled', 'message', 'messageDv', 'endsAt']) is not null then return 'invalid_maintenance'; end if;
      if v_section ? 'enabled' and jsonb_typeof(v_section -> 'enabled') <> 'boolean' then return 'invalid_maintenance'; end if;
      if v_section ? 'message' and not public.cfg_text_ok(v_section -> 'message', 200) then return 'invalid_maintenance'; end if;
      if v_section ? 'messageDv' and not public.cfg_text_ok(v_section -> 'messageDv', 200) then return 'invalid_maintenance'; end if;
      if v_section ? 'endsAt' and not (jsonb_typeof(v_section -> 'endsAt') = 'string' and (v_section ->> 'endsAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}') then return 'invalid_maintenance'; end if;
      if coalesce((v_section ->> 'enabled')::boolean, false) and length(trim(coalesce(v_section ->> 'message', ''))) < 5 then return 'maintenance_message_required'; end if;
    end if;
    v_section := p_config -> 'features';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['recentlyViewed', 'news', 'installPrompt', 'calendarExports', 'topPlayers']) is not null then return 'invalid_features'; end if;
      if exists (select 1 from jsonb_each(v_section) e where jsonb_typeof(e.value) <> 'boolean') then return 'invalid_features'; end if;
    end if;
    v_section := p_config -> 'help';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['email', 'phone', 'hours']) is not null then return 'invalid_help'; end if;
      if v_section ? 'email' and not (jsonb_typeof(v_section -> 'email') = 'string' and (v_section ->> 'email') ~ '^[^@\s<>]{1,64}@[A-Za-z0-9.-]{1,120}\.[A-Za-z]{2,}$') then return 'invalid_email'; end if;
      if v_section ? 'phone' and not (jsonb_typeof(v_section -> 'phone') = 'string' and (v_section ->> 'phone') ~ '^[0-9 +()-]{3,20}$') then return 'invalid_phone'; end if;
      if v_section ? 'hours' and not public.cfg_text_ok(v_section -> 'hours', 80) then return 'invalid_help'; end if;
    end if;
    v_section := p_config -> 'sports';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['hidden']) is not null then return 'invalid_sports'; end if;
      -- At least one sport stays visible.
      if v_section ? 'hidden' and not (public.cfg_id_list_ok(v_section -> 'hidden', v_sports, 5)) then return 'invalid_sports'; end if;
    end if;
    return null;
  end if;
  return 'invalid_kind';
end;
$$;

create or replace function public.app_config_assert_for(p_kind text, p_config jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare
  v_problem text := public.app_config_problem_for(p_kind, p_config);
begin
  if v_problem is not null then raise exception 'invalid_configuration: %', v_problem; end if;
end;
$$;

-- Published appearance and platform configuration, for every visitor.
create or replace function public.get_active_configuration()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'version', a.version, 'config', coalesce(a.config, '{}'::jsonb), 'publishedAt', a.published_at,
    'platformVersion', p.version, 'platform', coalesce(p.config, '{}'::jsonb))
  from (select 1) base
  left join public.app_configuration_versions a on a.kind = 'appearance' and a.status = 'published'
  left join public.app_configuration_versions p on p.kind = 'platform' and p.status = 'published';
$$;

drop function if exists public.admin_save_config_draft(uuid, jsonb, text);
create or replace function public.admin_save_config_draft(p_id uuid, p_config jsonb, p_summary text, p_kind text default 'appearance')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_row public.app_configuration_versions;
  v_kind text := p_kind;
begin
  if p_id is not null then
    select * into v_row from public.app_configuration_versions where id = p_id for update;
    if not found then raise exception 'not_found'; end if;
    v_kind := v_row.kind;
  end if;
  if v_kind not in ('appearance', 'platform') then raise exception 'invalid_kind'; end if;
  perform public.admin_assert(public.config_permission(v_kind, 'edit'));
  perform public.app_config_assert_for(v_kind, p_config);
  if p_id is null then
    insert into public.app_configuration_versions (kind, config, summary, created_by) values (v_kind, p_config, trim(p_summary), (select auth.uid())) returning id into v_id;
    perform public.admin_audit('configuration_draft_created', 'configuration', v_id::text, v_kind || ': ' || trim(p_summary), null, null, null, null);
    return v_id;
  end if;
  if v_row.status not in ('draft', 'rejected') then raise exception 'version_locked'; end if;
  update public.app_configuration_versions set config = p_config, summary = trim(p_summary), status = 'draft', reviewed_by = null, reviewed_at = null, review_note = null, updated_at = now() where id = p_id;
  perform public.admin_audit('configuration_draft_saved', 'configuration', p_id::text, v_kind || ': ' || trim(p_summary), null, null, null, null);
  return p_id;
end;
$$;

create or replace function public.admin_submit_config(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row public.app_configuration_versions;
begin
  select * into v_row from public.app_configuration_versions where id = p_id for update;
  if not found or v_row.status <> 'draft' then raise exception 'invalid_transition'; end if;
  perform public.admin_assert(public.config_permission(v_row.kind, 'edit'));
  perform public.app_config_assert_for(v_row.kind, v_row.config);
  update public.app_configuration_versions set status = 'in_review', updated_at = now() where id = p_id;
  perform public.admin_audit('configuration_submitted', 'configuration', p_id::text, v_row.kind || ': ' || v_row.summary, null, null, null, jsonb_build_object('version', v_row.version));
end;
$$;

create or replace function public.admin_review_config(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_row public.app_configuration_versions;
begin
  perform public.admin_require_reason(p_note);
  select * into v_row from public.app_configuration_versions where id = p_id for update;
  if not found or v_row.status <> 'in_review' then raise exception 'invalid_transition'; end if;
  perform public.admin_assert(public.config_permission(v_row.kind, 'publish'));
  if v_row.created_by = v_me and not public.admin_is_owner(v_me) then raise exception 'self_approval_not_allowed'; end if;
  update public.app_configuration_versions set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = v_me, reviewed_at = now(), review_note = trim(p_note), updated_at = now() where id = p_id;
  perform public.admin_audit(case when p_approve then 'configuration_approved' else 'configuration_rejected' end, 'configuration', p_id::text, v_row.kind || ': ' || v_row.summary, p_note, null, null,
    jsonb_build_object('version', v_row.version, 'self_approved', v_row.created_by = v_me));
end;
$$;

create or replace function public.admin_publish_config(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row public.app_configuration_versions;
  v_previous bigint;
begin
  perform public.admin_require_reason(p_reason);
  select * into v_row from public.app_configuration_versions where id = p_id for update;
  if not found or v_row.status <> 'approved' then raise exception 'invalid_transition'; end if;
  perform public.admin_assert(public.config_permission(v_row.kind, 'publish'));
  perform public.app_config_assert_for(v_row.kind, v_row.config);
  update public.app_configuration_versions set status = 'superseded', updated_at = now() where status = 'published' and kind = v_row.kind returning version into v_previous;
  update public.app_configuration_versions set status = 'published', published_by = (select auth.uid()), published_at = now(), updated_at = now() where id = p_id;
  perform public.admin_audit('configuration_published', 'configuration', p_id::text, v_row.kind || ': ' || v_row.summary, p_reason, null, jsonb_build_object('version', v_previous), jsonb_build_object('version', v_row.version));
end;
$$;

create or replace function public.admin_rollback_config(p_version bigint, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row public.app_configuration_versions;
  v_id uuid;
begin
  perform public.admin_require_reason(p_reason);
  select * into v_row from public.app_configuration_versions where version = p_version and status in ('published', 'superseded');
  if not found then raise exception 'not_found'; end if;
  perform public.admin_assert(public.config_permission(v_row.kind, 'rollback'));
  insert into public.app_configuration_versions (kind, config, summary, created_by, status, rollback_of)
  values (v_row.kind, v_row.config, left('Rollback to version ' || p_version || ': ' || trim(p_reason), 300), (select auth.uid()), 'in_review', p_version)
  returning id into v_id;
  perform public.admin_audit('configuration_rollback_proposed', 'configuration', v_id::text, v_row.kind, p_reason, null, null, jsonb_build_object('rollback_of', p_version));
  return v_id;
end;
$$;

-- Media library: a public bucket for brand and page images only. Private identity,
-- payment and team documents use their own private buckets and never come here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('platform-media', 'platform-media', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "customization admins upload platform media" on storage.objects;
create policy "customization admins upload platform media" on storage.objects for insert to authenticated
  with check (bucket_id = 'platform-media' and (select public.admin_has('admin.customization.edit'))
    and (storage.foldername(name))[1] in ('brand', 'hero', 'backgrounds', 'sports', 'covers', 'icons', 'email', 'pwa', 'social', 'help'));
-- No update or delete policies: files are archived in the library, never overwritten.

create table if not exists public.platform_media_assets (
  id uuid primary key default gen_random_uuid(),
  path text not null unique check (path ~ '^(brand|hero|backgrounds|sports|covers|icons|email|pwa|social|help)/[A-Za-z0-9_.-]{1,160}$'),
  kind text not null,
  alt_text text not null check (length(trim(alt_text)) between 3 and 200),
  tags text[] not null default '{}',
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  width integer check (width is null or width between 1 and 10000),
  height integer check (height is null or height between 1 and 10000),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (kind = split_part(path, '/', 1)),
  check (cardinality(tags) <= 10)
);
alter table public.platform_media_assets enable row level security;
drop policy if exists "customization admins read media" on public.platform_media_assets;
create policy "customization admins read media" on public.platform_media_assets for select to authenticated
  using ((select public.admin_has('admin.customization.edit')) or (select public.admin_has('admin.customization.publish')));

create or replace function public.admin_media_in_use(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_configuration_versions c where c.status in ('published', 'approved', 'in_review') and position('/platform-media/' || p_path in c.config::text) > 0);
$$;

create or replace function public.admin_register_media(p_path text, p_alt text, p_tags text[], p_mime text, p_size integer, p_width integer default null, p_height integer default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public.admin_assert('admin.customization.edit');
  if not exists (select 1 from storage.objects o where o.bucket_id = 'platform-media' and o.name = p_path) then raise exception 'not_found'; end if;
  if exists (select 1 from unnest(coalesce(p_tags, '{}')) t where t !~ '^[a-z0-9-]{1,24}$') then raise exception 'invalid_tags'; end if;
  insert into public.platform_media_assets (path, kind, alt_text, tags, mime, size_bytes, width, height, uploaded_by)
  values (p_path, split_part(p_path, '/', 1), trim(p_alt), coalesce(p_tags, '{}'), p_mime, p_size, p_width, p_height, (select auth.uid())) returning id into v_id;
  perform public.admin_audit('media_uploaded', 'media', v_id::text, p_path, null, null, null, jsonb_build_object('size', p_size, 'mime', p_mime));
  return v_id;
end;
$$;

create or replace function public.admin_update_media(p_id uuid, p_alt text, p_tags text[], p_archive boolean default null, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row public.platform_media_assets;
begin
  perform public.admin_assert('admin.customization.edit');
  select * into v_row from public.platform_media_assets where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if exists (select 1 from unnest(coalesce(p_tags, v_row.tags)) t where t !~ '^[a-z0-9-]{1,24}$') then raise exception 'invalid_tags'; end if;
  if p_archive is true then
    perform public.admin_require_reason(p_reason);
    if public.admin_media_in_use(v_row.path) then raise exception 'media_in_use'; end if;
  end if;
  update public.platform_media_assets set alt_text = coalesce(nullif(trim(p_alt), ''), alt_text), tags = coalesce(p_tags, tags),
    archived_at = case when p_archive is true then now() when p_archive is false then null else archived_at end where id = p_id;
  perform public.admin_audit(case when p_archive is true then 'media_archived' when p_archive is false then 'media_restored' else 'media_updated' end, 'media', p_id::text, v_row.path, p_reason, null, null, null);
end;
$$;

create or replace function public.admin_list_media(p_query text default null, p_include_archived boolean default false)
returns table (id uuid, path text, kind text, alt_text text, tags text[], mime text, size_bytes integer, width integer, height integer, archived boolean, in_use boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.admin_has('admin.customization.edit') or public.admin_has('admin.customization.publish')) then raise exception 'admin_permission_denied'; end if;
  return query select m.id, m.path, m.kind, m.alt_text, m.tags, m.mime, m.size_bytes, m.width, m.height, m.archived_at is not null, public.admin_media_in_use(m.path), m.created_at
  from public.platform_media_assets m
  where (p_include_archived or m.archived_at is null)
    and (nullif(trim(coalesce(p_query, '')), '') is null or m.path ilike '%' || trim(p_query) || '%' or m.alt_text ilike '%' || trim(p_query) || '%' or trim(p_query) = any(m.tags))
  order by m.created_at desc, m.id limit 200;
end;
$$;

-- ---------------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------------
revoke execute on function public.admin_execute_result_change(public.admin_action_requests, uuid) from public, anon, authenticated;
revoke execute on function public.admin_execute_merge(public.admin_action_requests) from public, anon, authenticated;
revoke execute on function public.admin_action_validate(text, jsonb) from public, anon, authenticated;
revoke execute on function public.admin_notify_case_person(public.platform_cases, text) from public, anon, authenticated;
revoke execute on function public.enforce_finance_freeze() from public, anon, authenticated;
revoke execute on function public.protect_merged_player() from public, anon, authenticated;
revoke execute on function public.admin_media_in_use(text) from public, anon, authenticated;
revoke execute on function public.app_config_assert_for(text, jsonb) from public, anon, authenticated;

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.admin_action_permission(text)', 'public.admin_merge_preview(uuid, uuid)', 'public.admin_propose_action(text, jsonb, text, uuid)',
    'public.admin_cancel_action(uuid, text)', 'public.admin_decide_action(uuid, boolean, text)', 'public.admin_list_actions(text, integer, integer)',
    'public.admin_match_versions(uuid)', 'public.admin_find_players(text)', 'public.admin_freeze_result(uuid, boolean, text, uuid)',
    'public.admin_set_case_requester(uuid, text, text)', 'public.admin_add_case_note(uuid, text, boolean)',
    'public.admin_update_case(uuid, text, text, text, uuid, boolean, text, text)',
    'public.admin_finance_records(text, text, integer, integer)', 'public.admin_finance_finding(text, uuid, text, text, uuid)', 'public.admin_record_finance_export(text, integer, text)',
    'public.admin_list_deliveries(text, integer, integer)', 'public.admin_retry_delivery(uuid, text)',
    'public.config_permission(text, text)', 'public.cfg_text_ok(jsonb, integer)', 'public.cfg_https_ok(jsonb, integer)', 'public.cfg_media_ok(jsonb)',
    'public.cfg_unknown_key(jsonb, text[])', 'public.cfg_id_list_ok(jsonb, text[], integer)', 'public.app_config_problem_for(text, jsonb)',
    'public.admin_save_config_draft(uuid, jsonb, text, text)', 'public.admin_submit_config(uuid)', 'public.admin_review_config(uuid, boolean, text)',
    'public.admin_publish_config(uuid, text)', 'public.admin_rollback_config(bigint, text)',
    'public.admin_register_media(text, text, text[], text, integer, integer, integer)', 'public.admin_update_media(uuid, text, text[], boolean, text)', 'public.admin_list_media(text, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;
end;
$$;

-- Visitors: the published configuration, and the yes/no used by the frozen-result policy.
revoke execute on function public.get_active_configuration() from public;
grant execute on function public.get_active_configuration() to anon, authenticated, service_role;
revoke execute on function public.can_read_match_result(uuid) from public;
grant execute on function public.can_read_match_result(uuid) to anon, authenticated, service_role;
revoke execute on function public.get_public_match_feed(timestamptz, timestamptz, text[], uuid, integer, boolean) from public;
grant execute on function public.get_public_match_feed(timestamptz, timestamptz, text[], uuid, integer, boolean) to anon, authenticated, service_role;

revoke insert, update, delete, truncate on public.admin_action_requests, public.match_result_freezes, public.platform_finance_findings, public.platform_media_assets from anon, authenticated;
revoke all on public.admin_action_requests, public.match_result_freezes, public.platform_finance_findings, public.platform_media_assets from anon;
revoke usage on sequence public.admin_action_seq from anon, authenticated;


-- ===== 202611010036_tournament_pages_complete.sql =====
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


-- ===== 202611010037_follows_and_account_profile.sql =====
-- Follows and account island/atoll (Additional Features list: follow on public pages,
-- Account Settings atoll/island).
-- Review-only. Do not apply, push or deploy without explicit owner authorization.
-- Apply after 202611010036_tournament_pages_complete.sql.
-- Created with `supabase migration new follows_and_account_profile`, renamed from
-- 20261101072048_… to 202611010037_… to match the other migrations.
--
--   1. follows: a signed-in person follows published tournaments, teams, players and
--      organizations. Each person sees and changes only their own follows; nobody
--      else (other users, organizers, the public) can read who follows what.
--   2. profiles.island and profiles.atoll: optional, private to the account.

-- ---------------------------------------------------------------------------------
-- 1. Follows
-- ---------------------------------------------------------------------------------
create table if not exists public.follows (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  entity_type text not null check (entity_type in ('tournament', 'team', 'player', 'organization')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, entity_type, entity_id)
);
create index if not exists follows_user_idx on public.follows(user_id, created_at desc);
alter table public.follows enable row level security;

-- Only published records can be followed.
create or replace function public.is_followable(p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'tournament' then exists (select 1 from public.tournaments t where t.id = p_id and t.is_published and t.status <> 'draft')
    when 'team' then exists (select 1 from public.teams t where t.id = p_id and t.is_published)
    when 'player' then exists (select 1 from public.player_profiles p where p.id = p_id and p.is_published)
    when 'organization' then exists (select 1 from public.organizations o where o.id = p_id and o.is_published)
    else false end;
$$;

drop policy if exists "people read their own follows" on public.follows;
create policy "people read their own follows" on public.follows for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "people follow published records" on public.follows;
create policy "people follow published records" on public.follows for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_followable(entity_type, entity_id));
drop policy if exists "people unfollow" on public.follows;
create policy "people unfollow" on public.follows for delete to authenticated
  using (user_id = (select auth.uid()));
-- No update policy: a follow is added or removed, never edited.

-- Names for the caller's own follows, public fields only (a record that was unpublished
-- since shows as no longer available).
create or replace function public.my_follows()
returns table (entity_type text, entity_id uuid, label text, slug text, available boolean, followed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.entity_type, f.entity_id,
    coalesce(t.name, tm.name, p.display_name, o.name, 'No longer public'),
    coalesce(t.slug, tm.slug, p.slug, o.slug),
    coalesce(t.id, tm.id, p.id, o.id) is not null,
    f.created_at
  from public.follows f
  left join public.tournaments t on f.entity_type = 'tournament' and t.id = f.entity_id and t.is_published and t.status <> 'draft'
  left join public.teams tm on f.entity_type = 'team' and tm.id = f.entity_id and tm.is_published
  left join public.player_profiles p on f.entity_type = 'player' and p.id = f.entity_id and p.is_published
  left join public.organizations o on f.entity_type = 'organization' and o.id = f.entity_id and o.is_published
  where f.user_id = (select auth.uid())
  order by f.created_at desc;
$$;

revoke execute on function public.is_followable(text, uuid) from public, anon;
grant execute on function public.is_followable(text, uuid) to authenticated, service_role;
revoke execute on function public.my_follows() from public, anon;
grant execute on function public.my_follows() to authenticated, service_role;
revoke all on public.follows from anon;
revoke update, truncate on public.follows from authenticated;

-- ---------------------------------------------------------------------------------
-- 2. Account island and atoll (private to the account; profiles RLS is owner-only)
-- ---------------------------------------------------------------------------------
alter table public.profiles add column if not exists island text check (island is null or length(trim(island)) between 2 and 80);
alter table public.profiles add column if not exists atoll text check (atoll is null or length(trim(atoll)) between 1 and 40);


-- ===== 202611010038_public_pages_complete.sql =====
-- Public site pages, the remaining parts (match timeline and lineups, tournament draw,
-- organization teams).
-- Review-only. Do not apply, push or deploy without explicit owner authorization.
-- Apply after 202611010037_follows_and_account_profile.sql.
-- Created with `supabase migration new public_pages_complete`, renamed from
-- 20261101115631_… to 202611010038_… to match the other migrations.
--
-- Read-only functions for guests. No table, column or policy changes. Each function
-- uses the visibility rules of get_public_match_feed (032/035):
--   * the tournament is published and not a draft, and the stage is published;
--   * a team's name shows when the team is published or has an approved entry;
--   * a player's name shows only when the player's profile is published;
--   * the timeline and lineups show only after the result is confirmed and while
--     the result is not frozen, so an unconfirmed score is never public;
--   * no internal fields leave the database (event payloads, recorders, entry rows).
--
--   1. get_public_match_detail(match): one fixture, its official score, timeline and lineups.
--   2. get_public_tournament_draw(tournament): published stages, groups and their teams.
--   3. get_public_organization_teams(organization): published teams linked to the
--      organization or approved in one of its published tournaments.

-- ---------------------------------------------------------------------------------
-- 1. Match detail
-- ---------------------------------------------------------------------------------
create or replace function public.get_public_match_detail(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_match public.matches;
  v_official boolean;
  v_score jsonb;
  v_events jsonb := '[]'::jsonb;
  v_lineups jsonb := '[]'::jsonb;
  v_hidden integer := 0;
begin
  select m.* into v_match
  from public.matches m
  join public.tournaments tr on tr.id = m.tournament_id and tr.is_published and tr.status <> 'draft'
  join public.competition_stages st on st.id = m.stage_id and st.published_at is not null
  where m.id = p_match_id;
  if v_match.id is null then return null; end if;

  v_official := v_match.status = 'confirmed'
    and not exists (select 1 from public.match_result_freezes f where f.match_id = v_match.id and f.lifted_at is null);

  if v_official then
    select v.score into v_score from public.match_result_versions v
    where v.match_id = v_match.id and v.status = 'confirmed' order by v.version desc limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
        'minute', e.event_minute,
        'type', e.event_type,
        'side', case when e.team_id = v_match.home_team_id then 'home' when e.team_id = v_match.away_team_id then 'away' end,
        'player', case when p.is_published then p.display_name end,
        'player_slug', case when p.is_published then p.slug end
      ) order by e.event_minute nulls last, e.created_at), '[]'::jsonb)
    into v_events
    from (select * from public.match_events where match_id = v_match.id order by event_minute nulls last, created_at limit 400) e
    left join public.player_profiles p on p.id = e.player_id;

    select coalesce(jsonb_agg(jsonb_build_object(
        'side', case when mp.team_id = v_match.home_team_id then 'home' else 'away' end,
        'player', p.display_name,
        'player_slug', p.slug,
        'starter', mp.starter
      ) order by mp.starter desc, p.display_name), '[]'::jsonb)
    into v_lineups
    from public.match_player_participants mp
    join public.player_profiles p on p.id = mp.player_id and p.is_published
    where mp.match_id = v_match.id;

    select count(*) into v_hidden
    from public.match_player_participants mp
    join public.player_profiles p on p.id = mp.player_id and not p.is_published
    where mp.match_id = v_match.id;
  end if;

  return jsonb_build_object(
    'id', v_match.id,
    'tournament_id', v_match.tournament_id,
    'home_team_id', v_match.home_team_id,
    'away_team_id', v_match.away_team_id,
    'scheduled_at', v_match.scheduled_at,
    'venue', v_match.venue,
    'status', v_match.status,
    'official', v_official,
    'home_score', case when v_official and jsonb_typeof(v_score->'home') = 'number' then (v_score->>'home')::numeric end,
    'away_score', case when v_official and jsonb_typeof(v_score->'away') = 'number' then (v_score->>'away')::numeric end,
    'outcome', case when v_official and v_score->>'outcome' in ('walkover', 'forfeit', 'abandoned') then v_score->>'outcome' end,
    'events', v_events,
    'lineups', v_lineups,
    'private_players', v_hidden
  );
end;
$$;
revoke execute on function public.get_public_match_detail(uuid) from public;
grant execute on function public.get_public_match_detail(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- 2. Tournament draw
-- ---------------------------------------------------------------------------------
-- Groups come from the published fixtures themselves: a team belongs to the group of
-- the matches it plays in. A knockout stage has no groups (group_name is null).
create or replace function public.get_public_tournament_draw(p_tournament_id uuid)
returns table(
  stage_id uuid, stage_name text, stage_format text, stage_order smallint, category_name text,
  group_name text, team_id uuid, team_name text, team_slug text, team_logo text
)
language sql stable security definer set search_path = '' as $$
  with stages as (
    select st.id, st.name, st.format, st.stage_order, c.name as category_name
    from public.competition_stages st
    join public.tournaments tr on tr.id = st.tournament_id and tr.is_published and tr.status <> 'draft'
    left join public.tournament_categories c on c.id = st.category_id
    where st.tournament_id = p_tournament_id and st.published_at is not null
  ), sides as (
    select m.stage_id, m.group_id, m.tournament_id, m.home_team_id as team_id from public.matches m join stages s on s.id = m.stage_id where m.home_team_id is not null
    union
    select m.stage_id, m.group_id, m.tournament_id, m.away_team_id from public.matches m join stages s on s.id = m.stage_id where m.away_team_id is not null
  )
  select distinct s.id, s.name, s.format, s.stage_order, s.category_name, g.name, t.id,
    case when t.is_published or exists (select 1 from public.tournament_entries e where e.team_id = t.id and e.tournament_id = sd.tournament_id and e.application_status = 'approved') then t.name end,
    case when t.is_published then t.slug end,
    case when t.is_published then t.logo_url end
  from sides sd
  join stages s on s.id = sd.stage_id
  join public.teams t on t.id = sd.team_id
  left join public.competition_groups g on g.id = sd.group_id
  order by s.stage_order, s.name, g.name nulls first
  limit 1000;
$$;
revoke execute on function public.get_public_tournament_draw(uuid) from public;
grant execute on function public.get_public_tournament_draw(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- 3. Organization teams
-- ---------------------------------------------------------------------------------
create or replace function public.get_public_organization_teams(p_organization_id uuid)
returns table(team_id uuid, name text, slug text, logo_url text, team_type text, island text, tournament_count bigint)
language sql stable security definer set search_path = '' as $$
  with org as (
    select o.id from public.organizations o where o.id = p_organization_id and o.is_published
  ), linked as (
    select l.team_id, null::uuid as tournament_id from public.organization_team_links l join org on org.id = l.organization_id
    union
    select e.team_id, e.tournament_id
    from public.tournament_entries e
    join public.tournaments tr on tr.id = e.tournament_id and tr.is_published and tr.status <> 'draft'
    join org on org.id = tr.organization_id
    where e.application_status = 'approved'
  )
  select t.id, t.name, t.slug, t.logo_url, t.team_type, t.island, count(distinct l.tournament_id)
  from linked l
  join public.teams t on t.id = l.team_id and t.is_published
  group by t.id, t.name, t.slug, t.logo_url, t.team_type, t.island
  order by t.name
  limit 200;
$$;
revoke execute on function public.get_public_organization_teams(uuid) from public;
grant execute on function public.get_public_organization_teams(uuid) to anon, authenticated, service_role;


-- ===== 202611010039_configuration_complete.sql =====
-- Configuration and Customization Studio, the remaining parts.
-- Review-only. Do not apply, push or deploy without explicit owner authorization.
-- Apply after 202611010038_public_pages_complete.sql.
-- Created with `supabase migration new configuration_complete`, renamed from
-- 20261101185557_… to 202611010039_… to match the other migrations.
--
-- Only the configuration check (app_config_problem_for, from 035) changes; it is
-- recreated with every 035 rule unchanged plus these new, fixed fields:
--   Platform configuration
--     places:  atoll names, islands (with atoll) and venues (with island), used as
--              suggestions in island, atoll and venue fields;
--     uploads: lower image and document size limits (never above the storage limits);
--     legal:   a version label and effective date for each legal page.
--   Customization Studio (install)
--     pwa.appName, pwa.shortName, pwa.iconUrl (a PNG from the media library),
--     pwa.themeColor, pwa.backgroundColor: the installed app's name, icon and colours,
--     served by the site's service worker, so no rebuild is needed.
-- No table, column, policy or grant changes. Drafts, review and publishing are unchanged.

create or replace function public.app_config_problem_for(p_kind text, p_config jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_key text;
  v_value jsonb;
  v_section jsonb;
  v_nav constant text[] := array['tournaments', 'live', 'teams', 'players', 'news', 'organizations', 'matches', 'standings', 'bracket', 'how-it-works'];
  v_sports constant text[] := array['football', 'futsal', 'handball', 'volleyball', 'basketball', 'basketball_3x3'];
  v_legal constant text[] := array['privacy', 'terms', 'community-guidelines', 'child-safety', 'data-correction', 'account-deletion', 'image-consent'];
  v_item jsonb;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then return 'config_not_object'; end if;
  if octet_length(p_config::text) > 60000 then return 'config_too_large'; end if;
  if p_kind = 'appearance' then
    v_key := public.cfg_unknown_key(p_config, array['theme', 'landing', 'fonts', 'brand', 'navigation', 'templates', 'seo', 'pwa', 'translations']);
    if v_key is not null then return 'unknown_key:' || v_key; end if;
    -- theme and landing keep the 034 rules.
    v_key := public.app_config_problem(p_config - array['fonts', 'brand', 'navigation', 'templates', 'seo', 'pwa', 'translations']);
    if v_key is not null then return v_key; end if;
    v_section := p_config -> 'fonts';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['heading', 'body', 'dhivehi']) is not null then return 'invalid_fonts'; end if;
      if v_section ? 'heading' and (v_section ->> 'heading') not in ('space-grotesk', 'inter', 'poppins', 'montserrat', 'system') then return 'invalid_fonts'; end if;
      if v_section ? 'body' and (v_section ->> 'body') not in ('plus-jakarta', 'inter', 'noto-sans', 'system') then return 'invalid_fonts'; end if;
      if v_section ? 'dhivehi' and (v_section ->> 'dhivehi') not in ('noto-sans-thaana', 'system') then return 'invalid_fonts'; end if;
    end if;
    v_section := p_config -> 'brand';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['appName', 'tagline', 'copyright', 'supportEmail', 'logoUrl', 'logoAlt', 'social']) is not null then return 'invalid_brand'; end if;
      if v_section ? 'appName' and not (public.cfg_text_ok(v_section -> 'appName', 30) and length(trim(v_section ->> 'appName')) >= 2) then return 'invalid_brand_name'; end if;
      if v_section ? 'tagline' and not public.cfg_text_ok(v_section -> 'tagline', 80) then return 'invalid_brand_text'; end if;
      if v_section ? 'copyright' and not public.cfg_text_ok(v_section -> 'copyright', 80) then return 'invalid_brand_text'; end if;
      if v_section ? 'logoAlt' and not public.cfg_text_ok(v_section -> 'logoAlt', 80) then return 'invalid_brand_text'; end if;
      if v_section ? 'supportEmail' and not (jsonb_typeof(v_section -> 'supportEmail') = 'string' and (v_section ->> 'supportEmail') ~ '^[^@\s<>]{1,64}@[A-Za-z0-9.-]{1,120}\.[A-Za-z]{2,}$') then return 'invalid_email'; end if;
      if v_section ? 'logoUrl' and not public.cfg_media_ok(v_section -> 'logoUrl') then return 'invalid_logo'; end if;
      if v_section ? 'logoUrl' and not (v_section ? 'logoAlt') then return 'logo_alt_required'; end if;
      if v_section ? 'social' then
        if jsonb_typeof(v_section -> 'social') <> 'array' or jsonb_array_length(v_section -> 'social') > 6 then return 'invalid_social'; end if;
        for v_value in select * from jsonb_array_elements(v_section -> 'social') loop
          if jsonb_typeof(v_value) <> 'object' or public.cfg_unknown_key(v_value, array['label', 'url']) is not null
            or (v_value ->> 'label') not in ('Facebook', 'Instagram', 'X', 'YouTube', 'TikTok', 'Website') or not public.cfg_https_ok(v_value -> 'url', 200) then return 'invalid_social'; end if;
        end loop;
      end if;
    end if;
    v_section := p_config -> 'navigation';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['hidden', 'order', 'labels']) is not null then return 'invalid_navigation'; end if;
      if v_section ? 'hidden' and not public.cfg_id_list_ok(v_section -> 'hidden', v_nav, 10) then return 'invalid_navigation'; end if;
      if v_section ? 'order' and not public.cfg_id_list_ok(v_section -> 'order', v_nav, 10) then return 'invalid_navigation'; end if;
      if v_section ? 'labels' then
        if jsonb_typeof(v_section -> 'labels') <> 'object' or public.cfg_unknown_key(v_section -> 'labels', v_nav) is not null then return 'invalid_navigation'; end if;
        for v_key, v_value in select * from jsonb_each(v_section -> 'labels') loop
          if not (public.cfg_text_ok(v_value, 24) and length(trim(v_value #>> '{}')) >= 2) then return 'invalid_navigation_label'; end if;
        end loop;
      end if;
    end if;
    v_section := p_config -> 'templates';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['publicHero', 'cards', 'density']) is not null then return 'invalid_templates'; end if;
      if v_section ? 'publicHero' and (v_section ->> 'publicHero') not in ('standard', 'compact', 'image-led') then return 'invalid_templates'; end if;
      if v_section ? 'cards' and (v_section ->> 'cards') not in ('elevated', 'flat', 'outlined') then return 'invalid_templates'; end if;
      if v_section ? 'density' and (v_section ->> 'density') not in ('compact', 'comfortable', 'spacious') then return 'invalid_templates'; end if;
    end if;
    v_section := p_config -> 'seo';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['titleSuffix', 'description']) is not null then return 'invalid_seo'; end if;
      if v_section ? 'titleSuffix' and not public.cfg_text_ok(v_section -> 'titleSuffix', 40) then return 'invalid_seo'; end if;
      if v_section ? 'description' and not public.cfg_text_ok(v_section -> 'description', 160) then return 'invalid_seo'; end if;
    end if;
    v_section := p_config -> 'pwa';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['installTitle', 'installText', 'appName', 'shortName', 'iconUrl', 'themeColor', 'backgroundColor']) is not null then return 'invalid_pwa'; end if;
      if v_section ? 'appName' and not (public.cfg_text_ok(v_section -> 'appName', 30) and length(trim(v_section ->> 'appName')) >= 2) then return 'invalid_pwa_name'; end if;
      if v_section ? 'shortName' and not (public.cfg_text_ok(v_section -> 'shortName', 12) and length(trim(v_section ->> 'shortName')) >= 2) then return 'invalid_pwa_name'; end if;
      if v_section ? 'iconUrl' and not public.cfg_media_ok(v_section -> 'iconUrl') then return 'invalid_pwa_icon'; end if;
      if v_section ? 'iconUrl' and (v_section ->> 'iconUrl') !~* '\.png$' then return 'invalid_pwa_icon'; end if;
      if v_section ? 'themeColor' and not (jsonb_typeof(v_section -> 'themeColor') = 'string' and (v_section ->> 'themeColor') ~ '^#[0-9a-fA-F]{6}$') then return 'invalid_pwa_colour'; end if;
      if v_section ? 'backgroundColor' and not (jsonb_typeof(v_section -> 'backgroundColor') = 'string' and (v_section ->> 'backgroundColor') ~ '^#[0-9a-fA-F]{6}$') then return 'invalid_pwa_colour'; end if;
      if v_section ? 'installTitle' and not public.cfg_text_ok(v_section -> 'installTitle', 60) then return 'invalid_pwa'; end if;
      if v_section ? 'installText' and not public.cfg_text_ok(v_section -> 'installText', 160) then return 'invalid_pwa'; end if;
    end if;
    v_section := p_config -> 'translations';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' then return 'invalid_translations'; end if;
      if (select count(*) from jsonb_object_keys(v_section)) > 400 then return 'too_many_translations'; end if;
      for v_key, v_value in select * from jsonb_each(v_section) loop
        if v_key !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_-]+)+$' or jsonb_typeof(v_value) <> 'object' or public.cfg_unknown_key(v_value, array['en', 'dv']) is not null then return 'invalid_translation_key'; end if;
        if (v_value ? 'en' and not public.cfg_text_ok(v_value -> 'en', 200)) or (v_value ? 'dv' and not public.cfg_text_ok(v_value -> 'dv', 200)) then return 'invalid_translation_text'; end if;
      end loop;
    end if;
    return null;
  elsif p_kind = 'platform' then
    v_key := public.cfg_unknown_key(p_config, array['maintenance', 'features', 'help', 'sports', 'places', 'uploads', 'legal']);
    if v_key is not null then return 'unknown_key:' || v_key; end if;
    v_section := p_config -> 'maintenance';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['enabled', 'message', 'messageDv', 'endsAt']) is not null then return 'invalid_maintenance'; end if;
      if v_section ? 'enabled' and jsonb_typeof(v_section -> 'enabled') <> 'boolean' then return 'invalid_maintenance'; end if;
      if v_section ? 'message' and not public.cfg_text_ok(v_section -> 'message', 200) then return 'invalid_maintenance'; end if;
      if v_section ? 'messageDv' and not public.cfg_text_ok(v_section -> 'messageDv', 200) then return 'invalid_maintenance'; end if;
      if v_section ? 'endsAt' and not (jsonb_typeof(v_section -> 'endsAt') = 'string' and (v_section ->> 'endsAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}') then return 'invalid_maintenance'; end if;
      if coalesce((v_section ->> 'enabled')::boolean, false) and length(trim(coalesce(v_section ->> 'message', ''))) < 5 then return 'maintenance_message_required'; end if;
    end if;
    v_section := p_config -> 'features';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['recentlyViewed', 'news', 'installPrompt', 'calendarExports', 'topPlayers']) is not null then return 'invalid_features'; end if;
      if exists (select 1 from jsonb_each(v_section) e where jsonb_typeof(e.value) <> 'boolean') then return 'invalid_features'; end if;
    end if;
    v_section := p_config -> 'help';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['email', 'phone', 'hours']) is not null then return 'invalid_help'; end if;
      if v_section ? 'email' and not (jsonb_typeof(v_section -> 'email') = 'string' and (v_section ->> 'email') ~ '^[^@\s<>]{1,64}@[A-Za-z0-9.-]{1,120}\.[A-Za-z]{2,}$') then return 'invalid_email'; end if;
      if v_section ? 'phone' and not (jsonb_typeof(v_section -> 'phone') = 'string' and (v_section ->> 'phone') ~ '^[0-9 +()-]{3,20}$') then return 'invalid_phone'; end if;
      if v_section ? 'hours' and not public.cfg_text_ok(v_section -> 'hours', 80) then return 'invalid_help'; end if;
    end if;
    v_section := p_config -> 'sports';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['hidden']) is not null then return 'invalid_sports'; end if;
      -- At least one sport stays visible.
      if v_section ? 'hidden' and not (public.cfg_id_list_ok(v_section -> 'hidden', v_sports, 5)) then return 'invalid_sports'; end if;
    end if;
    -- Places: suggestion lists for island, atoll and venue fields. Free text stays allowed.
    v_section := p_config -> 'places';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['atolls', 'islands', 'venues']) is not null then return 'invalid_places'; end if;
      if v_section ? 'atolls' then
        if jsonb_typeof(v_section -> 'atolls') <> 'array' or jsonb_array_length(v_section -> 'atolls') > 30 then return 'invalid_places'; end if;
        for v_item in select * from jsonb_array_elements(v_section -> 'atolls') loop
          if not (public.cfg_text_ok(v_item, 40) and length(trim(v_item #>> '{}')) >= 2) then return 'invalid_place_name'; end if;
        end loop;
      end if;
      if v_section ? 'islands' then
        if jsonb_typeof(v_section -> 'islands') <> 'array' or jsonb_array_length(v_section -> 'islands') > 300 then return 'invalid_places'; end if;
        for v_item in select * from jsonb_array_elements(v_section -> 'islands') loop
          if jsonb_typeof(v_item) <> 'object' or public.cfg_unknown_key(v_item, array['name', 'atoll']) is not null then return 'invalid_places'; end if;
          if not (public.cfg_text_ok(v_item -> 'name', 80) and length(trim(v_item ->> 'name')) >= 2) then return 'invalid_place_name'; end if;
          if v_item ? 'atoll' and not public.cfg_text_ok(v_item -> 'atoll', 40) then return 'invalid_place_name'; end if;
        end loop;
      end if;
      if v_section ? 'venues' then
        if jsonb_typeof(v_section -> 'venues') <> 'array' or jsonb_array_length(v_section -> 'venues') > 200 then return 'invalid_places'; end if;
        for v_item in select * from jsonb_array_elements(v_section -> 'venues') loop
          if jsonb_typeof(v_item) <> 'object' or public.cfg_unknown_key(v_item, array['name', 'island']) is not null then return 'invalid_places'; end if;
          if not (public.cfg_text_ok(v_item -> 'name', 120) and length(trim(v_item ->> 'name')) >= 2) then return 'invalid_place_name'; end if;
          if v_item ? 'island' and not public.cfg_text_ok(v_item -> 'island', 80) then return 'invalid_place_name'; end if;
        end loop;
      end if;
    end if;
    -- Upload limits can only be lower than the storage limits (images 5 MB, documents 10 MB).
    v_section := p_config -> 'uploads';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, array['imageMb', 'documentMb']) is not null then return 'invalid_uploads'; end if;
      if v_section ? 'imageMb' and not (jsonb_typeof(v_section -> 'imageMb') = 'number' and (v_section ->> 'imageMb') ~ '^[0-9]+$' and (v_section ->> 'imageMb')::integer between 1 and 5) then return 'invalid_uploads'; end if;
      if v_section ? 'documentMb' and not (jsonb_typeof(v_section -> 'documentMb') = 'number' and (v_section ->> 'documentMb') ~ '^[0-9]+$' and (v_section ->> 'documentMb')::integer between 1 and 10) then return 'invalid_uploads'; end if;
    end if;
    -- Legal versions: a version label and effective date per legal page.
    v_section := p_config -> 'legal';
    if v_section is not null then
      if jsonb_typeof(v_section) <> 'object' or public.cfg_unknown_key(v_section, v_legal) is not null then return 'invalid_legal'; end if;
      for v_key, v_item in select * from jsonb_each(v_section) loop
        if jsonb_typeof(v_item) <> 'object' or public.cfg_unknown_key(v_item, array['version', 'effective']) is not null then return 'invalid_legal'; end if;
        if not (jsonb_typeof(v_item -> 'version') = 'string' and (v_item ->> 'version') ~ '^[0-9A-Za-z][0-9A-Za-z.-]{0,11}$') then return 'invalid_legal_version'; end if;
        if v_item ? 'effective' and not (jsonb_typeof(v_item -> 'effective') = 'string' and (v_item ->> 'effective') ~ '^\d{4}-\d{2}-\d{2}$') then return 'invalid_legal_date'; end if;
      end loop;
    end if;
    return null;
  end if;
  return 'invalid_kind';
end;
$$;


-- ===== 202611010040_organizer_first_and_admin_on_behalf.sql =====
-- Organizer-first player status and Super Admin "create on behalf".
-- Review-only. Do not apply, push or deploy without explicit owner authorization.
-- Apply after 202611010039_configuration_complete.sql.
-- Created with `supabase migration new organizer_first_and_admin_on_behalf`, renamed from
-- 20261101233359_… to 202611010040_… to match the other migrations.
--
--   1. player_record_status / player_record_statuses: one readable status per player
--      record (final specification 1.2), derived from data that already exists, so it
--      can never drift: merged, restricted, verified, claimed, invited, unclaimed.
--      "restricted" is shown only to administrators who may moderate players.
--      ("archived" has no source column yet; it is not invented.)
--   2. Sports Operations role and the admin.records.create permission. Platform Owners
--      receive it through admin_all_permissions; Moderators do not.
--   3. admin_create_organization / _team / _tournament / _player: an authorized
--      administrator creates a record for an owner, with a mandatory reason, a recent
--      sign-in and an immutable audit event. Owners/managers can be assigned at once.
--      Players are created unclaimed; their ID card is then registered through the
--      register-identity Edge Function as for any organizer-created player.
-- Additive: one check constraint is widened; no data is changed or removed.

-- ---------------------------------------------------------------------------------
-- 1. Player record status
-- ---------------------------------------------------------------------------------
create or replace function public.player_record_status_for(p_player uuid, p_show_restricted boolean)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p.merged_into is not null then 'merged'
    when p_show_restricted and exists (select 1 from public.platform_restrictions r where r.target_type = 'player' and r.target_id = p.id and r.lifted_at is null) then 'restricted'
    when p.account_id is not null and exists (select 1 from public.player_identity_keys k where k.player_id = p.id) then 'verified'
    when p.account_id is not null then 'claimed'
    when exists (select 1 from public.claim_invitations c where c.player_id = p.id and c.accepted_at is null and c.revoked_at is null and c.expires_at > now()) then 'invited'
    else 'unclaimed'
  end
  from public.player_profiles p where p.id = p_player;
$$;
revoke execute on function public.player_record_status_for(uuid, boolean) from public, anon, authenticated;

-- Statuses for a list of players (at most 200), for signed-in screens such as the roster table.
create or replace function public.player_record_statuses(p_players uuid[])
returns table(player_id uuid, status text)
language sql stable security definer set search_path = '' as $$
  select p.id, public.player_record_status_for(p.id, public.admin_has('admin.players.moderate'))
  from public.player_profiles p
  where (select auth.uid()) is not null and p.id = any(p_players[1:200]);
$$;
revoke execute on function public.player_record_statuses(uuid[]) from public, anon;
grant execute on function public.player_record_statuses(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- 2. Sports Operations role and permission
-- ---------------------------------------------------------------------------------
create or replace function public.admin_all_permissions()
returns text[] language sql immutable set search_path = '' as $$
  select array[
    'admin.dashboard.read', 'admin.cases.manage', 'admin.cases.child_safety',
    'admin.accounts.read', 'admin.accounts.suspend', 'admin.sessions.revoke',
    'admin.identities.review', 'admin.organizations.moderate', 'admin.teams.moderate',
    'admin.players.moderate', 'admin.tournaments.moderate', 'admin.results.review',
    'admin.content.moderate', 'admin.support.manage', 'admin.data_requests.manage',
    'admin.finance.audit', 'admin.notifications.manage', 'admin.audit.read', 'admin.audit.export',
    'admin.security.manage', 'admin.system.read', 'admin.configuration.manage',
    'admin.customization.edit', 'admin.customization.publish', 'admin.customization.rollback',
    'admin.admins.manage', 'admin.records.create'
  ]::text[];
$$;

create or replace function public.admin_role_permissions(p_role text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_role
    when 'platform_owner' then public.admin_all_permissions()
    when 'security_admin' then array['admin.dashboard.read', 'admin.cases.manage', 'admin.accounts.read', 'admin.accounts.suspend', 'admin.sessions.revoke', 'admin.security.manage', 'admin.audit.read', 'admin.system.read']
    when 'identity_reviewer' then array['admin.dashboard.read', 'admin.cases.manage', 'admin.identities.review', 'admin.players.moderate', 'admin.accounts.read']
    when 'moderator' then array['admin.dashboard.read', 'admin.cases.manage', 'admin.content.moderate', 'admin.organizations.moderate', 'admin.teams.moderate', 'admin.players.moderate', 'admin.tournaments.moderate']
    when 'support_agent' then array['admin.dashboard.read', 'admin.cases.manage', 'admin.support.manage', 'admin.accounts.read']
    when 'finance_auditor' then array['admin.dashboard.read', 'admin.finance.audit', 'admin.audit.read']
    when 'content_admin' then array['admin.dashboard.read', 'admin.content.moderate']
    when 'customization_designer' then array['admin.dashboard.read', 'admin.customization.edit']
    when 'customization_publisher' then array['admin.dashboard.read', 'admin.customization.edit', 'admin.customization.publish', 'admin.customization.rollback']
    when 'technical_operator' then array['admin.dashboard.read', 'admin.system.read', 'admin.notifications.manage', 'admin.results.review']
    when 'sports_operations' then array['admin.dashboard.read', 'admin.accounts.read', 'admin.organizations.moderate', 'admin.teams.moderate', 'admin.players.moderate', 'admin.tournaments.moderate', 'admin.records.create']
    else array[]::text[]
  end;
$$;

alter table public.platform_admin_assignments drop constraint if exists platform_admin_assignments_role_check;
alter table public.platform_admin_assignments add constraint platform_admin_assignments_role_check check (role in ('platform_owner', 'security_admin', 'identity_reviewer', 'moderator', 'support_agent', 'finance_auditor', 'content_admin', 'customization_designer', 'customization_publisher', 'technical_operator', 'sports_operations'));

-- ---------------------------------------------------------------------------------
-- 3. Create on behalf
-- ---------------------------------------------------------------------------------
-- A readable, unique slug: name words plus a short random suffix.
create or replace function public.admin_record_slug(p_name text)
returns text language sql volatile set search_path = '' as $$
  select left(coalesce(nullif(trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')), ''), 'record'), 60) || '-' || substr(md5(gen_random_uuid()::text), 1, 8);
$$;
revoke execute on function public.admin_record_slug(text) from public, anon, authenticated;

create or replace function public.admin_check_create(p_name text, p_reason text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_assert('admin.records.create');
  perform public.admin_require_reason(p_reason);
  perform public.admin_require_recent_auth();
  if p_name is null or length(trim(p_name)) < 2 or length(trim(p_name)) > 120 then raise exception 'invalid_name'; end if;
end;
$$;
revoke execute on function public.admin_check_create(text, text) from public, anon, authenticated;

create or replace function public.admin_create_organization(p_name text, p_description text, p_owner uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_me uuid := (select auth.uid());
begin
  perform public.admin_check_create(p_name, p_reason);
  if p_owner is not null and not exists (select 1 from public.profiles where id = p_owner) then raise exception 'account_not_found'; end if;
  insert into public.organizations(name, slug, description, created_by)
  values (trim(p_name), public.admin_record_slug(p_name), nullif(left(trim(coalesce(p_description, '')), 1000), ''), v_me)
  returning id into v_id;
  if p_owner is not null then insert into public.organization_memberships(organization_id, user_id, role) values (v_id, p_owner, 'owner'); end if;
  perform public.admin_audit('organization_created_on_behalf', 'organization', v_id::text, trim(p_name), p_reason, null, null, jsonb_build_object('owner_assigned', p_owner is not null));
  return v_id;
end;
$$;

create or replace function public.admin_create_team(p_name text, p_team_type text, p_island text, p_organization uuid, p_manager uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_me uuid := (select auth.uid());
begin
  perform public.admin_check_create(p_name, p_reason);
  if coalesce(p_team_type, 'club') not in ('club', 'island', 'national', 'school', 'other') then raise exception 'invalid_team_type'; end if;
  if p_organization is not null and not exists (select 1 from public.organizations where id = p_organization) then raise exception 'organization_not_found'; end if;
  if p_manager is not null and not exists (select 1 from public.profiles where id = p_manager) then raise exception 'account_not_found'; end if;
  insert into public.teams(name, slug, team_type, island, created_by)
  values (trim(p_name), public.admin_record_slug(p_name), coalesce(p_team_type, 'club'), nullif(left(trim(coalesce(p_island, '')), 80), ''), v_me)
  returning id into v_id;
  if p_manager is not null then insert into public.team_memberships(team_id, user_id, role) values (v_id, p_manager, 'manager'); end if;
  if p_organization is not null then insert into public.organization_team_links(organization_id, team_id, linked_by) values (p_organization, v_id, v_me); end if;
  perform public.admin_audit('team_created_on_behalf', 'team', v_id::text, trim(p_name), p_reason, null, null, jsonb_build_object('manager_assigned', p_manager is not null, 'organization_linked', p_organization is not null));
  return v_id;
end;
$$;

create or replace function public.admin_create_tournament(p_organization uuid, p_name text, p_sport text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_me uuid := (select auth.uid()); v_org text;
begin
  perform public.admin_check_create(p_name, p_reason);
  select name into v_org from public.organizations where id = p_organization;
  if v_org is null then raise exception 'organization_not_found'; end if;
  if p_sport not in ('football', 'futsal', 'handball', 'volleyball', 'basketball', 'basketball_3x3') then raise exception 'invalid_sport'; end if;
  -- Created as a draft; the organization's owners finish setup in their workspace.
  insert into public.tournaments(organization_id, name, slug, sport, created_by)
  values (p_organization, trim(p_name), public.admin_record_slug(p_name), p_sport, v_me)
  returning id into v_id;
  perform public.admin_audit('tournament_created_on_behalf', 'tournament', v_id::text, trim(p_name), p_reason, null, null, jsonb_build_object('organization', v_org, 'sport', p_sport));
  return v_id;
end;
$$;

create or replace function public.admin_create_player(p_display_name text, p_island text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_me uuid := (select auth.uid());
begin
  perform public.admin_check_create(p_display_name, p_reason);
  insert into public.player_profiles(display_name, slug, island, created_by, account_id, is_claimed)
  values (trim(p_display_name), public.admin_record_slug(p_display_name), nullif(left(trim(coalesce(p_island, '')), 80), ''), v_me, null, false)
  returning id into v_id;
  perform public.admin_audit('player_created_on_behalf', 'player', v_id::text, trim(p_display_name), p_reason, null, null, jsonb_build_object('claimed', false));
  return v_id;
end;
$$;

revoke execute on function public.admin_create_organization(text, text, uuid, text) from public, anon;
revoke execute on function public.admin_create_team(text, text, text, uuid, uuid, text) from public, anon;
revoke execute on function public.admin_create_tournament(uuid, text, text, text) from public, anon;
revoke execute on function public.admin_create_player(text, text, text) from public, anon;
grant execute on function public.admin_create_organization(text, text, uuid, text) to authenticated, service_role;
grant execute on function public.admin_create_team(text, text, text, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.admin_create_tournament(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.admin_create_player(text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- 4. Copy previous roster (final specification, page 41)
-- ---------------------------------------------------------------------------------
-- For one entered team: the players of its most recent submitted roster in another
-- tournament, limited to players still in the team's current squad. Only this
-- tournament's operators or the team's roster managers may ask. Shirt number and
-- position only; nothing private.
create or replace function public.previous_roster_players(p_entry_id uuid)
returns table(player_id uuid, shirt_number text, player_position text, tournament_name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_team uuid;
  v_tournament uuid;
  v_submission uuid;
  v_name text;
begin
  if (select auth.uid()) is null then raise exception 'sign_in_required'; end if;
  select e.team_id, e.tournament_id into v_team, v_tournament from public.tournament_entries e where e.id = p_entry_id;
  if v_team is null or not (public.is_tournament_operator(v_tournament) or public.team_has_permission(v_team, 'manage_rosters')) then
    raise exception 'organizer_permission_required';
  end if;
  select s.id, t.name into v_submission, v_name
  from public.roster_submissions s
  join public.tournament_entries e on e.id = s.entry_id
  join public.tournaments t on t.id = e.tournament_id
  where e.team_id = v_team and e.tournament_id <> v_tournament and s.status in ('submitted', 'under_review', 'approved', 'locked')
  order by s.created_at desc
  limit 1;
  if v_submission is null then return; end if;
  return query
  select rp.player_id, rp.shirt_number, rp.position, v_name
  from public.roster_submission_players rp
  where rp.submission_id = v_submission
    and exists (select 1 from public.player_team_memberships ms where ms.player_id = rp.player_id and ms.team_id = v_team and ms.status in ('active', 'loaned') and ms.effective_to is null);
end;
$$;
revoke execute on function public.previous_roster_players(uuid) from public, anon;
grant execute on function public.previous_roster_players(uuid) to authenticated, service_role;


-- ===== 202611010041_public_management_labels.sql =====
-- Final plan 5.4: claim status and publication status are separate.
-- REVIEW ONLY. Not applied. The owner applies it after review.
--
-- A published team may be run by the tournament organizer before any team manager
-- accepts it. The public page then says "Managed by tournament organizer" instead of
-- implying that a team account owns it. This function returns only that neutral
-- label for a published team: no account, membership or organization identifiers.
--
--   'team'      a manager outside every linked organization runs the team
--   'organizer' the team is linked to an organization and has no such manager
--   null        unpublished, unknown, or not linked to an organization
--
-- Players need no function: player_profiles.is_claimed is already a public field.

create or replace function public.get_public_team_management(p_team_id uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (
      select 1 from public.team_memberships m
      where m.team_id = t.id and m.role = 'manager'
        and not exists (
          select 1 from public.organization_team_links l
          join public.organization_memberships om on om.organization_id = l.organization_id and om.user_id = m.user_id
          where l.team_id = t.id
        )
    ) then 'team'
    when exists (select 1 from public.organization_team_links l where l.team_id = t.id) then 'organizer'
    else null
  end
  from public.teams t
  where t.id = p_team_id and t.is_published and t.deactivated_at is null;
$$;
revoke execute on function public.get_public_team_management(uuid) from public;
grant execute on function public.get_public_team_management(uuid) to anon, authenticated, service_role;


-- ===== 202611010042_simple_match_start.sql =====
-- Simple Match Center: "Start Match" and its Undo.
-- REVIEW ONLY. Not applied. The owner applies it after review.
--
-- change_fixture (migration 036) lets an organizer schedule, postpone, cancel or
-- abandon a match, but not mark it as being played. This adds one narrow action:
-- a tournament operator or an assigned match official may move a scheduled match
-- to live, or move a live match with no submitted result back to scheduled
-- (the Undo of an accidental start). Nothing else on the match changes, and the
-- existing fixture trigger records the change in the tournament timeline.
-- Results still go only through submit_match_result and confirm_match_result.

create or replace function public.set_match_live(p_match uuid, p_live boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_match public.matches;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  select * into v_match from public.matches where id = p_match for update;
  if v_match.id is null or not (public.is_tournament_operator(v_match.tournament_id) or public.is_match_official(p_match)) then
    raise exception 'organizer_permission_required';
  end if;
  if p_live then
    if v_match.status <> 'scheduled' then raise exception 'match_not_startable'; end if;
    update public.matches set status = 'live' where id = p_match;
  else
    if v_match.status <> 'live' then raise exception 'match_not_live'; end if;
    if exists (select 1 from public.match_result_versions r where r.match_id = p_match) then raise exception 'result_already_submitted'; end if;
    update public.matches set status = 'scheduled' where id = p_match;
  end if;
end;
$$;
revoke execute on function public.set_match_live(uuid, boolean) from public, anon;
grant execute on function public.set_match_live(uuid, boolean) to authenticated, service_role;


-- ===== 202611010043_public_tournament_players.sql =====
-- Public tournament page: Players and Statistics tabs.
-- REVIEW ONLY. Not applied. The owner applies it after review.
--
-- Two read-only functions for a published (non-draft) tournament. They return
-- public fields only: player and team names and page addresses (slugs), shirt
-- numbers and counted statistics. No account, identity, contact, document,
-- payment or internal identifier is returned. Unpublished players are left out;
-- an unpublished team is shown without its name.

-- Players on each approved team's latest approved or locked squad list.
create or replace function public.get_public_tournament_players(p_tournament uuid)
returns table(player_slug text, player_name text, photo_url text, team_name text, team_slug text, shirt_number text, player_position text)
language sql stable security definer set search_path = '' as $$
  with latest as (
    select distinct on (rs.entry_id) rs.id, rs.entry_id
    from public.roster_submissions rs
    join public.tournament_entries e on e.id = rs.entry_id
    where e.tournament_id = p_tournament and e.application_status = 'approved' and rs.status in ('approved', 'locked')
    order by rs.entry_id, rs.version desc
  )
  select p.slug, p.display_name, p.photo_url,
    case when t.is_published then t.name end, case when t.is_published then t.slug end,
    rsp.shirt_number, rsp.position
  from latest l
  join public.roster_submission_players rsp on rsp.submission_id = l.id
  join public.player_profiles p on p.id = rsp.player_id and p.is_published
  join public.tournament_entries e on e.id = l.entry_id
  join public.teams t on t.id = e.team_id
  join public.tournaments tr on tr.id = e.tournament_id and tr.is_published and tr.status <> 'draft'
  order by t.name, p.display_name;
$$;
revoke execute on function public.get_public_tournament_players(uuid) from public;
grant execute on function public.get_public_tournament_players(uuid) to anon, authenticated, service_role;

-- Player rankings from confirmed matches only, counted the same way as
-- get_player_official_statistics (migrations 008 and 014).
create or replace function public.get_public_tournament_player_statistics(p_tournament uuid)
returns table(player_slug text, player_name text, team_name text, appearances bigint, goals bigint, assists bigint, yellow_cards bigint, red_cards bigint)
language sql stable security definer set search_path = '' as $$
  with confirmed_matches as (
    select distinct v.match_id from public.match_result_versions v
    join public.matches m on m.id = v.match_id
    where v.status = 'confirmed' and m.tournament_id = p_tournament
  ), event_totals as (
    select ev.player_id,
      count(*) filter (where ev.event_type in ('goal', 'point', 'one_point', 'two_point', 'three_point')) as goals,
      count(*) filter (where ev.event_type = 'assist') as assists,
      count(*) filter (where ev.event_type = 'yellow_card') as yellow_cards,
      count(*) filter (where ev.event_type in ('red_card', 'blue_card')) as red_cards
    from public.match_events ev
    join confirmed_matches cm on cm.match_id = ev.match_id
    where ev.player_id is not null
    group by ev.player_id
  ), appearances as (
    select mp.player_id, max(mp.team_id::text)::uuid as team_id, count(distinct mp.match_id) as appearances
    from public.match_player_participants mp
    join confirmed_matches cm on cm.match_id = mp.match_id
    group by mp.player_id
  )
  select p.slug, p.display_name, case when t.is_published then t.name end,
    coalesce(a.appearances, 0)::bigint, coalesce(et.goals, 0)::bigint, coalesce(et.assists, 0)::bigint,
    coalesce(et.yellow_cards, 0)::bigint, coalesce(et.red_cards, 0)::bigint
  from public.tournaments tr
  join (select player_id from appearances union select player_id from event_totals) who on true
  join public.player_profiles p on p.id = who.player_id and p.is_published
  left join appearances a on a.player_id = who.player_id
  left join event_totals et on et.player_id = who.player_id
  left join public.teams t on t.id = a.team_id
  where tr.id = p_tournament and tr.is_published and tr.status <> 'draft'
  order by coalesce(et.goals, 0) desc, coalesce(et.assists, 0) desc, p.display_name;
$$;
revoke execute on function public.get_public_tournament_player_statistics(uuid) from public;
grant execute on function public.get_public_tournament_player_statistics(uuid) to anon, authenticated, service_role;


-- ===== 202611010044_match_discipline.sql =====
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


-- ===== 202611010045_tournament_engine.sql =====
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


-- ===== 202611030046_sponsor_deliverables_and_protests.sql =====
-- Review-only: the owner applies it. Additive; changes no existing table data.
--
-- 1) Sponsor deliverables (unified plan section 22): what the organizer owes
--    each sponsor - banners, logo placement, social posts, announcements,
--    hospitality - with a due date and a fulfilment state. Private to the
--    tournament's finance staff, like tournament_sponsors itself.
-- 2) Protests and appeals (unified plan section 23): a team manager of an
--    approved entry files a protest about a match or decision; the tournament's
--    organizers decide it with a written reason; a decided protest can be
--    appealed once. Nothing is deleted: a filer may withdraw while undecided.
--    Private to the organizers and the filing team; never on public pages.

-- 1 ---------------------------------------------------------------------------
create table if not exists public.tournament_sponsor_deliverables (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  sponsor_id uuid not null references public.tournament_sponsors(id) on delete cascade,
  kind text not null default 'other' check (kind in ('banner', 'logo_placement', 'social_post', 'announcement', 'hospitality', 'branded_item', 'other')),
  title text not null check (length(trim(title)) between 2 and 160),
  due_on date,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'waived')),
  note text check (note is null or length(note) <= 500),
  delivered_at timestamptz,
  delivered_by uuid references public.profiles(id) on delete set null,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'delivered') = (delivered_at is not null))
);
create index if not exists tournament_sponsor_deliverables_idx on public.tournament_sponsor_deliverables(tournament_id, sponsor_id, due_on);
alter table public.tournament_sponsor_deliverables enable row level security;

-- The sponsor must belong to the same tournament as the deliverable.
create or replace function public.check_deliverable_sponsor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.tournament_sponsors s where s.id = new.sponsor_id and s.tournament_id = new.tournament_id) then
    raise exception 'sponsor_not_in_tournament';
  end if;
  new.updated_at := now();
  if new.status = 'delivered' and new.delivered_at is null then new.delivered_at := now(); new.delivered_by := auth.uid(); end if;
  if new.status <> 'delivered' then new.delivered_at := null; new.delivered_by := null; end if;
  return new;
end;
$$;
drop trigger if exists check_deliverable_sponsor on public.tournament_sponsor_deliverables;
create trigger check_deliverable_sponsor before insert or update on public.tournament_sponsor_deliverables
  for each row execute function public.check_deliverable_sponsor();

drop policy if exists "finance staff read deliverables" on public.tournament_sponsor_deliverables;
create policy "finance staff read deliverables" on public.tournament_sponsor_deliverables for select to authenticated
  using (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'finance'));
drop policy if exists "finance staff add deliverables" on public.tournament_sponsor_deliverables;
create policy "finance staff add deliverables" on public.tournament_sponsor_deliverables for insert to authenticated
  with check (created_by = (select auth.uid()) and (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'finance')));
drop policy if exists "finance staff update deliverables" on public.tournament_sponsor_deliverables;
create policy "finance staff update deliverables" on public.tournament_sponsor_deliverables for update to authenticated
  using (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'finance'))
  with check (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'finance'));
drop policy if exists "finance staff remove deliverables" on public.tournament_sponsor_deliverables;
create policy "finance staff remove deliverables" on public.tournament_sponsor_deliverables for delete to authenticated
  using (public.is_tournament_operator(tournament_id) or public.has_tournament_permission(tournament_id, 'finance'));
grant select, insert, update, delete on public.tournament_sponsor_deliverables to authenticated;

-- 2 ---------------------------------------------------------------------------
create table if not exists public.tournament_protests (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  team_id uuid not null references public.teams(id) on delete restrict,
  kind text not null check (kind in ('protest', 'appeal')),
  appeal_of uuid references public.tournament_protests(id) on delete restrict,
  subject text not null check (length(trim(subject)) between 5 and 160),
  grounds text not null check (length(trim(grounds)) between 20 and 4000),
  status text not null default 'submitted' check (status in ('submitted', 'under_review', 'upheld', 'rejected', 'withdrawn')),
  decision text check (decision is null or length(decision) <= 4000),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  filed_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'appeal') = (appeal_of is not null)),
  check ((status in ('upheld', 'rejected')) = (decided_at is not null))
);
create index if not exists tournament_protests_idx on public.tournament_protests(tournament_id, status, created_at desc);
create unique index if not exists tournament_protests_one_appeal on public.tournament_protests(appeal_of) where appeal_of is not null and status <> 'withdrawn';
alter table public.tournament_protests enable row level security;

-- Reads only; every change goes through the functions below.
drop policy if exists "organizers and filing team read protests" on public.tournament_protests;
create policy "organizers and filing team read protests" on public.tournament_protests for select to authenticated
  using (public.is_tournament_operator(tournament_id) or public.is_team_manager(team_id));
grant select on public.tournament_protests to authenticated;

create or replace function public.file_tournament_protest(p_tournament uuid, p_team uuid, p_match uuid, p_subject text, p_grounds text, p_appeal_of uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_parent public.tournament_protests;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if not public.is_team_manager(p_team) then raise exception 'team_manager_required'; end if;
  if not exists (select 1 from public.tournament_entries e where e.tournament_id = p_tournament and e.team_id = p_team and e.application_status = 'approved') then
    raise exception 'team_not_in_tournament';
  end if;
  if p_match is not null and not exists (select 1 from public.matches m where m.id = p_match and m.tournament_id = p_tournament) then
    raise exception 'match_not_in_tournament';
  end if;
  if p_subject is null or length(trim(p_subject)) < 5 then raise exception 'subject_required'; end if;
  if p_grounds is null or length(trim(p_grounds)) < 20 then raise exception 'grounds_required'; end if;
  if p_appeal_of is not null then
    select * into v_parent from public.tournament_protests where id = p_appeal_of;
    if v_parent.id is null or v_parent.tournament_id <> p_tournament or v_parent.team_id <> p_team then raise exception 'protest_not_found'; end if;
    if v_parent.kind <> 'protest' or v_parent.status not in ('upheld', 'rejected') then raise exception 'appeal_needs_decided_protest'; end if;
    if exists (select 1 from public.tournament_protests a where a.appeal_of = p_appeal_of and a.status <> 'withdrawn') then raise exception 'already_appealed'; end if;
  end if;
  insert into public.tournament_protests (tournament_id, match_id, team_id, kind, appeal_of, subject, grounds)
  values (p_tournament, coalesce(p_match, v_parent.match_id), p_team, case when p_appeal_of is null then 'protest' else 'appeal' end, p_appeal_of, left(trim(p_subject), 160), left(trim(p_grounds), 4000))
  returning id into v_id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (auth.uid(), case when p_appeal_of is null then 'protest_filed' else 'appeal_filed' end, 'tournament_protest', v_id, left(trim(p_subject), 500));
  return v_id;
end;
$$;
revoke execute on function public.file_tournament_protest(uuid, uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.file_tournament_protest(uuid, uuid, uuid, text, text, uuid) to authenticated, service_role;

-- Organizers move a protest to review or decide it; a decision needs a reason.
create or replace function public.decide_tournament_protest(p_protest uuid, p_status text, p_decision text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.tournament_protests;
begin
  select * into v_row from public.tournament_protests where id = p_protest for update;
  if v_row.id is null or not public.is_tournament_operator(v_row.tournament_id) then raise exception 'organizer_permission_required'; end if;
  if v_row.status in ('upheld', 'rejected', 'withdrawn') then raise exception 'already_closed'; end if;
  if p_status not in ('under_review', 'upheld', 'rejected') then raise exception 'invalid_status'; end if;
  if p_status in ('upheld', 'rejected') and (p_decision is null or length(trim(p_decision)) < 10) then raise exception 'decision_reason_required'; end if;
  update public.tournament_protests set status = p_status, updated_at = now(),
    decision = case when p_status = 'under_review' then decision else left(trim(p_decision), 4000) end,
    decided_by = case when p_status = 'under_review' then null else auth.uid() end,
    decided_at = case when p_status = 'under_review' then null else now() end
  where id = p_protest;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (auth.uid(), 'protest_' || p_status, 'tournament_protest', p_protest, left(coalesce(trim(p_decision), ''), 500));
end;
$$;
revoke execute on function public.decide_tournament_protest(uuid, text, text) from public, anon;
grant execute on function public.decide_tournament_protest(uuid, text, text) to authenticated, service_role;

-- The filing team may withdraw while the protest is still open.
create or replace function public.withdraw_tournament_protest(p_protest uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.tournament_protests;
begin
  select * into v_row from public.tournament_protests where id = p_protest for update;
  if v_row.id is null or not public.is_team_manager(v_row.team_id) then raise exception 'protest_not_found'; end if;
  if v_row.status not in ('submitted', 'under_review') then raise exception 'already_closed'; end if;
  update public.tournament_protests set status = 'withdrawn', updated_at = now() where id = p_protest;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (auth.uid(), 'protest_withdrawn', 'tournament_protest', p_protest, null);
end;
$$;
revoke execute on function public.withdraw_tournament_protest(uuid) from public, anon;
grant execute on function public.withdraw_tournament_protest(uuid) to authenticated, service_role;


-- ===== 202611030047_public_coach_referee_profiles.sql =====
-- Review-only: the owner applies it. Additive.
--
-- Public coach and referee directories (unified plan sections 7.2 and 32.2)
-- with consent: nobody appears until they switch on their own public profile.
-- The person chooses the public name, island and short biography; the
-- database checks they actually hold the role (a coach role in a team, or at
-- least one official assignment). Visitors read only switched-on profiles and
-- facts derived from published records - never email, phone or account data.

create table if not exists public.public_person_profiles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('coach', 'referee')),
  public_id uuid not null default gen_random_uuid() unique,
  display_name text not null check (length(trim(display_name)) between 2 and 80),
  island text check (island is null or length(trim(island)) between 1 and 60),
  bio text check (bio is null or length(bio) <= 600),
  is_public boolean not null default false,
  consent_version text not null default 'public-person-profile-1',
  consented_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.public_person_profiles enable row level security;
-- Only the person reads their own row directly; visitors use the functions below.
drop policy if exists "people read own public profile" on public.public_person_profiles;
create policy "people read own public profile" on public.public_person_profiles for select to authenticated using (user_id = (select auth.uid()));
grant select on public.public_person_profiles to authenticated;

create or replace function public.person_holds_role(p_user uuid, p_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_role
    when 'coach' then exists (select 1 from public.team_memberships m where m.user_id = p_user and m.role = 'coach')
    when 'referee' then exists (select 1 from public.match_official_assignments a where a.user_id = p_user and a.role = 'official')
    else false end;
$$;
revoke execute on function public.person_holds_role(uuid, text) from public, anon, authenticated;

-- The signed-in person's own roles and profiles, for Account Settings.
create or replace function public.get_my_public_person_profiles()
returns table(role text, eligible boolean, public_id uuid, display_name text, island text, bio text, is_public boolean)
language sql stable security definer set search_path = '' as $$
  select r.role, public.person_holds_role(auth.uid(), r.role), p.public_id, p.display_name, p.island, p.bio, coalesce(p.is_public, false)
  from (values ('coach'), ('referee')) as r(role)
  left join public.public_person_profiles p on p.user_id = auth.uid() and p.role = r.role
  where auth.uid() is not null;
$$;
revoke execute on function public.get_my_public_person_profiles() from public, anon;
grant execute on function public.get_my_public_person_profiles() to authenticated, service_role;

create or replace function public.save_public_person_profile(p_role text, p_is_public boolean, p_display_name text, p_island text, p_bio text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if p_role not in ('coach', 'referee') then raise exception 'invalid_role'; end if;
  if p_is_public and not public.person_holds_role(auth.uid(), p_role) then raise exception 'role_not_held'; end if;
  if p_display_name is null or length(trim(p_display_name)) < 2 then raise exception 'name_required'; end if;
  insert into public.public_person_profiles (user_id, role, display_name, island, bio, is_public, consented_at, updated_at)
  values (auth.uid(), p_role, left(trim(p_display_name), 80), nullif(left(trim(coalesce(p_island, '')), 60), ''), nullif(left(trim(coalesce(p_bio, '')), 600), ''), p_is_public, case when p_is_public then now() end, now())
  on conflict (user_id, role) do update set display_name = excluded.display_name, island = excluded.island, bio = excluded.bio, is_public = excluded.is_public,
    consented_at = case when excluded.is_public then coalesce(public.public_person_profiles.consented_at, now()) else null end, updated_at = now()
  returning public_id into v_id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), case when p_is_public then 'public_profile_shown' else 'public_profile_hidden' end, 'public_person_profile', v_id, p_role);
  return v_id;
end;
$$;
revoke execute on function public.save_public_person_profile(text, boolean, text, text, text) from public, anon;
grant execute on function public.save_public_person_profile(text, boolean, text, text, text) to authenticated, service_role;

-- Directory: switched-on profiles only, with counts from published records.
create or replace function public.get_public_people(p_role text, p_search text default null, p_limit integer default 60, p_offset integer default 0)
returns table(public_id uuid, display_name text, island text, bio text, matches_officiated bigint, teams_coached bigint)
language sql stable security definer set search_path = '' as $$
  select p.public_id, p.display_name, p.island, p.bio,
    case when p.role = 'referee' then (select count(distinct a.match_id) from public.match_official_assignments a join public.matches m on m.id = a.match_id join public.tournaments t on t.id = m.tournament_id
      where a.user_id = p.user_id and a.role = 'official' and m.status = 'confirmed' and t.is_published) else 0 end,
    case when p.role = 'coach' then (select count(distinct tm.team_id) from public.team_memberships tm join public.teams te on te.id = tm.team_id
      where tm.user_id = p.user_id and tm.role = 'coach' and te.is_published) else 0 end
  from public.public_person_profiles p
  where p.role = p_role and p.is_public and public.person_holds_role(p.user_id, p.role)
    and (p_search is null or p_search = '' or p.display_name ilike '%' || replace(replace(p_search, '%', ''), '_', '') || '%' or p.island ilike '%' || replace(replace(p_search, '%', ''), '_', '') || '%')
  order by p.display_name
  limit least(greatest(coalesce(p_limit, 60), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke execute on function public.get_public_people(text, text, integer, integer) from public;
grant execute on function public.get_public_people(text, text, integer, integer) to anon, authenticated, service_role;

-- One person: profile plus published teams coached or recent official matches.
create or replace function public.get_public_person(p_public_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'public_id', p.public_id, 'role', p.role, 'display_name', p.display_name, 'island', p.island, 'bio', p.bio,
    'teams', case when p.role = 'coach' then coalesce((select jsonb_agg(jsonb_build_object('name', te.name, 'slug', te.slug) order by te.name)
      from public.team_memberships tm join public.teams te on te.id = tm.team_id where tm.user_id = p.user_id and tm.role = 'coach' and te.is_published), '[]'::jsonb) else '[]'::jsonb end,
    'matches', case when p.role = 'referee' then coalesce((select jsonb_agg(x order by x->>'scheduled_at' desc) from (
      select jsonb_build_object('id', m.id, 'scheduled_at', m.scheduled_at, 'tournament', t.name, 'tournament_slug', t.slug, 'home', ht.name, 'away', at.name) as x
      from public.match_official_assignments a join public.matches m on m.id = a.match_id join public.tournaments t on t.id = m.tournament_id
      left join public.teams ht on ht.id = m.home_team_id left join public.teams at on at.id = m.away_team_id
      where a.user_id = p.user_id and a.role = 'official' and m.status = 'confirmed' and t.is_published
      order by m.scheduled_at desc nulls last limit 20) s), '[]'::jsonb) else '[]'::jsonb end)
  from public.public_person_profiles p
  where p.public_id = p_public_id and p.is_public and public.person_holds_role(p.user_id, p.role);
$$;
revoke execute on function public.get_public_person(uuid) from public;
grant execute on function public.get_public_person(uuid) to anon, authenticated, service_role;


-- ===== 202611040048_delete_unplayed_fixture.sql =====
-- Review-only: the owner applies it. Additive.
--
-- Deleting a fixture that was added by mistake (unified plan sections 3 and 18).
-- Only an unplayed match can be deleted: status scheduled, postponed or
-- cancelled, with no result versions, events or recorded appearances. The
-- organizer gives a reason, which is kept in the tournament activity log with
-- the teams and time, so the deletion stays auditable. Played matches are
-- never deleted; they are corrected or marked abandoned instead.

-- Guard for any delete path, not only the function below.
create or replace function public.protect_played_match()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status not in ('scheduled', 'postponed', 'cancelled')
    or exists (select 1 from public.match_result_versions v where v.match_id = old.id)
    or exists (select 1 from public.match_events e where e.match_id = old.id)
    or exists (select 1 from public.match_player_participants p where p.match_id = old.id) then
    raise exception 'match_has_results';
  end if;
  return old;
end;
$$;
drop trigger if exists protect_played_match_trigger on public.matches;
create trigger protect_played_match_trigger before delete on public.matches for each row execute function public.protect_played_match();

create or replace function public.delete_fixture(p_match uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_match public.matches; v_home text; v_away text;
begin
  select * into v_match from public.matches where id = p_match for update;
  if v_match.id is null or not public.is_tournament_operator(v_match.tournament_id) then raise exception 'organizer_permission_required'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  select name into v_home from public.teams where id = v_match.home_team_id;
  select name into v_away from public.teams where id = v_match.away_team_id;
  perform public.log_tournament_event(v_match.tournament_id, 'match', v_match.id, 'fixture_deleted',
    jsonb_build_object('home', v_home, 'away', v_away, 'scheduled_at', v_match.scheduled_at, 'venue', v_match.venue, 'status', v_match.status),
    left(trim(p_reason), 500));
  begin
    delete from public.matches where id = p_match;
  exception when foreign_key_violation or restrict_violation then
    raise exception 'match_feeds_later_round';
  end;
end;
$$;
revoke execute on function public.delete_fixture(uuid, text) from public, anon;
grant execute on function public.delete_fixture(uuid, text) to authenticated, service_role;


-- ===== 20261105144931_managed_record_deletion.sql =====
-- Review and apply in the existing Supabase environment before using delete.
-- Applying this migration does not delete existing records.
create or replace function public.protect_used_management_record()
returns trigger language plpgsql security definer set search_path = '' as $$
declare dependency record; linked boolean;
begin
  if tg_table_name = 'player_profiles' then
    if old.account_id is not null or old.is_claimed or old.is_published
      or old.created_at <= now() - interval '1 day' then
      raise exception 'player_not_unused';
    end if;
  elsif tg_table_name = 'tournaments' then
    if old.is_published or old.status not in ('draft', 'setup') then
      raise exception 'tournament_not_unused';
    end if;
  else
    raise exception 'unsupported_record_type';
  end if;
  -- Check every FK, including CASCADE/SET NULL and future history tables.
  -- Only unused tournament setup configuration may cascade with the draft.
  for dependency in
    select ns.nspname, rel.relname, att.attname
    from pg_catalog.pg_constraint fk
    join pg_catalog.pg_class rel on rel.oid = fk.conrelid
    join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace
    join lateral unnest(fk.conkey, fk.confkey) as keys(child_key, parent_key) on true
    join pg_catalog.pg_attribute att on att.attrelid = fk.conrelid and att.attnum = keys.child_key
    join pg_catalog.pg_attribute parent_att on parent_att.attrelid = fk.confrelid and parent_att.attnum = keys.parent_key
    where fk.contype = 'f' and fk.confrelid = tg_relid and parent_att.attname = 'id'
  loop
    if tg_table_name = 'tournaments' and dependency.nspname = 'public'
      and dependency.relname in ('tournament_setup_steps', 'tournament_registration_settings',
        'tournament_registration_questions', 'tournament_categories', 'competition_stages', 'tournament_fees') then
      continue;
    end if;
    execute format('select exists (select 1 from %I.%I where %I = $1)',
      dependency.nspname, dependency.relname, dependency.attname) into linked using old.id;
    if linked then raise exception 'record_has_dependencies'; end if;
  end loop;
  return old;
end;
$$;
revoke execute on function public.protect_used_management_record() from public, anon, authenticated;
drop trigger if exists protect_used_player_record on public.player_profiles;
create trigger protect_used_player_record before delete on public.player_profiles
  for each row execute function public.protect_used_management_record();
drop trigger if exists protect_used_tournament_record on public.tournaments;
create trigger protect_used_tournament_record before delete on public.tournaments
  for each row execute function public.protect_used_management_record();

create or replace function public.delete_unused_player(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare player public.player_profiles;
begin
  if auth.uid() is null then raise exception 'permission_required'; end if;
  select * into player from public.player_profiles where id = p_id for update;
  if player.id is null then raise exception 'record_not_found'; end if;
  if player.created_by is distinct from auth.uid() then raise exception 'permission_required'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'reason_required'; end if;
  delete from public.player_profiles where id = p_id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
    values (auth.uid(), 'unused_player_deleted', 'player', p_id, btrim(p_reason));
end;
$$;
revoke execute on function public.delete_unused_player(uuid, text) from public, anon;
grant execute on function public.delete_unused_player(uuid, text) to authenticated;

create or replace function public.delete_unused_tournament(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare tournament public.tournaments;
begin
  if auth.uid() is null then raise exception 'permission_required'; end if;
  select * into tournament from public.tournaments where id = p_id for update;
  if tournament.id is null then raise exception 'record_not_found'; end if;
  -- Authorization comes from real organization membership, never editable JWT data.
  if not exists (select 1 from public.organization_memberships om
    where om.organization_id = tournament.organization_id and om.user_id = auth.uid()
      and om.role in ('owner', 'operations')) then raise exception 'permission_required'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'reason_required'; end if;
  delete from public.tournaments where id = p_id;
  -- This audit record survives deletion of the tournament.
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
    values (auth.uid(), 'unused_tournament_deleted', 'tournament', p_id, btrim(p_reason));
end;
$$;
revoke execute on function public.delete_unused_tournament(uuid, text) from public, anon;
grant execute on function public.delete_unused_tournament(uuid, text) to authenticated;


-- ===== 202611060001_match_center_standings_insert_fix.sql =====
-- Fix Match Center result confirmation.
-- The standings snapshot INSERT has 11 target columns and must return 11 expressions.
-- The missing stage_id caused "INSERT has more target columns than expressions"
-- during confirm_match_result -> recalculate_stage_standings.
-- Safe to apply after migration 045, including installations where 045 is already live.

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


-- ===== 202611060002_auto_publish_players_and_teams.sql =====
﻿-- Auto-publish players and teams when they are created or added anywhere in the app.
-- This removes the separate "publish" step for normal squad/team/player flows.
alter table public.player_profiles alter column is_published set default true;
alter table public.teams alter column is_published set default true;

update public.player_profiles set is_published = true where is_published is not true;
update public.teams set is_published = true where is_published is not true;


-- ===== 202611060003_publish_helpers.sql =====
﻿-- Helpers so the browser can publish a player or team without depending on
-- table-level update policies (which often block non-owners). Security definer.
create or replace function public.publish_player_profile(p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  update public.player_profiles set is_published = true where id = p_player_id;
end;
$$;
revoke execute on function public.publish_player_profile(uuid) from public, anon;
grant execute on function public.publish_player_profile(uuid) to authenticated, service_role;

create or replace function public.publish_team(p_team_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  update public.teams set is_published = true where id = p_team_id;
end;
$$;
revoke execute on function public.publish_team(uuid) from public, anon;
grant execute on function public.publish_team(uuid) to authenticated, service_role;


-- ===== 202611060004_publish_match_players.sql =====
﻿-- Publish players who appear in confirmed match events/results, so public
-- match pages never show "Player not public" for participants.
create or replace function public.record_match_event(
  p_match_id uuid, p_team_id uuid, p_player_id uuid, p_event_type text,
  p_event_minute integer, p_payload jsonb, p_idempotency_key uuid, p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare match_row public.matches; event_id uuid; allowed boolean := false; sport text;
begin
  if p_actor_id <> auth.uid() then raise exception 'actor_mismatch'; end if;
  select m.* into match_row from public.matches m where m.id = p_match_id for update;
  if match_row.id is null or not public.is_match_participant(p_match_id) then raise exception 'match_not_assigned'; end if;
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
  if p_player_id is not null then update public.player_profiles set is_published = true where id = p_player_id; end if;
  return event_id;
end;
$$;
revoke execute on function public.record_match_event(uuid, uuid, uuid, text, integer, jsonb, uuid, uuid) from public, anon;
grant execute on function public.record_match_event(uuid, uuid, uuid, text, integer, jsonb, uuid, uuid) to authenticated, service_role;

-- Patch confirm/correct to publish participants.
create or replace function public.confirm_match_result(p_result_id uuid, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare result_row public.match_result_versions; match_row public.matches;
begin
  if p_actor_id <> auth.uid() then raise exception 'actor_mismatch'; end if;
  select * into result_row from public.match_result_versions where id = p_result_id for update;
  select * into match_row from public.matches where id = result_row.match_id for update;
  if result_row.id is null or match_row.id is null or not public.is_tournament_operator(match_row.tournament_id) or result_row.status <> 'submitted' then raise exception 'confirmation_not_allowed'; end if;
  update public.match_result_versions set status = 'confirmed', confirmed_by = p_actor_id where id = p_result_id;
  update public.match_result_versions set status = 'rejected' where match_id = match_row.id and status = 'submitted' and id <> p_result_id;
  update public.matches set status = 'confirmed' where id = match_row.id;
  update public.player_profiles set is_published = true where id in (select player_id from public.match_player_participants where match_id = match_row.id);
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
  update public.player_profiles set is_published = true where id in (select player_id from public.match_player_participants where match_id = p_match_id);
  perform public.recalculate_stage_standings(match_row.stage_id);
  perform public.recalculate_match_milestones(match_row.id);
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason) values (p_actor_id, 'match_result_corrected', 'match_result_version', result_id, trim(p_reason));
  return result_id;
end;
$$;

-- Publish all existing players now.
update public.player_profiles set is_published = true where is_published is not true;


-- ===== 202611060005_public_match_players.sql =====
-- Show match event and lineup player names regardless of publication status.
create or replace function public.get_public_match_detail(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_match public.matches;
  v_official boolean;
  v_score jsonb;
  v_events jsonb := '[]'::jsonb;
  v_lineups jsonb := '[]'::jsonb;
  v_hidden integer := 0;
begin
  select m.* into v_match
  from public.matches m
  join public.tournaments tr on tr.id = m.tournament_id and tr.is_published and tr.status <> 'draft'
  join public.competition_stages st on st.id = m.stage_id and st.published_at is not null
  where m.id = p_match_id;
  if v_match.id is null then return null; end if;

  v_official := v_match.status = 'confirmed'
    and not exists (select 1 from public.match_result_freezes f where f.match_id = v_match.id and f.lifted_at is null);

  if v_official then
    select v.score into v_score from public.match_result_versions v
    where v.match_id = v_match.id and v.status = 'confirmed' order by v.version desc limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
        'minute', e.event_minute,
        'type', e.event_type,
        'side', case when e.team_id = v_match.home_team_id then 'home' when e.team_id = v_match.away_team_id then 'away' end,
        'player', p.display_name,
        'player_slug', p.slug
      ) order by e.event_minute nulls last, e.created_at), '[]'::jsonb)
    into v_events
    from (select * from public.match_events where match_id = v_match.id order by event_minute nulls last, created_at limit 400) e
    left join public.player_profiles p on p.id = e.player_id;

    select coalesce(jsonb_agg(jsonb_build_object(
        'side', case when mp.team_id = v_match.home_team_id then 'home' else 'away' end,
        'player', p.display_name,
        'player_slug', p.slug,
        'starter', mp.starter
      ) order by mp.starter desc, p.display_name), '[]'::jsonb)
    into v_lineups
    from public.match_player_participants mp
    join public.player_profiles p on p.id = mp.player_id
    where mp.match_id = v_match.id;

    select count(*) into v_hidden
    from public.match_player_participants mp
    join public.player_profiles p on p.id = mp.player_id and not p.is_published
    where mp.match_id = v_match.id;
  end if;

  return jsonb_build_object(
    'id', v_match.id,
    'tournament_id', v_match.tournament_id,
    'home_team_id', v_match.home_team_id,
    'away_team_id', v_match.away_team_id,
    'scheduled_at', v_match.scheduled_at,
    'venue', v_match.venue,
    'status', v_match.status,
    'official', v_official,
    'home_score', case when v_official and jsonb_typeof(v_score->'home') = 'number' then (v_score->>'home')::numeric end,
    'away_score', case when v_official and jsonb_typeof(v_score->'away') = 'number' then (v_score->>'away')::numeric end,
    'outcome', case when v_official and v_score->>'outcome' in ('walkover', 'forfeit', 'abandoned') then v_score->>'outcome' end,
    'events', v_events,
    'lineups', v_lineups,
    'private_players', v_hidden
  );
end;
$$;


-- ===== 202611060006_public_player_profiles.sql =====
﻿-- Make all player profiles publicly readable.
drop policy if exists "published players are public" on public.player_profiles;
create policy "player profiles are public" on public.player_profiles for select using (true);


-- ===== 202611060007_public_teams.sql =====
﻿-- Make all teams publicly readable.
drop policy if exists "published teams are public" on public.teams;
create policy "teams are public" on public.teams for select using (true);


-- ===== 202611060008_backfill_confirmed_results.sql =====
﻿-- Backfill: convert any already-submitted (but unconfirmed) results to confirmed
-- and rebuild standings, so historical matches count immediately.
do $$
declare m record;
begin
  for m in select distinct match_id from public.match_result_versions where status = 'submitted' loop
    update public.match_result_versions set status = 'confirmed', confirmed_by = submitted_by where match_id = m.match_id and status = 'submitted';
    update public.matches set status = 'confirmed' where id = m.match_id;
  end loop;
end $$;

-- Rebuild standings for every stage that has matches.
do $$
declare s record;
begin
  for s in select distinct stage_id from public.matches where stage_id is not null loop
    perform public.recalculate_stage_standings(s.stage_id);
  end loop;
end $$;

