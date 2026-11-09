# Kulhivaru+ security audit (2026-10-29)

## Browser secrets
- No service-role key, JWT, or DB password in frontend. Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable key is browser-safe by design).

## RLS coverage
- Every foundation table has RLS enabled (migrations 0001–022). New tables (official_availability, news_articles) enable RLS with self-scoped / published-only policies.

## Function grants
- SECURITY DEFINER helpers (is_team_manager, is_match_participant, player_plays_in_match, has_tournament_permission, claim_player_profile, submit_roster, protect_entry_statuses) revoke PUBLIC/anon and grant only authenticated + service_role, with safe fixed search_path = public and schema-qualified references.

## Policy recursion
- Fixed via player_plays_in_match SECURITY DEFINER helper (migration 016). No remaining recursion in the matches graph.

## Storage
- Private bucket `tournament-private-documents` with operator/team-manager scoped insert/select. No public bucket for identity/payment evidence. Signed URLs not yet wired for downloads — flagged as a follow-up.

## RPC authorization
- submit_roster verifies actor_id = auth.uid() and team-manager/operator role; locked rosters rejected. claim_player_profile is Edge-Function-only (no client insert policy on identity keys).

## Edge Functions
- claim-player, invite-player, revoke-player-invitation exist but are not deployed/tested (Deno not installed). Static contract tests pass. Secrets (SUPABASE_SERVICE_ROLE_KEY, CLAIM_TOKEN_HMAC_SECRET) are server-side only.

## Input validation
- Auth inputs validated (validateAuthInput). File uploads validate type/size (private_documents CHECK). Search queries sanitized (sanitizeSearchQuery strips %_ and caps length).

## Public field selection
- PUBLIC_*_FIELDS constants define the guest-readable column boundary; tests pin the exact strings. Score/result versions, events, officials, assignments, payments, documents never exposed to guests.

## CSV export / finance privacy
- Finance exports are scoped to the caller's authorized scope; no cross-team data. Finance remains private.

## Notification privacy
- Notifications readable only by recipient_id = auth.uid(); deliveries scoped to the notification owner.

## Account/profile linking & claim security
- account_id is unique on player_profiles; claim_player_profile uses row locks + unique constraints. National ID stored only as HMAC digest server-side.

## Return-destination safety
- New returnDestination module validates slugs against a strict pattern, rejects external/malformed values, stores only in sessionStorage, and never carries tokens/emails/private values.

## Findings / follow-ups
1. Storage signed-URL download flow not yet implemented (private documents readable only via policy; UI download path pending).
2. Edge Functions not runtime-tested (Deno unavailable).
3. Email provider not configured; delivery remains queued.
4. Migration 019–022 pending owner application.
5. No open-redirect vulnerability found in the new return flow (validated internal slugs only).

## Super Admin workspace access — 2026-11-02
- Access comes only from the database for the signed-in session: `admin_permissions()` (bootstrap `platform_admins` rows receive every permission) or, before 034, `is_platform_admin()`. Both are revoked from anon; `platform_admins` is readable only for the caller's own row. No new policies or grants.
- The account is confirmed with `auth.getUser()` before the check, and a token for a different account is refused. Email, `user_metadata`, route parameters and UI state are never used for authorization. Nothing is cached in browser storage.
- A failed check is reported as an error, never as "not an administrator"; an expired session is refreshed once, then the person signs in again. Error codes are logged in development only; tokens are never logged.
- The Choose Workspace entry carries only the card fields (name, role label, the account's own id); no admin directory, audit data or other administrators are loaded there.
- No service-role or secret key in frontend code (test-enforced).

## Page 1 — Public landing — 2026-11-02
- Unchanged boundaries: the landing reads only with the session-less public client, only published records, and scores only from confirmed, unfrozen results (get_public_match_feed). No writes; no private fields selected (test-enforced).
- Sports History names a champion only when its team is published.
- The administrator access check moved to src/lib/adminAccess.ts; its failures now show plain-language messages only. Behaviour and authorization are unchanged.
- The closed mobile menu is now hidden from assistive technology and the tab order.

## Migration 040 — 2026-11-02
- Create-on-behalf functions are SECURITY DEFINER with empty search_path, revoked from public/anon, and each calls admin_assert(admin.records.create), admin_require_reason and admin_require_recent_auth, then admin_audit. No deletes.
- player_record_status_for is not callable by clients; player_record_statuses requires a signed-in caller and hides the restricted state unless the caller may moderate players.
- previous_roster_players returns shirt number and position only, for current squad players, and only to the tournament's operators or the team's roster managers.
- The Create page sends a player's ID card only to the register-identity Edge Function and clears it immediately; it is never stored, logged or kept in the browser.

## Final plan stage — 2026-11-02

- Migration 202611010041 (review only, not applied): `get_public_team_management(uuid)` is `security definer` with `search_path = ''`, execute revoked from public and granted to anon/authenticated/service_role. It reads only published, active teams and returns one of two words ('team' or 'organizer') or null: no account, membership or organization identifiers. No writes.
- Public player pages no longer present a claimed account as a verified identity (plan 5.4); claim and verification remain separate.
- Archive page reads the same published tournament fields as the directory; no new data is exposed.
