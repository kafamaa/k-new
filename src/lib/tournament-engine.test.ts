import { describe, expect, it } from 'vitest'
import {
  balancedRoundRobin, bestThirdPlaced, bracketSeedOrder, canTransition, computeTable, DEFAULT_FORMAT_CONFIG, drawGroups, expectedMatchCount, fixtureProblems,
  formatProblems, groupProblems, groupTies, homeAwayBalance, knockoutSeedingFromGroups, matchState, normalizeTiebreakers, numberFixtures, pairingProblems,
  planFixtures, potsFromSeeding, progressionConflicts, rankTable, seededBracket, seededShuffle, tieOutcome, totalMatchCount, type EngineResult, type FormatConfig,
} from './tournamentEngine'

const teams = (count: number) => Array.from({ length: count }, (_, index) => `t${index + 1}`)
const config = (extra: Partial<FormatConfig>): FormatConfig => ({ ...DEFAULT_FORMAT_CONFIG, ...extra })
const pairKey = (a: string, b: string) => [a, b].sort().join('|')

describe('Round robin', () => {
  for (const count of [2, 3, 4, 5, 6, 7, 8, 11, 12]) {
    it(`single round robin with ${count} teams: n(n-1)/2 matches, each pair once, no team twice per round, balanced`, () => {
      const fixtures = balancedRoundRobin(teams(count))
      expect(fixtures).toHaveLength((count * (count - 1)) / 2)
      expect(new Set(fixtures.map(item => pairKey(item.homeTeamId, item.awayTeamId))).size).toBe(fixtures.length)
      for (const round of new Set(fixtures.map(item => item.round))) {
        const playing = fixtures.filter(item => item.round === round).flatMap(item => [item.homeTeamId, item.awayTeamId])
        expect(new Set(playing).size).toBe(playing.length)
      }
      expect(Math.max(...[...homeAwayBalance(fixtures).values()].map(Math.abs))).toBeLessThanOrEqual(1)
      expect(fixtureProblems(fixtures, { teams: teams(count), expected: expectedMatchCount(config({}), count), checkBalance: true })).toEqual([])
    })
  }
  it('odd team counts give every team exactly one bye per cycle', () => {
    const fixtures = balancedRoundRobin(teams(5))
    const rounds = new Set(fixtures.map(item => item.round)).size
    expect(rounds).toBe(5)
    for (const team of teams(5)) expect(rounds - fixtures.filter(item => item.homeTeamId === team || item.awayTeamId === team).length).toBe(1)
  })
  it('double round robin: n(n-1) matches and every pair once each way', () => {
    const fixtures = balancedRoundRobin(teams(6), true)
    expect(fixtures).toHaveLength(30)
    expect(expectedMatchCount(config({ format: 'double_round_robin' }), 6)).toBe(30)
    for (const team of teams(6)) expect(homeAwayBalance(fixtures).get(team)).toBe(0)
    expect(new Set(fixtures.map(item => `${item.homeTeamId}>${item.awayTeamId}`)).size).toBe(30)
  })
})

