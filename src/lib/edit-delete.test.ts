import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { deleteFixture, deletableFixture, updateIncident } from './tournamentPages'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202611040048_delete_unplayed_fixture.sql'), 'utf8')
const rpcClient = (error: string | null, calls: string[] = []) => ({ rpc: (name: string) => { calls.push(name); return Promise.resolve({ data: null, error: error ? { message: error } : null }) } }) as unknown as SupabaseClient
function updateClient(rows: unknown[], filters: Array<[string, unknown]> = []) {
  const chain: Record<string, unknown> = { update: () => chain, eq: (column: string, value: unknown) => { filters.push([column, value]); return chain }, select: () => chain, then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }) }
  return { from: () => chain } as unknown as SupabaseClient
}

describe('deleting fixtures', () => {
  it('offers delete only for unplayed fixtures', () => {
    expect(['scheduled', 'postponed', 'cancelled'].every(status => deletableFixture({ status }))).toBe(true)
    expect(['live', 'awaiting_confirmation', 'confirmed', 'abandoned'].some(status => deletableFixture({ status }))).toBe(false)
  })

  it('needs a reason and never calls the server without one', async () => {
    const calls: string[] = []
    expect((await deleteFixture(rpcClient(null, calls), 'm1', 'no')).error).toMatch(/reason/)
    expect(calls).toEqual([])
  })

  it('explains every refusal in plain words', async () => {
    expect((await deleteFixture(rpcClient('match_has_results'), 'm1', 'Added by mistake')).error).toMatch(/already has a result/)
    expect((await deleteFixture(rpcClient('match_feeds_later_round'), 'm1', 'Added by mistake')).error).toMatch(/later knockout round/)
    expect((await deleteFixture(rpcClient('function public.delete_fixture does not exist'), 'm1', 'Added by mistake')).error).toMatch(/048/)
    expect((await deleteFixture(rpcClient(null), 'm1', 'Added by mistake')).error).toBeNull()
  })

  it('is guarded in the database for every delete path and logged with its reason', () => {
    expect(sql).toContain('before delete on public.matches for each row execute function public.protect_played_match()')
    expect(sql).toContain("raise exception 'match_has_results'")
    expect(sql).toContain("'fixture_deleted'")
    expect(sql).toContain('revoke execute on function public.delete_fixture(uuid, text) from public, anon')
  })
})

describe('editing incidents', () => {
  it('edits open incidents only', async () => {
    const filters: Array<[string, unknown]> = []
    expect((await updateIncident(updateClient([{ id: 'i1' }], filters), 'i1', { category: 'injury', severity: 'high', description: 'Ankle injury in the 30th minute' })).error).toBeNull()
    expect(filters).toContainEqual(['status', 'open'])
    expect((await updateIncident(updateClient([]), 'i1', { category: 'injury', severity: 'high', description: 'Ankle injury' })).error).toMatch(/already resolved/)
    expect((await updateIncident(updateClient([]), 'i1', { category: 'nonsense', severity: 'low', description: 'Something happened' })).error).toMatch(/category/)
  })
})

describe('destructive buttons ask first', () => {
  it('no workspace button deletes, removes or revokes on the first click', () => {
    const dir = resolve(process.cwd(), 'src/components')
    const offenders = readdirSync(dir).filter(name => name.endsWith('.tsx') && !name.startsWith('Admin')).flatMap(name => {
      const source = readFileSync(resolve(dir, name), 'utf8')
      return [...source.matchAll(/<button[^>]*onClick=\{\(\) => (?:void )?(?:remove|delete|revoke|removeAccess)[A-Za-z]*\([^)]*\)\}[^>]*>/g)]
        .filter(match => !/primary-button/.test(match[0])) // the "Yes/Remove" button inside a confirmation is allowed
        .map(match => `${name}: ${match[0].slice(0, 80)}`)
    })
    expect(offenders).toEqual([])
  })
})
