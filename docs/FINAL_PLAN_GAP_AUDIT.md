# Final plan gap audit — 2026-11-02

Source: docs/KULHIVARU_PLUS_FINAL_PLAN.md (76 sections, read in full).
Compared with the app after the 62-page specification and redesign stages (see docs/FINAL_SPEC_GAP_AUDIT.md, docs/IMPLEMENTATION_STATUS.md, docs/ROUTE_PAGE_MATRIX.md).

Status labels: **Implemented Locally**, **Live Verified**, **Owner Accepted**, **Blocked**. Nothing here is Owner Accepted; every signed-in journey is Blocked on the owner's real-account testing. “Not re-checked” means it was built in an earlier stage and was not re-inspected against this plan in this stage.

## Changed in this stage

| Plan section | Change | Status |
|---|---|---|
| 5.4 Claim vs publication | Public player pages and lists show “Claimed by the player” or “Record managed by an authorized organizer”, never “Verified profile” for a claim | Implemented Locally |
| 5.4 Team ownership | “Managed by tournament organizer” / “Managed by the team” label from `get_public_team_management` (migration 041) | Blocked: owner to apply 041 |
| 6.1 Public navigation | Home, Tournaments, Matches, Teams, Players, More; Search, Language, Account | Implemented Locally |
| 6.3 Workspace navigation | Exact plan labels for all six workspaces; Tournament workspace reduced from six groups to five | Implemented Locally |
| 8 Landing | Browse by Sport, Match Center, Tournament Hub with Completed Archives, Players and Teams, Organizer CTA, plan order and hero actions | Implemented Locally |
| 37 Teams & Players | Claims, Possible duplicates and Imports tabs; batch claim invitations; duplicate review requests; CSV and Excel import with template, column matching and history | Implemented Locally (signed-in check Blocked) |
| 19 Archive discovery | `#archive` page with sport/year/island/organizer filters and search; banner on completed tournaments | Implemented Locally |

## Already present (earlier stages)

| Plan section | Where | Status |
|---|---|---|
| 2.2 Organizer-first players, claim later | Quick roster entry, identity lookup before create, claim-player function | Implemented Locally; functions Live Verified (respond 401 signed out); journey Blocked |
| 5.2 Private identity digest | register-identity Edge Function (HMAC server side), lookup mode | Implemented Locally; lookup mode Blocked: owner to deploy |
| 9–18 Public pages | Search, directories, tournament/match/team/player/organization detail, standings, bracket, news | Implemented Locally; 038 functions Live Verified |
| 20–23 Auth and Choose Workspace | Sign-up with agreement, recovery, safe return, workspace chooser, account settings | Implemented Locally; Blocked: real account |
| 24–29 Player workspace | Overview, profile, card, career, requests, privacy | Implemented Locally; Blocked |
| 30–34 Team workspace | Overview, squad, tournaments, matches/history, manage | Implemented Locally; Blocked |
| 35–39 Organizer workspace | Overview, tournaments, teams and players, operations, settings | Implemented Locally; Blocked |
| 40–49 Tournament engine | Nine-stage setup, registration control, draw, fixtures, match center, results, completion | Implemented Locally; Blocked |
| 50–53 Official workspace | Assignments, match center, availability, notices | Implemented Locally; Blocked |
| 54–59 Super Admin | Server-side access, records, create on behalf (040), cases, customization | Implemented Locally; 040 Blocked: owner to apply |
| 63 PWA | Manifest, install prompt, offline notice, match-event queue | Implemented Locally |

## Remaining gaps (not built or not re-checked)

| Plan section | Gap | Notes |
|---|---|---|
| 5.3 / 5.4 | Separate stored claim states (invited, pending, disputed) and publication states (ready, unpublished, restricted) as distinct fields | Not re-checked. Today `is_claimed` and `is_published` plus claim requests; a schema change would need a reviewed additive migration |
| 5.4 Dated history | Team level and historical jersey number on every membership | Not re-checked against `player_team_memberships` |
| 31 Bulk tools | Batch Mark eligible and Request documents on tournament rosters | Not built. XLSX import and batch claim invitations are done (section 37) |
| 58 Controlled merge | Full eight-step merge flow with second confirmation | Not re-checked |
| 59 Customization | Version history and rollback for every customization | Not re-checked |
| Phase 1 | One shared page/workspace shell component across all pages | Partial: shared CSS and WorkspaceShell; not one component everywhere |
| Phase 12 | Migration/RLS integration tests against a database, Edge Function runtime tests, preview deployment, release checklist | Not done; needs owner environment |
| 71 Acceptance journeys | Organizer-created player → claim → continuous career; transfer; full tournament to archive; cross-organization denial; official scope; admin reason/audit | Blocked: real-account testing by the owner |

## Owner actions

1. Review and apply migrations 202611010040, 202611010041 and 202611010042 in the SQL editor.
2. Deploy the updated `register-identity` Edge Function.
3. Run `supabase migration repair` for 026–042 so CLI history matches.
4. Run the section 71 acceptance journeys with real accounts and reply “passed” or with what failed.

Release readiness: **hold**. The plan's acceptance journeys have not been run with real accounts.
