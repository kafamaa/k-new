import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { canAppeal, fileProtest, loadProtests, openProtestCount, PENDING_046, protestInputProblem, protestProblem, type Protest } from './protests'
import { deliverableProblem, deliverableSummary, isOverdue, loadDeliverables, maldivesToday, PENDING_DELIVERABLES, type Deliverable } from './sponsorDeliverables'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202611030046_sponsor_deliverables_and_protests.sql'), 'utf8')

// Minimal stand-in for the Supabase client: every query resolves to `result`.
function fakeClient(result: { data?: unknown; error?: { message: string } | null }, calls: Array<{ rpc: string; args: unknown }> = []): SupabaseClient {
  const chain: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'order', 'insert', 'update', 'delete']) chain[name] = () => chain
  chain.then = (resolve: (value: unknown) => void) => resolve({ data: result.data ?? null, error: result.error ?? null })
  return { from: () => chain, rpc: (rpc: string, args: unknown) => { calls.push({ rpc, args }); return Promise.resolve({ data: null, error: result.error ?? null }) } } as unknown as SupabaseClient
}

const protest = (over: Partial<Protest>): Protest => ({
  id: 'p1', tournamentId: 't', matchId: null, teamId: 'team', teamName: 'Team', kind: 'protest', appealOf: null,
  subject: 'Ineligible player', grounds: 'x'.repeat(30), status: 'submitted', decision: null, decidedAt: null, createdAt: '2026-11-01', ...over,
})

describe('protests', () => {
  it('checks title and grounds before sending', () => {
    expect(protestInputProblem({ subject: 'Bad', grounds: 'x'.repeat(30) })).toMatch(/title/)
    expect(protestInputProblem({ subject: 'Ineligible', grounds: 'too short' })).toMatch(/20 characters/)
    expect(protestInputProblem({ subject: 'Ineligible', grounds: 'x'.repeat(20) })).toBeNull()
  })

  it('never sends an invalid protest to the server', async () => {
    const calls: Array<{ rpc: string; args: unknown }> = []
    const result = await fileProtest(fakeClient({}, calls), { tournamentId: 't', teamId: 'team', matchId: null, subject: 'Bad', grounds: '' })
    expect(result.error).toBeTruthy()
    expect(calls).toEqual([])
  })

  it('turns server codes into plain words', () => {
    expect(protestProblem('ERROR: team_not_in_tournament')).toMatch(/approved entry/)
    expect(protestProblem('ERROR: already_appealed')).toMatch(/already been appealed/)
    expect(protestProblem('function public.file_tournament_protest does not exist')).toBe(PENDING_046)
  })

  it('reports a missing migration as pending, not as an error or an empty list', async () => {
    const result = await loadProtests(fakeClient({ error: { message: 'relation "public.tournament_protests" does not exist' } }), { tournamentId: 't' })
    expect(result.state).toBe('pending')
  })

  it('allows one appeal, only after a decision', () => {
    const decided = protest({ status: 'rejected', decidedAt: '2026-11-02' })
    expect(canAppeal(protest({}), [])).toBe(false)
    expect(canAppeal(decided, [decided])).toBe(true)
    expect(canAppeal(decided, [decided, protest({ id: 'a1', kind: 'appeal', appealOf: 'p1' })])).toBe(false)
    expect(canAppeal(decided, [decided, protest({ id: 'a1', kind: 'appeal', appealOf: 'p1', status: 'withdrawn' })])).toBe(true)
  })

  it('counts only open protests', () => {
    expect(openProtestCount([protest({}), protest({ status: 'under_review' }), protest({ status: 'upheld' }), protest({ status: 'withdrawn' })])).toBe(2)
  })

  it('keeps protests private and changes only through checked functions', () => {
    expect(sql).toContain('using (public.is_tournament_operator(tournament_id) or public.is_team_manager(team_id))')
    expect(sql).not.toMatch(/on public\.tournament_protests for (insert|update|delete)/)
    expect(sql).toContain("raise exception 'decision_reason_required'")
    expect(sql).toContain('revoke execute on function public.file_tournament_protest(uuid, uuid, uuid, text, text, uuid) from public, anon')
  })
})

describe('sponsor deliverables', () => {
  const item = (over: Partial<Deliverable>): Deliverable => ({ id: '1', sponsorId: 's', kind: 'banner', title: 'Banner', dueOn: null, status: 'pending', note: null, deliveredAt: null, ...over })

  it('needs a description', () => {
    expect(deliverableProblem({ title: ' ', dueOn: '' })).toBeTruthy()
    expect(deliverableProblem({ title: 'Banner at ground', dueOn: '2026-11-20' })).toBeNull()
  })

  it('flags overdue items by the Maldives calendar day', () => {
    expect(isOverdue(item({ dueOn: '2026-11-02' }), '2026-11-03')).toBe(true)
    expect(isOverdue(item({ dueOn: '2026-11-03' }), '2026-11-03')).toBe(false)
    expect(isOverdue(item({ dueOn: '2026-11-02', status: 'delivered' }), '2026-11-03')).toBe(false)
    // 20:00 UTC on 3 Nov is already 4 Nov in the Maldives.
    expect(maldivesToday(new Date('2026-11-03T20:00:00Z'))).toBe('2026-11-04')
  })

  it('summarises without counting items marked not needed', () => {
    expect(deliverableSummary([item({ status: 'delivered' }), item({ status: 'waived' }), item({ dueOn: '2026-01-01' })], '2026-11-03')).toEqual({ total: 2, delivered: 1, overdue: 1 })
  })

  it('reports a missing migration as pending', async () => {
    const result = await loadDeliverables(fakeClient({ error: { message: 'Could not find the table public.tournament_sponsor_deliverables in the schema cache' } }), 't')
    expect(result.state).toBe('pending')
    expect(PENDING_DELIVERABLES).toMatch(/046/)
  })

  it('keeps deliverables with the same sponsor tournament and finance staff only', () => {
    expect(sql).toContain("raise exception 'sponsor_not_in_tournament'")
    expect(sql).toContain('create policy "finance staff read deliverables"')
  })
})
