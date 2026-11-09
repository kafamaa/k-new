import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowLeft, Bell, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, Copy, Download, ExternalLink, FileText, Globe2, HelpCircle, IdCard, Info, Layers,
  Lock, MapPin, MessageCircle, Pencil, RefreshCw, Search, Settings, ShieldCheck, Trophy, UserRound, Users,
} from 'lucide-react'
import type { Hub } from './PlayerHubTabs'
import type { InboxAction, PlayerLocation } from '../lib/playerHome'
import { respondToInvitation, DOCUMENT_CATEGORIES, DOCUMENT_STATUS_LABELS, type PlayerDocument, type TeamInvitation } from '../lib/playerSections'
import { sumStatistics, type WorkspaceMatch } from '../lib/playerHub'
import { formatMaldivesDateTime } from '../lib/publicData'
import { formatDay, sportName } from '../lib/display'
import { CalendarButton } from './PublicExtras'
import { PersonAvatar, TeamLogo } from './HomeArt'

// Player Workspace pages in the owner's design (2026-11-04). Every number and
// row comes from the player's own loaded records; nothing is sample data.
type Row = Record<string, unknown>
const one = (value: unknown): Row | null => Array.isArray(value) ? (value[0] as Row | undefined) ?? null : value && typeof value === 'object' ? value as Row : null
const when = (iso: string | null) => iso ? formatMaldivesDateTime(iso) : 'Date to be confirmed'

function Panel({ icon, title, aside, children, className = '' }: { icon?: ReactNode; title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`sq-card pp-panel ${className}`.trim()}>
    <header className="pp-panel-head">{icon ? <span className="pp-icon">{icon}</span> : null}<h2 className="sq-card-title">{title}</h2>{aside ? <span className="pp-panel-aside">{aside}</span> : null}</header>
    {children}
  </section>
}
function Avatar({ hub, size = 'md' }: { hub: Hub; size?: 'md' | 'lg' }) {
  return <span className={`pp-avatar pp-avatar-${size}`}>{hub.photo ? <img src={hub.photo} alt="" /> : <PersonAvatar />}</span>
}
export function PlayerStrip({ hub, code, extra }: { hub: Hub; code: string | null; extra?: ReactNode }) {
  return <section className="sq-card pp-strip"><Avatar hub={hub} /><span className="sq-sep" aria-hidden="true" /><strong>{hub.name}{code ? <> <span aria-hidden="true">•</span> {code}</> : null}</strong>{extra ? <span className="pp-strip-extra">{extra}</span> : null}</section>
}
function Tiles({ items }: { items: Array<{ icon: ReactNode; value: ReactNode; label: string }> }) {
  return <dl className="pp-tiles">{items.map(item => <div key={item.label}><span className="sq-tile-icon">{item.icon}</span><dd>{item.value}</dd><dt>{item.label}</dt></div>)}</dl>
}
const awards = (hub: Hub) => hub.data.milestones.filter(row => String(row.milestone_type ?? '').startsWith('award_') || row.is_manual === true)

function Fixture({ match, big = false }: { match: WorkspaceMatch; big?: boolean }) {
  const score = match.resultConfirmed && match.homeScore !== null && match.awayScore !== null ? `${match.homeScore} – ${match.awayScore}` : null
  return <div className={`pp-fixture${big ? ' big' : ''}`}>
    <span><TeamLogo name={match.homeTeamName} logoUrl={match.homeTeamLogo} size={big ? 64 : 40} /><strong>{match.homeTeamName}</strong></span>
    <b className={score ? 'score' : ''}>{score ?? 'vs'}</b>
    <span><TeamLogo name={match.awayTeamName} logoUrl={match.awayTeamLogo} size={big ? 64 : 40} /><strong>{match.awayTeamName}</strong></span>
  </div>
}
const matchHref = (match: WorkspaceMatch) => `#matches/${encodeURIComponent(match.id)}`
// From the player's confirmed match record only.
function contribution(match: WorkspaceMatch): string {
  if (!match.participated) return 'Did not play'
  const parts = [match.goals ? `${match.goals} goal${match.goals === 1 ? '' : 's'}` : null, match.assists ? `${match.assists} assist${match.assists === 1 ? '' : 's'}` : null].filter(Boolean)
  return parts.length ? `Your contribution: ${parts.join(', ')}` : `Played${match.minutes ? ` · ${match.minutes} min` : ''}`
}

