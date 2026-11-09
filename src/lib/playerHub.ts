import type { SupabaseClient } from '@supabase/supabase-js'
import { publicTournamentBranding, resolveBrandingUrl } from './tournamentBranding'

// ---------------------------------------------------------------------------
// Player workspace data that needs migration 030: the player's own fixtures
// and results, typed requests with reviewers, notification preferences, and
// photo/biography visibility. Every loader degrades to "not available yet"
// instead of failing the workspace when the migration is missing.
// ---------------------------------------------------------------------------

export const NEEDS_030 = 'This needs migration 030 to be applied.'

function isMissingSchema(message: string): boolean {
  return /does not exist|PGRST2\d\d|42P0\d|42703|42883|schema cache|could not find/i.test(message)
}

// --- Matches -------------------------------------------------------------------

export type WorkspaceMatch = {
  id: string; tournamentId: string; tournamentName: string; tournamentSlug: string; sport: string
  scheduledAt: string | null; venue: string | null; status: string; teamId: string | null
  homeTeamId: string | null; homeTeamName: string; homeTeamLogo: string | null
  awayTeamId: string | null; awayTeamName: string; awayTeamLogo: string | null
  homeScore: number | null; awayScore: number | null; resultConfirmed: boolean
  participated: boolean; starter: boolean | null; minutes: number | null
  goals: number; assists: number; yellow: number; red: number
}

const num = (value: unknown): number | null => value === null || value === undefined || value === '' || Number.isNaN(Number(value)) ? null : Number(value)
const text = (value: unknown): string | null => typeof value === 'string' && value ? value : null

export function mapWorkspaceMatch(row: Record<string, unknown>): WorkspaceMatch {
  return {
    id: String(row.match_id), tournamentId: String(row.tournament_id ?? ''), tournamentName: String(row.tournament_name ?? 'Tournament'), tournamentSlug: String(row.tournament_slug ?? ''), sport: String(row.sport ?? ''),
    scheduledAt: text(row.scheduled_at), venue: text(row.venue), status: String(row.status ?? 'scheduled'), teamId: text(row.team_id),
    homeTeamId: text(row.home_team_id), homeTeamName: String(row.home_team_name ?? 'To be decided'), homeTeamLogo: text(row.home_team_logo),
    awayTeamId: text(row.away_team_id), awayTeamName: String(row.away_team_name ?? 'To be decided'), awayTeamLogo: text(row.away_team_logo),
    homeScore: num(row.home_score), awayScore: num(row.away_score), resultConfirmed: row.result_confirmed === true,
    participated: row.participated === true, starter: typeof row.starter === 'boolean' ? row.starter : null, minutes: num(row.minutes),
    goals: Number(row.goals ?? 0), assists: Number(row.assists ?? 0), yellow: Number(row.yellow_cards ?? 0), red: Number(row.red_cards ?? 0),
  }
}

export async function loadWorkspaceMatches(client: SupabaseClient, playerId: string): Promise<{ data: WorkspaceMatch[]; available: boolean; error: string | null }> {
  const result = await client.rpc('get_player_workspace_matches', { p_player_id: playerId })
  if (result.error) return isMissingSchema(result.error.message) ? { data: [], available: false, error: null } : { data: [], available: true, error: result.error.message }
  return { data: ((result.data ?? []) as Record<string, unknown>[]).map(mapWorkspaceMatch), available: true, error: null }
}

export type MatchBucket = 'live' | 'upcoming' | 'completed' | 'postponed'
export const MATCH_BUCKET_LABELS: Record<MatchBucket, string> = { live: 'Live', upcoming: 'Upcoming', completed: 'Completed', postponed: 'Postponed / cancelled' }

export function matchBucket(match: Pick<WorkspaceMatch, 'status' | 'scheduledAt'>, nowIso: string): MatchBucket {
  if (match.status === 'live') return 'live'
  if (['postponed', 'abandoned', 'cancelled'].includes(match.status)) return 'postponed'
  if (match.status === 'confirmed' || match.status === 'awaiting_confirmation') return 'completed'
  return !match.scheduledAt || match.scheduledAt >= nowIso ? 'upcoming' : 'completed'
}

