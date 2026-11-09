import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RecordDeleteAction } from './RecordDeleteAction'
import { tr, useLanguage } from '../lib/i18n'
import type { FormEvent, ReactNode } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, CircleCheck,
  Clock3, ExternalLink, Loader2, Lock, MapPin, MoreHorizontal, Plus, RefreshCw,
  Search, ShieldCheck, Trophy, Users, CalendarDays, PlayCircle,
} from 'lucide-react'
import {
  addOrganizerEntry, addTournamentCategory, applicationStatusLabel, applicationStatusTone,
  activityLabel, canManageFinance, cockpitAttentionItems, cockpitNextAction, completionReadinessItems,
  competitionReadinessItems, drawEligibleTeamIds, formatWorkspaceDate, lifecycleProgress,
  loadConfirmedResultScores, loadLatestRosterSubmission, loadMyRecentActivity,
  loadMyTournamentNotifications, loadRegistrationSettings, loadRegistrationTeamLimit,
  loadTournamentCategories,
  loadTournamentCockpit, loadLatestResultVersion, matchStatusLabel, matchStatusTone,
  operationalSummary, PENDING_ROSTER_STATUSES, paymentStatusLabel, paymentStatusTone,
  publishTournament, reviewRosterSubmission, rosterStatusLabel, rosterStatusTone,
  sanitizeSearchTerm, searchExistingTeams, setupReadinessItems, setEntryRosterStatus,
  setTournamentStatus, setupProgress, sportLabel, standingsPreview, tournamentCompletionBlockers,
  tournamentLifecycle, tournamentStatusLabel, upcomingMatchesList,
  updateTournamentBasics, updateTournamentBranding,
  type LifecycleView, type NextAction, type OrganizerTab, type TournamentStatus, type WorkspaceAuditEvent,
  type OrganizerTournament, type OperationalSummary, type ReadinessItem, type RosterStatus,
  type SearchableTeam, type SetupProgress, type SetupStepRecord, type TournamentEntry,
  type TournamentMatch, type TournamentNotificationSummary, type TournamentRegistrationSettings,
} from '../lib/organizer'
import {
  addRegistrationQuestion, countCategoryMatches, deleteRegistrationQuestion, loadEditableTournamentCategories,
  loadRegistrationQuestions, REGISTRATION_STANDARD_FIELDS, registrationFormFields, SUGGESTED_SPORT_SETTINGS,
  saveRegistrationSettings, saveSetupStep, SETUP_STEPS, SETUP_STEP_KEYS,
  updateRegistrationQuestion, updateTournamentCategory, validateSetupStep, validateSetupStepFields,
} from '../lib/tournament'
import { validateBrandingFile, uploadBrandingFile, removeBrandingFile } from '../lib/tournamentBranding'
import type { EditableTournamentCategory, RegistrationQuestion } from '../lib/tournament'
import type { Sport } from '../lib/records'
import { createTeam } from '../lib/records'
import { OrganizerTeamPlayers } from './OrganizerTeamPlayers'
import type { Workspace } from '../lib/workspace'
import { CompetitionPlanner } from './CompetitionPlanner'
import { AwardsPanel, NextRoundPanel, ProgressionConflictsPanel, StandingsTab } from './CompetitionTabs'
import { useTournamentAwards } from '../lib/useTournamentAwards'
import { LineupEditor } from './LineupEditor'
import { EntryDocuments } from './PrivateDocuments'
import { MatchOfficialsPanel } from './TournamentOperations'
import { PlayerDocumentsReview } from './TeamPlayerPanels'
import { PlayerRequestsReview } from './PlayerRequestsReview'
import { TeamDocumentsReview, TeamResultReportsReview } from './TeamReportsReview'
import { awardBlockers } from '../lib/competitionRecords'
import { confirmMatchResult, correctMatchResult, submitMatchResult } from '../lib/matchCenter'
import { FinanceSection } from './OperationsPanel'
import { TournamentCover, TournamentLogo } from './TournamentBranding'
import { TournamentStaffPanel } from './TournamentStaffPanel'
import { ApplicationsPage, CompletionPage, ReportsPage, DrawStagesPanel, FixturesPage, OperationsPage, PublicEffectPreview, RosterChecksPanel, SetupGuard, StandingsManagement, TournamentFinancePage, TournamentMediaPage, TournamentTimeline } from './TournamentPages'
import { AWARD_LABELS } from '../lib/competitionRecords'
import { FlowProgress, MoreDetails, SimpleFinish, SimpleHome, SimplePlay, SimpleSchedule, SimpleTeams } from './SimpleTournamentFlow'
import { chargesFee, currentFlowStep, FLOW_STEPS } from '../lib/simpleFlow'
import { correctionImpact, loadCompetitionStructure, type CompetitionStage, type StageMatch } from '../lib/advancement'
import { refreshSuspensions } from '../lib/discipline'
import { fixtureWarnings } from '../lib/tournamentPages'

const SPORTS: Sport[] = ['football', 'futsal', 'handball', 'volleyball', 'basketball', 'basketball_3x3']

type StageField = { key: string; label: string; type: 'text' | 'number' | 'textarea' | 'select' | 'date' | 'datetime'; options?: string[]; hint?: string }

// The nine setup stages collect these inputs into the setup-step row's jsonb
// data, so any stage can be left and resumed. Wizard stages 2, 4, and 9 drive
// their own records (categories, questions, review) instead of field pairs, and
// the retired wizard of 11 stages no longer includes Officials or Finance -
// those are standalone management modules on the Staff and Finance tabs.
// Start/end dates for stage 8 are stored in the stage data; the `tournaments`
// columns for them land only after the owner applies review-only migration 018
// (which currently provides `starts_at` only), until then the values live for
// scheduling planning without pretending the public row has them.
const STAGE_FIELDS: Record<number, StageField[]> = {
  1: [
    { key: 'name', label: 'Tournament name', type: 'text' },
    { key: 'sport', label: 'Sport', type: 'select', options: SPORTS },
    { key: 'season', label: 'Season or year (optional)', type: 'text' },
    { key: 'atoll', label: 'Atoll (optional)', type: 'text' },
    { key: 'island', label: 'Island (optional)', type: 'text' },
    { key: 'description', label: 'Description (optional)', type: 'textarea' },
  ],
  3: [
    { key: 'method', label: 'How teams enter', type: 'select', options: ['open', 'schedule', 'manual_add'] },
    { key: 'opensAt', label: 'Registration opens', type: 'datetime', hint: 'Scheduled opening only. Maldives time (UTC+5) unless you type a timezone.' },
    { key: 'closesAt', label: 'Registration closes', type: 'datetime', hint: 'Required for open and scheduled registration.' },
    { key: 'maxApplications', label: 'Maximum applications (optional)', type: 'number', hint: 'Applications may be capped separately from approved teams - e.g. accept 20 applications for 12 places. Category-specific team caps are set per category in Stage 2.' },
  ],
  5: [
    { key: 'rosterMin', label: 'Minimum players per team', type: 'number', hint: 'Suggested for the sport: see the blue hint below.' },
    { key: 'rosterMax', label: 'Maximum players per team', type: 'number' },
    { key: 'rosterOfficialCount', label: 'Maximum team officials (optional)', type: 'number' },
    { key: 'rosterTiming', label: 'When rosters are submitted', type: 'select', options: ['with_application', 'after_approval'] },
    { key: 'rosterDeadline', label: 'Roster submission deadline', type: 'datetime' },
  ],
  6: [
    { key: 'format', label: 'Competition format', type: 'select', options: ['round_robin', 'knockout', 'single_elimination', 'group_stage', 'groups_then_knockout', 'groups_only', 'two_leg'] },
    { key: 'tieBreaker', label: 'Primary tie-breaker', type: 'select', options: ['head_to_head', 'goal_difference', 'goals_scored'] },
  ],
  7: [{ key: 'rules', label: 'Rules and standings notes', type: 'textarea' }],
  8: [
    { key: 'startsAt', label: 'Tournament start date', type: 'date' },
    { key: 'endsAt', label: 'Tournament end date', type: 'date' },
    { key: 'venue', label: 'Primary venue', type: 'text' },
  ],
}

// Plain names: the organizer sees Teams, Schedule and Matches, never the
// engine's own words (stages, fixture versions, roster versions, lifecycle).
const TAB_LABELS: Array<{ tab: OrganizerTab; label: string }> = [
  { tab: 'overview', label: 'Home' }, { tab: 'setup', label: 'Categories, form & rules' },
  { tab: 'applications', label: 'Applications & payments' }, { tab: 'teams', label: 'Teams' },
  { tab: 'draw', label: 'Format & draw' }, { tab: 'fixtures', label: 'Schedule' }, { tab: 'matches', label: 'Matches' },
  { tab: 'standings', label: 'Standings & bracket' }, { tab: 'finance', label: 'Finance & sponsors' },
  { tab: 'staff', label: 'Officials & staff' }, { tab: 'media', label: 'News & media' }, { tab: 'settings', label: 'Tournament details' }, { tab: 'completion', label: 'Finish & archive' },
  { tab: 'reports', label: 'Reports & history' },
]

// The owner's simple flow (Create, Teams, Schedule, Play, Finish) uses only
// five menu items: Home, Teams, Schedule, Matches, More (owner, 2026-11-02).
// Teams holds applications and payments; Schedule holds format, draw, standings
// and bracket; More holds settings, categories and the registration form, rules,
// officials and staff, finance and sponsors, news and media, reports and audit
// history, and completion. Every earlier page is still reachable.
const GROUP_ICONS: Record<string, typeof Trophy> = { Home: Trophy, Teams: Users, Schedule: CalendarDays, Matches: PlayCircle, More: MoreHorizontal }
// Tabs whose screens already open with their own step heading.
const TITLED_ELSEWHERE: OrganizerTab[] = ['overview', 'teams', 'fixtures', 'matches', 'completion', 'setup']
// Keeps the selected sub-tab visible when the sub-tab row scrolls sideways on phones.
// Only the sub-tab row scrolls; scrollIntoView would also shift the page's own
// containers sideways.
const scrollTabIntoView = (element: HTMLButtonElement | null) => {
  const row = element?.parentElement
  if (!element || !row || row.scrollWidth <= row.clientWidth) return
  row.scrollLeft = Math.max(0, element.offsetLeft - row.offsetLeft - (row.clientWidth - element.offsetWidth) / 2)
}
// Menu names are stored in English (they key the icons); shown in the active language.
const groupLabel = (label: string) => tr(`tnav.${label.toLowerCase()}`, label)
const TAB_GROUPS: Array<{ label: string; tabs: OrganizerTab[] }> = [
  { label: 'Home', tabs: ['overview'] },
  { label: 'Teams', tabs: ['teams', 'applications'] },
  { label: 'Schedule', tabs: ['fixtures', 'draw', 'standings'] },
  { label: 'Matches', tabs: ['matches'] },
  { label: 'More', tabs: ['settings', 'setup', 'staff', 'finance', 'media', 'reports', 'completion'] },
]

