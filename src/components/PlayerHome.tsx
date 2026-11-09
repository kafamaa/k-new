import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowRight, BarChart3, BellRing, CalendarClock, CalendarDays, CalendarPlus, Check, CircleAlert, CircleCheck, CircleDashed, ClipboardList, Eye, History, IdCard,
  Lock, Monitor, Shield, ShieldAlert, ShieldCheck, Smartphone, Star, Trophy, UserRound, Users, X,
} from 'lucide-react'
import { groupMatches, matchOutcome, opponentOf, type WorkspaceMatch } from '../lib/playerHub'
import {
  activityLabel, AVAILABILITY, AVAILABILITY_LABELS, CLAIM_STATUS_LABELS, ELIGIBILITY_LABELS, loadActivity, matchCalendarFile, safeFileName, TAB_LABELS,
  type ActivityItem, type Availability, type ClaimStatus, type EligibilityCheck, type EligibilityStatus, type InboxAction, type NextAction, type OnboardingStep, type PlayerLocation,
} from '../lib/playerHome'
import { downloadBlob } from '../lib/cardImage'
import { RATING_MAX } from '../lib/playerRating'
import { formatMaldivesDateTime } from '../lib/publicData'
import { formatDay } from '../lib/display'
import { Crest } from './Editorial'
import { Card, Empty, Pending, Pill } from './HubUi'
import { MatchCard, type Hub } from './PlayerHubTabs'
import type { RequestType } from '../lib/playerHub'
import { featureOn } from '../lib/appConfig'

const NOW = () => new Date().toISOString()
const one = (value: unknown): Record<string, unknown> | null => Array.isArray(value) ? (value[0] as Record<string, unknown> | undefined) ?? null : value && typeof value === 'object' ? value as Record<string, unknown> : null

// Tabs inside a section, with real tab semantics and arrow-key movement.
export function SubTabs({ label, tabs, active, onChange, counts = {} }: { label: string; tabs: readonly string[]; active: string; onChange: (tab: string) => void; counts?: Record<string, number> }) {
  const move = (index: number) => { const next = tabs[(index + tabs.length) % tabs.length]; onChange(next); requestAnimationFrame(() => document.getElementById(`ptab-${next}`)?.focus()) }
  return <div className="pw-subtabs" role="tablist" aria-label={label}>{tabs.map((tab, index) => <button type="button" role="tab" key={tab} id={`ptab-${tab}`} aria-selected={tab === active} aria-controls={`ppanel-${tab}`} tabIndex={tab === active ? 0 : -1} className={tab === active ? 'active' : ''}
    onClick={() => onChange(tab)} onKeyDown={event => { if (event.key === 'ArrowRight') move(index + 1); if (event.key === 'ArrowLeft') move(index - 1) }}>{TAB_LABELS[tab] ?? tab}{counts[tab] ? <span className="ws-count">{counts[tab]}</span> : null}</button>)}</div>
}
export function TabPanel({ tab, children }: { tab: string; children: ReactNode }) { return <div role="tabpanel" id={`ppanel-${tab}`} aria-labelledby={`ptab-${tab}`}>{children}</div> }

// --- Overview -----------------------------------------------------------------
export function NextActionCard({ action, onGo }: { action: NextAction | null; onGo: (target: PlayerLocation) => void }) {
  if (!action) return <section className="pw-next calm" aria-label="Next action"><div><p className="pf-eyebrow">All set</p><h2>Nothing needs your attention</h2><p>New invitations, documents and fixtures appear here first.</p></div></section>
  return <section className="pw-next" aria-label="Next action"><div><p className="pf-eyebrow">Next action</p><h2>{action.title}</h2><p>{action.text}</p></div>
    <button type="button" className="ed-btn ed-btn-primary" onClick={() => onGo(action.target)}>{action.button} <ArrowRight size={16} /></button></section>
}

