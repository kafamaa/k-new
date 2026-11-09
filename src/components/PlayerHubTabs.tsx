import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ArrowRight, Award, BarChart3, BellOff, BellRing, CalendarClock, CalendarDays, Check, CheckCheck, CircleAlert, CircleCheck, ClipboardList, Clock3, ExternalLink,
  Eye, EyeOff, FileText, Filter, Flag, Globe2, HelpCircle, History, Lock, Mail, MapPin, MessageSquare, Radio, RotateCcw, Send, Shield, ShieldCheck, Star, Timer, Trophy, UserRound, Users, X,
} from 'lucide-react'
import type { PlayerWorkspaceData } from '../lib/playerWorkspace'
import { RATING_MAX, RATING_METHOD_SUMMARY, type RatingResult } from '../lib/playerRating'
import {
  breakdownStatistics, cancelPlayerRequest, CATEGORY_TABS, dayGroupLabel, EMPTY_STAT_FILTERS, filterMatchesForStats, filterStatisticRows, groupMatches, loadNotificationPreferences, loadRequestTypes,
  MATCH_BUCKET_LABELS, matchOutcome, matchStatusText, NEEDS_030, nextMilestones, NOTIFICATION_CATEGORIES, notificationCategory, opponentOf, playerTournamentStatus, readRequestDraft, REQUEST_STATUS_LABELS,
  REQUEST_TYPE_LABELS, REQUEST_TYPES, requestNextAction, requestRecipient, requestTone, resubmitPlayerRequest, saveNotificationPreferences, submitPlayerRequest, sumMatches, sumStatistics, TEAM_LEVEL_LABELS,
  TOURNAMENT_STATUS_LABELS, writeRequestDraft,
  type BreakdownKey, type MatchBucket, type NotificationCategory, type NotificationPreferences, type RequestType, type StatFilters, type TournamentCard, type WorkspaceMatch,
} from '../lib/playerHub'
import type { TeamInvitation } from '../lib/playerSections'
import { tournamentItems } from '../lib/playerHome'
import { activeGuardianScopes, GUARDIAN_RELATIONSHIP_LABELS, loadGuardianApprovals } from '../lib/identity'
import { formatMaldivesDateTime } from '../lib/publicData'
import { formatDay, sportName } from '../lib/display'
import { Crest } from './Editorial'
import { Card, Empty, Pending, Pill, Segments } from './HubUi'

// Shared context every player tab reads from. The workspace owns loading;
// tabs only display, filter and send the player's own actions.
export type Hub = {
  client: SupabaseClient; userId: string; playerId: string
  data: PlayerWorkspaceData
  matches: WorkspaceMatch[]; matchesAvailable: boolean
  tournaments: Map<string, TournamentCard>
  invitations: TeamInvitation[]
  documentsNeedingAction: number
  name: string; photo: string; initials: string; slug: string; isPublished: boolean
  position: string | null; sport: string | null; jersey: number | null
  completion: { percent: number; missing: string[]; completed: number; total: number }
  currentTeamName: string | null
  totals: { appearances: number; goals: number; assists: number; yellow: number; red: number }
  rating: RatingResult
  open: (tab: string) => void
  reload: () => void
}

const one = (value: unknown): Record<string, unknown> | null => Array.isArray(value) ? (value[0] as Record<string, unknown> | undefined) ?? null : value && typeof value === 'object' ? value as Record<string, unknown> : null
const when = (iso: string | null | undefined) => iso ? formatMaldivesDateTime(iso) : 'Date to be confirmed'
const NOW = () => new Date().toISOString()

// --- Header (every tab except My Profile, which has its own hero) ------------------
export function PlayerHeader({ hub, code = null, claimLabel, actions }: { hub: Hub; code?: string | null; claimLabel?: string; actions?: ReactNode }) {
  const claimed = hub.data.profile.is_claimed === true
  return <header className="pw-header">
    <div className="pw-header-photo">{hub.photo ? <img src={hub.photo} alt={`${hub.name} photo`} /> : <span>{hub.initials}</span>}</div>
    <div className="pw-header-body">
      <div className="pw-header-title"><h2>{hub.name}</h2><Pill tone={hub.isPublished ? 'ok' : 'muted'}>{hub.isPublished ? <Eye size={12} /> : <EyeOff size={12} />} {hub.isPublished ? 'Public' : 'Private'}</Pill><Pill tone={claimed ? 'ok' : 'warn'}><ShieldCheck size={12} /> {claimLabel ?? (claimed ? 'Claimed' : 'Unclaimed')}</Pill></div>
      <p>{[hub.currentTeamName ?? 'No active team', hub.sport, hub.position, hub.jersey !== null ? `#${hub.jersey}` : null].filter(Boolean).join(' · ')}{code ? <span className="pw-code"> · {code}</span> : null}</p>
      <div className="pw-header-progress"><span style={{ width: `${hub.completion.percent}%` }} /></div>
      <small>Profile completion {hub.completion.percent}%</small>
    </div>
    <div className="pw-header-actions">
      {actions ?? <a className="ed-btn ed-btn-sm pw-glass-btn" href={`#player/${encodeURIComponent(hub.slug)}`}><Eye size={14} /> Preview public profile</a>}
    </div>
  </header>
}

