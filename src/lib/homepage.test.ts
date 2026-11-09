import { describe, expect, it } from 'vitest'
import { REQUIRED_HOMEPAGE_SECTIONS, todayMatches } from './homepage'

describe('homepage published-data sections', () => {
  it('filters today matches without inventing records', () => {
    const now = new Date('2026-10-22T10:00:00Z')
    expect(todayMatches([{ id: 'today', scheduled_at: '2026-10-22T12:00:00Z' }, { id: 'old', scheduled_at: '2026-10-21T12:00:00Z' }, { id: 'unknown' }], now).map(match => match.id)).toEqual(['today'])
  })
  it('covers every required reference homepage data section', () => {
    expect(REQUIRED_HOMEPAGE_SECTIONS).toHaveLength(11)
    expect(REQUIRED_HOMEPAGE_SECTIONS).toContain('news')
    expect(REQUIRED_HOMEPAGE_SECTIONS).toContain('bracket')
  })
})
