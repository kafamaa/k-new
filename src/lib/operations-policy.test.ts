import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210009_operations_finance_notifications.sql'), 'utf8')

describe('operations authorization and privacy', () => {
  it('scopes delegated staff, finance, and notifications', () => {
    expect(sql).toContain('tournament_staff_assignments')
    expect(sql).toContain("permission in ('registration','finance','media','operations','match_data')")
    expect(sql).toContain('has_tournament_permission')
    expect(sql).toContain('recipients read notifications')
  })
  it('keeps finance manual and auditable without payment gateways', () => {
    expect(sql).toContain('finance_expenses')
    expect(sql).toContain('finance_receipts')
    expect(sql).toContain('finance_adjustments')
    expect(sql).toContain('audit_finance_change')
    expect(sql).not.toContain('stripe')
  })
})