// --- Overview --------------------------------------------------------------------
export function OverviewTab({ hub }: { hub: Hub }) {
  const groups = groupMatches(hub.matches, NOW())
  const next = groups.live[0] ?? groups.upcoming[0] ?? null
  const recent = groups.completed.filter(match => match.resultConfirmed).slice(0, 5)
  const pendingInvites = hub.invitations.filter(item => item.status === 'pending')
  const changes = (hub.data.correctionRequests ?? []).filter(row => row.status === 'changes_requested').length
  const activeTeams = hub.data.teams.filter(row => row.status === 'active' || row.status === 'loaned')
  const notices = (hub.data.notifications ?? []).slice(0, 3)

  // One clear next action, in the order the spec lists them.
  const action = pendingInvites.length ? { label: `Review your invitation from ${pendingInvites[0].teamName}`, hint: 'Accepting adds a dated team membership. Your earlier history stays.', text: 'Open Teams', tab: 'teams' }
    : hub.documentsNeedingAction ? { label: 'Submit a required document', hint: `${hub.documentsNeedingAction} document${hub.documentsNeedingAction === 1 ? ' needs' : 's need'} a new file or changes.`, text: 'Open Documents', tab: 'documents' }
    : changes ? { label: 'Correct your returned request', hint: 'A reviewer asked for changes before deciding.', text: 'Open Requests', tab: 'requests' }
    : hub.completion.missing.length ? { label: 'Complete your profile', hint: `Missing: ${hub.completion.missing.join(', ').toLowerCase()}.`, text: 'Complete profile', tab: 'profile' }
    : next ? { label: `Get ready: ${opponentOf(next).name}`, hint: `${when(next.scheduledAt)} · ${next.tournamentName}`, text: 'View match', tab: 'matches' }
    : null

  const attention = [
    ...pendingInvites.map(item => ({ key: `i-${item.id}`, label: `Team invitation from ${item.teamName}`, tab: 'teams' })),
    ...(hub.data.teamRequests ?? []).filter(row => row.status === 'pending').map(row => ({ key: `t-${String(row.id)}`, label: `Join request to ${String(one(row.teams)?.name ?? 'team')} is waiting`, tab: 'requests' })),
    ...(changes ? [{ key: 'c', label: `${changes} request${changes === 1 ? '' : 's'} returned for changes`, tab: 'requests' }] : []),
    ...(hub.documentsNeedingAction ? [{ key: 'd', label: `${hub.documentsNeedingAction} document${hub.documentsNeedingAction === 1 ? '' : 's'} need attention`, tab: 'documents' }] : []),
    ...(hub.data.profile.is_claimed !== true ? [{ key: 'claim', label: 'Claim your profile to confirm it is yours', tab: 'privacy' }] : []),
    ...(!hub.isPublished ? [{ key: 'pub', label: 'Your profile is private', tab: 'privacy' }] : []),
  ]

  return <div className="pw-page" role="tabpanel">
    {action ? <section className="pw-next">
      <div><p className="pf-eyebrow">Next action</p><h2>{action.label}</h2><p>{action.hint}</p></div>
      <button type="button" className="ed-btn ed-btn-primary" onClick={() => hub.open(action.tab)}>{action.text} <ArrowRight size={16} /></button>
    </section> : <section className="pw-next calm"><div><p className="pf-eyebrow">All set</p><h2>Nothing needs your attention</h2><p>New invitations, documents and fixtures appear here first.</p></div></section>}

    <div className="pw-rail" role="list" aria-label="Summary">
      {[
        { label: 'Matches played', value: hub.totals.appearances, icon: <CalendarDays size={16} />, tab: 'matches' },
        { label: 'Goals', value: hub.totals.goals, icon: <Trophy size={16} />, tab: 'statistics' },
        { label: 'Assists', value: hub.totals.assists, icon: <Users size={16} />, tab: 'statistics' },
        { label: 'Current teams', value: activeTeams.length, icon: <Shield size={16} />, tab: 'teams' },
        { label: 'Upcoming matches', value: hub.matchesAvailable ? groups.upcoming.length + groups.live.length : '—', icon: <CalendarClock size={16} />, tab: 'matches' },
        { label: 'Achievements', value: hub.data.milestones.length, icon: <Award size={16} />, tab: 'achievements' },
      ].map(item => <button type="button" role="listitem" key={item.label} className="pw-stat" onClick={() => hub.open(item.tab)}><span className="pw-stat-icon">{item.icon}</span><b>{item.value}</b><small>{item.label}</small></button>)}
    </div>
    <p className="pw-footnote"><ShieldCheck size={13} /> Only confirmed official records are counted.</p>

    <div className="pw-grid">
      <Card icon={<CalendarClock size={18} />} title="Next match" sub={next ? next.tournamentName : undefined} action={next ? <button type="button" className="ed-link-btn" onClick={() => hub.open('matches')}>View match <ArrowRight size={13} /></button> : undefined}>
        {next ? <NextMatchBody match={next} /> : <Empty icon={<CalendarDays size={20} />}>{hub.matchesAvailable ? 'No upcoming match for your teams yet.' : `Upcoming fixtures appear once migration 030 is applied.`}</Empty>}
      </Card>
      <Card icon={<UserRound size={18} />} title="Profile completion" sub={`${hub.completion.completed} of ${hub.completion.total} done`} action={hub.completion.missing.length ? <button type="button" className="ed-link-btn" onClick={() => hub.open('profile')}>Complete profile <ArrowRight size={13} /></button> : undefined}>
        <div className="pw-ring-row">
          <div className="pw-ring" style={{ ['--pct' as string]: `${hub.completion.percent}` }}><span>{hub.completion.percent}%</span></div>
          {hub.completion.missing.length ? <ul className="pw-missing">{hub.completion.missing.map(item => <li key={item}><CircleAlert size={13} /> {item}</li>)}</ul> : <p className="pw-ok-text"><CircleCheck size={15} /> Your profile is complete.</p>}
        </div>
      </Card>
      <Card icon={<Shield size={18} />} title="Current team" action={<button type="button" className="ed-link-btn" onClick={() => hub.open('teams')}>All teams <ArrowRight size={13} /></button>}>
        {activeTeams.length ? <ul className="pw-mini-list">{activeTeams.slice(0, 3).map(row => { const team = one(row.teams); return <li key={String(row.id ?? row.team_id)}><Crest name={String(team?.name ?? 'Team')} logoUrl={(team?.logo_url as string | null) ?? null} size="sm" /><span><strong>{String(team?.name ?? 'Team')}</strong><small>{[TEAM_LEVEL_LABELS[String(team?.team_type ?? '')] ?? null, hub.position, `since ${formatDay(row.effective_from) ?? '—'}`].filter(Boolean).join(' · ')}</small></span><Pill tone="ok">{String(row.status) === 'loaned' ? 'On loan' : 'Active'}</Pill></li> })}</ul>
          : <Empty icon={<Users size={20} />}>No active team yet. Accept an invitation or send a join request.</Empty>}
      </Card>
      <Card icon={<CircleAlert size={18} />} title="Attention required" sub={attention.length ? `${attention.length} item${attention.length === 1 ? '' : 's'}` : undefined}>
        {attention.length ? <ul className="pw-tasks">{attention.slice(0, 5).map(item => <li key={item.key}><button type="button" onClick={() => hub.open(item.tab)}><span>{item.label}</span><ArrowRight size={14} /></button></li>)}</ul> : <Empty>Nothing needs your attention.</Empty>}
      </Card>
      <Card icon={<BarChart3 size={18} />} title="Recent performance" sub="Last confirmed matches" action={<button type="button" className="ed-link-btn" onClick={() => hub.open('statistics')}>Statistics <ArrowRight size={13} /></button>}>
        {recent.length ? <ul className="pw-form-list">{recent.map(match => { const outcome = matchOutcome(match); return <li key={match.id}>
          <span className={`pw-outcome o-${outcome ?? 'n'}`}>{outcome ?? '–'}</span>
          <span className="pw-form-main"><strong>vs {opponentOf(match).name}</strong><small>{formatDay(match.scheduledAt) ?? ''} · {match.homeScore ?? '–'}–{match.awayScore ?? '–'}</small></span>
          <span className="pw-form-stats">{match.participated ? <>{match.goals ? <b title="Goals">{match.goals}G</b> : null}{match.assists ? <b title="Assists">{match.assists}A</b> : null}{match.minutes !== null ? <small>{match.minutes}′</small> : null}</> : <small>Did not play</small>}</span>
        </li> })}</ul> : <Empty icon={<BarChart3 size={20} />}>Confirmed results appear here after organizers confirm them.</Empty>}
      </Card>
      <Card icon={<BellRing size={18} />} title="Latest notifications" action={<button type="button" className="ed-link-btn" onClick={() => hub.open('notifications')}>All <ArrowRight size={13} /></button>}>
        {notices.length ? <ul className="pw-notice-mini">{notices.map(row => <li key={String(row.id)} className={row.read_at == null ? 'unread' : ''}><strong>{String(row.title ?? 'Notice')}</strong><small>{formatDay(row.created_at)}</small></li>)}</ul> : <Empty icon={<BellRing size={20} />}>No notifications yet.</Empty>}
      </Card>
    </div>
  </div>
}

function NextMatchBody({ match }: { match: WorkspaceMatch }) {
  const opponent = opponentOf(match)
  return <div className="pw-nextmatch">
    <div className="pw-vs"><Crest name={opponent.name} logoUrl={opponent.logo} size="md" /><div><small>{opponent.home ? 'Home vs' : 'Away at'}</small><strong>{opponent.name}</strong></div></div>
    <ul className="pw-facts">
      <li><CalendarDays size={14} /> {when(match.scheduledAt)} <em>Maldives time</em></li>
      {match.venue && <li><MapPin size={14} /> {match.venue}</li>}
      <li>{match.status === 'live' ? <><Radio size={14} /> Live now</> : <><Clock3 size={14} /> {matchStatusText(match.status, match.resultConfirmed)}</>}</li>
    </ul>
  </div>
}

