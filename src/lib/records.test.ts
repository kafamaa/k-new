import { describe, expect, it } from 'vitest'
import { slugify } from './records'

describe('persistent record boundaries', () => {
  it('creates URL-safe slugs without identity data', () => {
    expect(slugify("Hulhumalé United / Women's Team")).toBe('hulhumal-united-women-s-team')
    expect(slugify('')).toBe('')
  })
  it('keeps human-readable slugs collision-safe for persisted workspaces', () => {
    expect(slugify('Same Team')).toBe('same-team')
    expect(slugify('Same Organization')).toBe('same-organization')
  })
  it('does not turn a blank invitation into an edge-function request', async () => {
    const { claimPlayer } = await import('./records')
    const result = await claimPlayer({} as never, '  ')
    expect(result).toEqual({ data: null, error: 'Invitation token is required.' })
  })
})
