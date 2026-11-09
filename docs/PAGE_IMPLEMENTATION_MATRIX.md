# Kulhivaru+ Page Implementation Matrix

Status meanings:
- **Implemented:** route, access control, real data, actions, states and tests are in place.
- **Partial:** usable, but named parts of the specification are missing.
- **Missing:** no page.
- **Live-blocked:** built, but depends on a review-only migration or an undeployed Edge Function.

A route existing is not enough to count as Implemented. "Local only" means verified by tests, typecheck and build; signed-in pages have not been checked in a live browser session.

## Baseline (before this pass) — 2026-10-31

| # | Page | Route | Baseline | Main gaps found |
|---|------|-------|----------|-----------------|
| 1 | Landing | `/`, `#home` | Implemented / Live-blocked (032) | Follow/favourites deferred by spec |
| 2 | Search results | `#search?q=` | Partial | No type tabs, filters, pagination, matches/news groups or URL type |
| 3 | Tournaments listing | `#tournaments` | Partial | No location/date/category filters, pagination or fee/team-limit |
| 4 | Tournament detail | `#tournament/:slug` | Partial | Draw, schedule, news, rules, sponsors tabs; follow; calendar |
| 5 | Registration | `#tournament/:slug/register` | Partial | No waitlisted status |
| 6 | Organizations listing | `#organizations` | Partial | No pagination or location filter; needs 033 to publish |
| 7 | Organization detail | `#organization/:slug` | Partial | No news or sponsors |
| 8 | Teams listing | `#teams` | Partial | No pagination or sport filter |
| 9 | Team detail | `#team/:slug` | Partial | Scores are not public before 032 |
| 10 | Players listing | `#players` | Partial | No public code, position, team or pagination |
| 11 | Player detail | `#player/:slug` | Partial | Public code not shown |
| 12 | Player history | `#history/:slug` | Implemented | Date range uses season filters only |
| 13 | Public Digital Card | (in player detail) | Implemented | — |
| 14 | Matches listing | `#matches` | Partial | Confirmed matches only; no scores, status or pagination |
| 15 | Match detail | `#matches/:id` | Partial | Live timeline and public lineup not exposed |
| 16 | Standings | `#standings` | Partial | Flat table; old calculation versions can repeat; no selector |
| 17 | Bracket | `#bracket` | Partial | Plain match list; no rounds |
| 18 | News listing | `#news` | Partial | No search, category filter or pagination |
| 19 | News detail | `#news/:slug` | Partial | No related stories or share |
| 20 | Help, reporting, legal | `#info/:topic` | Implemented | Legal text is the owner's to publish |
| 21 | Authentication | dialog | Partial | **No reset-password page**; raw error text; no resend verification |
| 22 | Choose Workspace | `#workspace` | Implemented | — |
| 23 | Account Settings | `#account` | Partial | Avatar, atoll, notification preferences, data and closure requests |
| 24 | Player Workspace | `#workspace/player` | Implemented / Live-blocked (player_workspace_final, register-identity) | See IMPLEMENTATION_STATUS |
| 25 | Team Workspace | `#workspace/team/:id` | Partial | 15 flat sections instead of five groups |
| 26 | Organizer Workspace | `#workspace/organization/:id` | Partial | Ten sections in a 4 + More pattern; not grouped as specified |
| 27 | Create Tournament wizard | organizer | Implemented | Nine stages (migration 019) |
| 28 | Tournament dashboard | organizer `tid=` | Partial | — |
| 29 | Tournament setup | organizer | Partial | — |
| 30 | Applications & payments | organizer | Partial | No waitlist |
| 31 | Teams & rosters | organizer | Partial → see this pass | — |
| 32 | Draw & competition | organizer | Partial | — |
| 33 | Fixtures & scheduling | organizer | Partial | — |
| 34 | Match Center | organizer / official | Implemented | Offline queue and idempotency exist |
| 35 | Standings / statistics management | organizer | Partial | — |
| 36 | Tournament operations | organizer | Partial | — |
| 37 | Finance & sponsors | organizer | Partial | Sponsors not built |
| 38 | Media & news | organizer | Partial | — |
| 39 | Completion & archive | organizer | Partial | — |
| 40 | Official Workspace | `#workspace/official` | Implemented | Six sections |
| 41 | Super Admin | `#admin` | Partial | Highlights, announcements, reports, pages and player requests only |
| — | Not found | any unknown link | **Missing** | Unknown links silently open Home |

## After this pass — 2026-10-31

Checks: typecheck clean, lint clean, **611 tests in 62 files pass**, build clean.

