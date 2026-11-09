import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Identity check and guardian approval (Product Specification 6.4 / 16.3).
//
// The browser only forwards the typed number to the trusted register-identity
// Edge Function, which digests it; the number is never written to a table from
// here and is never kept in component state after the request. Guardian
// approvals are recorded by the person who created the minor's record.
// ---------------------------------------------------------------------------

export type IdentityInput = { identifierType: 'maldivian_national_id' | 'foreign_document'; value: string; documentType?: string; issuingCountry?: string }
export type IdentityOutcome = { status: 'registered' | 'already_registered' | 'identity_in_use' | 'profile_has_identity' | 'error'; message: string }

// Same rules as the Edge Function, so obvious typos are caught before sending.
export function normalizeMaldivianId(value: string): string | null {
  const normalized = value.toUpperCase().replace(/[\s-]/g, '')
  return /^A\d{6}$/.test(normalized) ? normalized : null
}

export function validateIdentityInput(input: IdentityInput): string | null {
  if (input.identifierType === 'maldivian_national_id') return normalizeMaldivianId(input.value) ? null : 'Enter a Maldivian ID card number in the form A123456.'
  if (!input.documentType) return 'Choose the document type.'
  if (!/^[A-Za-z]{2}$/.test((input.issuingCountry ?? '').trim())) return 'Enter the two-letter issuing country code, e.g. IN or LK.'
  if (!/^[A-Za-z0-9\s-]{4,24}$/.test(input.value.trim())) return 'Enter the document number (letters and digits).'
  return null
}

export async function registerIdentity(client: SupabaseClient, playerId: string, input: IdentityInput): Promise<IdentityOutcome> {
  const problem = validateIdentityInput(input)
  if (problem) return { status: 'error', message: problem }
  const result = await client.functions.invoke<{ status?: string; message?: string; error?: string }>('register-identity', { body: { playerId, ...input } })
  if (result.error) {
    // A 409 carries the safe explanation in the response body.
    const context = (result.error as { context?: Response }).context
    const body = context && typeof context.json === 'function' ? await context.json().catch(() => null) as { status?: string; message?: string; error?: string } | null : null
    if (body?.status === 'identity_in_use' || body?.status === 'profile_has_identity') return { status: body.status, message: body.message ?? 'This identity is already in use.' }
    // Say which problem it is: not deployed, not configured, or signed out.
    const status = context?.status ?? 0
    // A function that is not deployed also fails the browser's preflight, which
    // surfaces as a network error with no status.
    if (status === 0 && /failed to send a request/i.test(result.error.message)) return { status: 'error', message: navigator.onLine === false ? 'You are offline. Reconnect and try again.' : 'Identity checks are not enabled yet: the register-identity Edge Function could not be reached. It must be deployed.' }
    if (status === 404 || /requested function was not found/i.test(result.error.message)) return { status: 'error', message: 'Identity checks are not enabled yet: the register-identity Edge Function must be deployed.' }
    if (status === 503 || body?.error === 'identity_not_configured') return { status: 'error', message: 'Identity checks are not configured yet: the platform owner must set the IDENTITY_HMAC_SECRET secret.' }
    if (status === 401) return { status: 'error', message: 'Your session expired. Sign in again and retry.' }
    if (status >= 500) return { status: 'error', message: 'The identity check could not run right now. Please try again later.' }
    return { status: 'error', message: body?.error ?? 'The identity check could not be completed.' }
  }
  if (result.data?.status === 'already_registered') return { status: 'already_registered', message: 'This identity is already registered for this profile.' }
  return { status: 'registered', message: 'Identity registered. Only a protected digest is stored; the number itself is not kept.' }
}

// Exact-match lookup for organizers (final specification, page 42). Before an
// updated register-identity function is deployed this answers "unavailable" and
// callers keep the earlier behaviour (create, then refuse a duplicate).
export type IdentityLookup = { status: 'match'; playerId: string; displayName: string } | { status: 'no_match' } | { status: 'unavailable'; message: string }
export async function lookupIdentity(client: SupabaseClient, entryId: string, input: IdentityInput): Promise<IdentityLookup> {
  const problem = validateIdentityInput(input)
  if (problem) return { status: 'unavailable', message: problem }
  const result = await client.functions.invoke<{ status?: string; playerId?: string; displayName?: string }>('register-identity', { body: { action: 'lookup', entryId, ...input } })
  if (result.error || !result.data) return { status: 'unavailable', message: 'The ID check could not run right now.' }
  if (result.data.status === 'match' && result.data.playerId) return { status: 'match', playerId: result.data.playerId, displayName: String(result.data.displayName ?? 'Existing player') }
  if (result.data.status === 'no_match') return { status: 'no_match' }
  // An older deployment answers a lookup like a registration; treat it as unavailable.
  return { status: 'unavailable', message: 'Automatic matching is not deployed yet.' }
}

