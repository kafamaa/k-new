import type { CompetitionFormat, Fixture } from './competition'

// ---------------------------------------------------------------------------
// Kulhivaru+ Tournament Engine (owner, 2026-11-03). Pure functions only: the
// engine starts with confirmed teams and ends with the archive. Storage lives in
// the existing tables (competition_stages.rules, competition_groups, matches,
// competition_fixture_versions, match_result_versions, standings_snapshots,
// audit_events); nothing here invents teams, scores or statistics.
// ---------------------------------------------------------------------------

// --- Reproducible randomness ------------------------------------------------
// A draw is random but repeatable: the seed is stored with the draw, so anyone
// reviewing the audit record can reproduce exactly the same groups.

export function hashSeed(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) { hash ^= seed.charCodeAt(index); hash = Math.imul(hash, 16777619) }
  return hash >>> 0
}

export function seededRandom(seed: string): () => number {
  let state = hashSeed(seed) || 1
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function newDrawSeed(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function seededShuffle<T>(items: T[], seed: string): T[] {
  const random = seededRandom(seed)
  const list = [...items]
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [list[index], list[swap]] = [list[swap], list[index]]
  }
  return list
}

// --- Formats ----------------------------------------------------------------

export type EngineFormat = 'round_robin' | 'double_round_robin' | 'group_stage' | 'groups_knockout' | 'knockout' | 'league_playoffs' | 'manual'
export type FormatConfig = {
  format: EngineFormat
  groupCount: number
  groupDoubleRound: boolean
  qualifiersPerGroup: number
  bestThirds: number
  knockoutLegs: 1 | 2
  awayGoals: boolean
  extraTime: boolean
  penalties: boolean
  thirdPlace: boolean
  playoffTeams: number
  leagueDoubleRound: boolean
}

export const DEFAULT_FORMAT_CONFIG: FormatConfig = {
  format: 'round_robin', groupCount: 2, groupDoubleRound: false, qualifiersPerGroup: 2, bestThirds: 0,
  knockoutLegs: 1, awayGoals: false, extraTime: true, penalties: true, thirdPlace: false, playoffTeams: 4, leagueDoubleRound: false,
}

export const ENGINE_FORMAT_LABELS: Record<EngineFormat, string> = {
  round_robin: 'League (single round robin)',
  double_round_robin: 'League, home and away (double round robin)',
  group_stage: 'Group stage only',
  groups_knockout: 'Groups, then knockout',
  knockout: 'Knockout',
  league_playoffs: 'League, then playoffs',
  manual: 'Manual pairings',
}

// The engine format, stored in the existing competition_stages.format column.
export function storedFormat(config: FormatConfig): CompetitionFormat {
  switch (config.format) {
    case 'round_robin': return 'round_robin'
    case 'double_round_robin': return 'two_leg'
    case 'group_stage': return 'group_stage'
    case 'groups_knockout': return 'groups_knockout'
    case 'knockout': return 'knockout'
    case 'league_playoffs': return config.leagueDoubleRound ? 'two_leg' : 'round_robin'
    case 'manual': return 'round_robin'
  }
}

// Stage rules written to competition_stages.rules next to points and tie-breakers.
export function stageRulesFor(config: FormatConfig): Record<string, unknown> {
  return {
    engine_format: config.format,
    group_count: config.format === 'group_stage' || config.format === 'groups_knockout' ? config.groupCount : 1,
    group_double_round: config.groupDoubleRound,
    qualifiers_per_group: config.qualifiersPerGroup,
    best_thirds: config.bestThirds,
    knockout_legs: config.knockoutLegs,
    legs: config.format === 'knockout' ? config.knockoutLegs : 1,
    away_goals: config.awayGoals,
    extra_time: config.extraTime,
    penalties: config.penalties,
    third_place: config.thirdPlace,
    playoff_teams: config.format === 'league_playoffs' ? config.playoffTeams : 0,
  }
}

export function configFromRules(rules: Record<string, unknown>): FormatConfig {
  const number = (key: string, fallback: number) => typeof rules[key] === 'number' ? rules[key] as number : fallback
  const flag = (key: string, fallback: boolean) => typeof rules[key] === 'boolean' ? rules[key] as boolean : fallback
  const format = (typeof rules.engine_format === 'string' && rules.engine_format in ENGINE_FORMAT_LABELS ? rules.engine_format : 'round_robin') as EngineFormat
  return {
    format, groupCount: number('group_count', 2), groupDoubleRound: flag('group_double_round', false), qualifiersPerGroup: number('qualifiers_per_group', 2),
    bestThirds: number('best_thirds', 0), knockoutLegs: number('knockout_legs', 1) === 2 ? 2 : 1, awayGoals: flag('away_goals', false),
    extraTime: flag('extra_time', true), penalties: flag('penalties', true), thirdPlace: flag('third_place', false), playoffTeams: number('playoff_teams', 4), leagueDoubleRound: false,
  }
}

const isPowerOfTwo = (value: number) => value >= 2 && (value & (value - 1)) === 0

export function formatProblems(config: FormatConfig, teamCount: number): string[] {
  const problems: string[] = []
  if (teamCount < 2) problems.push('At least two confirmed teams are needed.')
  if (config.format === 'group_stage' || config.format === 'groups_knockout') {
    if (config.groupCount < 2) problems.push('Choose at least two groups.')
    else if (teamCount < config.groupCount * 2) problems.push(`${config.groupCount} groups need at least ${config.groupCount * 2} teams.`)
    if (config.format === 'groups_knockout') {
      const smallest = Math.floor(teamCount / Math.max(1, config.groupCount))
      if (config.qualifiersPerGroup < 1 || config.qualifiersPerGroup >= Math.max(2, smallest)) problems.push('Qualifiers per group must be at least 1 and fewer than the teams in the smallest group.')
      if (config.bestThirds < 0 || config.bestThirds > config.groupCount) problems.push('Best third-placed qualifiers cannot be more than the number of groups.')
      if (config.bestThirds > 0 && config.qualifiersPerGroup !== 2) problems.push('Best third-placed qualifiers need exactly two direct qualifiers per group.')
      const knockoutTeams = config.groupCount * config.qualifiersPerGroup + config.bestThirds
      if (knockoutTeams < 2) problems.push('At least two teams must reach the knockout.')
    }
  }
  if (config.format === 'league_playoffs' && (config.playoffTeams < 2 || config.playoffTeams > teamCount)) problems.push('Playoff places must be between 2 and the number of teams.')
  if (config.format === 'league_playoffs' && config.playoffTeams >= 2 && !isPowerOfTwo(config.playoffTeams)) problems.push('Playoff places should be 2, 4, 8 or 16 so the bracket has no byes.')
  if (config.thirdPlace && !['knockout', 'groups_knockout', 'league_playoffs'].includes(config.format)) problems.push('A third-place match needs a knockout round.')
  if (config.awayGoals && config.knockoutLegs !== 2) problems.push('Away goals only apply to two-leg ties.')
  return problems
}

// Matches in the first stage the engine creates (later knockout rounds are
// created from confirmed results).
export function expectedMatchCount(config: FormatConfig, teamCount: number): number | null {
  if (teamCount < 2) return 0
  const single = (n: number) => (n * (n - 1)) / 2
  switch (config.format) {
    case 'round_robin': return single(teamCount)
    case 'double_round_robin': return single(teamCount) * 2
    case 'league_playoffs': return single(teamCount) * (config.leagueDoubleRound ? 2 : 1)
    case 'group_stage':
    case 'groups_knockout': {
      const sizes = groupSizesFor(teamCount, config.groupCount)
      return sizes.reduce((sum, size) => sum + single(size) * (config.groupDoubleRound ? 2 : 1), 0)
    }
    case 'knockout': {
      const size = 2 ** Math.ceil(Math.log2(teamCount))
      return (teamCount - size / 2) * config.knockoutLegs
    }
    case 'manual': return null
  }
}

export function groupSizesFor(teamCount: number, groupCount: number): number[] {
  const count = Math.max(1, Math.min(groupCount, teamCount))
  return Array.from({ length: count }, (_, index) => Math.floor(teamCount / count) + (index < teamCount % count ? 1 : 0))
}

// Matches across the whole competition, including later knockout rounds.
export function totalMatchCount(config: FormatConfig, teamCount: number): number | null {
  const first = expectedMatchCount(config, teamCount)
  if (first === null) return null
  const knockout = (teams: number) => teams < 2 ? 0 : ((teams - 1) * config.knockoutLegs - (config.knockoutLegs === 2 ? 1 : 0)) + (config.thirdPlace ? 1 : 0)
  if (config.format === 'knockout') return knockout(teamCount)
  if (config.format === 'groups_knockout') return first + knockout(Math.min(teamCount, config.groupCount * config.qualifiersPerGroup + config.bestThirds))
  if (config.format === 'league_playoffs') return first + knockout(config.playoffTeams)
  return first
}

// --- Draw -------------------------------------------------------------------

export type DrawMode = 'random' | 'seeded' | 'pots' | 'manual'
export type DrawInput = { teams: string[]; groupCount: number; seed: string; mode: Exclude<DrawMode, 'manual'>; pots?: string[][]; avoid?: Record<string, string | null> }

// Pots from a ranking: the best groupCount teams form pot 1, and so on.
export function potsFromSeeding(rankedTeams: string[], groupCount: number): string[][] {
  const pots: string[][] = []
  for (let index = 0; index < rankedTeams.length; index += groupCount) pots.push(rankedTeams.slice(index, index + groupCount))
  return pots
}

// Groups filled one pot at a time: each team goes to the smallest group that
// has no team from the same pot and, where configured, no team with the same
// constraint key (for example the same island). If no group can avoid the
// conflict, the smallest group is used and the conflict is reported.
export function drawGroups(input: DrawInput): { groups: string[][]; problems: string[] } {
  const teams = [...new Set(input.teams)]
  const count = Math.max(1, Math.min(input.groupCount, teams.length))
  const pots = input.mode === 'pots' && input.pots?.length ? input.pots.map((pot, index) => seededShuffle(pot.filter(team => teams.includes(team)), `${input.seed}:pot:${index}`))
    : input.mode === 'seeded' ? potsFromSeeding(teams, count).map((pot, index) => seededShuffle(pot, `${input.seed}:pot:${index}`))
      : potsFromSeeding(seededShuffle(teams, input.seed), count)
  const potted = new Set(pots.flat())
  const leftovers = teams.filter(team => !potted.has(team))
  if (leftovers.length) pots.push(seededShuffle(leftovers, `${input.seed}:rest`))
  const groups = Array.from({ length: count }, () => [] as string[])
  const problems: string[] = []
  const key = (team: string) => input.avoid?.[team] ?? null
  pots.forEach(pot => {
    const filled = new Set<number>()
    for (const team of pot) {
      const order = groups.map((group, index) => ({ index, size: group.length })).sort((a, b) => a.size - b.size || a.index - b.index)
      const clash = (index: number) => key(team) !== null && groups[index].some(other => key(other) === key(team))
      const choice = order.find(item => !filled.has(item.index) && !clash(item.index)) ?? order.find(item => !clash(item.index)) ?? order.find(item => !filled.has(item.index)) ?? order[0]
      if (clash(choice.index)) problems.push(`Could not keep apart two teams from ${key(team)}.`)
      groups[choice.index].push(team)
      filled.add(choice.index)
      if (filled.size === count) filled.clear()
    }
  })
  return { groups, problems: [...new Set(problems)] }
}

export function groupProblems(groups: string[][], teams: string[]): string[] {
  const problems: string[] = []
  const seen = new Map<string, number>()
  groups.flat().forEach(team => seen.set(team, (seen.get(team) ?? 0) + 1))
  const duplicates = [...seen.entries()].filter(([, times]) => times > 1).length
  const missing = teams.filter(team => !seen.has(team)).length
  const unknown = [...seen.keys()].filter(team => !teams.includes(team)).length
  if (duplicates) problems.push(`${duplicates} team${duplicates === 1 ? ' is' : 's are'} in more than one group.`)
  if (missing) problems.push(`${missing} confirmed team${missing === 1 ? ' is' : 's are'} not in any group.`)
  if (unknown) problems.push('A team that is not confirmed is in a group.')
  if (groups.some(group => group.length < 2)) problems.push('Every group needs at least two teams.')
  const sizes = groups.map(group => group.length)
  if (sizes.length && Math.max(...sizes) - Math.min(...sizes) > 1) problems.push('Group sizes differ by more than one team.')
  return problems
}

// Standard seeded bracket positions: seed 1 meets the lowest seed, and the top
// two seeds can only meet in the final. Byes go to the top seeds.
export function bracketSeedOrder(size: number): number[] {
  let order = [1]
  while (order.length < size) {
    const next = order.length * 2 + 1
    order = order.flatMap(seed => [seed, next - seed])
  }
  return order
}

export type BracketPlan = { fixtures: Fixture[]; byes: string[]; slots: Array<string | null> }

export function seededBracket(seededTeams: string[], legs: 1 | 2 = 1): BracketPlan {
  const teams = [...new Set(seededTeams)]
  if (teams.length < 2) return { fixtures: [], byes: [...teams], slots: [...teams] }
  const size = 2 ** Math.ceil(Math.log2(teams.length))
  const slots = bracketSeedOrder(size).map(seed => teams[seed - 1] ?? null)
  const fixtures: Fixture[] = []
  const byes: string[] = []
  for (let index = 0; index < slots.length; index += 2) {
    const home = slots[index]; const away = slots[index + 1]
    if (home && away) {
      fixtures.push({ homeTeamId: home, awayTeamId: away, leg: 1, round: 1 })
      if (legs === 2) fixtures.push({ homeTeamId: away, awayTeamId: home, leg: 2, round: 1 })
    } else if (home || away) byes.push((home ?? away)!)
  }
  return { fixtures, byes, slots }
}

// Manual pairings: any number of rounds, never a team against itself, never the
// same pairing twice in one leg, never a team twice in one round, confirmed teams only.
export type ManualPairing = { homeTeamId: string; awayTeamId: string; round: number; leg?: 1 | 2 }
export function pairingProblems(pairings: ManualPairing[], teams: string[]): string[] {
  const problems: string[] = []
  const pairs = new Set<string>()
  const perRound = new Map<number, Set<string>>()
  for (const pairing of pairings) {
    if (!pairing.homeTeamId || !pairing.awayTeamId) { problems.push('A pairing is missing a team.'); continue }
    if (pairing.homeTeamId === pairing.awayTeamId) problems.push('A team cannot play itself.')
    if (![pairing.homeTeamId, pairing.awayTeamId].every(team => teams.includes(team))) problems.push('Only confirmed teams can be paired.')
    const key = `${[pairing.homeTeamId, pairing.awayTeamId].sort().join('|')}|${pairing.leg ?? 1}`
    if (pairs.has(key)) problems.push('The same pairing appears twice.')
    pairs.add(key)
    const round = perRound.get(pairing.round) ?? new Set<string>()
    for (const team of [pairing.homeTeamId, pairing.awayTeamId]) { if (round.has(team)) problems.push(`A team appears twice in round ${pairing.round}.`); round.add(team) }
    perRound.set(pairing.round, round)
  }
  return [...new Set(problems)]
}

// --- Fixtures ---------------------------------------------------------------

// Circle method: every team meets every other once per round robin, an odd
// count gives each team one bye per cycle, and home/away is balanced so no team
// has more than one extra home or away match. The second cycle mirrors the first.
export function balancedRoundRobin(teamIds: string[], doubleRound = false, group?: string): Fixture[] {
  const teams = [...new Set(teamIds)]
  if (teams.length < 2) return []
  const slots: Array<string | null> = teams.length % 2 ? [...teams, null] : [...teams]
  const rounds = slots.length - 1
  const half = slots.length / 2
  const home = new Map(teams.map(team => [team, 0]))
  const lastHome = new Map<string, boolean>()
  const fixtures: Fixture[] = []
  let rotation = [...slots]
  for (let round = 0; round < rounds; round += 1) {
    for (let index = 0; index < half; index += 1) {
      const a = rotation[index]; const b = rotation[rotation.length - 1 - index]
      if (!a || !b) continue
      const aHome = home.get(a)! - (fixtures.filter(item => item.awayTeamId === a).length)
      const bHome = home.get(b)! - (fixtures.filter(item => item.awayTeamId === b).length)
      const aFirst = aHome < bHome || (aHome === bHome && (lastHome.get(a) === false || (lastHome.get(a) === undefined && lastHome.get(b) !== false && (round + index) % 2 === 0)))
      const [h, w] = aFirst ? [a, b] : [b, a]
      home.set(h, home.get(h)! + 1)
      lastHome.set(h, true); lastHome.set(w, false)
      fixtures.push({ homeTeamId: h, awayTeamId: w, leg: 1, round: round + 1, ...(group ? { group } : {}) })
    }
    rotation = [rotation[0], rotation[rotation.length - 1], ...rotation.slice(1, -1)]
  }
  if (!doubleRound) return fixtures
  return [...fixtures, ...fixtures.map(fixture => ({ ...fixture, homeTeamId: fixture.awayTeamId, awayTeamId: fixture.homeTeamId, leg: 2 as const, round: (fixture.round ?? 1) + rounds }))]
}

export function homeAwayBalance(fixtures: Array<Pick<Fixture, 'homeTeamId' | 'awayTeamId'>>): Map<string, number> {
  const balance = new Map<string, number>()
  for (const fixture of fixtures) {
    balance.set(fixture.homeTeamId, (balance.get(fixture.homeTeamId) ?? 0) + 1)
    balance.set(fixture.awayTeamId, (balance.get(fixture.awayTeamId) ?? 0) - 1)
  }
  return balance
}

export type EnginePlan = { groups: string[][]; fixtures: Fixture[]; byes: string[]; expected: number | null }

// The first stage's fixtures from a confirmed draw.
export function planFixtures(config: FormatConfig, teams: string[], groups: string[][] | null, pairings: ManualPairing[] = []): EnginePlan {
  switch (config.format) {
    case 'round_robin': return { groups: [teams], fixtures: balancedRoundRobin(teams), byes: [], expected: expectedMatchCount(config, teams.length) }
    case 'double_round_robin': return { groups: [teams], fixtures: balancedRoundRobin(teams, true), byes: [], expected: expectedMatchCount(config, teams.length) }
    case 'league_playoffs': return { groups: [teams], fixtures: balancedRoundRobin(teams, config.leagueDoubleRound), byes: [], expected: expectedMatchCount(config, teams.length) }
    case 'group_stage':
    case 'groups_knockout': {
      const list = groups ?? []
      return { groups: list, fixtures: list.flatMap((group, index) => balancedRoundRobin(group, config.groupDoubleRound, groupName(index))), byes: [], expected: expectedMatchCount(config, teams.length) }
    }
    case 'knockout': {
      const bracket = seededBracket(teams, config.knockoutLegs)
      return { groups: [], fixtures: bracket.fixtures, byes: bracket.byes, expected: expectedMatchCount(config, teams.length) }
    }
    case 'manual': return { groups: [teams], fixtures: pairings.map(pairing => ({ homeTeamId: pairing.homeTeamId, awayTeamId: pairing.awayTeamId, leg: pairing.leg ?? 1, round: pairing.round })), byes: [], expected: null }
  }
}

export const groupName = (index: number) => `Group ${String.fromCharCode(65 + index)}`

export type ScheduledFixture = Fixture & { scheduledAt?: string | null; venue?: string | null }

// Every check the engine runs before fixtures are saved or published.
export function fixtureProblems(fixtures: ScheduledFixture[], options: { teams: string[]; expected?: number | null; restHours?: number; matchMinutes?: number; checkBalance?: boolean; requireSchedule?: boolean }): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const fixture of fixtures) {
    if (fixture.homeTeamId === fixture.awayTeamId) problems.push('A team is drawn against itself.')
    if (![fixture.homeTeamId, fixture.awayTeamId].every(team => options.teams.includes(team))) problems.push('A fixture includes a team that is not confirmed.')
    const key = `${fixture.group ?? ''}|${fixture.leg}|${[fixture.homeTeamId, fixture.awayTeamId].sort().join('|')}`
    if (seen.has(key)) problems.push('The same fixture appears twice.')
    seen.add(key)
  }
  const playing = new Set(fixtures.flatMap(fixture => [fixture.homeTeamId, fixture.awayTeamId]))
  const absent = options.teams.filter(team => !playing.has(team))
  if (options.expected !== undefined && options.expected !== null && fixtures.length !== options.expected) problems.push(`Expected ${options.expected} fixtures but found ${fixtures.length}.`)
  if (absent.length && options.expected !== undefined && options.expected !== null && options.expected > 0) {
    // Knockout byes are expected; the caller passes the teams that should play.
    problems.push(`${absent.length} confirmed team${absent.length === 1 ? ' has' : 's have'} no fixture.`)
  }
  if (options.checkBalance) {
    const worst = Math.max(0, ...[...homeAwayBalance(fixtures).values()].map(Math.abs))
    if (worst > 1) problems.push('Home and away matches are not balanced.')
  }
  const minutes = (options.matchMinutes ?? 90) * 60_000
  const rest = (options.restHours ?? 0) * 3_600_000
  const timed = fixtures.filter(fixture => fixture.scheduledAt).map(fixture => ({ ...fixture, at: Date.parse(fixture.scheduledAt!) })).sort((a, b) => a.at - b.at)
  if (options.requireSchedule && timed.length !== fixtures.length) problems.push(`${fixtures.length - timed.length} fixture${fixtures.length - timed.length === 1 ? ' has' : 's have'} no date and time.`)
  for (let index = 0; index < timed.length; index += 1) {
    for (let other = index + 1; other < timed.length && timed[other].at - timed[index].at < Math.max(minutes, rest); other += 1) {
      const a = timed[index]; const b = timed[other]
      const shared = [a.homeTeamId, a.awayTeamId].some(team => [b.homeTeamId, b.awayTeamId].includes(team))
      if (shared && b.at - a.at < minutes) problems.push('A team has two matches at the same time.')
      else if (shared && b.at - a.at < rest) problems.push(`A team has less than ${options.restHours} hours of rest between matches.`)
      if (a.venue && a.venue === b.venue && b.at - a.at < minutes) problems.push(`${a.venue} has two matches at the same time.`)
    }
  }
  return [...new Set(problems)]
}