// The per-tournament workspace: a header with real status and next action, plus
// one tab per part of the documented workflow. Every read and write is scoped
// to this tournament and runs through the caller's own client.
export function TournamentWorkspace({ client, user, organization, tournamentId, tab, step, staffPermissions = [], onNotice, onChanged, onOpenTab, onBack, onOpenOrganizerSection }: {
  client: SupabaseClient; user: User; organization: Workspace; tournamentId: string; tab: OrganizerTab; step: number | null; staffPermissions?: string[]; onNotice: (message: string) => void; onChanged: () => void; onOpenTab: (tab: OrganizerTab, step?: number | null) => void; onBack: () => void; onOpenOrganizerSection?: (section: 'overview' | 'tournaments') => void
}) {
  useLanguage()
  const [tournament, setTournament] = useState<OrganizerTournament | null>(null)
  const [steps, setSteps] = useState<SetupStepRecord[]>([])
  const [entries, setEntries] = useState<TournamentEntry[]>([])
  const [matches, setMatches] = useState<TournamentMatch[]>([])

  // The Overview shows a category summary and a standings preview. Both are
  // loaded separately from the core cockpit data and carry their own error
  // state, so a failure in either degrades that one section to an
  // "Unavailable - Retry" notice instead of closing the whole workspace
  // (specification section 21, and acceptance point 13).
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([])
  const [categoriesError, setCategoriesError] = useState('')
  const [scores, setScores] = useState<Map<string, { homeScore: number; awayScore: number }>>(new Map())
  const [scoresError, setScoresError] = useState('')

  // Overview sections 9, 14, 15 (revised specification). Each carries its own
  // error state, so a failure degrades only its own block to
  // "Unavailable - Retry" instead of closing the workspace. A null value means
  // "not loaded yet"; a loaded-but-empty value is a real state.
  const [registrationSummary, setRegistrationSummary] = useState<{ settings: TournamentRegistrationSettings | null; teamLimit: number | null } | null>(null)
  const [registrationError, setRegistrationError] = useState('')
  const [notifications, setNotifications] = useState<TournamentNotificationSummary | null>(null)
  const [notificationsError, setNotificationsError] = useState('')
  const [activity, setActivity] = useState<WorkspaceAuditEvent[]>([])
  const [activityLoaded, setActivityLoaded] = useState(false)
  const [activityError, setActivityError] = useState('')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  // Which tab has its "More details" panel open; another tab opens closed.
  const [detailsFor, setDetailsFor] = useState<OrganizerTab | null>(null)

  // Reloading the cockpit also notifies the dashboard, so counts and the next
  // action above stay in step with a change made inside a tab.
  const reload = useCallback(() => { setReloadKey(value => value + 1); onChanged() }, [onChanged])

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true); setError('')
      const result = await loadTournamentCockpit(client, tournamentId)
      if (!active) return
      setLoading(false)
      if (result.error) return setError(result.error)
      if (!result.data) return setError('This tournament could not be loaded. It may have been removed, or you may no longer have access.')
      setTournament(result.data.tournament)
      setSteps(result.data.steps)
      setEntries(result.data.entries)
      setMatches(result.data.matches)
    }
    void load()
    return () => { active = false }
  }, [client, tournamentId, reloadKey])

  // Category summary shown in the tournament header.
  useEffect(() => {
    let active = true
    const load = async () => {
      const result = await loadTournamentCategories(client, tournamentId)
      if (!active) return
      if (result.error) { setCategories([]); setCategoriesError(result.error); return }
      setCategoriesError('')
      setCategories((result.data ?? []).map(item => ({ id: item.id, name: item.name })))
    }
    void load()
    return () => { active = false }
  }, [client, tournamentId, reloadKey])

  // Overview section 9: registration configuration and the competition's team
  // limit. Both reads run together; either failing makes the whole summary
  // block unavailable rather than showing partial numbers as facts.
  useEffect(() => {
    let active = true
    const load = async () => {
      const [settingsResult, limitResult] = await Promise.all([
        loadRegistrationSettings(client, tournamentId),
        loadRegistrationTeamLimit(client, tournamentId),
      ])
      if (!active) return
      const failure = settingsResult.error ?? limitResult.error
      if (failure) { setRegistrationSummary(null); setRegistrationError(failure); return }
      setRegistrationError('')
      setRegistrationSummary({ settings: settingsResult.data ?? null, teamLimit: limitResult.data })
    }
    void load()
    return () => { active = false }
  }, [client, tournamentId, reloadKey])

  // Overview section 15: the caller's own notifications for this tournament.
  useEffect(() => {
    let active = true
    const load = async () => {
      const result = await loadMyTournamentNotifications(client, user.id, tournamentId)
      if (!active) return
      if (result.error) { setNotifications(null); setNotificationsError(result.error); return }
      setNotificationsError('')
      setNotifications(result.data)
    }
    void load()
    return () => { active = false }
  }, [client, tournamentId, user.id, reloadKey])

  // Overview section 14: the audit policy only exposes the caller's own events,
  // so the activity feed is explicitly labelled as the user's own actions.
  useEffect(() => {
    let active = true
    const load = async () => {
      const result = await loadMyRecentActivity(client, user.id, 5)
      if (!active) return
      setActivityLoaded(true)
      if (result.error) { setActivity([]); setActivityError(result.error); return }
      setActivityError('')
      setActivity(result.data ?? [])
    }
    void load()
    return () => { active = false }
  }, [client, user.id, reloadKey])

  // Confirmed scores feed the standings preview. Only confirmed matches are
  // requested, so an unconfirmed result can never reach the preview
  // (acceptance point 11).
  const confirmedMatchIds = useMemo(() => matches.filter(item => item.status === 'confirmed').map(item => item.id), [matches])
  useEffect(() => {
    let active = true
    const load = async () => {
      const result = await loadConfirmedResultScores(client, confirmedMatchIds)
      if (!active) return
      if (result.error) { setScores(new Map()); setScoresError(result.error); return }
      setScoresError('')
      setScores(result.data ?? new Map())
    }
    void load()
    return () => { active = false }
  }, [client, confirmedMatchIds])

  const progress = useMemo(() => setupProgress(steps), [steps])
  const role = organization.role
  const canManage = role === 'owner' || role === 'operations'
  const awards = useTournamentAwards(client, tournamentId)

  if (loading) return <div className="cockpit-loading"><Loader2 className="spin" size={18} /> Loading tournament workspace…</div>
  if (error) return <div className="state-block"><AlertTriangle size={24} /><h3>Tournament workspace unavailable</h3><p>{error}</p><button type="button" className="outline-button dark" onClick={onBack}><ArrowLeft size={14} /> Back to tournaments</button></div>
  if (!tournament) return <div className="state-block"><Trophy size={24} /><h3>Public record not found</h3><p>This tournament is not in your authorized list.</p><button type="button" className="outline-button dark" onClick={onBack}><ArrowLeft size={14} /> Back to tournaments</button></div>

  const workflow = { applicationsPending: entries.filter(entry => ['submitted', 'under_review', 'changes_requested'].includes(entry.application_status)).length, entriesTotal: entries.length, approvedEntries: entries.filter(entry => entry.application_status === 'approved').length, matchesTotal: matches.length, matchesUnresolved: matches.filter(match => ['scheduled', 'live', 'awaiting_confirmation', 'postponed', 'abandoned'].includes(match.status)).length, matchesAwaitingConfirmation: matches.filter(match => match.status === 'awaiting_confirmation').length }
  // Completion needs resolved fixtures and a recorded champion (spec 5.5).
  const blockers = [...tournamentCompletionBlockers(matches), ...(awards.loaded && !awards.error ? awardBlockers(awards.awards) : [])]
  const teamNames: Record<string, string> = Object.fromEntries([
    ...matches.flatMap(match => [[match.home_team_id, match.home_team_name], [match.away_team_id, match.away_team_name]]).filter((pair): pair is [string, string] => Boolean(pair[0] && pair[1])),
    ...entries.filter(entry => entry.team_name).map(entry => [entry.team_id, entry.team_name as string]),
  ])
  const approvedTeams = entries.filter(entry => entry.application_status === 'approved').map(entry => ({ id: entry.team_id, name: entry.team_name ?? 'Approved team' }))

  // The header's primary action and the Overview's next-action panel are the
  // same computation, so the page never shows two competing ladders
  // (specification section 3: "Do not show several competing primary actions").
  const summary = operationalSummary(entries, matches)
  const nextAction = cockpitNextAction({ status: tournament.status, isPublished: tournament.is_published, progress, entries, matches })
  const lifecycleStages = tournamentLifecycle({ status: tournament.status, setupComplete: progress.complete === progress.total, entries, matchCount: matches.length })
  const lifecycle = lifecycleProgress(lifecycleStages)
  const canFinance = canManageFinance(role, staffPermissions)
  const rosterStep = steps.find(item => item.step_number === 5)?.data ?? {}
  const rosterLimit = (key: string) => { const value = Number((rosterStep as Record<string, unknown>)[key]); return Number.isFinite(value) && value > 0 ? value : null }
  const rosterLimits = { min: rosterLimit('rosterMin'), max: rosterLimit('rosterMax') }
  const canMedia = canManage || role === 'media' || staffPermissions.includes('media')
  const awardList = awards.awards.map(award => ({ kind: award.kind, label: AWARD_LABELS[award.kind.replace(/^award_/, '') as keyof typeof AWARD_LABELS] ?? 'Award', recipient: award.label }))
  const goOrganizer = (section: 'overview' | 'tournaments') => { if (onOpenOrganizerSection) onOpenOrganizerSection(section); else onBack() }
  const phaseId = currentFlowStep({ status: tournament.status, isPublished: tournament.is_published, entries, matches })
  const phaseName = phaseId ? FLOW_STEPS.find(step => step.id === phaseId)?.label ?? '' : 'Finished'
  // Hide what is not in use: registration and payments only when teams apply or pay.
  const registrationUsed = tournament.status === 'registration_open' || chargesFee(entries) || entries.some(entry => entry.application_status !== 'approved')
  // More shows only what this person may use (finance and media need their permission).
  const allowed = (item: OrganizerTab) => item === tab || ((item !== 'finance' || canFinance) && (item !== 'media' || canMedia))
  const visibleTabs = (group: { tabs: OrganizerTab[] }) => group.tabs.filter(item => item === tab || item !== 'applications' || registrationUsed).filter(allowed)
  const currentGroup = TAB_GROUPS.find(group => group.tabs.includes(tab)) ?? TAB_GROUPS[0]
  // Plain warnings for Home: clashes, matches without a time, and anything waiting on the organizer.
  const clashCount = [...fixtureWarnings(matches).values()].filter(list => list.length).length
  const blockersForHome = [
    clashCount ? `${clashCount} match${clashCount === 1 ? ' has' : 'es have'} a team or venue clash.` : '',
    matches.filter(match => match.status === 'scheduled' && !match.scheduled_at).length ? `${matches.filter(match => match.status === 'scheduled' && !match.scheduled_at).length} match(es) still need a date and time.` : '',
    matches.filter(match => match.status === 'postponed').length ? `${matches.filter(match => match.status === 'postponed').length} postponed match(es) need a new date.` : '',
    summary.payments.pendingVerification ? `${summary.payments.pendingVerification} payment proof(s) to check.` : '',
    summary.rosters.submitted ? `${summary.rosters.submitted} squad list(s) to review.` : '',
  ].filter(Boolean)
  const details = (forTab: OrganizerTab, children: ReactNode, label?: string) => <MoreDetails open={detailsFor === forTab} onToggle={open => setDetailsFor(open ? forTab : null)} label={label}>{children}</MoreDetails>
  const awardsPanel = <AwardsPanel client={client} user={user} organizationId={organization.id} tournamentId={tournamentId} teams={approvedTeams} canManage={canManage} awards={awards.awards} awardsError={awards.error} onReload={awards.reload} onNotice={onNotice} />

  return <div className="cockpit" data-testid="tournament-workspace">
    <nav className="cockpit-breadcrumb" aria-label="Breadcrumb">
      <button type="button" onClick={() => goOrganizer('overview')}>Organizer</button>
      <ChevronRight size={13} aria-hidden="true" />
      <span>{organization.name}</span>
      <ChevronRight size={13} aria-hidden="true" />
      <button type="button" onClick={() => goOrganizer('tournaments')}>Tournaments</button>
      <ChevronRight size={13} aria-hidden="true" />
      {tab === 'overview'
        ? <span aria-current="page">{tournament.name}</span>
        : <>
          <button type="button" onClick={() => onOpenTab('overview')}>{tournament.name}</button>
          <ChevronRight size={13} aria-hidden="true" />
          <span aria-current="page">{TAB_LABELS.find(item => item.tab === tab)?.label ?? 'Overview'}</span>
        </>}
    </nav>

    {/* The banner shows only when the organizer added a cover; no empty placeholder block. */}
    {tab === 'overview' && tournament.cover_path && <div className="cockpit-cover"><TournamentCover client={client} path={tournament.cover_path} name={tournament.name} sport={tournament.sport} /></div>}
      <div className={`cockpit-header${tab === 'overview' ? '' : ' is-compact'}`}>

      <div className="cockpit-identity">
        <h1>{tournament.name}</h1>
        <p className="cockpit-sport">{sportLabel(tournament.sport)}</p>
        <p className="cockpit-meta">
          <span className="status-pill status-info" title="Current phase">Phase: {phaseName}</span>
          {tournament.is_published ? <span className="status-pill status-ok">Published</span> : <span className="status-pill status-neutral">Private draft</span>}
        </p>
      </div>
      <div className="cockpit-actions cockpit-side-actions">
        {tournament.is_published ? <a className="outline-button dark" href={`#tournament/${encodeURIComponent(tournament.slug)}`} target="_blank" rel="noreferrer">Preview Public Page <ExternalLink size={14} /></a> : <button type="button" className="outline-button dark" onClick={() => onOpenTab('setup', progress.currentStep)}>Preview Public Page</button>}
        {canManage && <button type="button" className="outline-button dark" onClick={() => onOpenTab('setup', 1)}>Edit tournament</button>}
        <MoreActionsMenu status={tournament.status} canManage={canManage} onOpenTab={onOpenTab} />
      </div>
    </div>

    {/* Five-step progress: Create, Teams, Schedule, Play, Finish. */}
    <FlowProgress tournament={tournament} entries={entries} matches={matches} onOpenTab={onOpenTab} />

    <nav className="cockpit-groups flow-nav" aria-label="Tournament menu">
      <div className="flow-nav-main" role="tablist">{TAB_GROUPS.map(group => { const first = visibleTabs(group)[0] ?? group.tabs[0]; const active = currentGroup.label === group.label; return <button type="button" key={group.label} role="tab" aria-selected={active} className={active ? 'active' : ''} onClick={() => onOpenTab(first, first === 'setup' ? progress.currentStep : null)}>{groupLabel(group.label)}{group.label === 'Teams' && workflow.applicationsPending > 0 ? <span className="tab-badge">{workflow.applicationsPending}</span> : null}</button> })}</div>
      {visibleTabs(currentGroup).length > 1 && <div className="cockpit-group-tabs flow-nav-sub" role="tablist" aria-label={groupLabel(currentGroup.label)}>{visibleTabs(currentGroup).map(item => <button type="button" key={item} ref={tab === item ? scrollTabIntoView : undefined} role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => onOpenTab(item, item === 'setup' ? progress.currentStep : null)}>{TAB_LABELS.find(label => label.tab === item)?.label ?? item}{item === 'applications' && workflow.applicationsPending > 0 ? <span className="tab-badge">{workflow.applicationsPending}</span> : null}</button>)}</div>}
    </nav>
    {/* Phone: the same five items as a bottom bar. */}
    <nav className="ws-bottomnav flow-bottomnav" aria-label="Tournament">{TAB_GROUPS.map(group => { const first = visibleTabs(group)[0] ?? group.tabs[0]; const active = currentGroup.label === group.label; const Icon = GROUP_ICONS[group.label] ?? MoreHorizontal; return <button type="button" key={group.label} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => onOpenTab(first, first === 'setup' ? progress.currentStep : null)}><Icon size={20} aria-hidden="true" /><span>{groupLabel(group.label)}</span></button> })}</nav>

    {/* Screens that do not print their own step heading get a clear title. */}
    {TITLED_ELSEWHERE.includes(tab) ? null : <header className="flow-step-head tab-title"><p className="ed-eyebrow">{groupLabel(currentGroup.label)}</p><h2>{TAB_LABELS.find(item => item.tab === tab)?.label ?? ''}</h2></header>}
    {tab === 'overview' ? <><SimpleHome activity={activity.map(item => ({ id: item.id, label: activityLabel(item), at: item.created_at }))} tournament={tournament} entries={entries} matches={matches} awards={awardList} onOpenTab={onOpenTab} onExit={onBack} registrationOpen={tournament.status === 'registration_open'} scores={scores} warnings={blockersForHome} client={client} /></>
      : tab === 'setup' ? <><SetupGuard tournament={tournament} entries={entries} matches={matches} onOpenTab={onOpenTab} /><SetupStage client={client} user={user} tournament={tournament} steps={steps} activeStep={step ?? progress.currentStep} progress={progress} canManage={canManage} onNotice={onNotice} onChanged={reload} onOpenTab={onOpenTab} /><div className="tab-panel"><PublicEffectPreview tournament={tournament} categories={categories} sportLabel={sportLabel(tournament.sport)} /><TournamentTimeline client={client} tournamentId={tournamentId} types={['setup', 'tournament']} title="Setup changes" reloadKey={reloadKey} /></div></>
        : tab === 'applications' ? <ApplicationsPage client={client} tournamentId={tournamentId} entries={entries} canManage={canManage} onNotice={onNotice} onChanged={reload} />
          : tab === 'teams' ? <><SimpleTeams client={client} user={user} tournament={tournament} entries={entries} matches={matches} steps={steps} canManage={canManage} onNotice={onNotice} onChanged={reload} onOpenTab={onOpenTab} />{details('teams', <><TeamsTab client={client} user={user} tournament={tournament} entries={entries} canManage={canManage} onNotice={onNotice} onChanged={reload} /><div className="tab-panel"><RosterChecksPanel client={client} entries={entries.filter(entry => entry.application_status === 'approved')} limits={rosterLimits} canManage={canManage} onNotice={onNotice} onChanged={reload} /><PlayerDocumentsReview client={client} userId={user.id} tournamentId={tournamentId} canManage={canManage} /></div>{canManage && <div className="tab-panel"><PlayerRequestsReview client={client} scope={{ kind: 'tournament', id: tournamentId }} title="Player correction requests" /><TeamDocumentsReview client={client} userId={user.id} tournamentId={tournamentId} /></div>}</>)}</>
            : tab === 'draw' ? <div className="tab-panel draw-tab">
                <div className="draw-tab-head"><h3 className="draw-tab-title">Draw &amp; fixtures</h3><p className="field-hint">Draws use approved teams only. {drawEligibleTeamIds(entries).length} of {entries.length} entries are currently eligible.</p></div>
                <div className="draw-tab-grid">
                  <div className="draw-tab-col"><CompetitionPlanner client={client} user={user} tournamentId={tournamentId} teams={approvedTeams} categories={categories} onNotice={onNotice} onSaved={reload} /></div>
                  <div className="draw-tab-col"><NextRoundPanel client={client} user={user} tournamentId={tournamentId} teamNames={teamNames} canManage={canManage} onNotice={onNotice} onChanged={reload} /></div>
                </div>
                <ProgressionConflictsPanel key={`conflicts-${reloadKey}`} client={client} user={user} tournamentId={tournamentId} teamNames={teamNames} canManage={canManage} onNotice={onNotice} onChanged={reload} />
                <DrawStagesPanel client={client} tournamentId={tournamentId} canManage={canManage} reloadKey={reloadKey} onNotice={onNotice} onChanged={reload} />
              </div>
              : tab === 'fixtures' ? <><SimpleSchedule client={client} user={user} tournament={tournament} entries={entries} matches={matches} steps={steps} categories={categories} canManage={canManage} onNotice={onNotice} onChanged={reload} onOpenTab={onOpenTab} onMakeChanges={() => setDetailsFor('fixtures')} />{details('fixtures', <FixturesPage client={client} user={user} tournamentId={tournamentId} matches={matches} teams={approvedTeams} canManage={canManage} reloadKey={reloadKey} onNotice={onNotice} onChanged={reload} />, 'Make changes and more details')}</>
              : tab === 'matches' ? <><ProgressionConflictsPanel key={`conflicts-${reloadKey}`} client={client} user={user} tournamentId={tournamentId} teamNames={teamNames} canManage={canManage} onNotice={onNotice} onChanged={reload} /><SimplePlay client={client} user={user} tournament={tournament} entries={entries} matches={matches} canManage={canManage} onNotice={onNotice} onChanged={reload} onOpenTab={onOpenTab} />{details('matches', <><MatchesTab client={client} user={user} tournamentId={tournamentId} matches={matches} canManage={canManage} onNotice={onNotice} onChanged={reload} onOpenTab={onOpenTab} />{canManage && <div className="tab-panel"><TeamResultReportsReview client={client} tournamentId={tournamentId} /></div>}</>, 'All matches and more details')}</>
                : tab === 'standings' ? <><ProgressionConflictsPanel key={`conflicts-${reloadKey}`} client={client} user={user} tournamentId={tournamentId} teamNames={teamNames} canManage={canManage} onNotice={onNotice} onChanged={reload} /><StandingsTab client={client} tournamentId={tournamentId} teamNames={teamNames} userId={user.id} canManage={canManage} onNotice={onNotice} /><div className="tab-panel"><StandingsManagement client={client} tournamentId={tournamentId} teamNames={teamNames} canManage={canManage} reloadKey={reloadKey} onNotice={onNotice} onChanged={reload} /></div></>
                  : tab === 'finance' ? <TournamentFinancePage client={client} user={user} tournamentId={tournamentId} entries={entries} canFinance={canFinance} reloadKey={reloadKey} onNotice={onNotice}><FinanceSection client={client} user={user} organizations={[organization]} organizationId={organization.id} onNotice={onNotice} /></TournamentFinancePage>
                    : tab === 'staff' ? <OperationsPage client={client} user={user} tournamentId={tournamentId} matches={matches} entries={entries} canManage={canManage} reloadKey={reloadKey} onNotice={onNotice}><TournamentStaffPanel client={client} user={user} tournamentName={tournament.name} tournamentId={tournamentId} canManage={canManage} onNotice={onNotice} /></OperationsPage>
                      : tab === 'media' ? <TournamentMediaPage client={client} user={user} organizationId={organization.id} tournament={tournament} teams={approvedTeams} matches={matches} canPublish={canMedia} onNotice={onNotice} />
                        : tab === 'reports' ? <ReportsPage client={client} tournament={tournament} entries={entries} matches={matches} scores={scores} reloadKey={reloadKey} />
                        : tab === 'completion' ? <><SimpleFinish client={client} tournament={tournament} matches={matches} awards={awardList} canManage={canManage} onNotice={onNotice} onChanged={reload} onOpenTab={onOpenTab} reloadKey={reloadKey} awardsPanel={awardsPanel} />{details('completion', <CompletionPage client={client} tournament={tournament} entries={entries} matches={matches} awards={awardList} canManage={canManage} reloadKey={reloadKey} onNotice={onNotice} onChanged={reload} onOpenTab={onOpenTab}>{['completed', 'archived', 'cancelled'].includes(tournament.status) ? <div className="tab-panel">{awardsPanel}</div> : null}</CompletionPage>, 'All completion checks and archive')}</>
                          : <><SettingsTab client={client} tournament={tournament} blockers={blockers} canManage={canManage} onNotice={onNotice} onChanged={reload} onBack={onBack} onOpenTab={onOpenTab} />{details('settings', <CockpitOverview
        tournament={tournament}
        organizationName={organization.name}
        progress={progress}
        summary={summary}
        nextAction={nextAction}
        lifecycleStages={lifecycleStages}
        lifecycle={lifecycle}
        steps={steps}
        entries={entries}
        matches={matches}
        categories={categories}
        categoriesError={categoriesError}
        onRetryCategories={() => setReloadKey(value => value + 1)}
        scores={scores}
        scoresError={scoresError}
        onRetryScores={() => setReloadKey(value => value + 1)}
        registrationSummary={registrationSummary}
        registrationError={registrationError}
        onRetryRegistration={() => setReloadKey(value => value + 1)}
        notifications={notifications}
        notificationsError={notificationsError}
        onRetryNotifications={() => setReloadKey(value => value + 1)}
        activity={activity}
        activityLoaded={activityLoaded}
        activityError={activityError}
        onRetryActivity={() => setReloadKey(value => value + 1)}
        canFinance={canFinance}
        canManage={canManage}
        client={client}
        blockers={blockers}
        onNotice={onNotice}
        onChanged={reload}
        onViewActivity={() => goOrganizer('overview')}
        onOpenTab={onOpenTab}
        onBack={onBack}
      />, 'Full status, lifecycle and history')}</>}
  </div>
}

