import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { deleteManagedRecord, deletionError, deletionProblem } from './managedDeletion'

describe('management record deletion', () => {
  it('requires the name and bounded reason before sending any request', async () => {
    let calls = 0
    const client = { rpc: async () => { calls++; return { error: null } } } as unknown as SupabaseClient
    expect(deletionProblem('Island Cup', 'Other Cup', 'Duplicate record')).toMatch(/full name/)
    expect(deletionProblem('Island Cup', 'Island Cup', 'x'.repeat(501))).toMatch(/500/)
    expect((await deleteManagedRecord(client, 'tournament', 't1', 'Island Cup', '', 'Duplicate record')).error).toBeTruthy()
    expect(calls).toBe(0)
  })
  it('uses the atomic endpoint and sends only the id and reason', async () => {
    const calls: unknown[] = []
    const client = { rpc: async (...args: unknown[]) => { calls.push(args); return { error: null } } } as unknown as SupabaseClient
    expect((await deleteManagedRecord(client, 'player', 'p1', 'Ali', ' Ali ', ' Duplicate record ')).error).toBeNull()
    expect((await deleteManagedRecord(client, 'tournament', 't1', 'Cup', 'Cup', 'Created in error')).error).toBeNull()
    expect(calls).toEqual([['delete_unused_player', { p_id: 'p1', p_reason: 'Duplicate record' }], ['delete_unused_tournament', { p_id: 't1', p_reason: 'Created in error' }]])
  })
  it('explains migration, permission and history refusals without reporting success', async () => {
    for (const [server, words] of [['permission_required', /permission/], ['record_has_dependencies', /history/], ['player_not_unused', /24 hours/], ['tournament_not_unused', /archive/], ['record_not_found', /no longer exists/], ['PGRST202 schema cache', /migration/]] as const) {
      const client = { rpc: async () => ({ error: { message: server } }) } as unknown as SupabaseClient
      expect((await deleteManagedRecord(client, 'player', 'p1', 'Ali', 'Ali', 'Duplicate record')).error).toMatch(words)
    }
    expect(deletionError('private server detail')).not.toContain('private server detail')
  })
  it('treats network failures as failure', async () => {
    const client = { rpc: async () => { throw new Error('offline') } } as unknown as SupabaseClient
    expect((await deleteManagedRecord(client, 'player', 'p1', 'Ali', 'Ali', 'Duplicate record')).error).toMatch(/connection/)
  })
})
