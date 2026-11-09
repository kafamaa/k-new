import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkspaceMatch } from './playerHub'
import type { Hub } from '../components/PlayerHubTabs'

const one = (value: unknown): Record<string, unknown> | null => Array.isArray(value) ? (value[0] as Record<string, unknown> | undefined) ?? null : value && typeof value === 'object' ? value as Record<string, unknown> : null

// ---------------------------------------------------------------------------
// Player Workspace, final specification: five sections with tabs, the Next
// Action engine, onboarding, claim status, eligibility, discipline,
// availability, activity and calendar export. Everything here is derived
// from records the player is allowed to read; nothing is invented.
// ---------------------------------------------------------------------------

export type PlayerSection = 'overview' | 'profile' | 'career' | 'requests' | 'more'
export const SECTION_TABS = {
  overview: [],
  profile: ['profile', 'card', 'privacy'],
  career: ['teams', 'tournaments', 'matches', 'statistics', 'achievements', 'history'],
  requests: ['requests', 'eligibility'],
  more: ['documents', 'discipline', 'availability', 'notifications', 'help'],
} as const satisfies Record<PlayerSection, readonly string[]>
export type CareerTab = (typeof SECTION_TABS.career)[number]
export type MatchesTab = 'upcoming' | 'live' | 'completed' | 'availability' | 'discipline'
export type MoreTab = (typeof SECTION_TABS.more)[number]
export type PlayerLocation = { section: PlayerSection; tab: string | null }
export const PLAYER_SECTIONS = Object.keys(SECTION_TABS) as PlayerSection[]

export const TAB_LABELS: Record<string, string> = {
  profile: 'Edit profile', card: 'Digital Card', privacy: 'Privacy & visibility',
  teams: 'Teams', tournaments: 'Tournaments', matches: 'Matches', statistics: 'Statistics', achievements: 'Achievements', history: 'History',
  requests: 'Invitations & Requests', eligibility: 'Eligibility',
  documents: 'Documents', discipline: 'Discipline', availability: 'Availability', notifications: 'Notifications', help: 'Help & settings',
  upcoming: 'Upcoming', live: 'Live', completed: 'Completed', activity: 'History',
}

// Older single-tab links (#…?tab=profile) and in-app shortcuts map onto the
// new sections, so nothing that was bookmarked breaks.
const LEGACY: Record<string, PlayerLocation> = {
  overview: { section: 'overview', tab: null },
  profile: { section: 'profile', tab: 'profile' }, card: { section: 'profile', tab: 'card' }, privacy: { section: 'profile', tab: 'privacy' },
  career: { section: 'career', tab: null }, teams: { section: 'career', tab: 'teams' }, tournaments: { section: 'career', tab: 'tournaments' },
  statistics: { section: 'career', tab: 'statistics' }, achievements: { section: 'career', tab: 'achievements' }, activity: { section: 'career', tab: 'history' }, history: { section: 'career', tab: 'history' },
  matches: { section: 'career', tab: 'matches' }, upcoming: { section: 'career', tab: 'matches' }, live: { section: 'career', tab: 'matches' }, completed: { section: 'career', tab: 'matches' },
  requests: { section: 'requests', tab: 'requests' }, eligibility: { section: 'requests', tab: 'eligibility' },
  documents: { section: 'more', tab: 'documents' }, discipline: { section: 'more', tab: 'discipline' }, availability: { section: 'more', tab: 'availability' },
  notifications: { section: 'more', tab: 'notifications' }, help: { section: 'more', tab: 'help' },
}
export function locationFor(target: string): PlayerLocation { return LEGACY[target] ?? { section: 'overview', tab: null } }

function validTab(section: PlayerSection, tab: string | null): string | null {
  const tabs = SECTION_TABS[section] as readonly string[]
  return tab && tabs.includes(tab) ? tab : null
}

