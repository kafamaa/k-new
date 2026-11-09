import { describe, expect, it } from 'vitest'
import { translations } from './i18n'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { activeTeams, completedTournaments, loadChampions, officialScore, type FeedMatch } from './landing'
import { getPublishedTournaments, PUBLIC_PLAYER_FIELDS, PUBLIC_TEAM_FIELDS, PUBLIC_TOURNAMENT_FIELDS } from './publicData'
import { parsePublicHash } from './publicRoutes'
import { shouldOpenChooseWorkspace } from './workspace'
import { DEFAULT_LANDING } from './appConfig'

// Acceptance for Page 1 (landing) under the owner's simplified public layout:
// five main items, previews only on Home, at most five records per block.
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const page = read('src/components/HomepageSections.tsx')
const app = read('src/App.tsx')
const css = read('src/landing-island.css')
const directories = read('src/components/PublicDirectories.tsx')
const body = page.slice(page.indexOf('export function HomepageSections'))
const UUID = '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5'
const NOW = Date.parse('2026-11-02T12:00:00Z')
const team = (id: string, name: string | null) => ({ id, name, slug: name ? name.toLowerCase() : null, logo: null })
const match = (overrides: Partial<FeedMatch>): FeedMatch => ({ id: UUID, tournamentId: 't1', tournamentName: 'Malé Futsal Cup', tournamentSlug: 'male-futsal-cup', sport: 'futsal', stageId: 's1', stageName: 'Group A', stageFormat: 'group_stage', stageOrder: 1, groupName: null, leg: 1, scheduledAt: '2026-11-01T14:00:00Z', venue: 'Futsal Ground', status: 'confirmed', home: team('h', 'Eagles'), away: team('a', 'Sharks'), homeScore: 2, awayScore: 1, outcome: null, confirmedAt: '2026-11-01T16:00:00Z', corrected: false, ...overrides })