// Match numbers in playing order, so a printed schedule and the bracket agree.
export function numberFixtures<T extends ScheduledFixture>(fixtures: T[]): Array<T & { matchNumber: number }> {
  return [...fixtures]
    .map((fixture, index) => ({ fixture, index }))
    .sort((a, b) => (a.fixture.scheduledAt ? Date.parse(a.fixture.scheduledAt) : Infinity) - (b.fixture.scheduledAt ? Date.parse(b.fixture.scheduledAt) : Infinity) || (a.fixture.round ?? 0) - (b.fixture.round ?? 0) || a.index - b.index)
    .map((item, position) => ({ ...item.fixture, matchNumber: position + 1 }))
}

// --- Results and ties ---------------------------------------------------------

// A score as stored in match_result_versions.score. home/away include extra
// time when it was played; shootout fields only decide a level knockout tie.
export type EngineScore = { home: number; away: number; extraTime?: boolean; homeShootout?: number; awayShootout?: number; outcome?: string }
export type TieLeg = { homeTeamId: string | null; awayTeamId: string | null; status: string; leg: number; score: EngineScore | null }
export type TieOutcome = { winner: string | null; loser: string | null; aggregate: Record<string, number>; decidedBy: 'score' | 'aggregate' | 'away_goals' | 'extra_time' | 'penalties' | null; problem: string | null }

