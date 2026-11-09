import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowRight, BarChart3, BellRing, CalendarDays, Check, CheckCheck, ChevronDown, ClipboardList, Download, ExternalLink, FileLock2, Filter, Flag, Lock, Mail,
  MapPin, Pencil, Plus, Printer, Radio, RefreshCw, RotateCcw, Send, ShieldCheck, Timer, Trophy, Upload, Wallet, X,
} from 'lucide-react'
import {
  addFinanceRecord, APPLICATION_STATUS_LABELS, EMPTY_STATS_FILTER, entryGroup, EXPENSE_CATEGORIES, FINANCE_CATEGORY_LABELS, financeCsv, financeSummary, FIXTURE_BUCKET_LABELS, filterTeamMatches, formatMvr,
  groupFixtures, INCOME_CATEGORIES, loadFinance, loadMatchParticipants, loadResultReports, loadRosterLimits, loadRosterVersions, loadTeamDocuments, openTeamPrivateFile, PAYMENT_STATUS_LABELS,
  PRIVATE_FILE_TYPES, removeTeamDocument, RESULT_REPORT_TYPES, ROSTER_STATUS_LABELS, statusTone, submitResultReport, submitRosterLines, TEAM_DOCUMENT_CATEGORIES, teamOutcome, teamTotals,
  TOURNAMENT_GROUP_LABELS, tournamentHistory, updateFinanceDraft, uploadTeamDocument, validateFinance, validateRosterLines, voidFinanceRecord,
  type FinanceDraft, type FinanceRecord, type FixtureBucket, type MatchParticipant, type ResultReport, type RosterLine, type RosterVersion, type StatsFilter, type TeamDocument, type TeamMatch, type TournamentGroup,
} from '../lib/teamHub'
import { CATEGORY_TABS, dayGroupLabel, loadNotificationPreferences, NEEDS_030, NOTIFICATION_CATEGORIES, notificationCategory, saveNotificationPreferences, TOURNAMENT_STATUS_LABELS, type NotificationCategory, type NotificationPreferences } from '../lib/playerHub'
import { changeApplicationStatus } from '../lib/teamWorkspace'
import { uploadPrivateDocument } from '../lib/tournament'
import { formatFileSize } from '../lib/documents'
import { formatMaldivesDateTime } from '../lib/publicData'
import { formatDay, sportName } from '../lib/display'
import { sortStandings, type StandingsRow } from '../lib/competitionRecords'
import { Crest } from './Editorial'
import { Card, Empty, Pending, Pill, Segments } from './HubUi'
import { Denied, type TeamCtx, type TeamSection } from './TeamHubTabs'
import { TeamProtests } from './TeamProtests'
import { ConfirmAction } from './ConfirmAction'
import { TeamPaymentProof } from './TeamPaymentProof'
import { RosterPlayerEditor } from './RosterPlayerEditor'

const one = (value: unknown): Record<string, unknown> | null => Array.isArray(value) ? (value[0] as Record<string, unknown> | undefined) ?? null : value && typeof value === 'object' ? value as Record<string, unknown> : null
const NOW = () => new Date().toISOString()
const entryName = (ctx: TeamCtx, entry: Record<string, unknown>) => String(one(entry.tournaments)?.name ?? ctx.tournaments.get(String(entry.tournament_id))?.name ?? 'Tournament')
const tournamentLink = (slug: string, tab?: string) => `#tournament/${encodeURIComponent(slug)}${tab ? `?tab=${tab}` : ''}`

// --- Tournaments ------------------------------------------------------------------------
export function TeamTournamentsSection({ ctx, details }: { ctx: TeamCtx; details: Map<string, { organizerName: string | null; island: string | null; startsAt: string | null }> }) {
  const entered = new Set(ctx.data.entries.map(entry => String(entry.tournament_id)))
  type Item = { id: string; group: TournamentGroup; entry: Record<string, unknown> | null }
  const items: Item[] = [
    ...ctx.openTournaments.filter(card => !entered.has(card.id)).map(card => ({ id: card.id, group: 'registration' as TournamentGroup, entry: null })),
    ...ctx.data.entries.map(entry => ({ id: String(entry.tournament_id), group: entryGroup({ applicationStatus: String(entry.application_status), tournamentStatus: ctx.tournaments.get(String(entry.tournament_id))?.status ?? '' }), entry })),
  ]
  const groups = (Object.keys(TOURNAMENT_GROUP_LABELS) as TournamentGroup[]).map(group => ({ group, items: items.filter(item => item.group === group) })).filter(group => group.items.length)
  return <div className="pw-page team-tournament-entries" role="tabpanel">
    {groups.length ? groups.map(({ group, items: list }) => <section key={group} className="tw-group">
      <h3 className="tw-group-title">{TOURNAMENT_GROUP_LABELS[group]} <span>{list.length}</span></h3>
      <div className="pw-tour-grid">{list.map(item => {
        const card = ctx.tournaments.get(item.id) ?? ctx.openTournaments.find(open => open.id === item.id)
        const detail = details.get(item.id)
        const entry = item.entry
        const slug = card?.isPublished ? card.slug : ''
        return <article key={`${item.id}-${group}`} className="pw-tour">
          <div className="pw-tour-cover" style={card?.coverUrl ? { backgroundImage: `url("${card.coverUrl}")` } : undefined}><span className="pw-tour-logo">{card?.logoUrl ? <img src={card.logoUrl} alt="" /> : <Trophy size={20} />}</span><Pill tone={card?.status === 'registration_open' ? 'ok' : 'info'}>{TOURNAMENT_STATUS_LABELS[card?.status ?? ''] ?? card?.status ?? 'Tournament'}</Pill></div>
          <div className="pw-tour-body">
            <h4>{card?.name ?? (entry ? entryName(ctx, entry) : 'Tournament')}</h4>
            <p className="pw-match-meta">{[card?.sport ? sportName(card.sport) : null, detail?.organizerName].filter(Boolean).join(' · ')}</p>
            <dl className="pw-dl compact">
              <div><dt>Dates</dt><dd>{formatDay(card?.startsAt ?? detail?.startsAt) ?? 'To be announced'}</dd></div>
              <div><dt>Location</dt><dd>{detail?.island ?? '—'}</dd></div>
              {entry && <><div><dt>Application</dt><dd><Pill tone={statusTone(String(entry.application_status))}>{APPLICATION_STATUS_LABELS[String(entry.application_status)] ?? String(entry.application_status)}</Pill></dd></div>
                <div><dt>Roster</dt><dd><Pill tone={statusTone(String(entry.roster_status))}>{ROSTER_STATUS_LABELS[String(entry.roster_status)] ?? String(entry.roster_status)}</Pill></dd></div>
                <div><dt>Payment</dt><dd><Pill tone={statusTone(String(entry.payment_status))}>{PAYMENT_STATUS_LABELS[String(entry.payment_status)] ?? String(entry.payment_status)}</Pill></dd></div></>}
            </dl>
            <div className="pw-link-row">
              {slug && <a href={tournamentLink(slug)}><ExternalLink size={12} /> View</a>}
              {!entry && slug && ctx.access.can('manage_applications') && <a href={`#register/${encodeURIComponent(slug)}`} className="tw-primary-link">Register team</a>}
              {entry && ['draft', 'changes_requested'].includes(String(entry.application_status)) && <button type="button" onClick={() => ctx.open('applications')}>Continue application</button>}
              {entry && <button type="button" onClick={() => ctx.open('applications')}>View application</button>}
              {entry?.application_status === 'approved' && <button type="button" onClick={() => ctx.open('rosters')}>Manage roster</button>}
              {entry && entry.payment_status !== 'not_required' && <button type="button" onClick={() => ctx.open('applications')}>View payment</button>}
              {entry && slug && <><a href={tournamentLink(slug, 'results')}>Fixtures & results</a><a href={tournamentLink(slug, 'standings')}>Standings</a><a href={tournamentLink(slug, 'bracket')}>Bracket</a></>}
            </div>
          </div>
        </article>
      })}</div>
    </section>) : <Empty icon={<Trophy size={22} />}>No tournaments yet. Published tournaments with open registration appear here.</Empty>}
  </div>
}

