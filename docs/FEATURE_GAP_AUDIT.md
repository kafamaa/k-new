# Kulhivaru+ Feature Gap Audit

Audit date: 21 October 2026

## Scope and method

Read completely:

- `doc/Kulhivaru_Plus_Product_Specification.md`
- `doc/Kulhivaru_Plus_OpenCode_Development_Plan.md`

Inspected:

- `src/App.tsx`, `src/components/*`, `src/lib/*`
- Supabase client and queries
- Migrations `202610210001` through `202610210010`
- Edge Functions under `supabase/functions/*`
- RLS/Storage policies and local tests

Current local checks: typecheck, lint, build, and 71 tests pass. Live Supabase/RLS/Storage/RPC/Auth/Edge Function behavior remains unverified.

Status meanings: **Implemented** means actual UI/data flow and local evidence exists; **Partial** means a slice exists but required pieces are absent; **Missing** means no implementation evidence; **Blocked** means live/runtime verification cannot run.

## Migration history verification (read-only, 22 October 2026)

Read-only inspection of the remote schema. No DDL was executed, no migration was applied or pushed, and no data was changed.

| Migration | Status | Evidence |
|---|---|---|
| `202610210011_public_rls_policy_split.sql` | Applied (recorded earlier) | Anonymous reads of `match_events` and `match_result_versions` return HTTP 200 with no helper-permission error. |
| `202610210012_player_workspace_access.sql` | **Applied** | Recorded from the read-only remote migration-history check. Policy-only migration (creates no relations of its own), so there is no table to probe and its `to authenticated` policies are not anonymously observable. |
| `202610210013_player_workspace_profile_requests.sql` | **Applied — 013's tables observed in the live schema** | `player_private_details`, `player_correction_requests`, and `player_team_requests` each answered HTTP 200 on anonymous REST. `player_private_details` exposes no `id` column, matching 013's `player_id` primary key, and no other migration creates these tables. |
| `202610220014_public_player_statistics_fixes.sql` | **Pending — not applied, not pushed by the assistant.** Live RPC behaviour has nevertheless changed (see the corrected blockers under "Player detail page") | Prepared for review only; an isolated dry run validated it locally and nothing was executed against the project by the assistant. Read-only anonymous probing on 22 October found `get_player_official_statistics` now returns HTTP 200 `[]` for both published players (previously HTTP 400 / `42804`). An isolated dry run proved the 0008 body raises the type error for zero rows and one row with `minutes` as both `integer` and `bigint` (4/4), so the empty live result cannot come from 0008 — the live definition has changed. Item 2's milestone policy state is indeterminate: `sport_milestones` is empty, so guest reads succeed trivially and do not exercise the operator policy. |

**Scope of this check:** it establishes what exists in the remote schema and nothing more. It is **not** feature verification and **not** browser acceptance. No workspace feature has been re-tested against the applied 012/013 state, so those features remain unaccepted until the owner confirms them in a real browser. Likewise the changed live RPC behaviour does **not** mean statistics or achievements are accepted: both published players currently have **no** statistics, team history, or milestones, so the pages render truthful empty states. Whether 014 (or an equivalent) was applied must be confirmed by the owner; the assistant applied nothing.

## Requirement audit

### Public experience and pages

| Requirement | Status | Evidence |
|---|---|---|
| Responsive homepage visual system | **Implemented locally / Blocked live** | `src/App.tsx`, `src/components/HomepageSections.tsx`, `src/lib/homepage.ts`, `src/styles.css`; all reference sections have responsive real-data/empty-state rendering and six sports are listed. Signed-out browser smoke passed; live published-data/RLS verification remains blocked. |
| Organization, tournament, team, player, match public pages | **Implemented locally / Blocked live** | Hash routes, `PublicPage.tsx`, and `publicData.ts` provide published-field list/detail loaders. Live RLS/public record verification remains blocked. |
| Published records loaded from Supabase | **Implemented locally / Blocked live** | `HomepageSections.tsx` and `publicData.ts` query published organizations, tournaments, teams, players, confirmed matches, and standings; empty/error states are explicit. |
| Public matches/results/standings/history/news | **Partially implemented / Blocked live** | Public match/player-history/statistics, standings, and bracket routes exist; news remains a truthful empty state because no news source exists. |
| Search | Missing | Search button in `App.tsx:36` only displays a notice; no search query or result page. |
| Guest read-only access | Partial/Blocked | Authenticated controls are conditionally rendered, and RLS policies exist in migrations. Live guest denial has not been exercised. |

### Accounts, workspaces, and roles

| Requirement | Status | Evidence |
|---|---|---|
| Email/password auth and recovery | Implemented locally/Blocked live | `App.tsx:28,69-71` and Supabase Auth calls. Live account acceptance remains owner work. |
| One account/multiple authorized workspaces | **Implemented locally / Blocked live** | `lib/workspace.ts` loads organization/team/player workspaces; the new Choose Workspace screen (`WorkspaceChooser.tsx`) lists only authorized workspaces and opens one only on explicit selection. Live RLS/history verification remains blocked. |
| Player/team/organization workspaces | Partial/Blocked | `WorkspaceChooser`, `PlayerWorkspace`, `RecordCreator`, `TournamentCockpit`, and `OperationsPanel` exist and are scoped per workspace kind. Live persistence is unverified. |
| Player, manager, organizer, staff scopes | Partial/Blocked | RLS/function policies and `staff.ts`/`OperationsPanel.tsx` exist; no live permission tests or complete role-specific navigation. |
| Super Admin | Missing | No schema, route, or admin UI. |

### Onboarding and claims

| Requirement | Status | Evidence |
|---|---|---|
| Explicit first-workspace choice | **Implemented locally / Blocked live** | `WorkspaceChooser.tsx` shows per-type onboarding (Create Player Profile, Create/Join Team, Create Organization) only for types the account lacks. Team/org creation uses existing policies; personal creation requires pending migration. |
| Search/link before duplicate creation | Missing | Creation forms accept names/IDs directly; no search or conflict review UI. |
| Organizer-created unclaimed records | Partial | `createUnclaimedPlayer`, `createTeam`, and claim UI exist. Existing-player/team search and roster linking are absent. |
| Atomic claim/expiry/revocation | Partial/Blocked | `claim-player`, `invite-player`, `revoke-player-invitation`, and SQL atomic claim function exist; Edge runtime/live tests are blocked. |
| National ID HMAC, foreign identity, minor/guardian workflows | Missing | Identity digest schema exists, but no trusted ID-processing flow, guardian approval, or conflict-review workflow. |

### Tournament planning and archive

| Requirement | Status | Evidence |
|---|---|---|
| Private draft and resumable 11-step setup | Implemented locally/Blocked live | `TournamentCockpit.tsx`, `lib/tournament.ts`, migrations `003-004`. |
| Basics/categories/registration/forms/roster/rules/venues/officials/finance/review | Partial | Setup step persistence exists, but category editing, answer UI, eligibility, venue scheduling, official workflow, finance setup, and review/publish validation are incomplete. |
| Lifecycle through completed/archived | Missing | Status constraints exist, but no controlled publish/complete/archive UI or completion validation. |
| Next Action and separate dashboard counts | Partial | Workspace UI exists, but no complete application/roster/payment/match counts, activity feed, or next-action engine. |

### Registration, rosters, and private documents

| Requirement | Status | Evidence |
|---|---|---|
| Team application and organizer entry | Partial | `submitTeamApplication` and review controls exist; organizer search/select/link UI is absent. |
| Separate application/roster/payment status | Implemented locally/Blocked live | `tournament_entries`, review trigger, roster RPC, and UI controls. Live RLS/persistence not verified. |
| Registration questions and answers | Partial | Questions can be created; answer-entry UI/validation is missing. |
| Eligibility/category/duplicate-player/roster lock rules | Missing/Partial | Versioned roster submission exists; eligibility checks and lock validation are incomplete. |
| Private uploads/proof | Partial/Blocked | Private bucket, metadata, policies, and upload data flow exist; Storage authorization is not live-tested. |

### Competition and match operations

| Requirement | Status | Evidence |
|---|---|---|
| Round robin, group, knockout, groups+knockout, two-leg | Implemented locally/Blocked live | `lib/competition.ts`, `CompetitionPlanner.tsx`, migration `005`, and tests. |
| Automatic/manual draw, preview, versions/audit | Partial | Planner and fixture-version contracts exist; publishing and post-publish change enforcement are incomplete. |
| Tie-breakers and sport rules | Implemented locally/Blocked live | Rule presets, standings calculation, and tests for six sports. Full configurable UI/event schema coverage is incomplete. |
| Venues/scheduling/rest constraints | Missing | Match venue/time fields exist, but no venue entity, availability, or scheduler. |
| Official assignment and match states | Partial | Assignment schema/RLS and match UI exist; listing/management and live checks are incomplete. |
| Sport-specific event recording | Implemented locally/Blocked live | `MatchCenter.tsx`, `matchCenter.ts`, trusted RPC contract, event lists. |
| Offline cache/replay/conflicts | Partial | Local queue/idempotency/conflict logic exists; authorized fixture/roster caching and live replay are not implemented/tested. |
| Result submit/confirm/correct/audit | Implemented locally/Blocked live | RPC contracts and correction audit SQL exist; live transaction/RLS testing is blocked. |
| Confirmed-only official results | Implemented locally/Blocked live | Calculators and statistics RPC filter confirmed versions; live recalculation is unverified. |

### Statistics, histories, milestones, cards

| Requirement | Status | Evidence |
|---|---|---|
| Player/team histories | Partial | Participant schema/calculators exist; public history routes and complete history UI are missing. |
| Club/island/national/school/sport/tournament/season/date breakdowns | Partial/Blocked | `statistics.ts` and RPC support core breakdowns; live RPC and date-range UI are missing. |
| Sport-specific stats and missing-not-zero | Partial | Presets/events exist, but many detailed metrics are not persisted/calculated and optional values are incomplete. |
| Automatic sourced milestones | Partial | First appearance/goal local calculation and source fields exist; thresholds/trophies/team/tournament milestones and rebuild workflow are missing. |
| Manual milestone labels | Schema/local only | `is_manual` exists; manual milestone UI is missing. |
| Data-driven player card | **Implemented locally / Blocked live** | `PlayerCard.tsx` renders real profile + official statistics + documented rating; now shown on the public `#player/:slug` page (share/print + history link). Two pre-existing defects currently block real statistics/achievements for guests — see the Player detail section below. |

