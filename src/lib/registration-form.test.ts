import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addRegistrationQuestion, deleteRegistrationQuestion, loadRegistrationQuestions,
  REGISTRATION_STANDARD_FIELDS, registrationFormFields, updateRegistrationQuestion,
  type RegistrationQuestion,
} from './tournament'

type RecordedCall = { table: string; action: string; columns: string; filters: [string, unknown][]; payloads: Record<string, unknown>[] }

// Mirrors the per-table stub used across this suite: records query shape, so
// loaders are asserted against the exact tables and columns they request.
function createClient(tables: Record<string, unknown[]>, errors: Record<string, string> = {}): { client: SupabaseClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const client = {
    from: (table: string) => {
      const call: RecordedCall = { table, action: 'select', columns: '', filters: [], payloads: [] }
      calls.push(call)
      const result = () => ({ data: tables[table] ?? [], error: errors[table] ? { message: errors[table] } : null })
      const chain: Record<string, unknown> = {}
      chain.select = (columns: string) => { call.columns = columns; return chain }
      chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain }
      chain.order = () => chain
      chain.insert = (payload: Record<string, unknown>) => { call.action = 'insert'; call.payloads.push(payload); return chain }
      chain.update = (payload: Record<string, unknown>) => { call.action = 'update'; call.payloads.push(payload); return chain }
      chain.delete = () => { call.action = 'delete'; return chain }
      chain.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(result()).then(onFulfilled)
      return chain
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('registration form questions (organizer-side, real rows)', () => {
  it('reads only this tournament question pool in display order', async () => {
    const { client, calls } = createClient({ tournament_registration_questions: [] })
    await loadRegistrationQuestions(client, 't-1')
    expect(calls[0].table).toBe('tournament_registration_questions')
    expect(calls[0].filters).toEqual([['tournament_id', 't-1']])
    expect(calls[0].columns).toContain('instructions')
    expect(calls[0].columns).toContain('sort_order')
  })

  it('saves a question with its type, instructions, choices, and required flag', async () => {
    const { client, calls } = createClient({ tournament_registration_questions: [] })
    const result = await addRegistrationQuestion(client, 't-1', 'preferred_contact', 'Preferred contact method', true, {
      instructions: 'How should we reach the manager?',
      responseType: 'select',
      options: ['Phone', 'Email'],
    })
    expect(result.error).toBeNull()
    expect(calls[0].action).toBe('insert')
    expect(calls[0].payloads[0]).toMatchObject({
      tournament_id: 't-1',
      field_key: 'preferred_contact',
      prompt: 'Preferred contact method',
      required: true,
      response_type: 'select',
      options: ['Phone', 'Email'],
      instructions: 'How should we reach the manager?',
    })
  })

  it('retries with a distinct key only when the label collides, never silently overwriting', async () => {
    // Hand-rolled client for this one path: first insert hits the table's
    // unique (tournament_id, field_key) constraint, second succeeds.
    const keys: string[] = []
    const client = {
      from: () => ({
        insert: (payload: Record<string, unknown>) => {
          keys.push(String(payload.field_key))
          return { then: (done: (value: unknown) => unknown) => Promise.resolve(keys.length === 1 ? { data: null, error: { message: 'duplicate key value violates unique constraint "tournament_registration_questions_tournament_id_field_key_key"' } } : { data: null, error: null }).then(done) }
        },
      }),
    } as unknown as SupabaseClient
    const result = await addRegistrationQuestion(client, 't-1', 'club_reg_number', 'Club registration number', true)
    expect(result.error).toBeNull()
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe('club_reg_number')
    expect(keys[1]).toMatch(/^club_reg_number_[0-9a-f]{6}$/)
  })

  it('adds no duplicate suffix for plain database errors - the error surfaces instead', async () => {
    const { client } = createClient({ tournament_registration_questions: [] }, { tournament_registration_questions: 'row level security blocks this insert' })
    const result = await addRegistrationQuestion(client, 't-1', 'club_reg_number', 'Club registration number', true)
    expect(result.error).toContain('row level security')
  })

  it('updates and removes a question by its id, never by index guessing', async () => {
    const { client, calls } = createClient({ tournament_registration_questions: [] })
    await updateRegistrationQuestion(client, 'q-9', { prompt: 'Preferred contact method?', required: false })
    expect(calls[0]).toMatchObject({ table: 'tournament_registration_questions', action: 'update' })
    expect(calls[0].filters).toEqual([['id', 'q-9']])
    expect(calls[0].payloads[0]).toEqual({ prompt: 'Preferred contact method?', required: false })
    await deleteRegistrationQuestion(client, 'q-9')
    expect(calls[1]).toMatchObject({ table: 'tournament_registration_questions', action: 'delete' })
    expect(calls[1].filters).toEqual([['id', 'q-9']])
  })

  const question = (over: Partial<RegistrationQuestion> = {}): RegistrationQuestion => ({
    id: 'q-1', field_key: 'club_reg_number', prompt: 'Club registration number',
    instructions: 'Find it on your certificate.', response_type: 'text', options: [], required: true, sort_order: 0,
    ...over,
  })

  it('maps every stored response type to the kind the form renders, and nothing else', () => {
    const fields = registrationFormFields([
      question({ response_type: 'text' }),
      question({ response_type: 'long_text' }),
      question({ response_type: 'number' }),
      question({ response_type: 'select', options: ['Phone', 'Email'] }),
      question({ response_type: 'boolean' }),
      question({ response_type: 'date' }),
    ])
    expect(fields.map(field => field.kind)).toEqual(['text', 'long_text', 'number', 'select', 'checkbox', 'date'])
    expect(fields[3].options).toEqual(['Phone', 'Email'])
    expect(fields.every(field => field.instructions === 'Find it on your certificate.')).toBe(true)
  })

  it('falls back to plain text for unknown response types instead of inventing a control', () => {
    expect(registrationFormFields([question({ response_type: 'signature_stamp' })])[0].kind).toBe('text')
  })

  it('lists the ready-made standard fields honestly, absent when there is no column', () => {
    const labels = REGISTRATION_STANDARD_FIELDS.map(field => field.label)
    expect(labels).toEqual(['Team name', 'Category', 'Team logo', 'Manager name', 'Manager phone number', 'Manager email', 'Island', 'First jersey colour', 'Second jersey colour'])
    // Atoll has no column anywhere in the schema, so it must not appear as if
    // usable; jersey colours come with an honest no-column provenance note.
    expect(labels).not.toContain('Atoll')
    expect(REGISTRATION_STANDARD_FIELDS.find(field => field.label === 'First jersey colour')?.source).toContain('no column exists yet')
  })

  it('records questions loader error honestly instead of empty success', async () => {
    const { client } = createClient({ tournament_registration_questions: [] }, { tournament_registration_questions: 'permission denied' })
    const result = await loadRegistrationQuestions(client, 't-1')
    expect(result.error).toBe('permission denied')
    expect(result.data).toBeNull()
  })
})