describe('Sections and navigation', () => {
  // Updated for the final plan (section 8): Browse by Sport after the hero, News before the
  // Organizer call-to-action, How It Works last. The component names are unchanged.
  // Owner's landing order (2026-11-02): hero, supported sports, automatic fixtures, live scores
  // and standings, player statistics, tournament pages, organizer and fan benefits, news/photos/
  // sponsors, final call to action. The component names of the real-data blocks are unchanged.
  // Owner mockup, 2026-11-04: hero with the live or next real match, Find your sport, Match Center,
  // Discover Tournaments, Players & Teams and the closing band. Standings, brackets, news and the
  // archive keep their own pages, reached from More.
  it('has the hero, sports, Match Center, tournaments, players and teams and the closing call to action, in order', () => {
    const markers = ['lp-hero-title', '<HeroMatch', '<BrowseBySport', '<SportsHub', '<TournamentShowcase', '<CommunitySpotlight', '<FinalCallToAction']
    const positions = markers.map(marker => body.indexOf(marker))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    for (const label of ["label: 'Live'", "label: 'Today'", "label: 'Upcoming'", "label: 'Results'"]) expect(page).toContain(label)
    for (const title of ['Match Center</h2>', 'Discover Tournaments</h2>', 'Players &amp; Teams</h2>', 'Find your sport</h2>']) expect(page).toContain(title)
    for (const card of ['title="Players"', 'title="Teams"']) expect(page).toContain(card)
    for (const action of ['View All Matches', 'View all<span className="sr-only"> tournaments</span>']) expect(page).toContain(action)
  })
  // Owner mockup, 2026-11-04: the mockup's hero copy, Explore and Organize actions.
  it('uses the owner\'s hero copy, two actions and at most three statistics', () => {
    expect([DEFAULT_LANDING.heroTitle, DEFAULT_LANDING.heroTitleAccent]).toEqual(['Island sport.', 'Lasting history.'])
    expect(DEFAULT_LANDING.heroLede).toBe('Follow competitions, discover players and celebrate every result.')
    expect(body).toContain('href="#tournaments"><Trophy size={18} aria-hidden="true" /> Explore Tournaments</a>')
    expect(body).toContain('onClick={onCreateTournament}><Users size={18} aria-hidden="true" /> Organize a Tournament</button>')
    expect(read('src/components/LandingFeatures.tsx')).toContain('Create a Tournament</button>')
    const stats = body.slice(body.indexOf('<dl className="lp-hero-stats"'), body.indexOf('</dl>'))
    expect(stats.match(/<dt>/g)).toHaveLength(3)
  })
  it('shows at most five records per block and three matches, tournaments, players and teams', () => {
    expect(page).toContain('const HOME_LIMIT = 5')
    expect(page).toContain('limit: HOME_LIMIT')
    expect(page).toContain('const HUB_LIMIT = 3')
    expect(page).toContain('const PEOPLE_LIMIT = 3')
    expect(page).toContain('}, [tournaments, promoted, spotlight]).slice(0, 3)')
  })
  // Updated for the final plan (6.1): Home, Tournaments, Matches, Teams, Players, then
  // Search, Language and Account. The rest stay under More; #live still opens Live first.
  // Owner (2026-11-02): Home, Tournaments, Matches, Players, Teams, then Sign In and Create
  // Tournament. Explore (organizations, standings, bracket, news, archive) is an icon link.
  it('has five main items, search, language, Sign In, Create Tournament, and Explore, Live and Search routes', () => {
    expect(app).toContain("{ id: 'home', key: 'nav.home'")
    expect(app).toContain("{ id: 'tournaments', key: 'nav.tournaments'")
    expect(app).toContain("{ id: 'live', key: 'nav.matches', href: '#matches'")
    expect(app).toContain("{ id: 'teams', key: 'nav.teams', href: '#teams'")
    expect(app).toContain("{ id: 'players', key: 'nav.players', href: '#players'")
    expect(app).toContain('className="ed-icon-btn ed-lang-btn"')
    expect(app).toContain('ed-signin-btn')
    expect(app).toContain(`<span className="ed-create-label">{t('nav.createTournament')}</span>`); expect(translations.en['nav.createTournament']).toBe('Create Tournament')
    expect(app).toContain('href="#explore" aria-label="Explore: organizations, standings, brackets, news and archive"')
    expect(app).toContain('aria-label="Account menu"')
    expect(app).toContain('<a className="ed-icon-btn" href="#search" aria-label="Search"><Search size={17} /></a>')
    expect(parsePublicHash('#explore')).toEqual({ kind: 'explore' })
    expect(parsePublicHash('#live')).toEqual({ kind: 'matches' })
    expect(directories).toContain("/^#\\/?live/.test(window.location.hash) ? 'live' : 'upcoming'")
    // Explore loads nothing itself: it only links to each directory.
    const explore = directories.slice(directories.indexOf('export function ExplorePage'))
    expect(explore).not.toMatch(/publicSupabase|useSection|\.from\(/)
  })
  // Updated for the final plan (6.1): the phone bar says Matches, like the header.
  // The phone bar mirrors the five main destinations (owner, 2026-11-02); search and account are in the top bar.
  it('has a five-item phone bar: Home, Tournaments, Matches, Players, Teams', () => {
    const bar = app.slice(app.indexOf('<nav className="ed-bottomnav"'), app.indexOf('</nav>}', app.indexOf('<nav className="ed-bottomnav"')))
    expect(bar.match(/<a /g)).toHaveLength(5)
    for (const href of ['href="#home"', 'href="#tournaments"', 'href="#matches"', 'href="#players"', 'href="#teams"']) expect(bar).toContain(href)
  })
  // A simpler footer: Explore, My Work (with help) and Legal, plus language and install.
  it('has a footer with explore, my work and help, legal, language and install', () => {
    for (const label of ['aria-label="Explore"', 'aria-label="My Work"', '#info/help', 'aria-label="Legal"', '#info/privacy', '#info/child-safety', 'LANGUAGE_LABELS[language]', "t('nav.install')"]) expect(app).toContain(label)
    expect(translations.en['nav.install']).toBe('Install app')
  })
})

describe('Data: published only, confirmed only, nothing private', () => {
  it('reads only published, non-draft tournaments', async () => {
    const calls: Array<[string, unknown]> = []
    const chain: Record<string, unknown> = {}
    for (const name of ['select', 'eq', 'neq', 'order']) chain[name] = (...args: unknown[]) => { calls.push([name, args]); return name === 'order' ? Promise.resolve({ data: [], error: null }) : chain }
    await getPublishedTournaments({ from: () => chain } as unknown as SupabaseClient)
    expect(calls).toContainEqual(['eq', ['is_published', true]])
    expect(calls).toContainEqual(['neq', ['status', 'draft']])
  })
  it('names a champion only when the team is published', async () => {
    const rows = [{ tournament_id: 't1', teams: { name: 'Eagles', slug: 'eagles', is_published: true } }, { tournament_id: 't2', teams: { name: 'Hidden FC', slug: 'hidden', is_published: false } }]
    const chain: Record<string, unknown> = { select: () => chain, eq: () => chain, in: () => Promise.resolve({ data: rows, error: null }) }
    const result = await loadChampions({ from: () => chain } as unknown as SupabaseClient, ['t1', 't2'])
    expect([...result.data.entries()]).toEqual([['t1', { name: 'Eagles', slug: 'eagles' }]])
  })
  it('never selects or renders private fields', () => {
    for (const fields of [PUBLIC_PLAYER_FIELDS, PUBLIC_TEAM_FIELDS, PUBLIC_TOURNAMENT_FIELDS]) expect(fields).not.toMatch(/email|phone|national|identity|account_id|document|payment|notes|date_of_birth/)
    expect(page).not.toMatch(/\.(email|phone|national_id|account_id|review_notes|internal_notes|date_of_birth)\b/)
  })
  it('shows a score only for an official result, and counts only confirmed matches', () => {
    expect(officialScore(match({}))).toBe('2–1')
    expect(officialScore(match({ status: 'live' }))).toBeNull()
    expect(officialScore(match({ status: 'awaiting_confirmation' }))).toBeNull()
    expect(page).toContain('<b className="lp-mcard-score">{score ?? \'v\'}</b>')
    expect(activeTeams([match({}), match({ id: 'x', status: 'awaiting_confirmation' })], NOW).map(entry => entry.matches)).toEqual([1, 1])
  })
  it('labels a tournament Registration open only when registration really is open', () => {
    expect(page).toContain("const status = registration.canRegister ? { kind: 'open'")
    expect(page).toContain('const registration = registrationInfo(record.status, capacity, detail?.closesAt)')
  })
  it('never shows raw ids or invented records', () => {
    expect(page).not.toMatch(/>\{(match|record|row|item)\.id\}</)
    expect(page).toContain("teamLabel(match.home)")
    expect(completedTournaments([{ id: 'a', status: 'in_progress' }, { id: 'b', status: 'archived' }]).map(row => row.id)).toEqual(['b'])
  })
})

describe('States: empty, error, Retry', () => {
  it('has a truthful empty state for every block', () => {
    for (const text of ['No matches are live right now.', 'No published matches are scheduled for today.', 'No upcoming published fixtures.', 'No official results have been published yet.', 'No published tournaments are available yet.', 'No published player profiles yet.', 'No published teams yet.']) expect(page, text).toContain(text)
  })
  it('shows an error with Retry instead of a fake zero', () => {
    expect(page).toContain("if (state.status === 'error' && !state.loadedAt) return <SectionError onRetry={state.retry} message={state.error} />")
    expect(page).toContain('<RefreshCw size={14} /> Retry</button>')
    expect(page).toContain('counts.data.teams !== null &&')
  })
})

describe('Guests, signed-in visitors and Create Tournament', () => {
  it('uses the session-less public client and no writes', () => {
    expect(page).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    expect(page).not.toMatch(/import \{[^}]*\bsupabase\b[^}]*\} from '\.\.\/lib\/supabase'/)
    expect(page).toContain("import { publicSupabase } from '../lib/supabase'")
  })
  it('keeps Home for signed-in people, with the account menu and a Workspace link', () => {
    expect(app).toContain('<main id="top" className="ed-main"><HomepageSections onCreateTournament={openTournamentCreator} /></main>')
    expect(shouldOpenChooseWorkspace('INITIAL_SESSION', false)).toBe(false)
    expect(app).toContain('href="#workspace"><LayoutDashboard size={15} /> {t(\'nav.workspace\')}</a>')
    expect(app).toContain("<a role=\"menuitem\" href=\"#workspace\" onClick={() => setAccountOpen(false)}>{t('workspace.choose')}</a>")
    expect(page).not.toMatch(/Switch workspace/i)
  })
  it('keeps the Create Tournament destination through sign-in', () => {
    expect(app).toContain("const openTournamentCreator = () => { saveSignInIntent('organizer'); if (currentUser) window.location.hash = '#workspace'; else { setAuthMode('signin'); setAuthOpen(true) } }")
    expect(read('src/components/WorkspacePanel.tsx')).toContain('const intent = takeSignInIntent()')
  })
})

