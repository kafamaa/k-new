import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Team workspace data + logic layer.
//
// Every query goes through the caller's own Supabase client, so the database
// RLS policies are the real authorization boundary. Before migration
// 202610240021 is applied, reads return exactly what today's policies admit
// (team identity via membership, entries via "team managers read own
// entries", matches via the participation helper); the team-profile and
// membership-end writes stay blocked by the database, and this layer maps the
// resulting error into the honest message the workspace shows.
//
// Pure helpers (application status lists, fixture split, result aggregation,
// roster validation) are separated so they are unit-testable without a
// database.
// ---------------------------------------------------------------------------

export const TEAM_APPLICATION_ACTIONS: Record<string, { label: string; allowedStatuses: string[] }> = {
  submit: { label: 'Submit application', allowedStatuses: ['draft'] },
  resubmit: { label: 'Resubmit after organizer changes', allowedStatuses: ['changes_requested'] },
  withdraw: { label: 'Withdraw application', allowedStatuses: ['submitted', 'changes_requested'] },
} as const

export type TeamProfileFields = { name: string; island: string; team_type: string; description: string; logo_url: string; is_published: boolean }

// teams.team_type CHECK - migration 0001. The empty option is only a UI default;
// an empty value saves as 'club' so the database check can never be violated.
export const TEAM_TYPES = ['club', 'island', 'national', 'school', 'other'] as const

export function sanitizeTeamProfile(fields: Partial<TeamProfileFields>): { patch: Record<string, unknown>; problems: string[] } {
  const problems: string[] = []
  const patch: Record<string, unknown> = {}
  const name = typeof fields.name === 'string' ? fields.name.trim().slice(0, 120) : ''
  if (name) patch.name = name
  else if (fields.name !== undefined) problems.push('Team name cannot be empty.')
  if (fields.island !== undefined) patch.island = typeof fields.island === 'string' ? fields.island.trim().slice(0, 80) || null : null
  if (fields.team_type !== undefined) patch.team_type = (TEAM_TYPES as readonly string[]).includes(String(fields.team_type)) ? fields.team_type : 'club'
  if (fields.description !== undefined) patch.description = typeof fields.description === 'string' ? fields.description.trim().slice(0, 600) || null : null
  if (fields.logo_url !== undefined) patch.logo_url = typeof fields.logo_url === 'string' ? fields.logo_url.trim().slice(0, 500) || null : null
  if (fields.is_published !== undefined) patch.is_published = fields.is_published === true
  return { patch, problems }
}

// Maps a database denial to the truthful message shown in the workspace. The
// migration 021 header text matches these so diagnostic trust is not claimed
// before the policy exists.
export function teamPolicyError(error: string): string {
  if (/row-level security/i.test(error)) return 'The database denied this change because the required policy (migration 202610240021) is not applied yet. Nothing else is affected.'
  return error
}

export async function updateTeamProfile(client: SupabaseClient, teamId: string, fields: Partial<TeamProfileFields>): Promise<{ error: string | null }> {
  const { patch, problems } = sanitizeTeamProfile(fields)
  if (problems.length) return { error: problems.join(' ') }
  if (!Object.keys(patch).length) return { error: null }
  const result = await client.from('teams').update(patch).eq('id', teamId).select('id')
  if (result.error) return { error: teamPolicyError(result.error.message) }
  if (!result.data?.length) return { error: 'No team row changed. You can only edit a team you manage.' }
  return { error: null }
}

export async function setMembershipStatus(client: SupabaseClient, teamId: string, membershipId: string, status: 'active' | 'ended'): Promise<{ error: string | null }> {
  const patch: Record<string, unknown> = { status }
  if (status === 'ended') patch.effective_to = new Date().toISOString().slice(0, 10)
  if (status === 'active') patch.effective_to = null
  const result = await client.from('player_team_memberships').update(patch).eq('id', membershipId).eq('team_id', teamId).select('id')
  if (result.error) return { error: teamPolicyError(result.error.message) }
  if (!result.data?.length) return { error: 'No membership was changed. You can only manage memberships of your own team.' }
  return { error: null }
}

