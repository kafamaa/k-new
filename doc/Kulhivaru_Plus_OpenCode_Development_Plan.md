# Kulhivaru+ — OpenCode Development Plan

Use this plan to build a new Kulhivaru+ application in OpenCode. The product source of truth is **Kulhivaru_Plus_Product_Specification.md**.

## 1. Development approach

Build in vertical stages. Each stage must include its interface, data model, authorization, validation, and meaningful tests before it is marked complete. A screen with placeholder buttons or local-only data is not a complete feature.

Before coding, OpenCode must inspect the repository, read project instructions, identify its current state, and create a short implementation checklist. Use the stack and scope defaults below. Never invent or expose credentials.

### Settled technical and product defaults

- **Frontend:** React + TypeScript + Vite, mobile-first.
- **Backend:** Supabase Auth, PostgreSQL, Row Level Security, private Storage, and Edge Functions for trusted server-side tasks.
- **Hosting:** Vercel, using Local, Preview, and Production environments.
- **Target:** The new Kulhivaru+ project opened in OpenCode. Do not merge or modify older repositories unless the owner specifically selects one as a source.
- **First-release sports:** Football, futsal, handball, volleyball, basketball, and 3x3 basketball. Do not expose a sport until its match events, statistics, rules, and standings are implemented and tested.
- **Competition formats:** Round robin, group stage, knockout, groups followed by knockout, and two-leg ties when allowed by the sport/category rules. Automatic and manual draw/fixture workflows are required.
- **Finance:** MVR-first manual fee and expense records, proof upload, manual verification, receipts, waivers/refunds, balances, and exports. No online payment gateway in the first release.
- **Notifications:** In-app and email in the first release. Add SMS or Telegram only after a provider and operating cost are selected.
- **Region and language:** Maldives timezone and atoll/island context; English and Dhivehi-ready UI, including right-to-left layout support.
- **Data model:** Follow the minimum relational data model in the Product Specification. Keep persistent team/player profiles separate from tournament entries and roster memberships; keep matches, events, result versions, claims, and audit history as linked records.
- **Identity:** Use a trusted server-side keyed HMAC digest of normalized national ID for uniqueness; do not store readable ID numbers in application tables or logs. A private claim invitation plus verified contact or authorized review is also required. Support a protected issuing-country/document-type identifier for foreign players and guardian approval for minors. Do not claim government-registry verification without an actual integration.
- **Owner testing:** Use the owner's real account and genuine records they are authorized to use. Do not add user-facing demo accounts/data. Use read-only checks on published records; for write tests use a genuine draft tournament the owner intends to run. Automated fixtures remain isolated from real accounts and data.

The main end-to-end journeys are:
- Organizer creates a tournament and completes it.
- Team manager manages a team, roster, and tournament entry.
- Organizer creates an unclaimed team/player record when needed.
- Real player/team manager claims the existing record without duplicate accounts or lost history.
- Confirmed match results update standings, statistics, histories, achievements, and milestones.

## 1.1 UI and visual direction

OpenCode is responsible for building the actual user interface, not only wiring routes or making a plain functional prototype. Use a polished, professional, mobile-first visual system that is easy for organizers, team managers, and players to understand. Apply the user's requested liquid-glass direction: translucent cards, restrained background blur, soft surfaces, and subtle or minimal borders. Keep text and controls highly readable; do not use blur or transparency where it reduces contrast or makes data hard to scan. Use the effect selectively rather than on every screen.