export function tieOutcome(legs: TieLeg[], options: { awayGoals?: boolean } = {}): TieOutcome {
  const empty = { winner: null, loser: null, aggregate: {}, decidedBy: null }
  const played = [...legs].sort((a, b) => a.leg - b.leg)
  if (!played.length) return { ...empty, problem: 'No match in this tie.' }
  if (played.some(leg => leg.status !== 'confirmed')) return { ...empty, problem: 'The tie still has a match without a confirmed result.' }
  if (played.some(leg => !leg.homeTeamId || !leg.awayTeamId)) return { ...empty, problem: 'A match in the tie is missing a team.' }
  if (played.some(leg => !leg.score)) return { ...empty, problem: 'A confirmed result has no readable score.' }
  const teams = [played[0].homeTeamId!, played[0].awayTeamId!]
  const aggregate: Record<string, number> = { [teams[0]]: 0, [teams[1]]: 0 }
  const awayGoals: Record<string, number> = { [teams[0]]: 0, [teams[1]]: 0 }
  for (const leg of played) {
    aggregate[leg.homeTeamId!] += leg.score!.home; aggregate[leg.awayTeamId!] += leg.score!.away
    awayGoals[leg.awayTeamId!] += leg.score!.away
  }
  const decide = (winner: string, decidedBy: TieOutcome['decidedBy']): TieOutcome => ({ winner, loser: teams.find(team => team !== winner)!, aggregate, decidedBy, problem: null })
  const last = played[played.length - 1]
  const extra = last.score!.extraTime === true
  if (aggregate[teams[0]] !== aggregate[teams[1]]) return decide(aggregate[teams[0]] > aggregate[teams[1]] ? teams[0] : teams[1], extra ? 'extra_time' : played.length > 1 ? 'aggregate' : 'score')
  if (options.awayGoals && played.length > 1 && awayGoals[teams[0]] !== awayGoals[teams[1]]) return decide(awayGoals[teams[0]] > awayGoals[teams[1]] ? teams[0] : teams[1], 'away_goals')
  const { homeShootout, awayShootout } = last.score!
  if (typeof homeShootout === 'number' && typeof awayShootout === 'number' && homeShootout !== awayShootout) return decide(homeShootout > awayShootout ? last.homeTeamId! : last.awayTeamId!, 'penalties')
  return { winner: null, loser: null, aggregate, decidedBy: null, problem: 'The tie is level with no penalty shootout result. Correct the last match with the shootout score.' }
}

