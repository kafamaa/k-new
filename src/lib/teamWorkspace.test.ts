import { describe, expect, it } from 'vitest'
import {
  applicationAction, applicationNextActions, latestConfirmedScores, membershipLabel, sanitizeTeamProfile,
  splitMatchesByTime, teamMatchRecord, validateRosterCount,
} from './teamWorkspace'

describe('teamWorkspace pure helpers', () => {
  it('sanitizeTeamProfile trims and bounds fields', () => {
    const result = sanitizeTeamProfile({ name: '  Team A  ', island: 'Male', team_type: 'club', description: 'd', logo_url: 'https://x', is_published: true })
    expect(result.problems).toEqual([])
    expect(result.patch).toEqual({ name: 'Team A', island: 'Male', team_type: 'club', description: 'd', logo_url: 'https://x', is_published: true })
  })
  it('sanitizeTeamProfile rejects an empty name and unknown team type', () => {
    const result = sanitizeTeamProfile({ name: '   ', team_type: 'unknown' })
    expect(result.problems).toContain('Team name cannot be empty.')
    expect(result.patch.team_type).toBe('club')
  })
  it('applicationAction only allows legal transitions', () => {
    expect(applicationAction('draft', 'submit')).toBeNull()
    expect(applicationAction('approved', 'submit')).not.toBeNull()
    expect(applicationAction('changes_requested', 'resubmit')).toBeNull()
    expect(applicationAction('approved', 'withdraw')).not.toBeNull()
  })
  it('applicationNextActions reports submitted and roster states', () => {
    const actions = applicationNextActions({ application_status: 'approved', roster_status: 'changes_requested' })
    expect(actions).toContain('The application is approved.')
    expect(actions).toContain('The organizer requested roster corrections; resubmit the roster.')
  })
  it('splitMatchesByTime separates concluded from upcoming', () => {
    const rows = [
      { id: 'a', status: 'confirmed', scheduled_at: '2026-01-01T10:00:00Z' },
      { id: 'b', status: 'scheduled', scheduled_at: '2099-01-01T10:00:00Z' },
    ]
    const result = splitMatchesByTime(rows, '2026-06-01T00:00:00Z')
    expect(result.past.map(row => row.id)).toEqual(['a'])
    expect(result.upcoming.map(row => row.id)).toEqual(['b'])
  })
  it('latestConfirmedScores keeps the highest version per match', () => {
    const versions = [
      { match_id: 'm1', version: 1, score: { home: 1, away: 0 } },
      { match_id: 'm1', version: 2, score: { home: 2, away: 1 } },
      { match_id: 'm2', version: 1, score: { home: null, away: 0 } },
    ]
    const scores = latestConfirmedScores(['m1', 'm2'], versions)
    expect(scores.get('m1')).toEqual({ matchId: 'm1', homeScore: 2, awayScore: 1 })
    expect(scores.get('m2')).toEqual({ matchId: 'm2', homeScore: null, awayScore: 0 })
  })
  it('teamMatchRecord aggregates confirmed matches for the chosen team', () => {
    const matches = [
      { id: 'm1', home_team_id: 't1', away_team_id: 't2', status: 'confirmed' },
      { id: 'm2', home_team_id: 't2', away_team_id: 't1', status: 'confirmed' },
    ]
    const versions = [
      { match_id: 'm1', version: 1, score: { home: 2, away: 1 } },
      { match_id: 'm2', version: 1, score: { home: 0, away: 3 } },
    ]
    const record = teamMatchRecord('t1', matches, versions) as Record<string, number>
    expect(record.played).toBe(2)
    expect(record.wins).toBe(2)
    expect(record.scored).toBe(5)
    expect(record.conceded).toBe(1)
    expect(record.points).toBe(6)
  })
  it('validateRosterCount reports problems', () => {
    expect(validateRosterCount(3, 5, 10).problems).toEqual(['Roster needs at least 5 players (currently 3).'])
    expect(validateRosterCount(12, 5, 10).problems).toEqual(['Roster allows at most 10 players (currently 12).'])
    expect(validateRosterCount(7, 5, 10).problems).toEqual([])
  })
  it('membershipLabel marks private profiles honestly', () => {
    expect(membershipLabel({ status: 'active', effective_from: '2026-01-01', player_profiles: null })).toContain('Private player record')
    expect(membershipLabel({ status: 'ended', effective_from: '2026-01-01', effective_to: '2026-02-02', player_profiles: { display_name: 'Asha' } })).toContain('Asha')
  })
})