// --- Overview ----------------------------------------------------------------------------------
export function OverviewPage({ hub, code, attention, onGo, upcoming, completed, onboarding }: { hub: Hub; code: string | null; attention: InboxAction[]; onGo: (target: PlayerLocation | string) => void; upcoming: WorkspaceMatch[]; completed: WorkspaceMatch[]; onboarding: ReactNode }) {
  const next = upcoming[0]
  const results = completed.filter(match => match.resultConfirmed).slice(0, 3)
  return <div className="pp-page">
    <section className="pp-hero">
      <Avatar hub={hub} size="lg" />
      <div className="pp-hero-text"><strong>{hub.name}</strong>{code ? <span>Player ID: {code}</span> : null}<span>{[hub.sport ? sportName(hub.sport) : null, hub.position, hub.currentTeamName].filter(Boolean).join(' • ') || 'Add your sport and position in My Profile'}</span>
        {hub.data.profile.is_claimed === true ? <span className="sq-pill tone-ok"><Check size={15} aria-hidden="true" /> Profile linked</span> : <span className="sq-pill tone-warn">Profile not claimed yet</span>}</div>
      <div className="pp-hero-actions"><button type="button" className="ed-btn ed-btn-primary" onClick={() => onGo('profile')}><Pencil size={17} aria-hidden="true" /> Edit Profile</button>{hub.isPublished && hub.slug ? <a className="ed-btn ed-btn-ghost pp-glass" href={`#player/${encodeURIComponent(hub.slug)}`}><ExternalLink size={17} aria-hidden="true" /> View Public Profile</a> : null}</div>
    </section>
    {onboarding}
    <Tiles items={[{ icon: <CalendarDays size={24} aria-hidden="true" />, value: hub.totals.appearances, label: 'Official matches' }, { icon: <Trophy size={24} aria-hidden="true" />, value: hub.totals.goals, label: 'Goals' }, { icon: <Users size={24} aria-hidden="true" />, value: hub.totals.assists, label: 'Assists' }, { icon: <Trophy size={24} aria-hidden="true" />, value: awards(hub).length, label: 'Awards' }]} />
    <p className="pp-divider-note">Career totals • confirmed results only</p>
    <div className="sq-two">
      <div className="sq-col">
        <Panel icon={<CalendarDays size={22} aria-hidden="true" />} title="Next match" aside={next ? <span className="sq-pill tone-ok">Scheduled</span> : null}>
          {next ? <><p className="sq-muted pp-sub">{next.tournamentName}</p><Fixture match={next} big />
            <p className="pp-meta"><CalendarDays size={17} aria-hidden="true" /> {when(next.scheduledAt)}{next.venue ? <><span className="sq-sep" aria-hidden="true" /><MapPin size={17} aria-hidden="true" /> {next.venue}</> : null}</p>
            <a className="ed-btn ed-btn-ghost pp-center" href={matchHref(next)}>View match</a></> : <p className="sq-empty">No upcoming fixtures. Matches appear here once your team is scheduled.</p>}
        </Panel>
        <Panel icon={<Layers size={22} aria-hidden="true" />} title="Recent results">
          {results.length ? <ul className="pp-results">{results.map(match => <li key={match.id}><a href={matchHref(match)}><Fixture match={match} /><span className="sq-pill tone-ok">Official</span></a></li>)}</ul> : <p className="sq-empty">No official results yet.</p>}
        </Panel>
      </div>
      <aside className="sq-col">
        <Panel icon={<Bell size={22} aria-hidden="true" />} title="Needs your attention">
          {attention.length ? <ul className="pp-attention">{attention.slice(0, 3).map(item => <li key={item.key}><span className="pp-dot" aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.detail}</small></span></li>)}</ul> : <p className="sq-muted">Nothing needs your attention right now.</p>}
          {attention[0] ? <button type="button" className="ed-btn ed-btn-primary pp-block" onClick={() => onGo(attention[0].target)}>Review {attention.length > 1 ? 'first item' : 'request'}</button> : null}
        </Panel>
        <Panel icon={<IdCard size={22} aria-hidden="true" />} title="Your digital card">
          <div className="pp-minicard"><Avatar hub={hub} /><span className="sq-sep" aria-hidden="true" /><span><strong>{hub.name}</strong>{code ? <small>{code}</small> : null}</span></div>
          <button type="button" className="ed-link-btn pp-center" onClick={() => onGo('card')}>View card</button>
        </Panel>
      </aside>
    </div>
  </div>
}