function CockpitOverview({ tournament, organizationName, progress, summary, nextAction, lifecycleStages, lifecycle, steps, entries, matches, categories, categoriesError, onRetryCategories, scores, scoresError, onRetryScores, registrationSummary, registrationError, onRetryRegistration, notifications, notificationsError, onRetryNotifications, activity, activityLoaded, activityError, onRetryActivity, canFinance, canManage, client, blockers, onNotice, onChanged, onViewActivity, onOpenTab, onBack }: CockpitOverviewProps) {
  const [copiedLink, setCopiedLink] = useState('')
  const confirmedMatches = matches.filter(item => item.status === 'confirmed')
  const awaitingMatches = matches.filter(item => item.status === 'awaiting_confirmation')

  // Team names come from the fixtures themselves; an id is never shown as a
  // label when its name cannot be resolved.
  const teamNames = new Map<string, string>()
  for (const item of matches) {
    if (item.home_team_id) teamNames.set(item.home_team_id, item.home_team_name ?? 'Published team')
    if (item.away_team_id) teamNames.set(item.away_team_id, item.away_team_name ?? 'Published team')
  }
  const confirmedResults = confirmedMatches
    .map(item => {
      const score = scores.get(item.id)
      return score ? { homeTeamId: item.home_team_id, awayTeamId: item.away_team_id, homeScore: score.homeScore, awayScore: score.awayScore, confirmed: true } : null
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
  const standings = standingsPreview([...teamNames.keys()], confirmedResults, 5)

  // Specification section 11: only the NEXT THREE matches on the overview.
  const upcoming = upcomingMatchesList(matches, entries, 3)
  const attention = cockpitAttentionItems({ status: tournament.status, isPublished: tournament.is_published, progress, entries, matches }).slice(0, 5)
  const setupItems = setupReadinessItems(steps)
  const competitionItems = competitionReadinessItems(entries, matches, null)
  const completionItems = completionReadinessItems(matches)

  const isNeedingAttention = (entry: TournamentEntry) => entry.application_status !== 'approved' || entry.roster_status === 'changes_requested' || PENDING_ROSTER_STATUSES.includes(entry.roster_status)
  const teamsNeedingAttention = entries.filter(isNeedingAttention).slice(0, 5)
  const teamsNeedingAttentionCount = entries.filter(isNeedingAttention).length
  const publicHash = `#tournament/${encodeURIComponent(tournament.slug)}`
  const publicUrl = `${window.location.origin}/${publicHash}`

  const copyRegistrationLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl)
      onNotice('Registration link copied to the clipboard.')
    } catch {
      setCopiedLink(publicUrl)
    }
  }

  // Remaining places compare the competition's team limit with the teams that
  // have actually been approved. Without a limit there is nothing to compare,
  // so no number is shown rather than an invented value.
  const approvedEntries = summary.applications.approved
  const teamLimit = registrationSummary?.teamLimit ?? null
  const remainingPlaces = teamLimit !== null && teamLimit > 0 ? Math.max(0, teamLimit - approvedEntries) : null
  const registrationStatusText = registrationSummaryLabel(tournament.status)

  return <div className="tab-panel overview-panel">
    {/* Section 3: one instruction, with its reason and a direct action. */}
    <section className={`ov-next tone-${nextAction.tone}`} aria-labelledby="ov-next-label">
      <div>
        <p className="eyebrow" id="ov-next-label">NEXT ACTION</p>
        <h3>{nextAction.label}</h3>
        <p>{nextAction.reason}</p>
      </div>
      <button type="button" className="primary-button" onClick={() => onOpenTab(nextAction.tab, nextAction.step)}>{nextAction.label.startsWith('Review') || nextAction.label.startsWith('Confirm') ? 'Open' : 'Go to'} {TAB_LABELS.find(item => item.tab === nextAction.tab)?.label ?? 'section'} <ArrowRight size={15} /></button>
    </section>

    {/* Section 6 (revised): operational summary cards, each with a single
        destination. Applications, rosters, payments and matches are counted
        separately, and finance is hidden without permission (acceptance
        points 4, 6 and 11). */}
    <section aria-labelledby="ov-summary-label">
      <h3 className="ov-section-title" id="ov-summary-label">Operational summary</h3>
      <div className="ov-cards">
        <OverviewCard title="Applications" tab="applications" onOpenTab={onOpenTab}>
          <Metric label="Total" value={summary.applications.total} />
          <Metric label="Pending review" value={summary.applications.pending} />
          <Metric label="Approved" value={summary.applications.approved} />
        </OverviewCard>
        <OverviewCard title="Rosters" tab="teams" onOpenTab={onOpenTab}>
          <Metric label="Submitted" value={summary.rosters.submitted} />
          <Metric label="Approved" value={summary.rosters.approved} />
          <Metric label="Locked" value={summary.rosters.locked} />
          <Metric label="Changes requested" value={summary.rosters.changesRequested} />
        </OverviewCard>
        <OverviewCard title="Fixtures" tab="draw" onOpenTab={onOpenTab}>
          <Metric label="Total" value={summary.fixtures.total} />
          <Metric label="Unscheduled" value={summary.fixtures.unscheduled} />
          <Metric label="Missing venue" value={summary.fixtures.missingVenue} />
        </OverviewCard>
        <OverviewCard title="Matches" tab="matches" onOpenTab={onOpenTab}>
          <Metric label="Scheduled" value={summary.matches.scheduled} />
          <Metric label="Live" value={summary.matches.live} />
          <Metric label="Awaiting confirmation" value={summary.matches.awaitingConfirmation} />
          <Metric label="Confirmed" value={summary.matches.confirmed} />
        </OverviewCard>
      </div>
      {/* At most four summary cards in view (final specification 2.4); the rest stay one tap away. */}
      <details className="ov-more-counts"><summary>More counts: teams{canFinance ? ' and payments' : ''}</summary><div className="ov-cards">
        <OverviewCard title="Teams" tab="teams" onOpenTab={onOpenTab}>
          <Metric label="Approved tournament entries" value={summary.teams.approvedEntries} />
          <Metric label="Eligible teams" value={summary.teams.eligible} />
          <Metric label="Teams needing attention" value={teamsNeedingAttentionCount} />
        </OverviewCard>
        {canFinance ? <OverviewCard title="Payments" tab="finance" onOpenTab={onOpenTab}>
          <Metric label="Pending" value={summary.payments.pendingVerification} />
          <Metric label="Verified" value={summary.payments.verified} />
          <Metric label="Outstanding" value={summary.payments.unpaid} />
        </OverviewCard> : null}
      </div></details>
    </section>

    <div className="ov-columns">
      <div className="ov-main">
        {/* Section 6 */}
        <section className="ov-block" aria-labelledby="ov-attention-label">
          <h3 className="ov-section-title" id="ov-attention-label">{tr('workspace.needsAttention', 'Needs attention')}</h3>
          {attention.length === 0
            ? <p className="empty-note">Nothing needs your attention in this tournament right now.</p>
            : <ul className="ov-attention">{attention.map(item => <li key={item.key} className={`tone-${item.tone}`}>
                <div>
                  <p className={item.priority === 'high' ? 'ov-priority high' : 'ov-priority'}>{item.priority === 'high' ? 'High priority' : 'Normal priority'}</p>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
                <button type="button" className="quiet-button" onClick={() => onOpenTab(item.tab, item.step)}>Open {TAB_LABELS.find(tab => tab.tab === item.tab)?.label ?? 'section'} <ArrowRight size={14} /></button>
              </li>)}</ul>}
        </section>

        {/* Section 12 */}
        <section className="ov-block" aria-labelledby="ov-upcoming-label">
          <h3 className="ov-section-title" id="ov-upcoming-label">Upcoming matches</h3>
          {matches.length === 0
            ? <p className="empty-note">No fixtures have been created yet. The draw creates fixtures from approved teams.</p>
            : upcoming.length === 0
              ? <p className="empty-note">No fixtures are still to be played.</p>
              : <ul className="ov-matches">{upcoming.map(item => <li key={item.id}>
                  <div>
                    <strong>{item.home} vs {item.away}</strong>
                    <p className="ov-match-meta"><Clock3 size={13} aria-hidden="true" /> {item.scheduledAt ? formatWorkspaceDate(item.scheduledAt) : 'Not scheduled'}{item.venue ? <> <MapPin size={13} aria-hidden="true" /> {item.venue}</> : null}</p>
                    <p><span className={`status-pill status-${matchStatusTone(item.status)}`}>{matchStatusLabel(item.status)}</span></p>
                    {item.warnings.length > 0 ? <p className="ov-warnings">{item.warnings.map(warning => <span key={warning} className="status-pill status-warn">{warning}</span>)}</p> : null}
                  </div>
                  <button type="button" className="quiet-button" onClick={() => onOpenTab('matches')}>Open match <ArrowRight size={14} /></button>
                </li>)}</ul>}
        </section>

        {/* Section 13 */}
        {awaitingMatches.length > 0 ? <section className="ov-block" aria-labelledby="ov-results-label">
          <h3 className="ov-section-title" id="ov-results-label">Results awaiting confirmation</h3>
          <p className="field-hint">Confirming a result here is done in the Matches tab, where the submitted score and its events are shown first.</p>
          <ul className="ov-matches">{awaitingMatches.map(item => <li key={item.id}>
            <div>
              <strong>{item.home_team_name ?? 'Published team'} vs {item.away_team_name ?? 'Published team'}</strong>
              <p className="ov-match-meta">{item.scheduled_at ? formatWorkspaceDate(item.scheduled_at) : 'Not scheduled'}{item.venue ? ` · ${item.venue}` : ''}</p>
            </div>
            <button type="button" className="quiet-button" onClick={() => onOpenTab('matches')}>Review result <ArrowRight size={14} /></button>
          </li>)}</ul>
        </section> : null}

        {/* Section 14 */}
        <section className="ov-block" aria-labelledby="ov-standings-label">
          <h3 className="ov-section-title" id="ov-standings-label">Standings preview</h3>
          {scoresError
            ? <SectionUnavailable label="Standings" reason={scoresError} onRetry={onRetryScores} />
            : confirmedMatches.length === 0
              ? <p className="empty-note">Standings will appear after the first result is confirmed.</p>
              : confirmedResults.length === 0
                ? <p className="empty-note">A result has been confirmed, but its score could not be read. Open Standings to view it.</p>
                : <>
                    <p className="field-hint">Calculated from confirmed results only.</p>
                    <table className="ov-table">
                      <thead><tr><th scope="col">Pos</th><th scope="col">Team</th><th scope="col">Played</th><th scope="col">Diff</th><th scope="col">Pts</th></tr></thead>
                      <tbody>{standings.map((row, index) => <tr key={row.teamId}><td>{index + 1}</td><td>{teamNames.get(row.teamId) ?? 'Published team'}</td><td>{row.played}</td><td>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td><td>{row.points}</td></tr>)}</tbody>
                    </table>
                    <button type="button" className="quiet-button" onClick={() => onOpenTab('standings')}>View full standings <ArrowRight size={14} /></button>
                  </>}
        </section>

        {/* Section 14 (revised specification): recent activity. The audit
            policy exposes only the caller's own events, so the feed says so
            instead of implying a team-wide record. */}
        <section className="ov-block" aria-labelledby="ov-activity-label">
          <h3 className="ov-section-title" id="ov-activity-label">Recent activity</h3>
          {activityError
            ? <SectionUnavailable label="Activity" reason={activityError} onRetry={onRetryActivity} />
            : !activityLoaded
              ? <p className="empty-note">Loading activity…</p>
              : activity.length === 0
                ? <p className="empty-note">No activity recorded yet. Actions you take are recorded with an audit trail.</p>
                : <>
                    <p className="field-hint">Showing your own recorded actions in this workspace.</p>
                    <ul className="ov-activity">
                      {activity.map(item => <li key={item.id}>
                        <div>
                          <strong>{activityLabel(item)}</strong>
                          <p className="ov-match-meta"><Clock3 size={13} aria-hidden="true" /> {formatWorkspaceDate(item.created_at)}</p>
                        </div>
                      </li>)}
                    </ul>
                    <button type="button" className="quiet-button" onClick={onViewActivity}>View full activity <ArrowRight size={14} /></button>
                  </>}
        </section>

        {/* Section 10 */}
        <section className="ov-block" aria-labelledby="ov-teams-label">
          <h3 className="ov-section-title" id="ov-teams-label">Teams and rosters</h3>
          {entries.length === 0
            ? <p className="empty-note">No teams have entered this tournament yet.</p>
            : teamsNeedingAttention.length === 0
              ? <p className="empty-note">Every entry is approved and its roster is resolved.</p>
              : <table className="ov-table">
                  <thead><tr><th scope="col">Team</th><th scope="col">Application</th><th scope="col">Roster</th><th scope="col">Payment</th></tr></thead>
                  <tbody>{teamsNeedingAttention.map(entry => <tr key={entry.id}>
                    <td>{entry.team_name ?? 'Published team'}</td>
                    <td><span className={`status-pill status-${applicationStatusTone(entry.application_status)}`}>{applicationStatusLabel(entry.application_status)}</span></td>
                    <td><span className={`status-pill status-${rosterStatusTone(entry.roster_status)}`}>{rosterStatusLabel(entry.roster_status)}</span></td>
                    <td>{canFinance ? <span className={`status-pill status-${paymentStatusTone(entry.payment_status)}`}>{paymentStatusLabel(entry.payment_status)}</span> : <span className="status-pill status-neutral">Restricted</span>}</td>
                  </tr>)}</tbody>
                </table>}
          <button type="button" className="quiet-button" onClick={() => onOpenTab('teams')}>View all teams <ArrowRight size={14} /></button>
        </section>
      </div>

      <div className="ov-side">
        {/* Section 4: setup and lifecycle progress, kept separate. */}
        <section className="ov-block" aria-labelledby="ov-progress-label">
          <h3 className="ov-section-title" id="ov-progress-label">Progress</h3>
          <p><strong>Setup:</strong> {progress.complete} of {progress.total} stages complete</p>
          <div className="progress-track" role="img" aria-label={`${progress.complete} of ${progress.total} setup stages complete`}><span style={{ width: `${progress.percent}%` }} /></div>
          <p><strong>Tournament lifecycle:</strong> {lifecycle.complete} of {lifecycle.total} stages</p>
          <div className="progress-track" role="img" aria-label={`${lifecycle.complete} of ${lifecycle.total} lifecycle stages complete`}><span style={{ width: `${lifecycle.percent}%` }} /></div>
        </section>

        {/* Section 7 */}
        <section className="ov-block" aria-labelledby="ov-readiness-label">
          <h3 className="ov-section-title" id="ov-readiness-label">Readiness</h3>
          <ReadinessList title="Setup readiness" items={setupItems} onOpenTab={onOpenTab} />
          <ReadinessList title="Competition readiness" items={competitionItems} onOpenTab={onOpenTab} />
          <ReadinessList title="Completion readiness" items={completionItems} onOpenTab={onOpenTab} />
        </section>

        {/* Section 9 (revised specification): registration summary. The full
            registration configuration stays in the Setup tab; only its state
            and the deadline-sensitive facts appear here. */}
        <section className="ov-block" aria-labelledby="ov-registration-label">
          <h3 className="ov-section-title" id="ov-registration-label">Registration</h3>
          {registrationError
            ? <SectionUnavailable label="Registration" reason={registrationError} onRetry={onRetryRegistration} />
            : registrationSummary === null
              ? <p className="empty-note">Loading registration…</p>
              : <>
                  <dl className="fact-sheet">
                    <div><dt>Status</dt><dd>{registrationStatusText}</dd></div>
                    <div><dt>Opening date</dt><dd>{registrationSummary.settings?.opens_at ? formatWorkspaceDate(registrationSummary.settings.opens_at) : 'Not set'}</dd></div>
                    <div><dt>Closing date</dt><dd>{registrationSummary.settings?.closes_at ? formatWorkspaceDate(registrationSummary.settings.closes_at) : 'Not set'}</dd></div>
                    <div><dt>Team limit</dt><dd>{teamLimit === null ? 'No limit set' : teamLimit}</dd></div>
                    <div><dt>Applications received</dt><dd>{approvedEntries}</dd></div>
                    <div><dt>Approved teams</dt><dd>{summary.teams.approvedEntries}</dd></div>
                    <div><dt>Remaining places</dt><dd>{remainingPlaces === null ? '—' : remainingPlaces}</dd></div>
                    <div><dt>Registration link</dt><dd>{tournament.is_published ? 'Public page is live' : 'Not published — the public link appears after publishing'}</dd></div>
                  </dl>
                  {tournament.is_published ? <button type="button" className="quiet-button" onClick={() => void copyRegistrationLink()}>Copy registration link <ArrowRight size={14} /></button> : null}
                  {copiedLink ? <p className="field-hint"><code>{copiedLink}</code></p> : null}
                  <RegistrationStatusActions client={client} tournament={tournament} canManage={canManage} onNotice={onNotice} onChanged={onChanged} />
                  <button type="button" className="quiet-button" onClick={() => onOpenTab('applications')}>Review applications <ArrowRight size={14} /></button>
                  <button type="button" className="quiet-button" onClick={() => onOpenTab('setup', 3)}>Edit registration <ArrowRight size={14} /></button>
                </>}
        </section>

        {/* Section 15 (revised specification): tournament notifications. Reads
            are recipient-scoped by policy; this is a summary, and the full
            notification management stays out of the Overview. */}
        <section className="ov-block" aria-labelledby="ov-notifications-label">
          <h3 className="ov-section-title" id="ov-notifications-label">Notifications</h3>
          {notificationsError
            ? <SectionUnavailable label="Notifications" reason={notificationsError} onRetry={onRetryNotifications} />
            : notifications === null
              ? <p className="empty-note">Loading notifications…</p>
              : <>
                  <p><strong>Unread:</strong> {notifications.unread === null ? '—' : notifications.unread}</p>
                  {notifications.notifications.length === 0
                    ? <p className="empty-note">No notifications for this tournament yet.</p>
                    : <ul className="ov-notifications">
                        {notifications.notifications.map(item => <li key={item.id}>
                          <strong>{item.title}</strong>
                          <p>{item.body}</p>
                          <p className="ov-match-meta"><Clock3 size={13} aria-hidden="true" /> {formatWorkspaceDate(item.created_at)}{item.read_at ? '' : ' · Unread'}{item.delivery_state ? ` · Delivery: ${item.delivery_state}` : ''}</p>
                        </li>)}
                      </ul>}
                </>}
        </section>

        {/* Section 8 */}
        <section className="ov-block" aria-labelledby="ov-lifecycle-label">
          <h3 className="ov-section-title" id="ov-lifecycle-label">Lifecycle</h3>
          <ol className="ov-timeline">{lifecycleStages.map(item => <li key={item.stage} className={`is-${item.state}`}>
            <span className="ov-timeline-dot" aria-hidden="true" />
            <span className="ov-timeline-label">{item.label}</span>
            <span className="ov-timeline-state">{item.state}</span>
          </li>)}</ol>
        </section>

        {/* Section 2 header detail, including the category summary. */}
        <section className="ov-block" aria-labelledby="ov-details-label">
          <h3 className="ov-section-title" id="ov-details-label">Tournament details</h3>
          <dl className="fact-sheet">
            <div><dt>Name</dt><dd>{tournament.name}</dd></div>
            <div><dt>Sport</dt><dd>{sportLabel(tournament.sport)}</dd></div>
            <div><dt>Status</dt><dd>{tournamentStatusLabel(tournament.status)}</dd></div>
            <div><dt>Visibility</dt><dd>{tournament.is_published ? 'Published' : 'Private draft — teams cannot see it yet'}</dd></div>
            <div><dt>Categories</dt><dd>{categoriesError ? <SectionUnavailable label="Categories" reason={categoriesError} onRetry={onRetryCategories} inline /> : categories.length === 0 ? 'None configured yet' : categories.map(item => item.name).join(', ')}</dd></div>
            <div><dt>Last updated</dt><dd>{formatWorkspaceDate(tournament.updated_at)}</dd></div>
            <div><dt>Organization</dt><dd>{organizationName}</dd></div>
          </dl>
        </section>

        {/* Section 20 */}
        {blockers.length > 0 && tournament.status !== 'completed' ? <section className="ov-block tone-warn" aria-labelledby="ov-blockers-label">
          <h3 className="ov-section-title" id="ov-blockers-label">Completion blocked</h3>
          <p className="field-hint">This tournament cannot be completed yet:</p>
          <ul className="ov-blockers">{blockers.map(item => <li key={item}>{item}</li>)}</ul>
          <button type="button" className="quiet-button" onClick={() => onOpenTab('settings')}>Open Settings <ArrowRight size={14} /></button>
        </section> : null}
      </div>
    </div>

    <p className="ov-footnote"><button type="button" className="quiet-button" onClick={onBack}><ArrowLeft size={14} /> Back to all tournaments</button></p>
  </div>
}

