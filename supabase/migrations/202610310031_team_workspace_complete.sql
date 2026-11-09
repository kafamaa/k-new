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