export function OnboardingCard({ steps, onGo, onChoose, onHide }: { steps: OnboardingStep[]; onGo: (target: PlayerLocation) => void; onChoose: (choice: 'withoutTeam' | 'keepPrivate') => void; onHide: () => void }) {
  const done = steps.filter(step => step.done && step.id !== 'finish').length
  const total = steps.length - 1
  const current = steps.find(step => !step.done)
  return <section className="pw-onboard" aria-label="Set up your Player Workspace">
    <header><div><p className="pf-eyebrow">Welcome to Kulhivaru+</p><h2>{current?.id === 'finish' || !current ? 'Your workspace is ready' : 'Set up your Player Workspace'}</h2><p>{done} of {total} completed · saved automatically</p></div><button type="button" className="ed-icon-btn" aria-label="Hide setup" onClick={onHide}><X size={16} /></button></header>
    <div className="pw-onboard-bar" aria-hidden="true"><span style={{ width: `${Math.round(done / total * 100)}%` }} /></div>
    <ol className="pw-onboard-steps">{steps.map(step => <li key={step.id} className={step.done ? 'done' : step === current ? 'current' : ''}>
      <span className="pw-onboard-mark" aria-hidden="true">{step.done ? <Check size={13} /> : <CircleDashed size={13} />}</span><span>{step.label}<span className="sr-only">{step.done ? ', done' : ', to do'}</span></span>
    </li>)}</ol>
    {current && current.id !== 'finish' && <div className="pw-onboard-now">
      {current.id === 'identity' && <><p><Lock size={14} /> Your national ID is checked securely on the server to prevent duplicate players. It is never shown again or made public.</p><button type="button" className="ed-btn ed-btn-primary" onClick={() => onGo(current.target)}>Start secure check</button></>}
      {current.id === 'profile' && <><p>Add your photo, name, island, primary sport and position.</p><button type="button" className="ed-btn ed-btn-primary" onClick={() => onGo(current.target)}>Complete basics</button></>}
      {current.id === 'team' && <><p>Accept a team invitation or find a team. Independent players can continue without one.</p><div className="pw-actions"><button type="button" className="ed-btn ed-btn-primary" onClick={() => onGo(current.target)}>Find a team</button><button type="button" className="ed-btn ed-btn-ghost" onClick={() => onChoose('withoutTeam')}>Continue without team</button></div></>}
      {current.id === 'privacy' && <><p>National ID, contact details and documents are always private. Your name, photo, team and approved history become public only after you publish.</p><div className="pw-actions"><button type="button" className="ed-btn ed-btn-primary" onClick={() => onGo(current.target)}>Preview and publish</button><button type="button" className="ed-btn ed-btn-ghost" onClick={() => onChoose('keepPrivate')}>Keep private</button></div></>}
    </div>}
    {(!current || current.id === 'finish') && <div className="pw-onboard-now"><p><CircleCheck size={14} /> Everything essential is done. You can reopen this from Privacy & Help.</p><button type="button" className="ed-btn ed-btn-primary" onClick={onHide}>Open workspace</button></div>}
  </section>
}

export function StatusPanel({ status, emailVerified, identity, isPublished, onGo }: { status: ClaimStatus; emailVerified: boolean; identity: 'registered' | 'not_registered' | 'unavailable'; isPublished: boolean; onGo: (target: string) => void }) {
  const rows: Array<{ label: string; value: string; ok: boolean; action?: { text: string; target: string } }> = [
    { label: 'Profile', value: CLAIM_STATUS_LABELS[status], ok: ['claimed', 'verified'].includes(status), action: status === 'unclaimed' || status === 'invitation_sent' ? { text: 'Claim profile', target: 'privacy' } : status === 'conflict' ? { text: 'Report duplicate', target: 'requests' } : undefined },
    { label: 'Email', value: emailVerified ? 'Verified' : 'Not verified', ok: emailVerified },
    { label: 'Identity', value: identity === 'registered' ? 'Verified and protected' : identity === 'unavailable' ? 'Check not available yet' : status === 'identity_review' ? 'Under review' : 'Not checked yet', ok: identity === 'registered', action: identity === 'not_registered' ? { text: 'Complete verification', target: 'profile' } : undefined },
    { label: 'Public profile', value: isPublished ? 'Public' : 'Private', ok: isPublished, action: { text: isPublished ? 'Preview' : 'Review', target: 'privacy' } },
  ]
  return <Card icon={<ShieldCheck size={18} />} title="Player status">
    <ul className="pw-status">{rows.map(row => <li key={row.label}><span className={`pw-status-mark ${row.ok ? 'ok' : 'todo'}`} aria-hidden="true">{row.ok ? <Check size={12} /> : <CircleAlert size={12} />}</span><span><small>{row.label}</small><strong>{row.value}</strong></span>{row.action && <button type="button" className="ed-link-btn" onClick={() => onGo(row.action!.target)}>{row.action.text}</button>}</li>)}</ul>
  </Card>
}

