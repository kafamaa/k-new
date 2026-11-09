-- Additive migration: profile-photo management for unclaimed players.
-- Review before applying. Does not reset data.

-- 1. Columns on player_profiles (additive).
alter table public.player_profiles
  add column if not exists photo_path text,
  add column if not exists photo_fit jsonb;

-- 2. Security-definer RPC to set an unclaimed player's photo.
create or replace function public.set_unclaimed_player_photo(
  p_player_id uuid,
  p_photo_path text,
  p_photo_url text,
  p_photo_fit jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player record;
  v_allowed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select id, account_id, is_claimed, created_by
    into v_player
    from public.player_profiles
    where id = p_player_id;

  if not found then
    raise exception 'Player not found';
  end if;
  if v_player.account_id is not null or v_player.is_claimed is true then
    raise exception 'Player is claimed; photo editing not permitted via this function';
  end if;

  -- Validate storage path belongs to this player.
  if p_photo_path is null or p_photo_path !~ ('^players/' || p_player_id::text || '/') then
    raise exception 'Invalid photo path';
  end if;

  -- Team manager permission: manage_players on a team the player belongs to.
  select exists (
    select 1
    from public.player_team_memberships m
    join public.team_memberships tm on tm.team_id = m.team_id
    where m.player_id = p_player_id
      and tm.user_id = auth.uid()
      and tm.role in ('manager', 'owner')
  ) into v_allowed;

  -- Organizer permission: is_tournament_operator or created_by.
  if not v_allowed then
    select exists (
      select 1 from public.player_profiles pp
      where pp.id = p_player_id and pp.created_by = auth.uid()
    ) into v_allowed;
  end if;

  if not v_allowed then
    raise exception 'Not authorized to edit this player photo';
  end if;

  update public.player_profiles
    set photo_url = p_photo_url,
        photo_path = p_photo_path,
        photo_fit = p_photo_fit
    where id = p_player_id;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, reason, created_at)
    values (auth.uid(), 'unclaimed_player_photo_set', 'player_profile', p_player_id, 'photo updated', now());
end;
$$;

-- 3. Equivalent protected action for removing a photo.
create or replace function public.remove_unclaimed_player_photo(
  p_player_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player record;
  v_allowed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select id, account_id, is_claimed, created_by, photo_path
    into v_player
    from public.player_profiles
    where id = p_player_id;

  if not found then
    raise exception 'Player not found';
  end if;
  if v_player.account_id is not null or v_player.is_claimed is true then
    raise exception 'Player is claimed; photo editing not permitted via this function';
  end if;

  select exists (
    select 1
    from public.player_team_memberships m
    join public.team_memberships tm on tm.team_id = m.team_id
    where m.player_id = p_player_id
      and tm.user_id = auth.uid()
      and tm.role in ('manager', 'owner')
  ) into v_allowed;

  if not v_allowed then
    select exists (
      select 1 from public.player_profiles pp
      where pp.id = p_player_id and pp.created_by = auth.uid()
    ) into v_allowed;
  end if;

  if not v_allowed then
    raise exception 'Not authorized to edit this player photo';
  end if;

  update public.player_profiles
    set photo_url = null,
        photo_path = null,
        photo_fit = null
    where id = p_player_id;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, reason, created_at)
    values (auth.uid(), 'unclaimed_player_photo_removed', 'player_profile', p_player_id, 'photo removed', now());
end;
$$;

-- 4. Storage policies for public-media bucket, players/<player-id>/ folder.
-- (Assume bucket 'public-media' exists; adjust bucket name if different.)
-- Upload policy: only authorized managers may upload into a player's folder.
-- Note: Storage policies cannot easily check team membership via SQL without
-- helper functions; the RPC is the enforcement point. These policies provide
-- a baseline and should be reviewed against the live schema.
-- (Left as comments; enable after reviewing live storage schema.)
-- create policy "unclaimed player photo upload" on storage.objects for insert to authenticated
--   with check (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'players');
-- create policy "unclaimed player photo read" on storage.objects for select to public
--   using (bucket_id = 'public-media' and (storage.foldername(name))[1] = 'players');

-- Revoke direct execute from anon/authenticated for safety? Keep RPC callable by authenticated.
grant execute on function public.set_unclaimed_player_photo(uuid, text, text, jsonb) to authenticated;
grant execute on function public.remove_unclaimed_player_photo(uuid) to authenticated;
revoke execute on function public.set_unclaimed_player_photo(uuid, text, text, jsonb) from anon, public;
revoke execute on function public.remove_unclaimed_player_photo(uuid) from anon, public;