describe('Draw', () => {
  it('is reproducible from its seed and different for another seed', () => {
    const a = drawGroups({ teams: teams(16), groupCount: 4, seed: 'abc', mode: 'random' })
    expect(drawGroups({ teams: teams(16), groupCount: 4, seed: 'abc', mode: 'random' })).toEqual(a)
    expect(drawGroups({ teams: teams(16), groupCount: 4, seed: 'xyz', mode: 'random' }).groups).not.toEqual(a.groups)
    expect(groupProblems(a.groups, teams(16))).toEqual([])
  })
  it('puts one team from each pot in every group (seeded pots)', () => {
    const ranked = teams(12)
    const pots = potsFromSeeding(ranked, 4)
    expect(pots).toEqual([['t1', 't2', 't3', 't4'], ['t5', 't6', 't7', 't8'], ['t9', 't10', 't11', 't12']])
    const { groups } = drawGroups({ teams: ranked, groupCount: 4, seed: 's', mode: 'pots', pots })
    for (const group of groups) for (const pot of pots) expect(group.filter(team => pot.includes(team))).toHaveLength(1)
    const seeded = drawGroups({ teams: ranked, groupCount: 4, seed: 's', mode: 'seeded' }).groups
    for (const group of seeded) expect(group.filter(team => ['t1', 't2', 't3', 't4'].includes(team))).toHaveLength(1)
  })
  it('keeps teams from the same island apart where possible and reports when it cannot', () => {
    const avoid = { t1: 'Malé', t2: 'Malé', t3: 'Addu', t4: 'Addu', t5: null, t6: null, t7: null, t8: null }
    const { groups, problems } = drawGroups({ teams: teams(8), groupCount: 2, seed: 'k', mode: 'random', avoid })
    for (const group of groups) { expect(group.filter(team => avoid[team as keyof typeof avoid] === 'Malé').length).toBeLessThanOrEqual(1); expect(group.filter(team => avoid[team as keyof typeof avoid] === 'Addu').length).toBeLessThanOrEqual(1) }
    expect(problems).toEqual([])
    expect(drawGroups({ teams: teams(4), groupCount: 2, seed: 'k', mode: 'random', avoid: { t1: 'X', t2: 'X', t3: 'X', t4: null } }).problems).toHaveLength(1)
  })
  it('finds missing and duplicated teams in a manual draw', () => {
    expect(groupProblems([['t1', 't2'], ['t2', 't3']], teams(4))).toEqual(['1 team is in more than one group.', '1 confirmed team is not in any group.'])
    expect(pairingProblems([{ homeTeamId: 't1', awayTeamId: 't1', round: 1 }, { homeTeamId: 't2', awayTeamId: 't3', round: 1 }, { homeTeamId: 't3', awayTeamId: 't2', round: 2 }, { homeTeamId: 't2', awayTeamId: 'x', round: 3 }], teams(4))).toEqual(expect.arrayContaining(['A team cannot play itself.', 'The same pairing appears twice.', 'Only confirmed teams can be paired.']))
    expect(pairingProblems([{ homeTeamId: 't1', awayTeamId: 't2', round: 1 }, { homeTeamId: 't1', awayTeamId: 't3', round: 1 }], teams(4))).toEqual(['A team appears twice in round 1.'])
  })
  it('shuffles reproducibly', () => {
    expect(seededShuffle(teams(10), 'q')).toEqual(seededShuffle(teams(10), 'q'))
    expect([...seededShuffle(teams(10), 'q')].sort()).toEqual([...teams(10)].sort())
  })
})

