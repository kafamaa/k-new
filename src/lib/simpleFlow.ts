import { generateFixtures, type CompetitionFormat } from './competition'
import type { OrganizerTab, TournamentEntry, TournamentMatch, TournamentStatus } from './organizer'

// ---------------------------------------------------------------------------
// The organizer's five simple steps: Create → Teams → Schedule → Play → Finish.
// Pure helpers only. The words an organizer sees here are deliberately plain;
// the categories, stages, fixture versions and roster versions behind them are
// created by the existing engine and stay out of sight unless someone opens
// "More details" or "Advanced options".
// ---------------------------------------------------------------------------

export const FLOW_STEPS = [
  { id: 'create', label: 'Create', tab: 'overview' },
  { id: 'teams', label: 'Teams', tab: 'teams' },
  { id: 'schedule', label: 'Schedule', tab: 'fixtures' },
  { id: 'play', label: 'Play', tab: 'matches' },
  { id: 'finish', label: 'Finish', tab: 'completion' },
] as const satisfies ReadonlyArray<{ id: string; label: string; tab: OrganizerTab }>
export type FlowStepId = (typeof FLOW_STEPS)[number]['id']
export type FlowStepState = 'done' | 'current' | 'upcoming'

const PAST_TEAMS: TournamentStatus[] = ['registration_closed', 'in_progress', 'completed', 'archived']
const FINISHED: TournamentStatus[] = ['completed', 'archived']
const OPEN_MATCH = ['scheduled', 'live', 'awaiting_confirmation', 'postponed']
const activeMatches = (matches: TournamentMatch[]) => matches.filter(match => !['cancelled', 'abandoned'].includes(match.status))

// conflicts: later-round matches a correction left holding the wrong team (bracket check).
export type FlowInput = { status: TournamentStatus; isPublished: boolean; entries: TournamentEntry[]; matches: TournamentMatch[]; conflicts?: number }

export function flowDone(input: FlowInput): Record<FlowStepId, boolean> {
  const active = activeMatches(input.matches)
  const finished = FINISHED.includes(input.status)
  const teams = finished || PAST_TEAMS.includes(input.status) || input.matches.length > 0
  const schedule = finished || (active.length > 0 && active.every(match => match.scheduled_at) && input.isPublished && ['in_progress'].includes(input.status))
  const play = finished || (schedule && active.every(match => !OPEN_MATCH.includes(match.status)))
  return { create: true, teams, schedule, play, finish: finished }
}

export function flowSteps(input: FlowInput): Array<{ id: FlowStepId; label: string; tab: OrganizerTab; state: FlowStepState }> {
  const done = flowDone(input)
  const current = FLOW_STEPS.find(step => !done[step.id])?.id ?? null
  return FLOW_STEPS.map(step => ({ ...step, state: done[step.id] ? 'done' : step.id === current ? 'current' : 'upcoming' }))
}

export function currentFlowStep(input: FlowInput): FlowStepId | null {
  return flowSteps(input).find(step => step.state === 'current')?.id ?? null
}

// One next action, in plain words, for the tournament home.
export type SimpleAction = { label: string; reason: string; tab: OrganizerTab; matchId?: string | null; publicPage?: boolean }

export function simpleNextAction(input: FlowInput, now = Date.now()): SimpleAction {
  const step = currentFlowStep(input)
  const approved = input.entries.filter(entry => entry.application_status === 'approved').length
  const waiting = input.entries.filter(entry => ['submitted', 'under_review', 'changes_requested'].includes(entry.application_status)).length
  const active = activeMatches(input.matches)
  // A bracket conflict after a correction comes before anything else that can move forward.
  if (input.conflicts && input.conflicts > 0) return { label: 'Fix the bracket', reason: `A corrected result changed who qualified. ${input.conflicts} later match${input.conflicts === 1 ? ' needs' : 'es need'} your decision.`, tab: 'standings' }
  if (step === 'teams') {
    if (waiting > 0) return { label: 'Check team applications', reason: `${waiting} team${waiting === 1 ? ' is' : 's are'} waiting for your decision.`, tab: 'teams' }
    const rosters = input.entries.filter(entry => entry.application_status === 'approved' && ['submitted', 'under_review'].includes(entry.roster_status)).length
    if (rosters > 0) return { label: 'Review squad lists', reason: `${rosters} squad list${rosters === 1 ? ' is' : 's are'} waiting for approval.`, tab: 'teams' }
    if (approved < 2) return { label: 'Add teams', reason: approved === 0 ? 'Add the teams that will play, or share the registration link.' : 'Add at least one more team.', tab: 'teams' }
    return { label: 'Confirm teams', reason: `${approved} teams are in. Confirm them to make the schedule.`, tab: 'teams' }
  }
  if (step === 'schedule') {
    if (active.length === 0) return { label: 'Make the schedule', reason: `${approved} teams confirmed. Use the recommended format to create every match.`, tab: 'fixtures' }
    const unscheduled = active.filter(match => !match.scheduled_at).length
    if (unscheduled > 0) return { label: 'Set match times', reason: `${unscheduled} match${unscheduled === 1 ? '' : 'es'} still need a date and time.`, tab: 'fixtures' }
    return { label: 'Publish schedule', reason: 'Every match has a date, time and venue. Publish it so teams and fans can see it.', tab: 'fixtures' }
  }
  if (step === 'play') {
    const awaiting = active.find(match => match.status === 'awaiting_confirmation')
    if (awaiting) return { label: 'Confirm result', reason: `${teamsLabel(awaiting)}: a result is waiting for confirmation.`, tab: 'matches', matchId: awaiting.id }
    const live = active.find(match => match.status === 'live')
    if (live) return { label: 'Enter the result', reason: `${teamsLabel(live)} is being played. Record the score when it ends.`, tab: 'matches', matchId: live.id }
    const next = nextMatch(input.matches, now)
    if (next) return { label: 'Open next match', reason: `${teamsLabel(next)}${next.scheduled_at ? ` · ${matchWhen(next.scheduled_at, now)}` : ''}${next.venue ? ` · ${next.venue}` : ''}`, tab: 'matches', matchId: next.id }
    return { label: 'Check the matches', reason: 'Some matches are postponed. Give them a new date.', tab: 'fixtures' }
  }
  if (step === 'finish') return { label: 'Finish tournament', reason: 'Every match is complete. Check the final details and publish the archive.', tab: 'completion' }
  return { label: 'View the archive', reason: 'This tournament is finished and kept as a permanent record.', tab: 'overview', publicPage: true }
}