// --- Applications -----------------------------------------------------------------------
const APP_STEPS = ['draft', 'submitted', 'under_review', 'decision'] as const
export function TeamApplicationsSection({ ctx }: { ctx: TeamCtx }) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [proofEntry, setProofEntry] = useState<Record<string, unknown> | null>(null)
  const can = ctx.access.can('manage_applications')
  const change = async (entry: Record<string, unknown>, status: 'submitted' | 'withdrawn', done: string) => {
    setBusy(String(entry.id)); setError('')
    const result = await changeApplicationStatus(ctx.client, String(entry.id), status)
    setBusy(null); setConfirming(null)
    if (result.error) return setError(result.error)
    ctx.notice(done); ctx.reload()
  }
  const uploadProof = async (file: File) => {
    const entry = proofEntry
    if (!entry || !can) return
    if (!PRIVATE_FILE_TYPES.includes(file.type)) return setError('Upload a PDF, PNG or JPG file.')
    setBusy(String(entry.id))
    const result = await uploadPrivateDocument(ctx.client, String(entry.tournament_id), String(entry.id), ctx.userId, file, 'payment_proof')
    setBusy(null)
    if (result.error) return setError(result.error)
    setProofEntry(null); ctx.notice('Payment proof uploaded privately. The organizer verifies it and updates the payment status.'); ctx.reload()
  }
  if (proofEntry && can) return <TeamPaymentProof teamName={ctx.profile.name} tournamentName={entryName(ctx, proofEntry)} paymentStatus={String(proofEntry.payment_status)} busy={busy !== null} error={error} onBack={() => { setProofEntry(null); setError('') }} onUpload={uploadProof} />
  if (!ctx.data.entries.length) return <div className="pw-page" role="tabpanel"><Empty icon={<ClipboardList size={22} />}>No applications yet. Open Tournaments and use Register on a tournament with open registration.</Empty></div>
  return <div className="pw-page" role="tabpanel">
    {error && <p className="form-error" role="alert">{error}</p>}
    {!can && <Pending>You can view applications. Submitting or withdrawing needs the Manage tournament applications permission.</Pending>}
    {ctx.data.entries.map(entry => {
      const id = String(entry.id); const status = String(entry.application_status)
      const card = ctx.tournaments.get(String(entry.tournament_id))
      const step = status === 'draft' ? 0 : status === 'submitted' ? 1 : status === 'under_review' || status === 'changes_requested' ? 2 : 3
      const proofs = ctx.data.documents.filter(document => String(document.entry_id) === id && document.document_type === 'payment_proof')
      return <Card key={id} icon={<ClipboardList size={18} />} title={entryName(ctx, entry)} sub={entry.submitted_at ? `Submitted ${formatMaldivesDateTime(String(entry.submitted_at))}` : 'Not submitted yet'} action={<Pill tone={statusTone(status)}>{APPLICATION_STATUS_LABELS[status] ?? status}</Pill>}>
        <ol className="tw-steps">{APP_STEPS.map((item, index) => <li key={item} className={index < step ? 'done' : index === step ? 'current' : ''}><span>{index < step ? <Check size={12} /> : index + 1}</span>{item === 'decision' ? (['approved', 'rejected', 'withdrawn'].includes(status) ? APPLICATION_STATUS_LABELS[status] : 'Decision') : APPLICATION_STATUS_LABELS[item]}</li>)}</ol>
        <div className="tw-status-row">
          <div><small>Application</small><Pill tone={statusTone(status)}>{APPLICATION_STATUS_LABELS[status] ?? status}</Pill></div>
          <div><small>Roster</small><Pill tone={statusTone(String(entry.roster_status))}>{ROSTER_STATUS_LABELS[String(entry.roster_status)] ?? String(entry.roster_status)}</Pill></div>
          <div><small>Payment</small><Pill tone={statusTone(String(entry.payment_status))}>{PAYMENT_STATUS_LABELS[String(entry.payment_status)] ?? String(entry.payment_status)}</Pill></div>
        </div>
        {entry.review_notes ? <p className="pw-note-box"><AlertTriangle size={13} /> Organizer notes: {String(entry.review_notes)}</p> : null}
        {proofs.length > 0 && <p className="pf-hint"><ShieldCheck size={13} /> {proofs.length} payment proof file{proofs.length === 1 ? '' : 's'} uploaded privately.</p>}
        {can && <div className="pw-actions">
          {status === 'draft' && card?.slug && <a className="ed-btn ed-btn-ghost ed-btn-sm" href={`#register/${encodeURIComponent(card.slug)}`}>Continue application form</a>}
          {status === 'draft' && <button type="button" className="ed-btn ed-btn-primary ed-btn-sm" disabled={busy === id} onClick={() => void change(entry, 'submitted', 'Application submitted to the organizer.')}><Send size={13} /> Submit</button>}
          {status === 'changes_requested' && <button type="button" className="ed-btn ed-btn-primary ed-btn-sm" disabled={busy === id} onClick={() => void change(entry, 'submitted', 'Application resubmitted.')}><RotateCcw size={13} /> Resubmit after changes</button>}
          {['unpaid', 'overdue', 'proof_submitted', 'under_review'].includes(String(entry.payment_status)) && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={busy === id} onClick={() => { setError(''); setProofEntry(entry) }}><Upload size={13} /> Upload payment proof</button>}
          {['draft', 'submitted', 'changes_requested'].includes(status) && (confirming === id
            ? <span className="tw-confirm"><span>Withdraw? The record is kept but cannot be reopened.</span><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={() => void change(entry, 'withdrawn', 'Application withdrawn. Its history stays recorded.')}>Confirm</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setConfirming(null)}>Keep</button></span>
            : <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setConfirming(id)}><X size={13} /> Withdraw</button>)}
        </div>}
      </Card>
    })}
    <p className="pw-footnote"><ShieldCheck size={13} /> One application per team and tournament; deadlines use Maldives time. Application, roster and payment statuses are tracked separately.</p>
  </div>
}

// --- Rosters --------------------------------------------------------------------------------
export function TeamRostersSection({ ctx }: { ctx: TeamCtx }) {
  const approved = ctx.data.entries.filter(entry => entry.application_status === 'approved')
  const [selected, setSelected] = useState(approved[0] ? String(approved[0].id) : '')
  if (!approved.length) return <div className="pw-page" role="tabpanel"><Empty icon={<ClipboardList size={22} />}>Roster building opens after an organizer approves a tournament application.</Empty></div>
  const entry = approved.find(item => String(item.id) === selected) ?? approved[0]
  return <div className="pw-page" role="tabpanel">
    {approved.length > 1 && <Segments label="Tournament rosters" active={String(entry.id)} onChange={setSelected} items={approved.map(item => ({ id: String(item.id), label: entryName(ctx, item) }))} />}
    <RosterEditor key={String(entry.id)} ctx={ctx} entry={entry} />
  </div>
}

