import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRateLimiter, MAX_LIMIT, parseApiRequest } from '../../supabase/functions/public-api/router'

const source = readFileSync(resolve(process.cwd(), 'supabase/functions/public-api/index.ts'), 'utf8')

describe('public API routes', () => {
  it('is read-only', () => {
    expect(parseApiRequest('POST', '/v1/tournaments', '')).toEqual({ ok: false, status: 405, error: expect.any(String) })
    expect(parseApiRequest('DELETE', '/v1/teams/x', '').ok).toBe(false)
  })

  it('maps versioned paths to resources', () => {
    expect(parseApiRequest('GET', '/v1/tournaments', '?limit=10&offset=20&sport=futsal')).toEqual({ ok: true, route: { resource: 'tournaments', limit: 10, offset: 20, sport: 'futsal' } })
    expect(parseApiRequest('GET', '/v1/tournaments/k-cup/results', '')).toEqual({ ok: true, route: { resource: 'tournament-results', slug: 'k-cup', limit: 25, offset: 0 } })
    expect(parseApiRequest('GET', '/v1/tournaments/k-cup/standings', '')).toEqual({ ok: true, route: { resource: 'tournament-standings', slug: 'k-cup' } })
    expect(parseApiRequest('GET', '/v1/teams/new-radiant', '')).toEqual({ ok: true, route: { resource: 'team', slug: 'new-radiant' } })
    expect(parseApiRequest('GET', '', '')).toEqual({ ok: true, route: { resource: 'index' } })
  })

  it('rejects bad paging, sports, identifiers and versions', () => {
    expect(parseApiRequest('GET', '/v1/teams', `?limit=${MAX_LIMIT + 1}`).ok).toBe(false)
    expect(parseApiRequest('GET', '/v1/teams', '?offset=-1').ok).toBe(false)
    expect(parseApiRequest('GET', '/v1/teams', '?sport=cricket').ok).toBe(false)
    expect(parseApiRequest('GET', "/v1/tournaments/x'%20or%201=1", '').ok).toBe(false)
    expect(parseApiRequest('GET', '/v2/tournaments', '')).toMatchObject({ ok: false, status: 404 })
    expect(parseApiRequest('GET', '/v1/players', '')).toMatchObject({ ok: false, status: 404 })
  })

  it('rate-limits bursts per caller', () => {
    const allow = createRateLimiter(2, 1000)
    expect(allow('a', 0).allowed).toBe(true)
    expect(allow('a', 1).allowed).toBe(true)
    expect(allow('a', 2)).toEqual({ allowed: false, retryAfter: 1 })
    expect(allow('b', 2).allowed).toBe(true)
    expect(allow('a', 1001).allowed).toBe(true)
  })

  it('can never read private data', () => {
    expect(source).not.toContain('SERVICE_ROLE')
    expect(source).toContain("Deno.env.get('SUPABASE_ANON_KEY')")
    expect(source).not.toContain('console.log')
    expect(source).not.toMatch(/select\(\s*['"]\*['"]/)
    // Only official results: confirmed matches and confirmed result versions.
    expect(source).toContain(".eq('status', 'confirmed')")
    for (const column of ['phone', 'email', 'national', 'digest', 'birth', 'account_id', 'agreement_notes']) expect(source).not.toContain(column)
  })
})
