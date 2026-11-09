# Kulhivaru+ — Product Specification

**Purpose:** A Maldives-focused sports platform that digitalizes tournament work from planning to completion and builds lasting histories for players and teams.

## 1. Product vision

Kulhivaru+ connects three core parts of sports:

1. **Tournaments:** Organizers plan, publish, operate, and complete competitions in one system.
2. **Players:** Players have a personal sports profile with verified participation, statistics, achievements, and trophies.
3. **Teams:** Teams manage their identity, managers, roster, tournament participation, results, achievements, and history.

These are connected records, not separate isolated modules. A confirmed match result contributes to the tournament record and, where applicable, the histories and statistics of the participating teams and players.

**Product rule:** Organizers run competitions. Teams and players take part. Confirmed competition records build the sports history.

## 2. Core entities and account model

| Entity | Purpose |
|---|---|
| User account | A person’s sign-in, security, preferences, and notifications. |
| Player profile | A person’s public and private sports record. |
| Team | A club, island/atoll side, national side, school, or other sports team. |
| Organization | The club, association, school, council, or body that manages tournaments and related teams. |
| Tournament | A competition with its own setup, registration, roster, schedule, matches, results, and archive. |
| Season | A named period used to group competition and player/team records. |
| Match | A scheduled contest and its official events, score, participants, and result status. |
| Workspace | A private management area for an account, player, team, organization, or tournament. |

One person should use **one user account** and may access multiple authorized workspaces. For example, Ibrahim may be a player and a team manager. A player profile or team can be created before its owner has an account. Creating such a record must not create a login or give the creator control over the person’s account.

### 2.1 Final implementation defaults

These are the settled defaults for the first build:

- **Frontend:** React + TypeScript + Vite, mobile-first.
- **Backend:** Supabase Auth, PostgreSQL, Row Level Security (RLS), private Storage, and Edge Functions only for trusted server-side tasks.
- **Hosting:** Vercel, with preview deployments for review and a separate production deployment.
- **Initial sports:** Football, futsal, handball, volleyball, basketball, and 3x3 basketball. A sport is offered only after its match events, statistics, standings, and rules are implemented and tested.
- **Tournament formats:** Round robin, group stage, knockout, groups followed by knockout, and two-leg ties where the sport/category rules permit them. Automatic and manual fixture workflows are required.
- **Finance:** MVR-first manual fee and expense tracking with proof upload, manual verification, receipts, waivers/refunds, balances, and exports. No online payment gateway is required for the first release.
- **Notifications:** In-app and email notifications in the first release. SMS/Telegram can be added after a provider and operating cost are selected.
- **Sign-in:** Email and password with verified email and account recovery. Phone is an optional contact field in the first release; do not require an SMS provider.
- **Language and region:** Maldives timezone and island/atoll context; English and Dhivehi-ready interface, including right-to-left layout support.

### 2.2 Minimum persistent data model

Use Supabase Auth for login identities. Store application data in relational tables with stable UUID primary keys, foreign keys, timestamps, and constraints. At minimum include:

| Record group | Required records |
|---|---|
| Accounts and permissions | profiles, protected identity keys, organizations, organization memberships, teams, team memberships, player profiles, player-account links |
| Player/team history | team roster memberships with effective dates/status, seasons, awards, achievements, milestones |
| Tournament setup | tournaments, categories, registration forms, applications/tournament entries, roster submissions, eligibility reviews, fees/payments, venues |
| Competition | stages/groups, fixtures/matches, match participants, official assignments, match events, result versions/confirmations, standings or recalculable standings snapshots, offline sync operation IDs |
| Trust and files | claim invitations, private document metadata, audit events, notification records, correction/dispute requests |

Represent a tournament entry separately from the persistent team record. Represent a roster membership separately from the player profile, with tournament, team, season, status, and effective dates. Derive official statistics and standings from confirmed match events/results; caches may be used only if they can be rebuilt from the source records.

Every table in an exposed schema must have RLS enabled and policies scoped to the actual player, team, organization, tournament, or assigned match. Public access is limited to published fields and published records. Keep privileged keys and sensitive identity processing on trusted server-side paths.

Use UUIDs as internal primary keys and separate stable public slugs/IDs for public URLs. Account/profile links and national-ID digests must have database uniqueness constraints. Use soft deactivation for teams and profiles with history; do not cascade-delete tournament history when an account is removed. Keep audit events append-only.