export function groupMatches(matches: WorkspaceMatch[], nowIso: string): Record<MatchBucket, WorkspaceMatch[]> {
  const groups: Record<MatchBucket, WorkspaceMatch[]> = { live: [], upcoming: [], completed: [], postponed: [] }
  for (const match of matches) groups[matchBucket(match, nowIso)].push(match)
  // Soonest first for what is ahead, latest first for what is done.
  groups.upcoming.sort((a, b) => String(a.scheduledAt ?? '9999').localeCompare(String(b.scheduledAt ?? '9999')))
  groups.completed.sort((a, b) => String(b.scheduledAt ?? '').localeCompare(String(a.scheduledAt ?? '')))
  return groups
}

export function opponentOf(match: WorkspaceMatch): { name: string; logo: string | null; home: boolean } {
  const home = match.teamId !== null && match.teamId === match.homeTeamId
  return home ? { name: match.awayTeamName, logo: match.awayTeamLogo, home: true } : { name: match.homeTeamName, logo: match.homeTeamLogo, home: false }
}

export function matchOutcome(match: WorkspaceMatch): 'W' | 'D' | 'L' | null {
  if (!match.resultConfirmed || match.homeScore === null || match.awayScore === null || !match.teamId) return null
  const mine = match.teamId === match.homeTeamId ? match.homeScore : match.awayScore
  const theirs = match.teamId === match.homeTeamId ? match.awayScore : match.homeScore
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D'
}

export function matchStatusText(status: string, resultConfirmed: boolean): string {
  if (status === 'confirmed' && resultConfirmed) return 'Official result'
  if (status === 'awaiting_confirmation') return 'Result awaiting confirmation'
  if (status === 'scheduled') return 'Scheduled'
  return status.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase())
}

// Before migration 030 only confirmed appearances are readable; turn those rows
// into the same shape so the Matches tab still lists them.
export function legacyMatches(rows: Record<string, unknown>[], tournamentsById: Map<string, Record<string, unknown>>): WorkspaceMatch[] {
  return rows.map(row => {
    const match = (Array.isArray(row.matches) ? row.matches[0] : row.matches) as Record<string, unknown> | null
    const tournament = tournamentsById.get(String(match?.tournament_id ?? ''))
    return mapWorkspaceMatch({
      match_id: row.match_id, tournament_id: match?.tournament_id, tournament_name: tournament?.name ?? 'Tournament', tournament_slug: tournament?.slug ?? '', sport: tournament?.sport ?? '',
      scheduled_at: match?.scheduled_at, venue: match?.venue, status: match?.status ?? 'confirmed', team_id: row.team_id,
      home_team_name: 'Your team', away_team_name: 'Opponent', result_confirmed: match?.status === 'confirmed', participated: true, starter: row.starter, minutes: row.minutes,
    })
  })
}

// --- Statistics ------------------------------------------------------------------

export type StatTotals = { appearances: number; starts: number; minutes: number; goals: number; assists: number; yellow: number; red: number }
export const EMPTY_TOTALS: StatTotals = { appearances: 0, starts: 0, minutes: 0, goals: 0, assists: 0, yellow: 0, red: 0 }

export function sumStatistics(rows: Record<string, unknown>[]): StatTotals {
  return rows.reduce<StatTotals>((total, row) => ({
    appearances: total.appearances + Number(row.appearances ?? 0), starts: total.starts + Number(row.starts ?? 0), minutes: total.minutes + Number(row.minutes ?? 0),
    goals: total.goals + Number(row.goals ?? 0), assists: total.assists + Number(row.assists ?? 0), yellow: total.yellow + Number(row.yellow_cards ?? 0), red: total.red + Number(row.red_cards ?? 0),
  }), { ...EMPTY_TOTALS })
}

