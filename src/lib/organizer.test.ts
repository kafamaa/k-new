import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addOrganizerEntry,
  addTournamentCategory,
  attentionItems,
  canManageFinance,
  canManageStaff,
  canManageTournaments,
  cockpitAttentionItems,
  cockpitNextAction,
  competitionReadinessItems,
  completionReadinessItems,
  drawEligibleTeamIds,
  formatMvr,
  isOrganizerSection,
  lifecycleProgress,
  loadConfirmedResultScores,
  loadLatestResultVersion,
  loadMyTournamentNotifications,
  loadRegistrationSettings,
  loadRegistrationTeamLimit,
  loadOrganizationTeamLinks,
  loadOrganizationTournaments,
  loadOrganizationWorkflowCounts,
  loadTournamentCategories,
  loadTournamentCockpit,
  loadTournamentEntries,
  loadTournamentMatches,
  loadTournamentSetupSteps,
  organizerNav,
  organizerHash,
  operationalSummary,
  overviewCounts,
  parseOrganizerSubroute,
  primaryNextAction,
  publishTournament,
  sanitizeSearchTerm,
  searchExistingPlayers,
  searchExistingTeams,
  setTournamentStatus,
  setupProgress,
  setupReadinessItems,
  setupStatuses,
  sportLabel,
  standingsPreview,
  tournamentBaseHash,
  tournamentTabHash,
  tournamentCompletionBlockers,
  tournamentLifecycle,
  emptyWorkflowCounts,
  tournamentNextAction,
  tournamentStatusLabel,
  updateTournamentBasics,
  upcomingMatchesList,
  type OrganizerCounts,
  type SetupProgress,
  type TournamentWorkflowCounts,
  type SetupStepRecord,
} from './organizer'
import { SETUP_STEPS } from './tournament'

type RecordedCall = { table: string; columns: string; filters: [string, unknown][]; limit: number | null; isFilters: [string, unknown][]; orFilter: string | null }

// A per-table stub that records the query shape and resolves rows, so loaders
// can be asserted against the exact tables and columns they request.
function createClient(tables: Record<string, unknown[]>, errors: Record<string, string> = {}): { client: SupabaseClient; calls: RecordedCall[]; recorded: Record<string, unknown>[] } {
  const calls: RecordedCall[] = []
  const recorded: Record<string, unknown>[] = []
  const client = {
    from: (table: string) => {
      const call: RecordedCall = { table, columns: '', filters: [], limit: null, isFilters: [], orFilter: null }
      calls.push(call)
      const result = () => ({ data: tables[table] ?? [], error: errors[table] ? { message: errors[table] } : null })
      const chain: Record<string, unknown> = {}
      chain.select = (columns: string) => { call.columns = columns; return chain }
      chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain }
      chain.in = (column: string, ids: unknown[]) => { call.filters.push([column, ids]); return chain }
      chain.is = (column: string, value: unknown) => { call.isFilters.push([column, value]); return chain }
      chain.or = (value: string) => { call.orFilter = value; return chain }
      chain.order = () => chain
      chain.limit = (value: number) => { call.limit = value; return chain }
      chain.maybeSingle = () => Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: errors[table] ? { message: errors[table] } : null })
      chain.single = () => Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: errors[table] ? { message: errors[table] } : null })
      chain.insert = (payload: Record<string, unknown>) => { recorded.push(payload); return chain }
      chain.update = (payload: Record<string, unknown>) => { recorded.push(payload); return chain }
      chain.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(result()).then(onFulfilled)
      return chain
    },
  } as unknown as SupabaseClient
  return { client, calls, recorded }
}

// The wizard has nine stages (owner's 2026-10-23 revision). Storage keys stay
// [1..8, 11] so historical rows are never remapped or lost.
describe('setup stages', () => {
  it('documents exactly the nine specified stages in order', () => {
    expect(SETUP_STEPS).toHaveLength(9)
    expect(SETUP_STEPS[0]).toBe('Basics')
    expect(SETUP_STEPS[8]).toBe('Review and launch')
  })
})

describe('setup progress (resumable)', () => {
  const step = (step_number: number, status: SetupStepRecord['status']): SetupStepRecord => ({ step_number, status, data: {}, updated_at: null })

  it('starts every stage not started when no rows exist', () => {
    const progress = setupProgress([])
    expect(progress.complete).toBe(0)
    expect(progress.percent).toBe(0)
    expect(progress.currentStep).toBe(1)
    expect(progress.statuses).toHaveLength(9)
    expect(progress.statuses.every(status => status === 'not_started')).toBe(true)
  })

  it('resumes at the first incomplete stage after earlier ones are complete', () => {
    const progress = setupProgress([step(1, 'complete'), step(2, 'complete'), step(3, 'in_progress')])
    expect(progress.complete).toBe(2)
    expect(progress.currentStep).toBe(3)
  })

  it('skips stages already complete so setup resumes after a reload', () => {
    const progress = setupProgress([step(1, 'complete'), step(2, 'complete'), step(4, 'complete')])
    expect(progress.currentStep).toBe(3)
    expect(progress.complete).toBe(3)
  })

  it('reads wizard stage 9 from stored key 11 and completes at nine stages', () => {
    const progress = setupProgress([1, 2, 3, 4, 5, 6, 7, 8, 11].map(n => step(n, 'complete')))
    expect(progress.complete).toBe(9)
    expect(progress.percent).toBe(100)
    expect(progress.currentStep).toBe(9)
    expect(progress.statuses[8]).toBe('complete')
  })

  it('never lets rows from the retired keys 9 and 10 drive wizard progress', () => {
    // Officials and Finance left the wizard; they are standalone management
    // modules now, so their old completion rows must neither complete nor
    // block any wizard stage.
    const progress = setupProgress([1, 2, 3, 4].map(n => step(n, 'complete')).concat([step(9, 'complete'), step(10, 'complete')]))
    expect(progress.complete).toBe(4)
    expect(progress.currentStep).toBe(5)
    expect(progress.statuses).toHaveLength(9)
  })

  it('treats set-later as never complete but does not force the organizer back to it on resume', () => {
    const progress = setupProgress([step(1, 'complete'), step(2, 'complete'), step(3, 'complete'), step(4, 'complete'), step(5, 'complete'), step(6, 'deferred')])
    expect(progress.statuses[5]).toBe('deferred')
    expect(progress.complete).toBe(5)
    expect(progress.percent).toBe(56) // 5 of 9 stages
    // The deferred stage is a conscious decision, so resume continues after it.
    expect(progress.currentStep).toBe(7)
  })

  it('never counts a stage complete when it is deferred', () => {
    const progress = setupProgress([step(1, 'complete'), step(2, 'deferred')])
    expect(progress.complete).toBe(1)
    expect(progress.percent).toBe(11)
  })

  it('ignores out-of-range or non-integer stage numbers', () => {
    const statuses = setupStatuses([step(0, 'complete'), step(12, 'complete'), step(1, 'complete'), { step_number: 2.5, status: 'complete', data: {}, updated_at: null }])
    expect(statuses[0]).toBe('complete')
    expect(statuses.filter(status => status === 'complete')).toHaveLength(1)
  })

  it('treats blocked and needs-review stages as incomplete so they stay visible', () => {
    const blocked = setupProgress([step(1, 'complete'), step(2, 'blocked')])
    expect(blocked.currentStep).toBe(2)
    const review = setupProgress([step(1, 'complete'), step(2, 'complete'), step(3, 'needs_review')])
    expect(review.complete).toBe(2)
    expect(review.currentStep).toBe(3)
  })
})

