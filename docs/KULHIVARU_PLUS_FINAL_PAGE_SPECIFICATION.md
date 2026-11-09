# Kulhivaru+ — Final Page-by-Page App Specification

**Version:** 1.0  
**Updated:** 2 November 2026  
**Core product:** Maldives sports tournament management, public sports discovery, permanent player/team/tournament history, and organizer-led operations.

> Saved from the owner's message of 2 November 2026. This is the governing page specification. Gaps against the current app are tracked in `FINAL_SPEC_GAP_AUDIT.md`.

---

## 1. Final operating model

Kulhivaru+ uses an **organizer-first, claim-later** player model.

- A player record is required for participation.
- A player account is optional.
- Organizers create teams, players, rosters, lineups and tournament records by default.
- Team managers may take over team work after accepting an invitation.
- Players may claim an existing player record later.
- Claiming never creates a second player or removes history.
- Match officials/organizers record official events.
- The system calculates confirmed statistics.
- Super Admin resolves duplicate identities and claim disputes.

### 1.1 Account and player are different

**Account (`auth.users` / account profile)**

- Sign-in identity
- Email and recovery
- Language and notification preferences
- Workspace access
- Privacy and correction requests

**Permanent player record**

- Platform player ID
- Sports identity
- Team memberships
- Tournament rosters
- Match participation
- Discipline
- Statistics, achievements and history

The player record may exist without an account. The record belongs to the platform history, not to the organizer who created it.

### 1.2 Player statuses

- `unclaimed` — created by an organizer/team
- `invited` — claim invitation sent
- `claimed` — linked to an account
- `verified` — identity confirmed
- `restricted` — duplicate, dispute, privacy or safety review
- `archived` — inactive but retained for history
- `merged` — replaced by a canonical player record

### 1.3 Identity rule

- Public/internal player key: UUID plus readable Kulhivaru+ Player ID such as `KPL-00001234`.
- National ID is never the public ID or profile slug.
- National ID is normalized and HMAC-digested inside a trusted server function.
- Only the digest is stored for uniqueness.
- Raw National ID must not be logged, returned to clients or stored in public profile tables.

---

## 2. Global design and navigation

### 2.1 Visual system

- Island Sport + Premium Liquid Glass + Sports Broadcast
- Deep navy, lagoon cyan, white, small Maldives-red live accents
- Large editorial headings
- Professional icons; no emoji navigation
- Restrained blur/glow
- Mobile-first, keyboard accessible, reduced-motion compatible

### 2.2 Public navigation

- Home
- Tournaments
- Live
- Explore
- Account

Search remains in the header. Explore contains Teams, Players, Organizations, Matches, Standings, Brackets and News.

### 2.3 Private navigation

After sign-in, always show **Choose Workspace**. Never force the user directly into one workspace.

- Player
- Team
- Organizer
- Official/Staff
- Super Admin (authorized users only)

Every workspace includes **Switch Workspace** without requiring sign-out.

### 2.4 Universal page structure

1. Breadcrumb/back action
2. Page title and short description
3. One primary action
4. Next Action or important alert
5. Maximum four summary cards
6. Maximum five main tabs; advanced tools under More
7. Selected content
8. Loading, empty, error/retry and permission states

---

# PART A — PUBLIC EXPERIENCE

## Page 1 — Landing Page

**Routes:** `/`, `#home`

### Purpose

Explain Kulhivaru+, show current public sports activity and direct visitors to the correct next action.

### Layout

1. Floating header
2. Hero and global search
3. Sports Hub
4. Tournament Showcase
5. Community Spotlight
6. Competition Center
7. How Kulhivaru+ Works
8. History and News
9. Footer

### Hero

- Eyebrow: `MALDIVES’ DIGITAL HOME OF SPORTS`
- Title: `Sports Live. History Forever.`
- Search tournaments, teams, players or islands
- Explore Tournaments
- Create Tournament
- Watch Live only when a genuine live match exists
- Desktop/mobile app preview
- Up to three genuine platform counts; failed counts are hidden, not shown as zero

### Sports Hub

Tabs: Live, Today, Upcoming, Results. Maximum five cards then View All.

### Tournament Showcase

Filters: Featured, Registration Open, Upcoming, Live, Completed. One lead card plus two smaller cards.

### Community Spotlight

Tabs: Players, Teams, Organizations. Published records only.

### Competition Center

Tabs: Standings, Bracket, Fixtures. Preview only; full data lives on dedicated pages.

### How It Works

Player, Team and Organizer cards with one action each.

### Data/privacy

- Published records only
- Confirmed results/statistics only
- No guest writes
- No private contact, identity, document, finance or account fields
- No demo records or raw UUID labels

