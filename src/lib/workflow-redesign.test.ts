import { describe, expect, it } from 'vitest'
import { translations } from './i18n'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { phaseFromCounts, pendingWork } from './simpleFlow'
import { rankBy, type TournamentPlayerStat } from './publicPages'
import { isOrganizerTab } from './organizer'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')
const counts = (extra: Partial<Parameters<typeof phaseFromCounts>[2]> = {}) => ({ approvedEntries: 0, applicationsPending: 0, rostersPending: 0, paymentsPending: 0, matchesTotal: 0, matchesUnresolved: 0, matchesAwaitingConfirmation: 0, ...extra })

// Owner's workflow redesign, 2026-11-02 (workflow benchmark; original Kulhivaru+ design).
describe('Stage 1: public shell and landing', () => {
  const app = read('src/App.tsx')
  const landing = read('src/components/HomepageSections.tsx')
  const features = read('src/components/LandingFeatures.tsx')
  // Owner mockup, 2026-11-04: Teams before Players, then More.
  it('has Home, Tournaments, Matches, Teams, Players, More, Sign In and Create Tournament in the header', () => {
    expect(app).toContain('<details className="ed-topnav-more">')
    const nav = app.slice(app.indexOf('const NAV_ITEMS = ['), app.indexOf('] as const', app.indexOf('const NAV_ITEMS = [')))
    expect([...nav.matchAll(/href: '#(\w+)'/g)].map(match => match[1])).toEqual(['home', 'tournaments', 'matches', 'teams', 'players'])
    expect(app).toContain("{t('common.signin')}</button>")
    expect(app).toContain(`<span className="ed-create-label">{t('nav.createTournament')}</span>`); expect(translations.en['nav.createTournament']).toBe('Create Tournament')
  })
  // Owner mockup, 2026-11-04: the hero shows a real match (never a sample), and a closing call to action.
  it('puts the landing in the agreed order with a real hero match and a final call to action', () => {
    const order = ['lp-hero-title', '<HeroMatch', '<BrowseBySport', '<SportsHub', '<TournamentShowcase', '<CommunitySpotlight', '<FinalCallToAction']
    const positions = order.map(marker => landing.indexOf(marker))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(landing).toContain('const heroMatch = firstLive ?? nextMatch')
    expect(read('src/components/HomeArt.tsx')).not.toMatch(/Lagoon FC|Island United|Sample match/)
  })
  it('never invents teams, players or scores in the explanatory sections', () => {
    expect(features).not.toMatch(/\b\d+\s*[-–]\s*\d+\b/)
    expect(features).toContain('placeholder')
    expect(features).not.toMatch(/Copa/i)
  })
})

describe('Stage 2: My Work', () => {
  it('names the five kinds of work and keeps Platform Administration last', () => {
    const chooser = read('src/components/WorkspaceChooser.tsx')
    expect(chooser).toContain("{ player: 'Player Career', team: 'Managed Teams', organization: 'Organizations', official: 'Official Assignments', platform_admin: 'Platform Administration' }")
    expect(chooser.indexOf('{DISPLAY_ORDER.map(kind => <KindPanel')).toBeLessThan(chooser.indexOf('<AdminCard workspace='))
    expect(read('src/lib/i18n.ts')).toContain("'workspace.choose': 'My Work'")
  })
})

