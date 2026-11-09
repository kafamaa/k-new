import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  effectivePermissions, entryGroup, financeCsv, financeSummary, fixtureBucket, groupFixtures, mapTeamMatch, roleDefaultPermissions, teamOutcome, teamTotals,
  tournamentHistory, validateFinance, validateRosterLines, validateTeamProfile, toTeamProfile, type FinanceRecord, type RosterLine,
} from './teamHub'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const sql = read('supabase/migrations/202610310031_team_workspace_complete.sql')
const workspace = read('src/components/TeamWorkspace.tsx')
const match = (overrides: Record<string, unknown>) => mapTeamMatch({ match_id: 'm', tournament_id: 't', tournament_name: 'Cup', status: 'scheduled', opponent_name: 'Rivals', ...overrides })

describe('team permissions', () => {
  it('gives managers everything and specialists only their area', () => {
    expect(roleDefaultPermissions('manager')).toHaveLength(9)
    expect(roleDefaultPermissions('finance')).toEqual(['manage_finance'])
    expect(roleDefaultPermissions('coach')).not.toContain('manage_finance')
    expect(effectivePermissions('coach', ['manage_rosters', 'view_documents', 'bogus'])).toEqual(['manage_rosters', 'view_documents'])
    expect(effectivePermissions('manager', [])).toContain('manage_staff')
  })
  it('keeps the SQL defaults and the browser defaults in step', () => {
    for (const role of ['staff', 'assistant_manager', 'roster_admin', 'coach', 'medical', 'media', 'finance']) {
      const line = sql.split('\n').find(row => row.trim().startsWith(`when '${role}' then array[`))!
      const sqlPermissions = [...line.matchAll(/'([a-z_]+)'/g)].map(found => found[1]).slice(1)
      expect(sqlPermissions).toEqual(roleDefaultPermissions(role))
    }
  })
})

describe('team fixtures and history', () => {
  it('groups fixtures into the six spec groups', () => {
    const now = '2026-10-31T00:00:00Z'
    expect(fixtureBucket({ status: 'abandoned', scheduledAt: null }, now)).toBe('abandoned')
    expect(fixtureBucket({ status: 'cancelled', scheduledAt: null }, now)).toBe('cancelled')
    expect(fixtureBucket({ status: 'postponed', scheduledAt: null }, now)).toBe('postponed')
    expect(fixtureBucket({ status: 'scheduled', scheduledAt: '2026-12-01T00:00:00Z' }, now)).toBe('upcoming')
    expect(Object.keys(groupFixtures([], now))).toEqual(['upcoming', 'live', 'completed', 'postponed', 'cancelled', 'abandoned'])
  })
  it('counts confirmed results only, with clean sheets and cards', () => {
    const rows = [
      match({ match_id: 'a', status: 'confirmed', result_confirmed: true, team_score: 2, opponent_score: 0, yellow_cards: 2 }),
      match({ match_id: 'b', status: 'confirmed', result_confirmed: true, team_score: 1, opponent_score: 1, red_cards: 1 }),
      match({ match_id: 'c', status: 'awaiting_confirmation', result_confirmed: false, team_score: 9, opponent_score: 0 }),
    ]
    expect(teamOutcome(rows[0])).toBe('W')
    expect(teamTotals(rows)).toMatchObject({ played: 2, wins: 1, draws: 1, scored: 3, conceded: 1, difference: 2, cleanSheets: 1, yellow: 2, red: 1 })
    expect(tournamentHistory(rows)[0].totals.played).toBe(2)
  })
  it('places entries in the tournament groups', () => {
    expect(entryGroup({ applicationStatus: 'draft', tournamentStatus: 'registration_open' })).toBe('in_progress')
    expect(entryGroup({ applicationStatus: 'under_review', tournamentStatus: 'registration_open' })).toBe('submitted')
    expect(entryGroup({ applicationStatus: 'approved', tournamentStatus: 'in_progress' })).toBe('active')
    expect(entryGroup({ applicationStatus: 'approved', tournamentStatus: 'completed' })).toBe('completed')
  })
})