### Finance, staff, reports, notifications

| Requirement | Status | Evidence |
|---|---|---|
| MVR fees/expenses/proof/receipts/waivers/refunds/balances | Partial/Blocked | Migrations `004/009`, finance helpers, audit triggers, and operations UI exist. Receipt/proof/balance/refund completeness and live RLS are missing. |
| Delegated staff | Partial/Blocked | Assignment table/RLS, `staff.ts`, `OperationsPanel`, and tests exist. Staff task views and live scope tests are incomplete. |
| Authorized exports | Partial/Blocked | `reports.ts` and CSV UI cover entries/fixtures/finance; complete reports and live permission checks are missing. |
| In-app notifications | Partial | Tables/create/read/queued UI exist; inbox/counts and all event producers are missing. |
| Email | Blocked | No provider, sender/domain, Edge Function delivery implementation, or delivery callback. Queued is not delivered. |
| SMS/Telegram excluded | Implemented | No provider code; explicitly excluded from release one. |

### Privacy, security, language, release

| Requirement | Status | Evidence |
|---|---|---|
| RLS/private Storage | Implemented in migrations/Blocked live | Policies are present in migrations; no local/live DB execution. |
| Secret handling | Implemented in source review | Browser uses publishable key only; server secrets appear in Edge Function source. Deno runtime testing unavailable. |
| Audit | Partial | Claims, result corrections, fixture/finance audit contracts exist; complete action coverage/live enforcement unverified. |
| Privacy/cross-scope denial | Partial/Blocked | Static/pure tests exist; real cross-workspace/RLS checks remain. |
| English/Dhivehi/RTL | Missing | EN selector is non-functional; no translations or `dir="rtl"` support. |
| Maldives timezone/island context | Partial | DB defaults/island fields exist; complete UI/timezone handling is missing. |
| PWA/mobile/accessibility | Partial | Manifest/responsive CSS/manual narrow smoke exist; no full install/device/automated accessibility coverage. |
| Backups/deployment/rollback/monitoring | Missing | No operational backup/rollback/monitoring implementation found. |

## Home and Workspace page separation

- `#home`/`#top` renders the public landing page; `#workspace` renders the private `WorkspacePanel`. `SIGNED_IN` navigates to Workspace, while the Home link remains available. Player workspaces load by `player_profiles.account_id`. Live RLS/history verification is no longer blocked by migration status (012 and 013 are applied per the read-only remote history check); it remains unrun and unaccepted.

### Tournament listing page evidence

`#tournaments` now has published-only data loading, search/sport/status filters, stable detail links, loading/error/empty states, and responsive controls in `src/components/PublicPage.tsx` and `src/lib/publicData.ts`. Live RLS/public-record testing remains blocked.

## Highest-priority gaps

1. Public routing and published-data pages for organizations, tournaments, teams, players, matches, histories, and news.
2. Live Supabase validation of RLS, Storage, RPCs, triggers, migrations, and Edge Functions.
3. Complete onboarding/claims: pending personal-profile migration, invitation acceptance function, national-ID HMAC, minors, and conflict review.
4. Tournament publish/lifecycle/archive, eligibility, scheduling, awards, and completion validation.
5. Detailed sport statistics, milestone rebuild/UI, complete finance/reporting/notification workflows, and email delivery.
6. Dhivehi/RTL support.

## Recommendation

Next development should implement public route/data pages and a controlled local Supabase integration environment, then verify live RLS/Storage/RPC/Edge Functions before advancing owner acceptance. Do not claim release readiness based on screens or local contract tests alone.
Owner browser result: **Tournaments listing passed**. The owner tested the listing route, filters, empty/published state, links, mobile layout, and guest view-only behavior.

Tournament detail evidence: `PublicPage.tsx` now has a dedicated published tournament detail view with teams, confirmed matches, links to standings/bracket, loading/error/not-found/empty states, and explicit unavailable messaging for public data not exposed by current RLS. Owner browser result is pending.
Owner browser result: **Tournament detail passed**. The owner tested the published-detail route, public-only content, team/match links, empty/not-found states, mobile layout, and private-control exclusion.

Organizations listing evidence: `#organizations` now has published-only fields, name/description search, stable organization detail links, loading/error/empty states, and no guest workspace/write controls. Signed-out smoke found no published organizations; populated content remains unverified. Owner browser result is pending.
Owner browser result: **Organizations listing passed**. The owner tested the route, search control, empty state, mobile layout, public-only fields, and guest access behavior; populated records remain unverified because none were published.

Organization detail evidence: `#organization/:slug` selects only PUBLIC_ORGANIZATION_FIELDS (id,name,slug,description), shows published tournament links, a truthful unavailable message for organization-team links not exposed by current public RLS, and excludes private memberships/staff/finance/documents/contact details/workspace controls. Focused route and approved-field tests pass. No published organizations exist; populated detail and team links are unverified. Owner browser result: **Organization detail passed** (not-found state, back navigation, privacy, mobile).
Teams listing evidence: `#teams` now uses a dedicated TeamList component with PUBLIC_TEAM_FIELDS (id,name,slug,team_type,island,description,logo_url), search across public name/description/team_type/island, team-type and island facet filters, truthful empty vs no-results states, and `#team/:slug` detail links. Focused tests assert the approved public team fields exclude contact/email/phone/payment/document/note/membership/manager/created_by and that facet filters work. Signed-out smoke found no published teams; populated-team behavior is unverified. Owner browser result is pending.
Owner browser result: **Teams listing passed**. The owner tested the route, empty state, search, team-type/island filters, mobile layout, public-only fields, and guest access behavior; populated records remain unverified because none were published.

Team detail evidence: `getPublishedTeamPage` in `publicData.ts` composes published team identity, PUBLIC_TEAM_ROSTER_FIELDS roster rows filtered by `selectPublishedRoster` (published players with a public name only), published tournaments, confirmed team matches with published opponents, standings, and reached sport_milestones. Focused tests assert roster field privacy (no account_id/national/email/phone/payment/document/created_by/source) and roster filtering behavior. `PublicPage.tsx` renders TeamPublicDetail with Back to Teams, empty states per section, and unavailable messaging for scores/statistics/seasons/trophies not exposed by current public policies. Signed-out smoke found no published teams; populated team detail is unverified. Owner browser result is pending.

Players listing evidence: `#players` now uses a dedicated PlayerList component with PUBLIC_PLAYER_FIELDS (id,display_name,slug,island,photo_url,is_claimed) reused across the listing, player detail, and published-search queries. Focused tests assert the approved public player fields exclude account/national/email/phone/payment/document/note/created_by/digest/token terms and that `filterPublishedPlayers` searches public name/island with an island facet filter. Signed-out smoke found no published player profiles; populated behavior is unverified. Owner browser result is pending.

Owner-tested result: **Players listing passed**. The owner confirmed the listing in the browser; both real published profiles render with approved public fields only.

Player publication evidence: `setPlayerPublication` (`src/lib/playerWorkspace.ts`) issues `update({is_published}).eq('id', playerId).eq('account_id', userId).select('id,is_published')`, so the row filter and the migration-0010 owner-scoped RLS policy both restrict the change to the signed-in owner's own profile; zero updated rows returns an explicit owner-only error. `player-publication.test.ts` asserts the update payload contains only `is_published`, the owner-scoped filters, the migration-0001 guest policy `published players are public ... using (is_published or account_id = auth.uid())`, that no anon update policy exists on player_profiles, and that the public listing requests only `is_published = true` with PUBLIC_PLAYER_FIELDS. Live anonymous REST check confirmed unpublished rows are invisible to guests (0 rows) and both currently-published real profiles render on `#players` and `#player/:slug` without private fields.

## Player Workspace feature-by-feature audit (2026-10-22)

Acceptance source: Product Specification §7.1 (player workspace), §7.2 (public page), §7.3 (digital card), plus the owner's explicit section list. Status key: **Implemented** (real UI/data flow + local tests), **Partial** (slice exists, required pieces absent), **Blocked** (cannot complete under current schema/policy or needs unapplied migration).

