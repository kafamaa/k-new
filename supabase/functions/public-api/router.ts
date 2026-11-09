// Pure request parsing for the read-only public API (unified plan section 24).
// No Deno or network imports, so it is unit-tested from the web app's suite.

export const API_VERSION = 'v1'
export const MAX_LIMIT = 100
export const DEFAULT_LIMIT = 25

export type ApiRoute =
  | { resource: 'index' }
  | { resource: 'tournaments'; limit: number; offset: number; sport: string | null }
  | { resource: 'tournament'; slug: string }
  | { resource: 'tournament-results'; slug: string; limit: number; offset: number }
  | { resource: 'tournament-standings'; slug: string }
  | { resource: 'teams'; limit: number; offset: number; sport: string | null }
  | { resource: 'team'; slug: string }

export type ParseResult = { ok: true; route: ApiRoute } | { ok: false; status: number; error: string }

const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/
const SPORTS = new Set(['football', 'futsal', 'handball', 'volleyball', 'basketball', 'basketball_3x3'])

function paging(params: URLSearchParams): { limit: number; offset: number } | string {
  const rawLimit = params.get('limit'); const rawOffset = params.get('offset')
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit)
  const offset = rawOffset === null ? 0 : Number(rawOffset)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return `limit must be a whole number from 1 to ${MAX_LIMIT}`
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) return 'offset must be a whole number from 0'
  return { limit, offset }
}

function sportParam(params: URLSearchParams): string | null | false {
  const sport = params.get('sport')
  if (sport === null || sport === '') return null
  return SPORTS.has(sport) ? sport : false
}

// `path` is everything after the function name, e.g. "/v1/tournaments/k-cup".
export function parseApiRequest(method: string, path: string, search: string): ParseResult {
  if (method !== 'GET' && method !== 'HEAD') return { ok: false, status: 405, error: 'Read-only API: only GET is allowed.' }
  const parts = path.split('/').filter(Boolean).map(part => decodeURIComponent(part))
  if (!parts.length) return { ok: true, route: { resource: 'index' } }
  if (parts[0] !== API_VERSION) return { ok: false, status: 404, error: `Unknown API version. Use /${API_VERSION}/.` }
  const params = new URLSearchParams(search)
  const [, collection, slug, sub] = parts
  if (!collection) return { ok: true, route: { resource: 'index' } }
  if (slug !== undefined && !SLUG.test(slug)) return { ok: false, status: 400, error: 'Invalid identifier.' }
  if (parts.length > 4) return { ok: false, status: 404, error: 'Not found.' }

  if (collection === 'tournaments' || collection === 'teams') {
    if (slug === undefined) {
      const page = paging(params); if (typeof page === 'string') return { ok: false, status: 400, error: page }
      const sport = sportParam(params); if (sport === false) return { ok: false, status: 400, error: 'Unknown sport.' }
      return { ok: true, route: { resource: collection, ...page, sport } }
    }
    if (collection === 'teams') return sub === undefined ? { ok: true, route: { resource: 'team', slug } } : { ok: false, status: 404, error: 'Not found.' }
    if (sub === undefined) return { ok: true, route: { resource: 'tournament', slug } }
    if (sub === 'results') { const page = paging(params); if (typeof page === 'string') return { ok: false, status: 400, error: page }; return { ok: true, route: { resource: 'tournament-results', slug, ...page } } }
    if (sub === 'standings') return { ok: true, route: { resource: 'tournament-standings', slug } }
  }
  return { ok: false, status: 404, error: 'Not found.' }
}

// Simple fixed-window limiter. Each Edge Function instance keeps its own
// counters, so this protects an instance from bursts; it is not a global quota.
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return (key: string, now: number): { allowed: boolean; retryAfter: number } => {
    const entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      if (hits.size > 10_000) hits.clear()
      hits.set(key, { count: 1, resetAt: now + windowMs })
      return { allowed: true, retryAfter: 0 }
    }
    entry.count += 1
    return entry.count <= limit ? { allowed: true, retryAfter: 0 } : { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
  }
}