describe('team rosters, profile and finance', () => {
  const line = (overrides: Partial<RosterLine>): RosterLine => ({ playerId: 'p', name: 'P', shirtNumber: '7', position: '', isCaptain: false, isGoalkeeper: false, claimed: true, identity: 'unknown', ...overrides })
  it('validates roster size, unique shirt numbers and one captain', () => {
    const problems = validateRosterLines([line({ playerId: 'a', isCaptain: true }), line({ playerId: 'b', isCaptain: true }), line({ playerId: 'c', shirtNumber: '' })], { min: 5, max: 12 })
    expect(problems.join(' ')).toMatch(/At least 5/)
    expect(problems.join(' ')).toMatch(/7 used more than once/)
    expect(problems.join(' ')).toMatch(/needs a shirt number/)
    expect(problems.join(' ')).toMatch(/only one captain/)
    expect(validateRosterLines([line({ playerId: 'a' }), line({ playerId: 'b', shirtNumber: '8' })], { min: 2, max: 2 })).toEqual([])
  })
  it('checks profile year, colours and https links', () => {
    const base = toTeamProfile({ name: 'Eagles', team_type: 'club' })
    expect(validateTeamProfile(base)).toBeNull()
    expect(validateTeamProfile({ ...base, establishedYear: '12' })).toMatch(/year/)
    expect(validateTeamProfile({ ...base, primaryColor: 'blue' })).toMatch(/hex/)
    expect(validateTeamProfile({ ...base, socialLinks: { instagram: 'http://x' } })).toMatch(/https/)
  })
  it('sums recorded entries only and exports safe CSV', () => {
    const record = (overrides: Partial<FinanceRecord>): FinanceRecord => ({ id: 'r', kind: 'income', category: 'sponsorship', description: 'Sponsor', amount: 1000, occurredOn: '2026-10-01', tournamentId: null, counterparty: null, receiptPath: null, status: 'recorded', voidReason: null, notes: null, createdAt: '', ...overrides })
    const records = [record({}), record({ kind: 'expense', category: 'travel', amount: 300 }), record({ amount: 500, status: 'void' }), record({ amount: 50, status: 'draft' })]
    expect(financeSummary(records)).toEqual({ income: 1000, expense: 300, balance: 700, drafts: 1 })
    expect(financeCsv([record({ description: '=HYPERLINK("x")' })], () => '')).toContain(`"'=HYPERLINK(""x"")"`)
    expect(validateFinance({ kind: 'income', category: 'travel', description: 'x', amount: '10', occurredOn: '2026-10-01', tournamentId: '', counterparty: '', notes: '', asDraft: false })).toMatch(/category/)
  })
})

describe('team workspace layout', () => {
  it('lists the fifteen sections in the specified order, grouped under the sidebar destinations', () => {
    const order = ['overview', 'profile', 'players', 'invitations', 'tournaments', 'applications', 'rosters', 'matches', 'statistics', 'finance', 'documents', 'notifications', 'staff', 'public', 'settings']
    const positions = order.map(id => workspace.indexOf(`{ id: '${id}'`))
    expect(positions.every(position => position > 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    // Updated for the final menu table (2 Nov 2026): grouping and labels changed; every page/tab is still listed.
    // Final menu: Home, Players, Tournaments, Matches, More, each holding tabs.
    // Owner's workspace design (2026-11-04): nine sidebar destinations; every page and tab is still reachable.
    expect(workspace).toContain("const MOBILE_PRIMARY: TeamGroup[] = ['home', 'squad', 'competitions', 'games']")
    expect(workspace).toContain("{ id: 'squad', label: 'Squad', icon: Users, tabs: ['players', 'invitations'] }")
    expect(workspace).toContain("{ id: 'more', label: 'Team Settings', shortLabel: 'Settings', icon: Settings, tabs: ['profile', 'public', 'notifications', 'settings'] }")
    for (const tab of ['finance', 'documents', 'staff']) expect(workspace).toContain(`tabs: ['${tab}']`)
    expect(workspace).toContain("get('section')")
  })
})

describe('migration 031 contracts', () => {
  it('stops staff granting permissions they lack and audits staff changes', () => {
    expect(sql).toContain("raise exception 'cannot_grant_%', permission")
    expect(sql).toContain("'team_staff_permissions_changed'")
  })
  it('keeps finance void-only and documents private', () => {
    expect(sql).toContain("raise exception 'recorded_entries_can_only_be_voided_with_reason'")
    expect(sql).toContain("insert into storage.buckets (id, name, public) values ('team-private', 'team-private', false)")
    expect(sql).toContain("case when (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$' then (")
  })
  it('validates rosters on the server and keeps every version', () => {
    for (const code of ['roster_below_minimum', 'duplicate_shirt_number', 'more_than_one_captain', 'player_not_active_member', 'roster_locked']) expect(sql).toContain(`'${code}'`)
    expect(sql).toContain('select coalesce(max(version), 0) + 1 into next_version')
  })
  it('qualifies the unclaimed-player delete policy against self-joins', () => {
    expect(sql).toContain('where ms.player_id = player_profiles.id')
  })
})
