import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { playerWorkspace } from './workspace'
import {
  aggregateTournamentStatistics, attentionItems, currentMembership, filterOfficialStatistics,
  markNotificationRead, playerRatingFromStatistics, profileCompletion, splitMatchesByTime,
  submitCorrectionRequest, submitTeamRequest, updatePlayerProfileDetails,
} from './playerWorkspace'

describe('player workspace account linking', () => {
  it('maps the existing account-linked profile to a player workspace without creating a record', () => {
    const profile = { id: 'player-1', display_name: 'Real Player', slug: 'real-player' }
    expect(playerWorkspace(profile)).toEqual({ id: 'player-1', name: 'Real Player', slug: 'real-player', role: 'player', kind: 'player' })
  })
  it('returns the same workspace identity after reload', () => {
    const profile = { id: 'player-1', display_name: 'Real Player', slug: 'real-player' }
    expect(playerWorkspace(profile).id).toBe('player-1')
  })
})

describe('profile completion', () => {
  it('counts only real profile facts', () => {
    const done = profileCompletion({ display_name: 'Real Player', island: 'Malé', photo_url: 'https://example.test/p.jpg', is_claimed: true }, true)
    expect(done.percent).toBe(100)
    expect(done.missing).toHaveLength(0)
  })
  it('lists exactly what is missing', () => {
    const partial = profileCompletion({ display_name: 'Real Player', island: '', photo_url: null, is_claimed: false }, false)
    expect(partial.completed).toBe(1)
    expect(partial.missing).toEqual(['Island', 'Photo', 'Team membership', 'Claimed profile'])
  })
})

describe('attention items', () => {
  const base = { completion: profileCompletion({ display_name: 'P', island: 'L', photo_url: 'u', is_claimed: true }, true), unreadNotifications: 0, pendingCorrections: 0, pendingTeamRequests: 0, unavailable: [] as string[], pendingSchema: [] as string[] }
  it('stays empty when nothing needs action', () => {
    expect(attentionItems({ ...base, profile: { is_claimed: true, is_published: true } })).toEqual([])
  })
  it('surfaces claim, publication, and pending-migration actions', () => {
    const items = attentionItems({ ...base, profile: { is_claimed: false, is_published: false }, unreadNotifications: 2, pendingCorrections: 1, unavailable: ['Team history'], pendingSchema: ['Correction requests'] })
    expect(items.some(item => item.includes('Claim your profile'))).toBe(true)
    expect(items.some(item => item.includes('private'))).toBe(true)
    expect(items.some(item => item.includes('2 unread'))).toBe(true)
    expect(items.some(item => item.includes('1 correction request'))).toBe(true)
    expect(items.some(item => item.includes('pending reviewed'))).toBe(true)
    expect(items.some(item => item.includes('profile-requests migration'))).toBe(true)
  })
})

describe('match split and statistics helpers', () => {
  const now = '2026-10-22T00:00:00Z'
  it('separates upcoming from past matches and drops cancelled games from upcoming', () => {
    const rows = [
      { matches: { scheduled_at: '2026-11-01T18:00:00Z', status: 'confirmed' } },
      { matches: { scheduled_at: '2026-09-01T18:00:00Z', status: 'confirmed' } },
      { matches: { scheduled_at: '2026-11-05T18:00:00Z', status: 'cancelled' } },
      { matches: null },
    ]
    const { upcoming, past } = splitMatchesByTime(rows, now)
    expect(upcoming).toHaveLength(1)
    expect(past).toHaveLength(3)
  })
  it('aggregates official statistics per tournament, season, sport, and team type', () => {
    const groups = aggregateTournamentStatistics([
      { tournament_id: 't1', season_id: 's1', sport: 'Football', team_type: 'senior_men', appearances: 3, goals: 1, assists: 0, yellow_cards: 1, red_cards: 0 },
      { tournament_id: 't1', season_id: 's1', sport: 'Football', team_type: 'senior_men', appearances: 2, goals: 2, assists: 1, yellow_cards: 0, red_cards: 0 },
      { tournament_id: 't2', season_id: 's2', sport: 'Futsal', team_type: 'senior_men', appearances: 1, goals: 0, assists: 0, yellow_cards: 0, red_cards: 1 },
    ])
    expect(groups).toHaveLength(2)
    const football = groups.find(group => group.tournamentId === 't1')!
    expect(football).toMatchObject({ appearances: 5, goals: 3, assists: 1, cards: 1 })
  })
  it('filters official statistics by tournament, season, and sport', () => {
    const rows = [
      { tournament_id: 't1', season_id: 's1', sport: 'Football' },
      { tournament_id: 't2', season_id: 's1', sport: 'Football' },
      { tournament_id: 't1', season_id: 's2', sport: 'Futsal' },
    ]
    expect(filterOfficialStatistics(rows, { tournamentId: 't1' })).toHaveLength(2)
    expect(filterOfficialStatistics(rows, { seasonId: 's1', sport: 'Football' })).toHaveLength(2)
    expect(filterOfficialStatistics(rows, { sport: 'Futsal' })).toHaveLength(1)
  })
  it('picks the most recent active membership as current team', () => {
    const teams = [
      { status: 'ended', effective_from: '2020-01-01', teams: { name: 'Old Team' } },
      { status: 'active', effective_from: '2024-01-01', teams: { name: 'Recent Team' } },
      { status: 'active', effective_from: '2025-01-01', teams: { name: 'Current Team' } },
    ]
    expect(String(firstOf(currentMembership(teams)?.teams)?.name)).toBe('Current Team')
    expect(currentMembership([{ status: 'ended', effective_from: '2020-01-01' }])).toBeNull()
  })
  it('derives the workspace rating from official statistics only', () => {
    const rated = playerRatingFromStatistics([{ appearances: 4, goals: 4, assists: 2, yellow_cards: 1, red_cards: 0 }])
    expect(rated.status).toBe('rated')
    const empty = playerRatingFromStatistics([])
    expect(empty.status).toBe('insufficient_data')
  })
})

