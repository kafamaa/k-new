import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210007_match_center.sql'), 'utf8')

describe('match-center trusted workflows', () => {
  it('records sport events with idempotency and assignment checks', () => {
    expect(sql).toContain('record_match_event')
    expect(sql).toContain('actor_mismatch')
    expect(sql).toContain('match_not_assigned')
    expect(sql).toContain('on conflict (match_id, idempotency_key) do nothing')
  })
  it('requires submission, organizer confirmation, and audited correction reasons', () => {
    expect(sql).toContain('submit_match_result')
    expect(sql).toContain('confirm_match_result')
    expect(sql).toContain('correct_match_result')
    expect(sql).toContain("match_result_confirmed")
    expect(sql).toContain("match_result_corrected")
    expect(sql).toContain('correction_reason_required')
    expect(sql).toContain("update public.match_result_versions set status = 'rejected'")
  })
})
