import { afterEach, describe, expect, it } from 'vitest'
import { activeLanguage, setActiveLanguage, statusLabel, tr, translationCoverage, translations } from './i18n'
import { matchStatusLabel, paymentStatusLabel } from './organizer'

afterEach(() => setActiveLanguage('en'))

describe('Dhivehi translation', () => {
  it('has no Dhivehi key without an English source', () => {
    expect(Object.keys(translations.dv).filter(key => !(key in translations.en))).toEqual([])
  })

  it('covers the shared shell, menus and every status label', () => {
    const { missing, percent } = translationCoverage()
    expect(missing).toEqual([])
    expect(percent).toBe(100)
  })

  it('uses Thaana for Dhivehi text (no English left in the Dhivehi dictionary)', () => {
    const latinOnly = Object.entries(translations.dv).filter(([, text]) => /^[\x20-\x7E…]+$/.test(text) && !/^[0-9x]/.test(text))
    expect(latinOnly).toEqual([])
  })

  it('switches every status label with the language and falls back to English', () => {
    expect(matchStatusLabel('confirmed')).toBe('Official')
    expect(paymentStatusLabel('unpaid')).toBe('Pending')
    setActiveLanguage('dv')
    expect(activeLanguage()).toBe('dv')
    expect(matchStatusLabel('confirmed')).toBe(translations.dv['status.match.confirmed'])
    expect(statusLabel('application', 'approved')).toBe(translations.dv['status.application.approved'])
    expect(tr('not.a.key', 'English fallback')).toBe('English fallback')
  })
})