// --- Career Records --------------------------------------------------------------------------------
export function CareerPage({ hub, onCorrection, details }: { hub: Hub; onCorrection: () => void; details: ReactNode }) {
  const [sport, setSport] = useState('')
  const [season, setSeason] = useState('')
  const [team, setTeam] = useState('')
  const [seasonNames, setSeasonNames] = useState<Map<string, string>>(new Map())
  const rows = hub.data.statistics
  const teamNames = useMemo(() => new Map(hub.data.teams.map(row => [String(row.team_id), { name: String(one(row.teams)?.name ?? 'Team'), logo: one(row.teams)?.logo_url ? String(one(row.teams)?.logo_url) : null }])), [hub.data.teams])
  const seasonIds = useMemo(() => [...new Set(rows.map(row => String(row.season_id ?? '')).filter(Boolean))], [rows])
  useEffect(() => {
    if (!seasonIds.length) return
    let active = true
    void hub.client.from('seasons').select('id,name').in('id', seasonIds).then(result => { if (active && !result.error) setSeasonNames(new Map(((result.data ?? []) as Row[]).map(row => [String(row.id), String(row.name ?? 'Season')]))) })
    return () => { active = false }
  }, [hub.client, seasonIds])
  const options = (key: string) => [...new Set(rows.map(row => String(row[key] ?? '')).filter(Boolean))]
  const filtered = rows.filter(row => (!sport || row.sport === sport) && (!season || String(row.season_id) === season) && (!team || String(row.team_id) === team))
  const totals = sumStatistics(filtered)
  const groups = new Map<string, Row[]>()
  for (const row of filtered) { const key = `${String(row.season_id ?? '')}|${String(row.team_id ?? '')}`; groups.set(key, [...(groups.get(key) ?? []), row]) }
  const breakdown = [...groups].map(([key, list]) => { const [seasonId, teamId] = key.split('|'); return { key, seasonId, teamId, totals: sumStatistics(list) } }).sort((a, b) => (seasonNames.get(b.seasonId) ?? b.seasonId).localeCompare(seasonNames.get(a.seasonId) ?? a.seasonId))
  const memberships = [...hub.data.teams].sort((a, b) => String(b.effective_from ?? '').localeCompare(String(a.effective_from ?? '')))
  const awardRows = awards(hub)
  const milestones = awardRows.length ? awardRows : hub.data.milestones.filter(row => row.state === 'reached' || row.reached_at)
  return <div className="pp-page">
    <div className="pp-head-action"><button type="button" className="ed-btn ed-btn-ghost" onClick={onCorrection}><Pencil size={17} aria-hidden="true" /> Request correction</button></div>
    <div className="sq-filterbar pp-filters">
      <label className="pp-inline">Sport: <select value={sport} onChange={event => setSport(event.target.value)}><option value="">All sports</option>{options('sport').map(value => <option key={value} value={value}>{sportName(value)}</option>)}</select></label>
      <label className="pp-inline">Season: <select value={season} onChange={event => setSeason(event.target.value)}><option value="">All seasons</option>{options('season_id').map(value => <option key={value} value={value}>{seasonNames.get(value) ?? 'Season'}</option>)}</select></label>
      <label className="pp-inline">Team: <select value={team} onChange={event => setTeam(event.target.value)}><option value="">All teams</option>{options('team_id').map(value => <option key={value} value={value}>{teamNames.get(value)?.name ?? 'Team'}</option>)}</select></label>
      <span className="sq-filter-sep" aria-hidden="true" /><button type="button" className="ed-link-btn" onClick={() => { setSport(''); setSeason(''); setTeam('') }}>Reset</button>
    </div>
    <Tiles items={[{ icon: <CalendarDays size={24} aria-hidden="true" />, value: totals.appearances, label: 'Official matches' }, { icon: <Trophy size={24} aria-hidden="true" />, value: totals.goals, label: 'Goals' }, { icon: <Users size={24} aria-hidden="true" />, value: totals.assists, label: 'Assists' }, { icon: <Trophy size={24} aria-hidden="true" />, value: awardRows.length, label: 'Awards' }]} />
    <p className="sq-note pp-note-plain"><Info size={18} aria-hidden="true" /> Only confirmed results contribute to career totals.</p>
    <div className="sq-two">
      <div className="sq-col">
        <Panel icon={<CalendarDays size={22} aria-hidden="true" />} title="Season breakdown" aside={<span className="sq-muted">{sport ? sportName(sport) : 'All sports'} · official records</span>}>
          {breakdown.length ? <div className="sq-table-wrap" role="region" aria-label="Season breakdown" tabIndex={0}><table className="sq-table">
            <thead><tr><th scope="col">Season</th><th scope="col">Team</th><th scope="col">Matches</th><th scope="col">Goals</th><th scope="col">Assists</th></tr></thead>
            <tbody>{breakdown.map(item => { const info = teamNames.get(item.teamId); return <tr key={item.key}><td>{item.seasonId ? seasonNames.get(item.seasonId) ?? 'Season' : 'No season'}</td><td><span className="pp-teamcell"><TeamLogo name={info?.name ?? 'Team'} logoUrl={info?.logo} size={28} /> {info?.name ?? 'Team'}</span></td><td>{item.totals.appearances}</td><td>{item.totals.goals}</td><td>{item.totals.assists}</td></tr> })}
              <tr className="pp-total"><td colSpan={2}>Total</td><td>{totals.appearances}</td><td>{totals.goals}</td><td>{totals.assists}</td></tr></tbody>
          </table></div> : <p className="sq-empty">No confirmed statistics yet. Numbers appear only after match results are confirmed.</p>}
        </Panel>
        <Panel icon={<Users size={22} aria-hidden="true" />} title="Team history">
          {memberships.length ? <ol className="pp-timeline">{memberships.map(row => { const info = one(row.teams); const current = !row.effective_to && ['active', 'loaned'].includes(String(row.status)); return <li key={String(row.id)}>
            <TeamLogo name={String(info?.name ?? 'Team')} logoUrl={info?.logo_url ? String(info.logo_url) : null} size={36} />
            <span><strong>{String(info?.name ?? 'Team')}</strong><small>{formatDay(row.effective_from) ?? '—'} – {current ? 'Present' : formatDay(row.effective_to) ?? '—'} {current ? <span className="sq-pill tone-info">Current</span> : null}{info?.team_type ? ` · ${String(info.team_type).replace(/_/g, ' ')}` : ''}</small></span>
          </li> })}</ol> : <p className="sq-empty">No team memberships yet.</p>}
        </Panel>
      </div>
      <aside className="sq-col">
        <Panel icon={<Trophy size={22} aria-hidden="true" />} title="Awards & milestones">
          {milestones.length ? <ul className="pp-awards">{milestones.slice(0, 6).map(row => <li key={String(row.id)}><span className="pp-trophy"><Trophy size={26} aria-hidden="true" /></span><span><strong>{String(row.label ?? 'Milestone')}</strong><small>{[row.reached_at ? formatDay(row.reached_at) : null, row.is_manual ? 'Award' : 'Automatic milestone'].filter(Boolean).join(' · ')}</small></span></li>)}</ul> : <p className="sq-empty">No awards or milestones yet.</p>}
        </Panel>
        <Panel icon={<CheckCircle2 size={22} aria-hidden="true" />} title="Records you can trust">
          <ul className="sq-bullets"><li>Official match records are updated after organizer confirmation.</li><li>Corrections keep an audit history.</li></ul>
        </Panel>
      </aside>
    </div>
    <details className="pp-more"><summary>Detailed statistics and rating</summary>{details}</details>
  </div>
}

