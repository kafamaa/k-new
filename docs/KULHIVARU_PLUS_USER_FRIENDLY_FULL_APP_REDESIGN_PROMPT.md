# Kulhivaru+ — User-Friendly Full-App Redesign and Workflow Implementation Prompt

Use this prompt with Claude Code from the Kulhivaru+ repository root.

---

Continue developing the existing Kulhivaru+ application. This is a full-app usability, navigation and workflow redesign built on the existing React/TypeScript/Vite/Supabase implementation.

Do not rebuild the application from scratch. Preserve every working feature, real record, route contract, RLS boundary, migration history and test unless an audited change is required.

## Primary objective

Make the complete app extremely easy to use while retaining its full tournament-management and player-career capabilities.

The final experience must hide technical complexity behind role-based navigation, Next Action guidance, short forms, smart defaults, bulk tools and progressive disclosure.

## Core product priorities

1. Create and manage tournaments from planning to archive.
2. Create permanent player records and preserve complete player careers.
3. Let organizers operate tournaments without waiting for players/team managers to create accounts.
4. Let players and teams claim existing records later without duplication or history loss.
5. Generate official statistics/history from confirmed matches and audited corrections.

## Mandatory organizer-first player model

- A player record is required; a player account is optional.
- Organizer/team-authorized users create unclaimed player records.
- Unclaimed players can join teams, rosters, lineups and matches and receive official statistics/history.
- A player can later claim the existing record after secure identity verification.
- Claiming must never create a duplicate or detach history.
- Use permanent internal UUID/Kulhivaru+ Player ID; never use readable National ID as public ID/slug/primary key.
- National ID must be normalized and HMAC-digested in a trusted server function using a server-only secret.
- Never store/log/return readable National ID in public/client-readable tables.
- Exact digest match reuses the existing player.
- Uncertain similar matches go to review; never auto-merge.
- Only authorized Super Admin identity roles may merge records.
- Merging must preserve memberships, roster records, matches, statistics, achievements, URLs and audit history.

## Mandatory Super Admin capabilities

Authorized Super Admin roles may create and manage organizations, tournaments, teams and players on behalf of owners, with permission checks, mandatory reasons, recent authentication and immutable audit events.

Super Admin functions include:

- Create platform-managed or organization-owned tournaments
- Create organizations and assign/invite owners
- Create teams and assign/invite managers
- Create unclaimed players after secure duplicate checking
- Bulk import historical/player/team/tournament data with preview
- Review identity/claim disputes and duplicates
- Correct official history through versioned, audited workflows
- Manage result integrity and trigger recalculation
- Hide/restrict/archive/restore records
- Never silently hard-delete historical records

Do not allow every admin every action. Enforce granular permissions for Platform Owner, Sports Operations, Identity Review, Results Integrity, Moderation, Support, Finance Audit, Content and Customization.

## Source of truth

Read completely before editing:

- Product Specification
- Development Plan
- KULHIVARU_PLUS_FINAL_PAGE_SPECIFICATION.md
- IMPLEMENTATION_STATUS.md
- FEATURE_GAP_AUDIT.md
- SECURITY_AUDIT.md
- all migrations and Edge Functions
- all current routes/components/loaders/tests

If the final page specification is not present in the repository, stop and report the missing file rather than inventing requirements.

## Non-negotiable safety

- Do not reset/delete/seed production.
- Do not invent demo data.
- Do not run `supabase db push`, production SQL or deploy without explicit owner authorization.
- Prepare additive reviewed migrations only when schema/RLS changes are genuinely required.
- Never expose service-role/secret keys in browser code.
- Never weaken RLS to make a screen work.
- Never authorize using email, route parameters or user-editable metadata.
- Never expose private identity, contact, documents, payment proofs, guardian data or internal notes publicly.
- Preserve unrelated user changes in the worktree.

## Global simplicity rules

1. One page has one main purpose.
2. One primary action per page.
3. Maximum five main navigation items; advanced tools go under More.
4. Show Next Action on every private dashboard.
5. Maximum four summary cards above the fold.
6. Show five recent items then View All.
7. Use search instead of long selectors.
8. Use Filter buttons/bottom sheets instead of permanent complex filter panels.
9. Use short forms first; request advanced information only when necessary.
10. Save progress; show Saved state; prevent duplicate submission.
11. Save & Continue validates, saves, completes the step and opens the next step.
12. Use smart defaults from the active tournament/team/account.
13. Support paste, bulk selection, CSV/XLSX imports and copying previous rosters.
14. Every empty state explains what to do next.
15. Use clear human labels; never show raw UUIDs or database statuses.
16. Dangerous actions require explanation and confirmation.
17. Use consistent page shells/components everywhere.

## Final navigation

### Public

- Home
- Tournaments
- Live
- Explore
- Account