## 3. Roles and access

### 3.1 Player

A player can:

- Create a player profile or claim an existing one.
- Edit permitted personal and sports details.
- Review their teams, tournaments, matches, statistics, achievements, and trophies.
- Request corrections to official records they cannot directly change.
- Control which profile fields are public.
- Accept or request team membership where enabled.
- Manage account security and notifications.

Players cannot change confirmed results, locked tournament rosters, or official match events unless explicitly assigned an authorized role.

### 3.2 Team Manager

A team manager can:

- Create a team or request access to an existing team.
- Manage the team’s name, logo, colours, island, description, managers, and roster.
- Invite players, create unclaimed roster records, or request to link existing player profiles.
- Apply to tournaments and submit team details and rosters.
- Track application, eligibility, payment, fixture, and result status.
- View and maintain the team’s history.
- Request corrections to published information.

Access is scoped to the teams assigned to that manager. Managing one team does not grant access to another team.

### 3.3 Organizer

An organizer can:

- Create and maintain an organization workspace.
- Create, configure, publish, manage, complete, and archive tournaments owned by that organization.
- Manage registration, teams, rosters, eligibility, draws, fixtures, venues, officials, matches, results, standings, awards, and tournament communications.
- Create team and player records when necessary for a tournament or organization activity.
- Link existing records instead of making duplicates.
- Assign limited organization or tournament responsibilities to authorized staff.
- Manage finance or private documents only when granted the relevant permission.

An organization owner has access to that organization’s work. Delegated staff should receive only the specific organization or tournament access needed for their duties.

### 3.4 Public visitor

A public visitor can browse published tournaments, matches, results, standings, team pages, player pages, organization pages, statistics, news, and histories without signing in. Visitors cannot submit, edit, upload, or manage information.

### 3.5 Platform administration

Super Admin is an internal platform role, never a public signup option. It is used for platform-level operations and support, with sensitive actions logged.

## 4. Workspaces and navigation

After sign-in:

- Always land on **Choose Workspace**. A workspace is never opened automatically, even when only one is authorized.
- Choose Workspace lists only the workspaces the person is authorized to use, grouped as Player, Team, and Organizer.
- For any type the account does not have, show only the matching onboarding choice: **Create Player Profile**, **Create/Join Team**, or **Create Organization**.
- Selecting Player opens the Player workspace and its tools only; Team and Organizer tools are not shown there. Selecting Team or Organizer opens that workspace, and a person with several teams or organizations chooses the specific one.
- A visible **Switch Workspace** control returns to Choose Workspace without signing out.
- Switching workspace changes the data and actions available; it does not grant new permissions, and every protected query and action keeps its authorization check.
- After a normal page refresh the current signed-in session and the current authorized workspace route are restored. A new sign-in or Switch Workspace shows Choose Workspace again.
- Public pages remain accessible without entering a management workspace.

Each workspace should have a clear dashboard, status counts, notifications, recent activity, and a prominent **Next Action** that guides the user to the next unfinished task.

## 5. Tournament management: planning to completion

A tournament is a resumable workflow. Organizers can create a minimal draft with a tournament name and sport, then add details as they become known.

### 5.1 Suggested setup stages

1. **Basics:** Name, sport, organizer, island/atoll, season, and visibility.
2. **Categories:** Age groups, divisions, gender categories if required, and team limits.
3. **Registration:** Open/close dates, application method, entry requirements, fees, and contact instructions.
4. **Registration form:** Team details and custom tournament questions.
5. **Roster requirements:** Player count, eligibility, documents, roster deadline, and change rules.
6. **Competition format:** Round robin, groups, knockout, combined groups and knockout, or supported alternative; configure two-leg ties where relevant.
7. **Rules and standings:** Match duration, points, tie-breakers, discipline rules, extra time, penalties, and ranking rules.
8. **Venues and scheduling:** Grounds/courts, dates, time zone, availability, rest gaps, and schedule constraints.
9. **Officials and operations:** Assign referees and staff, match operations, incident recording, and approval responsibilities.
10. **Finance and sponsors:** Entry fees, payment tracking, receipts, budget items, sponsor information, and reports if enabled.
11. **Review and publish:** Validate required setup, preview the public page, publish, and open registration.

Every stage is saveable and resumable. Organizers can see completion, warnings, missing information, and the next action. A draft can exist without being public.

### 5.2 Tournament lifecycle

Suggested lifecycle:

