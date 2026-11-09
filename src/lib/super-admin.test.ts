import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { adminHash, adminNextAction, adminProblem, ADMIN_PAGES, auditCsv, parseAdminHash, visiblePages, type AuditEvent } from './superAdmin'
import { cleanConfig, configProblems, contrast, contrastChecks, DEFAULT_THEME, themeVariables } from './appConfig'
import { parsePublicHash } from './publicRoutes'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const migration = read('supabase/migrations/202611010034_super_admin_release_one.sql')

describe('Super Admin routes and navigation', () => {
  it('parses #admin/<page> and falls back to Overview', () => {
    expect(parsePublicHash('#admin/cases')).toEqual({ kind: 'admin' })
    expect(parseAdminHash('#admin').page).toBe('overview')
    expect(parseAdminHash('#admin/audit').page).toBe('audit')
    expect(parseAdminHash('#admin/nonsense').page).toBe('overview')
    expect(parseAdminHash('#admin/cases?case=abc').params.get('case')).toBe('abc')
    // The Super Admin workspace moved to #workspace/platform-admin; #admin links still parse and redirect.
    expect(adminHash('accounts', { q: 'ali', empty: '' })).toBe('#workspace/platform-admin/accounts?q=ali')
    expect(parseAdminHash('#workspace/platform-admin/audit').page).toBe('audit')
  })
  it('covers every route in the specification, grouped in five groups', () => {
    for (const id of ['overview', 'cases', 'accounts', 'identities', 'organizations', 'teams', 'players', 'tournaments', 'matches', 'content', 'support', 'data-requests', 'finance', 'notifications', 'audit', 'security', 'system', 'configuration', 'customization', 'admins'])
      expect(ADMIN_PAGES.some(page => page.id === id)).toBe(true)
    // Updated for the final menu table (2 Nov 2026): grouping and labels changed; every page/tab is still listed.
    expect(new Set(ADMIN_PAGES.map(page => page.group))).toEqual(new Set(['overview', 'people', 'sports', 'operations', 'platform']))
  })
  it('shows only the pages a role may open', () => {
    const moderator = visiblePages(['admin.dashboard.read', 'admin.cases.manage', 'admin.content.moderate', 'admin.teams.moderate']).map(page => page.id)
    expect(moderator).toContain('teams')
    expect(moderator).not.toContain('accounts')
    expect(moderator).not.toContain('admins')
    expect(visiblePages([])).toEqual([])
  })
  // Updated for Release Two: finance, notifications and configuration are built, plus Critical approvals.
  it('has no placeholder pages left', () => {
    expect(ADMIN_PAGES.filter(page => page.later)).toEqual([])
    expect(ADMIN_PAGES.find(page => page.id === 'approvals')?.any).toEqual(['admin.results.review', 'admin.identities.review'])
  })
})

describe('Super Admin overview and errors', () => {
  it('picks the most urgent permitted task', () => {
    expect(adminNextAction({ openReports: 2, criticalCases: 1 })?.page).toBe('cases')
    expect(adminNextAction({ identityRequests: 3, openReports: 2 })?.label).toBe('Review identity requests')
    expect(adminNextAction({ openCases: 0 })).toBeNull()
  })
  it('never shows raw service errors', () => {
    expect(adminProblem('admin_permission_denied')).toMatch(/role does not allow/)
    expect(adminProblem('reauthentication_required')).toMatch(/sign in again/)
    expect(adminProblem('Could not find the function public.admin_overview')).toMatch(/202611010034/)
    const raw = adminProblem('duplicate key value violates unique constraint "platform_cases_pkey"')
    expect(raw).not.toMatch(/platform_cases|constraint|key/)
  })
  it('exports audit CSV without formula injection or raw identifiers', () => {
    const row: AuditEvent = { id: 1, actor_id: 'secret-uuid', actor_roles: 'moderator', action: 'record_hidden', target_type: 'team', target_id: 'team-uuid', target_label: '=HYPERLINK("x")', reason: 'Fake team', case_id: null, before_summary: null, after_summary: null, created_at: '2026-10-31T10:00:00Z' }
    const csv = auditCsv([row])
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).not.toContain('secret-uuid')
    expect(csv).not.toContain('team-uuid')
  })
})

