import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationsCsv, articleProblem, articleState, completionBlocked, EMPTY_ARTICLE, eventLabel, filterEntries, financeTotals, fixturesCsv, fixtureWarnings, fromMaldivesInput, pageProblem, sponsorProblem, toMaldivesInput, type FinanceOverview } from './tournamentPages'
import { isOrganizerTab, paymentStatusLabel, type TournamentEntry, type TournamentMatch } from './organizer'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const sql = read('supabase/migrations/202611010036_tournament_pages_complete.sql')
const entry = (overrides: Partial<TournamentEntry>): TournamentEntry => ({ id: 'e1', team_id: 't1', application_status: 'submitted', roster_status: 'not_started', payment_status: 'not_required', review_notes: null, reviewed_at: null, submitted_at: '2026-10-01T05:00:00Z', team_name: 'Maafannu Club', team_slug: null, latest_roster_status: null, latest_roster_version: null, ...overrides })
const match = (overrides: Partial<TournamentMatch>): TournamentMatch => ({ id: 'm1', status: 'scheduled', scheduled_at: '2026-11-05T14:00:00Z', venue: 'National Stadium', leg: 1, home_team_id: 'a', away_team_id: 'b', home_team_name: 'A', away_team_name: 'B', ...overrides })

describe('Organizer tournament routes', () => {
  it('has a tab for every organizer page', () => {
    for (const tab of ['overview', 'setup', 'applications', 'teams', 'draw', 'fixtures', 'matches', 'standings', 'staff', 'finance', 'media', 'completion', 'settings']) expect(isOrganizerTab(tab)).toBe(true)
  })
})

describe('Applications and payments (page 30)', () => {
  it('filters by status, payment, roster and search', () => {
    const entries = [entry({ id: '1' }), entry({ id: '2', application_status: 'waitlisted' }), entry({ id: '3', application_status: 'approved', payment_status: 'proof_submitted', team_name: 'Hulhumalé' })]
    expect(filterEntries(entries, 'waiting', '').map(item => item.id)).toEqual(['1'])
    expect(filterEntries(entries, 'waitlisted', '').map(item => item.id)).toEqual(['2'])
    expect(filterEntries(entries, 'payment', '').map(item => item.id)).toEqual(['3'])
    expect(filterEntries(entries, 'all', 'hulhu').map(item => item.id)).toEqual(['3'])
  })
  it('uses the specification payment words', () => {
    expect(paymentStatusLabel('unpaid')).toBe('Pending')
    expect(paymentStatusLabel('paid')).toBe('Verified')
    expect(paymentStatusLabel('rejected')).toBe('Rejected')
  })
  it('exports without private fields or formula injection', () => {
    const csv = applicationsCsv([entry({ team_name: '=HYPERLINK("x")', review_notes: 'private note' })], { application: s => s, roster: s => s, payment: s => s })
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).not.toContain('private note')
    expect(csv).not.toContain('e1')
  })
})

describe('Fixtures (page 33)', () => {
  it('uses Maldives time for scheduling', () => {
    expect(fromMaldivesInput('2026-11-05T19:00')).toBe('2026-11-05T14:00:00.000Z')
    expect(toMaldivesInput('2026-11-05T14:00:00.000Z')).toBe('2026-11-05T19:00')
  })
  it('warns about short rest and venue clashes', () => {
    const warnings = fixtureWarnings([match({ id: 'm1' }), match({ id: 'm2', scheduled_at: '2026-11-06T00:00:00Z', home_team_id: 'a', away_team_id: 'c' }), match({ id: 'm3', scheduled_at: '2026-11-05T14:30:00Z', home_team_id: 'd', away_team_id: 'e' })])
    expect(warnings.get('m2')?.[0]).toMatch(/within 10 hour/)
    expect(warnings.get('m3')).toContain('Another match at this venue within an hour')
    expect(fixtureWarnings([match({ id: 'm1' }), match({ id: 'x', status: 'cancelled', scheduled_at: '2026-11-05T15:00:00Z' })]).size).toBe(0)
  })
  it('exports fixtures in Maldives time', () => {
    expect(fixturesCsv([match({})], s => s)).toContain('05 Nov 2026')
  })
})

