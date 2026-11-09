# Kulhivaru+ — Final Product and Development Plan

**Document status:** Final source of truth  
**Product:** Kulhivaru+ Maldives Sports Platform  
**Primary outputs:** Permanent Player Career Record and Permanent Tournament Archive  
**Implementation approach:** Improve the existing React/TypeScript/Vite/Supabase application; do not rebuild or reset it.

---

## 1. Purpose

Kulhivaru+ digitizes the complete lifecycle of Maldivian sports tournaments while building a trustworthy permanent history of players, teams and competitions.

The app has two main outcomes:

1. **Permanent Player Career Record** — one continuous record for each real player across teams, sports, tournaments and seasons.
2. **Permanent Tournament Archive** — one permanent record of each tournament from planning and registration through matches, awards and completion.

Everything else exists to collect, verify, operate or publish these records:

- Accounts and workspaces
- Organizations and teams
- Player creation and claiming
- Tournament registration
- Rosters and eligibility
- Draws and fixtures
- Match-day operations
- Results and corrections
- Standings and brackets
- Statistics and achievements
- Finance, staff, news and reports

Kulhivaru+ is not primarily a social network. It is a sports operations and historical record system.

---

## 2. Product principles

### 2.1 Simple for ordinary users

- Show only the current role and workspace.
- Show one clear **Next Action**.
- Maximum five primary navigation items per workspace.
- Maximum four summary cards on an overview.
- Ask only for information required at the current step.
- Hide advanced settings under `More`, `Manage` or expandable sections.
- Use searchable selectors; never require raw UUIDs.
- Save safe drafts automatically.
- After `Save & Continue`, save successfully and open the next stage automatically.
- Use plain-language errors with a clear recovery action.

### 2.2 Organizer-first operation

Tournament operations must not wait for players or team managers to create accounts.

- Organizers can create legitimate unclaimed player and team records.
- Organizers can add players to teams and tournament rosters.
- Players can later claim the same permanent record.
- Claiming connects an account; it never creates a second career.

### 2.3 History cannot be silently destroyed

- Team transfers create dated memberships.
- Roster submissions are versioned.
- Fixture and result corrections are versioned.
- Confirmed history is archived, not overwritten.
- Records referenced by official history are not casually hard-deleted.
- Sensitive administrative actions require reason and audit.

### 2.4 Confirmed source records

- Only confirmed match participation, events and results affect official statistics.
- Draft or submitted results never affect public totals.
- Derived totals must be rebuildable from confirmed source records.
- Corrections must recalculate affected standings, brackets, statistics and milestones.

### 2.5 Privacy by default

- Public users see approved public information only.
- National IDs are never public.
- Identity documents and payment proofs remain private.
- Minor profiles use stricter visibility defaults.
- Authorization is enforced by database RLS, RPC and Storage policies, not only by hidden buttons.

### 2.6 Real records only

- No demo users or demo tournament data in production.
- Empty states must be truthful.
- Reference screenshots are design references, not records to seed.

---

## 3. Product scope

### Sports at release

- Football
- Futsal
- Handball
- Volleyball
- Basketball
- 3x3 Basketball

The rules engine must support sport presets and future sports without redesigning the entire schema.

### Maldives defaults

- Location hierarchy: Atoll → Island → Venue
- Time zone: Maldives time
- Currency: MVR
- Languages: English and Dhivehi
- Dhivehi layout: full RTL support

### Platforms

- Responsive web application
- Mobile-first interface
- Installable PWA
- Offline match-event queue
- Desktop and tablet organizer operations

---

## 4. User roles

| Role | Primary purpose |
|---|---|
| Public Guest | Browse published sports records without an account |
| Account User | Authentication, language, notifications and workspace access |
| Player | Manage permitted profile fields, view career and handle requests |
| Team Manager | Manage a team, squad, applications, rosters and team history |
| Organizer | Create and operate organizations and tournaments |
| Official/Staff | Perform only assigned match or tournament duties |
| Super Admin | Protect records, resolve platform-level issues and customize the app |

One account may access several workspaces. Opening one workspace must not mix tools from another role.

---

## 5. Core record model

### 5.1 Account and player are separate

- An account is a login identity.
- A player is a permanent sports record.
- A player can exist without an account.
- An account may claim one legitimate player record according to identity rules.
- Deleting or disabling an account does not delete the player career.

### 5.2 Public player ID and private identity key

- Every player receives a permanent Kulhivaru+ Player ID for public links and support.
- A national ID is a private verification input, not the public player ID.
- Normalize the national ID only in a trusted server environment.
- Generate an HMAC/digest using a server-only secret.
- Never store readable national IDs in public/general profile tables.
- Never expose the HMAC secret to the browser.
- Enforce uniqueness on the protected identity digest where legally and technically appropriate.

### 5.3 Player states

- Unclaimed
- Claim invited
- Claim pending
- Claimed
- Identity review
- Verified
- Restricted/deactivated
- Merged/redirected through controlled administrative process

### 5.4 Claim status and publication status are separate

Claiming controls who manages a record. Publishing controls whether approved information is visible to the public. These must never be treated as the same status.

An unclaimed player or unmanaged/unclaimed team may still have a public page when an authorized organizer has created the record and completed the required verification and public information.

#### Player claim statuses

- Unclaimed
- Claim invited
- Claim pending
- Claimed
- Claim disputed/restricted

#### Player publication statuses

- Private/incomplete
- Ready for publication
- Published
- Unpublished
- Restricted

#### Requirements for publishing an unclaimed player

