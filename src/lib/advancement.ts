import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateStandings, knockoutFixtures, type Fixture, type StandingsConfig } from './competition'
import { bestThirdPlaced, computeTable, groupTies, knockoutSeedingFromGroups, normalizeTiebreakers, rankTable, seededBracket, tieOutcome, type EngineResult, type RankedRow } from './tournamentEngine'

// ---------------------------------------------------------------------------
// Stage advancement: knockout next rounds and groups -> knockout.
//
// Every round is its own competition_stages row (format 'knockout',
// increasing stage_order), so each round keeps its own fixture version and
// audit trail and the previous round is never rewritten. Only confirmed
// results decide who advances. A level knockout score is decided by the
// shootout fields (score.homeShootout / score.awayShootout); a level score with
// no shootout blocks advancement instead of guessing a winner.
// ---------------------------------------------------------------------------

export type StageScore = { home: number; away: number; homeShootout?: number; awayShootout?: number; extraTime?: boolean }
export type StageMatch = { id: string; stageId: string; groupId: string | null; homeTeamId: string | null; awayTeamId: string | null; status: string; score: StageScore | null; leg?: number }
export type CompetitionStage = { id: string; categoryId: string; name: string; format: string; stageOrder: number; rules: Record<string, unknown> }
export type StageGroup = { id: string; name: string; stageId: string }

export function parseStageScore(value: unknown): StageScore | null {
  const score = value as Record<string, unknown> | null
  if (!score || typeof score.home !== 'number' || typeof score.away !== 'number') return null
  const parsed: StageScore = { home: score.home, away: score.away }
  if (typeof score.homeShootout === 'number' && typeof score.awayShootout === 'number') { parsed.homeShootout = score.homeShootout; parsed.awayShootout = score.awayShootout }
  if (score.extraTime === true) parsed.extraTime = true
  return parsed
}

// Matches that still need a decision before the stage can advance. Cancelled
// fixtures are treated as resolved (no team advances from them).
export function unresolvedStageMatches(matches: StageMatch[]): StageMatch[] {
  return matches.filter(match => match.status !== 'confirmed' && match.status !== 'cancelled')
}

export function matchWinner(match: StageMatch): { winner: string | null; problem: string | null } {
  if (!match.homeTeamId || !match.awayTeamId) return { winner: null, problem: 'A fixture is missing a team.' }
  if (!match.score) return { winner: null, problem: 'A confirmed result has no readable score.' }
  const { home, away, homeShootout, awayShootout } = match.score
  if (home > away) return { winner: match.homeTeamId, problem: null }
  if (away > home) return { winner: match.awayTeamId, problem: null }
  if (homeShootout !== undefined && awayShootout !== undefined && homeShootout !== awayShootout) return { winner: homeShootout > awayShootout ? match.homeTeamId : match.awayTeamId, problem: null }
  return { winner: null, problem: 'A knockout match ended level with no shootout result. Correct the result with the shootout score.' }
}

export function stageByes(stage: CompetitionStage): string[] {
  return Array.isArray(stage.rules.byes) ? (stage.rules.byes as unknown[]).map(String) : []
}

export type AdvancementPlan = { teams: string[]; fixtures: Fixture[]; byes: string[]; champion: string | null; problems: string[]; slots?: Array<string | null> }

// Teams paired with an empty slot in a padded bracket. knockoutFixtures leaves
// them out of the fixture list, so they must be carried to the next round.
export function bracketByes(teamIds: string[], fixtures: Fixture[]): string[] {
  const playing = new Set(fixtures.flatMap(fixture => [fixture.homeTeamId, fixture.awayTeamId]))
  return [...new Set(teamIds)].filter(teamId => !playing.has(teamId))
}

