import type { SupabaseClient } from '@supabase/supabase-js'
import { createUnclaimedPlayer } from './records'
import { lookupIdentity, registerIdentity, type IdentityInput } from './identity'
import { setMembershipStatus } from './teamWorkspace'
import { documentLimit, sizeLabel } from './appConfig'

// ---------------------------------------------------------------------------
// Team workspace data that needs migration 031: staff permissions, the full
// team profile, fixtures with opponent names, roster validation, result
// reports, team finance and team documents. Every loader degrades to "needs
// migration 031" instead of failing the whole workspace.
// ---------------------------------------------------------------------------

export const NEEDS_031 = 'This needs migration 031 to be applied.'
const MISSING = /does not exist|PGRST2\d\d|42P0\d|42703|42883|schema cache|could not find/i
const isMissing = (message: string) => MISSING.test(message)
const text = (value: unknown): string | null => typeof value === 'string' && value ? value : null
const one = (value: unknown): Record<string, unknown> | null => Array.isArray(value) ? (value[0] as Record<string, unknown> | undefined) ?? null : value && typeof value === 'object' ? value as Record<string, unknown> : null

// --- Permissions --------------------------------------------------------------------

export const TEAM_PERMISSIONS = ['edit_profile', 'manage_players', 'send_invitations', 'manage_applications', 'manage_rosters', 'view_documents', 'manage_finance', 'publish_content', 'manage_staff'] as const
export type TeamPermission = (typeof TEAM_PERMISSIONS)[number]
export const PERMISSION_LABELS: Record<TeamPermission, string> = {
  edit_profile: 'Edit team profile', manage_players: 'Manage players', send_invitations: 'Send invitations', manage_applications: 'Manage tournament applications',
  manage_rosters: 'Manage rosters', view_documents: 'View documents', manage_finance: 'Manage finance', publish_content: 'Publish team content', manage_staff: 'Manage staff',
}
export const STAFF_ROLES = ['manager', 'assistant_manager', 'coach', 'medical', 'media', 'finance', 'roster_admin', 'staff'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = { manager: 'Manager', assistant_manager: 'Assistant manager', coach: 'Coach', medical: 'Medical staff', media: 'Media staff', finance: 'Finance staff', roster_admin: 'Roster administrator', staff: 'Team staff' }

// Mirrors team_role_default_permissions in migration 031.
export function roleDefaultPermissions(role: string): TeamPermission[] {
  switch (role) {
    case 'manager': return [...TEAM_PERMISSIONS]
    case 'staff': return ['edit_profile', 'manage_players', 'send_invitations', 'manage_applications', 'manage_rosters', 'view_documents', 'publish_content']
    case 'assistant_manager': return ['edit_profile', 'manage_players', 'send_invitations', 'manage_applications', 'manage_rosters', 'view_documents']
    case 'roster_admin': return ['manage_players', 'manage_rosters']
    case 'coach': return ['manage_rosters']
    case 'medical': return ['view_documents']
    case 'media': return ['publish_content']
    case 'finance': return ['manage_finance']
    default: return []
  }
}
export function effectivePermissions(role: string, permissions: string[]): TeamPermission[] {
  if (role === 'manager') return roleDefaultPermissions('manager')
  return permissions.length ? permissions.filter((item): item is TeamPermission => (TEAM_PERMISSIONS as readonly string[]).includes(item)) : roleDefaultPermissions(role)
}

export type TeamAccess = { role: string; isOwner: boolean; permissions: TeamPermission[]; can: (permission: TeamPermission) => boolean }
export async function loadTeamAccess(client: SupabaseClient, teamId: string, userId: string, role: string): Promise<TeamAccess> {
  const [membership, team] = await Promise.all([
    client.from('team_memberships').select('permissions').eq('team_id', teamId).eq('user_id', userId).maybeSingle(),
    client.from('teams').select('created_by').eq('id', teamId).maybeSingle(),
  ])
  const stored = !membership.error && Array.isArray((membership.data as Record<string, unknown> | null)?.permissions) ? ((membership.data as Record<string, unknown>).permissions as string[]) : []
  const isOwner = (team.data as Record<string, unknown> | null)?.created_by === userId
  const permissions = isOwner ? [...TEAM_PERMISSIONS] : effectivePermissions(role, stored)
  return { role, isOwner, permissions, can: permission => permissions.includes(permission) }
}

// --- Team profile ---------------------------------------------------------------------

export const TEAM_TYPE_OPTIONS = ['club', 'island', 'atoll', 'national', 'school', 'community', 'corporate', 'other'] as const
export const TEAM_TYPE_LABELS: Record<string, string> = { club: 'Club', island: 'Island', atoll: 'Atoll', national: 'National', school: 'School', community: 'Community', corporate: 'Corporate', other: 'Other' }
export const TEAM_SOCIAL = [{ key: 'instagram', label: 'Instagram' }, { key: 'facebook', label: 'Facebook' }, { key: 'tiktok', label: 'TikTok' }, { key: 'x', label: 'X (Twitter)' }, { key: 'youtube', label: 'YouTube' }, { key: 'website', label: 'Website' }] as const

export type TeamProfile = {
  name: string; teamType: string; sports: string[]; atoll: string; island: string; establishedYear: string; description: string
  primaryColor: string; secondaryColor: string; homeVenue: string; socialLinks: Record<string, string>; publicContact: string; showPublicContact: boolean
  logoUrl: string | null; logoPath: string | null; coverUrl: string | null; coverPath: string | null; isPublished: boolean; isVerified: boolean; archivedAt: string | null
}
export const TEAM_PROFILE_FIELDS = 'id,name,slug,team_type,island,description,logo_url,is_published,deactivated_at,atoll,sports,established_year,primary_color,secondary_color,home_venue,social_links,public_contact,show_public_contact,logo_path,cover_path,cover_url,is_verified'

export function toTeamProfile(row: Record<string, unknown>): TeamProfile {
  const links = row.social_links && typeof row.social_links === 'object' ? row.social_links as Record<string, string> : {}
  return {
    name: String(row.name ?? ''), teamType: String(row.team_type ?? 'club'), sports: Array.isArray(row.sports) ? row.sports.map(String) : [], atoll: String(row.atoll ?? ''), island: String(row.island ?? ''),
    establishedYear: row.established_year ? String(row.established_year) : '', description: String(row.description ?? ''), primaryColor: String(row.primary_color ?? ''), secondaryColor: String(row.secondary_color ?? ''),
    homeVenue: String(row.home_venue ?? ''), socialLinks: links, publicContact: String(row.public_contact ?? ''), showPublicContact: row.show_public_contact === true,
    logoUrl: text(row.logo_url), logoPath: text(row.logo_path), coverUrl: text(row.cover_url), coverPath: text(row.cover_path), isPublished: row.is_published === true, isVerified: row.is_verified === true, archivedAt: text(row.deactivated_at),
  }
}

export async function loadTeamProfile(client: SupabaseClient, teamId: string): Promise<{ data: TeamProfile | null; extended: boolean; error: string | null }> {
  const full = await client.from('teams').select(TEAM_PROFILE_FIELDS).eq('id', teamId).maybeSingle()
  if (!full.error) return { data: full.data ? toTeamProfile(full.data as Record<string, unknown>) : null, extended: true, error: null }
  if (!isMissing(full.error.message)) return { data: null, extended: false, error: full.error.message }
  const base = await client.from('teams').select('id,name,slug,team_type,island,description,logo_url,is_published,deactivated_at').eq('id', teamId).maybeSingle()
  return { data: base.data ? toTeamProfile(base.data as Record<string, unknown>) : null, extended: false, error: base.error?.message ?? null }
}

export function validateTeamProfile(profile: TeamProfile): string | null {
  if (!profile.name.trim()) return 'Team name cannot be empty.'
  if (profile.establishedYear && !/^(19|20)\d{2}$/.test(profile.establishedYear)) return 'Established year must be a four-digit year.'
  for (const color of [profile.primaryColor, profile.secondaryColor]) if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return 'Colours must be hex values such as #00C2DC.'
  for (const [key, value] of Object.entries(profile.socialLinks)) if (value && !/^https:\/\//i.test(value)) return `${TEAM_SOCIAL.find(item => item.key === key)?.label ?? key} link must start with https://`
  if (profile.description.length > 600) return 'Keep the description under 600 characters.'
  return null
}

export async function saveTeamProfile(client: SupabaseClient, teamId: string, profile: TeamProfile, extended: boolean): Promise<{ error: string | null }> {
  const problem = validateTeamProfile(profile)
  if (problem) return { error: problem }
  const base: Record<string, unknown> = { name: profile.name.trim().slice(0, 120), team_type: profile.teamType, island: profile.island.trim() || null, description: profile.description.trim() || null }
  const patch = extended ? {
    ...base, atoll: profile.atoll.trim() || null, sports: profile.sports, established_year: profile.establishedYear ? Number(profile.establishedYear) : null,
    primary_color: profile.primaryColor || null, secondary_color: profile.secondaryColor || null, home_venue: profile.homeVenue.trim() || null,
    social_links: Object.fromEntries(Object.entries(profile.socialLinks).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()])),
    public_contact: profile.publicContact.trim() || null, show_public_contact: profile.showPublicContact,
  } : { ...base, team_type: ['club', 'island', 'national', 'school', 'other'].includes(profile.teamType) ? profile.teamType : 'other' }
  const result = await client.from('teams').update(patch).eq('id', teamId).select('id')
  if (result.error) return { error: /row-level security/i.test(result.error.message) ? 'You do not have permission to edit this team profile.' : result.error.message }
  if (!result.data?.length) return { error: 'No team row changed. You can only edit a team you manage.' }
  return { error: null }
}

