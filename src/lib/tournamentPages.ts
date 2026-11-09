import type { SupabaseClient } from '@supabase/supabase-js'
import { TIEBREAKER_LABELS } from './tournamentEngine'
import type { TournamentEntry, TournamentMatch } from './organizer'
import { imageLimit, sizeLabel } from './appConfig'
import { csvCell as cell } from './csvSafe'

// Organizer tournament pages 28-39 (migration 202611010036). Every read runs
// through the caller's own client and row-level security; every write that
// matters is recorded server-side in tournament_events.

const MIGRATION_036 = 'This needs migration 202611010036 to be applied.'
const isMissing = (message: string) => /PGRST20[25]|42P01|42703|Could not find|does not exist|schema cache/.test(message)

// Plain words for the errors these pages can produce. Raw service text is never shown.
const PROBLEMS: Array<[RegExp, string]> = [
  [/roster_unlock_requires_reason/, 'A locked roster can only be reopened with Unlock roster, which records a reason.'],
  [/roster_not_locked/, 'This roster is not locked.'],
  [/reason_required/, 'Enter a reason of at least 5 characters.'],
  [/organizer_permission_required|permission denied|row-level security|42501/, 'Your role in this tournament does not allow this action.'],
  [/team_not_in_stage/, 'That team does not play in this stage.'],
  [/already_revoked/, 'This adjustment was already removed.'],
  [/sport_locked_after_fixtures/, 'The sport cannot change after fixtures have been created.'],
  [/completion_blocked_unresolved_fixtures/, 'Every fixture must be played, cancelled or abandoned before the tournament can be completed.'],
  [/completion_blocked_no_champion/, 'Record the champion in Awards before completing the tournament.'],
  [/archive_requires_completion/, 'Only a completed or cancelled tournament can be archived.'],
  [/result_not_allowed|confirmation_not_allowed/, 'This result cannot be changed in its current state.'],
  [/duplicate key|23505/, 'That already exists.'],
  [/Failed to fetch|NetworkError/i, 'The service could not be reached. Check your connection and try again.'],
]
export function pageProblem(message: string | null | undefined): string {
  if (!message) return 'Something went wrong. Please try again.'
  if (isMissing(message)) return MIGRATION_036
  return PROBLEMS.find(([pattern]) => pattern.test(message))?.[1] ?? 'This could not be completed. Please try again.'
}
const fail = (message: string) => ({ error: pageProblem(message) })

