import { describe, expect, it } from 'vitest'
import { calculateOfficialPlayerStats } from './statistics'
import { financeStatusTransitionAllowed } from './finance'
import { reportColumns } from './reports'
import { nextDeliveryState } from './notifications'
import { validateSetupStep } from './tournament'

describe('local acceptance journey contracts', () => {
  it('organizer draft setup remains resumable and validates before saving', () => {
    expect(validateSetupStep(1, { name: 'Real tournament' })).toBeNull()
    expect(validateSetupStep(3, { opensAt: '2026-01-01', closesAt: '2026-01-02' })).toBeNull()
  })
  it('confirmed result history flows into stats while finance and email remain scoped states', () => {
    const stats = calculateOfficialPlayerStats([{ matchId: 'm', tournamentId: 't', sport: 'football', teamId: 'team', teamName: 'Authorized team', teamType: 'club', playerId: 'player', starter: true, minutes: 90, events: [{ type: 'goal' }], confirmed: true }])
    expect(stats[0].goals).toBe(1)
    expect(financeStatusTransitionAllowed('submitted', 'approved')).toBe(true)
    expect(reportColumns('finance', false)).toEqual([])
    expect(nextDeliveryState('email', false)).toBe('queued')
  })
})