export function SummaryCards({ hub, onGo }: { hub: Hub; onGo: (target: string) => void }) {
  const rated = hub.rating.status === 'rated'
  // A failed statistics query is never shown as zero.
  if (hub.data.unavailable.includes('Statistics')) return <div className="lp-error" role="alert"><span><strong>Official statistics could not be loaded.</strong><small>Your totals are not shown rather than shown as zero.</small></span><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={hub.reload}>Retry</button></div>
  return <div className="pw-summary" role="list" aria-label="Official totals">
    {[
      { label: 'Appearances', value: String(hub.totals.appearances), icon: <CalendarDays size={16} />, target: 'statistics' },
      { label: 'Goals', value: String(hub.totals.goals), icon: <Trophy size={16} />, target: 'statistics' },
      { label: 'Assists', value: String(hub.totals.assists), icon: <Users size={16} />, target: 'statistics' },
      { label: 'Rating', value: rated && hub.rating.status === 'rated' ? `${hub.rating.value.toFixed(1)} / ${RATING_MAX}` : 'Insufficient data', icon: <Star size={16} />, target: 'statistics' },
    ].map(item => <button type="button" role="listitem" key={item.label} className="pw-stat" onClick={() => onGo(item.target)}><span className="pw-stat-icon">{item.icon}</span><b className={item.value.length > 8 ? 'small' : ''}>{item.value}</b><small>{item.label}</small></button>)}
  </div>
}

export function OverviewBoard({ hub, attention, onGo, status }: { hub: Hub; attention: InboxAction[]; onGo: (target: PlayerLocation | string) => void; status: ReactNode }) {
  const groups = groupMatches(hub.matches, NOW())
  const next = groups.live[0] ?? groups.upcoming[0] ?? null
  const recent = groups.completed.filter(match => match.resultConfirmed).slice(0, 4)
  const activeTeams = hub.data.teams.filter(row => !row.effective_to && (row.status === 'active' || row.status === 'loaned'))
  const notices = (hub.data.notifications ?? []).slice(0, 3)
  return <div className="pw-grid">
    <Card icon={<CalendarClock size={18} />} title={next?.status === 'live' ? 'Live now' : 'Upcoming match'} sub={next ? next.tournamentName : undefined} action={next ? <button type="button" className="ed-link-btn" onClick={() => onGo(next.status === 'live' ? 'live' : 'upcoming')}>View <ArrowRight size={13} /></button> : undefined}>
      {next ? <div className="pw-nextmatch"><div className="pw-vs"><Crest name={opponentOf(next).name} logoUrl={opponentOf(next).logo} size="md" /><div><small>{opponentOf(next).home ? 'Home vs' : 'Away at'}</small><strong>{opponentOf(next).name}</strong></div></div><p className="pf-hint"><CalendarDays size={13} /> {next.scheduledAt ? formatMaldivesDateTime(next.scheduledAt) : 'Date to be confirmed'} · Maldives time{next.venue ? ` · ${next.venue}` : ''}</p></div>
        : <Empty icon={<CalendarDays size={20} />}>{hub.matchesAvailable ? 'No upcoming match for your teams yet.' : 'Upcoming fixtures appear once migration 030 is applied.'}</Empty>}
    </Card>
    <Card icon={<Shield size={18} />} title="Current team" action={<button type="button" className="ed-link-btn" onClick={() => onGo('teams')}>Teams <ArrowRight size={13} /></button>}>
      {activeTeams.length ? <ul className="pw-mini-list">{activeTeams.slice(0, 2).map(row => { const team = one(row.teams); return <li key={String(row.id ?? row.team_id)}><Crest name={String(team?.name ?? 'Team')} logoUrl={(team?.logo_url as string | null) ?? null} size="sm" /><span><strong>{String(team?.name ?? 'Team')}</strong><small>since {formatDay(row.effective_from) ?? '—'}</small></span></li> })}</ul>
        : <Empty icon={<Users size={20} />}>No current team. Independent players can still build a profile.</Empty>}
    </Card>
    <Card icon={<CircleAlert size={18} />} title="Attention required" sub={attention.length ? `${attention.length} item${attention.length === 1 ? '' : 's'}` : undefined}>
      {attention.length ? <ul className="pw-tasks">{attention.slice(0, 4).map(item => <li key={item.key}><button type="button" onClick={() => onGo(item.target)}><span><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowRight size={14} /></button></li>)}</ul> : <Empty>Nothing needs your attention.</Empty>}
    </Card>
    {status}
    <Card icon={<BarChart3 size={18} />} title="Recent performance" sub="Confirmed matches" action={<button type="button" className="ed-link-btn" onClick={() => onGo('completed')}>All <ArrowRight size={13} /></button>}>
      {recent.length ? <ul className="pw-form-list">{recent.map(match => { const outcome = matchOutcome(match); return <li key={match.id}><span className={`pw-outcome o-${outcome ?? 'n'}`}>{outcome ?? '–'}</span><span className="pw-form-main"><strong>vs {opponentOf(match).name}</strong><small>{formatDay(match.scheduledAt) ?? ''} · {match.homeScore ?? '–'}–{match.awayScore ?? '–'}</small></span><span className="pw-form-stats">{match.participated ? <>{match.goals ? <b>{match.goals}G</b> : null}{match.assists ? <b>{match.assists}A</b> : null}</> : <small>Did not play</small>}</span></li> })}</ul>
        : <Empty icon={<BarChart3 size={20} />}>Confirmed results appear here after organizers confirm them.</Empty>}
    </Card>
    <Card icon={<BellRing size={18} />} title="Latest notifications" action={<button type="button" className="ed-link-btn" onClick={() => onGo('notifications')}>All <ArrowRight size={13} /></button>}>
      {hub.data.notifications === null ? <Empty icon={<BellRing size={20} />}>Notifications could not be loaded.</Empty> : notices.length ? <ul className="pw-notice-mini">{notices.map(row => <li key={String(row.id)} className={row.read_at == null ? 'unread' : ''}><strong>{String(row.title ?? 'Notice')}</strong><small>{formatDay(row.created_at)}</small></li>)}</ul> : <Empty icon={<BellRing size={20} />}>No notifications yet.</Empty>}
    </Card>
  </div>
}