export async function loadIdentityStatus(client: SupabaseClient, playerId: string): Promise<'registered' | 'not_registered' | 'unavailable'> {
  const result = await client.rpc('player_identity_status', { p_player_id: playerId })
  if (result.error || (result.data !== 'registered' && result.data !== 'not_registered')) return 'unavailable'
  return result.data
}

export type GuardianRelationship = 'parent' | 'legal_guardian' | 'other_authorized'
export const GUARDIAN_RELATIONSHIP_LABELS: Record<GuardianRelationship, string> = { parent: 'Parent', legal_guardian: 'Legal guardian', other_authorized: 'Other authorized adult' }
export type GuardianApproval = { id: string; guardianName: string; relationship: string; approvesClaim: boolean; approvesPublicProfile: boolean; createdAt: string; revokedAt: string | null }

export async function loadGuardianApprovals(client: SupabaseClient, playerId: string): Promise<{ data: GuardianApproval[]; error: string | null }> {
  const result = await client.from('guardian_approvals').select('id,guardian_name,relationship,approves_claim,approves_public_profile,created_at,revoked_at').eq('player_id', playerId).order('created_at', { ascending: false })
  if (result.error) return { data: [], error: result.error.message }
  return { data: ((result.data ?? []) as Array<Record<string, unknown>>).map(row => ({ id: String(row.id), guardianName: String(row.guardian_name ?? ''), relationship: String(row.relationship ?? ''), approvesClaim: row.approves_claim === true, approvesPublicProfile: row.approves_public_profile === true, createdAt: String(row.created_at ?? ''), revokedAt: typeof row.revoked_at === 'string' ? row.revoked_at : null })), error: null }
}

export function activeGuardianScopes(approvals: GuardianApproval[]): { claim: boolean; publicProfile: boolean } {
  const active = approvals.filter(approval => !approval.revokedAt)
  return { claim: active.some(approval => approval.approvesClaim), publicProfile: active.some(approval => approval.approvesPublicProfile) }
}

export async function recordGuardianApproval(client: SupabaseClient, input: { playerId: string; guardianName: string; relationship: GuardianRelationship; contact: string; approvesClaim: boolean; approvesPublicProfile: boolean; note: string; userId: string }): Promise<{ error: string | null }> {
  if (!input.guardianName.trim()) return { error: 'Enter the guardian\'s name.' }
  if (!input.approvesClaim && !input.approvesPublicProfile) return { error: 'Choose what the guardian approves.' }
  const result = await client.from('guardian_approvals').insert({ player_id: input.playerId, guardian_name: input.guardianName.trim(), relationship: input.relationship, guardian_contact: input.contact.trim() || null, approves_claim: input.approvesClaim, approves_public_profile: input.approvesPublicProfile, note: input.note.trim() || null, recorded_by: input.userId })
  return { error: result.error ? guardianError(result.error.message) : null }
}

export async function revokeGuardianApproval(client: SupabaseClient, approvalId: string, userId: string): Promise<{ error: string | null }> {
  const result = await client.from('guardian_approvals').update({ revoked_at: new Date().toISOString(), revoked_by: userId }).eq('id', approvalId).is('revoked_at', null)
  return { error: result.error ? guardianError(result.error.message) : null }
}

export async function setPlayerMinor(client: SupabaseClient, playerId: string, isMinor: boolean): Promise<{ error: string | null }> {
  const result = await client.from('player_profiles').update({ is_minor: isMinor }).eq('id', playerId).select('id')
  if (result.error) return { error: guardianError(result.error.message) }
  if (!result.data?.length) return { error: 'Only the person who created this unclaimed record can change whether it belongs to a minor.' }
  return { error: null }
}

export function guardianError(message: string): string {
  if (/guardian_approvals|is_minor|does not exist|schema cache/i.test(message)) return 'Guardian approval needs migration 026 to be applied.'
  if (/guardian_approval_required_for_public_profile/.test(message)) return 'A guardian must approve before this minor\'s profile can be made public.'
  if (/guardian_approval_required/.test(message)) return 'A guardian must approve before this minor\'s profile can be claimed.'
  if (/row-level security/i.test(message)) return 'Only the person who created this player record can record or revoke guardian approval.'
  return message
}