export async function setTeamPublished(client: SupabaseClient, teamId: string, publish: boolean): Promise<{ error: string | null }> {
  const result = await client.from('teams').update({ is_published: publish }).eq('id', teamId).select('id')
  if (result.error) return { error: result.error.message }
  return { error: result.data?.length ? null : 'Nothing changed. You may not have permission to publish this team.' }
}

// Logo and cover go to the public bucket under teams/<id>/. The path is kept
// so a replaced image can be removed; the public URL is what pages show.
export async function uploadTeamImage(client: SupabaseClient, teamId: string, kind: 'logo' | 'cover', file: File, previousPath: string | null, extended: boolean): Promise<{ url: string | null; error: string | null }> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return { url: null, error: 'Use a PNG, JPG or WebP image.' }
  if (file.size > (kind === 'logo' ? 2 : 5) * 1024 * 1024) return { url: null, error: `Images must be under ${kind === 'logo' ? 2 : 5} MB.` }
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `teams/${teamId}/${kind}-${crypto.randomUUID()}.${extension}`
  const upload = await client.storage.from('public-media').upload(path, file, { contentType: file.type, upsert: false })
  if (upload.error) return { url: null, error: /bucket|not found/i.test(upload.error.message) ? 'Image storage needs migration 024.' : upload.error.message }
  const url = client.storage.from('public-media').getPublicUrl(path).data.publicUrl
  if (kind === 'cover' && !extended) { await client.storage.from('public-media').remove([path]); return { url: null, error: `Cover images: ${NEEDS_031}` } }
  const patch = kind === 'logo' ? (extended ? { logo_url: url, logo_path: path } : { logo_url: url }) : { cover_url: url, cover_path: path }
  const saved = await client.from('teams').update(patch).eq('id', teamId).select('id')
  if (saved.error || !saved.data?.length) { await client.storage.from('public-media').remove([path]); return { url: null, error: saved.error?.message ?? 'You do not have permission to change team images.' } }
  if (previousPath?.startsWith(`teams/${teamId}/`)) await client.storage.from('public-media').remove([previousPath])
  return { url, error: null }
}

export type TeamPrivateDetails = { managerLegalName: string; managerPhone: string; internalEmail: string; privateNotes: string }
export async function loadTeamPrivateDetails(client: SupabaseClient, teamId: string): Promise<{ data: TeamPrivateDetails; available: boolean }> {
  const result = await client.from('team_private_details').select('manager_legal_name,manager_phone,internal_email,private_notes').eq('team_id', teamId).maybeSingle()
  const row = (result.data ?? {}) as Record<string, unknown>
  return { data: { managerLegalName: String(row.manager_legal_name ?? ''), managerPhone: String(row.manager_phone ?? ''), internalEmail: String(row.internal_email ?? ''), privateNotes: String(row.private_notes ?? '') }, available: !result.error }
}
export async function saveTeamPrivateDetails(client: SupabaseClient, teamId: string, userId: string, details: TeamPrivateDetails): Promise<{ error: string | null }> {
  if (details.internalEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(details.internalEmail)) return { error: 'Enter a valid internal email.' }
  const result = await client.from('team_private_details').upsert({ team_id: teamId, manager_legal_name: details.managerLegalName.trim() || null, manager_phone: details.managerPhone.trim() || null, internal_email: details.internalEmail.trim() || null, private_notes: details.privateNotes.trim() || null, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'team_id' })
  return { error: result.error ? (isMissing(result.error.message) ? NEEDS_031 : result.error.message) : null }
}

// --- Staff, ownership, archive ---------------------------------------------------------

export type StaffMember = { userId: string; name: string; role: string; permissions: TeamPermission[]; isOwner: boolean; isSelf: boolean; joinedAt: string }
const staffError = (message: string) => isMissing(message) ? NEEDS_031
  : /manage_staff_required/.test(message) ? 'You need the Manage staff permission.'
  : /cannot_grant_(\w+)/.test(message) ? `You cannot grant "${PERMISSION_LABELS[message.match(/cannot_grant_(\w+)/)![1] as TeamPermission] ?? 'that permission'}" because you do not hold it.`
  : /only_managers_appoint_managers/.test(message) ? 'Only a manager or the owner can appoint another manager.'
  : /owner_must_transfer_first|owner_cannot_be_changed/.test(message) ? 'The owner must transfer ownership first.'
  : /only_owner/.test(message) ? 'Only the team owner can do this.'
  : /reason_required/.test(message) ? 'Give a reason.'
  : message

