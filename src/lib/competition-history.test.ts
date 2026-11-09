import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { bracketByes, groupAdvancement, groupQualifierFixtures, knockoutAdvancement, matchWinner, parseStageScore, roundName, type CompetitionStage, type StageMatch } from './advancement'
import { awardBlockers, sortStandings, validateAward, type StandingsRow } from './competitionRecords'
import { buildImportRows, defaultSelection, markExistingDuplicates, normalizeName, parseCsv } from './csvImport'
import { activeGuardianScopes, guardianError, normalizeMaldivianId, validateIdentityInput } from './identity'
import { formatFileSize } from './documents'
import { validateNewsDraft } from './news'
import { isPermanentRejection, replayOperations } from './matchCenter'
import type { SyncOperation } from './matchOperations'
import { knockoutFixtures } from './competition'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const stage = (format: string, rules: Record<string, unknown> = {}): CompetitionStage => ({ id: 's1', categoryId: 'c1', name: 'Round 1', format, stageOrder: 1, rules })
const match = (id: string, home: string, away: string, score: StageMatch['score'], status = 'confirmed', groupId: string | null = null): StageMatch => ({ id, stageId: 's1', groupId, homeTeamId: home, awayTeamId: away, status, score })

describe('knockout advancement', () => {
  it('advances winners and carries byes forward', () => {
    const plan = knockoutAdvancement(stage('knockout', { byes: ['E'] }), [match('m1', 'A', 'B', { home: 2, away: 0 }), match('m2', 'C', 'D', { home: 0, away: 1 })])
    expect(plan.problems).toEqual([])
    expect(plan.teams).toEqual(['A', 'D', 'E'])
    expect(plan.fixtures.length + plan.byes.length * 0.5).toBeGreaterThan(0)
  })
  it('decides a level match by shootout and blocks one without', () => {
    expect(matchWinner(match('m', 'A', 'B', { home: 1, away: 1, homeShootout: 4, awayShootout: 5 })).winner).toBe('B')
    expect(matchWinner(match('m', 'A', 'B', { home: 1, away: 1 })).problem).toMatch(/shootout/)
  })
  it('waits for unconfirmed matches and names a champion from a final', () => {
    expect(knockoutAdvancement(stage('knockout'), [match('m1', 'A', 'B', null, 'scheduled')]).problems[0]).toMatch(/confirmed result/)
    expect(knockoutAdvancement(stage('knockout'), [match('f', 'A', 'B', { home: 3, away: 2 })]).champion).toBe('A')
  })
  it('records teams left without a first-round match as byes', () => {
    // An odd field pairs one team with an empty slot; knockoutFixtures leaves
    // it out, so it must be recorded as a bye instead of disappearing.
    const teams = ['A', 'B', 'C', 'D', 'E']
    expect(bracketByes(teams, knockoutFixtures(teams))).toEqual(['E'])
    expect(bracketByes(['A', 'B', 'C', 'D', 'E', 'F'], knockoutFixtures(['A', 'B', 'C', 'D', 'E', 'F']))).toEqual([])
  })
  it('names rounds by size', () => {
    expect(roundName(2, 3)).toBe('Final')
    expect(roundName(4, 2)).toBe('Semi-finals')
  })
  it('parses only numeric scores', () => {
    expect(parseStageScore({ home: '1', away: 2 })).toBeNull()
    expect(parseStageScore({ home: 1, away: 2, homeShootout: 3, awayShootout: 1 })).toEqual({ home: 1, away: 2, homeShootout: 3, awayShootout: 1 })
  })
})

