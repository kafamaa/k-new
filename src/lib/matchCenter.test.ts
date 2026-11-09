import { describe, expect, it } from 'vitest'
import { EVENT_TYPES } from './matchCenter'

describe('match center rules', () => {
  it('exposes only sport-specific event types', () => {
    expect(EVENT_TYPES.football).toContain('goal')
    expect(EVENT_TYPES.futsal).toContain('team_foul')
    expect(EVENT_TYPES.handball).toContain('two_minute_suspension')
    expect(EVENT_TYPES.volleyball).toContain('ace')
    expect(EVENT_TYPES.basketball_3x3).toContain('two_point')
    expect(EVENT_TYPES.volleyball).not.toContain('yellow_card')
  })
})
