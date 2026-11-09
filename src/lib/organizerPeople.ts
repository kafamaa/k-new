import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeName } from './csvImport'
import { submitContentReport } from './landing'
import { sanitizeSearchTerm } from './organizer'
import { claimInvitationState } from './playerWorkspace'
import { createClaimInvitation } from './records'

// ---------------------------------------------------------------------------
// Teams & Players tabs from the final plan (section 37): Claims, Possible
// duplicates and Imports. Every read goes through the caller's own client and
// the existing policies: an organizer sees the player records they created,
// the claim invitations they created, the teams linked to their organization,
// published records, and their own audit rows. Nothing here merges, deletes or
// hides a record; a possible duplicate can only be sent for review.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null)

export type ManagedPlayer = { id: string; name: string; slug: string; island: string | null; claimed: boolean; published: boolean; photoUrl?: string | null; createdAt: string }
export type ManagedTeam = { id: string; name: string; slug: string; island: string | null; published: boolean }

export async function loadManagedPlayers(client: SupabaseClient, userId: string): Promise<{ data: ManagedPlayer[]; error: string | null }> {
  const result = await client.from('player_profiles').select('id,display_name,slug,island,is_claimed,is_published,photo_url,created_at').eq('created_by', userId).order('created_at', { ascending: false }).limit(500)
  if (result.error) return { data: [], error: 'Your player records could not be loaded. Please try again.' }
  return { data: ((result.data ?? []) as Row[]).map(row => ({ id: String(row.id), name: String(row.display_name ?? ''), slug: String(row.slug ?? ''), island: text(row.island), claimed: row.is_claimed === true, published: row.is_published === true, photoUrl: text(row.photo_url), createdAt: String(row.created_at ?? '') })), error: null }
}

export async function loadOrganizationTeams(client: SupabaseClient, organizationId: string): Promise<{ data: ManagedTeam[]; error: string | null }> {
  const result = await client.from('organization_team_links').select('team_id,teams(name,slug,island,is_published)').eq('organization_id', organizationId)
  if (result.error) return { data: [], error: 'Linked teams could not be loaded. Please try again.' }
  const teams: ManagedTeam[] = []
  for (const row of (result.data ?? []) as Row[]) {
    const team = (Array.isArray(row.teams) ? row.teams[0] : row.teams) as Row | null
    if (team) teams.push({ id: String(row.team_id), name: String(team.name ?? ''), slug: String(team.slug ?? ''), island: text(team.island), published: team.is_published === true })
  }
  return { data: teams, error: null }
}

// --- Claims -----------------------------------------------------------------

export type ClaimState = 'pending' | 'accepted' | 'revoked' | 'expired'
export type ClaimInvitation = { id: string; playerId: string; email: string | null; state: ClaimState; expiresAt: string; createdAt: string }

export async function loadMyClaimInvitations(client: SupabaseClient, userId: string): Promise<{ data: ClaimInvitation[]; error: string | null }> {
  const result = await client.from('claim_invitations').select('id,player_id,invited_email,expires_at,revoked_at,accepted_at,created_at').eq('created_by', userId).order('created_at', { ascending: false }).limit(500)
  if (result.error) return { data: [], error: 'Claim invitations could not be loaded. Please try again.' }
  return { data: ((result.data ?? []) as Row[]).map(row => ({ id: String(row.id), playerId: String(row.player_id), email: text(row.invited_email), state: claimInvitationState(row), expiresAt: String(row.expires_at ?? ''), createdAt: String(row.created_at ?? '') })), error: null }
}

// One claim status per player, from the record and its newest invitation.
export type PlayerClaimStatus = 'claimed' | 'invited' | 'expired' | 'not_invited'
export const CLAIM_STATUS_LABELS: Record<PlayerClaimStatus, string> = { claimed: 'Claimed by the player', invited: 'Invitation pending', expired: 'Invitation expired or revoked', not_invited: 'Not invited yet' }

export function playerClaimStatus(player: ManagedPlayer, invitations: ClaimInvitation[]): PlayerClaimStatus {
  if (player.claimed) return 'claimed'
  const own = invitations.filter(item => item.playerId === player.id)
  if (own.some(item => item.state === 'pending')) return 'invited'
  return own.length > 0 ? 'expired' : 'not_invited'
}

// Unclaimed records with no pending invitation can be invited together.
export function invitablePlayers(players: ManagedPlayer[], invitations: ClaimInvitation[]): ManagedPlayer[] {
  return players.filter(player => ['not_invited', 'expired'].includes(playerClaimStatus(player, invitations)))
}

export type SentInvitation = { playerId: string; name: string; token: string | null; expiresAt: string | null; error: string | null }

// Sequential so each failure is reported against its own player. The raw token
// is returned once for the organizer to deliver privately and is never stored.
export async function sendClaimInvitations(client: SupabaseClient, players: ManagedPlayer[], onProgress?: (done: number) => void): Promise<SentInvitation[]> {
  const sent: SentInvitation[] = []
  for (const player of players) {
    const result = await createClaimInvitation(client, player.id)
    sent.push({ playerId: player.id, name: player.name, token: result.data?.invitationToken ?? null, expiresAt: result.data?.expiresAt ?? null, error: result.error || !result.data ? 'The invitation could not be created. Please try again.' : null })
    onProgress?.(sent.length)
  }
  return sent
}

export async function revokeClaimInvitation(client: SupabaseClient, invitationId: string): Promise<{ error: string | null }> {
  const result = await client.functions.invoke('revoke-player-invitation', { body: { invitationId } })
  return { error: result.error ? 'The invitation could not be revoked. It may already be accepted or revoked.' : null }
}

