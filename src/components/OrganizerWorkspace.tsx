import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { tr } from '../lib/i18n'
import { clearOfflineCache } from '../lib/offlineCache'
import type { FormEvent } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bell, Check, ChevronRight, CircleUserRound,
  ExternalLink, FileSignature, Gauge, LayoutGrid, Loader2, LogOut, Menu, Pencil, Search, ShieldCheck,
  ChevronsLeft, ChevronsRight, FileSpreadsheet, MoreHorizontal, Newspaper, Repeat2, ScanSearch, Trophy, UserRoundCheck, UsersRound, WalletCards, X,
} from 'lucide-react'
import { BrandLogo } from './BrandLogo'
import { SaveStatusBadge } from './SaveStatusBadge'
import {
  activityLabel, attentionItems, canManageFinance, canManageTournaments,
  canViewReports, linkTeamToOrganization, loadMyNotifications, loadMyRecentActivity,
  loadOrganizationTeamLinks, loadOrganizationTournaments, loadOrganizationWorkflowCounts,
  loadTournamentSetupSteps,
  organizerHash, organizerNav, isOrganizerSection, parseOrganizerSubroute,
  sanitizeSearchTerm, searchExistingPlayers, searchExistingTeams, setupProgress, sportLabel,
  tournamentStatusLabel, tournamentStatusTone, tournamentTabHash,
  emptyWorkflowCounts, loadMyStaffPermissions,
  type OrganizerSection, type OrganizerTab, type OrganizerTournament,
  type SearchablePlayer, type SearchableTeam, type SetupProgress,
  type TournamentWorkflowCounts, type WorkspaceAuditEvent, type WorkspaceNotification,
} from '../lib/organizer'
import { loadManagedPlayers } from '../lib/organizerPeople'
import { createTournamentDraft } from '../lib/tournament'
import { FLOW_STEPS, organizationHomeAction, pendingWork, phaseFromCounts, type HomeAction } from '../lib/simpleFlow'
import { updateTournamentBranding } from '../lib/organizer'
import { uploadBrandingFile, validateBrandingFile } from '../lib/tournamentBranding'
import { createDetailsProblem, EMPTY_CREATE_DETAILS, saveCreateDetails, type CreateDetails } from '../lib/tournamentCreate'
import { BUILT_IN_ATOLLS } from '../lib/appConfig'
import type { Sport } from '../lib/records'
import type { Workspace } from '../lib/workspace'
// The per-tournament workspace is its own chunk, loaded when an organizer opens a tournament.
const TournamentWorkspace = lazy(() => import('./TournamentWorkspace').then(module => ({ default: module.TournamentWorkspace })))
import { TournamentCover, TournamentLogo } from './TournamentBranding'
import { RecordCreator } from './RecordCreator'
import { RecordDeleteAction } from './RecordDeleteAction'
import { ManagedPlayerRow } from './IdentityPanels'
import { ClaimsSection, DuplicatesSection, ImportsSection } from './OrganizerPeopleTabs'
import { NewsSection } from './NewsSection'
import { WorkspaceInvitePanel } from './WorkspaceInvitePanel'
import { FinanceSection, ReportsSection, StaffSection, NotificationSection } from './OperationsPanel'

const SPORTS: Sport[] = ['football', 'futsal', 'handball', 'volleyball', 'basketball', 'basketball_3x3']

const NAV_ICONS: Record<OrganizerSection, typeof Gauge> = {
  overview: Gauge, tournaments: Trophy, teams: UsersRound, players: CircleUserRound,
  claims: UserRoundCheck, duplicates: ScanSearch, imports: FileSpreadsheet,
  staff: ShieldCheck, finance: WalletCards, news: Newspaper, reports: FileSignature, profile: LayoutGrid, settings: Gauge,
}

function sumWorkflow(buckets: Iterable<TournamentWorkflowCounts>): TournamentWorkflowCounts {
  const total = emptyWorkflowCounts('')
  for (const bucket of buckets) {
    total.entriesTotal += bucket.entriesTotal
    total.approvedEntries += bucket.approvedEntries
    total.applicationsPending += bucket.applicationsPending
    total.rostersPending += bucket.rostersPending
    total.paymentsPending += bucket.paymentsPending
    total.matchesTotal += bucket.matchesTotal
    total.matchesUnresolved += bucket.matchesUnresolved
    total.matchesAwaitingConfirmation += bucket.matchesAwaitingConfirmation
  }
  return total
}

// The Organizer Workspace shell. It owns the header, the permission-filtered
// navigation, and the section routing; every section reads and writes only
// through the caller's own Supabase client, so the database policies remain
// the real authorization boundary.
// Five destinations from the specification. Each holds the sections this
// person may open (organizerNav already applies role and staff permissions);
// a group with no permitted section is not shown.
type OrganizerGroup = { id: string; label: string; short?: string; sections: OrganizerSection[] }
// Owner (2026-11-02): four items. Home, Tournaments, Players & Teams (with Claims,
// Possible duplicates and Imports), and More for staff, finance, news, reports,
// the organization profile and settings.
const ORG_GROUPS: OrganizerGroup[] = [
  { id: 'home', label: 'Home', short: 'Home', sections: ['overview'] },
  { id: 'tournaments', label: 'Tournaments', sections: ['tournaments'] },
  { id: 'people', label: 'Players & Teams', short: 'People', sections: ['players', 'teams', 'claims', 'duplicates', 'imports'] },
  { id: 'more', label: 'More', sections: ['staff', 'finance', 'news', 'reports', 'profile', 'settings'] },
]