describe('Phones, language and accessibility', () => {
  it('hides the full menu on small screens, keeps actions full width and leaves room for the bar', () => {
    expect(css).toMatch(/@media \(max-width: 900px\) \{\s*\.ed-topnav \{ display: none; \}/)
    expect(css).toContain('.is-home .lp-hero-actions { flex-direction: column; align-items: stretch; }')
    expect(css).toContain('padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px))')
  })
  it('follows the language direction and uses logical properties', () => {
    expect(app).toContain("document.documentElement.dir = isRtl(language) ? 'rtl' : 'ltr'")
    expect(css).not.toMatch(/padding-left:|margin-left:/)
  })
  it('uses real tabs, named regions and reduced motion', () => {
    expect(page.match(/<h1 /g)).toHaveLength(1)
    for (const id of ['hub']) { expect(page).toContain(`role="tablist"`); expect(page).toContain(`aria-controls="${id}-panel"`); expect(page).toContain(`id="${id}-panel" role="tabpanel"`) }
    expect(page).toContain('aria-labelledby={`people-${id}-title`}')
    expect(page).toContain('<span className="lp-hero-sea" aria-hidden="true" />')
    expect(read('src/components/GlobalSearch.tsx')).toContain('<label className="sr-only"')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
  it('keeps workspace and admin code out of the landing bundle', () => {
    for (const lazyChunk of ['const WorkspacePanel = lazy(', 'const PublicPage = lazy(', 'const AccountSettings = lazy(']) expect(app).toContain(lazyChunk)
    expect(app).not.toContain("from './lib/superAdmin'")
    expect(read('src/lib/workspace.ts')).not.toContain("from './superAdmin'")
    for (const name of ['function CommunitySpotlight(']) expect(page.slice(page.indexOf(name), page.indexOf(name) + 500)).toContain('useNearScreen')
  })
})

describe('Final specification additions', () => {
  it('shows Watch Live only when a published live match exists', () => {
    expect(page).toContain("const firstLive = live.status === 'ready' ? live.data.find(match => isLive(match.status)) : undefined")
    expect(page).toContain('{firstLive && <a className="ed-btn ed-btn-live ed-btn-lg" href={matchHref(firstLive.id)}>')
  })
})
