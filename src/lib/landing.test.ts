import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  activeTeams, bracketFromFeed, closestName, dismissalKey, latestStandings, maldivesDayKey, maldivesDayRange, matchStateLabel, officialScore, rankTopPlayers,
  registrationInfo, standingsColumns, timeAgo, toFeedMatch, tournamentStatus, upcomingByStart, viewedFromHash, type Capacity,
} from './landing'
import { parsePublicHash } from './publicRoutes'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const sql = read('supabase/migrations/202611010032_landing_page_complete.sql')
const page = read('src/components/HomepageSections.tsx')
const app = read('src/App.tsx')
const feed = (overrides: Record<string, unknown>) => toFeedMatch({ match_id: 'm', tournament_id: 't', tournament_name: 'Cup', stage_id: 's', stage_format: 'knockout', stage_order: 1, status: 'scheduled', home_team_id: 'a', home_name: 'Eagles', home_slug: 'eagles', away_team_id: 'b', away_name: 'Sharks', away_slug: 'sharks', ...overrides })
const capacity = (overrides: Partial<Capacity>): Capacity => ({ opensAt: null, closesAt: null, categoryCount: 1, teamLimit: null, approved: 0, ...overrides })

describe('Maldives time', () => {
  it('uses the Maldives calendar day, not the browser day', () => {
    expect(maldivesDayKey('2026-10-31T20:00:00Z')).toBe('2026-11-01')
    expect(maldivesDayRange(new Date('2026-10-31T20:00:00Z'))).toEqual({ from: '2026-10-31T19:00:00.000Z', to: '2026-11-01T19:00:00.000Z' })
    expect(timeAgo(Date.parse('2026-10-31T10:00:00Z') - 20_000, Date.parse('2026-10-31T10:00:00Z'))).toBe('20 seconds ago')
  })
})

describe('match states and scores', () => {
  it('never presents a finished, unconfirmed match as official', () => {
    expect(matchStateLabel({ status: 'awaiting_confirmation', outcome: null }).label).toBe('Finished — awaiting confirmation')
    expect(officialScore(feed({ status: 'awaiting_confirmation', home_score: 2, away_score: 1 }))).toBeNull()
    expect(officialScore(feed({ status: 'confirmed', home_score: 2, away_score: 1 }))).toBe('2–1')
    expect(matchStateLabel({ status: 'confirmed', outcome: 'walkover' }).label).toBe('Official · walkover')
  })
})

describe('tournament and registration status stay separate', () => {
  const now = Date.parse('2026-10-31T06:00:00Z')
  it('labels the tournament lifecycle on its own', () => {
    expect(tournamentStatus('in_progress')).toBe('active')
    expect(tournamentStatus('registration_open')).toBe('upcoming')
    expect(tournamentStatus('archived')).toBe('completed')
  })
  it('only claims urgency the data supports', () => {
    expect(registrationInfo('registration_open', capacity({ closesAt: '2026-10-31T18:00:00Z' }), null, now)).toMatchObject({ status: 'closing_soon', urgency: 'Registration closes today', canRegister: true })
    expect(registrationInfo('registration_open', capacity({ closesAt: '2026-11-02T18:00:00Z' }), null, now).urgency).toBe('2 days remaining')
    expect(registrationInfo('registration_open', capacity({ teamLimit: 8, approved: 6 }), null, now).urgency).toBe('2 team places remaining')
    expect(registrationInfo('registration_open', capacity({ teamLimit: 8, approved: 8 }), null, now)).toMatchObject({ status: 'full', canRegister: false })
    expect(registrationInfo('registration_open', capacity({ teamLimit: null, approved: 30 }), null, now).urgency).toBeNull()
    expect(registrationInfo('setup', capacity({ opensAt: '2026-11-03T04:00:00Z' }), null, now)).toMatchObject({ status: 'opens_soon', urgency: 'Registration opens in 3 days', canRegister: false })
    expect(registrationInfo('registration_open', capacity({ closesAt: '2026-10-30T00:00:00Z' }), null, now)).toMatchObject({ status: 'closed', canRegister: false })
    expect(registrationInfo('registration_open', capacity({ categoryCount: 0 }), null, now).canRegister).toBe(false)
  })
  it('sorts upcoming tournaments by nearest start and leaves out finished ones', () => {
    const rows = [{ id: 'late', status: 'setup' }, { id: 'soon', status: 'registration_open' }, { id: 'done', status: 'completed' }, { id: 'undated', status: 'postponed' }]
    const starts: Record<string, string> = { late: '2026-12-20', soon: '2026-11-05', done: '2026-11-01' }
    expect(upcomingByStart(rows, id => starts[id] ?? null, now).map(row => row.id)).toEqual(['soon', 'late', 'undated'])
  })
})

