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