Design requirements:
- Create a consistent design system for colors, typography, spacing, cards, buttons, forms, badges, tables, dialogs, and navigation.
- Make tournament cards show a clear title, sport, dates/status, cover image where available, organization/team logo, and progress/next action.
- Make dashboards prioritize the next task and separate application, roster, payment, and match counts.
- Make the 11-step setup feel resumable, with progress, validation, save state, and clear next/back actions.
- Use responsive layouts: compact navigation and readable cards on phones; efficient tables and dashboards on larger screens.
- Use accessible contrast, keyboard focus, labels, touch targets, and reduced-motion support. Consider Dhivehi/English text and right-to-left layout in the design system.
- Include realistic loading, empty, error, success, permission-denied, and offline/sync states.
- Use the user-provided homepage screenshot as a visual reference for composition, sports atmosphere, colors, and hierarchy. In the project, save it as **docs/ui-reference/kulhivaru-homepage-reference.jpeg** and tell OpenCode to inspect it. Treat the image's sample names, scores, dates, and counts as visual examples only; do not seed them as app data.
- Use the user-provided digital player-card image as a visual reference. In the project, save it as **docs/ui-reference/kulhivaru-player-card-reference.jpeg** and tell OpenCode to inspect it. Recreate its vertical shield card, dark navy/royal blue background, electric cyan edge glow and accents, Kulhivaru+ mark at the top, large player photo, bold name, team badge/name, island, and country flag. Treat the example person's identity and team as visual reference only; display each real player's own authorized profile data.
- Make the digital card responsive for phone display and sharing/download. Keep text readable and never bake example text into a background image. Add a stats area or companion card view for verified appearances, goals, assists, and cards; calculate any star rating only from a defined, visible method. The card must update from the player's verified records and link back to their public profile.
- Build the UI in the project's native framework and component system. Recreate the design as responsive components; do not use the screenshot itself as a flat page background or as a substitute for working UI.

### Homepage layout from the visual reference

Build the public landing page in this order, backed by real published records:
1. Compact top navigation with Kulhivaru+ brand, Home, Tournaments, Live, Teams, Players, News, language selector, Sign in, and Create account.
2. Large island/sports hero image with the message **“Sports Live. History Forever.”**, short supporting copy, tournament/team/player search, Explore Tournaments, and Create a Tournament actions.
3. Browse by Sport cards.
4. Live Now match cards.
5. Today’s Matches.
6. One large Spotlight tournament banner.
7. Featured Tournaments.
8. Trending tournaments, teams, and players.
9. Upcoming Tournaments.
10. Standings and Tournament Bracket side-by-side on wide screens, stacked on phones.
11. Top Players and Popular Teams.
12. Recent Results.
13. News and Announcements.
14. Organizer call-to-action banner.
15. How It Works steps and a complete footer with navigation, help, and legal links.

Hide or gracefully handle sections with no published data. Never show invented match results, player statistics, or tournament records as real content. Ensure this full landing page remains easy to scan on a phone, with no dense desktop tables overflowing the screen.

### Digital player-card layout from the visual reference

Build the card as a real data-driven component, not a static image. Preserve the reference's portrait shield composition and blue/cyan sports identity. Use the player's own approved photo and current selected team badge. Show player name, team, island, country flag, and verified sport statistics; allow the player to preview the public card and share/download it. Support an unclaimed profile state without exposing private identity data. Never show national ID, private contact information, or unverified statistics on the card.

## 2. Build stages and exit checks

### Stage 0 — Repository discovery and technical plan

**Work**
- Read README, project rules, package files, routes, database migrations, environment examples, UI, and tests.
- Identify working and incomplete features; confirm development and test commands.
- Create docs/IMPLEMENTATION_PLAN.md with architecture, feature sequence, schema outline, risks, and environment needs.
- Create/update docs/IMPLEMENTATION_STATUS.md with truthful statuses: Not Started, In Progress, Blocked, or Complete.

**Exit checks**
- App starts using documented commands.
- Existing files, data, migrations, and credentials are preserved.
- Architecture decisions and assumptions are documented.

### Stage 1 — Application foundation and account security

**Work**
- Build responsive app shell, routing, a post-sign-in Choose Workspace screen and workspace switcher, accessible forms, and loading/error/empty states.
- Implement signup, sign-in, sign-out, account recovery, and account profile.
- Use email/password with verified email and account recovery; phone is optional and no SMS provider is required for first release.
- Support one person using one account for multiple authorized workspaces.
- Add roles and permissions enforced in backend/database.
- Make public visitor access view-only.
- Implement the settled national-ID uniqueness and claim-verification flow from the Product Specification. Keep the ID out of public pages, logs, client-side secrets, and ordinary organizer views.