export function parsePlayerLocation(hash: string): PlayerLocation {
  const params = new URLSearchParams(hash.split('?')[1] ?? '')
  const section = params.get('section')
  if (section && (PLAYER_SECTIONS as string[]).includes(section)) {
    // A tab that moved to another area (for example career → profile) follows it.
    const valid = validTab(section as PlayerSection, params.get('tab'))
    const moved = params.get('tab')
    return !valid && moved && LEGACY[moved] ? LEGACY[moved] : { section: section as PlayerSection, tab: valid }
  }
  if (section === 'matches' || section === 'card') return locationFor(section === 'card' ? 'card' : params.get('tab') === 'availability' || params.get('tab') === 'discipline' ? String(params.get('tab')) : 'matches')
  const legacy = params.get('tab')
  return legacy ? locationFor(legacy) : { section: 'overview', tab: null }
}

export function playerLocationHash(hash: string, location: PlayerLocation): string {
  const [base, query = ''] = hash.split('?')
  const params = new URLSearchParams(query)
  params.delete('section'); params.delete('tab')
  if (location.section !== 'overview') params.set('section', location.section)
  const tab = validTab(location.section, location.tab)
  if (tab) params.set('tab', tab)
  const next = params.toString()
  return `${base}${next ? `?${next}` : ''}`
}

// --- Next Action -------------------------------------------------------------------
export type NextActionInput = {
  claimed: boolean; emailVerified: boolean; identity: 'registered' | 'not_registered' | 'unavailable'; identityConflict: boolean
  missingProfile: string[]; pendingInvitation: string | null; eligibilityIssue: string | null; documentsNeedingAction: number
  rosterCorrection: string | null; availabilityNeeded: { matchId: string; label: string } | null; upcomingMatch: { label: string; when: string } | null
  isPublished: boolean; cardSeen: boolean
}
export type NextAction = { id: string; title: string; text: string; button: string; target: PlayerLocation }

// One highest-priority task, in the specification's order.
export function nextAction(input: NextActionInput): NextAction | null {
  if (!input.claimed) return { id: 'claim', title: 'Claim your player profile', text: 'Confirm this profile is yours so its history and Digital Card belong to your account.', button: 'Review claim', target: locationFor('privacy') }
  if (!input.emailVerified) return { id: 'email', title: 'Verify your email', text: 'Open the confirmation email we sent, so your account can be trusted with your records.', button: 'Open account settings', target: locationFor('privacy') }
  if (input.identityConflict) return { id: 'conflict', title: 'Resolve a duplicate identity', text: 'Your identity matches another profile. The platform team reviews this privately.', button: 'Open requests', target: locationFor('requests') }
  if (input.missingProfile.length) return { id: 'profile', title: 'Complete your player profile', text: `Add your ${input.missingProfile.slice(0, 3).join(', ').toLowerCase()} so teams and organizers can recognise you.`, button: 'Complete profile', target: locationFor('profile') }
  if (input.pendingInvitation) return { id: 'invitation', title: `Review your invitation from ${input.pendingInvitation}`, text: 'Accepting adds a dated team membership. Your earlier history stays.', button: 'Review invitation', target: locationFor('teams') }
  if (input.eligibilityIssue) return { id: 'eligibility', title: 'Resolve an eligibility requirement', text: `Something is needed before you can play in ${input.eligibilityIssue}.`, button: 'Open eligibility', target: locationFor('eligibility') }
  if (input.documentsNeedingAction) return { id: 'document', title: 'Upload a requested document', text: `${input.documentsNeedingAction} document${input.documentsNeedingAction === 1 ? ' needs' : 's need'} a new file or changes.`, button: 'Open documents', target: locationFor('documents') }
  if (input.rosterCorrection) return { id: 'roster', title: 'Respond to a roster correction', text: `The organizer of ${input.rosterCorrection} asked for changes. Your team manager may need your details.`, button: 'Open tournaments', target: locationFor('tournaments') }
  if (input.availabilityNeeded) return { id: 'availability', title: 'Confirm your availability', text: `Let your team know if you can play ${input.availabilityNeeded.label}.`, button: 'Set availability', target: locationFor('availability') }
  if (input.upcomingMatch) return { id: 'match', title: `Get ready: ${input.upcomingMatch.label}`, text: input.upcomingMatch.when, button: 'View match', target: locationFor('upcoming') }
  if (!input.isPublished) return { id: 'privacy', title: 'Review your publication settings', text: 'Your profile is private. Preview what the public would see, then decide.', button: 'Review privacy', target: locationFor('privacy') }
  if (!input.cardSeen) return { id: 'card', title: 'See your Digital Player Card', text: 'It is generated automatically from your approved profile and official statistics.', button: 'Open card', target: locationFor('card') }
  return null
}