Headless browser, signed out, at 390 / 1280 / 1440 px: 33 page loads, no sideways scrolling and no console errors. Covers Home, Matches, Standings, Bracket, Search, News, Tournaments, Account, Player Workspace gate, Reset password and Not found.

Signed-in pages were **not** checked in a live browser.

| # | Page | Now | What changed |
|---|------|-----|--------------|
| 2 | Search results | **Implemented** | Type tabs (all, tournaments, teams, players, organizations, matches, news); best matches; debounced input; query, type and page in the URL; per-category failure notice; paging |
| 3 | Tournaments listing | Partial | Paging added; location, date and category filters still missing |
| 4 | Tournament detail | Partial | New Schedule tab (published fixtures, live state, official scores, MVT); Standings and Bracket tabs open filtered to this tournament. Draw, sponsors, follow and calendar still missing |
| 6/8/10 | Organizations, Teams, Players | Partial | Paging added; sport, position and public-code filters still missing |
| 14 | Matches listing | **Implemented / Live-blocked (032)** | Upcoming, Live, Official results; search, sport, tournament, date and status filters; official scores only; "awaiting confirmation" labelled; paging; URL state. Before 032 it falls back to the confirmed-only list |
| 16 | Standings | **Implemented / Live-blocked (032)** | Tournament selector (URL); newest calculation only; per stage and group; sport columns; published team names and links; updated time; ordering explained |
| 17 | Bracket | **Implemented / Live-blocked (032)** | Tournament selector; rounds from the published knockout draw; two-leg aggregates, byes and walkovers; winners from official scores only; accessible stage-list view |
| 18 | News listing | **Implemented** | Search, category, organization, sort, lead story, paging, URL state |
| 21 | Authentication | **Implemented** | New **Reset password** page (recovery link opens it, never the workspace); plain-language errors; resend verification; 8-character rule for new passwords; emails link back only to known pages in the app; recovery answers the same whether or not the account exists |
| 23 | Account Settings | Partial | Notification preferences and "Your data" added; account avatar and atoll still missing |
| 25 | Team Workspace | **Implemented (navigation)** | Five groups: Overview, Squad, Tournaments, Matches, More; permission-hidden tabs stay hidden; old `?section=` links still work |
| 26 | Organizer Workspace | **Implemented (navigation)** | Five groups: Overview, Tournaments, People & Teams, Operations, More; role permissions kept |
| — | Not found | **Implemented** | Unknown multi-part links show "Page not found"; one-word hashes stay page anchors |
| — | Error text | Fixed | Public pages, Team and Organizer workspaces no longer show raw service errors |

Unchanged in this pass: pages 1, 5, 7, 9, 11–13, 15, 19, 20, 22, 24, 27–41. Their statuses are as in the baseline above.

## Super Admin, Release One — 2026-10-31

Migration `202611010034_super_admin_release_one.sql` (review-only, not applied). Checks: typecheck and lint clean, 628 tests in 63 files pass, build clean. Signed-out browser check at 390/1280/1440 px: `#admin`, `#admin/cases`, `#admin/customization` show "Sign in required", no overflow or console errors. Signed-in admin pages were **not** checked in a live browser.

| Area | Route | Now | Notes |
|------|-------|-----|-------|
| Access, roles, permissions | `#admin` | Implemented / Live-blocked (034) | 10 roles, 26 permissions, expiry, suspension, revocation; bootstrap owners stay in `platform_admins` |
| Overview | `#admin/overview` | Implemented / Live-blocked (034) | Permitted counts only, next action, recent admin actions |
| Cases | `#admin/cases`, `identities`, `support`, `data-requests`, `security-incidents` | Implemented / Live-blocked (034) | Queue, detail, assign, status, decision, internal notes, open case from report; child-safety restricted. Delivering user-visible replies is not built |
| Accounts | `#admin/accounts` | Implemented / Live-blocked (034) | Search, sessions, suspend/restore (Auth ban), sign out everywhere |
| Organizations, teams, players, tournaments | `#admin/<type>` | Implemented / Live-blocked (034) | Hide/restore without deleting; owners cannot re-publish while hidden |
| Matches & results | `#admin/matches` | Partial | Read-only conflict/correction review; freeze and two-person correction not built |
| Public content | `#admin/content` | Implemented | News hide/restore plus existing highlights, announcements, reports and pages |
| Audit | `#admin/audit` | Implemented / Live-blocked (034) | Append-only, filtered, paged, audited CSV export |
| Security | `#admin/security` | Partial | Counts and security history; Auth logs stay in the Supabase dashboard |
| Platform health | `#admin/system` | Implemented | Live probes for API, auth, Edge Functions, migrations, service worker |
| Administrators | `#admin/admins` | Implemented / Live-blocked (034) | Grant, approve, suspend, revoke, extend; owner grants need a second owner |
| Customization | `#admin/customization` | Partial / Live-blocked (034) | Theme colours, radius, landing copy and sections; draft, review, publish, rollback. Brand, fonts, page templates, navigation, media, languages, SEO, PWA, templates not built |
| Finance, notifications, configuration | `#admin/finance` etc. | Missing (planned, Release Two) | Shown as planned; no actions |
| Duplicate player merge | — | Missing | Needs a reviewed merge design; not attempted |

