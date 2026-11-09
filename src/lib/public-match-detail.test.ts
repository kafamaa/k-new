import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPublishedMatch, getPublishedMatchLabels, PUBLIC_MATCH_FIELDS } from './publicData'

type RecordedCall = { table?: string; filters: [string, unknown][]; ids: unknown[] | null; columns?: string; order?: [string, boolean] }
function createRecordingClient(result: { data: unknown; error: { message: string } | null }): { client: SupabaseClient; call: RecordedCall } {
  const call: RecordedCall = { filters: [], ids: null }
  const chain: Record<string, unknown> = {}
  chain.select = (columns: string) => { call.columns = columns; return chain }
  chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain }
  chain.in = (column: string, ids: unknown[]) => { call.filters.push([column, ids]); call.ids = ids; return chain }
  chain.order = (column: string, opts?: { ascending?: boolean }) => { call.order = [column, opts?.ascending ?? true]; return chain }
  chain.maybeSingle = () => chain
  chain.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(result).then(onFulfilled)
  const client = { from: (table: string) => { call.table = table; return chain } } as unknown as SupabaseClient
  return { client, call }
}

describe('match detail loader (guest-visible data only)', () => {
  it('loads only the addressed match when its status is confirmed', async () => {
    const { client, call } = createRecordingClient({ data: null, error: null })
    await getPublishedMatch(client, 'match-uuid')
    expect(call.table).toBe('matches')
    expect(call.columns).toBe(PUBLIC_MATCH_FIELDS)
    expect(call.filters).toEqual([['id', 'match-uuid'], ['status', 'confirmed']])
  })
  it('never requests score, result-history, event, official, or account fields', () => {
    expect(PUBLIC_MATCH_FIELDS).not.toMatch(/score|submitted_by|confirmed_by|correction|payload|recorded_by|idempotency|assigned|created_by|note|document|payment|email/)
  })
})

describe('match detail label loader (only this fixture, published rows, real names)', () => {
  type LabelCall = { table: string; columns: string; filters: [string, unknown][]; ids: unknown[] | null }
  function createClient(tables: Record<string, unknown[]>): { client: SupabaseClient; calls: LabelCall[] } {
    const calls: LabelCall[] = []
    const client = {
      from: (table: string) => {
        const call: LabelCall = { table, columns: '', filters: [], ids: null }
        calls.push(call)
        const chain: Record<string, unknown> = {}
        chain.select = (columns: string) => { call.columns = columns; return chain }
        chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain }
        chain.in = (column: string, ids: unknown[]) => { call.ids = ids; return chain }
        chain.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(onFulfilled)
        return chain
      },
    } as unknown as SupabaseClient
    return { client, calls }
  }

  it('requests labels only for the ids referenced by this fixture, published rows only', async () => {
    const { client, calls } = createClient({
      teams: [{ id: 'team-1', name: 'Club A', slug: 'club-a' }],
      tournaments: [{ id: 'tourn-1', name: 'Ramadan Cup', slug: 'ramadan-cup', sport: 'football' }],
    })
    const match = { tournament_id: 'tourn-1', home_team_id: 'team-1', away_team_id: null }
    const result = await getPublishedMatchLabels(client, [match])
    const teams = calls.find(call => call.table === 'teams')
    const tournaments = calls.find(call => call.table === 'tournaments')
    expect(teams?.columns).toBe('id,name,slug,logo_url')
    expect(teams?.filters).toEqual([['is_published', true]])
    expect(teams?.ids).toEqual(['team-1'])
    expect(tournaments?.columns).toBe('id,name,slug,sport')
    expect(tournaments?.filters).toEqual([['is_published', true]])
    expect(tournaments?.ids).toEqual(['tourn-1'])
    expect(result.data?.teams['team-1']).toEqual({ name: 'Club A', slug: 'club-a', logo: null })
    expect(result.data?.tournaments['tourn-1']).toEqual({ name: 'Ramadan Cup', slug: 'ramadan-cup', sport: 'football' })
  })
  it('never stores a label without both a name and a slug, so no raw uuid can be shown', async () => {
    const { client } = createClient({
      teams: [{ id: 'team-1', name: '', slug: '' }],
      tournaments: [{ id: 'tourn-1', name: 'Ramadan Cup', slug: '' }],
    })
    const result = await getPublishedMatchLabels(client, [{ tournament_id: 'tourn-1', home_team_id: 'team-1', away_team_id: 'team-2' }])
    expect(result.data).toEqual({ teams: {}, tournaments: {} })
  })
  it('skips the teams query when the fixture references no team ids', async () => {
    const { client, calls } = createClient({ tournaments: [{ id: 'tourn-1', name: 'Ramadan Cup', slug: 'ramadan-cup', sport: 'football' }] })
    await getPublishedMatchLabels(client, [{ tournament_id: 'tourn-1', home_team_id: null, away_team_id: null }])
    expect(calls.map(call => call.table)).toEqual(['tournaments'])
  })
})

