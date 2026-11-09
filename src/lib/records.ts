import type { SupabaseClient } from '@supabase/supabase-js'

export type RecordResult<T> = { data: T | null; error: string | null }
export type Sport = 'football' | 'futsal' | 'handball' | 'volleyball' | 'basketball' | 'basketball_3x3'

export function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)
}

export async function createOrganization(client: SupabaseClient, userId: string, name: string): Promise<RecordResult<{ id: string }>> {
  const id = crypto.randomUUID()
  const result = await client.from('organizations').insert({ id, name: name.trim(), slug: `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`, created_by: userId })
  if (result.error) return { data: null, error: result.error.message }
  const membership = await client.from('organization_memberships').insert({ organization_id: id, user_id: userId, role: 'owner' })
  if (membership.error) return { data: null, error: membership.error.message }
  return { data: { id }, error: null }
}

export async function createTeam(client: SupabaseClient, userId: string, name: string, island: string, teamType = 'club'): Promise<RecordResult<{ id: string }>> {
  // Insert before the membership exists, so do not use RETURNING/select here:
  // private teams are intentionally invisible until their manager membership exists.
  const id = crypto.randomUUID()
  const team = await client.from('teams').insert({ id, name: name.trim(), slug: `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`, island: island.trim() || null, team_type: teamType, created_by: userId, is_published: true })
  if (team.error) return { data: null, error: team.error.message }
  const membership = await client.from('team_memberships').insert({ team_id: id, user_id: userId, role: 'manager' })
  if (membership.error) return { data: null, error: membership.error.message }
  return { data: { id }, error: null }
}

export async function createUnclaimedPlayer(client: SupabaseClient, userId: string, displayName: string, island: string): Promise<RecordResult<{ id: string }>> {
  const result = await client.from('player_profiles').insert({ display_name: displayName.trim(), slug: `${slugify(displayName)}-${crypto.randomUUID().slice(0, 8)}`, island: island.trim() || null, created_by: userId, account_id: null, is_claimed: false, is_published: true }).select('id').single()
  return { data: result.data, error: result.error?.message ?? null }
}

export async function createPersonalPlayerProfile(client: SupabaseClient, userId: string, displayName: string, island: string): Promise<RecordResult<{ id: string }>> {
  const auth = await client.auth.getUser()
  if (auth.error || !auth.data.user) {
    const refreshed = await client.auth.refreshSession()
    if (refreshed.error || !refreshed.data.user) return { data: null, error: 'Your sign-in session expired. Please sign in again before creating a personal player profile.' }
    if (refreshed.data.user.id !== userId) return { data: null, error: 'The signed-in account changed. Refresh the page and try again.' }
  } else if (auth.data.user.id !== userId) return { data: null, error: 'The signed-in account changed. Refresh the page and try again.' }
  const id = crypto.randomUUID()
  const result = await client.from('player_profiles').insert({ id, display_name: displayName.trim(), slug: `${slugify(displayName)}-${crypto.randomUUID().slice(0, 8)}`, island: island.trim() || null, created_by: userId, account_id: userId, is_claimed: true, is_published: true })
  return { data: result.error ? null : { id }, error: result.error?.message ?? null }
}

export async function acceptWorkspaceInvitation(client: SupabaseClient, invitationToken: string): Promise<RecordResult<{ workspaceType: 'team' | 'organization'; workspaceId: string }>> {
  if (!invitationToken.trim()) return { data: null, error: 'Invitation token is required.' }
  const result = await client.functions.invoke<{ workspaceType: 'team' | 'organization'; workspaceId: string }>('accept-workspace-invitation', { body: { invitationToken: invitationToken.trim() } })
  return { data: result.data, error: result.error?.message ?? null }
}

export async function claimPlayer(client: SupabaseClient, invitationToken: string): Promise<RecordResult<{ playerId: string }>> {
  if (!invitationToken.trim()) return { data: null, error: 'Invitation token is required.' }
  const result = await client.functions.invoke<{ claimed: boolean; playerId: string }>('claim-player', { body: { invitationToken: invitationToken.trim() } })
  return { data: result.data, error: result.error?.message ?? null }
}

