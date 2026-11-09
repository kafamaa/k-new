# Kulhivaru+ implementation status

Updated: 22 October 2026

This document records local implementation progress, assistant verification, and owner-tested page results. Statuses distinguish local code/tests from live Supabase verification. No journey is marked release-complete while live integration is blocked, and no page is marked accepted until the owner confirms it in a real browser.

> **Reconstruction note (2026-10-22):** An editing error overwrote this file. The owner-tested page records below (Home through Choose Workspace navigation) were recovered verbatim from the working session and are intact. The three sections **Latest verification (Stage 1 slice)**, **Verification notes**, and **Stage 9 owner checklist** could not be fully recovered and are marked for restoration. Please review those three sections against your own records.

## Current blockers

- Migration status correction (2026-10-22, read-only remote verification): `202610210012_player_workspace_access.sql` and `202610210013_player_workspace_profile_requests.sql` are **applied** remotely, so they are no longer migration blockers. The features they enable (owner-private history/match/milestone/roster reads, nationality/sports/position edit, date-of-birth storage, correction requests, team join requests, invited-person invitation metadata) have **not** been re-verified in a browser since the state changed, so they remain **unaccepted** pending the owner's test.
- Owner test-result corrections (23 October 2026, reported by the owner): an earlier part of this record was out of date on three points, now corrected here. (1) **Matches listing `#matches` — passed** by the owner; it is no longer pending. (2) **Player History `#history/:slug` — passed** by the owner; it is no longer pending. (3) **Match detail `#matches/:id` — still pending**, the only public-page check in that group not yet reported. The owner's reports are taken as authoritative; nothing was re-verified by the assistant to produce these corrections.
- **LIVE BLOCKER — RLS policy recursion on `matches` (reported by the owner, 23 October 2026):** the Organizer Workspace loads, then fails with `Unable to load this workspace: infinite recursion detected in policy for relation "matches"` (Postgres `42P17`). Root cause traced read-only through the migration history: `202610210012` created the `matches` policy **"players read own confirmed matches"** with an inline subquery on `public.match_player_participants`; a subquery inside a policy expression runs with RLS applied to the referenced table, so evaluating it evaluates that table's `202610210011` policies — **"participants read confirmed appearances"** and **"operators manage participants"**, both of which read `public.matches` directly, and the first of which also reads `public.match_result_versions`, whose **"operators confirm results"** policy reads `public.matches` again. The cycle is therefore `matches -> match_player_participants -> matches` (and, one hop on, `match_result_versions -> matches`). The failing query is the workspace overview's workflow-count read in `src/lib/organizer.ts` (`client.from('matches').select('id,tournament_id,status').in('tournament_id', ids)`), and `OrganizerWorkspace.tsx` aborts the entire workspace when that read errors. The other two `matches` policies are not implicated because their callees (`is_tournament_operator`, `is_match_participant`) are `security definer` and so do not re-apply RLS; guest queries are unaffected because the `202610210012` policy is `to authenticated`. The defect is **order-dependent** rather than unconditional, because Postgres ORs policy expressions and can short-circuit on a true earlier policy — which is why some authenticated reads of `matches` have succeeded while others abort. Fix prepared as `supabase/migrations/202610230016_matches_policy_recursion_fix.sql` (a `security definer` helper `player_plays_in_match(uuid)` plus a rewrite of the one policy to call it; identical predicate and visibility, no recursion). **The owner explicitly approved applying 016 (23 October 2026) and will run it themselves in the Supabase Dashboard SQL Editor** — the assistant applies and pushes nothing. The owner also explicitly declined an interim app-side graceful-degradation change, electing to fix the database only, so `OrganizerWorkspace.tsx` and the cockpit loader keep their current fail-fast behaviour by owner decision. No isolated Postgres reproduction was possible on this machine (Docker CLI is installed but its daemon is not running; no local Postgres), so the owner's live error is itself the reproduction, and confirmation that 016 works is the owner re-opening the Organizer Workspace after applying it.
- **Inference, pending the owner's confirmation:** reaching the Organizer Workspace at all means organization creation succeeded, which implies **migration 015 was applied and works** — the workspace only mounts once an organization exists, and that creation is exactly what 015 unblocked. If the owner confirms, 015 moves from "application pending" to "applied and owner-verified".
- **LIVE BLOCKER #2 — RLS policy recursion on `roster_submissions` (reported by the owner, 23 October 2026, after applying 016):** `Tournament workspace unavailable — infinite recursion detected in policy for relation "roster_submissions"`. Identical defect class to the `matches` cycle: `202610210013` created the `roster_submissions` policy **"players read own roster submissions"** with an inline subquery on `public.roster_submission_players`, whose own `202610210011` policies (**"participants read roster players"**, **"participants write roster players"**, in both `USING` and `WITH CHECK**) read `public.roster_submissions` back. Cycle: `roster_submissions -> roster_submission_players -> roster_submissions`. Fix prepared as `supabase/migrations/202610230017_roster_policy_recursion_fix.sql` (`security definer` helper `player_owns_roster_submission(uuid)` plus a rewrite of that one policy; identical predicate and visibility). **Prepared for review only — not applied, not pushed, approval pending.**
- **Systematic cycle detection (23 October 2026):** instead of fixing these one at a time, a script was run over the local migration history that replays every `create policy` / `drop policy if exists` in filename order to reconstruct the **final live policy set**, builds a directed edge `T -> U` for every policy on `T` whose `USING`/`WITH CHECK` reads table `U`, **excludes calls to `security definer` functions** (which execute as their owner and do not re-apply RLS), and runs Tarjan SCC detection over the result. Result: **45 tables, 103 live policies, exactly one remaining cycle** — the `roster_submissions` one fixed by 017. Two independent confirmations came out of it: the `matches` cycle is **already absent** from the final set once `player_plays_in_match` is recognised as `security definer`, so **016 breaks its cycle by construction**; and no cycle involves `player_profiles`, `tournament_entries`, membership tables, or any operations/finance/notification table. The 14 recognised `security definer` helpers are `claim_player_profile`, `is_tournament_operator`, `is_team_manager`, `protect_entry_statuses`, `submit_roster`, `is_match_participant`, `record_match_event`, `submit_match_result`, `confirm_match_result`, `correct_match_result`, `get_player_official_statistics`, `has_tournament_permission`, `audit_finance_change`, `player_plays_in_match`. The analysis is static (over local SQL); it predicts which policies *can* recurse, and both predictions so far have matched the owner's live errors, but it is not a substitute for applying a migration and re-testing. The detection script is kept at `C:\Users\hp\AppData\Local\Temp\opencode\policy-cycles.cjs`.
- Migration `202610220014_public_player_statistics_fixes.sql`: **reported applied by the owner (23 October 2026)** — the earlier "remains pending" note below this point is superseded; the assistant neither applied nor pushed it, and the owner has not stated the route by which it was applied. **Observation correction (22 October 2026, read-only):** the earlier statement that the public `get_player_official_statistics` RPC "fails for every caller" was **no longer true of the live project** even before the owner's report. A fresh anonymous probe returned **HTTP 200 with an empty array** for both real published players, and HTTP 400 only for a non-existent player id (the `player_not_public` guard, which is expected). In an isolated PostgreSQL dry run the **0008** definition raises `structure of query does not match function result type` in **all four** tested combinations (zero/one rows × `minutes integer`/`bigint`), so an empty live result cannot come from 0008's body — **the live function was no longer the 0008 version**. That observation is what prompted 014; the owner's later report that 014 is applied is consistent with it. The `sport_milestones` guest read also returns HTTP 200, but that table is **empty**, so a guest read is trivially successful and does **not** prove item 2 is applied — the milestone-policy state remains **indeterminate**. Either way there is currently **no** statistics or achievement data for either published player, so the public pages show truthful empty states, not errors.
- The **News** page has no news data source/table in the current schema.
- Live **Edge Function** runtime tests are blocked (Deno is not installed; Docker/Podman unavailable for `supabase functions serve`).
- **Email provider delivery** is not configured; notifications are queued, not delivered.
- Live **RLS acceptance tests** for several journeys remain blocked.
- **Release readiness is not claimable** while live integration is blocked.

## Migration history verification (read-only, 22 October 2026)

Read-only inspection of the remote schema. No DDL was executed, no migration was applied or pushed, and no data was changed.

| Migration | Status | Evidence |
|---|---|---|
| `202610210011_public_rls_policy_split.sql` | Applied (recorded earlier) | Its remote application was verified read-only in the public RLS policy review below; anonymous reads of `match_events` and `match_result_versions` return HTTP 200 with no helper-permission error. |
| `202610210012_player_workspace_access.sql` | **Applied** | Recorded from the read-only remote migration-history check. It is a policy-only migration (it creates no relations of its own), so there is no table to probe and its `to authenticated` policies are not anonymously observable. |
| `202610210013_player_workspace_profile_requests.sql` | **Applied — 013's tables observed in the live schema** | `player_private_details`, `player_correction_requests`, and `player_team_requests` each answered HTTP 200 on anonymous REST. `player_private_details` exposes no `id` column, matching 013's `player_id` primary key, and no other migration creates these tables. |
| `202610220014_public_player_statistics_fixes.sql` | **Pending — not applied, not pushed by the assistant.** Live RPC behaviour has nevertheless changed (see note below) | Prepared for review only; an isolated dry run validated it locally and nothing was executed against the project by the assistant. Read-only anonymous probing on 22 October found `get_player_official_statistics` now returns HTTP 200 `[]` for both published players (previously HTTP 400 / `42804`). An isolated dry run proved the 0008 body raises `structure of query does not match function result type` for zero rows and one row, with `minutes` as both `integer` and `bigint` (4/4), so the empty live result cannot come from 0008 — the live definition has changed. Item 2's milestone policy state is indeterminate: `sport_milestones` is empty, so guest reads succeed trivially and do not exercise the operator policy. |

**Scope of this check:** it establishes what exists in the remote schema and nothing more. It is **not** feature verification and **not** browser acceptance. No workspace feature has been re-tested against the applied 012/013 state, so those features remain unaccepted until the owner confirms them in a real browser. Likewise, the changed live RPC behaviour does **not** mean statistics or achievements are accepted: both published players currently have **no** statistics, team history, or milestones, so the pages render truthful empty states. Whether 014 (or an equivalent) was applied must be confirmed by the owner; the assistant applied nothing. **Follow-up (23 October 2026):** the owner was asked directly and replied **"not sure — I'll check"**, so the attribution of the changed live RPC behaviour is still open and must not be read as confirming 014 either applied or unapplied.

## Latest verification (Stage 1 slice)

[Original detailed content lost in the 2026-10-22 editing error — restore from your records. Local state at reconstruction: typecheck, lint, build, and 32 test files / 132 tests pass.]

## Verification notes

[Original detailed content lost in the 2026-10-22 editing error — restore from your records.]

## Stage 9 owner checklist

[Original detailed content lost in the 2026-10-22 editing error — restore from your records. Owner-tested page results are preserved in the list below.]

## Owner-tested page results and implementation records

- The supplied homepage reference is retained under `docs/ui-reference/` for design reference only and is not rendered as a page background. No player-card reference image was present in the source workspace.
- Onboarding verification: the signed-in browser session displays explicit Personal player, Team workspace, Organizer workspace, and Join by invitation choices. No workspace has been created yet; persistence after the owner selects a choice remains pending.
- Public pages implementation: added hash-routed published organization, tournament, team, player/history/statistics, match, collection, and news-empty-state pages using `src/lib/publicRoutes.ts`, `src/lib/publicData.ts`, and `src/components/PublicPage.tsx`. Guest writes are not added; live public RLS verification remains blocked.
- Home/Workspace separation: `#home`/`#top` renders only the public landing page; `#workspace` renders the private authorized workspace area. Signed-in events navigate to Workspace without removing the Home route; signed-out Workspace shows a sign-in gate.
- Homepage page review: `HomepageSections.tsx` now loads published organizations, tournaments, teams, players, confirmed matches, and standings through the public client. It renders Live Now, Today's Matches, Featured/Spotlight, Trending, Upcoming, Standings, Bracket, Top Players, Popular Teams, Recent Results, News, CTA, How It Works, and footer states. Signed-out browser smoke found all sections, six sports, no private fields, no write controls, no errors, and no horizontal overflow; all data sections were empty because no published records were available.
- Owner-tested page result: **Home passed**. The owner reviewed the full Home page, header navigation/account controls, language control, hero actions/search, six sports, all content sections, empty states, mobile behavior, and footer in the browser. Next page review has not started.
- Public pages/search implementation: added published search across organizations, tournaments, teams, and players plus published standings/bracket routes using `src/lib/publicData.ts` and `src/components/PublicPage.tsx`. Search and standings/bracket tests pass; live public RLS verification remains blocked.
- Player workspace implementation: the existing `player_profiles.account_id` is now loaded into authorized workspaces, direct/switcher workspace behavior is implemented, and `PlayerWorkspace` shows profile status, teams, matches, statistics, milestones, trophies/requests states, and public preview. Migration `202610210012_player_workspace_access.sql` is applied remotely (read-only verification, 2026-10-22); the browser behavior of its owner-private history reads has not been re-verified, so that feature remains unaccepted.
- Public RLS blocker: signed-out live route checks showed organizations, tournaments, teams, news, and search returning truthful empty states; players initially had an ordering typo, now fixed. Migration `202610210011_public_rls_policy_split.sql` separates helper-dependent policies from public published reads and is applied remotely; migration `202610210012_player_workspace_access.sql` is also applied (read-only verified 2026-10-22).
- Live signed-out route check: organizations, tournaments, teams, news, and search loaded with truthful empty states and no private fields. Players initially exposed a client ordering typo (`player_profiles.name`); fixed to `display_name`. Signed-out browser checks for matches, standings, and bracket now returned truthful empty states (`No published records...`, `No published standings...`, and `No published bracket matches...`) with no private fields or guest write controls.
- Workspace session handling: workspace loading now refreshes an expired JWT once, retries safely, and provides a Sign in again action if refresh fails. Public pages use a separate non-persisted Supabase client so they do not depend on an expired user session.
- Public RLS policy review: existing public match/standings policies call alongside helper-dependent policies, causing anonymous `permission denied for function is_tournament_operator`. Migration `202610210011_public_rls_policy_split.sql` separates helper-dependent policies to `authenticated` while preserving published-read policies; its remote application was verified read-only.
- Player workspace fix: loadWorkspaceSummary now queries the signed-in user's player_profiles.account_id, includes a kind: player workspace, and the workspace directory opens PlayerWorkspace with profile, teams, matches, statistics, milestones, trophies, requests, and public-preview states. Migration 202610210012_player_workspace_access.sql is applied remotely (read-only verification, 2026-10-22).
- Route verification: signed-in Workspace loaded with the authorized user and management tools while retaining a Home navigation link; after sign-out, `#workspace` showed the private sign-in gate and did not show workspace data. Home remains a separate public route.
- Tournaments listing page review: `#tournaments` now uses the published-only Supabase tournament query, with search, sport/status filters, stable tournament links, loading/error/empty states, and responsive accessible controls. Live published-record/RLS verification remains blocked.
- Owner-tested page result: **Tournaments listing passed**. Browser checks covered the route, empty/published state, search, sport/status filters, detail links, mobile layout, and view-only behavior.
- Tournament detail page review: `#tournament/:slug` now loads published tournament information, confirmed published matches, published linked teams, and clear unavailable states for categories, registration settings, scores, and standings when current public RLS does not expose them. Focused tests and checks pass; owner browser result is pending.
- Owner-tested page result: **Tournament detail passed**. Browser checks covered published information, team/match links, public-only fields, empty/not-found behavior, mobile layout, and absence of private controls.
- Organizations listing page review: `#organizations` uses published-only organization fields, stable detail links, search by public name/description, loading/error/empty states, and guest view-only rendering. Signed-out browser smoke showed no published organizations, no private fields, no workspace controls, and the truthful empty state. Owner result is pending.
- Owner-tested page result: **Organizations listing passed**. Browser checks covered published-only fields, search, empty state, detail-link behavior, mobile layout, private-field exclusion, and guest view-only behavior.
- Organization detail page review: `#organization/:slug` loads published organization name/description only via PUBLIC_ORGANIZATION_FIELDS, published tournament links, a truthful limitation message for organization-team links not exposed by current public RLS, private memberships/staff/finance/documents/contact details/workspace controls excluded, loading/error/empty/not-found states, and a direct Back to Organizations link. Focused route/field tests pass; no published organizations exist so populated behavior is unverified.
- Owner-tested page result: **Organization detail passed**. Browser checks covered not-found behavior for a missing slug, back navigation, private-field exclusion, team-link limitation messaging, and mobile layout. Populated organization detail remains unverified because no published organizations exist.
- Teams listing page review: `#teams` now has a dedicated TeamList view with published-only fields (PUBLIC_TEAM_FIELDS: id,name,slug,team_type,island,description,logo_url), search by name/description/team_type/island, team-type and island facet filters, distinct no-results vs empty states, and links to `#team/:slug`. Signed-out browser smoke showed the truthful empty state, all three filter controls, and no private team fields or workspace controls (only the site footer Contact Us link). Owner browser result is pending; populated-team behavior is unverified because no published teams are available.
- Owner-tested page result: **Teams listing passed**. Browser checks covered the route, truthful empty state, search, team-type/island filters, no-results behavior, team detail links, mobile layout, private-field exclusion, and guest view-only behavior. Populated-team behavior remains unverified because no published teams are available.
- Team detail page review: `#team/:slug` now has a dedicated TeamPublicDetail view loading published team identity (name, type, island, description, logo), public roster via published player_team_memberships rows (published players only), published tournaments, confirmed fixtures/results with resolved published opponent names, published standings rows, and published achievements (sport_milestones). Scores, team statistics, seasons, and trophies are truthfully reported unavailable under current public data policies. Private contact info, payments, notes, documents, manager controls, and workspace actions are excluded. Loading/error/empty/not-found states and a Back to Teams link are present. Signed-out smoke confirmed the not-found state, Back to Teams link, and no private fields. Owner browser result is pending; populated team detail is unverified because no published teams exist.
- Players listing page review: `#players` now has a dedicated PlayerList view with published-only fields (PUBLIC_PLAYER_FIELDS: id,display_name,slug,island,photo_url,is_claimed), search by public name/island, an island facet filter, distinct no-results vs empty states, published photo thumbnails, and links to `#player/:slug`. The same constant now backs the player detail and published-search queries. Signed-out browser smoke showed the truthful empty state, both filter controls, and no private fields (national ID, contact, documents, payments, account identifiers) or workspace controls. Owner-tested page result: **Players listing passed**. The owner confirmed the listing in the browser; populated behavior renders both real published profiles with approved public fields only.
- Player publication flow review: added an owner-controlled Publish/Unpublish profile setting to the Player workspace (`PlayerWorkspace.tsx`), backed by `setPlayerPublication` in `playerWorkspace.ts`. The update targets only `is_published` and is scoped by `.eq('account_id', userId)`, so it can only change the signed-in owner's own profile under the existing migration-0010 policy `players update own profile fields` (to authenticated, using/with check `account_id = auth.uid()`). The UI explains exactly what becomes public (display name, photo, island, published team history, confirmed appearances, verified statistics, achievements) and never public (national ID, contact details, identity documents, payments, internal notes), and requires an explicit owner confirmation checkbox before publishing. Unpublishing hides the profile from guests again. New `player-publication.test.ts` covers owner-only update scoping, zero-row failure, error surfacing, guest read policy, absence of anon update policy, and the published-only public listing query. Typecheck/lint/build and 30 test files / 87 tests pass.
- Live verification note: read-only anonymous REST inspection on 2026-10-22 showed both existing player profiles as `is_published = true` (previously reported as false), so populated guest visibility was verified live: the signed-out `#players` listing and `#player/:slug` detail render both real profiles with only approved public fields and no private leakage. The guest query for `is_published = false` rows returned 0 rows, confirming RLS hides unpublished profiles. The owner-side Publish/Unpublish action itself was not executed against production data and awaits the owner's browser test.
- Player Workspace full review (2026-10-22): rebuilt `PlayerWorkspace.tsx` into seven specification sections — Overview, My Profile, Player Card, Teams & Tournaments, Matches & Statistics, Requests & Notices, Privacy & Help — and extended `playerWorkspace.ts` with capability-detecting loaders plus pure helpers. Implemented against the existing schema/policies: profile/photo/name/island edit (owner-scoped `players update own profile fields`), overview completion %, current team, upcoming match, attention list, official-statistics totals, tournament/season/sport filters, owner-only publish/unpublish (kept), real notifications (recipient-scoped read + mark-as-read), and the privacy/documents/rating-method explanations. Defined the first documented rating formula in `src/lib/playerRating.ts` (confirmed-statistics-only, minimum-appearance threshold, clamped, with an insufficient-data state) and built the digital card in `src/components/PlayerCard.tsx` (real profile + official statistics; public-link sharing gated on publication; print/PDF download containing only public fields). Prepared migration `202610210013_player_workspace_profile_requests.sql` for nationality/sports/position columns, owner-only date-of-birth table, correction requests, team join requests, invited-person invitation metadata, and player-scoped roster reads — now recorded as **applied** in the remote schema (read-only verification 2026-10-22; its three tables were observed live). The workspace UI was built and reviewed against the pre-013 state, so these sections have **not** been re-verified in a browser and remain unaccepted until the owner tests them. Added `playerRating.test.ts` and expanded `playerWorkspace.test.ts` / `player-workspace-policy.test.ts`; typecheck, lint, build, and 31 test files / 116 tests pass. Signed-out `#workspace` still shows the sign-in gate. **Owner browser test is pending — not yet accepted.**
- Workspace navigation — Choose Workspace rule (2026-10-22): replaced the old "one workspace opens directly" behavior. After sign-in the app always lands on Choose Workspace; a workspace is never opened automatically. `App.tsx` now derives the open workspace from the route (`#workspace` = choose, `#workspace/<kind>/<id>` = a specific workspace) resolved against the authorized list, so an unauthorized or stale route falls back to Choose Workspace instead of opening. `WorkspaceDirectory` (which auto-selected `workspaces[0]`) was removed and replaced by the new `src/components/WorkspaceChooser.tsx`, which lists authorized Player/Team/Organizer workspaces and, for any missing type, only the matching onboarding choice (Create Player Profile, Create/Join Team, Create Organization). Tools are now scoped: Player opens only `PlayerWorkspace`; Organizer opens RecordCreator + TournamentCockpit + OperationsPanel; Team opens a team view that points to the Organizer workspace for record/tournament tools. A visible **Switch Workspace** control was added to the header and the workspace heading (returns to Choose Workspace without signing out). Refresh restores the current authorized route via the hash; a fresh sign-in redirects to Choose Workspace (existing `SIGNED_IN`/`wasSignedOut` logic now routed through the tested `shouldOpenChooseWorkspace` helper). Pure navigation logic (`parseWorkspaceRoute`, `workspaceRouteHash`, `resolveAuthorizedWorkspace`, `groupWorkspacesByKind`, `workspaceKindsNeedingOnboarding`, `shouldOpenChooseWorkspace`) lives in `src/lib/workspace.ts` and is covered by the new `workspace-nav.test.ts` (one workspace, multiple workspaces, no workspaces, switching, authorization denial, sign-in navigation, refresh restore). Product Specification §4 and the Development Plan wording were updated to the new rule. No RLS/schema/production change; authorization is unchanged (RLS still gates every query/action). Typecheck, lint, build, and 32 test files / 132 tests pass. Signed-out `#workspace` still shows the sign-in gate. **Owner browser test of the Choose Workspace navigation is pending — not yet accepted.**
- Page-load performance (2026-10-22): addressed the owner's "pages do not load faster" feedback with two safe, data-preserving changes. (1) Parallelized the sequential database reads that were the dominant latency: `loadPlayerWorkspace` (was ~11 one-after-another queries, now one `Promise.all` batch plus the one dependent tournament-name lookup), `loadWorkspaceSummary` (4 queries), and `getPublishedTeamPage` (tournament + opponent name lookups). Error handling and unavailable/pending list ordering are preserved, so behavior and truthful states are unchanged; only wall-clock round-trips are reduced. Homepage and search loaders were already parallel. (2) Code-split the single ~603 kB bundle so the homepage no longer downloads the workspace and public-page code up front: `WorkspacePanel` (with PlayerWorkspace, TournamentCockpit, OperationsPanel, WorkspaceChooser, RecordCreator) and `PublicPage` are now lazy chunks loaded on demand via `React.lazy`/`Suspense`. Initial homepage JS dropped to ~498 kB raw / ~141 kB gzip (under the 500 kB warning threshold); the ~86 kB workspace cluster and ~21 kB public pages load separately. Also fixed a regression introduced by the Player Workspace work: the homepage `<PlayerCard />` call site was never updated when `PlayerCard` became prop-driven, so it crashed (`profile.display_name` on undefined) and blanked the homepage. Replaced it with a real-data-only `HomepagePlayerCard` that renders the first published player and their confirmed statistics, or an honest empty state when none is published — no demo/fictional data. Verified: typecheck, lint, 32 test files / 132 tests, build green; signed-out browser smoke of homepage (hero + 6 sports + real player card, zero JS errors), lazy `#tournaments` page, and `#workspace` sign-in gate all render. Pre-existing, unrelated: the public `get_player_official_statistics` RPC returns 400 for the current data, so the card correctly shows the insufficient-data rating state. No schema/RLS/production change. **Owner browser test of the faster loading is pending — not yet accepted.**

