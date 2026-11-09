import { describe, expect, it } from 'vitest'
import { SETUP_STEP_KEYS, SETUP_STEPS, setupStepKey, validateSetupStep, validateSetupStepFields } from './tournament'

describe('resumable tournament setup', () => {
  it('documents all nine setup stages in order', () => {
    expect(SETUP_STEPS).toHaveLength(9)
    expect(SETUP_STEPS[0]).toBe('Basics')
    expect(SETUP_STEPS[8]).toBe('Review and launch')
  })

  it('maps wizard stages onto the legacy storage keys without touching rows 9 and 10', () => {
    // The database keeps step_number 1..11 with its historical rows. Stages
    // 1-8 keep their keys; the launch stage uses key 11; the retired keys 9
    // (Officials) and 10 (Finance) are never written by the wizard, so their
    // data stays available to the standalone management modules.
    expect([...SETUP_STEP_KEYS]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 11])
    expect(setupStepKey(1)).toBe(1)
    expect(setupStepKey(8)).toBe(8)
    expect(setupStepKey(9)).toBe(11)
    expect(setupStepKey(0)).toBe(1)
  })

  it('validates required basics, registration dates, and roster limits', () => {
    expect(validateSetupStep(1, {})).toContain('name')
    expect(validateSetupStep(3, { opensAt: '2026-03-02', closesAt: '2026-03-01' })).toContain('after')
    expect(validateSetupStep(5, { rosterMin: 12, rosterMax: 8 })).toContain('maximum')
    expect(validateSetupStep(3, { opensAt: '2026-03-01', closesAt: '2026-03-02' })).toBeNull()
  })

  it('validates the launch-stage date order without needing a clock', () => {
    expect(validateSetupStep(8, { startsAt: '2026-03-01', endsAt: '2026-02-28' })).toContain('start date')
    expect(validateSetupStep(8, { startsAt: '2026-03-01', endsAt: '2026-03-05' })).toBeNull()
  })

  // The one-step setup view shows corrections next to the exact field that
  // needs them, so each failure must map to a field key - and a passing step
  // must map to nothing rather than an empty-looking error object.
  describe('field-level validation for the setup forms', () => {
    it('points the basics failure at the name field', () => {
      expect(validateSetupStepFields(1, {})).toEqual({ name: expect.stringContaining('name') })
      expect(validateSetupStepFields(1, { name: 'National Futsal Cup', sport: 'futsal' })).toEqual({})
    })

    it('points the registration-window failure at the closing date field only', () => {
      expect(validateSetupStepFields(3, { opensAt: '2026-03-02', closesAt: '2026-03-01' })).toEqual({ closesAt: expect.stringContaining('after') })
      expect(validateSetupStepFields(3, { opensAt: '', closesAt: '' })).toEqual({})
    })

    it('points the roster failure at the maximum field', () => {
      expect(validateSetupStepFields(5, { rosterMin: 12, rosterMax: 8 })).toEqual({ rosterMax: expect.stringContaining('maximum') })
      expect(validateSetupStepFields(5, { rosterMin: 8, rosterMax: 12 })).toEqual({})
    })

    it('never invents errors for stages the summary validator accepts', () => {
      for (let step = 2; step <= 9; step += 1) {
        expect(validateSetupStep(step, {})).toBeNull()
        expect(validateSetupStepFields(step, {})).toEqual({})
      }
    })
  })

  describe('stage 3 registration methods', () => {
    const now = new Date('2026-03-10T12:00:00Z').getTime()

    it('open registration requires a future closing date', () => {
      expect(validateSetupStep(3, { method: 'open', closesAt: '2026-03-20T10:00' }, now)).toBeNull()
      expect(validateSetupStep(3, { method: 'open' }, now)).toContain('closing')
      expect(validateSetupStep(3, { method: 'open', closesAt: '2026-03-01T10:00' }, now)).toContain('current time')
      expect(validateSetupStepFields(3, { method: 'open', closesAt: '2026-03-01T10:00' }, now)).toEqual({ closesAt: expect.stringContaining('current time') })
    })

    it('scheduled registration requires a future opening before the closing', () => {
      expect(validateSetupStep(3, { method: 'schedule', opensAt: '2026-03-12T10:00', closesAt: '2026-03-20T10:00' }, now)).toBeNull()
      expect(validateSetupStep(3, { method: 'schedule', closesAt: '2026-03-20T10:00' }, now)).toContain('opening')
      expect(validateSetupStep(3, { method: 'schedule', opensAt: '2026-03-09T10:00', closesAt: '2026-03-20T10:00' }, now)).toContain('later than the current time')
      expect(validateSetupStep(3, { method: 'schedule', opensAt: '2026-03-12T10:00', closesAt: '2026-03-11T10:00' }, now)).toContain('closing must be later')
      expect(validateSetupStepFields(3, { method: 'schedule', opensAt: '2026-03-12T10:00', closesAt: '2026-03-11T10:00' }, now)).toEqual({ closesAt: expect.stringContaining('later than') })
    })

    it('manual adding needs no public dates at all', () => {
      expect(validateSetupStep(3, { method: 'manual_add' }, now)).toBeNull()
      expect(validateSetupStepFields(3, { method: 'manual_add' }, now)).toEqual({})
    })

    it('historical drafts without a method keep the legacy ordering check', () => {
      expect(validateSetupStep(3, { opensAt: '2026-03-02', closesAt: '2026-03-01' })).toContain('after')
      expect(validateSetupStep(3, { opensAt: '2026-03-01', closesAt: '2026-03-02' })).toBeNull()
    })
  })
})
