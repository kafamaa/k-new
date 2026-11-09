import type { SupabaseClient } from '@supabase/supabase-js'
import { DIRECTORY_PAGE_SIZE, rpc } from './superAdmin'
import { csvCell } from './csvSafe'

// Super Admin, Release Two (migration 202611010035): two-person critical actions,
// frozen results, case requesters, finance audit, notification operations and
// the media library. The database checks every permission.

export type ActionType = 'result_correction' | 'result_restore' | 'player_merge'
export const ACTION_LABELS: Record<ActionType, string> = { result_correction: 'Exceptional result correction', result_restore: 'Restore an earlier result', player_merge: 'Duplicate player merge' }
export type ActionRequest = {
  id: string; reference: string; action_type: ActionType; target_label: string | null; payload: Record<string, unknown>; reason: string; status: string
  proposed_by_me: boolean; proposed_by_name: string | null; decided_by_name: string | null; decision_note: string | null; result: Record<string, unknown> | null; created_at: string; decided_at: string | null; total: number
}
export const listActions = (client: SupabaseClient, status: string, page: number) => rpc<ActionRequest[]>(client, 'admin_list_actions', { p_status: status, p_limit: DIRECTORY_PAGE_SIZE, p_offset: page * DIRECTORY_PAGE_SIZE }, [])
export const proposeAction = (client: SupabaseClient, type: ActionType, payload: Record<string, unknown>, reason: string) => rpc<string | null>(client, 'admin_propose_action', { p_type: type, p_payload: payload, p_reason: reason, p_case: null }, null)
export const decideAction = (client: SupabaseClient, id: string, approve: boolean, note: string) => rpc<Record<string, unknown>>(client, 'admin_decide_action', { p_id: id, p_approve: approve, p_note: note }, {})
export const cancelAction = (client: SupabaseClient, id: string, reason: string) => rpc<null>(client, 'admin_cancel_action', { p_id: id, p_reason: reason }, null)

// What an approved action did, in words (no identifiers).
export function actionOutcome(request: Pick<ActionRequest, 'action_type' | 'result'>): string | null {
  const result = request.result
  if (!result) return null
  if (request.action_type === 'player_merge') return `Moved ${Number(result.matches ?? 0)} match appearance(s), ${Number(result.memberships ?? 0)} team membership(s), ${Number(result.events ?? 0)} match event(s) and ${Number(result.milestones ?? 0)} milestone(s); recalculated ${Number(result.recalculatedMatches ?? 0)} match(es).`
  return result.version ? `Published as result version ${Number(result.version)}; standings and milestones recalculated.` : null
}

export type MatchVersion = { version: number; status: string; home: number | null; away: number | null; correction_reason: string | null; created_at: string; frozen: boolean }
export const loadMatchVersions = (client: SupabaseClient, matchId: string) => rpc<MatchVersion[]>(client, 'admin_match_versions', { p_match: matchId }, [])
export const freezeResult = (client: SupabaseClient, matchId: string, freeze: boolean, reason: string) => rpc<null>(client, 'admin_freeze_result', { p_match: matchId, p_freeze: freeze, p_reason: reason, p_case: null }, null)

export type PlayerHit = { id: string; display_name: string; public_code: string | null; island: string | null; claimed: boolean; published: boolean; merged: boolean }
export const findPlayers = (client: SupabaseClient, query: string) => rpc<PlayerHit[]>(client, 'admin_find_players', { p_query: query }, [])
export type MergePreview = {
  canonical: { name: string; code: string | null; claimed: boolean; published: boolean }; duplicate: { name: string; code: string | null; claimed: boolean; published: boolean }
  memberships: number; rosters: number; matches: number; events: number; milestones: number; availability: number; blockers: string[]; warnings: string[]
}
export const previewMerge = (client: SupabaseClient, canonicalId: string, duplicateId: string) => rpc<MergePreview | null>(client, 'admin_merge_preview', { p_canonical: canonicalId, p_duplicate: duplicateId }, null)
export const MERGE_PROBLEMS: Record<string, string> = {
  same_profile: 'Choose two different profiles.',
  already_merged: 'One of these profiles was already merged.',
  both_claimed: 'Both profiles are claimed by different accounts. Resolve the claim dispute first.',
  duplicate_is_claimed: 'The duplicate is the claimed profile. Choose it as the profile to keep.',
  both_have_identity: 'Both profiles have a verified identity. Resolve this as an identity conflict first.',
  duplicate_has_identity: 'The duplicate holds the verified identity. Choose it as the profile to keep.',
  same_match: 'Both profiles played in the same match, so merging would count it twice.',
  same_roster: 'Both profiles are on the same tournament roster.',
  minor_flag_differs: 'One profile is marked as a minor and the other is not.',
  names_differ: 'The names differ. Check this is the same person.',
}

