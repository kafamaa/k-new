import type { SupabaseClient } from '@supabase/supabase-js'

export type StaffPermission = 'registration' | 'finance' | 'media' | 'operations' | 'match_data'
export const STAFF_PERMISSIONS: StaffPermission[] = ['registration', 'finance', 'media', 'operations', 'match_data']

export function canAssignStaff(role?: string): boolean { return role === 'owner' || role === 'operations' }
export async function assignTournamentStaff(client: SupabaseClient, tournamentId: string, userId: string, permission: StaffPermission, assignedBy: string) {
  if (!STAFF_PERMISSIONS.includes(permission)) return { error: 'Unsupported staff permission.' }
  const result = await client.from('tournament_staff_assignments').upsert({ tournament_id: tournamentId, user_id: userId, permission, assigned_by: assignedBy })
  return { error: result.error?.message ?? null }
}
export async function revokeTournamentStaff(client: SupabaseClient, tournamentId: string, userId: string, permission: StaffPermission) {
  const result = await client.from('tournament_staff_assignments').delete().eq('tournament_id', tournamentId).eq('user_id', userId).eq('permission', permission)
  return { error: result.error?.message ?? null }
}

// Plain-English role names for the tournament staff table. "operations" is the
// closest thing to a tournament manager (`is_tournament_operator` grants full
// workflow access under that label), but the true role is the operator's
// organization membership - staff assignments only ADD task scopes.
export type StaffRoleView = { label: string; access: string; summary: (tournamentName: string) => string; bullets: (tournamentName: string) => string[] }
export const TOURNAMENT_STAFF_ROLES: Record<StaffPermission, StaffRoleView> = {
  operations: {
    label: 'Tournament Manager', access: 'Full tournament access',
    summary: name => `Can manage every part of ${name}: setup, applications, teams, matches and results.`,
    bullets: name => ['Full tournament workflow', 'Applications, teams and matches', `${name} only`],
  },
  registration: {
    label: 'Registration Officer', access: 'Applications and rosters',
    summary: name => `Can review applications and rosters for ${name}.`,
    bullets: name => ['Review applications', 'Review team rosters', `${name} only`],
  },
  match_data: {
    label: 'Match Operator', access: 'Scores for assigned matches',
    summary: name => `Can record and confirm scores for matches in ${name}.`,
    bullets: name => ['Record match scores', 'Confirm match results', `${name} only`],
  },
  finance: {
    label: 'Finance Officer', access: 'Expenses and fee records',
    summary: name => `Can record MVR expenses and fee records for ${name}.`,
    bullets: name => ['Record MVR expenses', 'Update fee record status', `${name} only`],
  },
  media: {
    label: 'Media Officer', access: 'Photos and media documents',
    summary: name => `Can attach photos and official media documents for ${name}.`,
    bullets: name => ['Attach team photos', 'Attach official documents', `${name} only`],
  },
}

export type TournamentStaffRow = {
  userId: string
  permission: StaffPermission
  assignedBy: string
  createdAt: string
  name: string | null
}

// The staff list for a tournament: assignment rows plus real names resolved
// from published player profiles. Profiles are NOT readable for other users
// (RLS allows only each person's own row), so a member without a public
// published profile shows "No public profile" with the short id - the name is
// never invented.
export async function loadTournamentStaff(client: SupabaseClient, tournamentId: string) {
  const rows = await client
    .from('tournament_staff_assignments')
    .select('user_id,permission,assigned_by,created_at')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: true })
  if (rows.error) return { staff: [] as TournamentStaffRow[], error: rows.error.message }
  const staff: TournamentStaffRow[] = (rows.data ?? []).map(row => ({
    userId: row.user_id,
    permission: row.permission as StaffPermission,
    assignedBy: row.assigned_by,
    createdAt: row.created_at,
    name: null,
  }))
  const ids = [...new Set(staff.map(row => row.userId))]
  if (ids.length > 0) {
    const people = await client
      .from('player_profiles')
      .select('display_name,account_id')
      .in('account_id', ids)
      .eq('is_published', true)
    if (!people.error) {
      const names = new Map<string, string>()
      for (const person of people.data ?? []) names.set(person.account_id, person.display_name)
      for (const row of staff) row.name = names.get(row.userId) ?? null
    }
  }
  return { staff, error: null }
}

// People search for the invitation panel. The platform never exposes other
// users' emails (auth emails are private, profiles hold only display names),
// so searching by email is not possible; name search covers published player
// profiles with a linked account - honestly stated in the panel.
export type StaffCandidate = { name: string; slug: string; accountId: string }
export async function searchStaffCandidates(client: SupabaseClient, query: string) {
  const trimmed = query.trim()
  if (trimmed.length < 2) return { candidates: [] as StaffCandidate[], error: null }
  const safe = trimmed.replace(/[%_,()]/g, '')
  if (safe.trim().length < 2) return { candidates: [] as StaffCandidate[], error: null }
  const result = await client
    .from('player_profiles')
    .select('display_name,slug,account_id')
    .eq('is_published', true)
    .not('account_id', 'is', null)
    .ilike('display_name', `%${safe}%`)
    .limit(8)
  const candidates = (result.data ?? []).filter(person => person.account_id && person.account_id !== '').map(person => ({
    name: person.display_name,
    slug: person.slug,
    accountId: person.account_id,
  }))
  return { candidates, error: result.error?.message ?? null }
}
