# KULHIVARU+ continuation plan

Latest presentation update: 5 November 2026.

Continue the existing application. Do not recreate it, replace its data layer, seed mockup accounts or remove working features.

## Read first

1. docs/KULHIVARU_PLUS_FINAL_PLAN.md — authoritative feature scope.
2. docs/RELEASE_STATUS_2026-11-03.md — implementation/deployment register.
3. docs/REDESIGN_HANDOFF_2026-11-05.md — latest source changes and checks.
4. docs/MOCKUP_PAGE_REGISTER.md — all 66 reference images mapped to real components.

## Presentation work completed in source

- Shared navy/turquoise frame, decorative lagoon waves, glass panels and responsive controls.
- Three-role workspace chooser with actual workspace identities and create/join actions.
- Team Overview composition, including primary task, fixtures, quick actions, entries and finance.
- Player Profile appearance editor and side rail; duplicate identity banners removed.
- Full-screen sign-in/sign-up/verification presentation and keyboard handling.
- Dedicated tournament registration page and a review step before the existing submission.
- Dedicated private payment-proof selection/review page.
- Centered, keyboard-contained membership-ending confirmation.
- Focused roster-player editor and organizer player search/creation layouts.
- Compact team context covers, dedicated staff invitation/permissions pages, and finance add/draft-editor views.
- Coach/referee profile cover, record tabs and summary sidebar.
- Public organization cards, directory spacing/pagination, news feature/cards and article sidebar.
- Existing Player, Team, Organizer, tournament, Official and Admin features retained.

## Acceptance boundary

The image designs are not feature-completion evidence. Refer to the register for supported page/state mappings and explicit differences. Final local checks are documented in the handoff. Real-account authorization, persistence, uploads, email delivery and deployment require the owner's existing environment and remain separate acceptance work.

Do not apply migrations, reset the database or deploy merely to demonstrate the new appearance.

## Latest functional addition

Player and tournament edit/delete controls: see docs/PLAYER_TOURNAMENT_EDIT_DELETE.md for exact locations, guarded deletion rules, migration activation and verification. Preserve all existing design work. The new migration has not been applied remotely.

## Team logo rule

Show the uploaded team logo without an added shield, frame or clipping. Preserve its original aspect ratio and transparency. TeamLogo is the shared component; missing artwork uses simple initials. This user-requested rule overrides shield framing shown in earlier mockups.