// Knockout matches grouped into ties (one match, or two legs between the same teams).
export function groupTies<T extends TieLeg>(matches: T[]): T[][] {
  const ties = new Map<string, T[]>()
  for (const match of matches) {
    const key = [match.homeTeamId ?? '?', match.awayTeamId ?? '?'].sort().join('|')
    ties.set(key, [...(ties.get(key) ?? []), match])
  }
  return [...ties.values()]
}

// --- Standings ----------------------------------------------------------------

export type TieBreakerKey = 'head_to_head_points' | 'head_to_head_difference' | 'head_to_head_scored' | 'goal_difference' | 'goals_scored' | 'wins' | 'fair_play' | 'playoff' | 'manual'
export const TIEBREAKER_LABELS: Record<TieBreakerKey, string> = {
  head_to_head_points: 'Head-to-head points', head_to_head_difference: 'Head-to-head goal difference', head_to_head_scored: 'Head-to-head goals scored',
  goal_difference: 'Overall goal difference', goals_scored: 'Goals scored', wins: 'Wins', fair_play: 'Fair play (fewest card points)', playoff: 'Playoff match', manual: 'Manual decision',
}
export const DEFAULT_TIEBREAKERS: TieBreakerKey[] = ['head_to_head_points', 'head_to_head_difference', 'goal_difference', 'goals_scored', 'wins', 'fair_play', 'playoff', 'manual']
// Older stages stored these names (Format & draw page, migration 036).
const LEGACY_TIEBREAKERS: Record<string, TieBreakerKey> = { head_to_head: 'head_to_head_points', goals_for: 'goals_scored', goals_scored: 'goals_scored', goal_difference: 'goal_difference', wins: 'wins' }
export function normalizeTiebreakers(value: unknown): TieBreakerKey[] {
  if (!Array.isArray(value) || !value.length) return DEFAULT_TIEBREAKERS
  const list = value.map(item => (String(item) in TIEBREAKER_LABELS ? String(item) as TieBreakerKey : LEGACY_TIEBREAKERS[String(item)])).filter((item): item is TieBreakerKey => Boolean(item))
  return [...new Set(list)]
}