- Record was created by an authorized organizer/team role.
- Search and protected identity/duplicate checks passed.
- Required identity and sports fields are complete.
- Required consent or lawful tournament-record basis is recorded.
- Guardian/appropriate consent exists for a minor where required.
- No active identity dispute, duplicate review or privacy restriction exists.
- Only approved public fields are returned by the public loader.
- The page clearly says `Record managed by an authorized organizer` or another neutral label; it must not imply that the player personally claimed or verified the account.

Public unclaimed-player information may include:

- Display name
- Approved photo
- Island
- Sport/position
- Public team memberships
- Approved tournament participation
- Confirmed matches and statistics
- Awards and milestones

It must never include national ID, protected identity digest, date of birth unless a separately approved public age rule exists, email, phone, account data, private documents, payment information or internal notes.

#### Team ownership and publication

A team can be created and published by an authorized organizer before a team manager claims/manages it. Publication requires:

- Team name, type, sport and location
- Approved logo/cover when provided
- Authorized creator/source
- No ownership dispute or restriction
- Public information completeness

The public team page may show `Managed by tournament organizer` until an authorized team manager accepts ownership. Claiming the team changes management access; it does not create a new team, URL or history.

#### After a record is claimed

- Existing public URL and permanent ID remain unchanged.
- All previous teams, rosters, matches, statistics and awards remain attached.
- The new owner receives only permitted editing controls.
- Official history remains correction-controlled and cannot be overwritten by the claimant.
- Organizer access changes according to role and tournament scope; claiming does not erase the creator/audit source.

### 5.4 Dated team history

Every player-team membership stores:

- Player
- Team
- Team level: club, island, atoll, school, national or other approved type
- Sport
- Start date
- End date
- Status
- Source/creator
- Historical jersey number when applicable

A transfer ends the old membership and creates a new membership. It never replaces the old team.

### 5.5 Tournament archive

Every completed tournament preserves:

- Identity and branding
- Organization, sport, season and categories
- Location, dates, venues and rules
- Applications and decision history
- Approved participants and roster versions
- Draw, groups, fixtures and versions
- Match lineups, events and confirmed results
- Standings and bracket
- Discipline
- Awards and trophies
- Player/team statistics
- News, sponsors and final report

Private documents, identity information, payment proofs and internal review notes remain private after archive.

---

## 6. Information architecture

### 6.1 Public navigation

Keep the top navigation compact:

- Home
- Tournaments
- Matches
- Teams
- Players
- Search
- Language
- Sign in / Account

Organizations, standings, brackets, news and archive destinations remain available through relevant pages and menus without overcrowding the header.

### 6.2 Private navigation

After sign-in, always show **Choose Workspace**.

Available workspace types:

- Player
- Team
- Organizer
- Official/Staff
- Super Admin

`Switch Workspace` returns to the chooser without logout.

### 6.3 Workspace navigation

| Workspace | Primary navigation |
|---|---|
| Player | Overview, My Profile, Career, Requests, Privacy & More |
| Team | Overview, Squad, Tournaments, Matches & History, Manage |
| Organizer | Overview, Tournaments, Teams & Players, Operations, Settings |
| Tournament | Overview, Registration, Competition, Match Day, More |
| Official | Overview, Assignments, Match Center, Availability, Notices & Help |
| Super Admin | Overview, Records & Access, Sports Operations, Trust & Safety, Platform Settings |

---

## 7. Global design system

### 7.1 Visual direction

Combine:

- **Island Sport** — Maldivian sea, island and community identity
- **Premium Glass** — controlled translucency, blurred surfaces and soft borders
- **Sports Broadcast** — scores, status ribbons, match timelines and strong hierarchy
- **Editorial typography** — large confident headings and readable content
- **Purposeful motion** — short feedback transitions, never decorative distraction

### 7.2 Color and surface system

- Deep navy primary background
- Cyan/turquoise primary action
- Ocean blue supporting accents
- White/light surfaces for dense data pages
- Green success
- Amber warning
- Red destructive/error
- Glass only where contrast remains accessible

Do not put every section inside a glass card. Use cards only to group meaningful content.

### 7.3 Typography

- Large editorial page title
- Clear section title
- Compact data labels
- Tabular numerals for scores and statistics
- Minimum readable mobile body size
- English and Dhivehi font pairing with complete character support

### 7.4 Shared page shell

Every page includes:

- Contextual header
- Clear title and short description
- One primary action
- Loading, empty, error and retry states
- Responsive content width
- Breadcrumb/back behavior where needed
- Accessible footer or help entry

### 7.5 Shared workspace overview

Order:

1. Identity/status header
2. One Next Action card
3. Maximum four summary cards
4. Needs Attention
5. Main upcoming/current records
6. Recent activity

### 7.6 Mobile behavior

- Designed first for 360–430 px
- No horizontal page scroll
- Tables become cards
- Filters open in a bottom sheet
- Review side panels become full-screen sheets
- Primary action remains easy to reach
- Touch targets at least 44 px
- Navigation becomes a bottom bar or accessible drawer
- Safe-area support for modern phones

### 7.7 Accessibility

- Semantic headings
- Labels for every input
- Keyboard navigation
- Visible focus
- Color is never the only status indicator
- Sufficient contrast
- Reduced-motion support
- Screen-reader status announcements
- Accessible dialogs with focus trapping and return

---

# PART A — PUBLIC EXPERIENCE

## 8. Landing Page

### Purpose

Let visitors quickly find players, tournaments, teams and current match information without account creation.

### Simplified layout

1. Header
2. Hero and global search
3. Browse by Sport
4. Match Center
5. Tournament Hub
6. Players and Teams
7. Competition Center
8. News
9. Organizer call-to-action
10. How It Works
11. Footer