// Section 5 cards. Each is a plain card with an explicit action rather than a
// clickable container, so the card body stays readable and the control stays a
// real button.
function OverviewCard({ title, tab, onOpenTab, children }: { title: string; tab: OrganizerTab; onOpenTab: (tab: OrganizerTab, step?: number | null) => void; children: ReactNode }) {
  return <div className="ov-card">
    <div className="ov-card-head"><h4>{title}</h4></div>
    <dl className="ov-metrics">{children}</dl>
    <button type="button" className="quiet-button" onClick={() => onOpenTab(tab)}>Open {TAB_LABELS.find(item => item.tab === tab)?.label ?? title} <ArrowRight size={14} /></button>
  </div>
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="ov-metric"><dt>{label}</dt><dd>{value}</dd></div>
}

// Section 7: a failed readiness item links to the section that must fix it.
function ReadinessList({ title, items, onOpenTab }: { title: string; items: ReadinessItem[]; onOpenTab: (tab: OrganizerTab, step?: number | null) => void }) {
  const failed = items.filter(item => !item.done)
  return <div className="ov-readiness">
    <h4>{title}</h4>
    <p className="field-hint">{items.length - failed.length} of {items.length} ready</p>
    <ul>{items.map(item => <li key={item.key} className={item.done ? 'is-done' : 'is-pending'}>
      {item.done ? <CircleCheck size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
      <button type="button" disabled={item.done} onClick={() => onOpenTab(item.tab, item.step)}>{item.label}</button>
    </li>)}</ul>
  </div>
}

// Section 21: a section that failed to load keeps its title and offers a retry
// rather than showing a zero, and never closes the rest of the page.
function SectionUnavailable({ label, reason, onRetry, inline = false }: { label: string; reason: string; onRetry: () => void; inline?: boolean }) {
  return <div className={inline ? 'ov-unavailable inline' : 'ov-unavailable'} role="status">
    <AlertTriangle size={15} aria-hidden="true" />
    <span>{label} unavailable. <button type="button" className="quiet-button" onClick={onRetry}><RefreshCw size={13} aria-hidden="true" /> Retry</button></span>
    <span className="sr-only">{reason}</span>
  </div>
}

type CockpitOverviewProps = {
  tournament: OrganizerTournament
  organizationName: string
  progress: SetupProgress
  summary: OperationalSummary
  nextAction: NextAction
  lifecycleStages: LifecycleView[]
  lifecycle: { complete: number; total: number; percent: number }
  steps: SetupStepRecord[]
  entries: TournamentEntry[]
  matches: TournamentMatch[]
  categories: Array<{ id: string; name: string }>
  categoriesError: string
  onRetryCategories: () => void
  scores: Map<string, { homeScore: number; awayScore: number }>
  scoresError: string
  onRetryScores: () => void
  registrationSummary: { settings: TournamentRegistrationSettings | null; teamLimit: number | null } | null
  registrationError: string
  onRetryRegistration: () => void
  notifications: TournamentNotificationSummary | null
  notificationsError: string
  onRetryNotifications: () => void
  activity: WorkspaceAuditEvent[]
  activityLoaded: boolean
  activityError: string
  onRetryActivity: () => void
  canFinance: boolean
  canManage: boolean
  client: SupabaseClient
  blockers: string[]
  onNotice: (message: string) => void
  onChanged: () => void
  onViewActivity: () => void
  onOpenTab: (tab: OrganizerTab, step?: number | null) => void
  onBack: () => void
}

// One truthful line per completed stage, shown in the completed-steps summary.
const STAGE_SUMMARIES: Record<number, string> = {
  1: 'Tournament name and sport saved',
  2: 'Competition categories configured',
  3: 'Registration method and window saved',
  4: 'Registration questions saved',
  5: 'Roster requirements saved',
  6: 'Competition format decided',
  7: 'Rules and standings notes saved',
  8: 'Tournament dates and venues saved',
  9: 'Review and launch completed',
}

// Stepper state for one stage, using the specification vocabulary. A stage
// never actually "skipped" has no state here to claim; a Set-later stage shows
// exactly that, because the schema stores it as an explicit deferred decision.
function stepperState(number: number, status: SetupStepRecord['status'], currentStep: number): 'complete' | 'current' | 'attention' | 'later' | 'upcoming' {
  if (status === 'complete') return 'complete'
  if (number === currentStep) return 'current'
  if (status === 'deferred') return 'later'
  if (status === 'blocked' || status === 'needs_review' || status === 'in_progress' || number < currentStep) return 'attention'
  return 'upcoming'
}

// Typed-but-unsaved values survive Back and Edit navigation within this
// session. They are deliberately memory only: nothing counts as persisted
// until Save & Continue succeeds against the database.
const stageDraftCache = new Map<string, Record<string, string>>()
const savedStageKeys = new Set<string>()

function SetupStage({ client, user, tournament, steps, activeStep, progress, canManage, onNotice, onChanged, onOpenTab }: {
  client: SupabaseClient; user: User; tournament: OrganizerTournament; steps: SetupStepRecord[]; activeStep: number; progress: ReturnType<typeof setupProgress>; canManage: boolean; onNotice: (message: string) => void; onChanged: () => void; onOpenTab: (tab: OrganizerTab, step?: number | null) => void
}) {
  // `reach` is the furthest stage the organizer has legitimately opened
  // (completed or deferred stages plus the current one). It only ever moves
  // forward, so a future dependent stage cannot be edited before the stages it
  // depends on are decided - neither through the stepper nor through a deep link.
  const [reach, setReach] = useState(progress.currentStep)
  useEffect(() => { setReach(previous => Math.max(previous, progress.currentStep)) }, [progress.currentStep])
  const stepNumber = Math.min(Math.max(activeStep >= 1 && activeStep <= SETUP_STEPS.length ? activeStep : 1, 1), reach)
  // Stored rows live under the legacy keys [1..8, 11]; wizard stage 9 reads and
  // writes key 11. Rows outside the wizard (keys 9/10) are never touched here.
  const record = steps.find(item => item.step_number === SETUP_STEP_KEYS[stepNumber - 1])
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [brandingError, setBrandingError] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [categories, setCategories] = useState<EditableTournamentCategory[]>([])
  const [categoriesExtended, setCategoriesExtended] = useState(false)
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [categoryDraft, setCategoryDraft] = useState({ name: '', description: '', age_group: '', gender: '', eligibility_instructions: '', team_limit: '' })
  const [removingCategory, setRemovingCategory] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [questions, setQuestions] = useState<RegistrationQuestion[]>([])
  const [questionType, setQuestionType] = useState('text')
  const [questionInstructions, setQuestionInstructions] = useState('')
  const [questionOptions, setQuestionOptions] = useState('')
  const [questionRequired, setQuestionRequired] = useState(true)
  const [editingQuestion, setEditingQuestion] = useState<string | null>(null)
  const [removingQuestion, setRemovingQuestion] = useState<string | null>(null)
  const [published, setPublished] = useState(false)
  const [confirmAction, setConfirmAction] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const formRef = useRef<HTMLDivElement>(null)
  const firstView = useRef(true)

  // Seed the form from the persisted stage data (or the tournament row for the
  // Basics stage) so an unfinished stage resumes with its earlier values.
  // Values typed without saving survive Back/Edit navigation through the memory
  // cache, but a just-saved stage reseeds from the database.
  useEffect(() => {
    const cacheKey = `${tournament.id}:${stepNumber}`
    const seeded: Record<string, string> = {}
    if (stepNumber === 1) {
      seeded.name = tournament.name
      seeded.sport = tournament.sport
    } else {
      const data = record?.data ?? {}
      for (const field of STAGE_FIELDS[stepNumber] ?? []) {
        const value = data[field.key]
        seeded[field.key] = value === undefined || value === null ? '' : String(value)
      }
    }
    // Sport suggestions for Stage 5 (spec section 7): show suggested roster
    // limits for empty fields only. They are displayed values, saved only if
    // the organizer saves them, and a decided stage never gets re-suggested.
    if (stepNumber === 5 && record?.status !== 'complete' && record?.status !== 'deferred') {
      const suggestion = SUGGESTED_SPORT_SETTINGS[tournament.sport as Sport]
      if (suggestion) {
        if (!seeded.rosterMin) seeded.rosterMin = String(suggestion.rosterMin)
        if (!seeded.rosterMax) seeded.rosterMax = String(suggestion.rosterMax)
        if (!seeded.rosterOfficialCount) seeded.rosterOfficialCount = String(suggestion.officials)
        if (!seeded.rosterTiming) seeded.rosterTiming = 'after_approval'
      }
    }
    if (!savedStageKeys.has(cacheKey)) {
      const cached = stageDraftCache.get(cacheKey)
      if (cached) Object.assign(seeded, cached)
    }
    savedStageKeys.delete(cacheKey)
    setValues(seeded)
    setError(''); setSaveError(''); setFieldErrors({})
    if (stepNumber === 2 || stepNumber === 4) {
      let active = true
      void (async () => {
        if (stepNumber === 2) {
          // Full editing (description, eligibility, ordering) needs migration
          // 019's columns. Until the owner applies it, fall back to the plain
          // loader and say so, instead of breaking category display.
          const extended = await loadEditableTournamentCategories(client, tournament.id)
          if (!active) return
          if (!extended.error) { setCategoriesExtended(true); setCategories(extended.data ?? []); return }
          const plain = await loadTournamentCategories(client, tournament.id)
          if (!active) return
          setCategoriesExtended(false)
          setCategories((plain.data ?? []).map(item => ({ ...item, description: null, eligibility_instructions: null, sort_order: null })))
          if (plain.error) setError(plain.error)
        } else {
          const result = await loadRegistrationQuestions(client, tournament.id)
          if (active) setQuestions(result.data ?? [])
          if (active && result.error) setError(result.error)
        }
      })()
      return () => { active = false }
    }
    return undefined
  }, [stepNumber, record, tournament.id, tournament.name, tournament.sport, client])

  const updateValue = (key: string, value: string) => {
    const next = { ...values, [key]: value }
    setValues(next)
    stageDraftCache.set(`${tournament.id}:${stepNumber}`, next)
    if (fieldErrors[key]) setFieldErrors(previous => { const copy = { ...previous }; delete copy[key]; return copy })
  }

  // Automatic transition housekeeping: scroll to the open stage's title and
  // move keyboard focus there, so keyboard and screen-reader users land on the
  // stage that just opened - not on a random screen position.
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return }
    headingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    headingRef.current?.focus()
  }, [stepNumber])

  // Validation failure: move the caret to the first field needing correction
  // and never open the next step.
  useEffect(() => {
    if (Object.keys(fieldErrors).length === 0 || saving) return
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (invalid) invalid.focus()
  }, [fieldErrors, saving])

  const stageLabel = SETUP_STEPS[stepNumber - 1]
  const fields = STAGE_FIELDS[stepNumber] ?? []

  const collectData = (): Record<string, unknown> => {
    const data: Record<string, unknown> = { ...record?.data }
    for (const field of fields) {
      const raw = values[field.key] ?? ''
      data[field.key] = field.type === 'number' ? (raw === '' ? undefined : Number(raw)) : raw
    }
    return data
  }

  // The stage returned to after saving: the next stage if this one was the
  // furthest opened, otherwise the furthest reached stage - editing an earlier
  // stage brings the organizer back to where they were working. The next stage
  // opens only after the database confirms this save succeeded.
  const destinationAfterSave = stepNumber >= reach ? Math.min(stepNumber + 1, SETUP_STEPS.length) : reach

  const advance = (message: string) => {
    savedStageKeys.add(`${tournament.id}:${stepNumber}`)
    stageDraftCache.delete(`${tournament.id}:${stepNumber}`)
    setError(''); setSaveError(''); setFieldErrors({})
    if (stepNumber >= reach) setReach(destinationAfterSave)
    onNotice(message)
    onChanged()
    if (destinationAfterSave !== stepNumber) onOpenTab('setup', destinationAfterSave)
  }

  const persist = async (status: SetupStepRecord['status'], data: Record<string, unknown>, options: { enforceValidation?: boolean } = {}) => saveSetupStep(client, tournament.id, user.id, stepNumber, status, data, options)

  const saveComplete = async () => {
    setSaving(true)
    const result = await persist('complete', { ...record?.data })
    setSaving(false)
    if (result.error) return setSaveError(result.error)
    advance('Step saved.')
  }

  // Explicit Set Later on the stages the specification allows deferring: the
  // wizard records a real deferred decision and moves on, and progress never
  // counts a deferred stage as complete.
  const saveDeferred = async () => {
    setSaving(true)
    const data = collectData()
    data.setLater = true
    const result = await persist('deferred', data)
    setSaving(false)
    if (result.error) return setSaveError(result.error)
    advance('Set later. The stage stays open for its decision.')
  }

  // Save & Exit stores the typed values as honestly unfinished (in_progress)
  // and returns to the tournament dashboard. Partial data is not promoted to a
  // completed step, and resume brings the organizer back to this stage.
  // Upload branding files only after the draft exists (it does - the
  // organizer reached setup through an existing draft). Upload new files,
  // update paths, then remove replaced objects only after success. Returns an
  // error message, or null when every selected file is stored.
  const saveBrandingFiles = async (): Promise<string | null> => {
    const selections: Array<{ asset: 'logo' | 'cover'; file: File | null; previous: string | null; clear: () => void }> = [
      { asset: 'logo', file: logoFile, previous: tournament.logo_path ?? null, clear: () => setLogoFile(null) },
      { asset: 'cover', file: coverFile, previous: tournament.cover_path ?? null, clear: () => setCoverFile(null) },
    ]
    for (const { asset, file, previous, clear } of selections) {
      if (!file) continue
      const label = asset === 'logo' ? 'Logo' : 'Cover'
      const problem = validateBrandingFile(asset, file)
      if (problem) return problem
      const uploaded = await uploadBrandingFile(client, tournament.organization_id, tournament.id, asset, file)
      if (uploaded.error || !uploaded.path) return `${label} upload failed: ${uploaded.error}`
      const update = await updateTournamentBranding(client, tournament.id, asset === 'logo' ? { logoPath: uploaded.path } : { coverPath: uploaded.path })
      if (update.error) return `${label} path save failed: ${update.error}`
      if (previous && previous !== uploaded.path) await removeBrandingFile(client, previous)
      clear()
    }
    setBrandingError('')
    return null
  }

  const saveExit = async () => {
    setSaving(true)
    if (stepNumber === 1) {
      const brandingProblem = await saveBrandingFiles()
      if (brandingProblem) { setSaving(false); return setBrandingError(brandingProblem) }
    }
    const data = collectData()
    const result = await persist('in_progress', data, { enforceValidation: false })
    setSaving(false)
    if (result.error) return setSaveError(result.error)
    savedStageKeys.add(`${tournament.id}:${stepNumber}`)
    stageDraftCache.delete(`${tournament.id}:${stepNumber}`)
    setFieldErrors({}); setSaveError(''); setError('')
    onNotice('Progress saved. Setup resumes at this stage.')
    onChanged()
    onOpenTab('overview')
  }

  const submitSave = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!canManage) { setError('Only organization owners and operations members can edit setup.'); return }
    setError(''); setSaveError(''); setFieldErrors({})
    const data = collectData()
    const validation = validateSetupStep(stepNumber, data)
    if (validation) {
      // Stay on this step and highlight the exact fields to correct.
      setFieldErrors(validateSetupStepFields(stepNumber, data))
      return setError(validation)
    }
    setSaving(true)
    // Stage 1 cannot create anything: the draft already exists (that is how the
    // organizer reached setup), so double-clicking can never duplicate a
    // tournament. Returning to an existing draft edits the same draft.
    if (stepNumber === 1) {
      const basics = await updateTournamentBasics(client, tournament.id, String(data.name), data.sport as Sport)
      if (basics.error) { setSaving(false); return setSaveError(basics.error) }
      const brandingProblem = await saveBrandingFiles()
      if (brandingProblem) { setSaving(false); return setBrandingError(brandingProblem) }
    }
    if (stepNumber === 3) {
      const method = data.method === 'open' || data.method === 'schedule' || data.method === 'manual_add' ? data.method : null
      // Saving settings never opens registration; the opening itself is a
      // separate confirmed action on the launch stage.
      if (method) {
        const settings: Record<string, unknown> = { application_method: method === 'manual_add' ? 'invite_only' : 'team_application' }
        if (method !== 'manual_add') {
          if (data.opensAt && String(data.opensAt).trim()) settings.opens_at = data.opensAt
          if (data.closesAt && String(data.closesAt).trim()) settings.closes_at = data.closesAt
          // Optional application cap, separate from the per-category approved
          // team limit (tournament_categories.team_limit).
          if (data.maxApplications !== undefined && data.maxApplications !== null && String(data.maxApplications).trim() !== '') settings.max_applications = data.maxApplications
        }
        const registration = await saveRegistrationSettings(client, tournament.id, user.id, settings)
        if (registration.error) { setSaving(false); return setSaveError(registration.error) }
      }
    }
    if (stepNumber === 5) {
      // Stage 5 writes the structured roster policy columns (migration 019):
      // deadline, officials cap, and submission timing. If 019 is not applied
      // yet the write surfaces the real column error instead of failing
      // silently - the wizard itself still records the stage values.
      const rosterSettings: Record<string, unknown> = {}
      if (data.rosterDeadline && String(data.rosterDeadline).trim()) rosterSettings.roster_deadline = data.rosterDeadline
      if (data.rosterOfficialCount !== undefined && data.rosterOfficialCount !== null && String(data.rosterOfficialCount).trim() !== '') rosterSettings.roster_officials_count = data.rosterOfficialCount
      if (data.rosterTiming === 'with_application' || data.rosterTiming === 'after_approval') rosterSettings.roster_submission_timing = data.rosterTiming
      if (Object.keys(rosterSettings).length > 0) {
        const roster = await saveRegistrationSettings(client, tournament.id, user.id, rosterSettings)
        if (roster.error) { setSaving(false); return setSaveError(roster.error) }
      }
    }
    delete data.setLater
    const result = await persist('complete', data)
    setSaving(false)
    if (result.error) return setSaveError(result.error)
    advance('Step saved.')
  }

  const addCategory = async () => {
    if (!categoryName.trim()) return setError('Enter a category name.')
    if (categories.some(item => item.name.trim().toLowerCase() === categoryName.trim().toLowerCase())) return setError('A category with this name already exists in this tournament.')
    const result = await addTournamentCategory(client, tournament.id, categoryName.trim())
    if (result.error) return setError(result.error)
    setCategoryName(''); onNotice('Category added.')
    await refreshCategories()
  }

  // Deletion guard backed by the real schema: matches references categories
  // with ON DELETE RESTRICT, so a category with recorded matches can never be
  // deleted; the loader reads the count first so the refusal shows the reason.
  // competition_stages cascade-delete with the category - hence the confirm.
  const removeCategory = async (id: string) => {
    setError('')
    const usage = await countCategoryMatches(client, id)
    if (usage.error) return setError(usage.error)
    if ((usage.data ?? 0) > 0) return setError('This category has recorded matches, so it cannot be deleted until those matches are resolved or moved.')
    const result = await client.from('tournament_categories').delete().eq('id', id)
    if (result.error) return setError(result.error.message)
    setRemovingCategory(null)
    onNotice('Category removed. Related records that already exist are never deleted silently.')
    await refreshCategories()
  }

  const beginEditCategory = (category: EditableTournamentCategory) => {
    setEditingCategory(category.id)
    setCategoryDraft({
      name: category.name,
      description: category.description ?? '',
      age_group: category.age_group ?? '',
      gender: category.gender ?? '',
      eligibility_instructions: category.eligibility_instructions ?? '',
      team_limit: category.team_limit === null ? '' : String(category.team_limit),
    })
  }

  // Stage 2 spec rules: a unique name, and age eligibility needs a clear
  // cutoff date - "Under-18" alone cannot be checked automatically, so the
  // cutoff goes into the eligibility instructions applicants also see.
  const saveCategoryEdit = async (category: EditableTournamentCategory) => {
    setError('')
    const name = categoryDraft.name.trim()
    if (!name) return setError('Category name is required.')
    if (categories.some(item => item.id !== category.id && item.name.trim().toLowerCase() === name.toLowerCase())) return setError('A category with this name already exists in this tournament.')
    if (!categoriesExtended) {
      const result = await updateTournamentCategory(client, category.id, { name })
      if (result.error) return setError(result.error)
      setEditingCategory(null); onNotice('Category updated.')
      await refreshCategories()
      return
    }
    if (categoryDraft.age_group.trim() && !categoryDraft.eligibility_instructions.trim()) return setError('Age eligibility needs a clear cutoff date in the eligibility instructions (e.g. "cutoff 31 Dec 2011 - born 2012 or later").')
    if (categoryDraft.age_group.trim() && !/\d/.test(categoryDraft.eligibility_instructions)) return setError('The eligibility instructions must state the cutoff date clearly, with a date such as 31 Dec 2011.')
    const patch: Record<string, unknown> = {
      name,
      description: categoryDraft.description.trim() || null,
      age_group: categoryDraft.age_group.trim() || null,
      gender: categoryDraft.gender.trim() || null,
      eligibility_instructions: categoryDraft.eligibility_instructions.trim() || null,
      team_limit: categoryDraft.team_limit.trim() === '' ? null : Number(categoryDraft.team_limit),
    }
    const result = await updateTournamentCategory(client, category.id, patch)
    if (result.error) return setError(result.error)
    setEditingCategory(null); onNotice('Category updated.')
    await refreshCategories()
  }

  // Display order for the applicants' category list: swap with the neighbour
  // and renumber so sort_order stays a clean 0..n sequence.
  const reorderCategory = async (category: EditableTournamentCategory, direction: -1 | 1) => {
    setError('')
    const index = categories.findIndex(item => item.id === category.id)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= categories.length) return
    const reordered = [...categories]
    ;[reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]]
    setCategories(reordered)
    for (let position = 0; position < reordered.length; position++) {
      const row = reordered[position]
      if (row.sort_order === position) continue
      const result = await updateTournamentCategory(client, row.id, { sort_order: position })
      if (result.error) return setError(`Reordering stopped: ${result.error}`)
    }
    await refreshCategories()
  }

  // Single reload path after every category write, so the list always matches
  // the database even when the extended columns are unavailable.
  const refreshCategories = async () => {
    const extended = await loadEditableTournamentCategories(client, tournament.id)
    if (!extended.error) { setCategoriesExtended(true); setCategories(extended.data ?? []); return }
    const plain = await loadTournamentCategories(client, tournament.id)
    setCategoriesExtended(false)
    setCategories((plain.data ?? []).map(item => ({ ...item, description: null, eligibility_instructions: null, sort_order: null })))
  }

  // Stage 4 question builder. The type list is exactly what the stored
  // response_type CHECK accepts ("file upload" is listed but disabled until
  // storage wiring exists — never offered as a working control).
  const questionFieldKey = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'question'
  const parseQuestionOptions = (raw: string) => raw.split(',').map(item => item.trim()).filter(Boolean)
  const typeLabel = (responseType: string) => ({ text: 'Short text', long_text: 'Long text', number: 'Number', select: 'Dropdown/choice', boolean: 'Checkbox', date: 'Date (after migration 019)' })[responseType] ?? responseType

  const addQuestion = async () => {
    if (!question.trim()) return setError('Enter the question label as teams will see it.')
    const result = await addRegistrationQuestion(client, tournament.id, questionFieldKey(question), question.trim(), questionRequired, {
      instructions: questionInstructions,
      responseType: questionType,
      options: questionType === 'select' && questionOptions.trim() ? parseQuestionOptions(questionOptions) : [],
    })
    if (result.error) return setError(result.error)
    setQuestion(''); setQuestionType('text'); setQuestionInstructions(''); setQuestionOptions(''); setQuestionRequired(true)
    onNotice('Registration question added.')
    const refreshed = await loadRegistrationQuestions(client, tournament.id)
    setQuestions(refreshed.data ?? [])
  }

  const beginEditQuestion = (item: RegistrationQuestion) => {
    setEditingQuestion(item.id)
    setQuestion(item.prompt)
    setQuestionType(item.response_type)
    setQuestionInstructions(item.instructions ?? '')
    setQuestionOptions(item.options.join(', '))
    setQuestionRequired(item.required)
  }

  const cancelEditQuestion = () => {
    setEditingQuestion(null); setQuestion(''); setQuestionType('text'); setQuestionInstructions(''); setQuestionOptions(''); setQuestionRequired(true)
  }

  const saveEditedQuestion = async () => {
    if (!editingQuestion || !question.trim()) return
    const result = await updateRegistrationQuestion(client, editingQuestion, {
      prompt: question.trim(),
      instructions: questionInstructions.trim() || null,
      required: questionRequired,
      response_type: questionType,
      options: questionType === 'select' ? parseQuestionOptions(questionOptions) : [],
    })
    if (result.error) return setError(result.error)
    cancelEditQuestion()
    onNotice('Registration question updated.')
    const refreshed = await loadRegistrationQuestions(client, tournament.id)
    setQuestions(refreshed.data ?? [])
  }

  const removeQuestion = async (id: string) => {
    setError('')
    const result = await deleteRegistrationQuestion(client, id)
    if (result.error) return setError(result.error)
    setRemovingQuestion(null)
    onNotice('Registration question removed. Answers already collected for it are removed by the database link, never silently.')
    const refreshed = await loadRegistrationQuestions(client, tournament.id)
    setQuestions(refreshed.data ?? [])
  }

  // Launch actions. Publishing never publishes fixtures and never opens or
  // schedules registration; registration is its own confirmed, separate action.
  const publish = async (openRegistration: boolean) => {
    setError(''); setConfirmAction(null)
    const result = await publishTournament(client, tournament.id, openRegistration)
    if (result.error) return setError(result.error)
    // Publishing completes the review stage, otherwise setup would stay
    // reported as unfinished forever.
    await saveSetupStep(client, tournament.id, user.id, 9, 'complete', { ...record?.data })
    setPublished(true)
    onNotice('Tournament page published. Teams can now see the approved public information.')
    onChanged()
  }

  const openRegistrationAction = async () => {
    setConfirmAction(null)
    const result = await setTournamentStatus(client, tournament.id, 'registration_open')
    if (result.error) return setSaveError(result.error)
    onNotice('Registration opened. Real applications are accepted from now on.')
    onChanged()
  }

  const completedSteps: Array<{ number: number; label: string }> = []
  SETUP_STEPS.forEach((label, index) => {
    const number = index + 1
    const status = progress.statuses[index]
    if (status === 'complete' && number !== stepNumber) completedSteps.push({ number, label: String(label) })
  })

  // Stage 9 review: one truthful state per stage plus separate readiness
  // indicators - no single percentage stands in for unrelated workflows.
  const stageStates = SETUP_STEPS.map((label, index) => {
    const number = index + 1
    const status = progress.statuses[index]
    const state = status === 'complete' ? 'Completed' : status === 'deferred' ? 'Set later' : ['blocked', 'needs_review'].includes(status) ? 'Needs attention' : number === progress.currentStep ? 'Current step' : 'Incomplete'
    return { number, label: String(label), state }
  })
  const stage3Record = steps.find(item => item.step_number === 3)
  const opensAt = stage3Record && typeof stage3Record.data.opensAt === 'string' && stage3Record.data.opensAt ? new Date(stage3Record.data.opensAt) : null
  const registrationIsScheduled = Boolean(opensAt && opensAt.getTime() > Date.now() && tournament.status !== 'registration_open')
  const readiness: Array<{ label: string; state: string; ok: boolean }> = [
    { label: 'Public tournament page', state: tournament.is_published ? 'Published' : 'Not published yet', ok: tournament.is_published },
    { label: 'Registration', state: progress.statuses[2] === 'complete' && ['complete', 'deferred'].includes(progress.statuses[3]) ? 'Configured' : 'Not configured', ok: progress.statuses[2] === 'complete' && ['complete', 'deferred'].includes(progress.statuses[3]) },
    { label: 'Competition planning', state: ['complete', 'deferred'].includes(progress.statuses[5]) && ['complete', 'deferred'].includes(progress.statuses[6]) ? 'Planned' : 'Not planned', ok: ['complete', 'deferred'].includes(progress.statuses[5]) && ['complete', 'deferred'].includes(progress.statuses[6]) },
    { label: 'Roster collection', state: ['complete', 'deferred'].includes(progress.statuses[4]) ? 'Requirements set' : 'No requirements yet', ok: ['complete', 'deferred'].includes(progress.statuses[4]) },
    { label: 'Scheduling', state: ['complete', 'deferred'].includes(progress.statuses[7]) ? 'Planned' : 'Not planned', ok: ['complete', 'deferred'].includes(progress.statuses[7]) },
  ]
  const registrationReadyForOpen = progress.statuses[2] === 'complete' && progress.statuses[3] === 'complete' && progress.statuses[4] === 'complete'

  const copyPublicLink = async () => {
    const url = `${window.location.origin}/#tournament/${encodeURIComponent(tournament.slug)}`
    try {
      await navigator.clipboard.writeText(url)
      onNotice('Registration link copied to the clipboard.')
    } catch {
      setError(url)
    }
  }

  const renderField = (field: StageField) => {
    if (field.type === 'select') {
      if (field.key === 'method') {
        return <label key={field.key}>{field.label}
          <select value={values[field.key] ?? ''} onChange={event => updateValue(field.key, event.target.value)}>
            <option value="">Select…</option>
            <option value="open">A. Open registration — I choose a closing date</option>
            <option value="schedule">B. Schedule registration — I choose opening and closing</option>
            <option value="manual_add">C. Add teams myself — no public registration</option>
          </select>
        </label>
      }
      return <label key={field.key}>{field.label}
        <select value={values[field.key] ?? ''} onChange={event => updateValue(field.key, event.target.value)}>
          <option value="">Select…</option>
          {field.options?.map(option => <option value={option} key={option}>{field.key === 'sport' ? sportLabel(option) : option.replace(/_/g, ' ')}</option>)}
        </select>
      </label>
    }
    return <label key={field.key}>{field.label}
      <input
        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text'}
        value={values[field.key] ?? ''}
        list={field.key === 'venue' ? 'kv-venues' : undefined}
        onChange={event => updateValue(field.key, event.target.value)}
        aria-invalid={fieldErrors[field.key] ? true : undefined}
      />
      {field.hint ? <span className="field-hint-plain">{field.hint}</span> : null}
      {fieldErrors[field.key] ? <span className="field-error" role="alert">{fieldErrors[field.key]}</span> : null}
    </label>
  }

  return <div className="tab-panel">
    <ol className="stage-list" aria-label="Setup stages">{SETUP_STEPS.map((label, index) => {
      const number = index + 1
      const state = stepperState(number, progress.statuses[index], progress.currentStep)
      const locked = number > reach
      const stateLabel = state === 'complete' ? 'Complete' : state === 'current' ? 'Current' : state === 'attention' ? 'Needs review' : state === 'later' ? 'Set later' : 'Upcoming'
      return <li key={label}>
        <button type="button"
          className={`stage-item${number === stepNumber ? ' active' : ''} stage-${state}`}
          onClick={() => onOpenTab('setup', number)}
          aria-current={number === stepNumber ? 'step' : undefined}
          disabled={locked}
        >
          <span className="stage-number">{state === 'complete' ? <Check size={13} /> : number}</span>
          <span className="stage-label">{label}</span>
          <span className={`stage-state${state === 'attention' ? ' warn' : ''}`}>{stateLabel}</span>
          {locked ? <span className="sr-only"> - opens when earlier stages are decided</span> : null}
        </button>
      </li>
    })}</ol>

    {/* Completed stages appear only as compact summaries; the single active
        form is at the bottom, so no one scrolls through old forms. */}
    {completedSteps.length > 0 ? <section className="completed-steps" aria-label="Completed stages">
      {completedSteps.map(item => <div className="completed-step" key={item.number}>
        <span className="completed-check"><Check size={14} aria-hidden="true" /></span>
        <div>
          <strong>Step {item.number}: {item.label} — Complete</strong>
          <p>{STAGE_SUMMARIES[item.number]}</p>
        </div>
        <button type="button" className="quiet-button" onClick={() => onOpenTab('setup', item.number)}>Edit</button>
      </div>)}
    </section> : null}

    <div className="stage-form" ref={formRef}><h3 ref={headingRef} tabIndex={-1}>Stage {stepNumber} — {stageLabel}</h3>
      <p className="field-hint">{stepNumber === 2
        ? 'Categories are real records the rest of the setup and the draw read. Each category later gets its own teams, applications, format, fixtures, standings, and winner.'
        : stepNumber === 3
          ? 'Maldives time (Indian/Maldives — UTC+5) applies unless another timezone is typed. Saving settings never opens registration by itself.'
          : stepNumber === 4
            ? 'The form is ready-made: standard fields come from the team record, and you add only questions teams do not already answer. Preview shows exactly what teams will see.'
            : stepNumber === 5
              ? 'Roster limits are suggested for the sport - change them freely. The deadline, officials cap, and submission timing save with the form; approval and locking switches, required documents, and identity checks need the roster workflow and stay out until it exists.'
              : stepNumber === 9
                ? 'Publication, registration, and scheduling remain separate actions. Nothing in this wizard happens automatically.'
                : 'Values are stored on this stage. Save & Continue is the only control that progresses the wizard.'}</p>

      {stepNumber === 2 ? <div>
        {!categoriesExtended ? <p className="field-hint-plain">Full editing - description, eligibility instructions, display order, and per-category team caps - activates after migration 019 is applied. Until then only names can be changed.</p> : null}
        {categories.length === 0
          ? <p className="empty-note">Will this tournament have one category or multiple categories? Create the first category: the suggestion for a single-category tournament is Open, and adding several divisions makes it multi-category.</p>
            : <p className="field-hint-plain">{categories.length === 1
              ? 'Single category: applicants will not be asked to pick one, because this is the only choice. Add another category to make this a multi-category tournament.'
              : `Multiple categories: ${categories.length} in display order. Each category keeps its own teams, applications, fixtures, standings, and winner.`}</p>}
        <label className="search-bar"><span className="sr-only">New category name</span><input value={categoryName} onChange={event => setCategoryName(event.target.value)} placeholder="e.g. Open, Senior Men, Under-18, School division" /></label>
        <div className="button-row"><button type="button" className="outline-button dark" onClick={() => void addCategory()} disabled={!canManage}><Plus size={14} /> Add category</button>{categories.length === 0 ? <button type="button" className="quiet-button" onClick={() => setCategoryName('Open')} disabled={!canManage}>Use the suggested single category — Open</button> : null}</div>
        {categories.length === 0 ? null
          : <ul className="category-list">{categories.map((category, index) => <li key={category.id}>
              {editingCategory === category.id ? <div className="category-edit">
                <label>Name<input value={categoryDraft.name} onChange={event => setCategoryDraft({ ...categoryDraft, name: event.target.value })} /></label>
                {categoriesExtended ? <>
                  <label>Optional description<input value={categoryDraft.description} onChange={event => setCategoryDraft({ ...categoryDraft, description: event.target.value })} placeholder="e.g. Open to all registered clubs" /></label>
                  <div className="two-col">
                    <label>Age eligibility (optional)<input value={categoryDraft.age_group} onChange={event => setCategoryDraft({ ...categoryDraft, age_group: event.target.value })} placeholder="e.g. Under-18" /></label>
                    <label>Maximum approved teams (optional)<input type="number" min={1} value={categoryDraft.team_limit} onChange={event => setCategoryDraft({ ...categoryDraft, team_limit: event.target.value })} placeholder="e.g. 12" /></label>
                  </div>
                  <label>Gender or division eligibility (optional)<select value={['', 'Men', 'Women', 'Mixed'].includes(categoryDraft.gender) ? categoryDraft.gender : `__keep__${categoryDraft.gender}`} onChange={event => setCategoryDraft({ ...categoryDraft, gender: event.target.value.startsWith('__keep__') ? event.target.value.slice(8) : event.target.value })}>
                    <option value="">No limit</option>
                    <option value="Men">Men</option>
                    <option value="Women">Women</option>
                    <option value="Mixed">Mixed</option>
                    {!['', 'Men', 'Women', 'Mixed'].includes(categoryDraft.gender) ? <option value={`__keep__${categoryDraft.gender}`}>Keep current value ({categoryDraft.gender})</option> : null}
                  </select></label>
                  <label>Eligibility instructions (required when age eligibility is set)<input value={categoryDraft.eligibility_instructions} onChange={event => setCategoryDraft({ ...categoryDraft, eligibility_instructions: event.target.value })} placeholder="e.g. Cutoff 31 Dec 2011 - born 2012 or later" /></label>
                </> : null}
                <div className="button-row">
                  <button type="button" className="primary-button" onClick={() => void saveCategoryEdit(category)} disabled={!canManage}>Save category</button>
                  <button type="button" className="outline-button dark" onClick={() => { setEditingCategory(null); setCategoryDraft({ name: '', description: '', age_group: '', gender: '', eligibility_instructions: '', team_limit: '' }) }}>Cancel</button>
                </div>
              </div>
                : <div className="category-row">
                  <div><strong>{category.name}</strong><span className="category-meta">{[
                    category.age_group,
                    category.gender,
                    category.team_limit !== null ? `max ${category.team_limit} teams` : null,
                    category.description,
                  ].filter(Boolean).join(' · ') || 'No limits set'}</span>
                    {category.eligibility_instructions ? <span className="category-meta">Eligibility: {category.eligibility_instructions}</span> : null}
                  </div>
                  {removingCategory === category.id
                    ? <span className="confirm-group"><span>Remove this category? Its format stages are removed with it; recorded matches block deletion.</span><button type="button" className="primary-button" onClick={() => void removeCategory(category.id)}>Yes</button><button type="button" className="outline-button dark" onClick={() => setRemovingCategory(null)}>Cancel</button></span>
                    : <span className="button-row compact">
                      {categoriesExtended && index > 0 ? <button type="button" className="quiet-button" onClick={() => void reorderCategory(category, -1)} aria-label={`Move ${category.name} up`} disabled={!canManage}>↑</button> : null}
                      {categoriesExtended && index < categories.length - 1 ? <button type="button" className="quiet-button" onClick={() => void reorderCategory(category, 1)} aria-label={`Move ${category.name} down`} disabled={!canManage}>↓</button> : null}
                      <button type="button" className="quiet-button" onClick={() => beginEditCategory(category)} disabled={!canManage}>Edit</button>
                      <button type="button" className="quiet-button" onClick={() => setRemovingCategory(category.id)} disabled={!canManage}>Remove</button>
                    </span>}
                </div>}
            </li>)}</ul>}
        <div className="button-row stage-actions"><button className="outline-button dark" type="button" disabled={saving || !canManage} onClick={() => onOpenTab('setup', stepNumber - 1)}>Back</button><button type="button" className="outline-button dark" disabled={saving || !canManage} onClick={() => void saveExit()}>Save &amp; Exit</button><button type="button" className="primary-button" disabled={saving || !canManage} onClick={() => void saveComplete()}>{saving ? 'Saving…' : saveError ? 'Retry Save' : 'Save & Continue'} <ArrowRight size={15} /></button></div>
      </div>
      : stepNumber === 4 ? <div>
        <h4 className="ov-subheading">Ready-made standard fields</h4>
        <p className="field-hint-plain">These do not need to be built — the application form reads them from the team's existing Kulhivaru+ record:</p>
        <ul className="standard-fields">{REGISTRATION_STANDARD_FIELDS.map(field => <li key={field.label}>
          <strong>{field.label}{field.optional ? <span className="optional-tag"> optional</span> : null}</strong>
          <span>{field.source}</span>
        </li>)}</ul>

        <h4 className="ov-subheading">Additional questions</h4>
        {questions.length === 0 && !editingQuestion ? <p className="empty-note">No additional questions yet. Add any question the standard fields do not cover.</p>
          : <ul className="category-list">{questions.map(item => <li key={item.id}>
              {editingQuestion === item.id ? null : <div>
                <strong>{item.prompt}{item.required ? <span className="required-tag" title="Required"> *required</span> : <span className="optional-tag"> optional</span>}</strong>
                <span className="category-meta">{typeLabel(item.response_type)}{item.instructions ? ` — ${item.instructions}` : ''}{item.options.length ? ` — choices: ${item.options.join(', ')}` : ''}</span>
              </div>}
              {removingQuestion === item.id
                ? <span className="confirm-group"><span>Remove this question?</span><button type="button" className="primary-button" onClick={() => void removeQuestion(item.id)}>Yes</button><button type="button" className="outline-button dark" onClick={() => setRemovingQuestion(null)}>Cancel</button></span>
                : editingQuestion === item.id || removingQuestion === item.id ? null
                  : <span className="button-row compact"><button type="button" className="quiet-button" onClick={() => beginEditQuestion(item)} disabled={!canManage}>Edit</button><button type="button" className="quiet-button" onClick={() => setRemovingQuestion(item.id)} disabled={!canManage}>Remove</button></span>}
            </li>)}</ul>}

        {editingQuestion ? <h4 className="ov-subheading">{saving ? 'Editing question' : `Edit: ${question}`}</h4> : null}
        <div className="question-builder">
          <label>Question label<input value={question} onChange={event => setQuestion(event.target.value)} placeholder="e.g. Preferred contact method" /></label>
          <div className="two-col">
            <label>Field type<select value={questionType} onChange={event => setQuestionType(event.target.value)} disabled={!canManage}>
              <option value="text">Short text (e.g. club registration number)</option>
              <option value="long_text">Long text (e.g. additional information)</option>
              <option value="number">Number (e.g. participating members)</option>
              <option value="select">Dropdown or multiple choice (choose options below)</option>
              <option value="boolean">Checkbox (e.g. agreement to tournament rules)</option>
              <option value="date">Date (needs migration 019)</option>
              <option value="file" disabled>File upload (needs storage setup — not available yet)</option>
            </select></label>
            <label>Required<select value={questionRequired ? 'required' : 'optional'} onChange={event => setQuestionRequired(event.target.value === 'required')} disabled={!canManage}>
              <option value="required">Required</option>
              <option value="optional">Optional</option>
            </select></label>
          </div>
          <label>Instructions / help text (shown beside the field to teams)<input value={questionInstructions} onChange={event => setQuestionInstructions(event.target.value)} placeholder="e.g. Enter your school or institution name, or leave blank if not applicable" /></label>
          {questionType === 'select' ? <label>Choice options, comma separated<input value={questionOptions} onChange={event => setQuestionOptions(event.target.value)} placeholder="Phone, Email, Viber, WhatsApp" /></label> : null}
          <div className="button-row">
            {editingQuestion
              ? <><button type="button" className="outline-button dark" onClick={() => void saveEditedQuestion()} disabled={saving || !canManage}>Save edits</button><button type="button" className="outline-button dark" onClick={cancelEditQuestion}>Cancel editing</button></>
              : <button type="button" className="outline-button dark" onClick={() => void addQuestion()} disabled={!canManage}><Plus size={14} /> Add Field</button>}
          </div>
        </div>

        <h4 className="ov-subheading">Preview Form</h4>
        <p className="field-hint-plain">Exactly what teams fill in. Nothing entered here is submitted anywhere.</p>
        <div className="preview-form" aria-label="Registration form preview">
          <div className="preview-block"><p className="preview-title">Team details (from your team record)</p>
            {REGISTRATION_STANDARD_FIELDS.map(field => <dl key={field.label}><dt>{field.label}{field.optional ? '' : ' *'}</dt><dd className="preview-muted">filled automatically from {field.source}</dd></dl>)}
          </div>
          {registrationFormFields(questions).length > 0 ? <div className="preview-block"><p className="preview-title">Additional questions</p>
            {registrationFormFields(questions).map(field => <div key={field.key} className="preview-field">
              <label>{field.label}{field.required ? ' *' : ''}
                {field.kind === 'long_text' ? <textarea disabled /> :
                  field.kind === 'number' ? <input type="number" disabled /> :
                    field.kind === 'select' ? <select disabled>{field.options.length ? field.options.map(option => <option key={option}>{option}</option>) : <option>Choice list</option>}</select> :
                      field.kind === 'checkbox' ? <input type="checkbox" disabled /> :
                        field.kind === 'date' ? <input type="date" disabled /> :
                          <input type="text" disabled />}
              </label>
              {field.instructions ? <p className="field-hint-plain">{field.instructions}</p> : null}
            </div>)}
          </div> : null}
        </div>
        <p className="field-hint">No registration fee is configured in Finance right now, so the form shows no fee section. If a fee is added in Finance later, this preview displays the amount in MVR and the payment instructions automatically.</p>

        <div className="button-row wrap">
          <button type="button" className="outline-button dark" onClick={() => void copyPublicLink()} disabled={!canManage}>Copy Registration Link</button>
        </div>
        <p className="field-hint-plain">The stable link is this tournament's public page: teams visit it and see the correct registration status (not open yet, open, closed, or unavailable) once the public registration page work arrives — recorded as a gap until then.</p>

        <div className="button-row stage-actions">
          <button className="outline-button dark" type="button" disabled={saving || !canManage} onClick={() => onOpenTab('setup', stepNumber - 1)}>Back</button>
          <button className="outline-button dark" type="button" disabled={saving || !canManage} onClick={() => void saveExit()}>Save &amp; Exit</button>
          <button type="button" className="primary-button" disabled={saving || !canManage} onClick={() => void saveComplete()}>{saving ? 'Saving…' : saveError ? 'Retry Save' : 'Save & Continue'} <ArrowRight size={15} /></button>
        </div>
      </div>
      : stepNumber === 9 ? <div>
        <table className="ov-table stage-review-table"><thead><tr><th scope="col">Stage</th><th scope="col">State</th><th scope="col">Actions</th></tr></thead><tbody>
          {stageStates.filter(item => item.number < 9).map(item => <tr key={item.number}>
            <td>Step {item.number}: {item.label}</td>
            <td><span className={`status-pill status-${item.state === 'Completed' || item.state === 'Set later' ? 'ok' : 'warn'}`}>{item.state}</span></td>
            <td><button type="button" className="quiet-button" disabled={item.number > reach} onClick={() => onOpenTab('setup', item.number)}>Edit</button></td>
          </tr>)}
        </tbody></table>
        <dl className="readiness-grid">
          {readiness.map(item => <div key={item.label} className={item.ok ? 'is-ready' : 'is-pending'}><dt>{item.label}</dt><dd>{item.state}</dd></div>)}
        </dl>
        {tournament.status === 'registration_open' ? <p className="status-pill status-ok">Registration already open</p>
          : registrationIsScheduled ? <p className="status-pill status-neutral">Registration scheduled for {formatWorkspaceDate(String((opensAt as Date).toISOString()))}</p> : null}
        <div className="button-row wrap stage-launch">
          {!published && !tournament.is_published
            ? confirmAction === 'publish'
              ? <span className="confirm-group"><span>Publish the public tournament page now?</span><button type="button" className="primary-button" disabled={saving} onClick={() => void publish(false)}>Yes, publish</button><button type="button" className="outline-button dark" onClick={() => setConfirmAction(null)}>Cancel</button></span>
              : <button type="button" className="primary-button" disabled={saving || !canManage} onClick={() => setConfirmAction('publish')}>Publish Tournament Page</button>
            : null}
          {confirmAction === 'open-registration'
            ? <span className="confirm-group"><span>Open registration and accept real applications?</span><button type="button" className="primary-button" disabled={saving || !registrationReadyForOpen} onClick={() => void openRegistrationAction()}>Yes, open</button><button type="button" className="outline-button dark" onClick={() => setConfirmAction(null)}>Cancel</button></span>
            : <button type="button" className="outline-button dark" disabled={!registrationReadyForOpen || !canManage} onClick={() => setConfirmAction('open-registration')} title={registrationReadyForOpen ? undefined : 'Registration, form and roster stages must be complete first'}>Open Registration</button>}
          <button type="button" className="outline-button dark" disabled={!canManage} onClick={() => void copyPublicLink()}>Copy Registration Link</button>
          {confirmAction === 'draft'
            ? <span className="confirm-group"><span>Keep this tournament as a private draft and open its management dashboard?</span><button type="button" className="outline-button dark" onClick={() => { setConfirmAction(null); onOpenTab('overview') }}>Yes</button><button type="button" className="outline-button dark" onClick={() => setConfirmAction(null)}>Cancel</button></span>
            : <button type="button" className="outline-button dark" disabled={!canManage} onClick={() => setConfirmAction('draft')}>Keep as Draft</button>}
        </div>
        <p className="field-hint">Publishing does not publish fixtures and does not open registration. Opening registration requires registration, the form, and roster requirements to be complete, and always asks for confirmation.</p>
      </div>
      : fields.length > 0 ? <form className="creator-form" onSubmit={event => void submitSave(event)}>
        {fields.map(renderField)}
        {stepNumber === 1 ? <div className="branding-uploads">
          <h4>Tournament branding (optional)</h4>
          <p className="field-hint-plain">Square logo (PNG/JPG/WebP, max 2 MB) and wide cover (PNG/JPG/WebP, max 5 MB). Uploads happen on Save; previews are local until then.</p>
          {brandingError ? <div className="form-error" role="alert">{brandingError}</div> : null}
          <div className="upload-card">
            <label>Cover (16:9, recommended 1600×900)
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
                const file = event.target.files?.[0] ?? null
                if (!file) { setCoverFile(null); return }
                const problem = validateBrandingFile('cover', file)
                if (problem) { setBrandingError(problem); setCoverFile(null); return }
                setBrandingError(''); setCoverFile(file)
              }} />
            </label>
            {coverFile ? <small>Selected: {coverFile.name} ({Math.round(coverFile.size / 1024)} KB)</small> : (tournament.cover_path ? <span className="branding-preview"><span className="branding-preview-cover"><TournamentCover client={client} path={tournament.cover_path} name={tournament.name} sport={tournament.sport} /></span><small>Saved cover</small></span> : <small>No cover yet — sport artwork fallback will be used.</small>)}
          </div>
          <div className="upload-card">
            <label>Logo (1:1, recommended 512×512)
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
                const file = event.target.files?.[0] ?? null
                if (!file) { setLogoFile(null); return }
                const problem = validateBrandingFile('logo', file)
                if (problem) { setBrandingError(problem); setLogoFile(null); return }
                setBrandingError(''); setLogoFile(file)
              }} />
            </label>
            {logoFile ? <small>Selected: {logoFile.name} ({Math.round(logoFile.size / 1024)} KB)</small> : (tournament.logo_path ? <span className="branding-preview"><TournamentLogo client={client} path={tournament.logo_path} name={tournament.name} className="branding-preview-logo" /><small>Saved logo</small></span> : <small>No logo yet — initials fallback will be used.</small>)}
          </div>
        </div> : null}
        <div className="button-row stage-actions">
          <button className="outline-button dark" type="button" disabled={saving || !canManage} onClick={() => onOpenTab('setup', stepNumber - 1)}>Back</button>
          <button className="outline-button dark" type="button" disabled={saving || !canManage} onClick={() => void saveExit()}>Save &amp; Exit</button>
          <button className="primary-button" type="submit" disabled={saving || !canManage}>{saving ? 'Saving…' : saveError ? 'Retry Save' : 'Save & Continue'} <ArrowRight size={15} /></button>
          {stepNumber === 6 || stepNumber === 8 ? <button className="outline-button dark" type="button" disabled={saving || !canManage} onClick={() => void saveDeferred()}>Set later</button> : null}
        </div>
      </form> : null}

      {/* Registration readiness banner (spec section 7): once Steps 1-5 are
          valid, Open/Schedule/Copy remain reachable in every later stage, with
          their existing states shown honestly. It never auto-fires anything. */}
      {stepNumber >= 6 && stepNumber <= 8 ? <div className="reg-readiness-banner">
        <div className="stage-registration-banner">
          {tournament.status === 'registration_open'
            ? <p className="status-pill status-ok">Registration already open</p>
            : registrationIsScheduled
              ? <p className="status-pill status-neutral">Registration scheduled for {formatWorkspaceDate(String((opensAt as Date).toISOString()))}</p>
              : registrationReadyForOpen
                ? <p className="field-hint-plain">Steps 1–5 are complete, so registration can be opened while planning continues.</p>
                : <p className="field-hint-plain">Registration actions become available when Steps 3–5 (Registration, Form, Roster requirements) are complete.</p>}
          {tournament.status !== 'registration_open' && registrationReadyForOpen ? <div className="button-row compact wrap">
            {confirmAction === 'open-registration'
              ? <span className="confirm-group"><span>Open registration and accept real applications?</span><button type="button" className="primary-button" disabled={saving} onClick={() => void openRegistrationAction()}>Yes, open</button><button type="button" className="outline-button dark" onClick={() => setConfirmAction(null)}>Cancel</button></span>
              : <button type="button" className="outline-button dark" onClick={() => setConfirmAction('open-registration')}>Open Registration</button>}
            <button type="button" className="outline-button dark" onClick={() => void copyPublicLink()}>Copy Registration Link</button>
          </div> : null}
        </div>
      </div> : null}

      {error && error.startsWith('http') ? <p className="field-hint"><code>{error}</code></p> : error ? <div className="form-error" role="alert">{error}</div> : null}
      {saveError ? <div className="form-error" role="alert">{saveError} <button type="button" className="quiet-button" onClick={() => void submitSave()}><RefreshCw size={13} aria-hidden="true" /> Retry</button></div> : null}
      {stepNumber < reach ? <p className="field-hint"><button type="button" className="quiet-button" onClick={() => onOpenTab('setup', reach)}>Cancel editing — back to Stage {reach}</button></p> : null}
    </div>
  </div>
}