describe('Knockout', () => {
  it('uses standard seeding so the top two seeds can only meet in the final', () => {
    expect(bracketSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
    const plan = seededBracket(teams(8))
    expect(plan.fixtures.map(item => [item.homeTeamId, item.awayTeamId])).toEqual([['t1', 't8'], ['t4', 't5'], ['t2', 't7'], ['t3', 't6']])
  })
  it('gives byes to the top seeds', () => {
    const plan = seededBracket(teams(6))
    expect(plan.byes).toEqual(['t1', 't2'])
    expect(plan.fixtures).toHaveLength(2)
    expect(expectedMatchCount(config({ format: 'knockout' }), 6)).toBe(2)
    expect(totalMatchCount(config({ format: 'knockout', thirdPlace: true }), 8)).toBe(8)
  })
  it('creates both legs of two-leg ties with the venue swapped', () => {
    const plan = seededBracket(teams(4), 2)
    expect(plan.fixtures).toHaveLength(4)
    expect(plan.fixtures[1]).toMatchObject({ homeTeamId: 't4', awayTeamId: 't1', leg: 2 })
    expect(groupTies(plan.fixtures.map(item => ({ ...item, status: 'scheduled', score: null })))).toHaveLength(2)
  })
})

describe('Two-leg aggregate and penalties', () => {
  const leg = (home: string, away: string, h: number, a: number, n: number, extra: object = {}) => ({ homeTeamId: home, awayTeamId: away, leg: n, status: 'confirmed', score: { home: h, away: a, ...extra } })
  it('decides on aggregate', () => {
    expect(tieOutcome([leg('a', 'b', 2, 1, 1), leg('b', 'a', 1, 0, 2)]).problem).toMatch(/level/)
    expect(tieOutcome([leg('a', 'b', 2, 1, 1), leg('b', 'a', 0, 0, 2)])).toMatchObject({ winner: 'a', loser: 'b', aggregate: { a: 2, b: 1 }, decidedBy: 'aggregate' })
  })
  it('uses away goals only when switched on', () => {
    const legs = [leg('a', 'b', 1, 2, 1), leg('b', 'a', 0, 1, 2)]
    expect(tieOutcome(legs).winner).toBeNull()
    expect(tieOutcome(legs, { awayGoals: true })).toMatchObject({ winner: 'b', decidedBy: 'away_goals' })
  })
  it('counts extra time and then penalties in the last leg', () => {
    expect(tieOutcome([leg('a', 'b', 1, 0, 1), leg('b', 'a', 2, 0, 2, { extraTime: true })])).toMatchObject({ winner: 'b', decidedBy: 'extra_time' })
    expect(tieOutcome([leg('a', 'b', 1, 1, 1, { homeShootout: 3, awayShootout: 5 })])).toMatchObject({ winner: 'b', decidedBy: 'penalties' })
  })
  it('never decides from an unconfirmed result', () => {
    expect(tieOutcome([{ ...leg('a', 'b', 5, 0, 1), status: 'awaiting_confirmation' }]).winner).toBeNull()
  })
})

describe('Standings', () => {
  const results: EngineResult[] = [
    { homeTeamId: 'a', awayTeamId: 'b', homeScore: 1, awayScore: 0 },
    { homeTeamId: 'b', awayTeamId: 'c', homeScore: 3, awayScore: 0 },
    { homeTeamId: 'c', awayTeamId: 'a', homeScore: 2, awayScore: 0 },
  ]
  it('counts only the results it is given (confirmed) and never invents a match', () => {
    const table = computeTable(['a', 'b', 'c', 'd'], results)
    expect(table.find(row => row.teamId === 'd')).toMatchObject({ played: 0, points: 0 })
    expect(table.find(row => row.teamId === 'a')).toMatchObject({ played: 2, wins: 1, losses: 1, scored: 1, conceded: 2, points: 3 })
  })
  it('follows the configured tie-breaker order', () => {
    // All three on 3 points. Overall difference: b +2, a -1, c -1.
    const rows = computeTable(['a', 'b', 'c'], results)
    expect(rankTable(rows, results, ['goal_difference', 'goals_scored']).map(row => row.teamId)).toEqual(['b', 'c', 'a'])
    expect(rankTable(rows, results, ['goals_scored', 'goal_difference']).map(row => row.teamId)).toEqual(['b', 'c', 'a'])
    const h2h = rankTable(computeTable(['a', 'c'], [results[2]]), [results[2]], ['head_to_head_points'])
    expect(h2h.map(row => row.teamId)).toEqual(['c', 'a'])
  })
  it('uses fair play, then marks an unbroken tie for a manual decision', () => {
    const level: EngineResult[] = [{ homeTeamId: 'a', awayTeamId: 'b', homeScore: 1, awayScore: 1 }]
    const rows = computeTable(['a', 'b'], level, undefined, { fairPlay: new Map([['a', 4], ['b', 1]]) })
    expect(rankTable(rows, level, ['goal_difference', 'fair_play']).map(row => [row.teamId, row.decidedBy])).toEqual([['b', 'fair_play'], ['a', 'fair_play']])
    const plain = rankTable(computeTable(['a', 'b'], level), level, ['goal_difference', 'manual'])
    expect(plain.every(row => row.unresolved)).toBe(true)
    expect(rankTable(computeTable(['a', 'b'], level), level, ['goal_difference', 'manual'], { manualOrder: ['b', 'a'] }).map(row => row.teamId)).toEqual(['b', 'a'])
  })
  it('is deterministic', () => {
    const rows = computeTable(['x', 'y', 'z'], [])
    expect(rankTable(rows, [], DEFAULT_ORDER)).toEqual(rankTable([...rows].reverse(), [], DEFAULT_ORDER))
  })
  it('reads older tie-breaker names', () => {
    expect(normalizeTiebreakers(['goal_difference', 'goals_scored', 'head_to_head'])).toEqual(['goal_difference', 'goals_scored', 'head_to_head_points'])
  })
  it('qualifies the best third-placed teams and seeds winners against other runners-up', () => {
    const table = (ids: string[], points: number[]) => ids.map((teamId, index) => ({ teamId, played: 3, wins: 0, draws: 0, losses: 0, scored: 5 - index, conceded: 2, points: points[index], fairPlay: null, position: index + 1, difference: 3 - index, decidedBy: null, unresolved: false }))
    const groups = [table(['a1', 'a2', 'a3'], [9, 6, 4]), table(['b1', 'b2', 'b3'], [9, 6, 3]), table(['c1', 'c2', 'c3'], [9, 6, 5])]
    expect(bestThirdPlaced(groups, 2)).toEqual(['c3', 'a3'])
    expect(knockoutSeedingFromGroups(groups, 2, ['c3', 'a3'])).toEqual(['a1', 'b1', 'c1', 'b2', 'c2', 'a2', 'c3', 'a3'])
  })
})
const DEFAULT_ORDER = normalizeTiebreakers([])

describe('Formats and fixtures', () => {
  it('validates format settings', () => {
    expect(formatProblems(config({ format: 'groups_knockout', groupCount: 4 }), 6)).toContain('4 groups need at least 8 teams.')
    expect(formatProblems(config({ format: 'league_playoffs', playoffTeams: 6 }), 10)).toContain('Playoff places should be 2, 4, 8 or 16 so the bracket has no byes.')
    expect(formatProblems(config({ format: 'round_robin', thirdPlace: true }), 6)).toContain('A third-place match needs a knockout round.')
    expect(formatProblems(config({ format: 'groups_knockout', groupCount: 2 }), 8)).toEqual([])
  })
  it('plans group fixtures from the confirmed draw with the expected count', () => {
    const { groups } = drawGroups({ teams: teams(10), groupCount: 2, seed: 'g', mode: 'random' })
    const plan = planFixtures(config({ format: 'groups_knockout', groupCount: 2 }), teams(10), groups)
    expect(plan.fixtures).toHaveLength(20)
    expect(plan.expected).toBe(20)
    expect(fixtureProblems(plan.fixtures, { teams: teams(10), expected: plan.expected })).toEqual([])
  })
  it('finds duplicates, self-play, missing teams, clashes, venue conflicts and short rest', () => {
    const at = (hour: number) => new Date(Date.UTC(2026, 11, 1, hour)).toISOString()
    const problems = fixtureProblems([
      { homeTeamId: 't1', awayTeamId: 't2', leg: 1, scheduledAt: at(10), venue: 'A' },
      { homeTeamId: 't2', awayTeamId: 't1', leg: 1, scheduledAt: at(14), venue: 'B' },
      { homeTeamId: 't3', awayTeamId: 't3', leg: 1, scheduledAt: at(10), venue: 'A' },
    ], { teams: teams(4), expected: 2, restHours: 20, matchMinutes: 90 })
    expect(problems).toEqual(expect.arrayContaining(['The same fixture appears twice.', 'A team is drawn against itself.', 'Expected 2 fixtures but found 3.', '1 confirmed team has no fixture.', 'A has two matches at the same time.', 'A team has less than 20 hours of rest between matches.']))
    expect(fixtureProblems([{ homeTeamId: 't1', awayTeamId: 't2', leg: 1, scheduledAt: at(10) }, { homeTeamId: 't1', awayTeamId: 't3', leg: 1, scheduledAt: at(10) }], { teams: ['t1', 't2', 't3'] })).toContain('A team has two matches at the same time.')
  })
  it('numbers matches in playing order', () => {
    const numbered = numberFixtures([{ homeTeamId: 'a', awayTeamId: 'b', leg: 1, scheduledAt: '2026-12-02T10:00:00Z' }, { homeTeamId: 'c', awayTeamId: 'd', leg: 1, scheduledAt: '2026-12-01T10:00:00Z' }])
    expect(numbered.map(item => [item.homeTeamId, item.matchNumber])).toEqual([['c', 1], ['a', 2]])
  })
})

describe('Match lifecycle and progression conflicts', () => {
  it('follows the state machine', () => {
    expect(matchState({ status: 'scheduled' }, { stagePublished: false })).toBe('draft')
    expect(matchState({ status: 'live', live_phase: 'half_time' })).toBe('half_time')
    expect(matchState({ status: 'awaiting_confirmation' })).toBe('under_review')
    expect(matchState({ status: 'awaiting_confirmation' }, { outcome: 'walkover' })).toBe('walkover')
    expect(matchState({ status: 'confirmed' })).toBe('official')
    expect(canTransition('live', 'half_time')).toBe(true)
    expect(canTransition('official', 'live')).toBe(false)
    expect(canTransition('cancelled', 'scheduled')).toBe(false)
  })
  it('flags later matches holding a team that no longer qualifies, and never replaces it', () => {
    const later = [{ id: 'f', stageId: 's2', homeTeamId: 'a', awayTeamId: 'c', status: 'scheduled' }, { id: 'g', stageId: 's2', homeTeamId: 'd', awayTeamId: 'e', status: 'confirmed' }]
    expect(progressionConflicts(later, ['b', 'c', 'd', 'e'])).toEqual([{ stageId: 's2', matchId: 'f', unexpected: ['a'], missing: ['b'], played: false }])
    expect(progressionConflicts(later, ['a', 'c', 'x', 'e'])).toEqual([{ stageId: 's2', matchId: 'g', unexpected: ['d'], missing: ['x'], played: true }])
    expect(progressionConflicts(later, ['a', 'c', 'd', 'e'])).toEqual([])
  })
})

// --- Engine integration (advancement, storage, permissions) -------------------
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { advancementFor, expectedQualifiers, fairPlayFor, knockoutAdvancement, rankedStageTable, stageResults, type CompetitionStage, type StageMatch } from './advancement'
import { confirmDrawAndFixtures } from './engineStore'
import { careerEvents, EMPTY_SCOREBOARD } from './simpleFlow'
import type { SupabaseClient } from '@supabase/supabase-js'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')
const stageOf = (format: string, rules: Record<string, unknown>, id = 's1'): CompetitionStage => ({ id, categoryId: 'c', name: id, format, stageOrder: 1, rules })
const played = (id: string, home: string, away: string, h: number, a: number, extra: Partial<StageMatch> = {}): StageMatch => ({ id, stageId: 's1', groupId: null, homeTeamId: home, awayTeamId: away, status: 'confirmed', score: { home: h, away: a }, leg: 1, ...extra })

describe('Engine progression', () => {
  it('keeps the bracket shape from stored slots, including byes', () => {
    // 6 teams: seeds 1 and 2 have byes; slots come from seededBracket.
    const { slots } = seededBracket(teams(6))
    const stage = stageOf('knockout', { slots, engine_format: 'knockout' })
    const plan = knockoutAdvancement(stage, [played('m1', 't4', 't5', 2, 0), played('m2', 't3', 't6', 0, 1)])
    expect(plan.problems).toEqual([])
    expect(plan.slots).toEqual(['t1', 't4', 't2', 't6'])
    expect(plan.fixtures.map(item => [item.homeTeamId, item.awayTeamId])).toEqual([['t1', 't4'], ['t2', 't6']])
  })
  it('advances two-leg ties on aggregate and plays the final as one match', () => {
    const stage = stageOf('knockout', { slots: ['a', 'd', 'b', 'c'], knockout_legs: 2, away_goals: false })
    const plan = knockoutAdvancement(stage, [
      played('1', 'a', 'd', 1, 0), played('2', 'd', 'a', 1, 1, { leg: 2 }),
      played('3', 'b', 'c', 0, 2), played('4', 'c', 'b', 0, 3, { leg: 2, score: { home: 0, away: 3, extraTime: true } }),
    ])
    expect(plan.problems).toEqual([])
    expect(plan.fixtures).toEqual([{ homeTeamId: 'a', awayTeamId: 'b', leg: 1, round: 1 }])
  })
  it('waits for every leg and never advances from an unconfirmed result', () => {
    const stage = stageOf('knockout', { slots: ['a', 'b'], knockout_legs: 2 })
    expect(knockoutAdvancement(stage, [played('1', 'a', 'b', 3, 0), played('2', 'b', 'a', 0, 0, { leg: 2, status: 'awaiting_confirmation' })]).problems[0]).toMatch(/confirmed result/)
  })
  it('sends the top N of a league to seeded playoffs', () => {
    const stage = stageOf('round_robin', { engine_format: 'league_playoffs', playoff_teams: 2, tiebreakers: ['goal_difference'] })
    const plan = advancementFor(stage, [played('1', 'a', 'b', 2, 0), played('2', 'b', 'c', 1, 0), played('3', 'c', 'a', 0, 0)], [])
    expect(plan?.teams).toEqual(['a', 'b'])
    expect(plan?.fixtures).toEqual([{ homeTeamId: 'a', awayTeamId: 'b', leg: 1, round: 1 }])
  })
  it('qualifies group winners, runners-up and the best thirds into a seeded bracket', () => {
    const groups = [{ id: 'g1', name: 'Group A', stageId: 's1' }, { id: 'g2', name: 'Group B', stageId: 's1' }]
    const g = (id: string, home: string, away: string, h: number, a: number, group: string) => played(id, home, away, h, a, { groupId: group })
    const stage = stageOf('groups_knockout', { engine_format: 'groups_knockout', qualifiers_per_group: 2, best_thirds: 1, group_count: 2 })
    const plan = advancementFor(stage, [
      g('1', 'a1', 'a2', 1, 0, 'g1'), g('2', 'a2', 'a3', 1, 0, 'g1'), g('3', 'a1', 'a3', 1, 0, 'g1'),
      g('4', 'b1', 'b2', 1, 0, 'g2'), g('5', 'b2', 'b3', 1, 0, 'g2'), g('6', 'b1', 'b3', 1, 0, 'g2'),
    ], groups)
    expect(plan?.teams.slice(0, 4)).toEqual(['a1', 'b1', 'b2', 'a2'])
    expect(plan?.teams).toHaveLength(5)
    expect(plan?.byes).toHaveLength(3)
  })
  it('ranks with fair play from cards in confirmed matches only', () => {
    const stage = stageOf('round_robin', { tiebreakers: ['goal_difference', 'fair_play'] })
    const matches = [played('1', 'a', 'b', 1, 1), { ...played('2', 'a', 'b', 0, 0), status: 'scheduled' }]
    const cards = [{ matchId: '1', teamId: 'a', points: 3 }, { matchId: '2', teamId: 'b', points: 9 }]
    expect(rankedStageTable(stage, matches, fairPlayFor(cards, matches)).map(row => row.teamId)).toEqual(['b', 'a'])
    expect(stageResults(matches)).toHaveLength(1)
  })
  it('names the teams a stage should now send on, for the conflict check', () => {
    const stage = stageOf('knockout', { slots: ['a', 'b', 'c', 'd'] })
    expect(expectedQualifiers(stage, [played('1', 'a', 'b', 0, 1), played('2', 'c', 'd', 2, 1)], [])).toEqual(['b', 'c'])
  })
})

describe('Engine storage and boundaries', () => {
  it('writes nothing when a fixture check fails', async () => {
    const calls: string[] = []
    const client = { from: (table: string) => { calls.push(table); throw new Error('no write expected') }, rpc: () => { throw new Error('no rpc') } } as unknown as SupabaseClient
    const result = await confirmDrawAndFixtures(client, 'u', {
      tournamentId: 't', categoryId: 'c', categoryName: 'Open', confirmedTeams: ['a', 'b', 'c'], config: config({}), points: { win: 3, draw: 1, loss: 0 }, tiebreakers: DEFAULT_ORDER,
      drawMode: 'random', seed: 's', groups: [], fixtures: [{ homeTeamId: 'a', awayTeamId: 'a', leg: 1 }], byes: [], slots: null, expected: 3,
      schedule: { restHours: 0, matchMinutes: 90, maxPerDay: null, matchDays: null },
    })
    expect(result.error).toMatch(/itself/)
    expect(calls).toEqual([])
  })
  it('records each player event once, even when submitted again', () => {
    const key = '123e4567-e89b-42d3-a456-426614174000'
    const board = { ...EMPTY_SCOREBOARD, phase: 'finished' as const, scores: [{ key, side: 'home' as const, points: 1, playerId: 'p', assistId: 'q' }] }
    expect(careerEvents(board, 'football', { home: 'H', away: 'A' })).toEqual(careerEvents(board, 'football', { home: 'H', away: 'A' }))
    expect(read('supabase/migrations/202611010044_match_discipline.sql')).toContain('on conflict (match_id, idempotency_key) do nothing')
  })
  it('migration 045 keeps permission and public-data boundaries', () => {
    const sql = read('supabase/migrations/202611010045_tournament_engine.sql')
    expect(sql.match(/security definer set search_path = ''/g)).toHaveLength(4)
    for (const name of ['set_match_phase(uuid, text)', 'replace_match_participants(uuid, uuid, uuid, text)', 'publish_tournament_archive(uuid)']) expect(sql).toContain(`revoke execute on function public.${name} from public, anon;`)
    expect(sql).toContain('revoke execute on function public.recalculate_stage_standings(uuid) from public, anon, authenticated;')
    expect(sql).toContain('public.is_tournament_operator(v_match.tournament_id) or public.is_match_official(p_match)')
    expect(sql).toContain("raise exception 'match_already_played'")
    expect(sql).toContain("te.application_status = 'approved'")
    expect(sql).toContain("t.is_published and t.status in ('completed', 'archived')")
    expect(sql).toContain('enable row level security')
    // Archive: published names only, confirmed results only, no private fields.
    expect(sql).toContain('case when t.is_published then t.name end')
    expect(sql).toContain("v.status = 'confirmed'")
    const body = sql.slice(sql.indexOf('create or replace function public.publish_tournament_archive'))
    expect(body).not.toMatch(/national|phone|email|document|payment|review_notes/i)
    expect(sql).not.toMatch(/\b(drop table|truncate|delete from public\.(matches|match_result_versions|tournaments))\b/i)
    expect(sql).toContain('insert into public.standings_snapshot_history')
  })
  it('the Schedule page offers the engine steps and actions', () => {
    const engine = read('src/components/CompetitionEngine.tsx')
    // Choose Format → When & Where → (Draw) → Preview & Publish (simple workflow replacement, 2026-11-03).
    for (const text of ['Use This Format', 'Generate Schedule', 'Run Automatic Draw', 'Accept Draw', 'Try Again', 'Edit Manually', 'Draw options', 'Regenerate Draft', 'Publish Schedule', 'Swap home and away', 'Advanced settings']) expect(engine).toContain(text)
    expect(engine).toContain("entries.filter(entry => entry.application_status === 'approved')")
  })
})
