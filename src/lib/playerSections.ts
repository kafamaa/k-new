import type { SupabaseClient } from '@supabase/supabase-js'
import type { CardStyle } from './cardImage'
import { documentLimit, sizeLabel } from './appConfig'

// ---------------------------------------------------------------------------
// Player workspace sections (migration 029): team invitations, documents with
// review status, trophy visibility, notifications and the card style. Every
// write goes through the player's own session; the database checks ownership.
// ---------------------------------------------------------------------------

const missing = (message: string) => /does not exist|42P01|42703|schema cache|PGRST20\d|Could not find/i.test(message)
export const NEEDS_029 = 'This section needs migration 029 to be applied.'

// --- Team invitations ---------------------------------------------------------
export type TeamInvitation = { id: string; teamId: string; teamName: string; teamSlug: string | null; teamLogo: string | null; message: string | null; position: string | null; jerseyNumber: number | null; status: string; createdAt: string; expiresAt: string | null; responseNote: string | null }

export async function loadTeamInvitations(client: SupabaseClient, playerId: string): Promise<{ data: TeamInvitation[]; error: string | null }> {
  const result = await client.from('player_team_invitations').select('id,team_id,message,position,jersey_number,status,created_at,expires_at,response_note,teams(name,slug,logo_url)').eq('player_id', playerId).order('created_at', { ascending: false })
  if (result.error) return { data: [], error: missing(result.error.message) ? NEEDS_029 : result.error.message }
  return { data: ((result.data ?? []) as Array<Record<string, unknown>>).map(row => { const team = (Array.isArray(row.teams) ? row.teams[0] : row.teams) as Record<string, unknown> | null; return { id: String(row.id), teamId: String(row.team_id), teamName: String(team?.name ?? 'Team'), teamSlug: team?.slug ? String(team.slug) : null, teamLogo: team?.logo_url ? String(team.logo_url) : null, message: row.message ? String(row.message) : null, position: row.position ? String(row.position) : null, jerseyNumber: typeof row.jersey_number === 'number' ? row.jersey_number : null, status: String(row.status), createdAt: String(row.created_at), expiresAt: row.expires_at ? String(row.expires_at) : null, responseNote: row.response_note ? String(row.response_note) : null } }), error: null }
}

export async function respondToInvitation(client: SupabaseClient, invitationId: string, response: 'accepted' | 'declined' | 'reported', note: string): Promise<{ error: string | null }> {
  if (response === 'reported' && !note.trim()) return { error: 'Tell us what is wrong with this invitation.' }
  const result = await client.rpc('respond_team_invitation', { p_invitation_id: invitationId, p_response: response, p_note: note.trim() || null })
  if (!result.error) return { error: null }
  const message = result.error.message
  if (message.includes('invitation_expired')) return { error: 'This invitation has expired. Ask the team manager to send a new one.' }
  if (message.includes('invitation_already_answered')) return { error: 'This invitation was already answered.' }
  return { error: missing(message) ? NEEDS_029 : message }
}

// Team-manager side: invite a player profile to the team.
export async function sendTeamInvitation(client: SupabaseClient, input: { teamId: string; playerId: string; userId: string; message: string; position: string; jerseyNumber: string }): Promise<{ error: string | null }> {
  if (input.jerseyNumber && !/^\d{1,2}$/.test(input.jerseyNumber)) return { error: 'Jersey number must be between 0 and 99.' }
  const result = await client.from('player_team_invitations').insert({ team_id: input.teamId, player_id: input.playerId, invited_by: input.userId, message: input.message.trim() || null, position: input.position.trim() || null, jersey_number: input.jerseyNumber ? Number(input.jerseyNumber) : null })
  if (!result.error) return { error: null }
  if (/duplicate|unique/i.test(result.error.message)) return { error: 'This player already has a pending invitation from this team.' }
  return { error: missing(result.error.message) ? NEEDS_029 : result.error.message }
}

