-- Review-only. NOT APPLIED -- NOT PUSHED. Do not run against production without
-- the owner's explicit approval. This fixes a live error the owner hit in the
-- Organizer Workspace tournament cockpit on 23 October 2026:
--
--   Tournament workspace unavailable
--   infinite recursion detected in policy for relation "roster_submissions"
--
-- Everything below was derived read-only from the local migration history. No DDL
-- was executed against the project by the assistant.
--
-- ===========================================================================
-- Root cause: an RLS policy cycle between roster_submissions and
--             roster_submission_players
-- ===========================================================================
--
-- Migration 202610210013 created on public.roster_submissions:
--
--   create policy "players read own roster submissions" ...
--     using (exists (select 1 from public.roster_submission_players rsp
--                    where rsp.submission_id = id
--                      and exists (select 1 from public.player_profiles p
--                                  where p.id = rsp.player_id
--                                    and p.account_id = auth.uid())));
--
-- A subquery inside a policy expression runs with row-level security applied to
-- the referenced table, so evaluating that policy also evaluates the policies on
-- public.roster_submission_players. Migration 202610210011 defines those as:
--
--   "participants read roster players"  -> exists (... public.roster_submissions ...)
--   "participants write roster players" -> exists (... public.roster_submissions ...)
--                                          (in both USING and WITH CHECK)
--
-- Evaluation therefore re-enters the policy set of public.roster_submissions:
--
--   roster_submissions (202610210013 policy)
--     -> roster_submission_players (202610210011 policies)
--       -> roster_submissions                <- recursion
--
-- This is the same defect class as 202610230016 (matches -> match_player_participants
-- -> matches), fixed there the same way.
--
-- ===========================================================================
-- This is the last known cycle
-- ===========================================================================
--
-- A script was run over the local migration history that (a) replays every
-- `create policy` / `drop policy if exists` in filename order to reconstruct the
-- FINAL live policy set, (b) builds a directed edge T -> U for every policy on T
-- whose USING or WITH CHECK reads table U, (c) excludes calls to SECURITY DEFINER
-- functions, which execute as their owner and do not re-apply RLS, and (d) runs
-- Tarjan strongly-connected-component detection over the result. Over 45 tables
-- and 103 live policies it found exactly one remaining cycle, the one fixed here.
--
-- The `matches` cycle that migration 202610230016 addresses is already absent
-- from that final set, because `player_plays_in_match` is recognised as a
-- SECURITY DEFINER function -- i.e. 016 breaks its cycle by construction.
--
-- No cycle is reported involving player_profiles, tournament_entries,
-- organization_memberships, team_memberships, tournaments, matches,
-- match_result_versions, match_player_participants, or any other table; their
-- policies either read only auth.uid() columns or reach other tables through
-- SECURITY DEFINER helpers (is_tournament_operator, is_team_manager,
-- is_match_participant, has_tournament_permission, claim_player_profile,
-- submit_roster, protect_entry_statuses, record_match_event, submit_match_result,
-- confirm_match_result, correct_match_result, get_player_official_statistics,
-- audit_finance_change).
--
-- Note: the defect is order-dependent rather than unconditional, because Postgres
-- ORs the policy expressions and can short-circuit on a true earlier policy. That
-- is why authenticated roster reads have sometimes succeeded and sometimes
-- aborted; the defect is latent until evaluation happens to reach the recursive
-- policy.
--
-- ===========================================================================
-- Fix
-- ===========================================================================
--
-- Move the ownership lookup into a SECURITY DEFINER helper, which runs as the
-- function owner and therefore does not apply RLS to the tables it reads, so it
-- cannot re-enter the roster_submissions policy set. The predicate, and the
-- resulting row visibility, are unchanged; only the recursion is removed. This
-- mirrors 202610230016 and the helpers the matches policies already use.
--
-- Only the roster_submissions side is rewritten. The roster_submission_players
-- policies ("participants read roster players", "participants write roster
-- players") are left untouched: they are a plain parent-row-exists check, they
-- were written first, and breaking the cycle at one point is sufficient.
--
-- The helper is scoped to auth.uid() and returns a single boolean. It exposes no
-- column of any table, and is executable by authenticated and service_role only
-- (revoked from public and anon), matching the existing helpers.

create or replace function public.player_owns_roster_submission(p_submission_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.roster_submission_players rsp
    join public.player_profiles p on p.id = rsp.player_id
    where rsp.submission_id = p_submission_id
      and p.account_id = auth.uid()
  );
$$;

revoke execute on function public.player_owns_roster_submission(uuid) from public, anon;
grant execute on function public.player_owns_roster_submission(uuid) to authenticated, service_role;

drop policy if exists "players read own roster submissions" on public.roster_submissions;
create policy "players read own roster submissions" on public.roster_submissions
  for select to authenticated
  using (public.player_owns_roster_submission(id));
