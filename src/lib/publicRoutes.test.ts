import { describe, expect, it } from 'vitest'
import { parsePublicHash } from './publicRoutes'

describe('public route behavior', () => {
  it('parses collections and stable slug/ID detail routes', () => {
    expect(parsePublicHash('')).toEqual({ kind: 'home' })
    expect(parsePublicHash('#home')).toEqual({ kind: 'home' })
    expect(parsePublicHash('#workspace')).toEqual({ kind: 'workspace' })
    expect(parsePublicHash('#tournaments')).toEqual({ kind: 'tournaments' })
    expect(parsePublicHash('#teams/real-team')).toEqual({ kind: 'team', slug: 'real-team' })
    expect(parsePublicHash('#organization/real-organization')).toEqual({ kind: 'organization', slug: 'real-organization' })
    expect(parsePublicHash('#matches/123')).toEqual({ kind: 'match', slug: '123' })
    expect(parsePublicHash('#history/player-one')).toEqual({ kind: 'history', slug: 'player-one' })
    expect(parsePublicHash('#standings')).toEqual({ kind: 'standings' })
    expect(parsePublicHash('#search?q=real%20team')).toEqual({ kind: 'search', query: 'real team' })
  })
  // Unknown multi-part links now open a "Page not found" page instead of
  // silently showing Home; one-word hashes remain in-page anchors.
  it('does not invent a route for malformed hashes', () => { expect(parsePublicHash('#private/settings')).toEqual({ kind: 'not-found' }); expect(parsePublicHash('#unknown')).toEqual({ kind: 'home' }) })
})