This arrangement combines duplicate Live, Today and Recent sections into one tabbed Match Center.

### Hero

- Headline focused on permanent Maldives sports history
- Search players, teams and tournaments
- `Explore Tournaments`
- `Find a Player`
- `Organize a Tournament`
- Island/sports visual using approved assets

### Browse by Sport

Six compact sport tiles with icon, tournament count and direct filter link.

### Match Center

Tabs:

- Live
- Today
- Recent Results

Cards show team names/logos, competition, time/status and confirmed score only when public.

### Tournament Hub

Tabs or grouped blocks:

- Featured
- Upcoming
- Registration Open
- Completed Archives

### Players and Teams

- Top/featured players based on transparent confirmed-stat rules
- Popular/featured teams
- Links to public directories
- No fake ranking when insufficient data exists

### Competition Center

- Selected standings
- Selected bracket
- Link to full tournament output

### News

- Published news only
- Truthful empty state when no published news exists

### Organizer CTA

- Short explanation
- `Create Organization` or `Start Organizing`
- Authentication return destination preserved

## 9. Global Search

Search published:

- Players
- Teams
- Tournaments
- Organizations
- Matches when appropriate

Features:

- Debounced search
- Type filters
- Sport and location filters
- Safe wildcard handling
- Recent searches locally when consented
- No private-field matching exposed to guests
- Empty/no-results/error states

## 10. Tournament Directory

### Layout

- Title and live result count
- Search
- Sport chips
- Status chips
- Date/location filters
- Editorial tournament cards

### Tournament card

- Cover
- Logo
- Name
- Sport/category
- Dates and island
- Status ribbon
- Registration state
- Approved team count when public
- Open details

## 11. Public Tournament Detail

### Header

- Cover/logo
- Name, sport, season and status
- Location/dates
- Organizer
- Registration action

### Tabs

- Overview
- Registration
- Teams
- Schedule
- Results
- Standings
- Bracket
- Rules
- Awards
- News/Sponsors

Only show tabs supported by published records.

### Registration action

- Closed/not open: explain status
- Open and signed in: open registration form
- Open and signed out: sign in, preserve safe internal destination, then return directly to registration
- Already applied: show current application state instead of a duplicate form

## 12. Public Registration

- Tournament summary and deadline
- Eligibility/fee summary
- Managed-team selector
- Application questions
- Private document/payment upload
- Draft/save behavior where allowed
- Duplicate application protection
- Submit confirmation
- Application status after submission

Never expose one team's application to another team or guests.

## 13. Matches and Live

### Directory

- Live, upcoming, confirmed results
- Search and filters
- Team/tournament links
- Date, time and venue
- No score from unconfirmed result versions

### Match detail

- Tournament/stage
- Teams and logos
- Match status/clock
- Confirmed or live authorized score
- Timeline of public events
- Public lineups when allowed
- Officials when published
- Venue/date
- Links to player/team/tournament histories

## 14. Team Directory and Detail

### Directory

- Search
- Sport, type and location filters
- Published teams only

### Detail

- Team identity and branding
- Current public squad
- Tournament participation
- Upcoming fixtures
- Confirmed results
- Standings
- Team statistics
- Historical players
- Trophies/achievements
- No manager contact, payments, notes or private documents
- Published teams may be organizer-managed and unclaimed; show a neutral management-status label without implying account ownership

## 15. Player Directory and Detail

### Directory

- Search by public name
- Sport, team level, team and island filters
- Published profiles only

### Detail

- Public identity
- Digital player card
- Team timeline
- Tournament appearances
- Match history
- Confirmed statistics and filters
- Discipline where publicly appropriate
- Awards/trophies
- Statistics-source explanation
- No national ID, date of birth, contact, documents, payments, account ID or internal notes
- Published players may be unclaimed when an authorized organizer completed the verified public record; show a neutral organizer-managed label and keep claim status distinct from identity verification

## 16. Organizations

- Published organization directory
- Organization identity/description
- Published tournaments
- Published teams when policy allows
- Public announcements/news
- No membership, finance, staff or private document information

## 17. Standings and Bracket

- Published snapshots or confirmed-result calculation
- Tournament/category/stage filters
- Tie-breaker explanation
- Group tables
- Knockout tree
- Two-leg aggregate handling
- Clear unavailable/empty state

## 18. News

- Published list/detail
- Tournament/organization association
- Cover/media
- Author/date when approved
- Safe rendering
- Draft authoring remains private

## 19. Public archive discovery

- Browse completed tournaments by sport, year, island and organizer
- Search past players/teams/tournaments
- Permanent stable links
- Archive banner indicating completed historical record

---

# PART B — AUTHENTICATION AND ACCOUNT

## 20. Create Account

Ask only:

- Display/account name
- Email
- Password
- Terms/privacy agreement

Do not force creation of a player/team/organization during signup.

After verification/sign-in, open Choose Workspace.

## 21. Sign In and Recovery

- Email/password
- Forgot password
- Session-expired explanation
- Safe internal return destination
- No open redirects
- Clear rate-limit/error state

## 22. Choose Workspace

Show authorized cards only:

- Player
- Team
- Organizer
- Official/Staff
- Super Admin

If a role has multiple entities, open a second simple selector.

Creation/join actions:

- Create or claim Player Profile
- Create or join Team
- Create Organization

Always show `Switch Workspace` in private pages.

## 23. Account Settings

- Account photo/name
- Email verification
- Password/recovery
- Language/RTL preference
- Notification preferences
- Active sessions
- Connected player record
- Privacy/data requests
- Sign out

Account fields must not overwrite official player identity.

---

# PART C — PLAYER WORKSPACE