---

## Page 2 — Global Search

**Route:** `#search?q=`

- Search Tournaments, Teams, Players, Organizations, Matches and News
- Result-type tabs
- Recent searches remain device-local only
- Safe wildcard handling
- Published data only
- Empty, error and retry states
- Result cards use human names/slugs, never raw UUID titles

---

## Page 3 — Tournaments Listing

**Route:** `#tournaments`

- Search
- Filters: sport, status, island, registration state, date
- Status chips: Registration Open, Upcoming, Live, Completed
- Tournament cards: cover, logo, name, sport, status, island, dates, team count, registration state
- Load More/pagination
- One action: View Tournament

---

## Page 4 — Tournament Detail

**Route:** `#tournament/:slug`

### Header

- Cover and logo
- Name, sport, status, organizer, island/venue, dates
- Primary action based on state: Register Team, Watch Live, View Results or Registration Closed

### Tabs

- Overview
- Teams
- Matches
- Competition
- More

**Overview:** description, category summary, registration state, counts, next match, sponsors.  
**Teams:** approved teams and group assignment.  
**Matches:** Upcoming, Live, Results.  
**Competition:** Groups, Standings, Bracket, Statistics.  
**More:** registration information, rules, venues, sponsors, awards, media/news and history.

Never expose applications, private roster documents, payment proofs, staff notes or unpublished results.

---

## Page 5 — Public Tournament Registration

**Route:** `#tournament/:slug/register`

### Flow

1. Sign in when required; preserve safe return destination
2. Select a managed team or choose organizer-assisted registration
3. Complete application/custom questions
4. Upload required team documents
5. Add payment proof when required
6. Review
7. Submit
8. Track application status

If the user manages no team: Create Team, Join Team or contact the organizer. Organizer may enter the team manually from the Tournament Workspace.

---

## Page 6 — Live and Matches Directory

**Routes:** `#live`, `#matches`

- Tabs: Live, Today, Upcoming, Results
- Filters: sport, tournament, team, date, island
- Match card: tournament, team logos/names, time, venue, status and confirmed score
- Live card opens Live Match
- No-live state suggests Today and Upcoming

---

## Page 7 — Match Detail / Live Match

**Route:** `#matches/:id`

Tabs: Overview, Timeline, Lineups, Statistics.

- Official score/status
- Tournament, teams, venue and time
- Confirmed event timeline
- Public starting lineup/substitutes where permitted
- Confirmed statistics
- Correction/workspace controls never appear to guests

---

## Page 8 — Teams Listing

**Route:** `#teams`

- Search
- Filters: team type, island, sport, active tournament
- Card: logo, name, island, type, active tournaments
- Published teams only
- View Team

---

## Page 9 — Team Detail

**Route:** `#team/:slug`

Tabs: Overview, Players, Matches, History.

- Overview: identity, current tournaments, next fixture, recent result
- Players: published/roster-visible players only
- Matches: Upcoming, Results, Statistics
- History: past tournaments, achievements, trophies and membership timeline

No manager contact, internal notes, finance, documents or private eligibility data.

---

## Page 10 — Players Listing

**Route:** `#players`

- Search
- Filters: sport, team, position, island
- Card: photo, display name, current team, position, island, verification indicator
- Published/allowed player records only
- Unclaimed roster-visible players follow limited-public rules

---

## Page 11 — Player Detail

**Route:** `#player/:slug`

Tabs: Overview, Digital Card, Career, History.

- Overview: photo, display name, verification/claim-safe status, current team, position, island, statistics preview
- Digital Card: public card, share, download and verification link
- Career: Teams, Tournaments, Matches, Statistics, Achievements
- History: season timeline, milestones and awards

Never expose National ID, exact DOB, contact details, account ID, documents, guardian information, finance or internal notes.

---

## Page 12 — Organizations Listing and Detail

**Routes:** `#organizations`, `#organization/:slug`

Listing: search, island filter, published organization cards.  
Detail tabs: Overview, Tournaments, Teams, News.

Private membership, staff, finance and moderation information is excluded.

---

## Page 13 — Standings

**Route:** `#standings`

- Tournament selector
- Stage/group selector
- Position, team, played, won, drawn, lost, for, against, difference, points
- Tie-break explanation
- Confirmed results only
- Mobile keeps Team, Played and Points prominent

---

## Page 14 — Bracket

**Route:** `#bracket`

- Tournament/stage selector
- Round labels
- Team names/logos
- Confirmed scores
- Winner progression
- Mobile displays one round at a time

---

## Page 15 — News Listing and Detail

