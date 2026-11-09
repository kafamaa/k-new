import type { SupabaseClient } from '@supabase/supabase-js'
import { statusLabel } from './i18n'
import { calculateStandings } from './competition'
import { SETUP_STEP_KEYS } from './tournament'
import type { RecordResult, Sport } from './records'

// ---------------------------------------------------------------------------
// Organizer workspace data + logic layer.
//
// Everything in this module reads and writes through the caller's own
// Supabase client, so the database row-level security policies are the real
// authorization boundary. The UI helpers below (counts, next action, labels)
// are pure functions so they can be unit-tested without a database.
//
// Status vocabularies below mirror the CHECK constraints in the applied
// migrations; they are the ONLY values the database will accept.
// ---------------------------------------------------------------------------

// tournaments.status - migration 202610210003
export const TOURNAMENT_STATUSES = ['draft', 'setup', 'registration_open', 'registration_closed', 'in_progress', 'completed', 'archived', 'cancelled'] as const
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number]

// tournament_entries.application_status - migration 202610210004
export const APPLICATION_STATUSES = ['draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'withdrawn', 'waitlisted'] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

// tournament_entries.roster_status / roster_submissions.status - 202610210004
export const ROSTER_STATUSES = ['not_started', 'draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'locked', 'rejected'] as const
export type RosterStatus = (typeof ROSTER_STATUSES)[number]

// tournament_entries.payment_status - 202610210004
export const PAYMENT_STATUSES = ['not_required', 'unpaid', 'proof_submitted', 'under_review', 'paid', 'waived', 'refunded', 'overdue', 'rejected'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

// matches.status - migration 202610210005
export const MATCH_STATUSES = ['scheduled', 'live', 'awaiting_confirmation', 'confirmed', 'postponed', 'abandoned', 'cancelled'] as const
export type MatchStatus = (typeof MATCH_STATUSES)[number]

// organization_memberships.role - migration 202610210001
export type OrganizerRole = 'owner' | 'operations' | 'staff' | 'finance' | 'media'

// The setup wizard has NINE stages (owner's 2026-10-23 revision). Progress and
// resumability are computed over the wizard keys [1..8, 11], so historical rows
// stored under the old keys 9/10 (Officials, Finance - now standalone
// management modules, deleted from the wizard) never block or advance setup.
export const SETUP_STEP_COUNT = 9
export const SETUP_WIZARD_KEYS = SETUP_STEP_KEYS

export type StatusTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'live'

// Statuses that still need human work; used for counts and the attention list.
export const PENDING_APPLICATION_STATUSES: ApplicationStatus[] = ['submitted', 'under_review', 'changes_requested']
export const PENDING_ROSTER_STATUSES: RosterStatus[] = ['submitted', 'under_review']
export const PENDING_PAYMENT_STATUSES: PaymentStatus[] = ['proof_submitted', 'under_review']
export const UNRESOLVED_MATCH_STATUSES: MatchStatus[] = ['scheduled', 'live', 'awaiting_confirmation', 'postponed', 'abandoned']

// ---------------------------------------------------------------------------
// Labels and tones. Colour is never the only signal: every label renders its
// own text, and the tone only styles that text.
// ---------------------------------------------------------------------------

const TOURNAMENT_LABELS: Record<TournamentStatus, string> = {
  draft: 'Draft',
  setup: 'Setup in progress',
  registration_open: 'Registration open',
  registration_closed: 'Registration closed',
  in_progress: 'In progress',
  completed: 'Completed',
  archived: 'Archived',
  cancelled: 'Cancelled',
}

const TOURNAMENT_TONES: Record<TournamentStatus, StatusTone> = {
  draft: 'neutral',
  setup: 'info',
  registration_open: 'ok',
  registration_closed: 'info',
  in_progress: 'live',
  completed: 'ok',
  archived: 'neutral',
  cancelled: 'danger',
}

export function tournamentStatusLabel(status: string): string {
  return TOURNAMENT_LABELS[status as TournamentStatus] ?? status
}

export function tournamentStatusTone(status: string): StatusTone {
  return TOURNAMENT_TONES[status as TournamentStatus] ?? 'neutral'
}

export function applicationStatusLabel(status: string): string {
  const labels: Record<string, string> = { draft: 'Draft', submitted: 'Submitted', under_review: 'Under review', changes_requested: 'Changes requested', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn', waitlisted: 'Waitlisted' }
  return statusLabel('application', status, labels[status] ?? status)
}

export function rosterStatusLabel(status: string): string {
  const labels: Record<string, string> = { not_started: 'Not started', draft: 'Draft', submitted: 'Submitted', under_review: 'Under review', changes_requested: 'Changes requested', approved: 'Approved', locked: 'Locked', rejected: 'Rejected' }
  return statusLabel('roster', status, labels[status] ?? status)
}

export function paymentStatusLabel(status: string): string {
  const labels: Record<string, string> = { not_required: 'Not required', unpaid: 'Pending', proof_submitted: 'Proof submitted', under_review: 'Under review', paid: 'Verified', waived: 'Waived', refunded: 'Refunded', overdue: 'Overdue', rejected: 'Rejected' }
  return statusLabel('payment', status, labels[status] ?? status)
}

export function matchStatusLabel(status: string): string {
  const labels: Record<string, string> = { scheduled: 'Scheduled', live: 'Live', awaiting_confirmation: 'Awaiting confirmation', confirmed: 'Official', postponed: 'Postponed', abandoned: 'Abandoned', cancelled: 'Cancelled' }
  return statusLabel('match', status, labels[status] ?? status)
}

export function applicationStatusTone(status: string): StatusTone {
  const tones: Record<string, StatusTone> = { draft: 'neutral', submitted: 'warn', under_review: 'warn', changes_requested: 'warn', approved: 'ok', rejected: 'danger', withdrawn: 'neutral', waitlisted: 'info' }
  return tones[status] ?? 'neutral'
}

export function rosterStatusTone(status: string): StatusTone {
  const tones: Record<string, StatusTone> = { not_started: 'neutral', draft: 'neutral', submitted: 'warn', under_review: 'warn', changes_requested: 'warn', approved: 'ok', locked: 'info', rejected: 'danger' }
  return tones[status] ?? 'neutral'
}

export function paymentStatusTone(status: string): StatusTone {
  const tones: Record<string, StatusTone> = { not_required: 'neutral', unpaid: 'warn', proof_submitted: 'warn', under_review: 'warn', paid: 'ok', waived: 'info', refunded: 'info', overdue: 'danger', rejected: 'danger' }
  return tones[status] ?? 'neutral'
}

export function matchStatusTone(status: string): StatusTone {
  const tones: Record<string, StatusTone> = { scheduled: 'info', live: 'live', awaiting_confirmation: 'warn', confirmed: 'ok', postponed: 'warn', abandoned: 'danger', cancelled: 'neutral' }
  return tones[status] ?? 'neutral'
}

const SPORT_LABELS: Record<string, string> = { football: 'Football', futsal: 'Futsal', handball: 'Handball', volleyball: 'Volleyball', basketball: 'Basketball', basketball_3x3: '3x3 basketball' }

export function sportLabel(sport: string): string {
  return SPORT_LABELS[sport] ?? sport
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : /(s|x|ch|sh)$/.test(noun) ? 'es' : 's'}`
}

// Maldives-first currency formatting. Uses the ISO code so the value is never
// ambiguous, and stays readable without a network round trip.
export function formatMvr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return 'MVR —'
  return `MVR ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Dates are rendered in the Maldives timezone so an organizer reading a
// 23:00 fixture never sees the wrong calendar day.
export function formatWorkspaceDate(value: string | null | undefined): string {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not scheduled'
  return date.toLocaleString('en-GB', { timeZone: 'Indian/Maldives', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ---------------------------------------------------------------------------
// Navigation model. Permission gating here only decides what to render; the
// database policies remain the enforcement point for every read and write.
// ---------------------------------------------------------------------------

export type OrganizerSection = 'overview' | 'tournaments' | 'teams' | 'players' | 'claims' | 'duplicates' | 'imports' | 'staff' | 'finance' | 'news' | 'reports' | 'profile' | 'settings'

export type NavItem = { section: OrganizerSection; label: string; hint: string }

export const NAV_ITEMS: Record<OrganizerSection, NavItem> = {
  overview: { section: 'overview', label: 'Overview', hint: 'Status, counts, and your next action' },
  tournaments: { section: 'tournaments', label: 'Tournaments', hint: 'Every tournament this organization runs' },
  teams: { section: 'teams', label: 'Teams', hint: 'Search, link, and create team records' },
  players: { section: 'players', label: 'Players', hint: 'Create unclaimed player records and invitations' },
  // Final plan 37: Claims, Possible duplicates and Imports sit beside Teams and Players.
  claims: { section: 'claims', label: 'Claims', hint: 'Claim status and invitations for the players you created' },
  duplicates: { section: 'duplicates', label: 'Possible duplicates', hint: 'Records that may be the same person or team, sent for review' },
  imports: { section: 'imports', label: 'Imports', hint: 'Bulk import from CSV or Excel, with template and history' },
  staff: { section: 'staff', label: 'Staff', hint: 'Assign limited tournament permissions' },
  finance: { section: 'finance', label: 'Finance', hint: 'MVR expenses, payments, and receipts' },
  news: { section: 'news', label: 'News', hint: 'Write and publish news and announcements' },
  reports: { section: 'reports', label: 'Reports', hint: 'Export authorized records as CSV' },
  profile: { section: 'profile', label: 'Organization Profile', hint: 'Name and public visibility' },
  settings: { section: 'settings', label: 'Settings', hint: 'Publish, status changes, and completion' },
}

export function canManageTournaments(role: string): boolean {
  return role === 'owner' || role === 'operations'
}

// Assigning tournament staff is an owner/operations capability; the database
// policies require the same role, so this only decides whether to render the
// control at all.
export function canManageStaff(role: string): boolean {
  return canManageTournaments(role)
}

export function canManageFinance(role: string, staffPermissions: string[]): boolean {
  return canManageTournaments(role) || role === 'finance' || staffPermissions.includes('finance')
}

// News follows the news_articles policy: owner, operations and media members,
// or staff holding the tournament media permission.
export function canManageNews(role: string, staffPermissions: string[]): boolean {
  return canManageTournaments(role) || role === 'media' || staffPermissions.includes('media')
}

export function canViewReports(role: string): boolean {
  return canManageTournaments(role)
}

// The visible navigation is derived from the membership role plus any explicit
// tournament staff permissions the account holds for this organization.
export function organizerNav(role: string, staffPermissions: string[] = []): NavItem[] {
  const manager = canManageTournaments(role)
  const items: NavItem[] = [NAV_ITEMS.overview, NAV_ITEMS.tournaments, NAV_ITEMS.teams, NAV_ITEMS.players, NAV_ITEMS.claims, NAV_ITEMS.duplicates, NAV_ITEMS.imports]
  if (manager) items.push(NAV_ITEMS.staff)
  if (canManageFinance(role, staffPermissions)) items.push(NAV_ITEMS.finance)
  if (canManageNews(role, staffPermissions)) items.push(NAV_ITEMS.news)
  if (canViewReports(role)) items.push(NAV_ITEMS.reports, NAV_ITEMS.profile, NAV_ITEMS.settings)
  return items
}

// Distinct staff permissions the account holds across this organization's
// tournaments. Self-scoped by the staff-assignment read policy (021); an
// unreadable table simply yields no extra permissions.
export async function loadMyStaffPermissions(client: SupabaseClient, userId: string, organizationId: string): Promise<string[]> {
  const result = await client.from('tournament_staff_assignments').select('permission,tournaments!inner(organization_id)').eq('user_id', userId).eq('tournaments.organization_id', organizationId)
  if (result.error) return []
  return [...new Set(((result.data ?? []) as Array<{ permission?: unknown }>).map(row => String(row.permission ?? '')).filter(Boolean))]
}

export function isOrganizerSection(value: string): value is OrganizerSection {
  return value in NAV_ITEMS
}

// ---------------------------------------------------------------------------
// Organizer sub-routing. The workspace route itself is
// `#workspace/organization/<id>` (the shared resolver owns that shape), so the
// dashboard section, the open tournament, and the active cockpit tab travel as
// hash query parameters. That keeps deep links refresh-safe and leaves the
// authorized-workspace resolution untouched.
// ---------------------------------------------------------------------------

// fixtures, media and completion: organizer pages 33, 38 and 39 (migration 036).
export const TOURNAMENT_TABS = ['overview', 'setup', 'applications', 'teams', 'draw', 'fixtures', 'matches', 'standings', 'finance', 'staff', 'media', 'settings', 'completion', 'reports'] as const
export type OrganizerTab = (typeof TOURNAMENT_TABS)[number]

export type OrganizerSubroute = {
  section: OrganizerSection
  tournamentId: string | null
  tab: OrganizerTab
  step: number | null
}

export function isOrganizerTab(value: string): value is OrganizerTab {
  return (TOURNAMENT_TABS as readonly string[]).includes(value)
}

// A tournament opens at its own address, #workspace/tournament/<id>?tab=… (owner,
// 2026-11-02). Older #workspace/organization/<id>?tid=… links still open it.
export const TOURNAMENT_ROUTE = /^#\/?workspace\/tournament\/([^/?]+)/

export function tournamentRouteId(hash: string): string | null {
  const match = TOURNAMENT_ROUTE.exec(hash)
  const id = match ? decodeURIComponent(match[1]).trim() : ''
  return id || null
}

export function parseOrganizerSubroute(hash: string): OrganizerSubroute {
  const query = hash.split('?')[1] ?? ''
  const params = new URLSearchParams(query)
  const rawSection = params.get('section') ?? ''
  const rawTab = params.get('tab') ?? ''
  const rawTid = tournamentRouteId(hash) ?? params.get('tid')
  const rawStep = params.get('step')
  const step = rawStep !== null && /^\d+$/.test(rawStep) ? Number(rawStep) : null
  const tournamentId = rawTid && rawTid.trim() ? rawTid.trim() : null
  const section: OrganizerSection = isOrganizerSection(rawSection) ? rawSection : tournamentId ? 'tournaments' : 'overview'
  const tab: OrganizerTab = isOrganizerTab(rawTab) ? rawTab : 'overview'
  return { section, tournamentId, tab, step: step !== null && step >= 1 && step <= SETUP_STEP_COUNT ? step : null }
}

export function organizerHash(organizationId: string, options: { section?: OrganizerSection; tournamentId?: string | null; tab?: OrganizerTab | null; step?: number | null } = {}): string {
  if (options.tournamentId) return tournamentHash(options.tournamentId, options.tab ?? null, options.step ?? null)
  const params = new URLSearchParams()
  const section = options.section ?? (options.tournamentId ? 'tournaments' : 'overview')
  params.set('section', section)
  if (options.tournamentId) params.set('tid', options.tournamentId)
  if (options.tab) params.set('tab', options.tab)
  if (options.step !== null && options.step !== undefined) params.set('step', String(options.step))
  return `#workspace/organization/${encodeURIComponent(organizationId)}?${params.toString()}`
}

export function tournamentHash(tournamentId: string, tab: OrganizerTab | null = null, step: number | null = null): string {
  const params = new URLSearchParams()
  if (tab) params.set('tab', tab)
  if (step !== null) params.set('step', String(step))
  const query = params.toString()
  return `#workspace/tournament/${encodeURIComponent(tournamentId)}${query ? `?${query}` : ''}`
}

// The base deep link for one tournament's cockpit, used by the next-action and
// attention helpers.
export function tournamentBaseHash(organizationId: string, tournamentId: string): string {
  return organizerHash(organizationId, { section: 'tournaments', tournamentId })
}

// ---------------------------------------------------------------------------
// Setup progress. Wizard stages are 1..9; stored rows live under the legacy
// keys [1..8, 11], so a row step_number 11 is displayed as wizard stage 9, and
// rows under retired keys 9/10 are ignored (they belong to the standalone
// Officials & Operations and Finance modules, not this wizard).
// ---------------------------------------------------------------------------

export type SetupStepRecord = {
  step_number: number
  status: 'not_started' | 'in_progress' | 'complete' | 'blocked' | 'deferred' | 'needs_review'
  data: Record<string, unknown>
  updated_at: string | null
}

export type SetupProgress = {
  statuses: SetupStepRecord['status'][]
  complete: number
  total: number
  percent: number
  currentStep: number
}

export function setupStatuses(steps: SetupStepRecord[]): SetupStepRecord['status'][] {
  const statuses: SetupStepRecord['status'][] = new Array(SETUP_STEP_COUNT).fill('not_started')
  const byKey = new Map<number, SetupStepRecord['status']>(steps.map(step => [step.step_number, step.status]))
  for (let index = 0; index < SETUP_WIZARD_KEYS.length; index += 1) {
    statuses[index] = byKey.get(SETUP_WIZARD_KEYS[index]) ?? 'not_started'
  }
  return statuses
}

// The next stage that is not demonstrably finished - including stages saved as
// an explicit Set-later decision or as needing review - is where setup should
// resume. When everything is complete the launch stage (9) is still the
// useful destination. Refresh and sign-out both resume here, never at Stage 1.
export function setupProgress(steps: SetupStepRecord[]): SetupProgress {
  const statuses = setupStatuses(steps)
  const complete = statuses.filter(status => status === 'complete').length
  // An explicit Set-later decision does not become the resume target: the
  // organizer chose to defer it, so the wizard resumes at the next stage they
  // still genuinely need to decide. Everything else incomplete comes first.
  const firstIncomplete = statuses.findIndex(status => status !== 'complete' && status !== 'deferred')
  return {
    statuses,
    complete,
    total: SETUP_STEP_COUNT,
    percent: Math.round((complete / SETUP_STEP_COUNT) * 100),
    currentStep: firstIncomplete === -1 ? SETUP_STEP_COUNT : firstIncomplete + 1,
  }
}

export function setupStepLabel(stepNumber: number): string {
  if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > SETUP_STEP_COUNT) return 'Unknown stage'
  return `Stage ${stepNumber} of ${SETUP_STEP_COUNT}`
}

// ---------------------------------------------------------------------------
// Counts. The specification requires applications, rosters, payments, and
// matches to be counted separately, never as a single "tasks" number.
// ---------------------------------------------------------------------------

export type OrganizerCounts = {
  tournamentsTotal: number
  tournamentsDraft: number
  tournamentsPublished: number
  tournamentsInProgress: number
  applicationsPending: number
  rostersPending: number
  paymentsPending: number
  matchesUnresolved: number
  matchesAwaitingConfirmation: number
}

export type CountableEntry = { application_status: string; roster_status: string; payment_status: string }
export type CountableMatch = { status: string }

export function overviewCounts(
  tournaments: Array<Pick<OrganizerTournament, 'status' | 'is_published'>>,
  entries: CountableEntry[],
  matches: CountableMatch[],
): OrganizerCounts {
  return {
    tournamentsTotal: tournaments.length,
    tournamentsDraft: tournaments.filter(item => item.status === 'draft' || item.status === 'setup').length,
    tournamentsPublished: tournaments.filter(item => item.is_published).length,
    tournamentsInProgress: tournaments.filter(item => item.status === 'in_progress').length,
    applicationsPending: entries.filter(item => PENDING_APPLICATION_STATUSES.includes(item.application_status as ApplicationStatus)).length,
    rostersPending: entries.filter(item => PENDING_ROSTER_STATUSES.includes(item.roster_status as RosterStatus)).length,
    paymentsPending: entries.filter(item => PENDING_PAYMENT_STATUSES.includes(item.payment_status as PaymentStatus)).length,
    matchesUnresolved: matches.filter(item => UNRESOLVED_MATCH_STATUSES.includes(item.status as MatchStatus)).length,
    matchesAwaitingConfirmation: matches.filter(item => item.status === 'awaiting_confirmation').length,
  }
}

// ---------------------------------------------------------------------------
// Next action. A single prominent, honest instruction derived from real rows.
// Actions describe WHERE to go as a tab and optional step, and the hash is
// built from that, so a deep link can never be malformed by string-append.
// ---------------------------------------------------------------------------

export type OrganizerNextAction = {
  label: string
  hint: string
  tone: StatusTone
  tab: OrganizerTab
  step: number | null
}

export type NextActionContext = {
  status: TournamentStatus
  isPublished: boolean
  progress: SetupProgress
  counts: {
    applicationsPending: number
    entriesTotal: number
    approvedEntries: number
    matchesTotal: number
    matchesUnresolved: number
    matchesAwaitingConfirmation: number
  }
}

export function tournamentNextAction(ctx: NextActionContext): OrganizerNextAction | null {
  const { counts, progress } = ctx
  if (ctx.status === 'archived' || ctx.status === 'cancelled') return null

  if (ctx.status === 'completed') {
    return { label: 'Archive tournament', hint: 'Completion checks passed. Archiving keeps the public history.', tone: 'ok', tab: 'settings', step: null }
  }

  if (progress.complete < progress.total) {
    // A brand-new draft has nothing complete yet, which is the exact state the
    // workflow specification (Phase 2) names "Complete Basics". Once a stage is
    // saved the label becomes where the work actually resumes.
    const label = progress.complete === 0 && progress.currentStep === 1
      ? 'Complete Basics'
      : `Continue setup — ${setupStepLabel(progress.currentStep)}`
    return {
      label,
      hint: `${progress.complete} of ${progress.total} stages complete.`,
      tone: 'info',
      tab: 'setup',
      step: progress.currentStep,
    }
  }

  if (!ctx.isPublished) {
    return { label: 'Review and launch', hint: 'Setup is complete. Publish to open team applications.', tone: 'info', tab: 'setup', step: SETUP_STEP_COUNT }
  }

  if (counts.applicationsPending > 0) {
    return { label: `Review ${plural(counts.applicationsPending, 'application')}`, hint: 'Applications are waiting for a decision.', tone: 'warn', tab: 'applications', step: null }
  }

  if (counts.matchesTotal === 0) {
    return { label: 'Prepare draw and fixtures', hint: 'Generate or enter the fixture list for this tournament.', tone: 'info', tab: 'draw', step: null }
  }

  if (counts.matchesAwaitingConfirmation > 0) {
    return {
      label: `Confirm ${plural(counts.matchesAwaitingConfirmation, 'result')}`,
      hint: 'Only confirmed results update standings and histories.',
      tone: 'warn',
      tab: 'matches',
      step: null,
    }
  }

  if (counts.matchesUnresolved > 0) {
    return { label: `Operate ${plural(counts.matchesUnresolved, 'match')}`, hint: 'Record events and scores for the remaining matches.', tone: 'info', tab: 'matches', step: null }
  }

  if (ctx.status === 'registration_open' || ctx.status === 'registration_closed') {
    return { label: 'Complete tournament', hint: 'Every fixture is resolved and confirmed.', tone: 'ok', tab: 'settings', step: null }
  }

  return { label: 'Open registration', hint: 'Publish the tournament to start accepting teams.', tone: 'info', tab: 'settings', step: null }
}

// The hash for one tournament's tab, so every action and attention row links
// to a real, refresh-safe destination.
export function tournamentTabHash(organizationId: string, tournamentId: string, tab: OrganizerTab, step: number | null = null): string {
  return organizerHash(organizationId, { section: 'tournaments', tournamentId, tab, step })
}

// ---------------------------------------------------------------------------
// Attention list. Each row links straight to the work it describes, so the
// list is computed per tournament and every item carries a real deep link.
// ---------------------------------------------------------------------------

export type AttentionItem = {
  key: string
  label: string
  detail: string
  tone: StatusTone
  tournamentId: string
  tab: OrganizerTab
  step: number | null
}

export type TournamentAttentionCounts = {
  applicationsPending: number
  rostersPending: number
  paymentsPending: number
  matchesAwaitingConfirmation: number
  matchesUnresolved: number
}

export const EMPTY_TOURNAMENT_ATTENTION: TournamentAttentionCounts = {
  applicationsPending: 0,
  rostersPending: 0,
  paymentsPending: 0,
  matchesAwaitingConfirmation: 0,
  matchesUnresolved: 0,
}

// Outstanding work for one tournament, each row pointing at the exact tab that
// resolves it. A tournament with nothing pending contributes nothing.
export function tournamentAttentionItems(
  tournament: Pick<OrganizerTournament, 'id' | 'name' | 'status' | 'is_published'>,
  counts: TournamentAttentionCounts,
): AttentionItem[] {
  const items: AttentionItem[] = []
  if (tournament.status === 'archived' || tournament.status === 'cancelled') return items

  if (counts.applicationsPending > 0) {
    items.push({ key: `${tournament.id}-applications`, label: `${tournament.name}: ${plural(counts.applicationsPending, 'application')} to review`, detail: 'Approve, reject, or request changes on submitted applications.', tone: 'warn', tournamentId: tournament.id, tab: 'applications', step: null })
  }
  if (counts.rostersPending > 0) {
    items.push({ key: `${tournament.id}-rosters`, label: `${tournament.name}: ${plural(counts.rostersPending, 'roster')} to review`, detail: 'Submitted rosters are waiting for approval or locking.', tone: 'warn', tournamentId: tournament.id, tab: 'teams', step: null })
  }
  if (counts.paymentsPending > 0) {
    items.push({ key: `${tournament.id}-payments`, label: `${tournament.name}: ${plural(counts.paymentsPending, 'payment')} to verify`, detail: 'Entry fee proofs are waiting for finance verification.', tone: 'warn', tournamentId: tournament.id, tab: 'teams', step: null })
  }
  if (counts.matchesAwaitingConfirmation > 0) {
    items.push({ key: `${tournament.id}-results`, label: `${tournament.name}: ${plural(counts.matchesAwaitingConfirmation, 'result')} to confirm`, detail: 'Only a confirmed result updates standings and histories.', tone: 'warn', tournamentId: tournament.id, tab: 'matches', step: null })
  }
  if (counts.matchesUnresolved > 0) {
    items.push({ key: `${tournament.id}-matches`, label: `${tournament.name}: ${plural(counts.matchesUnresolved, 'match')} unresolved`, detail: 'Scheduled, live, postponed, or abandoned matches still need a resolution.', tone: 'info', tournamentId: tournament.id, tab: 'matches', step: null })
  }
  if (tournament.status === 'draft' || tournament.status === 'setup') {
    items.push({ key: `${tournament.id}-draft`, label: `${tournament.name} is still a draft`, detail: 'Setup is unfinished, so teams cannot apply yet.', tone: 'info', tournamentId: tournament.id, tab: 'setup', step: null })
  }
  return items
}

export type AttentionTournament = {
  tournament: Pick<OrganizerTournament, 'id' | 'name' | 'status' | 'is_published'>
  counts: TournamentAttentionCounts
}

export function attentionItems(tournaments: AttentionTournament[]): AttentionItem[] {
  return tournaments.flatMap(entry => tournamentAttentionItems(entry.tournament, entry.counts))
}

// ---------------------------------------------------------------------------
// Completion guard (specification 5.2): a tournament cannot be completed while
// required matches or results are missing, without an explicit resolution.
// ---------------------------------------------------------------------------

export function tournamentCompletionBlockers(matches: Array<Pick<TournamentMatch, 'status'>>): string[] {
  const unresolved = matches.filter(item => UNRESOLVED_MATCH_STATUSES.includes(item.status as MatchStatus))
  const blockers: string[] = []
  if (unresolved.length > 0) {
    blockers.push(`${plural(unresolved.length, 'match')} still unresolved (scheduled, live, awaiting confirmation, postponed, or abandoned).`)
  }
  if (matches.length === 0) {
    blockers.push('No fixtures have been created for this tournament yet.')
  }
  return blockers
}

// Approved entries are the draw pool; an empty pool means the draw cannot run.
export function drawEligibleTeamIds(entries: Array<Pick<TournamentEntry, 'team_id' | 'application_status'>>): string[] {
  return entries.filter(entry => entry.application_status === 'approved').map(entry => entry.team_id)
}

// ---------------------------------------------------------------------------
// Cockpit Overview - the tournament control centre.
//
// The Overview tab has to answer five questions at a glance (owner's Tournament
// Overview layout specification, 23 October 2026): what is the current status,
// what is complete, what needs attention, what is the next action, and which
// section owns each task. Everything below is pure so it can be unit-tested
// without a database, and every value is derived from rows the cockpit has
// already loaded - nothing here invents a figure.
//
// Three rules are encoded here rather than left to the UI:
//   1. Setup completion and tournament lifecycle progress are computed
//      separately and are never merged into one percentage (section 4).
//   2. Status always renders as text plus colour; the label helpers are the
//      only source of a status string (section 2).
//   3. A summary count may be `null`, which means "unavailable - the query did
//      not succeed". The UI must render that as Unavailable with a retry, never
//      as a zero (section 5, and acceptance point 5).
//
// Fields the specification asks for that do not exist on `tournaments` - cover
// image, logo, season, island/atoll, main venue, start and end dates - are
// deliberately absent from every type below. They are recorded as a schema gap
// in docs/FEATURE_GAP_AUDIT.md rather than shown as empty placeholders.
// ---------------------------------------------------------------------------

// Section 8: the lifecycle timeline. Informational only; state changes go
// through controlled buttons and confirmation dialogs elsewhere.
export const LIFECYCLE_STAGES = ['draft', 'setup', 'registration', 'applications', 'rosters', 'draw', 'fixtures', 'in_progress', 'completed', 'archived'] as const
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number]
export type LifecycleStageState = 'completed' | 'current' | 'upcoming' | 'blocked'
export type LifecycleView = { stage: LifecycleStage; label: string; state: LifecycleStageState }

const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
  draft: 'Draft',
  setup: 'Setup',
  registration: 'Registration',
  applications: 'Applications',
  rosters: 'Rosters',
  draw: 'Draw',
  fixtures: 'Fixtures',
  in_progress: 'In progress',
  completed: 'Completed',
  archived: 'Archived',
}

export type LifecycleInput = {
  status: TournamentStatus
  setupComplete: boolean
  entries: ReadonlyArray<Pick<TournamentEntry, 'application_status' | 'roster_status'>>
  matchCount: number
}

// A stage counts as completed only once the tournament has demonstrably moved
// past it, so nothing is marked done on intent. Applications complete when every
// entry is approved, rejected or withdrawn; the draw and fixture stages when
// fixtures actually exist. A cancelled tournament marks its current and all
// later stages blocked rather than leaving them looking merely upcoming.
export function tournamentLifecycle(input: LifecycleInput): LifecycleView[] {
  const { status, setupComplete, entries, matchCount } = input
  const approved = entries.filter(entry => entry.application_status === 'approved')
  // A completed or archived tournament has, by definition, moved past the
  // application and roster stages even when it ended with no entries at all.
  const terminal = status === 'completed' || status === 'archived'
  const past: Record<LifecycleStage, boolean> = {
    draft: status !== 'draft',
    setup: setupComplete,
    // Positive list, not a negated one: `cancelled` must not read as "registration
    // completed" when the tournament was cancelled during setup.
    registration: ['registration_closed', 'in_progress', 'completed', 'archived'].includes(status),
    applications: terminal || (entries.length > 0 && entries.every(entry => ['approved', 'rejected', 'withdrawn'].includes(entry.application_status))),
    rosters: terminal || (approved.length > 0 && approved.every(entry => entry.roster_status === 'locked')),
    draw: terminal || matchCount > 0,
    fixtures: terminal || matchCount > 0,
    in_progress: terminal,
    completed: terminal,
    archived: status === 'archived',
  }
  const cancelled = status === 'cancelled'
  const views: LifecycleView[] = []
  let currentAssigned = false
  for (const stage of LIFECYCLE_STAGES) {
    let state: LifecycleStageState
    if (past[stage]) state = 'completed'
    else if (!currentAssigned) { currentAssigned = true; state = cancelled ? 'blocked' : 'current' }
    else state = cancelled ? 'blocked' : 'upcoming'
    views.push({ stage, label: LIFECYCLE_LABELS[stage], state })
  }
  return views
}

export function lifecycleProgress(stages: ReadonlyArray<Pick<LifecycleView, 'state'>>): { complete: number; total: number; percent: number } {
  const total = stages.length
  const complete = stages.filter(item => item.state === 'completed').length
  return { complete, total, percent: total === 0 ? 0 : Math.round((complete / total) * 100) }
}

// Section 3: exactly one main instruction. The ladder below is the priority
// order from the specification and is applied strictly top-down, so the page
// never presents competing primary actions.
export type NextAction = { tab: OrganizerTab; label: string; reason: string; step: number | null; tone: StatusTone }

export type NextActionInput = {
  status: TournamentStatus
  isPublished: boolean
  progress: { complete: number; total: number; currentStep: number }
  entries: ReadonlyArray<Pick<TournamentEntry, 'application_status' | 'roster_status' | 'payment_status'>>
  matches: ReadonlyArray<Pick<TournamentMatch, 'status' | 'venue' | 'scheduled_at'>>
  syncConflicts?: number
  registrationClosesAt?: string | null
  now?: number
}

export function cockpitNextAction(input: NextActionInput): NextAction {
  const { status, isPublished, progress, entries, matches } = input
  const now = input.now ?? Date.now()
  const syncConflicts = input.syncConflicts ?? 0
  const pendingApplications = entries.filter(entry => PENDING_APPLICATION_STATUSES.includes(entry.application_status as ApplicationStatus)).length
  const pendingRosters = entries.filter(entry => PENDING_ROSTER_STATUSES.includes(entry.roster_status as RosterStatus)).length
  const awaiting = matches.filter(match => match.status === 'awaiting_confirmation').length
  const live = matches.filter(match => match.status === 'live').length
  const disrupted = matches.filter(match => match.status === 'postponed' || match.status === 'abandoned').length
  const noVenue = matches.filter(match => !match.venue).length
  const unscheduled = matches.filter(match => !match.scheduled_at).length

  // 1. security or synchronization conflict
  if (syncConflicts > 0) {
    return { tab: 'matches', label: `Resolve ${plural(syncConflicts, 'offline conflict')}`, reason: 'Synchronization conflicts must be cleared before this tournament\'s match data can be trusted.', step: null, tone: 'danger' }
  }
  // 2. result awaiting confirmation
  if (awaiting > 0) {
    return { tab: 'matches', label: `Confirm ${plural(awaiting, 'result')}`, reason: 'Only a confirmed result updates standings and histories.', step: null, tone: 'warn' }
  }
  // 3. match operational issue
  if (live > 0) return { tab: 'matches', label: `Record the ${plural(live, 'live match')}`, reason: 'A live match still needs its events and final score.', step: null, tone: 'live' }
  if (disrupted > 0) return { tab: 'matches', label: `Resolve ${plural(disrupted, 'disrupted match')}`, reason: 'Postponed or abandoned matches need an explicit resolution.', step: null, tone: 'warn' }
  if (matches.length > 0 && noVenue > 0) return { tab: 'draw', label: `Assign a venue to ${plural(noVenue, 'fixture')}`, reason: 'Every fixture needs a venue before it can be published to teams.', step: null, tone: 'warn' }
  if (matches.length > 0 && unscheduled > 0) return { tab: 'draw', label: `Schedule ${plural(unscheduled, 'fixture')}`, reason: 'Unscheduled fixtures cannot be published to teams.', step: null, tone: 'warn' }
  // 4. deadline approaching (48 hours)
  const closesAt = input.registrationClosesAt ? Date.parse(input.registrationClosesAt) : Number.NaN
  if (status === 'registration_open' && !Number.isNaN(closesAt) && closesAt > now && closesAt - now <= 48 * 60 * 60 * 1000) {
    return { tab: 'applications', label: 'Registration closes soon', reason: `Registration closes ${new Date(closesAt).toISOString()}. Review applications before the window shuts.`, step: null, tone: 'warn' }
  }
  // 5. application or roster review
  if (pendingApplications > 0) return { tab: 'applications', label: `Review ${plural(pendingApplications, 'application')}`, reason: 'Applications must be reviewed before teams can be approved.', step: null, tone: 'info' }
  if (pendingRosters > 0) return { tab: 'teams', label: `Review ${plural(pendingRosters, 'roster')}`, reason: 'Rosters must be approved or locked before the draw can run.', step: null, tone: 'info' }
  // 6. incomplete setup. Same wording rule as the dashboard ladder: an
  // untouched draft reads "Complete Basics" (workflow Phase 2); after that the
  // label names the stage the organizer is resuming.
  if (progress.complete < progress.total) {
    const label = progress.complete === 0 && progress.currentStep === 1
      ? 'Complete Basics'
      : `Continue setup - stage ${progress.currentStep}`
    return { tab: 'setup', label, reason: `${progress.total - progress.complete} setup ${progress.total - progress.complete === 1 ? 'stage remains' : 'stages remain'} before this tournament can be published.`, step: progress.currentStep, tone: 'info' }
  }
  // 7. normal administrative task
  if (!isPublished) return { tab: 'setup', label: 'Review and launch', reason: 'Setup is complete. Publishing makes this tournament visible to teams.', step: progress.total, tone: 'ok' }
  if (matches.length === 0) return { tab: 'draw', label: 'Prepare the draw', reason: 'Approved teams need a draw before fixtures can be published.', step: null, tone: 'ok' }
  return { tab: 'settings', label: 'Review completion', reason: 'No urgent work is outstanding for this tournament.', step: null, tone: 'ok' }
}

// Section 6: three to five highest-priority items only, emitted in ladder
// order so the list never competes with the single next action above it.
export type CockpitAttentionItem = { key: string; priority: 'high' | 'normal'; label: string; detail: string; tab: OrganizerTab; step: number | null; tone: StatusTone }

export function cockpitAttentionItems(input: NextActionInput): CockpitAttentionItem[] {
  const { progress, entries, matches } = input
  const items: CockpitAttentionItem[] = []
  const push = (item: CockpitAttentionItem) => { if (items.length < 5) items.push(item) }

  const syncConflicts = input.syncConflicts ?? 0
  if (syncConflicts > 0) push({ key: 'sync', priority: 'high', label: `${plural(syncConflicts, 'offline conflict')} to resolve`, detail: 'Synchronization conflicts make match data unreliable until they are cleared.', tab: 'matches', step: null, tone: 'danger' })

  const awaiting = matches.filter(match => match.status === 'awaiting_confirmation')
  if (awaiting.length > 0) push({ key: 'awaiting', priority: 'high', label: `${plural(awaiting.length, 'result')} awaiting confirmation`, detail: 'Only a confirmed result updates standings and histories.', tab: 'matches', step: null, tone: 'warn' })

  const live = matches.filter(match => match.status === 'live')
  if (live.length > 0) push({ key: 'live', priority: 'high', label: `${plural(live.length, 'match')} in progress`, detail: 'Live matches need events and a final score recorded.', tab: 'matches', step: null, tone: 'live' })

  const disrupted = matches.filter(match => match.status === 'postponed' || match.status === 'abandoned')
  if (disrupted.length > 0) push({ key: 'disrupted', priority: 'normal', label: `${plural(disrupted.length, 'match')} postponed or abandoned`, detail: 'Each needs an explicit resolution.', tab: 'matches', step: null, tone: 'warn' })

  const noVenue = matches.filter(match => !match.venue)
  if (matches.length > 0 && noVenue.length > 0) push({ key: 'venue', priority: 'normal', label: `${plural(noVenue.length, 'fixture')} without a venue`, detail: 'Fixtures without a venue cannot be published.', tab: 'draw', step: null, tone: 'warn' })

  const pendingApplications = entries.filter(entry => PENDING_APPLICATION_STATUSES.includes(entry.application_status as ApplicationStatus))
  if (pendingApplications.length > 0) push({ key: 'applications', priority: 'normal', label: `${plural(pendingApplications.length, 'application')} waiting for review`, detail: 'Teams cannot be approved until each application is decided.', tab: 'applications', step: null, tone: 'info' })

  const pendingRosters = entries.filter(entry => PENDING_ROSTER_STATUSES.includes(entry.roster_status as RosterStatus))
  if (pendingRosters.length > 0) push({ key: 'rosters', priority: 'normal', label: `${plural(pendingRosters.length, 'roster')} awaiting review`, detail: 'Rosters must be approved or locked before the draw.', tab: 'teams', step: null, tone: 'info' })

  const pendingPayments = entries.filter(entry => PENDING_PAYMENT_STATUSES.includes(entry.payment_status as PaymentStatus))
  if (pendingPayments.length > 0) push({ key: 'payments', priority: 'normal', label: `${plural(pendingPayments.length, 'payment proof')} awaiting verification`, detail: 'An approved application does not mean payment is verified.', tab: 'finance', step: null, tone: 'info' })

  if (progress.complete < progress.total) push({ key: 'setup', priority: 'normal', label: `${progress.total - progress.complete} setup ${progress.total - progress.complete === 1 ? 'stage' : 'stages'} incomplete`, detail: `Next incomplete stage is ${progress.currentStep}.`, tab: 'setup', step: progress.currentStep, tone: 'info' })

  return items
}

// Section 7: readiness checklists. A failed item links to the exact section
// that needs correcting. Items with no data source in the current schema
// (eligibility records, awards review, disputes) are omitted rather than shown
// as a permanent failure; see the gap audit.
export type ReadinessItem = { key: string; label: string; done: boolean; tab: OrganizerTab; step: number | null }

// Wizard stages are 1..9 over keys [1..8, 11]; the retired keys 9/10 (Officials,
// Finance) are separate management modules and are deliberately not setup
// readiness items.
const SETUP_READINESS: ReadonlyArray<{ step: number; label: string }> = [
  { step: 1, label: 'Basics complete' },
  { step: 2, label: 'Categories configured' },
  { step: 3, label: 'Registration configured' },
  { step: 4, label: 'Registration form ready' },
  { step: 5, label: 'Roster requirements ready' },
  { step: 6, label: 'Competition format selected' },
  { step: 7, label: 'Rules ready' },
  { step: 8, label: 'Venues ready' },
  { step: 9, label: 'Review completed' },
]

export function setupReadinessItems(steps: ReadonlyArray<Pick<SetupStepRecord, 'step_number' | 'status'>>): ReadinessItem[] {
  return SETUP_READINESS.map(item => ({
    key: `setup-${item.step}`,
    label: item.label,
    done: (steps.find(step => step.step_number === SETUP_WIZARD_KEYS[item.step - 1])?.status ?? 'not_started') === 'complete',
    tab: 'setup',
    step: item.step,
  }))
}

// Officials are only knowable when the caller has loaded them. Passing null
// omits the item entirely instead of reporting a false failure.
export function competitionReadinessItems(
  entries: ReadonlyArray<Pick<TournamentEntry, 'application_status' | 'roster_status' | 'payment_status'>>,
  matches: ReadonlyArray<Pick<TournamentMatch, 'id' | 'venue' | 'scheduled_at'>>,
  officialsByMatch: ReadonlyMap<string, number> | null = null,
): ReadinessItem[] {
  const approved = entries.filter(entry => entry.application_status === 'approved')
  const items: ReadinessItem[] = [
    { key: 'comp-teams', label: 'Required teams approved', done: approved.length >= 2, tab: 'applications', step: null },
    { key: 'comp-rosters', label: 'Rosters approved', done: approved.length > 0 && approved.every(entry => ['approved', 'locked'].includes(entry.roster_status)), tab: 'teams', step: null },
    { key: 'comp-eligibility', label: 'Roster corrections resolved', done: entries.length > 0 && entries.every(entry => !['changes_requested', 'rejected'].includes(entry.roster_status)), tab: 'teams', step: null },
    { key: 'comp-payments', label: 'Payment requirements resolved', done: entries.length > 0 && entries.every(entry => ['not_required', 'paid', 'waived'].includes(entry.payment_status)), tab: 'finance', step: null },
    { key: 'comp-draw', label: 'Draw valid', done: matches.length > 0, tab: 'draw', step: null },
    { key: 'comp-fixtures', label: 'Fixtures scheduled', done: matches.length > 0 && matches.every(match => Boolean(match.venue) && Boolean(match.scheduled_at)), tab: 'draw', step: null },
  ]
  if (officialsByMatch) {
    items.push({ key: 'comp-officials', label: 'Officials assigned', done: matches.length > 0 && matches.every(match => (officialsByMatch.get(match.id) ?? 0) > 0), tab: 'staff', step: null })
  }
  return items
}

export function completionReadinessItems(
  matches: ReadonlyArray<Pick<TournamentMatch, 'status'>>,
  syncConflicts = 0,
): ReadinessItem[] {
  const unresolved = matches.filter(match => UNRESOLVED_MATCH_STATUSES.includes(match.status as MatchStatus))
  const awaiting = matches.filter(match => match.status === 'awaiting_confirmation')
  const confirmed = matches.filter(match => match.status === 'confirmed')
  return [
    { key: 'done-fixtures', label: 'All required fixtures resolved', done: matches.length > 0 && unresolved.length === 0, tab: 'matches', step: null },
    { key: 'done-results', label: 'No result awaiting confirmation', done: awaiting.length === 0, tab: 'matches', step: null },
    { key: 'done-sync', label: 'No offline conflicts', done: syncConflicts === 0, tab: 'matches', step: null },
    { key: 'done-standings', label: 'Final standings calculated', done: confirmed.length > 0, tab: 'standings', step: null },
  ]
}

// Section 5: the operational summary cards. Fixtures and matches are two
// different lenses over the single `matches` table - there is no separate
// fixtures table in this schema - so one counts scheduling completeness and the
// other competition state. Payments are reported as status counts only; the
// outstanding MVR amount is deliberately not derived here because it requires
// the finance-restricted `tournament_payments` rows.
export type OperationalSummary = {
  applications: { total: number; submitted: number; underReview: number; changesRequested: number; approved: number; rejected: number; pending: number }
  teams: { approvedEntries: number; eligible: number }
  rosters: { notSubmitted: number; submitted: number; changesRequested: number; approved: number; locked: number }
  payments: { required: number; pendingVerification: number; verified: number; waived: number; refunded: number; unpaid: number }
  fixtures: { total: number; withVenue: number; missingVenue: number; unscheduled: number; upcoming: number }
  matches: { scheduled: number; live: number; awaitingConfirmation: number; confirmed: number; postponed: number; abandoned: number; cancelled: number }
}

export function operationalSummary(
  entries: ReadonlyArray<Pick<TournamentEntry, 'application_status' | 'roster_status' | 'payment_status'>>,
  matches: ReadonlyArray<Pick<TournamentMatch, 'status' | 'venue' | 'scheduled_at'>>,
  now = Date.now(),
): OperationalSummary {
  const count = (predicate: (value: string) => boolean, values: ReadonlyArray<string>) => values.filter(predicate).length
  const appStatuses = entries.map(entry => entry.application_status as string)
  const rosterStatuses = entries.map(entry => entry.roster_status as string)
  const paymentStatuses = entries.map(entry => entry.payment_status as string)
  const matchStatuses = matches.map(match => match.status as string)

  const approved = count(value => value === 'approved', appStatuses)
  const withVenue = matches.filter(match => Boolean(match.venue)).length
  const scheduledDates = matches.filter(match => Boolean(match.scheduled_at)).map(match => Date.parse(match.scheduled_at as string)).filter(value => !Number.isNaN(value))

  return {
    applications: {
      total: entries.length,
      submitted: count(value => value === 'submitted', appStatuses),
      underReview: count(value => value === 'under_review', appStatuses),
      changesRequested: count(value => value === 'changes_requested', appStatuses),
      approved,
      rejected: count(value => value === 'rejected', appStatuses),
      pending: entries.filter(entry => PENDING_APPLICATION_STATUSES.includes(entry.application_status as ApplicationStatus)).length,
    },
    teams: { approvedEntries: approved, eligible: drawEligibleTeamIds(entries as Array<Pick<TournamentEntry, 'team_id' | 'application_status'>>).length },
    rosters: {
      notSubmitted: count(value => value === 'not_started' || value === 'draft', rosterStatuses),
      submitted: entries.filter(entry => PENDING_ROSTER_STATUSES.includes(entry.roster_status as RosterStatus)).length,
      changesRequested: count(value => value === 'changes_requested', rosterStatuses),
      approved: count(value => value === 'approved', rosterStatuses),
      locked: count(value => value === 'locked', rosterStatuses),
    },
    payments: {
      required: entries.filter(entry => entry.payment_status !== 'not_required').length,
      pendingVerification: entries.filter(entry => PENDING_PAYMENT_STATUSES.includes(entry.payment_status as PaymentStatus)).length,
      verified: count(value => value === 'paid', paymentStatuses),
      waived: count(value => value === 'waived', paymentStatuses),
      refunded: count(value => value === 'refunded', paymentStatuses),
      unpaid: count(value => value === 'unpaid' || value === 'overdue', paymentStatuses),
    },
    fixtures: {
      total: matches.length,
      withVenue,
      missingVenue: matches.length - withVenue,
      unscheduled: matches.filter(match => !match.scheduled_at).length,
      upcoming: scheduledDates.filter(value => value > now).length,
    },
    matches: {
      scheduled: count(value => value === 'scheduled', matchStatuses),
      live: count(value => value === 'live', matchStatuses),
      awaitingConfirmation: count(value => value === 'awaiting_confirmation', matchStatuses),
      confirmed: count(value => value === 'confirmed', matchStatuses),
      postponed: count(value => value === 'postponed', matchStatuses),
      abandoned: count(value => value === 'abandoned', matchStatuses),
      cancelled: count(value => value === 'cancelled', matchStatuses),
    },
  }
}

// Section 12: the next few fixtures only, each carrying the warnings that make
// it actionable. Full fixture lists stay in the Draw and Matches tabs.
export type UpcomingMatchView = {
  id: string
  home: string
  away: string
  scheduledAt: string | null
  venue: string | null
  status: MatchStatus
  warnings: string[]
}

export function upcomingMatchesList(
  matches: ReadonlyArray<Pick<TournamentMatch, 'id' | 'status' | 'venue' | 'scheduled_at' | 'home_team_id' | 'away_team_id' | 'home_team_name' | 'away_team_name'>>,
  entries: ReadonlyArray<Pick<TournamentEntry, 'team_id' | 'roster_status'>> = [],
  limit = 5,
  now = Date.now(),
): UpcomingMatchView[] {
  const unlocked = new Set(entries.filter(entry => entry.roster_status !== 'locked').map(entry => entry.team_id))
  const decorated = matches
    .filter(match => match.status !== 'cancelled' && match.status !== 'abandoned')
    .map(match => {
      const parsed = match.scheduled_at ? Date.parse(match.scheduled_at) : Number.NaN
      const warnings: string[] = []
      if (!match.venue) warnings.push('No venue')
      if (!match.scheduled_at) warnings.push('No date or time')
      if (unlocked.has(match.home_team_id) || unlocked.has(match.away_team_id)) warnings.push('Roster not locked')
      // Upcoming fixtures first, then unscheduled ones; anything already
      // started or finished sorts behind both.
      const started = !Number.isNaN(parsed) && parsed <= now
      return {
        match: { id: match.id, home: match.home_team_name ?? 'Published team', away: match.away_team_name ?? 'Published team', scheduledAt: match.scheduled_at, venue: match.venue, status: match.status, warnings },
        sortKey: Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed,
        started,
      }
    })
  decorated.sort((a, b) => Number(a.started) - Number(b.started) || a.sortKey - b.sortKey)
  return decorated.slice(0, limit).map(item => item.match)
}

// Section 14: standings preview. Rows are produced by the existing, tested
// `calculateStandings`, which already discards unconfirmed results, so the
// preview can only ever reflect confirmed outcomes.
export type StandingsPreviewRow = { teamId: string; played: number; goalDifference: number; points: number }

export function standingsPreview(
  teamIds: ReadonlyArray<string>,
  results: ReadonlyArray<{ homeTeamId: string; awayTeamId: string; homeScore: number; awayScore: number; confirmed: boolean }>,
  limit = 5,
): StandingsPreviewRow[] {
  if (teamIds.length === 0) return []
  return calculateStandings([...teamIds], [...results])
    .map(row => ({ teamId: row.teamId, played: row.played, goalDifference: row.scored - row.conceded, points: row.points }))
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Row shapes returned to the UI. Only organizer-usable public-ish fields are
// selected; nothing here touches national ID, private contact, or documents.
// ---------------------------------------------------------------------------

export type OrganizerTournament = {
  id: string
  organization_id: string
  name: string
  slug: string
  sport: string
  status: TournamentStatus
  setup_stage: number
  is_published: boolean
  logo_path: string | null
  cover_path: string | null
  created_at: string
  updated_at: string
}

export type TournamentEntry = {
  id: string
  team_id: string
  application_status: ApplicationStatus
  roster_status: RosterStatus
  payment_status: PaymentStatus
  review_notes: string | null
  reviewed_at: string | null
  submitted_at: string | null
  team_name: string | null
  team_slug: string | null
  latest_roster_status: RosterStatus | null
  latest_roster_version: number | null
}

export type TournamentMatch = {
  id: string
  status: MatchStatus
  scheduled_at: string | null
  venue: string | null
  leg: number | null
  home_team_id: string
  away_team_id: string
  home_team_name: string | null
  away_team_name: string | null
}

const ORGANIZER_TOURNAMENT_FIELDS = 'id,organization_id,name,slug,sport,status,setup_stage,is_published,created_at,updated_at'
// Branding columns exist only after review-only migration 023. The cockpit asks
// for them and falls back to the base columns when the database does not have
// them yet, so an unapplied migration never breaks the tournament workspace.
const TOURNAMENT_BRANDING_FIELDS = 'logo_path,cover_path'

function isMissingColumnError(message: string): boolean {
  return /does not exist|42703|PGRST204|schema cache/i.test(message)
}

export async function loadOrganizerTournament(client: SupabaseClient, tournamentId: string): Promise<RecordResult<OrganizerTournament | null>> {
  const withBranding = await client.from('tournaments').select(`${ORGANIZER_TOURNAMENT_FIELDS},${TOURNAMENT_BRANDING_FIELDS}`).eq('id', tournamentId).maybeSingle()
  if (!withBranding.error) return { data: (withBranding.data as OrganizerTournament | null) ?? null, error: null }
  if (!isMissingColumnError(withBranding.error.message)) return { data: null, error: withBranding.error.message }
  const base = await client.from('tournaments').select(ORGANIZER_TOURNAMENT_FIELDS).eq('id', tournamentId).maybeSingle()
  if (base.error) return { data: null, error: base.error.message }
  return { data: base.data ? { ...(base.data as OrganizerTournament), logo_path: null, cover_path: null } : null, error: null }
}

// ---------------------------------------------------------------------------
// Loaders. Each one filters by the specific organization or tournament so the
// request itself is scoped, on top of the RLS policies.
// ---------------------------------------------------------------------------

export async function loadOrganizationTournaments(client: SupabaseClient, organizationId: string): Promise<RecordResult<OrganizerTournament[]>> {
  const withBranding = await client
    .from('tournaments')
    .select(`${ORGANIZER_TOURNAMENT_FIELDS},${TOURNAMENT_BRANDING_FIELDS}`)
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
  if (!withBranding.error) return { data: (withBranding.data ?? []) as OrganizerTournament[], error: null }
  if (!isMissingColumnError(withBranding.error.message)) return { data: null, error: withBranding.error.message }
  const result = await client
    .from('tournaments')
    .select(ORGANIZER_TOURNAMENT_FIELDS)
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
  if (result.error) return { data: null, error: result.error.message }
  return { data: ((result.data ?? []) as OrganizerTournament[]).map(row => ({ ...row, logo_path: null, cover_path: null })), error: null }
}

export async function loadTournamentSetupSteps(client: SupabaseClient, tournamentId: string): Promise<RecordResult<SetupStepRecord[]>> {
  const result = await client
    .from('tournament_setup_steps')
    .select('step_number,status,data,updated_at')
    .eq('tournament_id', tournamentId)
    .order('step_number', { ascending: true })
  if (result.error) return { data: null, error: result.error.message }
  return { data: (result.data ?? []) as SetupStepRecord[], error: null }
}

// Confirmed scores for the standings preview. Only the highest confirmed
// version of each match is returned, and the jsonb score is parsed defensively:
// a payload that is not the `{ home, away }` shape the app writes is skipped
// rather than guessed at, so an unreadable score can never become a fabricated
// number in the standings.
export type ConfirmedScore = { matchId: string; homeScore: number; awayScore: number }

export async function loadConfirmedResultScores(client: SupabaseClient, matchIds: string[]): Promise<RecordResult<Map<string, ConfirmedScore>>> {
  const scores = new Map<string, ConfirmedScore>()
  if (matchIds.length === 0) return { data: scores, error: null }
  const result = await client
    .from('match_result_versions')
    .select('match_id,version,score,status')
    .in('match_id', matchIds)
    .eq('status', 'confirmed')
    .order('version', { ascending: false })
  if (result.error) return { data: null, error: result.error.message }
  for (const row of (result.data ?? []) as Array<Record<string, unknown>>) {
    const matchId = String(row.match_id)
    if (scores.has(matchId)) continue // version is ordered descending, so the first is the latest
    // Re-checked here rather than trusting the query filter: standings may only
    // ever be built from confirmed results (acceptance point 11).
    if (row.status !== 'confirmed') continue
    const score = row.score as { home?: unknown; away?: unknown } | null
    const home = typeof score?.home === 'number' ? score.home : null
    const away = typeof score?.away === 'number' ? score.away : null
    if (home === null || away === null) continue
    scores.set(matchId, { matchId, homeScore: home, awayScore: away })
  }
  return { data: scores, error: null }
}

export async function loadTournamentEntries(client: SupabaseClient, tournamentId: string): Promise<RecordResult<TournamentEntry[]>> {
  const result = await client
    .from('tournament_entries')
    .select('id,team_id,application_status,roster_status,payment_status,review_notes,reviewed_at,submitted_at,teams(name,slug),roster_submissions(status,version)')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: true })
  if (result.error) return { data: null, error: result.error.message }

  const rows = (result.data ?? []) as Array<Record<string, unknown>>
  const entries: TournamentEntry[] = rows.map(row => {
    const team = Array.isArray(row.teams) ? (row.teams[0] as { name?: string; slug?: string } | undefined) : (row.teams as { name?: string; slug?: string } | undefined)
    const submissions = Array.isArray(row.roster_submissions) ? (row.roster_submissions as Array<{ status?: string; version?: number }>) : []
    const latest = submissions.reduce<{ status: RosterStatus | null; version: number | null }>((current, submission) => {
      const version = typeof submission.version === 'number' ? submission.version : 0
      if (current.version !== null && current.version >= version) return current
      return { status: (submission.status as RosterStatus) ?? null, version }
    }, { status: null, version: null })

    return {
      id: String(row.id),
      team_id: String(row.team_id),
      application_status: (row.application_status as ApplicationStatus) ?? 'draft',
      roster_status: (row.roster_status as RosterStatus) ?? 'not_started',
      payment_status: (row.payment_status as PaymentStatus) ?? 'not_required',
      review_notes: row.review_notes === null || row.review_notes === undefined ? null : String(row.review_notes),
      reviewed_at: row.reviewed_at === null || row.reviewed_at === undefined ? null : String(row.reviewed_at),
      submitted_at: row.submitted_at === null || row.submitted_at === undefined ? null : String(row.submitted_at),
      team_name: team?.name ?? null,
      team_slug: team?.slug ?? null,
      latest_roster_status: latest.status,
      latest_roster_version: latest.version,
    }
  })
  return { data: entries, error: null }
}

// Matches are read without an embedded join so the query stays portable across
// foreign-key constraint names; team names are resolved in a second read.
export async function loadTournamentMatches(client: SupabaseClient, tournamentId: string): Promise<RecordResult<TournamentMatch[]>> {
  const result = await client
    .from('matches')
    .select('id,status,scheduled_at,venue,leg,home_team_id,away_team_id')
    .eq('tournament_id', tournamentId)
    .order('scheduled_at', { ascending: true })
  if (result.error) return { data: null, error: result.error.message }

  const rows = (result.data ?? []) as Array<Record<string, unknown>>
  const teamIds = Array.from(new Set(rows.flatMap(row => [String(row.home_team_id), String(row.away_team_id)]))).filter(Boolean)
  const names = new Map<string, string>()
  if (teamIds.length > 0) {
    const teams = await client.from('teams').select('id,name').in('id', teamIds)
    if (!teams.error) {
      for (const row of (teams.data ?? []) as Array<{ id: unknown; name: unknown }>) names.set(String(row.id), String(row.name))
    }
  }

  const matches: TournamentMatch[] = rows.map(row => {
    const homeId = String(row.home_team_id)
    const awayId = String(row.away_team_id)
    return {
      id: String(row.id),
      status: (row.status as MatchStatus) ?? 'scheduled',
      scheduled_at: row.scheduled_at === null || row.scheduled_at === undefined ? null : String(row.scheduled_at),
      venue: row.venue === null || row.venue === undefined ? null : String(row.venue),
      leg: typeof row.leg === 'number' ? row.leg : null,
      home_team_id: homeId,
      away_team_id: awayId,
      home_team_name: names.get(homeId) ?? null,
      away_team_name: names.get(awayId) ?? null,
    }
  })
  return { data: matches, error: null }
}

export type CockpitData = {
  tournament: OrganizerTournament | null
  steps: SetupStepRecord[]
  entries: TournamentEntry[]
  matches: TournamentMatch[]
}

// ---------------------------------------------------------------------------
// Dashboard counts. The overview needs per-tournament workflow numbers across
// every tournament in the organization, so this reads the two relevant tables
// once with an `in` filter instead of issuing a query per tournament.
// ---------------------------------------------------------------------------

export type TournamentWorkflowCounts = {
  tournamentId: string
  entriesTotal: number
  approvedEntries: number
  applicationsPending: number
  rostersPending: number
  paymentsPending: number
  matchesTotal: number
  matchesUnresolved: number
  matchesAwaitingConfirmation: number
}

export function emptyWorkflowCounts(tournamentId: string): TournamentWorkflowCounts {
  return { tournamentId, entriesTotal: 0, approvedEntries: 0, applicationsPending: 0, rostersPending: 0, paymentsPending: 0, matchesTotal: 0, matchesUnresolved: 0, matchesAwaitingConfirmation: 0 }
}

export async function loadOrganizationWorkflowCounts(client: SupabaseClient, tournaments: Array<Pick<OrganizerTournament, 'id' | 'status' | 'is_published'>>): Promise<RecordResult<Map<string, TournamentWorkflowCounts>>> {
  const counts = new Map<string, TournamentWorkflowCounts>()
  for (const tournament of tournaments) counts.set(tournament.id, emptyWorkflowCounts(tournament.id))
  const ids = tournaments.map(tournament => tournament.id)
  if (ids.length === 0) return { data: counts, error: null }

  const [entries, matches] = await Promise.all([
    client.from('tournament_entries').select('id,tournament_id,application_status,roster_status,payment_status').in('tournament_id', ids),
    client.from('matches').select('id,tournament_id,status').in('tournament_id', ids),
  ])
  if (entries.error) return { data: null, error: entries.error.message }
  if (matches.error) return { data: null, error: matches.error.message }

  for (const row of (entries.data ?? []) as Array<Record<string, unknown>>) {
    const bucket = counts.get(String(row.tournament_id))
    if (!bucket) continue
    bucket.entriesTotal += 1
    if (row.application_status === 'approved') bucket.approvedEntries += 1
    if (PENDING_APPLICATION_STATUSES.includes(row.application_status as ApplicationStatus)) bucket.applicationsPending += 1
    if (PENDING_ROSTER_STATUSES.includes(row.roster_status as RosterStatus)) bucket.rostersPending += 1
    if (PENDING_PAYMENT_STATUSES.includes(row.payment_status as PaymentStatus)) bucket.paymentsPending += 1
  }
  for (const row of (matches.data ?? []) as Array<Record<string, unknown>>) {
    const bucket = counts.get(String(row.tournament_id))
    if (!bucket) continue
    bucket.matchesTotal += 1
    if (row.status === 'awaiting_confirmation') bucket.matchesAwaitingConfirmation += 1
    if (UNRESOLVED_MATCH_STATUSES.includes(row.status as MatchStatus)) bucket.matchesUnresolved += 1
  }
  return { data: counts, error: null }
}

// The single most pressing action across every tournament, used for the
// dashboard's prominent Next Action block.
export function primaryNextAction(
  tournaments: Array<Pick<OrganizerTournament, 'id' | 'status' | 'is_published'>>,
  progressById: Map<string, SetupProgress>,
  countsById: Map<string, TournamentWorkflowCounts>,
): (OrganizerNextAction & { tournamentId: string }) | null {
  const priority: StatusTone[] = ['warn', 'live', 'info', 'ok']
  const candidates: Array<OrganizerNextAction & { tournamentId: string }> = []
  for (const tournament of tournaments) {
    const progress = progressById.get(tournament.id) ?? setupProgress([])
    const counts = countsById.get(tournament.id) ?? emptyWorkflowCounts(tournament.id)
    const action = tournamentNextAction({
      status: tournament.status as TournamentStatus,
      isPublished: tournament.is_published,
      progress,
      counts: { applicationsPending: counts.applicationsPending, entriesTotal: counts.entriesTotal, approvedEntries: counts.approvedEntries, matchesTotal: counts.matchesTotal, matchesUnresolved: counts.matchesUnresolved, matchesAwaitingConfirmation: counts.matchesAwaitingConfirmation },
    })
    if (action) candidates.push({ ...action, tournamentId: tournament.id })
  }
  if (candidates.length === 0) return null
  return candidates.sort((a, b) => priority.indexOf(a.tone) - priority.indexOf(b.tone))[0]
}

// One call for everything a tournament cockpit renders. All four reads are
// independent, so they run concurrently and the first error is surfaced.
export async function loadTournamentCockpit(client: SupabaseClient, tournamentId: string): Promise<RecordResult<CockpitData>> {
  const [tournament, steps, entries, matches] = await Promise.all([
    loadOrganizerTournament(client, tournamentId),
    loadTournamentSetupSteps(client, tournamentId),
    loadTournamentEntries(client, tournamentId),
    loadTournamentMatches(client, tournamentId),
  ])
  if (tournament.error) return { data: null, error: tournament.error }
  if (steps.error) return { data: null, error: steps.error }
  if (entries.error) return { data: null, error: entries.error }
  if (matches.error) return { data: null, error: matches.error }
  return {
    data: {
      tournament: tournament.data ?? null,
      steps: steps.data ?? [],
      entries: entries.data ?? [],
      matches: matches.data ?? [],
    },
    error: null,
  }
}

// ---------------------------------------------------------------------------
// Duplicate prevention (specification 6.1 and 6.2): search before creating.
// The RLS policies decide which teams and players are findable, so this only
// ever surfaces records the caller is already allowed to read.
// ---------------------------------------------------------------------------

export type SearchableTeam = { id: string; name: string; slug: string; island: string | null; is_published: boolean }
export type SearchablePlayer = { id: string; display_name: string; slug: string; island: string | null; is_claimed: boolean; is_published: boolean; created_by?: string; account_id?: string | null }

// PostgREST treats `,`, `(`, `)` and `.` as filter syntax, so a free-text
// query is stripped of them before it is embedded in an ilike pattern.
export function sanitizeSearchTerm(query: string): string {
  return query.replace(/[%_,().\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

export async function searchExistingTeams(client: SupabaseClient, query: string, limit = 8): Promise<RecordResult<SearchableTeam[]>> {
  const term = sanitizeSearchTerm(query)
  if (term.length < 2) return { data: [], error: null }
  const result = await client
    .from('teams')
    .select('id,name,slug,island,is_published')
    .or(`name.ilike.%${term}%,slug.ilike.%${term}%`)
    .is('deactivated_at', null)
    .order('name', { ascending: true })
    .limit(limit)
  if (result.error) return { data: null, error: result.error.message }
  return { data: (result.data ?? []) as SearchableTeam[], error: null }
}

export async function searchExistingPlayers(client: SupabaseClient, query: string, limit = 8): Promise<RecordResult<SearchablePlayer[]>> {
  const term = sanitizeSearchTerm(query)
  if (term.length < 2) return { data: [], error: null }
  const result = await client
    .from('player_profiles')
    .select('id,display_name,slug,island,is_claimed,is_published,created_by,account_id')
    .or(`display_name.ilike.%${term}%,slug.ilike.%${term}%`)
    .is('deactivated_at', null)
    .order('display_name', { ascending: true })
    .limit(limit)
  if (result.error) return { data: null, error: result.error.message }
  return { data: (result.data ?? []) as SearchablePlayer[], error: null }
}

// Teams already linked to this organization, so the link action can be hidden
// for records that are already connected.
export type LinkedTeam = { team_id: string; name: string | null; slug: string | null }
export async function loadOrganizationTeamLinks(client: SupabaseClient, organizationId: string): Promise<RecordResult<LinkedTeam[]>> {
  const result = await client
    .from('organization_team_links')
    .select('team_id,teams(name,slug)')
    .eq('organization_id', organizationId)
  if (result.error) return { data: null, error: result.error.message }
  const rows = (result.data ?? []) as Array<Record<string, unknown>>
  return {
    data: rows.map(row => {
      const team = Array.isArray(row.teams) ? (row.teams[0] as { name?: string; slug?: string } | undefined) : (row.teams as { name?: string; slug?: string } | undefined)
      return { team_id: String(row.team_id), name: team?.name ?? null, slug: team?.slug ?? null }
    }),
    error: null,
  }
}

// ---------------------------------------------------------------------------
// Actions. All of them rely on the existing tables and policies; no schema
// change is required for any workflow below.
// ---------------------------------------------------------------------------

// Organization owner or operations role may link a team they can read. The
// "organization operators create team links" policy enforces the same rule
// server-side, so a denied call simply returns the database error.
export async function linkTeamToOrganization(client: SupabaseClient, organizationId: string, teamId: string, userId: string): Promise<{ error: string | null }> {
  const result = await client
    .from('organization_team_links')
    .insert({ organization_id: organizationId, team_id: teamId, linked_by: userId })
  return { error: result.error?.message ?? null }
}

// Organizer-entered team (specification 5.3). Entering a team directly records
// it as approved, because the organizer made the decision themselves.
export async function addOrganizerEntry(client: SupabaseClient, tournamentId: string, teamId: string, userId: string): Promise<RecordResult<{ id: string }>> {
  const now = new Date().toISOString()
  const result = await client
    .from('tournament_entries')
    .insert({ tournament_id: tournamentId, team_id: teamId, application_status: 'approved', submitted_at: now, reviewed_by: userId, reviewed_at: now, review_notes: 'Added directly by the organizer.' })
    .select('id')
    .single()
  // Entering a tournament makes the team part of the public competition.
  if (typeof client.rpc === 'function') await client.rpc('publish_team', { p_team_id: teamId })
  return { data: result.data, error: result.error?.message ?? null }
}

// Publishing makes the tournament visible and, when requested, opens team
// applications. Both fields are enforced by the tournament update policy.
export async function publishTournament(client: SupabaseClient, tournamentId: string, openRegistration: boolean): Promise<{ error: string | null }> {
  const patch: Record<string, unknown> = { is_published: true, updated_at: new Date().toISOString() }
  if (openRegistration) patch.status = 'registration_open'
  const result = await client.from('tournaments').update(patch).eq('id', tournamentId)
  return { error: result.error?.message ?? null }
}

// Stage 1 (Basics) writes back to the tournament row itself so the public
// pages read the corrected name and sport, then records the stage as complete.
export async function updateTournamentBasics(client: SupabaseClient, tournamentId: string, name: string, sport: Sport, branding?: { logoPath?: string | null; coverPath?: string | null }): Promise<{ error: string | null }> {
  const patch: Record<string, unknown> = { name: name.trim(), sport, updated_at: new Date().toISOString() }
  if (branding) {
    if (branding.logoPath !== undefined) patch.logo_path = branding.logoPath
    if (branding.coverPath !== undefined) patch.cover_path = branding.coverPath
  }
  const result = await client.from('tournaments').update(patch).eq('id', tournamentId)
  // Migration 036 locks the sport once fixtures exist, because it decides scoring and standings.
  if (result.error && /sport_locked_after_fixtures/.test(result.error.message)) return { error: 'The sport cannot change after fixtures have been created, because it decides scoring and standings.' }
  return { error: result.error?.message ?? null }
}

// Branding-only write: stores storage object paths (never URLs) without
// touching name or sport, so a partial Save & Exit cannot overwrite them.
export async function updateTournamentBranding(client: SupabaseClient, tournamentId: string, branding: { logoPath?: string | null; coverPath?: string | null }): Promise<{ error: string | null }> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (branding.logoPath !== undefined) patch.logo_path = branding.logoPath
  if (branding.coverPath !== undefined) patch.cover_path = branding.coverPath
  const result = await client.from('tournaments').update(patch).eq('id', tournamentId)
  return { error: result.error?.message ?? null }
}

export async function setTournamentStatus(client: SupabaseClient, tournamentId: string, status: TournamentStatus): Promise<{ error: string | null }> {
  const result = await client.from('tournaments').update({ status, updated_at: new Date().toISOString() }).eq('id', tournamentId)
  return { error: result.error?.message ?? null }
}

// Stage 2 (Categories) works against the real table, so a category a team
// registers into is a genuine row the rest of the engine reads.
export type TournamentCategory = { id: string; name: string; age_group: string | null; gender: string | null; team_limit: number | null }
export async function loadTournamentCategories(client: SupabaseClient, tournamentId: string): Promise<RecordResult<TournamentCategory[]>> {
  const result = await client
    .from('tournament_categories')
    .select('id,name,age_group,gender,team_limit')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: true })
  if (result.error) return { data: null, error: result.error.message }
  return { data: (result.data ?? []) as TournamentCategory[], error: null }
}

export async function addTournamentCategory(client: SupabaseClient, tournamentId: string, name: string): Promise<{ error: string | null }> {
  const result = await client.from('tournament_categories').insert({ tournament_id: tournamentId, name: name.trim() })
  return { error: result.error?.message ?? null }
}

// Roster review. Locking is the terminal state and is offered separately so an
// organizer never locks a roster by accident.
export type RosterDecision = 'approved' | 'rejected' | 'changes_requested' | 'locked'
export async function reviewRosterSubmission(client: SupabaseClient, submissionId: string, decision: RosterDecision, notes: string, userId: string): Promise<{ error: string | null }> {
  const result = await client
    .from('roster_submissions')
    .update({ status: decision, review_notes: notes.trim(), reviewed_by: userId })
    .eq('id', submissionId)
  return { error: result.error?.message ?? null }
}

// Keeps the entry's roster status in step with the submission decision. The
// entry status trigger only guards non-operators, so an operator write here is
// permitted by the "operators review entries" policy.
export async function setEntryRosterStatus(client: SupabaseClient, entryId: string, rosterStatus: RosterStatus): Promise<{ error: string | null }> {
  const result = await client.from('tournament_entries').update({ roster_status: rosterStatus, updated_at: new Date().toISOString() }).eq('id', entryId)
  return { error: result.error?.message ?? null }
}

// Latest roster submission for one entry, so the review actions can target a
// real row instead of a typed identifier.
export async function loadLatestRosterSubmission(client: SupabaseClient, entryId: string): Promise<RecordResult<{ id: string; status: RosterStatus; version: number } | null>> {
  const result = await client
    .from('roster_submissions')
    .select('id,status,version')
    .eq('entry_id', entryId)
    .order('version', { ascending: false })
    .limit(1)
  if (result.error) return { data: null, error: result.error.message }
  const row = (result.data ?? [])[0] as { id?: unknown; status?: unknown; version?: unknown } | undefined
  if (!row) return { data: null, error: null }
  return { data: { id: String(row.id), status: (row.status as RosterStatus) ?? 'draft', version: Number(row.version ?? 0) }, error: null }
}

// Roster players for one submission, so a roster review shows real names.
export type RosterPlayer = { player_id: string; shirt_number: string | null; position: string | null; display_name: string | null; slug: string | null; is_claimed: boolean | null }
export async function loadRosterPlayers(client: SupabaseClient, submissionId: string): Promise<RecordResult<RosterPlayer[]>> {
  const result = await client
    .from('roster_submission_players')
    .select('player_id,shirt_number,position,player_profiles(display_name,slug,is_claimed)')
    .eq('submission_id', submissionId)
  if (result.error) return { data: null, error: result.error.message }
  const rows = (result.data ?? []) as Array<Record<string, unknown>>
  return {
    data: rows.map(row => {
      const profile = Array.isArray(row.player_profiles)
        ? (row.player_profiles[0] as { display_name?: string; slug?: string; is_claimed?: boolean } | undefined)
        : (row.player_profiles as { display_name?: string; slug?: string; is_claimed?: boolean } | undefined)
      return {
        player_id: String(row.player_id),
        shirt_number: row.shirt_number === null || row.shirt_number === undefined ? null : String(row.shirt_number),
        position: row.position === null || row.position === undefined ? null : String(row.position),
        display_name: profile?.display_name ?? null,
        slug: profile?.slug ?? null,
        is_claimed: typeof profile?.is_claimed === 'boolean' ? profile.is_claimed : null,
      }
    }),
    error: null,
  }
}

// Registration summary for the Overview (page specification section 9). The
// settings row is a primary-key table keyed by tournament, so an absent row
// simply means registration has never been configured - the caller must treat
// that as "not configured", never as zero places or an all-zero summary.
export type TournamentRegistrationSettings = {
  opens_at: string | null
  closes_at: string | null
  application_method: string
  entry_requirements: string | null
  contact_instructions: string | null
  roster_min: number | null
  roster_max: number | null
  roster_deadline: string | null
}

export async function loadRegistrationSettings(client: SupabaseClient, tournamentId: string): Promise<RecordResult<TournamentRegistrationSettings | null>> {
  const result = await client
    .from('tournament_registration_settings')
    .select('opens_at,closes_at,application_method,entry_requirements,contact_instructions,roster_min,roster_max,roster_deadline')
    .eq('tournament_id', tournamentId)
    .maybeSingle()
  if (result.error) return { data: null, error: result.error.message }
  return { data: result.data as TournamentRegistrationSettings | null, error: null }
}

// The latest team limit among this tournament's categories is what the
// specification calls the registration "team limit". Categories without a limit
// are ignored rather than treated as zero, matching the column's nullable
// meaning; null overall means no category has a stated limit.
export async function loadRegistrationTeamLimit(client: SupabaseClient, tournamentId: string): Promise<RecordResult<number | null>> {
  const result = await client
    .from('tournament_categories')
    .select('team_limit')
    .eq('tournament_id', tournamentId)
  if (result.error) return { data: null, error: result.error.message }
  const limits = ((result.data ?? []) as Array<{ team_limit: number | null }>).map(item => item.team_limit).filter((value): value is number => typeof value === 'number' && value > 0)
  return { data: limits.length > 0 ? limits.reduce((sum, value) => sum + value, 0) : null, error: null }
}

// Overview notifications (section 15): the user's own latest notifications for
// ONE tournament. The policy scopes reads to the recipient, so this never
// shows another user's notifications, and unread is counted from the rows the
// caller can itself read rather than from a separate aggregate query.
export type TournamentNotification = { id: string; title: string; body: string; state: string; created_at: string; read_at: string | null; delivery_state: string | null }
export type TournamentNotificationSummary = { notifications: TournamentNotification[]; unread: number | null }

export async function loadMyTournamentNotifications(client: SupabaseClient, userId: string, tournamentId: string, limit = 3): Promise<RecordResult<TournamentNotificationSummary>> {
  const result = await client
    .from('notifications')
    .select('id,title,body,state,created_at,read_at,notification_deliveries(state)')
    .eq('recipient_id', userId)
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (result.error) return { data: null, error: result.error.message }
  const rows = (result.data ?? []) as Array<Record<string, unknown>>
  const notifications: TournamentNotification[] = rows.map(row => ({
    id: String(row.id),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    state: String(row.state ?? ''),
    created_at: String(row.created_at ?? ''),
    read_at: typeof row.read_at === 'string' ? row.read_at : null,
    delivery_state: Array.isArray(row.notification_deliveries) && row.notification_deliveries[0] && typeof (row.notification_deliveries[0] as { state?: unknown }).state === 'string'
      ? (row.notification_deliveries[0] as { state: string }).state
      : null,
  }))

  // Unread is counted for the whole tournament, not just the three shown. A
  // head count avoids loading any bodies; if the database cannot answer the
  // count, `null` means unknown and the UI must not show a zero.
  const count = await client
    .from('notifications')
    .select('id', { head: true, count: 'exact' })
    .eq('recipient_id', userId)
    .eq('tournament_id', tournamentId)
    .is('read_at', null)
  const unread = count.error ? null : ((count as { count?: number | null }).count ?? null)

  return { data: { notifications, unread: typeof unread === 'number' ? unread : null }, error: null }
}

// The latest result version for one match, so an organizer can confirm or correct
// a submitted result without typing any identifier. The result-version policy
// scopes readable rows to the organizer's own tournaments.
export type MatchResultVersion = { id: string; status: string; correction_reason: string | null }
export async function loadLatestResultVersion(client: SupabaseClient, matchId: string): Promise<RecordResult<MatchResultVersion | null>> {
  const result = await client
    .from('match_result_versions')
    .select('id,status,correction_reason')
    .eq('match_id', matchId)
    .order('version', { ascending: false })
    .limit(1)
  if (result.error) return { data: null, error: result.error.message }
  const row = (result.data ?? [])[0] as Record<string, unknown> | undefined
  if (!row) return { data: null, error: null }
  return {
    data: {
      id: String(row.id),
      status: String(row.status ?? 'submitted'),
      correction_reason: row.correction_reason === null || row.correction_reason === undefined ? null : String(row.correction_reason),
    },
    error: null,
  }
}

// Finance summary for the organization, respecting the finance policies: an
// organizer without finance permission simply receives nothing back.
export type FinanceExpense = { id: string; category: string; description: string | null; amount_mvr: number; status: string; created_at: string }
export async function loadOrganizationExpenses(client: SupabaseClient, organizationId: string): Promise<RecordResult<FinanceExpense[]>> {
  const result = await client
    .from('finance_expenses')
    .select('id,category,description,amount_mvr,status,created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (result.error) return { data: null, error: result.error.message }
  return { data: (result.data ?? []) as FinanceExpense[], error: null }
}

export function expenseTotal(expenses: FinanceExpense[]): number {
  return expenses.reduce((total, expense) => total + Number(expense.amount_mvr || 0), 0)
}

// Unread in-app notifications addressed to the signed-in account. The recipient
// policy means this can only ever return the caller's own rows.
export type WorkspaceNotification = { id: string; title: string; body: string | null; state: string; created_at: string }
export async function loadMyNotifications(client: SupabaseClient, userId: string): Promise<RecordResult<WorkspaceNotification[]>> {
  const result = await client
    .from('notifications')
    .select('id,title,body,state,created_at')
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(12)
  if (result.error) return { data: null, error: result.error.message }
  return { data: (result.data ?? []) as WorkspaceNotification[], error: null }
}

// Recent audit rows authored by this account. The audit policy only exposes a
// user's own events, so this is deliberately scoped to the caller.
export type WorkspaceAuditEvent = { id: string; action: string; entity_type: string; entity_id: string; reason: string | null; created_at: string }
export async function loadMyRecentActivity(client: SupabaseClient, userId: string, limit = 10): Promise<RecordResult<WorkspaceAuditEvent[]>> {
  const result = await client
    .from('audit_events')
    .select('id,action,entity_type,entity_id,reason,created_at')
    .eq('actor_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (result.error) return { data: null, error: result.error.message }
  return { data: (result.data ?? []) as WorkspaceAuditEvent[], error: null }
}

export function activityLabel(event: Pick<WorkspaceAuditEvent, 'action' | 'entity_type'>): string {
  const actions: Record<string, string> = {
    fixture_version_created: 'Created a fixture version',
    fixture_version: 'Updated a fixture version',
    match_result_confirmed: 'Confirmed a match result',
    match_result_corrected: 'Corrected a match result',
    insert_finance_record: 'Added a finance record',
    update_finance_record: 'Updated a finance record',
  }
  const label = actions[event.action] ?? event.action.replace(/_/g, ' ')
  return `${label} · ${event.entity_type.replace(/_/g, ' ')}`
}
