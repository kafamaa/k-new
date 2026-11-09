import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { authModeFromHash } from './authFlow'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const app = read('src/App.tsx')
const page = read('src/components/PublicPage.tsx')

describe('Pages 16-18: account links', () => {
  it('opens the right account form from #signin, #signup and #forgot-password', () => {
    expect(authModeFromHash('#signin')).toBe('signin')
    expect(authModeFromHash('#/signup')).toBe('signup')
    expect(authModeFromHash('#forgot-password')).toBe('recover')
    expect(authModeFromHash('#home')).toBeNull()
    expect(authModeFromHash('#signin/extra')).toBeNull()
    // The link is replaced with #home, so closing the form leaves the visitor on Home.
    expect(app).toContain("window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#home`)")
  })
  it('asks for a matching confirmation and the legal agreement before creating an account', () => {
    expect(app).toContain("form.confirm !== form.password ? 'The two passwords do not match.' : null")
    expect(app).toContain("form.agreed ? null : 'Please agree to the Terms and Privacy Policy to create your account.'")
    expect(app).toContain('href="#info/terms"')
    expect(app).toContain('href="#info/privacy"')
    // No identity, player, team or organization fields at sign-up.
    const signup = app.slice(app.indexOf('function AuthDialog'))
    expect(signup).not.toMatch(/national|identity|createTeam|createOrganization|player_profiles/i)
  })
})

describe('Page 4: tournament detail', () => {
  // The owner replaced the five tabs with one flat row of twelve on 2026-11-02
  // (see workflow-redesign.test.ts). Old five-tab links must still open the right tab.
  it('keeps the old five-tab links working', () => {
    for (const old of ["results: 'results'", "standings: 'standings'", "bracket: 'bracket'", "registration: 'rules'", "draw: 'standings'", "matches: 'schedule'", "competition: 'standings'", "more: 'rules'"]) expect(page).toContain(old)
  })
  it('shows one main action by state: Register Team, Watch Live, View Results or Registration Closed', () => {
    expect(page).toContain("void loadMatchFeed(client, { tournamentId, statuses: ['live'], limit: 1 })")
    expect(page).toContain(': liveMatchId ? <a className="ed-btn ed-btn-live ed-btn-lg"')
    expect(page).toContain('>View Results</button>')
    expect(page).toContain('disabled>Registration Closed</button>')
  })
  // Registration and rules now share the Rules tab; sponsors and news have their own tabs (2026-11-02).
  it('still shows registration, rules, sponsors and news', () => {
    expect(page).toContain("{tab === 'rules' && <section className=\"ed-panel public-registration\"")
    expect(page).toContain("{tab === 'rules' && hasRules && <section")
    expect(page).toContain("{tab === 'sponsors' && sponsors.length > 0 && <div className=\"ed-sponsor-grid\">")
    expect(page).toContain("{tab === 'news' && news.length > 0 && <div className=\"ed-news\">")
  })
})

describe('Pages 6, 9, 11, 12: tabs, with nothing removed', () => {
  const dirs = read('src/components/PublicDirectories.tsx')
  const parts = read('src/components/PublicPageParts.tsx')
  it('gives team, player and organization pages their tabs', () => {
    expect(page).toContain("const TEAM_TABS = [{ id: 'overview', label: 'Overview' }, { id: 'players', label: 'Players' }, { id: 'matches', label: 'Matches' }, { id: 'history', label: 'History' }] as const")
    expect(page).toContain("const PLAYER_TABS = [{ id: 'overview', label: 'Overview' }, { id: 'card', label: 'Digital Card' }, { id: 'career', label: 'Career' }, { id: 'history', label: 'History' }] as const")
    expect(page).toContain("const ORGANIZATION_TABS = [{ id: 'overview', label: 'Overview' }, { id: 'tournaments', label: 'Tournaments' }, { id: 'teams', label: 'Teams' }, { id: 'news', label: 'News' }] as const")
  })
  it('keeps every earlier section, now inside a tab', () => {
    for (const heading of ['Squad', 'Results', 'History', 'Trophies and milestones', 'Statistics by team and sport', 'Team history', 'Achievements and trophies']) expect(page, heading).toContain(`<h2 className="ed-subhead">${heading}</h2>`)
    expect(page).toContain('<FixturesCalendar name={name} teamId={String(team.id)} />')
    expect(page).toContain('<PlayerCard profile={record} teamName={teamName} totals={totals} rating={rating} isPublished={isPublished} />')
    for (const part of ['part="sponsors"', 'part="teams"', 'part="news"']) expect(page).toContain(part)
    for (const heading of ['Teams', 'News', 'Sponsors']) expect(parts).toContain(`<h2 className="ed-subhead">${heading}</h2>`)
  })
  it('orders the matches page Live, Today, Upcoming, Results', () => {
    expect(dirs).toContain("items={[{ id: 'live', label: 'Live' }, { id: 'today', label: 'Today' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'results', label: 'Results' }]}")
    expect(dirs).toContain("tab === 'today' ? { ...maldivesDayRange(), limit: 120 }")
  })
})