describe('groups to knockout', () => {
  it('crosses group winners with neighbouring runners-up', () => {
    const { fixtures } = groupQualifierFixtures([['A1', 'A2'], ['B1', 'B2']], 2)
    expect(fixtures.map(f => [f.homeTeamId, f.awayTeamId])).toEqual([['A1', 'B2'], ['B1', 'A2']])
  })
  it('ranks each group from confirmed results', () => {
    const groups = [{ id: 'g1', name: 'Group A', stageId: 's1' }, { id: 'g2', name: 'Group B', stageId: 's1' }]
    const plan = groupAdvancement(stage('groups_knockout', { qualifiers_per_group: 2 }), [
      match('1', 'A', 'B', { home: 3, away: 0 }, 'confirmed', 'g1'),
      match('2', 'C', 'D', { home: 0, away: 2 }, 'confirmed', 'g2'),
    ], groups)
    expect(plan.problems).toEqual([])
    expect(plan.fixtures.map(f => [f.homeTeamId, f.awayTeamId])).toEqual([['A', 'C'], ['D', 'B']])
  })
})

describe('standings and awards', () => {
  const row = (teamId: string, points: number, scored: number, conceded: number): StandingsRow => ({ stageId: 's', groupId: null, teamId, played: 1, wins: 0, draws: 0, losses: 0, scored, conceded, points, version: 1 })
  it('orders by points, then goal difference, then goals scored', () => {
    expect(sortStandings([row('a', 3, 1, 0), row('b', 3, 3, 1), row('c', 4, 0, 0)]).map(r => r.teamId)).toEqual(['c', 'b', 'a'])
  })
  it('requires a champion before completion and the right recipient for each award', () => {
    expect(awardBlockers([])).toHaveLength(1)
    expect(awardBlockers([{ id: '1', kind: 'champion', label: 'Champion', teamId: 't', playerId: null, reachedAt: null }])).toEqual([])
    expect(validateAward({ kind: 'champion', teamId: null, playerId: null, label: '' })).toMatch(/team/)
    expect(validateAward({ kind: 'top_scorer', teamId: 't', playerId: null, label: '' })).toMatch(/player/)
  })
})

describe('CSV import', () => {
  it('parses quoted fields, embedded commas and CRLF', () => {
    expect(parseCsv('name,island\r\n"Club, Malé",Malé\r\n"Say ""hi""",\r\n')).toEqual([['name', 'island'], ['Club, Malé', 'Malé'], ['Say "hi"', '']])
  })
  it('flags problems, in-file repeats and existing duplicates, and leaves them unselected', () => {
    const { rows } = buildImportRows('team', parseCsv('name,island,team_type\nWigani,Kanditheemu,club\nwigani,Kanditheemu,club\n,Malé,club\nNew FC,Malé,league'))
    expect(rows[1].duplicateInFile).toBe(true)
    expect(rows[2].problems[0]).toMatch(/empty/)
    expect(rows[3].problems[0]).toMatch(/Team type/)
    const marked = markExistingDuplicates(rows, [{ name: 'Wigani', island: 'Kanditheemu' }])
    expect(marked[0].duplicateOf).toContain('Wigani')
    expect([...defaultSelection(marked)]).toEqual([])
  })
  it('requires the named columns', () => {
    expect(buildImportRows('player', parseCsv('island\nMalé')).headerProblems[0]).toMatch(/Missing: name/)
    expect(normalizeName('  Malé  City ')).toBe('malé city')
  })
})

describe('identity and guardians', () => {
  it('accepts only the Maldivian ID card format', () => {
    expect(normalizeMaldivianId(' a-123 456 ')).toBe('A123456')
    expect(normalizeMaldivianId('123456')).toBeNull()
    expect(validateIdentityInput({ identifierType: 'foreign_document', value: 'N1234567', documentType: 'passport', issuingCountry: 'IND' })).toMatch(/two-letter/)
  })
  it('counts only unrevoked approvals', () => {
    expect(activeGuardianScopes([{ id: '1', guardianName: 'A', relationship: 'parent', approvesClaim: true, approvesPublicProfile: true, createdAt: '', revokedAt: '2026-01-01' }])).toEqual({ claim: false, publicProfile: false })
    expect(guardianError('guardian_approval_required_for_public_profile')).toMatch(/made public/)
  })
})