export async function createClaimInvitation(client: SupabaseClient, playerId: string, invitedEmail?: string): Promise<RecordResult<{ invitationToken: string; expiresAt: string }>> {
  const result = await client.functions.invoke<{ invitationToken: string; expiresAt: string }>('invite-player', { body: { playerId, invitedEmail: invitedEmail?.trim() || undefined } })
  return { data: result.data, error: result.error?.message ?? null }
}

// `createTournamentDraft` deliberately lives only in `lib/tournament.ts`. There
// were two near-identical copies with divergent slug logic (this one built the
// slug inline instead of reusing `slugify`), which is exactly the kind of
// duplication that makes later schema work double-handed. The tournament
// workflow UI imports the tournament.ts version.

// Team / organization invitations (invite-workspace-member Edge Function). The
// raw token is returned once for the inviter to deliver privately; it is
// never stored by the app.
export async function createWorkspaceInvitation(client: SupabaseClient, input: { workspaceType: 'team' | 'organization'; workspaceId: string; role: string; invitedEmail?: string }): Promise<RecordResult<{ invitationToken: string; expiresAt: string }>> {
  const result = await client.functions.invoke<{ invitationToken: string; expiresAt: string }>('invite-workspace-member', { body: { ...input, invitedEmail: input.invitedEmail?.trim() || undefined } })
  if (result.error) return { data: null, error: /not found|Function/i.test(result.error.message) ? 'Invitations are not enabled yet: the invite-workspace-member Edge Function must be deployed.' : result.error.message }
  return { data: result.data, error: null }
}

// --- Editing a player record this organizer created --------------------------
// Only unclaimed records (no linked account) can be edited by their creator;
// the database enforces the same rule. The public link (slug) and player ID
// never change, so existing links keep working. Claimed players edit their own.
export type ManagedPlayerDetails = { name: string; island: string; atoll: string; position: string; photoUrl?: string | null; photoFit?: { zoom?: number; x?: number; y?: number; auto?: boolean } | null }

export async function loadManagedPlayerDetails(client: SupabaseClient, playerId: string): Promise<{ data: ManagedPlayerDetails | null; error: string | null }> {
  const full = await client.from('player_profiles').select('display_name,island,atoll,position,photo_url,photo_fit').eq('id', playerId).maybeSingle()
  const result = full.error ? await client.from('player_profiles').select('display_name,island,photo_url,photo_fit').eq('id', playerId).maybeSingle() : full
  if (result.error || !result.data) return { data: null, error: 'This player record could not be loaded.' }
  const row = result.data as Record<string, unknown>
  return { data: { name: String(row.display_name ?? ''), island: String(row.island ?? ''), atoll: String(row.atoll ?? ''), position: String(row.position ?? ''), photoUrl: typeof row.photo_url === 'string' ? row.photo_url : null, photoFit: (row.photo_fit as { zoom?: number; x?: number; y?: number; auto?: boolean } | null) ?? null }, error: null }
}

export function managedPlayerProblem(input: ManagedPlayerDetails): string | null {
  if (input.name.trim().length < 2) return 'Enter the player’s name (at least 2 characters).'
  if (input.name.trim().length > 120) return 'Keep the name under 120 characters.'
  if (input.island.trim().length > 80 || input.atoll.trim().length > 60) return 'Island or atoll is too long.'
  if (input.position.trim().length > 40) return 'Keep the position under 40 characters.'
  return null
}

export async function updateManagedPlayer(client: SupabaseClient, userId: string, playerId: string, input: ManagedPlayerDetails): Promise<{ error: string | null }> {
  const problem = managedPlayerProblem(input)
  if (problem) return { error: problem }
  const base = { display_name: input.name.trim(), island: input.island.trim() || null }
  const extra = { atoll: input.atoll.trim() || null, position: input.position.trim() || null }
  // Scoped to this creator's unclaimed record, matching the database policy.
  const run = (patch: Record<string, unknown>) => client.from('player_profiles').update(patch).eq('id', playerId).eq('created_by', userId).is('account_id', null).select('id')
  let result = await run({ ...base, ...extra })
  if (result.error && /column|schema cache/i.test(result.error.message)) result = await run(base)
  if (result.error) return { error: 'The player could not be saved. Please try again.' }
  if (!result.data?.length) return { error: 'This player has claimed their profile, so only they can change it now.' }
  return { error: null }
}
