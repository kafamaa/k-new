import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { formatMaldivesDate, formatMaldivesDateTime, getPublicRegistration, PUBLIC_REGISTRATION_STATE_LABELS, publicRegistrationState } from './publicData'

// Fixed clock: 2024-07-01 04:00 UTC (= 09:00 Maldives).
const NOW = new Date('2024-07-01T04:00:00Z')
const OPEN = { application_method: 'team_application', opens_at: '2024-06-15T00:00:00Z', closes_at: '2024-09-01T00:00:00Z' }
const SCHEDULED = { application_method: 'team_application', opens_at: '2024-08-01T00:00:00Z', closes_at: null }
const CLOSED_SETTINGS = { application_method: 'team_application', opens_at: '2024-05-01T00:00:00Z', closes_at: '2024-06-30T00:00:00Z' }
const NO_WINDOW = { application_method: 'team_application', opens_at: null, closes_at: null }

describe('public registration state (spec section 6: preparing/scheduled/open/closed/disabled)', () => {
  it('no settings row: preparing, unless the organizer actually opened registration', () => {
    expect(publicRegistrationState(null, 'setup', NOW)).toBe('preparing')
    // The status flip is the truth - matching the workspace "Registration open" pill.
    expect(publicRegistrationState(null, 'registration_open', NOW)).toBe('open')
  })

  it('manual add is a disabled public registration', () => {
    expect(publicRegistrationState({ ...NO_WINDOW, application_method: 'invite_only' }, 'registration_open', NOW)).toBe('disabled')
  })

  it('open status inside the window is open', () => {
    expect(publicRegistrationState(OPEN, 'registration_open', NOW)).toBe('open')
  })

  it('open status but before opens_at is still scheduled', () => {
    expect(publicRegistrationState(SCHEDULED, 'registration_open', NOW)).toBe('scheduled')
  })

  it('closing is enforced by time, even if the status flip is missed', () => {
    expect(publicRegistrationState(CLOSED_SETTINGS, 'registration_open', NOW)).toBe('closed')
  })

  it('status not open with an open-past window is closed, not open', () => {
    expect(publicRegistrationState({ ...OPEN, closes_at: null }, 'setup', NOW)).toBe('closed')
  })

  it('open forever with no window is open while status is open', () => {
    expect(publicRegistrationState(NO_WINDOW, 'registration_open', NOW)).toBe('open')
  })

  it('a future window without the open status is scheduled', () => {
    expect(publicRegistrationState(SCHEDULED, 'setup', NOW)).toBe('scheduled')
  })

  it('every state has a visitor-facing label', () => {
    for (const state of ['preparing', 'scheduled', 'open', 'closed', 'disabled', 'unknown'] as const) {
      expect(PUBLIC_REGISTRATION_STATE_LABELS[state]).toBeTruthy()
    }
  })
})

function createClient(settings: unknown, settingsError: string | null, categories: unknown, categoriesError: string | null, questions: unknown, questionsError: string | null): { client: SupabaseClient; calls: { table: string; columns: string }[] } {
  const calls: { table: string; columns: string }[] = []
  const client = {
    from: (table: string) => {
      const entry = { table, columns: '' }
      calls.push(entry)
      const chain: Record<string, unknown> = {}
      chain.select = (columns: string) => { entry.columns = columns; return chain }
      chain.eq = () => chain
      chain.order = () => chain
      chain.maybeSingle = () => chain
      chain.then = (onFulfilled: (value: unknown) => unknown) => {
        if (table === 'tournament_registration_settings') return Promise.resolve({ data: settings, error: settingsError ? { message: settingsError } : null }).then(onFulfilled)
        if (table === 'tournament_categories') return Promise.resolve({ data: categories, error: categoriesError ? { message: categoriesError } : null }).then(onFulfilled)
        return Promise.resolve({ data: questions, error: questionsError ? { message: questionsError } : null }).then(onFulfilled)
      }
      return chain
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('public registration loader (real rows only)', () => {
  it('reads settings, categories, and questions in order for the page', async () => {
    const { client, calls } = createClient({ opens_at: null, closes_at: null, application_method: 'team_application' }, null, [], null, [], null)
    const info = await getPublicRegistration(client, 't-1', 'registration_open')
    expect(info.state).toBe('open')
    expect(calls.map(call => call.table)).toEqual(['tournament_registration_settings', 'tournament_categories', 'tournament_registration_questions'])
    expect(calls[0].columns).toContain('closes_at')
    expect(calls[1].columns).toContain('team_limit')
    expect(calls[2].columns).toContain('required')
  })

  it('a missing public settings policy (migration 020) shows unknown, never a fake state', async () => {
    const { client } = createClient(null, 'permission denied for table tournament_registration_settings', ['id'], null, [], null)
    const info = await getPublicRegistration(client, 't-1', 'registration_open')
    expect(info.state).toBe('unknown')
    expect(info.unavailable.join(' ')).toContain('migration 020')
  })

  it('questions still display when the instructions column is absent (pre-019)', async () => {
    // First read includes instructions and fails with the column error; the
    // retry must drop instructions and succeed.
    let questionCalls = 0
    const client = {
      from: (table: string) => {
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.eq = () => chain
        chain.order = () => chain
        chain.maybeSingle = () => chain
        chain.then = (onFulfilled: (value: unknown) => unknown) => {
          let payload: { data: unknown; error: { message: string } | null }
          if (table === 'tournament_registration_questions') {
            questionCalls++
            payload = questionCalls === 1
              ? { data: null, error: { message: 'Could not find a relationship between tournament_registration_questions and instructions in the schema cache' } }
              : { data: [{ field_key: 'kit_colour', prompt: 'Kit colour', response_type: 'text', options: [], required: true, sort_order: 1 }], error: null }
          } else if (table === 'tournament_registration_settings') payload = { data: null, error: null }
          else payload = { data: [], error: null }
          return Promise.resolve(payload).then(onFulfilled)
        }
        return chain
      },
    } as unknown as SupabaseClient
    const info = await getPublicRegistration(client, 't-1', 'registration_open')
    expect(questionCalls).toBe(2)
    expect(info.questions).toHaveLength(1)
    expect(info.questions[0].label).toBe('Kit colour')
    expect(info.questions[0].instructions).toBeNull()
    expect(info.unavailable).toEqual([])
  })

  it('nullable settings row with categories and questions follows the real status', async () => {
    const { client } = createClient(null, null, [], null, [], null)
    const info = await getPublicRegistration(client, 't-1', 'setup')
    expect(info.state).toBe('preparing')
    expect(info.unavailable).toEqual([])
    const openInfo = await getPublicRegistration(client, 't-1', 'registration_open')
    expect(openInfo.state).toBe('open')
  })
})

describe('maldives time rendering (spec section 3: UTC+5 by default)', () => {
  it('formats dates in the Asia/Maldives timezone without crashing', () => {
    expect(formatMaldivesDateTime('2024-07-01T04:00:00Z')).toContain('2024')
    expect(formatMaldivesDate('2024-07-01T04:00:00Z')).toContain('Jul')
  })
})

describe('review-only migration 020 carries the public read policies', () => {
  const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/202610240020_public_registration_reads.sql'), 'utf8')

  it('exposes settings and categories only for published tournaments', () => {
    expect(sql).toContain('create policy "published registration settings are public"')
    expect(sql).toContain('create policy "published tournament categories are public"')
    expect(sql.match(/is_published/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('does not touch the existing public questions policy', () => {
    expect(sql).not.toContain('tournament_registration_questions.')
    // The note references it by name only.
    expect(sql).toContain('published registration questions are public')
  })
})