export type EngineResult = { homeTeamId: string; awayTeamId: string; homeScore: number; awayScore: number }
export type TableRow = { teamId: string; played: number; wins: number; draws: number; losses: number; scored: number; conceded: number; points: number; fairPlay: number | null }
export type RankedRow = TableRow & { position: number; difference: number; decidedBy: TieBreakerKey | 'points' | null; unresolved: boolean }
export type PointsRules = { win: number; draw: number; loss: number }

// Only confirmed results reach this function; the caller filters by status.
export function computeTable(teams: string[], results: EngineResult[], points: PointsRules = { win: 3, draw: 1, loss: 0 }, extras: { fairPlay?: Map<string, number>; adjustments?: Map<string, number> } = {}): TableRow[] {
  const table = new Map(teams.map(team => [team, { teamId: team, played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0, points: extras.adjustments?.get(team) ?? 0, fairPlay: extras.fairPlay ? extras.fairPlay.get(team) ?? 0 : null }]))
  for (const result of results) {
    const home = table.get(result.homeTeamId); const away = table.get(result.awayTeamId)
    if (!home || !away) continue
    home.played += 1; away.played += 1
    home.scored += result.homeScore; home.conceded += result.awayScore
    away.scored += result.awayScore; away.conceded += result.homeScore
    if (result.homeScore > result.awayScore) { home.wins += 1; away.losses += 1; home.points += points.win; away.points += points.loss }
    else if (result.homeScore < result.awayScore) { away.wins += 1; home.losses += 1; away.points += points.win; home.points += points.loss }
    else { home.draws += 1; away.draws += 1; home.points += points.draw; away.points += points.draw }
  }
  return [...table.values()]
}