// --- Documents -------------------------------------------------------------------
export const DOCUMENT_CATEGORIES = [
  { value: 'identity', label: 'Identity document' }, { value: 'age_eligibility', label: 'Age eligibility' },
  { value: 'guardian_consent', label: 'Parent/guardian consent' }, { value: 'medical', label: 'Medical / participation' },
  { value: 'tournament_eligibility', label: 'Tournament eligibility' },
] as const
export const DOCUMENT_STATUS_LABELS: Record<string, string> = { uploaded: 'Uploaded', under_review: 'Under review', changes_requested: 'Changes requested', verified: 'Verified', rejected: 'Rejected', expired: 'Expired' }
export const DOCUMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg']
export const DOCUMENT_MAX = 10 * 1024 * 1024

export type PlayerDocument = { id: string; category: string; originalName: string; storagePath: string; sizeBytes: number; status: string; reviewerNote: string | null; tournamentId: string | null; expiresAt: string | null; createdAt: string; reviewedAt: string | null }

export async function loadPlayerDocuments(client: SupabaseClient, playerId: string): Promise<{ data: PlayerDocument[]; error: string | null }> {
  const result = await client.from('private_documents').select('id,document_type,original_name,storage_path,size_bytes,status,reviewer_note,tournament_id,retention_until,created_at,reviewed_at').eq('player_id', playerId).order('created_at', { ascending: false })
  if (result.error) return { data: [], error: missing(result.error.message) ? NEEDS_029 : result.error.message }
  return { data: ((result.data ?? []) as Array<Record<string, unknown>>).map(row => ({ id: String(row.id), category: String(row.document_type), originalName: String(row.original_name), storagePath: String(row.storage_path), sizeBytes: Number(row.size_bytes ?? 0), status: String(row.status ?? 'uploaded'), reviewerNote: row.reviewer_note ? String(row.reviewer_note) : null, tournamentId: row.tournament_id ? String(row.tournament_id) : null, expiresAt: row.retention_until ? String(row.retention_until) : null, createdAt: String(row.created_at), reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null })), error: null }
}

export function validateDocument(file: File): string | null {
  if (!DOCUMENT_TYPES.includes(file.type)) return 'Upload a PDF, PNG or JPG file.'
  if (file.size === 0) return 'The selected file is empty.'
  if (file.size > documentLimit(DOCUMENT_MAX)) return `Documents must be under ${sizeLabel(documentLimit(DOCUMENT_MAX))}.`
  return null
}

// Private bucket only; the file is never public and is opened with a
// one-minute signed link (see documents.ts).
export async function uploadPlayerDocument(client: SupabaseClient, input: { userId: string; playerId: string; file: File; category: string; tournamentId: string | null; expiresAt: string | null }): Promise<{ error: string | null }> {
  const problem = validateDocument(input.file)
  if (problem) return { error: problem }
  const path = `players/${input.playerId}/${crypto.randomUUID()}-${input.file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)}`
  const upload = await client.storage.from('tournament-private-documents').upload(path, input.file, { contentType: input.file.type, upsert: false })
  if (upload.error) return { error: /row-level security|policy/i.test(upload.error.message) ? NEEDS_029 : upload.error.message }
  const row = await client.from('private_documents').insert({ player_id: input.playerId, tournament_id: input.tournamentId, document_type: input.category, storage_path: path, original_name: input.file.name.slice(0, 200), mime_type: input.file.type, size_bytes: input.file.size, retention_until: input.expiresAt, uploaded_by: input.userId, status: 'uploaded' })
  if (row.error) { await client.storage.from('tournament-private-documents').remove([path]); return { error: missing(row.error.message) || /row-level security/i.test(row.error.message) ? NEEDS_029 : row.error.message } }
  return { error: null }
}

