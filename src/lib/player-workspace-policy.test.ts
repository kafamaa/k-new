import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const workspaceSql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210012_player_workspace_access.sql'), 'utf8')
const requestsSql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210013_player_workspace_profile_requests.sql'), 'utf8')

describe('player workspace private history policy', () => {
  it('scopes history, confirmed appearances, matches, and milestones to account_id', () => {
    expect(workspaceSql).toContain('p.account_id = auth.uid()')
    expect(workspaceSql).toContain("rv.status = 'confirmed'")
    expect(workspaceSql).toContain('players read own confirmed matches')
    expect(workspaceSql).toContain('players read own milestones')
    expect(workspaceSql).toContain('to authenticated')
  })
})

describe('review-only player workspace profile and requests migration', () => {
  it('keeps every new policy owner- or role-scoped and authenticated-only', () => {
    const policies = requestsSql.split('\n').filter(line => line.includes('create policy'))
    expect(policies.length).toBeGreaterThan(0)
    for (const policy of policies) {
      expect(policy).toContain('to authenticated')
      expect(policy).not.toContain('to anon')
    }
  })
  it('stores date of birth outside the guest-readable player_profiles table', () => {
    expect(requestsSql).toContain('create table if not exists public.player_private_details')
    expect(requestsSql).not.toMatch(/alter table public\.player_profiles add column if not exists date_of_birth/)
    const profileAlters = requestsSql.split('\n').filter(line => line.startsWith('alter table public.player_profiles add column'))
    for (const alter of profileAlters) expect(alter).toMatch(/nationality|sports|position/)
  })
  it('scopes private details, correction requests, and team requests to the profile owner', () => {
    expect(requestsSql).toContain('"players read own private details"')
    expect(requestsSql).toContain('"players insert own private details"')
    expect(requestsSql).toContain('"players update own private details"')
    expect(requestsSql).toContain('"players read own correction requests"')
    expect(requestsSql).toContain('"players create correction requests"')
    expect(requestsSql).toContain('"players read own team requests"')
    expect(requestsSql).toContain('"players create team requests"')
    expect(requestsSql).toContain('p.account_id = auth.uid()')
  })
  it('requires the creator to be the signed-in owner on request inserts', () => {
    expect(requestsSql).toContain('"players create correction requests" on public.player_correction_requests for insert to authenticated with check (created_by = auth.uid()')
    expect(requestsSql).toContain('"players create team requests" on public.player_team_requests for insert to authenticated with check (created_by = auth.uid()')
  })
  it('never lets players edit confirmed match records', () => {
    expect(requestsSql).not.toMatch(/on public\.matches for (update|insert|delete)/)
    expect(requestsSql).not.toMatch(/on public\.match_result_versions for (update|insert|delete)/)
    expect(requestsSql).not.toMatch(/on public\.match_player_participants for (update|delete)/)
  })
  it('exposes invitation metadata by verified email only, never tokens or digests', () => {
    expect(requestsSql).toContain("invited_email = auth.jwt() ->> 'email'")
    expect(requestsSql).not.toMatch(/create policy.*claim_invitations.*token/)
    expect(requestsSql).not.toContain('token_digest')
  })
  it('grants players read-only access to their own roster rows', () => {
    expect(requestsSql).toContain('"players read own roster rows" on public.roster_submission_players for select')
    expect(requestsSql).toContain('"players read own roster submissions" on public.roster_submissions for select')
    expect(requestsSql).not.toMatch(/roster_submissions for (insert|update|delete)/)
  })
  it('keeps operator and team-manager review paths intact', () => {
    expect(requestsSql).toContain('public.is_tournament_operator(tournament_id)')
    expect(requestsSql).toContain('public.is_team_manager(team_id)')
  })
})