function RosterEditor({ ctx, entry }: { ctx: TeamCtx; entry: Record<string, unknown> }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [limits, setLimits] = useState<{ min: number | null; max: number | null; known: boolean }>({ min: null, max: null, known: false })
  const [versions, setVersions] = useState<RosterVersion[]>([])
  const [lines, setLines] = useState<RosterLine[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const entryId = String(entry.id)
  const status = String(entry.roster_status)
  const locked = status === 'locked'
  const can = ctx.access.can('manage_rosters') && !locked
  const members = ctx.data.playerHistory.filter(row => row.status === 'active' || row.status === 'loaned')
  useEffect(() => {
    let active = true
    void loadRosterLimits(ctx.client, String(entry.tournament_id)).then(result => { if (active) setLimits(result) })
    void loadRosterVersions(ctx.client, entryId).then(result => { if (active) setVersions(result) })
    return () => { active = false }
  }, [ctx.client, entry.tournament_id, entryId])
  const toggle = (row: Record<string, unknown>) => {
    const playerId = String(row.player_id)
    if (lines.some(line => line.playerId === playerId)) return setLines(lines.filter(line => line.playerId !== playerId))
    const player = one(row.player_profiles)
    setLines([...lines, { playerId, name: String(player?.display_name ?? 'Private player record'), shirtNumber: row.jersey_number != null ? String(row.jersey_number) : '', position: String(row.position ?? ''), isCaptain: row.squad_role === 'captain', isGoalkeeper: /keeper|gk/i.test(String(row.position ?? '')), claimed: Boolean(player), identity: 'unknown' }])
  }
  const update = (playerId: string, patch: Partial<RosterLine>) => setLines(lines.map(line => line.playerId === playerId ? { ...line, ...patch } : patch.isCaptain ? { ...line, isCaptain: false } : line))
  const problems = validateRosterLines(lines, limits)
  const submit = async () => {
    setBusy(true); setError('')
    const result = await submitRosterLines(ctx.client, entryId, ctx.userId, lines)
    setBusy(false)
    if (result.error) return setError(result.error)
    ctx.notice('A new roster version was submitted. Earlier versions stay on record.'); setLines([]); ctx.reload()
  }
  const latest = versions[0]
  const editing = lines.find(line => line.playerId === editingId)
  if (editing && can) {
    const player = one(members.find(row => String(row.player_id) === editingId)?.player_profiles)
    return <RosterPlayerEditor key={editing.playerId} line={editing} otherLines={lines.filter(line => line.playerId !== editing.playerId)} teamName={ctx.profile.name} teamLogo={ctx.profile.logoUrl} tournamentName={entryName(ctx, entry)} code={player?.public_code ? String(player.public_code) : null} photo={player?.photo_url ? String(player.photo_url) : null} onBack={() => setEditingId(null)} onApply={line => { update(line.playerId, line); setEditingId(null) }} />
  }
  return <div className="pw-two">
    <div className="pw-stack">
      <div className="pw-counters">
        <div><b>{limits.min ?? '—'}</b><small>Minimum players</small></div>
        <div><b>{limits.max ?? '—'}</b><small>Maximum players</small></div>
        <div><b>{latest?.players.length ?? 0}</b><small>In latest version</small></div>
        <div><b>{latest ? `v${latest.version}` : '—'}</b><small>Roster version</small></div>
      </div>
      <Card icon={<ClipboardList size={18} />} title={entryName(ctx, entry)} sub={locked ? 'Locked by the organizer' : 'Choose players, then submit a version'} action={<Pill tone={statusTone(status)}>{ROSTER_STATUS_LABELS[status] ?? status}</Pill>}>
        {latest?.notes && ['changes_requested', 'rejected'].includes(latest.status) && <p className="pw-note-box"><AlertTriangle size={13} /> Organizer correction notes: {latest.notes}</p>}
        {locked ? <Pending>The roster is approved and locked. Changes need the organizer’s authorization.</Pending> : !ctx.access.can('manage_rosters') ? <Denied permission="manage_rosters" /> : <>
          {members.length ? <ul className="tw-roster-pick">{members.map(row => { const playerId = String(row.player_id); const line = lines.find(item => item.playerId === playerId); return <li key={String(row.id)} className={line ? 'on' : ''}>
            <label className="tw-roster-check"><input type="checkbox" checked={Boolean(line)} onChange={() => toggle(row)} /><span>{String(one(row.player_profiles)?.display_name ?? 'Private player record')}</span></label>
            {line && <div className="tw-roster-fields">
              <input aria-label="Shirt number" inputMode="numeric" maxLength={2} placeholder="#" value={line.shirtNumber} onChange={event => update(playerId, { shirtNumber: event.target.value.replace(/\D/g, '') })} />
              <input aria-label="Position" placeholder="Position" maxLength={40} value={line.position} onChange={event => update(playerId, { position: event.target.value })} />
              <label><input type="checkbox" checked={line.isCaptain} onChange={event => update(playerId, { isCaptain: event.target.checked })} /> C</label>
              <label><input type="checkbox" checked={line.isGoalkeeper} onChange={event => update(playerId, { isGoalkeeper: event.target.checked })} /> GK</label>
              <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setEditingId(playerId)} aria-label={`Edit roster details for ${line.name}`}><Pencil size={14} aria-hidden="true" /> Edit details</button>
            </div>}
          </li> })}</ul> : <Empty>No active team players yet. Add players in the Players section first.</Empty>}
          {lines.length > 0 && <div className={`tw-validation${problems.length ? ' bad' : ' ok'}`}>{problems.length ? <ul>{problems.map(problem => <li key={problem}><AlertTriangle size={13} /> {problem}</li>)}</ul> : <p><Check size={14} /> {lines.length} players · ready to submit</p>}{!limits.known && <p className="pf-hint">The tournament’s roster limits are not readable here; the organizer checks them on review.</p>}</div>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <footer className="pf-card-foot"><button type="button" className="ed-btn ed-btn-primary" disabled={!can || busy || !lines.length || problems.length > 0} onClick={() => void submit()}>{busy ? 'Submitting…' : `Submit roster version ${versions.length + 1}`}</button></footer>
        </>}
        <p className="pf-hint"><Lock size={13} /> Legal names, dates of birth, ID verification and ID images are collected privately by the organizer and players; none of it appears publicly.</p>
      </Card>
    </div>
    <Card icon={<RefreshCw size={18} />} title="Version history" sub="Every submission is kept" className="pw-sticky">
      {versions.length ? <ol className="tw-versions">{versions.map(version => <li key={version.id}>
        <div className="pw-request-head"><strong>Version {version.version}</strong><Pill tone={statusTone(version.status)}>{ROSTER_STATUS_LABELS[version.status] ?? version.status}</Pill></div>
        <small className="pf-hint">{formatMaldivesDateTime(version.createdAt)} · {version.players.length} players</small>
        {version.notes && <p className="pw-note-box">{version.notes}</p>}
        <details><summary>Players</summary><ul className="tw-version-players">{version.players.map((player, index) => <li key={index}>{player.shirt ? `#${player.shirt} ` : ''}{player.name}{player.position ? ` · ${player.position}` : ''}{player.captain ? ' · C' : ''}</li>)}</ul></details>
      </li>)}</ol> : <p className="pf-hint">No roster submitted yet.</p>}
    </Card>
  </div>
}

// --- Fixtures & results -------------------------------------------------------------------
export function TeamFixturesSection({ ctx }: { ctx: TeamCtx }) {
  const groups = groupFixtures(ctx.matches, NOW())
  const [bucket, setBucket] = useState<FixtureBucket>(groups.live.length ? 'live' : groups.upcoming.length ? 'upcoming' : 'completed')
  const [reports, setReports] = useState<ResultReport[]>([])
  const [reportsAvailable, setReportsAvailable] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => { let active = true; void loadResultReports(ctx.client, { teamId: ctx.teamId }).then(result => { if (active) { setReports(result.data); setReportsAvailable(!result.error) } }); return () => { active = false } }, [ctx.client, ctx.teamId, reloadKey])
  return <div className="pw-page" role="tabpanel">
    <Segments label="Fixture groups" active={bucket} onChange={setBucket} items={(Object.keys(FIXTURE_BUCKET_LABELS) as FixtureBucket[]).map(id => ({ id, label: FIXTURE_BUCKET_LABELS[id], count: groups[id].length }))} />
    {!ctx.matchesAvailable && <Pending>Opponent names, stage and group, and card counts appear once migration 031 is applied.</Pending>}
    {groups[bucket].length ? <ul className="pw-matches">{groups[bucket].map(match => <FixtureCard key={match.id} ctx={ctx} match={match} reports={reports.filter(report => report.matchId === match.id)} reportsAvailable={reportsAvailable} onReported={() => setReloadKey(value => value + 1)} />)}</ul>
      : <Empty icon={<CalendarDays size={22} />}>No {FIXTURE_BUCKET_LABELS[bucket].toLowerCase()} matches.</Empty>}
    <TeamProtests ctx={ctx} />
    <p className="pw-footnote"><ShieldCheck size={13} /> Team managers view fixtures and confirmed results. Officials confirm results; organizers decide correction reports. Old and corrected versions are both kept.</p>
  </div>
}