// --- Matches ---------------------------------------------------------------------
export function MatchesSection({ hub, tab, availability, availabilityReady, onAvailability, discipline }: {
  hub: Hub; tab: string; availability: Map<string, { status: Availability; reason: string | null }>; availabilityReady: boolean
  onAvailability: (matchId: string, status: Availability, reason: string) => Promise<string | null>
  discipline: { yellow: number; red: number; secondYellow: number; matches: WorkspaceMatch[] }
}) {
  const groups = groupMatches(hub.matches, NOW())
  const calendar = (match: WorkspaceMatch) => { const file = matchCalendarFile(match); if (file) downloadBlob(new Blob([file], { type: 'text/calendar' }), `${safeFileName(`${match.homeTeamName}-v-${match.awayTeamName}`)}.ics`) }
  const upcomingExtra = (match: WorkspaceMatch) => <div className="pw-match-extra">
    <p className="pf-hint"><ClipboardList size={13} /> The official lineup has not been published.</p>
    <div className="pw-actions">
      {availability.get(match.id) && <Pill tone={availability.get(match.id)!.status === 'available' ? 'ok' : availability.get(match.id)!.status === 'maybe' ? 'warn' : 'muted'}>{AVAILABILITY_LABELS[availability.get(match.id)!.status]}</Pill>}
      {match.scheduledAt && featureOn('calendarExports') && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => calendar(match)}><CalendarPlus size={13} /> Add to calendar</button>}
    </div>
  </div>
  const pending = !hub.matchesAvailable && <Pending>Only confirmed appearances are readable until migration 030 is applied. Fixtures, opponents and scores appear after that.</Pending>

  if (tab === 'availability') return <AvailabilityPanel hub={hub} matches={[...groups.upcoming, ...groups.postponed.filter(match => match.status === 'postponed')]} availability={availability} ready={availabilityReady} onSave={onAvailability} />
  if (tab === 'discipline') return <div className="pw-page">
    <div className="pw-counters"><div><b>{discipline.yellow}</b><small>Yellow cards</small></div><div><b>{discipline.secondYellow}</b><small>Second-yellow dismissals</small></div><div><b>{discipline.red}</b><small>Red cards</small></div><div><b>—</b><small>Active suspensions</small></div></div>
    <Card icon={<ShieldAlert size={18} />} title="Cards from confirmed matches" sub="Corrections update these automatically">
      {discipline.matches.length ? <ul className="pw-mini-list">{discipline.matches.map(match => <li key={match.id}><span className="pw-chip cards">{match.yellow ? <i className="card-y" /> : null}{match.red ? <i className="card-r" /> : null}</span><span><strong>vs {opponentOf(match).name}</strong><small>{match.tournamentName} · {formatDay(match.scheduledAt) ?? ''} · {match.yellow} yellow, {match.red} red</small></span><button type="button" className="ed-link-btn" onClick={() => hub.open('requests')}>Report a problem</button></li>)}</ul>
        : <Empty icon={<ShieldCheck size={20} />}>No cards in your confirmed matches.</Empty>}
    </Card>
    <p className="pw-footnote"><Lock size={13} /> Suspensions, matches remaining and appeals are decided by the organizer. Kulhivaru+ does not record suspensions yet, so none are shown. Players cannot edit discipline records.</p>
  </div>
  const items = tab === 'live' ? groups.live : tab === 'completed' ? groups.completed : [...groups.upcoming, ...groups.postponed]
  return <div className="pw-page">
    {pending}
    {items.length ? <ul className="pw-matches">{items.map(match => <MatchCard key={match.id} match={match} hub={hub} extra={tab === 'upcoming' && match.status === 'scheduled' ? upcomingExtra(match) : undefined} />)}</ul>
      : <Empty icon={<CalendarDays size={22} />}>{tab === 'live' ? 'None of your matches is live right now.' : tab === 'completed' ? 'No completed matches yet.' : 'No upcoming matches for your teams.'}</Empty>}
    <p className="pw-footnote"><ShieldCheck size={13} /> {tab === 'live' ? 'Live scores become official only after confirmation. You cannot edit match data here.' : 'Only confirmed results enter your official history. A corrected result replaces the earlier one.'}</p>
  </div>
}

