# Kulhivaru+ acceptance matrix

Updated: 21 October 2026

Statuses distinguish local implementation/tests from live Supabase verification. No journey is marked release-complete while live integration is blocked.

| Journey | Local evidence | Live/owner status |
|---|---|---|
| A. Organizer draft → setup → registration → roster → fixtures → results | UI/data contracts, 11-step validation, applications, rosters, competition planner, match center, and journey tests pass | **Blocked:** migrations, RLS, Storage, Auth, and persistence not run against Supabase |
| B. Organizer-created team/player → real claim | Atomic claim SQL, invitation expiry/revocation, Edge Function contract tests, creator-scoped UI pass | **Blocked:** Edge Function runtime and real verified-account claim unavailable; full national-ID matching flow remains not implemented |
| C. Team manager roster/application/history | Team/application/roster data functions and UI contracts pass | **Blocked:** live team-scoped RLS and persistence unavailable |
| D. Player claim → history/statistics/card | Confirmed-only stats, breakdowns, privacy card, and empty-state tests pass | **Blocked:** live published profile/RPC checks unavailable |
| E. Confirmed result → standings/statistics/milestones; correction | Pure calculations, correction version semantics, audit SQL contracts pass | **Blocked:** live RPC/triggers/RLS recalculation unavailable |
| F. Guest public pages/private denial | Public empty states, privacy tests, and browser smoke pass | **Blocked:** live guest/cross-record RLS verification unavailable |
| G. Cross-team/org/unassigned official denial | Policy-contract tests cover scopes and assigned match rules | **Blocked:** live RLS denial tests unavailable |
| Stage 7 operations | Staff UI, MVR finance, scoped exports, queued notifications, and local tests pass | **Blocked:** live finance RLS/Storage and email provider delivery unavailable |

## Known incomplete or provider-dependent items

- Supabase Edge Functions have static contract tests only. Deno is not installed, and Docker/Podman is unavailable for `supabase functions serve`.
- Email notifications are queued, not delivered. Delivery requires a selected provider, verified sender/domain, provider API secret stored in Edge Functions, email function configuration, and delivery callbacks/status handling.
- National-ID HMAC matching is reserved for the trusted server flow; the owner-facing UI does not collect national IDs.
- No demo accounts, demo sports data, deployments, production SQL, or migration applications have been used.
