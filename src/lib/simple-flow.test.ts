import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { TournamentEntry, TournamentMatch } from './organizer'
import {
  autoSchedule, careerEvents, chargesFee, EMPTY_SCOREBOARD, finishChecklist, flowSteps, homeCards, matchWhen, nextMatch, parsePlayingTimes,
  parseVenues, planFor, recommendFormat, scoreboardReducer, scoreTotals, simpleNextAction, teamReadiness, type FlowInput, type Scoreboard,
} from './simpleFlow'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')
const entry = (id: string, extra: Partial<TournamentEntry> = {}): TournamentEntry => ({ id, team_id: `team-${id}`, application_status: 'approved', roster_status: 'not_started', payment_status: 'not_required', review_notes: null, reviewed_at: null, submitted_at: null, team_name: `Team ${id}`, team_slug: null, latest_roster_status: null, latest_roster_version: null, ...extra })
const match = (id: string, extra: Partial<TournamentMatch> = {}): TournamentMatch => ({ id, status: 'scheduled', scheduled_at: null, venue: null, leg: 1, home_team_id: 'a', away_team_id: 'b', home_team_name: 'WIGANI', away_team_name: 'United', ...extra })
const input = (extra: Partial<FlowInput> = {}): FlowInput => ({ status: 'draft', isPublished: false, entries: [], matches: [], ...extra })
const states = (value: FlowInput) => flowSteps(value).map(step => step.state)

describe('Simple flow: five steps', () => {
  it('moves from Create to Finish as the tournament progresses', () => {
    expect(flowSteps(input()).map(step => step.label)).toEqual(['Create', 'Teams', 'Schedule', 'Play', 'Finish'])
    expect(states(input())).toEqual(['done', 'current', 'upcoming', 'upcoming', 'upcoming'])
    expect(states(input({ status: 'registration_closed', entries: [entry('1'), entry('2')] }))).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming'])
    const scheduled = [match('m1', { scheduled_at: '2026-11-10T15:00:00Z', venue: 'Main Court' })]
    expect(states(input({ status: 'registration_closed', matches: scheduled }))).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming'])
    expect(states(input({ status: 'in_progress', isPublished: true, matches: scheduled }))).toEqual(['done', 'done', 'done', 'current', 'upcoming'])
    expect(states(input({ status: 'in_progress', isPublished: true, matches: [match('m1', { status: 'confirmed', scheduled_at: '2026-11-10T15:00:00Z' })] }))).toEqual(['done', 'done', 'done', 'done', 'current'])
    expect(states(input({ status: 'completed' }))).toEqual(['done', 'done', 'done', 'done', 'done'])
  })
  it('gives one plain next action for each step', () => {
    expect(simpleNextAction(input()).label).toBe('Add teams')
    expect(simpleNextAction(input({ entries: [entry('1', { application_status: 'submitted' })] })).label).toBe('Check team applications')
    expect(simpleNextAction(input({ entries: [entry('1'), entry('2')] })).label).toBe('Confirm teams')
    expect(simpleNextAction(input({ status: 'registration_closed', entries: [entry('1'), entry('2')] })).label).toBe('Make the schedule')
    expect(simpleNextAction(input({ status: 'registration_closed', matches: [match('m1')] })).label).toBe('Set match times')
    expect(simpleNextAction(input({ status: 'registration_closed', matches: [match('m1', { scheduled_at: '2026-11-10T15:00:00Z' })] })).label).toBe('Publish schedule')
    const playing = input({ status: 'in_progress', isPublished: true, matches: [match('m1', { scheduled_at: '2026-11-10T15:00:00Z', venue: 'Main Court' })] })
    expect(simpleNextAction(playing, Date.parse('2026-11-10T10:00:00Z'))).toMatchObject({ label: 'Open next match', reason: 'WIGANI vs United · Today · 20:00 · Main Court', matchId: 'm1' })
    expect(simpleNextAction({ ...playing, matches: [match('m1', { status: 'awaiting_confirmation', scheduled_at: '2026-11-10T15:00:00Z' })] }).label).toBe('Confirm result')
    expect(simpleNextAction(input({ status: 'in_progress', isPublished: true, matches: [match('m1', { status: 'confirmed', scheduled_at: '2026-11-10T15:00:00Z' })] })).label).toBe('Finish tournament')
  })
  it('shows at most four home cards', () => {
    const cards = homeCards([entry('1'), entry('2', { application_status: 'submitted' })], [match('m1', { status: 'awaiting_confirmation' }), match('m2', { status: 'confirmed' }), match('m3', { status: 'cancelled' })])
    expect(cards.map(card => [card.label, card.value])).toEqual([['Teams', 1], ['Matches', 2], ['Completed', 1], ['Needs Attention', 2]])
  })
  it('picks the live match, then the next one in time', () => {
    const now = Date.parse('2026-11-10T10:00:00Z')
    expect(nextMatch([match('late', { scheduled_at: '2026-11-11T15:00:00Z' }), match('soon', { scheduled_at: '2026-11-10T15:00:00Z' })], now)?.id).toBe('soon')
    expect(nextMatch([match('soon', { scheduled_at: '2026-11-10T15:00:00Z' }), match('live', { status: 'live' })], now)?.id).toBe('live')
    expect(matchWhen('2026-11-11T13:00:00Z', now)).toBe('Tomorrow · 18:00')
  })
})