describe('competition data', () => {
  it('keeps only the newest standings calculation per stage', () => {
    const rows = [{ stage_id: 's', team_id: 'a', calculated_from_version: 1 }, { stage_id: 's', team_id: 'a', calculated_from_version: 2 }, { stage_id: 'x', team_id: 'b', calculated_from_version: 1 }]
    expect(latestStandings(rows).map(row => `${row.stage_id}${row.calculated_from_version}`)).toEqual(['s2', 'x1'])
    expect(standingsColumns('football').map(column => column.label)).toEqual(['P', 'W', 'D', 'L', 'GD', 'Pts'])
    expect(standingsColumns('volleyball').map(column => column.label)).not.toContain('D')
  })
  it('joins two-leg ties and advances only on official scores', () => {
    const rounds = bracketFromFeed([
      feed({ match_id: 'l1', stage_format: 'two_leg', status: 'confirmed', home_score: 1, away_score: 0, leg: 1 }),
      feed({ match_id: 'l2', stage_format: 'two_leg', status: 'confirmed', home_team_id: 'b', home_name: 'Sharks', away_team_id: 'a', away_name: 'Eagles', home_score: 3, away_score: 1, leg: 2 }),
      feed({ match_id: 'f', stage_id: 'final', stage_order: 2, status: 'awaiting_confirmation', home_score: 4, away_score: 0 }),
    ], 't')
    expect(rounds[0].ties[0]).toMatchObject({ score: '2–3', winner: 'away', label: 'Aggregate' })
    expect(rounds[1].ties[0]).toMatchObject({ score: null, winner: null })
  })
  it('ranks players only with enough confirmed appearances', () => {
    const ranked = rankTopPlayers([
      { player_id: 'few', display_name: 'Few', appearances: 2, goals: 9 },
      { player_id: 'a', display_name: 'A', appearances: 5, goals: 5 },
      { player_id: 'b', display_name: 'B', appearances: 5, goals: 1 },
    ])
    expect(ranked.map(player => player.id)).toEqual(['a', 'b'])
  })
  it('counts active teams from official matches only', () => {
    const now = Date.parse('2026-10-31T00:00:00Z')
    const teams = activeTeams([feed({ status: 'confirmed', scheduled_at: '2026-10-20T00:00:00Z' }), feed({ match_id: 'x', status: 'scheduled', scheduled_at: '2026-10-25T00:00:00Z' })], now)
    expect(teams.map(team => [team.name, team.matches])).toEqual([['Eagles', 1], ['Sharks', 1]])
  })
})

describe('search, history and announcements', () => {
  it('suggests a close published name for a typo', () => {
    expect(closestName('Kanditemu', ['Kanditheemu Futsal Cup', 'Wigani Sports Club'])).toBe('Kanditheemu Futsal Cup')
    expect(closestName('zz', ['Anything'])).toBeNull()
  })
  it('records only public record routes', () => {
    expect(viewedFromHash('#tournament/kanditheemu-cup')).toEqual({ kind: 'tournament', ref: 'kanditheemu-cup' })
    expect(viewedFromHash('#workspace/player/abc')).toBeNull()
    expect(viewedFromHash('#tournament/cup/register')).toBeNull()
    expect(viewedFromHash('#search?q=secret')).toBeNull()
  })
  it('brings an urgent announcement back after a material update', () => {
    expect(dismissalKey({ id: 'a', updatedAt: '2026-10-31T01:00:00Z', severity: 'critical' })).not.toBe(dismissalKey({ id: 'a', updatedAt: '2026-10-31T02:00:00Z', severity: 'critical' }))
    expect(dismissalKey({ id: 'a', updatedAt: 'x', severity: 'info' })).toBe('a')
  })
  it('routes footer help and legal pages', () => {
    expect(parsePublicHash('#info/privacy')).toEqual({ kind: 'info', slug: 'privacy' })
  })
})