// --- My Matches ------------------------------------------------------------------------------------
export function MatchesPage({ hub, upcoming, completed, more }: { hub: Hub; upcoming: WorkspaceMatch[]; completed: WorkspaceMatch[]; more: ReactNode }) {
  const [view, setView] = useState<'upcoming' | 'results' | 'all'>('upcoming')
  const [tournament, setTournament] = useState('')
  const pick = (list: WorkspaceMatch[]) => list.filter(match => !tournament || match.tournamentId === tournament)
  const tournaments = [...new Map(hub.matches.map(match => [match.tournamentId, match.tournamentName])).entries()]
  const next = pick(upcoming)[0]
  const later = pick(upcoming).slice(next ? 1 : 0)
  const results = pick(completed).filter(match => match.resultConfirmed)
  return <div className="pp-page">
    <div className="sq-tabs" role="tablist" aria-label="Matches">{([['upcoming', 'Upcoming'], ['results', 'Results'], ['all', 'All matches']] as const).map(([id, label]) => <button type="button" role="tab" key={id} aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}</div>
    {tournaments.length > 1 ? <div className="sq-filterbar pp-filters"><label className="pp-inline">Tournament: <select value={tournament} onChange={event => setTournament(event.target.value)}><option value="">All tournaments</option>{tournaments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div> : null}
    {view !== 'results' && <>
      <Panel icon={<CalendarDays size={22} aria-hidden="true" />} title="Next fixture" aside={next ? <span className="sq-pill tone-info">Scheduled</span> : null}>
        {next ? <><p className="sq-muted pp-sub">{next.tournamentName}</p><Fixture match={next} big />
          <p className="pp-meta"><CalendarDays size={18} aria-hidden="true" /> {when(next.scheduledAt)}{next.venue ? <><span className="sq-sep" aria-hidden="true" /><MapPin size={18} aria-hidden="true" /> {next.venue}</> : null}</p>
          <p className="sq-note pp-center-note"><Info size={18} aria-hidden="true" /> Team fixture · selection is confirmed by your team.</p>
          <div className="pp-actions-center"><a className="ed-btn ed-btn-primary" href={matchHref(next)}>View Match <ChevronRight size={17} aria-hidden="true" /></a>{next.scheduledAt ? <CalendarButton name={`${next.homeTeamName} v ${next.awayTeamName}`} events={[{ uid: next.id, title: `${next.homeTeamName} v ${next.awayTeamName}`, start: next.scheduledAt, location: next.venue, description: next.tournamentName }]} /> : null}</div></> : <p className="sq-empty">No upcoming fixtures. Matches appear here once your team is scheduled.</p>}
      </Panel>
      {later.length ? <ul className="pp-rows">{later.slice(0, 6).map(match => <li key={match.id} className="sq-card"><CalendarDays size={20} aria-hidden="true" /><span>{when(match.scheduledAt)}</span><span className="sq-sep" aria-hidden="true" /><span className="pp-rowteams"><TeamLogo name={match.homeTeamName} logoUrl={match.homeTeamLogo} size={28} /><strong>{match.homeTeamName}</strong> vs <strong>{match.awayTeamName}</strong><TeamLogo name={match.awayTeamName} logoUrl={match.awayTeamLogo} size={28} /></span><span className="sq-sep" aria-hidden="true" /><span>{match.tournamentName}</span><span className="sq-pill tone-info">Scheduled</span><a className="ed-link" href={matchHref(match)}>View match <ChevronRight size={15} aria-hidden="true" /></a></li>)}</ul> : null}
    </>}
    {view !== 'upcoming' && <Panel icon={<Trophy size={22} aria-hidden="true" />} title="Recent official results">
      {results.length ? <ul className="pp-results">{results.slice(0, view === 'all' ? 20 : 8).map(match => <li key={match.id}><a href={matchHref(match)}><Fixture match={match} /><span className="sq-pill tone-ok">Official</span><span className="pp-contrib">{contribution(match)}</span><span className="ed-link">View details <ChevronRight size={15} aria-hidden="true" /></span></a></li>)}</ul> : <p className="sq-empty">No official results yet.</p>}
    </Panel>}
    <p className="sq-dim">Career totals include confirmed appearances only.</p>
    {more}
  </div>
}

// --- Requests & Invitations ---------------------------------------------------------------------------
export function RequestsPage({ hub, code, onNewRequest, children }: { hub: Hub; code: string | null; onNewRequest: () => void; children: ReactNode }) {
  const [reviewing, setReviewing] = useState<TeamInvitation | null>(null)
  const [tab, setTab] = useState<'action' | 'sent' | 'history'>('action')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = hub.invitations.filter(item => item.status === 'pending' && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()))
  const requests = hub.data.correctionRequests ?? []
  const memberships = hub.data.teams.filter(row => !row.effective_to && ['active', 'loaned'].includes(String(row.status)))
  const respond = async (item: TeamInvitation, response: 'accepted' | 'declined') => {
    setBusy(true); setError('')
    const result = await respondToInvitation(hub.client, item.id, response, '')
    setBusy(false)
    if (result.error) return setError(result.error)
    setReviewing(null); hub.reload()
  }
  if (reviewing) return <InvitationReview hub={hub} code={code} item={reviewing} busy={busy} error={error} memberships={memberships} onBack={() => setReviewing(null)} onRespond={response => void respond(reviewing, response)} />
  return <div className="pp-page">
    <div className="pp-head-action"><button type="button" className="ed-btn ed-btn-primary" onClick={onNewRequest}>+ New request</button></div>
    <PlayerStrip hub={hub} code={code} />
    <div className="sq-tabs" role="tablist" aria-label="Requests">{([['action', `Needs action (${pending.length})`], ['sent', 'Sent requests'], ['history', 'History']] as const).map(([id, label]) => <button type="button" role="tab" key={id} aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {tab === 'action' && <div className="sq-two">
      <div className="sq-col">
        {pending.length ? pending.map(item => <Panel key={item.id} icon={<MessageCircle size={22} aria-hidden="true" />} title="Team invitation" aside={<span className="sq-pill tone-warn">Awaiting your response</span>}>
          <div className="pp-invite"><TeamLogo name={item.teamName} logoUrl={item.teamLogo} size={92} /><span className="sq-sep" aria-hidden="true" /><div><strong className="pp-invite-team">{item.teamName}</strong><p>{[item.position, item.jerseyNumber !== null ? `Shirt ${item.jerseyNumber}` : null].filter(Boolean).join(' · ') || 'Player'}</p><p><CalendarDays size={17} aria-hidden="true" /> Received {formatDay(item.createdAt)}{item.expiresAt ? <> <span className="sq-sep" aria-hidden="true" /> Expires {formatDay(item.expiresAt)}</> : null}</p></div></div>
          <p className="sq-note"><Info size={18} aria-hidden="true" /> Review the team, role and competition details before responding.</p>
          <div className="pp-actions-center"><button type="button" className="ed-btn ed-btn-primary" onClick={() => setReviewing(item)}>Review invitation <ChevronRight size={17} aria-hidden="true" /></button><button type="button" className="ed-btn ed-btn-ghost" disabled={busy} onClick={() => void respond(item, 'declined')}>Decline</button></div>
          <p className="sq-dim pp-center-text">Joining this team does not automatically approve tournament eligibility.</p>
        </Panel>) : <Panel icon={<MessageCircle size={22} aria-hidden="true" />} title="Team invitations"><p className="sq-empty">No invitations need your response.</p></Panel>}
        <Panel icon={<FileText size={22} aria-hidden="true" />} title="Recent requests">
          {requests.length ? <ul className="pp-reqs">{requests.slice(0, 4).map(row => <li key={String(row.id)}><FileText size={18} aria-hidden="true" /><strong>{String(row.subject ?? 'Request')}</strong><span className="sq-sep" aria-hidden="true" /><span>Submitted {formatDay(row.created_at)}</span><span className={`sq-pill ${row.status === 'resolved' || row.status === 'completed' ? 'tone-ok' : row.status === 'rejected' ? 'tone-muted' : 'tone-info'}`}>{String(row.status ?? 'open').replace(/_/g, ' ')}</span></li>)}</ul> : <p className="sq-empty">No requests yet.</p>}
        </Panel>
      </div>
      <aside className="sq-col">
        <Panel icon={<Users size={22} aria-hidden="true" />} title="Your current memberships">
          {memberships.length ? memberships.map(row => { const info = one(row.teams); return <div key={String(row.id)} className="pp-membership"><TeamLogo name={String(info?.name ?? 'Team')} logoUrl={info?.logo_url ? String(info.logo_url) : null} size={60} /><span className="sq-sep" aria-hidden="true" /><span><strong>{String(info?.name ?? 'Team')}</strong><small>{info?.team_type ? String(info.team_type).replace(/_/g, ' ') : 'Team'}</small></span><span className="sq-pill tone-ok">Current</span></div> }) : <p className="sq-muted">No current team.</p>}
          <p className="sq-note pp-note-plain"><Info size={18} aria-hidden="true" /> Existing memberships remain unchanged until a request is approved.</p>
        </Panel>
        <Panel icon={<CheckCircle2 size={22} aria-hidden="true" />} title="Before you respond">
          <ul className="pp-checks"><li><Check size={16} aria-hidden="true" /> Check who sent the invitation</li><li><Check size={16} aria-hidden="true" /> Review the team and competition</li><li><Check size={16} aria-hidden="true" /> Read any membership conditions</li></ul>
          <a className="ed-link" href="#info/help"><HelpCircle size={17} aria-hidden="true" /> Get help with a request</a>
        </Panel>
      </aside>
    </div>}
    {tab !== 'action' && children}
    <p className="sq-note pp-note-plain"><Info size={18} aria-hidden="true" /> Request decisions and changes appear in your activity history.</p>
  </div>
}

function InvitationReview({ hub, code, item, busy, error, memberships, onBack, onRespond }: { hub: Hub; code: string | null; item: TeamInvitation; busy: boolean; error: string; memberships: Row[]; onBack: () => void; onRespond: (response: 'accepted' | 'declined') => void }) {
  const [checked, setChecked] = useState(false)
  return <div className="pp-page sq-flow">
    <button type="button" className="ed-link-btn pp-back" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" /> Back to requests</button>
    <h1 className="sq-flow-title">Review team invitation</h1><p className="sq-lede">Check the details before you decide.</p>
    <section className="sq-card pp-invite-head"><TeamLogo name={item.teamName} logoUrl={item.teamLogo} size={96} /><span className="sq-sep" aria-hidden="true" /><div><strong className="pp-invite-team">{item.teamName}</strong>{item.teamSlug ? <a className="ed-link" href={`#team/${encodeURIComponent(item.teamSlug)}`} target="_blank" rel="noopener noreferrer">View team page <ExternalLink size={14} aria-hidden="true" /></a> : null}</div>
      <div className="pp-invite-status"><span className="sq-pill tone-warn">Awaiting your response</span>{item.expiresAt ? <span><CalendarDays size={18} aria-hidden="true" /> Invitation expires {formatDay(item.expiresAt)}</span> : null}</div></section>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="sq-two">
      <div className="sq-col">
        <Panel icon={<FileText size={22} aria-hidden="true" />} title="Invitation details">
          <dl className="sq-dl"><div><dt>Player</dt><dd>{hub.name}</dd></div>{code ? <div><dt>Player ID</dt><dd>{code}</dd></div> : null}<div><dt>Invited role</dt><dd>Player</dd></div><div><dt>Position</dt><dd>{item.position ?? <em>Not set</em>}</dd></div><div><dt>Shirt number</dt><dd>{item.jerseyNumber ?? <em>Not set</em>}</dd></div><div><dt>Invited by</dt><dd>{item.teamName} team management</dd></div><div><dt>Received</dt><dd>{formatDay(item.createdAt)}</dd></div></dl>
        </Panel>
        <Panel icon={<MessageCircle size={22} aria-hidden="true" />} title="Message from the team"><p className="sq-quote">{item.message ? `“${item.message}”` : <em>No message</em>}</p></Panel>
      </div>
      <aside className="sq-col">
        <Panel icon={<Users size={22} aria-hidden="true" />} title="What accepting means"><ul className="sq-bullets"><li>Creates a new dated team membership</li><li>Your player record and career history stay linked</li><li>Tournament eligibility is reviewed separately</li></ul></Panel>
        <Panel icon={<ShieldCheck size={22} aria-hidden="true" />} title="Existing membership">
          {memberships.length ? memberships.map(row => { const info = one(row.teams); return <div key={String(row.id)} className="pp-membership"><TeamLogo name={String(info?.name ?? 'Team')} logoUrl={info?.logo_url ? String(info.logo_url) : null} size={56} /><span className="sq-sep" aria-hidden="true" /><span><strong>{String(info?.name ?? 'Team')}</strong><small>{info?.team_type ? String(info.team_type).replace(/_/g, ' ') : 'Team'}</small></span></div> }) : <p className="sq-muted">You have no current team.</p>}
          <p className="sq-note pp-note-plain"><Info size={18} aria-hidden="true" /> Your current membership will not be replaced automatically.</p>
        </Panel>
      </aside>
    </div>
    <section className="sq-card pp-decide">
      <label className="sq-check"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} /><span><strong>I have reviewed the invitation details and membership conditions.</strong></span></label>
      <div className="pp-decide-actions"><button type="button" className="ed-btn ed-btn-primary" disabled={!checked || busy} onClick={() => onRespond('accepted')}>Accept Invitation</button><button type="button" className="ed-btn ed-btn-ghost" disabled={busy} onClick={() => onRespond('declined')}>Decline invitation</button><button type="button" className="ed-link-btn" onClick={onBack}>Decide later</button></div>
      <p className="sq-dim">Accepting submits your response. Any required approvals follow separately.</p>
    </section>
  </div>
}

// --- Digital Card -------------------------------------------------------------------------------------
export function CardPage({ hub, card, notice, onEdit, onPrivacy }: { hub: Hub; card: ReactNode; notice: ReactNode; onEdit: () => void; onPrivacy: () => void }) {
  const [copied, setCopied] = useState(false)
  const link = hub.slug ? `${window.location.origin}${window.location.pathname}#player/${encodeURIComponent(hub.slug)}` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2500) } catch { setCopied(false) } }
  return <div className="pp-page">
    <div className="sq-two">
      <Panel icon={<IdCard size={22} aria-hidden="true" />} title="Card preview" className="pp-cardstage">
        <div className="pp-card-wrap">{card}</div>{notice}
        <p className="pp-center-text">Card details come from your player profile. <button type="button" className="ed-link-btn inline" onClick={onEdit}>Edit profile</button></p>
      </Panel>
      <aside className="sq-col">
        <Panel icon={<Download size={22} aria-hidden="true" />} title="Save or share">
          <p className="sq-muted">Download the card as an image or PDF with the buttons under the card.</p>
          {hub.isPublished && link ? <button type="button" className="ed-btn ed-btn-ghost pp-block" onClick={() => void copy()}><Copy size={17} aria-hidden="true" /> {copied ? 'Link copied' : 'Copy profile link'}</button> : null}
          <p className="sq-muted">{hub.isPublished ? 'Anyone with the link can view your published profile.' : 'Publish your profile to share a link to it.'}</p>
        </Panel>
        <Panel icon={<Users size={22} aria-hidden="true" />} title="Sharing & privacy">
          <span className={`sq-pill ${hub.isPublished ? 'tone-ok' : 'tone-muted'}`}>{hub.isPublished ? <><CheckCircle2 size={16} aria-hidden="true" /> Public profile enabled</> : 'Profile is private'}</span>
          <p>Only your public sporting details appear on this card.</p><hr />
          <p className="sq-lockline"><Lock size={18} aria-hidden="true" /> ID documents, contact details and date of birth are excluded.</p>
          <button type="button" className="ed-btn ed-btn-ghost pp-block" onClick={onPrivacy}>Manage privacy</button>
        </Panel>
      </aside>
    </div>
    <section className="sq-card pp-footnote-card"><Info size={26} aria-hidden="true" /><div><h2>A sporting profile card</h2><p>This card is not a government ID or tournament eligibility approval.</p></div></section>
  </div>
}