**Draft → Setup in progress → Registration scheduled/open → Registration closed → Applications reviewed → Rosters under review → Rosters locked → Draw/fixtures prepared → Fixtures published → In progress → Completed → Archived**

An organizer may cancel or postpone a tournament with a reason and participant notification. State changes should be controlled so a tournament cannot be completed while required matches or results are missing without an explicit resolution.

### 5.3 Registration and team entry

Support both:

- **Team application:** Team manager applies; organizer reviews and approves, rejects, or requests changes.
- **Organizer entry:** Organizer creates or selects a team and adds it directly to the tournament.

Keep application, roster, and payment statuses separate. For example, an approved application does not automatically mean the roster is complete or the fee is paid.

### 5.4 Draws, fixtures, and match operations

Support automatic and manual draws/fixtures as appropriate to the selected format. Provide a preview before publishing. Preserve the draw and fixture version so changes are auditable.

A match should include:

- Tournament, stage/round, category, and participating teams.
- Scheduled date/time, venue, and match status.
- Assigned officials where applicable.
- Score and sport-specific match events.
- Result confirmation state and change history.

Match operations must be offline-tolerant: cache the authorized match fixture and roster, allow authorized officials to record score/events offline, and queue operations for sync. Every queued operation needs an idempotency key and actor/time metadata. Show pending sync clearly. Conflicting edits must be surfaced for review; never silently overwrite a newer result or auto-confirm a conflict.

Result states can include scheduled, live, awaiting confirmation, confirmed, postponed, abandoned, and cancelled. Only confirmed results update official standings and histories.

### 5.5 Standings and completion

Calculate standings from configured rules and confirmed results. Show the tie-breaker order to organizers and viewers. At completion, validate unresolved fixtures, results, awards, and final standings. Archive the event while retaining its public history and protecting private records.

## 6. Organization-created teams and player records

Organizers sometimes need to add participants who do not yet have app accounts. This is supported.

### 6.1 Add a team

1. Organizer searches for the team first.
2. If the correct team exists, link it to the organization or tournament.
3. Otherwise create a team record with required details.
4. Mark it as unclaimed if no manager controls it yet.
5. Add it to the tournament only through an explicit action.
6. Invite an authorized team manager to claim/manage the team workspace.

### 6.2 Add a player

1. Organizer or authorized team manager searches for an existing player.
2. Link the correct profile if found, rather than creating a duplicate.
3. Otherwise create a player record using only details needed for the roster or competition.
4. Add the record to the team roster and mark it unclaimed.
5. Invite the player to claim the record.
6. Collect tournament-required documents through restricted storage only when genuinely needed.

A record creator does not get to create the player’s password, control their personal account, or make private details public.

### 6.3 Claiming a player record

For example, an organizer adds Ibrahim to Wigani’s tournament roster. Ibrahim opens a private invitation, signs in or creates an account, completes identity verification, reviews the profile, and selects **Claim this profile**. Kulhivaru+ links the account to the existing player record and preserves its team, tournament, match, and statistics history.

If Ibrahim already has an account, he signs in or recovers it and claims the record. The app must not create a second account. Claiming a player profile does not make Ibrahim a team manager.

### 6.4 Preventing duplicate accounts and records

- Require one verified account per person.
- Check for an existing account before account creation.
- If one exists, direct the person to sign in or recover it.
- Check for likely existing player/team profiles before creating a new record.
- Never merge uncertain matches automatically.
- Review a profile conflict before linking or merging records.
- Preserve history and record who performed a claim, merge, or correction.

If national ID is used as an identity check, keep it private, collect it only for a clear purpose, and restrict verification to a trusted server-side flow. Do not publish it, expose it to ordinary organizers, or treat a public profile ID or national ID alone as an account password or claim token. Use a separate private invitation or verification step.

**Settled identity rule:** For Maldivian players, normalize the national ID and compute a keyed HMAC digest in a trusted server-side function. Store the digest with a unique database constraint; do not store the readable ID number in the application database or logs. The ID is used to prevent duplicate accounts and match an existing player record, not as a password. A claim also requires a one-time invitation tied to that player record and confirmation through a verified contact channel or an authorized organizer review. If an ID is already linked to an account, direct the person to account recovery/sign-in and never create another account. For a foreign player, use document type + issuing country + a protected unique digest. For a minor, require guardian approval before account claiming or public profile control. Do not claim government-registry verification unless an official verification service is actually integrated.

