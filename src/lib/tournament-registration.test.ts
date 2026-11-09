import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210004_tournament_registration.sql'), 'utf8')

describe('tournament registration authorization and status separation', () => {
  it('persists forms, entries, rosters, fees, payments, and private document metadata', () => {
    for (const table of ['tournament_setup_steps', 'tournament_registration_settings', 'tournament_registration_questions', 'tournament_entries', 'roster_submissions', 'tournament_fees', 'tournament_payments', 'private_documents']) expect(sql).toContain(`create table if not exists public.${table}`)
  })
  it('keeps application, roster, and payment states independent', () => {
    expect(sql).toContain('application_status text not null')
    expect(sql).toContain('roster_status text not null')
    expect(sql).toContain('payment_status text not null')
    expect(sql).toContain("application_status in ('draft','submitted'")
    expect(sql).toContain("status = 'submitted'")
    expect(sql).toContain('protect_entry_statuses')
    expect(sql).toContain('actor_mismatch')
  })
  it('does not give arbitrary signed-in users access to private files', () => {
    expect(sql).toContain('public.is_tournament_operator((storage.foldername(name))[1]::uuid)')
    expect(sql).toContain('public.is_team_manager(e.team_id)')
    expect(sql).not.toContain("bucket_id = 'tournament-private-documents' and auth.uid() is not null")
  })
})