## 24. Player Overview

### Header

- Photo/name
- Kulhivaru+ Player ID
- Claim/verification badge
- Current team
- Public/private status
- Public preview link

### Content

- One Next Action
- Career appearances
- Main sport statistic
- Teams represented
- Tournaments played
- Next match
- Current eligibility
- Recent results/milestones
- Needs Attention

## 25. My Profile

### Editable

- Display name subject to verification rules
- Photo upload/crop/remove
- Atoll/island
- Nationality
- Sports
- Positions
- Preferred foot/hand
- Jersey preference
- Biography

### Protected

- Verified legal name
- Date of birth
- National-ID digest/evidence
- Minor/guardian state

Protected changes use correction/verification requests.

## 26. Digital Player Card

Use the blue/cyan Kulhivaru+ shield style.

Fields:

- Photo
- Name
- Verified status
- Current team/logo
- Position and jersey
- Preferred foot/hand
- Island/country
- Selected confirmed statistics
- Rating only with documented minimum sample

Actions:

- Preview
- Publish/unpublish
- Copy public link
- Download/print safe card

## 27. Career

Sections:

- Career summary
- Team timeline
- Tournament appearances
- Match history
- Statistics
- Discipline/suspensions
- Awards/trophies
- Milestones

Filters:

- Sport
- Team
- Team level
- Tournament
- Season/year
- Island/atoll/national level

Explain calculation sources and insufficient-data states.

## 28. Player Requests

- Team invitations
- Roster/eligibility requests
- Claim/verification
- Data corrections
- Notifications

Players request corrections; they do not directly alter official results or statistics.

## 29. Privacy & More

- Public profile preview using the real guest loader
- Publish/unpublish
- Public/private field explanation
- Minor privacy
- Duplicate/impersonation report
- Data download request
- Account/player unlink request
- Help

---

# PART D — TEAM WORKSPACE

## 30. Team Overview

- Team identity and role
- One Next Action
- Current squad
- Active tournaments
- Upcoming matches
- Pending tasks
- Roster readiness
- Recent confirmed results

## 31. Squad

Tabs:

- Current players
- Previous players
- Invitations/requests
- Eligibility

Actions:

- Search existing player
- Add existing player
- Create legitimate unclaimed player
- Send claim invitation
- Start/end dated membership
- Assign team role/jersey details
- Bulk import with preview and row errors
- Export permitted roster information

Possible duplicates must enter review; ordinary users cannot bypass them.

## 32. Team Tournaments

Each tournament displays separately:

- Application status
- Payment status
- Roster status
- Eligibility issues
- Deadline
- Next action

Features:

- Apply
- Answer custom questions
- Upload private documents/payment proof
- Save/submit
- Respond to changes
- Build versioned roster
- Withdraw/resubmit where allowed

## 33. Matches & Team History

- Upcoming fixtures
- Confirmed results
- Standings
- Team statistics
- Player contributions
- Discipline
- Historical tournaments
- Placements/trophies

## 34. Team Manage

- Profile and branding uploads
- Team colors/kits
- Private contact information
- Assign/revoke managers
- Documents
- Team finance
- Requests/notices
- Public preview/publish state
- Safe deactivate/archive

---

# PART E — ORGANIZER WORKSPACE

## 35. Organizer Overview

- Organization identity
- `Create Tournament`
- One ranked Next Action
- Active tournaments
- Pending applications
- Roster/eligibility reviews
- Matches today
- Needs Attention
- Tournament cards
- Identity/duplicate warnings
- Recent audited activity

Priority order:

1. Safety/identity conflict
2. Result awaiting confirmation
3. Imminent match
4. Registration/roster deadline
5. Payment/document review
6. Setup task
7. Optional content/settings

## 36. Organizer Tournaments

- Search/filter/sort
- Status chips
- Tournament cards with logo/cover, progress and next action
- Create quick tournament
- Preview, duplicate configuration, cancel/archive when permitted

### Quick creation

Ask only:

- Name
- Sport
- Logo upload
- Cover upload

Then open the guided setup.

## 37. Teams & Players

Tabs:

- Teams
- Players
- Claims
- Possible duplicates
- Imports

Features:

- Search before creation
- Create teams
- Create unclaimed players
- Add players to teams/rosters
- Assign managers
- Send claim invitations
- View complete histories
- Bulk import with template, mapping, preview and row-level validation
- Duplicate review request

## 38. Organizer Operations

Launcher cards:

- Staff and permissions
- Officials
- Organization finance
- Notifications
- Reports/exports
- Audit activity

Do not render every operations table on the landing page.

## 39. Organizer Settings

- Organization profile/branding
- Location/contact
- Public page preview/publish
- Default tournament settings
- Staff permission overview
- Notification defaults
- Export/data requests
- Archive/deactivation controls

---

# PART F — TOURNAMENT WORKSPACE AND ENGINE

## 40. Tournament lifecycle

Statuses:

- Planning
- Registration scheduled/open/closed
- Competition preparation
- Active
- Completion review
- Completed
- Archived
- Cancelled

Status changes require validation and confirmation. Completed/archived records remain searchable.

## 41. Tournament Overview

### Header

- Logo/cover/name
- Sport/season/category summary
- Lifecycle and registration status
- Setup progress
- Public/private state
- Public preview
- More actions

### Body

- One Next Action
- Up to four contextual metrics
- Needs Attention
- Setup progress
- Registration summary/link
- Next three matches
- Recent audit activity
- Notifications
- Completion/archive readiness

Each section loads independently so one failed query does not blank the workspace.

## 42. Nine-stage setup wizard

### Stage 1 — Basics

