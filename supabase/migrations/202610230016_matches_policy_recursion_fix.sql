-- Review-only. NOT APPLIED -- NOT PUSHED. Do not run against production without
-- the owner's explicit approval. This fixes a live error the owner hit in the
-- Organizer Workspace on 23 October 2026:
--
--   Unable to load this workspace: infinite recursion detected in policy for
--   relation "matches"
--
-- Everything below was derived read-only from the local migration history. No DDL
-- was executed against the project by the assistant.
--
-- ===========================================================================
-- Root cause: an RLS policy cycle on public.matches
-- ===========================================================================
--
-- Migration 202610210012 created on public.matches:
--
--   create policy "players read own confirmed matches" ...
--     using (exists (select 1 from public.match_player_participants mp
--                    where mp.match_id = id and mp.player_id in (...))
--            and status = 'confirmed');
--
-- A subquery inside a policy expression runs with row-level security applied to
-- the referenced table, so evaluating that policy also evaluates the policies on
-- public.match_player_participants. Migration 202610210011 defines those as:
--
--   "participants read confirmed appearances" -> exists (... public.matches m ...)
--   "participants read confirmed appearances" -> exists (... public.match_result_versions ...)
--   "operators manage participants"           -> exists (... public.matches m ...)
--
-- and public.match_result_versions' own "operators confirm results" policy also
-- reads public.matches. Evaluation therefore re-enters the policy set of
-- public.matches, which Postgres detects and rejects:
--
--   matches (202610210012 policy)
--     -> match_player_participants (202610210011 policies)
--       -> matches                                <- recursion
--         (and one hop further, via match_result_versions -> matches)
--
-- Affected surface: any SELECT on public.matches, public.match_player_participants
-- or public.match_result_versions by a role whose policy evaluation reaches that
-- path -- which includes the Organizer Workspace overview query
-- (src/lib/organizer.ts, loadOrganizationWorkflowCounts:
--   client.from('matches').select('id,tournament_id,status').in('tournament_id', ids)).
-- The other two policies on public.matches are not implicated, because both of
-- their callees are SECURITY DEFINER and therefore do not re-apply RLS:
--   "operators manage matches"        -> public.is_tournament_operator(uuid)
--   "assigned officials read matches" -> public.is_match_participant(uuid)
-- Guest (anon) queries are unaffected: the 202610210012 policy is `to authenticated`.
--
-- The failure is order-dependent rather than unconditional, because Postgres ORs
-- the policy expressions and can short-circuit on a true earlier policy. That is
-- why some authenticated reads of matches have succeeded while others abort; the
-- defect is latent until the evaluation order happens to reach the recursive
-- policy, which is exactly what happened on the workspace overview.
--
-- ===========================================================================
-- Fix
-- ===========================================================================
--
-- Move the participation lookup into a SECURITY DEFINER helper. A definer
-- function executes as its owner and does not apply RLS to the tables it reads,
-- so the helper cannot re-enter the matches policy set. The predicate, and the
-- resulting row visibility, are unchanged; only the recursion is removed. This
-- mirrors the two helpers the other matches policies already use
-- (is_tournament_operator, is_match_participant).
--
-- Breaking the cycle at this single point fixes every path into it:
--   matches -> match_player_participants   now reads through the definer helper
--   match_player_participants -> matches   re-enters matches, whose policy no
--                                          longer re-enters that table
--   match_result_versions -> matches       same
--   match_official_assignments / offline_sync_operations -> matches  same
--
-- The helper is scoped to auth.uid() and returns a single boolean. It exposes no
-- column of any table, and is executable by authenticated and service_role only
-- (revoked from public and anon), matching the existing helpers.

create or replace function public.player_plays_in_match(p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.match_player_participants mp
    where mp.match_id = p_match_id
      and mp.player_id in (
        select p.id from public.player_profiles p where p.account_id = auth.uid()
      )
  );
$$;

revoke execute on function public.player_plays_in_match(uuid) from public, anon;
grant execute on function public.player_plays_in_match(uuid) to authenticated, service_role;

drop policy if exists "players read own confirmed matches" on public.matches;
create policy "players read own confirmed matches" on public.matches
  for select to authenticated
  using (public.player_plays_in_match(id) and status = 'confirmed');
