-- Review-only. NOT APPLIED — NOT PUSHED. Do not run against production without
-- the owner's explicit approval. This file fixes two pre-existing defects that
-- block real data on the public player page, the homepage player card, and the
-- player workspace statistics.
--
-- Everything below was verified read-only against the live project (anonymous
-- REST/PostgREST calls only) plus the local migration history. No DDL was
-- executed against production.
--
-- ===========================================================================
-- Item 1 — get_player_official_statistics: result-type mismatch
-- ===========================================================================
--
-- Live inspection (read-only):
--   * The function exists and every call returns HTTP 400:
--       {"code":"42804",
--        "message":"structure of query does not match function result type",
--        "details":"Returned type numeric does not match expected type bigint in column 9."}
--     Reproduced for both real published players and for an empty uuid.
--   * It is callable by anon: the failure is a runtime type error, not
--     "permission denied", so the existing EXECUTE grant to anon is intact.
--   * Local migration history: 202610210008_histories_statistics.sql is the only
--     migration that ever declares this function (no later migration creates,
--     replaces, or drops it), so the live definition is that one.
--   * Its declared return shape there is:
--       team_id uuid, team_type text, tournament_id uuid, season_id uuid,
--       sport text, appearances bigint, starts bigint, minutes bigint,
--       goals bigint, assists bigint, yellow_cards bigint, red_cards bigint
--
-- Root cause (confirmed against the real column DDL):
--   * count(...)                    -> bigint, matches declared bigint   (cols 6,7)
--   * sum(match_player_participants.minutes) where minutes is integer
--                                   -> bigint, matches declared bigint   (col 8)
--   * sum(bigint) -> numeric, but the four event totals are declared bigint
--                                                       (cols 9,10,11,12)  MISMATCH
--   Postgres reports the FIRST mismatching column and names column 9, which
--   independently proves columns 1-8 already match at runtime. teams.team_type
--   and tournaments.sport are plain text (check-constrained), so cols 2 and 5
--   are correct as declared.
--
-- Fix: preserve the EXACT existing return shape and add explicit, safe ::bigint
-- casts only to the four expressions that actually resolve to numeric.
--   * The values are whole-number non-negative counts, so numeric -> bigint is
--     lossless and cannot overflow in practice.
--   * Columns 6-8 are deliberately left byte-identical to 0008 so the diff is
--     trivially reviewable and no semantics change (including that
--     sum(mp.minutes) may still return NULL when every minutes value is NULL,
--     exactly as today).
--   * The guard, CTEs, joins, filters, GROUP BY, language/volatility,
--     security-definer, search_path and the grant list are all unchanged.
--
-- Why no versioned replacement is needed: CREATE OR REPLACE FUNCTION cannot
-- change an existing function's return type anyway (it raises SQLSTATE 42P13
-- "cannot change return type of existing function"), so keeping the original
-- shape is both required for the migration to apply and the correct way to keep
-- the RPC contract stable for every existing client (src/lib/publicData.ts,
-- src/lib/playerWorkspace.ts, src/lib/statistics.ts). PostgREST serialises int8
-- and numeric identically for whole-number values, so no client update is
-- required and the wire shape is unchanged.
--
-- Dependencies (read via local history; no views depend on this function):
--   reads: player_profiles, match_result_versions, match_events,
--          match_player_participants, matches, tournaments, teams
--   calls: auth.uid()
--   grants: anon, authenticated, service_role (EXECUTE) — preserved
--   callers: src/lib/publicData.ts, src/lib/playerWorkspace.ts,
--            src/lib/statistics.ts
-- ===========================================================================

create or replace function public.get_player_official_statistics(p_player_id uuid, p_team_type text default null, p_tournament_id uuid default null, p_season_id uuid default null, p_sport text default null)
returns table(team_id uuid, team_type text, tournament_id uuid, season_id uuid, sport text, appearances bigint, starts bigint, minutes bigint, goals bigint, assists bigint, yellow_cards bigint, red_cards bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.player_profiles p where p.id = p_player_id and (p.is_published or p.account_id = auth.uid())) then raise exception 'player_not_public'; end if;
  return query
  with confirmed_matches as (select distinct match_id from public.match_result_versions where status = 'confirmed'), event_totals as (
    select ev.match_id, ev.player_id,
      count(*) filter (where ev.event_type in ('goal','point','one_point','two_point','three_point')) as goals,
      count(*) filter (where ev.event_type = 'assist') as assists,
      count(*) filter (where ev.event_type = 'yellow_card') as yellow_cards,
      count(*) filter (where ev.event_type in ('red_card','blue_card')) as red_cards
    from public.match_events ev group by ev.match_id, ev.player_id
  )
  select mp.team_id, t.team_type, m.tournament_id, tr.season_id, tr.sport,
    count(distinct mp.match_id), count(distinct mp.match_id) filter (where mp.starter), sum(mp.minutes),
    coalesce(sum(et.goals), 0)::bigint, coalesce(sum(et.assists), 0)::bigint, coalesce(sum(et.yellow_cards), 0)::bigint, coalesce(sum(et.red_cards), 0)::bigint
  from public.match_player_participants mp
  join public.matches m on m.id = mp.match_id
  join public.tournaments tr on tr.id = m.tournament_id
  join public.teams t on t.id = mp.team_id
  join confirmed_matches cm on cm.match_id = m.id
  left join event_totals et on et.match_id = m.id and et.player_id = p_player_id
  where mp.player_id = p_player_id and tr.is_published and (p_team_type is null or t.team_type = p_team_type) and (p_tournament_id is null or m.tournament_id = p_tournament_id) and (p_season_id is null or tr.season_id = p_season_id) and (p_sport is null or tr.sport = p_sport)
  group by mp.team_id, t.team_type, m.tournament_id, tr.season_id, tr.sport;
end;
$$;
-- Re-stating the existing grants is idempotent and keeps the public RPC
-- contract explicit (CREATE OR REPLACE preserves existing ACLs regardless).
grant execute on function public.get_player_official_statistics(uuid, text, uuid, uuid, text) to anon, authenticated, service_role;

-- ===========================================================================
-- Item 2 — sport_milestones: guest reads of published achievements fail
-- ===========================================================================
--
-- Live inspection (read-only): an anonymous read of sport_milestones returns
-- HTTP 401 {"code":"42501","message":"permission denied for function
-- is_tournament_operator"}. The "operators manage milestones" policy created by
-- 0008 carries no TO clause, so it applies to anon and references a helper that
-- 202610210004 revoked from anon (granted only to authenticated, service_role).
-- Migration 202610210011 fixed this exact pattern on other tables but never
-- touched sport_milestones, and 202610210012 (unapplied) only adds a separate
-- authenticated-only policy.
--
-- Fix: recreate the same policy with an explicit "to authenticated" clause so
-- it is excluded from anon's policy set, letting the untouched
-- "published milestones are public" select policy serve guest reads cleanly.
-- USING/WITH CHECK expressions, policy name, and table are unchanged; the other
-- two policies ("published milestones are public", and
-- "players read own milestones" once 0012 is applied) are not modified.
-- ===========================================================================

drop policy if exists "operators manage milestones" on public.sport_milestones;
create policy "operators manage milestones" on public.sport_milestones for all to authenticated using (tournament_id is null or public.is_tournament_operator(tournament_id)) with check (created_by = auth.uid() and (tournament_id is null or public.is_tournament_operator(tournament_id)));