## 7. Player profiles, history, and digital cards

### 7.1 Player workspace

Show:

- Profile status: unclaimed, claimed, verification pending, or restricted.
- Current and previous team links.
- Tournaments, seasons, match appearances, and results.
- Sport-specific statistics.
- Achievements and trophies.
- Pending invitations, team requests, and correction requests.
- Public-profile preview and privacy controls.

### 7.2 Public player page

May display approved public information such as name, photo, island, sport, public team affiliations, match history, statistics, achievements, trophies, and digital player card.

Never display login credentials, national ID, private phone/email, identity documents, payment data, or internal notes.

### 7.3 Digital player card

Generate the card from the player profile and verified sporting records. The visual reference is a vertical shield card with a dark navy/royal blue background, electric cyan border/glow, Kulhivaru+ mark, large player photo, bold player name, team badge/name, island, and country flag. Build it as a responsive data-driven component rather than a flat image with hardcoded text. In the app project, keep the reference image at **docs/ui-reference/kulhivaru-player-card-reference.jpeg**.

The card may also show sport, verified appearances, goals, assists, and cards, with an optional star rating only when the rating method is defined and visible. It must use each player's own approved profile data, update from confirmed records, and link to the player's public history. Support preview and share/download. Never include national ID, private contact information, or unverified statistics. The example person's name, photo, and team in the reference are not to be used as seeded app data.

## 8. Team profiles and history

### 8.1 Team workspace

Show:

- Team identity and public-page preview.
- Managers and their permissions.
- Current roster and roster status.
- Tournament applications and participation.
- Match schedule, results, standings, and notices.
- Team statistics, trophies, milestones, and history.
- Pending player invites and profile-link requests.

### 8.2 Public team page

May show the team identity, public roster, tournaments, seasons, fixtures, results, standings, statistics, achievements, and trophies. Hide private contact information, payment records, internal notes, and private documents.

### 8.3 Team continuity

Keep a persistent team record across tournaments and seasons. A team changing its name or logo should retain its prior history with dated changes. Do not combine separate teams just because they have similar names.

## 9. Statistics and sport levels

### 9.1 Statistics by level

Player and team statistics should be filterable by:

- Club
- Island/atoll representative team
- National team
- School or other team type
- Sport
- Tournament
- Season
- Date range

Show career totals as well as each team/level breakdown. Example: Ibrahim’s total goals, then separate goals for Wigani (club), Sh. Kanditheemu (island), and Maldives (national).

### 9.2 Player statistics

First-release statistic definitions:

- **Football and futsal:** appearances, starts/substitutions, minutes when captured, goals, assists, yellow/red cards, goalkeeper saves and clean sheets when captured. Futsal also supports team/player foul counts where used by tournament rules.
- **Handball:** appearances, goals, assists, goalkeeper saves, yellow/red/blue cards where used, and two-minute suspensions.
- **Basketball and 3x3:** appearances, points, rebounds, assists, steals, blocks, and fouls. 3x3 records one- and two-point scoring according to the configured match rules.
- **Volleyball:** appearances, sets played, points, aces, attack points, blocks, digs, and recorded errors.

Organizers may mark optional stats as unrecorded; missing data must not be treated as zero. Use confirmed match events as the source of player totals.

### 9.3 Team statistics

Show matches played, wins/losses/draws where applicable, scores for and against, differential, standings points, tournament placements, and trophies. Use sport-specific scoring units (goals, points, sets) and exclude shootout scores from regulation totals while showing shootout outcomes separately.

### 9.4 Source of truth

Statistics come from match records. Authorized officials/organizers record match events and confirm results. Only confirmed records count as official history. Team goals and credited player goals must reconcile; own goals, unassigned goals, and shootout scores must be represented distinctly where relevant.

Corrections recalculate affected standings, player/team totals, and automatic milestones. Preserve an audit entry of the change.

## 10. Milestones and timeline

### Tournament milestones

Draft created, registration opened/closed, applications approved, rosters finalized, draw complete, fixtures published, first match, stage completed, final played, awards recorded, and tournament completed/archived.

### Player milestones

First tournament, first appearance, first goal or sport-specific achievement, appearance or scoring thresholds, first trophy, and milestones for a specific club, island, national team, or season.

### Team milestones

Team created, first tournament, first match/win, match or scoring thresholds, final reached, and trophy/championship won.