- Name
- Sport
- Season/year
- Atoll/island
- Dates
- Description
- Logo upload
- Cover upload

### Stage 2 — Categories

- Age/gender/open categories as applicable
- Team/player limits
- Category eligibility
- Sport variant

### Stage 3 — Registration

- Opening/closing dates
- Team limit/waitlist
- Entry fee MVR
- Payment instructions
- Applicant eligibility
- Registration link

### Stage 4 — Registration Form

- Built-in fields
- Custom questions
- Required/private classifications
- Document requirements
- Applicant preview

### Stage 5 — Roster Requirements

- Minimum/maximum players
- Jersey requirements
- Player fields/documents
- Age/identity rules
- Add/transfer deadline
- Approval and lock behavior

### Stage 6 — Competition Format

- Round robin
- Groups
- Knockout
- Groups then knockout
- Two-leg ties
- League then playoffs
- Third-place match
- Legs, qualifiers, seeding, pots and byes

### Stage 7 — Rules and Standings

- Points
- Ordered tie-breakers
- Head-to-head rules
- Fair play
- Walkover score
- Discipline/suspensions
- Result confirmation rules

### Stage 8 — Venues and Scheduling

- Venues
- Available dates/times
- Blackouts
- Rest constraints
- Match duration/breaks
- Scheduling preferences

### Stage 9 — Review and Publish

- Blocking/warning/information validation
- Public preview
- Registration preview
- Format/rules summary
- Publish/open registration confirmation

### Wizard behavior

- One stage open at a time
- Safe autosave
- Back, Save & Exit, Save & Continue
- Successful Save & Continue automatically opens next stage
- Resume at first incomplete/invalid stage
- Completed stages reviewable
- Publish blocked only by real blocking issues

Finance, sponsors, officials and operations remain available after quick creation under Tournament More instead of making initial setup unnecessarily long.

## 43. Registration Control Center

Tabs:

- Applications
- Approved Teams
- Rosters
- Eligibility
- Payments

### Applications

Statuses:

- Draft
- Submitted
- Under review
- Changes requested
- Approved
- Rejected
- Waitlisted
- Withdrawn

Actions:

- Review in side panel
- Approve/reject/request changes/waitlist
- Mandatory note for negative decisions
- Safe bulk reminders/approval

### Rosters

Statuses:

- Not started
- Draft
- Submitted
- Under review
- Changes requested
- Approved
- Rejected
- Locked

Features:

- Versioned submissions
- Player identity/duplicate checks
- Jersey conflicts
- Eligibility checks
- Approve/reject/request changes
- Lock/unlock with permission and reason

### Eligibility

- Identity
- Age/category
- Duplicate participation
- Suspension
- Required documents
- Manual override only with permission, reason and audit

### Payments

- Due/paid/waived/refunded
- Proof private
- Verify/reject/request clarification
- Manual MVR release-one flow

## 44. Competition Setup and Draw

### Formats

- Single/double round robin
- Group stage
- Knockout
- Groups to knockout
- Two-leg ties
- League to playoffs
- Third-place match

### Draw tools

- Eligible teams only
- Pots/seeding
- Automatic/manual draw
- Constraints
- Byes
- Preview
- Save a version
- Audit draw mode and actor

### Progression

- Group winners/runners-up/best qualifiers
- Configurable bracket placement
- Aggregate results
- Penalty/tie resolution
- Manual resolution only with permission/reason

## 45. Fixtures and Scheduling

- Generate fixtures
- Home/away and two-leg handling
- Manual adjustments
- Venue/time assignment
- Conflict detection
- Rest warnings
- Draft/published state
- Fixture versions
- Publish notifications
- Postpone/cancel/reschedule/abandon/walkover flows

## 46. Match Center

### Match statuses

`Scheduled → Live → Half-time → Finished → Submitted → Confirmed`

Exceptional:

- Postponed
- Cancelled
- Walkover
- Abandoned

### Data

- Teams/stage/venue/time
- Officials
- Lineups/substitutes
- Captain/goalkeeper when needed
- Match clock
- Event timeline

### Events

- Goal
- Assist
- Own goal
- Yellow card
- Second yellow
- Red card
- Substitution
- Penalty goal/miss
- Injury
- Incident
- Sport-specific events through presets

### Offline behavior

- Idempotency key per operation
- Queued/synced/conflict/rejected states
- Retry without duplicate event
- Organizer conflict resolution
- Clear last-sync indicator

## 47. Result confirmation and correction

### Submission

- Assigned official/actor submits result
- Organizer reviews score, participants and events
- Confirm/reject/request correction

### Confirmation transaction

1. Confirm result version.
2. Confirm valid participant/event sources.
3. Recalculate standings and progression.
4. Recalculate player/team statistics.
5. Evaluate discipline and milestones.
6. Update tournament completion readiness.
7. Write audit and notifications.

### Correction

- Mandatory reason
- Preserve previous version
- Create new corrected version
- Never double-count superseded result
- Recalculate all affected outputs
- Record actor/time/reason

## 48. Results, Standings and Bracket

- Confirmed results only
- Configurable points
- Tie-breakers: points, goal difference, goals, wins, head-to-head, head-to-head difference, fair play and approved manual/playoff resolution
- Published snapshots
- Bracket progression
- Two-leg aggregate
- Transparent rule explanation

## 49. Tournament More

- Finance
- Sponsors
- Staff and officials
- News/media
- Rules/documents
- Reports/exports
- Public settings
- Completion/archive

### Tournament finance

- Registration fees
- Sponsorship/donations
- Expenses
- Sponsor items
- Receipts
- Waivers/refunds
- Private proofs
- MVR totals
- Audit-safe changes

