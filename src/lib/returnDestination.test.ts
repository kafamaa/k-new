import { describe, expect, it } from 'vitest'
import { clearReturnDestination, loadReturnDestination, parseReturnDestinationFromHash, returnDestinationHash, saveReturnDestination, validateReturnDestination } from './returnDestination'

describe('returnDestination safety', () => {
  it('validates and round-trips a safe destination', () => {
    const destination = validateReturnDestination({ route: 'registration', tournamentSlug: 'real-tournament', category: 'cat-1', createdAt: Date.now() })
    expect(destination).not.toBeNull()
    expect(destination!.tournamentSlug).toBe('real-tournament')
    expect(destination!.category).toBe('cat-1')
  })
  it('rejects external or malformed destinations', () => {
    expect(validateReturnDestination({ route: 'registration', tournamentSlug: 'https://evil.example' })).toBeNull()
    expect(validateReturnDestination({ route: 'registration', tournamentSlug: '../secret' })).toBeNull()
    expect(validateReturnDestination({ route: 'home', tournamentSlug: 'real-tournament' })).toBeNull()
    expect(validateReturnDestination(null)).toBeNull()
  })
  it('parseReturnDestinationFromHash accepts only internal register routes', () => {
    const parsed = parseReturnDestinationFromHash('#register/real-tournament?category=cat-1')
    expect(parsed?.tournamentSlug).toBe('real-tournament')
    expect(parsed?.category).toBe('cat-1')
    expect(parseReturnDestinationFromHash('#register/https://evil.example')).toBeNull()
  })
  it('returnDestinationHash round-trips', () => {
    const destination = validateReturnDestination({ route: 'registration', tournamentSlug: 'real-tournament', createdAt: Date.now() })!
    expect(returnDestinationHash(destination)).toBe('#register/real-tournament')
  })
  it('save/load/clear round-trips through sessionStorage', () => {
    const store: Record<string, string> = {}
    ;(globalThis as { window?: unknown }).window = { sessionStorage: {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
    } }
    saveReturnDestination({ tournamentSlug: 'real-tournament' })
    const loaded = loadReturnDestination()
    expect(loaded?.tournamentSlug).toBe('real-tournament')
    clearReturnDestination()
    expect(loadReturnDestination()).toBeNull()
    delete (globalThis as { window?: unknown }).window
  })
})