export async function loadTeamStaff(client: SupabaseClient, teamId: string): Promise<{ data: StaffMember[]; error: string | null }> {
  const result = await client.rpc('get_team_staff', { p_team_id: teamId })
  if (result.error) return { data: [], error: staffError(result.error.message) }
  return { data: ((result.data ?? []) as Record<string, unknown>[]).map(row => ({ userId: String(row.user_id), name: String(row.display_name ?? 'Team member'), role: String(row.role), permissions: effectivePermissions(String(row.role), Array.isArray(row.permissions) ? row.permissions.map(String) : []), isOwner: row.is_owner === true, isSelf: row.is_self === true, joinedAt: String(row.joined_at ?? '') })), error: null }
}
export async function setTeamStaff(client: SupabaseClient, teamId: string, userId: string, role: StaffRole, permissions: TeamPermission[]): Promise<{ error: string | null }> {
  const result = await client.rpc('set_team_staff', { p_team_id: teamId, p_user_id: userId, p_role: role, p_permissions: role === 'manager' ? [] : permissions })
  return { error: result.error ? staffError(result.error.message) : null }
}
export async function removeTeamStaff(client: SupabaseClient, teamId: string, userId: string): Promise<{ error: string | null }> {
  const result = await client.rpc('remove_team_staff', { p_team_id: teamId, p_user_id: userId })
  return { error: result.error ? staffError(result.error.message) : null }
}
export async function transferTeamOwnership(client: SupabaseClient, teamId: string, newOwner: string): Promise<{ error: string | null }> {
  const result = await client.rpc('transfer_team_ownership', { p_team_id: teamId, p_new_owner: newOwner })
  return { error: result.error ? staffError(result.error.message) : null }
}
export async function setTeamArchived(client: SupabaseClient, teamId: string, archived: boolean, reason: string): Promise<{ error: string | null }> {
  const result = await client.rpc('set_team_archived', { p_team_id: teamId, p_archived: archived, p_reason: reason })
  return { error: result.error ? staffError(result.error.message) : null }
}
export type AuditRow = { action: string; reason: string | null; actor: string; createdAt: string }
export async function loadTeamAudit(client: SupabaseClient, teamId: string): Promise<{ data: AuditRow[]; error: string | null }> {
  const result = await client.rpc('get_team_audit', { p_team_id: teamId })
  if (result.error) return { data: [], error: staffError(result.error.message) }
  return { data: ((result.data ?? []) as Record<string, unknown>[]).map(row => ({ action: String(row.action), reason: text(row.reason), actor: String(row.actor_name ?? 'Team member'), createdAt: String(row.created_at ?? '') })), error: null }
}
export const AUDIT_LABELS: Record<string, string> = {
  team_staff_permissions_changed: 'Staff role or permissions changed', team_staff_removed: 'Staff member removed', team_staff_left: 'Staff member left', team_ownership_transferred: 'Ownership transferred',
  team_archived: 'Team archived', team_restored: 'Team restored', team_membership_updated: 'Player details updated', team_membership_ended: 'Player membership ended',
  team_finance_added: 'Finance record added', team_finance_voided: 'Finance record voided', team_finance_edited: 'Finance draft edited',
}

// --- Players ---------------------------------------------------------------------------

export const SQUAD_ROLE_LABELS: Record<string, string> = { player: 'Player', captain: 'Captain', vice_captain: 'Vice-captain' }
const membershipError = (message: string) => isMissing(message) ? NEEDS_031 : /jersey_number_taken/.test(message) ? 'Another active player already wears that number.' : /manage_players_required/.test(message) ? 'You need the Manage players permission.' : /end_date_before_start/.test(message) ? 'The end date cannot be before the membership started.' : /membership_already_ended|membership_ended/.test(message) ? 'This membership has already ended.' : message

export async function updateTeamMembership(client: SupabaseClient, membershipId: string, input: { position: string; jerseyNumber: string; squadRole: string }): Promise<{ error: string | null }> {
  if (input.jerseyNumber && !/^\d{1,2}$/.test(input.jerseyNumber)) return { error: 'Jersey number must be between 0 and 99.' }
  const result = await client.rpc('update_team_membership', { p_membership_id: membershipId, p_position: input.position.trim(), p_jersey_number: input.jerseyNumber ? Number(input.jerseyNumber) : null, p_squad_role: input.squadRole })
  return { error: result.error ? membershipError(result.error.message) : null }
}
export async function endTeamMembership(client: SupabaseClient, teamId: string, membershipId: string, endDate: string, reason: string): Promise<{ error: string | null }> {
  if (!endDate) return { error: 'Choose the end date.' }
  const result = await client.rpc('end_team_membership', { p_membership_id: membershipId, p_end_date: endDate, p_reason: reason })
  if (!result.error) return { error: null }
  // Before migration 031 the end date is today and no reason is stored.
  if (isMissing(result.error.message)) return setMembershipStatus(client, teamId, membershipId, 'ended')
  return { error: membershipError(result.error.message) }
}

// Adds a legitimate unclaimed player. When an ID is given it is checked first
// against every profile (server-side digest); a duplicate removes the new
// record again so no second copy of that person is left behind.
export async function addUnclaimedPlayer(client: SupabaseClient, input: { userId: string; teamId: string; name: string; island: string; position: string; jerseyNumber: string; identity: IdentityInput | null }): Promise<{ error: string | null; duplicate: boolean }> {
  if (input.name.trim().length < 2) return { error: 'Enter the player’s name.', duplicate: false }
  const created = await createUnclaimedPlayer(client, input.userId, input.name, input.island)
  if (created.error || !created.data) return { error: created.error ?? 'The player could not be created.', duplicate: false }
  const playerId = created.data.id
  if (input.identity && input.identity.value.trim()) {
    const identity = await registerIdentity(client, playerId, input.identity)
    if (identity.status !== 'registered' && identity.status !== 'already_registered') {
      await client.from('player_profiles').delete().eq('id', playerId)
      return { error: identity.status === 'identity_in_use' ? `${identity.message} Invite the existing player instead.` : identity.message, duplicate: identity.status === 'identity_in_use' }
    }
  }
  const membership = await client.from('player_team_memberships').insert({ player_id: playerId, team_id: input.teamId, status: 'active', source: 'manager', created_by: input.userId }).select('id').maybeSingle()
  if (membership.error) return { error: membership.error.message, duplicate: false }
  if (typeof client.rpc === 'function') await client.rpc('publish_player_profile', { p_player_id: playerId })
  if (typeof client.rpc === 'function') await client.rpc('publish_team', { p_team_id: input.teamId })
  const membershipId = String((membership.data as Record<string, unknown> | null)?.id ?? '')
  if (membershipId && (input.position || input.jerseyNumber)) await updateTeamMembership(client, membershipId, { position: input.position, jerseyNumber: input.jerseyNumber, squadRole: 'player' })
  return { error: null, duplicate: false }
}

// --- Invitations and join requests ----------------------------------------------------------