function FixtureCard({ ctx, match, reports, reportsAvailable, onReported }: { ctx: TeamCtx; match: TeamMatch; reports: ResultReport[]; reportsAvailable: boolean; onReported: () => void }) {
  const [open, setOpen] = useState<'lineup' | 'report' | null>(null)
  const [players, setPlayers] = useState<MatchParticipant[] | null>(null)
  const [report, setReport] = useState({ type: 'score', message: '' })
  const [error, setError] = useState('')
  const outcome = teamOutcome(match)
  const date = match.scheduledAt ? new Date(match.scheduledAt) : null
  const part = (options: Intl.DateTimeFormatOptions) => date ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Maldives', ...options }).format(date) : ''
  const showLineup = async () => {
    if (open === 'lineup') return setOpen(null)
    setOpen('lineup')
    if (!players) { const result = await loadMatchParticipants(ctx.client, ctx.teamId, match.id); setPlayers(result.data); if (result.error) setError(result.error) }
  }
  const send = async () => {
    setError('')
    const result = await submitResultReport(ctx.client, { teamId: ctx.teamId, matchId: match.id, tournamentId: match.tournamentId, userId: ctx.userId, type: report.type, message: report.message })
    if (result.error) return setError(result.error)
    setOpen(null); setReport({ type: 'score', message: '' }); ctx.notice('Report sent to the tournament organizer.'); onReported()
  }
  return <li className={`pw-match tw-fixture${match.status === 'live' ? ' live' : ''}`}>
    <div className="pw-match-date">{date ? <><b>{part({ day: 'numeric' })}</b><small>{part({ month: 'short' })}</small><em>{part({ hour: '2-digit', minute: '2-digit', hour12: false })}</em></> : <small>TBC</small>}</div>
    <div className="pw-match-body">
      <p className="pw-match-meta">{[match.tournamentName, match.stage, match.group].filter(Boolean).join(' · ')}</p>
      <div className="pw-match-teams"><span className="mine">{match.isHome ? 'Home' : 'Away'}</span><b className="pw-score">{match.resultConfirmed ? `${match.teamScore} – ${match.opponentScore}` : 'vs'}</b><span><Crest name={match.opponentName} logoUrl={match.opponentLogo} size="sm" /> {match.opponentName}</span></div>
      <p className="pw-match-sub">{match.venue ? <><MapPin size={12} /> {match.venue}</> : 'Venue to be confirmed'}{match.confirmedAt ? ` · confirmed ${formatDay(match.confirmedAt)}` : ''}</p>
      {match.resultConfirmed && (match.yellow + match.red > 0) && <div className="pw-chips"><span className="pw-chip cards">{match.yellow ? <i className="card-y" /> : null}{match.red ? <i className="card-r" /> : null} {match.yellow} yellow · {match.red} red</span></div>}
      {reports.length > 0 && <div className="pw-chips">{reports.map(item => <span key={item.id} className="pw-chip"><Flag size={11} /> {RESULT_REPORT_TYPES.find(type => type.value === item.type)?.label}: {item.status.replace('_', ' ')}{item.note ? ` — ${item.note}` : ''}</span>)}</div>}
      {open === 'lineup' && <div className="tw-lineup">{players === null ? <p className="pf-hint">Loading…</p> : players.length ? <table className="pw-table"><thead><tr><th>Player</th><th>Role</th><th>Min</th><th>G</th><th>A</th><th>Y</th><th>R</th></tr></thead><tbody>{players.map(player => <tr key={player.playerId}><td>{player.name}</td><td>{player.starter ? 'Started' : 'Sub'}</td><td>{player.minutes ?? '—'}</td><td>{player.goals}</td><td>{player.assists}</td><td>{player.yellow}</td><td>{player.red}</td></tr>)}</tbody></table> : <p className="pf-hint">{error || 'No confirmed lineup for this match.'}</p>}</div>}
      {open === 'report' && <div className="pw-inline-form">
        <label className="pf-field">What is wrong?<select value={report.type} onChange={event => setReport({ ...report, type: event.target.value })}>{RESULT_REPORT_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
        <label className="pf-field">Reason and evidence<textarea rows={3} value={report.message} onChange={event => setReport({ ...report, message: event.target.value })} placeholder="What happened, and what should the record say? Mention any video or match sheet." /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="pw-actions"><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={() => void send()}><Send size={13} /> Send to organizer</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setOpen(null)}>Cancel</button></div>
      </div>}
    </div>
    <div className="pw-match-side">
      {outcome ? <span className={`pw-outcome o-${outcome}`}>{outcome}</span> : match.status === 'live' ? <Pill tone="live"><Radio size={11} /> Live</Pill> : null}
      <Pill tone={match.resultConfirmed ? 'ok' : ['postponed', 'cancelled', 'abandoned'].includes(match.status) ? 'bad' : match.status === 'awaiting_confirmation' ? 'warn' : 'info'}>{match.resultConfirmed ? 'Official result' : match.status === 'awaiting_confirmation' ? 'Awaiting confirmation' : match.status.replace(/_/g, ' ')}</Pill>
      {match.resultConfirmed && <button type="button" className="ed-link-btn" onClick={() => void showLineup()}><ChevronDown size={13} /> Players</button>}
      {match.resultConfirmed && reportsAvailable && ctx.access.can('manage_rosters') && <button type="button" className="ed-link-btn" onClick={() => setOpen(open === 'report' ? null : 'report')}><Flag size={13} /> Report issue</button>}
      {match.resultConfirmed && match.tournamentPublished ? <a className="ed-link" href={`#match/${encodeURIComponent(match.id)}`}>View match <ArrowRight size={12} /></a> : match.tournamentPublished && match.tournamentSlug ? <a className="ed-link" href={tournamentLink(match.tournamentSlug, 'results')}>Tournament <ArrowRight size={12} /></a> : null}
    </div>
  </li>
}