describe('Simple flow: Teams', () => {
  it('uses one status per team', () => {
    expect(teamReadiness(entry('1'), 12, 5)).toBe('ready')
    expect(teamReadiness(entry('1'), 3, 5)).toBe('needs_players')
    expect(teamReadiness(entry('1', { payment_status: 'unpaid' }), 12, 5)).toBe('needs_payment')
    expect(teamReadiness(entry('1', { application_status: 'submitted' }), 12, 5)).toBe('needs_review')
    expect(teamReadiness(entry('1', { roster_status: 'submitted' }), 12, 5)).toBe('needs_review')
    expect(teamReadiness(entry('1'), null, 5)).toBe('ready')
  })
  it('shows the Payment column only when a fee applies', () => {
    expect(chargesFee([entry('1'), entry('2')])).toBe(false)
    expect(chargesFee([entry('1'), entry('2', { payment_status: 'paid' })])).toBe(true)
  })
})

describe('Simple flow: Schedule', () => {
  it('recommends a format from the team count', () => {
    expect(recommendFormat(1)).toBeNull()
    expect(recommendFormat(8)).toEqual({ format: 'groups_knockout', groupCount: 2, qualifiers: 2, summary: '2 groups of 4, followed by semi-finals and final.' })
    expect(recommendFormat(5)?.summary).toBe('One league: every team plays every other team once (10 matches).')
    expect(recommendFormat(16)?.summary).toBe('4 groups of 4, followed by quarter-finals, semi-finals and final.')
    expect(recommendFormat(9)?.summary).toBe('2 groups of 4–5, followed by semi-finals and final.')
    expect(planFor('knockout', 8).summary).toBe('Knockout.')
  })
  it('reads playing times and venues the way people type them', () => {
    expect(parsePlayingTimes('20:00, 18.30 9 25:00 x')).toEqual(['09:00', '18:30', '20:00'])
    expect(parseVenues('Main Court, Futsal Ground;Main Court')).toEqual(['Main Court', 'Futsal Ground'])
  })
  it('places every match with no team or venue clash and enough rest, in Maldives time', () => {
    const fixtures = [['a', 'b'], ['c', 'd'], ['a', 'c'], ['b', 'd'], ['a', 'd'], ['b', 'c']].map(([home, away], index) => ({ id: `m${index}`, homeTeamId: home, awayTeamId: away }))
    const { slots, unplaced } = autoSchedule(fixtures, { startDate: '2026-11-10', times: ['18:00', '20:00'], venues: ['Main Court', 'Second Court'] })
    expect(unplaced).toEqual([])
    expect(slots[0]).toEqual({ id: 'm0', scheduledAt: '2026-11-10T13:00:00.000Z', venue: 'Main Court' })
    const at = new Map(slots.map(slot => [slot.id, Date.parse(slot.scheduledAt)]))
    for (const left of fixtures) for (const right of fixtures) {
      if (left.id >= right.id) continue
      const shared = [left.homeTeamId, left.awayTeamId].some(team => [right.homeTeamId, right.awayTeamId].includes(team))
      if (shared) expect(Math.abs(at.get(left.id)! - at.get(right.id)!)).toBeGreaterThanOrEqual(20 * 3_600_000)
    }
    const used = slots.map(slot => `${slot.scheduledAt}|${slot.venue}`)
    expect(new Set(used).size).toBe(used.length)
  })
  it('places nothing without a date, time or venue', () => {
    expect(autoSchedule([{ id: 'm', homeTeamId: 'a', awayTeamId: 'b' }], { startDate: '', times: ['18:00'], venues: ['Court'] }).unplaced).toEqual(['m'])
  })
})

