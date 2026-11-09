import { describe, expect, it } from 'vitest'
import { advanceGroupsToKnockout, advanceKnockout, assignGroups, attachPersistedGroupIds, calculateStandings, generateFixtures, getSportRules, knockoutFixtures, manualFixtures, roundRobinFixtures } from './competition'

describe('competition engine formats and rules', () => {
  it('generates round-robin and two-leg fixtures', () => {
    expect(roundRobinFixtures(['a', 'b', 'c', 'd'])).toHaveLength(6)
    expect(roundRobinFixtures(['a', 'b', 'c'], true)).toHaveLength(6)
    expect(roundRobinFixtures(['a', 'b', 'c']).every(fixture => !fixture.homeTeamId.includes('BYE') && !fixture.awayTeamId.includes('BYE'))).toBe(true)
  })
  it('generates balanced group-stage and groups-plus-knockout plans', () => {
    expect(assignGroups(['a', 'b', 'c', 'd', 'e'], 2).map(group => group.length)).toEqual([3, 2])
    const groupPlan = generateFixtures('group_stage', ['a', 'b', 'c', 'd'], 2)
    expect(groupPlan.groups).toHaveLength(2)
    expect(groupPlan.fixtures.every(fixture => fixture.group)).toBe(true)
    const persisted = attachPersistedGroupIds(groupPlan.fixtures, [{ name: 'Group A', id: 'group-a-db' }, { name: 'Group B', id: 'group-b-db' }])
    expect(persisted.every(fixture => fixture.groupId === (fixture.group === 'Group A' ? 'group-a-db' : 'group-b-db'))).toBe(true)
    expect(generateFixtures('groups_knockout', ['a', 'b', 'c', 'd'], 2).nextRoundSlots).toEqual(['GROUP_A_1', 'GROUP_B_1'])
  })
  it('generates knockout fixtures with byes and validates manual draws', () => {
    expect(knockoutFixtures(['a', 'b', 'c', 'd', 'e'])).toHaveLength(2)
    expect(manualFixtures([['a', 'b'], ['c', 'd'], ['a', 'e']])).toHaveLength(2)
  })
  it('progresses completed knockout and group stages only from qualified teams', () => {
    expect(advanceKnockout(['a', 'b', 'c', 'd'], 2)).toHaveLength(2)
    expect(advanceGroupsToKnockout([['a', 'b'], ['c', 'd']], [[{ homeTeamId: 'a', awayTeamId: 'b', homeScore: 1, awayScore: 0, confirmed: true }], [{ homeTeamId: 'c', awayTeamId: 'd', homeScore: 0, awayScore: 2, confirmed: true }]])).toEqual([{ homeTeamId: 'a', awayTeamId: 'd', leg: 1, round: 1 }])
  })
  it('supports all release-one sport rule presets', () => {
    for (const sport of ['football', 'futsal', 'handball', 'volleyball', 'basketball', 'basketball_3x3']) expect(getSportRules(sport)).not.toBeNull()
    expect(getSportRules('basketball_3x3')?.events).toContain('two_point')
    expect(getSportRules('volleyball')?.scoreUnit).toBe('sets')
  })
  it('derives configurable standings from confirmed results only', () => {
    const standings = calculateStandings(['a', 'b'], [{ homeTeamId: 'a', awayTeamId: 'b', homeScore: 2, awayScore: 0, confirmed: true }, { homeTeamId: 'b', awayTeamId: 'a', homeScore: 9, awayScore: 0, confirmed: false }], { pointsWin: 3, pointsDraw: 1, pointsLoss: 0, tieBreakers: ['goal_difference', 'goals_for'] })
    expect(standings[0]).toMatchObject({ teamId: 'a', points: 3, wins: 1 })
    expect(standings[1]).toMatchObject({ teamId: 'b', points: 0, played: 1 })
  })
})
