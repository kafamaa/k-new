import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { EMPTY_MATCH_LIST_FILTERS, EMPTY_MATCH_LIST_LABELS, filterPublishedMatches, formatMatchDay, formatMatchSchedule, getPublishedMatch, getPublishedMatchLabels, getPublishedMatches, matchDayKey, matchDayOptions, matchPairTitle, matchSportOptions, matchStatusClass, matchStatusLabel, matchTeamOptions, matchTournamentOptions, PUBLIC_MATCH_FIELDS, type MatchListLabels } from './publicData'
import { parsePublicHash } from './publicRoutes'

type RecordedCall = { table?: string; filters: [string, unknown][]; ids: unknown[] | null; columns?: string; order?: [string, boolean] }
function createRecordingClient(result: { data: unknown; error: { message: string } | null }): { client: SupabaseClient; call: RecordedCall } {
  const call: RecordedCall = { filters: [], ids: null }
  const chain: Record<string, unknown> = {}
  chain.select = (columns: string) => { call.columns = columns; return chain }
  chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain }
  chain.in = (column: string, ids: unknown[]) => { call.ids = ids; call.filters.push([column, ids]); return chain }
  chain.order = (column: string, opts?: { ascending?: boolean }) => { call.order = [column, opts?.ascending ?? true]; return chain }
  chain.maybeSingle = () => chain
  chain.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(result).then(onFulfilled)
  const client = { from: (table: string) => { call.table = table; return chain } } as unknown as SupabaseClient
  return { client, call }
}

describe('public matches listing loader', () => {
  it('reads only confirmed matches with the approved public column boundary', async () => {
    const { client, call } = createRecordingClient({ data: [], error: null })
    await getPublishedMatches(client)
    expect(call.table).toBe('matches')
    expect(call.columns).toBe(PUBLIC_MATCH_FIELDS)
    expect(call.filters).toEqual([['status', 'confirmed']])
    expect(call.order).toEqual(['scheduled_at', false])
  })
  it('requests exactly the approved columns, never score, notes, documents, payments, or accounts', () => {
    // The exact string (an embed inside it must NOT be pre-split by commas).
    expect(PUBLIC_MATCH_FIELDS).toBe('id,tournament_id,stage_id,category_id,home_team_id,away_team_id,scheduled_at,venue,status,tournaments(id,name,slug)')
    expect(PUBLIC_MATCH_FIELDS).not.toMatch(/score|note|document|payment|created_by|email|phone/)
  })
  it('keeps the match detail loader on the same boundary and confirmed-only filter', async () => {
    const { client, call } = createRecordingClient({ data: null, error: null })
    await getPublishedMatch(client, 'match-1')
    expect(call.table).toBe('matches')
    expect(call.columns).toBe(PUBLIC_MATCH_FIELDS)
    expect(call.filters).toEqual([['id', 'match-1'], ['status', 'confirmed']])
  })
  it('routes #matches to the listing and #matches/:id to the detail', () => {
    expect(parsePublicHash('#matches')).toEqual({ kind: 'matches' })
    expect(parsePublicHash('#matches/123')).toEqual({ kind: 'match', slug: '123' })
  })
})