- Player detail page review (2026-10-22): rebuilt `PlayerPublicDetail` in `src/components/PublicPage.tsx` to meet Product Specification §7.2/§7.3 for `#player/:slug`. It now shows the approved public identity (name, island, verified-claim note, photo or an initials fallback), the digital player card (reuses the tested `PlayerCard` with real profile + official-statistics totals/rating), published team affiliations as links to `#team/:slug`, confirmed official statistics (with sport/team filters that appear only when the data supports them), and achievements/trophies from `sport_milestones`. Added "View full history & statistics" (`#history/:slug`) and "Back to Players" links and a truthful private-data note. New public-data helpers in `src/lib/publicData.ts` (`getPlayerAchievements`, `currentPublicTeam`, `playerPublicSportOptions`, `playerPublicTeamOptions`, `filterPlayerPublicStatistics`, `filterPlayerPublicHistory`) and a `.player-identity`/`.detail-photo` style. Live anonymous verification against both real published players ("Ali shiyam", "setico jr") confirmed approved public fields only (no national ID, contact, documents, payments, account identifiers), initials fallback where no photo exists, and truthful loading/empty/unavailable/not-found states. Two pre-existing defects currently block real statistics and achievements for guests and are surfaced honestly (the page shows a "not publicly available yet" warning and empty states, never fabricated data): (1) the `get_player_official_statistics` RPC fails for every caller because the four event totals come back `numeric` from `sum(bigint)` while the function declares them `bigint` (columns 9-12; columns 6-8 already matched) — this is also why the homepage card showed "insufficient data"; (2) the public `sport_milestones` read errors for guests because the `operators manage milestones` policy still calls `is_tournament_operator` (revoked from anon), the same pattern migration 0011 fixed on other tables but missed for milestones. Prepared review-only, unapplied migration `202610220014_public_player_statistics_fixes.sql` that casts the RPC aggregates to their declared types and scopes the milestones operator policy to `authenticated` — it is NOT applied and needs owner approval. Added `player-public-detail.test.ts` (loader field boundaries, filter helpers, RPC cast + policy assertions); typecheck, lint, build, and 33 test files / 145 tests pass. The History page (`#history/:slug`) is now a **dedicated** page (see the entry below) and is reviewed separately. **Owner browser test of the Player detail page is pending - not yet accepted.**

- Player history & statistics page review (2026-10-22): gave `#history/:slug` its own component, `PlayerHistoryDetail`, in `src/components/PublicPage.tsx`, instead of re-rendering the player summary. It previously reused `PlayerPublicDetail`, which meant the "View full history & statistics" button linked to the page it was already on - a self-referential loop with no way back. That is fixed: the history page now links "Back to player profile" (`#player/:slug`) and "Back to Players", while the player summary keeps its "View full history & statistics" link to `#history/:slug`. The page shows the approved public identity, then three sections - verified team history (links to `#team/:slug`), official statistics (a scrollable table with team, level, sport, tournament, apps, starts, minutes, goals, assists, cards, where the tournament cell links to `#tournament/:slug` using a slug resolved in the label pass - public detail routes resolve by `slug`, so the first draft's `#tournament/:uuid` link would have hit the not-found state; caught and fixed during this review), and achievements - each with a truthful empty state. Full filter set per Product Specification line 373 (club/island/national team level, tournament, season, sport) is implemented and, matching the established pattern, renders **only** when the published data offers 2+ distinct options; because no player currently has statistics, no filter is shown rather than showing dead controls. Tournament/season labels are resolved only from rows already loaded, and an id is never displayed as a raw label if its name cannot be resolved - `seasons` has RLS enabled with no public select policy, so guests cannot read season names and the season filter stays hidden rather than leaking an internal identifier. New helpers in `src/lib/publicData.ts` (`playerPublicTeamLevelOptions`, `playerPublicTournamentIdOptions`, `playerPublicSeasonIdOptions`, `labelledFilterOptions`, `getPlayerHistoryFilterLabels` returning `PlayerHistoryFilterLabels` with tournament name+slug maps, `EMPTY_PLAYER_HISTORY_LABELS`, `filterPlayerHistoryStatistics`, `filterPlayerHistoryByTeamLevel`, `EMPTY_PLAYER_HISTORY_FILTERS`). Loading, error, empty, and not-found states verified in a real browser for both published players ("Ali shiyam", "setico jr") plus a bogus slug; no national ID, contact details, documents, payments, or account identifiers are exposed, and unpublished profiles return the not-found state. Checks: typecheck, lint, build, and 33 test files / 156 tests pass (11 new tests covering the filter helpers, label/name+slug resolution, the no-request-when-empty case, and a source-level regression test that the history route renders `PlayerHistoryDetail` with no self-referential link while the player summary keeps its forward link). Statistics and achievements remain **empty**, not broken: the live RPC now returns HTTP 200 `[]` rather than the previously recorded `42804`, and `sport_milestones` is empty so guest reads succeed without exercising the operator policy - see the corrected migration note above; the owner should confirm whether 014 was applied. **Owner browser test of the History page is pending - not yet accepted.**

- Matches listing page review (2026-10-23): rebuilt the `#matches` listing with a dedicated `MatchList` component in `src/components/PublicPage.tsx` (it previously fell through to the generic `PublicList`, which showed the raw `home_team_id` uuid as the card title, the status word as the only subtitle, no date or venue, no related links, no filters, and a single generic empty message). Each fixture now shows a resolved "Home vs Away" title (fallback "Published team", never a raw uuid), the scheduled date/time and venue, a status badge derived from the record's own status (every guest-visible row is `confirmed` because the public RLS policy `published matches are public` admits only confirmed matches in published tournaments), and links to the match detail (`#matches/:id`), the owning tournament (`#tournament/:slug`), and both teams (`#team/:slug`) - slugs only, because public detail routes resolve by slug. Filters (search, sport, tournament, team, date) render only when the loaded data supports them: search once matches exist, each select only with 2+ labelled options; the status filter is deliberately absent because the public policy admits a single visible status. Sport labels are derived from the owning tournaments (the matches table has no sport column) and date filters use a local calendar-day key so late-night fixtures never shift day. New boundary constant `PUBLIC_MATCH_FIELDS` (shared by the listing and detail loaders) is asserted to contain exactly the nine approved columns, so the loader can never request score, notes, documents, payments, or account fields; scores exist only in `match_result_versions.score`, which has **no guest read policy** (0005 as amended by 0011: authenticated participants/operators only; guest probe 2026-10-23 returns HTTP 200 `[]`), so the page states truthfully that a score counts as official only after its result is confirmed and that confirmed scores are not readable by guests - no score is ever shown or fabricated. Distinct empty ("No published matches are available yet.") and no-results ("No matches match these filters.") states, plus a label-failure warning that hides affected filters/links instead of guessing. The component is view-only: zero buttons, mutations, auth actions, or workspace controls (source-level test). New `public-matches.test.ts` (26 tests) covers the loader column boundary/filter/order, the label loader (published-only, label columns only, no request when no matches are loaded, name+slug requirement, error surfacing), option derivation, filtering/search (an internal uuid is not searchable), display helpers (status labels, pair titles, date formatting), route parsing, and component source assertions. Typecheck, lint, build, and **34 test files / 182 tests** pass. Browser-verified 2026-10-23 at `#matches` (fresh load and SPA hash transition from `#teams`): correct heading and subtitle, truthful empty state and policy note, 0 filter/card/button elements, `#matches/<unknown-id>` not-found, a 502px-wide viewport with no horizontal scroll (screenshot), console with 0 errors (only the pre-existing GoTrueClient multi-instance warning and the site-wide favicon 404, both also present on owner-passed pages), and a network log showing exactly `matches?select=id,tournament_id,...,venue,status&status=eq.confirmed&order=scheduled_at.desc` (HTTP 200) with no label requests when no rows load. **No public matches exist (guest probes 2026-10-23: `matches` 0, `match_result_versions` 0, `match_events` 0, published tournaments 0, published teams 0, standings 0), so populated card/filter behavior is NOT browser-verified - it is covered only by unit tests with isolated fixtures. No data was created or altered, no migration was applied or pushed, and RLS was not weakened. The owner's browser test of this page has not run yet - this is not an acceptance.**

- Match detail page review (2026-10-23): rebuilt `MatchPublicDetail` (`#matches/:id`) as its own full section in `src/components/PublicPage.tsx`, dispatched alongside the organization/team/tournament details instead of rendering inside the generic `PublicDetail` shell - which had displayed the heading "Published record" for every match, no teams at all, the raw ISO `scheduled_at` string, the raw status word, and a misleading "Confirmed result" paragraph above a page that shows no result. The page now shows the fixture exactly as far as public policy allows: a resolved "Home vs Away" heading (fallback "Published team", never a raw uuid), the formatted date/time, and a `.match-detail` fact sheet with home team, away team, tournament, venue, and a status badge. Teams and tournament link to `#team/:slug` and `#tournament/:slug` using slugs resolved by `getPublishedMatchLabels` (published rows only, fixture-scoped ids, name **and** slug required so no internal id can be displayed), plus a "Back to Matches" link. Scores and events are **not** shown because they are genuinely inaccessible to guests: RLS is enabled on `match_result_versions` and `match_events` (0005 lines 132-133) and every current policy on `match_result_versions`, `match_events`, `match_official_assignments`, `competition_stages`, and `tournament_categories` is scoped `to authenticated` (0011), so guest queries always return zero rows - anonymous probes on 2026-10-23 confirmed HTTP 200 with 0 rows on all five tables. Rather than fabricate a score, the page renders an "Official result and events" state block naming what is public (teams, tournament, date/time, venue, status), what is not (scores, events, assigned officials, stage/round and category names, result change history), why (current public data policies), and who can see it (signed-in match participants and organizers), followed by a private-data note. The parent keeps its loading, error, and not-found states (not-found verified in the browser for an unknown id), and the component adds label-loading and label-failure states with truthful fallbacks for venue, tournament, and teams. New `public-match-detail.test.ts` (15 tests) covers the confirmed-only detail loader and column boundary, the label loader (fixture-scoped ids, published-only, no unlabelled rows, skipped teams query when no ids exist), **migration-pinned assertions** that RLS is enabled on the score/event/official/stage/category tables and that every current policy on them is `to authenticated` - so the on-page explanation cannot drift from schema reality - and source assertions for privacy (no score/result-history/event fields, no raw ids or ISO timestamps), status/result handling, slug links, states, and view-only (no buttons, inputs, or mutations). Typecheck, lint, build, and **35 test files / 197 tests** pass. Browser-verified 2026-10-23: unknown-id not-found state with 0 buttons, 0 console errors (only the pre-existing GoTrueClient multi-instance warning), and regression checks confirming the matches listing, `#history/:slug`, and `#player/:slug` still render correctly after the `PublicDetail` dispatch change (the player summary keeps its "View full history" forward link). **There are still no public matches (0 rows), so the populated match detail page was NOT browser-tested - its rendering is covered by unit tests and code review only.** Observation (recorded, not changed - out of scope): `TournamentPublicDetail`'s match links and `BracketPage` card titles still interpolate raw `home_team_id` uuids and need the same resolved pair-title treatment when those pages are reviewed. No data was created or altered, no migration was applied or pushed, and RLS was not weakened. The owner's browser test of this page has not run yet - this is not an acceptance.**

- Organizer/Team workspace creation RLS defect (reported 2026-10-23; fix PREPARED, NOT applied): the owner hit `new row violates row-level security policy for table "organization_memberships"` on Choose Workspace -> Create -> Organizer. Root cause proven by elimination: the `organizations` insert in `records.ts` `createOrganization` succeeded - its policy `created_by = auth.uid()` passing proves a valid session whose `auth.uid()` equals the app's userId - so the only failing condition in the membership insert policy "organization creator assigns self owner" (0002) is its `exists (select 1 from organizations o where o.id = organization_id and o.created_by = auth.uid())` subquery: subqueries inside policy expressions run as the current user and are subject to the referenced table's RLS, and organizations' only SELECT policy ("published organizations are public", 0001) requires `is_published` (new rows default to false) or an already-existing membership row - the very row being inserted cannot exist yet - so a creator can never see their own new organization at creation time. The identical defect exists for Team creation ("team creator assigns self as manager" in 0002 plus "published teams are public" in 0001; `teams.is_published` also defaults to false), and Tournament creation (0003) is only downstream-blocked because it requires an organization membership first. A purely additive fix is prepared as `supabase/migrations/202610230015_organization_team_creator_read.sql` (creator-read SELECT policies on `organizations` and `teams`, scoped `to authenticated`, gated only by `created_by = auth.uid()`) - reviewed here, **not applied, not pushed, and awaiting the owner's explicit approval**. App-side alternatives were rejected as unsafe: inserting with `is_published: true` would permanently expose the workspace (organizations have no UPDATE policy to unpublish it), and a service-role Edge Function would be a larger unapproved production change. The onboarding form now maps this RLS failure for the organization/team choices to a truthful message (mirroring the existing player-choice mapping, with no bypass advice). New `workspace-creation-rls.test.ts` (9 tests) pins the defect conditions in 0001/0002/0003, the exact content and purely-additive shape of the 015 file, and the app flow order (workspace row inserted before its membership, no RETURNING on the pre-membership inserts). Checks: typecheck, lint, build, and **36 test files / 206 tests** pass. Guest probes (2026-10-23): 0 organizations, 0 teams, 0 memberships visible - consistent with no published workspaces; each failed creation attempt also leaves one unpublished organization row that no RLS-authorized role can read (only the Supabase dashboard/service role can list or clean such rows; none were touched). Creating an Organizer (or Team) workspace will keep failing until 015 or an equivalent reviewed policy is approved and applied - this item is BLOCKED on the owner's decision, not an acceptance.

- Migration 015 approval, review, and application status (2026-10-23, corrected): the owner explicitly **approved applying 015** and then asked for a pre-application review of 015, confirmation of the linked project, and dry-run results, with the explicit instruction **not to run `supabase db push`** (which can apply pending migrations to the linked project). **Correction to an earlier note in this file:** the Supabase CLI (2.118.0) *is* authenticated - `supabase projects list` returns the owner's projects - so the earlier "no access token" claim was wrong; it was based on checking filesystem token paths that do not apply on Windows. Linked project confirmed: `.temp/project-ref` and `.temp/linked-project.json` both contain ref `qmxpokmvmlqfswnjcgke` (name "app", region ap-northeast-1, status ACTIVE_HEALTHY, `linked: true`), and that ref matches `VITE_SUPABASE_URL` in `.env.local` (`https://qmxpokmvmlqfswnjcgke.supabase.co`) - CLI and app agree on one project. A second project in the same organization is named `kulhivaru-plus` (ref `iqvgycpswqbirtpklirz`) but is **INACTIVE and not linked**, so it is not what the app or CLI points at; flagged to the owner in case the naming is unexpected. Review of 015 against the full local migration history (read-only): it is purely additive - two `create policy` statements, no DDL, no table change, no `drop`; the two policy names ("creators read their organizations", "creators read their teams") appear in no other migration, so there is no name collision; and the root-cause claim is confirmed by the history itself - `organizations` and `teams` each have exactly one SELECT policy ("published organizations are public" / "published teams are public", 0001) requiring `is_published` or an existing membership row, and no later migration (0003-0014) added a creator-read path. Migration 014, now **reported applied by the owner**, only fixes the return type of `get_player_official_statistics` and creates no policies, so it neither collides with nor is superseded by 015 (015's header comment about ordering is satisfied because 014 is already applied). CLI 2.118.0 supports a documented `--dry-run` on `db push` ("Print the migrations that would be applied, but don't actually apply them"); **no `db push` variant has been run**, per the owner's instruction, pending their decision on whether to run `--dry-run` themselves or authorise the assistant to. Current status: **reviewed, linked project confirmed, dry-run not yet run, application pending**; end-to-end verification after application = the owner retrying Organizer creation in the app (expected to succeed), plus assistant-side guest probes that must still show 0 organizations/teams visible (confirming the new policies are creator-scoped and leak nothing to guests).

