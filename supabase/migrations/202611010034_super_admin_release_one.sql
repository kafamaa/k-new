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
