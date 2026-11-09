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
    -- Allow deletion of any tournament without operational dependencies.
    -- (Status/published checks removed so organizers can delete unused tournaments.)
    null;
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

create or replace function public.delete_unused_player(p_id uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare player public.player_profiles;
begin
  if auth.uid() is null then raise exception 'permission_required'; end if;
  select * into player from public.player_profiles where id = p_id for update;
  if player.id is null then raise exception 'record_not_found'; end if;
  if player.created_by is distinct from auth.uid() then raise exception 'permission_required'; end if;
  if length(btrim(coalesce(p_reason, ''))) > 500 then raise exception 'reason_required'; end if;
  delete from public.player_profiles where id = p_id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
    values (auth.uid(), 'unused_player_deleted', 'player', p_id, nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;
revoke execute on function public.delete_unused_player(uuid, text) from public, anon;
grant execute on function public.delete_unused_player(uuid, text) to authenticated;

create or replace function public.delete_unused_tournament(p_id uuid, p_reason text default '')
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
  if length(btrim(coalesce(p_reason, ''))) > 500 then raise exception 'reason_required'; end if;
  delete from public.tournaments where id = p_id;
  -- This audit record survives deletion of the tournament.
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
    values (auth.uid(), 'unused_tournament_deleted', 'tournament', p_id, nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;
revoke execute on function public.delete_unused_tournament(uuid, text) from public, anon;
grant execute on function public.delete_unused_tournament(uuid, text) to authenticated;