function AvailabilityPanel({ hub, matches, availability, ready, onSave }: { hub: Hub; matches: WorkspaceMatch[]; availability: Map<string, { status: Availability; reason: string | null }>; ready: boolean; onSave: (matchId: string, status: Availability, reason: string) => Promise<string | null> }) {
  const [drafts, setDrafts] = useState<Record<string, { status: Availability; reason: string }>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [messages, setMessages] = useState<Record<string, string>>({})
  if (!ready) return <div className="pw-page"><Pending>Availability needs the Player Workspace migration (player_workspace_final).</Pending></div>
  const upcoming = matches.filter(match => match.status === 'scheduled' || match.status === 'postponed')
  return <div className="pw-page">
    <p className="pf-hint"><Lock size={13} /> Your answer is visible to the managers of your team for that match. A private reason is never public.</p>
    {upcoming.length ? <ul className="pw-matches">{upcoming.map(match => {
      const saved = availability.get(match.id)
      const draft = drafts[match.id] ?? { status: saved?.status ?? 'available', reason: saved?.reason ?? '' }
      return <li key={match.id} className="pw-match pw-avail"><div className="pw-match-body">
        <p className="pw-match-meta">{match.tournamentName} · {match.scheduledAt ? formatMaldivesDateTime(match.scheduledAt) : 'Date to be confirmed'}</p>
        <strong>vs {opponentOf(match).name}</strong>
        <div className="pw-segments" role="radiogroup" aria-label={`Availability against ${opponentOf(match).name}`}>{AVAILABILITY.map(option => <button type="button" role="radio" key={option} aria-checked={draft.status === option} className={draft.status === option ? 'active' : ''} onClick={() => setDrafts({ ...drafts, [match.id]: { ...draft, status: option } })}>{AVAILABILITY_LABELS[option].replace(' (private reason)', '')}</button>)}</div>
        {['unavailable', 'injured', 'other', 'maybe'].includes(draft.status) && <label className="pf-field">Private reason (optional)<input value={draft.reason} maxLength={200} onChange={event => setDrafts({ ...drafts, [match.id]: { ...draft, reason: event.target.value } })} placeholder="Only your team managers see this" /></label>}
        <div className="pw-actions"><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" disabled={busy === match.id} onClick={() => { setBusy(match.id); void onSave(match.id, draft.status, draft.reason).then(error => { setBusy(null); setMessages({ ...messages, [match.id]: error ?? 'Saved. Your team can see it.' }) }) }}>{busy === match.id ? 'Saving…' : saved ? 'Update' : 'Save'}</button>{saved && <small className="pf-hint">Saved: {AVAILABILITY_LABELS[saved.status]}</small>}</div>
        {messages[match.id] && <p className={messages[match.id].startsWith('Saved') ? 'publication-notice' : 'form-error'} role="status">{messages[match.id]}</p>}
      </div></li>
    })}</ul> : <Empty icon={<CalendarDays size={22} />}>No upcoming matches to answer for.</Empty>}
    {hub.data.teams.length === 0 && <p className="pf-hint">Availability is for matches of a team you belong to.</p>}
  </div>
}