export type SentInvitation = { id: string; playerName: string; playerSlug: string | null; position: string | null; jerseyNumber: number | null; sport: string | null; status: string; createdAt: string; expiresAt: string | null; responseNote: string | null }
export async function loadSentInvitations(client: SupabaseClient, teamId: string): Promise<{ data: SentInvitation[]; error: string | null }> {
  const withSport = await client.from('player_team_invitations').select('id,position,jersey_number,sport,status,created_at,expires_at,response_note,player_profiles(display_name,slug)').eq('team_id', teamId).order('created_at', { ascending: false })
  const result = withSport.error && isMissing(withSport.error.message) && /sport/.test(withSport.error.message)
    ? await client.from('player_team_invitations').select('id,position,jersey_number,status,created_at,expires_at,response_note,player_profiles(display_name,slug)').eq('team_id', teamId).order('created_at', { ascending: false })
    : withSport
  if (result.error) return { data: [], error: isMissing(result.error.message) ? 'Team invitations need migration 029.' : result.error.message }
  const now = new Date().toISOString()
  return {
    data: ((result.data ?? []) as Record<string, unknown>[]).map(row => {
      const player = one(row.player_profiles)
      const expired = row.status === 'pending' && typeof row.expires_at === 'string' && row.expires_at < now
      return { id: String(row.id), playerName: String(player?.display_name ?? 'Private player record'), playerSlug: text(player?.slug), position: text(row.position), jerseyNumber: typeof row.jersey_number === 'number' ? row.jersey_number : null, sport: text(row.sport), status: expired ? 'expired' : String(row.status), createdAt: String(row.created_at ?? ''), expiresAt: text(row.expires_at), responseNote: text(row.response_note) }
    }),
    error: null,
  }
}
export const INVITATION_STATUS_LABELS: Record<string, string> = { pending: 'Pending', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', withdrawn: 'Revoked', reported: 'Reported as wrong' }
export async function revokeInvitation(client: SupabaseClient, invitationId: string): Promise<{ error: string | null }> {
  const result = await client.from('player_team_invitations').update({ status: 'withdrawn' }).eq('id', invitationId).select('id')
  if (result.error) return { error: result.error.message }
  return { error: result.data?.length ? null : 'Only a pending invitation can be revoked.' }
}

export async function resolveJoinRequest(client: SupabaseClient, input: { requestId: string; playerId: string; teamId: string; userId: string; decision: 'approved' | 'rejected' | 'info_requested'; note: string }): Promise<{ error: string | null }> {
  if (input.decision !== 'approved' && !input.note.trim()) return { error: input.decision === 'info_requested' ? 'Say what information you need.' : 'Add a short reason for the player.' }
  if (input.decision === 'approved') {
    const membership = await client.from('player_team_memberships').insert({ player_id: input.playerId, team_id: input.teamId, status: 'active', source: 'manager', created_by: input.userId }).select('id')
    if (membership.error) return { error: membership.error.message }
    if (typeof client.rpc === 'function') await client.rpc('publish_player_profile', { p_player_id: input.playerId })
    if (typeof client.rpc === 'function') await client.rpc('publish_team', { p_team_id: input.teamId })
  }
  const update = await client.from('player_team_requests').update({ status: input.decision, resolution_note: input.note.trim() || null, resolved_at: input.decision === 'info_requested' ? null : new Date().toISOString() }).eq('id', input.requestId).select('id')
  if (update.error) return { error: input.decision === 'info_requested' && /check/i.test(update.error.message) ? `Asking for more information: ${NEEDS_031}` : update.error.message }
  return { error: null }
}

// --- Fixtures, results and statistics -----------------------------------------------------

export type TeamMatch = {
  id: string; tournamentId: string; tournamentName: string; tournamentSlug: string; tournamentPublished: boolean; sport: string
  stage: string | null; group: string | null; scheduledAt: string | null; venue: string | null; status: string; isHome: boolean
  opponentName: string; opponentLogo: string | null; teamScore: number | null; opponentScore: number | null; resultConfirmed: boolean; confirmedAt: string | null; yellow: number; red: number
}
const num = (value: unknown): number | null => value === null || value === undefined || Number.isNaN(Number(value)) ? null : Number(value)
export function mapTeamMatch(row: Record<string, unknown>): TeamMatch {
  return {
    id: String(row.match_id), tournamentId: String(row.tournament_id ?? ''), tournamentName: String(row.tournament_name ?? 'Tournament'), tournamentSlug: String(row.tournament_slug ?? ''), tournamentPublished: row.tournament_published === true, sport: String(row.sport ?? ''),
    stage: text(row.stage_name), group: text(row.group_name), scheduledAt: text(row.scheduled_at), venue: text(row.venue), status: String(row.status ?? 'scheduled'), isHome: row.is_home === true,
    opponentName: String(row.opponent_name ?? 'To be decided'), opponentLogo: text(row.opponent_logo), teamScore: num(row.team_score), opponentScore: num(row.opponent_score), resultConfirmed: row.result_confirmed === true, confirmedAt: text(row.confirmed_at),
    yellow: Number(row.yellow_cards ?? 0), red: Number(row.red_cards ?? 0),
  }
}
export async function loadTeamMatches(client: SupabaseClient, teamId: string): Promise<{ data: TeamMatch[]; available: boolean; error: string | null }> {
  const result = await client.rpc('get_team_workspace_matches', { p_team_id: teamId })
  if (result.error) return isMissing(result.error.message) ? { data: [], available: false, error: null } : { data: [], available: true, error: result.error.message }
  return { data: ((result.data ?? []) as Record<string, unknown>[]).map(mapTeamMatch), available: true, error: null }
}

// Before migration 031: the matches and confirmed versions the workspace can
// already read, without opponent names.
export function legacyTeamMatches(teamId: string, matches: Record<string, unknown>[], versions: Record<string, unknown>[]): TeamMatch[] {
  const latest = new Map<string, Record<string, unknown>>()
  for (const version of [...versions].sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))) if (!latest.has(String(version.match_id))) latest.set(String(version.match_id), version)
  return matches.map(match => {
    const home = String(match.home_team_id ?? '') === teamId
    const version = latest.get(String(match.id))
    const score = (version?.score ?? null) as { home?: unknown; away?: unknown } | null
    const confirmed = match.status === 'confirmed' && typeof score?.home === 'number' && typeof score?.away === 'number'
    const tournament = one(match.tournaments)
    return mapTeamMatch({ match_id: match.id, tournament_id: match.tournament_id, tournament_name: tournament?.name, tournament_slug: tournament?.slug, scheduled_at: match.scheduled_at, venue: match.venue, status: match.status, is_home: home, opponent_name: 'Opponent', team_score: confirmed ? (home ? score!.home : score!.away) : null, opponent_score: confirmed ? (home ? score!.away : score!.home) : null, result_confirmed: confirmed, confirmed_at: version?.created_at })
  })
}

export type FixtureBucket = 'upcoming' | 'live' | 'completed' | 'postponed' | 'cancelled' | 'abandoned'
export const FIXTURE_BUCKET_LABELS: Record<FixtureBucket, string> = { upcoming: 'Upcoming', live: 'Live', completed: 'Completed', postponed: 'Postponed', cancelled: 'Cancelled', abandoned: 'Abandoned' }
export function fixtureBucket(match: Pick<TeamMatch, 'status' | 'scheduledAt'>, nowIso: string): FixtureBucket {
  if (match.status === 'live') return 'live'
  if (match.status === 'postponed' || match.status === 'cancelled' || match.status === 'abandoned') return match.status
  if (match.status === 'confirmed' || match.status === 'awaiting_confirmation') return 'completed'
  return !match.scheduledAt || match.scheduledAt >= nowIso ? 'upcoming' : 'completed'
}
export function groupFixtures(matches: TeamMatch[], nowIso: string): Record<FixtureBucket, TeamMatch[]> {
  const groups: Record<FixtureBucket, TeamMatch[]> = { upcoming: [], live: [], completed: [], postponed: [], cancelled: [], abandoned: [] }
  for (const match of matches) groups[fixtureBucket(match, nowIso)].push(match)
  groups.upcoming.sort((a, b) => String(a.scheduledAt ?? '9999').localeCompare(String(b.scheduledAt ?? '9999')))
  groups.completed.sort((a, b) => String(b.scheduledAt ?? '').localeCompare(String(a.scheduledAt ?? '')))
  return groups
}
export function teamOutcome(match: TeamMatch): 'W' | 'D' | 'L' | null {
  if (!match.resultConfirmed || match.teamScore === null || match.opponentScore === null) return null
  return match.teamScore > match.opponentScore ? 'W' : match.teamScore < match.opponentScore ? 'L' : 'D'
}

