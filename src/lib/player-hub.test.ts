import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  breakdownStatistics, groupMatches, mapWorkspaceMatch, matchBucket, matchOutcome, nextMilestones, notificationCategory, opponentOf,
  playerTournamentStatus, requestRecipient, sumMatches, sumStatistics, validateRequest,
} from './playerHub'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610300030_player_workspace_complete.sql'), 'utf8')
const match = (overrides: Record<string, unknown>) => mapWorkspaceMatch({ match_id: 'm', tournament_id: 't', team_id: 'a', home_team_id: 'a', away_team_id: 'b', home_team_name: 'Home', away_team_name: 'Away', status: 'scheduled', ...overrides })

describe('player matches', () => {
  it('groups matches into upcoming, live, completed and postponed', () => {
    const now = '2026-10-30T00:00:00Z'
    expect(matchBucket({ status: 'live', scheduledAt: null }, now)).toBe('live')
    expect(matchBucket({ status: 'postponed', scheduledAt: '2026-11-01T00:00:00Z' }, now)).toBe('postponed')
    expect(matchBucket({ status: 'scheduled', scheduledAt: '2026-11-01T00:00:00Z' }, now)).toBe('upcoming')
    expect(matchBucket({ status: 'confirmed', scheduledAt: '2026-10-01T00:00:00Z' }, now)).toBe('completed')
    const groups = groupMatches([match({ match_id: 'late', scheduled_at: '2026-12-01T00:00:00Z' }), match({ match_id: 'soon', scheduled_at: '2026-11-01T00:00:00Z' })], now)
    expect(groups.upcoming.map(item => item.id)).toEqual(['soon', 'late'])
  })
  it('reads the opponent and the result from the player team side', () => {
    const away = match({ team_id: 'b', status: 'confirmed', result_confirmed: true, home_score: 1, away_score: 3 })
    expect(opponentOf(away).name).toBe('Home')
    expect(matchOutcome(away)).toBe('W')
    expect(matchOutcome(match({ status: 'confirmed', result_confirmed: false, home_score: 1, away_score: 3 }))).toBeNull()
  })
  it('counts only confirmed appearances in per-match totals', () => {
    const totals = sumMatches([match({ participated: true, starter: true, minutes: 90, goals: 2 }), match({ participated: false, goals: 5 })])
    expect(totals).toMatchObject({ appearances: 1, starts: 1, minutes: 90, goals: 2 })
  })
})

describe('player statistics', () => {
  it('sums and breaks down official rows', () => {
    const rows = [{ team_type: 'club', appearances: 2, starts: 1, minutes: 120, goals: 1 }, { team_type: 'island', appearances: 4, goals: 2 }, { team_type: 'club', appearances: 1 }]
    expect(sumStatistics(rows)).toMatchObject({ appearances: 7, goals: 3, minutes: 120 })
    expect(breakdownStatistics(rows, 'team_type').map(group => [group.key, group.totals.appearances])).toEqual([['island', 4], ['club', 3]])
  })
  it('points at the next automatic milestones', () => {
    expect(nextMilestones({ appearances: 0, goals: 0 }).map(item => item.label)).toEqual(['First official match', 'First goal'])
    expect(nextMilestones({ appearances: 12, goals: 50 })).toEqual([{ label: '25 appearances', current: 12, target: 25 }])
  })
})

describe('player requests and notices', () => {
  it('requires the recipient that each request type routes to', () => {
    const base = { subject: 'Goal missing', message: 'Scored in the 40th minute', tournamentId: '', teamId: '' }
    expect(validateRequest({ ...base, type: 'statistics' })).toMatch(/tournament/)
    expect(validateRequest({ ...base, type: 'team_history' })).toMatch(/team/)
    expect(validateRequest({ ...base, type: 'impersonation' })).toBeNull()
    expect(requestRecipient({}, {})).toBe('Kulhivaru+ platform team')
  })
  it('sorts notification types into categories', () => {
    expect(notificationCategory('team_invitation')).toBe('teams')
    expect(notificationCategory('roster_approved')).toBe('rosters')
    expect(notificationCategory('document_verified')).toBe('documents')
    expect(notificationCategory('result_confirmed')).toBe('results')
    expect(notificationCategory('fixture_changed')).toBe('matches')
    expect(notificationCategory('award_recorded')).toBe('achievements')
  })
  it('maps roster and tournament states to the player statuses', () => {
    expect(playerTournamentStatus({ rosterStatus: 'submitted' }).label).toBe('Pending roster approval')
    expect(playerTournamentStatus({ rosterStatus: 'approved', tournamentStatus: 'in_progress' }).label).toBe('Active')
    expect(playerTournamentStatus({ rosterStatus: 'approved', tournamentStatus: 'completed' }).label).toBe('Completed')
    expect(playerTournamentStatus({ applicationStatus: 'changes_requested' }).label).toBe('Changes requested')
  })
})

describe('migration 030 contracts', () => {
  it('lets only the profile owner read their match feed, using confirmed results only', () => {
    expect(sql).toContain("raise exception 'not_profile_owner'")
    expect(sql).toContain("where v.status = 'confirmed'")
    expect(sql).toContain('revoke execute on function public.get_player_workspace_matches(uuid) from public, anon')
  })
  it('gives every request type a reviewer and stops players inserting resolved requests', () => {
    expect(sql).toContain('public.is_team_manager(team_id)')
    expect(sql).toContain('public.is_platform_admin()')
    expect(sql).toContain("new.status := 'pending'")
  })
  it('keeps preferences and hidden biographies owner-only', () => {
    expect(sql).toContain('create policy "users read own notification preferences" on public.notification_preferences for select to authenticated using (user_id = auth.uid())')
    expect(sql).toContain('alter table public.player_private_details add column if not exists hidden_bio text')
  })
})

describe('claim invitations', () => {
  it('reads only columns that exist on claim_invitations and derives the state', async () => {
    const { claimInvitationState } = await import('./playerWorkspace')
    const loader = readFileSync(resolve(process.cwd(), 'src/lib/playerWorkspace.ts'), 'utf8')
    const table = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210002_persistent_records.sql'), 'utf8')
    const columns = loader.match(/from\('claim_invitations'\)\.select\('([^']+)'\)/)?.[1].split(',') ?? []
    expect(columns.length).toBeGreaterThan(0)
    const definition = table.slice(table.indexOf('create table if not exists public.claim_invitations'), table.indexOf('create index if not exists claim_invitations_player_idx'))
    for (const column of columns) expect(definition).toMatch(new RegExp(`\n  ${column} `))
    expect(claimInvitationState({ accepted_at: '2026-01-01' })).toBe('accepted')
    expect(claimInvitationState({ revoked_at: '2026-01-01' })).toBe('revoked')
    expect(claimInvitationState({ expires_at: '2020-01-01' }, '2026-01-01')).toBe('expired')
    expect(claimInvitationState({ expires_at: '2030-01-01' }, '2026-01-01')).toBe('pending')
  })
})