// --- Matches ---------------------------------------------------------------------
export function MatchesTab({ hub }: { hub: Hub }) {
  const groups = groupMatches(hub.matches, NOW())
  const [bucket, setBucket] = useState<MatchBucket>(groups.live.length ? 'live' : groups.upcoming.length ? 'upcoming' : 'completed')
  const items = groups[bucket]
  return <div className="pw-page" role="tabpanel">
    <Segments label="Match groups" active={bucket} onChange={setBucket} items={(['upcoming', 'live', 'completed', 'postponed'] as MatchBucket[]).map(id => ({ id, label: MATCH_BUCKET_LABELS[id], count: groups[id].length }))} />
    {!hub.matchesAvailable && <Pending>Only confirmed appearances are readable until migration 030 is applied. Upcoming, live and postponed fixtures, opponents and scores appear after that.</Pending>}
    {items.length ? <ul className="pw-matches">{items.map(match => <MatchCard key={match.id} match={match} hub={hub} />)}</ul>
      : <Empty icon={<CalendarDays size={22} />}>{bucket === 'upcoming' ? 'No upcoming matches for your teams.' : bucket === 'live' ? 'None of your matches is live right now.' : bucket === 'completed' ? 'No completed matches yet.' : 'No postponed or cancelled matches.'}</Empty>}
    <p className="pw-footnote"><ShieldCheck size={13} /> Only confirmed results enter your official history. A corrected result replaces the earlier one.</p>
  </div>
}

export function MatchCard({ match, hub, extra }: { match: WorkspaceMatch; hub: Hub; extra?: ReactNode }) {
  const opponent = opponentOf(match)
  const outcome = matchOutcome(match)
  const bucket = groupMatches([match], NOW())
  const done = bucket.completed.length > 0
  const myTeam = match.teamId === match.homeTeamId ? match.homeTeamName : match.awayTeamName
  const date = match.scheduledAt ? new Date(match.scheduledAt) : null
  const tournament = hub.tournaments.get(match.tournamentId)
  const publicMatch = match.resultConfirmed && tournament?.isPublished
  return <li className={`pw-match${match.status === 'live' ? ' live' : ''}`}>
    <div className="pw-match-date">{date ? <><b>{new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Maldives', day: 'numeric' }).format(date)}</b><small>{new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Maldives', month: 'short' }).format(date)}</small><em>{new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Maldives', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)}</em></> : <small>TBC</small>}</div>
    <div className="pw-match-body">
      <p className="pw-match-meta">{match.tournamentName}{match.sport ? ` · ${sportName(match.sport)}` : ''}</p>
      <div className="pw-match-teams">
        <span className={match.teamId === match.homeTeamId ? 'mine' : ''}><Crest name={match.homeTeamName} logoUrl={match.homeTeamLogo} size="sm" /> {match.homeTeamName}</span>
        <b className="pw-score">{done && match.homeScore !== null ? `${match.homeScore} – ${match.awayScore}` : 'vs'}</b>
        <span className={match.teamId === match.awayTeamId ? 'mine' : ''}><Crest name={match.awayTeamName} logoUrl={match.awayTeamLogo} size="sm" /> {match.awayTeamName}</span>
      </div>
      <p className="pw-match-sub">{match.venue ? <><MapPin size={12} /> {match.venue} · </> : null}Playing for {myTeam} · vs {opponent.name}</p>
      {done && match.resultConfirmed && <div className="pw-chips">
        {match.participated ? <>
          <span className="pw-chip">{match.starter ? 'Started' : 'Substitute'}</span>
          {match.minutes !== null && <span className="pw-chip"><Timer size={12} /> {match.minutes} min</span>}
          <span className="pw-chip">{match.goals} goal{match.goals === 1 ? '' : 's'}</span>
          <span className="pw-chip">{match.assists} assist{match.assists === 1 ? '' : 's'}</span>
          {match.yellow + match.red > 0 && <span className="pw-chip cards">{match.yellow ? <i className="card-y" /> : null}{match.red ? <i className="card-r" /> : null} {match.yellow + match.red} card{match.yellow + match.red === 1 ? '' : 's'}</span>}
        </> : <span className="pw-chip muted">Not in the confirmed lineup</span>}
      </div>}
      {extra}
    </div>
    <div className="pw-match-side">
      {outcome ? <span className={`pw-outcome o-${outcome}`}>{outcome}</span> : null}
      <Pill tone={match.status === 'live' ? 'live' : match.resultConfirmed ? 'ok' : ['postponed', 'cancelled', 'abandoned'].includes(match.status) ? 'bad' : match.status === 'awaiting_confirmation' ? 'warn' : 'info'}>{matchStatusText(match.status, match.resultConfirmed)}</Pill>
      {publicMatch ? <a className="ed-link" href={`#match/${encodeURIComponent(match.id)}`}>View match <ArrowRight size={13} /></a> : tournament?.isPublished && tournament.slug ? <a className="ed-link" href={`#tournament/${encodeURIComponent(tournament.slug)}?tab=results`}>Tournament <ArrowRight size={13} /></a> : null}
    </div>
  </li>
}