function plan(teams: string[], problems: string[]): AdvancementPlan {
  if (problems.length) return { teams: [], fixtures: [], byes: [], champion: null, problems }
  if (teams.length === 1) return { teams, fixtures: [], byes: [], champion: teams[0], problems: [] }
  if (teams.length === 0) return { teams, fixtures: [], byes: [], champion: null, problems: ['No team qualifies from this stage.'] }
  const fixtures = knockoutFixtures(teams)
  return { teams, fixtures, byes: bracketByes(teams, fixtures), champion: null, problems: [] }
}

// The next round's teams from a stored bracket: each pair of slots sends its
// tie winner (or its bye) to the same position, so the bracket keeps its shape.
export function nextSlots(slots: Array<string | null>, winnerOf: (a: string, b: string) => string | null): Array<string | null> {
  const next: Array<string | null> = []
  for (let index = 0; index < slots.length; index += 2) {
    const a = slots[index]; const b = slots[index + 1] ?? null
    next.push(a && b ? winnerOf(a, b) : a ?? b)
  }
  return next
}

// A two-team next round is the final: always one match. Earlier rounds keep
// the stage's legs setting.
function bracketPlan(slots: Array<string | null>, legs: 1 | 2): AdvancementPlan {
  const teams = slots.filter((team): team is string => Boolean(team))
  if (teams.length === 1) return { teams, fixtures: [], byes: [], champion: teams[0], problems: [], slots }
  const fixtures: Fixture[] = []
  const byes: string[] = []
  for (let index = 0; index < slots.length; index += 2) {
    const home = slots[index]; const away = slots[index + 1] ?? null
    if (home && away) {
      fixtures.push({ homeTeamId: home, awayTeamId: away, leg: 1, round: 1 })
      if (legs === 2 && teams.length > 2) fixtures.push({ homeTeamId: away, awayTeamId: home, leg: 2, round: 1 })
    } else if (home || away) byes.push((home ?? away)!)
  }
  return { teams, fixtures, byes, champion: null, problems: [], slots }
}

export function knockoutAdvancement(stage: CompetitionStage, matches: StageMatch[]): AdvancementPlan {
  const pending = unresolvedStageMatches(matches)
  if (pending.length) return plan([], [`${pending.length} match${pending.length === 1 ? '' : 'es'} in ${stage.name} still need a confirmed result.`])
  const problems: string[] = []
  const winners = new Map<string, string>()
  const confirmed = matches.filter(item => item.status === 'confirmed')
  for (const tie of groupTies(confirmed.map(match => ({ ...match, leg: match.leg ?? 1 })))) {
    const outcome = tieOutcome(tie, { awayGoals: stage.rules.away_goals === true })
    if (outcome.problem || !outcome.winner) { problems.push(outcome.problem ?? 'A tie has no winner.'); continue }
    const key = [tie[0].homeTeamId, tie[0].awayTeamId].sort().join('|')
    winners.set(key, outcome.winner)
  }
  if (problems.length) return plan([], [...new Set(problems)])
  const slots = Array.isArray(stage.rules.slots) ? (stage.rules.slots as unknown[]).map(item => typeof item === 'string' ? item : null) : null
  const legs = stage.rules.knockout_legs === 2 ? 2 : 1
  if (slots) return bracketPlan(nextSlots(slots, (a, b) => winners.get([a, b].sort().join('|')) ?? null), legs)
  // Stages made before the engine stored slots: winners in match order, then byes.
  return plan([...winners.values(), ...stageByes(stage)], [])
}

// Group winners meet runners-up of the neighbouring group (A1 v B2, B1 v A2...),
// so two teams from one group never meet in the first knockout round.
export function groupQualifierFixtures(groupTables: string[][], qualifiersPerGroup: number): { teams: string[]; fixtures: Fixture[] } {
  const groups = groupTables.filter(table => table.length > 0)
  if (qualifiersPerGroup >= 2 && groups.length >= 2 && groups.every(table => table.length >= 2)) {
    const fixtures: Fixture[] = groups.map((table, index) => ({ homeTeamId: table[0], awayTeamId: groups[(index + 1) % groups.length][1], leg: 1 as const, round: 1 }))
    const teams = fixtures.flatMap(fixture => [fixture.homeTeamId, fixture.awayTeamId])
    return { teams, fixtures }
  }
  const teams = groups.flatMap(table => table.slice(0, qualifiersPerGroup))
  return { teams, fixtures: knockoutFixtures(teams) }
}

