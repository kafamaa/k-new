import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { AlertTriangle, CalendarCheck, CalendarDays, ClipboardList, Cloud, CloudOff, Gauge, HelpCircle, LayoutGrid, Send } from 'lucide-react'
import { AttentionList, CountRow, NextActionPanel, WorkspaceShell, type ShellItem } from './WorkspaceShell'
import { EVENT_TYPES, confirmMatchResult, correctMatchResult, loadCurrentResultVersion, replayOperations, submitMatchResult, type LineupCandidate } from '../lib/matchCenter'
import { LineupEditor } from './LineupEditor'
import type { SyncOperation } from '../lib/matchOperations'
import { enqueueOperation, loadMatchQueue, pendingOperations, saveMatchQueue } from '../lib/matchOperations'
import {
  assignedMatchStatusLabel, loadOfficialWorkspace, officialRoleLabel, saveAvailability, splitAssignedMatches,
  staffPermissionLabel, validateAvailability, type AssignedMatch,
} from '../lib/officialWorkspace'
import { formatMatchSchedule } from '../lib/publicData'
import { markNotificationRead } from '../lib/playerWorkspace'
import { isOffline, readOffline, saveOffline } from '../lib/offlineCache'

type TabId = 'overview' | 'tournaments' | 'matches' | 'center' | 'availability' | 'notices'
type GroupId = 'home' | 'assignments' | 'center' | 'availability' | 'more'
const GROUPS: Array<ShellItem<GroupId> & { tabs: Array<{ id: TabId; label: string }> }> = [
  { id: 'home', label: 'Overview', icon: Gauge, tabs: [{ id: 'overview', label: 'Overview' }] },
  { id: 'assignments', label: 'Assignments', icon: CalendarDays, tabs: [{ id: 'matches', label: 'Assigned matches' }, { id: 'tournaments', label: 'Assigned tournaments' }] },
  { id: 'center', label: 'Match Center', icon: Send, tabs: [{ id: 'center', label: 'Match Center' }] },
  { id: 'availability', label: 'Availability', icon: CalendarCheck, tabs: [{ id: 'availability', label: 'Availability' }] },
  { id: 'more', label: 'Notices & Help', shortLabel: 'Notices', icon: LayoutGrid, tabs: [{ id: 'notices', label: 'Notifications & Help' }] },
]
const groupOf = (tab: TabId) => GROUPS.find(group => group.tabs.some(item => item.id === tab)) ?? GROUPS[0]


