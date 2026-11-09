import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { organizerHash, parseOrganizerSubroute, tournamentHash, tournamentRouteId, type TournamentEntry } from './organizer'
import { isWriteRequest, saveStatusLabel } from './saveStatus'
import { createDetailSteps, createDetailsProblem, EMPTY_CREATE_DETAILS, parseCategories } from './tournamentCreate'
import { careerEvents, derivedKey, drawPreview, EMPTY_SCOREBOARD, scheduleRulesProblem, DEFAULT_SCHEDULE_RULES, shuffledOrder, teamsConfirmBlockers, teamsSections } from './simpleFlow'
import { correctionImpact, latestStage, semiFinalLosers, thirdPlaceEnabled, type CompetitionStage, type StageMatch } from './advancement'
import { suspendedPlayerIds, type Suspension } from './discipline'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')
const entry = (id: string, extra: Partial<TournamentEntry> = {}): TournamentEntry => ({ id, team_id: `team-${id}`, application_status: 'approved', roster_status: 'approved', payment_status: 'not_required', review_notes: null, reviewed_at: null, submitted_at: null, team_name: `Team ${id}`, team_slug: null, latest_roster_status: null, latest_roster_version: null, ...extra })

// Owner's tournament workflow, 2026-11-03.
describe('1. Tournament route and workspace shell', () => {
  it('opens every tournament at #workspace/tournament/:id and keeps old links working', () => {
    expect(tournamentHash('t-1')).toBe('#workspace/tournament/t-1')
    expect(organizerHash('org-1', { tournamentId: 't-1', tab: 'teams' })).toBe('#workspace/tournament/t-1?tab=teams')
    expect(tournamentRouteId('#workspace/tournament/t%201?tab=x')).toBe('t 1')
    expect(tournamentRouteId('#workspace/organization/o')).toBeNull()
    expect(parseOrganizerSubroute('#workspace/organization/o?tid=t-2&tab=matches').tournamentId).toBe('t-2')
  })
  it('only opens a tournament inside an organization the account belongs to', () => {
    const panel = read('src/components/WorkspacePanel.tsx')
    expect(panel).toContain("workspace.kind === 'organization' && workspace.id === tournamentOwner.organizationId")
    expect(panel).toContain('That tournament is not available to this account.')
  })
  it('shows phase, publication, back, switch, preview and save status in the header', () => {
    const shell = read('src/components/OrganizerWorkspace.tsx')
    const workspace = read('src/components/TournamentWorkspace.tsx')
    for (const text of ['Back to Organization', 'Switch Tournament', '<SaveStatusBadge />']) expect(shell).toContain(text)
    for (const text of ['Phase: {phaseName}', 'Preview Public Page', "'Published'", 'Private draft']) expect(workspace.includes(text) || workspace.includes(text.replace(/'/g, ''))).toBe(true)
  })
  it('counts only real writes as saving', () => {
    expect(isWriteRequest('PATCH', 'https://x.supabase.co/rest/v1/tournaments?id=eq.1')).toBe(true)
    expect(isWriteRequest('POST', 'https://x.supabase.co/rest/v1/rpc/confirm_match_result')).toBe(true)
    expect(isWriteRequest('POST', 'https://x.supabase.co/rest/v1/rpc/get_public_match_feed')).toBe(false)
    expect(isWriteRequest('GET', 'https://x.supabase.co/rest/v1/tournaments')).toBe(false)
    expect(isWriteRequest('POST', 'https://x.supabase.co/auth/v1/token')).toBe(false)
    expect(isWriteRequest('POST', 'https://x.supabase.co/rest/v1/profiles?on_conflict=id')).toBe(false)
    expect(isWriteRequest('POST', 'https://x.supabase.co/storage/v1/object/sign/private/a')).toBe(false)
    expect(isWriteRequest('POST', 'https://x.supabase.co/storage/v1/object/public-media/a.png')).toBe(true)
    expect(saveStatusLabel({ state: 'saving', at: null })).toBe('Saving…')
    expect(saveStatusLabel({ state: 'error', at: 1 })).toMatch(/^Not saved/)
    expect(saveStatusLabel({ state: 'saved', at: 1000 }, 2000)).toBe('Saved')
  })
})

describe('2. Create phase', () => {
  it('needs only name and sport, and saves optional details without blanks', () => {
    expect(createDetailSteps('Cup', 'football', EMPTY_CREATE_DETAILS)).toEqual([])
    const steps = createDetailSteps('Cup', 'football', { ...EMPTY_CREATE_DETAILS, season: '2026', atoll: 'Kaafu', venues: 'A, B', startsAt: '2026-12-01', rules: 'FIFA laws' })
    expect(steps).toEqual([
      { step: 1, data: { name: 'Cup', sport: 'football', season: '2026', atoll: 'Kaafu' } },
      { step: 7, data: { rules: 'FIFA laws' } },
      { step: 8, data: { startsAt: '2026-12-01', venue: 'A', venues: ['A', 'B'] } },
    ])
    expect(createDetailsProblem({ ...EMPTY_CREATE_DETAILS, startsAt: '2026-12-05', endsAt: '2026-12-01' })).toMatch(/end date/)
    expect(parseCategories('Open, U17, Open,\nWomen')).toEqual(['Open', 'U17', 'Women'])
  })
  it('uses file uploads for logo and cover, never URL fields', () => {
    const form = read('src/components/OrganizerWorkspace.tsx')
    expect(form).toContain('<label>Logo (optional)<input type="file"')
    expect(form).toContain('<label>Cover (optional)<input type="file"')
    expect(form).toContain('More details (optional)')
  })
})

describe('3. Teams phase', () => {
  it('holds Confirm Teams until every open decision is made', () => {
    expect(teamsConfirmBlockers([entry('a'), entry('b')], new Map())).toEqual([])
    const blockers = teamsConfirmBlockers([entry('a', { application_status: 'submitted' }), entry('b', { roster_status: 'submitted' }), entry('c', { payment_status: 'proof_submitted' }), entry('d')], new Map([['d', ['A player is also on another team’s roster']]]))
    expect(blockers).toHaveLength(4)
    expect(read('src/components/SimpleTournamentFlow.tsx')).toContain('disabled={approved.length < 2 || blockers.length > 0}')
  })
  it('shows Registration, Applications, Confirmed teams, Players, Rosters, Eligibility and Payments', () => {
    const sections = teamsSections({ status: 'registration_open', entries: [entry('a', { payment_status: 'unpaid' })], players: 9, eligibilityProblems: new Map(), fee: true })
    expect(sections.map(section => section.label)).toEqual(['Registration', 'Applications', 'Confirmed teams', 'Players', 'Rosters', 'Eligibility', 'Payments'])
    expect(sections.find(section => section.id === 'payments')?.value).toBe('1 unpaid')
    expect(teamsSections({ status: 'draft', entries: [], players: null, eligibilityProblems: null, fee: false }).find(section => section.id === 'eligibility')?.value).toBe('Not checked')
  })
})

describe('4. Schedule phase', () => {
  it('previews exactly the draw that Confirm Draw creates', () => {
    const teams = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const preview = drawPreview('groups_knockout', teams, 2)
    expect(preview.groups).toHaveLength(2)
    expect(preview.fixtures).toHaveLength(12)
    expect(drawPreview('knockout', ['a', 'b', 'c'], 1).byes).toHaveLength(1)
    expect(shuffledOrder(teams, () => 0).sort()).toEqual(teams)
  })
  it('checks points, rest and match length', () => {
    expect(scheduleRulesProblem(DEFAULT_SCHEDULE_RULES, ['16:00', '18:00'])).toBeNull()
    expect(scheduleRulesProblem(DEFAULT_SCHEDULE_RULES, ['16:00', '17:00'])).toMatch(/closer together/)
    expect(scheduleRulesProblem({ ...DEFAULT_SCHEDULE_RULES, pointsWin: 20 }, ['16:00'])).toMatch(/Points/)
  })
  it('never replaces a published schedule and keeps a replaced draft', () => {
    const flow = read('src/components/SimpleTournamentFlow.tsx')
    expect(flow).toContain("const canRegenerate = !published && active.length > 0 && active.every(match => match.status === 'scheduled')")
    expect(flow).toContain("'Draft schedule replaced before publishing'")
    expect(flow).not.toMatch(/from\('matches'\)\.delete\(/)
  })
  it('adds a third-place match between the semi-final losers', () => {
    const stages: CompetitionStage[] = [{ id: 's1', categoryId: 'c', name: 'Semi-finals', format: 'knockout', stageOrder: 1, rules: { third_place: true } }, { id: 's2', categoryId: 'c', name: 'Third-place match', format: 'knockout', stageOrder: 2, rules: { third_place_match: true } }]
    const matches: StageMatch[] = [
      { id: 'm1', stageId: 's1', groupId: null, homeTeamId: 'a', awayTeamId: 'b', status: 'confirmed', score: { home: 2, away: 0 } },
      { id: 'm2', stageId: 's1', groupId: null, homeTeamId: 'c', awayTeamId: 'd', status: 'confirmed', score: { home: 1, away: 1, homeShootout: 3, awayShootout: 4 } },
    ]
    expect(thirdPlaceEnabled(stages, 'c')).toBe(true)
    expect(semiFinalLosers(stages[0], matches)).toEqual(['b', 'c'])
    expect(latestStage(stages, 'c')?.id).toBe('s1')
  })
})

describe('5. Match Center', () => {
  it('records penalty goals, own goals and second yellows with valid UUID keys', () => {
    const key = '123e4567-e89b-42d3-a456-426614174000'
    const board = { ...EMPTY_SCOREBOARD, phase: 'finished' as const, scores: [{ key, side: 'home' as const, points: 1, playerId: 'p1', assistId: 'p2', method: 'penalty' as const }, { key: key.replace('000', '001'), side: 'away' as const, points: 1, playerId: 'h9', assistId: null, method: 'own_goal' as const }], cards: [{ key: key.replace('000', '002'), side: 'home' as const, card: 'second_yellow' as const, playerId: 'p3' }] }
    const events = careerEvents(board, 'football', { home: 'H', away: 'A' })
    expect(events[0]).toEqual({ key, teamId: 'H', playerId: 'p1', eventType: 'goal', payload: { method: 'penalty' } })
    expect(events[1]).toMatchObject({ teamId: 'H', playerId: 'p2', eventType: 'assist' })
    expect(events[1].key).toMatch(/^[0-9a-f-]{36}$/)
    expect(events[2]).toMatchObject({ teamId: 'H', playerId: 'h9', eventType: 'own_goal' })
    expect(events.slice(3).map(event => event.eventType)).toEqual(['yellow_card', 'red_card'])
    expect(new Set(events.map(event => event.key)).size).toBe(events.length)
    expect(derivedKey(key, 1)).not.toBe(key)
  })
  it('keeps a private note and the walkover outcome out of public pages', () => {
    const flow = read('src/components/SimpleTournamentFlow.tsx')
    expect(flow).toContain('Never shown on the public page.')
    expect(flow).toContain("if (outcome !== 'played') score.outcome = outcome")
    expect(read('supabase/migrations/202611010038_public_pages_complete.sql')).not.toMatch(/'note'/)
  })
})

describe('6–8. Calculations, corrections and finish', () => {
  it('warns when a correction changes a knockout winner after the next round exists', () => {
    const stages: CompetitionStage[] = [{ id: 's1', categoryId: 'c', name: 'Semi-finals', format: 'knockout', stageOrder: 1, rules: {} }, { id: 's2', categoryId: 'c', name: 'Final', format: 'knockout', stageOrder: 2, rules: { previous_stage_id: 's1' } }]
    const matches: StageMatch[] = [{ id: 'm1', stageId: 's1', groupId: null, homeTeamId: 'a', awayTeamId: 'b', status: 'confirmed', score: { home: 2, away: 0 } }]
    expect(correctionImpact({ stages, matches }, 'm1', { home: 0, away: 1 })).toEqual({ previous: { home: 2, away: 0 }, laterRound: 'Final', winnerChanges: true })
    expect(correctionImpact({ stages, matches }, 'm1', { home: 3, away: 0 }).winnerChanges).toBe(false)
    expect(read('src/components/TournamentWorkspace.tsx')).toContain('I understand and will fix {impact.laterRound}.')
  })
  it('lists suspended players only while the suspension is active', () => {
    const base: Suspension = { id: '1', playerId: 'p1', playerName: 'A', teamId: 't', reason: 'red_card', matchesBanned: 1, status: 'active', note: null, createdAt: '', resolutionReason: null }
    expect([...suspendedPlayerIds([base, { ...base, id: '2', playerId: 'p2', status: 'served' }])]).toEqual(['p1'])
  })
  it('finishes with the full checklist and archives instead of deleting', () => {
    const flow = read('src/components/SimpleTournamentFlow.tsx')
    for (const text of ['Suspensions reviewed', 'Statistics rebuilt from confirmed results', 'Public archive previewed', 'Finish and Publish Archive']) expect(flow).toContain(text)
    expect(flow).toContain("setTournamentStatus(client, tournament.id, 'completed')")
  })
  it('migration 044 is additive, private and audited', () => {
    const sql = read('supabase/migrations/202611010044_match_discipline.sql')
    expect(sql).toContain("'penalty_miss'")
    expect(sql.match(/security definer set search_path = ''/g)).toHaveLength(4)
    expect(sql).toContain('alter table public.player_suspensions enable row level security;')
    expect(sql).toContain('revoke all on public.player_suspensions from anon;')
    expect(sql).not.toMatch(/\b(drop table|delete from|truncate)\b/i)
    for (const name of ['refresh_tournament_suspensions(uuid)', 'add_player_suspension(uuid, uuid, uuid, integer, text)', 'resolve_player_suspension(uuid, text, text)']) expect(sql).toContain(`revoke execute on function public.${name} from public, anon;`)
    expect(sql).toContain("m.status = 'confirmed'")
  })
})

describe('9–10. Public page, media and reports', () => {
  it('offers ranking graphics, match sheets, standings and a final report without private data', () => {
    const sheets = read('src/components/ReportSheets.tsx')
    for (const text of ['Print match sheet', 'Final tournament report', "'Standings'", 'No approved squad list.']) expect(sheets.includes(text) || sheets.includes(text.replace(/'/g, ''))).toBe(true)
    expect(sheets).not.toMatch(/national|phone|email|payment_proof|review_notes/i)
    const image = read('src/lib/resultImage.ts')
    expect(image).toContain('export function drawRankingCard')
    expect(read('src/components/TournamentPublicTabs.tsx')).toContain('renderRankingImage')
  })
  it('shows a final archive on finished tournaments', () => {
    expect(read('src/components/PublicPage.tsx')).toContain('<h2 className="ed-subhead">Final archive</h2>')
  })
  it('prints any page, not only the player card', () => {
    expect(read('src/styles.css')).toContain('@media print{body:has(.player-card-print) *{visibility:hidden}')
  })
})