function TeamsTab({ client, user, tournament, entries, canManage, onNotice, onChanged }: { client: SupabaseClient; user: User; tournament: OrganizerTournament; entries: TournamentEntry[]; canManage: boolean; onNotice: (message: string) => void; onChanged: () => void }) {
  const [query, setQuery] = useState(''); const [teams, setTeams] = useState<SearchableTeam[]>([]); const [searching, setSearching] = useState(false); const [searched, setSearched] = useState(false)
  const [error, setError] = useState(''); const [busy, setBusy] = useState<string | null>(null)
  const [teamLogos, setTeamLogos] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!entries.length) return
    let active = true
    const ids = entries.map(e => e.team_id)
    void client.from('teams').select('id,logo_url').in('id', ids).then(({ data }) => {
      if (!active) return
      const map: Record<string, string> = {}
      for (const row of (data ?? []) as Array<{ id: string; logo_url: string | null }>) if (row.logo_url) map[row.id] = row.logo_url
      setTeamLogos(map)
    })
    return () => { active = false }
  }, [client, entries])
  const entered = useMemo(() => new Set(entries.map(entry => entry.team_id)), [entries])
  // Organizers can also create a team that is not in Kulhivaru+ yet and enter it in one step.
  const [newTeam, setNewTeam] = useState<{ name: string; island: string; teamType: string } | null>(null)
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const createAndEnter = async (event: FormEvent) => {
    event.preventDefault(); if (!newTeam) return
    if (newTeam.name.trim().length < 2) return setError('Enter the team name.')
    setBusy('new-team'); setError('')
    const created = await createTeam(client, user.id, newTeam.name, newTeam.island, newTeam.teamType)
    if (created.error || !created.data) { setBusy(null); return setError(created.error ?? 'The team could not be created.') }
    const entry = await addOrganizerEntry(client, tournament.id, created.data.id, user.id)
    setBusy(null)
    if (entry.error) return setError(`The team was created but not entered: ${entry.error}`)
    setNewTeam(null); onNotice(`${newTeam.name.trim()} was created and entered. Add its players below.`); onChanged()
  }

  const search = async (event: FormEvent) => { event.preventDefault(); setError(''); setSearching(true); const result = await searchExistingTeams(client, query); setSearching(false); setTeams(result.data ?? []); setSearched(true); if (result.error) setError(result.error) }
  const addEntry = async (teamId: string) => {
    setBusy(teamId); setError('')
    const result = await addOrganizerEntry(client, tournament.id, teamId, user.id)
    setBusy(null)
    if (result.error) return setError(result.error)
    onNotice('Team added directly and recorded as approved.')
    onChanged()
  }
  const reviewRoster = async (entry: TournamentEntry, decision: 'approved' | 'locked' | 'changes_requested' | 'rejected') => {
    setBusy(entry.id); setError('')
    const latest = await loadLatestRosterSubmission(client, entry.id)
    if (latest.error) { setBusy(null); return setError(latest.error) }
    if (!latest.data) { setBusy(null); return setError('This team has not submitted a roster yet.') }
    const result = await reviewRosterSubmission(client, latest.data.id, decision, `Roster ${decision} in the organizer workspace`, user.id)
    if (result.error) { setBusy(null); return setError(result.error) }
    const status: RosterStatus = decision === 'locked' ? 'locked' : decision
    const entryResult = await setEntryRosterStatus(client, entry.id, status)
    setBusy(null)
    if (entryResult.error) return setError(entryResult.error)
    onNotice(`Roster ${decision}.`)
    onChanged()
  }

  return <div className="tab-panel">
    <p className="field-hint">Search for an existing team and link it instead of creating a duplicate. Roster review and locking are separate from the application decision.</p>
    <form className="search-bar" onSubmit={search}><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search published teams or teams you manage" aria-label="Search teams" /><button type="submit" className="outline-button dark" disabled={searching}>{searching ? 'Searching…' : 'Add existing team'}</button></form>
    {sanitizeSearchTerm(query).length >= 2 && <p className="field-hint">Search matches published teams plus teams you manage, which is all this account can read.</p>}
    {canManage && (newTeam ? <form className="panel-block form-grid" onSubmit={createAndEnter}>
      <label>New team name<input value={newTeam.name} onChange={event => setNewTeam({ ...newTeam, name: event.target.value })} /></label>
      <label>Island<input value={newTeam.island} list="kv-islands" onChange={event => setNewTeam({ ...newTeam, island: event.target.value })} /></label>
      <label>Team type<select value={newTeam.teamType} onChange={event => setNewTeam({ ...newTeam, teamType: event.target.value })}><option value="club">Club</option><option value="island">Island</option><option value="atoll">Atoll</option><option value="school">School</option><option value="community">Community</option><option value="corporate">Corporate</option><option value="other">Other</option></select></label>
      <div className="button-row"><button type="submit" className="primary-button" disabled={busy === 'new-team'}>{busy === 'new-team' ? 'Creating…' : 'Create and enter team'}</button><button type="button" className="outline-button dark" onClick={() => setNewTeam(null)}>Cancel</button></div>
      <p className="field-hint">Search first so the same team is never created twice. You manage this team until you invite its manager and transfer ownership in its Team Workspace.</p>
    </form> : <button type="button" className="outline-button dark" onClick={() => setNewTeam({ name: query.trim(), island: '', teamType: 'club' })}>Create a new team</button>)}
    {error && <div className="form-error" role="alert">{error}</div>}
    {searched && teams.length === 0 ? <p className="empty-note">No readable teams match that search. Use Create a new team above.</p>
      : teams.filter(team => !entered.has(team.id)).map(team => <div className="result-row" key={team.id}><div><strong>{team.name}</strong><span>{team.island ?? 'Island not recorded'}</span></div>{busy === team.id ? <Loader2 className="spin" size={15} /> : canManage && <button type="button" className="outline-button dark" onClick={() => void addEntry(team.id)}>Add to tournament</button>}</div>)}

    <h3 className="subhead">Entered teams</h3>
    {entries.length === 0 ? <p className="empty-note">No teams are entered in this tournament yet.</p>
      : entries.map(entry => <div className="entry-row" key={entry.id}>
        <div className="entry-team"><span className="entry-team-logo">{teamLogos[entry.team_id] ? <img src={teamLogos[entry.team_id]} alt="" /> : <span>{(entry.team_name ?? 'T').trim().slice(0, 2).toUpperCase()}</span>}</span><div><strong>{entry.team_name ?? 'Team record'}</strong><span>Roster: {rosterStatusLabel(entry.roster_status)}{entry.latest_roster_version ? ` (version ${entry.latest_roster_version})` : ''}</span></div></div>
        <div className="entry-statuses"><span className={`status-pill status-${rosterStatusTone(entry.roster_status)}`}>{rosterStatusLabel(entry.roster_status)}</span><span className={`status-pill status-${paymentStatusTone(entry.payment_status)}`}>{paymentStatusLabel(entry.payment_status)}</span></div>
        <EntryDocuments client={client} entryId={entry.id} />
        {canManage && <button type="button" className="outline-button dark" aria-expanded={openEntry === entry.id} onClick={() => setOpenEntry(openEntry === entry.id ? null : entry.id)}>{openEntry === entry.id ? 'Close players' : 'Players & roster'}</button>}
        {canManage && openEntry === entry.id && <OrganizerTeamPlayers client={client} userId={user.id} entryId={entry.id} tournamentId={tournament.id} teamName={entry.team_name ?? 'this team'} locked={entry.roster_status === 'locked'} onNotice={onNotice} onChanged={onChanged} />}
        {canManage && <div className="button-row">{busy === entry.id ? <Loader2 className="spin" size={15} /> : entry.roster_status === 'locked' ? <span className="status-pill status-info"><Lock size={12} /> Locked</span> : <><button type="button" className="outline-button dark" onClick={() => void reviewRoster(entry, 'approved')}>Approve roster</button><button type="button" className="outline-button dark" onClick={() => void reviewRoster(entry, 'locked')}><Lock size={13} /> Lock roster</button></>}</div>}
      </div>)}
  </div>
}

