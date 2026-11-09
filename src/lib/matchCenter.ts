import type { SupabaseClient } from '@supabase/supabase-js'
import type { SyncOperation } from './matchOperations'
import { detectConflict, markConflict } from './matchOperations'

export const EVENT_TYPES: Record<string, string[]> = {
  football: ['goal', 'assist', 'yellow_card', 'red_card', 'substitution', 'own_goal', 'unassigned_goal', 'shootout_score'],
  futsal: ['goal', 'assist', 'yellow_card', 'red_card', 'substitution', 'team_foul', 'own_goal', 'unassigned_goal', 'shootout_score'],
  handball: ['goal', 'assist', 'yellow_card', 'red_card', 'blue_card', 'two_minute_suspension'],
  volleyball: ['point', 'ace', 'attack_point', 'block', 'dig', 'recorded_error'],
  basketball: ['one_point', 'two_point', 'three_point', 'rebound', 'assist', 'steal', 'block', 'foul'],
  basketball_3x3: ['one_point', 'two_point', 'rebound', 'assist', 'steal', 'block', 'foul'],
}

export async function recordMatchEvent(client: SupabaseClient, operation: SyncOperation): Promise<{ id: string | null; error: string | null }> {
  const payload = operation.payload; const result = await client.rpc('record_match_event', { p_match_id: operation.matchId, p_team_id: payload.teamId ?? null, p_player_id: payload.playerId ?? null, p_event_type: payload.eventType, p_event_minute: payload.minute ?? null, p_payload: payload, p_idempotency_key: operation.operationId, p_actor_id: operation.actorId })
  return { id: result.data as string | null, error: result.error?.message ?? null }
}

// Database refusals that will never succeed on retry. Anything else (network,
// timeout) leaves the operation queued so it replays on the next attempt.
const PERMANENT_REJECTIONS = ['match_already_confirmed', 'match_not_assigned', 'unsupported_event_type', 'actor_mismatch', 'result_not_allowed']

export function isPermanentRejection(message: string): boolean {
  return PERMANENT_REJECTIONS.some(code => message.includes(code))
}

// Only queued operations replay. A conflict waits for an explicit decision
// (keep against the current version, or discard) and is never resent blindly.
export async function replayOperations(client: SupabaseClient, operations: SyncOperation[], currentVersions: Record<string, number>): Promise<SyncOperation[]> {
  const next: SyncOperation[] = []
  for (const operation of operations) {
    if (operation.status !== 'queued') { next.push(operation); continue }
    const conflict = detectConflict(operation.baseResultVersion, currentVersions[operation.matchId] ?? 0)
    if (conflict) { next.push(markConflict(operation, conflict)); continue }
    const result = operation.operationType === 'event' ? await recordMatchEvent(client, operation) : await client.from('offline_sync_operations').insert({ match_id: operation.matchId, operation_id: operation.operationId, actor_id: operation.actorId, operation_type: operation.operationType, payload: operation.payload, base_result_version: operation.baseResultVersion, status: 'synced', synced_at: new Date().toISOString() })
    if (!result.error) { next.push({ ...operation, status: 'synced' }); continue }
    const message = typeof result.error === 'string' ? result.error : result.error.message
    next.push(isPermanentRejection(message) ? { ...operation, status: 'rejected', conflictReason: message } : operation)
  }
  return next
}

// Latest result version number for one match (any status), used as the base
// version when an event is queued and as the current version at replay. Null
// means it could not be read, and the caller must not invent a number.
export async function loadCurrentResultVersion(client: SupabaseClient, matchId: string): Promise<number | null> {
  const result = await client.from('match_result_versions').select('version').eq('match_id', matchId).order('version', { ascending: false }).limit(1)
  if (result.error) return null
  const row = (result.data ?? [])[0] as { version?: unknown } | undefined
  return row ? Number(row.version ?? 0) : 0
}

// Lineups (migration 025): who played, which drives appearances and minutes.
export type LineupCandidate = { playerId: string; teamId: string; name: string; shirtNumber: string | null }
export type LineupEntry = { playerId: string; teamId: string; starter: boolean; minutes: number | null }

