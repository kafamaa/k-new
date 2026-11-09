import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210010_onboarding_invitations.sql'), 'utf8')

describe('first-time onboarding safeguards', () => {
  it('allows only the signed-in account to create its claimed personal profile', () => {
    expect(sql).toContain('drop policy if exists "users create own claimed player profile"')
    expect(sql).toContain('create policy "users create own claimed player profile" on public.player_profiles for insert to authenticated')
    expect(sql).toContain('created_by = auth.uid() and account_id = auth.uid() and is_claimed = true')
    expect(sql).toContain('players update own profile fields')
  })
  it('keeps team and organization invitations token-private and scoped', () => {
    expect(sql).toContain("workspace_type in ('team','organization')")
    expect(sql).toContain('token_digest bytea not null unique')
    expect(sql).toContain('Token creation and acceptance must use a trusted Edge Function')
  })
})
