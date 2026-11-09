import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  activityLabel, claimStatus, disciplineSummary, eligibilityFor, inboxActions, locationFor, matchCalendarFile, missingBasics, nextAction, onboardingSteps,
  parsePlayerLocation, playerLocationHash, safeFileName, type NextActionInput,
} from './playerHome'
import { loadWorkspaceSummary, playerShortcutTarget, type Workspace } from './workspace'
import { CARD_FIELDS, cardDataFor } from './cardImage'
import { computePlayerRating } from './playerRating'
import type { WorkspaceMatch } from './playerHub'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const migration = readdirSync(resolve(process.cwd(), 'supabase/migrations')).find(name => name.endsWith('_player_workspace_final.sql'))!
const sql = read(`supabase/migrations/${migration}`)
const workspace = read('src/components/PlayerWorkspace.tsx')
const home = read('src/components/PlayerHome.tsx')
const app = read('src/App.tsx')

const match = (overrides: Partial<WorkspaceMatch>): WorkspaceMatch => ({ id: 'm', tournamentId: 't', tournamentName: 'Cup', tournamentSlug: 'cup', sport: 'football', scheduledAt: '2026-11-05T14:00:00Z', venue: 'Futsal Ground', status: 'confirmed', teamId: 'a', homeTeamId: 'a', homeTeamName: 'Eagles', homeTeamLogo: null, awayTeamId: 'b', awayTeamName: 'Sharks', awayTeamLogo: null, homeScore: 1, awayScore: 0, resultConfirmed: true, participated: true, starter: true, minutes: 90, goals: 0, assists: 0, yellow: 0, red: 0, ...overrides })
const base: NextActionInput = { claimed: true, emailVerified: true, identity: 'registered', identityConflict: false, missingProfile: [], pendingInvitation: null, eligibilityIssue: null, documentsNeedingAction: 0, rosterCorrection: null, availabilityNeeded: null, upcomingMatch: null, isPublished: true, cardSeen: true }

describe('route and account-linked loading', () => {
  it('keeps the section and tab in the URL, and maps old links', () => {
    // Updated for the final menu (Home, Profile, Career, Requests, More): moved tabs follow their new area.
    expect(parsePlayerLocation('#workspace/player/p1?section=career&tab=profile')).toEqual({ section: 'profile', tab: 'profile' })
    expect(parsePlayerLocation('#workspace/player/p1?section=matches&tab=upcoming')).toEqual({ section: 'career', tab: 'matches' })
    expect(parsePlayerLocation('#workspace/player/p1?section=card')).toEqual({ section: 'profile', tab: 'card' })
    expect(parsePlayerLocation('#workspace/player/p1?section=more&tab=nope')).toEqual({ section: 'more', tab: null })
    expect(parsePlayerLocation('#workspace/player/p1?tab=documents')).toEqual({ section: 'more', tab: 'documents' })
    expect(playerLocationHash('#workspace/player/p1?tab=profile', { section: 'career', tab: 'matches' })).toBe('#workspace/player/p1?section=career&tab=matches')
    expect(playerLocationHash('#workspace/player/p1?section=card', { section: 'overview', tab: null })).toBe('#workspace/player/p1')
  })
  it('opens only the player linked to the account for #workspace/player', () => {
    const mine: Workspace = { id: 'p-1', name: 'Ali', slug: 'ali', role: 'player', kind: 'player' }
    expect(playerShortcutTarget('#workspace/player?section=card', [mine])).toEqual({ target: '#workspace/player/p-1?section=card' })
    expect(playerShortcutTarget('#workspace/player', [])).toEqual({ target: null })
    expect(playerShortcutTarget('#workspace/player/someone-else', [mine])).toBeNull()
  })
  it('never silently opens one of several linked profiles', async () => {
    const rows: Record<string, unknown> = { player_profiles: [{ id: 'a', display_name: 'A', slug: 'a' }, { id: 'b', display_name: 'B', slug: 'b' }] }
    const chain = (table: string) => { const result = { data: rows[table] ?? [], error: null }; const self: Record<string, unknown> = { select: () => self, eq: () => self, limit: () => Promise.resolve(result), maybeSingle: () => Promise.resolve({ data: null, error: null }), then: (resolve: (value: unknown) => void) => resolve(result) }; return self }
    // The summary also asks the database for administrator access (not an admin here).
    const client = { from: chain, rpc: () => Promise.resolve({ data: [], error: null }) } as unknown as SupabaseClient
    const summary = await loadWorkspaceSummary(client, { id: 'u', user_metadata: {} })
    expect(summary.data?.duplicatePlayers).toBe(true)
    expect(summary.data?.workspaces.some(item => item.kind === 'player')).toBe(false)
  })
  // Updated for Super Admin Release Two: signing in from #admin also stays there.
  it('returns to the private workspace (or admin) link after sign-in instead of the chooser', () => {
    expect(app).toContain("else if (!/^#\\/?(workspace\\/|admin)/.test(window.location.hash)) window.location.hash = '#workspace'")
  })
  it('uses five navigation items on phones and recovers from an expired session', () => {
    // Owner's workspace design (2026-11-04): nine sidebar destinations; every page and tab is still reachable.
    expect(workspace).toContain("const NAV_PRIMARY: PlayerNav[] = ['overview', 'profile', 'career', 'requests']")
    for (const label of ["label: 'Overview'", "label: 'My Profile'", "label: 'Career Records'", "label: 'Requests'", "label: 'Privacy & Help'"]) expect(workspace).toContain(label)
    expect(workspace).toContain('isSessionExpiredError(error)')
    expect(workspace).toContain('Sign In Again')
    expect(workspace).toContain('Your unsaved changes are still here.')
  })
})

