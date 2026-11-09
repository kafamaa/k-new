import type { SupabaseClient, User } from '@supabase/supabase-js'
import { adminRoleLabel, loadAdminAccess } from './adminAccess'

export type Profile = { id: string; display_name: string; avatar_url: string | null; locale: string; timezone: string }
export type Workspace = { id: string; name: string; slug: string; role: string; kind: 'organization' | 'team' | 'player' | 'official' | 'platform_admin'; logoUrl?: string | null }
// duplicatePlayers: more than one player profile is linked to the account. The
// database prevents this (account_id is unique), but if it ever happens no
// profile is opened silently.
// adminError: the administrator check failed. It is shown as its own problem and never
// read as "not an administrator".
export type WorkspaceSummary = { profile: Profile | null; workspaces: Workspace[]; duplicatePlayers?: boolean; adminError?: string }

// The Super Admin entry: only what the card shows. The id is the account itself;
// the admin workspace re-checks access with the database when it opens.
export function platformAdminWorkspace(userId: string, permissions: string[], legacyOwner = false): Workspace {
  return { id: userId, name: 'Super Admin', slug: 'platform-admin', role: adminRoleLabel(permissions, legacyOwner), kind: 'platform_admin' }
}

export function profilePayload(user: Pick<User, 'id' | 'user_metadata'>): Profile {
  return { id: user.id, display_name: typeof user.user_metadata.full_name === 'string' ? user.user_metadata.full_name : '', avatar_url: typeof user.user_metadata.avatar_url === 'string' ? user.user_metadata.avatar_url : null, locale: 'en', timezone: 'Indian/Maldives' }
}

export function canAccessWorkspace(workspace: Workspace, userId: string): boolean {
  return Boolean(userId) && Boolean(workspace.id) && Boolean(workspace.role)
}

export function playerWorkspace(player: { id: string; display_name: string; slug: string; photo_url?: string | null }): Workspace {
  return { id: player.id, name: player.display_name, slug: player.slug, role: 'player', kind: 'player', ...(player.photo_url ? { logoUrl: player.photo_url } : {}) }
}

export async function loadWorkspaceSummary(client: SupabaseClient, user: Pick<User, 'id' | 'user_metadata'>): Promise<{ data: WorkspaceSummary | null; error: string | null }> {
  // Profile, memberships, the player link, and both self-scoped assignment
  // reads are independent and keyed to the same user, so they run
  // concurrently. Errors are checked in the original order so the first
  // failing read still surfaces its message first. The assignment reads
  // (official + tournament staff) fail silently to zero rows on a database
  // without migration 202610240021, degrading to "no official workspace"
  // instead of an error.
  const [profileResult, organizations, teams, player, officialAssignments, staffAssignments, adminAccess] = await Promise.all([
    client.from('profiles').select('id,display_name,avatar_url,locale,timezone').eq('id', user.id).maybeSingle(),
    client.from('organization_memberships').select('organization_id,role,organizations(name,slug)').eq('user_id', user.id),
    client.from('team_memberships').select('team_id,role,teams(name,slug,logo_url)').eq('user_id', user.id),
    client.from('player_profiles').select('id,display_name,slug,photo_url').eq('account_id', user.id).limit(2),
    client.from('match_official_assignments').select('match_id,role').eq('user_id', user.id).limit(1),
    client.from('tournament_staff_assignments').select('tournament_id,permission').eq('user_id', user.id).limit(1),
    // Administrator access for this session (admin_permissions; bootstrap owners in
    // platform_admins receive every permission). Decided by the database, never by email or metadata.
    loadAdminAccess(client),
  ])
  if (profileResult.error) return { data: null, error: profileResult.error.message }
  if (organizations.error) return { data: null, error: organizations.error.message }
  if (teams.error) return { data: null, error: teams.error.message }
  if (player.error) return { data: null, error: player.error.message }
  if (officialAssignments.error) return { data: null, error: officialAssignments.error.message }
  if (staffAssignments.error) return { data: null, error: staffAssignments.error.message }
  const workspaces: Workspace[] = []
  for (const row of organizations.data ?? []) {
    const organization = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations
    if (organization?.name && organization.slug) workspaces.push({ id: row.organization_id, name: organization.name, slug: organization.slug, role: row.role, kind: 'organization' })
  }
  for (const row of teams.data ?? []) {
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
    if (team?.name && team.slug) workspaces.push({ id: row.team_id, name: team.name, slug: team.slug, role: row.role, kind: 'team', logoUrl: team.logo_url ?? null })
  }
  const linkedPlayers = player.data ?? []
  const duplicatePlayers = linkedPlayers.length > 1
  const linked = duplicatePlayers ? null : linkedPlayers[0]
  if (linked?.id && linked.display_name && linked.slug) workspaces.push(playerWorkspace(linked))
  // One official/staff workspace per account with at least one authorized
  // assignment. Its id is the account id because access is always scoped by
  // auth.uid() inside the assignment policies, never by a team or
  // organization id.
  if (officialAssignments.data?.length || staffAssignments.data?.length) workspaces.push({ id: user.id, name: 'Match operations', slug: user.id, role: officialAssignments.data?.length ? 'official' : 'staff', kind: 'official' })
  if (!adminAccess.error && (adminAccess.permissions.length || adminAccess.legacyOwner)) workspaces.push(platformAdminWorkspace(user.id, adminAccess.permissions, adminAccess.legacyOwner))
  return { data: { profile: profileResult.data as Profile | null, workspaces, duplicatePlayers, ...(adminAccess.error ? { adminError: adminAccess.error } : {}) }, error: null }
}