export function groupAdvancement(stage: CompetitionStage, matches: StageMatch[], groups: StageGroup[], config: StandingsConfig = {}, cards?: CardPoints[]): AdvancementPlan {
  const pending = unresolvedStageMatches(matches)
  if (pending.length) return plan([], [`${pending.length} group match${pending.length === 1 ? '' : 'es'} still need a confirmed result.`])
  const qualifiers = Math.max(1, Number(stage.rules.qualifiers_per_group ?? 2))
  const stageGroups = groups.filter(group => group.stageId === stage.id).sort((a, b) => a.name.localeCompare(b.name))
  const buckets = stageGroups.length ? stageGroups.map(group => matches.filter(match => match.groupId === group.id)) : [matches]
  if (stage.rules.engine_format) {
    const ranked = buckets.map(bucket => rankedStageTable(stage, bucket, fairPlayFor(cards, bucket)))
    const thirds = bestThirdPlaced(ranked, Number(stage.rules.best_thirds ?? 0))
    const seeds = knockoutSeedingFromGroups(ranked, qualifiers, thirds)
    if (seeds.length < 2) return plan(seeds, [])
    const bracket = seededBracket(seeds, stage.rules.knockout_legs === 2 && seeds.length > 2 ? 2 : 1)
    return { teams: seeds, fixtures: bracket.fixtures, byes: bracket.byes, champion: null, problems: [], slots: bracket.slots }
  }
  const tables = buckets.map(bucket => {
    const teamIds = [...new Set(bucket.flatMap(match => [match.homeTeamId, match.awayTeamId]).filter((id): id is string => Boolean(id)))]
    const results = bucket.filter(match => match.status === 'confirmed' && match.score && match.homeTeamId && match.awayTeamId)
      .map(match => ({ homeTeamId: match.homeTeamId!, awayTeamId: match.awayTeamId!, homeScore: match.score!.home, awayScore: match.score!.away, confirmed: true }))
    return calculateStandings(teamIds, results, config).map(row => row.teamId)
  })
  const { teams, fixtures } = groupQualifierFixtures(tables, qualifiers)
  if (teams.length < 2) return plan(teams, [])
  return { teams, fixtures, byes: bracketByes(teams, fixtures), champion: null, problems: [] }
}

export function roundName(teamCount: number, nextOrder: number): string {
  if (teamCount === 2) return 'Final'
  if (teamCount <= 4) return 'Semi-finals'
  if (teamCount <= 8) return 'Quarter-finals'
  return `Knockout round ${nextOrder}`
}

// A third-place match and a replaced draft never drive advancement (owner, 2026-11-02).
export const isSideStage = (stage: Pick<CompetitionStage, 'rules'>) => stage.rules.third_place_match === true || stage.rules.superseded === true

// The stage that advancement works from: the latest stage of a category.
export function latestStage(stages: CompetitionStage[], categoryId: string): CompetitionStage | null {
  return stages.filter(stage => stage.categoryId === categoryId && !isSideStage(stage)).sort((a, b) => b.stageOrder - a.stageOrder)[0] ?? null
}

// Third-place match: chosen in the Schedule step (rules.third_place on any
// stage of the category). Played by the two semi-final losers, decided only by
// confirmed results.
export function thirdPlaceEnabled(stages: CompetitionStage[], categoryId: string): boolean {
  return stages.some(stage => stage.categoryId === categoryId && stage.rules.third_place === true)
}