// --- Documents ----------------------------------------------------------------------------------------
export function DocumentsPage({ hub, code, documents, children }: { hub: Hub; code: string | null; documents: PlayerDocument[]; children: ReactNode }) {
  const latest = new Map<string, PlayerDocument>()
  for (const item of documents) if (!latest.has(item.category)) latest.set(item.category, item)
  const tone = (status: string) => status === 'verified' ? 'tone-ok' : ['changes_requested', 'rejected', 'expired'].includes(status) ? 'tone-warn' : 'tone-info'
  return <div className="pp-page">
    <PlayerStrip hub={hub} code={code} extra={<span className="sq-pill tone-ok"><Lock size={16} aria-hidden="true" /> Private documents</span>} />
    <p className="sq-note pp-note-plain"><Info size={18} aria-hidden="true" /> Documents are shared only with authorized reviewers for the relevant request.</p>
    <div className="sq-two">
      <Panel icon={<FileText size={22} aria-hidden="true" />} title="Your files">{children}</Panel>
      <aside className="sq-col">
        <Panel icon={<FileText size={22} aria-hidden="true" />} title="Document checklist">
          <ul className="pp-checklist">{DOCUMENT_CATEGORIES.map(category => { const item = latest.get(category.value); return <li key={category.value}><FileText size={20} aria-hidden="true" /><span>{category.label}</span>{item ? <span className={`sq-pill ${tone(item.status)}`}>{DOCUMENT_STATUS_LABELS[item.status] ?? item.status}</span> : <span className="sq-pill tone-muted">Not uploaded</span>}</li> })}</ul>
          <p className="sq-dim">Requirements depend on the tournament or request.</p>
        </Panel>
        <Panel icon={<Settings size={22} aria-hidden="true" />} title="File controls">
          <ul className="pp-lines"><li>Replace uploads a new version.</li><li>Delete asks for confirmation.</li><li>Files linked to submitted requests may be locked.</li></ul>
          <a className="ed-link" href="#info/privacy">Privacy &amp; document help</a>
        </Panel>
      </aside>
    </div>
  </div>
}

