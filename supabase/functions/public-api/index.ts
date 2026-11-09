// Read-only public API (unified plan section 24). It uses ONLY the anonymous
// key, so the database's published-record policies decide what is visible -
// exactly as for a signed-out visitor of the website - and every response is
// built from an explicit column allowlist below. Results are official
// (confirmed) only; live/provisional scores are not part of the API.
//
// Required secrets: SUPABASE_URL, SUPABASE_ANON_KEY (both public values).
// No service-role key: this function can never read private data.
// Never log request bodies or IP addresses.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { API_VERSION, createRateLimiter, parseApiRequest, type ApiRoute } from './router.ts'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, x-client-info, content-type',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
}
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } })
const limiter = createRateLimiter(120, 60_000)

// Column allowlists: the same fields the public website shows.
const TOURNAMENT_FIELDS = 'id,name,slug,sport,status,starts_at,island'
const TEAM_FIELDS = 'id,name,slug,team_type,island,logo_url'
const MATCH_FIELDS = 'id,scheduled_at,venue,status,home_team_id,away_team_id'
const STANDING_FIELDS = 'stage_id,team_id,played,wins,draws,losses,scored,conceded,points'

type Client = ReturnType<typeof createClient>

async function tournamentBySlug(client: Client, slug: string) {
  const result = await client.from('tournaments').select(TOURNAMENT_FIELDS).eq('slug', slug).maybeSingle()
  return result
}

async function handle(client: Client, route: ApiRoute): Promise<Response> {
  switch (route.resource) {
    case 'index':
      return json({ version: API_VERSION, endpoints: [`/${API_VERSION}/tournaments`, `/${API_VERSION}/tournaments/{slug}`, `/${API_VERSION}/tournaments/{slug}/results`, `/${API_VERSION}/tournaments/{slug}/standings`, `/${API_VERSION}/teams`, `/${API_VERSION}/teams/{slug}`], notes: 'Published records only. Results are official (confirmed) results. Times are UTC; display them in Maldives time (UTC+5).' })
    case 'tournaments':
    case 'teams': {
      const table = route.resource
      let query = client.from(table).select(table === 'tournaments' ? TOURNAMENT_FIELDS : TEAM_FIELDS, { count: 'exact' }).eq('is_published', true)
      if (route.sport) query = table === 'tournaments' ? query.eq('sport', route.sport) : query.contains('sports', [route.sport])
      const result = await query.order(table === 'tournaments' ? 'starts_at' : 'name', { ascending: table !== 'tournaments', nullsFirst: false }).range(route.offset, route.offset + route.limit - 1)
      if (result.error) return json({ error: 'Temporarily unavailable.' }, 503)
      return json({ data: result.data ?? [], paging: { limit: route.limit, offset: route.offset, total: result.count ?? null } })
    }
    case 'team': {
      const result = await client.from('teams').select(TEAM_FIELDS).eq('slug', route.slug).eq('is_published', true).maybeSingle()
      if (result.error) return json({ error: 'Temporarily unavailable.' }, 503)
      return result.data ? json({ data: result.data }) : json({ error: 'Not found.' }, 404)
    }
    case 'tournament': {
      const result = await tournamentBySlug(client, route.slug)
      if (result.error) return json({ error: 'Temporarily unavailable.' }, 503)
      return result.data ? json({ data: result.data }) : json({ error: 'Not found.' }, 404)
    }
    case 'tournament-results': {
      const tournament = await tournamentBySlug(client, route.slug)
      if (tournament.error) return json({ error: 'Temporarily unavailable.' }, 503)
      if (!tournament.data) return json({ error: 'Not found.' }, 404)
      const matches = await client.from('matches').select(MATCH_FIELDS, { count: 'exact' }).eq('tournament_id', (tournament.data as { id: string }).id).eq('status', 'confirmed').order('scheduled_at', { ascending: false, nullsFirst: false }).range(route.offset, route.offset + route.limit - 1)
      if (matches.error) return json({ error: 'Temporarily unavailable.' }, 503)
      const rows = (matches.data ?? []) as Array<{ id: string; home_team_id: string | null; away_team_id: string | null }>
      const ids = rows.map(row => row.id)
      const versions = ids.length ? await client.from('match_result_versions').select('match_id,version,score').in('match_id', ids).eq('status', 'confirmed').order('version', { ascending: false }) : { data: [], error: null }
      if (versions.error) return json({ error: 'Temporarily unavailable.' }, 503)
      const latest = new Map<string, unknown>()
      for (const version of (versions.data ?? []) as Array<{ match_id: string; score: unknown }>) if (!latest.has(version.match_id)) latest.set(version.match_id, version.score)
      const teamIds = [...new Set(rows.flatMap(row => [row.home_team_id, row.away_team_id]).filter((id): id is string => Boolean(id)))]
      const teams = teamIds.length ? await client.from('teams').select('id,name,slug').in('id', teamIds) : { data: [], error: null }
      const names = new Map(((teams.data ?? []) as Array<{ id: string; name: string; slug: string }>).map(team => [team.id, { name: team.name, slug: team.slug }]))
      const score = (value: unknown) => { const raw = value as { home?: unknown; away?: unknown } | null; return raw && typeof raw.home === 'number' && typeof raw.away === 'number' ? { home: raw.home, away: raw.away } : null }
      return json({
        data: rows.map(row => ({ ...row, home_team: row.home_team_id ? names.get(row.home_team_id) ?? null : null, away_team: row.away_team_id ? names.get(row.away_team_id) ?? null : null, score: score(latest.get(row.id)), official: true })),
        paging: { limit: route.limit, offset: route.offset, total: matches.count ?? null },
      })
    }
    case 'tournament-standings': {
      const tournament = await tournamentBySlug(client, route.slug)
      if (tournament.error) return json({ error: 'Temporarily unavailable.' }, 503)
      if (!tournament.data) return json({ error: 'Not found.' }, 404)
      const stages = await client.from('competition_stages').select('id,name').eq('tournament_id', (tournament.data as { id: string }).id)
      if (stages.error) return json({ error: 'Temporarily unavailable.' }, 503)
      const stageIds = ((stages.data ?? []) as Array<{ id: string }>).map(stage => stage.id)
      const rows = stageIds.length ? await client.from('standings_snapshots').select(STANDING_FIELDS).in('stage_id', stageIds).order('points', { ascending: false }) : { data: [], error: null }
      if (rows.error) return json({ error: 'Temporarily unavailable.' }, 503)
      return json({ data: { stages: stages.data ?? [], rows: rows.data ?? [] }, notes: 'Rows are ordered by points only; apply the tournament tie-breakers for final positions.' })
    }
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  const url = new URL(request.url)
  const after = url.pathname.split('/public-api')[1] ?? ''
  const parsed = parseApiRequest(request.method, after, url.search)
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status)
  const caller = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const gate = limiter(caller, Date.now())
  if (!gate.allowed) return json({ error: 'Too many requests. Try again shortly.' }, 429, { 'Retry-After': String(gate.retryAfter) })
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
    const response = await handle(client, parsed.route)
    if (response.status === 200) response.headers.set('Cache-Control', 'public, max-age=60')
    return response
  } catch {
    return json({ error: 'Temporarily unavailable.' }, 503)
  }
})
