import { describe, expect, it } from 'vitest'
import {
  computePlayerRating, formatRating, RATING_MAX, RATING_MIN_APPEARANCES,
  totalOfficialStatistics,
} from './playerRating'

describe('official statistics totals', () => {
  it('sums confirmed rows and ignores missing values', () => {
    const totals = totalOfficialStatistics([
      { appearances: 3, goals: 2, assists: 1, yellow_cards: 1, red_cards: 0 },
      { appearances: 2, goals: null, assists: 0, yellow_cards: 0, red_cards: 1 },
    ])
    expect(totals).toEqual({ appearances: 5, goals: 2, assists: 1, yellow: 1, red: 1 })
  })
  it('returns zero totals for no rows', () => {
    expect(totalOfficialStatistics([])).toEqual({ appearances: 0, goals: 0, assists: 0, yellow: 0, red: 0 })
  })
})

describe('player rating formula', () => {
  it('reports insufficient data below the confirmed-appearance threshold', () => {
    const result = computePlayerRating({ appearances: RATING_MIN_APPEARANCES - 1, goals: 5, assists: 5, yellow: 0, red: 0 })
    expect(result.status).toBe('insufficient_data')
    if (result.status === 'insufficient_data') expect(result.reason).toContain(String(RATING_MIN_APPEARANCES))
    expect(formatRating(result)).toBe('Insufficient data')
  })
  it('computes the documented formula from confirmed totals', () => {
    // base 6 + (4/4)*1.5 + (2/4)*1 - (1/4)*0.5 - (0/4)*1.5 = 6 + 1.5 + 0.5 - 0.125 = 7.875 -> 7.88
    const result = computePlayerRating({ appearances: 4, goals: 4, assists: 2, yellow: 1, red: 0 })
    expect(result.status).toBe('rated')
    if (result.status === 'rated') {
      expect(result.value).toBe(7.88)
      expect(result.stars).toBe(4)
      expect(result.appearances).toBe(4)
    }
  })
  it('penalises cards and clamps to the documented range', () => {
    // 6 − (3/3)*0.5 − (3/3)*1.5 = 4.0 — cards can only reduce, never below the floor
    const harsh = computePlayerRating({ appearances: 3, goals: 0, assists: 0, yellow: 3, red: 3 })
    expect(harsh.status).toBe('rated')
    if (harsh.status === 'rated') {
      expect(harsh.value).toBe(4)
      expect(harsh.stars).toBe(2)
    }
    const stellar = computePlayerRating({ appearances: 3, goals: 30, assists: 10, yellow: 0, red: 0 })
    expect(stellar.status).toBe('rated')
    if (stellar.status === 'rated') {
      expect(stellar.value).toBe(RATING_MAX)
      expect(stellar.stars).toBe(5)
    }
  })
  it('never produces a rating from zero appearances', () => {
    const result = computePlayerRating({ appearances: 0, goals: 0, assists: 0, yellow: 0, red: 0 })
    expect(result.status).toBe('insufficient_data')
  })
})
