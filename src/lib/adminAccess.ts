import type { SupabaseClient } from '@supabase/supabase-js'

// Administrator access, kept small and separate from the Super Admin workspace
// (superAdmin.ts) so the public pages that need it — the header's Super Admin
// link and Choose Workspace — do not load the admin code.

export const ADMIN_WORKSPACE_HASH = '#workspace/platform-admin'
export const isLegacyAdminHash = (hash: string) => /^#\/?admin(\/|\?|$)/.test(hash)
export const legacyAdminTarget = (hash: string) => hash.replace(/^#\/?admin/, ADMIN_WORKSPACE_HASH)

export const needsMigration = (message: string | null | undefined) => /PGRST202|Could not find the function|does not exist|schema cache/.test(message ?? '')

// Plain language only; raw service messages are never shown.
const accessProblem = (message: string | null | undefined) => /network|fetch|timeout/i.test(message ?? '') ? 'Check your connection and try again.' : 'Administrator access could not be checked. Try again in a moment.'

// Access: effective permissions, falling back to the bootstrap owner check (027)
// when this migration is not applied yet.
// A failed check is an error, never "not an administrator".
export async function loadAdminAccess(client: SupabaseClient): Promise<{ permissions: string[]; legacyOwner: boolean; error: string | null; code?: string; expired?: boolean }> {
  const result = await client.rpc('admin_permissions')
  if (!result.error) return { permissions: (result.data ?? []) as string[], legacyOwner: false, error: null }
  if (!needsMigration(result.error.message)) return { permissions: [], legacyOwner: false, error: accessProblem(result.error.message), code: result.error.code, expired: isExpired(result.error) }
  const legacy = await client.rpc('is_platform_admin')
  if (legacy.error) return { permissions: [], legacyOwner: false, error: accessProblem(legacy.error.message), code: legacy.error.code, expired: isExpired(legacy.error) }
  return { permissions: [], legacyOwner: legacy.data === true, error: null }
}

const isExpired = (error: { message?: string; code?: string } | null | undefined) => Boolean(error && (error.code === 'PGRST301' || error.code === 'PGRST303' || /jwt expired|invalid jwt|token has expired|refresh token|session missing|auth session/i.test(error.message ?? '')))

export type AdminAccessState =
  | { state: 'admin'; permissions: string[] }
  | { state: 'legacy' }
  | { state: 'denied' }
  | { state: 'expired' }
  | { state: 'error'; message: string }

// The account is confirmed with the auth server first (getUser), then its access is
// read from the database for that session. An expired session is refreshed once and
// the check repeated; if that fails the person must sign in again. Error codes are
// logged in development only, never tokens.
export async function checkAdminAccess(client: SupabaseClient, expectedUserId: string): Promise<AdminAccessState> {
  const log = (step: string, code: string | undefined) => { if (import.meta.env.DEV) console.warn(`[admin access] ${step} failed`, code ?? 'no code') }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const refreshAndRetry = async () => { if (attempt > 0) return false; const refreshed = await client.auth.refreshSession(); return !refreshed.error && Boolean(refreshed.data.session) }
    const who = await client.auth.getUser()
    if (who.error || !who.data.user) {
      log('getUser', who.error?.code)
      if (await refreshAndRetry()) continue
      return who.error && !isExpired(who.error) && !/session/i.test(who.error.message) ? { state: 'error', message: accessProblem(who.error.message) } : { state: 'expired' }
    }
    if (who.data.user.id !== expectedUserId) return { state: 'expired' }
    const access = await loadAdminAccess(client)
    if (access.error) {
      log('admin_permissions', access.code)
      if (access.expired) { if (await refreshAndRetry()) continue; return { state: 'expired' } }
      return { state: 'error', message: access.error }
    }
    if (access.permissions.length) return { state: 'admin', permissions: access.permissions }
    return access.legacyOwner ? { state: 'legacy' } : { state: 'denied' }
  }
  return { state: 'expired' }
}

// The Choose Workspace entry. It holds only what the card shows: never other
// administrators, audit data or the directory.
export function adminRoleLabel(permissions: string[], legacyOwner = false): string {
  if (legacyOwner || (permissions.includes('admin.admins.manage') && permissions.includes('admin.customization.publish') && permissions.includes('admin.security.manage'))) return 'Platform Owner'
  return `${permissions.length} administrator permission${permissions.length === 1 ? '' : 's'}`
}