| Feature | Status | Evidence / reason |
|---|---|---|
| Overview: photo/name, current team, profile completion, upcoming match, attention list | **Implemented** | `PlayerWorkspace.tsx` Overview tab + `profileCompletion`, `currentMembership`, `splitMatchesByTime`, `attentionItems` in `playerWorkspace.ts`; tested in `playerWorkspace.test.ts`. Upcoming matches depend on the owner-scoped read that migration 012 enables (012 is applied per the read-only remote history check; the browser behavior is not re-verified, so the feature is still unaccepted) → truthful unavailable state otherwise. |
| My Profile: edit name, island, photo (permitted details) | **Implemented** | `updatePlayerProfileDetails` updates only editable keys, scoped `.eq('id').eq('account_id')` under the migration-0010 owner policy; tests assert scoping, empty-name rejection, and zero-row failure. Photo is a URL field (no avatar storage bucket exists yet → upload is a documented gap, not faked). |
| My Profile: nationality, sports, position | **Blocked (migration prepared)** | Columns do not exist on `player_profiles` today. Migration `202610210013` adds them and is applied per the read-only remote history check (its tables were observed in the live schema). The form still shows a pending note and the loader degrades via `profileDetailsAvailable`; that pre-013 UI behavior has not been re-verified in a browser, so the feature is not accepted. |
| My Profile: date of birth / identification private | **Implemented by design** | DOB is deliberately **not** a `player_profiles` column (published rows are guest-readable), so it lives in owner-only `player_private_details` in migration 013. `PUBLIC_PLAYER_FIELDS` guard test still excludes any national/identity term. `PLAYER_PRIVATE_DETAIL_NOTE` surfaces this in the UI. |
| Account-level name/photo/location separation | **Implemented (boundary) / Partial (no Account page)** | Player Workspace only edits `player_profiles`; account-level edits belong to `profiles` via `upsertProfile` under Account → Edit Profile, which is not yet a dedicated page (out of this scope). The UI states this explicitly. |
| Digital Player Card: real profile + official statistics, public preview | **Implemented** | `src/components/PlayerCard.tsx` renders approved fields + `get_player_official_statistics` totals + documented rating; public preview links to `#player/:slug`. |
| Digital Player Card: sharing/download respecting publication | **Implemented** | "Copy public link" is disabled unless `is_published` (with explanation); "Download / print" prints only the card via `@media print` and never includes identification data. |
| My Teams: memberships, status, categories, links | **Implemented** | Teams tab lists `player_team_memberships` with team name/type/status/dates and published `#team/:slug` links; empty state when none. |
| My Tournaments: registration/roster status | **Blocked (migration prepared)** | `tournament_entries`/`roster_submissions` are operator/manager-scoped today, so a player sees none. Migration 013 adds player-scoped roster reads and is applied per the read-only remote history check; the tab still shows a pre-013 pending note that has not been re-verified in a browser. Derived tournament appearances/goals from statistics are shown now. |
| Matches & Statistics: upcoming/completed, official records | **Implemented** | Matches tab splits upcoming vs completed from confirmed participant rows and shows confirmed-only statistics; empty/unavailable states are explicit. Upcoming reads need migration 012, which is applied per the read-only remote history check (behavior not browser-verified). |
| Matches & Statistics: tournament/season/sport filters | **Implemented** | `filterOfficialStatistics` + select controls built from the real statistics rows; tested. |
| Rating: documented formula, tested, insufficient-data state | **Implemented** | First documented method defined in `src/lib/playerRating.ts` (confirmed statistics only, minimum-appearance threshold, clamped, transparent); no prior formula existed in spec or code. `playerRating.test.ts` covers totals, threshold, exact formula value, clamping, and zero-appearance denial. UI shows the method text and an insufficient-data state. |
| Documents & Eligibility: private storage, verification status, no public exposure | **Implemented (status) / Blocked (document-level status)** | Privacy & Help tab shows claim/verification status and states that documents stay in private storage readable only by authorized organizers/managers; correction/rejection info routes through notices and roster review notes. There is no player-readable per-document status field today; none is faked. |
| Invitations: real records + empty state | **Partial** | Invitations addressed to the player's verified email need the invited-person read policy in migration 013, which is applied per the read-only remote history check (read scope not browser-verified) → empty/pending state is truthful. |
| Team requests | **Blocked (migration prepared)** | No player-facing table existed; `player_team_requests` + owner/manager policies are in migration 013, which is applied per the read-only remote history check; the UI still shows a pre-013 pending state that has not been re-verified in a browser. |
| Correction requests (without editing confirmed records) | **Blocked (migration prepared)** | `player_correction_requests` + owner-scoped insert/read and operator review in migration 013, which is applied per the read-only remote history check; the policy test asserts players can never update matches/result versions. The UI still shows a pre-013 pending state that has not been re-verified in a browser. |
| Notifications: real records + empty state | **Implemented** | Requests & Notices tab lists the signed-in recipient's notifications and marks them read (recipient-scoped); tested. |
| Privacy: public/private boundary explained | **Implemented** | Privacy & Help tab lists never-public fields (national ID, contact, documents, DOB, payments, notes) and points to the publication control. |
| Help & Corrections entry | **Implemented** | Help tab explains correction flow, account-vs-player edit separation, and the rating method. |
| Owner-only publish/unpublish kept | **Implemented** | Retained in the My Profile tab from the prior review; scoping unchanged and still covered by `player-publication.test.ts`. |

Verification: typecheck, lint, build, and 31 test files / 116 tests pass. Signed-out `#workspace` shows the sign-in gate. **The owner's browser test of the Player Workspace has not run yet — this section is not an acceptance.** Migration 013 is applied per the read-only remote history check (its three tables were observed in the live schema). That is schema/history verification only: this review pushed nothing and seeded nothing, and the Player Workspace has not been browser-accepted.

## Workspace navigation (Choose Workspace rule) — 2026-10-22

Replaces the old "a person with one authorized workspace goes directly to it" rule (Product Specification §4 updated).

| Requirement | Status | Evidence |
|---|---|---|
| After sign-in, always show Choose Workspace (never auto-open) | **Implemented locally** | `App.tsx` SIGNED_IN → `shouldOpenChooseWorkspace` sets `#workspace` (choose); `WorkspaceDirectory` (auto-selected `workspaces[0]`) removed. `workspace-nav.test.ts` asserts `#workspace` parses to choose and `resolveAuthorizedWorkspace(choose, …)` returns null (nothing auto-opens). |
| Show only authorized Player/Team/Organizer workspaces | **Implemented locally / Blocked live** | `WorkspaceChooser` renders `groupWorkspacesByKind(loadWorkspaceSummary result)`; the loader already returns only RLS-authorized workspaces. |
| Per-type onboarding only for missing types | **Implemented locally** | `workspaceKindsNeedingOnboarding` drives Create Player Profile / Create/Join Team / Create Organization; test asserts onboarding shows only for kinds with zero workspaces. |
| Player opens only Player tools; Team/Organizer tools excluded | **Implemented locally** | `App.tsx` renders `PlayerWorkspace` for `kind === 'player'`; RecordCreator/TournamentCockpit/OperationsPanel render only inside the Organizer branch; Team branch shows a note pointing to the Organizer workspace. |
| Multiple teams/organizations → choose the specific one | **Implemented locally** | `WorkspaceChooser` lists every authorized team/org card; test asserts multiple teams stay selectable. |
| Visible Switch Workspace control (no sign-out) | **Implemented locally** | Header button + workspace-heading button set hash to `#workspace` (choose) without calling signOut. |
| Authorization kept on every protected action; switching grants nothing | **Implemented locally / Blocked live** | `resolveAuthorizedWorkspace` only matches the authorized list and returns null otherwise (authorization-denial test); no RLS/schema changed; every query/action still runs under existing RLS. |
| Refresh restores current authorized route; new sign-in/Switch shows Choose | **Implemented locally** | Selection is hash-derived and recomputed against the authorized list on load; `shouldOpenChooseWorkspace` returns false for INITIAL_SESSION/TOKEN_REFRESHED (refresh) and true only for a fresh SIGNED_IN. Tests cover both. |

Verification: typecheck, lint, build, and 32 test files / 132 tests pass (new `workspace-nav.test.ts`). Signed-out `#workspace` smoke-verified in the browser: renders the sign-in gate with no console errors. Signed-in Choose Workspace flow is **owner-pending — not an acceptance**. No demo data and no production change from this review, which applied no migration; migrations 012 and 013 are applied per the read-only remote history check, and 014 remains pending.

## Player detail page (public) — 2026-10-22

Requirement source: Product Specification §7.2 (public player page) and §7.3 (digital player card). Route `#player/:slug`. The separate `#history/:slug` route now has its **own** component (`PlayerHistoryDetail`) and is reviewed in its own section below.

| Requirement | Status | Evidence |
|---|---|---|
| Loads only published profiles + approved public fields | **Implemented locally / Verified live** | `getPublishedDetail(player)` selects `PUBLIC_PLAYER_FIELDS,is_published` and filters `is_published = true`. Live anonymous REST confirmed both real published profiles render with only display_name/island/photo/slug/is_claimed — no national ID, contact, documents, payments, or account identifiers. |
| Public identity, approved photo, island, verified-claim note | **Implemented locally / Verified live** | `PlayerPublicDetail` renders name, island, a "Verified profile" note, and the photo or an initials fallback (both real players currently have no photo → initials "AS"/"SJ" show). |
| Digital player card | **Implemented locally / Verified live (empty data)** | Reuses the tested `PlayerCard` with real profile + `get_player_official_statistics` totals/rating. The card renders; the RPC now answers HTTP 200 with an empty array (see corrected blockers below) and neither published player has statistics, so the rating shows the insufficient-data state truthfully. |
| Public team affiliations (+ links) | **Implemented locally / Verified structure** | `getPlayerHistory` reads published `player_team_memberships`; each affiliation links to `#team/:slug`. Both real players currently have 0 published affiliations → truthful empty state. |
| Confirmed statistics (+ filters) | **Implemented locally / Verified live (empty data)** | Statistics section with sport/team filters (shown only when the data supports them). The RPC returns HTTP 200 with zero rows and there is no published statistics data, so the page shows a truthful "No confirmed public statistics are available yet." empty state — verified in a real browser for both published players. |
| Achievements and trophies | **Implemented locally / Verified live (empty data)** | New `getPlayerAchievements` reads `sport_milestones` for the player. The table is empty, so a guest read succeeds and the page shows a truthful "No published achievements are available yet." state. The underlying milestone policy state is indeterminate (see corrected blockers below) and cannot be exercised without a row. |
| History/statistics filters where supported | **Implemented locally** | `playerPublicSportOptions`/`playerPublicTeamOptions` + `filterPlayerPublicStatistics`/`filterPlayerPublicHistory` (pure, tested); filter controls render only when there are 2+ distinct options. |
| Links to related team/tournament/history pages | **Implemented locally** | Team affiliations link to `#team/:slug`; a "View full history & statistics" button links to `#history/:slug`; "Back to Players" and a `#players` back link. Tournament links from statistics are not added because the RPC does not expose tournament slugs and statistics are currently unavailable. |
| Loading / error / empty / missing / unpublished states | **Implemented locally / Verified live** | Loading state, a "not publicly available yet" warning for blocked sections, per-section empty states, and a not-found state for an unknown/unpublished slug (handled by `PublicPage`). |
| No private data; view-only for guests | **Implemented locally / Verified live** | Only `PUBLIC_PLAYER_FIELDS` are selected; a private-data note lists never-shown fields; no write controls. Live anonymous check confirmed no private leakage. |

### Two pre-existing defects — status CORRECTED 2026-10-22 (read-only re-verification)

Both were live and reproducible when originally recorded. A fresh read-only anonymous probe on 22 October 2026 found the **statistics** defect no longer reproduces, and the **milestone** defect is now **indeterminate**. Neither was fixed by this review — the assistant applied and pushed nothing.