### Completion checklist

- Required matches resolved
- Results confirmed
- Standings/bracket final
- Discipline reviewed
- Awards confirmed
- Archive previewed
- Final report ready

Completing creates the permanent archive. Reopening requires elevated permission, reason and audit.

---

# PART G — OFFICIAL / STAFF WORKSPACE

## 50. Official Overview

- Assignment role
- Next match
- Venue/time
- Next Action
- Pre-match requirements
- Unsubmitted result
- Offline conflicts
- Organizer instructions

## 51. Assignments

- Assigned tournaments/matches
- Role and permission
- Date/venue/teams
- Acknowledge when required
- Report conflict/unavailability
- No unrelated private information

## 52. Official Match Center

- Auto-load sport preset
- View/confirm permitted lineup data
- Record events
- Work offline
- Review timeline
- Finish and submit result
- Track organizer response

Submitting and confirming must be separated unless the account has an explicit independent confirmation permission.

## 53. Availability and Notices

- Available/unavailable dates/windows
- Scheduling note
- Assignment changes
- Match instructions
- Conflict messages
- Incident/help report

---

# PART H — SUPER ADMIN WORKSPACE

## 54. Super Admin authorization

- Server-side protected authorization source
- RLS enforcement
- Frontend metadata alone never grants admin access
- Recent authentication for high-risk actions
- Mandatory reason/confirmation/audit

## 55. Admin Overview

- Active accounts
- Claimed/unclaimed players
- Active tournaments
- Pending claims
- Duplicate candidates
- Failed operations
- Security alerts
- One ranked Next Action
- Recent admin audit

## 56. Records & Access

Tabs:

- Accounts
- Players
- Teams
- Organizations
- Roles/permissions

Capabilities:

- Search and inspect permitted records
- Create player/team/organization/tournament on behalf
- Assign/revoke scoped role
- Suspend/restore access
- Controlled ownership transfer
- Inspect account-player connection
- Never access passwords or secret keys

## 57. Sports Operations

- Inspect tournaments
- Resolve stuck workflows
- Review disputes
- Controlled result correction
- Recalculate standings/statistics
- Rebuild milestones
- Complete/archive/reopen with reason
- Consistency checks across lineups, events, results and careers

Display `Acting as Platform Admin`; never impersonate silently.

## 58. Trust & Safety

- Claims
- Possible duplicates
- Player merge review
- Privacy/data requests
- Abuse/impersonation reports
- Audit log

### Controlled merge

1. Select surviving player.
2. Compare protected identity evidence.
3. List every affected membership, roster, match, event, statistic and award.
4. Block conflicting identities.
5. Require reason and second confirmation.
6. Relink transactionally.
7. Preserve redirect/alias and source audit.
8. Recalculate career.

## 59. Platform customization

- App name/logo
- Colors/theme assets
- Landing section order/content
- Navigation labels
- Enabled sports and presets
- Default rules
- Atolls/islands/venues
- Languages/translations/RTL
- Notification/email templates
- Player card templates and safe fields
- Registration defaults
- Public visibility defaults
- Feature flags
- Maintenance banner/mode
- Legal/privacy/help content

Every customization has draft, preview, validation, publish confirmation, version history, rollback and audit. Never allow arbitrary executable code or unsafe CSS injection.

---

# PART I — SHARED SYSTEMS

## 60. Notifications

In-app notifications for:

- Claim/invitation
- Application/roster decision
- Eligibility/document correction
- Fixture change
- Official assignment
- Result submitted/confirmed/corrected
- Suspension
- Award/tournament completion
- Privacy request

Delivery states:

- Queued
- Sent
- Delivered when supported
- Failed
- Read/unread

In-app delivery must work without email. Email/push configuration remains truthful and separate.

## 61. News and media

- Draft/publish/archive
- Organization/tournament scope
- Cover/media upload
- Public fields only
- Authoring permissions
- Safe rendering
- Optional featured placement through platform rules

## 62. Reports and exports

- Applications
- Approved rosters
- Fixtures
- Results
- Standings/bracket
- Player/team statistics
- Discipline
- Finance for authorized roles
- Final tournament report
- Player career summary under privacy rules

Exclude fields the current role cannot view.

## 63. PWA and offline

- Installable manifest
- App icons and theme
- Cached shell/public fallback
- Offline Match Center queue
- Online/offline indicator
- Update available prompt
- No false success before server confirmation

## 64. Help, legal and system states

- Help center
- Role-specific guidance
- Report problem
- Privacy policy
- Terms
- Contact/support
- Not found
- Access denied
- Maintenance
- Offline
- Session expired

---

## 65. Data architecture

Use normalized domain records, not one table per screen and not one giant table for everything.

### Identity domain

- Auth accounts
- Account profiles/preferences
- Player profiles
- Protected player identity/digests
- Claims/invitations
- Duplicate/merge cases
- Privacy/correction requests

### Organization/team domain

- Organizations
- Memberships/roles
- Teams
- Team managers
- Dated player-team memberships

### Tournament registration domain

- Tournaments
- Categories/seasons
- Setup/configuration
- Registration settings/questions
- Team applications
- Application answers
- Roster versions and roster players
- Fees/payments/adjustments
- Private document metadata

### Competition domain

- Stages/groups
- Fixture versions/matches
- Officials/assignments
- Match participants
- Match events
- Result versions
- Standings snapshots
- Progression/awards

### History domain

- Milestones
- Awards/trophies
- Discipline/suspensions
- Career/statistics views or rebuildable caches
- Tournament archive metadata/final reports

### Operations domain