describe('Next Action and onboarding', () => {
  it('follows the specified priority', () => {
    expect(nextAction({ ...base, claimed: false, missingProfile: ['Photo'] })?.id).toBe('claim')
    expect(nextAction({ ...base, emailVerified: false, pendingInvitation: 'Eagles' })?.id).toBe('email')
    expect(nextAction({ ...base, missingProfile: ['Photo'], pendingInvitation: 'Eagles' })?.id).toBe('profile')
    expect(nextAction({ ...base, pendingInvitation: 'Eagles', eligibilityIssue: 'Cup' })?.target).toEqual({ section: 'career', tab: 'teams' })
    expect(nextAction({ ...base, eligibilityIssue: 'Cup', documentsNeedingAction: 1 })?.id).toBe('eligibility')
    expect(nextAction({ ...base, availabilityNeeded: { matchId: 'm', label: 'against Sharks' }, upcomingMatch: { label: 'vs Sharks', when: '' } })?.id).toBe('availability')
    expect(nextAction({ ...base, isPublished: false })?.id).toBe('privacy')
    expect(nextAction({ ...base, cardSeen: false })?.id).toBe('card')
    expect(nextAction(base)).toBeNull()
    expect(JSON.stringify(nextAction({ ...base, pendingInvitation: 'Eagles' }))).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
  })
  it('calculates onboarding from real records and saved choices', () => {
    const steps = onboardingSteps({ identity: 'registered', missingBasics: [], hasTeam: false, isPublished: false, choices: { withoutTeam: true } })
    expect(steps.map(step => [step.id, step.done])).toEqual([['identity', true], ['profile', true], ['team', true], ['privacy', false], ['finish', false]])
    expect(onboardingSteps({ identity: 'registered', missingBasics: [], hasTeam: true, isPublished: false, choices: { keepPrivate: true } }).at(-1)?.done).toBe(true)
    expect(missingBasics({ display_name: 'Ali', island: '', sports: [] }, '')).toEqual(['Photo', 'Island', 'Primary sport', 'Position'])
  })
  it('describes claim status without exposing anyone else', () => {
    expect(claimStatus({ claimed: false, pendingClaimInvitation: true, identity: 'not_registered', openIdentityRequest: false, conflict: false })).toBe('invitation_sent')
    expect(claimStatus({ claimed: true, pendingClaimInvitation: false, identity: 'registered', openIdentityRequest: false, conflict: false })).toBe('verified')
    expect(claimStatus({ claimed: true, pendingClaimInvitation: false, identity: 'registered', openIdentityRequest: true, conflict: false })).toBe('identity_review')
  })
})

describe('eligibility, discipline and matches', () => {
  const input = { tournamentName: 'Cup', identity: 'registered' as const, emailVerified: true, isMinor: false, guardianApproved: false, activeMembership: true, rosterStatus: 'approved', documents: [] }
  it('explains every check and never lets the player approve themselves', () => {
    expect(eligibilityFor(input).status).toBe('eligible')
    expect(eligibilityFor({ ...input, identity: 'not_registered' }).status).toBe('action_required')
    expect(eligibilityFor({ ...input, rosterStatus: 'submitted' }).status).toBe('under_review')
    expect(eligibilityFor({ ...input, rosterStatus: 'rejected' }).status).toBe('ineligible')
    expect(eligibilityFor({ ...input, isMinor: true }).checks.find(check => check.id === 'guardian')?.state).toBe('action')
    expect(eligibilityFor({ ...input, documents: [{ status: 'verified', retentionUntil: '2020-01-01T00:00:00Z' }] }).status).toBe('expired')
    for (const check of eligibilityFor({ ...input, identity: 'not_registered', rosterStatus: 'changes_requested' }).checks) { expect(check.detail).toBeTruthy(); expect(check.who).toBeTruthy() }
    expect(home).toContain('You cannot approve your own eligibility.')
  })
  it('counts discipline from confirmed matches only', () => {
    const summary = disciplineSummary([match({ yellow: 2, red: 1 }), match({ id: 'x', resultConfirmed: false, yellow: 1 }), match({ id: 'y', yellow: 1 })])
    expect(summary).toMatchObject({ yellow: 3, red: 1, secondYellow: 1 })
    expect(summary.matches.map(item => item.id)).toEqual(['m', 'y'])
  })
  it('keeps draft lineups private and builds a calendar file from public facts', () => {
    expect(home).toContain('The official lineup has not been published.')
    const file = matchCalendarFile(match({ id: 'abc', scheduledAt: '2026-11-05T14:00:00Z', venue: 'Ground, Male' }), new Date('2026-11-01T00:00:00Z'))!
    expect(file).toContain('DTSTART:20261105T140000Z')
    expect(file).toContain('LOCATION:Ground\\, Male')
    expect(matchCalendarFile(match({ scheduledAt: null }))).toBeNull()
  })
  it('routes action inbox items to the right tab', () => {
    const actions = inboxActions({ invitations: [{ id: 'i', teamName: 'Eagles', status: 'pending' }], rosterCorrections: ['Cup'], documentsNeedingAction: 1, eligibilityIssues: [], verification: true })
    expect(actions.map(item => item.target.tab)).toEqual(['teams', 'tournaments', 'documents', 'profile'])
    // Updated for the final menu: activity is the History tab under Career.
    expect(locationFor('activity')).toEqual({ section: 'career', tab: 'history' })
    expect(activityLabel('card_downloaded')).toBe('Player Card downloaded')
  })
})