describe('Page 42 and public gaps (pages 3, 6, 10, 11, 14)', () => {
  const fnSource = read('supabase/functions/register-identity/index.ts')
  const identity = read('src/lib/identity.ts')
  const hub = read('src/lib/teamHub.ts')
  const dirs = read('src/components/PublicDirectories.tsx')
  it('reuses an existing player on an exact ID match, for authorized callers only', () => {
    expect(fnSource).toContain("const lookup = body.action === 'lookup'")
    // Authorization comes from the caller's own row-level access to the entry.
    expect(fnSource).toContain("await publicClient.from('tournament_entries').select('id').eq('id', body.entryId!).maybeSingle()")
    expect(fnSource).toContain("return json({ status: 'match', playerId: canonical.id, displayName: canonical.display_name }, 200)")
    expect(fnSource).toContain('found?.merged_into')
    expect(fnSource).not.toMatch(/console\.log/)
    expect(identity).toContain("{ body: { action: 'lookup', entryId, ...input } }")
    expect(hub).toContain("if (found.status === 'match') { playerId = found.playerId; matched = found.displayName }")
  })
  it('adds status chips and team counts, sport and island filters, a phone bracket pager and a card verification link', () => {
    expect(page).toContain('aria-label="Quick status"')
    expect(read('src/components/HomepageSections.tsx')).toContain("capacity && capacity.approved > 0 ?")
    expect(page).toContain('aria-label="Filter players by sport"')
    expect(dirs).toContain("&& (!params.island || islands.get(match.tournamentId) === params.island)")
    expect(dirs).toContain('Previous round</button>')
    expect(read('src/landing-island.css')).toContain('.pd-bracket .lp-round:not(.is-current) { display: none; }')
    expect(page).toContain('Verify this card: its official page is')
  })
})

describe('Workspace island style and page structure', () => {
  const css = read('src/workspace-island.css')
  const main = read('src/main.tsx')
  it('loads the workspace theme last and only for signed-in workspace pages', () => {
    const imports = [...main.matchAll(/^import '\.\/([a-z-]+)\.css'/gm)].map(match => match[1])
    expect(imports[imports.length - 1]).toBe('workspace-island')
    expect(css).toContain('.app-shell.in-workspace {')
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/(^|\n)\s*(body|html|:root)\s*\{/)
  })
  it('keeps text on the dark frame light', () => {
    expect(css).toContain('.in-workspace :is(.ws-appbar, .ws-topbar, .ws-next, .ws-choice-platform_admin) :is(.ed-btn-ghost, .outline-button, .ghost-button, .quiet-button) { color: #fff;')
    expect(css).toContain('.in-workspace .organizer-header :is(input, select) { background: rgba(255, 255, 255, .1); color: #fff;')
  })
  it('shows at most four summary cards, with the other counts kept one tap away', () => {
    const organizer = read('src/components/OrganizerWorkspace.tsx')
    // Organization Home redesign (2026-11-03): four "At a glance" counts; unread notifications sit by Recent activity.
    const glance = organizer.slice(organizer.indexOf('<section className="org-glance"'), organizer.indexOf('</section>', organizer.indexOf('<section className="org-glance"')))
    expect(glance.match(/{ label: '/g)).toHaveLength(4)
    expect(glance).toContain('Payments to check')
    expect(organizer).toContain('{unread} unread')
    const team = read('src/components/TeamHubTabs.tsx')
    expect(team).toContain("const TOP_CARDS = ['Active players', 'Active entries', 'Upcoming matches', 'Rosters needing action']")
    expect(team.indexOf('pw-next tw-next')).toBeLessThan(team.indexOf('pw-rail tw-rail'))
    const tournament = read('src/components/TournamentWorkspace.tsx')
    expect(tournament).toContain('<details className="ov-more-counts">')
    for (const title of ['Applications', 'Teams', 'Rosters', 'Payments', 'Fixtures', 'Matches']) expect(tournament).toContain(`<OverviewCard title="${title}"`)
  })
})
