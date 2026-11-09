# Kulhivaru+ implementation plan

## Discovery findings (21 Oct 2026)

- The workspace contained only `doc/` requirements, `.env.local`, and `opencode.json`; there was no app, package manifest, README, route tree, migration, test, or Git repository. Git commands therefore report “not a git repository”; no existing application work or data was overwritten.
- The requirements specify React + TypeScript + Vite, Supabase Auth/Postgres/RLS/Storage, Vercel, Maldives timezone, English/Dhivehi-ready UI, and a mobile-first liquid-glass visual system.
- `doc/kulhivaru-homepage-reference.jpeg` exists and was inspected. It is copied to `public/assets/homepage-reference.jpeg` for visual reference only; it is not used as a page substitute or source of data.
- `.env.local` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; values are never printed or committed. `opencode.json` configures a read-only Supabase MCP URL for project `qmxpokmvmlqfswnjcgke`, but no Supabase MCP resources are connected in this session.

## Architecture

- Vite + React + TypeScript single-page app with component-level responsive UI.
- Supabase browser client uses only the publishable key. All privileged identity processing and future trusted operations belong in Edge Functions; no service role key is accepted by the client.
- Supabase migrations are additive and reviewable. RLS is enabled on every foundation table. Production application is intentionally not performed by this agent.
- Public landing content currently has empty-safe presentation scaffolding; real published records will replace hardcoded visual examples through typed queries before public data is shown as real.

## Staged work

1. **Stage 0 — discovery and foundation (in progress):** app shell, responsive public experience, auth entry points, environment handling, migration baseline, docs, tests/tooling.
2. **Stage 1 — account security:** profile bootstrap, verified-email recovery, session/workspace routing, RLS tests, claims Edge Function design. (Implemented locally; live verification blocked.)
3. **Stage 2 — sports records:** organizations, teams, players, memberships, public/private fields, protected identity digests, trusted invitations/claims, dated player-team history, and creator-scoped record UI. (In progress.)
4. **Stage 3 — tournament setup:** private organization-scoped drafts, 11 resumable steps, registration settings/questions, applications, versioned rosters, separate payment state, and private documents are implemented locally. Live exit verification remains.
5. **Stage 4 — competition:** competition schema, round-robin/two-leg fixture generation, preview/save UI, match/official/event/result records, and confirmed-only standings foundations are implemented locally; format expansion and live validation remain.
6. **Stage 5 — match operations:** confirmed results, sport event schemas, offline queue and conflict review. Match-center UI, trusted event/result/correction RPC contracts, idempotent replay, and local conflict tests are implemented; live sync/RLS integration remains blocked.
7. **Stage 6 — history:** confirmed-only player/team history calculations, breakdown filters, sourced automatic/manual milestones, correction-safe recalculation, official statistics RPC, and privacy-safe data-driven player cards are implemented locally; live verification remains.
8. **Stage 7 — operations:** scoped staff assignments, manual MVR finance records/statuses, private proof/receipts, permission-aware reports/exports, and queued in-app/email notifications are implemented locally; provider and live RLS verification remain.
9. **Stage 8 — hardening:** local security/policy audit, secret scan, journey-contract tests, typecheck/lint/build, narrow-browser accessibility smoke, and release findings are recorded. Live RLS/Auth/Storage/Edge Function checks remain blocked.
10. **Stage 9 — owner acceptance:** `docs/OWNER_TESTING_GUIDE.md` is prepared for real-account testing; deployment, provider setup, and owner feedback remain required.

## Risks and required access

- Supabase MCP read-only access must be connected to inspect the live schema before applying any migration. No production SQL or migration deployment is authorized.
- The publishable key is required for real auth testing. The owner must provide/maintain it in local/Vercel environment variables; no secret key is needed in browser code.
- Real-account acceptance requires owner authorization, consenting participants, and a genuine draft tournament. No demo data will be seeded.
- Trusted claim Edge Functions require server-only `SUPABASE_SERVICE_ROLE_KEY` and `CLAIM_TOKEN_HMAC_SECRET`; neither is placed in browser code or committed. The readable national ID is not accepted by the client and is not stored by the migrations.
- Stage 3 requires review of migrations `202610210003_tournament_drafts.sql` and `202610210004_tournament_registration.sql`, then authorized live checks for organizer/team-manager isolation, persistence after refresh, private Storage access, and separate statuses. Stage 4 must wait for those checks.
- Stage 4 adds `202610210005_competition_engine.sql`; local tests cover fixture generation, confirmed-only standings, supported format/status constraints, and assigned-match authorization. Do not run migration/reset commands until Docker/Podman is available and the CLI target is confirmed local.
- Stage 8 audit found no privileged browser secret, but Edge Functions are not locally Deno/deployment-tested, and the staff-assignment UI/email provider are not release-ready. Queued email must never be reported as delivered.