describe('matches label loader', () => {
  type LabelCall = { table: string; columns: string; filters: [string, unknown][]; ids: unknown[] | null }
  function createClient(tables: Record<string, unknown[]>, errors: Record<string, string> = {}): { client: SupabaseClient; calls: LabelCall[] } {
    const calls: LabelCall[] = []
    const client = {
      from: (table: string) => {
        const call: LabelCall = { table, columns: '', filters: [], ids: null }
        calls.push(call)
        const chain: Record<string, unknown> = {}
        chain.select = (columns: string) => { call.columns = columns; return chain }
        chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain }
        chain.in = (column: string, ids: unknown[]) => { call.ids = ids; return chain }
        chain.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(errors[table] ? { data: null, error: { message: errors[table] } } : { data: tables[table] ?? [], error: null }).then(onFulfilled)
        return chain
      },
    } as unknown as SupabaseClient
    return { client, calls }
  }
  const matches = [
    { home_team_id: 'team-1', away_team_id: 'team-2', tournament_id: 'tourn-1' },
    { home_team_id: 'team-2', away_team_id: 'team-3', tournament_id: 'tourn-2' },
  ]

  it('reads published teams and tournaments for the ids present, label columns only', async () => {
    const { client, calls } = createClient({
      teams: [{ id: 'team-1', name: 'Club A', slug: 'club-a' }, { id: 'team-2', name: 'Island B', slug: 'island-b' }, { id: 'team-3', name: 'National C', slug: 'national-c' }],
      tournaments: [{ id: 'tourn-1', name: 'Ramadan Cup', slug: 'ramadan-cup', sport: 'football' }, { id: 'tourn-2', name: 'Island League', slug: 'island-league', sport: 'futsal' }],
    })
    const result = await getPublishedMatchLabels(client, matches)
    const teams = calls.find(call => call.table === 'teams')
    const tournaments = calls.find(call => call.table === 'tournaments')
    expect(teams?.columns).toBe('id,name,slug,logo_url')
    expect(teams?.filters).toEqual([['is_published', true]])
    expect(teams?.ids).toEqual(['team-1', 'team-2', 'team-3'])
    expect(tournaments?.columns).toBe('id,name,slug,sport')
    expect(tournaments?.filters).toEqual([['is_published', true]])
    expect(tournaments?.ids).toEqual(['tourn-1', 'tourn-2'])
    expect(result.data?.teams['team-1']).toEqual({ name: 'Club A', slug: 'club-a', logo: null })
    expect(result.data?.tournaments['tourn-1']).toEqual({ name: 'Ramadan Cup', slug: 'ramadan-cup', sport: 'football' })
    for (const call of calls) expect(call.columns).not.toMatch(/created_by|organization_id|password|email|phone|payment|note/)
  })
  it('makes no request at all when no matches are loaded', async () => {
    const { client, calls } = createClient({})
    const result = await getPublishedMatchLabels(client, [])
    expect(calls.length).toBe(0)
    expect(result.data).toEqual(EMPTY_MATCH_LIST_LABELS)
    expect(result.error).toBeNull()
  })
  it('never stores a label without both a name and a slug', async () => {
    const { client } = createClient({
      teams: [{ id: 'team-1', name: 'Club A', slug: 'club-a' }, { id: 'team-2', name: '', slug: '' }],
      tournaments: [{ id: 'tourn-1', name: 'Ramadan Cup', slug: '' }],
    })
    const result = await getPublishedMatchLabels(client, matches)
    expect(Object.keys(result.data?.teams ?? {})).toEqual(['team-1'])
    expect(Object.keys(result.data?.tournaments ?? {})).toEqual([])
  })
  it('surfaces a lookup error so the page can warn instead of guessing', async () => {
    const { client } = createClient({ teams: [], tournaments: [] }, { tournaments: 'permission denied' })
    const result = await getPublishedMatchLabels(client, matches)
    expect(result.error).toBe('permission denied')
  })
})