**Routes:** `#news`, `#news/:slug`

- Lead story, filters, cards and Load More
- Categories: Tournament, Match Report, Player, Team, Community, Announcement
- Detail: cover, title, organization/author, date, content, gallery/video links, related news and share
- Published content only

---

# PART B — AUTHENTICATION AND ACCOUNT

## Page 16 — Create Account

**Route:** `#signup`

- Display name, email, password, confirmation, required legal agreement
- No National ID, player, team or organization fields
- Email verification state and resend cooldown
- Safe internal return destination
- Account creation does not automatically create a player/team/organization

---

## Page 17 — Sign In

**Route:** `#signin`

- Email/password
- Password visibility
- Remembered email optional, never password
- Forgot Password
- Create Account
- Session-expiry handling
- Safe return to registration/invitation/claim flow
- Successful normal sign-in opens Choose Workspace

---

## Page 18 — Password Recovery

**Routes:** `#forgot-password`, `#reset-password`

- Request reset without revealing account state
- Expired/used link handling
- New-password validation
- Revoke/refresh sessions as configured
- Return to Sign In

---

## Page 19 — Choose Workspace

**Route:** `#workspace`

Cards are shown only when accessible:

- Player
- Team(s)
- Organizer organization(s)
- Official/Staff
- Super Admin

Missing workspace actions: Create Player Profile, Create Team, Join Team, Create Organization, Join by Invitation. Super Admin is never self-created.

---

## Page 20 — Account Settings

- Display name/avatar
- Email-change verification
- Password change
- Language and RTL
- Timezone
- Notification preferences
- Active sessions/sign out
- Data/privacy requests
- Account deletion workflow

Account settings remain separate from Player Profile.

---

# PART C — PLAYER WORKSPACE

## Page 21 — Player Home

- Claim/verification status
- Profile completion
- Current team
- Upcoming match
- Latest confirmed statistics
- Eligibility/discipline alerts
- Invitations/correction attention
- Next Action

Unclaimed players do not have this workspace until claiming.

## Page 22 — Player Profile

- Edit public display name, approved photo, island, sport, position, preferred foot/hand
- View protected identity status; National ID is never displayed after entry
- Public/private visibility
- Real public preview using public loader
- Organizer-created identity changes after verification require a correction request

## Page 23 — Player Digital Card

- Photo, verified name, current team, position, jersey, island, Maldives, official statistics/achievements
- Publish/unpublish
- Share/download
- Private fields excluded

## Page 24 — Player Career

Nested tabs: Teams, Tournaments, Matches, Statistics, Achievements, History.

## Page 25 — Player Requests

- Team invitations
- Claim status
- Eligibility requests
- Data correction requests
- Privacy/data requests
- Duplicate-profile report

## Page 26 — Player More

- Documents (private)
- Discipline
- Notifications
- Privacy
- Help
- Account Settings link

---

# PART D — TEAM WORKSPACE

## Page 27 — Team Home

- Team status/profile completion
- Active player count
- Current tournaments
- Upcoming match
- Pending applications/rosters
- Eligibility issues
- Next Action

## Page 28 — Team Profile

- Name, logo, cover, island, type, colors, description and approved contacts
- Public preview/publish control
- Staff management

## Page 29 — Team Players

- Current/former players
- Search existing player
- Invite player
- Organizer-created/unclaimed status
- Membership dates
- Join requests

Team staff cannot change verified identity or official statistics.

## Page 30 — Team Tournaments

- Applications
- Registration forms
- Rosters
- Eligibility/documents
- Payment proof/status
- Changes requested/resubmission

## Page 31 — Team Matches

Tabs: Upcoming, Live, Results, Statistics, History.

## Page 32 — Team More

- Requests/notices
- Finance
- Documents
- Notifications
- Public preview
- Staff and settings

---

# PART E — ORGANIZER WORKSPACE

## Page 33 — Organizer Home

- Organization identity
- Active tournaments
- Pending applications
- Incomplete rosters
- Eligibility/duplicate issues
- Upcoming matches
- Finance summary when permitted
- Recent activity/notifications
- Next Action

## Page 34 — Organizer Tournaments

Filters: Draft, Registration, Upcoming, Live, Completed, Archived. Create Tournament is the primary action.

## Page 35 — Organizer Teams

- Organization teams
- Linked teams
- Create organizer-managed team
- Invite manager
- Team claim state
- Team approvals/deactivation

## Page 36 — Organizer Operations

- Staff permissions
- Officials
- Assignments/availability
- Reports and exports
- Notifications
- Activity/audit access by permission

## Page 37 — Organizer Finance

