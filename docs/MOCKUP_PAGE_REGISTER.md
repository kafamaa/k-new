# Mockup-to-app register — 5 November 2026

All 50 images in the supplied mockup.zip and the 16 additional staff, finance, roster, history and coach references from the earlier previews were inspected (66 reference images in total). They are visual references, not implemented screens or production data. The two Tournament Directory images map to the same page. No mockup screenshots or example accounts were added to the production app.

The app was continued from its existing source. The authoritative product plan remains docs/KULHIVARU_PLUS_FINAL_PLAN.md. This register covers presentation, not completion of every backend feature in that plan.

## Reference mapping

“Existing” means the supplied application already contains that component and workflow; this update applies the shared visual system without replacing its handlers. “Added/rebuilt” identifies structural work in this update. Shared styling alone is not a pixel-for-pixel certification.

| # | Supplied reference image | Actual source | Route or state | Presentation work |
|---|---|---|---|---|
| 1 | Add player to team workspace.png | TeamSquad.tsx · AddPlayerFlow, step 1 | Team → Squad → Add Player | Existing flow; shared layout aligned |
| 2 | Amaan Zahid Futsal Career Profile.png | PublicPage.tsx · PublicDetail / PlayerPublicDetail | #player/<slug> | Existing public career and profile tabs |
| 3 | Check your email verification screen.png | App.tsx / AuthPages.tsx · VerifyEmailNotice | Sign-up → Check your email | Full-screen auth composition updated |
| 4 | Edit Lagoon FC player membership.png | TeamSquad.tsx · EditMembership | Team → Squad → Edit | Existing editor; shared form layout aligned |
| 5 | End player membership confirmation.png | TeamSquad.tsx / ReviewDialog.tsx | Edit membership → Review removal | Centered confirmation added; history-preserving handler retained |
| 6 | Find or add a player.png | OrganizerTeamPlayers.tsx · AddPlayer (search) | Tournament → Teams → Add existing player | Dedicated search form and summary sidebar added |
| 7 | Island Community Cup 2025 Archive.png | PublicPage.tsx / TournamentPublicTabs.tsx | #tournament/<archived-slug> | Existing archive state; shared public styling |
| 8 | Island Cup 2026 application review.png | PublicApplicationForm.tsx · review state | #register/<slug> → Continue to review | New client-side review; existing submit handler retained |
| 9 | Island Cup 2026 Payment Upload.png | TeamPaymentProof.tsx / TeamOpsTabs.tsx | Team → Applications → Upload payment proof | Dedicated receipt selection/review page added |
| 10 | Island Cup 2026 Registration Opens.png | PublicPage.tsx · NewsDetail | #news/<slug> | Article and sidebar composition updated |
| 11 | Island Cup 2026 Team Registration.png | PublicRegistrationLayout.tsx / PublicApplicationForm.tsx | #register/<slug> | Dedicated form + tournament summary layout added |
| 12 | Island Cup 2026 tournament details.png | PublicPage.tsx · TournamentPublicDetail | #tournament/<slug> | Existing cover/logo/tabs; shared public styling |
| 13 | Island Cup application status.png | TeamOpsTabs.tsx · TeamApplicationsSection / PublicApplicationForm.tsx | Team → Applications / existing application state | Existing data-bound application statuses |
| 14 | Island Cup player record form.png | OrganizerTeamPlayers.tsx · AddPlayer (new) | Tournament → Teams → Create new player | Dedicated identity-safe record form and summary sidebar added |
| 15 | Island Cup roster player editor.png | TeamOpsTabs.tsx · RosterEditor / OrganizerTeamPlayers.tsx | Team → Rosters / organizer roster rows | Focused RosterPlayerEditor added alongside the existing inline fields |
| 16 | Island Futsal Cup Knockout Bracket.png | PublicDirectories.tsx · BracketDirectory | #bracket / tournament Bracket tab | Existing interactive bracket; shared public styling |
| 17 | Island Futsal Cup Match Details.png | PublicPage.tsx · MatchPublicDetail | #matches/<id> | Existing scoreboard/events; shared public styling |
| 18 | Island Futsal Cup standings.png | PublicDirectories.tsx · StandingsDirectory | #standings / tournament Standings tab | Existing official tables; shared public styling |
| 19 | Island Sports Tournament Directory (1).png | PublicPage.tsx · TournamentList | #tournaments | Existing photo/logo card directory; shared public styling |
| 20 | Island Sports Tournament Directory.png | PublicPage.tsx · TournamentList | #tournaments | Second reference for the same directory |
| 21 | Kanditheemu Sports Club public profile.png | PublicPage.tsx · OrganizationPublicDetail | #organization/<slug> | Existing organization profile; shared public styling |
| 22 | KULHIVARU+ career records dashboard.png | PlayerPages.tsx · CareerPage | Player → Career Records | Existing data-bound two-column page; shared styling |
| 23 | KULHIVARU+ Digital Player Card.png | PlayerPages.tsx · CardPage / PlayerCard.tsx | Player → Digital Card | Existing live-rendered card; shared styling |
| 24 | KULHIVARU+ Island Sports Homepage.png | HomepageSections.tsx | #home | Existing island-sports homepage; shared palette/background |
| 25 | KULHIVARU+ Island Sports News.png | PublicDirectories.tsx · NewsDirectory | #news | Wide featured story plus three-column cards added |
| 26 | KULHIVARU+ Island Tournament Archive.png | PublicPage.tsx · ArchiveList | #archive | Existing filters/cards; shared public styling |
| 27 | KULHIVARU+ Maldives sports sign-in.png | App.tsx · AuthDialog (signin) | #signin / Sign in | Full-screen photo/form/header/footer composition added |
| 28 | KULHIVARU+ password reset screen.png | AuthPages.tsx · ResetPasswordPage | #reset-password | Existing split reset form; shared palette/background |
| 29 | KULHIVARU+ player activity history.png | PlayerPages.tsx · ActivityPage | Player → Activity | Existing timeline; shared two-column styling |
| 30 | KULHIVARU+ player documents dashboard.png | PlayerPages.tsx · DocumentsPage | Player → Documents | Existing private-document workflow; shared styling |
| 31 | KULHIVARU+ player privacy and help.png | PlayerPages.tsx · PrivacyHelpPage | Player → Privacy & Help | Existing controls/help; shared styling |
| 32 | KULHIVARU+ player profile editor.png | PlayerWorkspace.tsx / PlayerProfileEditors.tsx | Player → My Profile | Duplicate heroes removed; appearance/record/publication columns added |
| 33 | KULHIVARU+ Player Requests Dashboard.png | PlayerPages.tsx · RequestsPage | Player → Requests | Existing request tabs and invitation cards; shared styling |
| 34 | KULHIVARU+ Player Workspace Overview.png | PlayerPages.tsx · OverviewPage | Player → Overview | Existing reference composition; frame, spacing and neutral avatar aligned |
| 35 | KULHIVARU+ public player directory.png | PublicPage.tsx · PlayerList | #players | Existing three-column player cards; filters/style aligned |
| 36 | Kulhivaru+ Search Results for Kanditheemu.png | PublicDirectories.tsx · SearchDirectory | #search?q=<query> | Existing categorized search; shared styling |
| 37 | KULHIVARU+ Team Invitation Review.png | PlayerPages.tsx · InvitationReview | Player → Requests → Review invitation | Existing review/accept/decline handlers; shared styling |
| 38 | KULHIVARU+ Workspace Selection.png | WorkspaceChooser.tsx / WorkspacePanel.tsx | #workspace | Three large role cards, identity rows and Open Workspace actions rebuilt |
| 39 | Lagoon FC futsal team profile.png | PublicPage.tsx · TeamPublicDetail | #team/<slug> | Existing team profile; shared public styling |
| 40 | Lagoon FC Invitation Tracking Dashboard.png | TeamSquad.tsx · InvitationsPanel | Team → Squad → Invitations | Existing invitation filters/table; shared styling |
| 41 | Lagoon FC Player Invitation Review.png | TeamSquad.tsx · AddPlayerFlow, step 3 | Team → Squad → Add Player → Review Request | Existing confirmation gate; shared styling |
| 42 | Lagoon FC Player Membership Details.png | TeamSquad.tsx · AddPlayerFlow, step 2 | Team → Squad → Add Player → Continue | Existing membership fields; shared styling |
| 43 | Lagoon FC Roster Submission Dashboard.png | TeamOpsTabs.tsx · TeamRostersSection / RosterEditor | Team → Tournaments → Rosters | Existing validation/submission/history; shared styling |
| 44 | Lagoon FC squad management dashboard.png | TeamSquad.tsx · SquadPage | Team → Squad | Existing squad table and edit/remove actions; shared styling |
| 45 | Lagoon FC Team Workspace Dashboard.png | TeamHubTabs.tsx · TeamHeader / TeamOverview | Team → Overview | Photo banner, metric row and main/sidebar composition rebuilt |
| 46 | Live matches and scores across the islands.png | PublicDirectories.tsx · MatchesDirectory | #matches / #live | Existing live/upcoming/result feeds; shared styling |
| 47 | Maldives island sports organizations directory.png | PublicPage.tsx · OrganizationList | #organizations | Organization rows replaced with cover/identity/description cards |
| 48 | Maldives public teams directory.png | PublicPage.tsx · TeamList | #teams | Existing team cards; filter composition and spacing aligned |
| 49 | My Matches_ Upcoming Fixtures & Results.png | PlayerPages.tsx · MatchesPage | Player → My Matches | Existing fixture/results panels; shared styling |
| 50 | Twilight Island Futsal Sign-Up.png | App.tsx · AuthDialog (signup) | #signup | Full-screen photo/form composition; existing consent/password checks retained |