Milestones have a state (upcoming, reached, delayed, or not applicable where relevant), date, and source record. Generate automatic milestones from confirmed data. Organizer-entered custom milestones must be labeled as such. If a result is corrected, recalculate affected automatic milestones and retain audit history.

## 11. Permissions, privacy, and audit

- Require sign-in for edits, submissions, uploads, payments, and other write actions.
- Scope access by account, team, organization, tournament, and assigned match.
- Keep public pages view-only for unauthenticated visitors.
- Restrict private documents, payment records, identity information, internal notes, and private contact details.
- Provide explicit consent and purpose when collecting sensitive player data.
- Use private storage for uploaded identity or payment documents.
- Maintain audit history for profile claims, roster approvals/locks, manager changes, fixture changes, result changes, record merges, and permission changes.
- Record actor, time, affected record, and reason for sensitive changes.
- Provide a correction/dispute path for players, team managers, and organizers.
- Deactivate access when a staff assignment ends without erasing valid tournament history.

## 12. Notifications and user guidance

Notify the right users about invitations, profile claims, registration status, roster changes/deadlines, schedule changes, match assignments, result confirmation, payment status, milestones, and tournament completion.

Notifications must not reveal private data to the wrong recipient. Each workspace dashboard should present separate counts for applications, rosters, payments, and matches, plus a clear next action.

## 13. Reports and exports

Organizers should be able to view and export authorized tournament information such as team lists, rosters, fixtures, match results, standings, payments, and final reports. Team managers can export their own roster and team history. Players can download/share their public profile or digital card. Exports must respect the same access rules as the app.

## 14. Important user scenarios

### A. Start a tournament quickly

Organizer enters name and sport, creates a private draft, and lands in the tournament workspace. The app guides them through setup, shows incomplete items, and lets them return later.

### B. Add a team and roster

Organizer searches for an existing team or creates one. They add players by linking existing profiles or creating unclaimed records. They invite the manager and players to claim their records. Applications, roster approval, and payments remain separate statuses.

### C. Run a match

Organizer publishes fixtures. An assigned official records the match events and score. The result is submitted and confirmed. Standings and player/team histories update from that confirmed result.

### D. View a player’s career

A visitor opens Ibrahim’s public page and sees permitted history. They can filter his goals by club, island, national team, tournament, or season. Private identity and contact data stay hidden.

### E. Complete and archive a tournament

Organizer confirms outstanding matches/results, awards, and final standings. The tournament becomes completed and archived; public history remains available while private operational data stays restricted.

## 15. Recommended delivery milestones

### Milestone 1 — Foundations

Accounts, one-account-per-person safeguards, workspaces, role permissions, organizations, teams, player profiles, public/private field controls, and audit events.

### Milestone 2 — Tournament setup and registration

Draft creation, resumable setup stages, registration, applications, organizer-entered teams, player records, roster submission, eligibility, and separate status counts.

### Milestone 3 — Competition engine

Formats, rules, draws, fixtures, scheduling, venues, officials, match states, and result confirmation.

### Milestone 4 — Histories, statistics, and milestones

Verified match events, standings, player/team statistics by level and season, trophies, automatic milestones, correction workflow, and record provenance.

### Milestone 5 — Public experience and completion

Public organization, tournament, team, and player pages; digital cards; completion/archiving; notifications; and authorized exports.

### Milestone 6 — Hardening and launch readiness

Privacy review, access-control checks, duplicate/claim testing, mobile usability, recovery workflows, backups, data export checks, and end-to-end testing of the complete tournament-to-history flow.

## 16. Settled release-one decisions

These defaults are settled for the first build and should be implemented without reopening product-scope questions. OpenCode may document a technical blocker, but it should not silently substitute a different product behavior.

### 16.1 Mobile, language, and offline use

- Build a responsive installable web app (PWA), starting with phone layouts and supporting tablet/desktop.
- Launch English and Dhivehi-ready interface. Support right-to-left rendering for Dhivehi, Maldives timezone, and atoll/island names.
- Match center must work offline for assigned matches: cache that match and its authorized roster, queue score/events locally with idempotency IDs, show sync status, and sync on reconnection.
- Never silently overwrite a newer result. Conflicting queued edits enter **Needs Review** and require an authorized official/organizer decision.
- Offline users cannot create new accounts or access data that was not previously authorized and cached.

### 16.2 Permission defaults

