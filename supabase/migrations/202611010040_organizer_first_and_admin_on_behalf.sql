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
