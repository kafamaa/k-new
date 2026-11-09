import { describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ADMIN_PAGES, checkAdminAccess, isLegacyAdminHash, legacyAdminTarget, parseAdminHash, visiblePages } from './superAdmin'
import { isPlatformAdminRoute, loadWorkspaceSummary, parseWorkspaceRoute, resolveAuthorizedWorkspace, shouldOpenChooseWorkspace, workspaceRouteHash, type Workspace } from './workspace'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const USER = 'ac1c3c2d-34f2-4f4f-9492-7cdc3919f282'
// Every permission any admin page needs: what a bootstrap Platform Owner receives.
const OWNER_PERMISSIONS = [...new Set(ADMIN_PAGES.flatMap(page => page.any))].concat(['admin.admins.manage', 'admin.customization.publish', 'admin.security.manage'])

type RpcResult = { data: unknown; error: { message: string; code?: string } | null }
function fakeClient(options: { rpc?: Record<string, RpcResult | RpcResult[]>; users?: Array<{ data: { user: { id: string } | null }; error: { message: string; code?: string } | null }>; refresh?: { error: { message: string } | null } }) {
  const rpcCalls: string[] = []
  const queues = Object.fromEntries(Object.entries(options.rpc ?? {}).map(([name, value]) => [name, Array.isArray(value) ? [...value] : [value]]))
  const users = [...(options.users ?? [{ data: { user: { id: USER } }, error: null }])]
  const chain = () => { const result = { data: [], error: null }; const self: Record<string, unknown> = { select: () => self, eq: () => self, limit: () => Promise.resolve(result), maybeSingle: () => Promise.resolve({ data: null, error: null }), then: (done: (value: unknown) => void) => done(result) }; return self }
  const refreshSession = vi.fn(async () => ({ data: { session: options.refresh?.error ? null : { access_token: 'x' } }, error: options.refresh?.error ?? null }))
  const client = {
    from: chain,
    rpc: async (name: string) => { rpcCalls.push(name); const queue = queues[name]; return (queue && queue.length > 1 ? queue.shift() : queue?.[0]) ?? { data: null, error: { message: 'Could not find the function', code: 'PGRST202' } } },
    auth: { getUser: async () => users.length > 1 ? users.shift()! : users[0], refreshSession },
  } as unknown as SupabaseClient
  return { client, rpcCalls, refreshSession }
}

describe('Choose Workspace: Super Admin entry', () => {
  it('1. a bootstrap platform_admins row gives a platform_admin workspace item', async () => {
    const { client } = fakeClient({ rpc: { admin_permissions: { data: OWNER_PERMISSIONS, error: null } } })
    const summary = await loadWorkspaceSummary(client, { id: USER, user_metadata: {} })
    expect(summary.data?.workspaces).toContainEqual({ kind: 'platform_admin', id: USER, name: 'Super Admin', slug: 'platform-admin', role: 'Platform Owner' })
  })
  it('1b. before migration 034, the bootstrap check (is_platform_admin) still shows it', async () => {
    const { client } = fakeClient({ rpc: { is_platform_admin: { data: true, error: null } } })
    const summary = await loadWorkspaceSummary(client, { id: USER, user_metadata: {} })
    expect(summary.data?.workspaces.find(item => item.kind === 'platform_admin')?.role).toBe('Platform Owner')
  })
  it('2. a normal signed-in account does not get it', async () => {
    const { client } = fakeClient({ rpc: { admin_permissions: { data: [], error: null } } })
    const summary = await loadWorkspaceSummary(client, { id: 'someone-else', user_metadata: {} })
    expect(summary.data?.workspaces.some(item => item.kind === 'platform_admin')).toBe(false)
    expect(summary.data?.adminError).toBeUndefined()
  })
  it('4. a failed admin query is an error, never "not an administrator"', async () => {
    const { client } = fakeClient({ rpc: { admin_permissions: { data: null, error: { message: 'fetch failed', code: '' } } } })
    const summary = await loadWorkspaceSummary(client, { id: USER, user_metadata: {} })
    expect(summary.error).toBeNull()
    expect(summary.data?.adminError).toBeTruthy()
    expect(summary.data?.workspaces.some(item => item.kind === 'platform_admin')).toBe(false)
    const access = await checkAdminAccess(fakeClient({ rpc: { admin_permissions: { data: null, error: { message: 'fetch failed' } } } }).client, USER)
    expect(access.state).toBe('error')
  })
})