**Exit checks**
- Guests cannot perform write actions.
- Users see only authorized workspaces and records.
- Backend/data-layer permission checks are tested, not only hidden in the UI.
- No privileged key is sent to the browser.

### Stage 2 — Persistent sports records

**Work**
- Implement organizations, teams, player profiles, seasons, team memberships, and account-to-profile links.
- Add public/private fields and public organization, team, and player pages.
- Search for existing teams/players before creating records.
- Add profile claims/invitations with expiry, revocation, verification, conflict review, and audit events.
- An organizer-created record must not create a login or give the organizer control over a person's account.
- Preserve history when a profile is claimed or a player changes teams.

**Exit checks**
- Organizer can create a team and unclaimed player record.
- Player can claim the existing record after signing in or creating their one account.
- Existing account detection directs the person to sign in/recover, not create a duplicate.
- Claiming preserves history.
- Private identity data is inaccessible to guests and unauthorized users.

### Stage 3 — Tournament setup and registration

**Work**
- Create resumable tournament draft and organizer cockpit.
- Implement the 11 setup stages from the product specification.
- Show separate counts for applications, rosters, payments, and matches.
- Support team applications and organizer-entered teams.
- Implement application review, roster submission, eligibility, document requirements, and separate status changes.
- Add tournament public page and registration-link sharing.
- Add clear next-action guidance.

**Exit checks**
- Organizer can create a minimal draft and resume later.
- Team manager can apply and submit roster information.
- Organizer can approve, reject, request changes, or add a team directly.
- Application, roster, and payment states remain separate.
- Public pages reveal only published information.

### Stage 4 — Competition engine

**Work**
- Implement supported formats: round robin, group stage, knockout, group plus knockout, and two-leg ties where supported.
- Implement automatic and manual draw/fixture generation.
- Implement configurable rules, standings, and tie-breakers.
- Add venues, scheduling constraints, match states, and official assignments.
- Save draw/fixture versions and audit changes.
- Define sport-specific rules and event/stat schemas.

**Exit checks**
- Each supported format is tested for fixtures, progression, standings, tie-breakers, and edge cases.
- Organizer can preview before publishing.
- Changes after publishing require permission and are audited.
- Unsupported formats are not shown as available.

### Stage 5 — Match operations and verified results

**Work**
- Build a match center for authorized officials/organizers.
- Record score and sport-specific events.
- Support scheduled, live, awaiting confirmation, confirmed, postponed, abandoned, and cancelled states.
- Add result review, confirmation, correction, and dispute workflows.
- Make match operations usable on phones and offline-tolerant: cache the authorized fixture/roster, queue offline events with idempotency keys, show sync status, and route conflicts for review without overwriting confirmed results.
- Audit result and event changes.

**Exit checks**
- Only authorized users can record/confirm results.
- Only confirmed results update official standings and histories.
- Corrections recalculate affected data and preserve change history.
- Concurrent/offline edits do not silently overwrite newer data.

### Stage 6 — Standings, statistics, history, and milestones

**Work**
- Derive standings from confirmed results and configured rules.
- Derive player/team statistics from recorded match events.
- Filter statistics by sport, club, island/atoll team, national team, tournament, season, and date.
- Show career totals and per-team/level breakdowns without double-counting.
- Add achievements, trophies, digital player cards, and automatic milestones.
- Label organizer-entered milestones separately from system-generated ones.
- Add correction requests and recalculation audit trails.

**Exit checks**
- Confirmed match changes propagate to standings, team/player totals, and milestones.
- Own goals, shootout scores, unassigned events, and sport-specific scoring follow the sport rules.
- Public totals link to their source matches/competitions.
- Unconfirmed data is not presented as official history.

### Stage 7 — Organization operations, reporting, and notifications