function MatchesTab({ client, user, tournamentId, matches, canManage, onNotice, onChanged, onOpenTab }: { client: SupabaseClient; user: User; tournamentId: string; matches: TournamentMatch[]; canManage: boolean; onNotice: (message: string) => void; onChanged: () => void; onOpenTab: (tab: OrganizerTab) => void }) {
  if (matches.length === 0) return <div className="tab-panel"><div className="state-block"><Trophy size={22} /><h3>No fixtures yet</h3><p>Generate a draw or enter fixtures from the Draw &amp; fixtures tab. Fixtures appear here for operation and result confirmation.</p><button type="button" className="outline-button dark" onClick={() => onOpenTab('draw')}>Open draw &amp; fixtures</button></div></div>
  const confirmed = matches.filter(match => match.status === 'confirmed').length
  return <div className="tab-panel">
    <p className="field-hint">Submit a score, then confirm it. Only a confirmed result updates standings, statistics, and histories; every confirmation and correction is versioned and audited.</p>
    <p className="field-hint">{confirmed} of {matches.length} fixtures confirmed.</p>
    <ul className="match-list">{matches.map(match => <li key={match.id} className="match-row">
      <div className="match-teams"><strong>{match.home_team_name ?? 'Published team'}</strong><span>vs</span><strong>{match.away_team_name ?? 'Published team'}</strong></div>
      <div className="match-facts"><span className={`status-pill status-${matchStatusTone(match.status)}`}>{matchStatusLabel(match.status)}</span><span>{match.venue ?? 'Venue not set'}</span><time>{match.scheduled_at ? new Date(match.scheduled_at).toLocaleString('en-GB', { timeZone: 'Indian/Maldives', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Not scheduled'}</time></div>
      {canManage ? <MatchResultActions client={client} user={user} tournamentId={tournamentId} match={match} onNotice={onNotice} onChanged={onChanged} /> : <p className="field-hint">Result entry is limited to owners and operations members.</p>}
      <MatchOfficialsPanel client={client} user={user} matchId={match.id} canManage={canManage} onNotice={onNotice} />
    </li>)}</ul>
  </div>
}

function MatchResultActions({ client, user, tournamentId, match, onNotice, onChanged }: { client: SupabaseClient; user: User; tournamentId: string; match: TournamentMatch; onNotice: (message: string) => void; onChanged: () => void }) {
  const [home, setHome] = useState('')
  const [away, setAway] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resultId, setResultId] = useState<string | null>(null)
  const [mode, setMode] = useState<'none' | 'submit' | 'correct'>('none')
  const [homeShootout, setHomeShootout] = useState('')
  const [awayShootout, setAwayShootout] = useState('')
  const [lineupOpen, setLineupOpen] = useState(false)
  // Correction: show the result being replaced and guard a knockout tie whose next round exists.
  const [structure, setStructure] = useState<{ stages: CompetitionStage[]; matches: StageMatch[] } | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  useEffect(() => {
    if (mode !== 'correct') return
    let active = true
    void loadCompetitionStructure(client, tournamentId).then(result => { if (active && !result.error) setStructure(result) })
    return () => { active = false }
  }, [client, mode, match.id, tournamentId])
  const draftScore = home !== '' && away !== '' ? { home: Number(home), away: Number(away), ...(homeShootout !== '' && awayShootout !== '' ? { homeShootout: Number(homeShootout), awayShootout: Number(awayShootout) } : {}) } : null
  const impact = structure && draftScore ? correctionImpact(structure, match.id, draftScore) : structure ? correctionImpact(structure, match.id, { home: -1, away: -1 }) : null

  // For a match already awaiting confirmation, resolve its pending result
  // version so the confirm action needs no typed identifier.
  useEffect(() => {
    let active = true
    if (match.status === 'awaiting_confirmation') {
      void (async () => { const result = await loadLatestResultVersion(client, match.id); if (active && result.data) setResultId(result.data.id) })()
    }
    return () => { active = false }
  }, [client, match.id, match.status])

  const score = () => {
    if (home === '' || away === '') { setError('Enter both scores.'); return null }
    const homeScore = Number(home); const awayScore = Number(away)
    if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) { setError('Scores must be whole numbers of zero or more.'); return null }
    setError('')
    // Shootout fields only decide a level knockout match; standings ignore them.
    if (homeShootout !== '' && awayShootout !== '') return { home: homeScore, away: awayScore, homeShootout: Number(homeShootout), awayShootout: Number(awayShootout) }
    return { home: homeScore, away: awayScore }
  }

  const submit = async () => {
    const payload = score(); if (!payload) return
    setBusy(true)
    const result = await submitMatchResult(client, match.id, payload, user.id)
    setBusy(false)
    const id = result.data as string | null
    if (result.error) return setError(result.error.message)
    if (id) setResultId(id)
    onNotice('Result submitted. It updates standings only once an organizer confirms it.')
    onChanged()
  }

  const confirm = async () => {
    if (!resultId) return setError('This match has no submitted result to confirm yet.')
    setBusy(true)
    const result = await confirmMatchResult(client, resultId, user.id)
    setBusy(false)
    if (result.error) return setError(result.error.message)
    await refreshSuspensions(client, tournamentId)
    onNotice('Result confirmed. Standings and statistics now reflect it.')
    onChanged()
  }

  const correct = async () => {
    const payload = score(); if (!payload) return
    if (reason.trim().length < 5) return setError('A correction needs a reason of at least five characters; it is recorded in the audit history.')
    if (impact?.winnerChanges && !acknowledged) return setError(`This changes who won, and ${impact.laterRound} already exists. Tick the box to confirm you will fix that round.`)
    setBusy(true)
    const result = await correctMatchResult(client, match.id, payload, reason.trim(), user.id)
    setBusy(false)
    if (result.error) return setError(result.error.message)
    await refreshSuspensions(client, tournamentId)
    onNotice('Result corrected. The previous version is kept, and standings, statistics and careers are recalculated.')
    setMode('none'); setReason(''); setAcknowledged(false)
    onChanged()
  }

  return <div className="match-actions">
    {mode === 'none' && match.status !== 'confirmed' && <div className="button-row">{match.status === 'awaiting_confirmation' ? <button type="button" className="primary-button" disabled={busy} onClick={() => void confirm()}><Check size={14} /> Confirm result</button> : <><button type="button" className="outline-button dark" onClick={() => setMode('submit')}>Submit result</button></>}</div>}
    {mode === 'none' && match.status === 'confirmed' && <button type="button" className="outline-button dark" onClick={() => setMode('correct')}>Correct result</button>}
    {(mode === 'submit' || mode === 'correct') && <div className="score-form">
      <label>{match.home_team_name ?? 'Home'}<input type="number" min="0" value={home} onChange={event => setHome(event.target.value)} /></label>
      <span className="score-sep">–</span>
      <label>{match.away_team_name ?? 'Away'}<input type="number" min="0" value={away} onChange={event => setAway(event.target.value)} /></label>
      <label>Home shootout (optional)<input type="number" min="0" value={homeShootout} onChange={event => setHomeShootout(event.target.value)} /></label>
      <label>Away shootout (optional)<input type="number" min="0" value={awayShootout} onChange={event => setAwayShootout(event.target.value)} /></label>
      {mode === 'correct' && impact?.previous && <p className="field-hint">Current official result: {impact.previous.home} – {impact.previous.away}{impact.previous.homeShootout !== undefined ? ` (shootout ${impact.previous.homeShootout} – ${impact.previous.awayShootout})` : ''}. It is kept as the previous version.</p>}
      {mode === 'correct' && impact?.winnerChanges && <div className="tp-warn" role="alert"><strong>This changes who won the tie.</strong> {impact.laterRound} has already been created with the old winner. Teams in that round are not moved automatically: fix it with Edit Fixture after saving.
        <label className="flow-check"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> I understand and will fix {impact.laterRound}.</label></div>}
      {mode === 'correct' && <label className="reason-field">Reason (required)<input value={reason} onChange={event => setReason(event.target.value)} placeholder="e.g. Score entered against the wrong team" /></label>}
      <div className="button-row"><button type="button" className="primary-button" disabled={busy} onClick={() => void (mode === 'submit' ? submit() : correct())}>{busy ? <Loader2 className="spin" size={14} /> : mode === 'submit' ? 'Submit result' : 'Save correction'}</button><button type="button" className="outline-button dark" onClick={() => { setMode('none'); setError('') }}>Cancel</button></div>
    </div>}
    {match.status === 'awaiting_confirmation' && resultId && mode === 'none' && <p className="field-hint">A submitted result is waiting for confirmation.</p>}
    <button type="button" className="ghost-button" onClick={() => setLineupOpen(value => !value)}>{lineupOpen ? 'Hide lineup' : 'Lineup'}</button>
    {lineupOpen && <LineupEditor client={client} userId={user.id} matchId={match.id} teamNames={{ [match.home_team_id]: match.home_team_name ?? 'Home team', [match.away_team_id]: match.away_team_name ?? 'Away team' }} onNotice={onNotice} />}
    {error && <div className="form-error" role="alert">{error}</div>}
  </div>
}


// Overview section 9: a short truthful label for the registration state shown
// in the summary. The real status travels with the tournament itself.
function registrationSummaryLabel(status: TournamentStatus): string {
  if (status === 'registration_open') return 'Open'
  if (status === 'registration_closed') return 'Closed'
  if (status === 'in_progress') return 'Closed — tournament under way'
  if (status === 'completed' || status === 'archived' || status === 'cancelled') return 'Closed'
  return 'Not open yet'
}

// Overview section 9 actions. Only the transition that matches the current
// status is offered, and it asks for confirmation exactly as the Settings tab
// does, so the two entries cannot diverge.
function RegistrationStatusActions({ client, tournament, canManage, onNotice, onChanged }: { client: SupabaseClient; tournament: OrganizerTournament; canManage: boolean; onNotice: (message: string) => void; onChanged: () => void }) {
  const [confirming, setConfirming] = useState<'registration_open' | 'registration_closed' | null>(null)
  const [error, setError] = useState('')
  if (!canManage) return null
  const actions: Array<{ status: 'registration_open' | 'registration_closed'; label: string }> = []
  if (['draft', 'setup', 'registration_closed'].includes(tournament.status)) actions.push({ status: 'registration_open', label: 'Open registration' })
  if (tournament.status === 'registration_open') actions.push({ status: 'registration_closed', label: 'Close registration' })
  if (actions.length === 0) return null
  const change = async (status: 'registration_open' | 'registration_closed') => {
    const result = await setTournamentStatus(client, tournament.id, status)
    setConfirming(null)
    if (result.error) return setError(result.error)
    setError('')
    onNotice(status === 'registration_open' ? 'Registration opened.' : 'Registration closed.')
    onChanged()
  }
  return <div className="button-row wrap">
    {actions.map(action => confirming === action.status
      ? <span className="confirm-group" key={action.status}><span>Confirm {action.label.toLowerCase()}?</span><button type="button" className="primary-button" onClick={() => void change(action.status)}>Yes</button><button type="button" className="outline-button dark" onClick={() => setConfirming(null)}>Cancel</button></span>
      : <button type="button" className="outline-button dark" key={action.status} onClick={() => setConfirming(action.status)}>{action.label}</button>)}
    {error ? <span className="form-error" role="alert">{error}</span> : null}
  </div>
}

// Header "More Actions" (identity header). Actions are filtered by current
// status and permission; each one opens Tournament Settings where the
// controlled confirmation, completion checks and audit trail already live.
// "Postpone" has no corresponding status or rescheduling flow yet, so it is
// not offered rather than shown as a broken promise.
function MoreActionsMenu({ status, canManage, onOpenTab }: { status: TournamentStatus; canManage: boolean; onOpenTab: (tab: OrganizerTab, step?: number | null) => void }) {
  if (!canManage) {
    return <a className="icon-button cockpit-more" href="#" onClick={event => { event.preventDefault(); onOpenTab('settings') }} aria-label="Tournament settings"><MoreHorizontal size={17} /></a>
  }
  const items: Array<{ key: string; label: string }> = []
  if (!['completed', 'archived', 'cancelled'].includes(status)) items.push({ key: 'cancelled', label: 'Cancel tournament' })
  if (status === 'in_progress') items.push({ key: 'complete', label: 'Complete tournament' })
  if (status === 'completed') items.push({ key: 'archived', label: 'Archive tournament' })
  return <details className="more-actions">
    <summary aria-haspopup="true" className="icon-button cockpit-more" aria-label="More actions"><MoreHorizontal size={17} /></summary>
    <ul className="more-actions-list">
      <li key="settings"><button type="button" onClick={() => onOpenTab('settings')}>Tournament settings</button></li>
      {items.map(item => <li key={item.key}><button type="button" onClick={() => onOpenTab(item.key === 'cancelled' ? 'settings' : 'completion')}>{item.label}</button></li>)}
    </ul>
    <p className="field-hint">Each lifecycle change asks for confirmation in Tournament Settings.</p>
  </details>
}

function SettingsTab({ client, tournament, blockers, canManage, onNotice, onChanged, onBack, onOpenTab }: { client: SupabaseClient; tournament: OrganizerTournament; blockers: string[]; canManage: boolean; onNotice: (message: string) => void; onChanged: () => void; onBack: () => void; onOpenTab: (tab: OrganizerTab, step?: number | null) => void }) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState('')
  const change = async (status: 'registration_open' | 'registration_closed' | 'in_progress' | 'completed' | 'archived' | 'cancelled') => {
    setError('')
    if (status === 'completed' && blockers.length > 0) return setError(blockers.join(' '))
    const result = await setTournamentStatus(client, tournament.id, status)
    setConfirming(null)
    if (result.error) return setError(result.error)
    onNotice(`Tournament status changed to ${status.replace('_', ' ')}.`)
    onChanged()
  }
  const actions: Array<{ status: 'registration_open' | 'registration_closed' | 'in_progress' | 'completed' | 'archived' | 'cancelled'; label: string }> = [
    { status: 'registration_open', label: 'Open registration' },
    { status: 'registration_closed', label: 'Close registration' },
    { status: 'in_progress', label: 'Start tournament' },
    { status: 'cancelled', label: 'Cancel tournament' },
  ]
  return <div className="tab-panel">
    {canManage && <section className="panel-block"><h3>Edit or delete tournament</h3><p>Edit details, categories, form and rules. Deletion is limited to unused private drafts. Cancel or archive tournaments with existing history.</p><div className="button-row wrap"><button type="button" className="outline-button dark" onClick={() => onOpenTab('setup', 1)}>Edit tournament</button><RecordDeleteAction client={client} kind="tournament" id={tournament.id} name={tournament.name} disabled={tournament.is_published || !['draft', 'setup'].includes(tournament.status)} onDeleted={() => { onNotice(`${tournament.name} deleted.`); onChanged(); onBack() }} /></div></section>}
    <p className="field-hint">Consequential status changes ask for confirmation. Completing and archiving are on <button type="button" className="ed-link-btn" onClick={() => onOpenTab('completion')}>Completion &amp; archive</button>, after the completion checks.</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    {!canManage ? <div className="state-block"><ShieldCheck size={20} /><h3>View only</h3><p>Only organization owners and operations members can change tournament status.</p><button type="button" className="outline-button dark" onClick={onBack}><ArrowLeft size={14} /> Back to tournaments</button></div>
      : <div className="button-row wrap">{actions.map(action => confirming === action.status
        ? <span className="confirm-group" key={action.status}><span>Confirm {action.label.toLowerCase()}?</span><button type="button" className="primary-button" onClick={() => void change(action.status)}>Yes</button><button type="button" className="outline-button dark" onClick={() => setConfirming(null)}>Cancel</button></span>
        : <button type="button" className="outline-button dark" key={action.status} onClick={() => setConfirming(action.status)}>{action.label}</button>)}</div>}
  </div>
}

