import { describe, expect, it } from 'vitest'
import { registrationFormFields } from './tournament'
import { applicationStatusLabel, applicationWriteError, validateApplicationValues } from './registration'

const questions = [
  { id: 'q1', tournament_id: 't', field_key: 'contact', prompt: 'Contact', response_type: 'text', options: [], required: true, sort_order: 0, instructions: null },
  { id: 'q2', tournament_id: 't', field_key: 'players', prompt: 'Players', response_type: 'number', options: [], required: false, sort_order: 1, instructions: 'Count' },
  { id: 'q3', tournament_id: 't', field_key: 'agree', prompt: 'Agree', response_type: 'boolean', options: [], required: true, sort_order: 2, instructions: null },
  { id: 'q4', tournament_id: 't', field_key: 'level', prompt: 'Level', response_type: 'select', options: ['A', 'B'], required: false, sort_order: 3, instructions: null },
] as const

describe('registration pure helpers', () => {
  const fields = registrationFormFields(questions as unknown as Parameters<typeof registrationFormFields>[0])
  it('validateApplicationValues coerces and flags required', () => {
    const result = validateApplicationValues(fields, { contact: '  x  ', players: '7', agree: 'true', level: 'A' })
    expect(result.problems).toEqual({})
    expect(result.answers).toEqual({ contact: 'x', players: 7, agree: true, level: 'A' })
    const missing = validateApplicationValues(fields, {})
    expect(missing.problems.contact).toBe('This field is required.')
    expect(missing.problems.agree).toBe('This field is required.')
  })
  it('validateApplicationValues rejects bad numbers and options', () => {
    const result = validateApplicationValues(fields, { contact: 'x', players: 'abc', agree: true, level: 'Z' })
    expect(result.problems.players).toBe('Enter a number.')
    expect(result.problems.level).toBe('Choose one of the offered options.')
  })
  it('applicationWriteError maps duplicate and RLS denials', () => {
    expect(applicationWriteError({ message: 'duplicate key value violates unique constraint', code: '23505' })).toBe('This team already has an application in this tournament.')
    expect(applicationWriteError({ message: 'new row violates row-level security policy for table "tournament_entries": team managers submit applications registration_open' })).toContain('Registration is not open')
  })
  it('applicationStatusLabel returns recorded labels', () => {
    expect(applicationStatusLabel('changes_requested')).toBe('Changes requested')
  })
})