// Per-match totals for a date range; only confirmed appearances count.
export function sumMatches(matches: WorkspaceMatch[]): StatTotals {
  return matches.filter(match => match.participated).reduce<StatTotals>((total, match) => ({
    appearances: total.appearances + 1, starts: total.starts + (match.starter ? 1 : 0), minutes: total.minutes + (match.minutes ?? 0),
    goals: total.goals + match.goals, assists: total.assists + match.assists, yellow: total.yellow + match.yellow, red: total.red + match.red,
  }), { ...EMPTY_TOTALS })
}

export type BreakdownKey = 'team_type' | 'team_id' | 'tournament_id' | 'season_id' | 'sport'
export function breakdownStatistics(rows: Record<string, unknown>[], key: BreakdownKey): Array<{ key: string; totals: StatTotals }> {
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const value = typeof row[key] === 'string' && row[key] ? String(row[key]) : ''
    groups.set(value, [...(groups.get(value) ?? []), row])
  }
  return [...groups.entries()].map(([group, items]) => ({ key: group, totals: sumStatistics(items) })).sort((a, b) => b.totals.appearances - a.totals.appearances)
}

export const TEAM_LEVEL_LABELS: Record<string, string> = { club: 'Club / team', island: 'Island', atoll: 'Atoll', national: 'National team', school: 'School', other: 'Other' }

export type StatFilters = { sport: string; seasonId: string; tournamentId: string; teamId: string; teamLevel: string; from: string; to: string }
export const EMPTY_STAT_FILTERS: StatFilters = { sport: '', seasonId: '', tournamentId: '', teamId: '', teamLevel: '', from: '', to: '' }

export function filterStatisticRows(rows: Record<string, unknown>[], filters: StatFilters): Record<string, unknown>[] {
  return rows.filter(row => (!filters.sport || row.sport === filters.sport) && (!filters.seasonId || row.season_id === filters.seasonId) && (!filters.tournamentId || row.tournament_id === filters.tournamentId) && (!filters.teamId || row.team_id === filters.teamId) && (!filters.teamLevel || row.team_type === filters.teamLevel))
}

// Date ranges need per-match records; the other filters apply to them too
// where the match carries the field.
export function filterMatchesForStats(matches: WorkspaceMatch[], filters: StatFilters): WorkspaceMatch[] {
  return matches.filter(match => {
    const day = match.scheduledAt?.slice(0, 10) ?? ''
    return (!filters.from || (day && day >= filters.from)) && (!filters.to || (day && day <= filters.to)) && (!filters.sport || match.sport === filters.sport) && (!filters.tournamentId || match.tournamentId === filters.tournamentId) && (!filters.teamId || match.teamId === filters.teamId)
  })
}

// --- Achievements ------------------------------------------------------------------

const APPEARANCE_STEPS = [1, 10, 25, 50, 100]
const GOAL_STEPS = [1, 10, 25, 50]
export function nextMilestones(totals: { appearances: number; goals: number }): Array<{ label: string; current: number; target: number }> {
  const next = (value: number, steps: number[]) => steps.find(step => step > value) ?? null
  const items: Array<{ label: string; current: number; target: number }> = []
  const apps = next(totals.appearances, APPEARANCE_STEPS)
  if (apps) items.push({ label: apps === 1 ? 'First official match' : `${apps} appearances`, current: totals.appearances, target: apps })
  const goals = next(totals.goals, GOAL_STEPS)
  if (goals) items.push({ label: goals === 1 ? 'First goal' : `${goals} goals`, current: totals.goals, target: goals })
  return items
}

// --- Requests ------------------------------------------------------------------------

export type RequestType = 'profile' | 'statistics' | 'team_history' | 'document' | 'verification' | 'impersonation' | 'team_contact' | 'organizer_contact' | 'account_support'
  | 'identity' | 'roster' | 'duplicate_profile' | 'privacy' | 'data_copy' | 'account_closure'
