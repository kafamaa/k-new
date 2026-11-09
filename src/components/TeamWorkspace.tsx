import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { BarChart3, BellRing, CalendarDays, ClipboardList, Eye, FileLock2, Gauge, ListChecks, Pencil, RefreshCw, Settings, Shield, Trophy, UserPlus, Users, Wallet, WifiOff } from 'lucide-react'
import { loadTeamWorkspace, type TeamWorkspaceData } from '../lib/teamWorkspace'
import { markNotificationRead } from '../lib/playerWorkspace'
import { markAllNotificationsRead } from '../lib/playerSections'
import { loadTournamentCards, type TournamentCard } from '../lib/playerHub'
import { getTournamentDirectoryDetails } from '../lib/publicData'
import {
  financeSummary, formatMvr, legacyTeamMatches, loadFinance, loadSentInvitations, loadTeamAccess, loadTeamDocuments, loadTeamMatches, loadTeamProfile,
  type SentInvitation, type TeamAccess, type TeamMatch, type TeamProfile,
} from '../lib/teamHub'
import { WorkspaceShell, type ShellItem } from './WorkspaceShell'
import {
  TeamContextBanner, TeamHeader, TeamInvitationsSection, TeamOverview, TeamPlayersSection, TeamProfileSection, TeamPublicSection, TeamSettingsSection, TeamStaffSection,
  type TeamCtx, type TeamSection,
} from './TeamHubTabs'
import {
  TeamApplicationsSection, TeamDocumentsSection, TeamFinanceSection, TeamFixturesSection, TeamNotificationsSection, TeamRostersSection, TeamStatsSection, TeamTournamentsSection,
} from './TeamOpsTabs'

// Every Team Workspace section, in specification order. They are shown as
// tabs inside five groups (Overview, Squad, Tournaments, Matches, More).
const TABS: Array<ShellItem<TeamSection>> = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'profile', label: 'Team Profile', icon: Pencil },
  { id: 'players', label: 'Players', icon: Users },
  { id: 'invitations', label: 'Invitations & Requests', icon: UserPlus },
  { id: 'tournaments', label: 'Tournaments', icon: Trophy },
  { id: 'applications', label: 'Applications', icon: ClipboardList },
  { id: 'rosters', label: 'Rosters', icon: ListChecks },
  { id: 'matches', label: 'Fixtures & Results', icon: CalendarDays },
  { id: 'statistics', label: 'Statistics & History', icon: BarChart3 },
  { id: 'finance', label: 'Finance', icon: Wallet },
  { id: 'documents', label: 'Documents', icon: FileLock2 },
  { id: 'notifications', label: 'Notifications', icon: BellRing },
  { id: 'staff', label: 'Staff & Permissions', icon: Shield },
  { id: 'public', label: 'Public Page', icon: Eye },
  { id: 'settings', label: 'Settings', icon: Settings },
]
const SECTION_IDS = TABS.map(item => item.id)
type TeamGroup = 'home' | 'squad' | 'competitions' | 'games' | 'history' | 'finance' | 'staff' | 'documents' | 'more'
// Owner's workspace design (2026-11-04): nine destinations in the sidebar.
const GROUPS: Array<ShellItem<TeamGroup> & { tabs: TeamSection[] }> = [
  { id: 'home', label: 'Overview', shortLabel: 'Overview', icon: Gauge, tabs: ['overview'] },
  { id: 'squad', label: 'Squad', icon: Users, tabs: ['players', 'invitations'] },
  { id: 'competitions', label: 'Tournaments', icon: Trophy, tabs: ['tournaments', 'applications', 'rosters'] },
  { id: 'games', label: 'Matches', icon: CalendarDays, tabs: ['matches'] },
  { id: 'history', label: 'Team History', shortLabel: 'History', icon: BarChart3, tabs: ['statistics'] },
  { id: 'finance', label: 'Finance', icon: Wallet, tabs: ['finance'] },
  { id: 'staff', label: 'Staff', icon: Shield, tabs: ['staff'] },
  { id: 'documents', label: 'Documents', icon: FileLock2, tabs: ['documents'] },
  { id: 'more', label: 'Team Settings', shortLabel: 'Settings', icon: Settings, tabs: ['profile', 'public', 'notifications', 'settings'] },
]
const TEAM_PAGE: Partial<Record<TeamGroup, [string, string]>> = {
  home: ['Team Overview', 'Manage your squad and keep your team moving.'],
  squad: ['Team Squad', ''],
  competitions: ['Tournaments', 'Entries, applications and rosters for your team.'],
  games: ['Matches', 'Fixtures and official results.'],
  history: ['Team History', 'Statistics and records from confirmed matches.'],
  more: ['Team Settings', 'Profile, public page, notifications and settings.'],
}
const MOBILE_PRIMARY: TeamGroup[] = ['home', 'squad', 'competitions', 'games']