## Super Admin, Release Two — 2026-10-31

Migration `202611010035_super_admin_release_two.sql` (review-only, not applied; apply after 034). Checks: typecheck and lint clean, 645 tests in 64 files pass, build clean. Signed-out browser check (390/1280/1440): home, tournaments, news and three admin routes, no overflow or console errors. Signed-in admin pages and the SQL itself were **not** run against a database.

| Area | Now | Notes |
|------|-----|-------|
| Critical approvals `#admin/approvals` | Implemented / Live-blocked (035) | Propose → a different admin approves → server executes once; both audited; recent sign-in required; no owner exception |
| Result correction and restore | Implemented / Live-blocked (035) | New confirmed version, history kept, standings and milestones recalculated once |
| Freeze public result | Implemented / Live-blocked (035) | Restrictive RLS policy plus match feed; organizers, officials and reviewers still see it. Standings are unchanged until a correction is approved |
| Duplicate player merge | Implemented / Live-blocked (035) | Preview with blockers (same match, same roster, identity or account conflicts); sports history moves, duplicate archived, milestones rebuilt |
| Case replies | Implemented / Live-blocked (035) | In-app notification to the reporter or a linked requester; never for child-safety cases |
| Finance audit `#admin/finance` | Implemented / Live-blocked (035) | Four record kinds, findings, freeze blocks owner edits, audited CSV export; no receipt files |
| Notifications `#admin/notifications` | Implemented / Live-blocked (035) | Delivery list, safe retry. No email sender deployed; no templates exist to edit |
| Configuration `#admin/configuration` | Implemented / Live-blocked (035) | Maintenance, feature display, help contacts, sports shown; versioned and reviewed |
| Customization Studio | Implemented / Live-blocked (035) | Brand, logo, fonts, landing, navigation, page templates, SEO, install text, languages, media library, live preview |
| Sign-in from `#admin` | Implemented | Returns to `#admin` after sign-in |
| Not built | — | Installed-app manifest (needs a rebuild), atolls/islands/venues, file limits, legal version numbers |

## Organizer tournament pages 28–39 — 2026-11-01

Migration `202611010036_tournament_pages_complete.sql` (review-only, not applied; apply after 035). Checks: typecheck and lint clean, 665 tests in 65 files pass, build clean (tournament workspace now its own 195 kB chunk; workspace chunk 334 kB). Signed-out browser check passed; the organizer pages themselves were **not** checked signed-in on the live site.

| # | Page | Now | Notes |
|---|------|-----|-------|
| 28 | Tournament dashboard | Implemented | Header adds setup progress, Preview Public Page and Edit Branding; overview cards unchanged |
| 29 | Tournament setup | Implemented / Live-blocked (036) | Lock and warning panel, sport locked server-side once fixtures exist, public-effect preview, recorded setup changes |
| 30 | Applications & payments | Implemented / Live-blocked (036) | Search and filters, separate statuses, custom answers, waitlist, withdraw, reasoned reject and request changes, payment verify/reject/waive/refund, timeline, safe bulk actions, CSV export |
| 31 | Teams & rosters | Implemented / Live-blocked (036) | Roster size checks, duplicate-player detection, minors flagged, audited unlock with reason |
| 32 | Draw & competition | Implemented / Live-blocked (036) | Saved draws, publish/unpublish with confirmation, fixture versions, draw history |
| 33 | Fixtures & scheduling | Implemented / Live-blocked (036) | By-day and list views, Maldives time, reschedule, postpone, cancel, abandon, reinstate, walkover, manual fixtures, rest and venue warnings, team notifications, CSV export |
| 34 | Match Center | Implemented | Unchanged |
| 35 | Standings & statistics | Implemented / Live-blocked (036) | Points and tie-breakers per stage, reasoned manual adjustments included in recalculation, Recalculate now |
| 36 | Operations | Implemented / Live-blocked (036) | Staff and officials, venues, match-day checklists, incidents, exports, activity |
| 37 | Finance & sponsors | Implemented / Live-blocked (036) | MVR totals, fees, payments, waivers, refunds, expenses, sponsorship and donation income, sponsors with logo upload, level, public description, private agreement notes, public Sponsors tab, CSV export |
| 38 | Media & news | Implemented / Live-blocked (036) | Tournament news with category, cover upload, related team or match, preview, publish, schedule, unpublish, archive |
| 39 | Completion & archive | Implemented / Live-blocked (036) | Server-side completion checks; complete and archive guarded in the database; archive keeps everything |