export function OrganizerWorkspace({ client, user, organization, organizations, onNotice, onSwitchWorkspace }: {
  client: SupabaseClient; user: User; organization: Workspace; organizations: Workspace[]; onNotice: (message: string) => void; onSwitchWorkspace: () => void
}) {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => { const onHashChange = () => setHash(window.location.hash); window.addEventListener('hashchange', onHashChange); return () => window.removeEventListener('hashchange', onHashChange) }, [])
  const route = useMemo(() => parseOrganizerSubroute(hash), [hash])

  const [tournaments, setTournaments] = useState<OrganizerTournament[]>([])
  const [workflow, setWorkflow] = useState<Map<string, TournamentWorkflowCounts>>(new Map())
  const [progress, setProgress] = useState<Map<string, SetupProgress>>(new Map())
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([])
  const [activity, setActivity] = useState<WorkspaceAuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('kulhivaru.sidebar-collapsed') === '1' } catch { return false } })
  const toggleCollapsed = () => setCollapsed(value => { const next = !value; try { localStorage.setItem('kulhivaru.sidebar-collapsed', next ? '1' : '0') } catch { /* preference only */ } return next })
  const [panel, setPanel] = useState<'none' | 'notifications' | 'account'>('none')
  const [reloadKey, setReloadKey] = useState(0)

  const role = organization.role
  // Tournament staff permissions this account holds in this organization's
  // tournaments. They only widen what is shown; RLS still decides every write.
  const [staffPermissions, setStaffPermissions] = useState<string[]>([])
  useEffect(() => {
    let active = true
    void loadMyStaffPermissions(client, user.id, organization.id).then(result => { if (active) setStaffPermissions(result) })
    return () => { active = false }
  }, [client, user.id, organization.id])
  const nav = useMemo(() => organizerNav(role, staffPermissions), [role, staffPermissions])

  // One load pass for the dashboard: the organization's tournaments, then two
  // bulk reads for per-tournament workflow counts and setup progress, plus the
  // account's own activity and inbox.
  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true); setError('')
      const tournamentsResult = await loadOrganizationTournaments(client, organization.id)
      if (!active) return
      if (tournamentsResult.error) { setLoading(false); setError(tournamentsResult.error); return }
      const rows = tournamentsResult.data ?? []
      setTournaments(rows)
      const [countsResult, progressPairs] = await Promise.all([
        loadOrganizationWorkflowCounts(client, rows),
        Promise.all(rows.map(async row => [row.id, setupProgress((await loadTournamentSetupSteps(client, row.id)).data ?? [])] as const)),
      ])
      if (!active) return
      if (countsResult.error) { setLoading(false); setError(countsResult.error); return }
      setWorkflow(countsResult.data ?? new Map())
      setProgress(new Map(progressPairs))
      const [inbox, log] = await Promise.all([loadMyNotifications(client, user.id), loadMyRecentActivity(client, user.id)])
      if (!active) return
      setNotifications(inbox.data ?? [])
      setActivity(log.data ?? [])
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [client, organization.id, user.id, reloadKey])

  const reload = useCallback(() => setReloadKey(value => value + 1), [])

  const totals = useMemo(() => sumWorkflow(workflow.values()), [workflow])
  // Home shows the five-phase next action (owner, 2026-11-03), not the old setup-wizard stage.
  const nextAction = useMemo(() => organizationHomeAction(tournaments, workflow), [tournaments, workflow])
  const attention = useMemo(
    () => attentionItems(tournaments.map(tournament => ({ tournament, counts: workflow.get(tournament.id) ?? emptyWorkflowCounts(tournament.id) }))),
    [tournaments, workflow],
  )

  // notifications.state is queued | read | sent | failed (migration 0009), so
  // anything not yet marked read counts as unread.
  const unread = notifications.filter(item => item.state !== 'read').length

  const go = useCallback((section: OrganizerSection, tournamentId?: string | null, tab?: OrganizerTab | null, step?: number | null) => {
    window.location.hash = organizerHash(organization.id, { section, tournamentId: tournamentId ?? null, tab: tab ?? null, step: step ?? null })
    setNavOpen(false); setPanel('none')
  }, [organization.id])

  const openTournament = useCallback((tournamentId: string, tab?: OrganizerTab | null, step?: number | null) => {
    window.location.hash = tournamentTabHash(organization.id, tournamentId, tab ?? 'overview', step ?? null)
    setNavOpen(false); setPanel('none')
  }, [organization.id])

  const currentSection: OrganizerSection = isOrganizerSection(route.section) ? route.section : 'overview'
  const denied = !nav.some(item => item.section === currentSection)
  const groups = ORG_GROUPS.map(group => ({ ...group, items: group.sections.map(section => nav.find(item => item.section === section)).filter((item): item is NonNullable<typeof item> => Boolean(item)) })).filter(group => group.items.length > 0)
  const currentGroup = groups.find(group => group.items.some(item => item.section === currentSection)) ?? groups[0]
  const groupIcon = (group: (typeof groups)[number]) => group.id === 'people' ? UsersRound : group.id === 'more' ? MoreHorizontal : NAV_ICONS[group.items[0].section]

  // A tournament opens in its own workspace: its own header and menu, no organization
  // sidebar. Everything inside is scoped to that one tournament (owner, 2026-11-02).
  if (route.tournamentId) return <section className="organizer-shell tournament-shell" data-testid="tournament-shell">
    <header className="organizer-header tournament-header">
      <BrandLogo size={28} />
      <button type="button" className="ed-btn ed-btn-glass ed-btn-sm" onClick={() => go('tournaments')} aria-label={`Back to Organization: ${organization.name}`}><ArrowLeft size={15} /> <span className="ed-hide-sm">Back to Organization</span></button>
      <span className="tournament-header-org">{organization.name}</span>
      {tournaments.length > 1 && <label className="tournament-switch"><span className="sr-only">Switch Tournament</span>
        <select value={route.tournamentId} onChange={event => openTournament(event.target.value, 'overview')}>
          {!tournaments.some(item => item.id === route.tournamentId) && <option value={route.tournamentId}>This tournament</option>}
          {tournaments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>}
      <div className="organizer-header-actions">
        <SaveStatusBadge />
        <button type="button" className="ed-btn ed-btn-glass ed-btn-sm" onClick={onSwitchWorkspace} aria-label="Switch workspace" title="Switch workspace"><Repeat2 size={15} aria-hidden="true" /> <span className="ed-hide-sm">Switch workspace</span></button>
      </div>
    </header>
    <div className="tournament-shell-body">
      <Suspense fallback={<div className="cockpit-loading">Loading tournament workspace…</div>}><TournamentWorkspace client={client} user={user} organization={organization} tournamentId={route.tournamentId} tab={route.tab} step={route.step} staffPermissions={staffPermissions} onNotice={onNotice} onChanged={reload} onOpenTab={(tab, step) => openTournament(route.tournamentId!, tab, step)} onBack={() => go('tournaments')} onOpenOrganizerSection={section => go(section)} /></Suspense>
    </div>
  </section>

  if (loading) return <section className="organizer-shell"><div className="loading-state"><Loader2 className="spin" size={18} /> Loading organization workspace…</div></section>
  if (error) return <section className="organizer-shell"><div className="form-error" role="alert">This organization workspace could not be loaded. Please try again. <button type="button" className="retry-button" onClick={reload}>Retry</button></div></section>

  return (
    <section className="organizer-shell" data-testid="organizer-workspace">
      <header className="organizer-header">
        <BrandLogo size={30} />
        <label className="org-selector"><span className="sr-only">Organization</span>
          <select value={organization.id} onChange={event => { const next = organizations.find(item => item.id === event.target.value); if (next) window.location.hash = organizerHash(next.id) }}>
            {organizations.filter(item => item.kind === 'organization').map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
        </label>
        <span className="header-role">Organizer</span>
        <form className="organizer-search" onSubmit={event => { event.preventDefault(); go('teams') }}>
          <Search size={15} /><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search tournaments, teams, players..." aria-label="Search tournaments, teams, players" />
        </form>
        <div className="organizer-header-actions">
          <button type="button" className="ed-btn ed-btn-glass ed-btn-sm" onClick={onSwitchWorkspace} aria-label="Switch workspace" title="Switch workspace"><Repeat2 size={15} aria-hidden="true" /> <span className="ed-hide-sm">Switch workspace</span></button>
          <button type="button" className="icon-button" aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'} onClick={() => setPanel(panel === 'notifications' ? 'none' : 'notifications')}><Bell size={18} />{unread > 0 && <span className="badge">{unread}</span>}</button>
          <button type="button" className="avatar-button" aria-label="Account menu" onClick={() => setPanel(panel === 'account' ? 'none' : 'account')}>
            <CircleUserRound size={30} />
            <span className="header-user"><strong>{String(user.user_metadata?.full_name ?? 'My account').slice(0, 28)}</strong><small>Organizer</small></span>
          </button>
          <button type="button" className="icon-button nav-toggle" aria-label="Toggle navigation" onClick={() => setNavOpen(value => !value)}>{navOpen ? <X size={18} /> : <Menu size={18} />}</button>
        </div>
        {panel === 'notifications' && <div className="header-panel" role="dialog" aria-label="Notifications">{notifications.length === 0 ? <p className="empty-note">No notifications yet. Updates from tournaments you belong to appear here.</p> : notifications.map(item => <div className="header-panel-row" key={item.id}><strong>{item.title}</strong>{item.body && <span>{item.body}</span>}</div>)}<button type="button" className="quiet-button" onClick={() => setPanel('none')}>Close</button></div>}
        {panel === 'account' && <div className="header-panel" role="dialog" aria-label="Account"><div className="header-panel-row"><strong>{organization.name}</strong><span>{user.email ?? 'Signed in'}</span></div><div className="header-panel-row"><span>Role: {role}</span></div><button type="button" className="quiet-button" onClick={onSwitchWorkspace}>{tr('workspace.switch', 'Switch Workspace')}</button><button type="button" className="quiet-button" onClick={() => { void client.auth.signOut().finally(clearOfflineCache); onNotice('Signed out.') }}><LogOut size={14} /> {tr('common.signout', 'Sign out')}</button></div>}
      </header>

      <div className={`organizer-body${collapsed ? ' sidebar-collapsed' : ''}`}>
        <nav className={`organizer-nav${navOpen ? ' open' : ''}${collapsed ? ' collapsed' : ''}`} aria-label="Organizer sections">
          <button type="button" className="nav-item nav-collapse" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>{collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}<span>Collapse</span></button>
          {groups.map(group => {
            const Icon = groupIcon(group)
            const active = currentGroup?.id === group.id && !route.tournamentId
            return <button type="button" key={group.id} className={`nav-item${active ? ' active' : ''}`} onClick={() => go(group.items[0].section)} aria-current={active ? 'page' : undefined}><Icon size={17} /><span>{group.label}</span></button>
          })}
          <span className="nav-divider" aria-hidden="true" />
          <a className="nav-item nav-external" href="#top" target="_top"><ExternalLink size={17} /><span>View public site</span></a>
        </nav>

        <div className="organizer-content">
          {!route.tournamentId && currentGroup && currentGroup.items.length > 1 && <div className="pw-subtabs" role="tablist" aria-label={currentGroup.label}>{currentGroup.items.map(item => <button type="button" role="tab" key={item.section} aria-selected={item.section === currentSection} className={item.section === currentSection ? 'active' : ''} onClick={() => go(item.section)}>{item.label}</button>)}</div>}
          {denied ? <PermissionDenied section={currentSection} onBack={() => go('overview')} />
              : currentSection === 'overview' ? <OverviewSection client={client} workflow={workflow} organization={organization} role={role} tournaments={tournaments} totals={totals} nextAction={nextAction} attention={attention} activity={activity} unread={unread} onGo={go} onOpenTournament={openTournament} />
                : currentSection === 'tournaments' ? <TournamentsSection client={client} user={user} organization={organization} tournaments={tournaments} progress={progress} workflow={workflow} canManage={canManageTournaments(role)} onNotice={onNotice} onChanged={reload} onOpen={openTournament} />
                  : currentSection === 'teams' ? <TeamsSection client={client} user={user} organization={organization} initialQuery={searchQuery} canLink={canManageTournaments(role)} onNotice={onNotice} onChanged={reload} onImport={() => go('imports')} />
                    : currentSection === 'players' ? <PlayersSection client={client} user={user} onNotice={onNotice} onImport={() => go('imports')} />
                    : currentSection === 'claims' ? <ClaimsSection client={client} user={user} onNotice={onNotice} />
                    : currentSection === 'duplicates' ? <DuplicatesSection client={client} user={user} organizationId={organization.id} onNotice={onNotice} />
                    : currentSection === 'imports' ? <ImportsSection client={client} user={user} organizationId={organization.id} canImportTeams={canManageTournaments(role)} onNotice={onNotice} onImported={reload} />
                      : currentSection === 'staff' ? <div className="organizer-section"><div className="section-head"><div><p className="eyebrow">STAFF</p><h1>Staff</h1><p>Invite people to the organization, and give helpers one job in one tournament.</p></div></div>{role === 'owner' && <WorkspaceInvitePanel client={client} workspaceType="organization" workspaceId={organization.id} onNotice={onNotice} />}<StaffSection tournaments={tournaments} client={client} user={user} organizations={organizations} organizationId={organization.id} onNotice={onNotice} /></div>
                        : currentSection === 'finance' ? <div className="organizer-section"><div className="section-head"><div><p className="eyebrow">OPERATIONS</p><h1>Finance</h1><p>Organization money: expenses, receipts and verified income. Tournament fees and sponsors are managed in each tournament.</p></div></div><FinanceSection tournaments={tournaments} client={client} user={user} organizations={organizations} organizationId={organization.id} onNotice={onNotice} /></div>
                        : currentSection === 'news' ? <NewsSection client={client} user={user} organizationId={organization.id} tournaments={tournaments} onNotice={onNotice} />
                          : currentSection === 'reports' ? <div className="organizer-section"><div className="section-head"><div><p className="eyebrow">OPERATIONS</p><h1>Reports</h1><p>Download spreadsheets of your tournaments, teams, results and finance. Only records you are allowed to see are included.</p></div></div><ReportsSection tournaments={tournaments} client={client} organizations={organizations} organizationId={organization.id} onNotice={onNotice} /></div>
                            : currentSection === 'profile' ? <ProfileSection client={client} organization={organization} role={role} onNotice={onNotice} />
                              : <SettingsSection tournaments={tournaments} client={client} user={user} organization={organization} role={role} onNotice={onNotice} />}
        </div>
      </div>

      <nav className="ws-bottomnav org-bottomnav" aria-label="Organizer">
        {groups.map(group => { const Icon = groupIcon(group); const active = currentGroup?.id === group.id && !route.tournamentId; return <button type="button" key={group.id} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => go(group.items[0].section)}><Icon size={20} aria-hidden="true" /><span>{group.short ?? group.label}</span></button> })}
      </nav>
    </section>
  )
}