// --- Onboarding -----------------------------------------------------------------------
export type OnboardingStep = { id: 'identity' | 'profile' | 'team' | 'privacy' | 'finish'; label: string; done: boolean; target: PlayerLocation }
export type OnboardingChoices = { withoutTeam?: boolean; keepPrivate?: boolean; dismissed?: boolean }
export function onboardingSteps(input: { identity: 'registered' | 'not_registered' | 'unavailable'; missingBasics: string[]; hasTeam: boolean; isPublished: boolean; choices: OnboardingChoices }): OnboardingStep[] {
  const steps: OnboardingStep[] = [
    { id: 'identity', label: 'Secure identity check', done: input.identity === 'registered', target: locationFor('profile') },
    { id: 'profile', label: 'Basic profile', done: input.missingBasics.length === 0, target: locationFor('profile') },
    { id: 'team', label: 'Team', done: input.hasTeam || input.choices.withoutTeam === true, target: locationFor('teams') },
    { id: 'privacy', label: 'Privacy', done: input.isPublished || input.choices.keepPrivate === true, target: locationFor('privacy') },
  ]
  return [...steps, { id: 'finish', label: 'Ready', done: steps.every(step => step.done), target: { section: 'overview', tab: null } }]
}
const ONBOARDING_KEY = (playerId: string) => `kulhivaru.player-onboarding.${playerId}`
export function readOnboarding(playerId: string): OnboardingChoices { try { const value = JSON.parse(localStorage.getItem(ONBOARDING_KEY(playerId)) ?? '{}'); return value && typeof value === 'object' ? value : {} } catch { return {} } }
export function writeOnboarding(playerId: string, choices: OnboardingChoices): void { try { localStorage.setItem(ONBOARDING_KEY(playerId), JSON.stringify(choices)) } catch { /* preference only */ } }

// The basics the guided setup asks for.
export function missingBasics(profile: Record<string, unknown>, photo: string): string[] {
  const text = (key: string) => typeof profile[key] === 'string' && String(profile[key]).trim()
  return [
    !photo ? 'Photo' : null, !text('display_name') ? 'Display name' : null, !text('island') ? 'Island' : null,
    !(Array.isArray(profile.sports) && profile.sports.length) ? 'Primary sport' : null, !text('position') ? 'Position' : null,
  ].filter((item): item is string => Boolean(item))
}

// --- Claim and verification ---------------------------------------------------------------
export type ClaimStatus = 'unclaimed' | 'invitation_sent' | 'claimed' | 'identity_review' | 'verified' | 'conflict'
export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = { unclaimed: 'Unclaimed', invitation_sent: 'Invitation sent', claimed: 'Claimed', identity_review: 'Identity review required', verified: 'Verified', conflict: 'Duplicate or conflict detected' }
export function claimStatus(input: { claimed: boolean; pendingClaimInvitation: boolean; identity: 'registered' | 'not_registered' | 'unavailable'; openIdentityRequest: boolean; conflict: boolean }): ClaimStatus {
  if (input.conflict) return 'conflict'
  if (!input.claimed) return input.pendingClaimInvitation ? 'invitation_sent' : 'unclaimed'
  if (input.openIdentityRequest) return 'identity_review'
  return input.identity === 'registered' ? 'verified' : 'claimed'
}