1. **`get_player_official_statistics` — NO LONGER reproducing.** It was observed failing with `42804 structure of query does not match function result type` ("Returned type numeric does not match expected type bigint in column 9"): the four event-total columns resolve to `numeric` from `sum(bigint)` while the function declared them `bigint` (columns 9-12; columns 6-8, including `sum(minutes)`, already matched). **Now it returns HTTP 200 with an empty array** for both published players, and HTTP 400 only for a non-existent player id (the expected `player_not_public` guard). An isolated PostgreSQL dry run reproduced the 0008 body and confirmed it raises the type error in **all four** tested combinations — zero rows and one row, with `minutes` as both `integer` and `bigint`. Because an empty result set still triggers the check, **the live function can no longer be the 0008 version** — its definition has changed since the original observation. The assistant cannot determine from anonymous access whether the owner applied `202610220014` (or an equivalent fix) by another route; **the owner should confirm**.
2. **The public `sport_milestones` read — now INDETERMINATE.** It was observed erroring with `42501 permission denied for function is_tournament_operator`, because the `operators manage milestones` policy calls `is_tournament_operator` (revoked from `anon`); migration `202610210011` fixed this pattern on other tables but missed milestones, and it also breaks achievements on the public team page. **A guest read now returns HTTP 200**, but `sport_milestones` is **empty** for both players, and an isolated dry run confirmed an empty table yields a successful read *without* evaluating the operator policy — so this **does not** prove item 2 is applied. The policy state cannot be settled without a row to exercise it.

Either way, **neither published player currently has any statistics, team history, or milestones**, so the public pages render truthful empty states rather than errors. This is a data absence, not a rendering failure.

> **Follow-up (23 October 2026):** the owner was asked directly whether 014 (or an equivalent) was applied and replied **"not sure — I'll check."** The question is therefore still open: the live RPC's changed behaviour remains unattributed, and this file must not be read as confirming either that 014 is applied or that it is not.

**Prepared, NOT applied:** review-only migration `202610220014_public_player_statistics_fixes.sql` casts the RPC aggregates to their declared types and scopes the milestones operator policy to `authenticated` (so the public read policy applies cleanly for guests). It still needs owner approval before it can be applied; nothing was pushed or run against production by the assistant. If the owner has already applied an equivalent fix, this file should be reconciled against the live definition before any further action.

Verification: typecheck, lint, build, and 33 test files / 156 tests pass (new `player-public-detail.test.ts`). Live anonymous verification of both real published players. **The owner's browser test of the Player detail page has not run yet — this section is not an acceptance.**

## Player history & statistics page (public) — 2026-10-22

Requirement source: Product Specification line 373 ("They can filter his goals by club, island, national team, tournament, or season") plus §7.1–§7.3. Route `#history/:slug`, rendered by the dedicated `PlayerHistoryDetail` component in `src/components/PublicPage.tsx`.

| Requirement | Status | Evidence |
|---|---|---|
| Own page, no self-referential loop | **Implemented locally / Verified live** | The route previously re-rendered `PlayerPublicDetail`, so its "View full history & statistics" button linked to the page already on screen — a loop with no way back. The route now dispatches to `PlayerHistoryDetail`, which links "Back to player profile" (`#player/:slug`) and "Back to Players"; the player summary keeps its forward link. Verified by clicking through both directions in a real browser, plus a source-level regression test. |
| Filters: team level (club/island/national), tournament, season, sport | **Implemented locally / Verified structure** | New pure helpers in `src/lib/publicData.ts`: `playerPublicTeamLevelOptions`, `playerPublicTournamentIdOptions`, `playerPublicSeasonIdOptions`, `labelledFilterOptions`, `filterPlayerHistoryStatistics` (all tested). Controls render **only** when the data offers 2+ distinct options — no player currently has statistics, so no filter renders rather than showing dead controls. |
| Filter labels are real published names | **Implemented locally** | `getPlayerHistoryFilterLabels` resolves tournament `id,name,slug` from published rows only and season `id,name`. An id is never shown as a raw label when its name cannot be resolved; `seasons` has RLS enabled with **no** public select policy, so guest season-name reads return nothing and the season filter stays hidden instead of leaking an internal identifier. |
| Statistics table with related links | **Implemented locally** | Per-row table (team, level, sport, tournament, apps, starts, minutes, goals, assists, yellow/red) inside `.table-wrap`. Tournament cells link to `#tournament/:slug` using the **slug** resolved in the label pass — public detail routes resolve by `slug`, so a uuid link would have hit the not-found state (caught and fixed during this review). Team history entries link to `#team/:slug`. |
| Links back to the player profile | **Implemented locally / Verified live** | "Back to player profile" (`#player/:slug`) and "Back to Players" buttons at the foot of the page; verified in a real browser on both published players. |
| Unpublished profiles and private data stay hidden | **Implemented locally / Verified live** | Loader path is unchanged (`getPublishedDetail` filters `is_published = true`; `getPlayerHistory`/`getPlayerAchievements`/RPC guard are unchanged). A private-data note lists never-shown fields; no national ID, contact details, documents, payments, account identifiers, or internal notes are rendered. Not-found state verified for an unpublished/unknown slug. |
| Loading / error / empty / not-found states | **Implemented locally / Verified live** | Loading state while the three loaders run; per-section empty states; the "not publicly available yet" warning appears only when a loader actually errors; `PublicPage` renders "Public record not found" for an unknown slug — all four exercised in a real browser. |
| Mobile usable | **Implemented locally** | Reuses existing responsive primitives only: `.public-filters` collapses to one column at ≤600px, `.table-wrap` scrolls horizontally, `.public-state`/`.public-history` are already fluid. No new fixed-width markup. |
| Statistics/achievements shown truthfully | **Implemented locally / Verified live (empty data)** | Neither published player has statistics, team history, or milestones, so all three sections render honest empty states — no fabricated rows. The statistics RPC now answers HTTP 200 `[]` rather than the previously recorded `42804`, and the milestone policy state is indeterminate because the table is empty (see the corrected blockers in the section above); the owner should confirm whether 014 was applied. |

Verification: typecheck, lint, build, and 33 test files / 156 tests pass (new filter-helper, label-loader, and route-regression tests in `player-public-detail.test.ts`). Browser-checked in this session against both real published players ("Ali shiyam", "setico jr") and a bogus slug. **No migration was applied or pushed, no data was created or altered, and RLS was not weakened. The owner's browser test of this page has not run yet - this section is not an acceptance.**

## Matches listing page (public) — 2026-10-23

Requirement source: Product Specification line 110 (public visitors browse matches/results, view-only), line 314 (only confirmed records count as official history), section 5.4 (fixtures, venues, officials, match status), and the Development Plan's public "Live"/results navigation. Route `#matches`, rendered by the dedicated `MatchList` component in `src/components/PublicPage.tsx` (previously the generic `PublicList`).

| Requirement | Status | Evidence |
|---|---|---|
| Shows only matches the public RLS permits guests to view | **Implemented locally / Verified structure** | RLS policy `published matches are public` (0005, unchanged by 0011): `status = 'confirmed'` AND the owning tournament `is_published`. The loader (`getPublishedMatches`) mirrors the status filter and requests only `PUBLIC_MATCH_FIELDS`, ordered `scheduled_at` desc. Live guest probe 2026-10-23: HTTP 200, 0 rows; browser network log shows the identical query. |
| Match status clearly labeled; scores official only when confirmed | **Implemented locally / Verified live (empty data)** | Badge text and tone come from `matchStatusLabel`/`matchStatusClass` applied to each record's own status (all guest-visible rows are `confirmed`). Scores exist only in `match_result_versions.score`; that table has **no guest SELECT policy** (0005 as amended by 0011 - authenticated participants/operators only; guest probe 2026-10-23 returns HTTP 200 `[]`), so the listing never shows a score and says so truthfully in a policy note. No score is fabricated. |
| Search/filters (sport, tournament, team, date) only when the real data supports them | **Implemented locally** | Search renders only when matches exist; sport/tournament/team/date selects render only with 2+ labelled options; a status filter is deliberately absent because the public policy admits exactly one visible status. Sport labels come from the owning tournaments (matches carry no sport column); the date key is the local calendar day. With 0 public matches the page shows **0 filter controls** (verified in browser). |
| Correct links to match detail and related public tournament/team pages | **Implemented locally / Verified structure** | Card title links `#matches/:id` (detail loader uses the same field boundary and confirmed-only filter, test-asserted); tournament links `#tournament/:slug` and team links `#team/:slug` using slugs resolved in the label pass, because public detail routes resolve `.eq('slug', ...)` - uuid links would land on not-found. |
| Loading, error, empty, and no-results states | **Implemented locally / Verified live** | Parent loading ("Loading published records..."), a label-loading state, a label-failure warning that hides affected filters/links, and two distinct messages: "No published matches are available yet." (empty) vs "No matches match these filters." (no results). Not-found verified for `#matches/<unknown-id>`. |
| Mobile-friendly and view-only for guests | **Implemented locally / Verified live (502px)** | Reuses existing responsive primitives (`.public-filters` collapses to one column at <=600px, `.public-grid` at <=420px). View-only: the component contains zero buttons, mutations, auth actions, or workspace controls (source-level test). A 502px-wide viewport screenshot shows correct rendering with no horizontal scroll; not device-tested, and the populated card grid is not visually verified (no data exists). |
| No private notes, documents, payments, or workspace controls | **Implemented locally** | `PUBLIC_MATCH_FIELDS` is asserted to equal exactly `id,tournament_id,stage_id,category_id,home_team_id,away_team_id,scheduled_at,venue,status` - no score, note, document, payment, `created_by`, email, or phone. The matches table carries no such columns; the score-bearing tables are unreadable by guests; the component renders no controls. |
| Populated match behavior | **BLOCKED - no public data** | Guest probes 2026-10-23: `matches` 0 rows, `match_result_versions` 0, `match_events` 0, `match_player_participants` 0, published tournaments 0, published teams 0, `standings_snapshots` 0. Card rendering, filter interaction, and status/score display **with real rows are not browser-verified**; unit tests with isolated fixtures cover the logic only. This section must not be read as verifying populated behavior. |

Verification: typecheck, lint, build, and **34 test files / 182 tests** pass (new `public-matches.test.ts`, 26 tests: loader boundary, label loader, option/filter logic, display helpers, route parsing, component source assertions). Browser-checked 2026-10-23 at `#matches` (fresh load and SPA hash transition), `#matches/<unknown-id>` not-found, and a 502px-wide viewport; console had 0 errors (the pre-existing GoTrueClient multi-instance warning and the site-wide favicon 404 also appear on owner-passed pages such as `#players`/`#teams`).