export type RequestRoute = 'tournament' | 'team' | 'admin' | 'either'
export const REQUEST_TYPES: Array<{ value: RequestType; label: string; route: RequestRoute; hint: string }> = [
  { value: 'profile', label: 'Profile correction', route: 'admin', hint: 'Wrong verified name, island or other locked detail.' },
  { value: 'statistics', label: 'Statistics correction', route: 'tournament', hint: 'A goal, assist, card or appearance is missing or wrong.' },
  { value: 'team_history', label: 'Team-history correction', route: 'team', hint: 'A membership date or team is wrong.' },
  { value: 'document', label: 'Document correction', route: 'tournament', hint: 'A document decision needs another look.' },
  { value: 'verification', label: 'Claim / verification request', route: 'admin', hint: 'Confirm this profile belongs to you.' },
  { value: 'impersonation', label: 'Impersonation or duplicate profile', route: 'admin', hint: 'Someone else is using your name, or you have two profiles.' },
  { value: 'team_contact', label: 'Message my team manager', route: 'team', hint: 'Goes to the managers of the team you choose.' },
  { value: 'organizer_contact', label: 'Message a tournament organizer', route: 'tournament', hint: 'Goes to the operators of the tournament you choose.' },
  { value: 'account_support', label: 'Account support', route: 'admin', hint: 'Sign-in, account or platform problems.' },
  // Migration 034. Before it, these are sent under the closest older type with the label in the subject.
  { value: 'identity', label: 'Identity correction', route: 'admin', hint: 'Your verified national ID, legal name or date of birth is wrong. Attach evidence in Documents.' },
  { value: 'roster', label: 'Roster correction', route: 'tournament', hint: 'Your name, number or position on a tournament roster is wrong.' },
  { value: 'duplicate_profile', label: 'Duplicate-profile report', route: 'admin', hint: 'You have found a second profile for yourself.' },
  { value: 'privacy', label: 'Privacy request', route: 'admin', hint: 'Something about you is shown that should not be, or a privacy concern.' },
  { value: 'data_copy', label: 'Copy of my data', route: 'admin', hint: 'Ask for a copy of the personal data Kulhivaru+ holds about you.' },
  { value: 'account_closure', label: 'Account closure', route: 'admin', hint: 'Close your account. Official match history stays with the tournaments.' },
]
const LEGACY_REQUEST_TYPE: Partial<Record<RequestType, RequestType>> = { identity: 'verification', roster: 'organizer_contact', duplicate_profile: 'impersonation', privacy: 'account_support', data_copy: 'account_support', account_closure: 'account_support' }
export const REQUEST_TYPE_LABELS = Object.fromEntries(REQUEST_TYPES.map(item => [item.value, item.label])) as Record<RequestType, string>

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', pending: 'Submitted', under_review: 'Under review', changes_requested: 'More information required', resolved: 'Approved', approved: 'Approved',
  rejected: 'Rejected', cancelled: 'Cancelled', withdrawn: 'Cancelled', accepted: 'Accepted', declined: 'Declined', reported: 'Reported', expired: 'Expired',
}
export function requestTone(status: string): 'ok' | 'warn' | 'bad' | 'muted' | 'info' {
  if (['resolved', 'approved', 'accepted'].includes(status)) return 'ok'
  if (['changes_requested', 'pending'].includes(status)) return 'warn'
  if (['rejected', 'declined', 'expired'].includes(status)) return 'bad'
  if (['cancelled', 'withdrawn', 'draft', 'reported'].includes(status)) return 'muted'
  return 'info'
}

export function validateRequest(input: { type: RequestType; subject: string; message: string; tournamentId: string; teamId: string }): string | null {
  const route = REQUEST_TYPES.find(item => item.value === input.type)?.route
  if (!input.subject.trim()) return 'Add a short subject.'
  if (!input.message.trim()) return 'Describe what should change.'
  if (route === 'tournament' && !input.tournamentId) return 'Choose the tournament this is about, so its organizer receives it.'
  if (route === 'team' && !input.teamId) return 'Choose the team this is about, so its manager receives it.'
  return null
}

