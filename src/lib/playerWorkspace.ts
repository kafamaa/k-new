import type { SupabaseClient } from '@supabase/supabase-js'
import { computePlayerRating, totalOfficialStatistics, type RatingResult } from './playerRating'

// Extended sporting detail columns (nationality, sports, position) exist only
// after the review-only migration 202610210013 is applied. The loader probes
// for them and degrades truthfully when the environment does not have them yet.
export const PLAYER_PROFILE_DETAIL_FIELDS = 'nationality,sports,position'
// Date of birth is identity-private by design: it is never a column on
// player_profiles (published rows are guest-readable at the row level), so it
// lives in the owner-only player_private_details table prepared in migration 0013.
export const PLAYER_PRIVATE_DETAIL_NOTE = 'Date of birth and identification documents are private. They are stored outside the public profile and are never shown to guests.'

export type PlayerWorkspaceData = {
  profile: Record<string, unknown>
  profileDetailsAvailable: boolean
  privateDetails: Record<string, unknown> | null
  teams: Record<string, unknown>[]
  matches: Record<string, unknown>[]
  statistics: Record<string, unknown>[]
  milestones: Record<string, unknown>[]
  notifications: Record<string, unknown>[] | null
  correctionRequests: Record<string, unknown>[] | null
  teamRequests: Record<string, unknown>[] | null
  claimInvitations: Record<string, unknown>[] | null
  rosterRows: Record<string, unknown>[] | null
  tournaments: Record<string, unknown>[]
  teamDirectory: Record<string, unknown>[] | null
  unavailable: string[]
  pendingSchema: string[]
}

// PostgREST/PostgreSQL report a missing relation or column with these markers.
function isMissingSchemaError(message: string): boolean {
  return /does not exist|PGRST2\d\d|42P0\d|42703|schema cache/i.test(message)
}

