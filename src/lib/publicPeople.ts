import type { SupabaseClient } from '@supabase/supabase-js'

// Public coach and referee profiles (review-only migration 047). Only people
// who switched on their own public profile appear; counts and lists come from
// published records only.
export type PersonRole = 'coach' | 'referee'
export type PublicPerson = { publicId: string; name: string; island: string | null; bio: string | null; matchesOfficiated: number; teamsCoached: number }
export type PublicPersonDetail = {
  publicId: string; role: PersonRole; name: string; island: string | null; bio: string | null
  teams: Array<{ name: string; slug: string }>
  matches: Array<{ id: string; scheduledAt: string | null; tournament: string; tournamentSlug: string; home: string | null; away: string | null }>
}
export type MyPublicProfile = { role: PersonRole; eligible: boolean; publicId: string | null; name: string; island: string; bio: string; isPublic: boolean }

export const ROLE_LABELS: Record<PersonRole, { one: string; many: string }> = { coach: { one: 'Coach', many: 'Coaches' }, referee: { one: 'Referee', many: 'Referees' } }
export const PENDING_047 = 'Public coach and referee profiles become available once the platform owner applies update 047.'
const isPending = (message: string) => /does not exist|PGRST20\d|42883|42P01|schema cache|could not find/i.test(message)

export async function loadPublicPeople(client: SupabaseClient, role: PersonRole, search: string): Promise<{ data: PublicPerson[]; state: 'ready' | 'pending' | 'error' }> {
  const result = await client.rpc('get_public_people', { p_role: role, p_search: search.trim() || null, p_limit: 100, p_offset: 0 })
  if (result.error) return { data: [], state: isPending(result.error.message) ? 'pending' : 'error' }
  type Row = { public_id: string; display_name: string; island: string | null; bio: string | null; matches_officiated: number | string; teams_coached: number | string }
  return { state: 'ready', data: ((result.data ?? []) as Row[]).map(row => ({ publicId: row.public_id, name: row.display_name, island: row.island, bio: row.bio, matchesOfficiated: Number(row.matches_officiated ?? 0), teamsCoached: Number(row.teams_coached ?? 0) })) }
}

export async function loadPublicPerson(client: SupabaseClient, publicId: string): Promise<{ data: PublicPersonDetail | null; state: 'ready' | 'pending' | 'error' }> {
  if (!/^[0-9a-f-]{36}$/i.test(publicId)) return { data: null, state: 'ready' }
  const result = await client.rpc('get_public_person', { p_public_id: publicId })
  if (result.error) return { data: null, state: isPending(result.error.message) ? 'pending' : 'error' }
  const raw = result.data as null | { public_id: string; role: PersonRole; display_name: string; island: string | null; bio: string | null; teams?: Array<{ name: string; slug: string }>; matches?: Array<{ id: string; scheduled_at: string | null; tournament: string; tournament_slug: string; home: string | null; away: string | null }> }
  if (!raw) return { data: null, state: 'ready' }
  return {
    state: 'ready',
    data: {
      publicId: raw.public_id, role: raw.role, name: raw.display_name, island: raw.island, bio: raw.bio, teams: raw.teams ?? [],
      matches: (raw.matches ?? []).map(match => ({ id: match.id, scheduledAt: match.scheduled_at, tournament: match.tournament, tournamentSlug: match.tournament_slug, home: match.home, away: match.away })),
    },
  }
}

export async function loadMyPublicProfiles(client: SupabaseClient): Promise<{ data: MyPublicProfile[]; state: 'ready' | 'pending' | 'error' }> {
  const result = await client.rpc('get_my_public_person_profiles')
  if (result.error) return { data: [], state: isPending(result.error.message) ? 'pending' : 'error' }
  type Row = { role: PersonRole; eligible: boolean; public_id: string | null; display_name: string | null; island: string | null; bio: string | null; is_public: boolean }
  return { state: 'ready', data: ((result.data ?? []) as Row[]).map(row => ({ role: row.role, eligible: row.eligible, publicId: row.public_id, name: row.display_name ?? '', island: row.island ?? '', bio: row.bio ?? '', isPublic: row.is_public })) }
}

export async function saveMyPublicProfile(client: SupabaseClient, input: { role: PersonRole; isPublic: boolean; name: string; island: string; bio: string }): Promise<{ error: string | null }> {
  if (input.name.trim().length < 2) return { error: 'Enter the name to show publicly.' }
  const result = await client.rpc('save_public_person_profile', { p_role: input.role, p_is_public: input.isPublic, p_display_name: input.name.trim(), p_island: input.island.trim() || null, p_bio: input.bio.trim() || null })
  if (!result.error) return { error: null }
  if (isPending(result.error.message)) return { error: PENDING_047 }
  if (/role_not_held/.test(result.error.message)) return { error: input.role === 'coach' ? 'A public coach profile needs a coach role in a team.' : 'A public referee profile needs at least one match assignment as an official.' }
  return { error: 'Your public profile could not be saved. Please try again.' }
}