// --- Eligibility ----------------------------------------------------------------------------
export type EligibilityStatus = 'eligible' | 'provisional' | 'action_required' | 'under_review' | 'ineligible' | 'expired'
export const ELIGIBILITY_LABELS: Record<EligibilityStatus, string> = { eligible: 'Eligible', provisional: 'Provisionally eligible', action_required: 'Action required', under_review: 'Under review', ineligible: 'Ineligible', expired: 'Expired' }
export type EligibilityCheck = { id: string; label: string; state: 'ok' | 'action' | 'review' | 'fail' | 'organizer'; detail: string; who: string; todo: string | null }
export type EligibilityInput = {
  tournamentName: string; identity: 'registered' | 'not_registered' | 'unavailable'; emailVerified: boolean; isMinor: boolean; guardianApproved: boolean
  activeMembership: boolean; rosterStatus: string | null; documents: Array<{ status: string; retentionUntil: string | null }>; now?: number
}
export function eligibilityFor(input: EligibilityInput): { status: EligibilityStatus; checks: EligibilityCheck[] } {
  const now = input.now ?? Date.now()
  const expired = input.documents.some(doc => doc.status === 'expired' || (doc.retentionUntil !== null && Date.parse(doc.retentionUntil) < now))
  const returned = input.documents.some(doc => ['changes_requested', 'rejected'].includes(doc.status))
  const reviewing = input.documents.some(doc => ['uploaded', 'under_review'].includes(doc.status))
  const roster = input.rosterStatus ?? 'not_started'
  const checks: EligibilityCheck[] = [
    { id: 'identity', label: 'Identity verified', state: input.identity === 'registered' ? 'ok' : 'action', detail: input.identity === 'registered' ? 'Your identity is verified and protected.' : 'Organizers need a verified identity to prevent duplicate players.', who: 'Checked securely by Kulhivaru+', todo: input.identity === 'registered' ? null : 'Complete the secure identity check in My Profile.' },
    { id: 'email', label: 'Email verified', state: input.emailVerified ? 'ok' : 'action', detail: input.emailVerified ? 'Your account email is confirmed.' : 'Your account email is not confirmed yet.', who: 'Your account', todo: input.emailVerified ? null : 'Open the confirmation email we sent you.' },
    { id: 'age', label: 'Age and category', state: 'organizer', detail: 'Your age group is checked against the category by the organizer.', who: `Organizer of ${input.tournamentName}`, todo: null },
    ...(input.isMinor ? [{ id: 'guardian', label: 'Guardian consent', state: input.guardianApproved ? 'ok' as const : 'action' as const, detail: input.guardianApproved ? 'A guardian approval is on file.' : 'Players under 18 need a guardian’s approval.', who: 'The organizer who registered you records it', todo: input.guardianApproved ? null : 'Ask your guardian to contact your team or organizer.' }] : []),
    { id: 'membership', label: 'Active team membership', state: input.activeMembership ? 'ok' : 'fail', detail: input.activeMembership ? 'You are an active member of the team you represent.' : 'Your membership of the team you represent is not active.', who: 'Your team manager', todo: input.activeMembership ? null : 'Ask your team manager to check your membership.' },
    { id: 'roster', label: 'Roster approval', state: roster === 'approved' || roster === 'locked' ? 'ok' : roster === 'rejected' ? 'fail' : roster === 'changes_requested' ? 'action' : 'review', detail: { approved: 'Your team’s roster with you on it is approved.', locked: 'The approved roster is locked for the tournament.', rejected: 'The organizer rejected the roster.', changes_requested: 'The organizer asked your team to change the roster.', submitted: 'Your team sent the roster; the organizer is reviewing it.', under_review: 'The organizer is reviewing the roster.' }[roster] ?? 'Your team has not sent a roster with you yet.', who: `Organizer of ${input.tournamentName}`, todo: roster === 'changes_requested' || roster === 'rejected' ? 'Your team manager updates the roster; send them any details they need.' : null },
    { id: 'documents', label: 'Required documents', state: expired ? 'fail' : returned ? 'action' : reviewing ? 'review' : 'ok', detail: expired ? 'A document has expired.' : returned ? 'A document was returned for changes.' : reviewing ? 'Your document is being reviewed.' : input.documents.length ? 'Your documents are verified.' : 'No document has been requested from you.', who: `Organizer of ${input.tournamentName}`, todo: expired || returned ? 'Upload a new file in Documents.' : null },
    { id: 'suspension', label: 'Suspension status', state: 'organizer', detail: 'Suspensions are decided and communicated by the organizer; Kulhivaru+ does not record them yet.', who: `Organizer of ${input.tournamentName}`, todo: null },
  ]
  const status: EligibilityStatus = expired ? 'expired'
    : checks.some(check => check.state === 'fail') ? 'ineligible'
      : checks.some(check => check.state === 'action') ? 'action_required'
        : checks.some(check => check.state === 'review') ? 'under_review'
          : input.identity === 'registered' ? 'eligible' : 'provisional'
  return { status, checks }
}