export function requestRecipient(row: { tournament_id?: unknown; team_id?: unknown }, names: { tournament?: string | null; team?: string | null }): string {
  if (row.tournament_id) return `Organizer · ${names.tournament ?? 'tournament'}`
  if (row.team_id) return `Team manager · ${names.team ?? 'team'}`
  return 'Kulhivaru+ platform team'
}

export function requestNextAction(kind: 'correction' | 'team' | 'invitation', status: string): string {
  if (status === 'changes_requested') return 'Update your request and send it again.'
  if (status === 'pending') return kind === 'invitation' ? 'Accept or decline this invitation in Teams.' : 'Waiting for review. Nothing to do.'
  if (status === 'under_review') return 'Being reviewed. Nothing to do.'
  if (status === 'draft') return 'Finish and submit this draft.'
  return 'No action needed.'
}

export async function submitPlayerRequest(client: SupabaseClient, input: { userId: string; playerId: string; type: RequestType; subject: string; message: string; tournamentId: string; teamId: string; matchId?: string }): Promise<{ error: string | null }> {
  const problem = validateRequest(input)
  if (problem) return { error: problem }
  const base = { player_id: input.playerId, created_by: input.userId, subject: input.subject.trim(), message: input.message.trim(), tournament_id: input.tournamentId || null, match_id: input.matchId || null }
  const typed = await client.from('player_correction_requests').insert({ ...base, request_type: input.type, team_id: input.teamId || null }).select('id')
  if (!typed.error) return { error: null }
  // Before migration 034 the newer types fail the type check; send them under the closest older type.
  const legacyType = LEGACY_REQUEST_TYPE[input.type]
  if (legacyType && /check constraint|23514/i.test(typed.error.message)) {
    const fallback = await client.from('player_correction_requests').insert({ ...base, subject: `[${REQUEST_TYPE_LABELS[input.type]}] ${base.subject}`, request_type: legacyType, team_id: input.teamId || null }).select('id')
    return { error: fallback.error?.message ?? null }
  }
  if (!isMissingSchema(typed.error.message)) return { error: typed.error.message }
  // Before migration 030: keep the type in the subject so the reviewer sees it.
  const legacy = await client.from('player_correction_requests').insert({ ...base, subject: `[${REQUEST_TYPE_LABELS[input.type]}] ${base.subject}` }).select('id')
  return { error: legacy.error?.message ?? null }
}

export async function cancelPlayerRequest(client: SupabaseClient, kind: 'correction' | 'team', requestId: string): Promise<{ error: string | null }> {
  const result = await client.rpc('cancel_player_request', { p_kind: kind, p_request_id: requestId })
  if (!result.error) return { error: null }
  if (isMissingSchema(result.error.message)) return { error: NEEDS_030 }
  return { error: /not_cancellable/.test(result.error.message) ? 'This request can no longer be cancelled.' : result.error.message }
}

export async function resubmitPlayerRequest(client: SupabaseClient, requestId: string, message: string): Promise<{ error: string | null }> {
  if (!message.trim()) return { error: 'Describe the change before sending again.' }
  const result = await client.rpc('resubmit_correction_request', { p_request_id: requestId, p_message: message })
  if (!result.error) return { error: null }
  return { error: isMissingSchema(result.error.message) ? NEEDS_030 : result.error.message }
}

// Typed request columns arrive with migration 030.
export async function loadRequestTypes(client: SupabaseClient, ids: string[]): Promise<Map<string, { type: RequestType; teamId: string | null }>> {
  if (!ids.length) return new Map()
  const result = await client.from('player_correction_requests').select('id,request_type,team_id').in('id', ids)
  if (result.error) return new Map()
  return new Map(((result.data ?? []) as Record<string, unknown>[]).map(row => [String(row.id), { type: String(row.request_type ?? 'profile') as RequestType, teamId: text(row.team_id) }]))
}