- Staff assignments
- Finance
- Notifications/deliveries
- News/media
- Audit events
- Platform configuration versions

Do not create duplicate totals as competing sources. Use confirmed source records plus views/RPCs; cache only for performance with a rebuild path.

---

## 66. Storage plan

Standardize on the smallest safe bucket set after auditing existing buckets:

### Public media

For approved public:

- Tournament logos/covers
- Team/organization logos/covers
- Published player photos
- News media
- Public sponsor assets

Anonymous read is allowed only for intended public objects. Writes remain scoped.

### Private documents

For:

- Identity/eligibility documents
- Payment proofs
- Private application files
- Internal receipts

No anonymous access. Use authorized reads/signed URLs as appropriate. Never store secrets in object paths.

If existing buckets already fulfill these roles, reuse and standardize them through additive reviewed changes rather than creating duplicates.

---

## 67. Authorization and security

### RLS

- Enable RLS on every exposed table.
- Guest policies read only published public fields/records.
- Player policies scope by account-player ownership.
- Team policies scope by managed team membership.
- Organizer policies scope by organization/tournament membership.
- Official policies scope by active assignment.
- Admin policies use protected server-side admin authorization.

### Functions

- `SECURITY DEFINER` only when necessary.
- Fixed safe `search_path`.
- Revoke `PUBLIC` execution.
- Grant minimum roles.
- Avoid RLS recursion through reviewed helpers.

### Browser secrets

- Publishable key only in frontend.
- Never service-role key.
- Never identity HMAC secret.
- Provider secrets only in trusted functions/server environment.

### Audit

Record actor, action, target, time, reason and relevant before/after references for:

- Claims and merges
- Role changes
- Application/roster decisions
- Result confirmation/correction
- Finance changes
- Tournament completion/reopen
- Platform customization

---

## 68. State machines

### Application

`Draft → Submitted → Under Review → Approved / Rejected / Waitlisted / Changes Requested`

Changes Requested may return to Draft/Submitted. Withdrawal follows explicit rules.

### Roster

`Not Started → Draft → Submitted → Under Review → Approved / Rejected / Changes Requested → Locked`

### Match

`Scheduled → Live → Half-time → Finished → Submitted → Confirmed`

Exceptional: Postponed, Cancelled, Walkover, Abandoned.

### Claim

`Unclaimed → Invited/Pending → Verified → Claimed`

Exceptional: Expired, Revoked, Conflict Review, Rejected.

### Tournament

`Planning → Registration → Competition Preparation → Active → Completion Review → Completed → Archived`

Exceptional: Cancelled. Reopen requires elevated permission and audit.

---

## 69. End-to-end workflows

### Organizer runs a tournament

1. Choose Organizer.
2. Quick-create tournament.
3. Complete nine setup stages.
4. Publish/open registration.
5. Review applications/payments.
6. Search/create teams and players.
7. Approve/lock rosters.
8. Draw and publish fixtures.
9. Assign officials.
10. Run matches.
11. Confirm results.
12. Resolve corrections.
13. Confirm awards/final output.
14. Complete and publish archive.

### Player claim

1. Organizer-created player already has history.
2. Player creates/verifies account.
3. Player chooses claim existing record.
4. Trusted identity match finds exact player.
5. Claim completes atomically.
6. Existing history appears; no duplicate is created.

### Team application

1. Open public tournament.
2. Sign in if required and return to registration.
3. Select managed team.
4. Submit application/private proofs.
5. Track separate application/payment/roster states.
6. Build and submit roster.
7. Respond to changes.
8. Approved roster becomes historical participation.

### Offline match

1. Official opens assignment.
2. Cached lineup loads.
3. Events queue with idempotency keys.
4. Reconnect and sync.
5. Conflicts require review.
6. Submit result.
7. Organizer confirms.
8. Histories update exactly once.

---

## 70. Implementation plan

This is an existing application. Every phase begins with inspection and preserves working code/data.

### Phase 0 — Inventory and baseline

- Read product/development/status/audit documents.
- Inventory routes, components, migrations, functions, buckets and tests.
- Confirm linked Supabase project without modifying it.
- Record current local checks and live blockers.
- Create page/feature/permission/data-source matrix.

**Exit:** Baseline documented; no destructive action.

### Phase 1 — Shared UX foundation

- Tokens, typography and surfaces
- Shared public/private shells
- Header/workspace switcher
- Next Action component
- Summary/attention/activity components
- Forms, tabs, drawers, dialogs and states
- Mobile/RTL/accessibility foundation

**Exit:** Shared system used without breaking routes.

### Phase 2 — Identity and history integrity

- Permanent player model audit
- Protected identity digest path
- Search-before-create
- Atomic claim
- Duplicate review/merge plan
- Dated memberships
- History-source contracts

**Exit:** No normal path can create a duplicate verified career.

### Phase 3 — Public and authentication simplification

- Landing consolidation
- Directories/details/archive discovery
- Signup/signin/recovery
- Choose Workspace
- Safe return-to-registration

**Exit:** Public records and workspace entry are simple and privacy-safe.

### Phase 4 — Player and Team Workspaces

- Player overview/profile/card/career/requests/privacy
- Team overview/squad/tournaments/history/manage
- Uploads and publication controls
- Real empty/error/loading states

**Exit:** Real account and manager journeys persist after reload.

### Phase 5 — Organizer and setup

- Organizer overview/tournaments/records/operations/settings
- Quick creation
- Nine-stage setup with automatic continuation
- Branding uploads/public display

**Exit:** Organizer can publish a valid tournament without technical assistance.

### Phase 6 — Registration and roster operations

- Public application
- Review workflows
- Separate statuses
- Eligibility
- Payments/private documents
- Versioned roster
- Bulk player/team tools