**Work**
- Implement delegated organization/tournament staff permissions.
- Implement MVR-first manual finance: fee categories, proof uploads, manual verification, receipts, waivers/refunds, balances, and exports. No online payment gateway in the first release.
- Add notifications for invitations, registration, rosters, schedules, match assignments, result confirmation, payments, milestones, and completion.
- Add authorized reports and exports with privacy controls.

**Exit checks**
- Staff can perform only assigned tasks.
- Exports obey app permissions.
- Notifications do not leak private data.
- Finance records remain private and separate from public results.

### Stage 8 — Quality, security, and release readiness

**Work**
- Test mobile usability, accessibility, validation, loading/error/empty states, and main journeys.
- Test denial of cross-team, cross-organization, and unassigned-match access.
- Review private storage, identity data, secrets, logging, backups, and account recovery.
- Keep automated test fixtures isolated from real accounts and real records; do not seed demo records into the app users will test.
- Document environment setup, migrations, deployment, backups, and rollback.
- Verify the complete tournament-to-history journey.

**Exit checks**
- Typecheck/build/lint pass for the project.
- Automated tests pass; known gaps are documented.
- Critical workflows pass end-to-end.
- Tests and seeds do not alter real user or production data.
- Deployment instructions and limitations are documented.

### Stage 9 — Owner hands-on testing with real accounts and records

**Work**
- Provide a phone-accessible preview or the intended app environment where the owner can sign up and use the real authentication and database workflows.
- Do not create demo accounts, seed demo records, or populate the owner-facing app with fictional organizations, teams, players, tournaments, or matches.
- The owner should use their real account and the real workspaces they are authorized to access. The same person can switch between their authorized roles/workspaces without creating duplicate accounts.
- For player and team claim tests, invite the real player or team manager to use their own account and claim the correct existing record. Do not create duplicate accounts for one person or use fabricated national IDs.
- Use genuine records entered by authorized users. Test only against records the owner or participating account holders are allowed to change. Do not alter unrelated or live tournament data to exercise a workflow.
- Provide an owner testing guide with real sign-in/signup steps, expected outcomes, and a place to record defects or confusing steps. Never put passwords, national IDs, or recovery codes in the guide.
- Give the owner preview access instructions and explain how updates reach the preview. If a separate staging database is used, populate it through normal signup and user workflows with genuine authorized data, not demo seeds.
- Reproduce reported issues, fix them, run automated checks, and make the corrected version available for retesting.

**Owner test checklist**
1. Sign in with the owner's real account; create a tournament draft in an authorized workspace, leave it, return, and continue setup.
2. Use a genuine team record the owner is authorized to manage; add or link real players with their consent.
3. Invite the real player to claim the existing profile using their own account; confirm the history appears and no duplicate account is created.
4. Have the authorized real team manager review the roster and application; check application, roster, and payment statuses separately.
5. Publish fixtures and record/confirm a genuine authorized match result; check standings and player/team statistics.
6. Correct a result only when the owner is authorized and the record is appropriate to correct; confirm audit history and recalculated totals.
7. Sign out and open public pages as a guest; check published content is visible and private data/actions are blocked.
8. Verify denied access using an existing account that is not authorized for that team/organization/match, with the account holder's consent.
9. Refresh and reopen pages to confirm real data persists; test key screens on a phone.
10. Report anything broken, unclear, or difficult. Do not accept a stage until the owner has reviewed it.

**Exit checks**
- Owner can access the app and follow the guide without developer-only tools.
- Real accounts behave according to their actual permissions; guest access is checked by signing out.
- No demo accounts or demo records are added to the owner-facing app.
- Owner and participating users can repeat authorized core flows and report issues for correction.
- Automated tests passing alone does not mark the stage accepted; owner feedback is recorded.

## 3. OpenCode master instruction

Give OpenCode the following instruction with **Kulhivaru_Plus_Product_Specification.md** available in the project.

---

You are the implementation agent for the new Kulhivaru+ application.

Read **Kulhivaru_Plus_Product_Specification.md** completely before coding. Treat it as the product source of truth. Also read project instructions such as AGENTS.md, README, existing plans, package scripts, migrations, and environment examples.

