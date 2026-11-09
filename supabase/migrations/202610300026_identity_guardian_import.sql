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