describe('Simple flow: Play', () => {
  const entryKey = (n: number) => `k${n}`
  it('starts, scores, pauses, undoes and finishes', () => {
    let board: Scoreboard = EMPTY_SCOREBOARD
    board = scoreboardReducer(board, { type: 'score', entry: { key: entryKey(0), side: 'home', points: 1, playerId: null, assistId: null } })
    expect(scoreTotals(board)).toEqual({ home: 0, away: 0 })
    board = scoreboardReducer(board, { type: 'start' })
    board = scoreboardReducer(board, { type: 'score', entry: { key: entryKey(1), side: 'home', points: 1, playerId: 'p1', assistId: 'p2' } })
    board = scoreboardReducer(board, { type: 'score', entry: { key: entryKey(2), side: 'away', points: 1, playerId: null, assistId: null } })
    board = scoreboardReducer(board, { type: 'undo' })
    expect(scoreTotals(board)).toEqual({ home: 1, away: 0 })
    board = scoreboardReducer(board, { type: 'half_time' })
    expect(board.phase).toBe('half_time')
    board = scoreboardReducer(board, { type: 'undo' })
    expect(board.phase).toBe('first_half')
    board = scoreboardReducer(board, { type: 'finish' })
    expect(board.phase).toBe('finished')
    board = scoreboardReducer(board, { type: 'reopen' })
    expect(board.phase).toBe('second_half')
  })
  it('records player events only in Full Career Mode, from what is left after Undo', () => {
    const board: Scoreboard = { ...EMPTY_SCOREBOARD, phase: 'finished', scores: [{ key: 'g1', side: 'home', points: 1, playerId: 'p1', assistId: 'p2' }, { key: 'g2', side: 'away', points: 1, playerId: null, assistId: null }], cards: [{ key: 'c1', side: 'away', card: 'yellow_card', playerId: 'p9' }] }
    expect(careerEvents(board, 'football', { home: 'H', away: 'A' })).toEqual([
      { key: 'g1', teamId: 'H', playerId: 'p1', eventType: 'goal' },
      // Non-UUID test keys get a suffix; real UUID keys stay valid UUIDs (see workflow-redesign tests).
      { key: 'g1-1', teamId: 'H', playerId: 'p2', eventType: 'assist' },
      { key: 'g2', teamId: 'A', playerId: null, eventType: 'unassigned_goal' },
      { key: 'c1', teamId: 'A', playerId: 'p9', eventType: 'yellow_card' },
    ])
    expect(careerEvents({ ...board, scores: [{ key: 'b', side: 'home', points: 3, playerId: 'p1', assistId: null }], cards: [] }, 'basketball', { home: 'H', away: 'A' })).toEqual([{ key: 'b', teamId: 'H', playerId: 'p1', eventType: 'three_point' }])
    expect(careerEvents(board, 'volleyball', { home: 'H', away: 'A' })).toEqual([])
  })
  it('never shows missing player statistics as zero', () => {
    expect(read('src/components/PublicPageParts.tsx')).toContain('Player statistics were not recorded for this match.')
  })
})