export function teamsLabel(match: TournamentMatch): string {
  return `${match.home_team_name ?? 'To be decided'} vs ${match.away_team_name ?? 'To be decided'}`
}

// "Today · 20:00", "Tomorrow · 18:00", "Sat 9 Nov · 16:00" in Maldives time.
export function matchWhen(iso: string, now = Date.now()): string {
  const day = (value: number) => new Date(value).toLocaleDateString('en-CA', { timeZone: 'Indian/Maldives' })
  const at = Date.parse(iso)
  const time = new Date(at).toLocaleTimeString('en-GB', { timeZone: 'Indian/Maldives', hour: '2-digit', minute: '2-digit' })
  if (day(at) === day(now)) return `Today · ${time}`
  if (day(at) === day(now + 86_400_000)) return `Tomorrow · ${time}`
  return `${new Date(at).toLocaleDateString('en-GB', { timeZone: 'Indian/Maldives', weekday: 'short', day: 'numeric', month: 'short' })} · ${time}`
}

// A live match first, then the earliest scheduled one (a match that started
// up to three hours ago still counts), then an undated one.
export function nextMatch(matches: TournamentMatch[], now = Date.now()): TournamentMatch | null {
  const live = matches.find(match => match.status === 'live')
  if (live) return live
  const scheduled = matches.filter(match => match.status === 'scheduled')
  const dated = scheduled.filter(match => match.scheduled_at).sort((a, b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!))
  return dated.find(match => Date.parse(match.scheduled_at!) >= now - 3 * 3_600_000) ?? dated[0] ?? scheduled[0] ?? null
}

// Home cards: four at most.
export function homeCards(entries: TournamentEntry[], matches: TournamentMatch[]) {
  const active = activeMatches(matches)
  const attention = entries.filter(entry => ['submitted', 'under_review', 'changes_requested'].includes(entry.application_status)).length
    + entries.filter(entry => ['submitted', 'under_review'].includes(entry.roster_status)).length
    + entries.filter(entry => ['proof_submitted', 'under_review'].includes(entry.payment_status)).length
    + active.filter(match => match.status === 'awaiting_confirmation').length
  return [
    { key: 'teams', label: 'Teams', value: entries.filter(entry => entry.application_status === 'approved').length, tab: 'teams' as OrganizerTab },
    { key: 'matches', label: 'Matches', value: active.length, tab: 'fixtures' as OrganizerTab },
    { key: 'completed', label: 'Completed', value: active.filter(match => match.status === 'confirmed').length, tab: 'matches' as OrganizerTab },
    { key: 'attention', label: 'Needs Attention', value: attention, tab: 'teams' as OrganizerTab },
  ]
}

// --- Teams --------------------------------------------------------------------

export type TeamReadiness = 'ready' | 'needs_players' | 'needs_payment' | 'needs_review'
export const TEAM_READINESS_LABELS: Record<TeamReadiness, string> = { ready: 'Ready', needs_players: 'Needs players', needs_payment: 'Needs payment', needs_review: 'Needs review' }

export function teamReadiness(entry: TournamentEntry, players: number | null, minimum: number | null): TeamReadiness {
  if (['submitted', 'under_review', 'changes_requested', 'waitlisted', 'draft'].includes(entry.application_status)) return 'needs_review'
  if (['unpaid', 'overdue', 'proof_submitted', 'under_review', 'rejected'].includes(entry.payment_status)) return 'needs_payment'
  if (['submitted', 'under_review'].includes(entry.roster_status)) return 'needs_review'
  if (players !== null && players < Math.max(1, minimum ?? 1)) return 'needs_players'
  return 'ready'
}

