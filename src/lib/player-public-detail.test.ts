import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currentPublicTeam, EMPTY_PLAYER_HISTORY_FILTERS, filterPlayerHistoryByTeamLevel, filterPlayerHistoryStatistics, filterPlayerPublicHistory, filterPlayerPublicStatistics, getPlayerAchievements, getPlayerHistory, getPlayerHistoryFilterLabels, labelledFilterOptions, playerPublicSeasonIdOptions, playerPublicTeamLevelOptions, playerPublicSportOptions, playerPublicTeamOptions, playerPublicTournamentIdOptions, PUBLIC_PLAYER_FIELDS } from './publicData'

type RecordedCall = { table?: string; filters: [string, unknown][]; columns?: string; order?: [string, boolean] }
function createRecordingClient(result: { data: unknown; error: { message: string } | null }): { client: SupabaseClient; call: RecordedCall } {
  const call: RecordedCall = { filters: [] }
  const chain: Record<string, unknown> = {}
  chain.select = (columns: string) => { call.columns = columns; return chain }
  chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain }
  chain.order = (column: string, opts?: { ascending?: boolean }) => { call.order = [column, opts?.ascending ?? true]; return chain }
  chain.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(result).then(onFulfilled)
  const client = { from: (table: string) => { call.table = table; return chain } } as unknown as SupabaseClient
  return { client, call }
}

describe('public player achievements loader', () => {
  it('reads only the given player’s milestones with approved public fields', async () => {
    const { client, call } = createRecordingClient({ data: [], error: null })
    await getPlayerAchievements(client, 'player-1')
    expect(call.table).toBe('sport_milestones')
    expect(call.columns).toBe('id,label,milestone_type,state,reached_at,is_manual')
    expect(call.filters).toEqual([['player_id', 'player-1']])
    expect(call.order).toEqual(['reached_at', false])
  })
  it('does not select private milestone columns', async () => {
    const { client, call } = createRecordingClient({ data: [], error: null })
    await getPlayerAchievements(client, 'player-1')
    expect(call.columns).not.toMatch(/created_by|source_result_version/)
  })
})

describe('public player team history loader', () => {
  it('reads only the given player’s published team memberships', async () => {
    const { client, call } = createRecordingClient({ data: [], error: null })
    await getPlayerHistory(client, 'player-1')
    expect(call.table).toBe('player_team_memberships')
    expect(call.filters).toEqual([['player_id', 'player-1']])
    expect(call.columns).toBe('team_id,status,effective_from,effective_to,teams(name,slug,team_type,is_published)')
  })
})