export type TeamTotals = { played: number; wins: number; draws: number; losses: number; scored: number; conceded: number; difference: number; cleanSheets: number; yellow: number; red: number }
// Only confirmed results count; the feed already carries the latest confirmed
// version per match, so a corrected result replaces the earlier one.
export function teamTotals(matches: TeamMatch[]): TeamTotals {
  const totals: TeamTotals = { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0, difference: 0, cleanSheets: 0, yellow: 0, red: 0 }
  for (const match of matches) {
    const outcome = teamOutcome(match)
    if (!outcome) continue
    totals.played += 1; totals.scored += match.teamScore!; totals.conceded += match.opponentScore!
    if (outcome === 'W') totals.wins += 1; else if (outcome === 'D') totals.draws += 1; else totals.losses += 1
    if (match.opponentScore === 0) totals.cleanSheets += 1
    totals.yellow += match.yellow; totals.red += match.red
  }
  totals.difference = totals.scored - totals.conceded
  return totals
}
export type StatsFilter = { sport: string; tournamentId: string; season: string; competition: string; from: string; to: string }
export const EMPTY_STATS_FILTER: StatsFilter = { sport: '', tournamentId: '', season: '', competition: '', from: '', to: '' }
export function filterTeamMatches(matches: TeamMatch[], filter: StatsFilter): TeamMatch[] {
  return matches.filter(match => {
    const day = match.scheduledAt?.slice(0, 10) ?? ''
    return (!filter.sport || match.sport === filter.sport) && (!filter.tournamentId || match.tournamentId === filter.tournamentId) && (!filter.season || day.startsWith(filter.season))
      && (!filter.competition || (filter.competition === 'group' ? Boolean(match.group) : filter.competition === 'knockout' ? !match.group : true))
      && (!filter.from || (day && day >= filter.from)) && (!filter.to || (day && day <= filter.to))
  })
}
export function tournamentHistory(matches: TeamMatch[]): Array<{ tournamentId: string; name: string; slug: string; published: boolean; totals: TeamTotals; lastStage: string | null }> {
  const groups = new Map<string, TeamMatch[]>()
  for (const match of matches) groups.set(match.tournamentId, [...(groups.get(match.tournamentId) ?? []), match])
  return [...groups.entries()].map(([tournamentId, items]) => {
    const sorted = [...items].sort((a, b) => String(b.scheduledAt ?? '').localeCompare(String(a.scheduledAt ?? '')))
    return { tournamentId, name: items[0].tournamentName, slug: items[0].tournamentSlug, published: items[0].tournamentPublished, totals: teamTotals(items), lastStage: sorted[0]?.stage ?? null }
  })
}

export type MatchParticipant = { playerId: string; name: string; starter: boolean; minutes: number | null; goals: number; assists: number; yellow: number; red: number }
export async function loadMatchParticipants(client: SupabaseClient, teamId: string, matchId: string): Promise<{ data: MatchParticipant[]; error: string | null }> {
  const result = await client.rpc('get_team_match_participants', { p_team_id: teamId, p_match_id: matchId })
  if (result.error) return { data: [], error: isMissing(result.error.message) ? NEEDS_031 : result.error.message }
  return { data: ((result.data ?? []) as Record<string, unknown>[]).map(row => ({ playerId: String(row.player_id), name: String(row.display_name ?? 'Player'), starter: row.starter === true, minutes: num(row.minutes), goals: Number(row.goals ?? 0), assists: Number(row.assists ?? 0), yellow: Number(row.yellow_cards ?? 0), red: Number(row.red_cards ?? 0) })), error: null }
}

export const RESULT_REPORT_TYPES = [{ value: 'score', label: 'Incorrect score' }, { value: 'goal_scorer', label: 'Incorrect goal scorer' }, { value: 'assist', label: 'Missing assist' }, { value: 'card', label: 'Incorrect card' }, { value: 'appearance', label: 'Incorrect player appearance' }, { value: 'result_status', label: 'Incorrect walkover / result status' }] as const
export type ResultReport = { id: string; matchId: string; type: string; message: string; status: string; note: string | null; createdAt: string; teamName?: string }
export async function submitResultReport(client: SupabaseClient, input: { teamId: string; matchId: string; tournamentId: string; userId: string; type: string; message: string }): Promise<{ error: string | null }> {
  if (!input.message.trim()) return { error: 'Explain what is wrong and what it should be.' }
  const result = await client.from('team_result_reports').insert({ team_id: input.teamId, match_id: input.matchId, tournament_id: input.tournamentId, report_type: input.type, message: input.message.trim(), created_by: input.userId })
  return { error: result.error ? (isMissing(result.error.message) ? NEEDS_031 : result.error.message) : null }
}
export async function loadResultReports(client: SupabaseClient, scope: { teamId: string } | { tournamentId: string }): Promise<{ data: ResultReport[]; error: string | null }> {
  let query = client.from('team_result_reports').select('id,match_id,report_type,message,status,resolution_note,created_at,teams(name)').order('created_at', { ascending: false }).limit(100)
  query = 'teamId' in scope ? query.eq('team_id', scope.teamId) : query.eq('tournament_id', scope.tournamentId)
  const result = await query
  if (result.error) return { data: [], error: isMissing(result.error.message) ? NEEDS_031 : result.error.message }
  return { data: ((result.data ?? []) as Record<string, unknown>[]).map(row => ({ id: String(row.id), matchId: String(row.match_id), type: String(row.report_type), message: String(row.message ?? ''), status: String(row.status), note: text(row.resolution_note), createdAt: String(row.created_at ?? ''), teamName: String(one(row.teams)?.name ?? 'Team') })), error: null }
}
export async function resolveResultReport(client: SupabaseClient, reportId: string, status: 'under_review' | 'resolved' | 'rejected', note: string): Promise<{ error: string | null }> {
  if (status === 'rejected' && !note.trim()) return { error: 'Explain why the report is rejected.' }
  const result = await client.from('team_result_reports').update({ status, resolution_note: note.trim() || null }).eq('id', reportId).select('id')
  if (result.error) return { error: result.error.message }
  return { error: result.data?.length ? null : 'Nothing changed. You may not operate this tournament.' }
}

// --- Tournaments and applications ---------------------------------------------------------

export type TournamentGroup = 'registration' | 'in_progress' | 'submitted' | 'approved' | 'active' | 'completed'
export const TOURNAMENT_GROUP_LABELS: Record<TournamentGroup, string> = { registration: 'Registration available', in_progress: 'Application in progress', submitted: 'Application submitted', approved: 'Approved entries', active: 'Active tournaments', completed: 'Completed tournaments' }
export function entryGroup(entry: { applicationStatus: string; tournamentStatus: string }): TournamentGroup {
  if (['completed', 'archived'].includes(entry.tournamentStatus)) return 'completed'
  if (entry.applicationStatus === 'approved') return entry.tournamentStatus === 'in_progress' ? 'active' : 'approved'
  if (['draft', 'changes_requested'].includes(entry.applicationStatus)) return 'in_progress'
  if (['submitted', 'under_review'].includes(entry.applicationStatus)) return 'submitted'
  return 'completed'
}
export const APPLICATION_STATUS_LABELS: Record<string, string> = { draft: 'Draft', submitted: 'Submitted', under_review: 'Under review', changes_requested: 'Changes requested', approved: 'Approved', rejected: 'Rejected', waitlisted: 'Waitlisted', withdrawn: 'Withdrawn' }
export const ROSTER_STATUS_LABELS: Record<string, string> = { not_started: 'Not started', draft: 'Draft', submitted: 'Submitted', under_review: 'Under review', changes_requested: 'Changes requested', approved: 'Approved', rejected: 'Rejected', locked: 'Locked' }
export const PAYMENT_STATUS_LABELS: Record<string, string> = { not_required: 'No fee', unpaid: 'Unpaid', proof_submitted: 'Proof submitted', under_review: 'Under review', paid: 'Paid', waived: 'Waived', refunded: 'Refunded', overdue: 'Overdue' }
export function statusTone(status: string): 'ok' | 'warn' | 'bad' | 'muted' | 'info' {
  if (['approved', 'locked', 'paid', 'waived', 'verified', 'accepted', 'resolved', 'recorded', 'not_required'].includes(status)) return 'ok'
  if (['changes_requested', 'unpaid', 'overdue', 'pending', 'draft', 'info_requested', 'proof_submitted'].includes(status)) return 'warn'
  if (['rejected', 'declined', 'expired', 'void'].includes(status)) return 'bad'
  if (['withdrawn', 'not_started', 'refunded'].includes(status)) return 'muted'
  return 'info'
}