export async function loadPlayerWorkspace(client: SupabaseClient, userId: string, playerId: string): Promise<{ data: PlayerWorkspaceData | null; error: string | null }> {
  // Probe the extended sporting-detail columns first; fall back to base columns
  // when migration 0013 has not been applied to this environment.
  let profileResult = await client.from('player_profiles').select(`id,display_name,slug,island,photo_url,is_claimed,is_published,${PLAYER_PROFILE_DETAIL_FIELDS}`).eq('id', playerId).eq('account_id', userId).maybeSingle()
  let profileDetailsAvailable = true
  if (profileResult.error && isMissingSchemaError(profileResult.error.message)) {
    profileDetailsAvailable = false
    profileResult = await client.from('player_profiles').select('id,display_name,slug,island,photo_url,is_claimed,is_published').eq('id', playerId).eq('account_id', userId).maybeSingle()
  }
  if (profileResult.error) return { data: null, error: profileResult.error.message }
  if (!profileResult.data) return { data: null, error: 'Player profile is not linked to this account or is not available.' }

  const unavailable: string[] = []
  const pendingSchema: string[] = []

  // These reads are independent, so they run concurrently instead of one after
  // another. Only the profile (above) and the tournament-name lookup (below)
  // have ordering constraints. Errors are processed in the original order so
  // the unavailable/pending lists stay stable and truthful.
  const [privateDetails, history, matches, statistics, milestones, notifications, correctionRequests, teamRequests, invitations, roster, teamDirectory] = await Promise.all([
    client.from('player_private_details').select('date_of_birth').eq('player_id', playerId).maybeSingle(),
    client.from('player_team_memberships').select('id,team_id,status,effective_from,effective_to,source,teams(name,slug,team_type,is_published,logo_url)').eq('player_id', playerId),
    client.from('match_player_participants').select('match_id,team_id,starter,minutes,matches(tournament_id,scheduled_at,status,venue)').eq('player_id', playerId),
    client.rpc('get_player_official_statistics', { p_player_id: playerId }),
    client.from('sport_milestones').select('id,label,milestone_type,state,reached_at,is_manual,source_match_id,team_id,tournament_id').eq('player_id', playerId),
    client.from('notifications').select('id,title,body,notification_type,state,channel,tournament_id,created_at,read_at').eq('recipient_id', userId).order('created_at', { ascending: false }).limit(20),
    client.from('player_correction_requests').select('id,subject,message,status,resolution_note,tournament_id,match_id,created_at,resolved_at').eq('player_id', playerId).order('created_at', { ascending: false }),
    client.from('player_team_requests').select('id,team_id,message,status,resolution_note,created_at,resolved_at,teams(name,slug)').eq('player_id', playerId).order('created_at', { ascending: false }),
    // claim_invitations has no tournament or state column; the state is derived below.
    client.from('claim_invitations').select('id,player_id,invited_email,expires_at,revoked_at,accepted_at,created_at,created_by').order('created_at', { ascending: false }),
    client.from('roster_submission_players').select('submission_id,shirt_number,position,roster_submissions(status,review_notes,tournament_entries(tournament_id,team_id,application_status,roster_status,submitted_at,teams(name,slug),tournaments(name,slug)))').eq('player_id', playerId),
    client.from('teams').select('id,name,slug,is_published').eq('is_published', true).order('name', { ascending: true }).limit(50),
  ])

  if (privateDetails.error) pendingSchema.push('Private details (date of birth)')
  if (history.error) unavailable.push('Team history')
  if (matches.error) unavailable.push('Match history')
  if (statistics.error) unavailable.push('Statistics')
  if (milestones.error) unavailable.push('Milestones')
  if (notifications.error) unavailable.push('Notifications')
  if (correctionRequests.error) {
    if (isMissingSchemaError(correctionRequests.error.message)) pendingSchema.push('Correction requests')
    else unavailable.push('Correction requests')
  }
  if (teamRequests.error) {
    if (isMissingSchemaError(teamRequests.error.message)) pendingSchema.push('Team join requests')
    else unavailable.push('Team join requests')
  }
  if (invitations.error) unavailable.push('Invitations')
  if (roster.error) unavailable.push('Roster status')
  if (teamDirectory.error) unavailable.push('Team directory')

  // Resolve published tournament names for the ids referenced by this player's
  // matches and statistics (public rows only; unpublished ones stay unnamed).
  const tournamentIds = new Set<string>()
  for (const row of [...(matches.data ?? []), ...(statistics.data ?? [])]) {
    const tournamentId = (row as Record<string, unknown>).tournament_id
    if (typeof tournamentId === 'string' && tournamentId) tournamentIds.add(tournamentId)
  }
  // Tournaments reached only through a roster entry (no confirmed match yet).
  for (const row of (roster.data ?? []) as Record<string, unknown>[]) {
    const submission = (Array.isArray(row.roster_submissions) ? row.roster_submissions[0] : row.roster_submissions) as Record<string, unknown> | null
    const entry = (Array.isArray(submission?.tournament_entries) ? submission?.tournament_entries[0] : submission?.tournament_entries) as Record<string, unknown> | null
    if (typeof entry?.tournament_id === 'string') tournamentIds.add(entry.tournament_id)
  }
  let tournaments: Record<string, unknown>[] = []
  if (tournamentIds.size > 0) {
    const tournamentResult = await client.from('tournaments').select('id,name,slug,sport,status,is_published').in('id', [...tournamentIds])
    if (!tournamentResult.error) tournaments = (tournamentResult.data ?? []) as Record<string, unknown>[]
  }

  return {
    data: {
      profile: profileResult.data as Record<string, unknown>,
      profileDetailsAvailable,
      privateDetails: privateDetails.error ? null : (privateDetails.data as Record<string, unknown> | null),
      teams: (history.data ?? []) as Record<string, unknown>[],
      matches: (matches.data ?? []) as Record<string, unknown>[],
      statistics: (statistics.data ?? []) as Record<string, unknown>[],
      milestones: (milestones.data ?? []) as Record<string, unknown>[],
      notifications: notifications.error ? null : (notifications.data ?? []) as Record<string, unknown>[],
      correctionRequests: correctionRequests.error ? null : (correctionRequests.data ?? []) as Record<string, unknown>[],
      teamRequests: teamRequests.error ? null : (teamRequests.data ?? []) as Record<string, unknown>[],
      claimInvitations: invitations.error ? null : ((invitations.data ?? []) as Record<string, unknown>[]).filter(row => row.created_by !== userId).map(row => ({ ...row, state: claimInvitationState(row) })),
      rosterRows: roster.error ? null : (roster.data ?? []) as Record<string, unknown>[],
      tournaments,
      teamDirectory: teamDirectory.error ? null : (teamDirectory.data ?? []) as Record<string, unknown>[],
      unavailable,
      pendingSchema,
    },
    error: null,
  }
}