// --- Discipline ----------------------------------------------------------------------------
// From confirmed matches only. A match with two yellow cards is shown as a
// second-yellow dismissal only together with a red card in that match.
export function disciplineSummary(matches: WorkspaceMatch[]): { yellow: number; red: number; secondYellow: number; matches: WorkspaceMatch[] } {
  const confirmed = matches.filter(match => match.resultConfirmed && match.participated && match.yellow + match.red > 0)
  return {
    yellow: confirmed.reduce((sum, match) => sum + match.yellow, 0),
    red: confirmed.reduce((sum, match) => sum + match.red, 0),
    secondYellow: confirmed.filter(match => match.yellow >= 2 && match.red >= 1).length,
    matches: confirmed,
  }
}

// --- Availability ----------------------------------------------------------------------------
export const AVAILABILITY = ['available', 'unavailable', 'maybe', 'injured', 'suspended', 'other'] as const
export type Availability = (typeof AVAILABILITY)[number]
export const AVAILABILITY_LABELS: Record<Availability, string> = { available: 'Available', unavailable: 'Unavailable', maybe: 'Maybe', injured: 'Injured', suspended: 'Suspended', other: 'Other (private reason)' }
const MISSING = /does not exist|PGRST2\d\d|42P0\d|42703|42883|schema cache|could not find/i
export const NEEDS_FINAL = 'This needs the Player Workspace migration (player_workspace_final).'

export async function loadAvailability(client: SupabaseClient, playerId: string): Promise<{ data: Map<string, { status: Availability; reason: string | null }>; available: boolean }> {
  const result = await client.from('player_match_availability').select('match_id,status,private_reason').eq('player_id', playerId)
  if (result.error) return { data: new Map(), available: !MISSING.test(result.error.message) }
  return { data: new Map(((result.data ?? []) as Record<string, unknown>[]).map(row => [String(row.match_id), { status: row.status as Availability, reason: typeof row.private_reason === 'string' ? row.private_reason : null }])), available: true }
}
export async function saveAvailability(client: SupabaseClient, playerId: string, matchId: string, status: Availability, reason: string): Promise<{ error: string | null }> {
  if (reason.length > 200) return { error: 'Keep the reason under 200 characters.' }
  const result = await client.from('player_match_availability').upsert({ player_id: playerId, match_id: matchId, status, private_reason: reason.trim() || null, updated_at: new Date().toISOString() })
  if (!result.error) return { error: null }
  if (MISSING.test(result.error.message)) return { error: NEEDS_FINAL }
  return { error: /row-level security/i.test(result.error.message) ? 'Availability can only be set for upcoming matches of your current team.' : 'Your availability could not be saved. Please try again.' }
}

