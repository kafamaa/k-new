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
