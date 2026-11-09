import { describe, expect, it } from 'vitest'
import { calculateAutomaticMilestones, calculateOfficialPlayerStats, calculateTeamHistory, publicPlayerCardData } from './statistics'

const records = [{ matchId: 'm1', tournamentId: 't1', seasonId: 's1', sport: 'football', teamId: 'club-1', teamName: 'Real team', teamType: 'club' as const, playerId: 'p1', starter: true, minutes: 90, events: [{ type: 'goal' }, { type: 'assist' }], confirmed: true }, { matchId: 'm2', tournamentId: 't2', seasonId: 's2', sport: 'football', teamId: 'island-1', teamName: 'Island team', teamType: 'island' as const, playerId: 'p1', starter: false, minutes: null, events: [{ type: 'goal' }], confirmed: true }, { matchId: 'm3', tournamentId: 't1', seasonId: 's1', sport: 'football', teamId: 'club-1', teamName: 'Real team', teamType: 'club' as const, playerId: 'p1', starter: true, minutes: 90, events: [{ type: 'goal' }], confirmed: false }]

describe('official histories and statistics', () => {
  it('filters by club, island, tournament, season, and sport and ignores unconfirmed records', () => {
    expect(calculateOfficialPlayerStats(records)).toHaveLength(2)
    expect(calculateOfficialPlayerStats(records, { teamType: 'club', tournamentId: 't1', seasonId: 's1', sport: 'football' })[0]).toMatchObject({ appearances: 1, goals: 1, minutes: 90 })
  })
  it('recalculates team totals and automatic milestones from confirmed source records', () => {
    expect(calculateTeamHistory([{ teamId: 'a', tournamentId: 't', confirmed: true, scored: 2, conceded: 0 }, { teamId: 'a', tournamentId: 't', confirmed: false, scored: 9, conceded: 0 }])).toMatchObject([{ matches: 1, wins: 1, scored: 2 }])
    expect(calculateAutomaticMilestones(records).map(milestone => milestone.type)).toEqual(['first_appearance', 'first_goal'])
  })
  it('keeps manual milestones distinct and hides unapproved player cards', () => {
    expect(publicPlayerCardData({ displayName: 'Private', approved: false }, [])).toBeNull()
    expect(publicPlayerCardData({ displayName: 'Approved', approved: true, island: 'Malé' }, calculateOfficialPlayerStats(records), { name: 'Real team' })).toMatchObject({ displayName: 'Approved', stats: { appearances: 2, goals: 2 } })
  })
})