export function semiFinalLosers(stage: CompetitionStage, matches: StageMatch[]): [string, string] | null {
  if (stage.format !== 'knockout') return null
  const stageMatches = matches.filter(match => match.stageId === stage.id)
  if (unresolvedStageMatches(stageMatches).length) return null
  const ties = groupTies(stageMatches.filter(match => match.status === 'confirmed').map(match => ({ ...match, leg: match.leg ?? 1 })))
  if (ties.length !== 2) return null
  const losers = ties.map(tie => tieOutcome(tie, { awayGoals: stage.rules.away_goals === true }).loser)
  return losers[0] && losers[1] ? [losers[0], losers[1]] : null
}

// One league or group table, ranked by the stage's points and ordered
// tie-breakers, from confirmed results only.
export function stageResults(matches: StageMatch[]): EngineResult[] {
  return matches.filter(match => match.status === 'confirmed' && match.score && match.homeTeamId && match.awayTeamId)
    .map(match => ({ homeTeamId: match.homeTeamId!, awayTeamId: match.awayTeamId!, homeScore: match.score!.home, awayScore: match.score!.away }))
}
export function rankedStageTable(stage: CompetitionStage, matches: StageMatch[], fairPlay?: Map<string, number>): RankedRow[] {
  const teamIds = [...new Set(matches.flatMap(match => [match.homeTeamId, match.awayTeamId]).filter((id): id is string => Boolean(id)))]
  const results = stageResults(matches)
  const points = { win: Number(stage.rules.points_win ?? 3), draw: Number(stage.rules.points_draw ?? 1), loss: Number(stage.rules.points_loss ?? 0) }
  const manual = Array.isArray(stage.rules.manual_order) ? (stage.rules.manual_order as unknown[]).map(String) : undefined
  return rankTable(computeTable(teamIds, results, points, fairPlay ? { fairPlay } : {}), results, normalizeTiebreakers(stage.rules.tiebreakers), { points, manualOrder: manual })
}

// Custom format: round robin then final. After the group stage, 2nd and 3rd
// meet in a semifinal; the winner then meets 1st in the final. Only the
// semifinal (2nd vs 3rd) is generated here; the final is generated once the
// semifinal is confirmed.
export function topToFinalAdvancement(stage: CompetitionStage, matches: StageMatch[], cards?: CardPoints[]): AdvancementPlan {
  const pending = unresolvedStageMatches(matches)
  if (pending.length) return plan([], [`${pending.length} league match${pending.length === 1 ? '' : 'es'} still need a confirmed result.`])
  const table = rankedStageTable(stage, matches, fairPlayFor(cards, matches))
  if (table.length < 3) return plan([], ['At least 3 teams are required for this format.'])
  if (table.some(row => row.unresolved)) return plan([], ['A tie in the league table decides a place. Record a playoff or a manual decision under Standings first.'])
  const second = table[1].teamId
  const third = table[2].teamId
  return { teams: [second, third], fixtures: [{ homeTeamId: second, awayTeamId: third, leg: 1, round: 1 }], byes: [], champion: null, problems: [], slots: [second, third] }
}

// League followed by playoffs: the top N of the confirmed table, seeded 1 v N.
export function leagueAdvancement(stage: CompetitionStage, matches: StageMatch[], cards?: CardPoints[]): AdvancementPlan {
  const pending = unresolvedStageMatches(matches)
  if (pending.length) return plan([], [`${pending.length} league match${pending.length === 1 ? '' : 'es'} still need a confirmed result.`])
  const table = rankedStageTable(stage, matches, fairPlayFor(cards, matches))
  const places = Number(stage.rules.playoff_teams ?? 0)
  const cut = table.slice(0, places)
  if (cut.some(row => row.unresolved) || (table[places] && table[places].unresolved && table[places - 1]?.unresolved)) return plan([], ['A tie in the league table decides a playoff place. Record a playoff or a manual decision under Standings first.'])
  const seeds = cut.map(row => row.teamId)
  const bracket = seededBracket(seeds, stage.rules.knockout_legs === 2 && seeds.length > 2 ? 2 : 1)
  return { teams: seeds, fixtures: bracket.fixtures, byes: bracket.byes, champion: null, problems: [], slots: bracket.slots }
}

