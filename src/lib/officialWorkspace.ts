import type { SupabaseClient } from '@supabase/supabase-js'
import { statusLabel } from './i18n'

// ---------------------------------------------------------------------------
// Official / match-staff workspace data layer.
//
// Reads only the caller's own assignments (self-scoped policies from
// review-only migration 202610240021). On a database without that migration
// both reads return zero rows and the workspace shows its honest
// "no assignments" state — never an error the workspace cannot explain.
// Match rows resolve through "assigned officials read matches"
// (is_match_participant), so officials see only their matches plus public
// tournament labels, never unrelated tournament records.
// ---------------------------------------------------------------------------

export type AssignedMatch = {
  assignmentRole: string
  assignedAt: string | null
  match: { id: string; status: string; scheduledAt: string | null; venue: string | null; tournamentName: string; tournamentSlug: string; tournamentSport: string; homeTeamId?: string | null; awayTeamId?: string | null }
}

export type AssignedTournament = {
  tournamentId: string
  name: string
  slug: string
  status: string
  permission: string
  assignedAt: string | null
}

const MATCH_FIELDS = 'id,tournament_id,home_team_id,away_team_id,scheduled_at,venue,status,tournaments(name,slug,sport)'

export async function loadOfficialWorkspace(client: SupabaseClient, userId: string): Promise<{ matches: AssignedMatch[]; tournaments: AssignedTournament[]; availability: Record<string, unknown> | null; unavailable: string[]; error: string | null }> {
  const [assignments, staff, availability] = await Promise.all([
    client.from('match_official_assignments').select(`match_id,role,created_at,matches(${MATCH_FIELDS})`).eq('user_id', userId).order('created_at', { ascending: false }),
    client.from('tournament_staff_assignments').select('tournament_id,permission,created_at,tournaments(id,name,slug,status)').eq('user_id', userId).order('created_at', { ascending: false }),
    client.from('official_availability').select('available_from,available_to,note,updated_at').eq('user_id', userId).maybeSingle(),
  ])
  if (assignments.error || staff.error) return { matches: [], tournaments: [], availability: null, unavailable: [], error: assignments.error?.message ?? staff.error?.message ?? null }
  const matches: AssignedMatch[] = (assignments.data ?? []).flatMap(row => {
    const match = Array.isArray(row.matches) ? row.matches[0] : row.matches
    if (!match) return []
    const rawTournaments = match.tournaments as unknown
    const tournament = Array.isArray(rawTournaments) ? (rawTournaments[0] as Record<string, unknown> | null) : (rawTournaments as Record<string, unknown> | null)
    return [{
      assignmentRole: String(row.role ?? ''),
      assignedAt: typeof row.created_at === 'string' ? row.created_at : null,
      match: {
        id: String(match.id ?? ''), status: String(match.status ?? ''),
        scheduledAt: typeof match.scheduled_at === 'string' ? match.scheduled_at : null,
        venue: typeof match.venue === 'string' ? match.venue : null,
        tournamentName: String(tournament?.name ?? ''),
        tournamentSlug: String(tournament?.slug ?? ''),
        tournamentSport: String(tournament?.sport ?? ''),
        homeTeamId: typeof match.home_team_id === 'string' ? match.home_team_id : null,
        awayTeamId: typeof match.away_team_id === 'string' ? match.away_team_id : null,
      },
    }]
  })
  const tournaments: AssignedTournament[] = (staff.data ?? []).flatMap(row => {
    const tournament = Array.isArray(row.tournaments) ? row.tournaments[0] : row.tournaments
    if (!tournament || !tournament.name) return []
    return [{
      tournamentId: String(row.tournament_id ?? ''),
      name: String(tournament.name),
      slug: String(tournament.slug ?? ''),
      status: String(tournament.status ?? ''),
      permission: String(row.permission ?? ''),
      assignedAt: typeof row.created_at === 'string' ? row.created_at : null,
    }]
  })
  return { matches, tournaments, availability: (availability.data ?? null) as Record<string, unknown> | null, unavailable: [], error: null }
}

export async function saveAvailability(client: SupabaseClient, userId: string, input: { availableFrom: string; availableTo: string; note: string }): Promise<{ error: string | null }> {
  const problem = validateAvailability(input)
  if (problem) return { error: problem }
  const patch = {
    user_id: userId,
    available_from: input.availableFrom ? input.availableFrom : null,
    available_to: input.availableTo ? input.availableTo : null,
    note: input.note.trim().slice(0, 400) || null,
    updated_at: new Date().toISOString(),
  }
  const result = await client.from('official_availability').upsert(patch, { onConflict: 'user_id' }).select('user_id')
  if (result.error) {
    if (/row-level security/i.test(result.error.message)) return { error: 'Availability storage is not active yet: migration 202610240021 is not applied. Your availability was not saved.' }
    return { error: result.error.message }
  }
  return { error: null }
}

export function validateAvailability(input: { availableFrom: string; availableTo: string; note?: string }): string | null {
  const from = input.availableFrom ? new Date(`${input.availableFrom}T00:00:00Z`) : null
  const to = input.availableTo ? new Date(`${input.availableTo}T00:00:00Z`) : null
  if (!from && !to && !(input.note ?? '').trim()) return 'Enter at least one date or a note, or leave the form empty to clear availability.'
  if (from && Number.isNaN(from.getTime())) return 'Available-from date is invalid.'
  if (to && Number.isNaN(to.getTime())) return 'Available-to date is invalid.'
  if (from && to && from.getTime() > to.getTime()) return 'Available-to must not be earlier than available-from.'
  return null
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

export const OFFICIAL_ROLE_LABELS: Record<string, string> = { official: 'Official', reviewer: 'Result reviewer', staff: 'Match staff' }

export function officialRoleLabel(role: string): string {
  return OFFICIAL_ROLE_LABELS[role] ?? 'Assigned role'
}

export const MATCH_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled', live: 'Live', awaiting_confirmation: 'Awaiting confirmation', confirmed: 'Official',
  postponed: 'Postponed', abandoned: 'Abandoned', cancelled: 'Cancelled',
}

export function assignedMatchStatusLabel(status: string): string {
  return MATCH_STATUS_LABELS[status] ? statusLabel('match', status, MATCH_STATUS_LABELS[status]) : 'Status not published'
}

export function splitAssignedMatches(rows: AssignedMatch[], nowIso: string): { upcoming: AssignedMatch[]; past: AssignedMatch[] } {
  const now = new Date(nowIso).getTime()
  const upcoming: AssignedMatch[] = []
  const past: AssignedMatch[] = []
  for (const row of rows) {
    const concluded = ['confirmed', 'abandoned', 'cancelled', 'postponed', 'awaiting_confirmation'].includes(row.match.status)
    const scheduledTime = row.match.scheduledAt ? new Date(row.match.scheduledAt).getTime() : NaN
    const timeGone = !Number.isNaN(scheduledTime) && scheduledTime <= now
    if (concluded || timeGone) past.push(row)
    else upcoming.push(row)
  }
  return { upcoming, past }
}

export const STAFF_PERMISSION_LABELS: Record<string, string> = {
  registration: 'Registration staff', finance: 'Finance staff', media: 'Media staff', operations: 'Operations staff', match_data: 'Match-data staff',
}

export function staffPermissionLabel(permission: string): string {
  return STAFF_PERMISSION_LABELS[permission] ?? permission
}