// --- Possible duplicates --------------------------------------------------------

// Same words in any order: "Ali Ahmed" and "Ahmed  Ali" share a key.
export function duplicateKey(name: string): string {
  return normalizeName(name).split(' ').filter(Boolean).sort().join(' ')
}

export type DuplicateCandidate = { id: string; name: string; slug: string; island: string | null; managed: boolean; claimed?: boolean }
export type DuplicateGroup = { key: string; records: DuplicateCandidate[]; sameIsland: boolean }

export function findDuplicateGroups(records: DuplicateCandidate[]): DuplicateGroup[] {
  const groups = new Map<string, Map<string, DuplicateCandidate>>()
  for (const record of records) {
    const key = duplicateKey(record.name)
    if (!key) continue
    const group = groups.get(key) ?? new Map<string, DuplicateCandidate>()
    // The same record found twice (managed and published) counts once, as managed.
    const existing = group.get(record.id)
    group.set(record.id, existing ? { ...existing, managed: existing.managed || record.managed } : record)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, records: [...group.values()] }))
    // A group matters only when it holds at least one record this organizer manages.
    .filter(group => group.records.length > 1 && group.records.some(record => record.managed))
    .map(group => {
      const islands = new Set(group.records.map(record => normalizeName(record.island ?? '')).filter(Boolean))
      return { ...group, sameIsland: islands.size <= 1 }
    })
    .sort((left, right) => Number(right.sameIsland) - Number(left.sameIsland) || right.records.length - left.records.length || left.key.localeCompare(right.key))
}

// Published records whose names match the managed ones exactly (ignoring case).
export async function findPublishedNameMatches(client: SupabaseClient, kind: 'team' | 'player', names: string[]): Promise<{ data: DuplicateCandidate[]; error: string | null }> {
  const terms = [...new Set(names.map(name => sanitizeSearchTerm(name)).filter(term => term.length >= 2))]
  const column = kind === 'team' ? 'name' : 'display_name'
  const found: DuplicateCandidate[] = []
  for (let start = 0; start < terms.length; start += 20) {
    const chunk = terms.slice(start, start + 20)
    const result = await client.from(kind === 'team' ? 'teams' : 'player_profiles').select(`id,${column},slug,island,is_published${kind === 'player' ? ',is_claimed' : ''}`).eq('is_published', true).or(chunk.map(term => `${column}.ilike.${term}`).join(',')).limit(200)
    if (result.error) return { data: [], error: 'Published records could not be checked. Please try again.' }
    for (const row of (result.data ?? []) as unknown as Row[]) found.push({ id: String(row.id), name: String(row[column] ?? ''), slug: String(row.slug ?? ''), island: text(row.island), managed: false, claimed: kind === 'player' ? row.is_claimed === true : undefined })
  }
  return { data: found, error: null }
}

// The review request names records by their public addresses, not by internal
// ids. It goes to the platform review queue through submit_content_report
// (migration 032), which limits how many requests one account can send.
export function duplicateReviewDetails(kind: 'team' | 'player', group: DuplicateGroup): string {
  const list = group.records.map(record => `${record.name}${record.island ? ` (${record.island})` : ''} #${kind}/${record.slug}`).join('; ')
  return `Possible duplicate ${kind} records${group.sameIsland ? '' : ' (different islands)'}: ${list}`.slice(0, 1000)
}

export async function requestDuplicateReview(client: SupabaseClient, kind: 'team' | 'player', group: DuplicateGroup): Promise<{ error: string | null }> {
  const first = group.records.find(record => record.managed) ?? group.records[0]
  return submitContentReport(client, { entity: kind, ref: first.slug, label: first.name, reason: kind === 'player' ? 'duplicate_player' : 'other', details: duplicateReviewDetails(kind, group) })
}

// --- Imports ------------------------------------------------------------------

export type ImportBatch = { source: string; kind: 'team' | 'player'; created: number; lastAt: string }
const IMPORT_REASON = /^Imported from (.*), line \d+$/

// Each imported record has one audit row (csvImport.commitImport); rows from
// the same file on the same Maldives day are one batch.
export function groupImportEvents(events: Array<{ entity_type: string; reason: string | null; created_at: string }>): ImportBatch[] {
  const batches = new Map<string, ImportBatch>()
  for (const event of events) {
    const source = IMPORT_REASON.exec(event.reason ?? '')?.[1]
    const kind = event.entity_type === 'team' ? 'team' : event.entity_type === 'player_profile' ? 'player' : null
    if (!source || !kind) continue
    const day = new Date(event.created_at).toLocaleDateString('en-CA', { timeZone: 'Indian/Maldives' })
    const key = `${kind}|${source}|${day}`
    const batch = batches.get(key) ?? { source, kind, created: 0, lastAt: event.created_at }
    batch.created += 1
    if (event.created_at > batch.lastAt) batch.lastAt = event.created_at
    batches.set(key, batch)
  }
  return [...batches.values()].sort((left, right) => right.lastAt.localeCompare(left.lastAt))
}

export async function loadImportHistory(client: SupabaseClient, userId: string): Promise<{ data: ImportBatch[]; error: string | null }> {
  const result = await client.from('audit_events').select('entity_type,reason,created_at').eq('actor_id', userId).eq('action', 'csv_import').order('created_at', { ascending: false }).limit(1000)
  if (result.error) return { data: [], error: 'Import history could not be loaded. Please try again.' }
  return { data: groupImportEvents((result.data ?? []) as Array<{ entity_type: string; reason: string | null; created_at: string }>), error: null }
}