| Actor | Default permission scope |
|---|---|
| Public visitor | Read published public pages only. No writes or private data. |
| Player | Own account and linked player profile; may edit allowed profile fields and request record corrections. |
| Team Manager | Explicitly assigned teams; team identity, managers, roster, and tournament applications. No organization finance unless separately assigned. |
| Organization Owner | Own organization, its tournaments, and records explicitly linked to that organization. |
| Tournament Staff | Only the tournament(s) and actions explicitly assigned: registration, finance, media, operations, or match data. |
| Match Official | Only assigned match(es); may record and submit events/results, but organizer/authorized reviewer confirms official result. |
| Super Admin | Internal platform support/maintenance; never granted through public signup. Sensitive actions are audited. |

One person can hold several roles through one account. Workspace switching never grants access by itself. Every protected query and write must enforce scope in Supabase RLS or a trusted server-side function.

### 16.3 Identity, minors, and account recovery

- Signup uses verified email and password with recovery. Phone is optional; no SMS provider is required for release one.
- A normalized Maldivian national ID is processed server-side into a keyed HMAC digest and protected by a unique constraint. Do not store or log the readable ID in application tables.
- The ID digest prevents duplicate accounts and matches the organizer-created player record; it does not prove control of an account. Profile claim also requires a single-use private invitation plus confirmation through the player's verified email or authorized organizer review.
- If the ID digest already belongs to an account, direct the user to sign in or recover that account; do not create a second account or reveal whose account it is.
- Foreign players use a protected identifier composed of document type, issuing country, and keyed digest.
- A minor profile may be recorded by an authorized organizer/team manager. A guardian must approve account claim and public profile control.
- Do not store identity-card images by default. Collect a document image only if a particular tournament requires it, store it privately, and set a retention/deletion date.
- Do not claim government-registry verification unless a real official integration is implemented.

### 16.4 Team and player relationships

- A persistent team is separate from an organization and tournament entry. A team can participate in multiple tournaments and can be explicitly linked to more than one organization.
- A player has one persistent player profile linked to one verified account. The profile can have dated roster memberships with multiple teams over their career.
- Tournament eligibility rules control whether a player may be registered to multiple teams in the same competition/category. Default: one active team entry per player per category, with organizer-approved exceptions recorded.
- Team transfers and temporary loans create dated membership records; they do not rewrite prior seasons or delete match history.
- Island/national selections are team records classified by team type, so their statistics remain separate from club statistics.

### 16.5 Competition and sport rules

- Release-one sports and statistic definitions are the ones listed in Sections 2.1 and 9.2.
- Match format, roster rules, tie-breakers, and scoring presets are configured per tournament/category and shown to the organizer before publishing.
- Confirmed match events drive official scores and player statistics. Shootout scores are shown separately from regulation goals/points. Walkovers, forfeits, abandoned matches, own goals, unassigned events, and corrections have explicit statuses and do not silently alter history.
- Manual result corrections require a reason, permission, and an audit entry; derived standings, statistics, and milestones are recalculated.

### 16.6 Finance, import, and notifications

- Finance is MVR-first and manual in release one: fees, income/expenses, proof, verification, receipts, waivers/refunds, balances, and exports. No online payment gateway or stored card data.
- Provide registry search and reviewed CSV import for teams, players, and historical match records. Import shows a preview, detects likely duplicates, requires confirmation, and records provenance; it never overwrites existing records silently.
- Release-one notifications are in-app and email. SMS and Telegram remain out of release one.

### 16.7 Environments and owner acceptance

- Use Vercel Local, Preview, and Production deployments with environment-specific variables. The configured Supabase project is the authoritative real account/data backend; do not create a second login for the owner just to test a preview.
- The owner tests using their real account and genuine records they are authorized to manage. Published/live records are read-only during acceptance. Write tests use a genuine draft tournament the owner intends to run and real participants who consent.
- Never seed demo accounts or demo records into the owner-facing app. Automated tests use isolated temporary fixtures and may not write to real accounts or the production database.
- Acceptance requires the end-to-end journeys in the OpenCode plan, including phone testing, claim flow, result correction, persistence after refresh, and guest/cross-workspace access checks.

## 17. Definition of a successful core product

Kulhivaru+ is working as intended when an organizer can plan and complete a tournament digitally; teams can register and manage their participation; players can claim the correct profile without duplicate accounts; confirmed results update standings and sports histories; and the public can view approved tournament, team, and player information without seeing private data.