describe('Simple flow: Finish', () => {
  it('groups the server checks into the plain checklist', () => {
    const list = finishChecklist([{ key: 'fixtures', ok: true, blocking: true }, { key: 'results', ok: true, blocking: true }, { key: 'standings', ok: false, blocking: false }, { key: 'champion', ok: false, blocking: true }])
    // Eight lines since 2026-11-03; a line with no server check is not a failure.
    expect(list.map(item => item.key)).toEqual(['fixtures', 'results', 'standings', 'bracket', 'champion', 'runner_up', 'third_place', 'disputes'])
    expect(list.find(item => item.key === 'results')).toEqual({ key: 'results', label: 'Final results confirmed', ok: true, blocking: false })
    expect(list.find(item => item.key === 'standings')).toEqual({ key: 'standings', label: 'Standings confirmed', ok: false, blocking: false })
    expect(list.find(item => item.key === 'champion')).toEqual({ key: 'champion', label: 'Champion selected', ok: false, blocking: true })
    expect(list.find(item => item.key === 'disputes')?.ok).toBe(true)
  })
})

describe('Simple flow: what the organizer sees', () => {
  const flow = read('src/components/SimpleTournamentFlow.tsx')
  const workspace = read('src/components/TournamentWorkspace.tsx')
  // Words updated for the simple workflow replacement (2026-11-03): Add Team, Start Match,
  // Record Full Match Details; Save & Exit is gone because every change saves automatically.
  it('uses the five menu items and the exact button words', () => {
    expect(workspace).toContain("{ label: 'Home', tabs: ['overview'] }")
    for (const words of ['Create Tournament']) expect(read('src/components/OrganizerWorkspace.tsx')).toContain(words)
    // Use Recommended and Choose Another Format moved to the engine's Format & Rules section (2026-11-03).
    const engine = read('src/components/CompetitionEngine.tsx')
    // Simple workflow replacement (2026-11-03): format cards with one primary action.
    for (const words of ['Recommended', 'Use This Format', 'Advanced settings']) expect(engine).toContain(words)
    for (const words of ['How will teams join?', 'Share Registration Link', 'Add Team', 'Confirm Teams', 'Make Changes', 'Publish Schedule', 'Start Match', 'Start Match', 'Add Score', 'Undo', 'Finish Match', 'Submit Result', 'Result waiting for confirmation', 'Confirm Result', 'Simple Mode', 'Record Full Match Details', 'Your tournament is almost complete.', 'Finish Tournament', /* reworded 2026-11-03: archive, never delete */ 'This archives the tournament (nothing is deleted) and publishes its permanent record.', 'Finish and Publish Archive', 'More details']) expect(flow).toContain(words)
  })
  it('keeps engine words out of the simple screens', () => {
    const visible = flow.replace(/\/\/.*$/gm, '')
    for (const word of [/competition engine/i, /roster version/i, /fixture version/i, /lifecycle/i, /progression/i, /stage_id/]) expect(visible).not.toMatch(word)
    expect(workspace).not.toContain('Setup {progress.complete} of {progress.total}')
  })
  it('opens Teams straight after Create, and asks only name, sport, logo and cover', () => {
    const organizer = read('src/components/OrganizerWorkspace.tsx')
    expect(organizer).toContain("onOpen(result.data.id, 'teams')")
    expect(organizer).toContain('Logo (optional)')
    expect(organizer).toContain('Cover (optional)')
  })
  it('keeps every earlier tool reachable under More details', () => {
    for (const component of ['<CockpitOverview', '<TeamsTab', '<FixturesPage', '<MatchesTab', '<CompletionPage', '<CompetitionPlanner', '<SetupStage', '<ApplicationsPage']) expect(workspace).toContain(component)
  })
  it('migration 042 lets only an operator or assigned official start a match', () => {
    const sql = read('supabase/migrations/202611010042_simple_match_start.sql')
    expect(sql).toContain("security definer set search_path = ''")
    expect(sql).toContain('public.is_tournament_operator(v_match.tournament_id) or public.is_match_official(p_match)')
    expect(sql).toContain('revoke execute on function public.set_match_live(uuid, boolean) from public, anon;')
    expect(sql).toContain("if v_match.status <> 'scheduled' then raise exception 'match_not_startable'")
    expect(sql).not.toMatch(/\b(drop|delete|truncate|insert)\b/i)
  })
})