describe('Finance (page 37)', () => {
  it('totals real records only, in MVR', () => {
    const overview: FinanceOverview = {
      fees: [], errors: [],
      payments: [{ id: 'p1', entry_id: 'e', amount_mvr: 1500, status: 'paid', created_at: '' }, { id: 'p2', entry_id: 'e', amount_mvr: 1500, status: 'proof_submitted', created_at: '' }],
      adjustments: [{ id: 'a', payment_id: 'p1', kind: 'refund', amount_mvr: 500, reason: 'Withdrew', created_at: '' }],
      expenses: [{ id: 'x', category: 'venue', description: 'Hire', amount_mvr: 2000, status: 'approved', created_at: '' }],
      income: [{ id: 'i1', kind: 'sponsorship', sponsor_id: null, amount_mvr: 10000, status: 'received', description: 'Gold', received_on: '2026-10-01', created_at: '' }, { id: 'i2', kind: 'donation', sponsor_id: null, amount_mvr: 300, status: 'pledged', description: 'Pledge', received_on: null, created_at: '' }],
    }
    expect(financeTotals(overview)).toMatchObject({ registration: 1500, refunded: 500, sponsorship: 10000, donations: 0, pledged: 300, expenses: 2000, net: 9000 })
  })
  it('validates sponsors', () => {
    expect(sponsorProblem({ name: 'Ooredoo', website: 'https://ooredoo.mv', description: '' })).toBeNull()
    expect(sponsorProblem({ name: 'X', website: '', description: '' })).toMatch(/name/)
    expect(sponsorProblem({ name: 'Bank', website: 'javascript:alert(1)', description: '' })).toMatch(/https/)
  })
})

describe('Media (page 38) and activity', () => {
  it('validates articles and recognises scheduled ones', () => {
    expect(articleProblem({ ...EMPTY_ARTICLE, title: 'Final report', body: 'What a match.' })).toBeNull()
    expect(articleProblem({ ...EMPTY_ARTICLE, title: 'x', mediaUrl: 'http://insecure' })).toMatch(/https/)
    expect(articleState({ status: 'published', published_at: '2999-01-01T00:00:00Z' })).toBe('scheduled')
    expect(articleState({ status: 'published', published_at: '2000-01-01T00:00:00Z' })).toBe('published')
  })
  it('describes recorded events in words', () => {
    expect(eventLabel({ action: 'application_waitlisted', detail: {} })).toBe('Moved to the waitlist')
    expect(eventLabel({ action: 'setup_step_saved', detail: { step: 3, afterPublication: true } })).toBe('Setup step 3 saved after publication')
    expect(eventLabel({ action: 'status_in_progress', detail: {} })).toBe('Tournament status: in progress')
  })
  it('never shows raw service errors', () => {
    expect(pageProblem('roster_unlock_requires_reason')).toMatch(/Unlock roster/)
    expect(pageProblem('Could not find the function public.change_fixture')).toMatch(/202611010036/)
    expect(pageProblem('duplicate key value violates unique constraint "x_pkey"')).not.toMatch(/constraint|pkey/)
  })
})

describe('Completion (page 39)', () => {
  it('blocks only on required checks', () => {
    expect(completionBlocked([{ key: 'runner_up', label: '', ok: false, blocking: false, detail: '' }])).toBe(false)
    expect(completionBlocked([{ key: 'fixtures', label: '', ok: false, blocking: true, detail: '' }])).toBe(true)
  })
})

describe('Migration 036 (static review)', () => {
  it('adds waitlist and payment rejection without dropping existing statuses', () => {
    expect(sql).toContain("check (application_status in ('draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'withdrawn', 'waitlisted'))")
    expect(sql).toContain("check (payment_status in ('not_required', 'unpaid', 'proof_submitted', 'under_review', 'paid', 'waived', 'refunded', 'overdue', 'rejected'))")
  })
  it('requires reasons and records changes server-side', () => {
    expect(sql).toContain("raise exception 'roster_unlock_requires_reason'")
    expect(sql).toContain("if p_status in ('postponed', 'cancelled', 'abandoned') and (p_reason is null or length(trim(p_reason)) < 5) then raise exception 'reason_required'")
    expect(sql).toContain("raise exception 'sport_locked_after_fixtures'")
    expect(sql).toContain("raise exception 'completion_blocked_no_champion'")
    expect(sql).toContain("raise exception 'archive_requires_completion'")
  })
  it('keeps agreement notes off the public sponsor list', () => {
    const fn = sql.slice(sql.indexOf('function public.get_public_tournament_sponsors'), sql.indexOf('-- Sponsors recorded in setup step 10'))
    expect(fn).not.toContain('agreement_notes')
    expect(fn).toContain('s.is_public and t.is_published')
  })
  it('includes adjustments in every recalculation and never deletes source history', () => {
    expect(sql).toContain('+ coalesce(max(adj.points), 0)')
    expect(sql).not.toMatch(/delete from public\.(matches|match_result_versions|tournament_entries|roster_submissions|tournaments)\b/)
  })
  it('follows the function safety rules', () => {
    const definers = sql.match(/security definer set search_path = [^ ]+/g) ?? []
    // Only recalculate_stage_standings keeps migration 025's search_path, unchanged.
    expect(definers.filter(line => !line.endsWith("''"))).toEqual(['security definer set search_path = public'])
    expect(sql).toContain('revoke execute on function public.log_tournament_event(uuid, text, uuid, text, jsonb, text) from public, anon, authenticated')
    expect(sql).not.toMatch(/returns table\([^)]*\b(position|order|user|group)\b /)
    expect(sql.split('\n').filter(line => /^\s*(if|elsif)\b/.test(line) && /[^(]\s*case when/.test(line.split(/\bthen\b/)[0] + ' then'))).toEqual([])
  })
})