// --- Activity ---------------------------------------------------------------------------------------------
export function ActivityPage({ hub, code, children }: { hub: Hub; code: string | null; children: ReactNode }) {
  return <div className="pp-page">
    <PlayerStrip hub={hub} code={code} />
    <div className="sq-two">
      <Panel icon={<Clock3 size={22} aria-hidden="true" />} title="Recent activity" aside={<em className="sq-muted">Times shown in MVT</em>}>{children}</Panel>
      <aside className="sq-col">
        <Panel icon={<Layers size={22} aria-hidden="true" />} title="Activity types">
          <ul className="pp-types"><li><UserRound size={22} aria-hidden="true" /> Profile changes</li><li><Users size={22} aria-hidden="true" /> Team requests</li><li><FileText size={22} aria-hidden="true" /> Document updates</li><li><RefreshCw size={22} aria-hidden="true" /> Record corrections</li></ul>
        </Panel>
        <Panel icon={<Info size={22} aria-hidden="true" />} title="About this history">
          <ul className="pp-lines"><li>Events help you follow changes to your player record.</li><li>Official records are corrected through requests.</li><li>Activity entries cannot be edited here.</li></ul>
          <a className="ed-link" href="#info/help">Get help</a>
        </Panel>
      </aside>
    </div>
  </div>
}