describe('matches list filter options', () => {
  const labels: MatchListLabels = {
    teams: {
      'team-1': { name: 'Club A', slug: 'club-a', logo: null },
      'team-2': { name: 'Island B', slug: 'island-b', logo: null },
      'team-3': { name: 'National C', slug: 'national-c', logo: null },
    },
    tournaments: {
      'tourn-1': { name: 'Ramadan Cup', slug: 'ramadan-cup', sport: 'football' },
      'tourn-2': { name: 'Island League', slug: 'island-league', sport: 'futsal' },
    },
  }
  const matches = [
    { id: 'm1', tournament_id: 'tourn-1', home_team_id: 'team-1', away_team_id: 'team-2', scheduled_at: new Date(2026, 9, 1, 21, 0).toISOString(), venue: 'Kanditheemu Ground', status: 'confirmed' },
    { id: 'm2', tournament_id: 'tourn-2', home_team_id: 'team-3', away_team_id: 'team-1', scheduled_at: new Date(2026, 9, 2, 18, 0).toISOString(), venue: 'Maakurathu Hall', status: 'confirmed' },
    { id: 'm3', tournament_id: 'tourn-1', home_team_id: 'team-2', away_team_id: 'team-3', scheduled_at: null, venue: null, status: 'confirmed' },
    { id: 'm4', tournament_id: 'tourn-unknown', home_team_id: 'team-unknown', away_team_id: null, scheduled_at: 'not-a-date', venue: null, status: 'confirmed' },
  ]

  it('derives sport options from owning tournaments, skipping unresolvable rows', () => {
    expect(matchSportOptions(matches, labels)).toEqual(['football', 'futsal'])
  })
  it('derives labelled tournament options sorted by name without raw ids', () => {
    expect(matchTournamentOptions(matches, labels)).toEqual([
      { id: 'tourn-2', name: 'Island League' },
      { id: 'tourn-1', name: 'Ramadan Cup' },
    ])
  })
  it('derives labelled team options from both sides of every fixture', () => {
    expect(matchTeamOptions(matches, labels).map(option => option.name)).toEqual(['Club A', 'Island B', 'National C'])
  })
  it('derives distinct local days and skips missing or invalid timestamps', () => {
    expect(matchDayOptions(matches)).toEqual(['2026-10-01', '2026-10-02'])
  })
  it('keeps the day key in local time so a late-night match never shifts a day', () => {
    expect(matchDayKey(new Date(2026, 0, 15, 23, 30).toISOString())).toBe('2026-01-15')
    expect(matchDayKey(null)).toBe('')
    expect(matchDayKey('not-a-date')).toBe('')
  })
  it('formats day and schedule labels without leaking raw values', () => {
    expect(formatMatchDay('2026-10-01')).toContain('2026')
    expect(formatMatchDay('not-a-day')).toBe('not-a-day')
    expect(formatMatchSchedule(null)).toBe('Date not published')
    expect(formatMatchSchedule('not-a-date')).toBe('Date not published')
    expect(formatMatchSchedule(new Date(2026, 9, 1, 21, 0).toISOString())).toContain('2026')
  })

  it('filters by sport, tournament, team, and day', () => {
    expect(filterPublishedMatches(matches, labels, { ...EMPTY_MATCH_LIST_FILTERS, sport: 'futsal' }).map(row => row.id)).toEqual(['m2'])
    expect(filterPublishedMatches(matches, labels, { ...EMPTY_MATCH_LIST_FILTERS, tournamentId: 'tourn-1' }).map(row => row.id)).toEqual(['m1', 'm3'])
    expect(filterPublishedMatches(matches, labels, { ...EMPTY_MATCH_LIST_FILTERS, teamId: 'team-1' }).map(row => row.id)).toEqual(['m1', 'm2'])
    expect(filterPublishedMatches(matches, labels, { ...EMPTY_MATCH_LIST_FILTERS, day: '2026-10-02' }).map(row => row.id)).toEqual(['m2'])
  })
  it('searches across team names, tournament names, and venue only', () => {
    expect(filterPublishedMatches(matches, labels, { ...EMPTY_MATCH_LIST_FILTERS, search: 'island b' }).map(row => row.id)).toEqual(['m1', 'm3'])
    expect(filterPublishedMatches(matches, labels, { ...EMPTY_MATCH_LIST_FILTERS, search: 'ramadan' }).map(row => row.id)).toEqual(['m1', 'm3'])
    expect(filterPublishedMatches(matches, labels, { ...EMPTY_MATCH_LIST_FILTERS, search: 'maakurathu' }).map(row => row.id)).toEqual(['m2'])
    // An internal uuid is never searchable and never displayed.
    expect(filterPublishedMatches(matches, labels, { ...EMPTY_MATCH_LIST_FILTERS, search: 'tourn-1' })).toEqual([])
  })
  it('combines filters and returns an empty list when nothing matches', () => {
    expect(filterPublishedMatches(matches, labels, { search: 'club a', sport: 'football', tournamentId: 'tourn-1', teamId: 'team-1', day: '2026-10-01' }).map(row => row.id)).toEqual(['m1'])
    expect(filterPublishedMatches(matches, labels, { ...EMPTY_MATCH_LIST_FILTERS, search: 'zzz-no-such' })).toEqual([])
    expect(filterPublishedMatches([], labels, EMPTY_MATCH_LIST_FILTERS)).toEqual([])
  })
})