// --- Eligibility ------------------------------------------------------------------
export type EligibilityRow = { tournamentId: string; tournamentName: string; teamName: string | null; status: EligibilityStatus; checks: EligibilityCheck[] }
const ELIGIBILITY_TONE: Record<EligibilityStatus, 'ok' | 'warn' | 'bad' | 'info'> = { eligible: 'ok', provisional: 'info', action_required: 'warn', under_review: 'info', ineligible: 'bad', expired: 'bad' }
export function EligibilitySection({ rows, onGo }: { rows: EligibilityRow[]; onGo: (target: string) => void }) {
  const [open, setOpen] = useState<string | null>(rows.find(row => row.status !== 'eligible')?.tournamentId ?? null)
  const counts = rows.reduce<Record<string, number>>((all, row) => ({ ...all, [row.status]: (all[row.status] ?? 0) + 1 }), {})
  return <div className="pw-page">
    {rows.length > 0 && <p className="pw-elig-summary">{rows.length} tournament{rows.length === 1 ? '' : 's'}: {(Object.keys(counts) as EligibilityStatus[]).map(status => `${counts[status]} ${ELIGIBILITY_LABELS[status].toLowerCase()}`).join(', ')}.</p>}
    {rows.length ? <ul className="pw-elig">{rows.map(row => <li key={row.tournamentId}>
      <button type="button" className="pw-elig-head" aria-expanded={open === row.tournamentId} onClick={() => setOpen(open === row.tournamentId ? null : row.tournamentId)}><span><strong>{row.tournamentName}</strong><small>{row.teamName ?? 'Team not recorded'}</small></span><Pill tone={ELIGIBILITY_TONE[row.status]}>{ELIGIBILITY_LABELS[row.status]}</Pill></button>
      {open === row.tournamentId && <ul className="pw-checks">{row.checks.map(check => <li key={check.id} className={`c-${check.state}`}>
        <span className="pw-status-mark" aria-hidden="true">{check.state === 'ok' ? <Check size={12} /> : check.state === 'organizer' ? <Shield size={12} /> : <CircleAlert size={12} />}</span>
        <span><strong>{check.label}<span className="sr-only">: {check.state === 'ok' ? 'met' : check.state === 'organizer' ? 'checked by the organizer' : 'needs attention'}</span></strong><small>{check.detail}</small><small className="pw-who">Reviewed by: {check.who}</small>{check.todo && <small className="pw-todo"><ArrowRight size={11} /> {check.todo}</small>}</span>
        {check.todo && check.id === 'identity' && <button type="button" className="ed-link-btn" onClick={() => onGo('profile')}>Open</button>}
        {check.todo && check.id === 'documents' && <button type="button" className="ed-link-btn" onClick={() => onGo('documents')}>Open</button>}
      </li>)}</ul>}
    </li>)}</ul> : <Empty icon={<ShieldCheck size={22} />}>No tournaments yet. Eligibility appears once your team includes you in a tournament.</Empty>}
    <p className="pw-footnote"><Lock size={13} /> You cannot approve your own eligibility. Organizers decide; this page explains what they check and what is still needed.</p>
  </div>
}

