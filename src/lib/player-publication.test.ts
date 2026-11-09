import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPublishedPlayers, PUBLIC_PLAYER_FIELDS } from './publicData'
import { setPlayerPublication } from './playerWorkspace'

type RecordedCall = { table?: string; operation?: string; payload?: Record<string, unknown>; filters: [string, unknown][]; columns?: string }
function createRecordingClient(result: { data: unknown; error: { message: string } | null }): { client: SupabaseClient; call: RecordedCall } {
  const call: RecordedCall = { filters: [] }
  const chain: Record<string, unknown> = {}
  chain.update = (payload: Record<string, unknown>) => { call.operation = 'update'; call.payload = payload; return chain }
  chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain }
  chain.select = (columns: string) => { call.columns = columns; return chain }
  chain.order = () => chain
  chain.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(result).then(onFulfilled)
  const client = { from: (table: string) => { call.table = table; return chain } } as unknown as SupabaseClient
  return { client, call }
}

describe('player publication owner-only update', () => {
  it('updates only is_published and only for the signed-in owner profile', async () => {
    const { client, call } = createRecordingClient({ data: [{ id: 'player-1', is_published: true }], error: null })
    const result = await setPlayerPublication(client, 'user-1', 'player-1', true)
    expect(result.error).toBeNull()
    expect(call.table).toBe('player_profiles')
    expect(call.operation).toBe('update')
    expect(call.payload).toEqual({ is_published: true })
    expect(call.filters).toEqual(expect.arrayContaining([['id', 'player-1'], ['account_id', 'user-1']]))
    expect(call.columns).toBe('id,is_published')
  })
  it('reports failure when no owner-linked row was updated', async () => {
    const { client } = createRecordingClient({ data: [], error: null })
    const result = await setPlayerPublication(client, 'user-1', 'someone-else', false)
    expect(result.error).toMatch(/only the signed-in owner/i)
  })
  it('surfaces database errors without publishing', async () => {
    const { client } = createRecordingClient({ data: null, error: { message: 'permission denied for table player_profiles' } })
    const result = await setPlayerPublication(client, 'user-1', 'player-1', true)
    expect(result.error).toContain('permission denied')
  })
})

describe('guest visibility boundary', () => {
  const policySql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210001_foundation.sql'), 'utf8')
  const ownerSql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210010_onboarding_invitations.sql'), 'utf8')
  it('guests read only published player profiles', () => {
    expect(policySql).toContain('"published players are public" on public.player_profiles for select using (is_published or account_id = auth.uid())')
  })
  it('publication updates run only through the owner-scoped authenticated policy', () => {
    expect(ownerSql).toContain('"players update own profile fields" on public.player_profiles for update to authenticated using (account_id = auth.uid()) with check (account_id = auth.uid())')
    expect(ownerSql).not.toMatch(/player_profiles for update to anon/)
  })
  it('public player listing requests all player rows and approved fields', async () => {
    const { client, call } = createRecordingClient({ data: [], error: null })
    await getPublishedPlayers(client)
    expect(call.table).toBe('player_profiles')
    expect(call.filters).toEqual([])
    expect(call.columns).toBe(PUBLIC_PLAYER_FIELDS)
  })
})