// Deterministic ranking in the configured order. Head-to-head criteria use only
// the matches between the tied teams. A tie that no criterion separates keeps a
// stable order and is marked unresolved, so the organizer decides it by a
// playoff or a recorded manual decision (manualOrder), never silently.
export function rankTable(rows: TableRow[], results: EngineResult[], tieBreakers: TieBreakerKey[] = DEFAULT_TIEBREAKERS, options: { points?: PointsRules; manualOrder?: string[]; playoffOrder?: string[] } = {}): RankedRow[] {
  const points = options.points ?? { win: 3, draw: 1, loss: 0 }
  const value = (key: TieBreakerKey, row: TableRow, tied: string[]): number | null => {
    if (key === 'goal_difference') return row.scored - row.conceded
    if (key === 'goals_scored') return row.scored
    if (key === 'wins') return row.wins
    if (key === 'fair_play') return row.fairPlay === null ? null : -row.fairPlay
    if (key === 'manual' || key === 'playoff') {
      const order = key === 'manual' ? options.manualOrder : options.playoffOrder
      const index = order?.indexOf(row.teamId) ?? -1
      return index < 0 ? null : -index
    }
    const mini = computeTable(tied, results.filter(result => tied.includes(result.homeTeamId) && tied.includes(result.awayTeamId)), points).find(item => item.teamId === row.teamId)!
    if (key === 'head_to_head_points') return mini.points
    if (key === 'head_to_head_difference') return mini.scored - mini.conceded
    return mini.scored
  }
  type Placed = { row: TableRow; decidedBy: TieBreakerKey | 'points' | null; unresolved: boolean }
  const resolve = (group: TableRow[], keys: TieBreakerKey[]): Placed[] => {
    if (group.length === 1) return [{ row: group[0], decidedBy: null, unresolved: false }]
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]
      const tied = group.map(row => row.teamId)
      const scored = group.map(row => ({ row, score: value(key, row, tied) }))
      if (scored.some(item => item.score === null)) continue
      const distinct = new Set(scored.map(item => item.score))
      if (distinct.size === 1) continue
      const buckets = [...distinct].sort((a, b) => (b as number) - (a as number)).map(score => scored.filter(item => item.score === score).map(item => item.row))
      return buckets.flatMap(bucket => bucket.length === 1 ? [{ row: bucket[0], decidedBy: key, unresolved: false }] : resolve(bucket, keys.slice(index + 1)))
    }
    return [...group].sort((a, b) => a.teamId.localeCompare(b.teamId)).map(row => ({ row, decidedBy: null, unresolved: true }))
  }
  const byPoints = new Map<number, TableRow[]>()
  for (const row of rows) byPoints.set(row.points, [...(byPoints.get(row.points) ?? []), row])
  const ordered = [...byPoints.keys()].sort((a, b) => b - a).flatMap(score => {
    const group = byPoints.get(score)!
    return group.length === 1 ? [{ row: group[0], decidedBy: 'points' as const, unresolved: false }] : resolve(group, tieBreakers)
  })
  return ordered.map((item, index) => ({ ...item.row, position: index + 1, difference: item.row.scored - item.row.conceded, decidedBy: item.decidedBy, unresolved: item.unresolved }))
}