export function advancementFor(stage: CompetitionStage, matches: StageMatch[], groups: StageGroup[], cards?: CardPoints[]): AdvancementPlan | null {
  const stageMatches = matches.filter(match => match.stageId === stage.id)
  if (stage.format === 'knockout') return knockoutAdvancement(stage, stageMatches)
  if (stage.format === 'groups_knockout') return groupAdvancement(stage, stageMatches, groups, {}, cards)
  if (stage.format === 'round_robin_then_final') return topToFinalAdvancement(stage, stageMatches, cards)
  if (stage.format === 'round_robin' || stage.format === 'two_leg') {
    const teams = [...new Set(stageMatches.flatMap(match => [match.homeTeamId, match.awayTeamId]).filter((id): id is string => Boolean(id)))]
    const places = Number(stage.rules.playoff_teams ?? 0) || teams.length
    if (places >= 2) {
      const patched = { ...stage, rules: { ...stage.rules, playoff_teams: places } }
      return leagueAdvancement(patched, stageMatches, cards)
    }
  }
  return null
}

// The teams a stage should now send on, used to find downstream conflicts after
// a correction. Null when the stage does not feed a later round.
export function expectedQualifiers(stage: CompetitionStage, matches: StageMatch[], groups: StageGroup[], cards?: CardPoints[]): string[] | null {
  const next = advancementFor(stage, matches, groups, cards)
  if (!next || next.problems.length) return null
  return next.champion ? [next.champion] : next.teams
}

// ---------------------------------------------------------------------------
// Loading and persistence
// ---------------------------------------------------------------------------

// Card points per team in confirmed matches, for the fair-play tie-breaker:
// yellow 1, red 3 (a second yellow is a yellow plus a red).
export type CardPoints = { matchId: string; teamId: string; points: number }
export function fairPlayFor(cards: CardPoints[] | undefined, matches: StageMatch[]): Map<string, number> | undefined {
  if (!cards) return undefined
  const ids = new Set(matches.filter(match => match.status === 'confirmed').map(match => match.id))
  const totals = new Map<string, number>()
  for (const card of cards) if (ids.has(card.matchId)) totals.set(card.teamId, (totals.get(card.teamId) ?? 0) + card.points)
  return totals
}