// --- Statistics ------------------------------------------------------------------
export function StatisticsTab({ hub }: { hub: Hub }) {
  const rows = hub.data.statistics
  const [filters, setFilters] = useState<StatFilters>(EMPTY_STAT_FILTERS)
  const [breakdown, setBreakdown] = useState<BreakdownKey>('team_type')
  const [showFilters, setShowFilters] = useState(false)
  const [seasonNames, setSeasonNames] = useState<Map<string, string>>(new Map())
  const teamNames = useMemo(() => new Map(hub.data.teams.map(row => [String(row.team_id), String(one(row.teams)?.name ?? 'Team')])), [hub.data.teams])
  const seasonIds = useMemo(() => [...new Set(rows.map(row => String(row.season_id ?? '')).filter(Boolean))], [rows])
  useEffect(() => {
    if (!seasonIds.length) return
    let active = true
    void hub.client.from('seasons').select('id,name').in('id', seasonIds).then(result => { if (active && !result.error) setSeasonNames(new Map(((result.data ?? []) as Record<string, unknown>[]).map(row => [String(row.id), String(row.name ?? 'Season')]))) })
    return () => { active = false }
  }, [hub.client, seasonIds])

  const options = (key: string) => [...new Set(rows.map(row => String(row[key] ?? '')).filter(Boolean))]
  const label = (key: BreakdownKey, value: string) => !value ? 'Not set' : key === 'team_type' ? TEAM_LEVEL_LABELS[value] ?? value : key === 'team_id' ? teamNames.get(value) ?? 'Team' : key === 'tournament_id' ? hub.tournaments.get(value)?.name ?? 'Tournament' : key === 'season_id' ? seasonNames.get(value) ?? 'Season' : sportName(value)
  const dated = Boolean(filters.from || filters.to)
  const filteredRows = filterStatisticRows(rows, filters)
  const totals = dated ? sumMatches(filterMatchesForStats(hub.matches, filters)) : sumStatistics(filteredRows)
  const active = Object.values(filters).some(Boolean)
  const set = (patch: Partial<StatFilters>) => setFilters(current => ({ ...current, ...patch }))
  const stars = hub.rating.status === 'rated' ? hub.rating.stars : 0
  const per90 = totals.minutes > 0 ? ((totals.goals + totals.assists) / totals.minutes * 90).toFixed(2) : null

  return <div className="pw-page" role="tabpanel">
    <div className="pw-filter-bar"><button type="button" className={`ed-btn ed-btn-ghost ed-btn-sm${active ? ' active' : ''}`} aria-expanded={showFilters} onClick={() => setShowFilters(value => !value)}><Filter size={14} /> Filter{active ? ` (${Object.values(filters).filter(Boolean).length})` : ''}</button>{active && <button type="button" className="ed-link-btn" onClick={() => setFilters(EMPTY_STAT_FILTERS)}><RotateCcw size={13} /> Reset</button>}</div>
    {showFilters && <Card icon={<Filter size={18} />} title="Filters">
      <div className="pw-filters">
        <label className="pf-field">Sport<select value={filters.sport} onChange={event => set({ sport: event.target.value })}><option value="">All sports</option>{options('sport').map(value => <option key={value} value={value}>{sportName(value)}</option>)}</select></label>
        <label className="pf-field">Season<select value={filters.seasonId} onChange={event => set({ seasonId: event.target.value })}><option value="">All seasons</option>{options('season_id').map(value => <option key={value} value={value}>{seasonNames.get(value) ?? 'Season'}</option>)}</select></label>
        <label className="pf-field">Tournament<select value={filters.tournamentId} onChange={event => set({ tournamentId: event.target.value })}><option value="">All tournaments</option>{options('tournament_id').map(value => <option key={value} value={value}>{hub.tournaments.get(value)?.name ?? 'Tournament'}</option>)}</select></label>
        <label className="pf-field">Team<select value={filters.teamId} onChange={event => set({ teamId: event.target.value })}><option value="">All teams</option>{options('team_id').map(value => <option key={value} value={value}>{teamNames.get(value) ?? 'Team'}</option>)}</select></label>
        <label className="pf-field">Team level<select value={filters.teamLevel} onChange={event => set({ teamLevel: event.target.value })}><option value="">All levels</option>{options('team_type').map(value => <option key={value} value={value}>{TEAM_LEVEL_LABELS[value] ?? value}</option>)}</select></label>
        <label className="pf-field">From<input type="date" value={filters.from} disabled={!hub.matchesAvailable} onChange={event => set({ from: event.target.value })} /></label>
        <label className="pf-field">To<input type="date" value={filters.to} disabled={!hub.matchesAvailable} onChange={event => set({ to: event.target.value })} /></label>
      </div>
      {!hub.matchesAvailable && <Pending>Date ranges use per-match records and need migration 030.</Pending>}
      {dated && filters.teamLevel && <Pending>Team level is not applied inside a date range.</Pending>}
    </Card>}

    {rows.length ? <>
      <div className="pw-kpis">
        {[['Appearances', totals.appearances], ['Starts', totals.starts], ['Minutes', totals.minutes], ['Goals', totals.goals], ['Assists', totals.assists], ['Yellow cards', totals.yellow], ['Red cards', totals.red]].map(([name, value]) => <div key={String(name)} className="pw-kpi"><b>{value}</b><small>{name}</small></div>)}
        <div className="pw-kpi accent">{per90 ? <><b>{per90}</b><small>Goals + assists / 90</small></> : <><b>—</b><small>Per 90 needs minutes</small></>}</div>
      </div>
      <Card icon={<Star size={18} />} title="Player rating" sub={hub.rating.status === 'rated' ? `From ${hub.rating.appearances} confirmed appearances` : 'Insufficient data'}>
        {hub.rating.status === 'rated' ? <div className="pw-rating"><b>{hub.rating.value.toFixed(2)}</b><span>/ {RATING_MAX}</span><span className="pw-stars" aria-label={`${hub.rating.stars} of 5 stars`}>{[1, 2, 3, 4, 5].map(star => <Star key={star} size={16} className={star <= stars ? 'on' : ''} />)}</span></div> : <p className="pf-hint">Insufficient data. {hub.rating.status === 'insufficient_data' ? hub.rating.reason : ''}</p>}
        <details className="pw-details"><summary>How it is calculated</summary><p>{RATING_METHOD_SUMMARY}</p></details>
      </Card>
      <Card icon={<BarChart3 size={18} />} title="Breakdown" sub="Totals split by" action={undefined}>
        <Segments label="Breakdown" active={breakdown} onChange={setBreakdown} items={[{ id: 'team_type', label: 'Team level' }, { id: 'team_id', label: 'Team' }, { id: 'tournament_id', label: 'Tournament' }, { id: 'season_id', label: 'Season' }, { id: 'sport', label: 'Sport' }]} />
        <div className="pw-table-wrap"><table className="pw-table">
          <thead><tr><th>{{ team_type: 'Level', team_id: 'Team', tournament_id: 'Tournament', season_id: 'Season', sport: 'Sport' }[breakdown]}</th><th>Apps</th><th>Starts</th><th>Min</th><th>G</th><th>A</th><th>Y</th><th>R</th></tr></thead>
          <tbody>{breakdownStatistics(filteredRows, breakdown).map(group => <tr key={group.key}><td>{label(breakdown, group.key)}</td><td>{group.totals.appearances}</td><td>{group.totals.starts}</td><td>{group.totals.minutes}</td><td>{group.totals.goals}</td><td>{group.totals.assists}</td><td>{group.totals.yellow}</td><td>{group.totals.red}</td></tr>)}</tbody>
        </table></div>
      </Card>
    </> : <Empty icon={<BarChart3 size={22} />}>{hub.data.unavailable.includes('Statistics') ? 'Statistics are unavailable right now.' : 'No confirmed statistics yet. Numbers appear only after match results are confirmed.'}</Empty>}
    <p className="pw-footnote"><ShieldCheck size={13} /> Calculated from confirmed match records only. Corrected results replace earlier values and are never counted twice. Clean sheets and saves appear when the sport’s match records capture them.</p>
  </div>
}

