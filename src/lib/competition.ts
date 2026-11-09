import type { SupabaseClient } from '@supabase/supabase-js'

export type CompetitionFormat = 'round_robin' | 'group_stage' | 'knockout' | 'groups_knockout' | 'two_leg' | 'round_robin_then_final'
export type Fixture = { homeTeamId: string; awayTeamId: string; leg: 1 | 2; round?: number; group?: string }
export type Result = { homeTeamId: string; awayTeamId: string; homeScore: number; awayScore: number; confirmed: boolean }
export type TieBreaker = 'goal_difference' | 'goals_for' | 'wins' | 'head_to_head'
export type StandingsConfig = { pointsWin?: number; pointsDraw?: number; pointsLoss?: number; tieBreakers?: TieBreaker[] }

export type SportRules = { sport: string; scoreUnit: 'goals' | 'points' | 'sets'; supportsDraw: boolean; events: readonly string[]; optionalStats: readonly string[] }
const commonFootballEvents = ['goal', 'assist', 'yellow_card', 'red_card', 'substitution'] as const
export const SPORT_RULES: Record<string, SportRules> = {
  football: { sport: 'football', scoreUnit: 'goals', supportsDraw: true, events: commonFootballEvents, optionalStats: ['minutes', 'goalkeeper_saves', 'clean_sheets'] },
  futsal: { sport: 'futsal', scoreUnit: 'goals', supportsDraw: true, events: [...commonFootballEvents, 'team_foul'] as const, optionalStats: ['minutes', 'goalkeeper_saves', 'clean_sheets', 'fouls'] },
  handball: { sport: 'handball', scoreUnit: 'goals', supportsDraw: true, events: ['goal', 'assist', 'yellow_card', 'red_card', 'blue_card', 'two_minute_suspension'], optionalStats: ['goalkeeper_saves'] },
  volleyball: { sport: 'volleyball', scoreUnit: 'sets', supportsDraw: false, events: ['point', 'ace', 'attack_point', 'block', 'dig', 'recorded_error'], optionalStats: ['sets_played'] },
  basketball: { sport: 'basketball', scoreUnit: 'points', supportsDraw: false, events: ['one_point', 'two_point', 'three_point', 'rebound', 'assist', 'steal', 'block', 'foul'], optionalStats: [] },
  basketball_3x3: { sport: 'basketball_3x3', scoreUnit: 'points', supportsDraw: false, events: ['one_point', 'two_point', 'rebound', 'assist', 'steal', 'block', 'foul'], optionalStats: [] },
}

export function getSportRules(sport: string): SportRules | null { return SPORT_RULES[sport] ?? null }

export function roundRobinFixtures(teamIds: string[], doubleLeg = false, group?: string): Fixture[] {
  const teams = [...new Set(teamIds)]
  if (teams.length < 2) return []
  if (teams.length % 2) teams.push('BYE')
  const fixtures: Fixture[] = []; const rounds = teams.length - 1; const half = teams.length / 2; const rotation = [...teams]
  for (let round = 0; round < rounds; round += 1) {
    for (let i = 0; i < half; i += 1) { const home = rotation[i]; const away = rotation[rotation.length - 1 - i]; if (home !== 'BYE' && away !== 'BYE') fixtures.push({ homeTeamId: round % 2 ? away : home, awayTeamId: round % 2 ? home : away, leg: 1, round: round + 1, group }) }
    rotation.splice(1, 0, rotation.pop()!)
  }
  return doubleLeg ? [...fixtures, ...fixtures.map(fixture => ({ ...fixture, homeTeamId: fixture.awayTeamId, awayTeamId: fixture.homeTeamId, leg: 2 as const, round: (fixture.round ?? 1) + rounds }))] : fixtures
}

export function assignGroups(teamIds: string[], groupCount: number): string[][] {
  const count = Math.max(1, Math.min(groupCount, teamIds.length)); const groups = Array.from({ length: count }, () => [] as string[])
  teamIds.forEach((teamId, index) => groups[index % count].push(teamId))
  return groups
}