// Unsent drafts stay on this device only; nothing is sent until Submit.
export type RequestDraft = { type: RequestType; subject: string; message: string; tournamentId: string; teamId: string; savedAt: string }
const draftKey = (playerId: string) => `kulhivaru.request-draft.${playerId}`
export function readRequestDraft(playerId: string): RequestDraft | null {
  try { const raw = localStorage.getItem(draftKey(playerId)); return raw ? JSON.parse(raw) as RequestDraft : null } catch { return null }
}
export function writeRequestDraft(playerId: string, draft: RequestDraft | null): void {
  try { if (draft) localStorage.setItem(draftKey(playerId), JSON.stringify(draft)); else localStorage.removeItem(draftKey(playerId)) } catch { /* drafts are a convenience */ }
}

// Reviewer side: requests addressed to a tournament, a team, or the platform.
export type ReviewScope = { kind: 'tournament'; id: string } | { kind: 'team'; id: string } | { kind: 'admin' }
export type ReviewRequest = { id: string; type: RequestType | null; subject: string; message: string; status: string; note: string | null; playerName: string; createdAt: string }
export async function loadRequestsForReview(client: SupabaseClient, scope: ReviewScope): Promise<{ data: ReviewRequest[]; error: string | null }> {
  let query = client.from('player_correction_requests').select('id,request_type,subject,message,status,resolution_note,created_at,player_profiles(display_name)').order('created_at', { ascending: false }).limit(100)
  if (scope.kind === 'tournament') query = query.eq('tournament_id', scope.id)
  else if (scope.kind === 'team') query = query.eq('team_id', scope.id)
  else query = query.is('tournament_id', null).is('team_id', null)
  const result = await query
  if (result.error) return { data: [], error: isMissingSchema(result.error.message) ? NEEDS_030 : result.error.message }
  return {
    data: ((result.data ?? []) as Record<string, unknown>[]).map(row => {
      const player = (Array.isArray(row.player_profiles) ? row.player_profiles[0] : row.player_profiles) as Record<string, unknown> | null
      return { id: String(row.id), type: (text(row.request_type) as RequestType | null), subject: String(row.subject ?? ''), message: String(row.message ?? ''), status: String(row.status ?? 'pending'), note: text(row.resolution_note), playerName: String(player?.display_name ?? 'Player'), createdAt: String(row.created_at ?? '') }
    }),
    error: null,
  }
}
export async function reviewPlayerRequest(client: SupabaseClient, requestId: string, status: 'under_review' | 'changes_requested' | 'resolved' | 'rejected', note: string): Promise<{ error: string | null }> {
  if ((status === 'changes_requested' || status === 'rejected') && !note.trim()) return { error: 'Add a note so the player knows what to do.' }
  const result = await client.from('player_correction_requests').update({ status, resolution_note: note.trim() || null }).eq('id', requestId).select('id')
  if (result.error) return { error: result.error.message }
  if (!result.data?.length) return { error: 'Nothing changed. You may not be a reviewer for this request.' }
  return { error: null }
}

// --- Notifications ------------------------------------------------------------------

export type NotificationCategory = 'teams' | 'rosters' | 'documents' | 'matches' | 'results' | 'achievements' | 'announcements'
export const NOTIFICATION_CATEGORIES: Array<{ value: NotificationCategory; label: string }> = [
  { value: 'teams', label: 'Team invitations and decisions' },
  { value: 'rosters', label: 'Roster approvals and changes' },
  { value: 'documents', label: 'Document verification' },
  { value: 'matches', label: 'Fixture changes and reminders' },
  { value: 'results', label: 'Results and statistics' },
  { value: 'achievements', label: 'Achievements and awards' },
  { value: 'announcements', label: 'Tournament announcements' },
]
export function notificationCategory(type: unknown): NotificationCategory {
  const value = String(type ?? '').toLowerCase()
  if (/invit|team_request|membership|join/.test(value)) return 'teams'
  if (/roster|registration|entry|application/.test(value)) return 'rosters'
  if (/document|eligib|identity|guardian/.test(value)) return 'documents'
  if (/result|statistic|correction|score/.test(value)) return 'results'
  if (/fixture|match|schedule|reminder|venue/.test(value)) return 'matches'
  if (/award|achievement|milestone|trophy/.test(value)) return 'achievements'
  return 'announcements'
}
// Which workspace tab a notice opens when it has no tournament page to show.
export const CATEGORY_TABS: Record<NotificationCategory, string> = { teams: 'teams', rosters: 'tournaments', documents: 'documents', matches: 'matches', results: 'statistics', achievements: 'achievements', announcements: 'tournaments' }