Explore contains Teams, Players, Organizations, Matches, Standings, Bracket and News.

### Player

- Home
- Profile
- Career
- Requests
- More

### Team

- Home
- Players
- Tournaments
- Matches
- More

### Organizer

- Home
- Tournaments
- Teams
- Operations
- More

### Tournament

- Home
- Setup
- Teams & Rosters
- Competition
- Matches
- More

### Official

- Home
- Assignments
- Match Center
- More

### Super Admin

- Home
- People
- Sports
- Operations
- Platform

## Shared page shells to build/reuse first

- PublicShell
- DirectoryPageShell
- PublicDetailShell
- AuthShell
- WorkspaceChooser
- WorkspaceShell
- TournamentShell
- AdminShell
- PageHeader
- NextAction
- SummaryCards
- Tabs/OverflowMore
- SearchSelector
- FilterSheet
- LoadingSkeleton
- EmptyState
- ErrorRetryState
- AccessDeniedState
- ConfirmationDialog
- UnsavedChangesGuard
- Toast/InlineStatus

Do not redesign each page independently. Move existing workflows into these shared shells.

## Visual direction

Use Island Sport + Premium Liquid Glass + Sports Broadcast:

- Deep navy background/surfaces
- Lagoon cyan primary accents
- White high-contrast typography
- Maldives-red only for live/critical signals
- Professional icons; no emoji UI
- Editorial headings, restrained glass blur and subtle motion
- Real uploaded logos/covers/photos with safe fallbacks
- No generic white dashboard-card wall
- No excessive borders/glow/animation
- Respect prefers-reduced-motion

## Mobile requirements

- Mobile-first layouts at 390 px
- Maximum five bottom-navigation items
- More opens a clear bottom sheet/drawer
- Full-width primary actions
- Filters in bottom sheets
- Search selectors instead of long dropdowns
- Safe-area support and keyboard-safe forms
- No horizontal overflow except intentional tables/rails
- Touch targets at least 44–48 px

## Required staged implementation

Work through all stages continuously, but verify and document each stage before continuing. If a required credential/runtime is missing, record the exact blocker and continue with work that does not depend on it.

### Stage 0 — Inventory and baseline

- Map every route/page/component/data loader/write action/policy/test.
- Reconcile local/remote migration history read-only.
- Confirm the target Supabase project without printing secrets.
- Run baseline typecheck, lint, tests and build.
- Create a page matrix: Complete, Partial, Missing, Live-blocked.

### Stage 1 — Design system and shared shells

- Implement tokens, responsive shells, navigation, shared states and accessible components.
- Do not change business logic yet.
- Prove existing routes still render.

### Stage 2 — Public pages

Rearrange Home, Search, Tournaments, Tournament Detail/Registration, Live/Matches, Match Detail, Teams, Team Detail, Players, Player Detail/History/Card, Organizations, Standings, Bracket and News according to the final page specification.

- Previews on Home; complete data on dedicated pages.
- Published and confirmed records only.
- Guest view-only.
- Loading/empty/error/retry/not-found states.

### Stage 3 — Authentication and workspace selection

- Signup creates account only.
- Verification, sign-in, recovery and safe return destinations.
- Choose Workspace always appears after normal sign-in.
- Switch Workspace never signs out.
- Correct session refresh/retry behavior.
- Super Admin workspace appears only after trusted admin authorization.

### Stage 4 — Organizer-first player identity and career foundation

- Audit existing player/account/identity/claim schema before changing it.
- Implement/reuse permanent player record, secure identity digest, claim states, invitations, atomic claim, duplicate review, merge redirects and audit.
- Ensure an unclaimed player can participate and build career history.
- Ensure claiming reuses the same record.
- Implement progressive quick-entry vs full eligibility data collection.

### Stage 5 — Player Workspace

- Home, Profile, Career, Requests, More.
- Public preview uses the actual public loader.
- Digital Card from confirmed statistics.
- Correction/privacy/claim tools.
- Player cannot directly edit official statistics/history.

### Stage 6 — Team Workspace

- Home, Players, Tournaments, Matches, More.
- Existing/unclaimed player search, invitations, memberships, applications, rosters, eligibility, documents, payments, fixtures/results/history.
- Team claim preserves organizer-created history.

### Stage 7 — Organizer Workspace

- Home, Tournaments, Teams, Operations, More.
- Clear Next Action and attention counts.
- Organization/team creation and claim invitations.
- Staff/official permissions, reports, finance, news and settings.

### Stage 8 — Tournament Workspace and engine

- Home overview
- Nine-stage Setup with Save & Continue
- Teams & Rosters organizer control center
- Quick roster spreadsheet, paste list, import and copy previous roster
- Eligibility and duplicates
- Competition format/draw
- Fixture generation/scheduling/conflict checks
- Match Center/offline queue
- Result submit/confirm/correct
- Standings/bracket/statistics/discipline/awards
- Finance/sponsors/news/reports
- Completion/archive guard