describe('App customization', () => {
  it('accepts only fixed, safe values', () => {
    expect(configProblems({ theme: { accent: '#112233', radius: 12 } })).toEqual([])
    expect(configProblems({ theme: { accent: 'red' } }).length).toBe(1)
    expect(configProblems({ landing: { heroTitle: '<script>alert(1)</script>' } }).length).toBeGreaterThan(0)
    expect(configProblems({ landing: { heroLede: 'javascript:alert(1)' } }).length).toBeGreaterThan(0)
    expect(configProblems({ landing: { hiddenSections: ['footer'] } }).length).toBe(1)
  })
  it('stores only changes from the built-in theme', () => {
    expect(cleanConfig({ theme: { ...DEFAULT_THEME }, landing: { heroTitle: 'Island sport.' } })).toEqual({})
    expect(cleanConfig({ theme: { accent: '#AABBCC' } })).toEqual({ theme: { accent: '#aabbcc' } })
  })
  it('measures contrast and blocks only changes that make it worse', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 0)
    expect(contrastChecks({}).some(check => check.blocking)).toBe(false)
    // The built-in link colour is below 4.5:1: reported, not blocking.
    expect(contrastChecks({}).find(check => check.label === 'Links on white')?.pass).toBe(false)
    expect(contrastChecks({ theme: { accentStrong: '#7fd3e6' } }).find(check => check.label === 'Links on white')?.blocking).toBe(true)
    expect(contrastChecks({ theme: { accentStrong: '#05566b' } }).find(check => check.label === 'Links on white')?.pass).toBe(true)
  })
  it('maps theme values to the editorial CSS variables', () => {
    expect(themeVariables({ theme: { accent: '#112233', radius: 10 } })).toMatchObject({ '--ed-accent': '#112233', '--ed-radius': '10px' })
  })
})

describe('Super Admin migration safety (static review)', () => {
  it('uses an empty search_path on every SECURITY DEFINER function', () => {
    const definers = migration.match(/security definer[^\n]*/g) ?? []
    expect(definers.length).toBeGreaterThan(20)
    for (const line of definers) expect(line).toContain("set search_path = ''")
  })
  it('revokes API access from internal helpers and anon', () => {
    expect(migration).toContain('revoke execute on function public.admin_audit(text, text, text, text, text, uuid, jsonb, jsonb, uuid) from public, anon, authenticated')
    expect(migration).toContain("revoke execute on function %s from public, anon")
    // Only the published theme is visible to visitors.
    expect(migration.match(/grant execute on function [^;]+ to anon/g)).toEqual(['grant execute on function public.get_active_configuration() to anon'])
  })
  it('keeps the audit log append-only and admin tables write-protected', () => {
    expect(migration).toContain('before update or delete on public.platform_audit_events')
    expect(migration).toContain('before truncate on public.platform_audit_events')
    expect(migration).toMatch(/revoke insert, update, delete, truncate on public\.platform_admin_assignments/)
    expect(migration).not.toMatch(/for (insert|update|delete|all) to authenticated\s+using \(true\)/)
  })
  it('requires reasons, recent sign-in and two people where the specification demands it', () => {
    expect(migration.match(/admin_require_reason\(p_reason\)/g)?.length).toBeGreaterThan(8)
    expect(migration).toContain("raise exception 'self_approval_not_allowed'")
    expect(migration).toContain("raise exception 'cannot_grant_more_than_you_hold'")
    expect(migration).toContain("v_status := case when p_role = 'platform_owner' then 'proposed' else 'active' end")
    expect(migration).toContain("perform public.admin_require_recent_auth();")
  })
  it('hides records without deleting them and blocks re-publishing', () => {
    expect(migration).toContain("raise exception 'hidden_by_platform'")
    expect(migration).not.toMatch(/delete from public\.(organizations|teams|player_profiles|tournaments|news_articles|matches)/)
  })
  it('never selects identity digests or private details in admin readers', () => {
    expect(migration).not.toMatch(/keyed_digest|player_private_details|private_documents/)
  })
})