export function knockoutFixtures(teamIds: string[]): Fixture[] {
  const unique = [...new Set(teamIds)]; if (unique.length < 2) return []
  const size = 2 ** Math.ceil(Math.log2(unique.length)); const slots = [...unique, ...Array.from({ length: size - unique.length }, (_, i) => `BYE_${i + 1}`)]; const fixtures: Fixture[] = []
  for (let i = 0; i < slots.length; i += 2) if (!slots[i].startsWith('BYE_') && !slots[i + 1].startsWith('BYE_')) fixtures.push({ homeTeamId: slots[i], awayTeamId: slots[i + 1], leg: 1, round: 1 })
  return fixtures
}

export function manualFixtures(pairings: Array<[string, string]>): Fixture[] {
  const used = new Set<string>(); const fixtures: Fixture[] = []
  for (const [homeTeamId, awayTeamId] of pairings) { if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId || used.has(homeTeamId) || used.has(awayTeamId)) continue; used.add(homeTeamId); used.add(awayTeamId); fixtures.push({ homeTeamId, awayTeamId, leg: 1, round: 1 }) }
  return fixtures
}

export function generateFixtures(format: CompetitionFormat, teamIds: string[], groupCount = 2): { groups: string[][]; fixtures: Fixture[]; nextRoundSlots: string[] } {
  if (format === 'round_robin' || format === 'round_robin_then_final') return { groups: [teamIds], fixtures: roundRobinFixtures(teamIds), nextRoundSlots: [] }
  if (format === 'two_leg') return { groups: [teamIds], fixtures: roundRobinFixtures(teamIds, true), nextRoundSlots: [] }
  if (format === 'knockout') return { groups: [], fixtures: knockoutFixtures(teamIds), nextRoundSlots: [] }
  const groups = assignGroups(teamIds, groupCount); const fixtures = groups.flatMap((group, index) => roundRobinFixtures(group, false, `Group ${String.fromCharCode(65 + index)}`)); const nextRoundSlots = groups.map((_, index) => `GROUP_${String.fromCharCode(65 + index)}_1`)
  return { groups, fixtures: format === 'groups_knockout' ? fixtures : fixtures, nextRoundSlots }
}

export function attachPersistedGroupIds<T extends Fixture>(fixtures: T[], groups: Array<{ name: string; id: string }>): Array<T & { groupId: string | null }> {
  const ids = new Map(groups.map(group => [group.name, group.id])); return fixtures.map(fixture => ({ ...fixture, groupId: fixture.group ? ids.get(fixture.group) ?? null : null }))
}

export function calculateStandings(teamIds: string[], results: Result[], config: StandingsConfig = {}) {
  const pointsWin = config.pointsWin ?? 3; const pointsDraw = config.pointsDraw ?? 1; const pointsLoss = config.pointsLoss ?? 0; const table = new Map(teamIds.map(teamId => [teamId, { teamId, played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0, points: 0 }]))
  for (const result of results.filter(item => item.confirmed)) { const home = table.get(result.homeTeamId); const away = table.get(result.awayTeamId); if (!home || !away) continue; home.played += 1; away.played += 1; home.scored += result.homeScore; home.conceded += result.awayScore; away.scored += result.awayScore; away.conceded += result.homeScore; if (result.homeScore > result.awayScore) { home.wins += 1; home.points += pointsWin; away.losses += 1; away.points += pointsLoss } else if (result.homeScore < result.awayScore) { away.wins += 1; away.points += pointsWin; home.losses += 1; home.points += pointsLoss } else { home.draws += 1; away.draws += 1; home.points += pointsDraw; away.points += pointsDraw } }
  const tieBreakers = config.tieBreakers ?? ['goal_difference', 'goals_for', 'wins']
  return [...table.values()].sort((a, b) => { if (b.points !== a.points) return b.points - a.points; for (const tieBreaker of tieBreakers) { const difference = tieBreaker === 'goal_difference' ? (b.scored - b.conceded) - (a.scored - a.conceded) : tieBreaker === 'goals_for' ? b.scored - a.scored : tieBreaker === 'wins' ? b.wins - a.wins : 0; if (difference) return difference } return a.teamId.localeCompare(b.teamId) })
}

export function advanceKnockout(winners: string[], round: number): Fixture[] { return knockoutFixtures(winners).map(fixture => ({ ...fixture, round })) }