// --- Rosters ------------------------------------------------------------------------------

export type RosterLine = { playerId: string; name: string; shirtNumber: string; position: string; isCaptain: boolean; isGoalkeeper: boolean; claimed: boolean; identity: 'registered' | 'not_registered' | 'unknown' }
export function validateRosterLines(lines: RosterLine[], limits: { min: number | null; max: number | null }): string[] {
  const problems: string[] = []
  if (limits.min !== null && lines.length < limits.min) problems.push(`At least ${limits.min} players are required (now ${lines.length}).`)
  if (limits.max !== null && lines.length > limits.max) problems.push(`No more than ${limits.max} players are allowed (now ${lines.length}).`)
  const numbers = lines.map(line => line.shirtNumber.trim()).filter(Boolean)
  const repeated = [...new Set(numbers.filter((value, index) => numbers.indexOf(value) !== index))]
  if (repeated.length) problems.push(`Shirt number${repeated.length === 1 ? '' : 's'} ${repeated.join(', ')} used more than once.`)
  if (lines.some(line => !line.shirtNumber.trim())) problems.push('Every player needs a shirt number.')
  if (lines.some(line => line.shirtNumber.trim() && !/^\d{1,2}$/.test(line.shirtNumber.trim()))) problems.push('Shirt numbers must be 0–99.')
  if (lines.filter(line => line.isCaptain).length > 1) problems.push('Choose only one captain.')
  return problems
}
const ROSTER_ERRORS: Record<string, string> = { roster_below_minimum: 'The roster is below the tournament minimum.', roster_above_maximum: 'The roster is above the tournament maximum.', duplicate_shirt_number: 'Two players share a shirt number.', duplicate_player: 'A player is listed twice.', more_than_one_captain: 'Only one captain is allowed.', player_not_active_member: 'Every roster player must be an active member of this team.', roster_locked: 'The roster is locked by the organizer.', application_not_approved: 'Rosters open once the application is approved.', roster_not_authorized: 'You need the Manage rosters permission.', roster_empty: 'Add at least one player.' }
const rosterError = (message: string) => Object.entries(ROSTER_ERRORS).find(([key]) => message.includes(key))?.[1] ?? message

export async function submitRosterLines(client: SupabaseClient, entryId: string, userId: string, lines: RosterLine[]): Promise<{ error: string | null }> {
  const payload = lines.map(line => ({ player_id: line.playerId, shirt_number: line.shirtNumber.trim(), position: line.position.trim(), is_captain: line.isCaptain, is_goalkeeper: line.isGoalkeeper }))
  const result = await client.rpc('submit_roster_players', { p_entry_id: entryId, p_players: payload })
  if (!result.error) return { error: null }
  if (!isMissing(result.error.message)) return { error: rosterError(result.error.message) }
  // Before migration 031 only the player list is stored.
  const legacy = await client.rpc('submit_roster', { p_entry_id: entryId, p_player_ids: lines.map(line => line.playerId), p_actor_id: userId })
  return { error: legacy.error ? (legacy.error.message.includes('roster_not_authorized_or_locked') ? 'The roster is locked, or this account no longer manages the team.' : legacy.error.message) : null }
}

export type RosterVersion = { id: string; version: number; status: string; notes: string | null; createdAt: string; players: Array<{ name: string; shirt: string | null; position: string | null; captain: boolean }> }
export async function loadRosterVersions(client: SupabaseClient, entryId: string): Promise<RosterVersion[]> {
  const withFlags = await client.from('roster_submissions').select('id,version,status,review_notes,created_at,roster_submission_players(shirt_number,position,is_captain,player_profiles(display_name))').eq('entry_id', entryId).order('version', { ascending: false })
  const result = withFlags.error ? await client.from('roster_submissions').select('id,version,status,review_notes,created_at,roster_submission_players(shirt_number,position,player_profiles(display_name))').eq('entry_id', entryId).order('version', { ascending: false }) : withFlags
  if (result.error) return []
  return ((result.data ?? []) as Record<string, unknown>[]).map(row => ({
    id: String(row.id), version: Number(row.version ?? 0), status: String(row.status ?? ''), notes: text(row.review_notes), createdAt: String(row.created_at ?? ''),
    players: ((row.roster_submission_players ?? []) as Record<string, unknown>[]).map(player => ({ name: String(one(player.player_profiles)?.display_name ?? 'Private player record'), shirt: text(player.shirt_number), position: text(player.position), captain: player.is_captain === true })),
  }))
}
export async function loadRosterLimits(client: SupabaseClient, tournamentId: string): Promise<{ min: number | null; max: number | null; known: boolean }> {
  const result = await client.from('tournament_registration_settings').select('roster_min,roster_max').eq('tournament_id', tournamentId).maybeSingle()
  const row = result.data as Record<string, unknown> | null
  return { min: row && typeof row.roster_min === 'number' ? row.roster_min : null, max: row && typeof row.roster_max === 'number' ? row.roster_max : null, known: !result.error && Boolean(row) }
}

// --- Finance ------------------------------------------------------------------------------

export const INCOME_CATEGORIES = [{ value: 'sponsorship', label: 'Sponsorship' }, { value: 'donation', label: 'Donations' }, { value: 'membership', label: 'Membership contributions' }, { value: 'prize_money', label: 'Prize money' }, { value: 'other_income', label: 'Other income' }] as const
export const EXPENSE_CATEGORIES = [{ value: 'registration_fee', label: 'Tournament registration fee' }, { value: 'travel', label: 'Travel' }, { value: 'accommodation', label: 'Accommodation' }, { value: 'equipment', label: 'Equipment' }, { value: 'uniforms', label: 'Uniforms' }, { value: 'food', label: 'Food' }, { value: 'medical', label: 'Medical' }, { value: 'venue', label: 'Venue / training' }, { value: 'other_expense', label: 'Other expenses' }] as const
export const FINANCE_CATEGORY_LABELS: Record<string, string> = Object.fromEntries([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES].map(item => [item.value, item.label]))

export type FinanceRecord = { id: string; kind: 'income' | 'expense'; category: string; description: string; amount: number; occurredOn: string; tournamentId: string | null; counterparty: string | null; receiptPath: string | null; status: 'draft' | 'recorded' | 'void'; voidReason: string | null; notes: string | null; createdAt: string }
export type FinanceDraft = { kind: 'income' | 'expense'; category: string; description: string; amount: string; occurredOn: string; tournamentId: string; counterparty: string; notes: string; asDraft: boolean }

