import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { archiveOptions, archiveTournaments, EMPTY_ARCHIVE_FILTERS, isArchivedTournament, playerManagementLabel, teamManagementLabel, type ArchiveDetail } from './publicPages'
import { parsePublicHash } from './publicRoutes'
import { ADMIN_GROUPS, ADMIN_PAGES } from './superAdmin'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')

// docs/KULHIVARU_PLUS_FINAL_PLAN.md
describe('Final plan 5.4: claim status is not verification', () => {
  it('labels an unclaimed published player neutrally', () => {
    expect(playerManagementLabel({ is_claimed: false })).toBe('Record managed by an authorized organizer')
    expect(playerManagementLabel({})).toBe('Record managed by an authorized organizer')
    expect(playerManagementLabel({ is_claimed: true })).toBe('Claimed by the player')
  })
  it('labels a team by who manages it, and says nothing when unknown', () => {
    expect(teamManagementLabel('organizer')).toBe('Managed by tournament organizer')
    expect(teamManagementLabel('team')).toBe('Managed by the team')
    expect(teamManagementLabel(null)).toBeNull()
  })
  it('no longer calls a claimed profile "verified" on public pages', () => {
    const page = read('src/components/PublicPage.tsx')
    expect(page).not.toContain('Verified profile')
    expect(page).toContain('{playerManagementLabel(record)}')
    expect(read('src/components/HomepageSections.tsx')).not.toContain("row.is_claimed ? 'Verified'")
  })
  it('migration 041 returns only a label for published teams', () => {
    const sql = read('supabase/migrations/202611010041_public_management_labels.sql')
    expect(sql).toContain("security definer set search_path = ''")
    expect(sql).toContain('revoke execute on function public.get_public_team_management(uuid) from public;')
    expect(sql).toContain('t.is_published and t.deactivated_at is null')
    expect(sql).toContain('returns text')
    expect(sql).not.toMatch(/\b(drop|delete|truncate|insert|update)\b/i)
  })
})

describe('Final plan 19: public archive', () => {
  const records = [
    { id: 'a', name: 'Malé Futsal Cup', sport: 'futsal', status: 'completed', created_at: '2025-03-01T00:00:00Z' },
    { id: 'b', name: 'Addu Volleyball League', sport: 'volleyball', status: 'archived', created_at: '2024-01-01T00:00:00Z' },
    { id: 'c', name: 'Open Cup', sport: 'futsal', status: 'in_progress', created_at: '2026-01-01T00:00:00Z' },
  ]
  const details = new Map<string, ArchiveDetail>([['a', { startsAt: '2026-02-10T00:00:00Z', island: 'Malé', organizerName: 'FAM' }], ['b', { startsAt: null, island: 'Hithadhoo', organizerName: 'Addu Sports' }]])
  it('keeps only completed and archived tournaments, newest year first', () => {
    expect(isArchivedTournament('completed') && isArchivedTournament('archived') && !isArchivedTournament('in_progress')).toBe(true)
    expect(archiveTournaments(records, details, EMPTY_ARCHIVE_FILTERS).map(row => row.id)).toEqual(['a', 'b'])
  })
  it('filters by sport, year, island, organizer and search', () => {
    expect(archiveTournaments(records, details, { ...EMPTY_ARCHIVE_FILTERS, year: '2026' }).map(row => row.id)).toEqual(['a'])
    expect(archiveTournaments(records, details, { ...EMPTY_ARCHIVE_FILTERS, island: 'Hithadhoo' }).map(row => row.id)).toEqual(['b'])
    expect(archiveTournaments(records, details, { ...EMPTY_ARCHIVE_FILTERS, organizer: 'FAM', sport: 'futsal' }).map(row => row.id)).toEqual(['a'])
    expect(archiveTournaments(records, details, { ...EMPTY_ARCHIVE_FILTERS, query: 'addu' }).map(row => row.id)).toEqual(['b'])
    expect(archiveTournaments(records, details, { ...EMPTY_ARCHIVE_FILTERS, query: '%' }).length).toBe(2)
  })
  it('offers only options that exist in the archive', () => {
    expect(archiveOptions(records, details)).toEqual({ sports: ['futsal', 'volleyball'], years: ['2026', '2024'], islands: ['Hithadhoo', 'Malé'], organizers: ['Addu Sports', 'FAM'] })
  })
  it('has a stable route, an Explore tile and an archive banner on completed tournaments', () => {
    expect(parsePublicHash('#archive')).toEqual({ kind: 'archive' })
    expect(read('src/components/PublicDirectories.tsx')).toContain("{ href: '#archive', label: 'Archive'")
    expect(read('src/components/PublicPage.tsx')).toContain('Completed historical record')
  })
})