// --- Teams -----------------------------------------------------------------------
export function TeamsTab({ hub, invitations, joinForm }: { hub: Hub; invitations: ReactNode; joinForm: ReactNode }) {
  const statsByTeam = new Map(breakdownStatistics(hub.data.statistics, 'team_id').map(group => [group.key, group.totals]))
  const sportsByTeam = new Map<string, Set<string>>()
  for (const row of hub.data.statistics) { const id = String(row.team_id ?? ''); if (!id || !row.sport) continue; sportsByTeam.set(id, new Set([...(sportsByTeam.get(id) ?? []), String(row.sport)])) }
  const trophiesByTeam = new Map<string, number>()
  for (const item of hub.data.milestones) { const id = String(item.team_id ?? ''); if (id) trophiesByTeam.set(id, (trophiesByTeam.get(id) ?? 0) + 1) }
  const sorted = [...hub.data.teams].sort((a, b) => String(b.effective_from ?? '').localeCompare(String(a.effective_from ?? '')))
  const current = sorted.filter(row => !row.effective_to && row.status !== 'ended')
  const history = sorted.filter(row => row.effective_to || row.status === 'ended')
  const teamLink = (team: Record<string, unknown> | null, children: ReactNode) => team?.is_published === true && team.slug ? <a href={`#team/${encodeURIComponent(String(team.slug))}`}>{children}</a> : <>{children}</>

  return <div className="pw-page" role="tabpanel">
    {invitations}
    <Card icon={<Shield size={18} />} title="Current teams" sub={current.length ? `${current.length} active membership${current.length === 1 ? '' : 's'}` : undefined}>
      {current.length ? <div className="pw-team-grid">{current.map(row => { const team = one(row.teams); const id = String(row.team_id); const sports = [...(sportsByTeam.get(id) ?? [])].map(sportName); return <article key={String(row.id ?? id)} className="pw-team">
        <div className="pw-team-head"><Crest name={String(team?.name ?? 'Team')} logoUrl={(team?.logo_url as string | null) ?? null} size="lg" /><div><strong>{teamLink(team, String(team?.name ?? 'Team'))}</strong><small>{TEAM_LEVEL_LABELS[String(team?.team_type ?? '')] ?? 'Team'}</small></div><Pill tone="ok">{row.status === 'loaned' ? 'On loan' : 'Active'}</Pill></div>
        <dl className="pw-dl">
          <div><dt>Sport</dt><dd>{sports.length ? sports.join(', ') : hub.sport ?? '—'}</dd></div>
          <div><dt>Position</dt><dd>{hub.position ?? '—'}</dd></div>
          <div><dt>Jersey</dt><dd>{hub.jersey !== null ? `#${hub.jersey}` : '—'}</dd></div>
          <div><dt>Since</dt><dd>{formatDay(row.effective_from) ?? '—'}</dd></div>
        </dl>
        {team?.is_published === true && team.slug ? <a className="ed-link" href={`#team/${encodeURIComponent(String(team.slug))}`}>Team page <ArrowRight size={13} /></a> : <small className="pf-hint"><Lock size={12} /> Team page is not public</small>}
      </article> })}</div> : <Empty icon={<Users size={22} />}>No current team. Accept an invitation above or send a join request below.</Empty>}
    </Card>
    <Card icon={<History size={18} />} title="Team history" sub="Earlier memberships are never deleted">
      {history.length ? <ol className="pw-timeline">{history.map(row => { const team = one(row.teams); const id = String(row.team_id); const totals = statsByTeam.get(id); return <li key={String(row.id ?? `${id}-${String(row.effective_from)}`)}>
        <span className="pw-timeline-dot" />
        <div className="pw-timeline-body">
          <div className="pw-timeline-head"><Crest name={String(team?.name ?? 'Team')} logoUrl={(team?.logo_url as string | null) ?? null} size="sm" /><strong>{teamLink(team, String(team?.name ?? 'Team'))}</strong><small>{formatDay(row.effective_from) ?? '—'} – {formatDay(row.effective_to) ?? 'ended'}</small></div>
          <div className="pw-chips"><span className="pw-chip">{totals?.appearances ?? 0} matches</span><span className="pw-chip">{totals?.goals ?? 0} goals</span><span className="pw-chip">{totals?.assists ?? 0} assists</span>{trophiesByTeam.get(id) ? <span className="pw-chip gold"><Trophy size={12} /> {trophiesByTeam.get(id)} honour{trophiesByTeam.get(id) === 1 ? '' : 's'}</span> : null}</div>
        </div>
      </li> })}</ol> : <Empty icon={<History size={22} />}>No previous teams yet. When you move teams, the old membership stays here with its dates.</Empty>}
    </Card>
    {joinForm}
  </div>
}

// --- Tournaments -------------------------------------------------------------------
export function TournamentsTab({ hub }: { hub: Hub }) {
  const list = tournamentItems(hub)
  return <div className="pw-page" role="tabpanel">
    {hub.data.rosterRows === null && <Pending>Roster status becomes readable after the profile-requests migration is applied.</Pending>}
    {list.length ? <div className="pw-tour-grid">{list.map(item => {
      const card = hub.tournaments.get(item.id)
      const status = playerTournamentStatus({ applicationStatus: item.applicationStatus, rosterStatus: item.rosterStatus, tournamentStatus: card?.status })
      const base = card?.isPublished && card.slug ? `#tournament/${encodeURIComponent(card.slug)}` : null
      return <article key={item.id} className="pw-tour">
        <div className="pw-tour-cover" style={card?.coverUrl ? { backgroundImage: `url("${card.coverUrl}")` } : undefined}>
          <span className="pw-tour-logo">{card?.logoUrl ? <img src={card.logoUrl} alt="" /> : <Trophy size={20} />}</span>
          <Pill tone={status.tone}>{status.label}</Pill>
        </div>
        <div className="pw-tour-body">
          <h4>{card?.name ?? 'Tournament'}</h4>
          <p className="pw-match-meta">{[card?.sport ? sportName(card.sport) : null, card ? TOURNAMENT_STATUS_LABELS[card.status] ?? card.status : null].filter(Boolean).join(' · ')}</p>
          <dl className="pw-dl">
            <div><dt>Team</dt><dd>{item.teamName ?? '—'}</dd></div>
            <div><dt>Shirt</dt><dd>{item.shirt ? `#${item.shirt}` : '—'}</dd></div>
            <div><dt>Starts</dt><dd>{formatDay(card?.startsAt) ?? '—'}</dd></div>
            <div><dt>Roster sent</dt><dd>{formatDay(item.submittedAt) ?? '—'}</dd></div>
          </dl>
          {item.appearances > 0 && <p className="pf-hint"><CircleCheck size={13} /> {item.appearances} confirmed appearance{item.appearances === 1 ? '' : 's'}</p>}
          {item.rosterNote && <p className="pw-note-box"><MessageSquare size={13} /> Organizer note: {item.rosterNote}</p>}
          {base ? <div className="pw-link-row"><a href={`${base}?tab=results`}>Fixtures</a><a href={`${base}?tab=standings`}>Standings</a><a href={`${base}?tab=bracket`}>Bracket</a><a href={base}><ExternalLink size={12} /> Open</a></div> : <small className="pf-hint"><Lock size={12} /> Tournament page is not public yet</small>}
        </div>
      </article>
    })}</div> : <Empty icon={<Trophy size={22} />}>No tournaments yet. Tournaments appear once a team includes you in an approved roster or you play an official match.</Empty>}
    <p className="pw-footnote"><Lock size={13} /> Players cannot approve their own roster entry. Team managers submit rosters and organizers approve them.</p>
  </div>
}

// --- Requests ------------------------------------------------------------------------
type RequestRow = { key: string; kind: 'correction' | 'team' | 'invitation'; id: string; type: string; title: string; status: string; createdAt: string | null; recipient: string; note: string | null; message: string | null }