describe('match display helpers', () => {
  const labels: MatchListLabels = {
    teams: { 'team-1': { name: 'Club A', slug: 'club-a', logo: null }, 'team-2': { name: 'Island B', slug: 'island-b', logo: null } },
    tournaments: {},
  }

  it('titles a fixture with team names and falls back without exposing uuids', () => {
    expect(matchPairTitle({ home_team_id: 'team-1', away_team_id: 'team-2' }, labels)).toBe('Club A vs Island B')
    expect(matchPairTitle({ home_team_id: 'team-missing', away_team_id: null }, labels)).toBe('Published team vs Published team')
    expect(matchPairTitle({}, EMPTY_MATCH_LIST_LABELS)).toBe('Published team vs Published team')
  })
  it('labels every known status and never prints a raw status value', () => {
    expect(matchStatusLabel('confirmed')).toBe('Official')
    expect(matchStatusLabel('awaiting_confirmation')).toBe('Awaiting confirmation')
    expect(matchStatusLabel('cancelled')).toBe('Cancelled')
    expect(matchStatusLabel(undefined)).toBe('Status not published')
    expect(matchStatusLabel('some-internal-value')).toBe('Status not published')
  })
  it('tones the badge from the record status rather than assuming visibility', () => {
    expect(matchStatusClass('confirmed')).toBe('match-status confirmed')
    expect(matchStatusClass('live')).toBe('match-status live')
    expect(matchStatusClass('scheduled')).toBe('match-status')
    expect(matchStatusClass(undefined)).toBe('match-status')
  })
})

describe('matches listing page source', () => {
  const page = readFileSync(resolve(process.cwd(), 'src/components/PublicPage.tsx'), 'utf8')
  const matchList = page.slice(page.indexOf('function MatchList('), page.indexOf('function TournamentList('))

  it('routes the matches collection to the dedicated MatchList component', () => {
    // The Matches page is now MatchesDirectory (upcoming, live, results);
    // MatchList remains the confirmed-only view used before migration 032.
    expect(page).toContain("route.kind === 'matches') return <MatchesDirectory legacy={records => <MatchList records={records} />} />")
    expect(matchList.length).toBeGreaterThan(0)
  })
  it('keeps distinct empty and no-results states', () => {
    expect(matchList).toContain('No published matches are available yet.')
    expect(matchList).toContain('No matches match these filters.')
  })
  it('links each fixture to its detail and to related tournament and team pages by slug', () => {
    expect(matchList).toContain('href={`#matches/${encodeURIComponent(id)}`}')
    expect(matchList).toContain('href={`#tournament/${encodeURIComponent(tournament.slug)}`}')
    expect(matchList).toContain('href={`#team/${encodeURIComponent(')
  })
  it('labels status from the record and states the confirmed-score policy', () => {
    expect(matchList).toContain('matchStatusClass(record.status)')
    expect(matchList).toContain('Only confirmed matches are listed')
    expect(matchList).toContain('scores do not appear on this page')
  })
  it('is view-only for guests: no buttons, mutations, auth actions, or workspace controls', () => {
    expect(matchList).not.toContain('<button')
    expect(matchList).not.toMatch(/\.(insert|update|delete|upsert)\(/)
    expect(matchList).not.toMatch(/signOut|workspace|password|payment|document|email|phone|internal/i)
  })
  it('renders filter controls only after labels resolve and matches exist', () => {
    expect(matchList).toContain('!records.length ? <Empty')
    expect(matchList).toContain('!labelsReady ? <Loading')
    expect(matchList).toMatch(/sports\.length > 1/)
    expect(matchList).toMatch(/tournaments\.length > 1/)
    expect(matchList).toMatch(/teams\.length > 1/)
    expect(matchList).toMatch(/days\.length > 1/)
  })
})