export function OfficialWorkspace({ client, user, onNotice }: { client: SupabaseClient; user: User; onNotice: (message: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadOfficialWorkspace>> | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabId>('overview')
  const [reloadKey, setReloadKey] = useState(0)
  const [offlineSince, setOfflineSince] = useState<string | null>(null)
  const reload = () => setReloadKey(value => value + 1)
  useEffect(() => { const back = () => setReloadKey(value => value + 1); window.addEventListener('online', back); return () => window.removeEventListener('online', back) }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true); setLoadError('')
      const result = await loadOfficialWorkspace(client, user.id)
      if (!active) return
      // Offline: fall back to the assignments this account last loaded.
      const cached = result.error ? readOffline<Awaited<ReturnType<typeof loadOfficialWorkspace>>>(user.id, 'official-workspace') : null
      if (cached && isOffline()) { setData(cached.value); setOfflineSince(cached.savedAt); setLoading(false); return }
      if (result.error) setLoadError(result.error)
      else { saveOffline(user.id, 'official-workspace', result); setOfflineSince(null) }
      setData(result)
      setLoading(false)
    })()
    return () => { active = false }
  }, [client, user.id, reloadKey])

  const nowIso = new Date().toISOString()
  const { upcoming, past } = useMemo(() => data ? splitAssignedMatches(data.matches, nowIso) : { upcoming: [], past: [] }, [data, nowIso])

  if (loading) return <div className="loading-state">Loading your assigned work…</div>
  if (loadError) return <div className="form-error" role="alert">Unable to load your assignments: {loadError}<button type="button" className="outline-button dark" onClick={reload}>Retry</button></div>
  if (!data) return <div className="loading-state">Loading your assigned work…</div>

  const nextMatch = upcoming[0]
  return <WorkspaceShell kindLabel="Official" title="Match operations" subtitle={`${data.matches.length} match · ${data.tournaments.length} tournament assignment${data.tournaments.length === 1 ? '' : 's'}`} items={GROUPS} active={groupOf(tab).id} onSelect={group => setTab(GROUPS.find(item => item.id === group)!.tabs[0].id)}>
    {groupOf(tab).tabs.length > 1 && <div className="pw-subtabs" role="tablist" aria-label={groupOf(tab).label}>{groupOf(tab).tabs.map(item => <button type="button" role="tab" key={item.id} aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>}
    {offlineSince && <div className="warning" role="status"><CloudOff size={14} /> You are offline. Showing your assignments as last loaded on {new Date(offlineSince).toLocaleString('en-GB', { timeZone: 'Indian/Maldives' })}. Events you record are queued and sync when you reconnect.</div>}
    {tab === 'overview' && <div className="ws-overview" role="tabpanel">
      <div className="ws-page-head"><div className="ws-identity"><div><strong>Your assigned matches</strong><small>Only matches and tournaments an organizer assigned to you appear here.</small></div></div><button type="button" className="ed-btn ed-btn-primary" onClick={() => setTab('center')}>Open Match Center</button></div>
      <NextActionPanel label={nextMatch ? `Next: ${nextMatch.match.tournamentName || 'Assigned match'}` : 'No upcoming assignment'} hint={nextMatch ? `${nextMatch.match.scheduledAt ? formatMatchSchedule(nextMatch.match.scheduledAt) : 'Time not published'}${nextMatch.match.venue ? ` · ${nextMatch.match.venue}` : ''} · ${officialRoleLabel(nextMatch.assignmentRole)}` : 'New assignments appear here as soon as an organizer records them.'} action={nextMatch ? { text: 'Record this match', onClick: () => setTab('center') } : undefined} />
      <AttentionList items={past.filter(row => row.match.status === 'awaiting_confirmation' || row.match.status === 'scheduled' || row.match.status === 'live').map(row => ({ key: `${row.match.id}-${row.assignmentRole}`, label: `${row.match.tournamentName || 'Assigned match'} · ${assignedMatchStatusLabel(row.match.status)}`, detail: row.match.scheduledAt ? formatMatchSchedule(row.match.scheduledAt) : undefined, onOpen: () => setTab('center') }))} empty="No past assignment is waiting on you." />
      <CountRow counts={[{ label: 'Upcoming matches', value: upcoming.length }, { label: 'Past matches', value: past.length }, { label: 'Tournaments', value: data.tournaments.length }]} />
      <section className="ws-block"><h2 className="ed-subhead"><CalendarDays size={16} /> Upcoming matches</h2>{upcoming.length ? <ul className="ws-rows">{upcoming.slice(0, 5).map(row => <li key={`${row.match.id}-${row.assignmentRole}`}><strong>{row.match.tournamentName || 'Assigned match'}</strong><span>{row.match.scheduledAt ? formatMatchSchedule(row.match.scheduledAt) : 'Time not published'}{row.match.venue ? ` · ${row.match.venue}` : ''}</span><small>{officialRoleLabel(row.assignmentRole)}</small></li>)}</ul> : <p className="ed-empty">No upcoming match assignment.</p>}</section>
    </div>}

    {tab === 'tournaments' && <div className="player-section" role="tabpanel">
      {data.tournaments.length
        ? <ul className="public-history">{data.tournaments.map(row => <li key={`${row.tournamentId}-${row.permission}`}>
            <strong>{row.name}</strong> · {staffPermissionLabel(row.permission)} · assigned {row.assignedAt ? new Date(row.assignedAt).toLocaleDateString() : 'date not recorded'}
          </li>)}</ul>
        : <small>No tournament-staff assignment exists for this account. You see only tournaments an organizer explicitly assigned you — never unrelated private records.</small>}
    </div>}

    {tab === 'matches' && <div className="player-section" role="tabpanel">
      <section className="player-card-section">
        <h4><CalendarDays size={15} /> Upcoming assignments</h4>
        {upcoming.length ? <ul className="public-history">{upcoming.map(row => <AssignmentRow key={`${row.match.id}-${row.assignmentRole}`} row={row} />)}</ul>
          : <small>No upcoming match assignment. Assignments appear here the moment an organizer records them.</small>}
      </section>
      <section className="player-card-section">
        <h4><ClipboardList size={15} /> Past assignments</h4>
        {past.length ? <ul className="public-history">{past.map(row => <AssignmentRow key={`${row.match.id}-${row.assignmentRole}`} row={row} />)}</ul>
          : <small>No past assignment is readable yet.</small>}
      </section>
      <p className="player-note">Only your assignments are listed. Internal tournament notes, private documents, payment data, and unpublished result versions are never loaded into this workspace.</p>
    </div>}

    {tab === 'center' && <OfficialMatchCenter client={client} user={user} matches={data.matches} onNotice={onNotice} reload={reload} />}

    {tab === 'availability' && <AvailabilityTab client={client} userId={user.id} initial={data.availability} onSaved={message => { onNotice(message); reload() }} />}

    {tab === 'notices' && <NoticesTab client={client} userId={user.id} onNotice={onNotice} reload={reload} />}
  </WorkspaceShell>
}

function AssignmentRow({ row }: { row: AssignedMatch }) {
  const [centerOpen, setCenterOpen] = useState(false)
  return <li>
    {row.match.scheduledAt ? formatMatchSchedule(row.match.scheduledAt) : 'Time not published'} · {row.match.tournamentName || 'Tournament'} · {officialRoleLabel(row.assignmentRole)} · {assignedMatchStatusLabel(row.match.status)}{row.match.venue ? ` · ${row.match.venue}` : ''}
    <button type="button" className="ghost-button" onClick={() => setCenterOpen(!centerOpen)}>{centerOpen ? 'Hide details' : 'Details'}</button>
    {centerOpen && <dl>
      <dt>Match</dt><dd>{row.match.id}</dd>
      <dt>Tournament page</dt><dd>{row.match.tournamentSlug ? <a href={`#tournament/${encodeURIComponent(row.match.tournamentSlug)}`}>{row.match.tournamentName}</a> : 'not published'}</dd>
      <dt>Assigned role</dt><dd>{officialRoleLabel(row.assignmentRole)}</dd>
      <dt>Match status</dt><dd>{assignedMatchStatusLabel(row.match.status)}</dd>
      <dt>Venue</dt><dd>{row.match.venue ?? 'Venue not published'}</dd>
      <dt>Sport</dt><dd>{row.match.tournamentSport || 'not published'}</dd>
    </dl>}
  </li>
}

// ---------------------------------------------------------------------------
// Match Center, preselected from real assignments. This keeps the offline-tolerant
// queue semantics of matchOperations (idempotency key per queued operation,
// conflict detection against a newer result version, explicit retry) while the
// identifiers come from the assignment list instead of being typed by hand.
// ---------------------------------------------------------------------------

function OfficialMatchCenter({ client, user, matches, onNotice, reload }: {
  client: SupabaseClient; user: User; matches: AssignedMatch[]; onNotice: (message: string) => void; reload: () => void
}) {
  const selectable = matches.filter(row => row.match.id)
  const [matchId, setMatchId] = useState('')
  const selected = selectable.find(row => row.match.id === matchId)
  const sport = selected?.match.tournamentSport ?? 'football'
  const [eventType, setEventType] = useState(EVENT_TYPES[sport]?.[0] ?? 'goal')
  const [minute, setMinute] = useState('')
  const [eventTeamId, setEventTeamId] = useState('')
  const [eventPlayerId, setEventPlayerId] = useState('')
  const [candidates, setCandidates] = useState<LineupCandidate[]>([])
  const [currentVersion, setCurrentVersion] = useState<number | null>(null)
  const [homeScore, setHomeScore] = useState('')
  const [awayScore, setAwayScore] = useState('')
  const [homeShootout, setHomeShootout] = useState('')
  const [awayShootout, setAwayShootout] = useState('')
  const [correctionReason, setCorrectionReason] = useState('')
  const [queue, setQueue] = useState<SyncOperation[]>([])
  const [busy, setBusy] = useState(false)
  const [resultId, setResultId] = useState('')

  // The queue belongs to the signed-in account: another account on the same
  // device never sees or replays it. It is kept across sign-out (unsynced events
  // are never silently dropped) and the server rechecks assignment on replay.
  const [queueLoaded, setQueueLoaded] = useState(false)
  useEffect(() => { setQueue(loadMatchQueue(user.id)); setQueueLoaded(true) }, [user.id])
  useEffect(() => { if (queueLoaded) saveMatchQueue(user.id, queue) }, [queue, queueLoaded, user.id])
  useEffect(() => { setEventType(EVENT_TYPES[sport]?.[0] ?? 'goal') }, [sport])
  // The base version an event is queued against. A different version at replay
  // means the result changed meanwhile, which is a conflict for review.
  useEffect(() => {
    setCurrentVersion(null); setEventTeamId(''); setEventPlayerId(''); setCandidates([])
    if (!matchId) return
    let active = true
    void loadCurrentResultVersion(client, matchId).then(version => { if (active) setCurrentVersion(version) })
    return () => { active = false }
  }, [client, matchId])

  const pending = pendingOperations(queue)
  const forMatch = queue.filter(operation => operation.matchId === matchId)
  const queued = forMatch.filter(operation => operation.status === 'queued')
  const conflicts = forMatch.filter(operation => operation.status === 'conflict')
  const rejected = forMatch.filter(operation => operation.status === 'rejected')
  const sports = EVENT_TYPES[sport] ?? []
  const teamName = (teamId: string) => teamId === selected?.match.homeTeamId ? 'Home team' : teamId === selected?.match.awayTeamId ? 'Away team' : 'Team'
  const teamOptions = [selected?.match.homeTeamId, selected?.match.awayTeamId].filter((id): id is string => Boolean(id))
  const teamNames = Object.fromEntries(teamOptions.map(id => [id, teamName(id)]))
  const playerOptions = candidates.filter(candidate => !eventTeamId || candidate.teamId === eventTeamId)

  const queueEvent = () => {
    if (!selected) return onNotice('Select an assigned match first.')
    const player = candidates.find(candidate => candidate.playerId === eventPlayerId)
    const operation: SyncOperation = {
      operationId: crypto.randomUUID(), matchId: selected.match.id, actorId: user.id, operationType: 'event',
      payload: { eventType, minute: minute ? Number(minute) : null, teamId: player?.teamId ?? (eventTeamId || null), playerId: player?.playerId ?? null },
      baseResultVersion: currentVersion, status: 'queued',
    }
    setQueue(current => enqueueOperation(current, operation))
    setMinute('')
    onNotice('Event queued with its own idempotency key. Replaying it never records it twice.')
  }

  const replay = async () => {
    setBusy(true)
    const latest = await loadCurrentResultVersion(client, matchId)
    const result = await replayOperations(client, forMatch, latest === null ? {} : { [matchId]: latest })
    setBusy(false)
    if (latest !== null) setCurrentVersion(latest)
    setQueue(previous => [...previous.filter(operation => operation.matchId !== matchId), ...result])
    const newConflicts = result.filter(operation => operation.status === 'conflict').length
    const newRejected = result.filter(operation => operation.status === 'rejected').length
    const stillQueued = result.filter(operation => operation.status === 'queued').length
    onNotice(newConflicts || newRejected || stillQueued ? `${newConflicts} need review, ${newRejected} refused by the database, ${stillQueued} still waiting for a connection. Nothing was overwritten.` : 'Queued events synced.')
    reload()
  }

  // Keeping a conflicted event re-bases it on the version now current: the
  // official has reviewed it, so it may replay. Discarding drops it locally.
  const keepConflict = (operationId: string) => setQueue(previous => previous.map(operation => operation.operationId === operationId ? { ...operation, status: 'queued', baseResultVersion: currentVersion, conflictReason: undefined } : operation))
  const discard = (operationId: string) => setQueue(previous => previous.filter(operation => operation.operationId !== operationId))

  const scorePayload = () => {
    const payload: Record<string, number> = { home: Number(homeScore), away: Number(awayScore) }
    if (homeShootout !== '' && awayShootout !== '') { payload.homeShootout = Number(homeShootout); payload.awayShootout = Number(awayShootout) }
    return payload
  }

  const submit = async () => {
    if (!selected) return onNotice('Select an assigned match first.')
    if (homeScore === '' || awayScore === '') return onNotice('Enter both scores.')
    if (queued.length || conflicts.length) return onNotice('Sync or resolve the queued events for this match before submitting the result.')
    setBusy(true)
    const result = await submitMatchResult(client, selected.match.id, scorePayload(), user.id)
    setBusy(false)
    if (result.error) return onNotice(`Result not submitted: ${result.error.message}`)
    setResultId(String(result.data))
    onNotice('Result submitted and awaiting organizer confirmation.')
    reload()
  }

  const confirm = async () => {
    if (!resultId) return onNotice('Submit a result first; confirmation needs that result version.')
    setBusy(true)
    const result = await confirmMatchResult(client, resultId, user.id)
    setBusy(false)
    onNotice(result.error ? `Not confirmed: ${result.error.message}` : 'Result confirmed; standings and milestones recalculate from this version.')
    reload()
  }

  const correct = async () => {
    if (!selected) return onNotice('Select an assigned match first.')
    if (!correctionReason.trim()) return onNotice('A correction reason is required.')
    if (homeScore === '' || awayScore === '') return onNotice('Enter both corrected scores.')
    setBusy(true)
    const result = await correctMatchResult(client, selected.match.id, scorePayload(), correctionReason.trim(), user.id)
    setBusy(false)
    onNotice(result.error ? `Correction not recorded: ${result.error.message}` : 'Correction recorded with an audit reason and a new result version.')
    setCorrectionReason('')
    reload()
  }

  return <div className="player-section" role="tabpanel">
    <div className="match-center">
      <div className="creator-header"><div><h4><Send size={15} /> Match Center</h4><p>Records only for matches you are assigned to. Offline work queues safely; a newer result is never overwritten.</p></div>
        <span className="private-label">{pending.length ? <><CloudOff size={12} /> {pending.length} pending sync</> : <><Cloud size={12} /> Synced</>}</span></div>
      <label>Assigned match<select value={matchId} onChange={event => setMatchId(event.target.value)}>
        <option value="">Select one of your assignments…</option>
        {selectable.map(row => <option value={row.match.id} key={row.match.id}>{row.match.tournamentName || 'Tournament'} · {row.match.scheduledAt ? formatMatchSchedule(row.match.scheduledAt) : 'unscheduled'}</option>)}
      </select></label>
      {!matchId && <small>Select an assigned match to enable the lineup, event and result forms.</small>}
      {selected && <>
        <LineupEditor client={client} userId={user.id} matchId={selected.match.id} teamNames={teamNames} onNotice={onNotice} onCandidates={setCandidates} />
        <div className="match-form">
          <label>Event<select value={eventType} onChange={event => setEventType(event.target.value)}>{sports.map(value => <option value={value} key={value}>{value.replace(/_/g, ' ')}</option>)}</select></label>
          <label>Team<select value={eventTeamId} onChange={event => { setEventTeamId(event.target.value); setEventPlayerId('') }}><option value="">Not recorded</option>{teamOptions.map(id => <option value={id} key={id}>{teamName(id)}</option>)}</select></label>
          <label>Player<select value={eventPlayerId} onChange={event => setEventPlayerId(event.target.value)}><option value="">Unassigned</option>{playerOptions.map(candidate => <option value={candidate.playerId} key={candidate.playerId}>{candidate.shirtNumber ? `#${candidate.shirtNumber} ` : ''}{candidate.name}</option>)}</select></label>
          <label>Minute (optional)<input type="number" min="0" value={minute} onChange={event => setMinute(event.target.value)} /></label>
          <button type="button" className="outline-button dark" onClick={queueEvent}>Queue event</button>
        </div>
        {queued.length ? <>
          <div className="warning"><AlertTriangle size={14} /> {queued.length} queued event(s) for this match. Replaying is safe: each keeps its idempotency key.</div>
          <button type="button" className="ghost-button" disabled={busy} onClick={() => { void replay() }}>Sync queued events now</button>
        </> : null}
        {conflicts.length ? <div className="warning" role="alert"><AlertTriangle size={14} /> Needs review: the result changed after these events were queued.
          <ul className="plain-list">{conflicts.map(operation => <li key={operation.operationId}>{String(operation.payload.eventType ?? 'event').replace(/_/g, ' ')}{operation.payload.minute != null ? ` · ${String(operation.payload.minute)}'` : ''}
            <button type="button" className="ghost-button" onClick={() => keepConflict(operation.operationId)}>Keep and resend</button>
            <button type="button" className="ghost-button" onClick={() => discard(operation.operationId)}>Discard</button></li>)}</ul>
        </div> : null}
        {rejected.length ? <div className="form-error" role="alert">Refused by the database (will not be retried):
          <ul className="plain-list">{rejected.map(operation => <li key={operation.operationId}>{String(operation.payload.eventType ?? 'event').replace(/_/g, ' ')} · {operation.conflictReason}<button type="button" className="ghost-button" onClick={() => discard(operation.operationId)}>Remove</button></li>)}</ul>
        </div> : null}
        <div className="result-form">
          <label>Home score<input type="number" min="0" value={homeScore} onChange={event => setHomeScore(event.target.value)} /></label>
          <label>Away score<input type="number" min="0" value={awayScore} onChange={event => setAwayScore(event.target.value)} /></label>
          <label>Home shootout (optional)<input type="number" min="0" value={homeShootout} onChange={event => setHomeShootout(event.target.value)} /></label>
          <label>Away shootout (optional)<input type="number" min="0" value={awayShootout} onChange={event => setAwayShootout(event.target.value)} /></label>
          <button type="button" className="primary-button" disabled={busy} onClick={() => { void submit() }}>Submit result</button>
          <button type="button" className="outline-button dark" disabled={busy || !resultId} onClick={() => { void confirm() }}>Confirm result</button>
        </div>
        <small>Shootout scores decide a knockout tie only; they never count toward regulation totals or standings.</small>
        <div className="correction-form">
          <label>Correction reason (organizer correction)<input value={correctionReason} onChange={event => setCorrectionReason(event.target.value)} /></label>
          <button type="button" className="outline-button dark" disabled={busy} onClick={() => { void correct() }}>Submit correction</button>
        </div>
      </>}
    </div>
  </div>
}

function AvailabilityTab({ client, userId, initial, onSaved }: { client: SupabaseClient; userId: string; initial: Record<string, unknown> | null; onSaved: (message: string) => void }) {
  const [form, setForm] = useState({ availableFrom: String(initial?.available_from ?? ''), availableTo: String(initial?.available_to ?? ''), note: String(initial?.note ?? '') })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hasSaved = Boolean(initial || form.availableFrom || form.availableTo || form.note)
  return <div className="player-section" role="tabpanel">
    <section className="player-card-section">
      <h4><CalendarDays size={15} /> My availability</h4>
      {hasSaved && initial ? <p>Saved: {String(initial.available_from ?? 'no start date')} – {String(initial.available_to ?? 'no end date')} {String(initial.note ?? '')}</p> : <small>Availability is stored for this account only; organizers do not read it automatically.</small>}
      <p className="player-note">Availability depends on the reviewed availability migration (202610240021). Until it is applied, saving shows a truthful "not active yet" message and nothing is stored.</p>
    </section>
    <form onSubmit={async (event: React.FormEvent) => {
      event.preventDefault(); setError(''); setBusy(true)
      const problem = validateAvailability(form)
      if (problem) { setBusy(false); return setError(problem) }
      const result = await saveAvailability(client, userId, form)
      setBusy(false)
      if (result.error) return setError(result.error)
      onSaved('Availability saved.')
    }}>
      <label>Available from (optional)<input type="date" value={form.availableFrom} onChange={event => setForm({ ...form, availableFrom: event.target.value })} /></label>
      <label>Available to (optional)<input type="date" value={form.availableTo} onChange={event => setForm({ ...form, availableTo: event.target.value })} /></label>
      <label>Note<input value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} placeholder="e.g. evenings after 6pm" /></label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="button-row"><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save availability'}</button></div>
    </form>
  </div>
}

