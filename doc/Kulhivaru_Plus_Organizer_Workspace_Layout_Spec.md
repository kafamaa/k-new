# Kulhivaru+ Organizer Workspace — Layout and Style Specification

> Provenance: provided by the owner on 2026-10-23 as a **recommended layout specification** for the
> Organizer Workspace, explicitly "not a claim that every item is already complete in the running
> app". It is the working reference for the Organizer Workspace page-by-page review. The current
> state against this spec is audited in `docs/FEATURE_GAP_AUDIT.md` (section "Organizer workspace
> layout spec vs current implementation"). Nothing here overrides the Product Specification; where
> the two differ, the Product Specification governs and the difference is recorded.

Think of the Organizer Workspace as two connected areas:

1. **Organization dashboard** — manage the organization and see all its tournaments.
2. **Tournament cockpit** — manage one selected tournament from setup through completion.

This is a **recommended layout specification** for the workspace, not a claim that every item is already complete in the running app.

## 1. Organization dashboard

### Desktop layout

| Area | Layout and content |
|---|---|
| **Top bar** | Kulhivaru+ logo; organization switcher; global search; notifications; account menu; **Switch Workspace** button. |
| **Left navigation** | Overview, Tournaments, Teams, Players, Staff, Finance, Reports, Organization Profile, Settings. Show only items the user is authorized to use. |
| **Page heading** | Organization name and logo, short welcome, current date, and a prominent **Create Tournament** button. |
| **Attention panel** | A focused "Needs your attention" area: applications to review, rosters awaiting approval, upcoming matches, and finance items needing action. Each item links directly to the relevant task. |
| **Summary cards** | Active tournaments, registrations awaiting review, approved teams, upcoming matches, and outstanding MVR payments. Each card shows a label, count from real data, and a link to its list. |
| **Tournament section** | Searchable tournament cards or a table with status, sport, dates, application count, team count, and **Open Tournament** action. Tabs can filter Draft, Registration Open, Upcoming, Live, Completed, and Archived—only if those statuses exist in the data. |
| **Recent activity** | Recent applications, roster changes, result confirmations, and staff actions, with timestamps and links. |
| **Footer/help area** | Help link and a clear account/workspace switcher. |

### Example structure

```text
┌─────────────────────────────────────────────────────────────────────┐
│ KULHIVARU+    [Organization ▾]       Search   Alerts   Account      │
├──────────────────┬──────────────────────────────────────────────────┤
│ Overview         │  Organization name              [+ Create event] │
│ Tournaments      │  Good morning, organizer                         │
│ Teams            │                                                  │
│ Players          │  NEEDS YOUR ATTENTION                             │
│ Staff            │  4 applications  ·  2 rosters  ·  1 result       │
│ Finance          │  [Review applications] [Review rosters]          │
│ Reports          │                                                  │
│ Profile          │  Active events   Teams   Upcoming matches  Fees   │
│ Settings         │                                                  │
│                  │  Your tournaments                 [View all]     │
│                  │  Tournament cards / list                         │
│                  │                                                  │
│                  │  Recent activity                                 │
└──────────────────┴──────────────────────────────────────────────────┘
```

## 2. Tournament cockpit

Opening a tournament should take the organizer into a dedicated control room for that event.

### Tournament header

Show:

- Tournament name, sport, logo or cover image
- Current status and dates
- **Open public page** when published
- **Next action** button that takes the organizer to the most urgent incomplete task
- A compact progress indicator for setup or tournament completion

Example:

```text
Male' Futsal League 2026      Registration Open
Futsal · 12 Oct – 8 Nov · Malé

Next action: Review 4 team applications      [Review applications]
Setup progress: ███████░░░  7 of 10 sections
```

### Cockpit navigation

Use tabs or a clear side menu:

| Tab | Main purpose |
|---|---|
| **Overview** | Event progress, next action, key counts, recent activity. |
| **Setup** | Resumable tournament details and validation. |
| **Applications** | Approve, decline, or request changes from teams. |
| **Teams & rosters** | Review accepted teams and their submitted players. |
| **Draw & fixtures** | Configure stages/groups, create the draw, and manage fixtures. |
| **Match center** | Assign officials, record match events, submit results, and resolve conflicts. |
| **Standings & statistics** | Show calculations based on confirmed results. |
| **Finance** | Track fees, expenses, receipts, waivers, and refunds according to permission. |
| **Staff** | Assign tournament-specific roles and permissions. |
| **Media & updates** | Manage public tournament information and announcements if supported. |
| **Reports** | Export data the current user is allowed to access. |
| **Settings** | Tournament visibility, status, and permitted administrative changes. |

## 3. Tournament setup screen

Make setup resumable, with a step list on the left and one focused form at a time.

1. Basics
2. Categories
3. Registration settings
4. Registration questions
5. Roster requirements
6. Competition format
7. Rules and tie-breakers
8. Venues and schedule
9. Officials and operations
10. Finance and sponsors
11. Review and publish

Each step should show **Not started**, **In progress**, or **Complete**, plus any validation issue. Save progress automatically or provide a clear **Save and continue** action. Keep publication blocked until required information is valid.

## 4. Visual style

Use the Kulhivaru+ sports look while keeping organizer screens easy to read:

- **Base:** deep navy for the header and navigation; clean light backgrounds for work areas.
- **Accent:** bright turquoise for primary actions, progress, and selected navigation.
- **Cards:** subtle liquid-glass surfaces—light translucency, soft blur, gentle shadow, and quiet edges. Keep enough contrast behind text.
- **Status colors:** use consistent colors and text labels for Draft, Open, Live, Completed, and attention-needed states. Never rely on color alone.
- **Typography:** clear page titles, compact section headings, readable form labels, and legible tables.
- **Icons:** simple sports and task icons paired with words.
- **Actions:** one clear primary action per screen; less common actions go in a menu.
- **Motion:** subtle transitions only; respect reduced-motion settings.
- **Accessibility:** keyboard navigation, visible focus, descriptive labels, and sufficient contrast.

## 5. Mobile layout

On a phone:

- Replace the left navigation with a menu button or bottom navigation for the most-used sections.
- Keep the organization/tournament selector accessible.
- Stack summary cards into one or two columns.
- Turn wide tables into readable cards or horizontally scrollable tables with clear affordance.
- Keep **Next action** and **Create Tournament** easy to find.
- Make forms single-column with large touch targets.
- Avoid hiding important status or permission information in hover-only controls.

## 6. Interaction rules

- Counts and activity must come from real authorized records; show a useful empty state when there is no data.
- Each alert should open the exact item that needs attention.
- Every user sees only the organizations, tournaments, and actions allowed by their permissions.
- Show a success message after saving, and a clear retryable error when a save fails.
- Confirm consequential actions such as publishing, rejecting an application, or confirming a correction.
- Keep private documents and finance details restricted to authorized roles.
- Do not show fake tournament cards or sample statistics to make the dashboard look full.
