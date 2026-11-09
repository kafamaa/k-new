# Route and page matrix (Stage 0)

Status levels, as the redesign prompt requires:

- **Implemented Locally** — built; typecheck, lint, tests and build pass; checked in a local browser signed out.
- **Live Verified** — read-only probes confirm the live database objects it needs.
- **Owner Accepted** — the owner tested it with a real account and replied "passed".
- **Blocked** — waiting on something outside the code (owner action, credential, account).

Baseline on 2 November 2026: typecheck pass, lint pass, 737 tests, build pass. Supabase project ref `qmxpokmvmlqfswnjcgke` (from `.env.local`; no secrets printed). Migrations 026–038 live by probe; 039 applied by owner (not probeable by guests); CLI history needs `supabase migration repair` (owner).

| Route | Page (final spec) | Status | Notes |
|---|---|---|---|
| `/`, `#home` | 1 Landing | Implemented Locally | Owner acceptance pending |
| `#search?q=` | 2 Global search | Implemented Locally | |
| `#tournaments` | 3 Tournaments | Implemented Locally | Team count on cards missing |
| `#tournament/:slug` | 4 Tournament detail | Implemented Locally | Five tabs |
| `#tournament/:slug/register` | 5 Registration | Blocked | Needs a signed-in team manager to verify |
| `#live`, `#matches` | 6 Live and matches | Implemented Locally | Island filter missing |
| `#matches/:id` | 7 Match detail | Live Verified | 038 functions respond |
| `#teams`, `#team/:slug` | 8–9 Teams | Implemented Locally | Active-tournament filter missing |
| `#players`, `#player/:slug`, `#history/:slug` | 10–11 Players | Implemented Locally | Card verification link missing |
| `#organizations`, `#organization/:slug` | 12 Organizations | Implemented Locally | No published organization to view yet |
| `#standings`, `#bracket` | 13–14 | Implemented Locally | Phone one-round bracket missing |
| `#news`, `#news/:slug` | 15 News | Implemented Locally | |
| `#explore` | Public navigation | Implemented Locally | |
| `#signup`, `#signin`, `#forgot-password`, `#reset-password` | 16–18 Account | Implemented Locally | Sign-in itself needs a real account |
| `#workspace` | 19 Choose Workspace | Blocked | Owner sign-in needed |
| `#account` | 20 Account settings | Blocked | Owner sign-in needed |
| `#workspace/player/:id` | 21–26 Player workspace | Blocked | Menu alignment pending; owner sign-in needed |
| `#workspace/team/:id` | 27–32 Team workspace | Blocked | Menu alignment pending |
| `#workspace/organization/:id` (+ tournament) | 33–48 Organizer and tournament | Blocked | Quick roster built (Implemented Locally); owner sign-in needed |
| `#workspace/official/:id` | 49–52 Official | Blocked | Needs an assigned official account |
| `#workspace/platform-admin` (old `#admin` redirects) | 53–58 Super Admin | Blocked | Owner sign-in needed |
| `#info/:topic` | 60 Help and legal | Implemented Locally | Legal text is the owner's |
| unknown links | 62 Not found | Implemented Locally | |

## Final plan update (docs/KULHIVARU_PLUS_FINAL_PLAN.md) — 2026-11-02

| Route | Page (final plan) | Status | Notes |
|---|---|---|---|
| `#archive` | 19 Public archive discovery | Implemented Locally | Completed and archived tournaments; sport, year, island and organizer filters; search; stable `#tournament/:slug` links. Live data has no completed tournament yet, so only the truthful empty state was seen |
| `#tournament/:slug` (completed) | 19 Archive banner | Implemented Locally | “Completed historical record” banner; not seen live (no completed tournament) |
| `#player/:slug` | 15 Neutral management label | Implemented Locally | “Claimed by the player” or “Record managed by an authorized organizer”; no longer called “Verified profile” |
| `#team/:slug` | 14 Neutral management label | Blocked | Needs migration 041 (`get_public_team_management`); shows no label until applied |
| Header and phone bar | 6.1 Public navigation | Implemented Locally | Home, Tournaments, Matches, Teams, Players, More; Search, Language, Account. `#live` still opens the Live tab |

## Final plan 37 update — 2026-11-02

| Route | Page (final plan) | Status | Notes |
|---|---|---|---|
| `#workspace/organization/:id?section=claims` | 37 Claims | Blocked | Built (Implemented Locally); owner sign-in needed |
| `#workspace/organization/:id?section=duplicates` | 37 Possible duplicates | Blocked | Built (Implemented Locally); owner sign-in needed |
| `#workspace/organization/:id?section=imports` | 37 Imports (CSV and Excel) | Blocked | Built (Implemented Locally); owner sign-in needed |

## Simple tournament flow — 2026-11-02

| Route (tab) | Step | Status | Notes |
|---|---|---|---|
| `…?section=tournaments` | 1 Create | Blocked | Name, sport, logo, cover; opens Teams. Built (Implemented Locally) |
| `…&tab=overview` | Home | Blocked | One next action, four cards, five-step progress |
| `…&tab=teams` | 2 Teams | Blocked | Join choice, simple team list, Confirm Teams |
| `…&tab=fixtures` | 3 Schedule | Blocked | Recommended format, automatic schedule, Publish Schedule |
| `…&tab=matches` | 4 Play | Blocked | Next match, Simple Match Center, Confirm Result; Live label needs migration 042 |
| `…&tab=completion` | 5 Finish | Blocked | Checklist, awards, Finish and Publish Archive |

## Workflow redesign — 2026-11-02

| Route | Page | Status | Notes |
|---|---|---|---|
| `#home` | Landing (12 parts) | Implemented Locally, checked live signed out | App preview uses a real published tournament |
| `#workspace` | My Work | Blocked (sign-in) | Five kinds of work |
| `#workspace/organization/:id?section=tournaments` | Organizer tournaments | Blocked (sign-in) | Cards with phase and pending work |
| `…&tid=:id&tab=…` | Tournament workspace (own shell) | Blocked (sign-in) | New tab `reports` |
| `#tournament/:slug?tab=schedule|results|standings|bracket|teams|players|statistics|news|rules|sponsors|awards` | Public tournament page | Implemented Locally | Players and Statistics need migration 043 |