function PermissionDenied({ section, onBack }: { section: OrganizerSection; onBack: () => void }) {
  return <div className="state-block"><ShieldCheck size={26} /><h3>You do not have access to {section}</h3><p>This section is limited to specific organization roles. Ask an owner to grant you the permission, or return to the overview.</p><button type="button" className="outline-button dark" onClick={onBack}><ArrowLeft size={14} /> Back to Overview</button></div>
}

// Organization Home (owner, 2026-11-03): one list of what to do now, the
// tournaments as cards with their phase, a few counts and quick actions.
// The next action is the first task, so nothing is shown twice.
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function taskButton(tab: OrganizerTab, label: string): string {
  if (/confirm/i.test(label)) return 'Confirm'
  if (tab === 'applications' && /payment/i.test(label)) return 'Check'
  if (tab === 'applications' || tab === 'teams') return 'Review'
  if (tab === 'matches') return 'Open'
  return 'Continue'
}

function OverviewSection({ client, organization, role, tournaments, workflow, totals, nextAction, attention, activity, unread, onGo, onOpenTournament }: {
  client: SupabaseClient; organization: Workspace; role: string; tournaments: OrganizerTournament[]; workflow: Map<string, TournamentWorkflowCounts>; totals: TournamentWorkflowCounts; nextAction: HomeAction | null; attention: ReturnType<typeof attentionItems>; activity: WorkspaceAuditEvent[]; unread: number; onGo: (section: OrganizerSection) => void; onOpenTournament: (tournamentId: string, tab?: OrganizerTab, step?: number | null) => void
}) {
  const canManage = canManageTournaments(role)
  const live = tournaments.filter(item => item.status === 'in_progress').length
  const active = tournaments.filter(item => !['completed', 'archived', 'cancelled'].includes(item.status))
  const finished = tournaments.length - active.length
  const nameOf = (id: string) => tournaments.find(item => item.id === id)?.name ?? 'Tournament'
  // One task list: the warnings first, then the phase step when nothing is waiting.
  const tasks = attention.map(item => {
    const prefix = `${nameOf(item.tournamentId)}: `
    return { key: item.key, tournamentId: item.tournamentId, tab: item.tab, step: item.step, tone: item.tone, title: item.label.startsWith(prefix) ? item.label.slice(prefix.length) : item.label, detail: item.detail }
  })
  if (!tasks.length && nextAction) tasks.push({ key: 'next', tournamentId: nextAction.tournamentId, tab: nextAction.tab, step: null, tone: nextAction.tone === 'ok' ? 'ok' : 'info', title: nextAction.label, detail: sentence(nextAction.hint.replace(`${nameOf(nextAction.tournamentId)}: `, '')) })
  const firstName = organization.name
  return <div className="organizer-section org-home">
    <header className="org-home-head">
      <div>
        <p className="eyebrow">Organizer</p>
        <h1>{firstName}</h1>
        <p>{tournaments.length === 0 ? 'Create your first tournament to get started.' : `${tournaments.length} tournament${tournaments.length === 1 ? '' : 's'} · ${live} in progress · ${finished} finished`}</p>
      </div>
      <div className="org-home-head-actions">
        <a className="outline-button dark" href={`#organization/${encodeURIComponent(organization.slug)}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Public page</a>
        {canManage && <button type="button" className="primary-button" onClick={() => onGo('tournaments')}><Trophy size={15} /> Create Tournament</button>}
      </div>
    </header>

    <section className="org-todo" aria-labelledby="org-todo-title">
      <header><h3 id="org-todo-title">To do now</h3>{tasks.length > 0 && <span className="org-count">{tasks.length}</span>}</header>
      {tasks.length === 0
        ? <div className="org-todo-empty"><Check size={20} /><div><strong>You are all caught up.</strong><span>{tournaments.length === 0 ? 'Create a tournament to start.' : 'Nothing is waiting for you right now.'}</span></div></div>
        : <ul className="org-todo-list">{tasks.map((task, index) => <li key={task.key} className={`tone-${task.tone}${index === 0 ? ' is-first' : ''}`}>
          <span className="org-todo-mark" aria-hidden="true">{task.tone === 'warn' ? <AlertTriangle size={16} /> : <ArrowRight size={16} />}</span>
          <span className="org-todo-text"><small>{nameOf(task.tournamentId)}</small><strong>{task.title}</strong><span>{task.detail}</span></span>
          <button type="button" className={index === 0 ? 'primary-button' : 'outline-button dark'} onClick={() => onOpenTournament(task.tournamentId, task.tab, task.step)}>{taskButton(task.tab, task.title)} <ChevronRight size={15} /></button>
        </li>)}</ul>}
    </section>

    <section className="org-home-block" aria-labelledby="org-tournaments-title">
      <header><h3 id="org-tournaments-title">Your tournaments</h3>{tournaments.length > 0 && <button type="button" className="ghost-button" onClick={() => onGo('tournaments')}>See all <ChevronRight size={14} /></button>}</header>
      {active.length === 0
        ? <p className="empty-note">{tournaments.length ? 'No tournament is running. Finished tournaments stay under Tournaments.' : 'No tournaments yet.'}</p>
        : <div className="org-tournament-grid">{active.slice(0, 4).map(item => {
          const counts = workflow.get(item.id)
          const phase = phaseFromCounts(item.status, item.is_published, counts ?? { approvedEntries: 0, applicationsPending: 0, rostersPending: 0, paymentsPending: 0, matchesTotal: 0, matchesUnresolved: 0, matchesAwaitingConfirmation: 0 })
          const waiting = counts ? pendingWork(counts) : 0
          return <article key={item.id} className="org-tournament">
            <div className="org-tournament-top"><TournamentLogo client={client} path={item.logo_path ?? null} name={item.name} className="org-tournament-logo" /><div><strong>{item.name}</strong><span>{sportLabel(item.sport)} · {item.is_published ? 'Public' : 'Private draft'}</span></div></div>
            <ol className="org-phase" aria-label={`Phase: ${phase.label}`}>{FLOW_STEPS.map((step, index) => <li key={step.id} className={index < phase.index ? 'done' : index === phase.index ? 'current' : ''}><span>{step.label}</span></li>)}</ol>
            <p className="org-tournament-meta"><span>{counts ? `${counts.approvedEntries} team${counts.approvedEntries === 1 ? '' : 's'}` : 'Teams not counted'}</span><span>{counts ? `${counts.matchesTotal} match${counts.matchesTotal === 1 ? '' : 'es'}` : ''}</span>{waiting > 0 && <span className="org-waiting">{waiting} waiting</span>}</p>
            <button type="button" className="primary-button" onClick={() => onOpenTournament(item.id)}>Open <ArrowRight size={15} /></button>
          </article>
        })}</div>}
    </section>

    <section className="org-glance" aria-label="At a glance">
      {[
        { label: 'Applications to review', value: totals.applicationsPending },
        { label: 'Squad lists to review', value: totals.rostersPending },
        { label: 'Results to confirm', value: totals.matchesAwaitingConfirmation },
        { label: 'Payments to check', value: totals.paymentsPending },
      ].map(item => <div key={item.label} className={item.value > 0 ? 'has-work' : ''}><strong>{item.value}</strong><span>{item.label}</span></div>)}
    </section>

    <div className="org-home-columns">
      <section className="org-home-block" aria-labelledby="org-quick-title">
        <header><h3 id="org-quick-title">Quick actions</h3></header>
        <div className="org-quick">
          {canManage && <button type="button" onClick={() => onGo('tournaments')}><Trophy size={18} /><span>New tournament</span></button>}
          <button type="button" onClick={() => onGo('players')}><UsersRound size={18} /><span>Add players</span></button>
          <button type="button" onClick={() => onGo('teams')}><LayoutGrid size={18} /><span>Add teams</span></button>
          <button type="button" onClick={() => onGo('staff')}><UserRoundCheck size={18} /><span>Invite staff</span></button>
          <button type="button" onClick={() => onGo('news')}><Newspaper size={18} /><span>Post news</span></button>
          <button type="button" onClick={() => onGo('reports')}><FileSpreadsheet size={18} /><span>Reports</span></button>
        </div>
      </section>
      <section className="org-home-block" aria-labelledby="org-activity-title">
        <header><h3 id="org-activity-title">Recent activity</h3>{unread > 0 && <span className="org-count">{unread} unread</span>}</header>
        {activity.length === 0 ? <p className="empty-note">Your changes will be listed here.</p>
          : <ul className="org-activity">{activity.slice(0, 5).map(event => <li key={event.id}><span>{activityLabel(event)}</span><time>{new Date(event.created_at).toLocaleString('en-GB', { timeZone: 'Indian/Maldives', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></li>)}</ul>}
      </section>
    </div>
  </div>
}

function TournamentsSection({ client, user, organization, tournaments, workflow, canManage, onNotice, onChanged, onOpen }: {
  client: SupabaseClient; user: User; organization: Workspace; tournaments: OrganizerTournament[]; progress: Map<string, SetupProgress>; workflow: Map<string, TournamentWorkflowCounts>; canManage: boolean; onNotice: (message: string) => void; onChanged: () => void; onOpen: (tournamentId: string, tab?: OrganizerTab, step?: number | null) => void
}) {
  const [name, setName] = useState(''); const [sport, setSport] = useState<Sport>('football'); const [creating, setCreating] = useState(false); const [error, setError] = useState('')
  // Step 1 of 5 (Create): name and sport, with an optional logo and cover.
  // Sport defaults apply automatically; everything else can be set later.
  const [logo, setLogo] = useState<File | null>(null); const [cover, setCover] = useState<File | null>(null)
  const [details, setDetails] = useState<CreateDetails>(EMPTY_CREATE_DETAILS)
  const detail = (key: keyof CreateDetails) => ({ value: details[key], onChange: (event: { target: { value: string } }) => setDetails(current => ({ ...current, [key]: event.target.value })) })
  // The form opens on request, so the page itself stays a list of tournaments.
  const [showCreate, setShowCreate] = useState(tournaments.length === 0)
  const pickImage = (asset: 'logo' | 'cover', file: File | null) => {
    setError('')
    if (file) { const problem = validateBrandingFile(asset, file); if (problem) return setError(problem) }
    if (asset === 'logo') setLogo(file); else setCover(file)
  }
  const create = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (!name.trim()) return setError('Enter a tournament name.')
    const detailProblem = createDetailsProblem(details)
    if (detailProblem) return setError(detailProblem)
    setCreating(true)
    const result = await createTournamentDraft(client, user.id, organization.id, name.trim(), sport)
    if (result.error || !result.data) { setCreating(false); return setError('The tournament could not be created. Please try again.') }
    // Images are optional: a failed upload never blocks the tournament.
    let imageNote = ''
    const paths: { logoPath?: string; coverPath?: string } = {}
    for (const [asset, file] of [['logo', logo], ['cover', cover]] as const) {
      if (!file) continue
      const upload = await uploadBrandingFile(client, organization.id, result.data.id, asset, file)
      if (upload.path) paths[asset === 'logo' ? 'logoPath' : 'coverPath'] = upload.path
      else imageNote = ' The image could not be uploaded; add it later with Edit Branding.'
    }
    if (paths.logoPath || paths.coverPath) await updateTournamentBranding(client, result.data.id, paths)
    const saved = await saveCreateDetails(client, result.data.id, user.id, name.trim(), sport, details)
    const detailNote = saved.failed ? ' Some optional details were not saved; add them later under More, Tournament settings.' : ''
    setCreating(false)
    setName(''); setLogo(null); setCover(null); setDetails(EMPTY_CREATE_DETAILS)
    onNotice(`Tournament created and saved. Next: add the teams.${imageNote}${detailNote}`)
    onChanged()
    onOpen(result.data.id, 'teams')
  }
  return <div className="organizer-section">
    <div className="section-head"><div><p className="eyebrow">TOURNAMENTS</p><h1>Tournaments</h1><p>Real tournaments this organization runs. Each one opens in its own workspace. Drafts stay private until you publish.</p></div>{canManage && !showCreate && <button type="button" className="primary-button" onClick={() => setShowCreate(true)}><Trophy size={15} /> Create Tournament</button>}</div>

    {canManage && showCreate && <form className="inline-create flow-create" onSubmit={create}><label>Tournament name<input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Malé Island Cup 2026" /></label><label>Sport<select value={sport} onChange={event => setSport(event.target.value as Sport)}>{SPORTS.map(item => <option value={item} key={item}>{sportLabel(item)}</option>)}</select></label><label>Logo (optional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => pickImage('logo', event.target.files?.[0] ?? null)} /></label><label>Cover (optional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => pickImage('cover', event.target.files?.[0] ?? null)} /></label><details className="flow-create-more"><summary>More details (optional)</summary><div className="flow-create-grid">
      <label>Season or year<input {...detail('season')} placeholder="e.g. 2026" maxLength={40} /></label>
      <label>Categories<input {...detail('categories')} placeholder="e.g. Open, Under 17, Women" /><small className="field-hint">Separate with commas.</small></label>
      <label>Atoll<select {...detail('atoll')}><option value="">Not set</option>{BUILT_IN_ATOLLS.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>Island<input {...detail('island')} maxLength={80} /></label>
      <label>Venues<input {...detail('venues')} placeholder="e.g. National Stadium, Henveiru Ground" /><small className="field-hint">Separate with commas.</small></label>
      <label>Start date<input type="date" {...detail('startsAt')} /></label>
      <label>End date<input type="date" {...detail('endsAt')} min={details.startsAt || undefined} /></label>
      <label className="flow-create-wide">Description<textarea rows={3} {...detail('description')} maxLength={2000} /></label>
      <label className="flow-create-wide">Rules<textarea rows={3} {...detail('rules')} /></label>
    </div></details><button type="submit" className="primary-button" disabled={creating}>{creating ? <Loader2 className="spin" size={15} /> : <Trophy size={15} />} Create Tournament</button>{error && <span className="form-error" role="alert">{error}</span>}<small className="field-hint">It stays private until you publish. Rules, fees, officials and venues can be added later.</small>{tournaments.length > 0 && <button type="button" className="ghost-button" onClick={() => setShowCreate(false)}>Cancel</button>}</form>}

    {tournaments.length === 0 ? <div className="state-block"><Trophy size={24} /><h3>No tournaments yet</h3><p>{canManage ? 'Create a private draft above. It stays hidden until you publish it, and setup resumes at any stage.' : 'Tournaments appear here once this organization creates them.'}</p></div>
      : <div className="tournament-grid">{tournaments.map(tournament => {
        const bucket = workflow.get(tournament.id) ?? emptyWorkflowCounts(tournament.id)
        const phase = phaseFromCounts(tournament.status, tournament.is_published, bucket)
        const pending = pendingWork(bucket)
        // Signed with the organizer's authenticated client, so private draft
        // branding stays visible here while guests never see it.
        return <article className="tournament-card" key={tournament.id}>
          <div className="tournament-card-cover"><TournamentCover client={client} path={tournament.cover_path} name={tournament.name} sport={tournament.sport} /></div>
          <div className="tournament-card-head"><span className="tournament-card-title"><TournamentLogo client={client} path={tournament.logo_path} name={tournament.name} className="tournament-card-logo" /><h3>{tournament.name}</h3></span><span className={`status-pill status-${tournamentStatusTone(tournament.status)}`}>{tournamentStatusLabel(tournament.status)}</span></div>
          <p className="tournament-meta">{sportLabel(tournament.sport)} · Phase: <strong>{phase.label}</strong></p>
          <ol className="card-phases" aria-label={`Phase: ${phase.label}`}>{FLOW_STEPS.map((item, index) => <li key={item.id} className={index < phase.index ? 'done' : index === phase.index ? 'now' : ''} title={item.label} />)}</ol>
          <dl className="card-facts"><div><dt>Teams</dt><dd>{bucket.approvedEntries}</dd></div><div><dt>Matches</dt><dd>{bucket.matchesTotal}</dd></div><div className={pending ? 'tone-warn' : ''}><dt>Pending</dt><dd>{pending}</dd></div></dl>
          <div className="tournament-card-actions">{canManage && <><button type="button" className="outline-button dark" onClick={() => onOpen(tournament.id, 'setup', 1)}>Edit tournament</button><RecordDeleteAction client={client} kind="tournament" id={tournament.id} name={tournament.name} onDeleted={() => { onNotice(`${tournament.name} deleted.`); onChanged() }} /></>}<button type="button" className="primary-button" onClick={() => onOpen(tournament.id)}>Open Tournament <ArrowRight size={14} /></button></div>
        </article>
      })}</div>}
  </div>
}

function TeamsSection({ client, user, organization, initialQuery, canLink, onNotice, onChanged, onImport }: {
  client: SupabaseClient; user: User; organization: Workspace; initialQuery: string; canLink: boolean; onNotice: (message: string) => void; onChanged: () => void; onImport: () => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [teams, setTeams] = useState<SearchableTeam[]>([])
  const [linked, setLinked] = useState<Set<string>>(new Set())
  // Teams this account manages can be edited in their own Team workspace.
  const [managed, setManaged] = useState<Set<string>>(new Set())
  useEffect(() => {
    let active = true
    void client.from('team_memberships').select('team_id,role').eq('user_id', user.id).then(result => {
      if (active && !result.error) setManaged(new Set(((result.data ?? []) as Array<{ team_id: string; role: string }>).filter(row => ['manager', 'assistant_manager', 'staff'].includes(row.role)).map(row => row.team_id)))
    })
    return () => { active = false }
  }, [client, user.id])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')

  const runSearch = useCallback(async (term: string) => {
    setError(''); setSearching(true)
    const result = await searchExistingTeams(client, term)
    setSearching(false); setTeams(result.data ?? []); setSearched(true)
    if (result.error) setError(result.error)
  }, [client])

  useEffect(() => { if (initialQuery.trim()) void runSearch(initialQuery) }, [initialQuery, runSearch])
  useEffect(() => { let active = true; void (async () => { const result = await loadOrganizationTeamLinks(client, organization.id); if (active && result.data) setLinked(new Set(result.data.map(row => row.team_id))) })(); return () => { active = false } }, [client, organization.id])

  const search = async (event: FormEvent) => { event.preventDefault(); await runSearch(query) }
  const link = async (teamId: string) => {
    const result = await linkTeamToOrganization(client, organization.id, teamId, user.id)
    if (result.error) return setError(result.error)
    onNotice('Team linked to this organization.')
    setLinked(previous => new Set(previous).add(teamId))
    onChanged()
  }

  return <div className="organizer-section">
    <div className="section-head"><div><p className="eyebrow">TEAMS</p><h1>Teams</h1><p>Search published teams and teams you manage before creating a new record, so the same team is never entered twice.</p></div></div>
    <form className="search-bar" onSubmit={search}><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by team name or slug (at least 2 characters)" aria-label="Search teams" /><button type="submit" className="outline-button dark" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button></form>
    <p className="field-hint">Search returns published teams plus any team you manage, which is all the database lets this account read.</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    {searched && teams.length === 0 ? <div className="state-block"><UsersRound size={22} /><h3>No matching teams</h3><p>{sanitizeSearchTerm(query).length < 2 ? 'Enter at least two characters to search.' : 'Nothing readable by this account matches that search. Create the team record below if it does not exist yet.'}</p></div> : null}
    {searched && teams.length > 0 && teams.map(team => <div className="result-row" key={team.id}><div><strong>{team.name}</strong><span>{team.island ?? 'Island not recorded'}{team.is_published ? ' · Published' : ' · Private'}</span></div><div className="button-row">{managed.has(team.id) && <a className="outline-button dark" href={`#workspace/team/${encodeURIComponent(team.id)}?section=manage`} aria-label={`Edit ${team.name}`}><Pencil size={14} aria-hidden="true" /> Edit team</a>}{linked.has(team.id) ? <span className="status-pill status-ok">Linked</span> : canLink ? <button type="button" className="outline-button dark" onClick={() => void link(team.id)}>Link to organization</button> : null}{canLink && <button type="button" className="outline-button dark" onClick={() => { if (window.confirm(`Delete team "${team.name}"? This only works for unused teams.`)) void (async () => { const r = await client.from('teams').delete().eq('id', team.id); if (r.error) setError(r.error.message); else { onNotice(`${team.name} deleted.`); onChanged() } })() }}>Delete team</button>}</div></div>)}
    <RecordCreator user={user} onNotice={message => { onNotice(message); onChanged() }} defaultKind="team" />
    {/* Bulk import moved to its own Imports tab (final plan 37), with Excel, a template and history. */}
    {canLink && <button type="button" className="outline-button dark" onClick={onImport}><FileSpreadsheet size={14} /> Import teams from CSV or Excel</button>}
  </div>
}

function PlayersSection({ client, user, onNotice, onImport }: { client: SupabaseClient; user: User; onNotice: (message: string) => void; onImport: () => void }) {
  const [query, setQuery] = useState(''); const [players, setPlayers] = useState<SearchablePlayer[]>([]); const [searched, setSearched] = useState(false); const [searching, setSearching] = useState(false); const [error, setError] = useState('')
  const loadOwn = useCallback(async () => {
    const result = await loadManagedPlayers(client, user.id)
    setPlayers(result.data.map(player => ({ id: player.id, display_name: player.name, slug: player.slug, island: player.island, is_claimed: player.claimed, is_published: player.published, created_by: user.id })))
    setError(result.error ?? '')
  }, [client, user.id])
  useEffect(() => { void loadOwn() }, [loadOwn])
  const refreshPlayers = () => {
    if (sanitizeSearchTerm(query).length < 2) { void loadOwn(); return }
    void searchExistingPlayers(client, query).then(result => { setPlayers(result.data ?? []); setError(result.error ?? '') })
  }
  const search = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSearching(true)
    const result = await searchExistingPlayers(client, query)
    setSearching(false); setPlayers(result.data ?? []); setSearched(true)
    if (result.error) setError(result.error)
  }
  return <div className="organizer-section">
    <div className="section-head"><div><p className="eyebrow">PLAYERS</p><h1>Players</h1><p>Create unclaimed player records for people you manage, or search before adding to avoid duplicates.</p></div></div>
    <form className="search-bar" onSubmit={search}><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by player name or slug (at least 2 characters)" aria-label="Search players" /><button type="submit" className="outline-button dark" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button></form>
    {error && <div className="form-error" role="alert">{error}</div>}
    {searched && players.length === 0 ? <div className="state-block"><CircleUserRound size={22} /><h3>No matching players</h3><p>{sanitizeSearchTerm(query).length < 2 ? 'Enter at least two characters to search.' : 'Nothing readable by this account matches that search. Create the unclaimed record below if this person does not have a profile yet.'}</p></div> : players.map(player => <ManagedPlayerRow key={player.id} client={client} userId={user.id} player={player} onNotice={onNotice} onChanged={refreshPlayers} />)}
    <RecordCreator user={user} onNotice={message => { onNotice(message); refreshPlayers() }} defaultKind="player" />
    <button type="button" className="outline-button dark" onClick={onImport}><FileSpreadsheet size={14} /> Import players from CSV or Excel</button>
  </div>
}