// --- Activity -----------------------------------------------------------------------
export function ActivitySection({ hub }: { hub: Hub }) {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [more, setMore] = useState(false)
  const load = (before: string | null) => { void loadActivity(hub.client, hub.playerId, before).then(result => { if (result.error) { setError(result.error); setState(result.available ? 'error' : 'ready'); return } setItems(current => before ? [...current, ...result.data] : result.data); setMore(result.data.length === 30); setState('ready') }) }
  useEffect(() => { load(null) }, [hub.client, hub.playerId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (state === 'loading') return <div className="pw-page"><div className="lp-skeleton" aria-hidden="true">{[0, 1, 2].map(index => <span key={index} className="skeleton" />)}</div></div>
  return <div className="pw-page">
    {state === 'error' ? <div className="lp-error" role="alert"><span><strong>Your activity could not be loaded.</strong></span><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => { setState('loading'); load(null) }}>Retry</button></div>
      : error ? <Pending>{error}</Pending>
        : items.length ? <ol className="pw-timeline">{items.map(item => <li key={item.id}><span className="pw-timeline-dot" /><div className="pw-timeline-body"><div className="pw-timeline-head"><History size={14} /><strong>{activityLabel(item.event)}</strong><small>{formatMaldivesDateTime(item.createdAt)}</small></div>{item.detail && <p className="pf-hint">{item.detail.replace(/_/g, ' ')}</p>}</div></li>)}</ol>
          : <Empty icon={<History size={22} />}>No activity yet. Changes you make to your profile, requests and documents appear here.</Empty>}
    {more && <button type="button" className="ed-btn ed-btn-ghost" onClick={() => load(items[items.length - 1]?.createdAt ?? null)}>Show older activity</button>}
    <p className="pw-footnote"><Lock size={13} /> Only your own activity is listed. National ID, claim codes and other people’s actions never appear here.</p>
  </div>
}

// --- Inbox -----------------------------------------------------------------------
export function ActionInbox({ actions, onGo }: { actions: InboxAction[]; onGo: (target: PlayerLocation) => void }) {
  return <Card icon={<ClipboardList size={18} />} title="Actions" sub={actions.length ? `${actions.length} need${actions.length === 1 ? 's' : ''} you` : 'Nothing to do'}>
    {actions.length ? <ul className="pw-tasks">{actions.map(item => <li key={item.key}><button type="button" onClick={() => onGo(item.target)}><span><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowRight size={14} /></button></li>)}</ul> : <Empty>No actions waiting. Information-only updates are below.</Empty>}
  </Card>
}

// --- Profile helpers --------------------------------------------------------------
export function AccountSeparation() {
  return <p className="pw-account-note"><UserRound size={14} /> This page edits your sports profile. To change your email, password, account name, language or active sessions, open <a href="#account">Account Settings</a>.</p>
}

export function ControlledFields({ onRequest }: { onRequest: (type: RequestType) => void }) {
  const rows: Array<[string, RequestType]> = [['National ID, legal name and date of birth', 'identity'], ['Identity verification status', 'verification'], ['Official team history', 'team_history'], ['Match appearances, goals, assists and cards', 'statistics'], ['Roster details', 'roster'], ['Tournament awards', 'statistics']]
  return <Card icon={<Lock size={18} />} title="Verified information" sub="Changed only through review">
    <ul className="pw-controlled">{rows.map(([label, type]) => <li key={label}><span>{label}</span><button type="button" className="ed-link-btn" onClick={() => onRequest(type)}>Request correction</button></li>)}</ul>
    <p className="pf-hint"><ShieldCheck size={13} /> These come from verified checks and confirmed match records, so you cannot edit them directly.</p>
  </Card>
}

// --- Public preview ---------------------------------------------------------------
// The real signed-out public page in a frame: the same loader, fields and
// rules guests get, never a private page with parts hidden.
export function PublicPreview({ slug, isPublished, card }: { slug: string; isPublished: boolean; card: ReactNode }) {
  const [mode, setMode] = useState<'desktop' | 'mobile' | 'card'>('mobile')
  const src = `${window.location.pathname}#player/${encodeURIComponent(slug)}`
  return <Card icon={<Eye size={18} />} title="Public preview" sub={isPublished ? 'Exactly what guests see' : 'Guests see nothing until you publish'}>
    <div className="pw-segments" role="radiogroup" aria-label="Preview size">{([['desktop', 'Desktop', <Monitor size={14} key="d" />], ['mobile', 'Mobile', <Smartphone size={14} key="m" />], ['card', 'Digital Card', <IdCard size={14} key="c" />]] as const).map(([id, label, icon]) => <button type="button" role="radio" key={id} aria-checked={mode === id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>{icon} {label}</button>)}</div>
    {mode === 'card' ? <div className="pw-preview-card">{card}</div>
      : isPublished ? <div className={`pw-preview pw-preview-${mode}`}><iframe title={`Public profile preview, ${mode}`} src={src} loading="lazy" /></div>
        : <p className="pw-empty"><Lock size={18} /> Your profile is private, so the public page shows “Public record not found”. Publish to make it visible.</p>}
    <a className="ed-link" href={`#player/${encodeURIComponent(slug)}`} target="_blank" rel="noopener noreferrer">Open public page <ArrowRight size={13} /></a>
  </Card>
}