describe('counts (applications, rosters, payments, matches counted separately)', () => {
  const counts: OrganizerCounts = overviewCounts(
    [
      { status: 'draft', is_published: false },
      { status: 'setup', is_published: false },
      { status: 'registration_open', is_published: true },
      { status: 'in_progress', is_published: true },
      { status: 'completed', is_published: true },
    ],
    [
      { application_status: 'submitted', roster_status: 'not_started', payment_status: 'unpaid' },
      { application_status: 'under_review', roster_status: 'submitted', payment_status: 'proof_submitted' },
      { application_status: 'approved', roster_status: 'approved', payment_status: 'paid' },
      { application_status: 'rejected', roster_status: 'rejected', payment_status: 'not_required' },
    ],
    [
      { status: 'scheduled' },
      { status: 'awaiting_confirmation' },
      { status: 'confirmed' },
      { status: 'postponed' },
    ],
  )

  it('never merges the four workflow areas into one number', () => {
    expect(counts.applicationsPending).toBe(2)
    expect(counts.rostersPending).toBe(1)
    expect(counts.paymentsPending).toBe(1)
    expect(counts.matchesAwaitingConfirmation).toBe(1)
  })

  it('separates drafts from published and in-progress tournaments', () => {
    expect(counts.tournamentsTotal).toBe(5)
    expect(counts.tournamentsDraft).toBe(2)
    expect(counts.tournamentsPublished).toBe(3)
    expect(counts.tournamentsInProgress).toBe(1)
  })

  it('counts every unresolved match status, not only scheduled', () => {
    expect(counts.matchesUnresolved).toBe(3)
  })

  it('returns all zeroes for a genuinely empty organization', () => {
    expect(overviewCounts([], [], [])).toEqual({
      tournamentsTotal: 0,
      tournamentsDraft: 0,
      tournamentsPublished: 0,
      tournamentsInProgress: 0,
      applicationsPending: 0,
      rostersPending: 0,
      paymentsPending: 0,
      matchesUnresolved: 0,
      matchesAwaitingConfirmation: 0,
    })
  })
})

describe('next action ladder (one prominent instruction from real rows)', () => {
  const emptyCounts = { applicationsPending: 0, entriesTotal: 0, approvedEntries: 0, matchesTotal: 0, matchesUnresolved: 0, matchesAwaitingConfirmation: 0 }
  const progress = (complete: number, currentStep: number): SetupProgress => ({ statuses: [], complete, total: 9, percent: Math.round((complete / 9) * 100), currentStep })
  const ctx = (overrides: Partial<Parameters<typeof tournamentNextAction>[0]>) => ({ status: 'setup' as const, isPublished: false, progress: progress(0, 1), counts: emptyCounts, ...overrides })

  it('points at the first unfinished stage while setup runs', () => {
    const action = tournamentNextAction(ctx({ status: 'draft', progress: progress(2, 3) }))
    expect(action?.label).toContain('Stage 3')
    expect(action?.tab).toBe('setup')
    expect(action?.step).toBe(3)
    expect(action?.hint).toContain('2 of 9')
  })

  // Workflow Phase 2 names the next action for a brand-new draft "Complete
  // Basics", not the generic resume wording.
  it('reads Complete Basics for an untouched draft', () => {
    const action = tournamentNextAction(ctx({ status: 'draft', progress: progress(0, 1) }))
    expect(action?.label).toBe('Complete Basics')
    expect(action?.tab).toBe('setup')
    expect(action?.step).toBe(1)
  })

  it('switches to resume wording once any stage is saved', () => {
    const action = tournamentNextAction(ctx({ status: 'draft', progress: progress(1, 2) }))
    expect(action?.label).not.toBe('Complete Basics')
    expect(action?.label).toContain('Continue setup')
  })

  it('offers publishing only after all nine stages are complete', () => {
    const action = tournamentNextAction(ctx({ status: 'setup', isPublished: false, progress: progress(9, 9) }))
    expect(action?.label).toBe('Review and launch')
    expect(action?.tab).toBe('setup')
    expect(action?.step).toBe(9)
  })

  it('asks for application review when submissions are pending', () => {
    const action = tournamentNextAction(ctx({ status: 'registration_open', isPublished: true, progress: progress(11, 11), counts: { ...emptyCounts, applicationsPending: 3 } }))
    expect(action?.label).toBe('Review 3 applications')
    expect(action?.tab).toBe('applications')
  })

  it('asks for the draw once registration is clear and no fixtures exist', () => {
    const action = tournamentNextAction(ctx({ status: 'registration_open', isPublished: true, progress: progress(11, 11), counts: { ...emptyCounts, approvedEntries: 4 } }))
    expect(action?.label).toBe('Prepare draw and fixtures')
    expect(action?.tab).toBe('draw')
  })

  it('asks for result confirmation before ordinary match operation', () => {
    const action = tournamentNextAction(ctx({ status: 'registration_closed', isPublished: true, progress: progress(11, 11), counts: { ...emptyCounts, approvedEntries: 4, matchesTotal: 6, matchesUnresolved: 4, matchesAwaitingConfirmation: 2 } }))
    expect(action?.label).toBe('Confirm 2 results')
    expect(action?.hint).toContain('standings')
    expect(action?.tab).toBe('matches')
  })

  it('offers completion once every fixture is resolved and confirmed', () => {
    const action = tournamentNextAction(ctx({ status: 'registration_open', isPublished: true, progress: progress(11, 11), counts: { ...emptyCounts, approvedEntries: 4, matchesTotal: 6 } }))
    expect(action?.label).toBe('Complete tournament')
    expect(action?.tab).toBe('settings')
  })

  it('offers archiving for a completed tournament', () => {
    const action = tournamentNextAction(ctx({ status: 'completed', isPublished: true, progress: progress(11, 11) }))
    expect(action?.label).toBe('Archive tournament')
    expect(action?.tab).toBe('settings')
  })

  it('returns nothing for archived or cancelled tournaments', () => {
    expect(tournamentNextAction(ctx({ status: 'archived' }))).toBeNull()
    expect(tournamentNextAction(ctx({ status: 'cancelled' }))).toBeNull()
  })

  it('builds a refresh-safe hash from the chosen tab', () => {
    const action = tournamentNextAction(ctx({ status: 'registration_open', isPublished: true, progress: progress(11, 11), counts: { ...emptyCounts, applicationsPending: 1 } }))
    // Tournaments open at their own address since 2026-11-02.
    expect(tournamentTabHash('org-1', 't-1', action!.tab, action!.step)).toBe('#workspace/tournament/t-1?tab=applications')
  })

  it('keeps the setup step in the hash so a reload resumes the same stage', () => {
    expect(tournamentTabHash('org-1', 't-1', 'setup', 4)).toBe('#workspace/tournament/t-1?tab=setup&step=4')
    expect(parseOrganizerSubroute(tournamentTabHash('org-1', 't-1', 'setup', 4))).toEqual({ section: 'tournaments', tournamentId: 't-1', tab: 'setup', step: 4 })
  })
})

describe('attention list', () => {
  const draftTournament = { id: 't-1', name: 'Island Cup', status: 'draft' as const, is_published: false }

  it('links each real outstanding task to the exact tab that resolves it', () => {
    const items = attentionItems([{ tournament: draftTournament, counts: overviewCounts([], [{ application_status: 'submitted', roster_status: 'not_started', payment_status: 'unpaid' }], [{ status: 'awaiting_confirmation' }]) }])
    const keys = items.map(item => item.key)
    expect(keys).toContain('t-1-applications')
    expect(keys).toContain('t-1-results')
    expect(keys).toContain('t-1-draft')
    expect(keys).not.toContain('t-1-rosters')
    expect(keys).not.toContain('t-1-payments')
    expect(items.find(item => item.key === 't-1-draft')?.tab).toBe('setup')
    expect(tournamentTabHash('org-1', 't-1', 'setup')).toBe('#workspace/tournament/t-1?tab=setup')
  })

  it('separates pending counts so no area hides inside another', () => {
    const counts = overviewCounts([], [{ application_status: 'submitted', roster_status: 'submitted', payment_status: 'proof_submitted' }], [])
    expect(counts.applicationsPending).toBe(1)
    expect(counts.rostersPending).toBe(1)
    expect(counts.paymentsPending).toBe(1)
    const items = attentionItems([{ tournament: { ...draftTournament, status: 'registration_open', is_published: true }, counts }])
    expect(items.filter(item => item.key.endsWith('-applications'))).toHaveLength(1)
    expect(items.filter(item => item.key.endsWith('-rosters'))).toHaveLength(1)
    expect(items.filter(item => item.key.endsWith('-payments'))).toHaveLength(1)
  })

  it('stays empty when there is genuinely nothing to do', () => {
    expect(attentionItems([{ tournament: { ...draftTournament, status: 'registration_open', is_published: true }, counts: overviewCounts([], [], []) }])).toEqual([])
  })

  it('never invents a task the database does not report', () => {
    expect(attentionItems([])).toEqual([])
  })

  it('reports nothing for archived or cancelled tournaments', () => {
    expect(attentionItems([{ tournament: { ...draftTournament, status: 'archived' }, counts: overviewCounts([], [{ application_status: 'submitted', roster_status: 'not_started', payment_status: 'unpaid' }], []) }])).toEqual([])
  })

  it('carries the owning tournament so a row can be routed', () => {
    const items = attentionItems([{ tournament: draftTournament, counts: overviewCounts([], [], []) }])
    expect(items[0].tournamentId).toBe('t-1')
  })
})