// Publishing makes the organization's name, description and its published
// tournaments visible in the public directory (#organizations). Only an owner
// can change it, through set_organization_published (migration 033).
function ProfileSection({ client, organization, role, onNotice }: { client: SupabaseClient; organization: Workspace; role: string; onNotice: (message: string) => void }) {
  const [published, setPublished] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; void client.from('organizations').select('is_published').eq('id', organization.id).maybeSingle().then(result => { if (active) setPublished(result.data ? result.data.is_published === true : null) }); return () => { active = false } }, [client, organization.id])
  const toggle = async () => {
    if (published === null) return
    setBusy(true); setError('')
    const result = await client.rpc('set_organization_published', { p_organization_id: organization.id, p_publish: !published })
    setBusy(false)
    if (result.error) return setError(/does not exist|PGRST2\d\d|42883|schema cache|could not find/i.test(result.error.message) ? 'Publishing an organization needs migration 033. Ask the platform owner to apply it.' : result.error.message.includes('organization_owner_required') ? 'Only an organization owner can publish it.' : result.error.message)
    setPublished(!published)
    onNotice(published ? 'Organization unpublished. It no longer appears in the public directory.' : 'Organization published. It now appears in the public directory.')
  }
  return <div className="organizer-section"><div className="section-head"><div><p className="eyebrow">ORGANIZATION PROFILE</p><h1>Organization Profile</h1><p>Your organization identity as other people see it.</p></div></div><div className="panel-block"><dl className="fact-sheet"><div><dt>Organization name</dt><dd>{organization.name}</dd></div><div><dt>Reference</dt><dd><code>{organization.id}</code></dd></div><div><dt>Your role</dt><dd>{role}</dd></div><div><dt>Public visibility</dt><dd>{published === null ? 'Checking…' : published ? 'Published: listed in the public Organizations directory, and shown as the organizer on its published tournaments.' : 'Private: not listed publicly, and its tournaments show no organizer name. Tournaments are still published one by one.'}</dd></div></dl>
    {role === 'owner' && published !== null && <div className="button-row"><button type="button" className={published ? 'outline-button dark' : 'primary-button'} disabled={busy} onClick={() => void toggle()}>{busy ? 'Saving…' : published ? 'Unpublish organization' : 'Publish organization'}</button>{published && <a className="outline-button dark" href={`#organization/${encodeURIComponent(organization.slug)}`} target="_blank" rel="noopener noreferrer">View public page <ExternalLink size={14} /></a>}</div>}
    {role !== 'owner' && <p className="field-hint">Only an organization owner can publish or unpublish it.</p>}
    {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
  </div></div>
}

function SettingsSection({ client, user, organization, role, tournaments, onNotice }: { client: SupabaseClient; user: User; organization: Workspace; role: string; tournaments: OrganizerTournament[]; onNotice: (message: string) => void }) {
  if (!canManageTournaments(role) && !canManageFinance(role, []) && !canViewReports(role)) {
    return <div className="organizer-section"><PermissionDenied section="settings" onBack={() => { window.location.hash = organizerHash(organization.id) }} /></div>
  }
  return <div className="organizer-section">
    <div className="section-head"><div><p className="eyebrow">SETTINGS</p><h1>Settings</h1><p>Publishing, status changes, and completion live on each tournament, where the completion checks and confirmations apply.</p></div></div>
    <NotificationSection client={client} user={user} tournaments={tournaments} onNotice={onNotice} />
    <div className="panel-block"><h3>What lives where</h3><ul className="plain-list"><li>Publish, close registration, complete, and archive are per-tournament actions in the tournament workspace.</li><li>Finance entries and CSV exports are in their own sections.</li><li>Staff permissions are granted per tournament.</li></ul></div>
  </div>
}