export type Qualification = 'qualified' | 'best_third' | 'playoff' | 'eliminated' | null
export function qualificationFor(position: number, config: Pick<FormatConfig, 'format' | 'qualifiersPerGroup' | 'bestThirds' | 'playoffTeams'>, bestThirdQualified = false): Qualification {
  if (config.format === 'groups_knockout') return position <= config.qualifiersPerGroup ? 'qualified' : position === 3 && config.bestThirds > 0 ? (bestThirdQualified ? 'best_third' : 'eliminated') : 'eliminated'
  if (config.format === 'league_playoffs') return position <= config.playoffTeams ? 'playoff' : 'eliminated'
  return null
}

// Best third-placed teams across groups, compared on points, goal difference,
// goals scored and wins (head-to-head cannot apply between groups).
export function bestThirdPlaced(groupTables: RankedRow[][], count: number): string[] {
  return groupTables.map(table => table[2]).filter((row): row is RankedRow => Boolean(row))
    .sort((a, b) => b.points - a.points || b.difference - a.difference || b.scored - a.scored || b.wins - a.wins || a.teamId.localeCompare(b.teamId))
    .slice(0, count).map(row => row.teamId)
}

// Knockout seeding from group tables: group winners first, then runners-up, then
// best thirds, so a winner meets another group's runner-up (A1 v B2, B1 v A2…).
export function knockoutSeedingFromGroups(groupTables: RankedRow[][], qualifiers: number, thirds: string[]): string[] {
  const seeded: string[] = []
  for (let place = 0; place < qualifiers; place += 1) {
    const row = groupTables.map(table => table[place]?.teamId).filter((team): team is string => Boolean(team))
    seeded.push(...(place % 2 ? row.slice(1).concat(row.slice(0, 1)) : row))
  }
  return [...seeded, ...thirds]
}

// --- Match lifecycle ----------------------------------------------------------

