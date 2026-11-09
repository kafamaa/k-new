import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { TournamentEntry, TournamentMatch } from './organizer'
import { homeSummary, simpleNextAction, simpleStatus, teamStatus } from './simpleFlow'
import { fixtureIssues } from './tournamentEngine'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')
const entry = (id: string, extra: Partial<TournamentEntry> = {}): TournamentEntry => ({ id, team_id: `t${id}`, application_status: 'approved', roster_status: 'approved', payment_status: 'not_required', review_notes: null, reviewed_at: null, submitted_at: null, team_name: `Team ${id}`, team_slug: null, latest_roster_status: null, latest_roster_version: null, ...extra })
const match = (id: string, extra: Partial<TournamentMatch> = {}): TournamentMatch => ({ id, status: 'scheduled', scheduled_at: '2026-12-01T10:00:00Z', venue: 'Court', leg: 1, home_team_id: 'a', away_team_id: 'b', home_team_name: 'A', away_team_name: 'B', ...extra })

// Simple tournament workflow replacement (owner, 2026-11-03).
describe('Plain status labels', () => {
  it('turns detailed states into five labels', () => {
    expect(['draft', 'changes_requested', 'unpaid'].map(simpleStatus)).toEqual(['Needs Action', 'Needs Action', 'Needs Action'])
    expect(['submitted', 'under_review', 'proof_submitted', 'awaiting_confirmation'].map(simpleStatus)).toEqual(Array(4).fill('Waiting for Review'))
    expect(['approved', 'paid', 'waived'].map(simpleStatus)).toEqual(['Ready', 'Ready', 'Ready'])
    expect(['rejected', 'conflict'].map(simpleStatus)).toEqual(['Problem', 'Problem'])
    expect(['confirmed', 'archived', 'locked'].map(simpleStatus)).toEqual(['Done', 'Done', 'Done'])
  })
  it('gives each team one label, worst first', () => {
    expect(teamStatus(entry('1'))).toBe('Ready')
    expect(teamStatus(entry('1', { roster_status: 'submitted' }))).toBe('Waiting for Review')
    expect(teamStatus(entry('1', { payment_status: 'unpaid' }))).toBe('Needs Action')
    expect(teamStatus(entry('1', { application_status: 'rejected' }))).toBe('Problem')
    expect(teamStatus(entry('1'), ['A player is also on another team’s roster'])).toBe('Problem')
  })
})

describe('Tournament Home', () => {
  it('shows at most six summary cards', () => {
    const cards = homeSummary([entry('1'), entry('2', { application_status: 'submitted' })], [match('m1', { status: 'awaiting_confirmation' }), match('m2', { status: 'confirmed' })], { players: 14, issues: 1 })
    expect(cards.map(card => [card.label, card.value])).toEqual([['Teams', '1'], ['Players', '14'], ['Fixtures', '2'], ['Completed matches', '1'], ['Pending decisions', '2'], ['Issues', '1']])
    expect(homeSummary([], [], { players: null, issues: 0 })[1].value).toBe('…')
  })
  it('orders the next action: bracket conflict, applications, squad lists, then the phase', () => {
    const base = { status: 'draft' as const, isPublished: false, entries: [entry('1'), entry('2')], matches: [] }
    expect(simpleNextAction({ ...base, conflicts: 1 }).label).toBe('Fix the bracket')
    expect(simpleNextAction({ ...base, entries: [entry('1', { roster_status: 'submitted' }), entry('2')] }).label).toBe('Review squad lists')
    expect(simpleNextAction({ status: 'in_progress', isPublished: true, entries: base.entries, matches: [match('m1', { status: 'live' })] }).label).toBe('Enter the result')
  })
  it('keeps forms and settings off Home', () => {
    const flow = read('src/components/SimpleTournamentFlow.tsx')
    const home = flow.slice(flow.indexOf('export function SimpleHome('), flow.indexOf('function FinishedSummary('))
    expect(home).not.toMatch(/<form|<input|<select|<textarea/)
    expect(read('src/components/TournamentWorkspace.tsx')).toContain("{details('settings', <CockpitOverview")
  })
})

describe('Teams, Schedule and Matches screens', () => {
  const flow = read('src/components/SimpleTournamentFlow.tsx')
  it('Teams: two big actions, search before create, team cards with Manage Team', () => {
    for (const text of ['Share Registration Link', 'Add Team', 'Open Registration', 'Copy Link', 'Share via WhatsApp', 'Preview Form', 'Close Registration', 'Create New Team', 'Add to Tournament', 'Manage Team', 'Approve Roster', 'Lock Roster', 'Request Correction', 'Confirm Teams and Continue']) expect(flow).toContain(text)
    expect(flow.indexOf('Search team name')).toBeLessThan(flow.indexOf('Create New Team'))
  })
  it('Matches: filters, start checklist, simple result first, correction in the match menu', () => {
    for (const text of ["label: 'Next'", "label: 'Live'", "label: 'Needs Review'", "label: 'Completed'", "label: 'All'", 'Start Match', 'Record Full Match Details', 'Correct Result']) expect(flow).toContain(text)
    expect(flow).toContain("read(modeKey) === 'career' ? 'career' : 'simple'")
    expect(flow).toMatch(/<details className="match-menu">[^]*Correct Result/)
  })
  it('Schedule: per-fixture problems with a suggested fix', () => {
    const issues = fixtureIssues([
      { homeTeamId: 'a', awayTeamId: 'b', leg: 1, scheduledAt: '2026-12-01T10:00:00Z', venue: 'Court' },
      { homeTeamId: 'c', awayTeamId: 'd', leg: 1, scheduledAt: '2026-12-01T10:30:00Z', venue: 'Court' },
      { homeTeamId: 'a', awayTeamId: 'c', leg: 1, scheduledAt: null, venue: null },
    ], { matchMinutes: 90 })
    expect(issues.get(0)).toEqual(['Court has two matches at once. Change the time or venue.'])
    expect(issues.get(2)).toEqual(['No date and time yet. Choose one.'])
  })
  it('never asks for raw IDs in the organization operations forms', () => {
    const ops = read('src/components/OperationsPanel.tsx')
    expect(ops).not.toMatch(/Tournament ID|user ID|UUID/)
  })
})
