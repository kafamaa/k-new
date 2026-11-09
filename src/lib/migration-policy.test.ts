import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = [
  readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210001_foundation.sql'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210002_persistent_records.sql'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210003_tournament_drafts.sql'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210004_tournament_registration.sql'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210005_competition_engine.sql'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210006_match_operations.sql'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210007_match_center.sql'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210008_histories_statistics.sql'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210009_operations_finance_notifications.sql'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210010_onboarding_invitations.sql'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210011_public_rls_policy_split.sql'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210012_player_workspace_access.sql'), 'utf8'),
].join('\n')

describe('foundation migration RLS review', () => {
  it('enables RLS for every foundation table', () => {
    for (const table of ['profiles', 'organizations', 'organization_memberships', 'teams', 'team_memberships', 'player_profiles', 'audit_events']) {
      expect(migration).toContain(`alter table public.${table} enable row level security`)
    }
  })
  it('does not recursively evaluate membership policies', () => {
    const membershipPolicies = migration.split('\n').filter(line => line.includes('create policy') && line.includes('read memberships'))
    expect(membershipPolicies).toHaveLength(2)
    for (const policy of membershipPolicies) expect(policy).not.toContain('from public.')
    expect(membershipPolicies.every(policy => policy.includes('using (user_id = auth.uid())'))).toBe(true)
  })
  it('keeps private records owner-scoped while published records are public', () => {
    expect(migration).toContain('auth.uid() = id')
    expect(migration).toContain('is_published or account_id = auth.uid()')
  })
  it('keeps identity keys and claim insertion on the trusted path', () => {
    expect(migration).toContain('create table if not exists public.player_identity_keys')
    expect(migration).toContain('keyed_digest bytea not null unique')
    expect(migration).toContain('create policy "no client access to identity keys"')
    expect(migration).not.toContain('create policy "authorized creator inserts invitation metadata"')
    expect(migration).toContain('Invitation insertion is intentionally reserved for the trusted invite-player Edge Function')
  })
  it('keeps tournament drafts private until published', () => {
    expect(migration).toContain('create table if not exists public.tournaments')
    expect(migration).toContain("status in ('draft','setup','registration_open'")
    expect(migration).toContain('is_published and status <> \'draft\'')
    expect(migration).toContain('organization operators create tournaments')
  })
})