Observation for later (not changed in this review, out of scope): the homepage "Live Now"/"Today's Matches"/"Recent Results" card titles still interpolate the raw `home_team_id` uuid (`HomepageSections.tsx`), which would display uuids once matches exist; they render fallback text today only because no matches are public.

**No data was created or altered, no migration was applied or pushed, and RLS was not weakened. The owner's browser test of this page has not run yet - this section is not an acceptance.**

## Match detail page (public) — 2026-10-23

Requirement source: Product Specification section 3.4 line 110 (public visitors browse matches and results view-only), section 5.4 lines 172-178 (a match includes tournament, teams, scheduled date/time, venue, status, assigned officials, score and events, result confirmation state), line 182 (only confirmed results are official), and the Development Plan. Route `#matches/:id`, rendered by the rebuilt `MatchPublicDetail` component in `src/components/PublicPage.tsx`.

| Requirement | Status | Evidence |
|---|---|---|
| Loads only matches the public RLS permits guests to view | **Implemented locally / Verified structure** | `getPublishedMatch` selects `PUBLIC_MATCH_FIELDS` filtered `id = <slug> AND status = 'confirmed'`; the RLS policy `published matches are public` additionally requires a published owning tournament. Anonymous probe with a bogus id (2026-10-23): HTTP 200, 0 rows (renders not-found). |
| Shows teams, tournament, date/time, venue, status when publicly available | **Implemented locally** | Resolved "Home vs Away" heading (`matchPairTitle`, fallback "Published team", never a raw uuid), formatted date/time (`formatMatchSchedule`, never the raw ISO string), and a `.match-detail` fact sheet: home team, away team, tournament, venue, status badge (`matchStatusLabel`/`matchStatusClass`). Team/tournament labels come from `getPublishedMatchLabels`: published rows only, fixture-scoped ids, name **and** slug required before a label or link is produced. |
| Scores and events only when genuinely accessible to guests | **Verified: not accessible - nothing shown** | RLS is enabled on `match_result_versions` and `match_events` (0005 lines 132-133), and every current policy on those tables - plus `match_official_assignments`, `competition_stages`, `tournament_categories` - is scoped `to authenticated` (0011), so guest queries always return zero rows. Anonymous probes 2026-10-23: all five tables HTTP 200, 0 rows. The component contains no score or event rendering (source test), so no score can ever be fabricated or shown prematurely. |
| Clearly explains unavailable information | **Implemented locally** | An "Official result and events" state block states what is public for this match (teams, tournament, date/time, venue, status), what is not (scores, events, assigned officials, stage/round and category names, result change history), why (current public data policies), and who can see it (signed-in match participants and organizers). A private-data note lists never-shown fields (documents, contacts, payments, internal notes, result submitters and confirmation reasons, event recording metadata, account identifiers, workspace controls). |
| Related public team and tournament links use valid slugs | **Implemented locally** | Home/away link `#team/${encodeURIComponent(slug)}`, tournament link `#tournament/${encodeURIComponent(slug)}`, plus "Back to Matches" (`#matches`). The label loader refuses rows without a slug, so a uuid can never become a link target. |
| Loading, error, not-found, truthful empty states | **Implemented locally / Verified live (not-found)** | Parent states unchanged (loading, loader error, "Public record not found" for an unknown id - verified in browser, 0 buttons). Component adds label-loading `Loading` and a label-failure warning that hides links instead of guessing, plus truthful fallbacks (`Venue not published`, `Tournament not published`, `Published team`). |
| View-only, private fields hidden, mobile | **Implemented locally / Verified (view-only + mobile CSS)** | Component contains no buttons, inputs, or mutations (source test; browser shows 0 buttons in `main`). The loader boundary test forbids score, result-history, event, official, and account columns, and the component never reads `record.score`/`submitted_by`/`confirmed_by`/`payload`/`recorded_by` (test). `.match-detail` stacks to one column at <=600px (CSS added); the populated layout is not visually verified without data. |
| Populated match detail behavior | **BLOCKED - no public data** | There are **0 public matches**, so the populated detail page was **not** browser-tested. Rendering of teams/tournament/venue/status/links with real rows is covered by unit tests with isolated fixtures and code review only, and must not be read as browser-verified. |

Verification: typecheck, lint, build, and **35 test files / 197 tests** pass (new `public-match-detail.test.ts`, 15 tests: confirmed-only detail loader and column boundary, fixture-scoped label loader, **migration-pinned assertions** that RLS is enabled on the score/event/official/stage/category tables and that every current policy on them is `to authenticated` - so the on-page explanation cannot drift away from schema reality - plus source assertions for privacy, status/result handling, slug links, states, and view-only). Browser-checked 2026-10-23: unknown-id not-found, matches listing unchanged, and regression checks confirming `#history/:slug` and `#player/:slug` still render correctly after the `PublicDetail` dispatch change (the player summary keeps its "View full history" forward link); console had 0 errors (only the pre-existing GoTrueClient multi-instance warning).

Observation for later (not changed in this review, out of scope): `TournamentPublicDetail`'s match links and `BracketPage` card titles still interpolate the raw `home_team_id` uuid and need the same resolved pair-title treatment when those pages are reviewed.

**No data was created or altered, no migration was applied or pushed, and RLS was not weakened. The owner's browser test of this page has not run yet - this section is not an acceptance.**

## Organizer workspace creation blocked by RLS (defect + prepared fix) - 2026-10-23

Report by the owner: creating an Organizer workspace (Choose Workspace -> Create -> Organizer) fails with `new row violates row-level security policy for table "organization_memberships"`. Requirement source: Product Specification section 3.2 (workspace selection) and the Development Plan onboarding flow. The failure is server-side (production RLS); no client-side defect causes it.

| Item | Status | Evidence |
|---|---|---|
| Organizer creation works | **BLOCKED - production RLS defect** | `createOrganization` (records.ts) inserts the organization (policy `created_by = auth.uid()` passes, proving a valid session and `auth.uid()` = app userId), then the owner membership - whose insert policy "organization creator assigns self owner" (0002) requires `exists (select 1 from organizations o where o.id = organization_id and o.created_by = auth.uid())`. That subquery runs as the user and is RLS-filtered on `organizations`, whose only SELECT policy ("published organizations are public", 0001) needs `is_published` (default false) or an existing membership row - neither can be true for the first membership of a brand-new unpublished organization. The exists() is therefore always false, and the reported error is exactly what Postgres returns. |
| Team creation works | **Predicted broken (identical shape)** | "team creator assigns self as manager" (0002) requires `exists (select from teams ... created_by = auth.uid())`; teams' only SELECT policy ("published teams are public", 0001) is the same published/member form; `teams.is_published` defaults to false. Same chicken-and-egg. |
| Tournament creation works | **Downstream-blocked** | "organization operators create tournaments" (0003) requires an organization membership with role owner/operations, which cannot exist until Organizer creation succeeds. |
| Fix without weakening guest RLS | **Prepared: `202610230015_organization_team_creator_read.sql` - NOT applied, NOT pushed** | Two additive SELECT policies (`created_by = auth.uid()`, scoped `to authenticated`) on `organizations` and `teams`: only the signed-in creator gains read access to rows they created; anon's policy set is untouched and public pages keep the published-only policies. Pinned by 9 tests in `workspace-creation-rls.test.ts` (defect conditions, exact fix content, purely-additive shape). **Awaiting the owner's explicit approval before any application.** |
| App-side workaround | **Rejected as unsafe** | Creating with `is_published: true` would satisfy the exists() branch but permanently expose the workspace: `organizations` has no UPDATE policy to unpublish it afterwards. A service-role Edge Function would be a larger unapproved production change. |
| Onboarding UX | **Improved locally** | RLS failures for the organization/team choices now map to a truthful message ("A reviewed policy fix is prepared but not yet applied; do not manually edit the database or bypass RLS"), mirroring the existing player-choice mapping. |
| Orphaned rows from failed attempts | **Owner's call - untouched** | Each failed attempt leaves one unpublished organization row (insert succeeded before the membership failed). No RLS-authorized role can read such rows (guest probes 2026-10-23: 0 organizations/teams/memberships visible); only the Supabase dashboard or service role can list/clean them. No cleanup was performed or attempted. |

