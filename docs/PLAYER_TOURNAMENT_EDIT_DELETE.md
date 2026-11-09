# Player and tournament editing and deletion — 5 November 2026

This update extends the saved redesign without replacing working features.

## Where the controls are

- Organizer → Players automatically lists the player records this account created. Search still finds readable published or managed records. Edit player and Delete player appear for this creator’s unclaimed records. Editing uses the existing name, island, atoll and position form and preserves player ID, public link and history.
- Organizer → Claims retains the existing player editor and now also offers the same deletion confirmation.
- Organizer → Tournaments cards have Edit tournament and Delete tournament beside Open Tournament. Edit opens the existing setup editor at Basics; categories, registration, branding and rules remain available through the existing editor.
- Tournament workspace header has Edit tournament. More → Tournament details also has Edit and Delete alongside the existing lifecycle controls.
- A claimed player edits their own information in Player → My Profile. A team manager changes membership details or removes a squad member in Team → Players; ending membership preserves history.

## Deletion rules

Deletion is permanent and requires the exact displayed name plus a private reason of 5–500 characters. Opening or cancelling the confirmation does not send a deletion request. The form prevents duplicate submissions and keeps errors in the dialog.

Player deletion follows the existing short correction window: only the creator’s private, unclaimed record created within the last 24 hours, with no linked rows, can be deleted. Memberships, submitted rosters, match appearances, identity keys and claim invitations prevent deletion. A record created with an invitation may therefore need to remain; remove membership or request duplicate review instead. This action does not delete an account.

Tournament deletion is available only for private draft/setup tournaments managed by organization owners or operations members. Only setup configuration may cascade. Entries, matches, staff, payments, documents, news, audit-linked history and other foreign-key dependencies prevent deletion. Use Cancel or Finish & archive for a tournament that has operational history.

Database triggers protect direct deletion paths too, including foreign keys with CASCADE and SET NULL. Each application deletion is atomic, checks the current user’s actual ownership/membership under a parent row lock, and writes a surviving private audit event. Failure rolls back the operation. Anonymous callers cannot execute the deletion endpoints. No service-role credential is added to the browser.

## Database activation

Review and apply `supabase/migrations/20261105144931_managed_record_deletion.sql` through the existing project’s migration process. It creates two deletion RPCs and two protective triggers; applying it does not delete existing records. The frontend displays a migration-needed message until those endpoints exist. No remote migration or deployment was performed here.

## Verification

- ESLint and TypeScript/production build passed.
- All 951 tests in 91 files pass. Four additional client tests cover name/reason validation, endpoint arguments, refusal messages and network failures.
- 36 isolated PostgreSQL-compatible PGlite checks passed against a minimal schema: anonymous/other-user/viewer refusal, linked histories, direct-delete guards, new foreign keys, permitted draft setup cleanup, privilege checks and surviving audit events. See DELETE_DATABASE_QA.json. This is not a full Supabase migration replay or live RLS certification.
- 38 browser assertions passed at desktop 1448px and phone 390px using the actual source components and an isolated test client. They cover player edit save/cancel, deletion open/cancel/Escape, typed confirmation, success/failure, ownership/claimed visibility, active tournament disabling and horizontal overflow. See DELETE_UI_QA.json. Test clients and screenshots are excluded from the app package.
- Existing design references and previous implementation remain in the redesign handoff and mockup page register.

Live acceptance still requires owner-controlled accounts in the configured Supabase environment: verify edit permissions, successful unused-record deletion, linked-record refusal, audit visibility, migration compatibility and navigation back to the list. Keep the existing .env.local when merging the package.