export type NotificationPreferences = { mutedCategories: NotificationCategory[]; emailEnabled: boolean }
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = { mutedCategories: [], emailEnabled: true }
export async function loadNotificationPreferences(client: SupabaseClient, userId: string): Promise<{ data: NotificationPreferences; available: boolean }> {
  const result = await client.from('notification_preferences').select('muted_categories,email_enabled').eq('user_id', userId).maybeSingle()
  if (result.error) return { data: DEFAULT_NOTIFICATION_PREFERENCES, available: !isMissingSchema(result.error.message) }
  const row = result.data as Record<string, unknown> | null
  return { data: row ? { mutedCategories: (Array.isArray(row.muted_categories) ? row.muted_categories : []) as NotificationCategory[], emailEnabled: row.email_enabled !== false } : DEFAULT_NOTIFICATION_PREFERENCES, available: true }
}
export async function saveNotificationPreferences(client: SupabaseClient, userId: string, preferences: NotificationPreferences): Promise<{ error: string | null }> {
  const result = await client.from('notification_preferences').upsert({ user_id: userId, muted_categories: preferences.mutedCategories, email_enabled: preferences.emailEnabled, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (result.error) return { error: isMissingSchema(result.error.message) ? NEEDS_030 : result.error.message }
  return { error: null }
}

export function dayGroupLabel(iso: unknown, now = new Date()): string {
  if (typeof iso !== 'string') return 'Earlier'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Earlier'
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(date)) / 86400000)
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : 'Earlier'
}

// --- Privacy: photo and biography visibility ---------------------------------------

export type VisibilityState = { photoPath: string | null; photoVisible: boolean; bioVisible: boolean; hasBio: boolean; available: boolean }
export async function loadVisibility(client: SupabaseClient, playerId: string): Promise<VisibilityState> {
  const [profile, privateRow] = await Promise.all([
    client.from('player_profiles').select('photo_url,photo_path,bio').eq('id', playerId).maybeSingle(),
    client.from('player_private_details').select('hidden_bio').eq('player_id', playerId).maybeSingle(),
  ])
  const row = (profile.data ?? {}) as Record<string, unknown>
  const hiddenBio = privateRow.error ? null : text((privateRow.data as Record<string, unknown> | null)?.hidden_bio)
  const photoPath = text(row.photo_path)
  return { photoPath, photoVisible: Boolean(text(row.photo_url)) || !photoPath, bioVisible: !hiddenBio, hasBio: Boolean(text(row.bio) || hiddenBio), available: !profile.error && !privateRow.error }
}

// Hiding the photo clears the public URL everywhere (lists, rosters, the card)
// while photo_path keeps the file, so showing it again restores the same image.
export async function setPhotoVisibility(client: SupabaseClient, userId: string, playerId: string, photoPath: string | null, visible: boolean): Promise<{ url: string | null; error: string | null }> {
  if (!photoPath) return { url: null, error: 'Upload a photo first.' }
  const url = visible ? client.storage.from('public-media').getPublicUrl(photoPath).data.publicUrl : null
  const result = await client.from('player_profiles').update({ photo_url: url }).eq('id', playerId).eq('account_id', userId).select('id')
  if (result.error) return { url: null, error: result.error.message }
  return { url, error: null }
}