function firstOf(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? null
  if (value && typeof value === 'object') return value as Record<string, unknown>
  return null
}

type RecordedCall = { table?: string; operation?: string; payload?: Record<string, unknown>; filters: [string, unknown][]; columns?: string }
function createRecordingClient(result: { data: unknown; error: { message: string } | null }): { client: SupabaseClient; call: RecordedCall } {
  const call: RecordedCall = { filters: [] }
  const chain: Record<string, unknown> = {}
  chain.update = (payload: Record<string, unknown>) => { call.operation = 'update'; call.payload = payload; return chain }
  chain.insert = (payload: Record<string, unknown>) => { call.operation = 'insert'; call.payload = payload; return chain }
  chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain }
  chain.select = (columns: string) => { call.columns = columns; return chain }
  chain.order = () => chain
  chain.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(result).then(onFulfilled)
  const client = { from: (table: string) => { call.table = table; return chain } } as unknown as SupabaseClient
  return { client, call }
}

describe('owner-scoped workspace mutations', () => {
  it('updates profile details only for the signed-in owner and only known fields', async () => {
    const { client, call } = createRecordingClient({ data: [{ id: 'player-1' }], error: null })
    const result = await updatePlayerProfileDetails(client, 'user-1', 'player-1', { display_name: '  Real Player  ', island: 'Malé', photo_url: '' })
    expect(result.error).toBeNull()
    expect(call.table).toBe('player_profiles')
    expect(call.operation).toBe('update')
    expect(call.payload).toEqual({ display_name: 'Real Player', island: 'Malé', photo_url: null })
    expect(call.filters).toEqual(expect.arrayContaining([['id', 'player-1'], ['account_id', 'user-1']]))
  })
  it('rejects an empty display name before touching the database', async () => {
    const { client, call } = createRecordingClient({ data: [], error: null })
    const result = await updatePlayerProfileDetails(client, 'user-1', 'player-1', { display_name: '   ' })
    expect(result.error).toMatch(/cannot be empty/i)
    expect(call.operation).toBeUndefined()
  })
  it('creates correction requests as the signed-in player only', async () => {
    const { client, call } = createRecordingClient({ data: [{ id: 'req-1' }], error: null })
    const result = await submitCorrectionRequest(client, 'user-1', 'player-1', { subject: 'Goals missing', message: 'Match on 3 Oct is missing two goals.' })
    expect(result.error).toBeNull()
    expect(call.table).toBe('player_correction_requests')
    expect(call.operation).toBe('insert')
    expect(call.payload).toEqual({ player_id: 'player-1', subject: 'Goals missing', message: 'Match on 3 Oct is missing two goals.', created_by: 'user-1' })
    expect(Object.keys(call.payload ?? {})).not.toContain('status')
  })
  it('creates team requests with creator and team linkage only', async () => {
    const { client, call } = createRecordingClient({ data: [{ id: 'req-1' }], error: null })
    const result = await submitTeamRequest(client, 'user-1', 'player-1', 'team-9', 'Please add me.')
    expect(result.error).toBeNull()
    expect(call.table).toBe('player_team_requests')
    expect(call.payload).toEqual({ player_id: 'player-1', team_id: 'team-9', message: 'Please add me.', created_by: 'user-1' })
    expect(Object.keys(call.payload ?? {})).not.toContain('status')
  })
  it('marks notifications read only for the recipient', async () => {
    const { client, call } = createRecordingClient({ data: [{ id: 'n-1' }], error: null })
    const result = await markNotificationRead(client, 'user-1', 'n-1')
    expect(result.error).toBeNull()
    expect(call.table).toBe('notifications')
    expect(call.operation).toBe('update')
    expect(call.payload?.state).toBe('read')
    expect(typeof call.payload?.read_at).toBe('string')
    expect(call.filters).toEqual(expect.arrayContaining([['id', 'n-1'], ['recipient_id', 'user-1']]))
  })
  it('reports failure when a mutation matches no owned row', async () => {
    const { client } = createRecordingClient({ data: [], error: null })
    const profile = await updatePlayerProfileDetails(client, 'user-1', 'someone-else', { display_name: 'X' })
    expect(profile.error).toMatch(/only the signed-in owner/i)
    const notification = await markNotificationRead(client, 'user-1', 'not-mine')
    expect(notification.error).toMatch(/only mark your own/i)
  })
})