- Tournament income
- Registration fees
- Sponsorship/donations
- Expenses
- Refunds/waivers
- Receipts
- MVR totals
- Private proofs and permission-aware exports

## Page 38 — Organizer More

- Organization profile/public preview
- News/media
- Sponsors
- Settings

---

# PART F — TOURNAMENT WORKSPACE / ENGINE

## Page 39 — Tournament Home

- Cover/logo, name, sport, status
- Setup progress
- Registration summary
- Team/roster/eligibility/payment counts
- Fixture/match summary
- Next three matches
- Attention tasks
- Recent activity/notifications
- Next Action

Main menu: Home, Setup, Teams & Rosters, Competition, Matches, More.

## Page 40 — Setup Wizard

Only the active stage is expanded. Save & Continue validates, saves, completes the stage and opens the next stage.

1. Basics and branding
2. Categories
3. Registration
4. Registration form
5. Roster requirements
6. Competition format
7. Rules and standings
8. Venues and scheduling
9. Review and publish

Finance, sponsors, officials and operations are available after the tournament shell exists; they are not required to finish quick setup unless validation requires them.

## Page 41 — Teams & Rosters (Organizer-first control center)

### Summary

- Teams
- Players
- Complete rosters
- Eligibility issues
- Duplicate warnings

### Tabs

- Teams
- Players
- Rosters
- Eligibility
- Imports
- Claims

### Actions

- Add Team
- Quick Add Players
- Search Existing
- Copy Previous Roster
- Paste List
- Import CSV/XLSX

### Quick roster table

- Name
- Secure National-ID entry
- Jersey
- Position
- Existing/New/Possible Duplicate status

### Progressive collection

Quick entry requires name, National ID and team. Eligibility details/documents are collected later only when rules require them.

### Batch actions

- Mark eligible
- Request documents
- Assign position/jersey
- Move/remove from roster
- Send claim invitation
- Export/print

## Page 42 — Duplicate and Identity Review

- Exact secure digest match links existing player
- Similar details create a possible-match review
- Organizer cannot merge records
- Super Admin confirms merge/dispute
- No roster is blocked merely because a player is unclaimed

## Page 43 — Competition Setup and Draw

- Round robin, double round robin, groups, knockout, groups-to-knockout, two-leg, playoffs, manual pairings
- Pots/seeding/random draw/byes/third-place match
- Preview, regenerate before publish, audited manual adjustment, confirm/publish

## Page 44 — Fixtures and Scheduling

- Automatic fixtures
- Venue/date/time assignment
- Rest/conflict checks
- Draft/publish versions
- Reschedule, postpone, cancel, walkover, abandon with reason

## Page 45 — Matches Directory

Tabs: Upcoming, Live, Review, Official, Postponed/Cancelled. Filters by team, stage, venue, official and date.

## Page 46 — Match Center

- Lineups, starters, substitutes, captain, goalkeeper
- Start/live/period/half-time/finish workflow
- Goal, assist, own goal, cards, substitutions, penalty, injury, incident and sport-specific events
- Offline queue and idempotency
- Submit result
- Organizer confirm
- Correction requires reason and audit

## Page 47 — Results and Competition Output

Tabs: Results, Standings, Bracket, Statistics, Discipline, Awards.

- Confirmed-only recalculation
- Configurable tie-breaks
- Automatic progression
- Suspensions/card accumulation
- Top scorers/custom rankings
- Awards and milestones

## Page 48 — Tournament More

- Officials and staff
- Finance
- Sponsors
- News/media
- Social graphics
- Reports/exports
- Audit log
- Settings
- Complete tournament
- Archive

Completion is blocked while unresolved matches, results, standings or required awards remain.

---

# PART G — OFFICIAL / STAFF WORKSPACE

## Page 49 — Official Home

- Today’s assignment
- Upcoming assignments
- Availability
- Sync/conflict status
- Notifications

## Page 50 — Assignments

- Assigned tournaments
- Assigned matches
- Role/permission
- Venue/time
- Completed assignments

## Page 51 — Official Match Center

Same authorized event workflow as Page 46, restricted to assigned matches and exact permissions. Officials cannot browse private finance/registration data.

## Page 52 — Availability and Notices

- Availability calendar
- Assignment response where enabled
- Notifications
- Help and incident escalation

---

# PART H — SUPER ADMIN WORKSPACE

## Page 53 — Admin Overview

- Platform health
- Pending cases
- Identity/claim reviews
- Content reports
- Result-integrity alerts
- Recent audit actions

## Page 54 — People

- Accounts
- Players/identity verification
- Claim disputes
- Duplicate/merge review
- Minor privacy/guardian cases
- Administrator assignments