export async function setPlayerPublication(client: SupabaseClient, userId: string, playerId: string, publish: boolean): Promise<{ error: string | null }> {
  const result = await client.from('player_profiles').update({ is_published: publish }).eq('id', playerId).eq('account_id', userId).select('id,is_published')
  if (result.error) return { error: /guardian_approval_required/.test(result.error.message) ? 'This profile belongs to a minor. A guardian must approve before it can be made public; ask the organizer who added you.' : result.error.message }
  if (!result.data?.length) return { error: 'No profile was changed. Only the signed-in owner of this player profile can publish or unpublish it.' }
  return { error: null }
}

export type ProfileEditFields = { display_name?: string; island?: string; photo_url?: string | null; nationality?: string | null; position?: string | null; sports?: string[] }

// Owner-scoped update of the player's own permitted profile details. The update
// is limited to id + account_id of the signed-in owner and to the editable keys.
export async function updatePlayerProfileDetails(client: SupabaseClient, userId: string, playerId: string, fields: ProfileEditFields): Promise<{ error: string | null }> {
  const patch: Record<string, unknown> = {}
  if (typeof fields.display_name === 'string') {
    const display_name = fields.display_name.trim()
    if (!display_name) return { error: 'Display name cannot be empty.' }
    patch.display_name = display_name
  }
  if (typeof fields.island === 'string') patch.island = fields.island.trim()
  if (typeof fields.photo_url === 'string') patch.photo_url = fields.photo_url.trim() || null
  if (typeof fields.nationality === 'string') patch.nationality = fields.nationality.trim() || null
  if (typeof fields.position === 'string') patch.position = fields.position.trim() || null
  if (Array.isArray(fields.sports)) patch.sports = fields.sports.map(sport => sport.trim()).filter(Boolean)
  if (Object.keys(patch).length === 0) return { error: 'No editable field was provided.' }
  const result = await client.from('player_profiles').update(patch).eq('id', playerId).eq('account_id', userId).select('id')
  if (result.error) return { error: result.error.message }
  if (!result.data?.length) return { error: 'No profile was changed. Only the signed-in owner of this player profile can edit it.' }
  return { error: null }
}

export async function submitCorrectionRequest(client: SupabaseClient, userId: string, playerId: string, input: { subject: string; message: string }): Promise<{ error: string | null }> {
  const subject = input.subject.trim(); const message = input.message.trim()
  if (!subject || !message) return { error: 'Both a subject and a message are required for a correction request.' }
  const result = await client.from('player_correction_requests').insert({ player_id: playerId, subject, message, created_by: userId }).select('id')
  if (result.error) return { error: result.error.message }
  return { error: null }
}

export async function submitTeamRequest(client: SupabaseClient, userId: string, playerId: string, teamId: string, message: string): Promise<{ error: string | null }> {
  if (!teamId) return { error: 'Choose the team you want to request to join.' }
  const result = await client.from('player_team_requests').insert({ player_id: playerId, team_id: teamId, message: message.trim() || null, created_by: userId }).select('id')
  if (result.error) return { error: result.error.message }
  return { error: null }
}

export async function markNotificationRead(client: SupabaseClient, userId: string, notificationId: string): Promise<{ error: string | null }> {
  const result = await client.from('notifications').update({ state: 'read', read_at: new Date().toISOString() }).eq('id', notificationId).eq('recipient_id', userId).select('id')
  if (result.error) return { error: result.error.message }
  if (!result.data?.length) return { error: 'No notification was changed. You can only mark your own notifications as read.' }
  return { error: null }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested): completion, attention, match split, filters.
// ---------------------------------------------------------------------------

export function profileCompletion(profile: Record<string, unknown>, hasTeam: boolean): { percent: number; completed: number; total: number; missing: string[] } {
  const items: Array<[string, boolean]> = [
    ['Display name', typeof profile.display_name === 'string' && profile.display_name.trim().length > 0],
    ['Island', typeof profile.island === 'string' && profile.island.trim().length > 0],
    ['Photo', typeof profile.photo_url === 'string' && profile.photo_url.trim().length > 0],
    ['Team membership', hasTeam],
    ['Claimed profile', profile.is_claimed === true],
  ]
  const completed = items.filter(([, done]) => done).length
  const missing = items.filter(([, done]) => !done).map(([label]) => label)
  return { completed, total: items.length, percent: Math.round((completed / items.length) * 100), missing }
}