export type MatchState = 'draft' | 'scheduled' | 'live' | 'half_time' | 'finished' | 'under_review' | 'official' | 'postponed' | 'cancelled' | 'walkover' | 'abandoned'
export const MATCH_STATE_LABELS: Record<MatchState, string> = {
  draft: 'Draft', scheduled: 'Scheduled', live: 'Live', half_time: 'Half-time', finished: 'Finished', under_review: 'Under review', official: 'Official',
  postponed: 'Postponed', cancelled: 'Cancelled', walkover: 'Walkover', abandoned: 'Abandoned',
}
export const MATCH_TRANSITIONS: Record<MatchState, MatchState[]> = {
  draft: ['scheduled', 'cancelled'],
  scheduled: ['live', 'postponed', 'cancelled', 'walkover', 'under_review'],
  live: ['half_time', 'finished', 'abandoned', 'scheduled'],
  half_time: ['live', 'finished', 'abandoned'],
  finished: ['under_review', 'live'],
  under_review: ['official', 'scheduled'],
  official: ['official'],
  postponed: ['scheduled', 'cancelled'],
  cancelled: [],
  walkover: ['under_review', 'official'],
  abandoned: ['scheduled', 'under_review'],
}
export const canTransition = (from: MatchState, to: MatchState) => MATCH_TRANSITIONS[from].includes(to)

// The state shown for a stored match. matches.status keeps the database values;
// live_phase (migration 045) adds half-time and finished; a walkover is a
// result outcome; an unpublished stage is still a draft.
export function matchState(match: { status: string; live_phase?: string | null }, options: { stagePublished?: boolean; outcome?: string | null } = {}): MatchState {
  if (match.status === 'confirmed') return 'official'
  if (match.status === 'awaiting_confirmation') return options.outcome === 'walkover' ? 'walkover' : 'under_review'
  if (match.status === 'live') return match.live_phase === 'half_time' ? 'half_time' : match.live_phase === 'finished' ? 'finished' : 'live'
  if (match.status === 'scheduled') return options.stagePublished === false ? 'draft' : 'scheduled'
  if (match.status === 'postponed' || match.status === 'cancelled' || match.status === 'abandoned') return match.status
  return 'scheduled'
}

// --- Progression conflicts ----------------------------------------------------

export type ConflictMatch = { id: string; stageId: string; homeTeamId: string | null; awayTeamId: string | null; status: string }
export type ProgressionConflict = { stageId: string; matchId: string; unexpected: string[]; missing: string[]; played: boolean }

// A later round is in conflict when a confirmed correction changed who should be
// in it. Matches holding a team that no longer qualifies are listed; nothing is
// replaced here. A played (confirmed) match cannot be fixed by replacement.
export function progressionConflicts(laterStageMatches: ConflictMatch[], expectedTeams: string[]): ProgressionConflict[] {
  const present = new Set(laterStageMatches.filter(match => match.status !== 'cancelled').flatMap(match => [match.homeTeamId, match.awayTeamId]).filter((team): team is string => Boolean(team)))
  const missing = expectedTeams.filter(team => !present.has(team))
  return laterStageMatches.filter(match => match.status !== 'cancelled').flatMap(match => {
    const unexpected = [match.homeTeamId, match.awayTeamId].filter((team): team is string => Boolean(team) && !expectedTeams.includes(team!))
    return unexpected.length ? [{ stageId: match.stageId, matchId: match.id, unexpected, missing, played: match.status === 'confirmed' }] : []
  })
}

// The same checks, pinned to the fixture they concern, each with a suggested
// fix, so the Preview can highlight the exact card (owner, 2026-11-03).
export function fixtureIssues(fixtures: ScheduledFixture[], options: { restHours?: number; matchMinutes?: number } = {}): Map<number, string[]> {
  const issues = new Map<number, string[]>()
  const add = (index: number, text: string) => issues.set(index, [...new Set([...(issues.get(index) ?? []), text])])
  const minutes = (options.matchMinutes ?? 90) * 60_000
  const rest = (options.restHours ?? 0) * 3_600_000
  const timed = fixtures.map((fixture, index) => ({ fixture, index, at: fixture.scheduledAt ? Date.parse(fixture.scheduledAt) : null }))
  for (const { fixture, index, at } of timed) {
    if (fixture.homeTeamId === fixture.awayTeamId) add(index, 'A team is drawn against itself. Edit the teams.')
    if (at === null) add(index, 'No date and time yet. Choose one.')
  }
  const ordered = timed.filter(item => item.at !== null).sort((a, b) => a.at! - b.at!)
  for (let first = 0; first < ordered.length; first += 1) {
    for (let second = first + 1; second < ordered.length && ordered[second].at! - ordered[first].at! < Math.max(minutes, rest); second += 1) {
      const a = ordered[first]; const b = ordered[second]
      const shared = [a.fixture.homeTeamId, a.fixture.awayTeamId].some(team => [b.fixture.homeTeamId, b.fixture.awayTeamId].includes(team))
      if (shared && b.at! - a.at! < minutes) { add(a.index, 'A team plays twice at the same time. Move one match to another time.'); add(b.index, 'A team plays twice at the same time. Move one match to another time.') }
      else if (shared && b.at! - a.at! < rest) add(b.index, `Less than ${options.restHours} hours of rest for a team. Move it later.`)
      if (a.fixture.venue && a.fixture.venue === b.fixture.venue && b.at! - a.at! < minutes) { add(a.index, `${a.fixture.venue} has two matches at once. Change the time or venue.`); add(b.index, `${b.fixture.venue} has two matches at once. Change the time or venue.`) }
    }
  }
  return issues
}
