import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Sponsors and match officials, available at any point after creation.
//
// Sponsors live in the tournament's setup-step row 10 ("Finance and sponsors"),
// which the nine-stage wizard retired but kept as real data for this module,
// under the existing "operators manage setup steps" policy. Officials are
// match_official_assignments rows ("operators manage assignments").
// ---------------------------------------------------------------------------

export const SPONSOR_STEP = 10
export type Sponsor = { name: string; tier: string; website: string }
export const SPONSOR_TIERS = ['Title sponsor', 'Gold', 'Silver', 'Partner', 'Supporter'] as const

export async function loadSponsors(client: SupabaseClient, tournamentId: string): Promise<{ data: Sponsor[]; error: string | null }> {
  const result = await client.from('tournament_setup_steps').select('data').eq('tournament_id', tournamentId).eq('step_number', SPONSOR_STEP).maybeSingle()
  if (result.error) return { data: [], error: result.error.message }
  const raw = (result.data?.data as { sponsors?: unknown } | undefined)?.sponsors
  return { data: Array.isArray(raw) ? raw.map(item => item as Record<string, unknown>).map(item => ({ name: String(item.name ?? ''), tier: String(item.tier ?? 'Partner'), website: String(item.website ?? '') })).filter(item => item.name) : [], error: null }
}

export function validateSponsor(sponsor: Sponsor): string | null {
  if (!sponsor.name.trim()) return 'Enter the sponsor name.'
  if (sponsor.website.trim() && !/^https:\/\/\S+$/i.test(sponsor.website.trim())) return 'Sponsor websites must start with https://.'
  return null
}

export async function saveSponsors(client: SupabaseClient, tournamentId: string, userId: string, sponsors: Sponsor[]): Promise<{ error: string | null }> {
  const existing = await client.from('tournament_setup_steps').select('data,status').eq('tournament_id', tournamentId).eq('step_number', SPONSOR_STEP).maybeSingle()
  if (existing.error) return { error: existing.error.message }
  const data = { ...((existing.data?.data as Record<string, unknown> | undefined) ?? {}), sponsors: sponsors.map(item => ({ name: item.name.trim(), tier: item.tier, website: item.website.trim() })) }
  const result = await client.from('tournament_setup_steps').upsert({ tournament_id: tournamentId, step_number: SPONSOR_STEP, status: existing.data?.status ?? 'in_progress', data, updated_by: userId, updated_at: new Date().toISOString() })
  return { error: result.error?.message ?? null }
}

export type MatchOfficial = { matchId: string; userId: string; role: string; name: string | null }
export const OFFICIAL_ROLES = [{ value: 'official', label: 'Match official' }, { value: 'reviewer', label: 'Result reviewer' }, { value: 'staff', label: 'Match staff' }] as const

export async function loadMatchOfficials(client: SupabaseClient, matchIds: string[]): Promise<{ data: MatchOfficial[]; error: string | null }> {
  if (matchIds.length === 0) return { data: [], error: null }
  const result = await client.from('match_official_assignments').select('match_id,user_id,role').in('match_id', matchIds)
  if (result.error) return { data: [], error: result.error.message }
  const rows = (result.data ?? []) as Array<Record<string, unknown>>
  const ids = [...new Set(rows.map(row => String(row.user_id)))]
  const names = new Map<string, string>()
  if (ids.length) {
    // Names come only from published player profiles; anyone else stays unnamed.
    const people = await client.from('player_profiles').select('display_name,account_id').in('account_id', ids).eq('is_published', true)
    for (const person of (people.data ?? []) as Array<Record<string, unknown>>) names.set(String(person.account_id), String(person.display_name ?? ''))
  }
  return { data: rows.map(row => ({ matchId: String(row.match_id), userId: String(row.user_id), role: String(row.role), name: names.get(String(row.user_id)) ?? null })), error: null }
}

export async function assignMatchOfficial(client: SupabaseClient, matchId: string, userId: string, role: string, assignedBy: string): Promise<{ error: string | null }> {
  const result = await client.from('match_official_assignments').insert({ match_id: matchId, user_id: userId, role, assigned_by: assignedBy })
  if (result.error) return { error: /duplicate|unique/i.test(result.error.message) ? 'This person already has that role for the match.' : result.error.message }
  return { error: null }
}

export async function removeMatchOfficial(client: SupabaseClient, matchId: string, userId: string, role: string): Promise<{ error: string | null }> {
  const result = await client.from('match_official_assignments').delete().eq('match_id', matchId).eq('user_id', userId).eq('role', role)
  return { error: result.error?.message ?? null }
}
