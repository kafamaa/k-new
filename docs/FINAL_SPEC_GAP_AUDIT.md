# Final specification — gap audit

Against `KULHIVARU_PLUS_FINAL_PAGE_SPECIFICATION.md` (2 November 2026). Status is from the code as of this date, signed-out browser checks and read-only database probes. **No page counts as accepted until it is tested with a real authorized account** (spec section 5).

Legend: **Built** — the page and its main parts exist. **Partial** — exists, named parts missing. **Missing** — not built. **Decision** — needs the owner.

## Operating model (section 1)

| Item | Status | Notes |
|---|---|---|
| Player record without an account; claim later keeps history | Built | `player_profiles.account_id` null until claimed; claim-player Edge Function (deployed). |
| National ID: normalized, HMAC digest only, server-side | Built | register-identity Edge Function (deployed); raw ID never stored or returned. |
| Player statuses | Built (needs 040) | Derived status: unclaimed, invited, claimed, verified, restricted (admins only), merged. Archived has no source column yet. |
| Readable player ID | Kept as `KHP-000184` | Owner chose the easiest option for users (2 Nov 2026): existing IDs on cards and profiles stay the same. |
| Super Admin merge and claim disputes | Built | Two-person merge (035), cases. |

## Part A — Public (pages 1–15)

| Page | Status | Missing |
|---|---|---|
| 1 Landing | Built | Waiting for owner acceptance. |
| 2 Global search | Built | Recent searches on device to verify. |
| 3 Tournaments listing | Partial | Team count on cards; status chips as specified. |
| 4 Tournament detail | Built | Five tabs (Overview, Teams, Matches with Upcoming/Live/Results, Competition with Groups/Standings/Bracket/Statistics, More with registration, rules, sponsors, news); one main action by state (Register Team, Watch Live, View Results, Registration Closed); old ?tab= links redirect. |
| 5 Registration | Partial | Organizer-assisted option, review step, status tracking page to verify. |
| 6 Live and matches | Built | Tabs Live, Today, Upcoming, Results; `#live` opens Live. Island filter still missing. |
| 7 Match detail | Built | Officials when public. |
| 8 Teams listing | Partial | Active-tournament filter. |
| 9 Team detail | Built | Tabs Overview, Players, Matches (upcoming + results), History; every earlier section kept. |
| 10 Players listing | Partial | Sport filter; limited-public rules for unclaimed players. |
| 11 Player detail | Built | Tabs Overview, Digital Card, Career, History; full history page kept. Card verification link still missing. |
| 12 Organizations | Built | Detail tabs Overview (with sponsors), Tournaments, Teams, News; each tab loads only its own data. |
| 13 Standings | Built | Tie-break explanation to verify. |
| 14 Bracket | Partial | One round at a time on phones. |
| 15 News | Partial | Categories differ (content types); gallery links. |

## Part B — Authentication and account (16–20)

| Page | Status | Missing |
|---|---|---|
| 16 Create account | Built | `#signup` opens the form; password confirmation and required Terms/Privacy agreement added; resend cooldown to verify. |
| 17 Sign in | Built | `#signin` opens the form over Home. |
| 18 Password recovery | Built | `#forgot-password` and `#reset-password`. |
| 19 Choose Workspace | Built | Includes Super Admin. |
| 20 Account settings | Partial | Timezone; active-session list (sign out everywhere exists). |

## Parts C–E — Player, Team, Organizer workspaces (21–38)

| Area | Status | Missing |
|---|---|---|
| Player 21–26 | Partial | Built as Home, Career, Matches, Card, More; spec menu is Home, Profile, Career, Requests, More. Duplicate-profile report to verify. |
| Team 27–32 | Partial | Five groups exist; menu to align to Home, Players, Tournaments, Matches, More. |
| Organizer 33–38 | Partial | Organization-level finance (37) beyond per-tournament finance; menu alignment. |

## Part F — Tournament engine (39–48)

| Page | Status | Missing |
|---|---|---|
| 39 Home | Built | Menu to align: Home, Setup, Teams & Rosters, Competition, Matches, More. |
| 40 Setup wizard | Built | Save & Continue opens the next stage (to verify). |
| **41 Teams & Rosters** | **Partial — started** | **Done now:** quick roster table (name, masked ID card, jersey, position, status), Paste List, Import CSV, possible-duplicate check (organizer decides), Select all, Export CSV, Print. **Still missing:** XLSX import (CSV asked instead), Copy Previous Roster, batch Mark eligible / Request documents / Send claim invitation / Move, summary cards and the six tabs. |
| 42 Duplicate review | Partial | Exact digest match stops and asks the organizer to use the existing player; **automatic linking** needs a change to the register-identity Edge Function. Possible matches are flagged by name. Merge is Super Admin only (built). |
| 43 Draw | Partial | Pots/seeding, third-place match to verify. |
| 44 Fixtures | Built | Rest/conflict checks to verify. |
| 45 Matches directory | Partial | Review / Official / Postponed tabs. |
| 46 Match Center | Built | |
| 47 Results output | Partial | Discipline/suspension view and custom rankings to verify. |
| 48 More | Built | Social graphics. |

## Parts G–I — Official, Super Admin, shared (49–62)

| Area | Status | Missing |
|---|---|---|
| Official 49–52 | Partial | Availability calendar (availability exists), assignment response. |
| Super Admin 53–58 | Built | Menu groups differ from People / Sports / Operations / Platform. |
| 59 Notifications | Partial | Inbox exists in workspaces; one shared inbox with filters. |
| 60 Help and legal | Built | Owner writes the legal text. |
| 61 Offline/PWA | Built | |
| 62 Not found / denied / maintenance | Built | Network-unavailable page to verify. |

## Suggested order

1. Owner acceptance of Page 1; owner decisions on player ID format and status field.
2. Page 41 remainder and Page 42 automatic linking (Edge Function change, owner deploys).
3. Page 16–18 routes and the legal agreement.
4. Public detail pages 4, 9, 11, 12 into the five-tab structure.
5. Workspace menus aligned to the final menu table.