### Product goal

Build a mobile-first sports platform that digitalizes tournaments from planning to completion and maintains verified player and team histories. Core records are tournaments, organizations, teams, players, seasons, matches, and confirmed match events. Main user workspaces are Player, Team Manager, and Organizer. Public visitors are view-only. Super Admin is internal and never selectable at public signup.

### Work style

1. Inspect the repository and current application before changing anything.
2. If it is an existing project, preserve working features, user data, visual style, and established architecture unless they conflict with the product specification. Do not restart or replace working systems without a concrete reason.
3. If the repository is empty, scaffold the app and document the chosen stack and architecture.
4. Create **docs/IMPLEMENTATION_PLAN.md** and **docs/IMPLEMENTATION_STATUS.md**. Keep statuses truthful. A feature is not complete because a screen exists; it must work through UI, persisted data, permissions, validation, and tests.
5. Implement the stages in **Kulhivaru_Plus_OpenCode_Development_Plan.md** in order. Work autonomously through available tasks. Do not stop after giving advice, a plan, mockups, or TODOs.
6. After each stage, run relevant checks, fix failures, update status/docs, and continue.
7. If credentials or external services are unavailable, implement the safe local/configuration path, document the precise blocker, and continue independent work. Never invent credentials.
8. Do not claim a feature is complete unless its actual workflow was tested.

### Core product rules

- One person has one user account and may access multiple authorized workspaces.
- Search for an existing team/player before creating a record.
- An organizer may create unclaimed team/player records for tournament operations, but cannot create or control the person's login.
- A player claims the existing profile through a private, verifiable invitation. If an account already exists, require sign-in/account recovery; never create a duplicate account.
- Claiming preserves team, tournament, match, and statistics history. Conflicts go to review; do not auto-merge uncertain records.
- National ID, if used, is sensitive identity data: never expose it publicly, in client logs, or to ordinary organizers. Do not use a public profile ID or national ID alone as a claim secret.
- Public visitors can view published pages but cannot submit, edit, upload, or manage.
- Enforce authorization in backend/database policies and UI. Scope access to the authorized player, team, organization, tournament, or assigned match.
- Only confirmed match results update official standings, histories, statistics, trophies, and automatic milestones.
- Corrected results recalculate derived data and retain audit history.
- Keep application, roster, payment, and match statuses separate.
- Never expose service-role keys or privileged credentials in client code.
- Do not run destructive database commands, reset production data, or execute production seeds. Inspect migrations and target environments before database changes.
- Automated tests must not alter real user or production data. Owner acceptance testing must use real accounts and authorized records, never demo accounts or demo data.

### Implementation requirements

- Build tournament setup as a resumable workflow with clear progress, validation, and a prominent next action.
- Build the complete polished UI using the mobile-first liquid-glass visual direction, with readable contrast and accessible interactions; do not leave generic placeholder layouts.
- Support team applications and organizer-entered teams.
- Support organizer-created unclaimed players, player claim flow, team management, and duplicate/conflict handling.
- Implement competition formats and sport-specific rules only when supported and tested.
- Derive standings and sport-specific player/team statistics from verified match records. Provide breakdowns by club, island/atoll team, national team, tournament, season, and sport.
- Add public organization, tournament, team, and player pages that exclude private data.
- Add tournament, team, and player milestones with their source records. Label manual milestones.
- Make main journeys usable on mobile and document offline/sync behavior and conflict handling.
- Match-day offline recording and safe synchronization are first-release requirements, not optional scope.
- Add delegated staff permissions so organization/tournament tasks can be assigned without broad access.

### Required end-to-end acceptance journeys

A. Organizer creates a draft, resumes setup, publishes registration, reviews an application, approves a roster, creates/publishes fixtures, records/confirms results, completes, and archives the tournament.

B. Organizer creates a team and player record, adds them to a tournament, and the real manager/player claims the existing record without duplicate accounts or history loss.