// Application decisions a manager may take. The entry-status trigger (0004 as
// amended by review-only migration 021) enforces exactly these transitions.
export function applicationAction(currentStatus: string, action: 'submit' | 'resubmit' | 'withdraw'): string | null {
  const spec = TEAM_APPLICATION_ACTIONS[action]
  if (!spec) return null
  if (!spec.allowedStatuses.includes(currentStatus)) return `This application is ${currentLabel(currentStatus)}; ${spec.label.toLowerCase()} is not available from that state.`
  return null
}

function currentLabel(status: string): string {
  return ({
    draft: 'a draft', submitted: 'submitted', under_review: 'under review', changes_requested: 'waiting for your changes',
    approved: 'approved', rejected: 'rejected', withdrawn: 'withdrawn',
  })[status] ?? status
}

export async function changeApplicationStatus(client: SupabaseClient, entryId: string, status: 'draft' | 'submitted' | 'withdrawn'): Promise<{ error: string | null }> {
  const result = await client.from('tournament_entries').update({ application_status: status }).eq('id', entryId).select('application_status')
  if (result.error) {
    const message = result.error.message
    if (/row-level security/i.test(message)) return { error: 'The application was not changed: the database requires either an open registration window or the withdrawal policy (migration 202610240021).' }
    if (message.includes('team_manager_withdrawal_not_permitted_from_current_status')) return { error: 'Withdrawal is only possible before the application is approved or rejected.' }
    return { error: message }
  }
  if (!result.data?.length) return { error: 'No application was changed. You can only act on applications for a team you manage.' }
  return { error: null }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export type TeamWorkspaceData = {
  team: Record<string, unknown> | null
  role: string
  playerHistory: Record<string, unknown>[]
  entries: Record<string, unknown>[]
  matches: Record<string, unknown>[]
  resultVersions: Record<string, unknown>[]
  teamRequests: Record<string, unknown>[]
  documents: Record<string, unknown>[]
  notifications: Record<string, unknown>[]
  unavailable: string[]
}

const TEAM_IDENTITY_FIELDS = 'id,name,slug,team_type,island,description,logo_url,is_published,created_at,deactivated_at'
const ENTRY_FIELDS = 'id,tournament_id,application_status,roster_status,payment_status,submitted_at,review_notes,updated_at,tournaments(id,name,slug)'
const MATCH_FIELDS = 'id,tournament_id,home_team_id,away_team_id,scheduled_at,venue,status,tournaments(id,name,slug)'

// Squad rows with position, shirt number and role (migration 031) and the player code;
// before those columns exist the base row is read so the squad still loads.
const MEMBERSHIP_BASE = 'id,player_id,status,effective_from,effective_to,source'
async function loadSquadHistory(client: SupabaseClient, teamId: string) {
  const query = (fields: string) => client.from('player_team_memberships').select(fields).eq('team_id', teamId).order('effective_from', { ascending: false }).order('effective_to', { ascending: false, nullsFirst: false })
  const full = await query(`${MEMBERSHIP_BASE},position,jersey_number,squad_role,player_profiles(id,display_name,slug,photo_url,is_published,public_code)`)
  if (!full.error || !/column|does not exist|schema cache|PGRST20/i.test(full.error.message)) return full
  return query(`${MEMBERSHIP_BASE},player_profiles(id,display_name,slug,photo_url,is_published)`)
}

export async function loadTeamWorkspace(client: SupabaseClient, userId: string, teamId: string): Promise<{ data: TeamWorkspaceData | null; error: string | null }> {
  const role = await client.from('team_memberships').select('role').eq('team_id', teamId).eq('user_id', userId).maybeSingle()
  if (role.error) return { data: null, error: role.error.message }
  // Readers without a membership (an old deep link to a team the scope no
  // longer includes) must land on the workspace's permission-denied state, so
  // a null role stops here without guessing the team identity.
  if (!role.data) return { data: null, error: null }

  const [teamResult, historyResult, entryResult, matchResult, requestResult, documentResult, notificationResult] = await Promise.all([
    client.from('teams').select(TEAM_IDENTITY_FIELDS).eq('id', teamId).maybeSingle(),
    loadSquadHistory(client, teamId),
    client.from('tournament_entries').select(ENTRY_FIELDS).eq('team_id', teamId).order('updated_at', { ascending: false }),
    client.from('matches').select(MATCH_FIELDS).or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`).order('scheduled_at', { ascending: true, nullsFirst: false }),
    client.from('player_team_requests').select('id,player_id,status,message,created_at,resolved_at,player_profiles(display_name,slug)').eq('team_id', teamId).order('created_at', { ascending: false }),
    client.from('private_documents').select('id,entry_id,tournament_id,document_type,storage_path,original_name,mime_type,size_bytes,created_at').eq('uploaded_by', userId).order('created_at', { ascending: false }),
    client.from('notifications').select('id,notification_type,title,body,channel,state,created_at,read_at,tournament_id').eq('recipient_id', userId).order('created_at', { ascending: false }).limit(30),
  ])

  const unavailable: string[] = []
  const failed = [{ key: 'team', result: teamResult }, { key: 'player history', result: historyResult }, { key: 'applications', result: entryResult }, { key: 'matches', result: matchResult }, { key: 'requests', result: requestResult }, { key: 'documents', result: documentResult }, { key: 'notifications', result: notificationResult }]
    .filter(entry => entry.result.error)
    .map(entry => `${entry.key}: ${entry.result.error!.message}`)
  if (failed.length) unavailable.push(...failed)

  const matches = (matchResult.data ?? []) as Record<string, unknown>[]
  // Confirmed result versions for exactly the matches already admitted by the
  // participation helper. A failing read degrades to no results, recorded in
  // `unavailable` — never fabricated to an empty array silently.
  const matchIds = matches.map(match => String(match.id))
  const versions = matchIds.length
    ? await client.from('match_result_versions').select('match_id,version,score,status,created_at').in('match_id', matchIds).eq('status', 'confirmed').order('version', { ascending: false })
    : { data: [], error: null as string | null }

  return {
    data: {
      team: (teamResult.data ?? null) as Record<string, unknown> | null,
      role: String(role.data.role ?? ''),
      playerHistory: (historyResult.data ?? []) as unknown as Record<string, unknown>[],
      entries: (entryResult.data ?? []) as Record<string, unknown>[],
      matches,
      resultVersions: ((versions.data ?? []) as Record<string, unknown>[]) ?? [],
      teamRequests: (requestResult.data ?? []) as Record<string, unknown>[],
      documents: (documentResult.data ?? []) as Record<string, unknown>[],
      notifications: (notificationResult.data ?? []) as Record<string, unknown>[],
      unavailable: failed.length || versions.error ? [...unavailable, ...(versions.error ? [`results: ${versions.error}`] : [])] : [],
    },
    error: null,
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

export function splitMatchesByTime(rows: Record<string, unknown>[], nowIso: string): { upcoming: Record<string, unknown>[]; past: Record<string, unknown>[] } {
  const now = new Date(nowIso).getTime()
  const isTimestamp = (value: unknown) => Boolean(value) && !Number.isNaN(new Date(String(value)).getTime())
  const upcoming: Record<string, unknown>[] = []
  const past: Record<string, unknown>[] = []
  for (const row of rows) {
    const status = String(row.status ?? '')
    const concluded = ['confirmed', 'abandoned', 'cancelled', 'postponed', 'awaiting_confirmation'].includes(status)
    const scheduledAndGone = !concluded && isTimestamp(row.scheduled_at) && new Date(String(row.scheduled_at)).getTime() <= now
    if (concluded || scheduledAndGone) past.push(row)
    else upcoming.push(row)
  }
  return { upcoming, past }
}

export type ConfirmedTeamResult = { matchId: string; homeScore: number | null; awayScore: number | null }

// Scores come only from confirmed result versions and only for matches the
// loader already admitted. Score shape mirrors the organizer result forms
// ({ home, away }); a malformed/dual-version row contributes nothing rather
// than a wrong number.
export function latestConfirmedScores(matchIds: readonly string[], versions: Record<string, unknown>[]): Map<string, ConfirmedTeamResult> {
  const wanted = new Set(matchIds.map(String))
  const latest = new Map<string, { version: number; score: unknown }>()
  for (const row of versions) {
    const matchId = String(row.match_id ?? '')
    if (!wanted.has(matchId)) continue
    const version = Number(row.version)
    if (Number.isNaN(version)) continue
    const existing = latest.get(matchId)
    if (!existing || version > existing.version) latest.set(matchId, { version, score: row.score })
  }
  const results = new Map<string, ConfirmedTeamResult>()
  for (const [matchId, entry] of latest) {
    const score = entry.score as { home?: unknown; away?: unknown } | null
    const home = typeof score?.home === 'number' ? score.home : null
    const away = typeof score?.away === 'number' ? score.away : null
    results.set(matchId, { matchId, homeScore: home, awayScore: away })
  }
  return results
}

export function teamMatchRecord(teamId: string, matches: Record<string, unknown>[], versions: Record<string, unknown>[], pointsWin = 3, pointsDraw = 1): Record<string, unknown> {
  const scores = latestConfirmedScores(matches.map(match => String(match.id)), versions)
  let played = 0; let wins = 0; let draws = 0; let losses = 0; let scored = 0; let conceded = 0; let points = 0
  for (const match of matches) {
    if (String(match.status ?? '') !== 'confirmed') continue
    const result = scores.get(String(match.id))
    if (!result || result.homeScore === null || result.awayScore === null) continue
    const home = String(match.home_team_id ?? '') === String(teamId)
    const own = home ? result.homeScore : result.awayScore
    const other = home ? result.awayScore : result.homeScore
    played += 1; scored += own; conceded += other
    if (own > other) { wins += 1; points += pointsWin } else if (own < other) { losses += 1 } else { draws += 1; points += pointsDraw }
  }
  return { played, wins, draws, losses, scored, conceded, points }
}

export type RosterCount = { count: number; problems: string[] }

export function validateRosterCount(count: number, min: number | null, max: number | null): RosterCount {
  const problems: string[] = []
  if (min !== null && count < min) problems.push(`Roster needs at least ${min} players (currently ${count}).`)
  if (max !== null && count > max) problems.push(`Roster allows at most ${max} players (currently ${count}).`)
  return { count, problems }
}

// Document states the workspace can show truthfully from the database; the
// review decisions ("Under review", "Correction required") live in roster and
// application review states the organizer sets - they are surfaced there and
// mirrored here, never invented.
export function applicationNextActions(entry: Record<string, unknown>): string[] {
  const actions: string[] = []
  const application = String(entry.application_status ?? '')
  const roster = String(entry.roster_status ?? '')
  if (application === 'draft') actions.push('Submit this application to the organizer.')
  if (application === 'changes_requested') actions.push('The organizer requested changes; review the notes and resubmit.')
  if (application === 'submitted') actions.push('Waiting for the organizer to review the application.')
  if (application === 'approved') actions.push('The application is approved.')
  if (application === 'rejected') actions.push('The application was rejected.')
  if (application === 'withdrawn') actions.push('The application was withdrawn.')
  if (['approved'].includes(application) && roster === 'not_started') actions.push('Build and submit the tournament roster.')
  if (roster === 'changes_requested') actions.push('The organizer requested roster corrections; resubmit the roster.')
  if (roster === 'submitted' || roster === 'under_review') actions.push('The roster is waiting for organizer review.')
  if (roster === 'locked') actions.push('The roster is approved and locked.')
  return actions
}

// The player_profiles embed resolves only for published (or self-owned)
// profiles; an unclaimed record stays genuinely invisible under RLS and is
// labelled honestly instead of showing a raw identifier.
export function membershipLabel(row: Record<string, unknown>): string {
  const status = String(row.status ?? '')
  const from = typeof row.effective_from === 'string' ? row.effective_from : ''
  const to = typeof row.effective_to === 'string' && row.effective_to ? row.effective_to : null
  const player = row.player_profiles as Record<string, unknown> | null
  const name = player ? String(player.display_name ?? '') || 'Private player record' : 'Private player record'
  return `${name} · ${status.replace('_', ' ')}${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''}`
}