// The Payment column appears only when some team has something to pay.
export function chargesFee(entries: TournamentEntry[]): boolean {
  return entries.some(entry => entry.payment_status !== 'not_required')
}

// Teams in the simple list: the ones still playing a part (not rejected or withdrawn).
export function listedEntries(entries: TournamentEntry[]): TournamentEntry[] {
  return entries.filter(entry => !['rejected', 'withdrawn'].includes(entry.application_status))
}

// --- Schedule -------------------------------------------------------------------

export type FormatPlan = { format: CompetitionFormat; groupCount: number; qualifiers: number; summary: string }

const KNOCKOUT_AFTER: Record<number, string> = { 2: 'semi-finals and final', 4: 'quarter-finals, semi-finals and final', 8: 'round of 16, quarter-finals, semi-finals and final' }

export function groupSizes(teamCount: number, groupCount: number): string {
  const small = Math.floor(teamCount / groupCount); const large = Math.ceil(teamCount / groupCount)
  return small === large ? `${groupCount} groups of ${small}` : `${groupCount} groups of ${small}–${large}`
}

// The recommendation the organizer can accept with one click.
export function recommendFormat(teamCount: number): FormatPlan | null {
  if (teamCount < 2) return null
  if (teamCount === 2) return { format: 'knockout', groupCount: 1, qualifiers: 1, summary: 'One final between the two teams.' }
  if (teamCount <= 6) return { format: 'round_robin', groupCount: 1, qualifiers: 0, summary: `One league: every team plays every other team once (${(teamCount * (teamCount - 1)) / 2} matches).` }
  const groupCount = teamCount <= 10 ? 2 : teamCount <= 20 ? 4 : 8
  return { format: 'groups_knockout', groupCount, qualifiers: 2, summary: `${groupSizes(teamCount, groupCount)}, followed by ${KNOCKOUT_AFTER[groupCount]}.` }
}

export const FORMAT_CHOICES: Array<{ format: CompetitionFormat; label: string }> = [
  { format: 'round_robin', label: 'League: everyone plays everyone once' },
  { format: 'two_leg', label: 'League: home and away' },
  { format: 'groups_knockout', label: 'Groups, then knockout' },
  { format: 'group_stage', label: 'Groups only' },
  { format: 'knockout', label: 'Knockout' },
]

export function planFor(format: CompetitionFormat, teamCount: number): FormatPlan {
  const recommended = recommendFormat(teamCount)
  if (recommended && recommended.format === format) return recommended
  const groupCount = format === 'groups_knockout' || format === 'group_stage' ? Math.max(2, recommended?.groupCount ?? 2) : 1
  const label = FORMAT_CHOICES.find(choice => choice.format === format)?.label ?? 'Custom format'
  return { format, groupCount, qualifiers: format === 'groups_knockout' ? 2 : 0, summary: groupCount > 1 ? `${groupSizes(teamCount, groupCount)}${format === 'groups_knockout' ? `, followed by ${KNOCKOUT_AFTER[groupCount] ?? 'a knockout'}` : ''}.` : `${label}.` }
}