describe('completion guard', () => {
  it('blocks completion while any match is unresolved', () => {
    const blockers = tournamentCompletionBlockers([{ status: 'scheduled' }, { status: 'confirmed' }])
    expect(blockers).toHaveLength(1)
    expect(blockers[0]).toContain('1 match')
  })

  it('blocks completion when no fixtures exist at all', () => {
    expect(tournamentCompletionBlockers([])).toContain('No fixtures have been created for this tournament yet.')
  })

  it('allows completion once every fixture is confirmed or cancelled', () => {
    expect(tournamentCompletionBlockers([{ status: 'confirmed' }, { status: 'cancelled' }])).toEqual([])
  })
})

describe('draw eligibility', () => {
  it('uses approved entries only', () => {
    expect(drawEligibleTeamIds([
      { team_id: 'a', application_status: 'approved' },
      { team_id: 'b', application_status: 'submitted' },
      { team_id: 'c', application_status: 'approved' },
    ])).toEqual(['a', 'c'])
  })

  it('is empty before any team is approved', () => {
    expect(drawEligibleTeamIds([{ team_id: 'a', application_status: 'submitted' }])).toEqual([])
  })
})

describe('permission-filtered navigation', () => {
  const sections = (items: ReturnType<typeof organizerNav>) => items.map(item => item.section)

  it('gives an owner every section', () => {
    // Final plan 37 adds Claims, Possible duplicates and Imports to Teams & Players.
    expect(sections(organizerNav('owner'))).toEqual(['overview', 'tournaments', 'teams', 'players', 'claims', 'duplicates', 'imports', 'staff', 'finance', 'news', 'reports', 'profile', 'settings'])
  })

  it('shows news to media members and media staff only', () => {
    expect(sections(organizerNav('media'))).toContain('news')
    expect(sections(organizerNav('staff', ['media']))).toContain('news')
    expect(sections(organizerNav('finance'))).not.toContain('news')
  })

  it('hides staff, reports, profile, and settings from a media member', () => {
    const visible = sections(organizerNav('media'))
    expect(visible).not.toContain('staff')
    expect(visible).not.toContain('reports')
    expect(visible).not.toContain('profile')
    expect(visible).not.toContain('settings')
    expect(visible).toContain('overview')
  })

  it('shows finance to a finance member', () => expect(sections(organizerNav('finance'))).toContain('finance'))

  it('honours an explicit tournament finance staff permission', () => {
    expect(sections(organizerNav('staff', ['finance']))).toContain('finance')
    expect(sections(organizerNav('staff', ['match_data']))).not.toContain('finance')
  })

  it('keeps read-only sections visible to every role', () => {
    for (const role of ['owner', 'operations', 'staff', 'finance', 'media']) {
      expect(sections(organizerNav(role)).slice(0, 4)).toEqual(['overview', 'tournaments', 'teams', 'players'])
    }
  })

  it('gates management capabilities to owner and operations', () => {
    expect(canManageTournaments('owner')).toBe(true)
    expect(canManageTournaments('operations')).toBe(true)
    expect(canManageTournaments('staff')).toBe(false)
    expect(canManageStaff('media')).toBe(false)
    expect(canManageFinance('finance', [])).toBe(true)
    expect(canManageFinance('media', ['finance'])).toBe(true)
    expect(canManageFinance('media', [])).toBe(false)
  })

  it('recognizes only the nine real sections', () => {
    expect(isOrganizerSection('overview')).toBe(true)
    expect(isOrganizerSection('settings')).toBe(true)
    expect(isOrganizerSection('nonexistent')).toBe(false)
  })
})

describe('organizer sub-routing (hash query params)', () => {
  it('defaults to the overview with no query', () => {
    expect(parseOrganizerSubroute('#workspace/organization/org-1')).toEqual({ section: 'overview', tournamentId: null, tab: 'overview', step: null })
  })

  it('reads a deep-linked section', () => {
    expect(parseOrganizerSubroute('#workspace/organization/org-1?section=tournaments').section).toBe('tournaments')
  })

  it('falls back to overview for an unknown section', () => {
    expect(parseOrganizerSubroute('#workspace/organization/org-1?section=nonexistent').section).toBe('overview')
  })

  it('infers the tournaments section when a tournament is open', () => {
    const route = parseOrganizerSubroute('#workspace/organization/org-1?tid=t-9')
    expect(route.section).toBe('tournaments')
    expect(route.tournamentId).toBe('t-9')
    expect(route.tab).toBe('overview')
  })

  it('restores the open tournament and tab after a reload', () => {
    const route = parseOrganizerSubroute('#workspace/organization/org-1?section=tournaments&tid=t-9&tab=setup&step=4')
    expect(route).toEqual({ section: 'tournaments', tournamentId: 't-9', tab: 'setup', step: 4 })
  })

  it('ignores an out-of-range setup step', () => {
    expect(parseOrganizerSubroute('#workspace/organization/org-1?tab=setup&step=99').step).toBeNull()
    expect(parseOrganizerSubroute('#workspace/organization/org-1?tab=setup&step=abc').step).toBeNull()
  })

  it('ignores an unknown tab', () => {
    expect(parseOrganizerSubroute('#workspace/organization/org-1?tab=nonexistent').tab).toBe('overview')
  })

  it('treats a blank tid as no open tournament', () => {
    expect(parseOrganizerSubroute('#workspace/organization/org-1?tid=%20').tournamentId).toBeNull()
  })

  it('round-trips a built link back through the parser', () => {
    const hash = organizerHash('org-1', { section: 'tournaments', tournamentId: 't-9', tab: 'matches' })
    const route = parseOrganizerSubroute(hash)
    expect(route.section).toBe('tournaments')
    expect(route.tournamentId).toBe('t-9')
    expect(route.tab).toBe('matches')
  })

  it('encodes the organization id so it survives the round trip', () => {
    const hash = organizerHash('org with space')
    expect(hash).toContain('org%20with%20space')
    expect(parseOrganizerSubroute(hash).section).toBe('overview')
  })

  it('builds a tournament base link the attention and next-action helpers can target', () => {
    expect(tournamentBaseHash('org-1', 't-1')).toBe('#workspace/tournament/t-1')
    // Old links keep working.
    expect(parseOrganizerSubroute('#workspace/organization/org-1?section=tournaments&tid=t-1').tournamentId).toBe('t-1')
    expect(parseOrganizerSubroute('#workspace/tournament/t-1?tab=matches')).toEqual({ section: 'tournaments', tournamentId: 't-1', tab: 'matches', step: null })
  })
})

describe('labels, tones, and formatting', () => {
  it('maps every real tournament status to a readable label', () => {
    expect(tournamentStatusLabel('registration_open')).toBe('Registration open')
    expect(tournamentStatusLabel('in_progress')).toBe('In progress')
    expect(tournamentStatusLabel('unknown_value')).toBe('unknown_value')
  })

  it('labels every sport the schema allows', () => {
    expect(sportLabel('basketball_3x3')).toBe('3x3 basketball')
    expect(sportLabel('futsal')).toBe('Futsal')
  })

  it('formats Maldives rufiyaa amounts unambiguously', () => {
    expect(formatMvr(1250)).toBe('MVR 1,250.00')
    expect(formatMvr(0)).toBe('MVR 0.00')
    expect(formatMvr(null)).toBe('MVR —')
    expect(formatMvr(Number.NaN)).toBe('MVR —')
  })

  it('strips PostgREST filter syntax out of a free-text search term', () => {
    expect(sanitizeSearchTerm('  club,(select 1)  ')).toBe('club select 1')
    expect(sanitizeSearchTerm("a'b")).toBe("a'b")
    expect(sanitizeSearchTerm('x'.repeat(200))).toHaveLength(80)
  })
})