- Organizer Workspace layout specification (received 2026-10-23): the owner supplied a recommended layout spec for the Organizer Workspace (organization dashboard, tournament cockpit, 11-step setup, visual style, mobile, interaction rules), explicitly not a claim of completeness. It is recorded verbatim as `doc/Kulhivaru_Plus_Organizer_Workspace_Layout_Spec.md` and audited read-only against the current implementation in `docs/FEATURE_GAP_AUDIT.md`. Current reality (source-level audit; no workspace code was changed): with an organization workspace open the app renders one stacked section - RecordCreator, an in-memory 11-step tournament setup (draft id is lost on reload, so existing drafts cannot be reopened - a live defect the spec's tournament section would fix), and an OperationsPanel of raw forms (finance, exports, notifications, staff) addressed by manually typed ids. Missing versus the spec: top bar/organization switcher, left navigation, dashboard (attention panel, summary cards, tournament list, recent activity), routed cockpit tabs, standings/media/settings views, per-step validation states, confirmation dialogs for consequential actions, and the status-color system. The setup step list matches the spec's 11 steps in order. All of it remains unreachable for owner testing until migration 015 is approved and applied and a real organization exists (0 organizations/tournaments today; nothing may be seeded). No implementation was started; this entry records the spec and the baseline only.

- Organizer Workspace build (2026-10-23): implemented the organization dashboard and tournament cockpit end to end against the **existing** schema and policies — no schema change, no new table, no seeded data. Built in vertical stages: a tested data/logic layer, then the shell, then the cockpit, then the operations sections, then styles.

  **Data and logic layer** — new `src/lib/organizer.ts` (pure helpers + scoped loaders + actions) with `src/lib/organizer.test.ts` (86 tests). It provides: status vocabularies for tournaments/entries/rosters/payments/matches pinned by migration assertions to the real CHECK constraints in 0003/0004/0005; `setupProgress`/`setupStatuses` for the resumable 11 stages (out-of-range and non-integer stage numbers ignored, blocked stages stay visible); `overviewCounts`; a single-instruction `tournamentNextAction` ladder (setup resume → publish → applications → draw → result confirmation → operation → complete → archive; nothing for archived/cancelled); `tournamentAttentionItems`/`attentionItems` where **every row carries its owning tournament and target tab** so the dashboard links straight to the work; `tournamentCompletionBlockers` (blocks completion while any match is unresolved and states so); `drawEligibleTeamIds` (approved entries only); `organizerNav` permission gating against the real org roles (`owner,staff,finance,operations,media`) and staff permissions (`registration,finance,media,operations,match_data`); hash **query-parameter** sub-routing (`organizerHash`/`parseOrganizerSubroute`/`tournamentTabHash`) chosen deliberately because the shared `parseWorkspaceRoute` encodes the id from all remaining path segments — path-segment deep links would have broken authorized-workspace resolution, and query params keep it untouched; and scoped loaders/actions (`loadOrganizationTournaments`, `loadTournamentSetupSteps`, `loadTournamentEntries` with team-name join and latest roster version, `loadTournamentMatches` resolving names via a second scoped read, `loadTournamentCockpit`, `loadOrganizationWorkflowCounts` doing two bulk `in` reads instead of one query per tournament, `loadOrganizationTeamLinks`, `searchExistingTeams`/`searchExistingPlayers` with PostgREST-metacharacter sanitization, `loadLatestRosterSubmission`, `loadLatestResultVersion`, `linkTeamToOrganization`, `addOrganizerEntry`, `publishTournament`, `setTournamentStatus`, `updateTournamentBasics`, `addTournamentCategory`/`loadTournamentCategories`, `reviewRosterSubmission`, `setEntryRosterStatus`, `loadMyNotifications`, `loadMyRecentActivity`). Tests assert loaders never request national-ID, contact, document, payment-proof, score, submitter, or confirmer fields; that short/blank searches return empty **without querying**; and that a database error surfaces instead of inventing rows.

  **Shell and sections** — new `src/components/OrganizerWorkspace.tsx`: header (brand, organization selector, search, notifications with unread count, account menu, visible **Switch Workspace** that needs no logout), permission-filtered left nav (Overview, Tournaments, Teams, Players, Staff, Finance, Reports, Organization Profile, Settings) with a permission-denied state for hidden sections, and section routing. Overview shows identity, **Create Tournament** (owner/operations only), separate summary cards for tournaments/applications/rosters/payments/matches/notifications (never one merged number), the prominent **Next Action** derived from real rows, a **Needs attention** list linking each real task to its tab, and recent activity from `audit_events`. Tournaments lists real cards (name, sport, status pill, updated date, setup-progress bar, next action) and creates private drafts that **can be reopened after reload** — fixing the previously recorded live defect where the draft id was lost on refresh. Teams searches existing published/managed teams **before** creation and offers "Link to organization"; Players searches before creating unclaimed records.

  **Tournament cockpit** — new `src/components/TournamentWorkspace.tsx`, dispatched when a `tid` is present: real header (status pill, published/private-draft pill, progress), ten workflow tabs. Overview (facts + next action); **Setup** with the 11 stages as a resumable stepper that seeds each stage from its persisted row (Stage 1 writes name/sport back to the `tournaments` row so public pages read the correction; Stage 2 persists real `tournament_categories` rows; Stage 3 writes registration settings; Stage 4 adds real registration questions; Stages 5–10 persist through `saveSetupStep` behind `validateSetupStep`; Stage 11 reviews and publishes, where publishing sets `is_published` and optionally opens registration); **Applications** (approve / reject / request-changes per entry with the database enforcing who may decide); **Teams & rosters** (search-before-add, plus roster approve/lock kept separate from the application decision); **Draw & fixtures** reusing the existing `CompetitionPlanner` with the eligible-team count shown; **Matches** listing real fixtures with per-match **submit → confirm → correct** result actions wired to the tested `matchCenter` RPCs (`submitMatchResult`/`confirmMatchResult`/`correctMatchResult`), where a correction **requires** a reason and only a confirmed result updates standings; **Standings** explaining that standings derive from confirmed results only and version on recalculation; **Finance** and **Staff** scoped sections; **Settings** with confirmation dialogs for consequential status changes and a completion guard that blocks "Complete tournament" while blockers exist.

  **Operations refactor** — `OperationsPanel.tsx` rewritten to export `FinanceSection`, `ReportsSection`, `StaffSection`, `NotificationSection` (same tables, handlers, and audit behaviour as before) so each can live in its own nav section; this also removed a real cross-form bug where typing a tournament ID for a finance expense silently changed the export and staff targets. `RecordCreator` extracted verbatim to `RecordCreator.tsx` and reused by the Teams/Players sections. `WorkspacePanel.tsx` organization branch now mounts `OrganizerWorkspace` (the old stacked RecordCreator + TournamentCockpit + OperationsPanel view is superseded; `TournamentCockpit.tsx` remains on disk but is no longer imported).

  **Styles** — new `src/organizer.css` (imported first from `styles.css`) in the existing liquid-glass direction (navy ink, cyan accent, glass panels, hairline borders), with status pills that always print their own word (colour is never the only signal), mobile breakpoints at 900/600/420 px, and a newly defined `.outline-button.dark` — which was previously **missing**, meaning every existing `outline-button dark` on a light background rendered white-on-white; this also repairs that pre-existing defect.

  **Verification (local, 2026-10-23)** — typecheck clean; lint clean; build succeeds (`✓ built`, workspace cluster ~137 kB lazy chunk); **37 test files / 292 tests pass** (was 206/36 before this work). Browser smoke via chrome-devtools at 1280×860 and 390×844: homepage renders with zero console errors (hero, 12 sections, nav intact — no regression from the CSS import or the WorkspacePanel change); signed-out `#workspace` still shows the sign-in gate. Screenshots: `docs/screenshots/organizer-home-desktop.jpeg`, `organizer-home-mobile.jpeg`, `organizer-workspace-gate-desktop.jpeg`, `organizer-workspace-gate-mobile.jpeg`.

  **What is NOT yet verified — owner action required.** The signed-in Organizer dashboard and the tournament workflow could **not** be exercised by the assistant: the browser session had expired, and the assistant does not and will not sign in with the owner's account or create records on the owner's behalf. No organization exists yet, so every screenshot above is a truthful empty/signed-out state rather than a populated dashboard. Until the owner tests it, the Organizer Workspace is **implemented and locally verified, but not accepted.** Two dependencies remain: (1) migration 015 must still be run in the Dashboard SQL Editor before an organization can be created at all; (2) once an organization exists, the owner should run the tournament checklist below.

  **Owner checklist (local route `http://127.0.0.1:5173/#workspace`)** — 1) Sign in; confirm Choose Workspace appears and lists only your workspaces; Switch Workspace stays visible and does not log you out. 2) Open Organizer (create it first if 015 has been applied; expect the RLS error if it has not). 3) Overview: confirm identity, Create Tournament, zero-valued summary cards, "Nothing needs your attention", and an honest empty activity list. 4) Tournaments: create a private draft (name + sport); confirm the card shows "Private draft", 0 of 11 stages, and that **reloading the page and reopening the draft still finds it** (the previously recorded defect). 5) Setup: step through Stage 1 (name/sport persist), Stage 2 (add a category, reload, still there), Stage 3 (registration dates), Stage 11; confirm the stepper resumes at the right stage after a reload and that Stage 11 shows the publish buttons. 6) Publish and open registration; confirm the card flips to "Published"/"Registration open". 7) Teams & rosters: search before adding, add an existing team you manage; confirm a roster decision and a lock are separate actions. 8) Applications: approve/reject/request-changes an entry; confirm the counts move and the tab badge updates. 9) Draw & fixtures: confirm the eligible-team count matches approved entries. 10) Matches: submit a result, confirm it, then correct it with a required reason; confirm standings text reflects confirmed-only logic. 11) Settings: confirm "Complete tournament" is blocked with a stated reason while fixtures are unresolved, and that status changes ask for confirmation. 12) Check the mobile layout (nav collapses to the menu toggle; cards, tabs, and forms reflow).

- Tournament Overview / cockpit control centre (2026-10-23): implemented the Overview tab of the tournament cockpit per the owner's 24-section Tournament Overview layout specification. Sequencing and the identity-field decision were the owner's: build the **core control centre first** (deferring draw/staff/notices/audit summaries, which need new read loaders), and **omit the identity fields the schema does not have** rather than render empty placeholders. No schema change, no migration, no seeded data.

  **Pure logic layer (added to `src/lib/organizer.ts`)** - `tournamentLifecycle`/`lifecycleProgress` (10 stages: completed/current/upcoming/blocked, each stage marked complete only once the tournament has demonstrably moved past it); `cockpitNextAction` implementing the specification's **7-level priority ladder** (sync conflict > result awaiting confirmation > match operational issue > closing deadline > application/roster review > incomplete setup > normal task) returning **exactly one** action so the page never shows competing primaries; `cockpitAttentionItems` (3-5 items, ladder order, unique keys); `setupReadinessItems` (the 11 named setup checks) / `competitionReadinessItems` / `completionReadinessItems`; `operationalSummary` (separate counts for applications, teams, rosters, payments, fixtures, matches); `upcomingMatchesList` (next fixtures, upcoming first, with venue/date/roster warnings); `standingsPreview` **reusing the existing tested `calculateStandings`**, which already discards unconfirmed results; and `loadConfirmedResultScores`, a bulk read of confirmed `match_result_versions` that re-checks `status === 'confirmed'` client-side and **skips any score payload it cannot parse** rather than guessing. Setup progress and lifecycle progress are computed separately and never merged into one percentage.

  **Two real defects the new tests caught before any browser use** - (1) the `registration` lifecycle stage used a *negated* status list, so a tournament **cancelled during setup reported its registration stage as completed**; (2) an **archived** tournament with no entries still showed the application and roster stages as unfinished. Both fixed (positive status list; terminal statuses force past the entry stages) and pinned by named regression tests.

  **UI (`src/components/TournamentWorkspace.tsx`)** - breadcrumb with real navigation (added an optional `onOpenOrganizerSection` prop wired from `OrganizerWorkspace`, threaded `staffPermissions` so `canManageFinance` has one source); enhanced tournament header (sport, status pill, published/private, category summary, last-updated, and a primary action derived from the *same* `cockpitNextAction` the panel uses); Overview rewritten into a two-column dashboard (next action, six operational summary cards, needs attention, upcoming matches, results awaiting confirmation, standings preview, teams/roster summary | progress, readiness, lifecycle, details, completion blockers). `staffPermissions` is threaded from the parent; payments card is hidden without finance permission; payment status per team row shows "Restricted" instead of the value for unauthorized staff.

  **Section-level failure handling (specification section 21, acceptance point 13)** - the category summary and the standings scores load **separately** from the core cockpit data and each carries its own error state, degrading to an "unavailable - Retry" notice rather than closing the page. Note the relationship to an earlier owner decision: the owner previously declined app-side graceful degradation for the *workspace loader*, and that outer loader is unchanged and still fail-fast as chosen; this section-level resilience is scoped to the two new Overview reads only, because the specification requires it for this tab. If that is not wanted, it is a small, isolated change.

  **Deliberately omitted, not fabricated** - the specification asks for tournament cover image, logo, season, island/atoll, main venue, and start/end dates; `tournaments` has only `id, organization_id, name, slug, sport, status, setup_stage, is_published, created_by, created_at, updated_at`, so those are absent from the UI and recorded as a schema gap. Likewise omitted with reasons in the gap audit: organizer-entered vs team-submitted teams (`submitted_by` cannot distinguish them), waiting-list teams (no concept in schema), player eligibility (no column), awards review and disputes (no tables). Officials readiness is included only when officials are known; passing null omits the item rather than reporting a false failure. Outstanding MVR amount is not derived on the Overview because it needs finance-restricted `tournament_payments` rows.

  **Schema finding worth the owner's attention** - the specification treats Fixtures and Matches as separate data. This schema has **one** `matches` table and no separate fixtures table, so both cards read the same rows through two lenses (scheduling completeness vs competition state) rather than pretending to be independent sources.

  **Verification (local, 2026-10-23)** - typecheck clean; lint clean; build succeeds (`built`); **37 test files / 338 tests pass** (was 292; 46 new tests covering the lifecycle, the priority ladder, readiness, summary separation, upcoming ordering, standings confirmed-only filtering, and the scores loader including malformed-payload and database-error paths). Browser smoke at `http://127.0.0.1:5173/#workspace`: sign-in gate renders, no Vite overlay, **no console errors**. Dev server restarted on `127.0.0.1:5173` (a previous background instance had died, returning 502).

  **What is NOT verified - owner action required.** The Overview could not be exercised against real data: the assistant has no session and will not sign in. Migration 017 (`roster_submissions` recursion) is still **awaiting the owner's application**, so Teams & rosters is still blocked; the Overview itself reads only data the cockpit already loaded plus two independent reads, so it should render, but nothing here is accepted until the owner tests it.

