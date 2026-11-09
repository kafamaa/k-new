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