**Exit:** Approved teams/rosters are reliable competition inputs.

### Phase 7 — Competition engine

- Formats, draw, pots, seeding, byes
- Fixture versions/scheduling
- Standings/tie-breakers
- Bracket/progression
- Sport presets

**Exit:** Deterministic tested competition outputs.

### Phase 8 — Match operations

- Official assignment
- Lineup and participants
- Event console
- Offline sync/idempotency
- Result submission/confirmation/correction
- Audit

**Exit:** Confirmed result updates all outputs exactly once.

### Phase 9 — Careers and archives

- Player/team breakdowns
- Discipline/milestones/awards
- Completion checklist
- Permanent tournament archive
- Rebuild/recalculation tools

**Exit:** Career and archive acceptance journeys pass.

### Phase 10 — Official and Super Admin

- Official workspace and availability
- Admin records/access
- Sports operations
- Trust/safety/merge
- Platform customization versioning

**Exit:** Scopes and audits verified; no hidden escalation.

### Phase 11 — Supporting operations

- Finance/sponsors
- News/media
- Notifications/delivery
- Reports/exports
- PWA/offline polish

**Exit:** Supporting systems are truthful and permission-aware.

### Phase 12 — Hardening and release

- Migration/RLS/Storage/RPC integration tests
- Edge Function runtime/deployment tests
- Security/performance/accessibility review
- Mobile/tablet/desktop browser checks
- Real-account owner acceptance
- Preview deployment
- Release checklist/rollback plan

**Exit:** Release readiness supported by live evidence.

---

## 71. Testing strategy

### Unit

- Validation
- State transitions
- Draw/fixture/standings logic
- Statistics and corrections
- Navigation/return destination
- Permission-aware data shaping

### Database contract

- Migration ordering/idempotency where required
- RLS policy structure
- No recursion
- Function grants/search paths
- Storage policies
- Confirmed-only calculations
- Atomic claim/merge/correction

### Integration

- Auth/session refresh
- Real persistence/reload
- Cross-role denials
- Storage upload/download
- Offline replay/conflicts
- Notification delivery states

### Browser

For every page:

- Loading
- Empty
- Populated
- Error/retry
- Signed out
- Authorized
- Unauthorized
- Mobile 390 px
- Tablet
- Desktop 1280/1440 px
- Keyboard/accessibility
- No horizontal overflow
- No raw UUID/private leakage

### Required acceptance journeys

- Organizer-created player → roster → confirmed match → player claim → continuous career
- Team transfer preserves old/new history
- Tournament setup → registration → draw → match → correction → archive
- Guest public privacy
- Cross-organization denial
- Official sees assigned data only
- Super Admin high-risk action requires reason/audit

---

## 72. Definition of done

A page is complete only when:

- Features match this plan.
- Real data source and RLS scope are identified.
- Loading/empty/error/retry states exist.
- Mobile and keyboard behavior work.
- No private fields leak.
- Tests pass.
- Relevant live integration is verified or explicitly marked blocked.
- Documentation is updated.

Use status labels:

- **Implemented Locally**
- **Live Verified**
- **Owner Accepted**
- **Blocked**

Do not call a feature complete or release-ready from static tests alone.

---

## 73. Release-one requirements

Required:

- Public browsing
- Auth/session/recovery
- Workspace selection/switching
- Organizer-first player creation
- Secure claim/no duplicates
- Player/team/organization workspaces
- Nine-stage tournament setup
- Applications, rosters, eligibility and manual MVR payments
- Competition formats, fixtures, standings and bracket
- Official assignment and Match Center
- Offline/idempotent event recording
- Result confirmation/correction/audit
- Player/team statistics and history
- Tournament completion/archive
- Digital player card
- Permissions/RLS/private Storage
- In-app notifications
- Reports/exports
- Mobile/PWA foundation
- English and structural Dhivehi/RTL readiness

Can follow after release one unless already safely implemented:

- Online payment gateway
- SMS/Telegram
- Advanced broadcast integrations
- Fully automated email delivery
- Advanced AI assistance

---

## 74. Safety rules for development agents

- Read this plan and current status before changes.
- Inspect repository, environment, migrations and tests first.
- Preserve real data and working features.
- Use additive reviewed migrations.
- Never reset or seed production.
- Never push migrations or deploy without explicit owner authorization.
- Never place service-role/provider/HMAC secrets in frontend code.
- Do not weaken RLS to make a UI work.
- Fix failures before moving to the next phase.
- Do not invent records to make pages look populated.
- Report exact blockers and continue with independent safe work.

---

## 75. Final completion report

At the end, report:

1. Page/route matrix
2. Completed features and remaining gaps
3. Files changed
4. Migrations and applied/pending state
5. RLS/Storage/RPC/Edge Function verification
6. Player uniqueness/claim/career proof
7. Tournament archive proof
8. Permission/audit proof
9. Typecheck, lint, test and build results
10. Browser/accessibility viewport results
11. Security findings
12. Performance impact
13. External services still required
14. Exact owner actions
15. Release/hold recommendation

---

## 76. Final instruction

Build Kulhivaru+ around permanent, trustworthy Maldivian player careers and tournament archives. Keep the interface simple by showing each role one workspace, no more than five main destinations, one Next Action and only the fields required at that moment. Preserve full advanced capability through progressive disclosure. Confirmed match source records—not manually entered totals—must power official history. Preserve previous versions and audit every correction. Protect private identity and documents through trusted server processing, RLS and private Storage. Maintain real data, avoid destructive operations, and do not claim release readiness until live and owner acceptance journeys pass.