describe('Stage 3: Organizer workspace', () => {
  const organizer = read('src/components/OrganizerWorkspace.tsx')
  it('uses four menu items and opens the create form only on request', () => {
    expect([...organizer.slice(organizer.indexOf('const ORG_GROUPS'), organizer.indexOf(']\n', organizer.indexOf('const ORG_GROUPS'))).matchAll(/label: '([^']+)'/g)].map(match => match[1])).toEqual(['Home', 'Tournaments', 'Players & Teams', 'More'])
    expect(organizer).toContain('{canManage && showCreate && <form')
  })
  it('shows phase, teams, matches and pending work on each tournament card', () => {
    expect(phaseFromCounts('draft', false, counts()).label).toBe('Teams')
    expect(phaseFromCounts('registration_closed', false, counts()).label).toBe('Schedule')
    expect(phaseFromCounts('in_progress', true, counts({ matchesTotal: 6, matchesUnresolved: 2 })).label).toBe('Play')
    expect(phaseFromCounts('in_progress', true, counts({ matchesTotal: 6 })).label).toBe('Finish')
    expect(phaseFromCounts('archived', true, counts()).label).toBe('Finished')
    expect(pendingWork(counts({ applicationsPending: 1, paymentsPending: 2, matchesAwaitingConfirmation: 1 }))).toBe(4)
    for (const text of ['<dt>Teams</dt>', '<dt>Matches</dt>', '<dt>Pending</dt>', 'Open Tournament']) expect(organizer).toContain(text)
  })
})

describe('Stage 4 and 5: separate tournament workspace', () => {
  const organizer = read('src/components/OrganizerWorkspace.tsx')
  const workspace = read('src/components/TournamentWorkspace.tsx')
  it('opens a tournament in its own shell, without the organization sidebar', () => {
    const shell = organizer.slice(organizer.indexOf('if (route.tournamentId) return'), organizer.indexOf('if (loading) return'))
    expect(shell).toContain('data-testid="tournament-shell"')
    expect(shell).toContain('Back to Organization')
    expect(shell).toContain('Switch Tournament')
    expect(shell).toContain('<SaveStatusBadge />')
    expect(shell).toContain('Switch workspace')
    expect(shell).not.toContain('organizer-nav')
  })
  it('groups the tournament pages as Home, Teams, Schedule, Matches and More, with a phone bar', () => {
    expect(workspace).toContain("{ label: 'Teams', tabs: ['teams', 'applications'] }")
    expect(workspace).toContain("{ label: 'Schedule', tabs: ['fixtures', 'draw', 'standings'] }")
    expect(workspace).toContain("{ label: 'More', tabs: ['settings', 'setup', 'staff', 'finance', 'media', 'reports', 'completion'] }")
    expect(workspace).toContain('className="ws-bottomnav flow-bottomnav"')
    expect(isOrganizerTab('reports')).toBe(true)
  })
  // Home is a short control centre since 2026-11-03: next matches, latest results,
  // attention and activity (registration and the public page live on Teams and the header).
  it('shows next matches, latest results, attention and activity on Home', () => {
    const flow = read('src/components/SimpleTournamentFlow.tsx')
    for (const heading of ['<h4>Next matches</h4>', '<h4>Latest results</h4>', "<h4>{tr('workspace.needsAttention', 'Needs attention')}</h4>", '<h4>Latest activity</h4>']) expect(flow).toContain(heading)
    expect(flow).toContain("'Score not recorded'")
    expect(flow).toContain('Statistics rebuilt from confirmed results')
  })
  it('offers reports and full audit history without private data', () => {
    const pages = read('src/components/TournamentPages.tsx')
    const reports = pages.slice(pages.indexOf('export function ReportsPage'))
    expect(reports).toContain('Private documents, ID numbers and payment proofs are never included.')
    expect(reports).toContain('<TournamentTimeline')
    expect(reports).toContain("'Not recorded'")
  })
})

describe('Stage 6: public tournament page', () => {
  const page = read('src/components/PublicPage.tsx')
  it('has the flat tab row and keeps old links working', () => {
    for (const label of ['Overview', 'Schedule', 'Results', 'Standings', 'Bracket', 'Teams', 'Players', 'Statistics', 'News & media', 'Rules', 'Sponsors', 'Awards']) expect(page).toContain(`label: '${label}'`)
    expect(page).toContain("more: 'rules', registration: 'rules'")
    expect(page).toContain('<StandingsDirectory tournamentId={tournamentId} embedded />')
    expect(page).toContain('<BracketDirectory tournamentId={tournamentId} embedded />')
  })
  it('ranks only players who recorded a statistic, never showing zero', () => {
    const row = (name: string, goals: number): TournamentPlayerStat => ({ slug: name, name, team: null, appearances: 1, goals, assists: 0, yellow: 0, red: 0 })
    expect(rankBy([row('A', 0), row('B', 3), row('C', 1)], 'goals').map(item => item.name)).toEqual(['B', 'C'])
    expect(rankBy([row('A', 0)], 'assists')).toEqual([])
  })
  it('draws shareable images only from confirmed results with public fields', () => {
    const image = read('src/lib/resultImage.ts')
    expect(image).toContain('Confirmed official result')
    expect(image).not.toMatch(/national|phone|email|id_document|passport/i)
    expect(read('src/components/TournamentPublicTabs.tsx')).toContain("statuses: ['confirmed']")
  })
  it('migration 043 returns only public fields for published players and tournaments', () => {
    const sql = read('supabase/migrations/202611010043_public_tournament_players.sql')
    expect(sql.match(/security definer set search_path = ''/g)).toHaveLength(2)
    expect(sql).toContain('revoke execute on function public.get_public_tournament_players(uuid) from public;')
    expect(sql).toContain('revoke execute on function public.get_public_tournament_player_statistics(uuid) from public;')
    expect(sql).toContain("tr.is_published and tr.status <> 'draft'")
    expect(sql).toContain('p.is_published')
    expect(sql).toContain("v.status = 'confirmed'")
    expect(sql).not.toMatch(/\b(drop|delete|truncate|insert|update)\b/i)
    expect(sql).not.toMatch(/returns table\([^)]*\b(id|account_id|user_id|player_id)\b uuid/)
  })
})
