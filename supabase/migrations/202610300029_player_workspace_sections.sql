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
