import type { SupabaseClient } from '@supabase/supabase-js'

// Suspensions (review-only migration 044). Automatic suspensions come only from
// cards in confirmed matches; manual ones and overturning need a reason. Until
// the owner applies 044 every call reports 'pending' instead of an error.
export type Suspension = {
  id: string; playerId: string; playerName: string; teamId: string | null; reason: 'red_card' | 'yellow_cards' | 'manual'
  matchesBanned: number; status: 'active' | 'served' | 'overturned'; note: string | null; createdAt: string; resolutionReason: string | null
}
export const SUSPENSION_REASONS: Record<Suspension['reason'], string> = { red_card: 'Red card', yellow_cards: 'Yellow cards added up', manual: 'Organizer decision' }

const isPending = (message: string) => /does not exist|PGRST20\d|42883|42P01|schema cache|could not find/i.test(message)
const problem = (message: string) => /reason_required/.test(message) ? 'Give a reason of at least five characters.'
  : /organizer_permission_required/.test(message) ? 'Only this tournament’s organizers can change suspensions.'
    : /invalid_matches/.test(message) ? 'A suspension lasts between 1 and 20 matches.'
      : 'This could not be saved. Please try again.'

export async function loadSuspensions(client: SupabaseClient, tournamentId: string): Promise<{ data: Suspension[]; state: 'ready' | 'pending' | 'error' }> {
  const result = await client.from('player_suspensions').select('id,player_id,team_id,reason,matches_banned,status,note,created_at,resolution_reason,player_profiles(display_name)').eq('tournament_id', tournamentId).order('created_at', { ascending: false })
  if (result.error) return { data: [], state: isPending(result.error.message) ? 'pending' : 'error' }
  type Row = { id: string; player_id: string; team_id: string | null; reason: Suspension['reason']; matches_banned: number; status: Suspension['status']; note: string | null; created_at: string; resolution_reason: string | null; player_profiles: { display_name?: string } | Array<{ display_name?: string }> | null }
  return {
    state: 'ready',
    data: ((result.data ?? []) as Row[]).map(row => {
      const profile = Array.isArray(row.player_profiles) ? row.player_profiles[0] : row.player_profiles
      return { id: row.id, playerId: row.player_id, playerName: profile?.display_name ?? 'Player', teamId: row.team_id, reason: row.reason, matchesBanned: row.matches_banned, status: row.status, note: row.note, createdAt: row.created_at, resolutionReason: row.resolution_reason }
    }),
  }
}

export async function refreshSuspensions(client: SupabaseClient, tournamentId: string): Promise<{ added: number; error: string | null; pending: boolean }> {
  const result = await client.rpc('refresh_tournament_suspensions', { p_tournament: tournamentId })
  if (!result.error) return { added: Number(result.data ?? 0), error: null, pending: false }
  if (isPending(result.error.message)) return { added: 0, error: null, pending: true }
  return { added: 0, error: problem(result.error.message), pending: false }
}

export async function addSuspension(client: SupabaseClient, input: { tournamentId: string; playerId: string; teamId: string | null; matches: number; note: string }): Promise<{ error: string | null }> {
  if (input.note.trim().length < 5) return { error: problem('reason_required') }
  const result = await client.rpc('add_player_suspension', { p_tournament: input.tournamentId, p_player: input.playerId, p_team: input.teamId, p_matches: input.matches, p_note: input.note.trim() })
  return { error: result.error ? (isPending(result.error.message) ? 'Suspensions become available once the platform owner applies update 044.' : problem(result.error.message)) : null }
}

export async function resolveSuspension(client: SupabaseClient, id: string, status: 'served' | 'overturned', reason: string): Promise<{ error: string | null }> {
  if (reason.trim().length < 5) return { error: problem('reason_required') }
  const result = await client.rpc('resolve_player_suspension', { p_suspension: id, p_status: status, p_reason: reason.trim() })
  return { error: result.error ? problem(result.error.message) : null }
}

// Players who may not play the next match: active suspensions only.
export function suspendedPlayerIds(list: Suspension[]): Set<string> {
  return new Set(list.filter(item => item.status === 'active').map(item => item.playerId))
}
