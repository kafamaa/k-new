import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  countCategoryMatches, loadEditableTournamentCategories, SUGGESTED_SPORT_SETTINGS, saveSetupStep,
  SETUP_STEP_KEYS, updateTournamentCategory,
} from './tournament'

type RecordedCall = { table: string; action: string; payload: Record<string, unknown> | null; filters: [string, unknown][]; columns: string }

function createClient(): { client: SupabaseClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const client = {
    from: (table: string) => {
      const call: RecordedCall = { table, action: 'select', payload: null, filters: [], columns: '' }
      calls.push(call)
      const chain: Record<string, unknown> = {}
      chain.select = (columns: string) => { call.columns = columns; return chain }
      chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain }
      chain.order = () => chain
      chain.insert = (payload: Record<string, unknown>) => { call.action = 'insert'; call.payload = payload; return chain }
      chain.update = (payload: Record<string, unknown>) => { call.action = 'update'; call.payload = payload; return chain }
      chain.upsert = (payload: Record<string, unknown>) => { call.action = 'upsert'; call.payload = payload; return chain }
      chain.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(onFulfilled)
      return chain
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('sport suggestions (spec section 7 - shown, never auto-saved)', () => {
  it('covers every supported sport with usable limits', () => {
    const sports = ['football', 'futsal', 'handball', 'volleyball', 'basketball', 'basketball_3x3']
    for (const sport of sports) {
      const suggestion = SUGGESTED_SPORT_SETTINGS[sport as keyof typeof SUGGESTED_SPORT_SETTINGS]
      expect(suggestion.rosterMin).toBeGreaterThan(0)
      expect(suggestion.rosterMax).toBeGreaterThanOrEqual(suggestion.rosterMin)
      expect(suggestion.officials).toBeGreaterThan(0)
    }
    // Spot-check the extremes: 3x3 is the smallest, football the broadest.
    expect(SUGGESTED_SPORT_SETTINGS.basketball_3x3).toEqual({ rosterMin: 3, rosterMax: 6, officials: 1 })
    expect(SUGGESTED_SPORT_SETTINGS.football).toEqual({ rosterMin: 7, rosterMax: 18, officials: 3 })
  })
})

describe('stage 2 category editing loaders', () => {
  it('updates a real category row by id with the given patch', async () => {
    const { client, calls } = createClient()
    const result = await updateTournamentCategory(client, 'cat-1', { name: 'Open', age_group: 'Under-18', eligibility_instructions: 'Cutoff 31 Dec 2011', team_limit: 12 })
    expect(result.error).toBeNull()
    expect(calls[0]).toMatchObject({ table: 'tournament_categories', action: 'update', filters: [['id', 'cat-1']] })
    expect(calls[0].payload).toEqual({ name: 'Open', age_group: 'Under-18', eligibility_instructions: 'Cutoff 31 Dec 2011', team_limit: 12 })
  })

  it('counts matches per category for the deletion guard (restrict-backed)', async () => {
    const { client, calls } = createClient()
    const result = await countCategoryMatches(client, 'cat-1')
    expect(result.error).toBeNull()
    expect(result.data).toBe(0)
    expect(calls[0]).toMatchObject({ table: 'matches', filters: [['category_id', 'cat-1']] })
  })

  it('reads extended category columns in display order for the editor', async () => {
    const { client, calls } = createClient()
    await loadEditableTournamentCategories(client, 't-1')
    expect(calls[0]).toMatchObject({ table: 'tournament_categories', filters: [['tournament_id', 't-1']] })
    expect(calls[0].columns).toContain('description')
    expect(calls[0].columns).toContain('eligibility_instructions')
    expect(calls[0].columns).toContain('sort_order')
  })

  it('passes the database error through so the stage can fall back honestly', async () => {
    // Pre-019 the column select fails; the loader reports it instead of
    // pretending the extended fields exist.
    const failing = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              then: (cb: (value: unknown) => unknown) => Promise.resolve(cb({ data: null, error: { message: 'Could not find a relationship between tournament_categories and description' } })),
            }),
          }),
        }),
      }),
    }
    const result = await loadEditableTournamentCategories(failing as unknown as SupabaseClient, 't-1')
    expect(result.data).toBeNull()
    expect(result.error).toContain('description')
  })
})

describe('save-and-exit stores unfinished work without validation', () => {
  it('skips step validation when explicitly asked (in-progress exit save)', async () => {
    const { client, calls } = createClient()
    // Stage 3 with no method and no closing time would fail normal validation;
    // an exit save records it as in_progress instead of blocking the exit.
    const result = await saveSetupStep(client, 't-1', 'u-1', 3, 'in_progress', { method: '', closesAt: '' }, { enforceValidation: false })
    expect(result.error).toBeNull()
    expect(calls[0]).toMatchObject({ table: 'tournament_setup_steps', action: 'upsert' })
    expect(calls[0].payload).toMatchObject({ tournament_id: 't-1', step_number: SETUP_STEP_KEYS[2], status: 'in_progress' })
    expect(calls[0].payload?.data).toEqual({ method: '', closesAt: '' })
    // The tournament row still learns the furthest stage for resume.
    expect(calls[1]).toMatchObject({ table: 'tournaments', action: 'update', filters: [['id', 't-1']], payload: { setup_stage: 3 } })
  })

  it('still validates a normal save (default behaviour is unchanged)', async () => {
    const { client, calls } = createClient()
    const result = await saveSetupStep(client, 't-1', 'u-1', 3, 'complete', { method: 'open', closesAt: '' }, {})
    expect(result.error).toBeTruthy()
    expect(calls).toEqual([])
  })
})

describe('review-only migration 019 carries the stage-2/5 fields and the window policy', () => {
  const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/202610230019_setup_wizard_nine_stage_fields.sql'), 'utf8')

  it('adds category eligibility instructions', () => {
    expect(sql).toContain('eligibility_instructions text')
  })

  it('adds the structured roster policy columns stage 5 writes', () => {
    expect(sql).toContain('roster_officials_count smallint')
    expect(sql).toContain('roster_submission_timing text')
    expect(sql).toContain("roster_submission_timing in ('with_application','after_approval')")
  })

  it('enforces the registration window in the entries insert policy', () => {
    expect(sql).toContain('drop policy if exists "team managers submit applications" on public.tournament_entries;')
    expect(sql).toContain('rs.opens_at is null or rs.opens_at <= now()')
    expect(sql).toContain('rs.closes_at is null or rs.closes_at > now()')
  })
})

describe('setup saves never downgrade tournament status', () => {
  it('promotes only a draft to setup', async () => {
    const { client, calls } = createClient()
    const result = await saveSetupStep(client, 't-1', 'u-1', 9, 'complete', {})
    expect(result.error).toBeNull()
    expect(calls[1].payload).not.toHaveProperty('status')
    expect(calls[2]).toMatchObject({ table: 'tournaments', action: 'update', payload: { status: 'setup' }, filters: [['id', 't-1'], ['status', 'draft']] })
  })
})
