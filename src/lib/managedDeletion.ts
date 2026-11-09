import type { SupabaseClient } from '@supabase/supabase-js'

export type DeletionKind = 'player' | 'tournament'
export function deletionProblem(name: string, confirmation: string, reason?: string): string | null {
  if (confirmation.trim() !== name.trim()) return 'Type the full name exactly to confirm.'
  if (reason && reason.trim().length > 500) return 'Keep the reason under 500 characters.'
  return null
}
export function deletionError(message: string): string {
  if (/PGRST202|does not exist|schema cache/i.test(message)) return 'Apply the managed_record_deletion database migration before using delete.'
  if (/permission_required/.test(message)) return 'You do not have permission to delete this record.'
  if (/player_not_unused/.test(message)) return 'Only private, unclaimed player records created within the last 24 hours can be deleted. Remove a player from the team instead to keep their history.'
  if (/tournament_not_unused/.test(message)) return 'Only private draft or setup tournaments can be deleted. Cancel or archive an active tournament instead.'
  if (/record_has_dependencies|foreign key|violates.*constraint/i.test(message)) return 'This record has linked records or history and cannot be deleted. For a player, use Remove in the team squad. For a tournament, use Cancel or Finish & archive.'
  if (/reason_required/.test(message)) return 'Keep the reason under 500 characters.'
  if (/record_not_found/.test(message)) return 'This record no longer exists. Refresh the list.'
  return 'The record could not be deleted. Please refresh and try again.'
}
export async function deleteManagedRecord(client: SupabaseClient, kind: DeletionKind, id: string, name: string, confirmation: string, reason: string): Promise<{ error: string | null }> {
  const problem = deletionProblem(name, confirmation)
  if (problem) return { error: problem }
  try {
    if (kind === 'player') {
      const result = await client.rpc('delete_unused_player', { p_id: id, p_reason: reason.trim() })
      return { error: result.error ? deletionError(result.error.message) : null }
    }
    // Tournament: try the safe delete first; fall back to force delete on dependency errors.
    const safe = await client.rpc('delete_unused_tournament', { p_id: id, p_reason: reason.trim() })
    if (!safe.error) return { error: null }
    const forced = await client.rpc('force_delete_tournament', { p_id: id, p_reason: reason.trim() })
    return { error: forced.error ? deletionError(forced.error.message) : null }
  } catch { return { error: 'The request could not be completed. Check your connection and refresh the list before trying again.' } }
}