export function attentionItems(input: { profile: Record<string, unknown>; completion: ReturnType<typeof profileCompletion>; unreadNotifications: number; pendingCorrections: number; pendingTeamRequests: number; unavailable: string[]; pendingSchema: string[] }): string[] {
  const items: string[] = []
  if (input.profile.is_claimed !== true) items.push('Claim your profile to confirm it belongs to you.')
  for (const missing of input.completion.missing) items.push(`Complete your profile: add ${missing.toLowerCase()}.`)
  if (input.profile.is_published !== true) items.push('Your profile is private. Publish it from My Profile when you are ready.')
  if (input.unreadNotifications > 0) items.push(`You have ${input.unreadNotifications} unread notification${input.unreadNotifications === 1 ? '' : 's'}.`)
  if (input.pendingCorrections > 0) items.push(`${input.pendingCorrections} correction request${input.pendingCorrections === 1 ? ' is' : 's are'} waiting for review.`)
  if (input.pendingTeamRequests > 0) items.push(`${input.pendingTeamRequests} team join request${input.pendingTeamRequests === 1 ? ' is' : 's are'} waiting for a team manager.`)
  if (input.unavailable.includes('Team history') || input.unavailable.includes('Match history') || input.unavailable.includes('Milestones')) items.push('Private history access is unavailable under the current RLS schema (pending reviewed player-workspace access migration).')
  if (input.pendingSchema.includes('Correction requests')) items.push('Correction requests become available once the reviewed profile-requests migration is applied.')
  return items
}

export function splitMatchesByTime(rows: Record<string, unknown>[], nowIso: string): { upcoming: Record<string, unknown>[]; past: Record<string, unknown>[] } {
  const upcoming: Record<string, unknown>[] = []; const past: Record<string, unknown>[] = []
  for (const row of rows) {
    const match = (row.matches ?? null) as Record<string, unknown> | null
    const scheduledAt = typeof match?.scheduled_at === 'string' ? match.scheduled_at : null
    const status = typeof match?.status === 'string' ? match.status : ''
    if (status === 'cancelled' || !scheduledAt) { past.push(row); continue }
    if (scheduledAt >= nowIso && status !== 'awaiting_confirmation') upcoming.push(row)
    else past.push(row)
  }
  return { upcoming, past }
}

export function aggregateTournamentStatistics(rows: Record<string, unknown>[]): Array<{ key: string; tournamentId: string | null; seasonId: string | null; sport: string; teamType: string; appearances: number; goals: number; assists: number; cards: number }> {
  const groups = new Map<string, { key: string; tournamentId: string | null; seasonId: string | null; sport: string; teamType: string; appearances: number; goals: number; assists: number; cards: number }>()
  for (const row of rows) {
    const tournamentId = typeof row.tournament_id === 'string' ? row.tournament_id : null
    const seasonId = typeof row.season_id === 'string' ? row.season_id : null
    const sport = typeof row.sport === 'string' ? row.sport : ''
    const teamType = typeof row.team_type === 'string' ? row.team_type : ''
    const key = `${tournamentId ?? 'none'}|${seasonId ?? 'none'}|${sport}|${teamType}`
    const group = groups.get(key) ?? { key, tournamentId, seasonId, sport, teamType, appearances: 0, goals: 0, assists: 0, cards: 0 }
    group.appearances += Number(row.appearances ?? 0)
    group.goals += Number(row.goals ?? 0)
    group.assists += Number(row.assists ?? 0)
    group.cards += Number(row.yellow_cards ?? 0) + Number(row.red_cards ?? 0)
    groups.set(key, group)
  }
  return [...groups.values()]
}

export function filterOfficialStatistics(rows: Record<string, unknown>[], filter: { tournamentId?: string; seasonId?: string; sport?: string }): Record<string, unknown>[] {
  return rows.filter(row => {
    if (filter.tournamentId && row.tournament_id !== filter.tournamentId) return false
    if (filter.seasonId && row.season_id !== filter.seasonId) return false
    if (filter.sport && row.sport !== filter.sport) return false
    return true
  })
}

export function claimInvitationState(row: Record<string, unknown>, now = new Date().toISOString()): 'accepted' | 'revoked' | 'expired' | 'pending' {
  if (row.accepted_at) return 'accepted'
  if (row.revoked_at) return 'revoked'
  if (typeof row.expires_at === 'string' && row.expires_at < now) return 'expired'
  return 'pending'
}

export function currentMembership(teams: Record<string, unknown>[]): Record<string, unknown> | null {
  const active = teams
    .filter(team => team.status === 'active')
    .sort((a, b) => String(b.effective_from ?? '').localeCompare(String(a.effective_from ?? '')))
  return active[0] ?? null
}

export function playerRatingFromStatistics(statistics: Record<string, unknown>[]): RatingResult {
  return computePlayerRating(totalOfficialStatistics(statistics))
}