C. Team manager creates/manages a team, submits a roster, tracks tournament status, and views team history.

D. Player signs in, claims the correct profile, sees club/island/national statistics and history, and cannot alter official results.

E. A confirmed match updates standings, player/team statistics, and applicable milestones. Correcting the result recalculates them and records who changed it.

F. A public visitor can view published pages but is denied private documents, identity data, payments, workspace controls, and all write actions.

G. A user from another team/organization or an official not assigned to a match cannot view or mutate restricted records.

Begin by inspecting the repository and writing the implementation plan/status. Then implement in stages, run checks after each stage, and continue until all feasible acceptance journeys pass. Also provide a phone-accessible preview and a hands-on owner testing guide using the owner's real account and genuine records they are authorized to use. Do not create demo accounts or demo records in the owner-facing app. The owner must be able to test the app, report issues, and retest fixes. Never run destructive resets or use automated test fixtures against real accounts/data. Report completed work, automated and owner tests run, and exact remaining blockers.

---

## 4. How to run the plan

1. Put the product specification and this development plan in the project root or docs folder.
2. Open the correct new Kulhivaru+ project in OpenCode.
3. Paste the master instruction.
4. Let OpenCode inspect the project and begin Stage 0.
5. Review the generated implementation plan/status before any production database deployment.
6. Use the owner testing guide to verify each end-to-end journey with real accounts and authorized records. Record bugs and confusing steps, send them back to OpenCode, and retest fixes. Sign out to test guest access; use consenting, already-authorized users for other role checks.

## 5. Handling changes during development

Requirements can change while the app is being built. The owner can send OpenCode a change request in plain language at any stage; a change does not automatically require restarting the project.

For every change request, OpenCode must:

1. Restate the requested outcome briefly and identify which current stage and user journeys it affects.
2. Check effects on the interface, database/schema and migrations, role permissions, identity/privacy, tournament operations, statistics/history, offline behavior, and existing records as relevant.
3. Update **Kulhivaru_Plus_Product_Specification.md** first when the product requirement changes. Update **docs/IMPLEMENTATION_PLAN.md**, **docs/IMPLEMENTATION_STATUS.md**, and any decision or migration notes that are affected. The product specification remains the canonical source of truth.
4. Follow the owner's latest explicit instruction if it changes or replaces an earlier decision. Do not silently keep an old requirement that directly conflicts with the new request. Record the decision and any remaining trade-off in the docs.
5. Implement the change in the smallest complete slice, including authorization and validation, then add or adjust meaningful automated tests and run the checks for affected features.
6. Preserve unrelated working behavior and all real user data. Use a reviewed, additive migration where possible. Do not delete or overwrite production records, reset a production database, or make an irreversible production change without the owner's explicit authorization.
7. Report what changed, which documents/files changed, tests and checks run, any migration/deployment action still required, and any blocker. Keep implementation status accurate and continue with the next feasible work.

### Owner change-request template

Copy this into OpenCode and fill in the brackets:

> **Change request:** [What should change?]  
> **Reason:** [Why is it needed?]  
> **Expected result:** [What should a user be able to see or do afterward?]  
> **Priority/timing:** [Must-have now / next milestone / later]
>
> Inspect the impact before editing. Treat this as my latest requirement where it conflicts with an earlier decision. Update the product specification and implementation plan/status, implement the change with the relevant permissions and tests, run the affected checks, preserve real accounts and records, and report the files changed, test results, and any remaining migration or deployment step. Do not perform destructive production data changes without asking me first.

Small clarifications can be sent as a short message. For a broad change, include the reason and expected result so OpenCode can tell whether it changes only the UI or also the data model, permissions, workflows, and already recorded history. If a requested change conflicts with law, security requirements, or an external platform constraint, OpenCode should explain the conflict and propose a safe implementation rather than quietly dropping the request.

The master instruction asks OpenCode to work autonomously, but it cannot supply missing account credentials, make legal identity-verification decisions, or safely deploy schema changes to a production database without the correct project and environment configured.