## Additional features, first pass — 2026-11-01

Migration `202611010037_follows_and_account_profile.sql` (review-only, not applied). Checks: typecheck and lint clean, 672 tests in 66 files pass, build clean; signed-out browser check of home, tournaments, players, teams, standings, news, account and workspace at 390/1280/1440: no problems.

| Area | Added |
|------|-------|
| Follow (tournament, team, player, organization) | Follow button on each public page; private follow list with unfollow in Account Settings (needs 037) |
| Calendar | Download upcoming fixtures for a tournament or team; add a single match to a calendar |
| Tournament detail | Follow, fixtures calendar, postponed-fixture notice, cancelled banner, last-updated date (when the loader provides it) |
| Tournaments listing | Location and start-date filters, included in Clear all and the mobile filter count |
| Players listing | Public player code and position shown; search by code; position filter; sort; clear filters |
| Match detail | Share, add to calendar until played, venue directions |
| Standings | Download table (CSV), share link, last-five form guide from official results |
| News detail | Reading time, share, print view, related stories |
| Sign in | Show or hide the password |
| Account Settings | Account photo upload and removal, island and atoll (needs 037), following list |
| Choose Workspace | Pinned and recent workspaces, saved on the device only |
| Fixtures & scheduling | Printable fixture sheet |
| Not in this pass | Match reminders and alerts (need a scheduled sender), QR code on the card, passkeys, map views, galleries, comments, personalised feeds, and most Team, Player, Organizer and Official workspace P1 items |

## Public site 22 of 22 — 2026-11-01

Migration `202611010038_public_pages_complete.sql` (review-only, not applied): read-only guest functions get_public_match_detail, get_public_tournament_draw and get_public_organization_teams. No table, column or policy changes. Checks: typecheck and lint clean, 682 tests in 67 files pass, build clean; signed-out browser check at 390/1280/1440: no problems.

| Page | Completed |
|------|-----------|
| Tournaments listing | Category filter (from published tournament categories) |
| Tournament detail | Draw tab: published stages, groups and teams (needs 038) |
| Registration | Places left and a waitlist notice when every place is filled; Waitlisted status for the applying team |
| Organizations listing | Location filter (islands of the organization's published tournaments) |
| Organization detail | Teams (needs 038), news, sponsors of its tournaments |
| Teams listing | Sport filter and clear filters |
| Players listing | Team filter; current team shown |
| Match detail | Loads its record (it previously always showed not found); official score, key events, timeline, lineups and match statistics after confirmation (needs 038); scheduled and live fixtures open too |
| Fixed | Public pages no longer render once with the previous page's data after in-app navigation |
| Rule kept | Nothing recorded during a match is public before the result is confirmed, so there is no live minute-by-minute feed for guests |

## Configuration and Customization Studio complete — 2026-11-02

Migration `202611010039_configuration_complete.sql` (review-only, not applied): recreates app_config_problem_for with every 035 rule plus the fields below. No table, policy or grant changes. Checks: typecheck and lint clean, 692 tests in 68 files pass, build clean; service-worker manifest checked in a browser on the production build; signed-out browser check: no problems.

| Area | Completed |
|------|-----------|
| Configuration → Atolls, islands and venues | Published lists become suggestions in every island, atoll and venue field (account, player, team, organizer, tournament setup, fixtures); free text still allowed; built-in list of the 20 administrative atolls and Malé City |
| Configuration → Upload size limits | Lower image (1–5 MB) and document (1–10 MB) limits, applied to every upload check; never above the storage limits |
| Configuration → Legal versions | Version label and effective date per legal page, shown at the top of the page |
| Customization → Installed app | App name, short name, icon (square PNG ≥ 512 from the media library), toolbar and splash colours, with a preview; served by the service worker at /manifest.webmanifest, so no rebuild; iOS title and icon set on the page |
| Still not configurable | Notification defaults |