describe('why scores, events, officials, and stage names are unavailable to guests', () => {
  const base = resolve(process.cwd(), 'supabase/migrations')
  const engine = readFileSync(resolve(base, '202610210005_competition_engine.sql'), 'utf8')
  const split = readFileSync(resolve(base, '202610210011_public_rls_policy_split.sql'), 'utf8')

  it('has row level security enabled on the result and event tables', () => {
    expect(engine).toContain('alter table public.match_result_versions enable row level security')
    expect(engine).toContain('alter table public.match_events enable row level security')
    expect(engine).toContain('alter table public.match_official_assignments enable row level security')
    expect(engine).toContain('alter table public.competition_stages enable row level security')
    expect(engine).toContain('alter table public.tournament_categories enable row level security')
  })
  it('scopes every current result, event, official, stage, and category policy to authenticated users', () => {
    for (const table of ['match_result_versions', 'match_events', 'match_official_assignments', 'competition_stages', 'tournament_categories']) {
      const created = split.split('\n').map(line => line.trim()).filter(line => line.startsWith('create policy') && line.includes(`on public.${table}`))
      expect(created.length, `expected at least one create policy for ${table}`).toBeGreaterThan(0)
      for (const line of created) expect(line, line).toContain('to authenticated')
    }
  })
})

describe('match detail component (privacy, status/result handling, links, states)', () => {
  const page = readFileSync(resolve(process.cwd(), 'src/components/PublicPage.tsx'), 'utf8')
  const detail = page.slice(page.indexOf('function MatchPublicDetail('))

  it('is dispatched for the match route instead of the generic detail shell', () => {
    expect(page).toMatch(/route\.kind === 'match'\) return <MatchPublicDetail/)
    expect(page).not.toMatch(/route\.kind === 'match' \? <MatchPublicDetail/)
    expect(detail.length).toBeGreaterThan(0)
  })
  it('renders a resolved title and formatted schedule, never raw ids or ISO timestamps', () => {
    expect(detail).toContain('matchPairTitle(record, labels)')
    expect(detail).toContain('formatMatchSchedule(record.scheduled_at)')
    expect(detail).not.toContain('String(record.scheduled_at')
    expect(detail).not.toMatch(/stage_id|category_id|group_id|record\.id/)
  })
  it('never reads or renders result history, event metadata, or other private fields', () => {
    expect(detail).not.toMatch(/record\.(score|submitted_by|confirmed_by|correction_reason|payload|recorded_by|idempotency_key|created_by|account_id)/)
    expect(detail).toContain('never shown on public pages')
  })
  it('labels status from the record and never claims a score it cannot show', () => {
    expect(detail).toContain('matchStatusLabel(record.status)')
    expect(detail).toContain('matchStatusClass(record.status)')
    expect(detail).toContain('Official scores and match events are stored in confirmed result records')
    expect(detail).toContain('do not expose to guests')
    expect(detail).not.toMatch(/<dt>Score|record\.score/)
  })
  it('links both teams, the tournament, and back to the listing using slugs', () => {
    expect(detail).toContain('href={`#team/${encodeURIComponent(home.slug)}`}')
    expect(detail).toContain('href={`#team/${encodeURIComponent(away.slug)}`}')
    expect(detail).toContain('href={`#tournament/${encodeURIComponent(tournament.slug)}`}')
    expect(detail).toContain('href="#matches" label="Back to Matches"')
  })
  it('keeps truthful fallbacks for information the policies do not expose', () => {
    expect(detail).toContain("'Venue not published'")
    expect(detail).toContain("'Tournament not published'")
    expect(detail).toContain("'Published team'")
    expect(detail).toContain('current public data policies do not expose to guests')
  })
  it('has loading, label-failure, and parent error/not-found states', () => {
    expect(detail).toContain('!labelsReady ? <Loading />')
    expect(detail).toContain('public-home-warning')
    expect(page).toContain('if (loading) return')
    expect(page).toContain('if (error) return')
    expect(page).toMatch(/if \(!data\) return[\s\S]*?<NotFound/)
  })
  it('is view-only for guests: no buttons, inputs, mutations, or auth actions', () => {
    expect(detail).not.toContain('<button')
    expect(detail).not.toMatch(/<(input|select|textarea)/)
    expect(detail).not.toMatch(/\.(insert|update|delete|upsert)\(/)
    expect(detail).not.toContain('signOut')
  })
})
