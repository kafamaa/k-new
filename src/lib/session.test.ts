import { describe, expect, it } from 'vitest'
import { isSessionExpiredError } from './supabase'

describe('session recovery', () => {
  it('recognizes expired and invalid refresh sessions', () => {
    expect(isSessionExpiredError('JWT expired')).toBe(true)
    expect(isSessionExpiredError('refresh token not found')).toBe(true)
    expect(isSessionExpiredError('network unavailable')).toBe(false)
  })
})