describe('loaders (scoped reads against real tables)', () => {
  it('reads only this organization’s tournaments, newest first', async () => {
    const { client, calls } = createClient({ tournaments: [{ id: 't-1', organization_id: 'org-1' }] })
    await loadOrganizationTournaments(client, 'org-1')
    expect(calls[0].table).toBe('tournaments')
    expect(calls[0].filters).toEqual([['organization_id', 'org-1']])
    expect(calls[0].columns).toContain('setup_stage')
  })

  it('scopes setup steps to one tournament and requests the stage number', async () => {
    const { client, calls } = createClient({ tournament_setup_steps: [] })
    await loadTournamentSetupSteps(client, 't-1')
    expect(calls[0].table).toBe('tournament_setup_steps')
    expect(calls[0].filters).toEqual([['tournament_id', 't-1']])
    expect(calls[0].columns).toContain('step_number')
  })

  it('returns entries joined to team names and the latest roster version', async () => {
    const { client } = createClient({
      tournament_entries: [
        { id: 'e-1', team_id: 'team-1', application_status: 'approved', roster_status: 'submitted', payment_status: 'paid', review_notes: null, reviewed_at: null, submitted_at: '2026-10-01', teams: { name: 'Club A', slug: 'club-a' }, roster_submissions: [{ status: 'draft', version: 1 }, { status: 'submitted', version: 2 }] },
        { id: 'e-2', team_id: 'team-2', application_status: 'submitted', roster_status: 'not_started', payment_status: 'unpaid', review_notes: null, reviewed_at: null, submitted_at: null, teams: null, roster_submissions: [] },
      ],
    })
    const { data, error } = await loadTournamentEntries(client, 't-1')
    expect(error).toBeNull()
    expect(data?.[0]).toMatchObject({ id: 'e-1', team_name: 'Club A', team_slug: 'club-a', latest_roster_status: 'submitted', latest_roster_version: 2 })
    // A team row the caller cannot read under RLS must degrade gracefully.
    expect(data?.[1]).toMatchObject({ id: 'e-2', team_name: null, team_slug: null, latest_roster_status: null })
  })

  it('reports a database error instead of inventing rows', async () => {
    const { client } = createClient({}, { tournament_entries: 'permission denied' })
    const { data, error } = await loadTournamentEntries(client, 't-1')
    expect(data).toBeNull()
    expect(error).toContain('permission denied')
  })

  it('resolves match team names through a second scoped read', async () => {
    const { client, calls } = createClient({
      matches: [{ id: 'm-1', status: 'scheduled', scheduled_at: '2026-11-01T15:00:00Z', venue: 'Galolhu', leg: 1, home_team_id: 'team-1', away_team_id: 'team-2' }],
      teams: [{ id: 'team-1', name: 'Club A' }, { id: 'team-2', name: 'Club B' }],
    })
    const { data, error } = await loadTournamentMatches(client, 't-1')
    expect(error).toBeNull()
    expect(calls[0].table).toBe('matches')
    expect(calls[0].filters).toEqual([['tournament_id', 't-1']])
    expect(calls[1].table).toBe('teams')
    expect(calls[1].filters).toEqual([['id', ['team-1', 'team-2']]])
    expect(data?.[0]).toMatchObject({ home_team_name: 'Club A', away_team_name: 'Club B', scheduled_at: '2026-11-01T15:00:00Z', venue: 'Galolhu' })
  })

  it('surfaces the first failing read from the combined cockpit loader', async () => {
    const { client } = createClient({}, { tournaments: 'not found' })
    const { data, error } = await loadTournamentCockpit(client, 'missing')
    expect(data).toBeNull()
    expect(error).toContain('not found')
  })

  it('never requests private contact, national ID, or document fields', async () => {
    const { client, calls } = createClient({ organization_team_links: [], player_profiles: [], teams: [] })
    await loadOrganizationTeamLinks(client, 'org-1')
    await searchExistingTeams(client, 'club')
    await searchExistingPlayers(client, 'ali')
    for (const call of calls) {
      expect(call.columns).not.toMatch(/national|id_number|email|phone|contact|document|payment_proof|private_note/i)
    }
  })

  it('returns an empty list instead of querying for a term shorter than two characters', async () => {
    const { client, calls } = createClient({ teams: [], player_profiles: [] })
    expect((await searchExistingTeams(client, 'a')).data).toEqual([])
    expect((await searchExistingPlayers(client, '')).data).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('escapes filter syntax before embedding a search term', async () => {
    const { client, calls } = createClient({ teams: [] })
    await searchExistingTeams(client, 'club,(x)')
    expect(calls[0].orFilter).toBe('name.ilike.%club x%,slug.ilike.%club x%')
  })

  it('records an organizer-entered team as approved with a decision note', async () => {
    const { client, recorded } = createClient({ tournament_entries: [{ id: 'e-9' }] })
    const { data, error } = await addOrganizerEntry(client, 't-1', 'team-1', 'user-1')
    expect(error).toBeNull()
    expect(data).toEqual({ id: 'e-9' })
    expect(recorded[0]).toMatchObject({ tournament_id: 't-1', team_id: 'team-1', application_status: 'approved', reviewed_by: 'user-1' })
  })
})

describe('dashboard workflow counts and primary next action', () => {
  const tournaments = [
    { id: 't-1', status: 'draft' as const, is_published: false },
    { id: 't-2', status: 'registration_open' as const, is_published: true },
  ]

  it('returns empty buckets for every tournament when no workflow rows exist', async () => {
    const { client } = createClient({ tournament_entries: [], matches: [] })
    const { data, error } = await loadOrganizationWorkflowCounts(client, tournaments)
    expect(error).toBeNull()
    expect(data?.size).toBe(2)
    expect(data?.get('t-1')).toMatchObject({ entriesTotal: 0, matchesTotal: 0 })
  })

  it('reads both tables once with an in filter instead of per tournament', async () => {
    const { client, calls } = createClient({ tournament_entries: [], matches: [] })
    await loadOrganizationWorkflowCounts(client, tournaments)
    expect(calls).toHaveLength(2)
    expect(calls[0].filters).toEqual([['tournament_id', ['t-1', 't-2']]])
    expect(calls[1].filters).toEqual([['tournament_id', ['t-1', 't-2']]])
  })

  it('buckets entries and matches to the right tournament', async () => {
    const { client } = createClient({
      tournament_entries: [
        { id: 'e1', tournament_id: 't-2', application_status: 'submitted', roster_status: 'submitted', payment_status: 'proof_submitted' },
        { id: 'e2', tournament_id: 't-2', application_status: 'approved', roster_status: 'approved', payment_status: 'paid' },
      ],
      matches: [
        { id: 'm1', tournament_id: 't-2', status: 'awaiting_confirmation' },
        { id: 'm2', tournament_id: 't-2', status: 'confirmed' },
      ],
    })
    const { data } = await loadOrganizationWorkflowCounts(client, tournaments)
    expect(data?.get('t-1')).toMatchObject({ entriesTotal: 0, matchesTotal: 0 })
    expect(data?.get('t-2')).toMatchObject({ entriesTotal: 2, approvedEntries: 1, applicationsPending: 1, rostersPending: 1, paymentsPending: 1, matchesTotal: 2, matchesAwaitingConfirmation: 1, matchesUnresolved: 1 })
  })

  it('skips counts rows for a tournament outside the requested set', async () => {
    const { client } = createClient({ tournament_entries: [{ id: 'e1', tournament_id: 'other', application_status: 'submitted', roster_status: 'not_started', payment_status: 'unpaid' }], matches: [] })
    const { data } = await loadOrganizationWorkflowCounts(client, [{ id: 't-1', status: 'draft', is_published: false }])
    expect(data?.get('t-1')?.entriesTotal).toBe(0)
  })

  it('needs no queries at all for an organization with no tournaments', async () => {
    const { client, calls } = createClient({})
    const { data, error } = await loadOrganizationWorkflowCounts(client, [])
    expect(error).toBeNull()
    expect(data?.size).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('reports a database error instead of inventing counts', async () => {
    const { client } = createClient({}, { matches: 'permission denied' })
    const { data, error } = await loadOrganizationWorkflowCounts(client, tournaments)
    expect(data).toBeNull()
    expect(error).toContain('permission denied')
  })

  it('picks the most urgent action across tournaments for the prominent block', () => {
    const completeSteps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(n => ({ step_number: n, status: 'complete' as const, data: {}, updated_at: null }))
    const progress = new Map<string, SetupProgress>([['t-1', setupProgress([])], ['t-2', setupProgress(completeSteps)]])
    const counts = new Map<string, TournamentWorkflowCounts>([['t-1', emptyWorkflowCounts('t-1')], ['t-2', { ...emptyWorkflowCounts('t-2'), applicationsPending: 2 }]])
    const action = primaryNextAction(tournaments, progress, counts)
    expect(action?.tournamentId).toBe('t-2')
    expect(action?.label).toBe('Review 2 applications')
    expect(action?.tab).toBe('applications')
  })

  it('surfaces a setup stage for a draft tournament when nothing is urgent elsewhere', () => {
    const progress = new Map<string, SetupProgress>([['t-1', setupProgress([])], ['t-2', setupProgress([])]])
    const counts = new Map<string, TournamentWorkflowCounts>([['t-1', emptyWorkflowCounts('t-1')], ['t-2', emptyWorkflowCounts('t-2')]])
    const action = primaryNextAction(tournaments, progress, counts)
    expect(action?.tournamentId).toBe('t-1')
    // Workflow Phase 2 names an untouched draft's action "Complete Basics"
    // rather than "Continue setup - Stage 1"; it still targets stage 1.
    expect(action?.label).toBe('Complete Basics')
    expect(action?.step).toBe(1)
  })

  it('returns null when every tournament is archived', () => {
    expect(primaryNextAction([{ id: 't-1', status: 'archived', is_published: true }], new Map(), new Map())).toBeNull()
  })
})

describe('cockpit persistence actions (reuse applied tables and policies)', () => {
  it('writes stage 1 basics back to the tournament row itself', async () => {
    const { client, recorded } = createClient({ tournaments: [] })
    const { error } = await updateTournamentBasics(client, 't-1', '  Island Cup 2026  ', 'futsal')
    expect(error).toBeNull()
    expect(recorded[0]).toMatchObject({ name: 'Island Cup 2026', sport: 'futsal' })
  })

  it('stores the category against its tournament, not as free text', async () => {
    const { client, calls, recorded } = createClient({ tournament_categories: [] })
    const { error } = await addTournamentCategory(client, 't-1', 'Under-17')
    expect(error).toBeNull()
    expect(calls[0].table).toBe('tournament_categories')
    expect(recorded[0]).toMatchObject({ tournament_id: 't-1', name: 'Under-17' })
  })

  it('reads categories scoped to one tournament', async () => {
    const { client, calls } = createClient({ tournament_categories: [{ id: 'c1', name: 'Senior', age_group: null, gender: null, team_limit: 16 }] })
    const { data } = await loadTournamentCategories(client, 't-1')
    expect(calls[0].filters).toEqual([['tournament_id', 't-1']])
    expect(data?.[0]).toMatchObject({ id: 'c1', name: 'Senior', team_limit: 16 })
  })

  it('publishes a tournament and optionally opens registration', async () => {
    const { client, recorded } = createClient({ tournaments: [] })
    await publishTournament(client, 't-1', true)
    expect(recorded[0]).toMatchObject({ is_published: true, status: 'registration_open' })
    const second = createClient({ tournaments: [] })
    await publishTournament(second.client, 't-1', false)
    expect(second.recorded[0]).toMatchObject({ is_published: true })
    expect(second.recorded[0].status).toBeUndefined()
  })

  it('changes tournament status against the real table', async () => {
    const { client, recorded } = createClient({ tournaments: [] })
    await setTournamentStatus(client, 't-1', 'registration_closed')
    expect(recorded[0]).toMatchObject({ status: 'registration_closed' })
  })

  it('reads the latest result version for a match without a typed id', async () => {
    const { client, calls } = createClient({ match_result_versions: [{ id: 'r-2', status: 'submitted', correction_reason: null }, { id: 'r-1', status: 'confirmed', correction_reason: 'typo' }] })
    const { data } = await loadLatestResultVersion(client, 'm-1')
    expect(calls[0].table).toBe('match_result_versions')
    expect(calls[0].filters).toEqual([['match_id', 'm-1']])
    expect(calls[0].limit).toBe(1)
    // The stub returns rows in order; the loader picks the first (highest version).
    expect(data).toMatchObject({ id: 'r-2', status: 'submitted' })
  })

  it('returns null when a match has no result version at all', async () => {
    const { client } = createClient({ match_result_versions: [] })
    const { data, error } = await loadLatestResultVersion(client, 'm-1')
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('never selects score, submitter, or confirmer identity fields', async () => {
    const { client, calls } = createClient({ match_result_versions: [] })
    await loadLatestResultVersion(client, 'm-1')
    expect(calls[0].columns).not.toMatch(/score|submitted_by|confirmed_by|payload|idempotency/)
  })

  it('surfaces a database error instead of pretending an action succeeded', async () => {
    const { client } = createClient({}, { tournaments: 'permission denied' })
    const { error } = await updateTournamentBasics(client, 't-1', 'Cup', 'football')
    expect(error).toContain('permission denied')
  })
})

describe('status vocabularies match the applied database constraints', () => {
  const migration = (name: string) => readFileSync(resolve(__dirname, '../../supabase/migrations', name), 'utf8')

  it('pins the tournament, entry, roster, payment, and match statuses to the CHECK constraints', () => {
    const drafts = migration('202610210003_tournament_drafts.sql')
    const registration = migration('202610210004_tournament_registration.sql')
    const engine = migration('202610210005_competition_engine.sql')
    for (const status of ['draft', 'setup', 'registration_open', 'registration_closed', 'in_progress', 'completed', 'archived', 'cancelled']) {
      expect(drafts).toContain(`'${status}'`)
    }
    for (const status of ['submitted', 'under_review', 'changes_requested', 'approved', 'rejected']) {
      expect(registration).toContain(`'${status}'`)
    }
    for (const status of ['not_required', 'unpaid', 'proof_submitted', 'paid', 'waived', 'refunded', 'overdue']) {
      expect(registration).toContain(`'${status}'`)
    }
    for (const status of ['scheduled', 'live', 'awaiting_confirmation', 'confirmed', 'postponed', 'abandoned', 'cancelled']) {
      expect(engine).toContain(`'${status}'`)
    }
  })

  it('pins the navigation permission sources to real tables and roles', () => {
    const foundation = migration('202610210001_foundation.sql')
    const staffPermissions = migration('202610210009_operations_finance_notifications.sql')
    for (const role of ['owner', 'operations', 'staff', 'finance', 'media']) {
      expect(foundation).toContain(`'${role}'`)
    }
    for (const permission of ['registration', 'finance', 'media', 'operations', 'match_data']) {
      expect(staffPermissions).toContain(`'${permission}'`)
    }
    expect(foundation).toContain('organization_memberships')
  })

  it('pins the tables this workspace reads and writes to applied migrations', () => {
    const all = ['202610210001_foundation.sql', '202610210002_persistent_records.sql', '202610210003_tournament_drafts.sql', '202610210004_tournament_registration.sql', '202610210005_competition_engine.sql', '202610210009_operations_finance_notifications.sql']
      .map(migration)
      .join('\n')
    for (const table of ['tournaments', 'tournament_setup_steps', 'tournament_entries', 'roster_submissions', 'roster_submission_players', 'matches', 'teams', 'player_profiles', 'organization_team_links', 'finance_expenses', 'notifications', 'audit_events']) {
      expect(all).toContain(`public.${table}`)
    }
  })

  it('pins the operator enforcement functions the policies rely on', () => {
    const registration = migration('202610210004_tournament_registration.sql')
    expect(registration).toContain('is_tournament_operator')
    expect(registration).toContain('security definer')
  })
})

// ---------------------------------------------------------------------------
// Cockpit Overview (tournament control centre)
// ---------------------------------------------------------------------------

type EntryInput = { application_status?: string; roster_status?: string; payment_status?: string; team_id?: string }
const entry = (values: EntryInput = {}) => ({
  team_id: values.team_id ?? 'team-1',
  application_status: values.application_status ?? 'submitted',
  roster_status: values.roster_status ?? 'not_started',
  payment_status: values.payment_status ?? 'not_required',
}) as never

type MatchInput = { status?: string; venue?: string | null; scheduled_at?: string | null; id?: string; home_team_id?: string; away_team_id?: string; home_team_name?: string | null; away_team_name?: string | null }
const match = (values: MatchInput = {}) => ({
  id: values.id ?? 'match-1',
  status: values.status ?? 'scheduled',
  venue: values.venue === undefined ? 'Central Stadium' : values.venue,
  scheduled_at: values.scheduled_at === undefined ? '2026-12-01T16:00:00Z' : values.scheduled_at,
  home_team_id: values.home_team_id ?? 'team-1',
  away_team_id: values.away_team_id ?? 'team-2',
  home_team_name: values.home_team_name ?? 'Wigani',
  away_team_name: values.away_team_name ?? 'Victory SC',
}) as never

const nextActionFor = (overrides: Partial<Parameters<typeof cockpitNextAction>[0]> = {}) => cockpitNextAction({
  status: 'setup',
  isPublished: false,
  progress: { complete: 11, total: 11, currentStep: 11 },
  entries: [],
  matches: [],
  ...overrides,
})

describe('cockpit lifecycle timeline', () => {
  it('shows draft as the current stage for a brand new tournament', () => {
    const stages = tournamentLifecycle({ status: 'draft', setupComplete: false, entries: [], matchCount: 0 })
    expect(stages).toHaveLength(10)
    expect(stages[0]).toEqual({ stage: 'draft', label: 'Draft', state: 'current' })
    expect(stages.filter(item => item.state === 'completed')).toHaveLength(0)
  })

  it('does not mark setup complete until every step is complete', () => {
    const partial = tournamentLifecycle({ status: 'setup', setupComplete: false, entries: [], matchCount: 0 })
    expect(partial.find(item => item.stage === 'setup')?.state).toBe('current')
    const finished = tournamentLifecycle({ status: 'setup', setupComplete: true, entries: [], matchCount: 0 })
    expect(finished.find(item => item.stage === 'setup')?.state).toBe('completed')
  })

  it('requires every entry to be decided before applications are complete', () => {
    const mixed = tournamentLifecycle({ status: 'registration_closed', setupComplete: true, entries: [entry({ application_status: 'approved' }), entry({ application_status: 'submitted' })], matchCount: 0 })
    expect(mixed.find(item => item.stage === 'applications')?.state).toBe('current')
    const decided = tournamentLifecycle({ status: 'registration_closed', setupComplete: true, entries: [entry({ application_status: 'approved' }), entry({ application_status: 'rejected' }), entry({ application_status: 'withdrawn' })], matchCount: 0 })
    expect(decided.find(item => item.stage === 'applications')?.state).toBe('completed')
  })

  it('requires approved rosters to be locked, not merely approved', () => {
    const approvedOnly = tournamentLifecycle({ status: 'registration_closed', setupComplete: true, entries: [entry({ application_status: 'approved', roster_status: 'approved' })], matchCount: 0 })
    expect(approvedOnly.find(item => item.stage === 'rosters')?.state).toBe('current')
    const locked = tournamentLifecycle({ status: 'registration_closed', setupComplete: true, entries: [entry({ application_status: 'approved', roster_status: 'locked' })], matchCount: 0 })
    expect(locked.find(item => item.stage === 'rosters')?.state).toBe('completed')
  })

  it('keeps draw and fixtures upcoming while no fixtures exist', () => {
    const stages = tournamentLifecycle({ status: 'registration_closed', setupComplete: true, entries: [entry({ application_status: 'approved', roster_status: 'locked' })], matchCount: 0 })
    expect(stages.find(item => item.stage === 'draw')?.state).toBe('current')
    expect(stages.find(item => item.stage === 'fixtures')?.state).toBe('upcoming')
  })

  it('marks the current and every later stage blocked when cancelled', () => {
    const stages = tournamentLifecycle({ status: 'cancelled', setupComplete: false, entries: [], matchCount: 0 })
    expect(stages.find(item => item.stage === 'draft')?.state).toBe('completed') // status is no longer draft
    expect(stages.find(item => item.stage === 'setup')?.state).toBe('blocked')
    expect(stages.filter(item => item.state === 'blocked')).toHaveLength(9)
  })

  it('completes every stage once archived', () => {
    const stages = tournamentLifecycle({ status: 'archived', setupComplete: true, entries: [], matchCount: 3 })
    expect(stages.every(item => item.state === 'completed')).toBe(true)
  })

  // Regression: `registration` used a negated list, so a tournament cancelled
  // during setup reported its registration stage as completed.
  it('does not claim registration completed when cancelled during setup', () => {
    const stages = tournamentLifecycle({ status: 'cancelled', setupComplete: false, entries: [], matchCount: 0 })
    expect(stages.find(item => item.stage === 'registration')?.state).toBe('blocked')
    expect(stages.filter(item => item.state === 'completed')).toHaveLength(1) // only Draft
  })

  // Regression: an archived tournament with no entries still reported the
  // application and roster stages as unfinished.
  it('treats an archived tournament as past the application and roster stages', () => {
    const stages = tournamentLifecycle({ status: 'archived', setupComplete: true, entries: [], matchCount: 0 })
    expect(stages.find(item => item.stage === 'applications')?.state).toBe('completed')
    expect(stages.find(item => item.stage === 'rosters')?.state).toBe('completed')
    expect(stages.filter(item => item.state !== 'completed')).toHaveLength(0)
  })

  it('reports lifecycle progress separately from setup progress', () => {
    const stages = tournamentLifecycle({ status: 'draft', setupComplete: false, entries: [], matchCount: 0 })
    expect(lifecycleProgress(stages)).toEqual({ complete: 0, total: 10, percent: 0 })
    const mid = tournamentLifecycle({ status: 'registration_closed', setupComplete: true, entries: [], matchCount: 0 })
    expect(lifecycleProgress(mid).complete).toBe(3) // draft, setup, registration
  })
})

describe('cockpit next action priority ladder', () => {
  it('puts an offline conflict above every other concern', () => {
    const action = nextActionFor({ syncConflicts: 2, matches: [match({ status: 'awaiting_confirmation' })], entries: [entry()] })
    expect(action.tab).toBe('matches')
    expect(action.tone).toBe('danger')
    expect(action.label).toContain('2 offline conflicts')
  })

  it('puts a result awaiting confirmation above applications and setup', () => {
    const action = nextActionFor({ matches: [match({ status: 'awaiting_confirmation' })], entries: [entry({ application_status: 'submitted' })], progress: { complete: 3, total: 11, currentStep: 4 } })
    expect(action.tab).toBe('matches')
    expect(action.label).toContain('Confirm')
    expect(action.reason).toContain('confirmed result')
  })

  it('puts a match operational issue above deadlines and review', () => {
    const action = nextActionFor({ matches: [match({ status: 'live' })], status: 'registration_open', registrationClosesAt: new Date(Date.now() + 3600 * 1000).toISOString() })
    expect(action.tab).toBe('matches')
    expect(action.tone).toBe('live')
  })

  it('raises a closing registration window above pending applications', () => {
    const action = nextActionFor({ status: 'registration_open', registrationClosesAt: new Date(Date.now() + 3600 * 1000).toISOString(), entries: [entry({ application_status: 'submitted' })] })
    expect(action.tab).toBe('applications')
    expect(action.label).toBe('Registration closes soon')
  })

  it('ignores a registration deadline that is more than 48 hours away', () => {
    const action = nextActionFor({ status: 'registration_open', registrationClosesAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(), entries: [entry({ application_status: 'submitted' })] })
    expect(action.label).toContain('Review 1 application')
  })

  it('reviews applications before rosters', () => {
    const action = nextActionFor({ entries: [entry({ application_status: 'submitted' }), entry({ roster_status: 'submitted' })] })
    expect(action.tab).toBe('applications')
  })

  it('falls through to incomplete setup, then publish, then draw, then completion', () => {
    expect(nextActionFor({ progress: { complete: 4, total: 11, currentStep: 5 } }).tab).toBe('setup')
    expect(nextActionFor({}).label).toBe('Review and launch')
    expect(nextActionFor({ isPublished: true }).tab).toBe('draw')
    const done = nextActionFor({ isPublished: true, matches: [match({ status: 'confirmed' })] })
    expect(done.tab).toBe('settings')
    expect(done.label).toBe('Review completion')
  })

  // Same wording rule as the dashboard ladder: workflow Phase 2 names the
  // untouched draft's next action "Complete Basics".
  it('reads Complete Basics for an untouched draft', () => {
    const action = nextActionFor({ progress: { complete: 0, total: 11, currentStep: 1 } })
    expect(action.label).toBe('Complete Basics')
    expect(action.step).toBe(1)
    expect(action.tab).toBe('setup')
  })

  it('returns exactly one action, never a list', () => {
    const action = nextActionFor({ matches: [match({ status: 'awaiting_confirmation' }), match({ status: 'live', id: 'match-2' })], entries: [entry()], progress: { complete: 1, total: 11, currentStep: 2 } })
    expect(action).toHaveProperty('tab')
    expect(Object.keys(action).sort()).toEqual(['label', 'reason', 'step', 'tab', 'tone'])
  })
})

describe('cockpit attention list', () => {
  it('never exceeds five items and keeps unique keys', () => {
    const items = cockpitAttentionItems({
      status: 'registration_closed',
      isPublished: true,
      progress: { complete: 5, total: 11, currentStep: 6 },
      entries: [entry({ application_status: 'submitted' }), entry({ roster_status: 'submitted', team_id: 'team-2' }), entry({ payment_status: 'under_review', team_id: 'team-3' })],
      matches: [match({ status: 'awaiting_confirmation' }), match({ status: 'postponed', id: 'match-2', venue: null })],
    })
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(5)
    expect(new Set(items.map(item => item.key)).size).toBe(items.length)
  })

  it('ranks an awaiting result above a pending application', () => {
    const items = cockpitAttentionItems({
      status: 'registration_closed',
      isPublished: true,
      progress: { complete: 11, total: 11, currentStep: 11 },
      entries: [entry({ application_status: 'submitted' })],
      matches: [match({ status: 'awaiting_confirmation' })],
    })
    expect(items[0].key).toBe('awaiting')
    expect(items[0].priority).toBe('high')
  })

  it('flags fixtures that have no venue', () => {
    const items = cockpitAttentionItems({
      status: 'registration_closed',
      isPublished: true,
      progress: { complete: 11, total: 11, currentStep: 11 },
      entries: [entry({ application_status: 'approved', roster_status: 'locked' })],
      matches: [match({ venue: null })],
    })
    expect(items.some(item => item.key === 'venue' && item.tab === 'draw')).toBe(true)
  })

  it('returns nothing when the tournament genuinely needs no attention', () => {
    expect(cockpitAttentionItems({
      status: 'completed',
      isPublished: true,
      progress: { complete: 11, total: 11, currentStep: 11 },
      entries: [entry({ application_status: 'approved', roster_status: 'locked', payment_status: 'paid' })],
      matches: [match({ status: 'confirmed' })],
    })).toHaveLength(0)
  })
})

describe('cockpit readiness checklists', () => {
  it('lists only the nine wizard stages and marks them from stored keys', () => {
    const items = setupReadinessItems([{ step_number: 1, status: 'complete' }, { step_number: 2, status: 'in_progress' }] as SetupStepRecord[])
    expect(items).toHaveLength(9)
    expect(items[0]).toMatchObject({ done: true, step: 1, tab: 'setup' })
    expect(items[1]).toMatchObject({ done: false, step: 2 })
    expect(items[8].label).toBe('Review completed')
  })

  it('never lists the retired officials and finance stages as setup checks', () => {
    const items = setupReadinessItems([] as SetupStepRecord[])
    expect(items.some(item => /official|finance/i.test(item.label))).toBe(false)
  })

  it('marks the launch check done from stored key 11, not wizard number alone', () => {
    const items = setupReadinessItems(Array.from({ length: 8 }, (_, index) => ({ step_number: index + 1, status: 'complete' })).concat([{ step_number: 11, status: 'complete' }]) as SetupStepRecord[])
    expect(items[8]).toMatchObject({ done: true })
    expect(items.filter(item => item.done)).toHaveLength(9)
  })

  it('omits the officials check when officials are unknown, rather than reporting a false failure', () => {
    const entries = [entry({ application_status: 'approved', roster_status: 'locked' })]
    const matches = [match()]
    expect(competitionReadinessItems(entries, matches, null).some(item => item.key === 'comp-officials')).toBe(false)
    const known = new Map([['match-1', 0]])
    const withOfficials = competitionReadinessItems(entries, matches, known)
    expect(withOfficials.find(item => item.key === 'comp-officials')?.done).toBe(false)
  })

  it('requires both a venue and a scheduled date for fixtures to be scheduled', () => {
    const entries = [entry({ application_status: 'approved', roster_status: 'locked' })]
    expect(competitionReadinessItems(entries, [match({ venue: null })], null).find(item => item.key === 'comp-fixtures')?.done).toBe(false)
    expect(competitionReadinessItems(entries, [match({ scheduled_at: null })], null).find(item => item.key === 'comp-fixtures')?.done).toBe(false)
    expect(competitionReadinessItems(entries, [match()], null).find(item => item.key === 'comp-fixtures')?.done).toBe(true)
  })

  it('reports payment requirements unresolved while any proof is unverified', () => {
    const entries = [entry({ application_status: 'approved', roster_status: 'locked', payment_status: 'proof_submitted' })]
    expect(competitionReadinessItems(entries, [match()], null).find(item => item.key === 'comp-payments')?.done).toBe(false)
  })

  it('keeps completion readiness false while any fixture is unresolved', () => {
    expect(completionReadinessItems([match({ status: 'scheduled' })]).find(item => item.key === 'done-fixtures')?.done).toBe(false)
    expect(completionReadinessItems([match({ status: 'confirmed' })]).find(item => item.key === 'done-fixtures')?.done).toBe(true)
  })

  it('requires at least one confirmed result before standings count as calculated', () => {
    expect(completionReadinessItems([match({ status: 'scheduled' })]).find(item => item.key === 'done-standings')?.done).toBe(false)
    expect(completionReadinessItems([match({ status: 'confirmed' })]).find(item => item.key === 'done-standings')?.done).toBe(true)
  })
})

describe('operational summary cards', () => {
  it('counts applications, rosters, payments and matches separately', () => {
    const summary = operationalSummary(
      [
        entry({ application_status: 'submitted', roster_status: 'submitted', payment_status: 'proof_submitted' }),
        entry({ application_status: 'approved', roster_status: 'locked', payment_status: 'paid', team_id: 'team-2' }),
        entry({ application_status: 'changes_requested', roster_status: 'changes_requested', payment_status: 'waived', team_id: 'team-3' }),
      ],
      [match({ status: 'scheduled' }), match({ status: 'awaiting_confirmation', id: 'match-2' }), match({ status: 'confirmed', id: 'match-3' })],
    )
    expect(summary.applications).toMatchObject({ total: 3, pending: 2, approved: 1, changesRequested: 1 })
    expect(summary.rosters).toMatchObject({ submitted: 1, changesRequested: 1, locked: 1, notSubmitted: 0 })
    expect(summary.payments).toMatchObject({ required: 3, pendingVerification: 1, verified: 1, waived: 1 })
    expect(summary.matches).toMatchObject({ scheduled: 1, awaitingConfirmation: 1, confirmed: 1 })
  })

  it('does not treat an approved application as a verified payment', () => {
    const summary = operationalSummary([entry({ application_status: 'approved', payment_status: 'unpaid' })], [])
    expect(summary.applications.approved).toBe(1)
    expect(summary.payments.verified).toBe(0)
    expect(summary.payments.unpaid).toBe(1)
  })

  it('separates fixtures (scheduling) from matches (competition state)', () => {
    const summary = operationalSummary([], [match({ venue: null }), match({ scheduled_at: null, id: 'match-2' })], Date.parse('2026-01-01T00:00:00Z'))
    expect(summary.fixtures).toMatchObject({ total: 2, missingVenue: 1, unscheduled: 1 })
    expect(summary.matches.scheduled).toBe(2)
  })

  it('counts nothing when there is genuinely nothing', () => {
    const summary = operationalSummary([], [])
    expect(summary.applications.total).toBe(0)
    expect(summary.matches.confirmed).toBe(0)
    expect(summary.payments.pendingVerification).toBe(0)
  })
})

describe('upcoming matches list', () => {
  it('excludes cancelled and abandoned fixtures', () => {
    const list = upcomingMatchesList([match({ status: 'cancelled' }), match({ status: 'abandoned', id: 'match-2' })] as never, [], 5)
    expect(list).toHaveLength(0)
  })

  it('sorts fixtures still to come ahead of those already started', () => {
    const now = Date.parse('2026-06-15T12:00:00Z')
    const list = upcomingMatchesList([
      match({ id: 'past', scheduled_at: '2026-06-01T16:00:00Z' }),
      match({ id: 'future', scheduled_at: '2026-07-01T16:00:00Z' }),
      match({ id: 'unscheduled', scheduled_at: null }),
    ] as never, [], 5, now)
    expect(list.map(item => item.id)).toEqual(['future', 'unscheduled', 'past'])
  })

  it('honours the limit', () => {
    const many = Array.from({ length: 9 }, (_, index) => match({ id: `match-${index}`, scheduled_at: `2026-07-0${index + 1}T16:00:00Z` }) as never)
    expect(upcomingMatchesList(many, [], 5)).toHaveLength(5)
  })

  it('warns about a missing venue, a missing date and an unlocked roster', () => {
    const list = upcomingMatchesList([match({ venue: null, scheduled_at: null })] as never, [entry({ team_id: 'team-1', roster_status: 'submitted' })] as never, 5)
    expect(list[0].warnings).toEqual(expect.arrayContaining(['No venue', 'No date or time', 'Roster not locked']))
  })

  it('shows no warnings once venue, date and roster are all in place', () => {
    const list = upcomingMatchesList([match()] as never, [entry({ team_id: 'team-1', roster_status: 'locked' }), entry({ team_id: 'team-2', roster_status: 'locked' })] as never, 5)
    expect(list[0].warnings).toHaveLength(0)
  })
})

describe('standings preview from confirmed results only', () => {
  const teams = ['a', 'b', 'c']

  it('counts only confirmed results', () => {
    const rows = standingsPreview(teams, [
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 2, awayScore: 1, confirmed: true },
      { homeTeamId: 'a', awayTeamId: 'c', homeScore: 5, awayScore: 0, confirmed: false },
    ])
    expect(rows.find(row => row.teamId === 'a')?.played).toBe(1)
    expect(rows.find(row => row.teamId === 'a')?.points).toBe(3)
    expect(rows.find(row => row.teamId === 'c')?.played).toBe(0)
  })

  it('applies the three-one-zero points convention and goal difference', () => {
    const rows = standingsPreview(teams, [
      { homeTeamId: 'a', awayTeamId: 'b', homeScore: 2, awayScore: 1, confirmed: true },
      { homeTeamId: 'b', awayTeamId: 'c', homeScore: 0, awayScore: 0, confirmed: true },
    ])
    expect(rows[0]).toMatchObject({ teamId: 'a', played: 1, goalDifference: 1, points: 3 })
    expect(rows.find(row => row.teamId === 'b')).toMatchObject({ played: 2, points: 1, goalDifference: -1 })
    expect(rows.find(row => row.teamId === 'c')).toMatchObject({ points: 1 })
  })

  it('returns an empty preview when there are no teams', () => {
    expect(standingsPreview([], [{ homeTeamId: 'a', awayTeamId: 'b', homeScore: 1, awayScore: 0, confirmed: true }])).toHaveLength(0)
  })

  it('honours the preview limit', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(standingsPreview(many, [], 5)).toHaveLength(5)
  })
})

describe('confirmed result scores loader', () => {
  it('skips the query entirely when there is nothing to load', async () => {
    const { client, calls } = createClient({})
    const result = await loadConfirmedResultScores(client, [])
    expect(result.error).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('keeps only the latest version per match and rejects unconfirmed rows', async () => {
    const { client } = createClient({
      match_result_versions: [
        { match_id: 'm1', version: 3, status: 'confirmed', score: { home: 2, away: 1 } },
        { match_id: 'm1', version: 1, status: 'confirmed', score: { home: 0, away: 0 } },
        { match_id: 'm2', version: 1, status: 'submitted', score: { home: 9, away: 9 } },
      ],
    })
    const result = await loadConfirmedResultScores(client, ['m1', 'm2'])
    expect(result.error).toBeNull()
    expect(result.data?.size).toBe(1)
    expect(result.data?.get('m1')).toEqual({ matchId: 'm1', homeScore: 2, awayScore: 1 })
  })

  it('never invents a score for a payload it cannot read', async () => {
    const { client } = createClient({
      match_result_versions: [
        { match_id: 'm1', version: 1, status: 'confirmed', score: { result: 'won by forfeit' } },
        { match_id: 'm2', version: 1, status: 'confirmed', score: null },
      ],
    })
    const result = await loadConfirmedResultScores(client, ['m1', 'm2'])
    expect(result.data?.size).toBe(0)
  })

  it('surfaces the database error rather than pretending the scores are empty', async () => {
    const { client } = createClient({}, { match_result_versions: 'infinite recursion detected in policy for relation "match_result_versions"' })
    const result = await loadConfirmedResultScores(client, ['m1'])
    expect(result.data).toBeNull()
    expect(result.error).toContain('infinite recursion')
  })

  it('requests only the score columns and never touches submitter or document fields', async () => {
    const { client, calls } = createClient({ match_result_versions: [] })
    await loadConfirmedResultScores(client, ['m1'])
    expect(calls[0].table).toBe('match_result_versions')
    expect(calls[0].columns).toBe('match_id,version,score,status')
    expect(calls[0].columns).not.toMatch(/submitted_by|confirmed_by|correction_reason|national|document/)
  })
})

// Registration summary (Overview section 9). The settings row is nullable, so
// "never configured" must stay distinguishable from "configured to nothing".
describe('tournament registration summary loaders', () => {
  it('returns null settings when registration has never been configured', async () => {
    const { client } = createClient({})
    const result = await loadRegistrationSettings(client, 't-1')
    expect(result.error).toBeNull()
    expect(result.data).toBeNull()
  })

  it('requests only registration columns and never payment, document or identity fields', async () => {
    const { client, calls } = createClient({ tournament_registration_settings: [{ opens_at: null, closes_at: null, application_method: 'request', entry_requirements: null, contact_instructions: null, roster_min: null, roster_max: null, roster_deadline: null }] })
    await loadRegistrationSettings(client, 't-1')
    expect(calls[0].table).toBe('tournament_registration_settings')
    expect(calls[0].columns).toBe('opens_at,closes_at,application_method,entry_requirements,contact_instructions,roster_min,roster_max,roster_deadline')
    expect(calls[0].columns).not.toMatch(/payment|document|national|proof/)
  })

  it('sums only categories that state a positive team limit', async () => {
    const { client } = createClient({ tournament_categories: [{ team_limit: 8 }, { team_limit: null }, { team_limit: 0 }, { team_limit: 4 }] })
    const result = await loadRegistrationTeamLimit(client, 't-1')
    expect(result.error).toBeNull()
    expect(result.data).toBe(12)
  })

  it('returns null rather than zero when no category states a limit', async () => {
    const { client } = createClient({ tournament_categories: [{ team_limit: null }] })
    const result = await loadRegistrationTeamLimit(client, 't-1')
    expect(result.error).toBeNull()
    expect(result.data).toBeNull()
  })

  it('surfaces the database error instead of pretending the limit is zero', async () => {
    const { client } = createClient({}, { tournament_categories: 'infinite recursion detected in policy for relation "tournament_categories"' })
    const result = await loadRegistrationTeamLimit(client, 't-1')
    expect(result.data).toBeNull()
    expect(result.error).toContain('infinite recursion')
  })
})

// Overview notifications (section 15). Reads are recipient-scoped by policy, so
// the loader must prove it filters by recipient and by this tournament only.
describe('tournament notification summary loader', () => {
  it('reads only the caller\'s own notifications for this tournament, latest first', async () => {
    const { client, calls } = createClient({
      notifications: [
        { id: 'n1', title: 'Result submitted', body: '', state: 'sent', created_at: '2026-10-23T10:00:00Z', read_at: null, notification_deliveries: [{ state: 'sent' }] },
      ],
    })
    const result = await loadMyTournamentNotifications(client, 'user-1', 't-1')
    expect(result.error).toBeNull()
    expect(result.data?.notifications).toHaveLength(1)
    expect(result.data?.notifications[0]).toMatchObject({ id: 'n1', delivery_state: 'sent' })
    expect(result.data?.unread).toBeNull()
    expect(calls.some(call => call.table === 'notifications')).toBe(true)
    for (const call of calls.filter(call => call.table === 'notifications')) {
      expect(call.filters).toContainEqual(['recipient_id', 'user-1'])
      expect(call.filters).toContainEqual(['tournament_id', 't-1'])
    }
  })

  it('keeps delivery state empty when the delivery row is absent instead of guessing a state', async () => {
    const { client } = createClient({
      notifications: [
        { id: 'n2', title: 'Roster locked', body: '', state: 'queued', created_at: '2026-10-23T09:00:00Z', read_at: '2026-10-23T09:05:00Z', notification_deliveries: [] },
      ],
    })
    const result = await loadMyTournamentNotifications(client, 'user-1', 't-1')
    expect(result.error).toBeNull()
    expect(result.data?.notifications[0].delivery_state).toBeNull()
  })

  it('surfaces the database error instead of an empty list', async () => {
    const { client } = createClient({}, { notifications: 'permission denied for table notifications' })
    const result = await loadMyTournamentNotifications(client, 'user-1', 't-1')
    expect(result.data).toBeNull()
    expect(result.error).toContain('permission denied')
  })
})
