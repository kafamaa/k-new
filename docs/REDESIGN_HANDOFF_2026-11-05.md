# KULHIVARU+ redesign handoff — 5 November 2026

## Continued source

This update continues the supplied application. It does not restart the project or replace the data layer. The authoritative feature scope remains `docs/KULHIVARU_PLUS_FINAL_PLAN.md`, with prior implementation and deployment notes in `docs/IMPLEMENTATION_STATUS.md` and `docs/RELEASE_STATUS_2026-11-03.md`.

The original upload had no root `plan.md`; a concise continuation index has now been added. `docs/IMPLEMENTATION_PLAN.md` is an older foundation-stage document and is not the latest completion report.

## Reference review

Inspected 66 reference images: 50 from `mockup.zip`, plus 16 additional staff, finance, history, roster and coach previews from the earlier work. `docs/MOCKUP_PAGE_REGISTER.md` maps each image to actual source and records capability differences. Several images depict states of the same page rather than separate routes.

An image is not evidence that its pictured feature exists. Existing names, photos, logos, scores, statuses and financial records remain data-bound. No example accounts, sample transactions or mockup screenshots were added to the application.

## Implemented in this source update

- Shared navy/turquoise frame, responsive lagoon-wave background, glass panels, readable tables, consistent controls, focus indicators and status treatment.
- Rebuilt My Work around three role cards with actual workspace identities, prominent Open Workspace buttons, and create/join actions. Recent/pinned workspaces, official assignments and protected administration remain available.
- Rebuilt Team Overview with a compact photo identity banner, four metrics, main task/fixtures/results column and quick-actions/entries/finance sidebar.
- Added compact team context banners and horizontal tournament-entry cards throughout Team Workspace.
- Refined My Profile into an appearance/photo panel, editable details, player-record and publication sidebar. Removed duplicate large identity banners; retained private details, profile extras, photo operations, correction requests and their real save handlers.
- Sign-in, sign-up, recovery and verification now use the full-screen photo/form presentation, with a brand header/footer, keyboard containment, Escape handling and focus restoration. Password validation, consent, return destinations and real Supabase handlers remain in place.
- Added a dedicated tournament registration layout with tournament cover/logo, form and summary sidebar. The form now reviews actual configured answers before the existing submit handler runs, and Edit details preserves answers.
- Added a dedicated payment-proof page with file selection, filename/size review and an explicit private-upload action. Selecting a file does not upload it or verify payment.
- Added a focused roster-player editor, preserving the existing inline controls and submission/version workflow. Applying local roster edits does not mutate a previously submitted roster.
- Reorganized organizer player search/creation into dedicated form-and-summary layouts, keeping the existing identity-safe handlers and roster tools.
- Added a centered membership-ending confirmation with focus containment, Escape/cancel handling, explicit final action, and the existing history-preserving server operation.
- Added dedicated staff invitation and permission-editing layouts. Existing authorization, owner restrictions and audit behavior remain in place. Invitations still use the existing one-time private-token flow.
- Reorganized team finance into a ledger dashboard and dedicated transaction form/sidebar. Added access to the existing draft-edit API for amount/description; other draft fields remain read-only and recorded entries retain their void-with-reason workflow.
- Replaced public organization rows with cover/identity/description cards; refined public directory filters, pagination and closing banners.
- Reorganized News into a wide featured story and card grid, with an article/sidebar layout.
- Refined coach/referee cards and public profiles around real published names, island, biography and published records. Unsupported qualifications are clearly absent.
- Shared shells and controls also style the existing Organizer, tournament, Official and Platform Administration screens. Their existing tools and permission gates were preserved.

## Validation

- All **947 tests in 90 files** pass. Final Vitest JSON reports success and zero failures.
- ESLint passes.
- TypeScript and Vite production build pass.
- **80 page/viewport checks plus 36 interaction-state captures** passed with no detected horizontal overflow or browser errors. Desktop (1448px) and phone (390px) checks cover the actual public, Player and Team source components plus focused form/dialog states. They use isolated fixtures outside the packaged application. Details are in `docs/VISUAL_QA_RESULTS.json`.
- Verified review/edit-back preserves application answers; reviewing/cancelling does not submit; receipt selection does not upload; invitation sending remains behind its confirmation checkbox; roster edits remain behind roster submission; membership confirmation contains keyboard focus and closes with Escape.
- Corrected phone-header overflow, squeezed player-selection radios, duplicate profile banners and a legacy footer style leaking into the payment action bar.
- Dependency lockfile, database migrations and backend source contracts remain unchanged.

These browser checks establish rendered layout, width containment and specific local interactions. They do not certify pixel equality, live authorization or persistence. Empty-state checks are not proof of populated standings/brackets or private records.

## Implemented versus incomplete/blocked

| Area | Implemented in the supplied/updated source | Still requires live acceptance or further capability |
|---|---|---|
| Public pages | Existing loaders/routes, cards, profiles, competition pages; refined visual system | Published live-record and opt-in checks |
| Player | Existing career, profile, digital card, requests, documents, privacy and history; refined layouts | Real-account access, saves, downloads and private-file acceptance |
| Team | Existing squad, invitations, applications, rosters, matches, history, finance and staff; updated compositions/editors | Real role matrix, server mutations, uploaded files and version/audit acceptance |
| Organizer/tournament | Existing creation, setup, teams, draws, fixtures, official operations, finance and completion; shared visual frame | Full signed-in tournament journey against the existing environment |
| Administration | Existing protected management tools using shared shell/controls | Actual administrator permission checks and individual-page acceptance; no Admin mockup was supplied |
| Coach/referee | Public API-backed cards and profile layout | Migration 047 availability/publication; expertise/licenses are not in this API |
| Team preparation | Existing readable participants and result-report workflows | A separate synchronized editable team-preparation worksheet is not part of the supplied backend |
| Registration/finance | Real configured questions, separate application/payment/roster states, existing ledger rules | Do not infer unsupported form/bank/license fields from illustrations |
| Feature roadmap | Existing local implementation in the release register | Remote migration/Edge Function/Storage/RLS checks; remaining roadmap items such as Swiss/double elimination are not claimed complete |

No real account login, invitation send, email delivery, payment action, production migration, database reset or deployment was performed during this update. Earlier live acceptance and deployment blockers remain separate from the presentation work.

## Using the update

1. Keep a copy of the existing project and merge the updated `app/` source into it.
2. Keep the owner's existing `.env.local`; environment credentials are intentionally excluded from the package.
3. Install the locked dependencies with `npm ci`, then run `npm run dev`.
4. Review the existing real accounts/roles against the reference register. Confirm actual saves, invitations, uploads, official results and audit/version history in the owner's configured environment.
5. Continue the feature roadmap from the authoritative plan and release notes. Do not treat a visual reference or fixture screenshot as backend completion evidence.

## Subsequent player/tournament management addition

See PLAYER_TOURNAMENT_EDIT_DELETE.md for the new visible editing controls, guarded record deletion, database migration and separate verification results. This builds on the design pass described above.

## Team logo presentation

Removed the generated shield around team logos. The shared TeamLogo component now renders uploaded artwork at its original aspect ratio, with transparency and no added frame or clipping. Team cards, homepage scores, player match/history views and squad panels use the same component. A missing logo shows simple initials. Uploaded artwork itself is unchanged.

Logo update validation: lint, TypeScript/production build and all 951 tests pass. Desktop and phone checks cover square, landscape and portrait images plus missing-logo initials; images fit their available space with no added shield, clipping or background.