// "18:00, 20:00" -> ["18:00", "20:00"]; invalid entries are dropped.
export function parsePlayingTimes(value: string): string[] {
  const times = value.split(/[,\s]+/).map(item => item.trim()).filter(Boolean).map(item => {
    const match = /^(\d{1,2})[:.]?(\d{2})?$/.exec(item)
    if (!match) return null
    const hours = Number(match[1]); const minutes = Number(match[2] ?? '0')
    return hours < 24 && minutes < 60 ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` : null
  }).filter((item): item is string => Boolean(item))
  return [...new Set(times)].sort()
}

export function parseVenues(value: string): string[] {
  return [...new Set(value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean))]
}

export type ScheduleSlot = { id: string; scheduledAt: string; venue: string }

// Places every unscheduled match into a playing slot, day by day from the
// start date: one match per venue per time, no team twice inside the rest
// time, in the order the draw produced them so rounds stay together.
// Times are Maldives time (UTC+5).
// maxPerDay and days (0 = Sunday … 6 = Saturday, Maldives time) are optional.
export function autoSchedule(fixtures: Array<{ id: string; homeTeamId: string; awayTeamId: string }>, options: { startDate: string; times: string[]; venues: string[]; restHours?: number; maxDays?: number; maxPerDay?: number | null; days?: number[] | null }): { slots: ScheduleSlot[]; unplaced: string[] } {
  const restMs = (options.restHours ?? 20) * 3_600_000
  const lastPlayed = new Map<string, number>()
  const waiting = [...fixtures]
  const slots: ScheduleSlot[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.startDate) || options.times.length === 0 || options.venues.length === 0) return { slots, unplaced: fixtures.map(item => item.id) }
  const start = Date.parse(`${options.startDate}T00:00:00+05:00`)
  for (let day = 0; day < (options.maxDays ?? 366) && waiting.length > 0; day += 1) {
    const date = new Date(start + day * 86_400_000 + 5 * 3_600_000).toISOString().slice(0, 10)
    if (options.days?.length && !options.days.includes(new Date(`${date}T12:00:00Z`).getUTCDay())) continue
    let today = 0
    for (const time of options.times) {
      if (options.maxPerDay && today >= options.maxPerDay) break
      const at = Date.parse(`${date}T${time}:00+05:00`)
      const busy = new Set<string>()
      for (const venue of options.venues) {
        const index = waiting.findIndex(item => [item.homeTeamId, item.awayTeamId].every(team => !busy.has(team) && (lastPlayed.get(team) === undefined || at - lastPlayed.get(team)! >= restMs)))
        if (index < 0) break
        const [fixture] = waiting.splice(index, 1)
        busy.add(fixture.homeTeamId); busy.add(fixture.awayTeamId)
        lastPlayed.set(fixture.homeTeamId, at); lastPlayed.set(fixture.awayTeamId, at)
        slots.push({ id: fixture.id, scheduledAt: new Date(at).toISOString(), venue })
        today += 1
        if (options.maxPerDay && today >= options.maxPerDay) break
      }
    }
  }
  return { slots, unplaced: waiting.map(item => item.id) }
}

// --- Play: the simple scoreboard ----------------------------------------------------

export type MatchPhase = 'not_started' | 'first_half' | 'half_time' | 'second_half' | 'finished'
// method: a penalty goal is still a goal (payload.method = 'penalty'); an own goal
// counts for `side` but is credited to a player of the other team.
export type ScoreEntry = { key: string; side: 'home' | 'away'; points: number; playerId: string | null; assistId: string | null; method?: 'goal' | 'penalty' | 'own_goal'; minute?: number | null }
// 'second_yellow' is written as a yellow and a red card; 'penalty_miss' needs migration 044.
export type CardEntry = { key: string; side: 'home' | 'away'; card: 'yellow_card' | 'red_card' | 'second_yellow' | 'penalty_miss'; playerId: string | null; minute?: number | null }
export type Scoreboard = { phase: MatchPhase; scores: ScoreEntry[]; cards: CardEntry[]; history: Array<{ kind: 'phase'; from: MatchPhase } | { kind: 'score' } | { kind: 'card' }> }
export type ScoreboardAction =
  | { type: 'start' } | { type: 'half_time' } | { type: 'resume' } | { type: 'finish' } | { type: 'undo' } | { type: 'reopen' }
  | { type: 'score'; entry: ScoreEntry } | { type: 'card'; entry: CardEntry }

export const EMPTY_SCOREBOARD: Scoreboard = { phase: 'not_started', scores: [], cards: [], history: [] }

export function scoreboardReducer(state: Scoreboard, action: ScoreboardAction): Scoreboard {
  const phase = (to: MatchPhase, allowed: MatchPhase[]): Scoreboard => allowed.includes(state.phase) ? { ...state, phase: to, history: [...state.history, { kind: 'phase', from: state.phase }] } : state
  const playing = state.phase === 'first_half' || state.phase === 'second_half'
  switch (action.type) {
    case 'start': return phase('first_half', ['not_started'])
    case 'half_time': return phase('half_time', ['first_half'])
    case 'resume': return phase('second_half', ['half_time'])
    case 'finish': return phase('finished', ['first_half', 'second_half', 'half_time'])
    case 'reopen': return phase('second_half', ['finished'])
    case 'score': return playing ? { ...state, scores: [...state.scores, action.entry], history: [...state.history, { kind: 'score' }] } : state
    case 'card': return playing || state.phase === 'half_time' ? { ...state, cards: [...state.cards, action.entry], history: [...state.history, { kind: 'card' }] } : state
    case 'undo': {
      const last = state.history[state.history.length - 1]
      if (!last) return state
      const history = state.history.slice(0, -1)
      if (last.kind === 'score') return { ...state, scores: state.scores.slice(0, -1), history }
      if (last.kind === 'card') return { ...state, cards: state.cards.slice(0, -1), history }
      return { ...state, phase: last.from, history }
    }
  }
}

export function scoreTotals(board: Scoreboard): { home: number; away: number } {
  return board.scores.reduce((total, entry) => ({ ...total, [entry.side]: total[entry.side] + entry.points }), { home: 0, away: 0 })
}

// Score buttons per sport. Volleyball keeps sets won, basketball keeps points.
export function scoreButtons(sport: string): Array<{ points: number; label: string }> {
  if (sport === 'basketball') return [{ points: 1, label: '+1' }, { points: 2, label: '+2' }, { points: 3, label: '+3' }]
  if (sport === 'basketball_3x3') return [{ points: 1, label: '+1' }, { points: 2, label: '+2' }]
  if (sport === 'volleyball') return [{ points: 1, label: '+1 set' }]
  return [{ points: 1, label: '+1 goal' }]
}

export function phaseLabel(phase: MatchPhase, sport: string): string {
  const halves = !['volleyball', 'basketball', 'basketball_3x3'].includes(sport)
  return ({ not_started: 'Not started', first_half: halves ? 'First half' : 'In play', half_time: halves ? 'Half-time' : 'Break', second_half: halves ? 'Second half' : 'In play', finished: 'Finished' } as Record<MatchPhase, string>)[phase]
}

// Events written to the match record in Full Career Mode, from the scoreboard,
// only when the result is submitted (so Undo never leaves a stray event).
// Volleyball sets are not player events, and an unknown scorer is recorded
// only where the sport has an "unassigned goal" event.
// Events need UUID idempotency keys. A second event from one tap (an assist, the
// red card of a second yellow) gets a stable key derived from the first, so a
// retry never records it twice. Only the version digit changes: every random key
// is version 4, so a derived key (version 5, 6, …) can never equal another key.
export function derivedKey(key: string, index: number): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return `${key}-${index}`
  return `${key.slice(0, 14)}${((4 + index) % 16).toString(16)}${key.slice(15)}`
}

export type CareerEvent = { key: string; teamId: string; playerId: string | null; eventType: string; payload?: Record<string, unknown> }

export function careerEvents(board: Scoreboard, sport: string, teamIds: { home: string; away: string }): CareerEvent[] {
  const events: CareerEvent[] = []
  const goalSport = ['football', 'futsal', 'handball'].includes(sport)
  const other = (side: 'home' | 'away') => side === 'home' ? 'away' : 'home'
  for (const entry of board.scores) {
    const teamId = teamIds[entry.side]
    if (goalSport) {
      if (entry.method === 'own_goal') { events.push(entry.playerId ? { key: entry.key, teamId: teamIds[other(entry.side)], playerId: entry.playerId, eventType: 'own_goal', ...(entry.minute != null ? { payload: { minute: entry.minute } } : {}) } : { key: entry.key, teamId, playerId: null, eventType: sport === 'handball' ? 'goal' : 'unassigned_goal', payload: { method: 'own_goal' } }); continue }
      const payload = entry.method === 'penalty' ? { method: 'penalty' } : undefined
      if (entry.playerId) events.push({ key: entry.key, teamId, playerId: entry.playerId, eventType: 'goal', ...(entry.minute != null ? { payload: { ...(payload ?? {}), minute: entry.minute } } : (payload ? { payload } : {})) })
      else if (sport !== 'handball') events.push({ key: entry.key, teamId, playerId: null, eventType: 'unassigned_goal', ...(entry.minute != null ? { payload: { ...(payload ?? {}), minute: entry.minute } } : (payload ? { payload } : {})) })
      if (entry.assistId) events.push({ key: derivedKey(entry.key, 1), teamId, playerId: entry.assistId, eventType: 'assist', ...(entry.minute != null ? { payload: { minute: entry.minute } } : {}) })
    } else if (sport.startsWith('basketball') && entry.playerId) {
      events.push({ key: entry.key, teamId, playerId: entry.playerId, eventType: entry.points === 3 ? 'three_point' : entry.points === 2 ? 'two_point' : 'one_point', ...(entry.minute != null ? { payload: { minute: entry.minute } } : {}) })
    }
  }
  if (goalSport) for (const card of board.cards) {
    const teamId = teamIds[card.side]
    if (card.card === 'second_yellow') {
      events.push({ key: card.key, teamId, playerId: card.playerId, eventType: 'yellow_card', payload: { second_yellow: true, ...(card.minute != null ? { minute: card.minute } : {}) } })
      events.push({ key: derivedKey(card.key, 1), teamId, playerId: card.playerId, eventType: 'red_card', payload: { second_yellow: true, ...(card.minute != null ? { minute: card.minute } : {}) } })
    } else events.push({ key: card.key, teamId, playerId: card.playerId, eventType: card.card, ...(card.minute != null ? { payload: { minute: card.minute } } : {}) })
  }
  return events
}

export const CARD_LABELS: Record<CardEntry['card'], string> = { yellow_card: 'Yellow card', second_yellow: 'Second yellow (sent off)', red_card: 'Red card', penalty_miss: 'Penalty missed' }

// --- Finish ----------------------------------------------------------------------

// The Finish checklist (owner, 2026-11-03), drawn from the server's completion
// checks (migration 036). Suspensions, statistics rebuild, awards and the
// archive preview are added by the Finish page itself.
export const FINISH_ITEMS = [
  { key: 'fixtures', label: 'All fixtures resolved', checks: ['fixtures', 'conflicts'] },
  { key: 'results', label: 'Final results confirmed', checks: ['results'] },
  { key: 'standings', label: 'Standings confirmed', checks: ['standings', 'statistics'] },
  { key: 'bracket', label: 'Knockout progression resolved', checks: ['bracket'] },
  { key: 'champion', label: 'Champion selected', checks: ['champion'] },
  { key: 'runner_up', label: 'Runner-up selected', checks: ['runner_up'] },
  { key: 'third_place', label: 'Third place recorded where applicable', checks: ['third_place'] },
  { key: 'disputes', label: 'Disputes resolved', checks: ['corrections', 'incidents'] },
] as const

// Groups the server's completion checks under the plain checklist lines.
// A line is done when every check it covers passes (a missing check is not a failure).
export function finishChecklist(checks: Array<{ key: string; ok: boolean; blocking: boolean }>): Array<{ key: string; label: string; ok: boolean; blocking: boolean }> {
  return FINISH_ITEMS.map(item => {
    const covered = checks.filter(check => (item.checks as readonly string[]).includes(check.key))
    return { key: item.key, label: item.label, ok: covered.every(check => check.ok), blocking: covered.some(check => !check.ok && check.blocking) }
  })
}

// --- Organizer tournament cards ------------------------------------------------------
// The same five phases from the counts the organization dashboard already loads
// (no per-tournament entry or match lists needed).
export type PhaseCounts = { approvedEntries: number; applicationsPending: number; rostersPending: number; paymentsPending: number; matchesTotal: number; matchesUnresolved: number; matchesAwaitingConfirmation: number }

export function phaseFromCounts(status: TournamentStatus, isPublished: boolean, counts: PhaseCounts): { step: FlowStepId | 'finished'; label: string; index: number } {
  if (FINISHED.includes(status)) return { step: 'finished', label: 'Finished', index: 5 }
  if (status === 'cancelled') return { step: 'finished', label: 'Cancelled', index: 5 }
  if (counts.matchesTotal === 0) return PAST_TEAMS.includes(status) ? { step: 'schedule', label: 'Schedule', index: 2 } : { step: 'teams', label: 'Teams', index: 1 }
  if (!isPublished || status !== 'in_progress') return { step: 'schedule', label: 'Schedule', index: 2 }
  if (counts.matchesUnresolved > 0) return { step: 'play', label: 'Play', index: 3 }
  return { step: 'finish', label: 'Finish', index: 4 }
}

export function pendingWork(counts: PhaseCounts): number {
  return counts.applicationsPending + counts.rostersPending + counts.paymentsPending + counts.matchesAwaitingConfirmation
}

// Teams phase (owner, 2026-11-02): one page with Registration, Applications,
// Confirmed Teams, Players, Rosters, Eligibility and Payments. Confirm Teams is
// held back only by decisions the organizer still has to make, never by
// information that is simply not recorded yet.
const WAITING_APPLICATION = ['submitted', 'under_review']
const WAITING_ROSTER = ['submitted', 'under_review']
const WAITING_PAYMENT = ['proof_submitted', 'under_review']

export function teamsConfirmBlockers(entries: TournamentEntry[], eligibilityProblems: Map<string, string[]>): string[] {
  const approved = entries.filter(entry => entry.application_status === 'approved')
  const applications = entries.filter(entry => WAITING_APPLICATION.includes(entry.application_status)).length
  const rosters = approved.filter(entry => WAITING_ROSTER.includes(entry.roster_status)).length
  const payments = approved.filter(entry => WAITING_PAYMENT.includes(entry.payment_status)).length
  const eligibility = approved.filter(entry => (eligibilityProblems.get(entry.id) ?? []).length > 0).length
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  return [
    applications ? `${plural(applications, 'application is', 'applications are')} waiting for a decision.` : '',
    rosters ? `${plural(rosters, 'squad list is', 'squad lists are')} waiting to be approved or rejected.` : '',
    payments ? `${plural(payments, 'payment proof is', 'payment proofs are')} waiting to be checked.` : '',
    eligibility ? `${plural(eligibility, 'team has', 'teams have')} an eligibility problem to resolve.` : '',
  ].filter(Boolean)
}

export type TeamsSection = { id: 'registration' | 'applications' | 'confirmed' | 'players' | 'rosters' | 'eligibility' | 'payments'; label: string; value: string; tone: 'ok' | 'warn' | 'info'; tab: OrganizerTab }

export function teamsSections(input: { status: TournamentStatus; entries: TournamentEntry[]; players: number | null; eligibilityProblems: Map<string, string[]> | null; fee: boolean }): TeamsSection[] {
  const { entries } = input
  const approved = entries.filter(entry => entry.application_status === 'approved')
  const waitingApplications = entries.filter(entry => WAITING_APPLICATION.includes(entry.application_status)).length
  const waitingRosters = approved.filter(entry => WAITING_ROSTER.includes(entry.roster_status)).length
  const locked = approved.filter(entry => entry.roster_status === 'locked').length
  const waitingPayments = approved.filter(entry => WAITING_PAYMENT.includes(entry.payment_status)).length
  const unpaid = approved.filter(entry => ['unpaid', 'overdue'].includes(entry.payment_status)).length
  const problems = input.eligibilityProblems ? approved.filter(entry => (input.eligibilityProblems!.get(entry.id) ?? []).length > 0).length : null
  const open = input.status === 'registration_open'
  const sections: TeamsSection[] = [
    { id: 'registration', label: 'Registration', value: open ? 'Open' : ['draft', 'setup'].includes(input.status) ? 'Not open' : 'Closed', tone: open ? 'ok' : 'info', tab: 'setup' },
    { id: 'applications', label: 'Applications', value: waitingApplications ? `${waitingApplications} to review` : 'None waiting', tone: waitingApplications ? 'warn' : 'ok', tab: 'applications' },
    { id: 'confirmed', label: 'Confirmed teams', value: String(approved.length), tone: approved.length >= 2 ? 'ok' : 'info', tab: 'teams' },
    { id: 'players', label: 'Players', value: input.players === null ? 'Loading' : String(input.players), tone: 'info', tab: 'teams' },
    { id: 'rosters', label: 'Rosters', value: waitingRosters ? `${waitingRosters} to review` : locked ? `${locked} locked` : 'None waiting', tone: waitingRosters ? 'warn' : 'ok', tab: 'teams' },
    { id: 'eligibility', label: 'Eligibility', value: problems === null ? 'Not checked' : problems ? `${problems} to resolve` : 'No problems', tone: problems ? 'warn' : problems === null ? 'info' : 'ok', tab: 'teams' },
  ]
  if (input.fee) sections.push({ id: 'payments', label: 'Payments', value: waitingPayments ? `${waitingPayments} to check` : unpaid ? `${unpaid} unpaid` : 'Up to date', tone: waitingPayments || unpaid ? 'warn' : 'ok', tab: 'applications' })
  return sections
}

// Schedule phase draw preview (owner, 2026-11-02). Fixture generation is
// deterministic for a given team order, so the preview is exactly what Confirm
// Draw creates. An automatic draw shuffles the order; a seeded draw keeps the
// order the organizer listed.
export function shuffledOrder<T>(items: T[], random: () => number = Math.random): T[] {
  const list = [...items]
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [list[index], list[swap]] = [list[swap], list[index]]
  }
  return list
}

export function drawPreview(format: CompetitionFormat, teamIds: string[], groupCount: number): { groups: string[][]; fixtures: Array<{ homeTeamId: string; awayTeamId: string }>; byes: string[] } {
  const plan = generateFixtures(format, teamIds, Math.max(1, groupCount))
  const playing = new Set(plan.fixtures.flatMap(fixture => [fixture.homeTeamId, fixture.awayTeamId]))
  return { groups: plan.groups, fixtures: plan.fixtures, byes: format === 'knockout' ? teamIds.filter(id => !playing.has(id)) : [] }
}

export type ScheduleRules = { pointsWin: number; pointsDraw: number; pointsLoss: number; thirdPlace: boolean; restHours: number; matchMinutes: number }
export const DEFAULT_SCHEDULE_RULES: ScheduleRules = { pointsWin: 3, pointsDraw: 1, pointsLoss: 0, thirdPlace: false, restHours: 20, matchMinutes: 90 }

export function scheduleRulesProblem(rules: ScheduleRules, times: string[]): string | null {
  for (const value of [rules.pointsWin, rules.pointsDraw, rules.pointsLoss]) if (!Number.isInteger(value) || value < -5 || value > 10) return 'Points must be whole numbers between -5 and 10.'
  if (!Number.isFinite(rules.restHours) || rules.restHours < 0 || rules.restHours > 168) return 'Rest time must be between 0 and 168 hours.'
  if (!Number.isInteger(rules.matchMinutes) || rules.matchMinutes < 10 || rules.matchMinutes > 240) return 'Match length must be between 10 and 240 minutes.'
  const minutes = times.map(time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))).sort((a, b) => a - b)
  if (minutes.some((value, index) => index > 0 && value - minutes[index - 1] < rules.matchMinutes)) return `Playing times are closer together than one ${rules.matchMinutes}-minute match. Space them out or add another venue.`
  return null
}

// Organization Home next action (owner, 2026-11-03): the one thing to do now,
// in the same five phases the tournament workspace shows, never the old
// setup-wizard stages. Waiting decisions come first, then the most advanced
// active tournament's phase.
export type HomeAction = { tournamentId: string; label: string; hint: string; tab: OrganizerTab; tone: 'warn' | 'info' | 'ok' }

export function organizationHomeAction(tournaments: Array<{ id: string; name: string; status: TournamentStatus; is_published: boolean }>, counts: Map<string, PhaseCounts>): HomeAction | null {
  const active = tournaments.filter(item => !['completed', 'archived', 'cancelled'].includes(item.status))
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  for (const tournament of active) {
    const value = counts.get(tournament.id)
    if (!value) continue
    if (value.matchesAwaitingConfirmation) return { tournamentId: tournament.id, label: `Confirm ${plural(value.matchesAwaitingConfirmation, 'result', 'results')}`, hint: `${tournament.name}: only a confirmed result updates standings and careers.`, tab: 'matches', tone: 'warn' }
    if (value.applicationsPending) return { tournamentId: tournament.id, label: `Review ${plural(value.applicationsPending, 'application', 'applications')}`, hint: `${tournament.name}: teams are waiting for a decision.`, tab: 'applications', tone: 'warn' }
    if (value.rostersPending) return { tournamentId: tournament.id, label: `Review ${plural(value.rostersPending, 'squad list', 'squad lists')}`, hint: `${tournament.name}: approve or ask for changes.`, tab: 'teams', tone: 'warn' }
    if (value.paymentsPending) return { tournamentId: tournament.id, label: `Check ${plural(value.paymentsPending, 'payment', 'payments')}`, hint: `${tournament.name}: entry-fee proofs are waiting.`, tab: 'applications', tone: 'warn' }
  }
  const ranked = active.map(tournament => ({ tournament, phase: phaseFromCounts(tournament.status, tournament.is_published, counts.get(tournament.id) ?? { approvedEntries: 0, applicationsPending: 0, rostersPending: 0, paymentsPending: 0, matchesTotal: 0, matchesUnresolved: 0, matchesAwaitingConfirmation: 0 }) }))
    .sort((a, b) => b.phase.index - a.phase.index)
  const first = ranked[0]
  if (!first) return null
  const { tournament, phase } = first
  const action: Record<string, Omit<HomeAction, 'tournamentId'>> = {
    teams: { label: 'Add teams', hint: `${tournament.name}: add or approve the teams, then Confirm Teams.`, tab: 'teams', tone: 'info' },
    schedule: { label: 'Make the schedule', hint: `${tournament.name}: choose the format, run the draw and publish the fixtures.`, tab: 'fixtures', tone: 'info' },
    play: { label: 'Play the next match', hint: `${tournament.name}: open the Match Center and record the result.`, tab: 'matches', tone: 'info' },
    finish: { label: 'Finish the tournament', hint: `${tournament.name}: every match is done. Record the awards and publish the archive.`, tab: 'completion', tone: 'ok' },
  }
  const chosen = action[phase.step]
  return chosen ? { tournamentId: tournament.id, ...chosen } : null
}

// Five plain labels for every record on the main pages (owner, 2026-11-03).
// The detailed status and its reason stay in the record's detail view.
export type SimpleStatus = 'Needs Action' | 'Waiting for Review' | 'Ready' | 'Problem' | 'Done'
const STATUS_GROUPS: Array<[SimpleStatus, string[]]> = [
  ['Problem', ['rejected', 'ineligible', 'conflict', 'conflicted', 'overdue', 'cancelled', 'abandoned', 'withdrawn']],
  ['Done', ['completed', 'official', 'archived', 'confirmed', 'locked', 'served']],
  ['Waiting for Review', ['submitted', 'under_review', 'pending', 'proof_submitted', 'awaiting_confirmation', 'waitlisted']],
  ['Needs Action', ['draft', 'not_started', 'incomplete', 'changes_requested', 'unpaid', 'scheduled', 'postponed', 'live']],
  ['Ready', ['approved', 'eligible', 'paid', 'waived', 'not_required', 'ready', 'published']],
]
export function simpleStatus(value: string | null | undefined): SimpleStatus {
  const key = String(value ?? '').toLowerCase()
  return STATUS_GROUPS.find(([, values]) => values.includes(key))?.[0] ?? 'Needs Action'
}
export const SIMPLE_STATUS_TONE: Record<SimpleStatus, 'warn' | 'info' | 'ok' | 'danger' | 'neutral'> = { 'Needs Action': 'warn', 'Waiting for Review': 'info', Ready: 'ok', Problem: 'danger', Done: 'neutral' }

// A team's one label: the worst of its application, squad list and payment.
export function teamStatus(entry: TournamentEntry, eligibilityProblems: string[] = []): SimpleStatus {
  if (eligibilityProblems.length) return 'Problem'
  const parts = [entry.application_status, entry.application_status === 'approved' ? entry.roster_status : 'approved', entry.application_status === 'approved' ? entry.payment_status : 'not_required'].map(simpleStatus)
  for (const status of ['Problem', 'Needs Action', 'Waiting for Review'] as SimpleStatus[]) if (parts.includes(status)) return status
  return 'Ready'
}

// Tournament Home summary (owner spec): at most six cards, each opening its page.
export function homeSummary(entries: TournamentEntry[], matches: TournamentMatch[], extras: { players: number | null; issues: number }) {
  const active = activeMatches(matches)
  const pending = entries.filter(entry => ['submitted', 'under_review', 'changes_requested'].includes(entry.application_status)).length
    + entries.filter(entry => ['submitted', 'under_review'].includes(entry.roster_status)).length
    + entries.filter(entry => ['proof_submitted', 'under_review'].includes(entry.payment_status)).length
    + active.filter(match => match.status === 'awaiting_confirmation').length
  return [
    { key: 'teams', label: 'Teams', value: String(entries.filter(entry => entry.application_status === 'approved').length), tab: 'teams' as OrganizerTab },
    { key: 'players', label: 'Players', value: extras.players === null ? '…' : String(extras.players), tab: 'teams' as OrganizerTab },
    { key: 'fixtures', label: 'Fixtures', value: String(active.length), tab: 'fixtures' as OrganizerTab },
    { key: 'completed', label: 'Completed matches', value: String(active.filter(match => match.status === 'confirmed').length), tab: 'matches' as OrganizerTab },
    { key: 'pending', label: 'Pending decisions', value: String(pending), tab: (pending && active.some(match => match.status === 'awaiting_confirmation') ? 'matches' : 'applications') as OrganizerTab, warn: pending > 0 },
    { key: 'issues', label: 'Issues', value: String(extras.issues), tab: 'fixtures' as OrganizerTab, warn: extras.issues > 0 },
  ]
}