export const setCaseRequester = (client: SupabaseClient, caseId: string, email: string, reason: string) => rpc<null>(client, 'admin_set_case_requester', { p_case: caseId, p_email: email, p_reason: reason }, null)

export type FinanceKind = 'tournament_payment' | 'finance_expense' | 'finance_adjustment' | 'team_finance'
export const FINANCE_KINDS: Record<FinanceKind, string> = { tournament_payment: 'Tournament payments', finance_expense: 'Organization expenses', finance_adjustment: 'Refunds and waivers', team_finance: 'Team finance' }
export type FinanceRow = { record_id: string; amount_mvr: number; record_status: string; related: string; actor: string | null; description: string | null; has_receipt: boolean; created_at: string; finding_status: string | null; finding_reason: string | null; total: number }
export const loadFinance = (client: SupabaseClient, kind: FinanceKind, filter: string, page: number) => rpc<FinanceRow[]>(client, 'admin_finance_records', { p_kind: kind, p_filter: filter, p_limit: DIRECTORY_PAGE_SIZE, p_offset: page * DIRECTORY_PAGE_SIZE }, [])
export const financeFinding = (client: SupabaseClient, kind: FinanceKind, recordId: string, action: 'flag' | 'freeze' | 'unfreeze' | 'close', reason: string) =>
  rpc<null>(client, 'admin_finance_finding', { p_kind: kind, p_record: recordId, p_action: action, p_reason: reason, p_case: null }, null)
export const recordFinanceExport = (client: SupabaseClient, kind: FinanceKind, rows: number, reason: string) => rpc<null>(client, 'admin_record_finance_export', { p_kind: kind, p_rows: rows, p_reason: reason }, null)
export const formatMvr = (amount: number) => `MVR ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function financeCsv(rows: FinanceRow[]): string {
  const header = ['Date', 'Amount (MVR)', 'Status', 'Related', 'By', 'Description', 'Receipt', 'Finding']
  return [header.map(csvCell).join(','), ...rows.map(row => [row.created_at, Number(row.amount_mvr).toFixed(2), row.record_status, row.related, row.actor ?? '', row.description ?? '', row.has_receipt ? 'Yes' : 'No', row.finding_status ?? ''].map(csvCell).join(','))].join('\r\n')
}

export type DeliveryRow = { delivery_id: string; channel: string; state: string; attempts: number; problem: string | null; created_at: string; delivered_at: string | null; notification_type: string; title: string; total: number }
export const loadDeliveries = (client: SupabaseClient, state: string, page: number) => rpc<DeliveryRow[]>(client, 'admin_list_deliveries', { p_state: state, p_limit: DIRECTORY_PAGE_SIZE, p_offset: page * DIRECTORY_PAGE_SIZE }, [])
export const retryDelivery = (client: SupabaseClient, id: string, reason: string) => rpc<null>(client, 'admin_retry_delivery', { p_delivery: id, p_reason: reason }, null)

export type MediaAsset = { id: string; path: string; kind: string; alt_text: string; tags: string[]; mime: string; size_bytes: number; width: number | null; height: number | null; archived: boolean; in_use: boolean; created_at: string }
export const MEDIA_FOLDERS = ['brand', 'hero', 'backgrounds', 'sports', 'covers', 'icons', 'email', 'pwa', 'social', 'help'] as const
export const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024
export const listMedia = (client: SupabaseClient, query: string, archived: boolean) => rpc<MediaAsset[]>(client, 'admin_list_media', { p_query: query || null, p_include_archived: archived }, [])
export const mediaUrl = (client: SupabaseClient, path: string) => client.storage.from('platform-media').getPublicUrl(path).data.publicUrl
// Safe storage name: folder/date-random-name.ext, matching the server's path rule.
export function mediaPath(folder: string, fileName: string, now = new Date()): string {
  const extension = (fileName.match(/\.(png|jpe?g|webp)$/i)?.[1] ?? 'png').toLowerCase().replace('jpeg', 'jpg')
  const base = fileName.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'image'
  return `${folder}/${now.toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}-${base}.${extension}`
}