describe('landing page layout', () => {
  // Updated for the owner's simplified public layout: Home holds previews only.
  // Updated for the final plan (section 8).
  it('keeps the specified section order', () => {
    // Owner mockup, 2026-11-04.
    const order = ['lp-hero-title', '<HeroMatch', '<BrowseBySport', '<SportsHub', '<TournamentShowcase', '<CommunitySpotlight', '<FinalCallToAction']
    const body = page.slice(page.indexOf('export function HomepageSections'))
    const positions = order.map(marker => body.indexOf(marker))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })
  // Rankings name their measure (players by the published rating method).
  it('names rankings only with a stated measure', () => {
    expect(page).toContain('{RATING_METHOD_SUMMARY}')
    expect(page).not.toMatch(/title="Trending|Popular Teams/)
  })
  it('hides summary chips whose query failed instead of showing zero', () => {
    expect(page).toContain('counts.data.teams !== null &&')
    expect(page).not.toContain('data.players.length}')
  })
  // Updated: the More menu became Explore (five main items: Home, Tournaments, Live, Explore, Account).
  it('offers every required footer link and the Explore menu', () => {
    for (const href of ['#info/help', '#info/contact', '#info/report', '#info/claim-profile', '#info/account-support', '#info/privacy', '#info/terms', '#info/community-guidelines', '#info/child-safety', '#info/data-correction', '#info/account-deletion', '#info/image-consent', '#organizations', '#news', '#explore', '#live', '#workspace', '#archive']) expect(app).toContain(`href="${href}"`)
    // Updated for the final plan (6.1): Teams and Players moved to the main bar; Archive joined More.
    for (const label of ['Organizations', 'Standings', 'Bracket', 'News', 'Archive']) expect(app).toContain(`label: '${label}'`)
    for (const key of ['nav.matches', 'nav.teams', 'nav.players']) expect(app).toContain(`key: '${key}'`)
  })
})

describe('migration 033 organization publishing', () => {
  const publishing = read('supabase/migrations/202611010033_organization_publishing.sql')
  it('lets only an organization owner publish it, and never guests', () => {
    expect(publishing).toContain("m.user_id = auth.uid() and m.role = 'owner'")
    expect(publishing).toContain('revoke execute on function public.set_organization_published(uuid, boolean) from public, anon')
    expect(publishing).not.toMatch(/create policy/)
    expect(read('src/components/OrganizerWorkspace.tsx')).toContain("client.rpc('set_organization_published'")
  })
})

describe('migration 032 contracts', () => {
  it('feeds only published tournaments and published draws, with the newest confirmed score', () => {
    expect(sql).toContain("tr.is_published and tr.status <> 'draft'")
    expect(sql).toContain('st.published_at is not null')
    expect(sql).toContain("where v.status = 'confirmed'\n    order by v.match_id, v.version desc")
    expect(sql).toContain("case when m.status = 'confirmed' and jsonb_typeof(l.score->'home') = 'number'")
  })
  it('keeps reports private, signed-in and rate limited', () => {
    expect(sql).toContain("raise exception 'report_limit_reached'")
    expect(sql).toContain('revoke execute on function public.submit_content_report(text, text, text, text, text) from public, anon')
    expect(sql).not.toMatch(/on public\.content_reports for select to anon/)
  })
  it('exposes registration places only as counts', () => {
    expect(sql).toContain("e.application_status = 'approved')")
    expect(sql).not.toMatch(/get_public_registration_capacity[\s\S]*review_notes/)
  })
})