export function RequestsTab({ hub, preset, onPresetUsed }: { hub: Hub; preset: RequestType | null; onPresetUsed: () => void }) {
  const [types, setTypes] = useState<Map<string, { type: RequestType; teamId: string | null }>>(new Map())
  const [filter, setFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const corrections = useMemo(() => hub.data.correctionRequests ?? [], [hub.data.correctionRequests])
  const correctionIds = corrections.map(row => String(row.id)).join(',')
  useEffect(() => { let active = true; void loadRequestTypes(hub.client, correctionIds ? correctionIds.split(',') : []).then(map => { if (active) setTypes(map) }); return () => { active = false } }, [hub.client, correctionIds])
  const teamNames = new Map([...hub.data.teams.map(row => [String(row.team_id), String(one(row.teams)?.name ?? 'team')] as const), ...(hub.data.teamDirectory ?? []).map(row => [String(row.id), String(row.name)] as const)])

  const rows: RequestRow[] = [
    ...hub.invitations.map(item => ({ key: `i-${item.id}`, kind: 'invitation' as const, id: item.id, type: 'Team invitation', title: `Invitation from ${item.teamName}`, status: item.status, createdAt: item.createdAt, recipient: `Team manager · ${item.teamName}`, note: item.responseNote, message: item.message })),
    ...(hub.data.teamRequests ?? []).map(row => ({ key: `t-${String(row.id)}`, kind: 'team' as const, id: String(row.id), type: 'Team join request', title: `Join ${String(one(row.teams)?.name ?? 'team')}`, status: String(row.status), createdAt: (row.created_at as string | null) ?? null, recipient: `Team manager · ${String(one(row.teams)?.name ?? 'team')}`, note: (row.resolution_note as string | null) ?? null, message: (row.message as string | null) ?? null })),
    ...corrections.map(row => { const typed = types.get(String(row.id)); const teamId = typed?.teamId ?? null; return { key: `c-${String(row.id)}`, kind: 'correction' as const, id: String(row.id), type: typed ? REQUEST_TYPE_LABELS[typed.type] ?? 'Request' : 'Correction request', title: String(row.subject ?? 'Request'), status: String(row.status), createdAt: (row.created_at as string | null) ?? null, recipient: requestRecipient({ tournament_id: row.tournament_id, team_id: teamId }, { tournament: hub.tournaments.get(String(row.tournament_id ?? ''))?.name, team: teamId ? teamNames.get(teamId) : null }), note: (row.resolution_note as string | null) ?? null, message: (row.message as string | null) ?? null } }),
  ].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
  const open = (status: string) => ['pending', 'under_review', 'changes_requested'].includes(status)
  const shown = rows.filter(row => filter === 'all' || (filter === 'open' ? open(row.status) : !open(row.status)))

  const cancel = async (row: RequestRow) => {
    setBusy(row.key); setError(''); setNotice('')
    const result = await cancelPlayerRequest(hub.client, row.kind === 'team' ? 'team' : 'correction', row.id)
    setBusy(null)
    if (result.error) return setError(result.error)
    setNotice('Request cancelled.'); hub.reload()
  }
  const resubmit = async (row: RequestRow) => {
    setBusy(row.key); setError(''); setNotice('')
    const result = await resubmitPlayerRequest(hub.client, row.id, editText)
    setBusy(null)
    if (result.error) return setError(result.error)
    setEditing(null); setEditText(''); setNotice('Sent again for review.'); hub.reload()
  }

  return <div className="pw-page" role="tabpanel">
    <div className="pw-counters">
      <div><b>{rows.filter(row => open(row.status)).length}</b><small>Open</small></div>
      <div><b>{rows.filter(row => row.status === 'changes_requested').length}</b><small>Need your changes</small></div>
      <div><b>{rows.filter(row => ['resolved', 'approved', 'accepted'].includes(row.status)).length}</b><small>Approved</small></div>
      <div><b>{rows.filter(row => ['rejected', 'declined'].includes(row.status)).length}</b><small>Rejected</small></div>
    </div>
    <div className="pw-two">
      <Card icon={<ClipboardList size={18} />} title="My requests" action={<Segments label="Filter requests" active={filter} onChange={setFilter} items={[{ id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed' }, { id: 'all', label: 'All' }]} />}>
        {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
        {notice && <p className="publication-notice" role="status">{notice}</p>}
        {hub.data.correctionRequests === null && <Pending>Correction requests become available once the profile-requests migration is applied.</Pending>}
        {shown.length ? <ul className="pw-requests">{shown.map(row => <li key={row.key}>
          <div className="pw-request-head"><span className="pw-request-type">{row.type}</span><Pill tone={requestTone(row.status)}>{REQUEST_STATUS_LABELS[row.status] ?? row.status}</Pill></div>
          <strong>{row.title}</strong>
          <dl className="pw-dl compact"><div><dt>Sent</dt><dd>{formatDay(row.createdAt) ?? '—'}</dd></div><div><dt>Handled by</dt><dd>{row.recipient}</dd></div></dl>
          {row.note && <p className="pw-note-box"><MessageSquare size={13} /> {row.note}</p>}
          <p className="pf-hint"><ArrowRight size={13} /> {requestNextAction(row.kind, row.status)}</p>
          {editing === row.key ? <div className="pw-inline-form">
            <label className="pf-field">Updated details<textarea rows={3} value={editText} onChange={event => setEditText(event.target.value)} /></label>
            <div className="pw-actions"><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" disabled={busy === row.key} onClick={() => void resubmit(row)}><Send size={13} /> Send again</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setEditing(null)}>Cancel</button></div>
          </div> : <div className="pw-actions">
            {row.kind === 'invitation' && row.status === 'pending' && <button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={() => hub.open('teams')}>Respond in Teams</button>}
            {row.kind === 'correction' && row.status === 'changes_requested' && <button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={() => { setEditing(row.key); setEditText(row.message ?? '') }}><RotateCcw size={13} /> Update and resend</button>}
            {((row.kind === 'correction' && ['pending', 'changes_requested'].includes(row.status)) || (row.kind === 'team' && row.status === 'pending')) && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={busy === row.key} onClick={() => void cancel(row)}><X size={13} /> {row.kind === 'team' ? 'Withdraw' : 'Cancel'}</button>}
          </div>}
        </li>)}</ul> : <Empty icon={<ClipboardList size={22} />}>{filter === 'open' ? 'No open requests.' : 'Nothing here yet.'}</Empty>}
      </Card>
      <NewRequestForm hub={hub} preset={preset} onPresetUsed={onPresetUsed} />
    </div>
  </div>
}

function NewRequestForm({ hub, preset, onPresetUsed }: { hub: Hub; preset: RequestType | null; onPresetUsed: () => void }) {
  const saved = readRequestDraft(hub.playerId)
  const [type, setType] = useState<RequestType>(preset ?? saved?.type ?? 'statistics')
  const [subject, setSubject] = useState(saved?.subject ?? '')
  const [message, setMessage] = useState(saved?.message ?? '')
  const [tournamentId, setTournamentId] = useState(saved?.tournamentId ?? '')
  const [teamId, setTeamId] = useState(saved?.teamId ?? '')
  const [draftAt, setDraftAt] = useState(saved?.savedAt ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => { if (preset) { setType(preset); onPresetUsed() } }, [preset, onPresetUsed])
  const route = REQUEST_TYPES.find(item => item.value === type)
  const tournaments = [...hub.tournaments.values()]
  const teams = [...new Map([...hub.data.teams.map(row => [String(row.team_id), String(one(row.teams)?.name ?? 'Team')] as const)]).entries()]

  const saveDraft = () => { const savedAt = new Date().toISOString(); writeRequestDraft(hub.playerId, { type, subject, message, tournamentId, teamId, savedAt }); setDraftAt(savedAt); setNotice('Draft saved on this device.') }
  const submit = async () => {
    setBusy(true); setError(''); setNotice('')
    const result = await submitPlayerRequest(hub.client, { userId: hub.userId, playerId: hub.playerId, type, subject, message, tournamentId: route?.route === 'tournament' ? tournamentId : '', teamId: route?.route === 'team' ? teamId : '' })
    setBusy(false)
    if (result.error) return setError(result.error)
    writeRequestDraft(hub.playerId, null); setDraftAt(''); setSubject(''); setMessage('')
    setNotice('Request submitted. You will see the reviewer’s response here.'); hub.reload()
  }
  return <Card icon={<Send size={18} />} title="New request" sub={draftAt ? `Draft saved ${formatDay(draftAt)}` : 'Official records change only through review'} className="pw-sticky">
    <div className="pw-type-grid" role="radiogroup" aria-label="Request type">{REQUEST_TYPES.map(item => <button type="button" role="radio" aria-checked={type === item.value} key={item.value} className={type === item.value ? 'active' : ''} onClick={() => setType(item.value)}>{item.label}</button>)}</div>
    {route && <p className="pf-hint"><HelpCircle size={13} /> {route.hint} {route.route === 'admin' ? 'Reviewed by the Kulhivaru+ platform team.' : ''}</p>}
    {route?.route === 'tournament' && <label className="pf-field">Tournament<select value={tournamentId} onChange={event => setTournamentId(event.target.value)}><option value="">Choose a tournament…</option>{tournaments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {route?.route === 'team' && <label className="pf-field">Team<select value={teamId} onChange={event => setTeamId(event.target.value)}><option value="">Choose a team…</option>{teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
    <label className="pf-field">Subject<input value={subject} maxLength={120} onChange={event => setSubject(event.target.value)} placeholder="e.g. Missing goal vs Eydhafushi" /></label>
    <label className="pf-field">Details<textarea rows={4} value={message} onChange={event => setMessage(event.target.value)} placeholder="What is wrong, and what should it be?" /></label>
    {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
    {notice && <p className="publication-notice" role="status">{notice}</p>}
    <footer className="pf-card-foot"><button type="button" className="ed-btn ed-btn-ghost" onClick={saveDraft}><FileText size={14} /> Save draft</button><button type="button" className="ed-btn ed-btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Sending…' : 'Submit request'}</button></footer>
  </Card>
}

// --- Notifications -------------------------------------------------------------------
export function NotificationsTab({ hub, onMarkRead, onMarkAll }: { hub: Hub; onMarkRead: (id: string) => void; onMarkAll: () => void }) {
  const [filter, setFilter] = useState<'all' | 'unread' | NotificationCategory>('all')
  const [prefs, setPrefs] = useState<NotificationPreferences>({ mutedCategories: [], emailEnabled: true })
  const [prefsAvailable, setPrefsAvailable] = useState(true)
  const [showMuted, setShowMuted] = useState(false)
  const [prefNotice, setPrefNotice] = useState('')
  useEffect(() => { let active = true; void loadNotificationPreferences(hub.client, hub.userId).then(result => { if (active) { setPrefs(result.data); setPrefsAvailable(result.available) } }); return () => { active = false } }, [hub.client, hub.userId])
  const all = hub.data.notifications ?? []
  const unread = all.filter(row => row.read_at == null).length
  const present = [...new Set(all.map(row => notificationCategory(row.notification_type)))]
  const visible = all.filter(row => {
    const category = notificationCategory(row.notification_type)
    if (!showMuted && prefs.mutedCategories.includes(category)) return false
    return filter === 'all' || (filter === 'unread' ? row.read_at == null : category === filter)
  })
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of visible) { const key = dayGroupLabel(row.created_at); groups.set(key, [...(groups.get(key) ?? []), row]) }
  const toggleMute = async (category: NotificationCategory) => {
    const next = { ...prefs, mutedCategories: prefs.mutedCategories.includes(category) ? prefs.mutedCategories.filter(item => item !== category) : [...prefs.mutedCategories, category] }
    setPrefs(next); setPrefNotice('')
    const result = await saveNotificationPreferences(hub.client, hub.userId, next)
    setPrefNotice(result.error ?? 'Preferences saved.')
  }
  const toggleEmail = async () => { const next = { ...prefs, emailEnabled: !prefs.emailEnabled }; setPrefs(next); const result = await saveNotificationPreferences(hub.client, hub.userId, next); setPrefNotice(result.error ?? 'Preferences saved.') }
  const icon = (category: NotificationCategory) => ({ teams: <Users size={16} />, rosters: <ClipboardList size={16} />, documents: <FileText size={16} />, matches: <CalendarDays size={16} />, results: <BarChart3 size={16} />, achievements: <Trophy size={16} />, announcements: <Globe2 size={16} /> })[category]
  const link = (row: Record<string, unknown>): { href?: string; tab?: string } => {
    const tournament = hub.tournaments.get(String(row.tournament_id ?? ''))
    const category = notificationCategory(row.notification_type)
    if (tournament?.isPublished && tournament.slug && (category === 'announcements' || category === 'matches')) return { href: `#tournament/${encodeURIComponent(tournament.slug)}` }
    return { tab: CATEGORY_TABS[category] }
  }

  return <div className="pw-page" role="tabpanel">
    <div className="pw-two">
      <Card icon={<BellRing size={18} />} title="Notifications" sub={unread ? `${unread} unread` : 'All caught up'} action={unread ? <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={onMarkAll}><CheckCheck size={14} /> Mark all as read</button> : undefined}>
        <div className="pw-filter-chips">
          {[{ id: 'all' as const, label: 'All' }, { id: 'unread' as const, label: `Unread${unread ? ` (${unread})` : ''}` }, ...present.map(id => ({ id, label: NOTIFICATION_CATEGORIES.find(item => item.value === id)?.label.split(' ')[0] ?? id }))].map(item => <button type="button" key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>{item.label}</button>)}
        </div>
        {hub.data.notifications === null ? <Empty icon={<BellOff size={22} />}>Notifications cannot be loaded right now.</Empty>
          : visible.length ? [...groups.entries()].map(([label, items]) => <div key={label} className="pw-day"><h5>{label}</h5><ul className="pw-notices">{items.map(row => { const category = notificationCategory(row.notification_type); const target = link(row); return <li key={String(row.id)} className={row.read_at == null ? 'unread' : ''}>
            <span className={`pw-notice-icon c-${category}`}>{icon(category)}</span>
            <div className="pw-notice-body"><strong>{String(row.title ?? 'Notice')}</strong><p>{String(row.body ?? '')}</p>
              <small>{formatMaldivesDateTime(String(row.created_at ?? ''))}{hub.tournaments.get(String(row.tournament_id ?? '')) ? ` · ${hub.tournaments.get(String(row.tournament_id ?? ''))?.name}` : ''}{row.channel === 'email' ? <> · <Mail size={11} /> Email {row.state === 'sent' ? 'delivered' : row.state === 'failed' ? 'failed' : 'queued'}</> : null}</small>
            </div>
            <div className="pw-notice-actions">
              {target.href ? <a className="ed-icon-btn" href={target.href} aria-label="Open related record"><ExternalLink size={14} /></a> : <button type="button" className="ed-icon-btn" aria-label="Open related section" onClick={() => target.tab && hub.open(target.tab)}><ArrowRight size={14} /></button>}
              {row.read_at == null && <button type="button" className="ed-icon-btn" aria-label="Mark as read" onClick={() => onMarkRead(String(row.id))}><Check size={14} /></button>}
            </div>
          </li> })}</ul></div>)
          : <Empty icon={<BellRing size={22} />}>{filter === 'unread' ? 'No unread notifications.' : 'No notifications here yet. Organizer updates and team decisions appear here.'}</Empty>}
        {prefs.mutedCategories.length > 0 && <button type="button" className="ed-link-btn" onClick={() => setShowMuted(value => !value)}>{showMuted ? 'Hide muted categories' : 'Show muted categories'}</button>}
      </Card>
      <Card icon={<BellOff size={18} />} title="Preferences" sub="Choose what you see" className="pw-sticky">
        {!prefsAvailable ? <Pending>{NEEDS_030}</Pending> : <>
          <ul className="pw-toggles">{NOTIFICATION_CATEGORIES.map(item => { const on = !prefs.mutedCategories.includes(item.value); return <li key={item.value}><span>{icon(item.value)} {item.label}</span><button type="button" role="switch" aria-checked={on} aria-label={item.label} className={`pw-switch${on ? ' on' : ''}`} onClick={() => void toggleMute(item.value)}><span /></button></li> })}</ul>
          <div className="pf-divider" />
          <ul className="pw-toggles"><li><span><Mail size={16} /> Email copies</span><button type="button" role="switch" aria-checked={prefs.emailEnabled} aria-label="Email copies" className={`pw-switch${prefs.emailEnabled ? ' on' : ''}`} onClick={() => void toggleEmail()}><span /></button></li></ul>
          <p className="pf-hint"><HelpCircle size={13} /> Muted categories are hidden from this list. Email is sent only when the email service is configured; delivery status then shows on each notice.</p>
          {prefNotice && <p className={prefNotice.includes('migration') ? 'pending-note' : 'publication-notice'} role="status">{prefNotice}</p>}
        </>}
      </Card>
    </div>
  </div>
}

// --- Achievements progress (shown above the trophy cabinet) ------------------------
export function MilestoneProgress({ hub }: { hub: Hub }) {
  const items = nextMilestones(hub.totals)
  const trophies = hub.data.milestones.filter(item => String(item.milestone_type ?? '').startsWith('award_')).length
  return <div className="pw-page pw-achieve-top">
    <div className="pw-counters">
      <div><b>{trophies}</b><small>Trophies & awards</small></div>
      <div><b>{hub.data.milestones.length - trophies}</b><small>Automatic achievements</small></div>
      <div><b>{hub.data.milestones.filter(item => item.is_manual).length}</b><small>Organizer-awarded</small></div>
    </div>
    {items.length > 0 && <Card icon={<Award size={18} />} title="Next milestones" sub="From confirmed matches">
      <ul className="pw-progress-list">{items.map(item => <li key={item.label}><div><strong>{item.label}</strong><small>{item.current} / {item.target}</small></div><div className="pw-bar"><span style={{ width: `${Math.min(100, Math.round(item.current / item.target * 100))}%` }} /></div></li>)}</ul>
    </Card>}
  </div>
}

// --- Privacy & help ------------------------------------------------------------------
export function PrivacyTab({ hub, publication, visibility, identity, onHelp }: { hub: Hub; publication: ReactNode; visibility: ReactNode; identity: ReactNode; onHelp: (type: RequestType) => void }) {
  const profile = hub.data.profile
  const publicItems: Array<[string, string]> = [
    ['Display name', hub.name], ['Photo', hub.photo ? 'Shown' : 'No photo shown'], ['Island', String(profile.island ?? '') || 'Not set'],
    ['Team history', 'Published teams only'], ['Match appearances', 'Confirmed matches only'], ['Statistics', 'Verified only'], ['Achievements', 'Those you keep visible'], ['Biography and social links', 'If you add them'],
  ]
  const privateItems = ['National ID or its digest', 'Date of birth', 'Email and phone', 'Documents', 'Payment information', 'Internal notes', 'Account ID', 'Claim tokens', 'Correction discussions']
  const help: Array<{ type: RequestType; label: string; icon: ReactNode }> = [
    { type: 'profile', label: 'Report incorrect profile information', icon: <UserRound size={18} /> },
    { type: 'statistics', label: 'Request a statistics correction', icon: <BarChart3 size={18} /> },
    { type: 'impersonation', label: 'Report impersonation or a duplicate profile', icon: <Flag size={18} /> },
    { type: 'team_contact', label: 'Contact my team manager', icon: <Users size={18} /> },
    { type: 'organizer_contact', label: 'Contact a tournament organizer', icon: <Trophy size={18} /> },
    { type: 'account_support', label: 'Account support', icon: <HelpCircle size={18} /> },
  ]
  return <div className="pw-page" role="tabpanel">
    <div className="pw-two">
      <div className="pw-stack">
        {publication}
        {visibility}
        <Card icon={<Eye size={18} />} title="What the public sees" sub={hub.isPublished ? 'Live on your public page' : 'Only after you publish'} action={<a className="ed-link" href={`#player/${encodeURIComponent(hub.slug)}`}>Preview <ArrowRight size={13} /></a>}>
          <ul className="pw-public-list">{publicItems.map(([label, value]) => <li key={label}><Eye size={14} /><span>{label}</span><small>{value}</small></li>)}</ul>
        </Card>
        <Card icon={<Lock size={18} />} title="Always private" sub="Never shown publicly">
          <ul className="pw-private-list">{privateItems.map(item => <li key={item}><Lock size={13} /> {item}</li>)}</ul>
        </Card>
      </div>
      <div className="pw-stack">
        {identity}
        <Card icon={<HelpCircle size={18} />} title="Help" sub="Each option opens a request that reaches the right person">
          <div className="pw-help-grid">{help.map(item => <button type="button" key={item.type} onClick={() => onHelp(item.type)}><span className="pf-card-icon">{item.icon}</span><span>{item.label}</span><ArrowRight size={14} /></button>)}</div>
        </Card>
      </div>
    </div>
  </div>
}

// Read-only for the player: the organizer who created the record marks a minor
// and records guardian approval; the player sees the outcome here.
export function GuardianStatus({ client, playerId }: { client: SupabaseClient; playerId: string }) {
  const [state, setState] = useState<{ isMinor: boolean; claim: boolean; publicProfile: boolean; guardians: string[] } | null>(null)
  useEffect(() => {
    let active = true
    void Promise.all([client.from('player_profiles').select('is_minor').eq('id', playerId).maybeSingle(), loadGuardianApprovals(client, playerId)]).then(([profile, approvals]) => {
      if (!active || profile.error) return
      const scopes = activeGuardianScopes(approvals.data)
      setState({ isMinor: profile.data?.is_minor === true, claim: scopes.claim, publicProfile: scopes.publicProfile, guardians: approvals.data.filter(item => !item.revokedAt).map(item => `${item.guardianName} (${GUARDIAN_RELATIONSHIP_LABELS[item.relationship as keyof typeof GUARDIAN_RELATIONSHIP_LABELS] ?? item.relationship})`) })
    })
    return () => { active = false }
  }, [client, playerId])
  if (!state) return null
  return <Card icon={<Users size={18} />} title="Parent / guardian" sub={state.isMinor ? 'Required because you are under 18' : 'Not required'}>
    {state.isMinor ? <>
      <ul className="pw-toggles readonly">
        <li><span>Approval to claim this profile</span><Pill tone={state.claim ? 'ok' : 'warn'}>{state.claim ? 'Approved' : 'Needed'}</Pill></li>
        <li><span>Approval to make it public</span><Pill tone={state.publicProfile ? 'ok' : 'warn'}>{state.publicProfile ? 'Approved' : 'Needed'}</Pill></li>
      </ul>
      {state.guardians.length > 0 && <p className="pf-hint"><ShieldCheck size={13} /> On file: {state.guardians.join(', ')}</p>}
      <p className="pf-hint"><Lock size={13} /> The organizer who registered you records guardian approval. Guardian details are private.</p>
    </> : <p className="pf-hint"><CircleCheck size={13} /> No guardian approval is needed for this profile.</p>}
  </Card>
}