export async function loadCompetitionStructure(client: SupabaseClient, tournamentId: string): Promise<{ stages: CompetitionStage[]; groups: StageGroup[]; matches: StageMatch[]; cards?: CardPoints[]; error: string | null }> {
  const [stages, matches] = await Promise.all([
    client.from('competition_stages').select('id,category_id,name,format,stage_order,rules').eq('tournament_id', tournamentId).order('stage_order', { ascending: true }),
    client.from('matches').select('id,stage_id,group_id,home_team_id,away_team_id,status,leg').eq('tournament_id', tournamentId),
  ])
  if (stages.error) return { stages: [], groups: [], matches: [], error: stages.error.message }
  if (matches.error) return { stages: [], groups: [], matches: [], error: matches.error.message }
  const stageRows = (stages.data ?? []) as Array<Record<string, unknown>>
  const stageIds = stageRows.map(row => String(row.id))
  const matchRows = (matches.data ?? []) as Array<Record<string, unknown>>
  const matchIds = matchRows.map(row => String(row.id))
  const [groups, versions] = await Promise.all([
    stageIds.length ? client.from('competition_groups').select('id,name,stage_id').in('stage_id', stageIds) : Promise.resolve({ data: [], error: null }),
    matchIds.length ? client.from('match_result_versions').select('match_id,version,score').in('match_id', matchIds).eq('status', 'confirmed').order('version', { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ])
  if (groups.error) return { stages: [], groups: [], matches: [], error: groups.error.message }
  if (versions.error) return { stages: [], groups: [], matches: [], error: versions.error.message }
  const scores = new Map<string, StageScore | null>()
  for (const row of (versions.data ?? []) as Array<Record<string, unknown>>) {
    const id = String(row.match_id)
    if (!scores.has(id)) scores.set(id, parseStageScore(row.score))
  }
  // Cards are optional: if they cannot be read, fair play is simply skipped.
  const confirmedIds = matchRows.filter(row => row.status === 'confirmed').map(row => String(row.id))
  const cardRows = confirmedIds.length ? await client.from('match_events').select('match_id,team_id,event_type').in('match_id', confirmedIds).in('event_type', ['yellow_card', 'red_card']) : { data: [], error: null }
  const cards = cardRows.error ? undefined : ((cardRows.data ?? []) as Array<{ match_id: string; team_id: string | null; event_type: string }>).filter(row => row.team_id).map(row => ({ matchId: row.match_id, teamId: row.team_id!, points: row.event_type === 'red_card' ? 3 : 1 }))
  return {
    cards,
    stages: stageRows.map(row => ({ id: String(row.id), categoryId: String(row.category_id), name: String(row.name), format: String(row.format), stageOrder: Number(row.stage_order ?? 1), rules: (row.rules ?? {}) as Record<string, unknown> })),
    groups: ((groups.data ?? []) as Array<Record<string, unknown>>).map(row => ({ id: String(row.id), name: String(row.name), stageId: String(row.stage_id) })),
    matches: matchRows.map(row => ({ id: String(row.id), stageId: String(row.stage_id), groupId: row.group_id ? String(row.group_id) : null, homeTeamId: row.home_team_id ? String(row.home_team_id) : null, awayTeamId: row.away_team_id ? String(row.away_team_id) : null, status: String(row.status ?? 'scheduled'), score: scores.get(String(row.id)) ?? null, leg: Number(row.leg ?? 1) })),
    error: null,
  }
}

export async function createThirdPlaceMatch(client: SupabaseClient, userId: string, tournamentId: string, from: CompetitionStage, losers: [string, string]): Promise<{ error: string | null }> {
  const stage = await client.from('competition_stages').insert({
    tournament_id: tournamentId, category_id: from.categoryId, name: 'Third-place match', format: 'knockout', draw_mode: 'automatic', stage_order: from.stageOrder + 1,
    rules: { previous_stage_id: from.id, third_place_match: true },
  }).select('id').single()
  if (stage.error || !stage.data) return { error: stage.error?.message ?? 'The third-place match could not be created.' }
  const fixture = { homeTeamId: losers[0], awayTeamId: losers[1], leg: 1 as const, round: 1 }
  const match = await client.from('matches').insert({ tournament_id: tournamentId, stage_id: stage.data.id, category_id: from.categoryId, home_team_id: losers[0], away_team_id: losers[1], leg: 1, created_by: userId })
  if (match.error) return { error: match.error.message }
  const version = await client.from('competition_fixture_versions').insert({ stage_id: stage.data.id, version: 1, draw_mode: 'automatic', fixture_payload: { fixtures: [fixture], third_place_from: from.id }, created_by: userId }).select('id').single()
  if (!version.error && version.data) await client.from('audit_events').insert({ actor_id: userId, action: 'fixture_version_created', entity_type: 'fixture_version', entity_id: version.data.id, reason: `Third-place match from ${from.name}` })
  return { error: version.error?.message ?? null }
}

export async function createNextRound(client: SupabaseClient, userId: string, tournamentId: string, from: CompetitionStage, next: AdvancementPlan, options: { thirdPlace?: [string, string] | null } = {}): Promise<{ stageId: string | null; fixtureCount: number; error: string | null }> {
  if (next.problems.length) return { stageId: null, fixtureCount: 0, error: next.problems.join(' ') }
  if (next.fixtures.length === 0) return { stageId: null, fixtureCount: 0, error: next.champion ? 'This stage already decided the winner; no further round is needed.' : 'No fixtures to create.' }
  const order = from.stageOrder + 1
  const stage = await client.from('competition_stages').insert({
    tournament_id: tournamentId, category_id: from.categoryId, name: roundName(next.teams.length, order), format: 'knockout', draw_mode: 'automatic', stage_order: order,
    // The bracket slots, legs and tie rules travel with each round, so the next
    // round and any later correction check use the same bracket.
    rules: {
      previous_stage_id: from.id, byes: next.byes,
      ...(next.slots ? { slots: next.slots } : {}),
      ...(['knockout_legs', 'away_goals', 'extra_time', 'penalties', 'engine_format'].reduce((carried, key) => from.rules[key] !== undefined ? { ...carried, [key]: from.rules[key] } : carried, {} as Record<string, unknown>)),
    },
  }).select('id').single()
  if (stage.error || !stage.data) return { stageId: null, fixtureCount: 0, error: stage.error?.message ?? 'The next round could not be created.' }
  const stageId = String(stage.data.id)
  const matches = await client.from('matches').insert(next.fixtures.map(fixture => ({ tournament_id: tournamentId, stage_id: stageId, category_id: from.categoryId, home_team_id: fixture.homeTeamId, away_team_id: fixture.awayTeamId, leg: fixture.leg ?? 1, created_by: userId })))
  if (matches.error) return { stageId, fixtureCount: 0, error: matches.error.message }
  // Bracket source references: every slot names the stage it came from.
  const version = await client.from('competition_fixture_versions').insert({ stage_id: stageId, version: 1, draw_mode: 'automatic', fixture_payload: { fixtures: next.fixtures, byes: next.byes, advanced_from: from.id, slots: next.slots ?? null, sources: next.teams.map(team => ({ team, from_stage: from.id })) }, created_by: userId }).select('id').single()
  if (!version.error && version.data) await client.from('audit_events').insert({ actor_id: userId, action: 'fixture_version_created', entity_type: 'fixture_version', entity_id: version.data.id, reason: `Advanced from ${from.name}` })
  if (version.error) return { stageId, fixtureCount: next.fixtures.length, error: version.error.message }
  if (options.thirdPlace && next.teams.length === 2) {
    const third = await createThirdPlaceMatch(client, userId, tournamentId, from, options.thirdPlace)
    if (third.error) return { stageId, fixtureCount: next.fixtures.length, error: `The final was created, but the third-place match was not: ${third.error}` }
    return { stageId, fixtureCount: next.fixtures.length + 1, error: null }
  }
  return { stageId, fixtureCount: next.fixtures.length, error: null }
}

// Result correction guard (owner, 2026-11-03). A correction that changes who won
// a knockout tie after the next round already exists does not move teams in that
// round by itself, so the organizer is warned and must acknowledge it.
export function correctionImpact(structure: { stages: CompetitionStage[]; matches: StageMatch[] }, matchId: string, next: StageScore): { previous: StageScore | null; laterRound: string | null; winnerChanges: boolean } {
  const match = structure.matches.find(item => item.id === matchId)
  if (!match) return { previous: null, laterRound: null, winnerChanges: false }
  const stage = structure.stages.find(item => item.id === match.stageId)
  const later = stage ? structure.stages.find(item => item.rules.previous_stage_id === stage.id) ?? null : null
  if (!stage || stage.format !== 'knockout' || !match.score) return { previous: match.score, laterRound: later?.name ?? null, winnerChanges: false }
  const before = matchWinner(match).winner
  const after = matchWinner({ ...match, score: next }).winner
  return { previous: match.score, laterRound: later?.name ?? null, winnerChanges: Boolean(later) && before !== after }
}