function NoticesTab({ client, userId, onNotice, reload }: { client: SupabaseClient; userId: string; onNotice: (message: string) => void; reload: () => void }) {
  const [notifications, setNotifications] = useState<Record<string, unknown>[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void (async () => {
      const result = await client.from('notifications').select('id,title,body,state,created_at').eq('recipient_id', userId).order('created_at', { ascending: false }).limit(20)
      if (!active) return
      if (result.error) setError(result.error.message)
      else setNotifications((result.data ?? []) as Record<string, unknown>[])
    })()
    return () => { active = false }
  }, [client, userId, reload])
  return <div className="player-section" role="tabpanel">
    <section className="player-card-section">
      <h4><ClipboardList size={15} /> Notifications</h4>
      {error ? <div className="form-error" role="alert">{error}</div>
        : notifications === null ? <div className="loading-state">Loading notifications…</div>
          : notifications.length ? <ul className="public-history">{notifications.map(notification => {
            const unread = String(notification.state ?? "") !== "read"
            return <li key={String(notification.id)}>{unread ? <b>[unread] </b> : null}<strong>{String(notification.title ?? "Notification")}</strong> — {String(notification.body ?? "")}
              {unread && <button type="button" className="ghost-button" onClick={async () => { const result = await markNotificationRead(client, userId, String(notification.id)); if (result.error) onNotice("Not marked read: " + result.error); else reload() }}>Mark read</button>}
            </li>
          })}</ul> : <small>No notifications for this account yet.</small>}
    </section>
    <section className="player-card-section">
      <h4><HelpCircle size={15} /> Help</h4>
    </section>
  </div>
}
