import { describe, expect, it } from 'vitest'
import { canManageFinance, financeStatusTransitionAllowed } from './finance'
import { reportColumns, toCsv } from './reports'
import { nextDeliveryState } from './notifications'

describe('Stage 7 operations', () => {
  it('scopes finance access to owners, finance staff, or assigned finance permission', () => { expect(canManageFinance({ organizationRole: 'operations' })).toBe(false); expect(canManageFinance({ organizationRole: 'finance' })).toBe(true); expect(canManageFinance({ tournamentPermission: 'finance' })).toBe(true) })
  it('allows auditable manual finance transitions only', () => { expect(financeStatusTransitionAllowed('submitted', 'approved')).toBe(true); expect(financeStatusTransitionAllowed('submitted', 'refunded')).toBe(false); expect(financeStatusTransitionAllowed('approved', 'refunded')).toBe(true) })
  it('never exposes finance columns to an unauthorized export', () => { expect(reportColumns('finance', false)).toEqual([]); expect(toCsv([{ id: '1', title: 'Receipt, one' }], ['id', 'title'])).toBe('"id","title"\r\n"1","Receipt, one"') })
  it('keeps email delivery queued until a provider is configured', () => { expect(nextDeliveryState('email', false)).toBe('queued'); expect(nextDeliveryState('in_app', false)).toBe('queued') })
})