// Hiding the biography moves it into the owner-only private details row, so it
// leaves the public profile row entirely.
export async function setBioVisibility(client: SupabaseClient, userId: string, playerId: string, visible: boolean): Promise<{ error: string | null }> {
  if (visible) {
    const stored = await client.from('player_private_details').select('hidden_bio').eq('player_id', playerId).maybeSingle()
    if (stored.error) return { error: isMissingSchema(stored.error.message) ? NEEDS_030 : stored.error.message }
    const bio = text((stored.data as Record<string, unknown> | null)?.hidden_bio)
    const restore = await client.from('player_profiles').update({ bio }).eq('id', playerId).eq('account_id', userId).select('id')
    if (restore.error) return { error: restore.error.message }
    const clear = await client.from('player_private_details').update({ hidden_bio: null, updated_at: new Date().toISOString() }).eq('player_id', playerId)
    return { error: clear.error?.message ?? null }
  }
  const current = await client.from('player_profiles').select('bio').eq('id', playerId).maybeSingle()
  const bio = text((current.data as Record<string, unknown> | null)?.bio)
  if (!bio) return { error: 'There is no biography to hide.' }
  const keep = await client.from('player_private_details').upsert({ player_id: playerId, hidden_bio: bio, updated_at: new Date().toISOString() }, { onConflict: 'player_id' })
  if (keep.error) return { error: isMissingSchema(keep.error.message) ? NEEDS_030 : keep.error.message }
  const cleared = await client.from('player_profiles').update({ bio: null }).eq('id', playerId).eq('account_id', userId).select('id')
  return { error: cleared.error?.message ?? null }
}

// --- Tournaments ------------------------------------------------------------------

export type TournamentCard = { id: string; name: string; slug: string; sport: string; status: string; startsAt: string | null; isPublished: boolean; logoUrl: string | null; coverUrl: string | null }
export async function loadTournamentCards(client: SupabaseClient, ids: string[]): Promise<Map<string, TournamentCard>> {
  if (!ids.length) return new Map()
  const branded = await client.from('tournaments').select('id,name,slug,sport,status,starts_at,is_published,logo_path,cover_path').in('id', ids)
  const result = branded.error ? await client.from('tournaments').select('id,name,slug,sport,status,starts_at,is_published').in('id', ids) : branded
  if (result.error) return new Map()
  const rows = (result.data ?? []) as Record<string, unknown>[]
  const cards = await Promise.all(rows.map(async row => {
    const branding = publicTournamentBranding(row)
    const [logoUrl, coverUrl] = await Promise.all([resolveBrandingUrl(client, branding.logoPath), resolveBrandingUrl(client, branding.coverPath)])
    return { id: String(row.id), name: String(row.name ?? 'Tournament'), slug: String(row.slug ?? ''), sport: String(row.sport ?? ''), status: String(row.status ?? ''), startsAt: text(row.starts_at), isPublished: row.is_published === true, logoUrl, coverUrl }
  }))
  return new Map(cards.map(card => [card.id, card]))
}

// Spec statuses for a player's tournament, from the entry and roster states.
export function playerTournamentStatus(input: { applicationStatus?: string | null; rosterStatus?: string | null; tournamentStatus?: string | null }): { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted' } {
  const roster = input.rosterStatus ?? ''; const application = input.applicationStatus ?? ''; const tournament = input.tournamentStatus ?? ''
  if (tournament === 'completed' || tournament === 'archived') return { label: 'Completed', tone: 'muted' }
  if (roster === 'rejected' || application === 'rejected') return { label: 'Rejected', tone: 'bad' }
  if (roster === 'changes_requested' || application === 'changes_requested') return { label: 'Changes requested', tone: 'warn' }
  if (roster === 'approved' || roster === 'locked') return tournament === 'in_progress' ? { label: 'Active', tone: 'ok' } : { label: 'Approved', tone: 'ok' }
  if (['submitted', 'under_review'].includes(roster) || ['submitted', 'under_review'].includes(application)) return { label: 'Pending roster approval', tone: 'warn' }
  if (tournament === 'in_progress') return { label: 'Active', tone: 'ok' }
  return { label: 'Invited', tone: 'info' }
}

export const TOURNAMENT_STATUS_LABELS: Record<string, string> = { draft: 'Draft', setup: 'In setup', registration_open: 'Registration open', registration_closed: 'Registration closed', in_progress: 'In progress', completed: 'Completed', archived: 'Archived', cancelled: 'Cancelled' }