describe('player public filter helpers', () => {
  const history = [
    { team_id: 't1', status: 'active', effective_from: '2024-01-01', teams: { name: 'Alpha', slug: 'alpha' } },
    { team_id: 't2', status: 'ended', effective_from: '2023-01-01', teams: { name: 'Beta', slug: 'beta' } },
    { team_id: 't1', status: 'active', effective_from: '2025-01-01', teams: { name: 'Alpha', slug: 'alpha' } },
  ]
  const statistics = [
    { team_id: 't1', sport: 'Football', appearances: 5, goals: 2 },
    { team_id: 't2', sport: 'Futsal', appearances: 3, goals: 1 },
    { team_id: 't1', sport: 'Football', appearances: 2, goals: 0 },
  ]

  it('picks the most recent active membership for the card team label', () => {
    expect(String(currentPublicTeam(history)?.team_id)).toBe('t1')
    expect(String(currentPublicTeam(history)?.effective_from)).toBe('2025-01-01')
  })
  it('returns null when there is no active membership', () => {
    expect(currentPublicTeam([{ team_id: 'x', status: 'ended' }])).toBeNull()
  })
  it('extracts distinct sport options', () => {
    expect(playerPublicSportOptions(statistics)).toEqual(['Football', 'Futsal'])
  })
  it('extracts distinct team options with names', () => {
    expect(playerPublicTeamOptions(history)).toEqual([{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta' }])
  })
  it('filters statistics by sport and team', () => {
    expect(filterPlayerPublicStatistics(statistics, 'Football', '').length).toBe(2)
    expect(filterPlayerPublicStatistics(statistics, '', 't2').length).toBe(1)
    expect(filterPlayerPublicStatistics(statistics, 'Football', 't1').length).toBe(2)
    expect(filterPlayerPublicStatistics(statistics, 'Handball', '').length).toBe(0)
  })
  it('filters history by team', () => {
    expect(filterPlayerPublicHistory(history, 't1').length).toBe(2)
    expect(filterPlayerPublicHistory(history, '').length).toBe(3)
  })
})

describe('public player field boundary', () => {
  const foundation = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210001_foundation.sql'), 'utf8')
  const fixes = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610220014_public_player_statistics_fixes.sql'), 'utf8')

  it('requests only approved public player fields', () => {
    // Updated: public code and position added for the Players directory filters.
    expect(PUBLIC_PLAYER_FIELDS).toBe('id,display_name,slug,island,photo_url,is_claimed,public_code,position')
  })
  it('guests read only published player profiles', () => {
    expect(foundation).toContain('"published players are public" on public.player_profiles for select using (is_published or account_id = auth.uid())')
  })
  it('statistics RPC keeps the original 0008 return shape and casts only the mismatching columns', () => {
    const original = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210008_histories_statistics.sql'), 'utf8')
    const retOf = (sql: string): string | null => sql.match(/get_player_official_statistics\(p_player_id[\s\S]*?(returns table\([^)]*\))/i)?.[1] ?? null
    const shape0008 = retOf(original)
    const shape014 = retOf(fixes)
    // the declared return shape must be byte-identical to the live function
    expect(shape0008).toBeTruthy()
    expect(shape014).toBe(shape0008)
    expect(shape014).toContain('minutes bigint')
    expect(shape014).not.toContain('minutes integer')
    // the four sums(bigint) -> numeric columns are the ones that mismatched
    expect(fixes).toContain('coalesce(sum(et.goals), 0)::bigint')
    expect(fixes).toContain('coalesce(sum(et.assists), 0)::bigint')
    expect(fixes).toContain('coalesce(sum(et.yellow_cards), 0)::bigint')
    expect(fixes).toContain('coalesce(sum(et.red_cards), 0)::bigint')
    // columns that already resolved correctly are left untouched (incl. NULL semantics)
    expect(fixes).not.toContain('coalesce(sum(mp.minutes)')
    // guard, security definer, volatility, search_path and grants are preserved
    expect(fixes).toContain("raise exception 'player_not_public'")
    expect(fixes).toContain('language plpgsql stable security definer set search_path = public')
    expect(fixes).toContain('grant execute on function public.get_player_official_statistics(uuid, text, uuid, uuid, text) to anon, authenticated, service_role;')
  })
  it('scopes the milestones operator policy to authenticated so guests can read published milestones', () => {
    expect(fixes).toMatch(/"operators manage milestones" on public\.sport_milestones for all to authenticated/)
  })
})

describe('player history page filter helpers', () => {
  // Rows shaped like get_player_official_statistics output.
  const statistics = [
    { team_id: 't1', team_type: 'club', tournament_id: 'tourn-1', season_id: 'season-1', sport: 'football', appearances: 5, goals: 2 },
    { team_id: 't2', team_type: 'island', tournament_id: 'tourn-2', season_id: 'season-1', sport: 'futsal', appearances: 3, goals: 1 },
    { team_id: 't3', team_type: 'club', tournament_id: 'tourn-1', season_id: 'season-2', sport: 'football', appearances: 2, goals: 0 },
  ]
  const history = [
    { team_id: 't1', status: 'active', teams: { name: 'Alpha', slug: 'alpha', team_type: 'club' } },
    { team_id: 't2', status: 'active', teams: { name: 'Beta', slug: 'beta', team_type: 'island' } },
    { team_id: 't3', status: 'ended', teams: { name: 'Gamma', slug: 'gamma', team_type: 'club' } },
  ]

  it('starts from an empty filter set', () => {
    expect(EMPTY_PLAYER_HISTORY_FILTERS).toEqual({ teamLevel: '', sport: '', tournamentId: '', seasonId: '' })
  })
  it('derives distinct team levels from statistics rows', () => {
    expect(playerPublicTeamLevelOptions(statistics)).toEqual(['club', 'island'])
  })
  it('derives distinct tournament and season ids', () => {
    expect(playerPublicTournamentIdOptions(statistics)).toEqual(['tourn-1', 'tourn-2'])
    expect(playerPublicSeasonIdOptions(statistics)).toEqual(['season-1', 'season-2'])
  })
  it('filters statistics by team level, sport, tournament and season together', () => {
    expect(filterPlayerHistoryStatistics(statistics, { ...EMPTY_PLAYER_HISTORY_FILTERS, teamLevel: 'club' }).length).toBe(2)
    expect(filterPlayerHistoryStatistics(statistics, { ...EMPTY_PLAYER_HISTORY_FILTERS, sport: 'futsal' }).length).toBe(1)
    expect(filterPlayerHistoryStatistics(statistics, { ...EMPTY_PLAYER_HISTORY_FILTERS, tournamentId: 'tourn-1' }).length).toBe(2)
    expect(filterPlayerHistoryStatistics(statistics, { ...EMPTY_PLAYER_HISTORY_FILTERS, seasonId: 'season-2' }).length).toBe(1)
    expect(filterPlayerHistoryStatistics(statistics, { teamLevel: 'club', sport: 'football', tournamentId: 'tourn-1', seasonId: 'season-2' }).length).toBe(1)
    expect(filterPlayerHistoryStatistics(statistics, { ...EMPTY_PLAYER_HISTORY_FILTERS, teamLevel: 'national' }).length).toBe(0)
  })
  it('filters team history by the joined team level', () => {
    expect(filterPlayerHistoryByTeamLevel(history, '').length).toBe(3)
    expect(filterPlayerHistoryByTeamLevel(history, 'club').length).toBe(2)
    expect(filterPlayerHistoryByTeamLevel(history, 'island').length).toBe(1)
    expect(filterPlayerHistoryByTeamLevel(history, 'national').length).toBe(0)
  })
  it('never labels an id that has no resolved name', () => {
    // An unlabelled id must not surface as a raw internal identifier.
    expect(labelledFilterOptions(['tourn-1', 'tourn-2'], { 'tourn-1': 'Ramadan Cup' })).toEqual([{ id: 'tourn-1', name: 'Ramadan Cup' }])
    expect(labelledFilterOptions(['a', 'b'], {})).toEqual([])
  })
})

describe('player history filter label loader', () => {
  type LabelCall = { table: string; columns: string; filters: [string, unknown][]; ids: unknown[] | null }
  function createChain(call: LabelCall, data: unknown[]) {
    const chain: Record<string, unknown> = {}
    chain.select = (columns: string) => { call.columns = columns; return chain }
    chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain }
    chain.in = (column: string, ids: unknown[]) => { call.ids = ids; return chain }
    chain.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(onFulfilled)
    return chain
  }
  function createClient(tables: Record<string, unknown[]>): { client: SupabaseClient; calls: LabelCall[] } {
    const calls: LabelCall[] = []
    const client = { from: (table: string) => { const call: LabelCall = { table, columns: '', filters: [], ids: null }; calls.push(call); return createChain(call, tables[table] ?? []) } } as unknown as SupabaseClient
    return { client, calls }
  }
  const statistics = [
    { tournament_id: 'tourn-1', season_id: 'season-1' },
    { tournament_id: 'tourn-1', season_id: 'season-2' },
  ]

  it('reads published tournaments and seasons for the ids present', async () => {
    const { client, calls } = createClient({ tournaments: [{ id: 'tourn-1', name: 'Ramadan Cup', slug: 'ramadan-cup-2026' }], seasons: [{ id: 'season-1', name: '2025' }, { id: 'season-2', name: '2026' }] })
    const result = await getPlayerHistoryFilterLabels(client, statistics)
    const tournaments = calls.find(call => call.table === 'tournaments')
    const seasons = calls.find(call => call.table === 'seasons')
    expect(tournaments?.columns).toBe('id,name,slug')
    expect(tournaments?.filters).toEqual([['is_published', true]])
    expect(tournaments?.ids).toEqual(['tourn-1'])
    expect(seasons?.columns).toBe('id,name')
    expect(seasons?.ids).toEqual(['season-1', 'season-2'])
    expect(result.data?.tournaments).toEqual({ 'tourn-1': 'Ramadan Cup' })
    // Public detail routes resolve by slug, so a statistics row must link by
    // slug — a raw uuid link would land on the not-found state.
    expect(result.data?.tournamentSlugs).toEqual({ 'tourn-1': 'ramadan-cup-2026' })
    expect(result.data?.seasons).toEqual({ 'season-1': '2025', 'season-2': '2026' })
  })
  it('does not request private tournament or season columns', async () => {
    const { client, calls } = createClient({})
    await getPlayerHistoryFilterLabels(client, statistics)
    for (const call of calls) expect(call.columns).not.toMatch(/created_by|organization_id|rules|password|email/)
  })
  it('makes no request at all when the player has no statistics rows', async () => {
    const { client, calls } = createClient({})
    const result = await getPlayerHistoryFilterLabels(client, [])
    expect(calls.length).toBe(0)
    expect(result.data).toEqual({ tournaments: {}, tournamentSlugs: {}, seasons: {} })
  })
})

describe('history route uses its own component with no self-referential link', () => {
  const page = readFileSync(resolve(process.cwd(), 'src/components/PublicPage.tsx'), 'utf8')

  it('renders the dedicated history component for the history route', () => {
    expect(page).toMatch(/route\.kind === 'history' \? <PlayerHistoryDetail/)
    // The old bug: history rendered PlayerPublicDetail, so its "View full
    // history & statistics" button pointed at the page already being shown.
    const historyComponent = page.slice(page.indexOf('function PlayerHistoryDetail'))
    expect(historyComponent).toContain('#player/')
    expect(historyComponent).toContain('Back to player profile')
    expect(historyComponent).not.toContain('View full history')
  })

  it('keeps the player summary linking forward to the history page', () => {
    const summary = page.slice(page.indexOf('function PlayerPublicDetail'), page.indexOf('function PlayerHistoryDetail'))
    expect(summary).toContain('View full history')
    expect(summary).toContain('#history/')
    // and the summary must not link to itself
    expect(summary).not.toContain('href={`#player/')
  })
})