describe('Final plan 6: navigation', () => {
  const app = read('src/App.tsx')
  it('shows Home, Tournaments, Matches, Teams and Players in the header, with search and language', () => {
    const nav = app.slice(app.indexOf('const NAV_ITEMS = ['), app.indexOf('] as const', app.indexOf('const NAV_ITEMS = [')))
    // Players before Teams since the owner's 2026-11-02 navigation.
    expect([...nav.matchAll(/key: 'nav\.(\w+)'/g)].map(match => match[1])).toEqual(['home', 'tournaments', 'matches', 'teams', 'players'])
    expect(app).toContain('aria-label="Search"')
    expect(app).toContain('ed-lang-btn')
  })
  it('gives every workspace the five destinations in the plan', () => {
    const labels = (path: string, start: string) => { const source = read(path); const from = source.indexOf(start); return [...source.slice(from, source.indexOf(']\n', from)).matchAll(/label: '([^']+)'/g)].map(match => match[1]) }
    // Owner's workspace design (2026-11-04): nine sidebar destinations; every page and tab is still reachable.
    expect(labels('src/components/PlayerWorkspace.tsx', 'const NAV:')).toEqual(['Overview', 'My Profile', 'Digital Card', 'Career Records', 'My Matches', 'Requests', 'Documents', 'Activity', 'Privacy & Help'])
    expect(labels('src/components/TeamWorkspace.tsx', 'const GROUPS')).toEqual(['Overview', 'Squad', 'Tournaments', 'Matches', 'Team History', 'Finance', 'Staff', 'Documents', 'Team Settings'])
    // Owner (2026-11-02): four organizer items.
    expect(labels('src/components/OrganizerWorkspace.tsx', 'const ORG_GROUPS')).toEqual(['Home', 'Tournaments', 'Players & Teams', 'More'])
    // The owner's simple flow replaced the plan's tournament labels (2026-11-02).
    expect(labels('src/components/TournamentWorkspace.tsx', 'const TAB_GROUPS')).toEqual(['Home', 'Teams', 'Schedule', 'Matches', 'More'])
    const official = labels('src/components/OfficialWorkspace.tsx', 'const GROUPS')
    for (const label of ['Overview', 'Assignments', 'Match Center', 'Availability', 'Notices & Help']) expect(official).toContain(label)
    expect(ADMIN_GROUPS.map(group => group.label)).toEqual(['Overview', 'Records & Access', 'Sports Operations', 'Trust & Safety', 'Platform Settings'])
  })
  it('keeps every Super Admin page in one of the five groups', () => {
    const groups = new Set(ADMIN_GROUPS.map(group => group.id))
    expect(ADMIN_PAGES.every(page => groups.has(page.group))).toBe(true)
    expect(ADMIN_PAGES.filter(page => page.group === 'people').map(page => page.id)).toEqual(expect.arrayContaining(['accounts', 'players', 'teams', 'organizations', 'create', 'admins']))
    expect(ADMIN_PAGES.filter(page => page.group === 'operations').map(page => page.id)).toEqual(expect.arrayContaining(['cases', 'identities', 'data-requests', 'audit']))
  })
})

describe('Final plan 8: landing', () => {
  const page = read('src/components/HomepageSections.tsx')
  it('has six sport tiles with real counts and filter links', () => {
    expect(page).toContain('order.map(key =>')
    expect(page).toContain("const SPORT_ORDER = ['football', 'futsal', 'volleyball', 'handball', 'basketball', 'basketball_3x3']")
    expect(page).toContain('#tournaments?sport=')
  })
  it('has an organizer call-to-action that keeps the sign-in destination', () => {
    expect(read('src/components/LandingFeatures.tsx')).toContain('export function OrganizerBenefits({ onCreateTournament }')
    expect(read('src/App.tsx')).toContain("saveSignInIntent('organizer')")
  })
})
