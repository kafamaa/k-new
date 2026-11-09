import { describe, expect, it } from 'vitest'
import { STAFF_PERMISSIONS, canAssignStaff, TOURNAMENT_STAFF_ROLES, loadTournamentStaff, searchStaffCandidates } from './staff'
import type { SupabaseClient } from '@supabase/supabase-js'

// Per-table stub in the same style as the other suites: each table resolves
// its own rows, and the last ilike() value is captured for the search tests.
function createClient(tables: Record<string, unknown[]>): { client: SupabaseClient; lastIlike: () => string } {
  let capturedIlike = ''
  const client = {
    from: (table: string) => {
      const result = () => ({ data: tables[table] ?? [], error: null })
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.in = () => chain
      chain.is = () => chain
      chain.not = () => chain
      chain.ilike = (_column: string, value: string) => { capturedIlike = value; return chain }
      chain.order = () => chain
      chain.limit = () => chain
      chain.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(result()).then(onFulfilled)
      return chain
    },
  } as unknown as SupabaseClient
  return { client, lastIlike: () => capturedIlike }
}

describe('scoped staff permissions', () => {
  it('allows only organization owners/operations to manage assignments', () => {
    expect(canAssignStaff('owner')).toBe(true)
    expect(canAssignStaff('operations')).toBe(true)
    expect(canAssignStaff('finance')).toBe(false)
    expect(canAssignStaff('media')).toBe(false)
  })
  it('exposes only the documented task scopes', () => expect(STAFF_PERMISSIONS).toEqual(['registration', 'finance', 'media', 'operations', 'match_data']))
})

describe('tournament staff roles (plain-English table)', () => {
  it('gives every documented scope a human role label and an access summary', () => {
    expect(TOURNAMENT_STAFF_ROLES.operations.label).toBe('Tournament Manager')
    expect(TOURNAMENT_STAFF_ROLES.registration.label).toBe('Registration Officer')
    expect(TOURNAMENT_STAFF_ROLES.match_data.label).toBe('Match Operator')
    for (const scope of STAFF_PERMISSIONS) {
      expect(TOURNAMENT_STAFF_ROLES[scope].access.length).toBeGreaterThan(3)
      expect(TOURNAMENT_STAFF_ROLES[scope].summary('Test Cup 2021')).toContain('Test Cup 2021')
    }
  })
})

describe('tournament staff list', () => {
  it('maps assignment rows and resolves names from published player profiles', async () => {
    const { client } = createClient({
      tournament_staff_assignments: [{ user_id: 'u-1', permission: 'registration', assigned_by: 'boss', created_at: '2026-10-01' }],
      player_profiles: [{ display_name: 'Ali Shiyam', account_id: 'u-1' }],
    })
    const result = await loadTournamentStaff(client, 't-1')
    expect(result.error).toBeNull()
    expect(result.staff[0]).toEqual({ userId: 'u-1', permission: 'registration', assignedBy: 'boss', createdAt: '2026-10-01', name: 'Ali Shiyam' })
  })

  it('never invents a name: a member without a public profile stays null', async () => {
    const { client } = createClient({
      tournament_staff_assignments: [{ user_id: 'u-2', permission: 'operations', assigned_by: 'boss', created_at: '2026-10-02' }],
      player_profiles: [],
    })
    const result = await loadTournamentStaff(client, 't-1')
    expect(result.staff[0].name).toBeNull()
  })
})

describe('staff people search (honest directory limits)', () => {
  it('requires at least two letters before querying', async () => {
    let queried = false
    const client = { from: () => { queried = true; return {} } } as unknown as SupabaseClient
    const result = await searchStaffCandidates(client, 'a')
    expect(result.candidates).toEqual([])
    expect(queried).toBe(false)
  })
  it('strips filter-injection characters from the search term', async () => {
    const { client, lastIlike } = createClient({})
    await searchStaffCandidates(client, 'al%, ex')
    expect(lastIlike()).toBe('%al ex%')
  })
  it('maps published profiles with a linked account into candidates', async () => {
    const { client } = createClient({
      player_profiles: [
        { display_name: 'Aisha Hassan', slug: 'aisha-hassan-1', account_id: 'u-9' },
        { display_name: 'Unlinked Profile', slug: 'unlinked', account_id: null },
      ],
    })
    const result = await searchStaffCandidates(client, 'aisha')
    expect(result.candidates).toEqual([{ name: 'Aisha Hassan', slug: 'aisha-hassan-1', accountId: 'u-9' }])
  })
})