export async function loadFinance(client: SupabaseClient, teamId: string): Promise<{ data: FinanceRecord[]; error: string | null }> {
  const result = await client.from('team_finance_records').select('id,kind,category,description,amount_mvr,occurred_on,tournament_id,counterparty,receipt_path,status,void_reason,private_notes,created_at').eq('team_id', teamId).order('occurred_on', { ascending: false }).limit(500)
  if (result.error) return { data: [], error: isMissing(result.error.message) ? NEEDS_031 : result.error.message }
  return { data: ((result.data ?? []) as Record<string, unknown>[]).map(row => ({ id: String(row.id), kind: row.kind === 'income' ? 'income' : 'expense', category: String(row.category), description: String(row.description ?? ''), amount: Number(row.amount_mvr ?? 0), occurredOn: String(row.occurred_on ?? ''), tournamentId: text(row.tournament_id), counterparty: text(row.counterparty), receiptPath: text(row.receipt_path), status: (row.status as FinanceRecord['status']) ?? 'recorded', voidReason: text(row.void_reason), notes: text(row.private_notes), createdAt: String(row.created_at ?? '') })), error: null }
}
export function validateFinance(draft: FinanceDraft): string | null {
  if (!draft.description.trim()) return 'Add a description.'
  if (!/^\d+(\.\d{1,2})?$/.test(draft.amount.trim()) || Number(draft.amount) <= 0) return 'Enter an amount in MVR, e.g. 1500 or 1500.50.'
  if (!draft.occurredOn) return 'Choose the date.'
  const categories: readonly { value: string }[] = draft.kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  if (!categories.some(item => item.value === draft.category)) return 'Choose a category.'
  return null
}
export async function addFinanceRecord(client: SupabaseClient, teamId: string, userId: string, draft: FinanceDraft, receipt: File | null): Promise<{ error: string | null }> {
  const problem = validateFinance(draft)
  if (problem) return { error: problem }
  let receiptPath: string | null = null
  if (receipt) {
    const uploaded = await uploadTeamPrivateFile(client, teamId, 'finance', receipt)
    if (uploaded.error) return { error: uploaded.error }
    receiptPath = uploaded.path
  }
  const result = await client.from('team_finance_records').insert({ team_id: teamId, kind: draft.kind, category: draft.category, description: draft.description.trim(), amount_mvr: Number(draft.amount), occurred_on: draft.occurredOn, tournament_id: draft.tournamentId || null, counterparty: draft.counterparty.trim() || null, receipt_path: receiptPath, status: draft.asDraft ? 'draft' : 'recorded', private_notes: draft.notes.trim() || null, created_by: userId })
  if (result.error) { if (receiptPath) await client.storage.from('team-private').remove([receiptPath]); return { error: isMissing(result.error.message) ? NEEDS_031 : result.error.message } }
  return { error: null }
}
export async function updateFinanceDraft(client: SupabaseClient, id: string, patch: { status?: 'recorded'; amount?: number; description?: string }): Promise<{ error: string | null }> {
  const result = await client.from('team_finance_records').update({ ...(patch.status ? { status: patch.status } : {}), ...(patch.amount ? { amount_mvr: patch.amount } : {}), ...(patch.description ? { description: patch.description } : {}) }).eq('id', id).select('id')
  if (result.error) return { error: /recorded_entries_can_only_be_voided/.test(result.error.message) ? 'A recorded entry can only be voided.' : result.error.message }
  return { error: result.data?.length ? null : 'Nothing changed.' }
}
export async function voidFinanceRecord(client: SupabaseClient, id: string, reason: string): Promise<{ error: string | null }> {
  if (!reason.trim()) return { error: 'Give a reason for voiding this record.' }
  const result = await client.from('team_finance_records').update({ status: 'void', void_reason: reason.trim() }).eq('id', id).select('id')
  if (result.error) return { error: /void_records_are_final/.test(result.error.message) ? 'This record is already void.' : result.error.message }
  return { error: result.data?.length ? null : 'Nothing changed.' }
}
export function financeSummary(records: FinanceRecord[]): { income: number; expense: number; balance: number; drafts: number } {
  const live = records.filter(record => record.status === 'recorded')
  const income = live.filter(record => record.kind === 'income').reduce((sum, record) => sum + record.amount, 0)
  const expense = live.filter(record => record.kind === 'expense').reduce((sum, record) => sum + record.amount, 0)
  return { income, expense, balance: income - expense, drafts: records.filter(record => record.status === 'draft').length }
}
const csvCell = (value: unknown) => { const raw = String(value ?? ''); const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe }
export function financeCsv(records: FinanceRecord[], tournamentName: (id: string | null) => string): string {
  const header = ['Date', 'Type', 'Category', 'Description', 'Amount (MVR)', 'Tournament', 'Payer / payee', 'Status', 'Void reason']
  const rows = records.map(record => [record.occurredOn, record.kind, FINANCE_CATEGORY_LABELS[record.category] ?? record.category, record.description, record.amount.toFixed(2), tournamentName(record.tournamentId), record.counterparty ?? '', record.status, record.voidReason ?? ''])
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')
}
export const formatMvr = (value: number) => `MVR ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// --- Team documents --------------------------------------------------------------------------

export const TEAM_DOCUMENT_CATEGORIES = [{ value: 'registration_certificate', label: 'Team registration certificate' }, { value: 'authorization_letter', label: 'Team authorization letter' }, { value: 'manager_identification', label: 'Manager identification' }, { value: 'tournament_document', label: 'Tournament document' }, { value: 'payment_proof', label: 'Payment proof' }, { value: 'sponsor_agreement', label: 'Sponsor agreement' }, { value: 'player_eligibility', label: 'Player eligibility file' }, { value: 'other', label: 'Other' }] as const
export type TeamDocument = { id: string; category: string; originalName: string; storagePath: string; sizeBytes: number; status: string; reviewerNote: string | null; tournamentId: string | null; expiresAt: string | null; createdAt: string }
export const PRIVATE_FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg']

export async function uploadTeamPrivateFile(client: SupabaseClient, teamId: string, area: 'finance' | 'documents', file: File): Promise<{ path: string | null; error: string | null }> {
  if (!PRIVATE_FILE_TYPES.includes(file.type)) return { path: null, error: 'Upload a PDF, PNG or JPG file.' }
  if (file.size === 0 || file.size > documentLimit()) return { path: null, error: `Files must be under ${sizeLabel(documentLimit())}.` }
  const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-60)
  const path = `teams/${teamId}/${area}/${crypto.randomUUID()}-${safe}`
  const upload = await client.storage.from('team-private').upload(path, file, { contentType: file.type, upsert: false })
  if (upload.error) return { path: null, error: /bucket|not found/i.test(upload.error.message) ? `Private team storage: ${NEEDS_031}` : upload.error.message }
  return { path, error: null }
}
export async function openTeamPrivateFile(client: SupabaseClient, path: string): Promise<{ url: string | null; error: string | null }> {
  const result = await client.storage.from('team-private').createSignedUrl(path, 60)
  return { url: result.data?.signedUrl ?? null, error: result.error?.message ?? null }
}
export async function loadTeamDocuments(client: SupabaseClient, teamId: string): Promise<{ data: TeamDocument[]; error: string | null }> {
  const result = await client.from('team_documents').select('id,category,original_name,storage_path,size_bytes,status,reviewer_note,tournament_id,expires_at,created_at').eq('team_id', teamId).order('created_at', { ascending: false })
  if (result.error) return { data: [], error: isMissing(result.error.message) ? NEEDS_031 : result.error.message }
  return { data: ((result.data ?? []) as Record<string, unknown>[]).map(row => ({ id: String(row.id), category: String(row.category), originalName: String(row.original_name), storagePath: String(row.storage_path), sizeBytes: Number(row.size_bytes ?? 0), status: String(row.status), reviewerNote: text(row.reviewer_note), tournamentId: text(row.tournament_id), expiresAt: text(row.expires_at), createdAt: String(row.created_at ?? '') })), error: null }
}
export async function uploadTeamDocument(client: SupabaseClient, input: { teamId: string; userId: string; file: File; category: string; tournamentId: string; expiresAt: string }): Promise<{ error: string | null }> {
  const uploaded = await uploadTeamPrivateFile(client, input.teamId, 'documents', input.file)
  if (uploaded.error || !uploaded.path) return { error: uploaded.error }
  const result = await client.from('team_documents').insert({ team_id: input.teamId, tournament_id: input.tournamentId || null, category: input.category, storage_path: uploaded.path, original_name: input.file.name.slice(0, 200), mime_type: input.file.type, size_bytes: input.file.size, expires_at: input.expiresAt || null, uploaded_by: input.userId })
  if (result.error) { await client.storage.from('team-private').remove([uploaded.path]); return { error: isMissing(result.error.message) ? NEEDS_031 : result.error.message } }
  return { error: null }
}
export async function removeTeamDocument(client: SupabaseClient, document: TeamDocument): Promise<{ error: string | null }> {
  const result = await client.from('team_documents').delete().eq('id', document.id).select('id')
  if (result.error) return { error: result.error.message }
  if (!result.data?.length) return { error: 'Reviewed documents cannot be removed. Upload a replacement instead.' }
  await client.storage.from('team-private').remove([document.storagePath])
  return { error: null }
}

// --- Manual player and roster entry (migration manual_team_and_roster_entry) ---------------
export const NEEDS_MANUAL_ENTRY = 'This needs the manual team and roster entry migration to be applied.'
const MANUAL_ERRORS: Record<string, string> = {
  player_claimed_invite_instead: 'This player has their own account. Send them an invitation; they join once they accept.',
  already_member: 'This player is already in the team.',
  duplicate_jersey: 'Another current player already wears that number.',
  invalid_jersey: 'Jersey numbers go from 0 to 99.',
  team_permission_required: 'You need the "Manage players" permission in this team.',
  organizer_permission_required: 'Only organizers of this tournament can do this.',
  roster_locked: 'This team’s roster is locked.',
  player_not_found: 'That player record could not be found.',
}
function manualError(message: string): string {
  if (isMissing(message)) return NEEDS_MANUAL_ENTRY
  const code = Object.keys(MANUAL_ERRORS).find(key => message.includes(key))
  return code ? MANUAL_ERRORS[code] : 'This could not be saved. Please try again.'
}
const jerseyValue = (value: string) => value.trim() === '' ? null : Number(value)

export type UnclaimedMatch = { id: string; name: string; island: string | null }
// Unclaimed records the caller may already see; names and islands only.
export async function searchUnclaimedPlayers(client: SupabaseClient, query: string, scope: { teamId: string } | { entryId: string }): Promise<{ data: UnclaimedMatch[]; error: string | null }> {
  if (query.trim().length < 2) return { data: [], error: null }
  const result = await client.rpc('search_unclaimed_players', { p_query: query, p_team_id: 'teamId' in scope ? scope.teamId : null, p_entry_id: 'entryId' in scope ? scope.entryId : null })
  if (result.error) return { data: [], error: manualError(result.error.message) }
  return { data: ((result.data ?? []) as Record<string, unknown>[]).map(row => ({ id: String(row.player_id), name: String(row.display_name ?? 'Player'), island: typeof row.island === 'string' ? row.island : null })), error: null }
}

// Team manager: add an existing unclaimed player straight to the team.
export async function addExistingTeamPlayer(client: SupabaseClient, input: { teamId: string; playerId: string; position: string; jerseyNumber: string }): Promise<{ error: string | null }> {
  const result = await client.rpc('add_team_player', { p_team_id: input.teamId, p_player_id: input.playerId, p_position: input.position || null, p_jersey: jerseyValue(input.jerseyNumber) })
  if (!result.error) {
    if (typeof client.rpc === 'function') await client.rpc('publish_player_profile', { p_player_id: input.playerId })
    if (typeof client.rpc === 'function') await client.rpc('publish_team', { p_team_id: input.teamId })
  }
  return { error: result.error ? manualError(result.error.message) : null }
}

// Organizer: put a player in a team entered in their tournament. A new
// player is created unclaimed first, with the same private duplicate-ID check
// team managers use; a duplicate creates nothing.
export async function organizerAddPlayer(client: SupabaseClient, input: { entryId: string; userId: string; playerId: string | null; name: string; island: string; position: string; jerseyNumber: string; identity: IdentityInput | null }): Promise<{ error: string | null; matched?: string | null }> {
  let playerId = input.playerId
  let created = false
  let matched: string | null = null
  // An exact ID match reuses the existing player (page 42); nothing is created.
  if (!playerId && input.identity && input.identity.value.trim()) {
    const found = await lookupIdentity(client, input.entryId, input.identity)
    if (found.status === 'match') { playerId = found.playerId; matched = found.displayName }
  }
  if (!playerId) {
    if (input.name.trim().length < 2) return { error: 'Enter the player’s name.' }
    const record = await createUnclaimedPlayer(client, input.userId, input.name, input.island)
    if (record.error || !record.data) return { error: 'The player could not be created. Please try again.' }
    playerId = record.data.id; created = true
    if (input.identity && input.identity.value.trim()) {
      const identity = await registerIdentity(client, playerId, input.identity)
      if (identity.status !== 'registered' && identity.status !== 'already_registered') {
        await client.from('player_profiles').delete().eq('id', playerId)
        return { error: identity.status === 'identity_in_use' ? `${identity.message} Search for the existing player instead.` : identity.message }
      }
    }
  }
  const result = await client.rpc('organizer_add_team_player', { p_entry_id: input.entryId, p_player_id: playerId, p_position: input.position || null, p_jersey: jerseyValue(input.jerseyNumber) })
  if (result.error) {
    if (created) await client.from('player_profiles').delete().eq('id', playerId)
    return { error: manualError(result.error.message) }
  }
  if (typeof client.rpc === 'function') await client.rpc('publish_player_profile', { p_player_id: playerId })
  const entry = await client.from('tournament_entries').select('team_id').eq('id', input.entryId).maybeSingle()
  const teamId = (entry.data as { team_id?: string } | null)?.team_id
  if (teamId && typeof client.rpc === 'function') await client.rpc('publish_team', { p_team_id: teamId })
  return { error: null, matched }
}

export type SquadPlayer = { id: string; name: string; claimed: boolean; position: string | null; jerseyNumber: number | null; squadRole: string | null }
export async function loadEntrySquad(client: SupabaseClient, entryId: string): Promise<{ data: SquadPlayer[]; error: string | null }> {
  const result = await client.rpc('get_entry_team_players', { p_entry_id: entryId })
  if (result.error) return { data: [], error: manualError(result.error.message) }
  return { data: ((result.data ?? []) as Record<string, unknown>[]).map(row => ({ id: String(row.player_id), name: String(row.display_name ?? 'Player'), claimed: row.claimed === true, position: typeof row.player_position === 'string' ? row.player_position : null, jerseyNumber: typeof row.jersey_number === 'number' ? row.jersey_number : null, squadRole: typeof row.squad_role === 'string' ? row.squad_role : null })), error: null }
}
