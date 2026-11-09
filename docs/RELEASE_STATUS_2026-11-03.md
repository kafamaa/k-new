# Release status register — 3 November 2026

States follow the unified plan: **Implemented Locally** (code + automated checks), **Live Verified**, **Owner Accepted**, **Blocked**.
Nothing below is Live Verified or Owner Accepted yet: that needs the migrations applied and the owner's accounts.
This register replaces nothing in `IMPLEMENTATION_STATUS.md`; it records this session only.

Environment for every check: Windows 11, Node, local `vite preview` build, Chromium via Playwright (signed-out pages read the live project anonymously), PGlite (in-process Postgres) for SQL.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` | 87 files, 929 tests, all pass |
| `npm run build` | Pass |
| Signed-out pages at 375 px and 1280 px (16 routes) | No sideways scrolling, no console errors, no broken images |
| Touch targets on a touch phone (375 px) | Every button, input and select ≥ 44 px; only links inside sentences are smaller (allowed) |
| Dhivehi at 375 px | Right-to-left, Thaana font, no sideways scrolling |
| Migrations 046 and 047 in PGlite | Apply cleanly; allowed and denied cases behave (functions run as superuser there, so read policies still need a live check) |
| Built files secret scan | Only the publishable key; no service-role key or HMAC secret |

## Changes in this session

| Requirement (plan section) | Change | State |
|---|---|---|
| Data integrity (26) | Migration 030's damaged `get_player_workspace_matches` rebuilt and exercised in PGlite | Implemented Locally — compare with the live definition before any re-apply |
| Offline queue scoped to the account (28) | Queue keyed per account; legacy queue split by actor; never silently dropped | Implemented Locally |
| Sign-out clears caches (8, 27) | All three sign-out paths clear the offline cache | Implemented Locally |
| CSV formula injection (24) | One safe cell writer for every export; numbers stay numeric | Implemented Locally |
| Maldives time (1) | Four places used Asia/Dhaka (UTC+6) and showed times 1 hour late; now Indian/Maldives; a test forbids other zones | Implemented Locally |
| "Official" wording (2) | Confirmed results labelled "Official" everywhere | Implemented Locally |
| Configurable rest (18) | Already existed; fixed the schedule screen resetting rest and match length to defaults on reopen | Implemented Locally |
| Sponsor deliverables (22) | Migration 046 + Sponsor checklist under Finance | Implemented Locally — needs 046 |
| Protests and appeals (23, 21) | Migration 046; team files from Fixtures; organizer decides with a reason on Matches and Finish; open protests block finishing | Implemented Locally — needs 046 |
| Coach and referee directories (7.2, 32.2) | Migration 047, opt-in from Account Settings; `#coaches`, `#referees`, profile pages; Explore and footer links | Implemented Locally — needs 047 |
| Read-only public API (24) | `public-api` Edge Function: versioned, paginated, rate-limited, anonymous key only | Implemented Locally — needs deploy |
| Dhivehi (6) | Shared language for every screen; shell, menus, sign-in, footer, all status labels in Dhivehi (draft) | Implemented Locally — wording needs native review; page bodies still English |
| Accessibility (6) | 44 px touch targets, visible focus ring, reduced motion, readable sign-in dialog, explicit button types (174 buttons) | Implemented Locally |
| Bugs found on the way | Wrong browser tab titles on 4 pages; search box stacked/22 px tall in directory filters | Implemented Locally |
| Deployment (30, 33) | `vercel.json` headers and caching; `docs/DEPLOYMENT.md`; unused design image moved out of the public site | Implemented Locally |

## Open items

| Item | Blocker / next action |
|---|---|
| Apply 046 and 047; deploy `public-api` | Owner action (docs/DEPLOYMENT.md) |
| Live checks of read policies, signed-in journeys, offline replay | Owner's accounts or a test project |
| Dhivehi page bodies and native review | Translator; then extend `tr()` screen by screen |
| Swiss and double-elimination formats | Scheduled explicitly (plan 32.2); not built |
| Content-Security-Policy header | Test against live domains first |