export async function removePlayerDocument(client: SupabaseClient, document: PlayerDocument): Promise<{ error: string | null }> {
  const result = await client.from('private_documents').delete().eq('id', document.id).select('id')
  if (result.error) return { error: result.error.message }
  if (!result.data?.length) return { error: 'Reviewed documents cannot be removed. Upload a replacement instead.' }
  await client.storage.from('tournament-private-documents').remove([document.storagePath])
  return { error: null }
}

// Organizer side: review a document for one of the operator's tournaments.
export async function reviewDocument(client: SupabaseClient, documentId: string, userId: string, status: 'under_review' | 'changes_requested' | 'verified' | 'rejected', note: string): Promise<{ error: string | null }> {
  const result = await client.from('private_documents').update({ status, reviewer_note: note.trim() || null, reviewed_by: userId, reviewed_at: new Date().toISOString() }).eq('id', documentId).select('id')
  if (result.error) return { error: missing(result.error.message) ? NEEDS_029 : result.error.message }
  if (!result.data?.length) return { error: 'Only the tournament organizer can review this document.' }
  return { error: null }
}

// --- Trophy cabinet ---------------------------------------------------------------
export async function setMilestoneVisibility(client: SupabaseClient, milestoneId: string, isPublic: boolean): Promise<{ error: string | null }> {
  const result = await client.rpc('set_milestone_visibility', { p_milestone_id: milestoneId, p_public: isPublic })
  return { error: result.error ? (missing(result.error.message) ? NEEDS_029 : result.error.message) : null }
}

export async function loadMilestoneExtras(client: SupabaseClient, ids: string[]): Promise<Map<string, { imageUrl: string | null; isPublic: boolean; teamName: string | null; tournamentName: string | null }>> {
  const map = new Map<string, { imageUrl: string | null; isPublic: boolean; teamName: string | null; tournamentName: string | null }>()
  if (!ids.length) return map
  const result = await client.from('sport_milestones').select('id,image_url,is_public,teams(name),tournaments(name)').in('id', ids)
  const rows = result.error ? ((await client.from('sport_milestones').select('id,teams(name),tournaments(name)').in('id', ids)).data ?? []) : (result.data ?? [])
  for (const row of rows as Array<Record<string, unknown>>) {
    const team = (Array.isArray(row.teams) ? row.teams[0] : row.teams) as Record<string, unknown> | null
    const tournament = (Array.isArray(row.tournaments) ? row.tournaments[0] : row.tournaments) as Record<string, unknown> | null
    map.set(String(row.id), { imageUrl: typeof row.image_url === 'string' ? row.image_url : null, isPublic: row.is_public !== false, teamName: team?.name ? String(team.name) : null, tournamentName: tournament?.name ? String(tournament.name) : null })
  }
  return map
}

// --- Notifications -----------------------------------------------------------------
export async function markAllNotificationsRead(client: SupabaseClient, userId: string): Promise<{ error: string | null }> {
  const result = await client.from('notifications').update({ state: 'read', read_at: new Date().toISOString() }).eq('recipient_id', userId).is('read_at', null)
  return { error: result.error?.message ?? null }
}

// --- Card style ----------------------------------------------------------------------
export async function loadCardDetails(client: SupabaseClient, playerId: string): Promise<{ cardStyle: CardStyle | null; jerseyNumber: number | null }> {
  const result = await client.from('player_profiles').select('card_style,jersey_number').eq('id', playerId).maybeSingle()
  if (result.error || !result.data) return { cardStyle: null, jerseyNumber: null }
  return { cardStyle: (result.data.card_style as CardStyle | null) ?? null, jerseyNumber: typeof result.data.jersey_number === 'number' ? result.data.jersey_number : null }
}

export async function saveCardStyle(client: SupabaseClient, userId: string, playerId: string, style: CardStyle): Promise<{ error: string | null }> {
  const result = await client.from('player_profiles').update({ card_style: style }).eq('id', playerId).eq('account_id', userId).select('id')
  if (result.error) return { error: missing(result.error.message) ? 'Saving a card style needs migration 029.' : result.error.message }
  return { error: result.data?.length ? null : 'The card style was not saved.' }
}