## Page 55 — Sports Directory Administration

- Organizations
- Teams
- Tournaments
- Hidden/restricted records
- Result integrity
- Archive/restore controls

## Page 56 — Operations

- Reports and cases
- Content moderation
- Support requests
- Data/privacy requests
- Finance audit
- Notification operations
- Immutable audit log/export

## Page 57 — Platform Customization

- Theme tokens
- Logos/icons
- Landing copy and section visibility/order
- Navigation labels
- Sport catalog
- Feature flags
- Legal/help content
- Draft, review, publish and rollback

Customization cannot bypass authorization, expose private data or insert unsafe HTML/scripts.

## Page 58 — Security and System Health

- Auth/session health
- Storage status
- Failed jobs/notifications
- Edge Function status
- Configuration visibility without secret values
- Security findings and audit events

---

# PART I — SHARED SYSTEM PAGES

## Page 59 — Notifications

- In-app inbox
- Filters: unread, tournament, team, player, system
- Mark read
- Deep link to source
- Delivery state where permitted

## Page 60 — Help, Reports and Legal

- Help Center/tutorials
- Contact/report problem
- Community Guidelines
- Terms
- Privacy
- Data request
- Account deletion

## Page 61 — Offline/PWA States

- Install App
- Offline banner
- Cached public records labeled with last-updated time
- Match operation queue with queued/synced/conflict/rejected states
- Never claim a write succeeded until server confirmation

## Page 62 — Not Found / Access Denied / Maintenance

Separate accessible pages for:

- Public record not found/unpublished
- Sign-in required
- Permission denied
- Session expired
- Platform maintenance
- Network unavailable

---

## 3. Player edit and ownership rules

| Information | Default controller |
|---|---|
| Create player record | Organizer/team-authorized workflow |
| Secure identity digest | Trusted server only |
| Name/photo before claim | Organizer with audit |
| Public presentation after claim | Player |
| Team membership | Team/organizer |
| Tournament roster/jersey | Team/organizer |
| Eligibility | Organizer |
| Lineup | Team/organizer/official by permission |
| Match events | Assigned official/organizer |
| Result confirmation | Organizer |
| Statistics | System from confirmed source records |
| Discipline | Authorized organizer/disciplinary role |
| Duplicate merge | Super Admin only |
| Official-history correction | Authorized organizer/admin with audit |

---

## 4. End-to-end organizer scenario

1. Organizer creates account and organization.
2. Creates tournament with name, sport, logo and cover.
3. Completes guided setup and opens registration or chooses manual entry.
4. Creates/imports teams.
5. Searches existing players and quick-adds missing players as unclaimed records.
6. System securely prevents exact identity duplicates and flags uncertain matches.
7. Organizer builds rosters and completes eligibility.
8. Organizer configures draw/format and generates fixtures.
9. Officials/organizer operate matches, submit and confirm results.
10. Standings, brackets, discipline and statistics update from confirmed data.
11. Tournament awards are recorded; unresolved items block completion.
12. Tournament is completed and archived.
13. Team managers and players may claim existing records later.
14. Claims preserve every team, roster, match, statistic and achievement.

---

## 5. Non-negotiable privacy and release rules

- Real records only; no demo data in production.
- Public visitors are view-only.
- Every exposed table has appropriate RLS and grants.
- Frontend uses publishable key only; never service-role/secret keys.
- Roles never rely on editable user metadata.
- Raw National ID, identity documents, contact data, payments and internal notes are private.
- Minor profiles use guardian/privacy restrictions.
- Confirmed source records are the only official statistics source.
- Corrections require reason and audit.
- Deactivation/merge preserves history.
- Every page includes loading, empty, error/retry, not-found/denied where applicable.
- Mobile, tablet, desktop, keyboard, screen-reader and reduced-motion checks are required.
- Page acceptance requires real authorized-account testing; local tests alone are not release acceptance.

---

## 6. Final acceptance journey

Release is not complete until a real authorized test proves:

1. Guest browses public pages without private leakage.
2. Organizer creates a tournament.
3. Organizer creates a team and quick-adds an unclaimed player.
4. Duplicate identity is detected securely.
5. Roster and eligibility are approved.
6. Draw and fixtures are published.
7. Official records a match offline/online and submits the result.
8. Organizer confirms/corrects the result with audit.
9. Standings, bracket and statistics update correctly.
10. Player claims the existing record without a duplicate.
11. Player sees preserved history and controls public profile/privacy.
12. Team manager claims the existing team without losing tournament history.
13. Super Admin resolves a duplicate/claim case and audit captures it.
14. Tournament completes and remains available as a public archive.