Verification: typecheck, lint, build, and **36 test files / 206 tests** pass. The defect could not be reproduced from this side (creation requires the owner's signed-in session, and no writes to production are permitted); the root cause is proven by elimination from the code, the applied policy files, and the shape of the returned error. Browser re-test of the Organizer creation flow becomes possible only after the fix migration (or an equivalent reviewed policy) is approved and applied.

**No migration was applied or pushed, no production policy was changed, no data was created or altered, and RLS was not weakened. This defect is BLOCKED pending the owner's explicit approval of migration 015 - it is not an acceptance.**

## Organizer workspace layout spec vs current implementation - 2026-10-23

The owner provided a recommended layout specification for the Organizer Workspace (organization dashboard + tournament cockpit + setup screen + visual style + mobile + interaction rules). It is recorded verbatim as `doc/Kulhivaru_Plus_Organizer_Workspace_Layout_Spec.md` and is the working reference for that page-by-page review. This section is a read-only audit of what the running app contains today (source inspection of `WorkspacePanel.tsx`, `WorkspaceChooser.tsx`, `TournamentCockpit.tsx`, `OperationsPanel.tsx`, `CompetitionPlanner.tsx`, `MatchCenter.tsx`, `workspace.ts`, `tournament.ts`); **no workspace code was changed**.

**Current reality:** with an organization workspace open, `WorkspacePanel` renders one vertically stacked section: a heading (name + role + Switch Workspace), `RecordCreator` (create team / add unclaimed player / claim invitation), `TournamentCockpit` (draft-creation form, then an 11-step in-memory setup stepper with application/roster/payment forms addressed by manually typed ids), and `OperationsPanel` (expense form, CSV exports, notification sender, staff assign/revoke by typed ids). There is no top bar, no left navigation, no dashboard, no tournament list, and no routed cockpit.

| Spec area | Status | Evidence / gap |
|---|---|---|
| Dashboard: top bar (org switcher, search, alerts, account menu) | **Missing** | Only a workspace heading with a Switch Workspace button (`WorkspacePanel` line 28). |
| Dashboard: left navigation, permission-filtered | **Missing** | No navigation component exists for workspaces; the only routing is the workspace hash. |
| Dashboard: page heading with welcome, date, Create Tournament | **Partial** | Heading shows name/role; Create Tournament exists only as the "Create private tournament draft" form inside the cockpit, not on a dashboard. |
| Dashboard: attention panel | **Missing** | None. |
| Dashboard: summary cards from real data | **Missing** | None. |
| Dashboard: tournament section (cards/table, status tabs) and resumability | **Missing (incl. a live defect)** | No tournament list exists; a draft's id lives only in component state, so after a page reload an organizer **cannot reopen an existing draft** at all. The spec's tournament section plus a list loader is the structural fix. |
| Dashboard: recent activity | **Missing** | `audit_events` exist server-side but nothing surfaces them to the dashboard. |
| Cockpit: header with status, dates, open-public-page, next action, progress | **Partial** | Cockpit shows name, "PRIVATE DRAFT" badge and raw Draft ID; the stepper's complete marks are the only progress cue; no status/dates line, no public-page link, no next-action button. |
| Cockpit: tabbed navigation (12 tabs) | **Partial** | Capabilities exist but are untabbed and stacked: setup steps, `CompetitionPlanner` (draw/fixtures), `MatchCenter` (officials/events/results), finance/reports/staff/notifications in `OperationsPanel`. Applications, Teams & rosters, Standings, Media, and Settings views are absent (application review requires typing an entry UUID). |
| Setup: 11 steps, statuses, validation, publish gating | **Partial (aligned list)** | `SETUP_STEPS` has the spec's 11 steps in matching order (minor label drift: "Registration form" vs "Registration questions", "Rules and standings" vs "Rules and tie-breakers"); per-step save with completion marks exists; no Not started/In progress/Complete labelling, no validation issues per step, no auto-save, publication only through step 11. |
| Visual style (navy/turquoise/glass, status colors, one primary action) | **Partial** | Existing app theme (turquoise accents, glass-style public cards) is reused; workspace screens are generic forms without the status-color system, and the cockpit shows several primary actions per screen. |
| Mobile layout | **Partial** | Forms are already single-column and app-level media queries exist; no menu button/bottom navigation, no table-to-card treatment (no tables yet). |
| Interaction rules (real counts, per-item links, confirmations, restricted documents) | **Partial** | RLS scopes every action; success notices and error retry exist; private documents upload with restricted metadata. Missing: counts/lists to link from, and confirmations for consequential actions (publish, reject application, payment status change) are not implemented. |

**Blockers before any implementation or owner testing of this spec:**
1. **Migration 015 is still awaiting the owner's explicit approval** (see the defect section above). Until an Organizer workspace can be created, every dashboard/cockpit screen is unreachable in production - and this audit could not be browser-verified for the same reason; it is source-level only.
2. **Zero real data** (guest probes 2026-10-23: 0 organizations, 0 tournaments, 0 entries). The spec's own interaction rule ("counts must come from real authorized records; do not show fake tournament cards") means dashboard counts/cards can only be owner-tested after a real organization and tournament exist - created by the owner through the app, never seeded by the assistant.
3. Tournament creation is downstream-blocked by organization creation.

**Recommended review order once unblocked:** Organization dashboard (overview, tournament list with reopenable drafts, attention/summary panels) first, then the Tournament cockpit as routed tabs over the capabilities that already exist. No workspace implementation was started this turn; nothing here is an acceptance.

**No migration was applied or pushed, no production policy was changed, no data was created or altered, and RLS was not weakened. Owner decision required (015 approval + review order) before workspace work begins.**

**Update 2026-10-23 (same day):** the owner **approved applying 015** and chose the **Organization dashboard first** as the workspace review order. Deployment path was evaluated from this machine: the Supabase CLI (2.118.0) is linked to project qmxpokmvmlqfswnjcgke but holds no access token, and `supabase db push` would also carry the unapproved pending 014 - so the approved application path is the owner running the two statements from `202610230015_organization_team_creator_read.sql` in the Dashboard SQL Editor. Status: approved, application pending the owner's run; verification afterwards = the owner retrying Organizer creation in the app, plus assistant-side guest probes that must still show 0 organizations/teams visible (proving the new policies are creator-scoped and expose nothing to guests). 014 remains pending and unapproved - untouched. The blockers above now reduce to: (1) apply 015 via SQL Editor, (2) the owner creates a real Organizer workspace through the app - after which the dashboard implementation/review begins.

## Organizer Workspace — post-implementation gap status (2026-10-23)

The dashboard and tournament cockpit described by the layout spec have now been **implemented locally** against the existing schema and policies, with no schema change, no new table, and no seeded data. This re-audits the gap table above. Everything below is **source-and-test verified only** — the signed-in workspace could not be exercised in a browser by the assistant (session expired; the assistant does not sign in with the owner's account or create records on the owner's behalf), and no organization exists yet, so nothing here is an acceptance.

| Spec area | Before | Now | Evidence / remaining gap |
|---|---|---|---|
| Top bar (logo, organization switcher, search, notifications, account, Switch Workspace) | Missing | **Implemented** | `OrganizerWorkspace.tsx` header: brand, organization `<select>`, teams/players search, notifications popover with unread badge, account menu, visible Switch Workspace. Not browser-verified signed-in. |
| Left navigation, permission-filtered | Missing | **Implemented** | `organizerNav` gated on real org roles + staff permissions (unit-tested: media loses staff/reports/profile/settings; a `staff` member with the `finance` permission gains Finance). Hidden sections render an explicit permission-denied panel. |
| Dashboard (identity, create action, counts, attention list, Next Action, recent activity) | Missing | **Implemented** | Overview shows identity, Create Tournament (owner/operations only), six **separate** summary cards (applications/rosters/payments/matches never merged), a single prominent Next Action derived from real rows, an attention list where every row carries its owning tournament + target tab, and recent activity from `audit_events`. Honest empty states throughout. |
| Tournament list with reopenable drafts | Missing (live defect: draft id lost on reload) | **Implemented** | `loadOrganizationTournaments` reads real rows; cards show name/sport/status/updated/progress/next action. The reload defect is fixed because the draft is a database row addressed by id, not component state. |
| 11-stage resumable setup with progress/validation/save state/Next Action | Partial (in-memory stepper) | **Implemented** | Real `tournament_setup_steps` rows via `saveSetupStep`; stepper seeds each stage from its row and resumes after reload; `validateSetupStep` gates saves; Stage 1 writes name/sport to the `tournaments` row; Stage 2 persists `tournament_categories`; Stage 3 writes registration settings; Stage 4 adds real registration questions; Stage 11 reviews and publishes. |
| Separate application / roster / payment review with approve, reject, request-changes, roster locking | Missing | **Implemented** | Applications tab: approve/reject/request-changes per entry. Teams & rosters tab: roster approve/lock kept **separate** from the application decision, plus organizer-entered teams. Payment status is displayed per entry; changing it stays in the tested finance path. |
| Search existing teams/players before creating to avoid duplicates | Missing | **Implemented** | `sanitizeSearchTerm` + `searchExistingTeams`/`searchExistingPlayers` (short/blank terms return empty **without querying**); Teams and Players sections search first and offer "Link to organization"; searches return only published teams plus teams the account manages — all the database exposes. |
| Formats, draws/byes/preview/tie-breakers, versioned fixtures | Partial (CompetitionPlanner existed) | **Reused, not extended** | Draw & fixtures tab reuses the existing, tested `CompetitionPlanner` and surfaces the eligible-team count (approved entries only). No new format logic was added — nothing beyond what was already implemented and tested. |
| Officials + match operations with offline queue where supported | Partial (MatchCenter existed) | **Reused, extended** | Matches tab lists real fixtures with per-match **submit → confirm → correct** wired to the tested `matchCenter` RPCs; correction requires a reason; the existing offline-capable `matchCenter`/`matchOperations` libs are unchanged. |
| Results submit/confirm/correct with audit; only confirmed results update standings | Partial | **Implemented** | Confirm is a distinct step from submit; `loadLatestResultVersion` resolves the pending result so no id is typed; standings tab states confirmed-only + versioned recalculation. Live behavior still unverified (no fixtures exist). |
| Postponement/cancel with reason + notification, completion checks, archiving without losing history | Missing | **Implemented** | Settings tab: confirmation dialogs for consequential status changes; `tournamentCompletionBlockers` blocks "Complete tournament" with a stated reason while any match is unresolved; archiving keeps the public history (per existing public-read policies). Notification composing is available via the Settings section's participant form. |
| Header/identity, status-color system, mobile layout, interaction rules | Partial | **Implemented** | `src/organizer.css`: status pills always print their own word (colour is never the only signal), liquid-glass direction, mobile breakpoints at 900/600/420 px, nav collapses to a menu toggle. Also repaired a pre-existing defect: `.outline-button.dark` was **undefined**, so every `outline-button dark` on a light background rendered white-on-white. |

**Still genuinely missing or unverified (honest remainder):**
- **Browser acceptance** of every row above — blocked on the owner signing in and owning an organization.
- **Migration 015** is still not applied, so organization creation still fails; the dashboard cannot be reached in production until the owner runs it.
- **Standings display** is explanatory only: with no draws and no fixtures, there is nothing to render, so the standings table itself is unproven.
- **Media/finance dashboards** beyond the reused finance/reports/staff forms were not specified in the layout spec and were not built.
- **Dhivehi/RTL** remains structural readiness only (no translated strings added).
- Live Edge Function, email delivery, and live RLS acceptance tests remain blocked as previously recorded.

**Tests: 37 files / 292 pass (was 206/36). Typecheck clean, lint clean, build succeeds. No migration was applied or pushed, no production data was created or altered, and RLS was not weakened.**

---

## Tournament Overview (control centre) - gaps found while implementing, 2026-10-23

The owner's Tournament Overview layout specification was audited against the real schema before any code was written. Everything below is a **field or concept the specification asks for that the database does not hold**. None of it is shown in the UI, and none of it was invented. Each row needs an owner decision; the first would require an additive migration, which is prepared for review only and never applied by the assistant.

| Specification asks for | Schema reality | Handling | Needs |
|---|---|---|---|
| Tournament cover image | No column on `tournaments` | Omitted | Additive migration `cover_image_url text` |
| Tournament logo | No column on `tournaments` | Omitted | Additive migration `logo_url text` |
| Season | **Correction (23 Oct):** `tournaments.season_id` **does exist** - it is added by review-only migration `202610210008_histories_statistics.sql` (the first audit here only read the original CREATE TABLE in 0003 and missed later ALTERs). It references `public.seasons(id) on delete set null`. No migration needed; the remaining problem is that **nothing in the app writes `seasons` rows**, so a season picker would list nothing until seasons can be created somewhere | Reuse the existing column; surface the seasons-empty state honestly | A seasons creation flow, or an owner decision on who populates `seasons` |
| ~~Additive migration `season_id uuid references seasons(id)`~~ | superseded by the correction above | | |
| Island / atoll | No column on `tournaments` | Omitted | Additive migration `island text` |
| Main venue | No column; venue lives per-fixture on `matches.venue` | Omitted from the identity header; venue is still shown per upcoming match, where it genuinely exists | Additive migration `main_venue text`, or accept per-fixture venues only |
| Start and end dates | No columns | Omitted; only the **registration** window is shown, because `tournament_registration_settings.opens_at/closes_at` exist | Additive migration `starts_at` / `ends_at` |
| Organizer-entered vs team-submitted teams | `tournament_entries.submitted_by` is set for both an organizer's manual entry and a manager's application, so it cannot distinguish them | Omitted from the Teams card | Either a `source text` column, or accept the merged count |
| Waiting-list teams | No waiting-list concept anywhere in the schema | Omitted | New table or a status value; needs design, not just a column |
| Player eligibility status | No eligibility column on entries, rosters, or players | Omitted from the Rosters card and the readiness checklist (roster corrections are shown instead, which do exist) | New concept; needs design |
| Awards reviewed (completion readiness) | No awards table | Omitted from the completion checklist | New table, or drop from the specification |
| Unresolved dispute (completion readiness) | No disputes table | Omitted from the completion checklist | New table, or drop from the specification |
| Fixture schedule-conflict count | No conflict detection exists | Omitted from the Fixtures card | New derivation or a stored conflict flag |
| Outstanding MVR amount on the Overview | Exists on `tournament_payments`, but those rows are finance-restricted | Status **counts** only; the amount is deliberately not derived on the Overview | None - this is a deliberate permission decision, not a gap |
| Officials assigned (competition readiness) | `match_official_assignments` exists, but the Overview does not yet load it | The readiness item is **omitted when officials are unknown**, so it can never report a false failure | A small scoped loader (planned with the draw/staff pass) |

**Not a gap, but a specification/schema mismatch worth recording:** the specification lists Fixtures and Matches as two separate sources. This schema has a **single `matches` table** and no separate fixtures table (`competition_fixture_versions` is version history, not fixtures). Both Overview cards therefore read the same rows through two different lenses - scheduling completeness (venue, date, upcoming) and competition state (scheduled/live/awaiting/confirmed/postponed). They are honestly labelled rather than presented as independent data.

**Deliberately kept, per the owner's earlier decision:** the workspace's outer loader remains fail-fast. Section-level error handling was added **only** to the two new Overview reads (categories, confirmed scores), because this specification requires section-level failure handling for this tab (section 21, acceptance point 13).

**Updated test count: 37 files / 338 tests pass.**

---

## Tournament Overview revision - additional findings, 2026-10-23 (later the same day)

The owner issued a revised Overview specification (16 sections + acceptance checklist). It was implemented without any migration. New findings surfaced while reconciling it:

| Revised specification asks for | Reality | Handling | Needs |
|---|---|---|---|
| Recent activity showing **other users'** actions with their names (section 14) | `audit_events` has **no tournament column**, and its only SELECT policy is `actor_id = auth.uid()` - cross-user, tournament-scoped activity is impossible | The block shows the **caller's own** recorded actions and says so in the UI | Additive migration: `tournament_id` on `audit_events` (or a linking table) **plus** an operator-scoped SELECT policy - design decision needed on who may read whose activity |
| Fixtures card: Draft / Published / Conflicts | Fixture publication (`competition_stages.published_at`, `competition_fixture_versions.published_at`) is **never written by any app path**, and no schedule-conflict detection exists | The card shows only truthfully computed counts (total, unscheduled, missing venue); Draft/Published/Conflicts are omitted rather than shown as misleading zeros | Fixture publication flow (planned phase work), conflict detection design |
| "View All Tasks" | The attention list is not truncated and no standalone task view exists | Button omitted; no destination was invented | A tasks view, if the owner wants one |
| "View All Notifications" | No notification-inbox view exists anywhere in the app (only sender forms on the organizer Settings section) | Button omitted; the Overview shows the latest three + unread count only | An inbox destination |
| "Postpone" under More Actions | No postponed tournament status and no rescheduling flow | Not offered (a Cancel/Complete/Archive menu filters by status and routes to the Settings confirmations, which were extended with the real `cancelled` status) | Rescheduling design |
| Identity: season / island / start+end dates / cover / logo | Unchanged from the earlier audit; `starts_at` + `island` land with review-only migration 018, the rest has no columns | Still omitted until 018 is applied / columns exist | Owner application of 018; later phase work for the rest |
| "Missing official" warning on upcoming matches | `match_official_assignments` has RLS but **no policies and no app write path** | Existing warning list unchanged; officials state remains unknown | Officials policy + flow (planned phase work) |

**No migration was prepared or applied for this revision; no production data was touched. New loaders read only existing tables and columns.**
**Updated test count: 37 files / 349 tests pass.**

---

## Tournament Setup (one-step-at-a-time) - findings, 2026-10-23 (second revision)

The owner's one-step Setup specification reconciled against the implementation. Schema-level findings are unchanged from earlier rows (no `ends_at`/logo/cover columns; migration 018 ownership of `starts_at`/`island`). New behaviour-level findings:

| Specification asks for | Reality before this revision | Handling | Notes |
|---|---|---|---|
| Advance through stages 1-11 by saving | Stage 2 and Stage 4 had **no save control**, so they could never be marked complete - the ladder blocked at 4 | Save & Continue added to both (writes the existing step row; no new status value) | New write path; owner should exercise |
| Stage 11 completes on publish | Publishing did not touch `tournament_setup_steps`, so a published tournament still showed setup unfinished | Publishing persists step 11 complete | Deliberate, one-line write |
| "Saving the edit returns to the previous current step unless the change invalidates a later dependency" | No dependency inference exists between stages | Edit-save returns to the furthest stage reached; the invalidation case is **not detectable** with today's validators | Recorded as a limitation; a dependency model is phase work |
| "Skipped" stepper state | No skip concept exists in the schema | Not offered (inventing a state would fake data) | Could be added later as a real status value, if the owner wants skip flows |
| Stepper states by status | Only Complete/Blocked were rendered | Complete / Current / Needs attention / Upcoming rendered; future stages locked against stepper and deep links | Values map from the existing `not_started`/`in_progress`/`blocked`/`complete` |

**No migration was prepared or applied. Updated test count: 37 files / 353 tests pass.**

---

## Tournament Setup (nine-stage wizard) - findings, 2026-10-23 (third revision)

The owner's simple 9-step specification reconciled against the schema. The storage mapping needs **no** migration (stages map onto legacy keys [1..8, 11]; retired keys 9/10 are untouched). These findings need the review-only **migration 019** (or later phase work) before they can be implemented honestly:

| Nine-step specification asks for | Reality | Handling | Needs |
|---|---|---|---|
| Stage 2: category short description, active/inactive state, reordering | `tournament_categories` has only name/age_group/gender/team_limit/rules | Name/age/gender visible, add, and confirmed removal exist now; description, active state and reorder are **not rendered** (would fake data) | Migration 019 (`description`, `is_active`, `sort_order`); phase 2 wiring |
| Stage 2: prevent deletion when related real records exist | No table references `tournament_categories` from row data (entries have no category column), so no dependent record can block a delete today | Removal asks confirmation and surfaces any real database error; RLS keeps it operator-only | A real usage link (e.g. a `category_id` on entries) in a later phase if the owner wants delete blocking |
| Stage 3: maximum applications, late-application allowance | No columns | Not rendered | Migration 019 (`max_applications`, `allow_late_applications`) + cap checks in the entry path |
| Stage 3: "maximum approved teams" | `tournament_categories.team_limit` already exists and is summed by `loadRegistrationTeamLimit` | Reused; **no duplicate column added** | None (documented reuse) |
| Stage 4: fields settable required/optional/hidden; add/edit/remove custom fields; types incl. dropdown/multiple choice/file/date; Preview Form | `tournament_registration_questions` stores prompt/required/response_type (text, long_text, number, boolean, select)/options/sort_order; no hidden concept; no edit/remove loaders; no preview | Adding a question exists and works; per-field config, edit/remove and preview are phase 2 work | Migration 019 widens response_type with `date`; `file` needs storage wiring; a hidden-field convention needs design |
| Stage 4: link inactive until registration AND roster setup ready | Public page exists; the registration link is the tournament page URL | Copy link works anytime; **no gating flag** in schema | Reuse Stage-9 readiness; a link-enforcement flag can be added later if the owner wants link-level blocking |
| Stage 5: officials allowed, submission timing, changes before deadline, organizer approval, lock after approval | `tournament_registration_settings` has roster_min/max/deadline only | Min/max/deadline configurable now; the other five switches are **not rendered** | Migration 019 (five structured columns); phase 2 wiring |
| Stage 5: private identity data never public | Existing public read policies already exclude private identity reads (earlier audit held) | No behavior change in this revision | None new |
| Stage 6/8: "Set later" saved as an explicit deferred decision | `tournament_setup_steps.status` CHECK allowed only not_started/in_progress/complete/blocked | Migration 019 widens the CHECK with `deferred` (and `needs_review` for stage-invalidation marking); until applied, a Set-later save returns a real database CHECK error instead of pretending success | Owner applies 019 |
| Stage 7: sport-specific suggested rules, tie-breaker reordering, public-visibility flags | Rules live in stage JSON/free text; no structured rules storage | Stage 7 saves rules notes; sport-specific suggestions are phase 3 work | Structured rules design (owner decision) |
| Stage 8: venue records, unavailable dates/periods, rest rules, clash checks | `matches.venue` is a text field on rows; no venue table | Stage 8 saves dates + primary venue text to stage JSON | Venue table + clash detection (phase 3, owner decision) |
| Stage 9: a separate "Schedule Registration" button | Scheduling is inherent to Stage 3's saved dates; the launch stage shows the scheduled opening | Separate button not offered; the state is displayed truthfully | A delayed status-change flow only if the owner wants one |
| Dependency revalidation (sport/category changes mark later stages "Needs review") | No dependency model exists | Not implemented; `needs_review` value prepared by migration 019 | Phase 4 dependency map |
| Finance & Sponsors and Officials & Operations in setup | The owner's spec removes them from the wizard; both exist as real Staff/Finance management sections | Explicitly excluded from the wizard; stored rows under keys 9/10 untouched | None |

**No production data was touched. Migration 019 is review-only and must be applied by the owner before `deferred`/`needs_review` statuses and the new columns exist. Updated test count: 37 files / 364 tests pass.**
---

## Stage 4 — Registration Form: recheck findings, 2026-10-24

The ready-made registration form specification was rechecked against the app. The organizer-side is now built (see Implementation Status); these items **cannot** be done on the organizer side alone and stay out of the UI until their pieces exist:

| Specification asks for | Reality | Handling | Needs |
|---|---|---|---|
| Standard field "Island and atoll" | `teams.island` exists; **no atoll column anywhere** | Island shown with real provenance; atoll deliberately absent (not faked) | A column on `teams` if the owner wants atoll captured |
| Standard field jersey colours (first/second) | No jersey colour columns | Shown with an honest "no column exists yet" note | Columns on `teams` (e.g. `jersey_primary`/`jersey_secondary`) |
| Public application form teams fill in | Zero reads of `tournament_registration_questions` existed; `tournament_registration_answers` (with real team-manager read/write policies) is unused by any UI | Still the missing center; the organizer Preview renders from the shared `registrationFormFields` model so the future public form stays consistent | Public policy for questions read + a signed-in team application route writing entries and answers |
| Link page states: not open yet / open / closed / unavailable | Public page shows none; public read of `tournament_registration_settings` is policy-blocked (loader itself notes "requires additional public data policies") | Recorded; no statuses rendered on the public page | Public SELECT policy for registration settings (owner decision on exposure) + the status component |
| "Unavailable — public registration disabled" | `application_method = 'invite_only'` exists but the public page cannot read it | Recorded | Same public settings policy above |
| Fee display if Finance has a registration fee | `tournament_fees` table exists but **no app path writes it** (Finance today records manual expenses only), so no fee can exist to display | Stage 4 preview shows an explicit note instead of a fee section | A fee-recording flow in Finance, then read the fee for display |
| File upload question type | No `file` response_type in the CHECK and no storage wiring | Listed but disabled with reason | Storage bucket policy + `file` type + upload path |
| Multiple choice as distinct from dropdown | Table `response_type` has single-choice `select` only | Both map to `select` truthfully (choice list, single answer) | `multi_select` type widening if the owner wants multi-answer checkboxes |
| "Multiple choice / dropdown" per-question choices on public page | Questions never reach teams (see row above) | Options stored and editable; display waits for the application form | Same public route work |

**Updated migration note:** review-only migration 019 gained `tournament_registration_questions.instructions text` before application (it was still unapplied). No production data was touched. **Updated test count: 38 files / 373 tests pass.**

# Feature gap audit additions — 2026-10-24 (Phase 2 depth batch)

Still open, stated plainly (no fake completeness):

| Area | Gap | Reason / owner decision needed |
|---|---|---|
| Scheduled registration | Auto-opening at `opens_at` is not automatic | Postgres has no timer trigger; honoring a timestamp without the organizer would bypass launch control. Needs pg_cron (not assumed available) or the organizer clicks Open. Closing IS now backend-enforced inside the entries insert policy (amended 019). |
| Stage 5 | Required player fields, required documents, identity verification, suspension checks | No roster-policy schema or workflow exists yet. Roster submission/approval/locking is the §14 workflow (later phase). |
| Stage 5 | Approval/lock switches in the setup form | 019 provides the columns; the UI only writes deadline/officials/timing for now, matching spec section 7. Switches land with the roster workflow. |
| Stage 2 | Automatic eligibility checking | Eligibility is stored as instructions with a mandatory cutoff; birth dates stay private, so the future checker flags records for review instead of auto-rejecting. |
| Stage 2 | Category removal cascades competition stages | Matches are guarded (RESTRICT), but format stages for the category delete with it. The confirm says so. If the owner prefers blocking when stages exist too, that is a one-line addition. |
| Stage 2 | Per-category max applications | Implemented: per-category max approved teams (team_limit). Per-category application caps are not in the schema (single `max_applications` per tournament). |
| Public side | Application form page, statuses page, answers writes | Unchanged — the big missing center. Zero reads of questions exist on the public side; `tournament_registration_answers` still unused. Blocked on the public SELECT policy decision. |
| Finance | Fee display in the form preview | `tournament_fees` still has no app write path. |
| Ages/colours | Atoll, jersey colours on the standard fields | Still no columns on `teams`; never faked. |
| Migrations | 017, 018, amended 019 all await the owner's application in the Supabase SQL Editor | Stage 2 extended editing, Stage 3 cap, Stage 5 structured settings, and the backend window policy only go live after 019 is applied. |
| Review | Stage 4 rebuild, this batch, Overview revision, Setup Phase 1 browser pass | Not "passed" until the owner tests them in the browser. |

# Feature gap audit updates — 2026-10-24 (public registration states)

| Area | Change / remaining gap | Notes |
|---|---|---|
| Public registration state on the tournament page | RESOLVED (needs migration 020 applied + owner browser pass) | Settings/categories public policies are new (020); questions policy already existed. Unknown-state honesty: before 020 the page says "not public yet" instead of guessing. |
| Public application submission | STILL OPEN (next phase candidate, spec section 13) | Register button appears when open but honestly states submission is not wired. Needs: public sign-in entry point, "teams I manage" loader, category choice, `tournament_entries` + `tournament_registration_answers` writes (policies already allow a team manager during the open window), and the duplicate-application rule (same team + category — note: `tournament_entries` has no category column, so team-level uniqueness is what the DB can enforce today). |
| Application status page for applicants | STILL OPEN | Teams cannot yet see submitted/changes_requested/approved states from the public side. |
| Pre-public registration link behaviour | STILL OPEN (owner exposure decision) | An unpublished tournament's public page is a NotFound today, so the "Preparing" state of spec section 6 only exists inside published tournaments. A shared registration page for private tournaments would need a scoped public read of an unpublished tournament's name + registration info. |
| Fee display | STILL OPEN | `tournament_fees` has no app write path; Finance fee flow comes first. |
| Migrations | 017, 018, amended 019, NEW 020 await the owner's application in the Supabase SQL Editor | 020 activates the public page's registration details; before that it shows the honest "not public yet" state. |
| Owner browser pass | Pending for: Overview revision, Setup Phase 1, Stage 4 rebuild, Phase 2 depth batch (Stages 2/3/5 + Save & Exit + banner), and now the public registration block | Nothing is "passed" until the owner tests in the browser. |


## Gap additions - workspace chrome + staff page (2026-10-24)

| Area | Gap | Owner decision needed |
|---|---|---|
| Staff directory | Email search/invitation impossible under current schema (auth.users emails never exposed; profiles RLS is owner-only). Name search covers published player profiles only. | A security-definer RPC "user directory search" would expose minimal (id, display_name) with policies; blocked until the owner approves a privacy surface |
| Staff statuses | No invited/pending state in tournament_staff_assignments; Status is always Active (no email service). | Accept immediate-effect invites, or add an invitations table later |
| Org-level Staff page | Still the UUID fallback form (relabeled Remove Access) outside tournament pages. | Wire it to a real tournament picker + table if wanted |
| Workspace chrome | Team workspace still a note page (no dedicated team shell). | Future phase |

## Batch update � 2026-10-29 (Team + Official workspaces + public application)

- Team workspace: IMPLEMENTED locally (was "note page"). Needs migration 021 applied for profile/membership writes.
- Official/Staff workspace: IMPLEMENTED locally (was missing). Needs migration 021 for assignment reads.
- Public application submission: IMPLEMENTED locally (was the declared "next phase candidate"). Uses existing entries/answers policies; duplicate prevention via UNIQUE (tournament, team).
- Public name resolution defects: RESOLVED (PublicList match cards, BracketPage, TournamentPublicDetail match links).
- Review-only migration 021 added (team/official access paths).
- Tests: 44 files / 430 pass. Typecheck/lint/build clean.


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

| Item | State |
|------|-------|
| Super Admin card in Choose Workspace | Done (database-checked; not auto-opened) |
| Private route #workspace/platform-admin, refresh-safe, Back and Switch workspace | Done; #admin links redirect |
| Distinct checking / denied / expired / error states | Done |
| Live sign-in check with the real administrator account | Not done: needs the account owner to sign in |

## Page 1 — Public landing — 2026-11-02

| Item | State |
|------|-------|
| 24 required sections | Done |
| Watch Live only with a real published live match | Done |
| Trending / Popular with stated, real measures | Done |
| Sports History with recorded champions | Done (champion shown only for published teams) |
| Signed-in verification in a browser | Not done: needs the owner's account |
| Landing sections hideable from Customization | The new sections (ticker, Why, roles, engine, card, history) are always shown; the published configuration format does not list them yet |
| Hero and landing text in Dhivehi | Layout turns right-to-left; the landing copy itself is English until reviewed Dhivehi text is added |

## Page 1 revised — simplified public layout — 2026-11-02

| Item | State |
|------|-------|
| Five main items, Explore, search icon, five-item phone bar | Done |
| Landing previews (Sports Hub, Showcase, Community, Competition, How It Works, History and News) | Done |
| #explore and #live | Done (#live reuses the matches page) |
| Other public pages in the new shared layout (pages 2-19 of the owner list) | Not started: one page at a time after Page 1 passes |
| Signed-in browser check | Not done: needs the owner account |