// #workspace/team/<id>?section=players survives a refresh.
function sectionFromHash(): TeamSection {
  const value = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('section')
  return SECTION_IDS.includes(value as TeamSection) ? value as TeamSection : 'overview'
}
function writeSectionToHash(section: TeamSection) {
  const [base, query = ''] = window.location.hash.split('?')
  const params = new URLSearchParams(query)
  if (section === 'overview') params.delete('section'); else params.set('section', section)
  const next = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${base}${next ? `?${next}` : ''}`)
}

type LoadState = { kind: 'loading' } | { kind: 'denied' } | { kind: 'session' } | { kind: 'offline' } | { kind: 'error'; message: string } | { kind: 'ready' }

export function TeamWorkspace({ client, user, teamId, onNotice }: { client: SupabaseClient; user: User; teamId: string; onNotice: (message: string) => void }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [data, setData] = useState<TeamWorkspaceData | null>(null)
  const [access, setAccess] = useState<TeamAccess | null>(null)
  const [profile, setProfile] = useState<{ data: TeamProfile; extended: boolean } | null>(null)
  const [matches, setMatches] = useState<{ data: TeamMatch[]; available: boolean }>({ data: [], available: false })
  const [invitations, setInvitations] = useState<SentInvitation[]>([])
  const [tournaments, setTournaments] = useState<Map<string, TournamentCard>>(new Map())
  const [openTournaments, setOpenTournaments] = useState<TournamentCard[]>([])
  const [details, setDetails] = useState<Map<string, { organizerName: string | null; island: string | null; startsAt: string | null }>>(new Map())
  const [financeBalance, setFinanceBalance] = useState<string | null>(null)
  const [documentIssues, setDocumentIssues] = useState(0)
  const [section, setSectionState] = useState<TeamSection>(sectionFromHash)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(value => value + 1), [])
  const open = useCallback((next: TeamSection) => { setSectionState(next); writeSectionToHash(next); window.scrollTo({ top: 0 }) }, [])

  // Overview data first; everything else refreshes alongside without blocking it.
  useEffect(() => {
    let active = true
    void (async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { setState({ kind: 'offline' }); return }
      const result = await loadTeamWorkspace(client, user.id, teamId)
      if (!active) return
      if (result.error) { setState(/jwt|expired|invalid claim|not authenticated|401/i.test(result.error) ? { kind: 'session' } : { kind: 'error', message: result.error }); return }
      if (!result.data || !result.data.team) { setState({ kind: 'denied' }); return }
      const [teamAccess, teamProfile] = await Promise.all([loadTeamAccess(client, teamId, user.id, result.data.role), loadTeamProfile(client, teamId)])
      if (!active) return
      setData(result.data); setAccess(teamAccess)
      if (teamProfile.data) setProfile({ data: teamProfile.data, extended: teamProfile.extended })
      setState({ kind: 'ready' })
      void loadTeamMatches(client, teamId).then(feed => { if (active) setMatches({ data: feed.data, available: feed.available && !feed.error }) })
      void loadSentInvitations(client, teamId).then(sent => { if (active) setInvitations(sent.data) })
      if (teamAccess.can('manage_finance')) void loadFinance(client, teamId).then(finance => { if (active) setFinanceBalance(finance.error ? null : formatMvr(financeSummary(finance.data).balance)) })
      if (teamAccess.can('view_documents')) void loadTeamDocuments(client, teamId).then(documents => { if (active) setDocumentIssues(documents.data.filter(item => ['changes_requested', 'rejected', 'expired'].includes(item.status)).length) })
      const open = await client.from('tournaments').select('id').eq('is_published', true).eq('status', 'registration_open').order('created_at', { ascending: false }).limit(12)
      if (!active) return
      const ids = [...new Set([...result.data.entries.map(entry => String(entry.tournament_id)), ...result.data.matches.map(match => String(match.tournament_id)), ...((open.data ?? []) as Record<string, unknown>[]).map(row => String(row.id))].filter(Boolean))]
      const [cards, directory] = await Promise.all([loadTournamentCards(client, ids), getTournamentDirectoryDetails(client, ids)])
      if (!active) return
      setTournaments(cards); setDetails(directory)
      setOpenTournaments(((open.data ?? []) as Record<string, unknown>[]).map(row => cards.get(String(row.id))).filter((card): card is TournamentCard => Boolean(card)))
    })()
    return () => { active = false }
  }, [client, user.id, teamId, reloadKey])

  const unread = useMemo(() => (data?.notifications ?? []).filter(row => row.read_at == null && row.state !== 'read').length, [data?.notifications])

  if (state.kind === 'loading') return <div className="tw-skeleton" aria-busy="true" aria-label="Loading team workspace"><span /><span /><span /><span /></div>
  if (state.kind !== 'ready' || !data || !access || !profile) {
    const message = state.kind === 'session' ? 'Your session expired. Sign in again to reopen this Team Workspace.'
      : state.kind === 'offline' ? 'You are offline. Reconnect to load this Team Workspace.'
      : state.kind === 'denied' ? 'This team is not part of your authorized workspaces. Use Switch Workspace to choose a team you manage.'
      : state.kind === 'error' ? 'The Team Workspace could not be loaded. Please try again.'
      : 'The team record is not readable inside this workspace scope.'
    return <div className="tw-state" role="alert">{state.kind === 'offline' ? <WifiOff size={26} /> : <Shield size={26} />}<p>{message}</p>
      <div className="pw-actions">{state.kind === 'session' ? <a className="ed-btn ed-btn-primary" href="#workspace">Sign in again</a> : <button type="button" className="ed-btn ed-btn-primary" onClick={() => { setState({ kind: 'loading' }); reload() }}><RefreshCw size={14} /> Retry</button>}<a className="ed-btn ed-btn-ghost" href="#workspace">Switch workspace</a></div></div>
  }

  const ctx: TeamCtx = {
    client, userId: user.id, teamId, data, access, profile: profile.data, profileExtended: profile.extended,
    matches: matches.available ? matches.data : legacyTeamMatches(teamId, data.matches, data.resultVersions), matchesAvailable: matches.available,
    invitations, tournaments, openTournaments, open, reload, notice: onNotice,
  }
  const markRead = async (id: string) => { const result = await markNotificationRead(client, user.id, id); if (result.error) onNotice(`Not marked read: ${result.error}`); else reload() }
  const markAll = async () => { const result = await markAllNotificationsRead(client, user.id); if (result.error) onNotice(result.error); else reload() }
  const pendingRequests = data.teamRequests.filter(row => row.status === 'pending').length
  const rostersNeeding = data.entries.filter(entry => entry.application_status === 'approved' && ['not_started', 'draft', 'changes_requested', 'rejected'].includes(String(entry.roster_status))).length
  // Finance and documents stay out of the menu for staff without permission.
  const tabs = TABS.filter(item => (item.id !== 'finance' || access.can('manage_finance')) && (item.id !== 'documents' || access.can('view_documents')))
    .map(item => item.id === 'invitations' ? { ...item, count: pendingRequests } : item.id === 'notifications' ? { ...item, count: unread } : item.id === 'rosters' ? { ...item, count: rostersNeeding } : item)
  const shown = tabs.some(item => item.id === section) ? section : 'overview'
  // Groups list only the tabs this staff member may open; counts add up.
  const visible = new Set(tabs.map(item => item.id))
  const groups = GROUPS.map(group => ({ ...group, tabs: group.tabs.filter(tab => visible.has(tab)), count: tabs.filter(item => group.tabs.includes(item.id)).reduce((sum, item) => sum + (item.count ?? 0), 0) })).filter(group => group.tabs.length > 0)
  const activeGroup = groups.find(group => group.tabs.includes(shown)) ?? groups[0]
  const tabLabel = (id: TeamSection) => TABS.find(item => item.id === id)?.label ?? id

  return <WorkspaceShell kindLabel="Team" title={profile.data.name} subtitle={profile.data.isPublished ? 'Public team page' : 'Private team page'} items={groups} active={activeGroup.id} pageTitle={TEAM_PAGE[activeGroup.id]?.[0]} pageLede={TEAM_PAGE[activeGroup.id]?.[1]} onSelect={id => open(groups.find(group => group.id === id)?.tabs[0] ?? 'overview')} primaryIds={MOBILE_PRIMARY}>
    {activeGroup.tabs.length > 1 && <div className="pw-subtabs" role="tablist" aria-label={activeGroup.label}>{activeGroup.tabs.map(id => { const count = tabs.find(item => item.id === id)?.count; return <button type="button" role="tab" key={id} aria-selected={id === shown} className={id === shown ? 'active' : ''} onClick={() => open(id)}>{tabLabel(id)}{count ? <span className="ws-count">{count}</span> : null}</button> })}</div>}
    {data.unavailable.length > 0 && <div className="warning">Some sections are limited by the current access rules: {data.unavailable.join(', ')}. Totals are not shown for data that could not be read.</div>}
    {shown === 'overview' && <TeamHeader ctx={ctx} />}
    {!['overview', 'players', 'invitations', 'profile'].includes(shown) && <TeamContextBanner ctx={ctx} />}
    {shown === 'overview' && <TeamOverview ctx={ctx} unread={unread} financeBalance={financeBalance} documentIssues={documentIssues} />}
    {shown === 'profile' && <TeamProfileSection key={reloadKey} ctx={ctx} />}
    {shown === 'players' && <TeamPlayersSection ctx={ctx} />}
    {shown === 'invitations' && <TeamInvitationsSection ctx={ctx} />}
    {shown === 'tournaments' && <TeamTournamentsSection ctx={ctx} details={details} />}
    {shown === 'applications' && <TeamApplicationsSection ctx={ctx} />}
    {shown === 'rosters' && <TeamRostersSection ctx={ctx} />}
    {shown === 'matches' && <TeamFixturesSection ctx={ctx} />}
    {shown === 'statistics' && <TeamStatsSection ctx={ctx} />}
    {shown === 'finance' && <TeamFinanceSection ctx={ctx} onChanged={reload} />}
    {shown === 'documents' && <TeamDocumentsSection ctx={ctx} onChanged={reload} />}
    {shown === 'notifications' && <TeamNotificationsSection ctx={ctx} onMarkRead={id => void markRead(id)} onMarkAll={() => void markAll()} />}
    {shown === 'staff' && <TeamStaffSection ctx={ctx} />}
    {shown === 'public' && <TeamPublicSection ctx={ctx} />}
    {shown === 'settings' && <TeamSettingsSection ctx={ctx} onLeft={() => { window.location.hash = '#workspace' }} />}
  </WorkspaceShell>
}