| 51 | Ahmed Rilwan Futsal Coach Profile.png | PublicDirectories.tsx · PersonPage | #coach/<public-id> | Cover/avatar, Overview/Records tabs and main/sidebar layout refined |
| 52 | Island Cup Team Roster Dashboard.png | TeamOpsTabs.tsx · RosterEditor | Team → Tournaments → Rosters | Existing selection, validation, submission and version history; focused player editor added |
| 53 | Island Cup roster player editor(1).png | RosterPlayerEditor.tsx | Roster → select player → Edit details | Focused playing-details form, record context and summary sidebar added |
| 54 | KULHIVARU+ coaches directory.png | PublicDirectories.tsx · PeopleDirectory | #coaches | Published-person cards, search, real counts and profile actions |
| 55 | Lagoon FC Team Finance Dashboard.png | TeamOpsTabs.tsx · TeamFinanceSection | Team → Finance | Compact team cover, metrics and full-width ledger; Add transaction action |
| 56 | Lagoon FC Tournament Entry Details.png | TeamOpsTabs.tsx · TeamApplicationsSection | Team → Tournaments → Applications | Existing application/roster/payment statuses and actions retained |
| 57 | Lagoon FC fixtures and results.png | TeamOpsTabs.tsx · TeamFixturesSection | Team → Matches | Existing real fixtures/results; compact identity cover and shared card styling |
| 58 | Lagoon FC roster review dashboard.png | TeamOpsTabs.tsx · RosterEditor | Team → Rosters | Existing server validation and submission/version details retained |
| 59 | Lagoon FC staff invitation dashboard.png | TeamHubTabs.tsx / WorkspaceInvitePanel.tsx | Team → Staff → Invite staff | Dedicated invitation form + access/help sidebar added |
| 60 | Lagoon FC staff permissions dashboard.png | TeamHubTabs.tsx · TeamStaffSection | Team → Staff | Team identity banner, actual access summaries and management actions |
| 61 | Lagoon FC team history dashboard.png | TeamOpsTabs.tsx · TeamStatsSection | Team → Team History | Existing confirmed-result statistics and trophy/history records; shared styling |
| 62 | Lagoon FC tournament entries dashboard.png | TeamOpsTabs.tsx · TeamTournamentsSection | Team → Tournaments | Entries composed as cover/logo rows; actual statuses and links retained |
| 63 | Roster review: changes requested.png | TeamOpsTabs.tsx · RosterEditor | Team → Rosters → correction state | Existing organizer notes/status and version history, with focused editing |
| 64 | Staff permissions dashboard for Lagoon FC.png | TeamStaffEditor.tsx | Team → Staff → Change role | Dedicated role/permission form + access-summary sidebar added |
| 65 | Team Match Preparation Dashboard.png | TeamOpsTabs.tsx · FixtureCard | Team → Matches → lineup view | Existing readable lineups and result-report workflow retained; see capability boundary below |
| 66 | Team finance transaction editor.png | TeamOpsTabs.tsx · TeamFinanceSection editor | Team → Finance → Add transaction / Edit draft | Dedicated form and live summary; only supported draft fields editable |