// --- Calendar ----------------------------------------------------------------------------------
const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsText = (value: string) => value.replace(/[\\;,]/g, match => `\\${match}`).replace(/\r?\n/g, ' ')
// A standard calendar entry (2 hours) for one fixture. Only public match facts.
export function matchCalendarFile(match: Pick<WorkspaceMatch, 'id' | 'scheduledAt' | 'homeTeamName' | 'awayTeamName' | 'tournamentName' | 'venue'>, now = new Date()): string | null {
  if (!match.scheduledAt) return null
  const end = new Date(Date.parse(match.scheduledAt) + 2 * 3600_000).toISOString()
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kulhivaru+//Player Workspace//EN', 'BEGIN:VEVENT', `UID:${match.id}@kulhivaru`, `DTSTAMP:${icsDate(now.toISOString())}`,
    `DTSTART:${icsDate(match.scheduledAt)}`, `DTEND:${icsDate(end)}`, `SUMMARY:${icsText(`${match.homeTeamName} v ${match.awayTeamName}`)}`,
    `DESCRIPTION:${icsText(match.tournamentName)}`, ...(match.venue ? [`LOCATION:${icsText(match.venue)}`] : []), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
}

// --- Activity -------------------------------------------------------------------------------------
export type ActivityItem = { id: string; event: string; detail: string | null; createdAt: string }
export const ACTIVITY_LABELS: Record<string, string> = {
  profile_updated: 'Profile updated', profile_published: 'Profile published', profile_unpublished: 'Profile unpublished', profile_claimed: 'Profile claimed',
  privacy_changed: 'Privacy settings changed', invitation_accepted: 'Team invitation accepted', invitation_declined: 'Team invitation declined', invitation_reported: 'Team invitation reported',
  join_request_submitted: 'Join request sent', join_request_approved: 'Join request approved', join_request_rejected: 'Join request declined', join_request_withdrawn: 'Join request withdrawn',
  document_uploaded: 'Document uploaded', document_removed: 'Document removed', document_verified: 'Document verified', document_rejected: 'Document rejected', document_changes_requested: 'Document returned for changes', document_under_review: 'Document under review', document_expired: 'Document expired',
  request_submitted: 'Request sent', request_under_review: 'Request under review', request_resolved: 'Request approved', request_rejected: 'Request rejected', request_changes_requested: 'More information requested', request_cancelled: 'Request cancelled', request_pending: 'Request sent again',
  card_downloaded: 'Player Card downloaded', card_shared: 'Player Card shared', card_printed: 'Player Card printed',
}
export const activityLabel = (event: string) => ACTIVITY_LABELS[event] ?? 'Account activity'
export async function loadActivity(client: SupabaseClient, playerId: string, before: string | null = null): Promise<{ data: ActivityItem[]; error: string | null; available: boolean }> {
  let request = client.from('player_activity').select('id,event,detail,created_at').eq('player_id', playerId).order('created_at', { ascending: false }).limit(30)
  if (before) request = request.lt('created_at', before)
  const result = await request
  if (result.error) return { data: [], error: MISSING.test(result.error.message) ? NEEDS_FINAL : 'Your activity could not be loaded.', available: !MISSING.test(result.error.message) }
  return { data: ((result.data ?? []) as Record<string, unknown>[]).map(row => ({ id: String(row.id), event: String(row.event), detail: typeof row.detail === 'string' ? row.detail : null, createdAt: String(row.created_at) })), error: null, available: true }
}
export async function logCardAction(client: SupabaseClient, userId: string, playerId: string, event: 'card_downloaded' | 'card_shared' | 'card_printed'): Promise<void> {
  await client.from('player_activity').insert({ player_id: playerId, actor_id: userId, event }).then(() => undefined, () => undefined)
}