// --- Privacy & Help ------------------------------------------------------------------------------------------
const FAQ: Array<[string, string]> = [
  ['How do I edit my profile?', 'Open My Profile, change your details and select Save changes. Identity and official records are changed through a correction request.'],
  ['Why are my stats missing?', 'Statistics count only after the organizer confirms a match result. If a confirmed result is wrong, send a record correction request.'],
  ['Who can see my documents?', 'Only you and the reviewers of the request or tournament the document belongs to. Documents never appear on public pages.'],
]
export function PrivacyHelpPage({ visibility, information }: { visibility: ReactNode; information: ReactNode }) {
  const [query, setQuery] = useState('')
  const shown = FAQ.filter(([question, answer]) => !query.trim() || `${question} ${answer}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="pp-page">
    <div className="sq-two">
      <div className="sq-col">
        <Panel icon={<Globe2 size={22} aria-hidden="true" />} title="Profile visibility">{visibility}
          <p className="sq-note pp-note-plain"><Info size={18} aria-hidden="true" /> Visibility changes do not erase official competition records.</p></Panel>
        <Panel icon={<Layers size={22} aria-hidden="true" />} title="Your information">{information}
          <p className="sq-note pp-note-plain"><Info size={18} aria-hidden="true" /> Requests are reviewed. Some official records may need to be retained.</p></Panel>
      </div>
      <aside className="sq-col">
        <Panel icon={<HelpCircle size={22} aria-hidden="true" />} title="How can we help?">
          <label className="sq-search pp-faq-search"><Search size={20} aria-hidden="true" /><input type="search" aria-label="Search help articles" placeholder="Search help articles" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <div className="pp-faq">{shown.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}{!shown.length ? <p className="sq-muted">No matching answers. Try the Help Centre.</p> : null}</div>
        </Panel>
        <Panel icon={<MessageCircle size={22} aria-hidden="true" />} title="Need more help?">
          <p>Send a support request with the details of your issue.</p>
          <a className="ed-btn ed-btn-primary pp-block" href="#info/contact">Contact Support</a>
          <a className="ed-btn ed-btn-ghost pp-block" href="#info/report">Report a problem</a>
          <p className="pp-center-text"><a className="ed-link" href="#info/privacy">Privacy Policy</a> <span aria-hidden="true">|</span> <a className="ed-link" href="#info/terms">Terms of Use</a></p>
        </Panel>
      </aside>
    </div>
  </div>
}