- **Tournament Overview revision (2026-10-23, later the same day).** The owner issued a **revised** Overview page specification (16 numbered sections + acceptance checklist) that supersedes the earlier 24-section layout. Nothing in Phase 1-2 was disturbed; this is the same Overview tab built to the newer document, with every change implementable **without any migration** (018 remains prepared but unapplied, so nothing touches `tournaments.starts_at`/`island` yet).

  **What changed to match the revision**
  - **Section 6 cards trimmed** to the exact revised metric lists: Applications (total / pending review / approved), Teams (approved tournament entries / eligible / needing attention), Rosters (submitted / approved / locked / changes requested), Payments (pending / verified / outstanding - card still hidden without finance permission), Fixtures (total / unscheduled / missing venue), Matches (scheduled / live / awaiting confirmation / confirmed).
  - **Section 11**: upcoming matches reduced from five to **the next three**; empty state unchanged ("after fixtures are created").
  - **Section 9 (new section: Registration summary)** - a side-column block with status, opening/closing dates, team limit, applications received, approved teams, remaining places, and link status. Backed by two new section-isolated loaders `loadRegistrationSettings` (nullable row = never configured, never rendered as zeros) and `loadRegistrationTeamLimit` (sums positive category limits; null without categories). Actions: **Open/Close Registration** only for the status that allows it, reusing `setTournamentStatus` with the same confirm-then-run pattern as Settings; **Copy Registration Link** (clipboard; on clipboard denial the URL is printed instead of failing silently); Review applications / Edit registration route to their tabs. Status changes elsewhere stay in Settings for the same reason.
  - **Section 15 (new section: Notifications)** - the user's **own** notifications for this tournament (recipient-scoped by database policy), latest three, unread count for the whole tournament via a head-count query that returns **null (rendered "—") when it cannot be answered**, and delivery state from `notification_deliveries` only when a row exists - never a guessed state.
  - **Section 14 (new section: Recent activity)** - latest five audit events. **Honest scoping**: the `audit_events` SELECT policy is `actor_id = auth.uid()` and the table has no tournament column, so cross-user/team-wide activity is impossible without a schema change; the block is labelled "your own recorded actions" and a hint states it. Recorded as a gap, not faked.
  - **Sections 3 and 4 (identity header + More Actions)** - added **Preview Public Page** (only when published; links the real `#tournament/:slug` public page in a new tab), and a **More Actions** menu showing Cancel / Complete / Archive **filtered by current status and owner/operations permission**, each item routing to Tournament Settings where the controlled confirmation, completion blockers and audit already live (reused, not duplicated). Settings itself gained the **Cancel tournament** status action (`cancelled` is a real `tournaments.status` value that nothing had offered before). **Postpone is not offered** - no status or rescheduling flow exists - recorded in the gap audit rather than shown as a broken promise.
  - **Sections 6/9/14/15 each degrade independently** to an "Unavailable - Retry" block on database error, matching the revised error-handling requirement; the outer cockpit loader remains fail-fast per the owner's earlier decision, unchanged.
  - **Desktop layout** - the six summary cards now render in **one row** above the two columns (3-per-row at tablet width, 2-per-row on mobile, matching the mobile requirement); section order on mobile follows the revised list.

  **Deliberate deviations, recorded in `docs/FEATURE_GAP_AUDIT.md`** - Fixtures card does not show Draft/Published/Conflicts because fixture-stage publication is never written anywhere yet (a later phase) and no schedule-conflict detection exists; the card shows only counts that are actually computed. "View All Tasks" is omitted because the attention list is not truncated and no standalone task view exists. "View All Notifications" is omitted because no notification-inbox view exists anywhere in the app. Identity fields (season, island/atoll, start/end dates, cover, logo) remain omitted: `starts_at`/`island` need migration 018 applied first, and `ends_at`/logo/cover have no columns (Phase 3 domain).

  **Verification (local, 2026-10-23)** - typecheck clean; lint clean; build succeeds (`✓ built`); **37 test files / 349 tests pass** (was 341; new tests pin the registration loaders' nullable-vs-error semantics, the unread-count fallback to null, positive-only team-limit summation, and the recipient+tournament scoping of the notifications read). **What is NOT verified - owner action required:** all of the above needs a signed-in browser pass against real data; no migration was required or applied for this revision.

- **Tournament Setup - one-step-at-a-time (2026-10-23, second revision).** The owner issued a Setup-tab behaviour specification: only the current stage form is rendered, completed stages collapse to compact summaries with an Edit shortcut, future stages show in the stepper but cannot be opened, and saving advances automatically through stages 1-11 with "Step saved", progress update, scroll+focus on the next heading, and URL state so refresh returns to the open stage. Implemented in `SetupStage` (`src/components/TournamentWorkspace.tsx`) with no schema change.
  - **Real gaps that blocked the ladder, now fixed** - Stage 2 (Categories) and Stage 4 (Registration form) previously had **no Save action at all**, so they could never be marked complete and setup could never pass 4; each now has **Save & Continue** that persists the stage row and advances. Publishing (Stage 11) previously never completed the review stage, so a published tournament still reported "setup unfinished"; publishing now persists step 11 as complete (publication itself remains a deliberate button, exactly as specified).
  - **Automatic transition** - on successful save: "Step saved." notice, the saved stage is marked complete, progress updates, the next stage opens, the heading is scrolled into view and receives keyboard focus (`tabIndex={-1}`, skipped on initial load), and the hash is rewritten with the new stage so refresh resumes there. On failure the form stays open with every entered value preserved and the failing fields are shown **next to the exact inputs** via a new pure `validateSetupStepFields` (tested; the summary validator `validateSetupStep` remains the single gate in `saveSetupStep`).
  - **Stepper states** - Complete / Current / Needs attention / Upcoming, with locked future stages rendered disabled+dashed and a screen-reader note that they open after earlier stages. The old "Skip to next stage" button was removed: arbitrary jumping was the premature-edit path the specification forbids. Deep links to a future stage are clamped to the furthest legitimately opened stage. Editing a completed stage via Edit saves back to the furthest stage reached ("previous current step") - the one case not detectable is an edit that invalidates a later dependency, which no validator can currently know; recorded as a limitation.
  - **Deliberate deviations (recorded in the gap audit)** - the "Skipped" stepper state is not offered (no skip concept exists in the schema; inventing one would either fake data or need a status value).
  - **Verification (local, 2026-10-23)** - typecheck clean; lint clean; build succeeds; **37 test files / 353 tests pass** (4 new field-level validation tests). **What is NOT verified - owner action required:** the full save-advance ladder needs a signed-in browser pass; the Stage 2/4 completion write path is new behavior that the owner should exercise, and Reviewers should confirm publishing correctly flips setup progress on their tournament.

- **Tournament Setup rebuilt as the owner's nine-stage wizard (2026-10-23, third revision).** The owner's "simple 9-step guided process" specification supersedes the 11-step wizard entirely: Officials & Operations and Finance & Sponsors **leave the wizard** (they remain real management modules on the Staff and Finance tabs), and Stage 9 becomes **Review and launch** with the separate publish / open-registration / copy-link / keep-as-draft actions. Phase 1 of the owner's phased plan is implemented; Phases 2–5 (full stage 2–8 field depth, form preview/builder, sport-specific rules, dependency revalidation) are next.
  - **Storage compatibility, no migration required for the mapping** - the wizard renders **9 stages** but stores rows under the **legacy keys [1..8, 11]** (`SETUP_STEP_KEYS` in `src/lib/tournament.ts`): stages 1–8 keep keys 1–8, wizard stage 9 reads/writes key 11, and rows under the retired keys 9/10 are **never touched** by the wizard, so existing draft data survives byte-for-byte. Old deep links (`?step=11`) clamp to stage 9. `SETUP_STEP_COUNT` is 9; readiness lists drop the retired officials/finance checks.
  - **Progress semantics** - `setupStatuses`/`setupProgress` map stored rows onto the nine wizard positions; `deferred` (explicit Set later) and `needs_review` count as never-complete, but a **deferred stage is not the resume target** (resume continues after the conscious decision, at the next undecided stage). All pinned by tests.
  - **Stage 3 methods** - open / schedule / manual-add with method-aware validation (open requires a future closing time; scheduled requires a future opening **and** future closing with closing after opening; manual-add needs no dates; duplicates cannot occur because the settings row is a single tournament-keyed upsert). Saving settings **never** opens registration by itself. Legacy drafts without a stored method keep the old pair-ordering check, so nothing historical breaks.
  - **Stage 1** - cannot create anything (the draft already exists), so double-clicking cannot duplicate a tournament; returning to a draft edits the same draft. Stage 8 start/end dates are stored in the setup-step JSON (real, resumable) until migration 018 provides the public columns.
  - **Stage 9 review** - one truthful state per stage (Completed / Set later / Needs attention / Incomplete) with per-stage Edit, **five separate readiness indicators** (public page, registration, competition planning, roster collection, scheduling) with no fake percentage, "Registration already open" / scheduled-opening status lines, and the listed launch actions. Publish confirms inline, never publishes fixtures, and persists the review stage complete; Open Registration is gated on stages 3–5 being complete and requires confirmation; Copy Registration Link falls back to printing the URL when the clipboard is denied; Keep as Draft routes to the management dashboard.
  - **UX contract** - Save & Continue / "Saving…" (button disabled while saving, preventing double submits) / "Retry Save" after a database failure; database failures keep the form open with every entered value preserved and never advance; validation failures highlight the exact fields, focus the first invalid input, and do not open the next step; typed-but-unsaved values survive Back/Edit navigation through a session-only memory cache (never treated as saved); Back + Cancel-editing controls; scrolling and keyboard focus move to each newly opened stage heading.
  - **Deliberate omissions until schema exists (recorded in the gap audit)** - category description/active-state/reordering; registration application caps and late-application flag; structured roster policy fields (officials allowed, submission timing, changes allowed, organizer approval, lock after approval); question types beyond the stored set (date added by review-only **migration 019**; file upload needs storage wiring first). These cannot be configured honestly until 019 is applied; a hint on the affected stages says so.
  - **Verification (local, 2026-10-23)** - typecheck clean; lint clean; build succeeds (`✓ built`); **37 test files / 364 tests pass** (was 353; new tests: 9-stage mapping onto legacy keys [1..8, 11], retired key 9/10 rows never driving wizard progress, deferred/needs-review semantics, storage-key mapping tests, method-aware stage-3 validation with injectable clock, launch-stage date-order validation, readiness list of nine from stored keys). Dev server restarted at `http://127.0.0.1:5173/` (HTTP 200).
  - **What is NOT verified - owner action required** - the full nine-stage browser pass (per-stage save, advance, resume-after-refresh, retry paths, stage-9 actions) needs the owner's signed-in test; migration **019** (review-only) must be applied before "Set later"/`deferred` saves succeed against the database; no production data was touched.
- **Stage 4 — Registration Form: recheck + organizer-side rebuild (2026-10-24).** The owner asked for a recheck of the ready-made registration form specification. The recheck found the center of the feature **missing**: nothing in the app ever read `tournament_registration_questions`, the `tournament_registration_answers` table (which has real team-manager-write policies) is unused by any UI, no public application form exists, and the public tournament page shows no registration state at all. Implemented this turn, the **organizer side** of Stage 4:
  - **Ready-made standard fields** are now shown on Stage 4 with one provenance line each (teams.name, tournament_categories, teams.logo_url, teams.island, manager details from the team record) — they are not re-entered; deleting nothing. Jersey colours carry an honest "no column exists yet" note, and **Atoll is absent** because no schema column exists.
  - **Custom questions** can now be added with label, **field type** (short text, long text, number, dropdown/multiple choice → stored `select`, checkbox, and `date` after migration 019), **instructions/help text**, choice options, and Required/Optional — plus **Edit** and **Remove** per question (new loaders `loadRegistrationQuestions`, `updateRegistrationQuestion`, `deleteRegistrationQuestion`; add retries with a distinct key only on a real duplicate conflict, otherwise the raw error surfaces). "File upload" is listed but **disabled with its reason** (needs storage wiring); it is never offered as a working control.
  - **Preview Form** now exists: standard fields with their automatic provenance plus every custom question rendered as the control teams will see (text/number/dropdown/checkbox/date), instructions underneath, required marks — nothing entered in preview is submitted. A note explains the fee section: `tournament_fees` rows cannot exist yet (no app path writes them — Finance only records manual expenses), so it shows no fee until a fee flow exists.
  - **Copy Registration Link** added to Stage 4 (same clipboard-with-fallback pattern as Stage 9).
  - Review-only **migration 019 was amended before application** (it remains unapplied): `tournament_registration_questions` gains `instructions text`.
  - **Verification (local)** - typecheck clean; lint clean; build `✓ built`; **38 test files / 373 tests pass** (new `registration-form.test.ts`, 9 tests: question read scoping/order, insert shape, duplicate-retry only on unique-key conflicts, plain errors surfaced, update/delete by id with recorded payload, full type→kind mapping including unknown-type fallback to text, standard-fields honesty). **Owner browser pass still required; not accepted until then.**

- **What Stage 4 still cannot do — the public side (recorded in the gap audit)** - the spec's link-page states ("not open yet / open / closed / unavailable"), the application form teams actually fill in, and fee display from Finance all require work outside this stage: public read policies for `tournament_registration_settings` + questions, a public team-application route, and answers writes through the existing policies. The recheck report listed each; nothing was faked while those are missing.

# Implementation status — Phase 2 depth batch (Stages 2, 3, 5 + cross-cutting) — 2026-10-24

Delivered this turn (locally verified only; browser pass by owner still pending):

## Stage 2 — Categories (spec section 4)
- Real-row editing per category: name, optional description, age eligibility, gender or division eligibility, eligibility instructions, and the per-category **maximum approved teams** cap (`tournament_categories.team_limit`).
- Eligibility rule enforced at save: an age eligibility setting requires a clear cutoff date in the eligibility instructions (a date must actually be present) — "Under-18" alone is rejected.
- Duplicate category names are refused client-side; the database unique (tournament_id, name) constraint backs this up.
- Display order: up/down reordering writes `sort_order` (0..n) and reloads the list from the database after every write.
- Removal guard reads `matches` by `category_id` first: categories with recorded matches cannot be deleted (matches references categories with ON DELETE RESTRICT), and the confirm states that competition stages cascade-delete with the category.
- Single/multiple framing per spec: zero categories shows the question with the suggested single category "Open"; exactly one category says applicants will not be asked to pick one; two or more show the multi-category message and ordering controls.
- Migration 019 resilience: the extended loader selects `description`, `eligibility_instructions`, `sort_order`; if those columns do not exist yet (019 unapplied), the stage falls back to the plain loader, disables extended editing/reordering, and says so — the wizard never breaks on an unapplied migration.

## Stage 3 — Registration method (spec section 5)
- New optional **Maximum applications** field for open/scheduled registration, written to `tournament_registration_settings.max_applications` (019), separate from the per-category approved-team caps set in Stage 2.
- Existing method rules unchanged: open needs a closing date/time; scheduled needs opening and closing; manual add needs neither.

## Backend registration window (spec section 5, amended 019)
- The entries insert policy now enforces the window itself: nothing is accepted before `opens_at`, and at/after `closes_at` applications are refused even if the tournament status still says registration_open. A closed browser or inactive organizer can no longer prevent closing.
- Scheduled auto-**opening** remains an explicit organizer action (documented limitation: Postgres has no timer trigger; the alternative would silently bypass launch control). Recorded in the migration comment and the gap audit.

## Stage 5 — Roster requirements (spec section 7)
- New structured fields saving to the 019 columns: maximum team officials (`roster_officials_count`) and submission timing (`roster_submission_timing`: with application / after approval); deadline as before.
- Sport-based suggestions prefill empty limit fields (e.g. futsal 5–12 with 2 officials; 3x3 3–6 with 1). Suggestions are displayed values only — a completed or deferred stage is never re-suggested, and nothing saves without the organizer's Save & Continue.
- Still deliberately absent: approval/lock switches, required player fields/documents, identity checks — no schema or workflow exists yet; they are recorded in the gap audit rather than faked.

## Cross-cutting (spec section 2)
- **Save & Exit** on every stage (2–8): saves the typed values as honestly unfinished (`in_progress`, no validation — partial data is not promoted to complete), clears the draft cache, and opens the tournament dashboard. Resume returns to that stage with its values.
- **Readiness banner** on stages 6–8: shows real registration state (already open / scheduled for a date) and, once Steps 3–5 are complete, offers Open Registration (with the same confirmation as the launch stage) and Copy Registration Link. It never fires anything automatically.

## Verification (local only — owner browser pass pending)
- Typecheck clean; lint clean; **39 test files / 383 tests pass** (10 new in `src/lib/setup-stage-two-five.test.ts`: suggestions, category loaders/guards, exit-save semantics, and migration-019 content pins); build OK (chunk-size warning only).
- Owner must test in the browser before this batch is "passed": Stage 2 editing/reordering/removal, Stage 3 application cap, Stage 5 suggestions and save, Save & Exit on stages 2–8, readiness banner.

# Implementation status — Public registration states + Register button on the tournament page — 2026-10-24

Delivered this turn (locally verified only; browser pass by owner still pending):

## Public tournament page — Registration section (spec sections 2 and 6)

- `getPublicRegistration` (publicData.ts) reads three real, applicant-facing records for the tournament:
  - `tournament_registration_settings` (dates, method, requirements text, contact instructions, roster limits, documents flag, change rules),
  - `tournament_registration_questions` (the organizer-built form fields, public under the previously shipped "published registration questions are public" policy),
  - `tournament_categories` (names + per-category team caps).
- Pure state rule `publicRegistrationState(settings, tournamentStatus, now)` maps to exactly the spec's five visitor states: Preparing / Scheduled / Open / Closed / Disabled. Closing is time-enforced (a missed organizer status flip still shows Closed); Copy Link on the organizer side never activates anything — only the real status does.
- A missing public policy (migration 020 not applied) surfaces "Registration details are not public yet" with the real reason — never a guessed state.
- The page renders the state pill, open/close dates in Maldives time (UTC+5), category list with caps, requirements, private-document note, roster deadline, the question list, and contact instructions.
- When the state is Open, a **Register** button appears, exactly as the owner asked. Clicking it honestly states that application submission from public pages is the next phase and is not wired yet — no fake form, no fake submission. Scheduled shows "the Apply button appears automatically when registration opens".
- `formatMaldivesDateTime`/`formatMaldivesDate` render in the fixed UTC+5 zone ("Asia/Dhaka" carries the identical offset; "Asia/Maldives" is not in some ICU builds).

## Review-only migration 020 (`supabase/migrations/202610240020_public_registration_reads.sql`)

- Public SELECT policy for `tournament_registration_settings` — only where the tournament `is_published`.
- Public SELECT policy for `tournament_categories` — only where the tournament `is_published`.
- The questions policy already existed in the base schema and is deliberately untouched. A draft tournament still exposes nothing.

## Verification (local only — owner browser pass pending)

- Typecheck, lint, build clean; **40 test files / 399 tests pass** (16 new in `src/lib/public-registration.test.ts`: the full state matrix, loader shapes, unknown-state honesty, pre-019 instructions fallback, timezone rendering, and 020 content pins).
- Owner browser test: a published tournament whose registration is open (`status = registration_open`) shows the green "Registration is open" pill and the Register button on `#tournament/<slug>`; before migration 020 is applied it shows "Registration details are not public yet" - that is expected until the policy is applied.
- Still required for actual submission: sign-in from the public flow, team selection (my managed teams), category choice, answers writes, the "my application status" screen, and organizer-side review (Applications section already exists in the workspace).

# Correction — public registration state must agree with the workspace pill — 2026-10-24

Owner-reported mismatch: the workspace header showed **Registration open** for test cup 2021 while the public page said **Registration is not available yet**.

## Cause
- The workspace pill maps directly from `tournaments.status = 'registration_open'`.
- The public state rule returned **preparing** whenever the settings row was absent - and this tournament was opened for registration without a Stage 3 settings row (an older draft opened via the status flip; RLS also silently returns no row before migration 020 is applied, indistinguishable from "not configured").

## Fix (live-verified in the browser)
- `publicRegistrationState` now trusts the real status when no settings row exists: `registration_open` → **open**, otherwise preparing. Explicit settings still win where they exist (invite_only stays disabled; a passed closes_at stays closed).
- `test cup 2021` now shows the green **Registration is open** pill plus the **Register** button on the public page, matching the workspace exactly. No crashes.

## Verification
- State-matrix tests updated and green: 40 files / 399 tests; typecheck and lint clean.
- Live check: public page pill "Registration is open", Register button visible, honest apply panel text intact.

# Workspace layout cleanup + tournament Staff page rebuild — 2026-10-24

Owner request: one clean organizer chrome (no repeated workspace sections), a compact tournament
header, and a Staff page with a real staff table and a side panel invitation flow.

## What changed (locally verified; owner browser pass pending - signed-in check needs the owner's session)

### One chrome, no duplicates
- WorkspacePanel no longer renders the **Your Authorized Space** heading and **Open Workspace**
  banner above an open workspace: the organizer's own header is the only chrome there.
- The organizer header keeps the single workspace switcher (now labelled `Organizer`) and lost its
  own **Switch Workspace** button (it stays in the account menu panel and the chooser footer).
- App topbar lost its duplicate **Switch Workspace** button (Workspace link + account menu remain).
- The big public site footer is suppressed inside the workspace route; a compact **workspace
  footer** (brand, workspace name, Home/Tournaments/Switch) closes the page instead.

### Compact tournament header
- The header is now: name + sport + status pills on the left; **View Public Page** (renamed from
  Preview public page) and a **•••** More Actions menu on the right.
- Setup progress and the primary next action moved back to where they already live: the
  **Overview** tab (progress line + Go to ... action card). "Last updated" also lives on Overview.
- More Actions is an icon menu that always offers **Tournament settings**, plus the status-allowed
  lifecycle shortcuts. Non-managers get a settings-only ••• icon.
- Breadcrumb now reads Organization → Tournaments → Tournament → **current tab** (Staff, etc.),
  with the tournament name clickable back to Overview.

### Tournament Staff page (replaces the UUID form on the tournament tab)
- New `TournamentStaffPanel`: the needed table **Staff member | Role | Access | Status | Actions**.
- Invite Staff opens a **side panel**: 1) find a person (name search), 2) select role
  (Tournament Manager / Registration Officer / Match Operator / Finance Officer / Media Officer),
  3) plain-English permission summary naming the tournament ("Can review applications and rosters
  for Test Cup 2021."), 4) Send Invitation.
- Row actions: **Edit** (reopens the panel preloaded to change the role) and **Remove Access**
  (renamed from Revoke). Actions appear only for organization owners/operations (RLS
  `is_tournament_operator` is the same gate the database applies).
- `tournament id is handled automatically` - the panel only exists inside one tournament's page.

### CSS
- Sidebar 224px, `nav-item` 13px, content padding widened, organizer body text bumped to ~13.5px.
- Staff table = white card surface; mobile: rows become labelled stacked cards, the invite panel
  goes full-screen, tabs keep horizontal scrolling.

## Honest limits (never faked)
- **No email capability**: invitations are not emails. The person is added immediately and sees the
  workspace at next sign-in; the panel says so. Status column shows **Active** - the schema has no
  invited/pending state, so none is displayed.
- **People search covers published player profiles with a linked account** (`player_profiles`).
  Names resolve the same way in the staff list; a member without a public profile shows
  "No public profile" + short id, never an invented name.
- **Email search/invitation is impossible with the current schema** (emails live in auth.users and
  are never exposed; `profiles` RLS allows only each person's own row). A real user-directory
  search needs a backend decision (e.g. a security-definer RPC) - recorded as a gap, not attempted.
- The organization-level operations Staff fallback form keeps UUID inputs but is relabelled and
  points organizers to each tournament's Staff page.

## Verification
- typecheck, lint clean; 40 files / **405 tests** pass (staff suite extended: role table, list
  mapping, no-invented-names rule, search limits + injection stripping); build exit 0.
- Owner browser checklist: open `Test Cup 2021 → Staff`: table or empty state, Invite Staff panel,
  invite a published player, Edit + Remove Access; confirm the duplicated sections are gone and
  only one Switch Workspace remains (account menu), tournament header compact with •••.

# Full visual migration - "Maldives Island Sports Broadcast Glass" — 2026-10-24

Complete reskin applied on top of all existing routes, data, permissions and
workflow. No engine, loader, policy or route was changed except the two noted
below. All gates: typecheck 0, lint 0, 40 files / 405 tests pass, build exit 0,
homepage live check with zero console errors.

## Token system
- Official palette wired as CSS tokens in both stylesheets and every legacy
  hardcoded colour swept: deep ocean `#041827`, secondary navy `#082A40`,
  primary turquoise `#00CFE8` (+ `#19BDE8`), light page `#F4F8FB`, white cards,
  ink `#0B1F33`, muted `#64748B`, live red `#FF3B4D`, success `#10B981`,
  spotlight gold `#F5B72E`.
- Base typography switched to **Plus Jakarta Sans** (Space Grotesk kept for
  numerals/brand/headlines, including the small "Maldives Plays On" detail).
- Radio: 16-20px card corners, soft shadows + hover lift, faint borders.
- Motion: 180 ms transitions; hover elevation; `prefers-reduced-motion` honoured.
- Global `:focus-visible` outline (turquoise) for keyboard navigation.
- Text-capable cyan `#0891B2` / link teal `#0A9AB8` reserved where turquoise
  would fail contrast on light surfaces (eyebrows, stat numbers, table headers).

## Official branding
- New `BrandLogo`/`BrandMark` component loads **/assets/kulhivaru-mark.png**
  verbatim (never recoloured/redrawn) in the topbar, footer and auth dialog;
  `KULHIVARU+` beside it where space allows, mark alone on small screens.
- **The PNG is not yet in the repo** - until the owner drops it into
  `public/assets/kulhivaru-mark.png` the components fall back to the text
  wordmark only; no substitute logo is drawn.

## Homepage (order exactly as specified)
Header / island-glass hero (ocean gradients + subtle wave + palm SVG art,
requested headline + support line, large search, both CTAs, "Maldives Plays On")
/ Browse by Sport / Live Now / Today's Matches / Spotlight / Featured /
Trending / Upcoming / Standings / Bracket / Top Players / Popular Teams /
Recent Results / News / Organizer CTA / How It Works / Footer.
- Broadcast match cards: competition label, crest monograms or real `logo_url`,
  Maldives-time kick-off slot, venue, status pill with pulsing red LIVE dot.
- Broadcast standings: pos badge (gold for 1st), P/W/L/GD/Pts, bold points.
- Bracket panels on navy glass; player cards with photo/monogram + honest chips.
- The "Verified Player Card" promo section was removed from the homepage to
  match the required section order (component files remain untouched).

## Honest data limits (no fake data)
- Public match RLS exposes only confirmed matches, so **Live Now shows an empty
  state explaining that guests see confirmed matches until visibility widens**.
- Tournament dates/cover images/logos and player ratings/teams are not in the
  guest-viewable columns, so cards omit them rather than inventing them.
- News has no published source yet - honest empty state kept.

## Routes/navigation
- Fixed bottom mobile navigation (public routes only, hidden in workspaces):
  Home / Tournaments / Live (#matches) / Teams / Players; 48px touch targets;
  safe-area padding; body padding prevents content overlap.
- In the workspace chrome Switch Workspace remains only in the account menu.

## Workspaces
- Same token system at lower intensity: light paper background, dark glass
  organizer header, solid white cards for forms/tables, prominent gold-edged
  "Next Action" card, compact statistics - no photos behind management screens.

## Match loader change (review script re-run not needed)
- `PUBLIC_MATCH_FIELDS` gained a guest-safe embed `tournaments(id,name,slug)`
  for the competition label above broadcast match cards (the exact-string test
  was updated; the private-field exclusion test still passes).

## Verification
- Dev-server live check: hero/spotlight gradients, card tokens, fonts, section
  order, bottom nav all confirmed; homepage renders with **0 console errors**.
- Owner checklist: drop `kulhivaru-mark.png` into `public/assets/`; compare
  desktop/tablet/mobile; sign in and check organizer/team/player workspace
  shading; confirm broadcast cards populate once published records exist.

# Workspace chrome pass 2 - navbar + sidebar + staff page to reference mock — 2026-10-24

Owner provided the reference mock ("Maldives Island Sports Broadcast Glass",
workspace view). Implemented to match, keeping every honest-data rule.

## Top navbar (sticky, dark ocean glass)
- Official brand mark + KULHIVARU+ (PNG loaded verbatim, text fallback while
  `public/assets/kulhivaru-mark.png` is absent), then the `kafamaa org`
  switcher pill with an "Organizer" label beside it.
- Centered pill search ("Search tournaments, teams, players...").
- Right: notification bell with unread badge, avatar button with the account's
  name + "Organizer" caption (name comes from sign-up metadata; honest fallback
  text), account panel still holds Switch Workspace + Sign out.

## Sidebar (full-height dark icon rail)
- Ocean gradient rail (deep navy to lagoon), 236px, full height under the
  navbar, sticky; icon items Overview / Tournaments / Teams / Players / Staff /
  Finance / Reports / Settings with turquoise active state.
- New divider + "View public site" external link at the rail's foot, plus a
  subtle palm-island aura artwork drawn below it.
- Users see only their workspace's navigation (unchanged rule); mobile keeps
  the existing collapse toggle, now overlaid under the navbar.

## Content area
- Light paper background, breadcrumb above a white tournament header card:
  island-gradient logo tile (sport trophy), name, sport line, status pills,
  "View Public Page" + ••• menu on the right.
- Tabs moved onto a white card with a turquoise underline active state.
- Page heading pattern: big bold heading + subtitle + primary action on the
  right (Staff: "Tournament Staff / Manage who can access..." + Invite Staff).

## Staff page to the mock
- Stat cards row: **Active staff** (unique members) / **Role assignments**
  (rows) / **Tournament-only access** (fixed fact). The mock's "Pending
  invitation" card was NOT copied - the schema has no invited state and none is
  fabricated.
- Table: search bar + "All roles" filter; initials avatar circles (deterministic
  ocean-family tints), name + real "Added <date>", role chips colour-coded,
  green Active dot, ••• row menu with Edit access / Remove access.
- The mock's per-row emails are NOT shown: emails never exist in guest-readable
  schema; "Added <date>" is the real, obtainable detail.
- Invite drawer: "Invite Staff / Give someone access to <tournament>",
  "Name or email" search field (honest hint: name search over published
  profiles - email search is impossible until a backend decision), role select,
  **Can access** box with bullet list per role (from staff.ts role views),
  Cancel + Send Invitation. Edit access reuses the drawer preloaded.

## Honest notes
- User display name uses auth sign-up metadata; if it is missing the header
  shows "My account" (never guesses an organization-based name).
- No invitation emails exist - the drawer says so next to Send.

## Verification
- typecheck/lint clean, 40 files / 405 tests pass, build exit 0.
- Live stylesheet check in the dev browser confirmed the new rules serve
  (sticky 64px navbar + full-height sidebar CSS, avatar button, palm aura).
- Owner checklist (signed-in): compare navbar/sidebar/card layout against the
  mock; test staff search + role filter; open ••• actions; walk the invite
  drawer; check mobile collapse of sidebar + topbar search.

# Brand logo wiring completed (pending the PNG file) — 2026-10-24

The official logo was provided as an in-chat image only - no standalone file
exists anywhere on disk (checked Temp, Downloads, project). exporting chat
image bytes is not possible with the available tools and redrawing/rebuilding
the mark is forbidden, so the app is wired to load the file the moment it is
placed, with no further code changes:

- `public/assets/PUT-KULHIVARU-MARK-HERE.txt` - a 20-second instruction file
  for the owner.
- `index.html` now links `/assets/kulhivaru-mark.png` as the favicon.
- `manifest.webmanifest` updated to the official palette (deep ocean
  `#041827`, light `#F4F8FB`) with the mark as the install icon (any +
  maskable).
- `BrandLogo`/`BrandMark` already renders the PNG verbatim in the topbar,
  footer, workspace footer and auth dialog, silently falling back to the text
  wordmark while the file is absent.

Owner action: save the attached logo as `public/assets/kulhivaru-mark.png`
(512x512+, transparent background, unmodified). A thumb-version shortcut: when
the browser re-serves, everything picks it up in one reload.

# Official brand mark placed and live — 2026-10-24

Owner delivered the official logo at `img/kulhivaru-mark.png` (985x985 PNG,
414 KB). It was copied UNMODIFIED to `public/assets/kulhivaru-mark.png` (the
path every brand surface already references; the placeholder instruction file
was removed).

Live-verified in the dev browser: both brand marks (topbar + footer) render
`naturalWidth 985` and are visible; the favicon link resolves to the same file.
No code changed - this was a file drop + copy only. The auth dialog, workspace
footer and installed-app icon (manifest) all share the same asset.

Owner note: the original `img/kulhivaru-mark.png` remains untouched in the
project root `img/` folder as the source file.

# Major visual redesign pass — 2026-10-29

Owner requested a substantial, immediately visible transformation: "Maldives Island
Sport + Premium Liquid Glass + Professional Sports Broadcast". Delivered the
first large art-directed pass (typecheck/lint clean, build exit 0, 405 tests pass).

## What changed
- App.tsx hero rebuilt as a two-column cinematic composition: layered sea/horizon
  gradients, a glass broadcast panel with an inline island SVG scene, and three
  floating glass chips (Live matches / Island tournaments / Player profiles).
  Search box restyled as a glass pill with a cyan search button.
- "Browse by Sport" rail: 6 compact sport tiles with professional lucide icons
  (Goal, CircleDot, Hand, Volleyball, Dribbble, Globe2) instead of emoji, each
  with a distinct gradient + per-sport CSS class for future art swaps.
- HomepageSections: loading state replaced with a skeleton layout; "Featured
  Tournaments" converted to an editorial split (one lead card + a stacked rest
  column); TournamentCard rebuilt as a cover card with sport-keyed gradient art,
  a status ribbon (colour-coded by state), a monogram crest overlapping the
  cover, and an editorial caption. TournamentCard is now exported and reused by
  the public Tournaments listing.
- PublicPage Tournaments listing: search becomes a glass search bar with a live
  result count; sport and status filters become filter-chip rows (active state
  cyan); tournament cards reuse the new cover cards.
- styles.css redesign patch: editorial type scale, hero composition, sport rail,
  tournament editorial/cover/ribbon/crest, filter chips, public search bar,
  skeletons, empty-state polish, responsive breakpoints, reduced-motion guard.
- All previous functionality, routes, data and permissions preserved.

## Verification
- typecheck + lint clean; build exit 0; 405 tests pass.
- Live DOM check on the dev server: hero stage/scene/chips present, 6 sport
  cards with per-sport keys, 3 cover cards in 1 editorial, tournament listing
  shows 4 chips + 1 cover card + live result count, zero console errors.
- "Before" screenshots saved in docs/redesign/ (before-home-desktop-hero.jpeg,
  before-home-desktop-full.jpeg, before-home-mobile-hero.jpeg,
  before-tournaments-desktop.jpeg).

## Honest unfinished areas
- No real photography/cinematic imagery exists in the repo; the hero uses a
  CSS/SVG island scene. Drop photos into public/assets and I will wire them as
  cover art (no code change needed for the mark; photos need placement).
- Skeletons only on the homepage loading state; other public pages still show
  "Loading page…". MatchList filters are selects (restyled), not chips, and no
  mobile bottom-sheet filter yet. Searchable selectors, contextual menus beyond
  the staff rows, and toast polish are not done.
- Desktop-width (1440px) verification is not possible in this tooling (review
  pane is 800px); responsive rules are standard but the owner should confirm
  desktop shading/layout.
- "After" screenshots could not be captured: the browser screenshot tool
  requires a visible desktop window, which this environment does not expose. The
  before shots are on disk; after-state is verified via DOM/console checks.

## Owner batch 2026-10-29 — Team workspace + Official/Staff workspace + public application submission

### What shipped (local, review-only, no production data touched)

- **Team workspace (new TeamWorkspace.tsx + 	eamWorkspace.ts)** — replaces the note stub. Tabs: Overview, Team Profile, Players, Applications & Rosters, Fixtures & Results, Requests & Notices. Loads team identity, active/past player memberships, tournament entries, fixtures, confirmed result versions, join requests, documents and notifications through existing RLS. Profile editing uses review-only migration 021. Membership ending, application submit/resubmit/withdraw, roster submission via submit_roster RPC, join-request approval (records an active membership) all wired.
- **Official/Staff workspace (new OfficialWorkspace.tsx + officialWorkspace.ts)** — Assigned Tournaments, Assigned Matches, Match Center (offline-tolerant event queue with idempotency keys, conflict detection, replay, submit/confirm/correct result), Availability, Notifications & Help. Reads only the caller's own assignments.
- **Public application submission (new PublicApplicationForm.tsx + 
egistration.ts)** — signed-in team managers can apply from the published tournament page: managed-team selector, questions rendered from the canonical 
egistrationFormFields model, duplicate detection against the UNIQUE (tournament, team) constraint, draft resubmission, and an honest "already applied" state. Organizer review path already existed.
- **Workspace chooser** now shows an Official/Staff panel only when assignments exist; never self-created.
- **Public name resolution fixes**: PublicList match cards, BracketPage (labels loader), and TournamentPublicDetail match links now resolve team names instead of raw UUIDs.
- **Review-only migration 021** (202610240021_team_official_workspace_access.sql): officials read own match assignments; staff read own tournament-staff assignments; team managers update their team; team managers end player memberships; team managers may withdraw their own application (trigger amended, guards preserved); officials own their availability (new official_availability table). All statements are 	o authenticated; nothing touches anon; nothing drops an existing policy except the trigger recreation whose predicate list only grows.
- Tests: +4 files / +26 tests (teamWorkspace, officialWorkspace, registration, team-official-rls). Total 44 files / 430 tests. Typecheck clean, lint clean, build succeeds.

### Still blocked / honest remainder

- Migrations 014, 015, 016, 017, 018, 019, 020 and the new 021 are review-only and await the owner's explicit application in the Supabase SQL Editor. Until 021 is applied, team profile editing, membership ending, withdrawal, official workspace assignment reads and availability storage stay database-denied and the UI shows the prepared-policy message.
- Team workspace roster building lists only player profiles readable under RLS (published or self-owned); unclaimed players stay private and are labelled "Private player record".
- Official availability is stored only for the caller; no organizer-facing availability view exists yet.
- No email provider is configured; email notifications remain queued.
- Dhivehi/RTL remains structural readiness only.
- Live RLS/Auth/Storage/Edge Function acceptance tests remain blocked (no writes to production by the assistant).

### Test counts
- 44 test files, 430 tests passed.
- Typecheck: clean. Lint: clean. Build: success (vite build exit 0).

## Migration reconciliation — 2026-10-29 (read-only)

- Linked project reference: qmxpokmvmlqfswnjcgke (app).
- Supabase CLI 2.118.0.
- supabase migration list: remote contains 202610210001 through 202610230018 inclusive. Local adds 202610230019, 202610240020, 202610240021.
- supabase db push --dry-run: would push exactly the three pending migrations above. No other migration is pending.
- Correction: earlier reports describing 014–018 as unapplied were stale. 014–018 are already recorded remotely and must not be re-run or pasted into SQL Editor.
- Pending migrations (owner-authorized only): 019, 020, 021.
- No migration repair, no apply, no reset, no seed, no data mutation was performed by the assistant.

## Batch update — 2026-10-29 (registration return flow + news/media + i18n + PWA + performance + security audit)

### Migration reconciliation (read-only)
- Linked project: qmxpokmvmlqfswnjcgke.
- Remote contains 0001–0018. Pending (owner-authorized only): 019, 020, 021, 022.
- supabase db push --dry-run would push exactly those four. No migration repair, no apply, no reset performed.

### What shipped (local)
- Registration return flow: src/lib/returnDestination.ts (safe internal destinations only), #register/<slug> route, PublicApplicationForm session-expiry handling with one refresh attempt + "Sign in again", App.tsx auth return-to-registration, tournament button state gating via 
egistrationButtonState.
- News/media model: migration 022 + src/lib/news.ts + PublicPage NewsList/NewsDetail rendering published rows only.
- i18n: src/lib/i18n.ts (English complete, Dhivehi partial with coverage report), persisted preference, RTL dir, language switcher in header.
- PWA: manifest updated (name, icons, theme/background, standalone, portrait).
- Performance: manualChunks split (react, supabase); main bundle 513 kB → 276 kB.
- Security audit: docs/SECURITY_AUDIT.md.
- Tests: +2 files (returnDestination, plus i18n not yet tested). Total 45 files / 435 tests. Typecheck/lint/build clean.

### Browser verification
- Dev server started on port 5174; the in-sandbox browser could not reach localhost (502 Bad Gateway), so signed-out smoke testing via the browser tool is recorded as a tooling limitation, not a pass. Owner must run the checklist locally.

### Test counts
- 45 test files, 435 tests passed.
- Typecheck: clean. Lint: clean. Build: success.

## Batch update — 2026-10-30 (Stage 1 tournament branding upload)

### Migration reconciliation
- Pending migrations now: 019, 020, 021, 022, 023 (owner-authorized only).

### What shipped (local)
- Migration 023 (review-only): adds logo_path and cover_path to 	ournaments; creates private 	ournament-media bucket; storage policies for authorized organization operators (write) and published-tournament public read; SECURITY DEFINER helper 	ournament_media_write_allowed with safe search_path.
- src/lib/tournamentBranding.ts: validation (type/size), safe generated object paths, upload, replace, remove helpers. No original filename trusted.
- TournamentWorkspace Stage 1: branding upload panel (logo + cover file inputs, validation, error display, saved-path display). Uploads happen during Save & Continue/Save & Exit, after the draft exists, with per-file failure handling that keeps the draft and does not advance.
- OrganizerTournament type extended with logo_path/cover_path.
- updateTournamentBasics extended to accept branding paths.
- Tests: +1 file (tournamentBranding, 3 tests). Total 46 files / 438 tests. Typecheck/lint/build clean.

### Still pending / honest remainder
- Drag-and-drop, progress bars, retry buttons, and remove-with-confirmation polish are not yet implemented (basic file input + validation + save-time upload is in place).
- Public pages do not yet render the uploaded logo/cover (paths are stored; public URL generation and display wiring is pending).
- Storage signed-URL download flow for private documents remains pending.

## Batch update — 2026-10-30 (app-wide file upload system)

### Migration reconciliation
- Pending migrations now: 019, 020, 021, 022, 023, 024 (owner-authorized only).

### What shipped (local)
- Reusable upload components: src/components/uploads/ImageUploader.tsx and DocumentUploader.tsx (drag-drop, preview, validation, progress, replace/remove/retry, accessible).
- Migration 024 (review-only): additive path columns (vatar_path, photo_path, logo_path, cover_path) on profiles/player_profiles/teams/organizations/news_articles; private public-media bucket with owner-scoped write policies and public read.
- src/lib/tournamentBranding.ts extended pattern reused; validation + safe generated paths.
- Audit inventory: URL-based asset fields identified across Account (avatar_url), Player (photo_url), Team (logo_url), Organization (none yet), Tournament (logo_path/cover_path now), News (cover_image_url). Intentional external links (video, website, social, map) remain URL fields.
- Tests: components not yet unit-tested (JSX); lib helpers covered. Total 46 files / 438 tests. Typecheck/lint/build clean.

### Still pending / honest remainder
- Converting every URL input in TeamWorkspace profile, Account settings, Player workspace, Organization workspace, News authoring to the new upload components (components are ready; wiring per page pending).
- Drag-drop/progress/retry polish for Stage 1 branding.
- Public rendering of uploaded logo/cover.
- Storage signed-URL download flow for private documents.
- Legacy URL values preserved (not auto-migrated).

## Batch update — 2026-10-30 (tournament branding display fix)

### Root cause
- No UI rendered tournament branding. The only display helper (`brandingPublicUrl`) used `getPublicUrl()` on the private `tournament-media` bucket (HTTP 400) and was never called; Stage 1 showed the saved path as text.
- The applied 023 guest read policy is broken: inside its `tournaments` subquery the unqualified `name` resolved to `tournaments.name`, and missing parentheses let `or` escape the published check. Live definition: `((t.is_published AND t.logo_path = t.name) OR t.cover_path = t.name)`. Guests can never sign a URL (verified: anonymous `createSignedUrl` returns "Object not found").
- Saved data is correct: the one branded tournament stores bare object paths matching the upload format, and both objects exist.

### What shipped (local)
- `src/lib/tournamentBranding.ts`: signed-URL resolver (1 h TTL, per-client in-memory cache, re-signs near expiry, null on missing/invalid path or signing failure), `publicTournamentBranding` guard (published and not draft), object-path validator. `getPublicUrl` helper removed.
- `src/components/TournamentBranding.tsx`: `TournamentLogo` (contain) and `TournamentCover` (cover) with loading/ready/error states and a fixed-size branded fallback.
- Organizer: list loader now selects branding (with the missing-column fallback); cards show cover strip and logo; workspace header shows cover banner and logo; Stage 1 shows saved-image previews.
- Public: all tournament loaders select `is_published,logo_path,cover_path`; homepage featured/upcoming/trending cards, spotlight, listing cards, detail hero and registration route render branding through the public client.
- Migration `20261030071738_fix_tournament_branding_reads.sql` (review-only, **not applied**): replaces the broken guest read policy with a SECURITY DEFINER helper (org members: any branding; guests: current logo/cover of published, non-draft tournaments only). Bucket stays private.
- Tests: +1 file (23 tests). Total 47 files / 465 tests. Typecheck/lint/build clean.

### Applied and verified (2026-10-30, owner-approved)
- Applied to production: `202610300025_history_engine.sql` and `20261030071738_fix_tournament_branding_reads.sql` (each in its own transaction, then recorded with `supabase migration repair`). `202610300026_identity_guardian_import.sql` was NOT applied (not approved). The "NOT APPLIED" header in the branding file is now historical.
- Guest verification against the published tournament `test-cup-1-c41dc5f6`: anonymous signing of logo and cover succeeds (HTTP 200 image/png); a non-current path in the same tournament is refused.
- Signed-out headless Chrome (fresh profile): homepage spotlight + featured/upcoming/trending cards, `#tournaments`, `#tournament/:slug`, `#register/:slug` all load branding via `/object/sign/tournament-media/` URLs; no horizontal overflow at 375 px or 1280 px.
- Not verified on live data: draft branding hidden from guests (no draft tournament has branding; covered by the policy definition and unit tests). Organizer views not browser-verified (needs a signed-in session).
- Save & Exit on Stage 1 now uploads selected branding files (shared `saveBrandingFiles`, branding-only `updateTournamentBranding`).

### Security finding: self-join RLS policies (pre-existing)
- 13 live policies compare a column with itself (`om.organization_id = om.organization_id`, etc.), so they cross organization/team boundaries: tournaments (cross-org read of drafts, cross-org create/update), finance receipts/expenses, news, organization team links, player team memberships, match appearances.
- Review-only fix prepared, **not applied**: `20261030074639_fix_self_join_rls_policies.sql` (policy-only; same names/roles/conditions, outer columns qualified). Tests: `src/lib/self-join-rls-repair.test.ts`.

## Batch update — 2026-10-30 (core bug fixes, history engine, competition completion, identity/guardian, import, news, invitations, offline)

Work done by Claude Code in the same working folder while another tool was making the branding changes recorded above. Edits to shared files (`TournamentWorkspace.tsx`, `OrganizerWorkspace.tsx`, `organizer.ts`) were exact-match insertions that preserved the CRLF line endings; nothing from the branding work was reverted. Not browser-verified; no live data was created or changed by this batch.

### Core bug fixes
- **Player claims could never succeed.** `invite-player` stored the token digest as base64url text, while `claim-player` looked it up as raw HMAC bytes (`\x<hex>`) in the `bytea` column. Both now use the hex bytea form. Any invitation created before this fix cannot match and must be re-issued. Takes effect only once `invite-player` is redeployed.
- **Public team applications always showed "Session expired".** `PublicApplicationForm` used `publicSupabase`, which never persists a session. It now uses the signed-in client.
- **"Publish and open registration" reverted to setup.** `saveSetupStep` unconditionally wrote `status: 'setup'`, and `publish()` calls it right after opening registration. A setup save now moves only a `draft` to `setup` and never downgrades a later status.
- **Organizer unread badge was always 0.** It counted `state === 'unread'`, which the 0009 CHECK constraint does not allow; it now counts every state other than `read`.
- **Saved tournament logo/cover were not loaded.** Added `loadOrganizerTournament` with branding columns and a missing-column fallback; the branding batch above built on it.
- **"Join by invitation" called a missing function.** Added `supabase/functions/accept-workspace-invitation` (verified email; one use, enforced by a conditional `accepted_at` update; grants team manager/staff or organization staff/finance/operations/media, never owner; audited). Added `supabase/functions/invite-workspace-member` to create those invitations (team managers and organization owners only; 7-day expiry; token returned once, only the digest stored).

### Migration 025 — `202610300025_history_engine.sql` (applied to production per the entry above)
- `confirm_match_result` and `correct_match_result` now rebuild the stage's `standings_snapshots` (`recalculate_stage_standings`; latest confirmed version per match; points from `stage.rules` with 3/1/0 defaults; shootout fields ignored) and the affected automatic milestones (`recalculate_match_milestones`: first appearance; 10/25/50/100 appearances; first goal or first points; team first match and first win). Manual milestones are never touched. Both recalculation functions are service-role only.
- Lineups: `record_match_participants` and `get_match_lineup_candidates` (latest approved/locked roster of each team). Before this nothing wrote `match_player_participants`, so appearances and player statistics could never be non-zero.
- **Security:** `record_match_event` and `submit_match_result` now require an assigned official (`is_match_official`) or a tournament operator. Previously any member of either team could write match data. The direct-write policies "officials submit results" (`match_result_versions`, which allowed inserting a version with any status, including `confirmed`) and "assigned officials manage events" (`match_events`, for all commands) were dropped; participants keep read access. The `offline_sync_operations` write policy is limited the same way.
- Confirming one submitted version now rejects other pending submissions for the match; a correction also rejects pending submitted versions.
- `seasons` had RLS enabled with no policies: added a public read policy and creation for organization owners/operations.
- `standings_snapshots.group_id` (added to the file at about 12:30) so group stages show per-group tables. **To confirm:** the live definition of `recalculate_stage_standings` includes `group_id`. If 025 was applied from an earlier copy of the file, re-run that part.

### Migration 026 — `202610300026_identity_guardian_import.sql` (NOT applied, not approved)
- `player_profiles.is_minor`, a `guardian_approvals` table (append-only, revocable), and helpers `can_manage_minor_record` / `has_guardian_approval`.
- A trigger blocks publishing a minor's profile without a public-profile approval and stops anyone except the record creator from changing `is_minor`.
- `claim_player_profile` additionally raises `guardian_approval_required` for a minor without a claim approval, and links an existing identity key to the claiming account.
- New policy "record creators set minor flag": the creator of an unclaimed record may update it. Note that this policy also lets them edit the record's other columns.
- `player_identity_status(player_id)` returns registered / not registered without exposing the key.
- Audit policy "importers append import audit" (`csv_import` rows only).

### New Edge Function — `register-identity` (not deployed)
- Normalizes a Maldivian ID (`A` + 6 digits) or a foreign document (type + 2-letter country + number), HMACs it with the new secret `IDENTITY_HMAC_SECRET`, and stores only the digest in `player_identity_keys`.
- If the identity already belongs to another record or account, the response says to sign in / recover or to ask for that record's claim invitation, without revealing whose it is. The readable number is never stored, logged, or returned.

### App changes
- **Competition completion:** `src/lib/advancement.ts` plus **Generate next round** on the Draw tab. Knockout winners are decided by regulation score, then shootout; a level score without a shootout blocks advancement. Groups → knockout crosses each group winner with the neighbouring group's runner-up. Each round is a new `competition_stages` row with its own fixture version and audit event.
- **Bye bug:** `knockoutFixtures` drops a team paired with an empty slot in an odd-sized field (5 teams → one team never plays). Byes are now recorded in `stage.rules.byes` at draw time and carried into the next round.
- **Standings tab:** reads the database snapshots per stage/group. **Awards** (Settings tab): stored as `sport_milestones` with `is_manual = true` and `award_*` types. Completion is blocked until a champion is recorded.
- **Matches:** a lineup editor and optional shootout scores on the organizer Matches tab and in the official Match Center.
- **Official Match Center:** events now carry team and player; the base result version is recorded when an event is queued; replay detects conflicts against the current version; conflicts wait for **Keep and resend** or **Discard**; permanent database refusals become `rejected` instead of retrying forever.
- **Draw planner:** approved teams chosen by name and an existing category reused (previously comma-separated UUIDs and a new category for every draw).
- **Identity & guardian panels:** the player's Privacy tab, and an "Identity & guardian" action on unclaimed records in the organizer Players section.
- **Private documents:** `src/lib/documents.ts` adds 60-second signed links (Team workspace, organizer Teams & rosters). This closes SECURITY_AUDIT follow-up 1.
- **CSV import** for teams and players: preview, likely-duplicate detection against readable records and within the file, explicit row selection and confirmation, audit provenance. Imported teams are linked to the organization, and the importer becomes their manager until a real manager claims them.
- **News section** in the organizer navigation (owner/operations/media or media staff): drafts, publish, unpublish, archive. **Depends on** `20261030074639_fix_self_join_rls_policies.sql`, because the live "media roles manage organization news" policy has the self-join defect recorded above.
- **Invitations:** an Invite panel in the Team Profile tab (managers) and the organizer Staff section (owners). Tokens are shown once; email delivery is still not configured.
- **Staff permissions:** the organizer navigation now loads the account's real `tournament_staff_assignments` for the organization (previously always empty).
- **Dhivehi:** the main and bottom navigation now render through `translate()`. Only existing reviewed Dhivehi labels are shown; all other keys fall back to English, and no translations were invented.
- **Offline:** `public/sw.js` caches the app shell and hashed assets, same-origin only (Supabase is never cached), registered in production builds. The Official workspace and lineups fall back to this account's last loaded data when offline. `src/lib/offlineCache.ts` clears that cache on sign-out.
- **Cleanups:** debug `console.log` calls removed from `returnDestination.ts`; the sign-in/sign-up notices no longer mention registration without a return destination; the header "Live" link now goes to `#matches`; unused `TournamentCockpit.tsx` and `MatchCenter.tsx` deleted; new `src/features.css` for the new panels.

### Verification (local only)
- Typecheck, lint, and build clean.
- Tests: new `src/lib/competition-history.test.ts`, plus additions to `edge-functions.test.ts` (shared digest form, acceptance contract), `setup-stage-two-five.test.ts` (no status downgrade) and `organizer.test.ts` (News navigation). At the time of this batch, 48 files / 492 tests passed. The suite total may differ once the self-join repair tests are counted.
- Not done: browser testing of any of these screens, deployment or runtime testing of the five Edge Functions, application of 026.

### Owner actions to enable
1. Confirm the live `recalculate_stage_standings` includes `group_id` (see the 025 note above).
2. Review and apply `202610300026_identity_guardian_import.sql`, and the self-join repair, which News needs.
3. Deploy `invite-player`, `claim-player`, `accept-workspace-invitation`, `invite-workspace-member`, and `register-identity`. Set the secret `IDENTITY_HMAC_SECRET` alongside the existing `SUPABASE_SERVICE_ROLE_KEY` and `CLAIM_TOKEN_HMAC_SECRET`.
4. Re-issue any player claim invitations created before the digest fix.
5. Browser checks: a 5-team knockout through to the final; lineup → confirm → standings and milestones; invite → join; identity check; a minor claim blocked until guardian approval.

### Still not covered
- Importing historical match records (teams and players only).
- Email delivery of invitation tokens.
- Dhivehi translations beyond the navigation labels.

# Player Workspace — all twelve sections completed to the spec — 2026-10-31

Review-only migration `supabase/migrations/202610300030_player_workspace_complete.sql` (not applied; the owner applies it). Without it every section still loads and shows a clear "needs migration 030" note where a feature depends on it.

- **Migration 030:** `get_player_workspace_matches` (owner-only feed of the player's team fixtures and results; scores and personal numbers from the latest confirmed result only); typed correction requests with `team_id`, the statuses `changes_requested` and `cancelled`, reviewers for every type (organizers, team managers, platform admins), `cancel_player_request` / `resubmit_correction_request`, and an insert trigger that forces new requests to `pending`; `notification_preferences`; `player_private_details.hidden_bio`.
- **Header:** shown on every section except My Profile, which has its own hero. It carries the photo, claim and public/private status, current team, sport and position, profile completion and Preview public profile.
- **Overview:** one next action (invitation → document → returned request → profile → next match), six summary cards (a horizontal rail on phones), and Next match, Profile completion, Current team, Attention required, Recent performance (W/D/L) and Latest three notifications.
- **My Profile:** adds a Private details card (email, phone, date of birth, claim status); the biography locks while it is hidden.
- **Player Card:** team logo and nationality on the card; side panels explain that only approved records are used.
- **Teams:** invitation cards; current teams (level, sport, position, jersey, since date, team page link); team history timeline (dates, matches, goals, assists, honours per team); join requests and claim invitations.
- **Tournaments:** cards with cover and logo, team represented, shirt number, spec roster status (Invited / Pending roster approval / Approved / Changes requested / Rejected / Active / Completed), organizer note, and Fixtures, Standings and Bracket links. The public tournament page now opens `?tab=results|standings|bracket|teams`.
- **Matches:** Upcoming / Live / Completed / Postponed-cancelled. Each match card shows Maldives time, both crests, the player's team and an official score, plus started/substitute, minutes, goals, assists and cards for confirmed matches only.
- **Statistics:** filters (sport, season, tournament, team, team level, date range); totals including starts, minutes and per-90; the rating, or "Insufficient data"; breakdowns by team level, team, tournament, season and sport.
- **Achievements:** counters, next-milestone progress bars, and trophies showing the season and their public/hidden state.
- **Requests:** one list of invitations, join requests and corrections (sent date, who handles it, status, response, next action); cancel, withdraw, or update-and-resend; nine request types routed to the right reviewer; drafts kept on this device.
- **Notifications:** filters, day groups, Open related record, Mark read / Mark all, per-category mute, email opt-in and email delivery state.
- **Documents:** a checklist of the five document types with Not submitted / status; Replace (removes the old file only when the player may); secure upload area.
- **Privacy & Help:** publish controls, photo and biography visibility (hiding really removes them from the public row), "What the public sees" vs "Always private", identity check, read-only guardian status, and six help actions that open a pre-filled request.
- **Reviewer side:** the new `PlayerRequestsReview` panel is in the tournament Teams tab (operators), the team Requests & Notices tab (managers) and the platform admin page.
- **Verification:** typecheck, lint and build clean; 55 test files and 532 tests pass (new: `src/lib/player-hub.test.ts`). Owner browser pass pending.

# Team Workspace — fifteen sections completed to the spec — 2026-10-31

Review-only migration `supabase/migrations/202610310031_team_workspace_complete.sql` (not applied; apply after 024 and 026–030). Without it the workspace loads and every dependent feature shows a "needs migration 031" note.

- **Migration 031:**
  - Extended team profile columns and team types. Platform admins verify teams through a trigger. Private details go in a separate `team_private_details` table.
  - Staff roles with per-member permissions. Helpers `team_has_permission` and `is_team_owner` (the owner is `teams.created_by`). `is_team_manager` now excludes coach, medical, media and finance roles; existing manager and staff rows are unchanged.
  - Audited functions for staff, ownership, archive, membership edits and ending a membership with a private reason. A delete policy for unused unclaimed records (used when the ID check finds a duplicate). Join requests can be returned for more information.
  - `get_team_workspace_matches` and `get_team_match_participants`. `submit_roster_players` validates rosters on the server and keeps every version.
  - `team_result_reports`, `team_finance_records` (void-only, audited) and `team_documents` in a private `team-private` bucket.
- **Sections:** Overview, Team Profile, Players, Invitations & Requests, Tournaments, Applications, Rosters, Fixtures & Results, Statistics & History, Finance, Documents, Notifications, Staff & Permissions, Public Page and Settings.
  - The open section is kept in `?section=`. Phones show Overview / Players / Tournaments / Matches with the rest under More.
  - Finance and Documents are hidden for staff without permission.
- **Organizer side:** team result reports appear in the tournament Matches tab; team documents for review appear in the Teams tab.
- **Not built:** per-player eligibility status in the player list (organizers check eligibility per roster); "Request document" from a player; push notifications; the application form itself still lives on the public tournament registration page.
- **Verification:** typecheck, lint and build clean; 56 test files and 546 tests pass (new: `src/lib/team-hub.test.ts`). Owner browser pass pending.


# Public Landing Page — completed to the specification — 2026-11-01

Migration **202611010032_landing_page_complete.sql** (review-only; apply after 024 and 026–031). Until it is applied the page still loads: Live Now, Today and Top Players say they need migration 032, and Recent Results falls back to the confirmed-match list without scores.

## What 032 adds
- `get_public_match_feed(...)` (anon): matches of published, non-draft tournaments whose draw (stage) is published. Score only for confirmed matches, from the newest confirmed version (a corrected result replaces the old one; it is flagged "Corrected"). Team names only for published teams or teams with an approved entry. No notes, documents, payments or account ids.
- `get_public_top_players(...)` (anon): confirmed official totals for published players with at least 3 appearances; the browser ranks them with the documented rating formula.
- `get_public_registration_capacity(...)` (anon): registration window plus counts only (categories, team limit, approved entries) for the urgency line.
- `public_announcements`: the service banner above the header (severity, English and Dhivehi, schedule). Platform admins manage it.
- `content_reports` + `submit_content_report(...)`: private moderation requests. Signed-in only, 5 per day, one open report per record; only platform admins read them; report contents cannot be edited.
- `platform_pages`: owner-written Privacy, Terms, Community Guidelines, Contact and other pages.

## Page
Sections in spec order: announcement → header → hero and search → Browse by Sport (with tournament counts) → Live Now (30-second refresh, "Updated … ago", stale and offline warnings) → Today's Matches (Maldives day, grouped by time) → Spotlight (admin-promoted, then open registration, then active, then nearest upcoming) → Featured → Recently Active → Upcoming (nearest start first) → Standings (newest calculation only, sport-appropriate columns) → Bracket (published knockout draw, two-leg aggregates, byes, winners from official scores) → Top Players → Active Teams → Recent Results → News → Continue Exploring → Organizer CTA → How It Works → install prompt → footer.
- Each section loads, fails and retries on its own; below-the-fold sections load when they come near the screen.
- Hero chips show only counts that loaded; a failed count is hidden, never shown as zero.
- "Trending" became **Recently Active** and "Popular Teams" became **Active Teams** (official matches in 90 days), because there is no popularity or follower data.
- Tournament status and registration status are always two separate labels; urgency (opens in N days, closes today, N days remaining, N places remaining, full) appears only when the data supports it.
- Search: suggestions grouped by type after 2 characters, debounced and cancelled, keyboard navigation, screen-reader announcements, clear button, "Did you mean" from published names.
- Header: More menu, glass that strengthens on scroll, notifications bell and account menu (Choose Workspace, Public profile, Install app, Platform admin, Sign out) when signed in. Dhivehi sets `dir="rtl"`.
- Footer: all Navigate, Sports, Help and Legal links, which open `#info/<topic>`. Help topics describe how the platform works; legal pages show the owner's published text or say they are not published yet.
- A Report button on public tournament, team, player, match, organization and news pages.
- Platform admin: service announcements, the content-report queue, and the help and legal page editor.

## Not built / owner actions
- Follow and favourites, and therefore contextual notification permission. The spec marks these as after the core release.
- Account Settings in the account menu: there is no account settings page yet.
- A live running score: scores become public only when confirmed. The schema has one in-play state (`live`), so half-time and extra time cannot be shown separately.
- Registration fee and waitlist: there is no public fee field and no waitlist status.
- Social previews: hash routes cannot give each record its own preview. index.html has the landing title, description and Open Graph tags; `og:image` needs the production domain as an absolute URL, and per-record previews need server-rendered metadata.
- Analytics: none are sent.


# Player Workspace — final specification (five sections) — 2026-10-31

Migration **20261030213640_player_workspace_final.sql**, created with `supabase migration new player_workspace_final`. Review-only, not applied. It depends on 013, 026, 029 and 030 only. Until it is applied, the workspace works as before and the new parts say they need it: public player code, activity log, availability, saved card choices, and the six new request types (sent under the closest older type until then).

## What changed
- **Navigation:** five sections, Overview · My Career · Matches · Player Card · More. Phones show the bottom bar Home, Career, Matches, Card, More.
  - The URL keeps `?section=…&tab=…`; old `?tab=` links still work.
  - `#workspace/player` opens the player linked to the signed-in account; the id never comes from the browser.
  - Signing in returns to the private link that was opened.
  - Several linked profiles show a support message, and none is opened.
- **Header:** public player code, claim and verification badge, jersey number, completion, and Preview / Edit profile / Publish or Unpublish / Account.
- **Overview:**
  - Guided setup: secure identity check, basics, team or "continue without team", privacy or "keep private". Progress is saved, the guide can be hidden, and it can be reopened from Privacy & Help.
  - One Next Action, following the 12-step priority.
  - Four summary cards. A failed statistics query shows an error, not zeros.
  - Upcoming match, current team, attention required, player status, recent performance, notifications.
- **My Career:**
  - Profile: grouped into Basic, Playing and Public; Account Settings separated; "Verified information" lists locked fields with Request correction, plus Request identity correction.
  - Teams, Tournaments and Achievements are unchanged.
  - Statistics: filters behind one Filter button; a source line with View source matches and Request correction.
- **Matches:**
  - Upcoming, Live and Completed.
  - Lineup: "The official lineup has not been published." No draft lineup data is read.
  - Add to calendar (.ics).
  - Availability: six choices with a private reason, readable only by the player and that team's managers.
  - Discipline: cards from confirmed matches only.
- **Player Card:** neon shield, 5:8, exported at 1000 × 1600.
  - One renderer draws both the preview and the PNG. Outside the shield is transparent.
  - Shows the public code and the foot/hand, island and flag rows.
  - Long names shrink rather than clip. Fonts load before export. The file name is safe.
  - Customize: style, published team, photo position, statistics row.
  - A private profile can download and print; Share and the public link need a published profile.
- **More:**
  - Eligibility per tournament: every check says what is wrong, why, who reviews it, and the next step.
  - Invitations & Requests.
  - Documents.
  - Notifications: an Actions inbox, then information-only notices.
  - Activity: written by database triggers, paginated.
  - Privacy & Help: the public preview frames the real signed-out page (desktop, mobile, card), plus data-copy, privacy, duplicate and account-closure requests.
- **Account Settings** (`#account`): account name, email change, password, language, and signing out other devices.
- **Header fixes:**
  - No more link nested inside a link around the logo.
  - The header search is hidden below 1360 px, which removes the 56 px sideways scroll at 1280 px.
  - The Player Workspace is a separate 120 kB chunk.

## Still partial
- **Suspensions:** not recorded anywhere, so Discipline and Eligibility say the organizer decides and communicates them.
- **Age and category:** checked by the organizer, not calculated.
- **Lineups:** there is no "published lineup" state yet; upcoming matches always say the lineup is not published.
- **Availability for team staff:** managers can read it (RLS), but no Team Workspace screen shows it yet.
- **Identity correction:** a private request plus evidence in Documents. The replacement duplicate check stays the existing `register-identity` server function, run by the reviewer.
- **Onboarding progress:** stored in the browser. The steps themselves are calculated from real records.
- **Public player code:** shown on the card and in the workspace, not yet on the public player page.


# Manual team and roster entry — 2026-10-31

Migration **20261031063946_manual_team_and_roster_entry.sql**, created with `supabase migration new`. Review-only, not applied. Apply it after 031.

- **Team managers** have three ways to add a player in Players:
  - **Invite player:** for a player with an account; they join only when they accept.
  - **Add existing player** (new): searches players without an account and adds one directly, with position and jersey number.
  - **Create new player:** a new unclaimed record, with the private duplicate-ID check.
- **Tournament organizers**, in the tournament's Teams tab:
  - **Create a new team:** creates the team and enters it as approved in one step. The organizer manages it until they invite its manager and transfer ownership.
  - **Players & roster** on each entered team: add an existing player without an account, or create a new player (same ID check). Then pick players with shirt number, position, captain and goalkeeper, and submit the roster. Size and number rules are checked live and again on the server, and each submission is a new version that still needs approval.
- **Consent:** a player with an account is never added by anyone else; the database answers "invite them instead". Every add is audited.
- **Security fix:** the old insert policy let any team staff member put any player, claimed or not, directly into their team. Direct inserts now need the player to be unclaimed, or to have a pending request to join that team.

## Super Admin in Choose Workspace — 2026-11-02

No migration. Frontend only.

- **Root cause.** The database side was correct (`platform_admins` row; `admin_permissions()` and `is_platform_admin()` live and refused to guests). The frontend never asked: `loadWorkspaceSummary` read only organization, team, player and official links, so Choose Workspace had no Super Admin entry. The admin area lived at `#admin` and was reachable only from the account menu in the public header, which the workspace screen hides. A refresh also showed "Sign in" for a moment, because the app treated everyone as signed out until the saved session loaded.
- **Choose Workspace** now asks the database for the session's administrator access (`admin_permissions`, falling back to `is_platform_admin` before 034) and shows a **Super Admin** card (Platform Owner · Manage the complete Kulhivaru+ platform · Open Admin Workspace). It is never opened automatically. A failed check shows "Unable to verify administrator access" with Retry; it is never read as "not an administrator".
- **Route** `#workspace/platform-admin[/<page>]`. Signed out: the sign-in gate. Signed in: the admin workspace confirms the account with `auth.getUser()`, then reads its permissions; states are Checking administrator access, Access denied (not a platform administrator), Session expired — sign in again (after one refresh and retry), and Unable to verify administrator access (Retry). Old `#admin/...` links redirect. Switch workspace returns to the chooser without signing out.
- **Sections** are the existing permission-aware admin pages (overview, cases, identities, accounts, organizations, teams, players, tournaments, results, approvals, finance, notifications, content, configuration, customization, administrators, audit, security, system); each appears only when `admin_permissions()` includes what it needs.
- **Session:** the app waits for the saved session before rendering private routes; workspace results are cleared when the account changes; admin access is never cached in browser storage and is checked again on every load.
- **Checks:** typecheck, lint, 705 tests in 69 files and the build pass. Browser, signed out: `#workspace/platform-admin`, `#admin/cases?case=1` (redirects) and `#workspace` show the sign-in gate, no console errors. **Not verified:** signing in with the real account — that needs the account owner in a browser.

## Final acceptance — Page 1: Public landing (/ and #home) — 2026-11-02

No migration. Waiting for the owner to reply "passed".

- **Before:** 15 of the 24 required sections; light white-card sections under a dark hero; the hero panel was an empty teal block without a cover; no ticker, Why, role panels, Tournament Engine, Player Card showcase or Sports History; "Recently Active" and "Active Teams" instead of Trending and Popular; mobile menu links stayed keyboard-focusable while the menu was closed; admin code (superAdmin.ts) was in the landing bundle.
- **Now:** all 24 sections in the owner's order, in an island / liquid-glass / broadcast design (landing-island.css, scoped to the home route): floating header, cinematic hero with the owner's copy and actions (Watch Live only when a published live match exists), search, match ticker, sports grid, Featured (spotlight leads), Live Now, Today, Upcoming, Recent Results, Why Kulhivaru+, role panels, Tournament Engine, Digital Player Card (the real top-ranked player, or a layout example clearly marked "not a real player"), Standings, Bracket, Top Players, Popular Teams, Trending Tournaments, Sports History, News, Organizer CTA, How It Works, footer.
- **Truthful measures:** Popular Teams = official matches in the last 90 days; Trending = live matches now, official results in 14 days and open registration (stated on the page; never views or clicks). Sports History = completed tournaments and the champion recorded in Awards, named only when the team is published.
- **Data:** session-less public client only; published records; scores only from confirmed, unfrozen results; each section has its own skeleton, truthful empty state and error with Retry; the ticker reuses the loaded feeds (no extra query); Standings, Bracket, News and Sports History load near the screen.
- **Accessibility:** one h1, no skipped heading levels, named regions and controls, decorative art hidden, visible focus (header search fixed), closed mobile menu removed from the tab order, reduced-motion stops the ticker and drifting rings, right-to-left ticker direction.
- **Performance:** the small administrator access check moved to adminAccess.ts so superAdmin.ts is no longer in the landing bundle (main chunk 426 kB → 413 kB).
- **Checks:** typecheck, lint, 723 tests in 70 files, build. Browser, signed out, at 390 / 768 / 1280 / 1440 and 390 with reduced motion: no overflow, no console errors, no raw ids or private text, every link internal. **Not verified:** signed-in views (needs the owner's account).

## Page 1 revised — simplified public layout — 2026-11-02

The owner replaced the 24-section landing with a shorter one. No migration.

- **Navigation:** five main items (Home, Tournaments, Live, Explore, Account) and a search icon. Explore holds Teams, Players, Organizations, Matches, Standings, Bracket and News, following the published Customization (hidden items and labels). Language and install moved into the Account menu and the footer. Phones: no hamburger; Explore and Search as header icons; bottom bar Home, Tournaments, Live, Search, Account.
- **New routes:** #explore (one tile per directory; loads nothing itself) and #live (the matches page, opening on Live).
- **Landing:** hero (owner copy, search, Explore Tournaments, Create Tournament, app preview, three real statistics), Sports Hub (Live / Today / Upcoming / Results, five cards), Tournaments (Featured / Registration Open / Upcoming / Live / Completed; one large and two smaller), Community Spotlight (Players / Teams / Organizations, five each), Competition Center (Standings / Bracket / Fixtures previews), How It Works (Player, Team, Organizer; one action each), History and News (history message and completed tournaments with champions; latest three stories). Removed: ticker, sports grid, Why, role panels, Tournament Engine, card showcase, trending, popular teams, organizer banner, recently viewed.
- **Footer:** Navigation, Workspaces, Help, Legal, language and Install App.
- **Fixed during review:** the Registration Open filter now uses the same rule as the card label.
- **Checks:** typecheck, lint, 726 tests in 70 files, build (main bundle 385 kB). Browser, signed out, at 390 / 768 / 1280 / 1440 and with reduced motion: no overflow, no console errors, no raw ids or private text; #explore, #live, #search and #account load. Signed-in views not verified.

## Full-app redesign — stages 4 to 10 — 2026-11-02

Migration `202611010040_organizer_first_and_admin_on_behalf.sql` prepared (review-only, not applied).

- **Menus (stages 5-10), nothing removed:** Player Home/Profile/Career/Requests/More (every earlier tab moved; old links follow their tab); Team Home/Players/Tournaments/Matches/More; Organizer Home/Tournaments/Teams/Operations/More; Tournament Home/Setup/Teams & Rosters/Competition/Matches/More; Official Home/Assignments/Match Center/More (sub-tabs inside); Super Admin Home/People/Sports/Operations/Platform.
- **Stage 4 (player record):** one derived status per player (unclaimed, invited, claimed, verified, restricted for admins, merged) via player_record_statuses; shown in the organizer roster panel. Copy Previous Roster (current squad players from the team's latest roster in another tournament; operators/roster managers only). Archived has no source column and is not invented.
- **Stage 10 (Super Admin):** new Sports Operations role and admin.records.create permission (Platform Owners included, Moderators not). Create on behalf page: organization (optional owner), team (optional organization and manager), tournament (draft, for an organization), unclaimed player (optional ID card through the private check). Every creation requires a reason and a recent sign-in and writes an audit event.
- **Not done:** automatic linking when an ID card matches an existing player (needs a register-identity Edge Function change and owner deploy); XLSX import (CSV works); batch Mark eligible / Request documents / Send claim invitation; shared page shells refactor (stage 1) beyond the shells already used; system-wide hardening (stage 11) beyond what earlier passes covered.

## Page 42 and public gaps — 2026-11-02

Status labels used from now on: **Implemented Locally**, **Live Verified**, **Owner Accepted**, **Blocked**.

| Item | Status |
|------|--------|
| Exact ID match reuses the existing player (register-identity `lookup`; organizers/team managers only, via their own row-level access to the entry; merged records resolve to the canonical player; audited) | Implemented Locally; **Blocked** until the owner deploys the updated register-identity function |
| Quick roster shows “Matched an existing player by ID card … No duplicate was created” | Implemented Locally |
| Tournaments listing: quick status chips (All, Registration Open, Upcoming, Live, Completed) and approved team count on cards | Implemented Locally |
| Players listing: sport filter | Implemented Locally |
| Matches: island filter (from each tournament’s published island) | Implemented Locally |
| Bracket: one round at a time on phones with Previous/Next | Implemented Locally (no published knockout yet to view) |
| Player Digital Card: verification address (plain text, no self-link) | Implemented Locally |
| Migrations 037–039 | Live Verified (037–038 by probe; 039 applied by owner) |
| Migration 040 | Blocked: owner to apply |
| Every signed-in page, history/claim/archive/permission journeys | Blocked: real-account testing by the owner |

## Workspace island style and page structure — 2026-11-02

| Item | Status |
|------|--------|
| Island style on every signed-in workspace (src/workspace-island.css, loaded last, scoped to .in-workspace): navy navigation and top bar, broadcast header band with Maldives-red accent, lagoon active states, broadcast Next Action, tinted cards with fewer borders, one segmented tab style, one button and field style for old and new components, island Choose Workspace hero | Implemented Locally |
| Organizer Home: four summary cards; payments and notifications counts on one line below | Implemented Locally |
| Team Home: Next Action first, four summary cards (2 x 2 on phones), other counts as links | Implemented Locally |
| Tournament Home: four summary cards in view; Teams and Payments under “More counts” | Implemented Locally |
| Visual check | Local layout preview only: a stand-in session in a local test browser with every database request answered locally (no real data, nothing created). Choose Workspace, Player, Team, Organizer and Super Admin frames at 390 and 1280 px: no overflow, no errors. Not Live Verified. |

## Final plan (docs/KULHIVARU_PLUS_FINAL_PLAN.md) — 2026-11-02

The full plan (76 sections) was read and compared with the app. Most of it was already built in earlier stages; see docs/FINAL_PLAN_GAP_AUDIT.md for the section-by-section result. Changed in this stage:

| Item | Status |
|------|--------|
| 6.1 Public header: Home, Tournaments, Matches, Teams, Players, More (Organizations, Standings, Bracket, News, Archive), Search, visible Language button, Account. Phone bar: Home, Tournaments, Matches, Search, Account. Customization id “live” kept, default label now Matches | Implemented Locally |
| 6.3 Workspace menus with the plan’s exact labels: Player (Overview, My Profile, Career, Requests, Privacy & More); Team (Overview, Squad, Tournaments, Matches & History, Manage); Organizer (Overview, Tournaments, Teams & Players, Operations, Settings); Tournament (Overview with Setup, Registration, Competition, Match Day, More — was six groups); Official (Overview, Assignments, Match Center, Availability, Notices & Help); Super Admin (Overview, Records & Access, Sports Operations, Trust & Safety, Platform Settings) with pages regrouped. Every page and tab is still reachable | Implemented Locally (signed-in check Blocked: owner) |
| 8 Landing order: Hero (Explore Tournaments, Find a Player, Organize a Tournament), Browse by Sport (six tiles, real counts, filter links), Match Center (Live, Today, Upcoming, Recent Results), Tournament Hub (Featured, Upcoming, Registration Open, Completed Archives, Live), Players and Teams, Competition Center, History and News, Organizer call-to-action (sign-in destination kept), How It Works | Implemented Locally |
| 19 Public archive page and completed-tournament banner | Implemented Locally |
| 5.4 Claim status shown separately from verification on public player pages and lists | Implemented Locally |
| 5.4 Team “Managed by tournament organizer” label, migration 202611010041 (review only) | Blocked: owner to apply 041 |
| Checks | typecheck pass, lint pass, 764 tests (74 files) pass, build pass (main bundle 390 kB). Browser 390/1024/1280 px signed out: no overflow, no page errors |

## Final plan 37 — Teams & Players tabs — 2026-11-02

No database change. Everything reads through the organizer's own client and existing policies.

| Item | Status |
|------|--------|
| Teams & Players now has five tabs: Teams, Players, Claims, Possible duplicates, Imports (every organization role; team import stays owner/operations) | Implemented Locally (signed-in check Blocked: owner) |
| Claims: every player record you created with one status (Claimed by the player, Invitation pending, Invitation expired or revoked, Not invited yet), filters, revoke, and batch "Send claim invitation" with a confirm step; tokens shown once for private delivery, never stored | Implemented Locally; uses the deployed invite-player and revoke-player-invitation functions |
| Possible duplicates: same name (words in any order) among your records, your linked teams and published records; "Request duplicate review" sends it to the Super Admin review queue through submit_content_report (032). Nothing is merged, hidden or deleted | Implemented Locally |
| Imports: CSV or Excel (.xlsx, first sheet, read in the browser with no new library), column-name template, column matching, the existing preview with row checks and duplicate warnings, confirm, and import history from your audit rows. The Teams and Players tabs link to it | Implemented Locally; .xlsx reader also checked in Chromium |
| Checks | typecheck pass, lint pass, 779 tests (75 files) pass, build pass (main bundle 390 kB) |

## Simple tournament flow: Create → Teams → Schedule → Play → Finish — 2026-11-02

The owner's five-step instruction for organizers. Every earlier tool is kept: it now sits under "More details" on each step, or under More.

| Item | Status |
|------|--------|
| Create: tournament name, sport, optional logo and cover; "Create Tournament" saves and opens Teams. Sport defaults (squad size) apply automatically | Implemented Locally (signed-in check Blocked: owner) |
| Tournament menu: Home, Teams, Schedule, Matches, More. More holds Registration & payments (hidden when no team applies or pays), Rules & details (the nine setup stages), Officials, Finance & sponsors, News, Tournament settings, Finish | Implemented Locally |
| Tournament Home: one next action, four cards (Teams, Matches, Completed, Needs Attention), five-step progress on every tab, Save & Exit. "Setup n of 9" and the five-count strip removed from the header; the old overview is under "Full overview" | Implemented Locally |
| Teams: "How will teams join?" Share Registration Link (creates and copies the #register link after a confirm, since it publishes the page) or Add Teams Myself (search, create if not found). One list: Team, Players, Payment (only when a fee applies), Status (Ready, Needs players, Needs payment, Needs review). Players: search, add, create unclaimed, paste a list, or later. Confirm Teams closes registration and opens Schedule | Implemented Locally |
| Schedule: recommendation from the team count (e.g. 8 teams: 2 groups of 4, then semi-finals and final), Use Recommended or Choose Another Format; asks only start date, venue and playing times; creates the draw and every match and places them with no team or venue clash and 20 hours' rest; calendar by day; Make Changes and Publish Schedule. Seeding, pots, two legs and tie-breakers under Advanced options | Implemented Locally |
| Play: Next Match card and Open Match; Simple Match Center with Start Match, Add Score, Undo, Half-time, Finish Match, final score, player details, Submit Result; "Result waiting for confirmation" with Confirm Result; next match shown after. Simple Mode or Full Career Mode (recommended: scorers, assists and cards are recorded on submit, so Undo never leaves a stray event). The running score is kept on the device until it is submitted | Implemented Locally |
| Start Match public "Live" label: migration 202611010042 (set_match_live, review only) | Blocked: owner to apply 042. Without it the match is still scored and submitted; only the public Live label waits |
| Finish: "Your tournament is almost complete." checklist (results, standings, champion, optional awards, archive preview), awards (best player, top scorer, best goalkeeper, other), Finish Tournament, then the exact confirmation and "Finish and Publish Archive". Finished tournaments show champion, runner-up, results and links to standings, bracket, teams, results and player statistics; organizer tasks hidden | Implemented Locally |
| Public match page: "Player statistics were not recorded for this match." instead of an empty or zero table | Implemented Locally |
| Checks | typecheck pass, lint pass, 798 tests (76 files) pass, build pass. Local layout preview (stand-in session and placeholder rows answered inside the test browser; nothing real read or written) at 390 and 1280 px for Home, Teams, Schedule, Matches and the match center: no overflow, no page errors |

## Workflow redesign (benchmark: a simple tournament app; original Kulhivaru+ design) — 2026-11-02

Labels: Completed = Implemented Locally and checked; Partial; Blocked; Live-unverified = built, not yet seen with real signed-in data. No code, wording, images or branding were copied from the benchmark product.

| Stage | Item | Status |
|---|---|---|
| 1 Public shell | Header: Home, Tournaments, Matches, Players, Teams, Sign In, Create Tournament; Explore, Search and Language icons (language hides under 1180 px and stays in the account menu and footer). Phone bar: Home, Tournaments, Matches, Players, Teams. Simple footer: Explore, My Work, Legal | Completed (390/920/1024/1280 px, signed out, live public data: no overflow, no errors) |
| 1 Landing | Hero with Create Tournament and an app preview (a real published tournament's cover and name; placeholder bars, never invented teams or scores), supported sports, automatic fixtures, live scores and standings, player statistics, tournament pages, organizer benefits, player/fan benefits, news/photos/sponsors, final call to action | Completed |
| 2 My Work | Player Career, Managed Teams, Organizations, Official Assignments (shown even when empty), Platform Administration (administrators only, last). Switch Workspace stays in every workspace header | Completed in local layout preview; Live-unverified |
| 3 Organizer | Home, Tournaments, Players & Teams, More. Create Tournament form opens only on request. Cards: cover, logo, name, sport, phase bar, Teams, Matches, Pending, Open Tournament | Completed in local layout preview; Live-unverified |
| 4 Tournament workspace | Opens in its own shell (All tournaments, organization name, Switch workspace) with no organization sidebar; own phone bar | Completed in local layout preview; Live-unverified |
| 5 Five phases | Teams: team list + Applications & payments. Schedule: schedule, format & draw, standings & bracket. Matches: match center. More: settings, categories/form/rules, officials & staff, finance & sponsors, news & media, Reports & history (new: team, schedule and result downloads with no private data, plus the full audit history), complete & archive. Home: next action, four cards, registration, teams, upcoming matches, recent results ("Score not recorded" when missing), warnings, public-page preview. Finish: "Statistics rebuilt from confirmed results" step | Completed in local layout preview; Live-unverified |
| 6 Public tournament page | One tab row: Overview, Schedule, Results, Standings, Bracket, Teams, Players, Statistics, News & media (when published), Rules (with registration), Sponsors (when listed), Awards (finished tournaments). Standings and bracket open inside the page. Results have a "Share image" result graphic (confirmed results only). Old ?tab= links still work | Completed (Players and Statistics: Blocked on migration 043; until then they say so) |
| 6 Migration 202611010043 | get_public_tournament_players and get_public_tournament_player_statistics: read-only, published players in published tournaments, confirmed results only, no internal IDs | Blocked: owner to review and apply |
| 7 Polish | Phone card layout for the Teams step list; no sideways scrolling on the checked pages | Partial: full accessibility audit and performance budget not done |
| Not built | Suspensions (no suspension rule in the schema), ranking graphics, match sheets as printable PDFs, spreadsheet import into a single team's squad from the Teams step (the organization Imports tab does CSV/Excel), a third-place match option in the Schedule step, optional location/dates on Create (set later under More) | Not built |

## Tournament workflow (owner's 16-part plan) — 2026-11-03

Labels: Implemented Locally (built and checked by typecheck, lint, tests and build), Live-unverified (needs a signed-in owner run with real data), Blocked (waits for an owner action), Partial. Original Kulhivaru+ design; no benchmark code, wording or images copied. No migration applied, nothing deployed, no data created.

| Part | Item | Status |
|---|---|---|
| 1 | `#workspace/tournament/:id` opens the tournament only inside an organization the account belongs to (otherwise back to My Work with a message). Old `?tid=` links still work. Header: logo, name, sport, Phase, lifecycle status, Published/Private draft, Back to Organization, Switch Tournament, Preview Public Page, Save & Exit, Saving/Saved/Not saved | Implemented Locally; Live-unverified |
| 2 | Create needs only name and sport. Optional and folded: logo and cover uploads (Storage paths only), season, categories, atoll, island, venues, start/end dates, description, rules. Saved into the existing setup records (no new columns). Opens the Teams step | Implemented Locally; Live-unverified |
| 3 | Teams page: Registration, Applications, Confirmed teams, Players, Rosters, Eligibility, Payments at a glance; registration dates and form, close registration, copy/share link, add/search/create team, import link, players and rosters. Confirm Teams is disabled while applications, squad lists, payment proofs or eligibility problems wait for a decision. Sign-in round trip back to the registration form already existed | Implemented Locally; Live-unverified |
| 4 | Schedule: team count, recommended format (changeable), Preview Draw (automatic shuffle) or seeded preview, Shuffle again, Confirm Draw and Generate Fixtures, points win/draw/loss, match length, rest hours, third-place match, Edit Fixture, Regenerate Draft (only before publishing and before play; old draft cancelled with a reason and kept), Publish Schedule. Pots, manual pairings, tie-breaker order and two legs stay under Advanced options | Implemented Locally; Live-unverified |
| 5 | Match Center: Simple and Full Career modes; Start Match, half-time, finish; goal / penalty goal / own goal, assist, yellow, second yellow (yellow + red), red, penalty miss; lineups and minutes; injury/incident to the private log; result type Played/Walkover/Forfeit; private note; submit → confirm. Fixed: assist events used an invalid idempotency key | Implemented Locally; penalty miss Blocked on migration 044 (skipped with a notice until then) |
| 6 | Standings, statistics, careers recalculate in the existing confirm/correct functions. Suspensions from confirmed cards (red card, every Nth yellow) refresh on confirm and correction | Suspensions Blocked on migration 044 |
| 7 | Corrections: reason (5+ characters), previous version shown and kept, audit; warning plus required acknowledgement when a knockout winner changes after the next round exists | Implemented Locally |
| 8 | Finish checklist: fixtures resolved, results confirmed, standings, knockout progression, champion, runner-up, third place, disputes, suspensions reviewed, statistics rebuilt, awards, archive preview; "Finish and Publish Archive" sets Completed (archive, never delete) | Implemented Locally; Live-unverified |
| 9 | Public: Final archive panel on finished tournaments; ranking graphic "Share image" on each player ranking; result graphic already existed | Implemented Locally; Players/Statistics Blocked on migration 043 |
| 10 | Reports: standings CSV, printable match sheets and final tournament report (print or PDF), next to teams/schedule/results CSV and the audit history. Fixed: a global print rule blanked every printout except the player card | Implemented Locally |
| 11 | Staff scopes: the database allows registration, operations, match_data, finance and media; the plan's eight scopes map onto them (Registration and Teams/rosters → Registration Officer; Scheduling and Match operations → Tournament Manager; Results → Match data; Finance; Media; Reports → every operator). Separate scheduling/reports scopes would need a migration that changes every policy | Partial |
| 12 | Mobile/accessibility: new controls are labelled, status announcements use aria-live, focus rings, reduced motion for the save spinner, no new fixed widths | Partial: full audit not done |

New review-only migration: `202611010044_match_discipline.sql` (penalty_miss event type; player_suspensions table with RLS for tournament operators; refresh/add/resolve functions, all `security definer set search_path = ''`, execute revoked from public and anon, every change audited).

Release: hold. The full organizer journey (create → teams → rosters → fixtures → play → confirm → standings/careers → finish → archive) has not been run signed in with real data.

## Tournament Engine (confirmed teams → archive) — 2026-11-03

Scope: engine only. No changes to the Player, Team, Organizer, public or Super Admin workspaces beyond where engine results appear (Schedule, Matches, Standings, Finish, public Final archive). Nothing applied, deployed or seeded.

| # | Engine part | Where | Status |
|---|---|---|---|
| 1 | Audit and reuse | Existing stages, groups, matches (legs), result versions, match events (idempotent), standings snapshots, adjustments, fixture versions, audit events reused; no duplicate models | Done |
| 2 | Formats and validation | `tournamentEngine.ts`: single/double round robin (balanced home/away, byes for odd counts), group stage (single/double inside groups), groups→knockout (qualifiers, best thirds), knockout (seeded bracket, byes to top seeds, 1 or 2 legs), league→playoffs (top 2/4/8/16), manual pairings; expected match counts; format checks | Implemented Locally |
| 3 | Points and ordered tie-breakers | Win/draw/loss; head-to-head points, head-to-head difference, overall difference, goals scored, wins, fair play (cards from confirmed matches), playoff, manual decision (with reason and audit). Unbroken ties are flagged, never silently ordered | Implemented Locally |
| 4 | Draw engine | Random, seeded, seeded pots, same-island separation, reproducible draw code stored with the draw; manual draw (move teams between groups) and manual pairings with duplicate/missing/self/round checks; Preview Draw, Redraw, Edit Manually, Confirm Draw | Implemented Locally |
| 5 | Fixture generator | Start date, match days, time slots, venues, rest, match length, most matches per day; validation (self-play, duplicates, overlaps, venue clashes, rest, count, home/away balance, every team included); preview with editable date/time/venue; Regenerate Draft; save writes stage, groups, fixtures, a fixture version (seed, match numbers, slots) and an audit event. Publish Schedule versions as before; a published schedule is never replaced | Implemented Locally |
| 6 | Match lifecycle | Draft → Scheduled → Live → Half-time → Finished → Under review → Official; Postponed, Cancelled, Walkover, Abandoned. Half-time/Finished are saved on the match after migration 045 | Implemented Locally; phase saving Blocked on 045 |
| 7 | Result entry | Simple: score, extra time, penalties, how it ended, private note. Full Career: lineups, minutes, goals (incl. penalty, own goal), assists, cards (incl. second yellow), penalty misses (044), injuries/incidents | Implemented Locally |
| 8 | Result workflow | Official submits → Under review → organizer confirms → Official; only confirmed results feed standings, progression, careers, statistics (existing server functions) | Existing; Live-unverified |
| 9 | Standings | Confirmed-only, configured points and tie-breakers, deterministic, qualification marks, snapshot version shown; previous snapshots kept after migration 045 | Implemented Locally; history Blocked on 045 |
| 10 | Knockout progression | Bracket slots stored and kept; ties decided on aggregate, away goals (off by default), extra time, penalties; final always one match; third-place match; never from an unconfirmed result | Implemented Locally |
| 11 | Corrections | Reason, previous version kept, audit, recalculation (existing); knockout winner change after the next round exists needs an acknowledgement; later matches holding a no-longer-qualified team are listed under "Bracket needs attention" and fixed only by an organizer with a reason (played matches are never changed) | Implemented Locally |
| 12 | Completion and archive | Checklist adds "No bracket conflicts"; Finish and Publish Archive writes an immutable archive snapshot (standings, results, awards, team and player statistics) after migration 045; public Final archive shows its version | Implemented Locally; snapshot Blocked on 043 + 045 |

New review-only migration: `202611010045_tournament_engine.sql` (standings snapshot history, live phase + set_match_phase, replace_match_participants, tournament_archives + publish_tournament_archive). Apply order: 040 → 041 → 042 → 043 → 044 → 045.

Not claimed complete: the full journey (confirm teams → format → draw → fixtures → record → confirm → standings/progression → complete → archive) has only run in the local layout preview with placeholder rows, not signed in against the real database.

## Simple tournament workflow replacement — 2026-11-03

UI and workflow refactor only: same tables, engine, RPCs, RLS, history and audit. Labels: Implemented Locally (built; typecheck, lint, tests and build pass; checked in the local layout preview with placeholder rows), Live-unverified (not yet run signed in with real data), Partial.

| Area | What changed | Status |
|---|---|---|
| Shell | `#workspace/tournament/:id`; header shows logo, name, sport, phase, publication, Saved/Saving/Error, Back to Organization, Switch Tournament, Preview Public Page (Edit Branding and Save & Exit removed: every change saves; branding stays under More). Cover only on Home. Phones: the bottom bar is the only main menu; no top tab row | Implemented Locally; Live-unverified |
| Home | One Next Action (priority: bracket conflict, applications, squad lists, teams, schedule, publish, live match, result to confirm, finish); six cards (Teams, Players, Fixtures, Completed matches, Pending decisions, Issues) opening their pages; Next matches (3), Latest results (3), Needs attention (5), Latest activity (5). No forms. The old full overview moved to More → Tournament details | Implemented Locally; Live-unverified |
| Create | Name and sport only; optional logo/cover and folded details; opens Teams | Implemented earlier |
| Teams | "N confirmed teams" header; Share Registration Link (closing date, max teams, fee → Open Registration; then Copy Link, Share via WhatsApp, Preview Form, Close Registration); Add Team (search first, then Create New Team with name, type, island; opens the new team's players); team cards with one label (Needs Action / Waiting for Review / Ready / Problem / Done) and Manage Team (exact statuses, problems, players search/quick add through the existing secure ID path, Approve Roster, Lock Roster, Request Correction, Reject); Confirm Teams and Continue, held back by open decisions | Implemented Locally; Live-unverified |
| Schedule | 1 Choose Format (six format cards with a sentence and match estimate; Recommended; Advanced settings collapsed) → 2 When & Where (start date, match days, venues, time slots; advanced: length, rest, per-day cap) → Draw when needed (Run Automatic Draw; Accept Draw, Try Again, Edit Manually; Draw options: seeded, pots, island separation, manual) → 3 Preview & Publish (cards by date, Edit date/time/venue/home-away, problems pinned to the exact card with a suggested fix, Publish Schedule saves the draw and version and makes it public, then opens Matches) | Implemented Locally; Live-unverified |
| Matches | Top card with the next required action; filters Next / Live / Needs Review / Completed / All; Start Match opens a checklist (venue, officials, both lineups) first; Simple Result by default with "Record Full Match Details"; Correct Result in each official match's menu with reason, previous result, what is recalculated, bracket warning and explicit confirmation | Implemented Locally; Live-unverified |
| Finish | Checklist items open the page that fixes them; awards quick selectors; Finish and Publish Archive | Implemented earlier |
| More | Tournament details, categories/form/rules, officials & staff, finance (only with finance permission), news & media (only with media permission), reports & history, finish & archive | Implemented Locally |
| Raw IDs | No UUID or ID entry left in organizer or tournament screens | Implemented Locally |
| Mobile | One-column forms, full-width cards, sticky main action above the bottom bar, no horizontal scroll at 390 px on Home, Teams, Schedule, Matches | Implemented Locally (preview) |
| Not done | Separate full-screen detail views on phones (team, fixture and match open in place as focused panels); WhatsApp is a share link, not an API; searching players by Kulhivaru+ Player ID | Partial |

Not accepted yet: the real-data organizer journey and the signed-out privacy checks in the specification have not been run against the live database.