### Stage 9 — Official Workspace

- Assignments, Match Center, offline sync, availability and notices.
- Only assigned matches and exact permissions.

### Stage 10 — Super Admin

- Home, People, Sports, Operations, Platform.
- Create/manage on behalf of owners with reason/audit.
- Identity claims/duplicates/merges.
- Results integrity/versioned corrections.
- Moderation, finance audit, admin roles, audit log.
- Full app customization with draft/review/publish/rollback.
- Security and system health without exposing secrets.

### Stage 11 — System-wide hardening

- Notifications, email/push delivery states
- English/Dhivehi/RTL
- PWA/offline behavior
- Storage uploads/downloads and signed URLs
- Performance/code splitting/query deduplication
- Accessibility and keyboard testing
- Privacy/security review
- Page-by-page owner acceptance checklist

## Organizer player workflow UX

Create one primary control center:

`Tournament → Teams & Rosters`

Summary: Teams, Players, Complete Rosters, Eligibility Issues, Duplicate Warnings.

Tabs: Teams, Players, Rosters, Eligibility, Imports, Claims.

Primary actions:

- Add Team
- Quick Add Players
- Search Existing
- Copy Previous Roster
- Paste List
- Import CSV/XLSX

Quick roster table fields:

- Full name
- Secure National-ID entry
- Jersey number
- Position
- Existing/New/Possible Match status

Quick entry requires only name, National ID and team. Collect photo, DOB, nationality, eligibility, guardian and documents later only when required.

## Player career source-of-truth

Every confirmed tournament action must strengthen permanent career history.

- Roster establishes tournament participation.
- Confirmed lineup establishes appearance/start/minutes.
- Confirmed match events establish goals/assists/cards/sport metrics.
- Confirmed result establishes match outcome.
- System aggregates career by sport, team, level, tournament and season.
- Awards/milestones retain source tournament/match references.
- Corrections version source records and recalculate aggregates.
- Never treat editable cached totals as the source of truth.

## Permissions and privacy

Implement exact ownership and permission checks in RLS/trusted functions, not only in UI.

- Organizer: own organization/tournament operations.
- Team manager: managed teams, memberships, entries and rosters.
- Player: claimed profile presentation/privacy and requests.
- Official: assigned matches/events only.
- Super Admin: granular scoped permissions, reasons and audit.
- Guest: published view-only records.

Minors require guardian/privacy restrictions. Unclaimed public records expose only roster-appropriate display information. Identity/contact/documents/finance remain private.

## Testing requirements

After every stage run relevant focused tests, then run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Add tests for:

- Navigation and role visibility
- Loading/empty/error/retry states
- Session refresh
- Safe return destinations
- RLS/policy contracts
- Organizer-created unclaimed player
- Exact duplicate prevention
- Claim reuses existing player/history
- Team claim preserves history
- Confirmed-only career calculations
- Correction recalculation
- Minor/private field exclusion
- Super Admin permission/reason/audit controls
- Mobile layout/accessibility
- No raw UUID/private field leakage
- No service-role key/browser secret

## Live acceptance journeys

Do not mark release-ready until real authorized accounts verify:

1. Guest public privacy.
2. Organizer creates tournament/team/player/roster.
3. Secure duplicate detection.
4. Draw and fixtures.
5. Official match operation and offline replay.
6. Result confirmation/correction.
7. Standings/statistics update.
8. Player claims existing history without duplicate.
9. Team manager claims existing team.
10. Super Admin creates/manages on behalf and resolves a reviewed identity/result case.
11. Tournament completes and remains archived/public as configured.

## Documentation and status

Maintain:

- IMPLEMENTATION_PLAN.md
- IMPLEMENTATION_STATUS.md
- FEATURE_GAP_AUDIT.md
- SECURITY_AUDIT.md
- ACCEPTANCE_MATRIX.md
- OWNER_TESTING_GUIDE.md

Never mark a feature complete based only on static code/tests when live Supabase or owner browser acceptance remains unverified. Distinguish Local Green, Live Verified, Owner Accepted and Blocked.

## Final completion report

At completion report:

1. Route/page matrix
2. Files changed
3. Migrations prepared/applied status
4. Data model/RLS changes
5. Player identity/claim/career proof
6. Organizer workflow proof
7. Super Admin permission/audit proof
8. Test count and results
9. Typecheck/lint/build
10. Browser viewport/accessibility results
11. Live checks completed and blocked
12. Security findings
13. Performance impact
14. Exact owner actions
15. Release recommendation

Do not claim completion or release readiness when any required live journey is unverified.