describe('Super Admin access check', () => {
  it('3. guests cannot query administrator access', () => {
    const legacy = read('supabase/migrations/202610300027_platform_admin_highlights.sql')
    expect(legacy).toContain('revoke execute on function public.is_platform_admin() from public, anon;')
    expect(legacy).toContain('for select to authenticated using (user_id = auth.uid())')
    expect(legacy).not.toMatch(/platform_admins for select to anon|platform_admins for insert/)
    const r1 = read('supabase/migrations/202611010034_super_admin_release_one.sql')
    expect(r1).toContain("execute format('revoke execute on function %s from public, anon', v_sig)")
  })
  it('5. an expired session is refreshed once and the check repeated', async () => {
    const recovered = fakeClient({ users: [{ data: { user: null }, error: { message: 'JWT expired', code: 'PGRST301' } }, { data: { user: { id: USER } }, error: null }], rpc: { admin_permissions: { data: OWNER_PERMISSIONS, error: null } } })
    expect((await checkAdminAccess(recovered.client, USER)).state).toBe('admin')
    expect(recovered.refreshSession).toHaveBeenCalledTimes(1)
    const stillExpired = fakeClient({ rpc: { admin_permissions: { data: null, error: { message: 'JWT expired', code: 'PGRST301' } } } })
    expect(await checkAdminAccess(stillExpired.client, USER)).toEqual({ state: 'expired' })
    expect(stillExpired.refreshSession).toHaveBeenCalledTimes(1)
    const refreshFails = fakeClient({ users: [{ data: { user: null }, error: { message: 'Auth session missing!' } }], refresh: { error: { message: 'Invalid Refresh Token' } } })
    expect(await checkAdminAccess(refreshFails.client, USER)).toEqual({ state: 'expired' })
  })
  it('6. the route rejects a signed-in non-administrator', async () => {
    expect(await checkAdminAccess(fakeClient({ rpc: { admin_permissions: { data: [], error: null } } }).client, USER)).toEqual({ state: 'denied' })
    const panel = read('src/components/WorkspacePanel.tsx')
    expect(panel).toContain('!adminRoute && parseWorkspaceRoute(hash).kind === \'open\' && !selected')
    expect(panel).toContain('{adminRoute ? <Suspense')
    expect(read('src/components/AdminWorkspace.tsx')).toContain('<h1>Access denied</h1><p>Not a platform administrator.')
  })
  it('10. authorization uses the confirmed account id, never email or user_metadata', async () => {
    // The access check lives in its own small module (kept out of the admin chunk's way).
    const lib = read('src/lib/adminAccess.ts')
    const fn = lib.slice(lib.indexOf('export async function loadAdminAccess'), lib.indexOf('export function adminRoleLabel'))
    expect(fn).not.toMatch(/user_metadata|email|localStorage/)
    const summary = read('src/lib/workspace.ts')
    expect(summary).toContain('loadAdminAccess(client)')
    expect(summary.replace(/\/\/.*$/gm, '')).not.toMatch(/platform_admin[^\n]*(email|user_metadata)/)
    // A token for another account is never accepted as this account's access.
    expect(await checkAdminAccess(fakeClient({ users: [{ data: { user: { id: 'other' } }, error: null }], rpc: { admin_permissions: { data: OWNER_PERMISSIONS, error: null } } }).client, USER)).toEqual({ state: 'expired' })
  })
})

describe('Routing', () => {
  const admin: Workspace = { kind: 'platform_admin', id: USER, name: 'Super Admin', slug: 'platform-admin', role: 'Platform Owner' }
  it('7. a refresh of the admin route keeps it, and no sign-in event sends it to the chooser', () => {
    for (const hash of ['#workspace/platform-admin', '#workspace/platform-admin/audit', '#workspace/platform-admin/matches?match=x']) {
      expect(isPlatformAdminRoute(hash)).toBe(true)
      expect(resolveAuthorizedWorkspace(parseWorkspaceRoute(hash), [admin])).toBe(admin)
    }
    expect(parseAdminHash('#workspace/platform-admin/audit').page).toBe('audit')
    expect(shouldOpenChooseWorkspace('INITIAL_SESSION', false)).toBe(false)
    expect(shouldOpenChooseWorkspace('TOKEN_REFRESHED', false)).toBe(false)
    const app = read('src/App.tsx')
    expect(app).toContain("publicRoute.kind === 'workspace' && !authReady ?")
    expect(app).toContain("else if (!/^#\\/?(workspace\\/|admin)/.test(window.location.hash)) window.location.hash = '#workspace'")
    expect(isLegacyAdminHash('#admin/cases?case=1')).toBe(true)
    expect(legacyAdminTarget('#admin/cases?case=1')).toBe('#workspace/platform-admin/cases?case=1')
    expect(isLegacyAdminHash('#administration')).toBe(false)
  })
  it('8. Switch Workspace returns to the chooser without signing out', () => {
    expect(workspaceRouteHash(admin)).toBe('#workspace/platform-admin')
    expect(parseWorkspaceRoute('#workspace')).toEqual({ kind: 'choose' })
    const shell = read('src/components/WorkspaceShell.tsx')
    expect(shell).toContain('<a className="ws-switch" href="#workspace">')
    expect(shell).not.toContain('signOut')
  })
})

describe('Safety', () => {
  it('9. no service-role or secret key is used in frontend code', () => {
    const files: string[] = []
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) files.push(path) } }
    walk(resolve(process.cwd(), 'src'))
    for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(/service_role|SERVICE_ROLE|sb_secret_|SUPABASE_SECRET/)
  })
  it('11. a Platform Owner gets every permission-aware section, others only theirs', () => {
    expect(visiblePages(OWNER_PERMISSIONS).map(page => page.id)).toEqual(ADMIN_PAGES.map(page => page.id))
    const one = ADMIN_PAGES.find(page => page.id === 'finance')!.any[0]
    const limited = visiblePages([one])
    expect(limited.length).toBeGreaterThan(0)
    expect(limited.length).toBeLessThan(ADMIN_PAGES.length)
    expect(limited.every(page => (page.any as readonly string[]).includes(one))).toBe(true)
  })
  it('12. no admin interface appears before authorization completes', () => {
    const workspace = read('src/components/AdminWorkspace.tsx')
    const gate = workspace.indexOf("if (access.state === 'checking')")
    expect(gate).toBeGreaterThan(0)
    expect(workspace.indexOf('<WorkspaceShell')).toBeGreaterThan(gate)
    for (const state of ["access.state === 'expired'", "access.state === 'error'", "access.state === 'denied'"]) expect(workspace.indexOf(state)).toBeLessThan(workspace.indexOf('<WorkspaceShell'))
    const chooser = read('src/components/WorkspaceChooser.tsx')
    expect(chooser).toContain('{groups.platform_admin[0] ? <AdminCard')
    expect(read('src/components/WorkspacePanel.tsx')).toContain('setWorkspaces([]); setName(\'\'); setAdminError(\'\') }, [user.id])')
  })
})