export async function loadLineupCandidates(client: SupabaseClient, matchId: string): Promise<{ data: LineupCandidate[]; error: string | null }> {
  const result = await client.rpc('get_match_lineup_candidates', { p_match_id: matchId })
  if (result.error) return { data: [], error: result.error.message }
  const rows = (result.data ?? []) as Array<Record<string, unknown>>
  return { data: rows.map(row => ({ playerId: String(row.player_id), teamId: String(row.team_id), name: String(row.display_name ?? 'Player'), shirtNumber: row.shirt_number == null ? null : String(row.shirt_number) })), error: null }
}

export async function loadMatchLineup(client: SupabaseClient, matchId: string): Promise<{ data: LineupEntry[]; error: string | null }> {
  const result = await client.from('match_player_participants').select('player_id,team_id,starter,minutes').eq('match_id', matchId)
  if (result.error) return { data: [], error: result.error.message }
  return { data: ((result.data ?? []) as Array<Record<string, unknown>>).map(row => ({ playerId: String(row.player_id), teamId: String(row.team_id), starter: row.starter === true, minutes: typeof row.minutes === 'number' ? row.minutes : null })), error: null }
}

export async function recordMatchParticipants(client: SupabaseClient, matchId: string, lineup: LineupEntry[], actorId: string): Promise<{ count: number; error: string | null }> {
  const payload = lineup.map(entry => ({ player_id: entry.playerId, team_id: entry.teamId, starter: entry.starter, minutes: entry.minutes }))
  const result = await client.rpc('record_match_participants', { p_match_id: matchId, p_participants: payload, p_actor_id: actorId })
  return { count: typeof result.data === 'number' ? result.data : 0, error: result.error?.message ?? null }
}

export async function submitMatchResult(client: SupabaseClient, matchId: string, score: Record<string, unknown>, actorId: string) { return client.rpc('submit_match_result', { p_match_id: matchId, p_score: score, p_actor_id: actorId }) }
export async function confirmMatchResult(client: SupabaseClient, resultId: string, actorId: string) { return client.rpc('confirm_match_result', { p_result_id: resultId, p_actor_id: actorId }) }
export async function correctMatchResult(client: SupabaseClient, matchId: string, score: Record<string, unknown>, reason: string, actorId: string) { return client.rpc('correct_match_result', { p_match_id: matchId, p_score: score, p_reason: reason, p_actor_id: actorId }) }

// Half-time and Finished while live (review-only migration 045). A missing
// function only means the phase is shown on this device until the owner applies it.
export async function setMatchPhase(client: SupabaseClient, matchId: string, phase: 'first_half' | 'half_time' | 'second_half' | 'extra_time' | 'penalties' | 'finished'): Promise<{ error: string | null; pending: boolean }> {
  const result = await client.rpc('set_match_phase', { p_match: matchId, p_phase: phase })
  if (!result.error) return { error: null, pending: false }
  if (/does not exist|PGRST20\d|42883|schema cache|could not find/i.test(result.error.message)) return { error: null, pending: true }
  if (result.error.message.includes('match_not_live')) return { error: null, pending: true }
  return { error: 'The match phase could not be saved. The score is still kept on this device.', pending: false }
}

// Simple Match Center "Start Match" (review-only migration 042). Until the
// owner applies it the match is still played and scored in the browser; only the
// public "Live" status waits, so a missing function is reported, not an error.
export async function setMatchLive(client: SupabaseClient, matchId: string, live: boolean): Promise<{ error: string | null; pending: boolean }> {
  const result = await client.rpc('set_match_live', { p_match: matchId, p_live: live })
  if (!result.error) return { error: null, pending: false }
  if (/does not exist|PGRST20\d|42883|schema cache|could not find/i.test(result.error.message)) return { error: null, pending: true }
  if (result.error.message.includes('match_not_startable')) return { error: 'This match cannot be started from its current status.', pending: false }
  if (result.error.message.includes('result_already_submitted')) return { error: 'A result is already submitted for this match.', pending: false }
  return { error: 'The match status could not be changed. Please try again.', pending: false }
}