export const maldivesTime = (iso: string | null | undefined, withTime = true) => {
  if (!iso) return 'Not scheduled'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Not scheduled'
  return date.toLocaleString('en-GB', { timeZone: 'Indian/Maldives', day: '2-digit', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) })
}
// datetime-local inputs work in Maldives time (UTC+5, no daylight saving).
export const toMaldivesInput = (iso: string | null) => iso ? new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 16) : ''
export const fromMaldivesInput = (value: string) => value ? new Date(`${value}:00+05:00`).toISOString() : null
export const formatMvr = (amount: number) => `MVR ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// CSV with formula-injection protection; callers pass public or staff fields only.
export function toCsv(header: string[], rows: Array<Array<unknown>>): string {
  return [header.map(cell).join(','), ...rows.map(row => row.map(cell).join(','))].join('\r\n')
}

// --- Activity timeline ------------------------------------------------------------------------------
export type TournamentEvent = { id: string; entity_type: string; entity_id: string | null; action: string; detail: Record<string, unknown>; note: string | null; created_at: string; actor_id: string | null }
export async function loadEvents(client: SupabaseClient, tournamentId: string, options: { entityId?: string; types?: string[]; limit?: number } = {}): Promise<{ data: TournamentEvent[]; error: string | null }> {
  let query = client.from('tournament_events').select('id,entity_type,entity_id,action,detail,note,created_at,actor_id').eq('tournament_id', tournamentId)
  if (options.entityId) query = query.eq('entity_id', options.entityId)
  if (options.types?.length) query = query.in('entity_type', options.types)
  const result = await query.order('created_at', { ascending: false }).limit(options.limit ?? 30)
  if (result.error) return { data: [], error: pageProblem(result.error.message) }
  return { data: (result.data ?? []) as TournamentEvent[], error: null }
}
const ACTION_WORDS: Record<string, string> = {
  application_submitted: 'Application submitted', application_under_review: 'Application under review', application_approved: 'Application approved',
  application_rejected: 'Application rejected', application_changes_requested: 'Changes requested', application_waitlisted: 'Moved to the waitlist', application_withdrawn: 'Application withdrawn',
  roster_submitted: 'Roster submitted', roster_approved: 'Roster approved', roster_locked: 'Roster locked', roster_changes_requested: 'Roster changes requested', roster_rejected: 'Roster rejected',
  payment_paid: 'Payment verified', payment_rejected: 'Payment rejected', payment_waived: 'Fee waived', payment_refunded: 'Payment refunded', payment_under_review: 'Payment under review', payment_unpaid: 'Payment pending',
  draw_saved: 'Draw saved', draw_published: 'Draw and fixtures published', draw_unpublished: 'Draw and fixtures unpublished', stage_rules_changed: 'Points or tie-breakers changed',
  fixture_added: 'Fixture added', fixture_rescheduled: 'Fixture rescheduled', fixture_postponed: 'Fixture postponed', fixture_cancelled: 'Fixture cancelled', fixture_abandoned: 'Fixture abandoned',
  fixture_scheduled: 'Fixture back on schedule', fixture_live: 'Match started', fixture_awaiting_confirmation: 'Result submitted', fixture_confirmed: 'Result confirmed',
  points_adjusted: 'Points adjusted', adjustment_revoked: 'Points adjustment removed', recalculated: 'Standings and statistics recalculated',
  setup_step_saved: 'Setup step saved', details_changed: 'Tournament details changed', sponsor_added: 'Sponsor added', sponsor_updated: 'Sponsor updated', sponsor_removed: 'Sponsor removed',
  income_recorded: 'Income recorded', income_received: 'Income received', income_cancelled: 'Income cancelled', incident_reported: 'Incident reported', incident_resolved: 'Incident resolved', incident_open: 'Incident reopened',
}
export function eventLabel(event: Pick<TournamentEvent, 'action' | 'detail'>): string {
  if (event.action.startsWith('status_')) return `Tournament status: ${event.action.slice(7).replace(/_/g, ' ')}`
  if (event.action === 'setup_step_saved') return `Setup step ${String(event.detail.step ?? '')} saved${event.detail.afterPublication ? ' after publication' : ''}`
  return ACTION_WORDS[event.action] ?? event.action.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase())
}

// --- Applications ---------------------------------------------------------------------------------
export type ApplicationFilter = 'all' | 'waiting' | 'approved' | 'waitlisted' | 'rejected' | 'withdrawn' | 'payment' | 'roster'
export function filterEntries(entries: TournamentEntry[], filter: ApplicationFilter, query: string): TournamentEntry[] {
  const term = query.trim().toLowerCase()
  return entries.filter(entry => {
    if (term && !(entry.team_name ?? '').toLowerCase().includes(term)) return false
    if (filter === 'waiting') return ['submitted', 'under_review', 'changes_requested'].includes(entry.application_status)
    if (filter === 'payment') return ['proof_submitted', 'under_review', 'unpaid', 'overdue'].includes(entry.payment_status)
    if (filter === 'roster') return ['submitted', 'under_review'].includes(entry.roster_status)
    if (filter === 'all') return true
    return entry.application_status === filter
  })
}
// Team name and statuses only: no contacts, answers, documents or identifiers.
export function applicationsCsv(entries: TournamentEntry[], labels: { application: (s: string) => string; roster: (s: string) => string; payment: (s: string) => string }): string {
  return toCsv(['Team', 'Application', 'Roster', 'Payment', 'Submitted'], entries.map(entry => [entry.team_name ?? 'Team', labels.application(entry.application_status), labels.roster(entry.roster_status), labels.payment(entry.payment_status), entry.submitted_at ? maldivesTime(entry.submitted_at, false) : '']))
}
export type EntryAnswer = { prompt: string; answer: string }
export async function loadEntryAnswers(client: SupabaseClient, entryId: string): Promise<{ data: EntryAnswer[]; error: string | null }> {
  const result = await client.from('tournament_registration_answers').select('answer, tournament_registration_questions(prompt, sort_order)').eq('entry_id', entryId)
  if (result.error) return { data: [], error: pageProblem(result.error.message) }
  const rows = (result.data ?? []) as Array<{ answer: unknown; tournament_registration_questions: { prompt?: string; sort_order?: number } | Array<{ prompt?: string; sort_order?: number }> | null }>
  const question = (row: typeof rows[number]) => Array.isArray(row.tournament_registration_questions) ? row.tournament_registration_questions[0] : row.tournament_registration_questions
  const text = (value: unknown) => typeof value === 'boolean' ? (value ? 'Yes' : 'No') : Array.isArray(value) ? value.join(', ') : value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return { data: rows.sort((a, b) => (question(a)?.sort_order ?? 0) - (question(b)?.sort_order ?? 0)).map(row => ({ prompt: question(row)?.prompt ?? 'Question', answer: text(row.answer) })), error: null }
}
export async function setApplicationStatus(client: SupabaseClient, entryId: string, status: string, note: string) {
  const result = await client.from('tournament_entries').update({ application_status: status, review_notes: note.trim() || null, reviewed_at: new Date().toISOString() }).eq('id', entryId)
  return result.error ? fail(result.error.message) : { error: null }
}
export async function setPaymentStatus(client: SupabaseClient, entryId: string, status: string, note: string) {
  const result = await client.from('tournament_entries').update({ payment_status: status, review_notes: note.trim() || null }).eq('id', entryId)
  return result.error ? fail(result.error.message) : { error: null }
}
export async function unlockRoster(client: SupabaseClient, entryId: string, reason: string) {
  const result = await client.rpc('unlock_entry_roster', { p_entry: entryId, p_reason: reason })
  return result.error ? fail(result.error.message) : { error: null }
}

// --- Rosters: eligibility and duplicates ----------------------------------------------------------
export type RosterCheck = { entryId: string; size: number; problems: string[] }
export async function loadRosterChecks(client: SupabaseClient, entries: TournamentEntry[], limits: { min: number | null; max: number | null }): Promise<{ data: RosterCheck[]; duplicates: Array<{ playerName: string; teams: string[] }>; error: string | null }> {
  const ids = entries.map(entry => entry.id)
  if (!ids.length) return { data: [], duplicates: [], error: null }
  const submissions = await client.from('roster_submissions').select('id,entry_id,version').in('entry_id', ids).order('version', { ascending: false })
  if (submissions.error) return { data: [], duplicates: [], error: pageProblem(submissions.error.message) }
  const latest = new Map<string, string>()
  for (const row of (submissions.data ?? []) as Array<{ id: string; entry_id: string }>) if (!latest.has(row.entry_id)) latest.set(row.entry_id, row.id)
  const submissionIds = [...latest.values()]
  if (!submissionIds.length) return { data: entries.map(entry => ({ entryId: entry.id, size: 0, problems: [] })), duplicates: [], error: null }
  const players = await client.from('roster_submission_players').select('submission_id, player_id, player_profiles(display_name, is_minor)').in('submission_id', submissionIds)
  if (players.error) return { data: [], duplicates: [], error: pageProblem(players.error.message) }
  type Row = { submission_id: string; player_id: string; player_profiles: { display_name?: string; is_minor?: boolean } | Array<{ display_name?: string; is_minor?: boolean }> | null }
  const rows = (players.data ?? []) as Row[]
  const profile = (row: Row) => Array.isArray(row.player_profiles) ? row.player_profiles[0] : row.player_profiles
  const entryOf = new Map([...latest.entries()].map(([entryId, submissionId]) => [submissionId, entryId]))
  const teamOf = new Map(entries.map(entry => [entry.id, entry.team_name ?? 'Team']))
  const byPlayer = new Map<string, { name: string; entries: Set<string> }>()
  for (const row of rows) {
    const entryId = entryOf.get(row.submission_id); if (!entryId) continue
    const current = byPlayer.get(row.player_id) ?? { name: profile(row)?.display_name ?? 'A player', entries: new Set<string>() }
    current.entries.add(entryId); byPlayer.set(row.player_id, current)
  }
  const duplicates = [...byPlayer.values()].filter(item => item.entries.size > 1).map(item => ({ playerName: item.name, teams: [...item.entries].map(id => teamOf.get(id) ?? 'Team') }))
  const duplicateEntries = new Set([...byPlayer.values()].filter(item => item.entries.size > 1).flatMap(item => [...item.entries]))
  const data = entries.map(entry => {
    const submission = latest.get(entry.id)
    const list = submission ? rows.filter(row => row.submission_id === submission) : []
    const problems: string[] = []
    if (submission && limits.min !== null && list.length < limits.min) problems.push(`Fewer than the minimum ${limits.min} players`)
    if (submission && limits.max !== null && list.length > limits.max) problems.push(`More than the maximum ${limits.max} players`)
    if (duplicateEntries.has(entry.id)) problems.push('A player is also on another team’s roster')
    const minors = list.filter(row => profile(row)?.is_minor).length
    if (minors) problems.push(`${minors} minor(s): check guardian consent`)
    return { entryId: entry.id, size: list.length, problems }
  })
  return { data, duplicates, error: null }
}

// --- Draw: stages ---------------------------------------------------------------------------------
export type StageRules = { points_win?: number; points_draw?: number; points_loss?: number; tiebreakers?: string[]; third_place?: boolean }
export type Stage = { id: string; name: string; format: string; stage_order: number; published_at: string | null; fixture_version: number; draw_mode: string; rules: StageRules; category_id: string }
export async function loadStages(client: SupabaseClient, tournamentId: string): Promise<{ data: Stage[]; error: string | null }> {
  const result = await client.from('competition_stages').select('id,name,format,stage_order,published_at,fixture_version,draw_mode,rules,category_id').eq('tournament_id', tournamentId).order('stage_order').order('name')
  if (result.error) return { data: [], error: pageProblem(result.error.message) }
  return { data: (result.data ?? []) as Stage[], error: null }
}
export async function setStagePublished(client: SupabaseClient, stageId: string, publish: boolean) {
  const result = await client.from('competition_stages').update({ published_at: publish ? new Date().toISOString() : null }).eq('id', stageId)
  return result.error ? fail(result.error.message) : { error: null }
}
export async function saveStageRules(client: SupabaseClient, stageId: string, rules: StageRules) {
  const result = await client.from('competition_stages').update({ rules }).eq('id', stageId)
  return result.error ? fail(result.error.message) : { error: null }
}
// Engine tie-breaker names (Format & Rules) and the older names stored by earlier stages.
export const TIEBREAKERS: Record<string, string> = { ...TIEBREAKER_LABELS, goal_difference: 'Goal / point difference', goals_scored: 'Scored', head_to_head: 'Head-to-head points', wins: 'Wins' }
export const FORMAT_LABELS: Record<string, string> = { round_robin: 'Round robin', two_leg: 'Home and away', group_stage: 'Group stage', knockout: 'Knockout', groups_knockout: 'Groups then knockout' }

// --- Fixtures -------------------------------------------------------------------------------------
export type FixtureMatch = TournamentMatch & { stage_id?: string | null }
// Goes through change_fixture so the reason is recorded and sent to both teams.
export async function updateFixture(client: SupabaseClient, matchId: string, patch: { scheduled_at?: string | null; venue?: string | null; status?: string }, reason = '') {
  const setSchedule = 'scheduled_at' in patch || 'venue' in patch
  const result = await client.rpc('change_fixture', { p_match: matchId, p_status: patch.status ?? null, p_scheduled_at: patch.scheduled_at ?? null, p_venue: patch.venue ?? null, p_reason: reason || null, p_set_schedule: setSchedule })
  return result.error ? fail(result.error.message) : { error: null }
}
export async function addFixture(client: SupabaseClient, userId: string, input: { tournamentId: string; stage: Stage; homeTeamId: string; awayTeamId: string; scheduledAt: string | null; venue: string | null }) {
  if (input.homeTeamId === input.awayTeamId) return { error: 'Choose two different teams.' }
  const result = await client.from('matches').insert({ tournament_id: input.tournamentId, stage_id: input.stage.id, category_id: input.stage.category_id, home_team_id: input.homeTeamId, away_team_id: input.awayTeamId, scheduled_at: input.scheduledAt, venue: input.venue, created_by: userId })
  return result.error ? fail(result.error.message) : { error: null }
}
// Rest and clash warnings: a team playing twice within `restHours`, or two matches at one venue within an hour.
export function fixtureWarnings(matches: TournamentMatch[], restHours = 20): Map<string, string[]> {
  const warnings = new Map<string, string[]>()
  const add = (id: string, text: string) => warnings.set(id, [...(warnings.get(id) ?? []), text])
  const timed = matches.filter(match => match.scheduled_at && !['cancelled', 'abandoned'].includes(match.status)).map(match => ({ match, at: Date.parse(match.scheduled_at as string) })).sort((a, b) => a.at - b.at)
  for (let i = 0; i < timed.length; i += 1) {
    for (let j = i + 1; j < timed.length; j += 1) {
      const gap = (timed[j].at - timed[i].at) / 3600_000
      if (gap >= Math.max(restHours, 1)) break
      const a = timed[i].match, b = timed[j].match
      const shared = [a.home_team_id, a.away_team_id].filter(team => team && [b.home_team_id, b.away_team_id].includes(team))
      if (shared.length && gap < restHours) { const text = `A team plays again within ${Math.round(gap)} hour(s)`; add(a.id, text); add(b.id, text) }
      if (a.venue && b.venue && a.venue.trim().toLowerCase() === b.venue.trim().toLowerCase() && gap < 1) { add(a.id, 'Another match at this venue within an hour'); add(b.id, 'Another match at this venue within an hour') }
    }
  }
  return warnings
}
export function fixturesCsv(matches: TournamentMatch[], statusLabel: (s: string) => string): string {
  return toCsv(['Date (Maldives time)', 'Home', 'Away', 'Venue', 'Status'], matches.map(match => [maldivesTime(match.scheduled_at), match.home_team_name ?? 'To be decided', match.away_team_name ?? 'To be decided', match.venue ?? '', statusLabel(match.status)]))
}

// --- Standings adjustments ------------------------------------------------------------------------
export type Adjustment = { id: string; stage_id: string; team_id: string; points: number; reason: string; created_at: string; revoked_at: string | null }
export async function loadAdjustments(client: SupabaseClient, stageIds: string[]): Promise<{ data: Adjustment[]; error: string | null }> {
  if (!stageIds.length) return { data: [], error: null }
  const result = await client.from('standings_adjustments').select('id,stage_id,team_id,points,reason,created_at,revoked_at').in('stage_id', stageIds).order('created_at', { ascending: false })
  if (result.error) return { data: [], error: pageProblem(result.error.message) }
  return { data: (result.data ?? []) as Adjustment[], error: null }
}
export async function adjustStandings(client: SupabaseClient, stageId: string, teamId: string, points: number, reason: string) {
  const result = await client.rpc('adjust_standings', { p_stage: stageId, p_team: teamId, p_points: points, p_reason: reason })
  return result.error ? fail(result.error.message) : { error: null }
}
export async function revokeAdjustment(client: SupabaseClient, id: string, reason: string) {
  const result = await client.rpc('revoke_standings_adjustment', { p_adjustment: id, p_reason: reason })
  return result.error ? fail(result.error.message) : { error: null }
}
export async function recalculateTournament(client: SupabaseClient, tournamentId: string) {
  const result = await client.rpc('recalculate_tournament', { p_tournament: tournamentId })
  return result.error ? fail(result.error.message) : { error: null }
}

// --- Operations -----------------------------------------------------------------------------------
export type ChecklistItem = { label: string; done: boolean }
export const DEFAULT_CHECKLIST = ['Venue open and marked', 'Equipment and balls ready', 'First aid on site', 'Officials arrived', 'Team lineups received', 'Scoresheet or Match Center ready']
export async function loadChecklist(client: SupabaseClient, matchId: string): Promise<{ data: ChecklistItem[]; error: string | null }> {
  const result = await client.from('match_day_checklists').select('items').eq('match_id', matchId).maybeSingle()
  if (result.error) return { data: [], error: pageProblem(result.error.message) }
  const items = (result.data?.items ?? null) as ChecklistItem[] | null
  return { data: items?.length ? items : DEFAULT_CHECKLIST.map(label => ({ label, done: false })), error: null }
}
export async function saveChecklist(client: SupabaseClient, userId: string, matchId: string, items: ChecklistItem[]) {
  const clean = items.filter(item => item.label.trim()).slice(0, 40).map(item => ({ label: item.label.trim().slice(0, 120), done: item.done }))
  const result = await client.from('match_day_checklists').upsert({ match_id: matchId, items: clean, updated_by: userId, updated_at: new Date().toISOString() })
  return result.error ? fail(result.error.message) : { error: null }
}
export type Incident = { id: string; match_id: string | null; category: string; severity: string; description: string; status: string; resolution: string | null; created_at: string; resolved_at: string | null }
export const INCIDENT_CATEGORIES: Record<string, string> = { injury: 'Injury', discipline: 'Discipline', venue: 'Venue', security: 'Security', equipment: 'Equipment', weather: 'Weather', other: 'Other' }
export async function loadIncidents(client: SupabaseClient, tournamentId: string): Promise<{ data: Incident[]; error: string | null }> {
  const result = await client.from('tournament_incidents').select('id,match_id,category,severity,description,status,resolution,created_at,resolved_at').eq('tournament_id', tournamentId).order('created_at', { ascending: false }).limit(100)
  if (result.error) return { data: [], error: pageProblem(result.error.message) }
  return { data: (result.data ?? []) as Incident[], error: null }
}
export async function reportIncident(client: SupabaseClient, userId: string, input: { tournamentId: string; matchId: string | null; category: string; severity: string; description: string }) {
  const result = await client.from('tournament_incidents').insert({ tournament_id: input.tournamentId, match_id: input.matchId, category: input.category, severity: input.severity, description: input.description.trim(), reported_by: userId })
  return result.error ? fail(result.error.message) : { error: null }
}
export async function resolveIncident(client: SupabaseClient, userId: string, id: string, resolution: string) {
  const result = await client.from('tournament_incidents').update({ status: 'resolved', resolution: resolution.trim(), resolved_by: userId, resolved_at: new Date().toISOString() }).eq('id', id)
  return result.error ? fail(result.error.message) : { error: null }
}

// --- Finance and sponsors -------------------------------------------------------------------------
export type SponsorRecord = { id: string; name: string; level: string; website: string | null; description: string | null; logo_path: string | null; is_public: boolean; agreement_notes: string | null; sort_order: number }
export const SPONSOR_LEVELS = ['Title sponsor', 'Gold', 'Silver', 'Partner', 'Supporter'] as const
export async function loadSponsorRecords(client: SupabaseClient, tournamentId: string): Promise<{ data: SponsorRecord[]; error: string | null }> {
  const result = await client.from('tournament_sponsors').select('id,name,level,website,description,logo_path,is_public,agreement_notes,sort_order').eq('tournament_id', tournamentId).order('sort_order').order('name')
  if (result.error) return { data: [], error: pageProblem(result.error.message) }
  return { data: (result.data ?? []) as SponsorRecord[], error: null }
}
export function sponsorProblem(input: { name: string; website: string; description: string }): string | null {
  if (input.name.trim().length < 2) return 'Enter the sponsor’s name.'
  if (input.website.trim() && !/^https?:\/\/[A-Za-z0-9.-]+/.test(input.website.trim())) return 'The website must start with https://'
  if (input.description.length > 400) return 'The public description can be 400 characters at most.'
  return null
}
export async function saveSponsorRecord(client: SupabaseClient, userId: string, tournamentId: string, id: string | null, input: { name: string; level: string; website: string; description: string; is_public: boolean; agreement_notes: string; logo_path?: string | null }) {
  const problem = sponsorProblem(input); if (problem) return { error: problem }
  const row = { name: input.name.trim(), level: input.level, website: input.website.trim() || null, description: input.description.trim() || null, is_public: input.is_public, agreement_notes: input.agreement_notes.trim() || null, ...(input.logo_path !== undefined ? { logo_path: input.logo_path } : {}), updated_at: new Date().toISOString() }
  const result = id ? await client.from('tournament_sponsors').update(row).eq('id', id) : await client.from('tournament_sponsors').insert({ ...row, tournament_id: tournamentId, created_by: userId })
  return result.error ? fail(result.error.message) : { error: null }
}
export async function removeSponsorRecord(client: SupabaseClient, id: string) {
  const result = await client.from('tournament_sponsors').delete().eq('id', id)
  return result.error ? fail(result.error.message) : { error: null }
}
export const SPONSOR_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export async function uploadSponsorLogo(client: SupabaseClient, tournamentId: string, file: File): Promise<{ path: string | null; error: string | null }> {
  if (!SPONSOR_LOGO_TYPES.includes(file.type)) return { path: null, error: 'Use a PNG, JPEG or WebP image.' }
  if (file.size > imageLimit(2 * 1024 * 1024)) return { path: null, error: `Logos must be ${sizeLabel(imageLimit(2 * 1024 * 1024))} or smaller.` }
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `tournaments/${tournamentId}/sponsors/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extension}`
  const result = await client.storage.from('public-media').upload(path, file, { contentType: file.type, upsert: false })
  return result.error ? { path: null, error: pageProblem(result.error.message) } : { path, error: null }
}
export const sponsorLogoUrl = (client: SupabaseClient, path: string) => client.storage.from('public-media').getPublicUrl(path).data.publicUrl
export type PublicSponsor = { sponsor_name: string; sponsor_level: string; website: string | null; description: string | null; logo_path: string | null }
export async function loadPublicSponsors(client: SupabaseClient, tournamentId: string): Promise<{ data: PublicSponsor[]; error: string | null; missing: boolean }> {
  const result = await client.rpc('get_public_tournament_sponsors', { p_tournament: tournamentId })
  if (result.error) return { data: [], error: pageProblem(result.error.message), missing: isMissing(result.error.message) }
  return { data: (result.data ?? []) as PublicSponsor[], error: null, missing: false }
}

export type Income = { id: string; kind: string; sponsor_id: string | null; amount_mvr: number; status: string; description: string; received_on: string | null; created_at: string }
export const INCOME_KINDS: Record<string, string> = { sponsorship: 'Sponsorship', donation: 'Donation', other: 'Other income' }
export type FinanceOverview = {
  fees: Array<{ id: string; label: string; amount_mvr: number }>
  payments: Array<{ id: string; entry_id: string; amount_mvr: number; status: string; created_at: string }>
  adjustments: Array<{ id: string; payment_id: string; kind: string; amount_mvr: number; reason: string; created_at: string }>
  expenses: Array<{ id: string; category: string; description: string; amount_mvr: number; status: string; created_at: string }>
  income: Income[]
  errors: string[]
}
export async function loadFinanceOverview(client: SupabaseClient, tournamentId: string, entryIds: string[]): Promise<FinanceOverview> {
  const [fees, payments, expenses, income] = await Promise.all([
    client.from('tournament_fees').select('id,label,amount_mvr').eq('tournament_id', tournamentId),
    entryIds.length ? client.from('tournament_payments').select('id,entry_id,amount_mvr,status,created_at').in('entry_id', entryIds) : Promise.resolve({ data: [], error: null }),
    client.from('finance_expenses').select('id,category,description,amount_mvr,status,created_at').eq('tournament_id', tournamentId).order('created_at', { ascending: false }),
    client.from('tournament_income').select('id,kind,sponsor_id,amount_mvr,status,description,received_on,created_at').eq('tournament_id', tournamentId).order('created_at', { ascending: false }),
  ])
  const paymentRows = (payments.data ?? []) as FinanceOverview['payments']
  const adjustments = paymentRows.length ? await client.from('finance_adjustments').select('id,payment_id,kind,amount_mvr,reason,created_at').in('payment_id', paymentRows.map(row => row.id)) : { data: [], error: null }
  const errors = [fees.error, payments.error, expenses.error, income.error, adjustments.error].filter((item): item is NonNullable<typeof item> => Boolean(item)).map(item => pageProblem(item.message))
  const num = <T extends { amount_mvr: unknown }>(rows: T[]) => rows.map(row => ({ ...row, amount_mvr: Number(row.amount_mvr) }))
  return {
    fees: num((fees.data ?? []) as FinanceOverview['fees']), payments: num(paymentRows), adjustments: num((adjustments.data ?? []) as FinanceOverview['adjustments']),
    expenses: num((expenses.data ?? []) as FinanceOverview['expenses']), income: num((income.data ?? []) as Income[]), errors: [...new Set(errors)],
  }
}
// MVR totals from real records only; a section that failed to load is excluded and reported, never counted as zero.
export function financeTotals(overview: FinanceOverview) {
  const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100
  const registration = sum(overview.payments.filter(row => row.status === 'paid').map(row => row.amount_mvr))
  const waived = sum(overview.adjustments.filter(row => row.kind === 'waiver').map(row => row.amount_mvr))
  const refunded = sum(overview.adjustments.filter(row => row.kind === 'refund').map(row => row.amount_mvr))
  const sponsorship = sum(overview.income.filter(row => row.kind === 'sponsorship' && row.status === 'received').map(row => row.amount_mvr))
  const donations = sum(overview.income.filter(row => row.kind !== 'sponsorship' && row.status === 'received').map(row => row.amount_mvr))
  const pledged = sum(overview.income.filter(row => row.status === 'pledged').map(row => row.amount_mvr))
  const expenses = sum(overview.expenses.filter(row => ['approved', 'submitted'].includes(row.status)).map(row => row.amount_mvr))
  return { registration, waived, refunded, sponsorship, donations, pledged, expenses, net: sum([registration - refunded, sponsorship, donations, -expenses]) }
}
export async function saveIncome(client: SupabaseClient, userId: string, tournamentId: string, input: { kind: string; sponsorId: string | null; amount: number; description: string; status: string; receivedOn: string | null }) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: 'Enter an amount in MVR greater than zero.' }
  if (input.description.trim().length < 2) return { error: 'Describe this income.' }
  if (input.status === 'received' && !input.receivedOn) return { error: 'Enter the date it was received.' }
  const result = await client.from('tournament_income').insert({ tournament_id: tournamentId, kind: input.kind, sponsor_id: input.sponsorId, amount_mvr: Math.round(input.amount * 100) / 100, description: input.description.trim(), status: input.status, received_on: input.receivedOn, created_by: userId })
  return result.error ? fail(result.error.message) : { error: null }
}
export async function setIncomeStatus(client: SupabaseClient, id: string, status: 'received' | 'cancelled', receivedOn: string | null) {
  const result = await client.from('tournament_income').update({ status, received_on: status === 'received' ? receivedOn ?? new Date().toISOString().slice(0, 10) : undefined, updated_at: new Date().toISOString() }).eq('id', id)
  return result.error ? fail(result.error.message) : { error: null }
}

// --- Completion -----------------------------------------------------------------------------------
export type CompletionCheck = { key: string; label: string; ok: boolean; blocking: boolean; detail: string }
export async function loadCompletionChecks(client: SupabaseClient, tournamentId: string): Promise<{ data: CompletionCheck[]; error: string | null }> {
  const result = await client.rpc('tournament_completion_checks', { p_tournament: tournamentId })
  if (result.error) return { data: [], error: pageProblem(result.error.message) }
  return { data: (result.data ?? []) as CompletionCheck[], error: null }
}
export const completionBlocked = (checks: CompletionCheck[]) => checks.some(check => check.blocking && !check.ok)

// --- Tournament media and news --------------------------------------------------------------------
export type TournamentArticle = {
  id: string; slug: string; title: string; status: string; content_type: string; published_at: string | null; created_at: string
  excerpt: string | null; body: string; cover_image_url: string | null; media_url: string | null
  related_team_id: string | null; related_player_id: string | null; related_match_id: string | null
}
export type ArticleDraft = { title: string; excerpt: string; body: string; contentType: string; coverUrl: string; mediaUrl: string; relatedTeamId: string; relatedPlayerId: string; relatedMatchId: string }
export const EMPTY_ARTICLE: ArticleDraft = { title: '', excerpt: '', body: '', contentType: 'news', coverUrl: '', mediaUrl: '', relatedTeamId: '', relatedPlayerId: '', relatedMatchId: '' }
const ARTICLE_FIELDS = 'id,slug,title,status,content_type,published_at,created_at,excerpt,body,cover_image_url,media_url'

export async function loadTournamentNews(client: SupabaseClient, tournamentId: string): Promise<{ data: TournamentArticle[]; error: string | null; linksAvailable: boolean }> {
  const full = await client.from('news_articles').select(`${ARTICLE_FIELDS},related_team_id,related_player_id,related_match_id`).eq('tournament_id', tournamentId).order('created_at', { ascending: false }).limit(100)
  if (!full.error) return { data: (full.data ?? []) as TournamentArticle[], error: null, linksAvailable: true }
  if (!isMissing(full.error.message)) return { data: [], error: pageProblem(full.error.message), linksAvailable: false }
  const basic = await client.from('news_articles').select(ARTICLE_FIELDS).eq('tournament_id', tournamentId).order('created_at', { ascending: false }).limit(100)
  if (basic.error) return { data: [], error: pageProblem(basic.error.message), linksAvailable: false }
  return { data: ((basic.data ?? []) as TournamentArticle[]).map(row => ({ ...row, related_team_id: null, related_player_id: null, related_match_id: null })), error: null, linksAvailable: false }
}

export function articleProblem(draft: ArticleDraft): string | null {
  if (!draft.title.trim()) return 'Give the article a title.'
  if (draft.title.trim().length > 160) return 'Keep the title under 160 characters.'
  if (!draft.body.trim() && !draft.mediaUrl.trim()) return 'Write the article or add a media link.'
  if (draft.mediaUrl.trim() && !/^https:\/\/\S+$/i.test(draft.mediaUrl.trim())) return 'Media links must start with https://.'
  if (draft.coverUrl && !/^https:\/\/\S+$/i.test(draft.coverUrl)) return 'Upload the cover image again.'
  return null
}

// mode: draft keeps it private; publish shows it now; schedule shows it from publishAt (the public
// News policy only returns published articles whose time has come).
export async function saveTournamentArticle(client: SupabaseClient, input: { id: string | null; organizationId: string; tournamentId: string; authorId: string; draft: ArticleDraft; mode: 'draft' | 'publish' | 'schedule'; publishAt: string | null; linksAvailable: boolean }) {
  const problem = articleProblem(input.draft); if (problem) return { error: problem }
  if (input.mode === 'schedule' && (!input.publishAt || Date.parse(input.publishAt) <= Date.now())) return { error: 'Choose a publication time in the future.' }
  const { draft } = input
  const fields: Record<string, unknown> = {
    title: draft.title.trim(), excerpt: draft.excerpt.trim() || null, body: draft.body.trim(), content_type: draft.contentType, tournament_id: input.tournamentId,
    cover_image_url: draft.coverUrl || null, media_url: draft.mediaUrl.trim() || null,
    status: input.mode === 'draft' ? 'draft' : 'published', published_at: input.mode === 'draft' ? null : input.mode === 'schedule' ? input.publishAt : new Date().toISOString(), updated_at: new Date().toISOString(),
  }
  if (input.linksAvailable) Object.assign(fields, { related_team_id: draft.relatedTeamId || null, related_player_id: draft.relatedPlayerId || null, related_match_id: draft.relatedMatchId || null })
  const slugBase = draft.title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'article'
  const result = input.id
    ? await client.from('news_articles').update(fields).eq('id', input.id).select('id')
    : await client.from('news_articles').insert({ ...fields, slug: `${slugBase}-${crypto.randomUUID().slice(0, 8)}`, organization_id: input.organizationId, author_id: input.authorId }).select('id')
  if (result.error) return { error: /row-level security|42501/i.test(result.error.message) ? 'Only owner, operations or media members of this organization can manage its news.' : pageProblem(result.error.message) }
  if (!result.data?.length) return { error: 'The article was not saved. You may no longer have permission to edit it.' }
  return { error: null }
}
export async function setArticleStatus(client: SupabaseClient, id: string, status: 'draft' | 'published' | 'archived') {
  const result = await client.from('news_articles').update({ status, ...(status === 'published' ? { published_at: new Date().toISOString() } : status === 'draft' ? { published_at: null } : {}), updated_at: new Date().toISOString() }).eq('id', id).select('id')
  if (result.error) return fail(result.error.message)
  return result.data?.length ? { error: null } : { error: 'The article was not changed.' }
}
export async function uploadNewsCover(client: SupabaseClient, tournamentId: string, file: File): Promise<{ url: string | null; error: string | null }> {
  if (!SPONSOR_LOGO_TYPES.includes(file.type)) return { url: null, error: 'Use a PNG, JPEG or WebP image.' }
  if (file.size > imageLimit()) return { url: null, error: `Cover images must be ${sizeLabel(imageLimit())} or smaller.` }
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `tournaments/${tournamentId}/news/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extension}`
  const result = await client.storage.from('public-media').upload(path, file, { contentType: file.type, upsert: false })
  return result.error ? { url: null, error: pageProblem(result.error.message) } : { url: client.storage.from('public-media').getPublicUrl(path).data.publicUrl, error: null }
}
export const articleState = (article: Pick<TournamentArticle, 'status' | 'published_at'>, now = Date.now()) =>
  article.status === 'published' && article.published_at && Date.parse(article.published_at) > now ? 'scheduled' : article.status

// --- Editing an open incident and deleting an unplayed fixture --------------------------------------
// Only open incidents are edited; resolved ones keep their record as decided.
export async function updateIncident(client: SupabaseClient, id: string, input: { category: string; severity: string; description: string }) {
  if (input.description.trim().length < 5) return { error: 'Describe what happened (at least 5 characters).' }
  if (!(input.category in INCIDENT_CATEGORIES)) return { error: 'Choose a category.' }
  const result = await client.from('tournament_incidents').update({ category: input.category, severity: input.severity, description: input.description.trim() }).eq('id', id).eq('status', 'open').select('id')
  if (result.error) return fail(result.error.message)
  if (!result.data?.length) return { error: 'This incident is already resolved, so it can no longer be changed.' }
  return { error: null }
}

// Unplayed fixtures only (migration 048). Played matches are corrected or
// marked abandoned instead; the database refuses to delete them.
export const deletableFixture = (match: { status: string }) => ['scheduled', 'postponed', 'cancelled'].includes(match.status)
export async function deleteFixture(client: SupabaseClient, matchId: string, reason: string): Promise<{ error: string | null }> {
  if (reason.trim().length < 5) return { error: 'Give a reason of at least 5 characters. It is kept in the activity log.' }
  const result = await client.rpc('delete_fixture', { p_match: matchId, p_reason: reason.trim() })
  if (!result.error) return { error: null }
  const message = result.error.message
  if (/does not exist|PGRST20\d|42883|schema cache|could not find/i.test(message)) return { error: 'Deleting fixtures becomes available once the platform owner applies update 048.' }
  if (/match_has_results/.test(message)) return { error: 'This match already has a result or recorded events, so it cannot be deleted. Correct the result or mark it abandoned instead.' }
  if (/match_feeds_later_round/.test(message)) return { error: 'A later knockout round depends on this match. Change the bracket first.' }
  if (/organizer_permission_required/.test(message)) return { error: 'Only this tournament’s organizers can delete fixtures.' }
  return { error: 'The fixture could not be deleted. Please try again.' }
}