describe('Digital Player Card', () => {
  const totals = { appearances: 2, goals: 1, assists: 0, yellow: 0, red: 0 }
  it('carries public fields only and handles missing data honestly', () => {
    expect(CARD_FIELDS).not.toEqual(expect.arrayContaining(['national_id']))
    for (const field of CARD_FIELDS) expect(String(field)).not.toMatch(/id_number|birth|email|phone|account|document|payment|note/i)
    const data = cardDataFor({ profile: { display_name: 'Ali', national_id: '123', date_of_birth: '2000-01-01', public_code: 'KHP-000184', preferred_side: 'left', sports: ['futsal'] }, teamName: null, teamLogo: null, totals, rating: computePlayerRating(totals), style: 'classic', photoY: 30, statVariant: 'attack' })
    expect(JSON.stringify(data)).not.toMatch(/123|2000-01-01/)
    expect(data).toMatchObject({ code: 'KHP-000184', teamName: null, jersey: null, foot: 'Left foot', ratingText: 'Rating unavailable', stars: null, country: 'Maldives' })
    expect(JSON.stringify(data)).not.toContain('Independent Player')
    expect(safeFileName('Ali Shiyam / ../x')).toBe('ali-shiyam-x')
  })
  it('previews the real signed-out public page, not a private page with fields hidden', () => {
    expect(home).toContain('src={src}')
    expect(home).toContain('#player/${encodeURIComponent(slug)}')
  })
})

describe('player_workspace_final migration contracts', () => {
  it('issues a permanent public code that is not derived from the national ID', () => {
    expect(sql).toContain("'KHP-' || lpad(nextval('public.player_public_code_seq')::text, 6, '0')")
    expect(sql).toContain("raise exception 'public_code_is_permanent'")
    expect(sql).toContain('create unique index if not exists player_profiles_public_code_key')
    expect(sql).not.toMatch(/public_code[^\n]*(digest|national)/i)
  })
  it('lets players read only their own activity and add only card actions', () => {
    expect(sql).toContain("using (exists (select 1 from public.player_profiles p where p.id = player_activity.player_id and p.account_id = (select auth.uid())))")
    expect(sql).toContain("event in ('card_downloaded', 'card_shared', 'card_printed') and detail is null")
    expect(sql).toContain('revoke execute on function public.log_player_activity(uuid, text, text) from public, anon, authenticated')
    expect(sql).not.toMatch(/log_player_activity\([^)]*storage_path/)
  })
  it('protects availability with ownership on both USING and WITH CHECK', () => {
    expect(sql).toContain('using (public.can_set_match_availability(player_match_availability.player_id, player_match_availability.match_id))\n  with check (public.can_set_match_availability(')
    expect(sql).toContain("join public.matches m on m.id = p_match_id and m.status in ('scheduled', 'postponed')")
    expect(sql).not.toMatch(/player_match_availability for select to anon/)
  })
  it('only shows a published team the player belongs to on the card', () => {
    expect(sql).toContain("raise exception 'card_team_not_allowed'")
  })
  it('adds the new request types', () => {
    for (const type of ['identity', 'roster', 'duplicate_profile', 'privacy', 'data_copy', 'account_closure']) expect(sql).toContain(`'${type}'`)
  })
})

describe('no secrets or readable identity in the browser', () => {
  it('never references the service role or the HMAC secret in app code', () => {
    const files = ['src/components/PlayerWorkspace.tsx', 'src/components/PlayerHome.tsx', 'src/components/PlayerCard.tsx', 'src/components/AccountSettings.tsx', 'src/lib/playerHome.ts', 'src/lib/cardImage.ts', 'src/lib/supabase.ts']
    for (const file of files) { const text = read(file); expect(text).not.toMatch(/service_role|SERVICE_ROLE|IDENTITY_HMAC_SECRET/); expect(text).not.toMatch(/national_id_digest|id_digest/) }
  })
  it('keeps account settings out of the player profile', () => {
    expect(workspace).toContain('<AccountSeparation />')
    expect(workspace).not.toMatch(/updateUser\(|type="email"/)
    expect(read('src/components/AccountSettings.tsx')).toContain('auth.updateUser({ email')
  })
})