// --- Action inbox ----------------------------------------------------------------------------------
// Things that need the player, kept apart from information-only notices.
export type InboxAction = { key: string; title: string; detail: string; target: PlayerLocation }
export function inboxActions(input: { invitations: Array<{ id: string; teamName: string; status: string }>; rosterCorrections: string[]; documentsNeedingAction: number; eligibilityIssues: string[]; verification: boolean }): InboxAction[] {
  return [
    ...input.invitations.filter(item => item.status === 'pending').map(item => ({ key: `i-${item.id}`, title: `Team invitation from ${item.teamName}`, detail: 'Accept or decline.', target: locationFor('teams') })),
    ...input.rosterCorrections.map(name => ({ key: `r-${name}`, title: `Roster changes requested · ${name}`, detail: 'Your team manager updates the roster.', target: locationFor('tournaments') })),
    ...(input.documentsNeedingAction ? [{ key: 'docs', title: `${input.documentsNeedingAction} document${input.documentsNeedingAction === 1 ? '' : 's'} need attention`, detail: 'Missing, returned or expiring.', target: locationFor('documents') }] : []),
    ...input.eligibilityIssues.map(name => ({ key: `e-${name}`, title: `Eligibility needs action · ${name}`, detail: 'See what is missing and who reviews it.', target: locationFor('eligibility') })),
    ...(input.verification ? [{ key: 'verify', title: 'Complete your identity check', detail: 'Needed for tournaments and to prevent duplicates.', target: locationFor('profile') }] : []),
  ]
}

// Safe file names for downloads: letters, digits and dashes only.
export function safeFileName(value: string, fallback = 'player'): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || fallback
}

// --- Tournaments ------------------------------------------------------------------------------
export type TournamentItem = { id: string; teamId: string | null; teamName: string | null; applicationStatus: string | null; rosterStatus: string | null; rosterNote: string | null; submittedAt: string | null; shirt: string | null; appearances: number }
// Every tournament the player is connected to: a roster line, confirmed
// statistics, or a fixture of their team.
export function tournamentItems(hub: Hub): TournamentItem[] {
  type Item = TournamentItem
  const items = new Map<string, Item>()
  for (const row of hub.data.rosterRows ?? []) {
    const submission = one(row.roster_submissions); const entry = one(submission?.tournament_entries)
    const id = String(entry?.tournament_id ?? ''); if (!id) continue
    items.set(id, { id, teamId: (entry?.team_id as string | null) ?? null, teamName: String(one(entry?.teams)?.name ?? '') || null, applicationStatus: (entry?.application_status as string | null) ?? null, rosterStatus: (entry?.roster_status as string | null) ?? (submission?.status as string | null) ?? null, rosterNote: (submission?.review_notes as string | null) ?? null, submittedAt: (entry?.submitted_at as string | null) ?? null, shirt: row.shirt_number ? String(row.shirt_number) : null, appearances: 0 })
  }
  const teamNames = new Map(hub.data.teams.map(row => [String(row.team_id), String(one(row.teams)?.name ?? '')]))
  for (const row of hub.data.statistics) {
    const id = String(row.tournament_id ?? ''); if (!id) continue
    const item = items.get(id) ?? { id, teamId: row.team_id ? String(row.team_id) : null, teamName: teamNames.get(String(row.team_id ?? '')) || null, applicationStatus: null, rosterStatus: 'approved', rosterNote: null, submittedAt: null, shirt: null, appearances: 0 }
    item.appearances += Number(row.appearances ?? 0); items.set(id, item)
  }
  for (const match of hub.matches) if (!items.has(match.tournamentId)) items.set(match.tournamentId, { id: match.tournamentId, teamId: match.teamId, teamName: match.teamId === match.homeTeamId ? match.homeTeamName : match.awayTeamName, applicationStatus: null, rosterStatus: null, rosterNote: null, submittedAt: null, shirt: null, appearances: 0 })
  return [...items.values()]
}