export function advanceGroupsToKnockout(groups: string[][], resultsByGroup: Result[][], qualifiersPerGroup = 1, config: StandingsConfig = {}): Fixture[] {
  const qualifiers = groups.flatMap((group, index) => calculateStandings(group, resultsByGroup[index] ?? [], config).slice(0, qualifiersPerGroup).map(row => row.teamId))
  return advanceKnockout(qualifiers, 1)
}

export async function createCompetitionPlan(client: SupabaseClient, userId: string, tournamentId: string, categoryName: string, stageName: string, format: CompetitionFormat, teamIds: string[], groupCount = 2, drawMode: 'automatic' | 'manual' = 'automatic', pairings: Array<[string, string]> = [], options: { categoryId?: string | null; qualifiersPerGroup?: number } = {}): Promise<{ fixtureCount: number; error: string | null }> {
  const plan = drawMode === 'manual' ? { groups: [], fixtures: manualFixtures(pairings), nextRoundSlots: [] } : generateFixtures(format, teamIds, groupCount); if (!plan.fixtures.length) return { fixtureCount: 0, error: 'At least two valid teams are required.' }
  // An existing category is reused so a new draw never duplicates it.
  let categoryId = options.categoryId ?? null
  if (!categoryId) { const category = await client.from('tournament_categories').insert({ tournament_id: tournamentId, name: categoryName.trim() }).select('id').single(); if (category.error || !category.data) return { fixtureCount: 0, error: category.error?.message ?? 'Category could not be created.' }; categoryId = String(category.data.id) }
  // A padded knockout bracket leaves some teams without a first-round match;
  // they are recorded as byes so the next round carries them forward.
  const playing = new Set(plan.fixtures.flatMap(fixture => [fixture.homeTeamId, fixture.awayTeamId]))
  const byes = format === 'knockout' && drawMode === 'automatic' ? [...new Set(teamIds)].filter(teamId => !playing.has(teamId)) : []
  const stage = await client.from('competition_stages').insert({ tournament_id: tournamentId, category_id: categoryId, name: stageName.trim(), format, draw_mode: drawMode, rules: { group_count: groupCount, byes, qualifiers_per_group: options.qualifiersPerGroup ?? 2 } }).select('id').single(); if (stage.error || !stage.data) return { fixtureCount: 0, error: stage.error?.message ?? 'Competition stage could not be created.' }
  const category = { data: { id: categoryId } }
  let persistedGroups: Array<{ name: string; id: string }> = []; if (plan.groups.length > 1) { const groups = await client.from('competition_groups').insert(plan.groups.map((_, index) => ({ stage_id: stage.data.id, name: `Group ${String.fromCharCode(65 + index)}` }))).select('id,name'); if (groups.error) return { fixtureCount: 0, error: groups.error.message }; persistedGroups = (groups.data ?? []) as Array<{ name: string; id: string }> }
  const groupedFixtures = attachPersistedGroupIds(plan.fixtures, persistedGroups)
  const matches = await client.from('matches').insert(groupedFixtures.map(fixture => ({ tournament_id: tournamentId, stage_id: stage.data.id, category_id: category.data.id, group_id: fixture.groupId, home_team_id: fixture.homeTeamId, away_team_id: fixture.awayTeamId, leg: fixture.leg, created_by: userId })))
  if (!matches.error) { const version = await client.from('competition_fixture_versions').insert({ stage_id: stage.data.id, version: 1, draw_mode: drawMode, fixture_payload: { fixtures: plan.fixtures, groups: plan.groups }, created_by: userId }).select('id').single(); if (version.error) return { fixtureCount: 0, error: version.error.message }; await client.from('audit_events').insert({ actor_id: userId, action: 'fixture_version_created', entity_type: 'fixture_version', entity_id: version.data.id, reason: `${drawMode} ${format} draw` }) }
  return { fixtureCount: matches.error ? 0 : plan.fixtures.length, error: matches.error?.message ?? null }
}

export async function createRoundRobinStage(client: SupabaseClient, userId: string, tournamentId: string, categoryName: string, stageName: string, teamIds: string[], doubleLeg: boolean) {
  return createCompetitionPlan(client, userId, tournamentId, categoryName, stageName, doubleLeg ? 'two_leg' : 'round_robin', teamIds)
}