// --- Statistics & history -------------------------------------------------------------------
export function TeamStatsSection({ ctx }: { ctx: TeamCtx }) {
  const [filter, setFilter] = useState<StatsFilter>(EMPTY_STATS_FILTER)
  const [trophies, setTrophies] = useState<Record<string, unknown>[]>([])
  const [positions, setPositions] = useState<Map<string, { position: number; of: number }>>(new Map())
  useEffect(() => {
    let active = true
    void ctx.client.from('sport_milestones').select('id,label,milestone_type,tournament_id,reached_at,is_manual').eq('team_id', ctx.teamId).then(result => { if (active && !result.error) setTrophies((result.data ?? []) as Record<string, unknown>[]) })
    // Final table position per tournament, from published standings snapshots.
    void (async () => {
      const own = await ctx.client.from('standings_snapshots').select('stage_id,competition_stages(tournament_id)').eq('team_id', ctx.teamId)
      if (!active || own.error || !own.data?.length) return
      const stageIds = [...new Set((own.data as Record<string, unknown>[]).map(row => String(row.stage_id)))]
      const all = await ctx.client.from('standings_snapshots').select('stage_id,group_id,team_id,played,wins,draws,losses,scored,conceded,points,calculated_from_version').in('stage_id', stageIds)
      if (!active || all.error) return
      const rows = (all.data ?? []) as Record<string, unknown>[]
      const map = new Map<string, { position: number; of: number }>()
      for (const row of own.data as Record<string, unknown>[]) {
        const stageId = String(row.stage_id)
        const mine = rows.find(item => String(item.stage_id) === stageId && String(item.team_id) === ctx.teamId)
        const table: StandingsRow[] = rows.filter(item => String(item.stage_id) === stageId && String(item.group_id ?? '') === String(mine?.group_id ?? '')).map(item => ({ stageId, groupId: item.group_id ? String(item.group_id) : null, teamId: String(item.team_id), played: Number(item.played ?? 0), wins: Number(item.wins ?? 0), draws: Number(item.draws ?? 0), losses: Number(item.losses ?? 0), scored: Number(item.scored ?? 0), conceded: Number(item.conceded ?? 0), points: Number(item.points ?? 0), version: Number(item.calculated_from_version ?? 0) }))
        const position = sortStandings(table).findIndex(item => item.teamId === ctx.teamId) + 1
        const tournamentId = String(one(row.competition_stages)?.tournament_id ?? '')
        if (tournamentId && position > 0) map.set(tournamentId, { position, of: table.length })
      }
      setPositions(map)
    })()
    return () => { active = false }
  }, [ctx.client, ctx.teamId])
  const options = useMemo(() => ({
    sports: [...new Set(ctx.matches.map(match => match.sport).filter(Boolean))],
    tournaments: [...new Map(ctx.matches.map(match => [match.tournamentId, match.tournamentName])).entries()],
    seasons: [...new Set(ctx.matches.map(match => match.scheduledAt?.slice(0, 4)).filter(Boolean) as string[])].sort().reverse(),
  }), [ctx.matches])
  const filtered = filterTeamMatches(ctx.matches, filter)
  const totals = teamTotals(filtered)
  const awards = trophies.filter(item => String(item.milestone_type ?? '').startsWith('award_'))
  const set = (patch: Partial<StatsFilter>) => setFilter(current => ({ ...current, ...patch }))
  return <div className="pw-page" role="tabpanel">
    <Card icon={<Filter size={18} />} title="Filters" action={Object.values(filter).some(Boolean) ? <button type="button" className="ed-link-btn" onClick={() => setFilter(EMPTY_STATS_FILTER)}><RotateCcw size={13} /> Reset</button> : undefined}>
      <div className="pw-filters">
        <label className="pf-field">Sport<select value={filter.sport} onChange={event => set({ sport: event.target.value })}><option value="">All sports</option>{options.sports.map(value => <option key={value} value={value}>{sportName(value)}</option>)}</select></label>
        <label className="pf-field">Season<select value={filter.season} onChange={event => set({ season: event.target.value })}><option value="">All seasons</option>{options.seasons.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="pf-field">Tournament<select value={filter.tournamentId} onChange={event => set({ tournamentId: event.target.value })}><option value="">All tournaments</option>{options.tournaments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="pf-field">Competition type<select value={filter.competition} onChange={event => set({ competition: event.target.value })}><option value="">All stages</option><option value="group">Group / league</option><option value="knockout">Knockout</option></select></label>
        <label className="pf-field">From<input type="date" value={filter.from} onChange={event => set({ from: event.target.value })} /></label>
        <label className="pf-field">To<input type="date" value={filter.to} onChange={event => set({ to: event.target.value })} /></label>
      </div>
    </Card>
    <div className="pw-kpis">
      {([['Played', totals.played], ['Wins', totals.wins], ['Draws', totals.draws], ['Losses', totals.losses], ['Scored', totals.scored], ['Conceded', totals.conceded], ['Difference', totals.difference > 0 ? `+${totals.difference}` : totals.difference], ['Clean sheets', totals.cleanSheets], ['Yellow cards', totals.yellow], ['Red cards', totals.red], ['Trophies', awards.length]] as Array<[string, number | string]>).map(([label, value]) => <div key={label} className="pw-kpi"><b>{value}</b><small>{label}</small></div>)}
    </div>
    {!ctx.matchesAvailable && <Pending>Card counts and stage filters need migration 031; results come from confirmed versions either way.</Pending>}
    <Card icon={<Trophy size={18} />} title="Tournament history" sub="Confirmed results only">
      {tournamentHistory(filtered).length ? <div className="pw-table-wrap"><table className="pw-table"><thead><tr><th>Tournament</th><th>Position</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>Furthest stage</th><th>Awards</th></tr></thead><tbody>
        {tournamentHistory(filtered).map(row => { const place = positions.get(row.tournamentId); const won = awards.filter(item => String(item.tournament_id) === row.tournamentId); return <tr key={row.tournamentId}>
          <td>{row.published && row.slug ? <a href={tournamentLink(row.slug, 'standings')}>{row.name}</a> : row.name}</td><td>{place ? `${place.position} of ${place.of}` : '—'}</td><td>{row.totals.played}</td><td>{row.totals.wins}</td><td>{row.totals.draws}</td><td>{row.totals.losses}</td><td>{row.totals.scored}</td><td>{row.totals.conceded}</td><td>{row.lastStage ?? '—'}</td><td>{won.length ? won.map(item => String(item.label)).join(', ') : '—'}</td>
        </tr> })}
      </tbody></table></div> : <Empty icon={<BarChart3 size={20} />}>No confirmed results yet.</Empty>}
    </Card>
    {awards.length > 0 && <Card icon={<Trophy size={18} />} title="Trophy cabinet"><div className="pw-chips">{awards.map(item => <span key={String(item.id)} className="pw-chip gold"><Trophy size={12} /> {String(item.label)} · {formatDay(item.reached_at)}</span>)}</div></Card>}
    <p className="pw-footnote"><ShieldCheck size={13} /> Corrected results replace old values and are never double-counted. Renaming the team or changing players does not rewrite past results.</p>
  </div>
}

// --- Finance ---------------------------------------------------------------------------------
const EMPTY_FINANCE: FinanceDraft = { kind: 'expense', category: 'registration_fee', description: '', amount: '', occurredOn: new Date().toISOString().slice(0, 10), tournamentId: '', counterparty: '', notes: '', asDraft: false }
export function TeamFinanceSection({ ctx, onChanged }: { ctx: TeamCtx; onChanged: () => void }) {
  const [showEditor, setShowEditor] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [records, setRecords] = useState<FinanceRecord[]>([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState<FinanceDraft>(EMPTY_FINANCE)
  const [receipt, setReceipt] = useState<File | null>(null)
  const [filters, setFilters] = useState({ kind: '', category: '', tournamentId: '', from: '', to: '' })
  const [voiding, setVoiding] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const receiptRef = useRef<HTMLInputElement>(null)
  const allowed = ctx.access.can('manage_finance')
  useEffect(() => { if (!allowed) return; let active = true; void loadFinance(ctx.client, ctx.teamId).then(result => { if (active) { setRecords(result.data); setError(result.error ?? ''); setLoaded(true) } }); return () => { active = false } }, [ctx.client, ctx.teamId, allowed, reloadKey])
  if (!allowed) return <div className="pw-page" role="tabpanel"><Denied permission="manage_finance" /></div>
  const refresh = () => { setReloadKey(value => value + 1); onChanged() }
  const shown = records.filter(record => (!filters.kind || record.kind === filters.kind) && (!filters.category || record.category === filters.category) && (!filters.tournamentId || record.tournamentId === filters.tournamentId) && (!filters.from || record.occurredOn >= filters.from) && (!filters.to || record.occurredOn <= filters.to))
  const summary = financeSummary(shown)
  const tournamentName = (id: string | null) => id ? ctx.tournaments.get(id)?.name ?? 'Tournament' : ''
  const add = async () => {
    const problem = validateFinance(draft)
    if (problem) return setError(problem)
    setBusy(true); setError('')
    const result = editingId ? await updateFinanceDraft(ctx.client, editingId, { amount: Number(draft.amount), description: draft.description.trim() }) : await addFinanceRecord(ctx.client, ctx.teamId, ctx.userId, draft, receipt)
    setBusy(false)
    if (result.error) return setError(result.error)
    setDraft({ ...EMPTY_FINANCE, kind: draft.kind, category: draft.category }); setReceipt(null); setShowEditor(false); setEditingId(null); ctx.notice('Finance record saved.'); refresh()
  }
  const exportCsv = () => {
    const blob = new Blob(['﻿', financeCsv(shown, tournamentName)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob); const link = document.createElement('a')
    link.href = url; link.download = `${ctx.profile.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-finance.csv`; link.click(); URL.revokeObjectURL(url)
  }
  const openReceipt = async (path: string) => { const result = await openTeamPrivateFile(ctx.client, path); if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer'); else setError(result.error ?? 'The receipt could not be opened.') }
  const categories = draft.kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  const editor = <Card icon={<Plus size={18} />} title="Transaction details" sub="Amounts in MVR" className="finance-editor-card">
        <div className="pw-segments" role="tablist" aria-label="Record type">{(['income', 'expense'] as const).map(kind => <button type="button" role="tab" disabled={Boolean(editingId)} key={kind} aria-selected={draft.kind === kind} className={draft.kind === kind ? 'active' : ''} onClick={() => setDraft({ ...draft, kind, category: kind === 'income' ? 'sponsorship' : 'registration_fee' })}>{kind === 'income' ? 'Income' : 'Expense'}</button>)}</div>
        <label className="pf-field">Category<select disabled={Boolean(editingId)} value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}>{categories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="pf-field">Description<input value={draft.description} maxLength={300} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
        <div className="pf-fields"><label className="pf-field">Amount (MVR)<input inputMode="decimal" value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value.replace(/[^\d.]/g, '') })} placeholder="0.00" /></label><label className="pf-field">Date<input type="date" disabled={Boolean(editingId)} value={draft.occurredOn} onChange={event => setDraft({ ...draft, occurredOn: event.target.value })} /></label></div>
        <label className="pf-field">Related tournament<select disabled={Boolean(editingId)} value={draft.tournamentId} onChange={event => setDraft({ ...draft, tournamentId: event.target.value })}><option value="">None</option>{[...ctx.tournaments.values()].map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="pf-field">{draft.kind === 'income' ? 'Payer' : 'Payee'}<input disabled={Boolean(editingId)} value={draft.counterparty} onChange={event => setDraft({ ...draft, counterparty: event.target.value })} /></label>
        <label className="pf-field">Private notes<input disabled={Boolean(editingId)} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
        <button type="button" className="pw-dropzone" disabled={Boolean(editingId)} onClick={() => receiptRef.current?.click()}><Upload size={18} /><strong>{receipt ? receipt.name : 'Attach receipt or proof'}</strong><small>PDF, PNG or JPG · private storage</small></button>
        <input ref={receiptRef} type="file" accept={PRIVATE_FILE_TYPES.join(',')} className="sr-only" aria-label="Receipt" onChange={event => setReceipt(event.target.files?.[0] ?? null)} />
        <label className="publication-confirm"><input type="checkbox" disabled={Boolean(editingId)} checked={draft.asDraft} onChange={event => setDraft({ ...draft, asDraft: event.target.checked })} /> Save as draft (editable, not counted)</label>
        <button type="button" className="ed-btn ed-btn-primary pf-block" disabled={busy} onClick={() => void add()}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Save transaction'}</button>
        {editingId ? <p className="pf-hint">Only the amount and description of this draft can be changed here. Record it from Finance when it is ready.</p> : null}<p className="pf-hint"><Lock size={13} /> Team finance is separate from tournament and organization finance, never public, and every change is audited. Card details are never stored. Recorded entries can only be voided with a reason.</p>
      </Card>
  if (showEditor) return <div className="sq-page sq-flow"><button type="button" className="back-link" disabled={busy} onClick={() => { setShowEditor(false); setEditingId(null); setError('') }}>← Back to finance</button><header><h1 className="sq-flow-title">{editingId ? 'Edit transaction' : 'Add transaction'}</h1><p className="sq-lede">Manage a private finance record for {ctx.profile.name}.</p></header><div className="sq-two"><div className="sq-col">{error ? <p className="form-error" role="alert">{error}</p> : null}{editor}<button type="button" className="ed-btn ed-btn-ghost" disabled={busy} onClick={() => { setShowEditor(false); setEditingId(null); setError('') }}>Cancel</button></div><aside className="sq-col"><Card icon={<Wallet size={20} />} title="Transaction summary"><strong className="team-finance-balance">{formatMvr(Number(draft.amount) || 0)}</strong><p>{draft.kind === 'income' ? 'Income' : 'Expense'} · {FINANCE_CATEGORY_LABELS[draft.category] ?? draft.category}</p><p>{draft.description || 'Add a description for this transaction.'}</p><p className="pf-hint">{draft.asDraft ? 'Draft · not included in totals' : 'Recorded entries contribute to finance totals'}</p></Card><Card icon={<Lock size={20} />} title="Record history"><p>Recorded transactions are kept. To reverse one, void it with a reason from Finance.</p><p className="pf-hint">Receipts and notes remain private to authorized team staff.</p></Card></aside></div></div>
  return <div className="pw-page tw-finance" role="tabpanel">
    <div className="pp-head-action"><button type="button" className="ed-btn ed-btn-primary" onClick={() => { setDraft(EMPTY_FINANCE); setReceipt(null); setEditingId(null); setError(''); setShowEditor(true) }}><Plus size={17} aria-hidden="true" /> Add transaction</button></div>
    {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
    <div className="pw-counters">
      <div className="tw-income"><b>{formatMvr(summary.income)}</b><small>Income</small></div>
      <div className="tw-expense"><b>{formatMvr(summary.expense)}</b><small>Expenses</small></div>
      <div className={summary.balance >= 0 ? 'tw-income' : 'tw-expense'}><b>{formatMvr(summary.balance)}</b><small>Balance</small></div>
      <div><b>{summary.drafts}</b><small>Drafts (not counted)</small></div>
    </div>
    <div className="pw-two">
      <Card icon={<Wallet size={18} />} title="Records" sub={`${shown.length} shown`} action={<div className="pw-actions"><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={!shown.length} onClick={exportCsv}><Download size={13} /> CSV</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => window.print()}><Printer size={13} /> PDF</button></div>}>
        <div className="pw-filters">
          <label className="pf-field">Type<select value={filters.kind} onChange={event => setFilters({ ...filters, kind: event.target.value, category: '' })}><option value="">Income and expenses</option><option value="income">Income</option><option value="expense">Expenses</option></select></label>
          <label className="pf-field">Category<select value={filters.category} onChange={event => setFilters({ ...filters, category: event.target.value })}><option value="">All categories</option>{[...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES].filter(item => !filters.kind || (filters.kind === 'income') === INCOME_CATEGORIES.some(income => income.value === item.value)).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="pf-field">Tournament<select value={filters.tournamentId} onChange={event => setFilters({ ...filters, tournamentId: event.target.value })}><option value="">All</option>{[...ctx.tournaments.values()].map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="pf-field">From<input type="date" value={filters.from} onChange={event => setFilters({ ...filters, from: event.target.value })} /></label>
          <label className="pf-field">To<input type="date" value={filters.to} onChange={event => setFilters({ ...filters, to: event.target.value })} /></label>
        </div>
        {!loaded ? <p className="pf-hint">Loading…</p> : shown.length ? <ul className="tw-ledger">{shown.map(record => <li key={record.id} className={`k-${record.kind} s-${record.status}`}>
          <div className="tw-ledger-main"><strong>{record.description}</strong><small>{[formatDay(record.occurredOn), FINANCE_CATEGORY_LABELS[record.category], tournamentName(record.tournamentId) || null, record.counterparty].filter(Boolean).join(' · ')}</small>{record.voidReason && <small className="ps-review-note">Void: {record.voidReason}</small>}</div>
          <b className="tw-amount">{record.kind === 'income' ? '+' : '−'}{formatMvr(record.amount)}</b>
          <div className="pw-actions">
            <Pill tone={statusTone(record.status)}>{record.status === 'void' ? 'Void' : record.status === 'draft' ? 'Draft' : 'Recorded'}</Pill>
            {record.receiptPath && <button type="button" className="ed-icon-btn" aria-label="Open receipt" onClick={() => void openReceipt(record.receiptPath!)}><FileLock2 size={14} /></button>}
            {record.status === 'draft' ? <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => { setDraft({ kind: record.kind, category: record.category, description: record.description, amount: String(record.amount), occurredOn: record.occurredOn, tournamentId: record.tournamentId ?? '', counterparty: record.counterparty ?? '', notes: record.notes ?? '', asDraft: true }); setEditingId(record.id); setReceipt(null); setError(''); setShowEditor(true) }}><Pencil size={14} aria-hidden="true" /> Edit draft</button> : null}
            {record.status === 'draft' && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => void updateFinanceDraft(ctx.client, record.id, { status: 'recorded' }).then(result => result.error ? setError(result.error) : refresh())}><Check size={13} /> Record</button>}
            {record.status !== 'void' && (voiding === record.id ? <span className="tw-confirm"><input value={reason} placeholder="Reason" onChange={event => setReason(event.target.value)} /><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={() => void voidFinanceRecord(ctx.client, record.id, reason).then(result => { if (result.error) return setError(result.error); setVoiding(null); setReason(''); refresh() })}>Void</button><button type="button" className="ed-icon-btn" aria-label="Cancel" onClick={() => setVoiding(null)}><X size={14} /></button></span> : <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => { setVoiding(record.id); setReason('') }}>Void</button>)}
          </div>
        </li>)}</ul> : <Empty icon={<Wallet size={22} />}>No finance records{Object.values(filters).some(Boolean) ? ' match these filters' : ' yet'}.</Empty>}
      </Card>
      <div className="team-finance-info"><Card icon={<FileLock2 size={20} />} title="Receipts & records"><p>Keep private receipts with your team’s transactions.</p>{ctx.access.can('view_documents') ? <button type="button" className="ed-btn ed-btn-ghost" onClick={() => ctx.open('documents')}>Manage documents</button> : null}</Card><Card icon={<ShieldCheck size={20} />} title="Team finances stay separate"><p>Team income and expenses are separate from tournament and organization finances.</p></Card></div>
    </div>
  </div>
}

// --- Documents -------------------------------------------------------------------------------
export function TeamDocumentsSection({ ctx, onChanged }: { ctx: TeamCtx; onChanged: () => void }) {
  const [items, setItems] = useState<TeamDocument[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({ category: 'registration_certificate', tournamentId: '', expiresAt: '' })
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [replacing, setReplacing] = useState<TeamDocument | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const allowed = ctx.access.can('view_documents')
  useEffect(() => { if (!allowed) return; let active = true; void loadTeamDocuments(ctx.client, ctx.teamId).then(result => { if (active) { setItems(result.data); setError(result.error ?? '') } }); return () => { active = false } }, [ctx.client, ctx.teamId, allowed, reloadKey])
  if (!allowed) return <div className="pw-page" role="tabpanel"><Denied permission="view_documents" /></div>
  const send = async (file: File, input: { category: string; tournamentId: string; expiresAt: string }, previous: TeamDocument | null) => {
    setBusy(true); setError(''); setNotice('')
    const result = await uploadTeamDocument(ctx.client, { teamId: ctx.teamId, userId: ctx.userId, file, ...input })
    if (!result.error && previous && ['uploaded', 'changes_requested', 'rejected'].includes(previous.status)) await removeTeamDocument(ctx.client, previous)
    setBusy(false)
    if (result.error) return setError(`${result.error} You can retry.`)
    setNotice(previous ? 'Replacement uploaded.' : 'Document uploaded privately.'); setReloadKey(value => value + 1); onChanged()
  }
  const open = async (document: TeamDocument) => { const result = await openTeamPrivateFile(ctx.client, document.storagePath); if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer'); else setError(result.error ?? 'The file could not be opened.') }
  const remove = async (document: TeamDocument) => { const result = await removeTeamDocument(ctx.client, document); if (result.error) return setError(result.error); setReloadKey(value => value + 1); onChanged() }
  const label = (value: string) => TEAM_DOCUMENT_CATEGORIES.find(item => item.value === value)?.label ?? value
  return <div className="pw-page" role="tabpanel">
    <div className="pw-two">
      <Card icon={<FileLock2 size={18} />} title="Team documents" sub={`${items.length} file${items.length === 1 ? '' : 's'}`}>
        {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
        {notice && <p className="publication-notice" role="status">{notice}</p>}
        {items.length ? <ul className="ps-docs">{items.map(document => <li key={document.id}>
          <div><strong>{label(document.category)}</strong><small>{document.originalName} · {formatFileSize(document.sizeBytes)} · {formatDay(document.createdAt)}{document.tournamentId ? ` · ${ctx.tournaments.get(document.tournamentId)?.name ?? 'Tournament'}` : ''}{document.expiresAt ? ` · valid until ${formatDay(document.expiresAt)}` : ''}</small>{document.reviewerNote && <small className="ps-review-note">Reviewer: {document.reviewerNote}</small>}</div>
          <span className={`ps-doc-status status-${document.status}`}>{({ uploaded: 'Uploaded', under_review: 'Under review', changes_requested: 'Changes requested', verified: 'Verified', rejected: 'Rejected', expired: 'Expired' } as Record<string, string>)[document.status] ?? document.status}</span>
          <div className="button-row compact">
            <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => void open(document)}>Open</button>
            <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={busy} onClick={() => { setReplacing(document); replaceRef.current?.click() }}><RefreshCw size={13} /> Replace</button>
            {['uploaded', 'changes_requested', 'rejected'].includes(document.status) && <ConfirmAction className="ed-btn ed-btn-ghost ed-btn-sm" label={`Remove ${document.originalName}`} question={`Remove ${document.originalName}?`} onConfirm={async () => { await remove(document) }} />}
          </div>
        </li>)}</ul> : <Empty icon={<FileLock2 size={22} />}>No team documents uploaded yet.</Empty>}
        <input ref={replaceRef} type="file" accept={PRIVATE_FILE_TYPES.join(',')} className="sr-only" aria-label="Replacement file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; const previous = replacing; setReplacing(null); if (file && previous) void send(file, { category: previous.category, tournamentId: previous.tournamentId ?? '', expiresAt: previous.expiresAt ?? '' }, previous) }} />
        <p className="pf-hint"><ShieldCheck size={13} /> Player identity and eligibility files belong to each player and are reviewed by the organizer; they are not copied here.</p>
      </Card>
      <Card icon={<Upload size={18} />} title="Upload a document" sub="Private bucket · signed links" className="pw-sticky">
        <label className="pf-field">Type<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}>{TEAM_DOCUMENT_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="pf-field">For tournament<select value={form.tournamentId} onChange={event => setForm({ ...form, tournamentId: event.target.value })}><option value="">General</option>{[...ctx.tournaments.values()].map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="pf-field">Valid until (optional)<input type="date" value={form.expiresAt} onChange={event => setForm({ ...form, expiresAt: event.target.value })} /></label>
        <button type="button" className="pw-dropzone" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? <RefreshCw className="spin" size={20} /> : <Upload size={20} />}<strong>{busy ? 'Uploading…' : 'Choose a file'}</strong><small>PDF, PNG or JPG · up to 10 MB</small></button>
        <input ref={inputRef} type="file" accept={PRIVATE_FILE_TYPES.join(',')} className="sr-only" aria-label="Document file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void send(file, form, null) }} />
        <p className="pf-hint"><Lock size={13} /> Only staff with the View documents permission, and the organizers of the tournament you choose, can open these files, through links that expire after a minute.</p>
      </Card>
    </div>
  </div>
}

// --- Notifications ---------------------------------------------------------------------------
export function TeamNotificationsSection({ ctx, onMarkRead, onMarkAll }: { ctx: TeamCtx; onMarkRead: (id: string) => void; onMarkAll: () => void }) {
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all')
  const [prefs, setPrefs] = useState<NotificationPreferences>({ mutedCategories: [], emailEnabled: true })
  const [prefsAvailable, setPrefsAvailable] = useState(true)
  const [prefNotice, setPrefNotice] = useState('')
  useEffect(() => { let active = true; void loadNotificationPreferences(ctx.client, ctx.userId).then(result => { if (active) { setPrefs(result.data); setPrefsAvailable(result.available) } }); return () => { active = false } }, [ctx.client, ctx.userId])
  const isUnread = (row: Record<string, unknown>) => row.read_at == null && row.state !== 'read'
  const all = ctx.data.notifications.filter(row => !prefs.mutedCategories.includes(notificationCategory(row.notification_type)))
  const unread = all.filter(isUnread).length
  const shown = all.filter(row => filter === 'all' || (filter === 'unread' ? isUnread(row) : !isUnread(row)))
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of shown) { const key = dayGroupLabel(row.created_at); groups.set(key, [...(groups.get(key) ?? []), row]) }
  const target = (row: Record<string, unknown>): { href?: string; section?: TeamSection } => {
    const tournament = ctx.tournaments.get(String(row.tournament_id ?? ''))
    const category = notificationCategory(row.notification_type)
    const map: Record<NotificationCategory, TeamSection> = { teams: 'invitations', rosters: 'rosters', documents: 'documents', matches: 'matches', results: 'matches', achievements: 'statistics', announcements: 'tournaments' }
    if (category === 'announcements' && tournament?.isPublished && tournament.slug) return { href: tournamentLink(tournament.slug) }
    return { section: map[category] ?? (CATEGORY_TABS[category] as TeamSection) }
  }
  const toggle = async (category: NotificationCategory) => {
    const next = { ...prefs, mutedCategories: prefs.mutedCategories.includes(category) ? prefs.mutedCategories.filter(item => item !== category) : [...prefs.mutedCategories, category] }
    setPrefs(next); const result = await saveNotificationPreferences(ctx.client, ctx.userId, next); setPrefNotice(result.error ?? 'Preferences saved.')
  }
  return <div className="pw-page" role="tabpanel">
    <div className="pw-two">
      <Card icon={<BellRing size={18} />} title="Notifications" sub={unread ? `${unread} unread` : 'All caught up'} action={unread ? <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={onMarkAll}><CheckCheck size={14} /> Mark all as read</button> : undefined}>
        <div className="pw-filter-chips">{(['all', 'unread', 'read'] as const).map(id => <button type="button" key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{id === 'all' ? 'All' : id === 'unread' ? `Unread${unread ? ` (${unread})` : ''}` : 'Read'}</button>)}</div>
        {shown.length ? [...groups.entries()].map(([label, rows]) => <div key={label} className="pw-day"><h5>{label}</h5><ul className="pw-notices">{rows.map(row => { const link = target(row); return <li key={String(row.id)} className={isUnread(row) ? 'unread' : ''}>
          <span className={`pw-notice-icon c-${notificationCategory(row.notification_type)}`}><BellRing size={16} /></span>
          <div className="pw-notice-body"><strong>{String(row.title ?? 'Notice')}</strong><p>{String(row.body ?? '')}</p><small>{formatMaldivesDateTime(String(row.created_at ?? ''))}{row.channel === 'email' ? <> · <Mail size={11} /> {row.state === 'sent' ? 'Email sent' : row.state === 'failed' ? 'Email failed' : 'Email queued'}</> : null}</small></div>
          <div className="pw-notice-actions">{link.href ? <a className="ed-icon-btn" href={link.href} aria-label="Open related record"><ExternalLink size={14} /></a> : <button type="button" className="ed-icon-btn" aria-label="Open related record" onClick={() => link.section && ctx.open(link.section)}><ArrowRight size={14} /></button>}{isUnread(row) && <button type="button" className="ed-icon-btn" aria-label="Mark as read" onClick={() => onMarkRead(String(row.id))}><Check size={14} /></button>}</div>
        </li> })}</ul></div>) : <Empty icon={<BellRing size={22} />}>{filter === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}</Empty>}
      </Card>
      <Card icon={<Timer size={18} />} title="Preferences" sub="Shared with your other workspaces" className="pw-sticky">
        {!prefsAvailable ? <Pending>{NEEDS_030}</Pending> : <>
          <ul className="pw-toggles">{NOTIFICATION_CATEGORIES.map(item => { const on = !prefs.mutedCategories.includes(item.value); return <li key={item.value}><span>{item.label}</span><button type="button" role="switch" aria-checked={on} aria-label={item.label} className={`pw-switch${on ? ' on' : ''}`} onClick={() => void toggle(item.value)}><span /></button></li> })}</ul>
          <ul className="pw-toggles"><li><span><Mail size={16} /> Email copies</span><button type="button" role="switch" aria-checked={prefs.emailEnabled} aria-label="Email copies" className={`pw-switch${prefs.emailEnabled ? ' on' : ''}`} onClick={() => { const next = { ...prefs, emailEnabled: !prefs.emailEnabled }; setPrefs(next); void saveNotificationPreferences(ctx.client, ctx.userId, next).then(result => setPrefNotice(result.error ?? 'Preferences saved.')) }}><span /></button></li></ul>
          <p className="pf-hint">In-app always works. Email and push are used only when configured, and “sent” shows only after the provider confirms.</p>
          {prefNotice && <p className={prefNotice.includes('migration') ? 'pending-note' : 'publication-notice'} role="status">{prefNotice}</p>}
        </>}
      </Card>
    </div>
  </div>
}