## Whole-app coverage beyond these references

The shared WorkspaceShell, panels, controls, tables, badges, navigation and responsive rules also style the existing Organizer, tournament cockpit, Official and Platform Administration pages. No general organizer dashboard or Super Admin mockup images were supplied, so those screens cannot be certified against a supplied image. Their permission gates and existing editing/deletion handlers remain in place.

## Differences that depend on actual product capability

- Actual names, logos, photos, counts, statuses and records come from the app's data. Empty accounts show honest empty states. The illustrative teams, people, finances and scores in the reference are not production content.
- The existing official KULHIVARU+ brand asset is preserved. It is not silently replaced by an approximate logo from a generated screenshot.
- Player Profile shows the existing default cover and a real photo editor. A per-player cover-upload backend does not exist in the supplied contract; a nonfunctional Change Cover button was not added.
- Registration uses the organizer's configured questions. Manager/jersey/category fields shown in an image do not become stored fields automatically. Unsupported fields and bank details/fees are not invented.
- Registration now reviews answers before the existing submission. Payment proof remains a separate Team Workspace action, preserving the existing application/payment/roster lifecycle.
- Roster editing now offers a focused player editor as well as inline fields. Applying those changes updates the current selection; submitting a roster remains the persistence action, preserving earlier versions.
- Email verification and password recovery keep their real email/session requirements. The verification view cannot be reached by pretending a real email was sent.

- Staff permissions follow the existing permission flags. A two-level View/Manage matrix is not invented where the server has one permission flag.
- Staff invitations retain the existing one-time-token flow. The app does not claim to send invitation emails.
- Finance edits respect the supplied ledger contract: only draft amount/description can be edited, while recorded entries can be voided with a reason. Other draft fields are visibly read-only in Edit Transaction.
- The match-preparation reference proposes an editable team worksheet. The supplied API exposes readable match participants and official operations; a new synchronized team-preparation backend was not fabricated.
- Coach expertise, license and certificate fields are not part of the public API. The profile explicitly says qualifications are not included rather than inventing credentials.

## Verification record

See REDESIGN_HANDOFF_2026-11-05.md for the final check results and remaining live acceptance requirements. Browser checks use isolated, read-only fixtures outside the packaged app. They verify rendered source components and interactions, not live Supabase access, persistence, RLS or deployment.

## Subsequent logo preference

The owner requested removal of generated shield framing from team logos after these mockups were made. Follow the current unframed TeamLogo rendering even when a reference image shows a shield. Do not add a second badge around uploaded team artwork.