export async function upsertProfile(client: SupabaseClient, user: Pick<User, 'id' | 'user_metadata'>): Promise<{ error: string | null }> {
  const result = await client.from('profiles').upsert(profilePayload(user), { onConflict: 'id' })
  return { error: result.error?.message ?? null }
}

// ---------------------------------------------------------------------------
// Workspace navigation (Choose Workspace rule). Pure helpers, unit-tested.
// After sign-in the app always lands on Choose Workspace; a specific workspace
// is only opened through an explicit, authorized selection (or a safe refresh
// restore of a still-authorized route). Nothing is ever opened automatically.
// ---------------------------------------------------------------------------

export type WorkspaceKind = Workspace['kind']
export type WorkspaceRouteTarget = { kind: 'choose' } | { kind: 'open'; workspaceKind: WorkspaceKind; id: string }

const WORKSPACE_KINDS: WorkspaceKind[] = ['player', 'team', 'organization', 'official']
// Kinds the account can create through onboarding. The official kind appears
// only by organizer assignment, never by self-service creation.
const CREATION_KINDS: WorkspaceKind[] = ['player', 'team', 'organization']

// '#workspace' -> choose. '#workspace/<kind>/<id>' -> open that workspace.
// '#workspace/platform-admin[/<page>]' -> the Super Admin workspace (no id: it is the account's own).
// Any other hash is treated as choose; the caller only routes workspace hashes here.
export function parseWorkspaceRoute(hash: string): WorkspaceRouteTarget {
  const raw = hash.replace(/^#\/?/, '')
  const parts = raw.split('?')[0].split('/').filter(Boolean)
  if (parts[0] !== 'workspace') return { kind: 'choose' }
  if (parts[1] === 'platform-admin') return { kind: 'open', workspaceKind: 'platform_admin', id: '' }
  const segment = parts[1] as WorkspaceKind | undefined
  const id = parts[2] ? decodeURIComponent(parts.slice(2).join('/')) : ''
  if (!segment || !id || !WORKSPACE_KINDS.includes(segment)) return { kind: 'choose' }
  return { kind: 'open', workspaceKind: segment, id }
}

export const isPlatformAdminRoute = (hash: string) => /^#\/?workspace\/platform-admin(\/|\?|$)/.test(hash)

export function workspaceRouteHash(workspace: Workspace): string {
  if (workspace.kind === 'platform_admin') return '#workspace/platform-admin'
  return `#workspace/${workspace.kind}/${encodeURIComponent(workspace.id)}`
}

// Resolve a parsed target against the authorized workspaces. Returns null for
// 'choose', unknown ids, and kind mismatches so an unauthorized workspace is
// never opened.
export function resolveAuthorizedWorkspace(target: WorkspaceRouteTarget, workspaces: Workspace[]): Workspace | null {
  if (target.kind !== 'open') return null
  if (target.workspaceKind === 'platform_admin') return workspaces.find(workspace => workspace.kind === 'platform_admin') ?? null
  return workspaces.find(workspace => workspace.kind === target.workspaceKind && workspace.id === target.id) ?? null
}

export function groupWorkspacesByKind(workspaces: Workspace[]): Record<WorkspaceKind, Workspace[]> {
  return {
    player: workspaces.filter(workspace => workspace.kind === 'player'),
    team: workspaces.filter(workspace => workspace.kind === 'team'),
    organization: workspaces.filter(workspace => workspace.kind === 'organization'),
    official: workspaces.filter(workspace => workspace.kind === 'official'),
    platform_admin: workspaces.filter(workspace => workspace.kind === 'platform_admin'),
  }
}

// Kinds with no authorized workspace get their onboarding choice instead.
export function workspaceKindsNeedingOnboarding(workspaces: Workspace[]): WorkspaceKind[] {
  const groups = groupWorkspacesByKind(workspaces)
  return CREATION_KINDS.filter(kind => groups[kind].length === 0)
}

export const ONBOARDING_LABELS: Record<Exclude<WorkspaceKind, 'official' | 'platform_admin'>, string> = {
  player: 'Create Player Profile',
  team: 'Create/Join Team',
  organization: 'Create Organization',
}

export const WORKSPACE_KIND_LABELS: Record<WorkspaceKind, string> = {
  player: 'Player',
  team: 'Team',
  organization: 'Organizer',
  official: 'Official',
  platform_admin: 'Super Admin',
}

// A fresh sign-in (no prior session) must land on Choose Workspace. A page
// refresh or token refresh of an existing session must NOT redirect, so the
// current authorized route is restored instead.
export function shouldOpenChooseWorkspace(event: string, wasSignedOut: boolean): boolean {
  return event === 'SIGNED_IN' && wasSignedOut
}

// #workspace/player (no id) opens the player profile linked to the signed-in
// account, keeping ?section=… . The id always comes from the account link,
// never from the browser. Returns null when the hash is not that shortcut.
export function playerShortcutTarget(hash: string, workspaces: Workspace[]): { target: string | null } | null {
  const match = /^#\/?workspace\/player\/?(\?.*)?$/.exec(hash)
  if (!match) return null
  const players = workspaces.filter(workspace => workspace.kind === 'player')
  return { target: players.length === 1 ? `${workspaceRouteHash(players[0])}${match[1] ?? ''}` : null }
}