describe('offline replay', () => {
  const op = (status: SyncOperation['status'], base: number | null): SyncOperation => ({ operationId: crypto.randomUUID(), matchId: 'm', actorId: 'u', operationType: 'event', payload: { eventType: 'goal' }, baseResultVersion: base, status })
  it('marks a version change as a conflict and never resends conflicts', async () => {
    const result = await replayOperations({} as SupabaseClient, [op('queued', 1), op('conflict', 1)], { m: 2 })
    expect(result.map(item => item.status)).toEqual(['conflict', 'conflict'])
  })
  it('stops retrying permanent refusals but keeps network failures queued', async () => {
    const client = { rpc: async (_: string, args: { p_idempotency_key: string }) => ({ data: null, error: { message: args.p_idempotency_key === 'a' ? 'match_already_confirmed' : 'Failed to fetch' } }) } as unknown as SupabaseClient
    const result = await replayOperations(client, [{ ...op('queued', null), operationId: 'a' }, { ...op('queued', null), operationId: 'b' }], {})
    expect(result.map(item => item.status)).toEqual(['rejected', 'queued'])
    expect(isPermanentRejection('unsupported_event_type')).toBe(true)
  })
})

describe('small helpers', () => {
  it('formats sizes and validates news', () => {
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(validateNewsDraft({ title: '', excerpt: '', body: 'x', contentType: 'news', tournamentId: null, mediaUrl: '', featured: false })).toMatch(/title/)
    expect(validateNewsDraft({ title: 'T', excerpt: '', body: '', contentType: 'video_link', tournamentId: null, mediaUrl: 'http://x', featured: false })).toMatch(/https/)
  })
})

describe('migration 025 contracts', () => {
  const sql = read('supabase/migrations/202610300025_history_engine.sql')
  it('rebuilds standings and milestones on confirmation and correction', () => {
    expect(sql.match(/perform public\.recalculate_stage_standings\(match_row\.stage_id\)/g)).toHaveLength(3)
    expect(sql.match(/perform public\.recalculate_match_milestones\(match_row\.id\)/g)).toHaveLength(3)
    expect(sql).toContain("where sm.is_manual = false")
  })
  it('limits score and event writes to assigned officials or operators and closes direct writes', () => {
    expect(sql).toContain('not (public.is_match_official(p_match_id) or public.is_tournament_operator(match_row.tournament_id))')
    expect(sql).toContain('drop policy if exists "officials submit results" on public.match_result_versions;')
    expect(sql).toContain('drop policy if exists "assigned officials manage events" on public.match_events;')
    expect(sql).not.toMatch(/create policy "assigned officials manage events"/)
  })
  it('keeps the recalculation functions server-only', () => {
    expect(sql).toContain('revoke execute on function public.recalculate_stage_standings(uuid) from public, anon, authenticated;')
    expect(sql).toContain('revoke execute on function public.recalculate_match_milestones(uuid) from public, anon, authenticated;')
  })
})

describe('migration 026 and identity functions', () => {
  const sql = read('supabase/migrations/202610300026_identity_guardian_import.sql')
  const identity = read('supabase/functions/register-identity/index.ts')
  const invite = read('supabase/functions/invite-workspace-member/index.ts')
  it('blocks a minor claim or publication without guardian approval', () => {
    expect(sql).toContain("if player.is_minor and not public.has_guardian_approval(p_player_id, 'claim') then")
    expect(sql).toContain('guardian_approval_required_for_public_profile')
  })
  it('never stores or logs a readable identity number', () => {
    expect(identity).toContain('IDENTITY_HMAC_SECRET')
    expect(identity).not.toContain('console.log')
    expect(identity).not.toMatch(/insert\(\{[^}]*value:/)
    expect(sql).not.toMatch(/national_id\s+text/)
  })
  it('lets only managers or owners invite, never granting ownership', () => {
    expect(invite).toContain("membership.data.role !== (isTeam ? 'manager' : 'owner')")
    expect(invite).toContain("const ORGANIZATION_ROLES = ['staff', 'finance', 'operations', 'media']")
    expect(invite).not.toContain('console.log')
  })
})
