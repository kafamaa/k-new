import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import {
  AlertTriangle, Archive, CalendarClock, CheckCircle2, CircleCheck, CircleX, ClipboardCheck, Download, Eye, FileText, Flag, Handshake, History, ImageUp, Lock, Newspaper,
  ListChecks, Pencil, RefreshCw, Search, ShieldAlert, Trophy, Wallet,
} from 'lucide-react'
import {
  addFixture, adjustStandings, deleteFixture, deletableFixture, updateIncident, applicationsCsv, articleState, completionBlocked, DEFAULT_CHECKLIST, EMPTY_ARTICLE, eventLabel, filterEntries, financeTotals, fixturesCsv, fixtureWarnings,
  formatMvr, FORMAT_LABELS, fromMaldivesInput, INCIDENT_CATEGORIES, INCOME_KINDS, loadAdjustments, loadChecklist, loadCompletionChecks, loadEntryAnswers, loadEvents, loadFinanceOverview,
  loadIncidents, loadRosterChecks, loadSponsorRecords, loadStages, loadTournamentNews, maldivesTime, recalculateTournament, removeSponsorRecord, reportIncident, resolveIncident,
  revokeAdjustment, saveChecklist, saveIncome, saveSponsorRecord, saveStageRules, saveTournamentArticle, setApplicationStatus, setArticleStatus, setIncomeStatus, setPaymentStatus,
  setStagePublished, SPONSOR_LEVELS, sponsorLogoUrl, TIEBREAKERS, toCsv, toMaldivesInput, unlockRoster, updateFixture, uploadNewsCover, uploadSponsorLogo,
  type Adjustment, type ApplicationFilter, type ArticleDraft, type ChecklistItem, type CompletionCheck, type EntryAnswer, type FinanceOverview, type Incident, type RosterCheck,
  type SponsorRecord, type Stage, type StageRules, type TournamentArticle, type TournamentEvent,
} from '../lib/tournamentPages'
import {
  applicationStatusLabel, applicationStatusTone, matchStatusLabel, matchStatusTone, paymentStatusLabel, paymentStatusTone, rosterStatusLabel, rosterStatusTone, setTournamentStatus,
  type OrganizerTab, type OrganizerTournament, type TournamentEntry, type TournamentMatch,
} from '../lib/organizer'
import {
  addDeliverable, DELIVERABLE_KINDS, DELIVERABLE_STATUS, deliverableSummary, isOverdue, loadDeliverables, maldivesToday, PENDING_DELIVERABLES, removeDeliverable, setDeliverableStatus, updateDeliverable,
  type Deliverable, type DeliverableKind, type DeliverableStatus,
} from '../lib/sponsorDeliverables'
import { NEWS_CONTENT_LABELS, NEWS_CONTENT_TYPES, type NewsContentType } from '../lib/news'
import { submitMatchResult, confirmMatchResult } from '../lib/matchCenter'
import { downloadBlob } from '../lib/cardImage'
import { ReasonAction } from './AdminParts'
import { PrintButton } from './PublicExtras'
import { ReportSheets } from './ReportSheets'

const csvDownload = (text: string, name: string) => downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), `${name}-${new Date().toISOString().slice(0, 10)}.csv`)
const Pill = ({ tone, children }: { tone: string; children: ReactNode }) => <span className={`status-pill status-${tone}`}>{children}</span>
// Two-step confirmation for actions that need no reason.
function ConfirmButton({ label, question, onConfirm }: { label: string; question: string; onConfirm: () => Promise<string | null> }) {
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  if (!asking) return <button type="button" className="ghost-button" onClick={() => setAsking(true)}>{label}</button>
  return <span className="confirm-group"><span>{question}</span><button type="button" className="primary-button" onClick={() => void onConfirm().then(problem => { if (problem) setError(problem); else setAsking(false) })}>Yes</button><button type="button" className="outline-button dark" onClick={() => { setAsking(false); setError('') }}>No</button>{error ? <span className="form-error" role="alert">{error}</span> : null}</span>
}
const Problem = ({ text, onRetry }: { text: string; onRetry?: () => void }) => <div className={text.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{text}{onRetry ? <button type="button" className="retry-button" onClick={onRetry}>Retry</button> : null}</div>

// ---------------------------------------------------------------------------------------------------
// Activity timeline (used by several pages)
// ---------------------------------------------------------------------------------------------------
export function TournamentTimeline({ client, tournamentId, entityId, types, title = 'Activity', limit = 12, reloadKey = 0 }: { client: SupabaseClient; tournamentId: string; entityId?: string; types?: string[]; title?: string; limit?: number; reloadKey?: number }) {
  const [events, setEvents] = useState<TournamentEvent[] | null>(null)
  const [error, setError] = useState('')
  const typeKey = types?.join(',') ?? ''
  const reload = useCallback(() => { void loadEvents(client, tournamentId, { entityId, types: typeKey ? typeKey.split(',') : undefined, limit }).then(result => { setEvents(result.data); setError(result.error ?? '') }) }, [client, tournamentId, entityId, typeKey, limit])
  useEffect(() => { reload() }, [reload, reloadKey])
  return <section className="panel-block tp-timeline" aria-label={title}>
    <h3><History size={15} /> {title}</h3>
    {error ? <Problem text={error} onRetry={reload} /> : !events ? <p className="field-hint">Loading…</p> : events.length === 0 ? <p className="empty-note">Nothing recorded yet.</p>
      : <ol className="tp-events">{events.map(event => <li key={event.id}><strong>{eventLabel(event)}</strong><small>{maldivesTime(event.created_at)}{event.note ? ` · ${event.note}` : ''}</small></li>)}</ol>}
  </section>
}

// ---------------------------------------------------------------------------------------------------
// Page 29: setup guard and public preview
// ---------------------------------------------------------------------------------------------------
export function SetupGuard({ tournament, entries, matches, onOpenTab }: { tournament: OrganizerTournament; entries: TournamentEntry[]; matches: TournamentMatch[]; onOpenTab: (tab: OrganizerTab, step?: number | null) => void }) {
  const locks: string[] = []
  const warnings: string[] = []
  if (matches.length) locks.push('Sport: fixtures exist, so the sport is locked (it decides scoring and standings).')
  if (matches.length) warnings.push('Changing categories or the competition format does not rebuild fixtures that already exist. Use Draw & competition to save a new draw.')
  if (entries.length) warnings.push(`${entries.length} team(s) have entered. Changing roster limits or registration rules applies to new submissions; existing rosters are reviewed as submitted.`)
  if (tournament.is_published) warnings.push('This tournament is public. Saved changes to its name, branding, dates, venue and rules appear on the public page straight away, and each change is recorded.')
  if (['completed', 'archived'].includes(tournament.status)) locks.push('The tournament is finished. Setup is kept as part of the permanent record.')
  if (!locks.length && !warnings.length) return null
  return <section className="panel-block tp-guard" aria-label="Before you change setup">
    {locks.length ? <><h3><Lock size={15} /> Locked</h3><ul className="plain-list">{locks.map(item => <li key={item}>{item}</li>)}</ul></> : null}
    {warnings.length ? <><h3><AlertTriangle size={15} /> Check before saving</h3><ul className="plain-list">{warnings.map(item => <li key={item}>{item}</li>)}</ul></> : null}
    <button type="button" className="ghost-button" onClick={() => onOpenTab('setup', 9)}><Eye size={14} /> Review what visitors see</button>
  </section>
}

export function PublicEffectPreview({ tournament, categories, sportLabel }: { tournament: OrganizerTournament; categories: Array<{ name: string }>; sportLabel: string }) {
  return <section className="panel-block tp-preview" aria-label="Public page preview">
    <h3><Eye size={15} /> What visitors see</h3>
    {!tournament.is_published ? <p className="field-hint">Nothing yet. This tournament is a private draft; publish it from Publish &amp; settings.</p>
      : <dl className="tp-dl">
        <div><dt>Name</dt><dd>{tournament.name}</dd></div>
        <div><dt>Sport</dt><dd>{sportLabel}</dd></div>
        <div><dt>Status</dt><dd>{tournament.status.replace(/_/g, ' ')}</dd></div>
        <div><dt>Categories</dt><dd>{categories.length ? categories.map(item => item.name).join(', ') : 'None'}</dd></div>
        <div><dt>Shown publicly</dt><dd>Logo and cover, dates and venue, rules summary, published fixtures and draw, official results, standings, approved team names, public sponsors and published news.</dd></div>
        <div><dt>Never public</dt><dd>Applications, payments, documents, roster review notes, incidents, finance and agreement notes.</dd></div>
      </dl>}
    {tournament.is_published ? <a className="outline-button dark" href={`#tournament/${encodeURIComponent(tournament.slug)}`} target="_blank" rel="noreferrer"><Eye size={14} /> Open public page</a> : null}
  </section>
}

// ---------------------------------------------------------------------------------------------------
// Page 30: applications and payments
// ---------------------------------------------------------------------------------------------------
const APPLICATION_ACTIONS: Array<{ status: string; label: string; from: string[]; reason: boolean; tone: 'primary' | 'ghost' | 'danger' }> = [
  { status: 'under_review', label: 'Start review', from: ['submitted'], reason: false, tone: 'ghost' },
  { status: 'approved', label: 'Approve', from: ['submitted', 'under_review', 'changes_requested', 'waitlisted'], reason: false, tone: 'primary' },
  { status: 'changes_requested', label: 'Request changes', from: ['submitted', 'under_review'], reason: true, tone: 'ghost' },
  { status: 'waitlisted', label: 'Waitlist', from: ['submitted', 'under_review', 'changes_requested'], reason: false, tone: 'ghost' },
  { status: 'rejected', label: 'Reject', from: ['submitted', 'under_review', 'changes_requested', 'waitlisted'], reason: true, tone: 'danger' },
  { status: 'withdrawn', label: 'Withdraw', from: ['submitted', 'under_review', 'changes_requested', 'waitlisted', 'approved'], reason: true, tone: 'ghost' },
]
const PAYMENT_ACTIONS: Array<{ status: string; label: string; reason: boolean }> = [
  { status: 'under_review', label: 'Review payment', reason: false }, { status: 'paid', label: 'Verify payment', reason: false },
  { status: 'rejected', label: 'Reject payment', reason: true }, { status: 'waived', label: 'Waive fee', reason: true }, { status: 'refunded', label: 'Mark refunded', reason: true },
]
const FILTERS: Array<[ApplicationFilter, string]> = [['all', 'All'], ['waiting', 'Waiting'], ['approved', 'Approved'], ['waitlisted', 'Waitlist'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn'], ['payment', 'Payment to check'], ['roster', 'Roster to review']]

export function ApplicationsPage({ client, tournamentId, entries, canManage, onNotice, onChanged }: { client: SupabaseClient; tournamentId: string; entries: TournamentEntry[]; canManage: boolean; onNotice: (message: string) => void; onChanged: () => void }) {
  const [filter, setFilter] = useState<ApplicationFilter>('waiting')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const shown = filterEntries(entries, filter, query)
  const waiting = entries.filter(entry => ['submitted', 'under_review', 'changes_requested'].includes(entry.application_status)).length
  const decide = async (entry: TournamentEntry, status: string, note: string) => {
    const result = await setApplicationStatus(client, entry.id, status, note)
    if (result.error) return result.error
    onNotice(`${entry.team_name ?? 'Team'}: ${applicationStatusLabel(status).toLowerCase()}.`); onChanged(); return null
  }
  // Bulk actions are limited to safe, reversible steps: start review and waitlist.
  const bulk = async (status: 'under_review' | 'waitlisted') => {
    setBusy(true)
    const targets = entries.filter(entry => selected.includes(entry.id) && APPLICATION_ACTIONS.find(action => action.status === status)!.from.includes(entry.application_status))
    const failures = (await Promise.all(targets.map(entry => setApplicationStatus(client, entry.id, status, '')))).filter(result => result.error).length
    setBusy(false); setSelected([])
    onNotice(`${targets.length - failures} application(s) updated${failures ? `, ${failures} could not be changed` : ''}.`); onChanged()
  }
  return <div className="tab-panel">
    <p className="field-hint">{waiting ? `${waiting} application(s) need a decision.` : 'No applications are waiting for a decision.'} Application, roster and payment each have their own status. Every decision is recorded with its reason.</p>
    <div className="tp-toolbar">
      <label className="tp-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search teams</span><input type="search" value={query} placeholder="Search teams" onChange={event => setQuery(event.target.value)} /></label>
      <div className="ed-toggle" role="group" aria-label="Filter applications">{FILTERS.map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>
      <button type="button" className="outline-button dark" onClick={() => csvDownload(applicationsCsv(entries, { application: applicationStatusLabel, roster: rosterStatusLabel, payment: paymentStatusLabel }), 'applications')}><Download size={14} /> Export CSV</button>
    </div>
    {canManage && selected.length > 0 && <div className="button-row tp-bulk"><span>{selected.length} selected</span><button type="button" className="outline-button dark" disabled={busy} onClick={() => void bulk('under_review')}>Start review</button><button type="button" className="outline-button dark" disabled={busy} onClick={() => void bulk('waitlisted')}>Move to waitlist</button><button type="button" className="ghost-button" onClick={() => setSelected([])}>Clear</button></div>}
    {entries.length === 0 ? <div className="state-block"><Flag size={22} /><h3>No teams have applied yet</h3><p>Open registration to receive applications, or add a team directly in Teams &amp; rosters.</p></div>
      : shown.length === 0 ? <p className="empty-note">No applications match this filter.</p>
      : <ul className="tp-list">{shown.map(entry => <li key={entry.id} className="entry-row">
        <div className="tp-row-head">
          {canManage && <input type="checkbox" aria-label={`Select ${entry.team_name ?? 'team'}`} checked={selected.includes(entry.id)} onChange={event => setSelected(current => event.target.checked ? [...current, entry.id] : current.filter(id => id !== entry.id))} />}
          <div><strong>{entry.team_name ?? 'Team record'}</strong><span>Submitted {entry.submitted_at ? maldivesTime(entry.submitted_at, false) : '—'}</span>{entry.review_notes && <span className="entry-note">{entry.review_notes}</span>}</div>
          <div className="entry-statuses"><Pill tone={applicationStatusTone(entry.application_status)}>Application: {applicationStatusLabel(entry.application_status)}</Pill><Pill tone={rosterStatusTone(entry.roster_status)}>Roster: {rosterStatusLabel(entry.roster_status)}</Pill><Pill tone={paymentStatusTone(entry.payment_status)}>Payment: {paymentStatusLabel(entry.payment_status)}</Pill></div>
          <button type="button" className="ghost-button" aria-expanded={open === entry.id} onClick={() => setOpen(open === entry.id ? null : entry.id)}>{open === entry.id ? 'Close' : 'Details'}</button>
        </div>
        {open === entry.id && <EntryDetail client={client} tournamentId={tournamentId} entry={entry} canManage={canManage} onDecide={decide} onPayment={async (status, note) => { const result = await setPaymentStatus(client, entry.id, status, note); if (result.error) return result.error; onNotice(`Payment: ${paymentStatusLabel(status).toLowerCase()}.`); onChanged(); return null }} />}
      </li>)}</ul>}
  </div>
}

function EntryDetail({ client, tournamentId, entry, canManage, onDecide, onPayment }: { client: SupabaseClient; tournamentId: string; entry: TournamentEntry; canManage: boolean; onDecide: (entry: TournamentEntry, status: string, note: string) => Promise<string | null>; onPayment: (status: string, note: string) => Promise<string | null> }) {
  const [answers, setAnswers] = useState<EntryAnswer[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { void loadEntryAnswers(client, entry.id).then(result => { setAnswers(result.data); setError(result.error ?? '') }) }, [client, entry.id])
  const actions = APPLICATION_ACTIONS.filter(action => action.from.includes(entry.application_status))
  return <div className="tp-detail">
    <section><h4>Registration answers</h4>{error ? <Problem text={error} /> : !answers ? <p className="field-hint">Loading…</p> : answers.length === 0 ? <p className="empty-note">No custom questions were answered.</p>
      : <dl className="tp-dl">{answers.map((item, index) => <div key={index}><dt>{item.prompt}</dt><dd>{item.answer}</dd></div>)}</dl>}</section>
    <section><h4>Payment</h4><p className="field-hint">Payment proof is a private document: open it from the team’s documents in Teams &amp; rosters. It is never public.</p>
      {canManage && entry.payment_status !== 'not_required' && <div className="button-row wrap">{PAYMENT_ACTIONS.filter(action => action.status !== entry.payment_status).map(action => action.reason
        ? <ReasonAction key={action.status} label={action.label} onConfirm={note => onPayment(action.status, note)} />
        : <button type="button" key={action.status} className="outline-button dark" onClick={() => void onPayment(action.status, '')}>{action.label}</button>)}</div>}
    </section>
    {canManage && actions.length > 0 && <section><h4>Decision</h4><div className="button-row wrap">{actions.map(action => action.reason
      ? <ReasonAction key={action.status} label={action.label} tone={action.tone} hint={action.status === 'changes_requested' ? 'The team sees this note.' : undefined} onConfirm={note => onDecide(entry, action.status, note)} />
      : <button type="button" key={action.status} className={action.tone === 'primary' ? 'primary-button' : 'outline-button dark'} onClick={() => void onDecide(entry, action.status, '')}>{action.label}</button>)}</div></section>}
    <TournamentTimeline client={client} tournamentId={tournamentId} entityId={entry.id} title="Timeline" limit={20} />
  </div>
}

// ---------------------------------------------------------------------------------------------------
// Page 31: roster checks, duplicates and audited unlocking
// ---------------------------------------------------------------------------------------------------
export function RosterChecksPanel({ client, entries, limits, canManage, onNotice, onChanged }: { client: SupabaseClient; entries: TournamentEntry[]; limits: { min: number | null; max: number | null }; canManage: boolean; onNotice: (message: string) => void; onChanged: () => void }) {
  const [checks, setChecks] = useState<RosterCheck[] | null>(null)
  const [duplicates, setDuplicates] = useState<Array<{ playerName: string; teams: string[] }>>([])
  const [error, setError] = useState('')
  const entryKey = entries.map(entry => `${entry.id}:${entry.roster_status}:${entry.latest_roster_version ?? 0}`).join(',')
  const reload = useCallback(() => { void loadRosterChecks(client, entries, limits).then(result => { setChecks(result.data); setDuplicates(result.duplicates); setError(result.error ?? '') }) }, [client, entryKey, limits.min, limits.max]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload() }, [reload])
  const locked = entries.filter(entry => entry.roster_status === 'locked')
  const flagged = (checks ?? []).filter(check => check.problems.length)
  return <section className="panel-block" aria-label="Roster checks">
    <h3><ClipboardCheck size={15} /> Roster checks</h3>
    <p className="field-hint">Checks the latest roster version of every entered team{limits.min !== null || limits.max !== null ? ` against the setup limits (${limits.min ?? 'no minimum'}–${limits.max ?? 'no maximum'} players)` : ''}, and looks for players on more than one team.</p>
    {error ? <Problem text={error} onRetry={reload} /> : !checks ? <p className="field-hint">Checking…</p> : <>
      {duplicates.length ? <div className="state-block warn"><AlertTriangle size={18} /><h3>Players on more than one roster</h3><ul className="plain-list">{duplicates.map((item, index) => <li key={index}>{item.playerName}: {item.teams.join(', ')}</li>)}</ul></div> : <p className="tp-ok"><CircleCheck size={15} /> No player appears on two rosters.</p>}
      {flagged.length ? <ul className="plain-list">{flagged.map(check => <li key={check.entryId}><strong>{entries.find(entry => entry.id === check.entryId)?.team_name ?? 'Team'}</strong> ({check.size} players): {check.problems.join('; ')}</li>)}</ul> : <p className="tp-ok"><CircleCheck size={15} /> Every submitted roster is within the limits.</p>}
    </>}
    {canManage && locked.length > 0 && <><h4>Locked rosters</h4><p className="field-hint">Unlocking is recorded with your reason. Lock the roster again once changes are approved.</p>
      <ul className="tp-list">{locked.map(entry => <li key={entry.id} className="result-row"><div><strong>{entry.team_name ?? 'Team'}</strong><span><Lock size={12} /> Locked{entry.latest_roster_version ? ` · version ${entry.latest_roster_version}` : ''}</span></div>
        <ReasonAction label="Unlock roster" onConfirm={async reason => { const result = await unlockRoster(client, entry.id, reason); if (result.error) return result.error; onNotice(`${entry.team_name ?? 'Roster'} unlocked.`); onChanged(); return null }} /></li>)}</ul></>}
  </section>
}

// ---------------------------------------------------------------------------------------------------
// Page 32: draw stages (publish, versions)
// ---------------------------------------------------------------------------------------------------
export function DrawStagesPanel({ client, tournamentId, canManage, reloadKey, onNotice, onChanged }: { client: SupabaseClient; tournamentId: string; canManage: boolean; reloadKey: number; onNotice: (message: string) => void; onChanged: () => void }) {
  const [stages, setStages] = useState<Stage[] | null>(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const reload = useCallback(() => { void loadStages(client, tournamentId).then(result => { setStages(result.data); setError(result.error ?? '') }) }, [client, tournamentId])
  useEffect(() => { reload() }, [reload, reloadKey])
  const toggle = async (stage: Stage) => {
    const result = await setStagePublished(client, stage.id, !stage.published_at)
    setConfirming(null)
    if (result.error) return setError(result.error)
    onNotice(stage.published_at ? `${stage.name} is private again.` : `${stage.name}: draw and fixtures are now public.`); reload(); onChanged()
  }
  return <section className="panel-block" aria-label="Saved draws">
    <h3><Trophy size={15} /> Saved draws</h3>
    <p className="field-hint">A saved draw stays private until you publish it. Publishing shows its fixtures, groups and bracket on the public page and notifies teams of later fixture changes.</p>
    {error ? <Problem text={error} onRetry={reload} /> : !stages ? <p className="field-hint">Loading…</p> : stages.length === 0 ? <p className="empty-note">No draw saved yet.</p>
      : <ul className="tp-list">{stages.map(stage => <li key={stage.id} className="result-row">
        <div><strong>{stage.name}</strong><span>{FORMAT_LABELS[stage.format] ?? stage.format} · {stage.draw_mode === 'manual' ? 'Manual pairings' : 'Automatic draw'} · fixture version {stage.fixture_version}{stage.rules.third_place ? ' · third-place match' : ''}</span></div>
        <div className="button-row">{stage.published_at ? <Pill tone="ok">Public since {maldivesTime(stage.published_at, false)}</Pill> : <Pill tone="neutral">Private draft</Pill>}
          {canManage && (confirming === stage.id
            ? <span className="confirm-group"><span>{stage.published_at ? 'Hide this draw from the public?' : 'Publish this draw?'}</span><button type="button" className="primary-button" onClick={() => void toggle(stage)}>Yes</button><button type="button" className="outline-button dark" onClick={() => setConfirming(null)}>Cancel</button></span>
            : <button type="button" className="outline-button dark" onClick={() => setConfirming(stage.id)}>{stage.published_at ? 'Unpublish' : 'Publish'}</button>)}</div>
      </li>)}</ul>}
    <TournamentTimeline client={client} tournamentId={tournamentId} types={['stage']} title="Draw history" reloadKey={reloadKey} />
  </section>
}

// ---------------------------------------------------------------------------------------------------
// Page 33: fixtures and scheduling
// ---------------------------------------------------------------------------------------------------
export function FixturesPage({ client, user, tournamentId, matches, teams, canManage, reloadKey, onNotice, onChanged }: { client: SupabaseClient; user: User; tournamentId: string; matches: TournamentMatch[]; teams: Array<{ id: string; name: string }>; canManage: boolean; reloadKey: number; onNotice: (message: string) => void; onChanged: () => void }) {
  const [view, setView] = useState<'calendar' | 'list'>('calendar')
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [stages, setStages] = useState<Stage[]>([])
  useEffect(() => { void loadStages(client, tournamentId).then(result => setStages(result.data)) }, [client, tournamentId, reloadKey])
  const warnings = useMemo(() => fixtureWarnings(matches), [matches])
  const sorted = [...matches].sort((a, b) => (a.scheduled_at ? Date.parse(a.scheduled_at) : Infinity) - (b.scheduled_at ? Date.parse(b.scheduled_at) : Infinity))
  const byDay = new Map<string, TournamentMatch[]>()
  for (const match of sorted) { const key = match.scheduled_at ? maldivesTime(match.scheduled_at, false) : 'Not scheduled yet'; byDay.set(key, [...(byDay.get(key) ?? []), match]) }
  const unscheduled = matches.filter(match => !match.scheduled_at).length
  const change = async (match: TournamentMatch, patch: { scheduled_at?: string | null; venue?: string | null; status?: string }, message: string, reason = '') => {
    const result = await updateFixture(client, match.id, patch, reason)
    if (result.error) return result.error
    onNotice(message); setEditing(null); onChanged(); return null
  }
  // A walkover is an official result: submitted and confirmed as 3-0 (or 0-3) with outcome "walkover".
  const walkover = async (match: TournamentMatch, winner: 'home' | 'away', reason: string) => {
    const score = { home: winner === 'home' ? 3 : 0, away: winner === 'away' ? 3 : 0, outcome: 'walkover', note: reason }
    const submitted = await submitMatchResult(client, match.id, score, user.id)
    if (submitted.error) return 'The walkover could not be recorded. Check that the match has no result yet.'
    const confirmed = await confirmMatchResult(client, String(submitted.data), user.id)
    if (confirmed.error) return 'The walkover was submitted but not confirmed. Confirm it in Match Center.'
    onNotice('Walkover recorded as an official result.'); onChanged(); return null
  }
  const row = (match: TournamentMatch) => <li key={match.id} className="match-row">
    <div className="match-teams"><strong>{match.home_team_name ?? 'To be decided'}</strong><span>vs</span><strong>{match.away_team_name ?? 'To be decided'}</strong></div>
    <div className="match-facts"><Pill tone={matchStatusTone(match.status)}>{matchStatusLabel(match.status)}</Pill><span>{match.venue ?? 'Venue not set'}</span><time>{maldivesTime(match.scheduled_at)}</time>{match.leg === 2 ? <span>2nd leg</span> : null}</div>
    {warnings.get(match.id)?.map(text => <p className="tp-warn" key={text}><AlertTriangle size={13} /> {text}</p>)}
    {canManage && !['confirmed'].includes(match.status) && (editing === match.id
      ? <FixtureEditor match={match} onCancel={() => setEditing(null)} onSave={(scheduledAt, venue) => change(match, { scheduled_at: scheduledAt, venue, ...(match.status === 'postponed' && scheduledAt ? { status: 'scheduled' } : {}) }, 'Fixture updated. Both teams were notified if the draw is public.')} />
      : <div className="button-row wrap">
        <button type="button" className="outline-button dark" onClick={() => setEditing(match.id)}><CalendarClock size={14} /> {match.scheduled_at ? 'Reschedule' : 'Schedule'}</button>
        {match.status === 'scheduled' && <ReasonAction label="Postpone" hint="Both teams see this reason." onConfirm={reason => change(match, { status: 'postponed' }, 'Fixture postponed.', reason)} />}
        {['scheduled', 'postponed'].includes(match.status) && <ReasonAction label="Cancel fixture" tone="danger" hint="Both teams see this reason." onConfirm={reason => change(match, { status: 'cancelled' }, 'Fixture cancelled.', reason)} />}
        {['live', 'scheduled'].includes(match.status) && <ReasonAction label="Abandon" hint="Both teams see this reason." onConfirm={reason => change(match, { status: 'abandoned' }, 'Match abandoned.', reason)} />}
        {['postponed', 'abandoned', 'cancelled'].includes(match.status) && <button type="button" className="outline-button dark" onClick={() => void change(match, { status: 'scheduled' }, 'Fixture back on schedule.')}>Reinstate</button>}
        {['scheduled', 'postponed'].includes(match.status) && match.home_team_id && match.away_team_id && <WalkoverAction match={match} onConfirm={walkover} />}
        {deletableFixture(match) && <ReasonAction label="Delete fixture" confirmLabel="Delete fixture" tone="danger" hint="Only for a fixture added by mistake. It is removed from the schedule; the reason is kept in the activity log." onConfirm={async reason => { const result = await deleteFixture(client, match.id, reason); if (result.error) return result.error; onNotice('Fixture deleted.'); setEditing(null); onChanged(); return null }} />}
      </div>)}
  </li>
  return <div className="tab-panel">
    <p className="field-hint">All times are Maldives time (UTC+5). {unscheduled ? `${unscheduled} fixture(s) still need a date.` : 'Every fixture has a date.'} Changes to published fixtures are recorded and both teams’ managers are notified in the app.</p>
    <div className="tp-toolbar">
      <div className="ed-toggle" role="group" aria-label="View">{(['calendar', 'list'] as const).map(value => <button type="button" key={value} aria-pressed={view === value} className={view === value ? 'active' : ''} onClick={() => setView(value)}>{value === 'calendar' ? 'By day' : 'List'}</button>)}</div>
      <button type="button" className="outline-button dark" onClick={() => csvDownload(fixturesCsv(sorted, matchStatusLabel), 'fixtures')}><Download size={14} /> Export CSV</button><PrintButton />
      {canManage && stages.length > 0 && <button type="button" className="outline-button dark" onClick={() => setAdding(value => !value)}>Add fixture</button>}
    </div>
    {adding && <ManualFixtureForm stages={stages} teams={teams} onCancel={() => setAdding(false)} onSave={async input => { const result = await addFixture(client, user.id, { tournamentId, ...input }); if (result.error) return result.error; setAdding(false); onNotice('Fixture added.'); onChanged(); return null }} />}
    {matches.length === 0 ? <div className="state-block"><CalendarClock size={22} /><h3>No fixtures yet</h3><p>Save a draw in Draw &amp; competition to generate fixtures, then schedule them here.</p></div>
      : view === 'list' ? <ul className="match-list">{sorted.map(row)}</ul>
      : [...byDay.entries()].map(([day, list]) => <section key={day} className="tp-day"><h3>{day}</h3><ul className="match-list">{list.map(row)}</ul></section>)}
    <TournamentTimeline client={client} tournamentId={tournamentId} types={['match']} title="Fixture changes" reloadKey={reloadKey} />
  </div>
}

function FixtureEditor({ match, onSave, onCancel }: { match: TournamentMatch; onSave: (scheduledAt: string | null, venue: string | null) => Promise<string | null>; onCancel: () => void }) {
  const [when, setWhen] = useState(toMaldivesInput(match.scheduled_at))
  const [venue, setVenue] = useState(match.venue ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (event: FormEvent) => { event.preventDefault(); setBusy(true); const problem = await onSave(fromMaldivesInput(when), venue.trim() || null); setBusy(false); if (problem) setError(problem) }
  return <form className="score-form" onSubmit={save}>
    <label>Date and time (Maldives)<input type="datetime-local" value={when} onChange={event => setWhen(event.target.value)} /></label>
    <label>Venue<input value={venue} list="kv-venues" maxLength={120} onChange={event => setVenue(event.target.value)} /></label>
    <div className="button-row"><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button><button type="button" className="outline-button dark" onClick={onCancel}>Cancel</button></div>
    {error && <div className="form-error" role="alert">{error}</div>}
  </form>
}

function WalkoverAction({ match, onConfirm }: { match: TournamentMatch; onConfirm: (match: TournamentMatch, winner: 'home' | 'away', reason: string) => Promise<string | null> }) {
  const [winner, setWinner] = useState<'home' | 'away'>('home')
  return <ReasonAction label="Walkover" hint="Records an official 3–0 result for the team that turned up. Standings update at once." onConfirm={reason => onConfirm(match, winner, reason)}>
    <label className="pf-field">Awarded to<select value={winner} onChange={event => setWinner(event.target.value as 'home' | 'away')}><option value="home">{match.home_team_name ?? 'Home team'}</option><option value="away">{match.away_team_name ?? 'Away team'}</option></select></label>
  </ReasonAction>
}

function ManualFixtureForm({ stages, teams, onSave, onCancel }: { stages: Stage[]; teams: Array<{ id: string; name: string }>; onSave: (input: { stage: Stage; homeTeamId: string; awayTeamId: string; scheduledAt: string | null; venue: string | null }) => Promise<string | null>; onCancel: () => void }) {
  const [stageId, setStageId] = useState(stages[0]?.id ?? '')
  const [home, setHome] = useState('')
  const [away, setAway] = useState('')
  const [when, setWhen] = useState('')
  const [venue, setVenue] = useState('')
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const stage = stages.find(item => item.id === stageId)
    if (!stage || !home || !away) return setError('Choose the stage and both teams.')
    const problem = await onSave({ stage, homeTeamId: home, awayTeamId: away, scheduledAt: fromMaldivesInput(when), venue: venue.trim() || null })
    if (problem) setError(problem)
  }
  return <form className="panel-block form-grid" onSubmit={submit}>
    <label>Stage<select value={stageId} onChange={event => setStageId(event.target.value)}>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
    <label>Home team<select value={home} onChange={event => setHome(event.target.value)}><option value="">Choose…</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
    <label>Away team<select value={away} onChange={event => setAway(event.target.value)}><option value="">Choose…</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
    <label>Date and time (Maldives, optional)<input type="datetime-local" value={when} onChange={event => setWhen(event.target.value)} /></label>
    <label>Venue (optional)<input value={venue} list="kv-venues" onChange={event => setVenue(event.target.value)} /></label>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="button-row"><button type="submit" className="primary-button">Add fixture</button><button type="button" className="outline-button dark" onClick={onCancel}>Cancel</button></div>
  </form>
}

// ---------------------------------------------------------------------------------------------------
// Page 35: standings rules, adjustments and recalculation
// ---------------------------------------------------------------------------------------------------
export function StandingsManagement({ client, tournamentId, teamNames, canManage, reloadKey, onNotice, onChanged }: { client: SupabaseClient; tournamentId: string; teamNames: Record<string, string>; canManage: boolean; reloadKey: number; onNotice: (message: string) => void; onChanged: () => void }) {
  const [stages, setStages] = useState<Stage[] | null>(null)
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = useCallback(() => {
    void loadStages(client, tournamentId).then(async result => {
      setStages(result.data); setError(result.error ?? '')
      const loaded = await loadAdjustments(client, result.data.map(stage => stage.id)); setAdjustments(loaded.data); if (loaded.error) setError(loaded.error)
    })
  }, [client, tournamentId])
  useEffect(() => { reload() }, [reload, reloadKey])
  const tableStages = (stages ?? []).filter(stage => stage.format !== 'knockout')
  const recalc = async () => { setBusy(true); const result = await recalculateTournament(client, tournamentId); setBusy(false); if (result.error) return setError(result.error); onNotice('Standings and statistics recalculated from confirmed results.'); onChanged() }
  return <section className="panel-block" aria-label="Standings management">
    <h3><Trophy size={15} /> Points, tie-breakers and adjustments</h3>
    <p className="field-hint">Tables are rebuilt from confirmed results only, once per confirmation or correction, so nothing is counted twice. Changing points recalculates the stage at once.</p>
    {error ? <Problem text={error} onRetry={reload} /> : null}
    {canManage && <button type="button" className="outline-button dark" disabled={busy} onClick={() => void recalc()}><RefreshCw size={14} /> {busy ? 'Recalculating…' : 'Recalculate now'}</button>}
    {!stages ? <p className="field-hint">Loading…</p> : tableStages.length === 0 ? <p className="empty-note">No league or group stage yet.</p>
      : tableStages.map(stage => <StageRulesEditor key={stage.id} client={client} stage={stage} teamNames={teamNames} canManage={canManage} adjustments={adjustments.filter(item => item.stage_id === stage.id)} onSaved={message => { onNotice(message); reload(); onChanged() }} />)}
  </section>
}

function StageRulesEditor({ client, stage, teamNames, canManage, adjustments, onSaved }: { client: SupabaseClient; stage: Stage; teamNames: Record<string, string>; canManage: boolean; adjustments: Adjustment[]; onSaved: (message: string) => void }) {
  const [rules, setRules] = useState<StageRules>({ points_win: stage.rules.points_win ?? 3, points_draw: stage.rules.points_draw ?? 1, points_loss: stage.rules.points_loss ?? 0, tiebreakers: stage.rules.tiebreakers ?? ['goal_difference', 'goals_scored', 'head_to_head'], third_place: stage.rules.third_place ?? false })
  const [team, setTeam] = useState('')
  const [points, setPoints] = useState('')
  const [error, setError] = useState('')
  const teams = Object.entries(teamNames)
  const save = async () => {
    for (const key of ['points_win', 'points_draw', 'points_loss'] as const) { const value = rules[key]; if (!Number.isInteger(value) || (value as number) < -5 || (value as number) > 10) return setError('Points must be whole numbers between -5 and 10.') }
    const result = await saveStageRules(client, stage.id, { ...stage.rules, ...rules })
    if (result.error) return setError(result.error)
    setError(''); onSaved(`${stage.name}: rules saved and table recalculated.`)
  }
  const move = (index: number, direction: -1 | 1) => { const list = [...(rules.tiebreakers ?? [])]; const target = index + direction; if (target < 0 || target >= list.length) return; [list[index], list[target]] = [list[target], list[index]]; setRules({ ...rules, tiebreakers: list }) }
  return <div className="tp-stage">
    <h4>{stage.name}</h4>
    <div className="tp-points">{(['points_win', 'points_draw', 'points_loss'] as const).map(key => <label key={key}>{key === 'points_win' ? 'Win' : key === 'points_draw' ? 'Draw' : 'Loss'}<input type="number" min={-5} max={10} disabled={!canManage} value={rules[key]} onChange={event => setRules({ ...rules, [key]: Number(event.target.value) })} /></label>)}</div>
    <p className="field-hint">Tie-breakers, in order:</p>
    <ol className="tp-tiebreakers">{(rules.tiebreakers ?? []).map((item, index) => <li key={item}>{TIEBREAKERS[item] ?? item}{canManage && <span className="button-row compact"><button type="button" className="ghost-button" aria-label={`Move ${TIEBREAKERS[item]} up`} onClick={() => move(index, -1)}>↑</button><button type="button" className="ghost-button" aria-label={`Move ${TIEBREAKERS[item]} down`} onClick={() => move(index, 1)}>↓</button></span>}</li>)}</ol>
    {canManage && <div className="button-row"><button type="button" className="primary-button" onClick={() => void save()}>Save rules</button></div>}
    <h5>Manual adjustments</h5>
    {adjustments.length === 0 ? <p className="empty-note">None.</p> : <ul className="plain-list">{adjustments.map(item => <li key={item.id} className={item.revoked_at ? 'tp-revoked' : ''}>{teamNames[item.team_id] ?? 'Team'}: {item.points > 0 ? '+' : ''}{item.points} point(s) · {item.reason}{item.revoked_at ? ' (removed)' : ''}
      {canManage && !item.revoked_at && <ReasonAction label="Remove" onConfirm={async reason => { const result = await revokeAdjustment(client, item.id, reason); if (result.error) return result.error; onSaved('Adjustment removed and table recalculated.'); return null }} />}</li>)}</ul>}
    {canManage && <div className="tp-adjust">
      <label>Team<select value={team} onChange={event => setTeam(event.target.value)}><option value="">Choose…</option>{teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Points (+ or −)<input type="number" min={-100} max={100} value={points} onChange={event => setPoints(event.target.value)} /></label>
      <ReasonAction label="Add adjustment" hint="For example a points deduction decided by the disciplinary committee. Recorded with your reason." disabled={!team || !points || Number(points) === 0} onConfirm={async reason => { const result = await adjustStandings(client, stage.id, team, Math.trunc(Number(points)), reason); if (result.error) return result.error; setTeam(''); setPoints(''); onSaved('Adjustment added and table recalculated.'); return null }} />
    </div>}
    {error && <div className="form-error" role="alert">{error}</div>}
  </div>
}

// ---------------------------------------------------------------------------------------------------
// Page 36: tournament operations
// ---------------------------------------------------------------------------------------------------
export function OperationsPage({ client, user, tournamentId, matches, entries, canManage, reloadKey, onNotice, children }: { client: SupabaseClient; user: User; tournamentId: string; matches: TournamentMatch[]; entries: TournamentEntry[]; canManage: boolean; reloadKey: number; onNotice: (message: string) => void; children: ReactNode }) {
  const upcoming = matches.filter(match => ['scheduled', 'live', 'postponed'].includes(match.status)).sort((a, b) => (a.scheduled_at ? Date.parse(a.scheduled_at) : Infinity) - (b.scheduled_at ? Date.parse(b.scheduled_at) : Infinity))
  const [matchId, setMatchId] = useState(upcoming[0]?.id ?? '')
  const venues = [...new Set(matches.map(match => match.venue?.trim()).filter((venue): venue is string => Boolean(venue)))]
  return <div className="tab-panel">
    <p className="field-hint">Officials, match-day preparation, incidents and exports. Everything here is private to this tournament’s operations staff and the assigned officials.</p>
    {children}
    <section className="panel-block" aria-label="Venues"><h3>Venues</h3>{venues.length === 0 ? <p className="empty-note">No venues set on fixtures yet. Add them in Fixtures &amp; scheduling.</p>
      : <ul className="plain-list">{venues.map(venue => { const list = matches.filter(match => match.venue?.trim() === venue); return <li key={venue}><strong>{venue}</strong>: {list.length} fixture(s), next {maldivesTime(list.filter(match => match.scheduled_at && Date.parse(match.scheduled_at) > Date.now()).sort((a, b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!))[0]?.scheduled_at ?? null)}</li> })}</ul>}</section>
    <section className="panel-block" aria-label="Match-day checklist"><h3><ClipboardCheck size={15} /> Match-day checklist</h3>
      {upcoming.length === 0 ? <p className="empty-note">No upcoming matches.</p> : <>
        <label className="pf-field">Match<select value={matchId} onChange={event => setMatchId(event.target.value)}>{upcoming.map(match => <option key={match.id} value={match.id}>{maldivesTime(match.scheduled_at)} · {match.home_team_name ?? 'TBD'} vs {match.away_team_name ?? 'TBD'}</option>)}</select></label>
        {matchId && <Checklist key={matchId} client={client} userId={user.id} matchId={matchId} canEdit={canManage} onNotice={onNotice} />}
      </>}
    </section>
    <Incidents client={client} userId={user.id} tournamentId={tournamentId} matches={matches} canManage={canManage} onNotice={onNotice} />
    <section className="panel-block" aria-label="Exports"><h3><Download size={15} /> Exports</h3>
      <p className="field-hint">Exports include names and statuses only: no contact details, documents, identity numbers or payment proof.</p>
      <div className="button-row wrap">
        <button type="button" className="outline-button dark" onClick={() => csvDownload(fixturesCsv(matches, matchStatusLabel), 'fixtures')}>Fixtures</button>
        <button type="button" className="outline-button dark" onClick={() => csvDownload(applicationsCsv(entries, { application: applicationStatusLabel, roster: rosterStatusLabel, payment: paymentStatusLabel }), 'teams')}>Teams and statuses</button>
      </div>
    </section>
    <TournamentTimeline client={client} tournamentId={tournamentId} types={['incident', 'match']} title="Operations activity" reloadKey={reloadKey} />
  </div>
}

function Checklist({ client, userId, matchId, canEdit, onNotice }: { client: SupabaseClient; userId: string; matchId: string; canEdit: boolean; onNotice: (message: string) => void }) {
  const [items, setItems] = useState<ChecklistItem[] | null>(null)
  const [error, setError] = useState('')
  const [newItem, setNewItem] = useState('')
  useEffect(() => { void loadChecklist(client, matchId).then(result => { setItems(result.data.length ? result.data : DEFAULT_CHECKLIST.map(label => ({ label, done: false }))); setError(result.error ?? '') }) }, [client, matchId])
  const persist = async (next: ChecklistItem[]) => { setItems(next); const result = await saveChecklist(client, userId, matchId, next); if (result.error) setError(result.error); else setError('') }
  if (!items) return <p className="field-hint">Loading…</p>
  const done = items.filter(item => item.done).length
  return <div className="tp-checklist">
    {error ? <Problem text={error} /> : null}
    <p className="field-hint">{done} of {items.length} done</p>
    <ul className="plain-list">{items.map((item, index) => <li key={`${item.label}-${index}`}><label className="checkbox-row"><input type="checkbox" checked={item.done} disabled={!canEdit} onChange={event => void persist(items.map((entry, i) => i === index ? { ...entry, done: event.target.checked } : entry))} /> {item.label}</label></li>)}</ul>
    {canEdit && <form className="button-row" onSubmit={event => { event.preventDefault(); if (newItem.trim()) { void persist([...items, { label: newItem.trim(), done: false }]); setNewItem(''); onNotice('Checklist item added.') } }}><input aria-label="New checklist item" value={newItem} maxLength={120} onChange={event => setNewItem(event.target.value)} placeholder="Add an item" /><button type="submit" className="outline-button dark">Add</button></form>}
  </div>
}

function Incidents({ client, userId, tournamentId, matches, canManage, onNotice }: { client: SupabaseClient; userId: string; tournamentId: string; matches: TournamentMatch[]; canManage: boolean; onNotice: (message: string) => void }) {
  const [items, setItems] = useState<Incident[] | null>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ matchId: '', category: 'injury', severity: 'medium', description: '' })
  const reload = useCallback(() => { void loadIncidents(client, tournamentId).then(result => { setItems(result.data); setError(result.error ?? '') }) }, [client, tournamentId])
  useEffect(() => { reload() }, [reload])
  const matchLabel = (id: string | null) => { const match = matches.find(item => item.id === id); return match ? `${match.home_team_name ?? 'TBD'} vs ${match.away_team_name ?? 'TBD'}` : 'Tournament-wide' }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (draft.description.trim().length < 3) return setError('Describe what happened.')
    const result = await reportIncident(client, userId, { tournamentId, matchId: draft.matchId || null, category: draft.category, severity: draft.severity, description: draft.description })
    if (result.error) return setError(result.error)
    setDraft({ ...draft, description: '' }); onNotice('Incident recorded.'); reload()
  }
  // Correct an open incident's type, severity or description in place.
  const [editingIncident, setEditingIncident] = useState<{ id: string; category: string; severity: string; description: string } | null>(null)
  const saveIncident = async (event: FormEvent) => {
    event.preventDefault(); if (!editingIncident) return
    const result = await updateIncident(client, editingIncident.id, editingIncident)
    if (result.error) return setError(result.error)
    setEditingIncident(null); setError(''); onNotice('Incident updated.'); reload()
  }
  return <section className="panel-block" aria-label="Incidents"><h3><ShieldAlert size={15} /> Incidents</h3>
    <form className="form-grid" onSubmit={submit}>
      <label>Match<select value={draft.matchId} onChange={event => setDraft({ ...draft, matchId: event.target.value })}><option value="">Tournament-wide</option>{matches.map(match => <option key={match.id} value={match.id}>{matchLabel(match.id)}</option>)}</select></label>
      <label>Type<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}>{Object.entries(INCIDENT_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Severity<select value={draft.severity} onChange={event => setDraft({ ...draft, severity: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      <label className="tp-wide">What happened<textarea rows={2} maxLength={2000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      <div className="button-row"><button type="submit" className="primary-button">Record incident</button></div>
    </form>
    {error ? <Problem text={error} onRetry={reload} /> : null}
    {!items ? <p className="field-hint">Loading…</p> : items.length === 0 ? <p className="empty-note">No incidents recorded.</p>
      : <ul className="tp-list">{items.map(item => editingIncident?.id === item.id ? <li key={item.id} className="result-row"><form className="inline-editor form-grid" onSubmit={event => void saveIncident(event)} aria-label="Edit incident">
        <label>Type<select value={editingIncident.category} onChange={event => setEditingIncident({ ...editingIncident, category: event.target.value })}>{Object.entries(INCIDENT_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Severity<select value={editingIncident.severity} onChange={event => setEditingIncident({ ...editingIncident, severity: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label className="tp-wide">What happened<textarea rows={3} maxLength={2000} value={editingIncident.description} onChange={event => setEditingIncident({ ...editingIncident, description: event.target.value })} /></label>
        <div className="button-row tp-wide"><button type="submit" className="primary-button">Save changes</button><button type="button" className="outline-button dark" onClick={() => setEditingIncident(null)}>Cancel</button></div>
      </form></li> : <li key={item.id} className="result-row"><div><strong>{INCIDENT_CATEGORIES[item.category] ?? item.category} · {matchLabel(item.match_id)}</strong><span>{item.description}</span><small>{maldivesTime(item.created_at)}{item.resolution ? ` · Resolution: ${item.resolution}` : ''}</small></div>
        <div className="button-row"><Pill tone={item.status === 'open' ? (item.severity === 'high' ? 'danger' : 'warn') : 'ok'}>{item.status === 'open' ? `Open · ${item.severity}` : 'Resolved'}</Pill>
          {canManage && item.status === 'open' && <button type="button" className="ghost-button" aria-label={`Edit incident: ${item.description.slice(0, 40)}`} onClick={() => setEditingIncident({ id: item.id, category: item.category, severity: item.severity, description: item.description })}><Pencil size={13} aria-hidden="true" /> Edit</button>}
          {canManage && item.status === 'open' && <ReasonAction label="Resolve" onConfirm={async resolution => { const result = await resolveIncident(client, userId, item.id, resolution); if (result.error) return result.error; onNotice('Incident resolved.'); reload(); return null }} />}</div></li>)}</ul>}
  </section>
}

// ---------------------------------------------------------------------------------------------------
// Page 37: tournament finance and sponsors
// ---------------------------------------------------------------------------------------------------
export function TournamentFinancePage({ client, user, tournamentId, entries, canFinance, reloadKey, onNotice, children }: { client: SupabaseClient; user: User; tournamentId: string; entries: TournamentEntry[]; canFinance: boolean; reloadKey: number; onNotice: (message: string) => void; children: ReactNode }) {
  const [overview, setOverview] = useState<FinanceOverview | null>(null)
  const [sponsors, setSponsors] = useState<SponsorRecord[]>([])
  const [sponsorError, setSponsorError] = useState('')
  const entryKey = entries.map(entry => entry.id).join(',')
  const reload = useCallback(() => {
    void loadFinanceOverview(client, tournamentId, entryKey ? entryKey.split(',') : []).then(setOverview)
    void loadSponsorRecords(client, tournamentId).then(result => { setSponsors(result.data); setSponsorError(result.error ?? '') })
  }, [client, tournamentId, entryKey])
  useEffect(() => { reload() }, [reload, reloadKey])
  if (!canFinance) return <div className="tab-panel"><div className="state-block"><Wallet size={22} /><h3>Finance is restricted</h3><p>Only the organization owner, operations members and tournament finance staff can see this tournament’s money.</p></div></div>
  const totals = overview ? financeTotals(overview) : null
  const exportRows = () => overview && csvDownload(toCsv(['Date', 'Type', 'Description', 'Status', 'Amount (MVR)'], [
    ...overview.payments.map(row => [maldivesTime(row.created_at, false), 'Registration fee', entries.find(entry => entry.id === row.entry_id)?.team_name ?? 'Team', row.status, row.amount_mvr.toFixed(2)]),
    ...overview.adjustments.map(row => [maldivesTime(row.created_at, false), row.kind === 'waiver' ? 'Waiver' : 'Refund', row.reason, '', (-row.amount_mvr).toFixed(2)]),
    ...overview.income.map(row => [maldivesTime(row.created_at, false), INCOME_KINDS[row.kind] ?? row.kind, row.description, row.status, row.amount_mvr.toFixed(2)]),
    ...overview.expenses.map(row => [maldivesTime(row.created_at, false), 'Expense', `${row.category}: ${row.description}`, row.status, (-row.amount_mvr).toFixed(2)]),
  ]), 'tournament-finance')
  return <div className="tab-panel">
    <p className="field-hint">Tournament finance is kept apart from the organization’s and teams’ own finance. All amounts are in MVR, and every change is recorded.</p>
    {overview?.errors.length ? <Problem text={`Some finance records could not be loaded and are left out of the totals: ${overview.errors.join(' ')}`} onRetry={reload} /> : null}
    {!totals ? <p className="field-hint">Loading…</p> : <dl className="ws-counts tp-money">
      <div><dt>Registration fees verified</dt><dd>{formatMvr(totals.registration)}</dd></div>
      <div><dt>Sponsorship received</dt><dd>{formatMvr(totals.sponsorship)}</dd></div>
      <div><dt>Donations and other</dt><dd>{formatMvr(totals.donations)}</dd></div>
      <div><dt>Waived / refunded</dt><dd>{formatMvr(totals.waived)} / {formatMvr(totals.refunded)}</dd></div>
      <div><dt>Expenses</dt><dd>{formatMvr(totals.expenses)}</dd></div>
      <div className={totals.net < 0 ? 'tone-warn' : ''}><dt>Net (received)</dt><dd>{formatMvr(totals.net)}</dd></div>
      {totals.pledged ? <div><dt>Pledged, not yet received</dt><dd>{formatMvr(totals.pledged)}</dd></div> : null}
    </dl>}
    <div className="button-row"><button type="button" className="outline-button dark" disabled={!overview} onClick={exportRows}><Download size={14} /> Export finance CSV</button></div>
    {overview && <IncomePanel client={client} userId={user.id} tournamentId={tournamentId} income={overview.income} sponsors={sponsors} onChanged={message => { onNotice(message); reload() }} />}
    {overview && <section className="panel-block" aria-label="Registration fees"><h3>Registration fees and payments</h3>
      {overview.fees.length === 0 ? <p className="empty-note">No registration fee is set for this tournament.</p> : <ul className="plain-list">{overview.fees.map(fee => <li key={fee.id}>{fee.label}: {formatMvr(fee.amount_mvr)}</li>)}</ul>}
      <p className="field-hint">{overview.payments.length} payment record(s). Verify, reject, waive or refund payments from each team’s application in Applications.</p>
      {overview.adjustments.length ? <><h4>Waivers and refunds</h4><ul className="plain-list">{overview.adjustments.map(row => <li key={row.id}>{row.kind === 'waiver' ? 'Waiver' : 'Refund'} {formatMvr(row.amount_mvr)} · {row.reason}</li>)}</ul></> : null}
    </section>}
    {children}
    <SponsorsManager client={client} userId={user.id} tournamentId={tournamentId} sponsors={sponsors} error={sponsorError} onChanged={message => { onNotice(message); reload() }} />
    <SponsorDeliverablesPanel client={client} userId={user.id} tournamentId={tournamentId} sponsors={sponsors} reloadKey={reloadKey} onNotice={onNotice} />
    <TournamentTimeline client={client} tournamentId={tournamentId} types={['income', 'sponsor']} title="Finance activity" reloadKey={reloadKey} />
  </div>
}

function IncomePanel({ client, userId, tournamentId, income, sponsors, onChanged }: { client: SupabaseClient; userId: string; tournamentId: string; income: FinanceOverview['income']; sponsors: SponsorRecord[]; onChanged: (message: string) => void }) {
  const [draft, setDraft] = useState({ kind: 'sponsorship', sponsorId: '', amount: '', description: '', status: 'pledged', receivedOn: '' })
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const result = await saveIncome(client, userId, tournamentId, { kind: draft.kind, sponsorId: draft.sponsorId || null, amount: Number(draft.amount), description: draft.description, status: draft.status, receivedOn: draft.receivedOn || null })
    if (result.error) return setError(result.error)
    setError(''); setDraft({ ...draft, amount: '', description: '', receivedOn: '' }); onChanged('Income recorded.')
  }
  return <section className="panel-block" aria-label="Sponsorships and donations"><h3><Wallet size={15} /> Sponsorships and donations</h3>
    <form className="form-grid" onSubmit={submit}>
      <label>Type<select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value })}>{Object.entries(INCOME_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {draft.kind === 'sponsorship' && <label>Sponsor<select value={draft.sponsorId} onChange={event => setDraft({ ...draft, sponsorId: event.target.value })}><option value="">Not linked</option>{sponsors.map(sponsor => <option key={sponsor.id} value={sponsor.id}>{sponsor.name}</option>)}</select></label>}
      <label>Amount (MVR)<input inputMode="decimal" value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value.replace(/[^0-9.]/g, '') })} /></label>
      <label>Description<input value={draft.description} maxLength={300} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      <label>Status<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="pledged">Pledged</option><option value="received">Received</option></select></label>
      {draft.status === 'received' && <label>Received on<input type="date" value={draft.receivedOn} onChange={event => setDraft({ ...draft, receivedOn: event.target.value })} /></label>}
      <div className="button-row"><button type="submit" className="primary-button">Record</button></div>
    </form>
    {error && <div className="form-error" role="alert">{error}</div>}
    {income.length === 0 ? <p className="empty-note">No sponsorship or donation recorded.</p> : <ul className="tp-list">{income.map(row => <li key={row.id} className="result-row">
      <div><strong>{formatMvr(row.amount_mvr)} · {INCOME_KINDS[row.kind] ?? row.kind}</strong><span>{row.description}{row.sponsor_id ? ` · ${sponsors.find(sponsor => sponsor.id === row.sponsor_id)?.name ?? 'Sponsor'}` : ''}</span></div>
      <div className="button-row"><Pill tone={row.status === 'received' ? 'ok' : row.status === 'cancelled' ? 'neutral' : 'warn'}>{row.status === 'received' ? `Received ${row.received_on ?? ''}` : row.status === 'cancelled' ? 'Cancelled' : 'Pledged'}</Pill>
        {row.status === 'pledged' && <><button type="button" className="outline-button dark" onClick={() => void setIncomeStatus(client, row.id, 'received', null).then(result => result.error ? setError(result.error) : onChanged('Marked as received.'))}>Mark received</button>
          <ConfirmButton label="Cancel pledge" question="Cancel this pledge? It stays in the records as cancelled." onConfirm={async () => { const result = await setIncomeStatus(client, row.id, 'cancelled', null); if (result.error) return result.error; onChanged('Pledge cancelled.'); return null }} /></>}</div>
    </li>)}</ul>}
  </section>
}

// What the organizer owes each sponsor (unified plan section 22). In-kind
// value and cash stay in Income above; this list never changes money totals.
function SponsorDeliverablesPanel({ client, userId, tournamentId, sponsors, reloadKey, onNotice }: { client: SupabaseClient; userId: string; tournamentId: string; sponsors: SponsorRecord[]; reloadKey: number; onNotice: (message: string) => void }) {
  const [items, setItems] = useState<Deliverable[] | null>(null)
  const [state, setState] = useState<'ready' | 'pending' | 'error'>('ready')
  const [draft, setDraft] = useState({ sponsorId: '', kind: 'banner' as DeliverableKind, title: '', dueOn: '', note: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [loadKey, setLoadKey] = useState(0)
  useEffect(() => { let active = true; void loadDeliverables(client, tournamentId).then(result => { if (active) { setItems(result.data); setState(result.state) } }); return () => { active = false } }, [client, tournamentId, reloadKey, loadKey])
  const today = maldivesToday()
  const refresh = (message: string) => { onNotice(message); setLoadKey(value => value + 1) }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    const sponsorId = draft.sponsorId || sponsors[0]?.id || ''
    if (!sponsorId) return setError('Add a sponsor first.')
    setBusy('add')
    const result = await addDeliverable(client, userId, tournamentId, { ...draft, sponsorId })
    setBusy('')
    if (result.error) return setError(result.error)
    setDraft({ ...draft, title: '', dueOn: '', note: '' }); refresh('Added to the sponsor checklist.')
  }
  const change = async (id: string, status: DeliverableStatus) => {
    setBusy(id); setError('')
    const result = await setDeliverableStatus(client, id, status)
    setBusy('')
    if (result.error) return setError(result.error)
    refresh(status === 'delivered' ? 'Marked as delivered.' : status === 'waived' ? 'Marked as not needed.' : 'Moved back to to-do.')
  }
  // Edit an item's wording, type, due date or note in place.
  const [editing, setEditing] = useState<{ id: string; kind: DeliverableKind; title: string; dueOn: string; note: string } | null>(null)
  const saveEdit = async (event: FormEvent) => {
    event.preventDefault(); if (!editing) return
    setBusy(editing.id); setError('')
    const result = await updateDeliverable(client, editing.id, editing)
    setBusy('')
    if (result.error) return setError(result.error)
    setEditing(null); refresh('Checklist item saved.')
  }
  if (!sponsors.length) return null
  const summary = items ? deliverableSummary(items, today) : null
  return <section className="panel-block" aria-label="Sponsor checklist"><h3><ListChecks size={15} /> Sponsor checklist</h3>
    <p className="field-hint">What each sponsor receives in return: banners, logo placement, posts, passes. Private to finance staff. Money is recorded under Sponsorships above.</p>
    {state === 'pending' ? <p className="pending-note" role="status">{PENDING_DELIVERABLES}</p>
      : state === 'error' ? <Problem text="The sponsor checklist could not be loaded." onRetry={() => setLoadKey(value => value + 1)} />
        : items === null ? <p className="field-hint">Loading…</p> : <>
          {summary && summary.total > 0 && <p className="field-hint"><strong>{summary.delivered} of {summary.total}</strong> delivered{summary.overdue ? <> · <span className="tone-warn">{summary.overdue} overdue</span></> : null}</p>}
          {sponsors.map(sponsor => {
            const own = items.filter(item => item.sponsorId === sponsor.id)
            if (!own.length) return null
            return <div key={sponsor.id}><h4>{sponsor.name}</h4><ul className="tp-list">{own.map(item => {
              const overdue = isOverdue(item, today)
              if (editing?.id === item.id) return <li key={item.id} className="result-row"><form className="inline-editor form-grid" onSubmit={event => void saveEdit(event)} aria-label={`Edit ${item.title}`}>
                <label className="tp-wide">What they receive<input value={editing.title} maxLength={160} autoFocus onChange={event => setEditing({ ...editing, title: event.target.value })} /></label>
                <label>Type<select value={editing.kind} onChange={event => setEditing({ ...editing, kind: event.target.value as DeliverableKind })}>{(Object.keys(DELIVERABLE_KINDS) as DeliverableKind[]).map(kind => <option key={kind} value={kind}>{DELIVERABLE_KINDS[kind]}</option>)}</select></label>
                <label>Due date (optional)<input type="date" value={editing.dueOn} onChange={event => setEditing({ ...editing, dueOn: event.target.value })} /></label>
                <label className="tp-wide">Note (optional)<input value={editing.note} maxLength={500} onChange={event => setEditing({ ...editing, note: event.target.value })} /></label>
                <div className="button-row tp-wide"><button type="submit" className="primary-button" disabled={busy === item.id}>{busy === item.id ? 'Saving…' : 'Save changes'}</button><button type="button" className="outline-button dark" onClick={() => setEditing(null)}>Cancel</button></div>
              </form></li>
              return <li key={item.id} className="result-row">
                <div><strong>{item.title}</strong><span>{DELIVERABLE_KINDS[item.kind]}{item.dueOn ? ` · due ${item.dueOn}` : ''}{item.note ? ` · ${item.note}` : ''}</span></div>
                <div className="button-row">
                  <Pill tone={item.status === 'delivered' ? 'ok' : item.status === 'waived' ? 'neutral' : overdue ? 'danger' : 'warn'}>{overdue ? 'Overdue' : DELIVERABLE_STATUS[item.status]}</Pill>
                  {item.status === 'pending' ? <>
                    <button type="button" className="outline-button dark" disabled={busy === item.id} onClick={() => void change(item.id, 'delivered')}>Mark delivered</button>
                    <button type="button" className="ghost-button" disabled={busy === item.id} onClick={() => void change(item.id, 'waived')}>Not needed</button>
                  </> : <button type="button" className="ghost-button" disabled={busy === item.id} onClick={() => void change(item.id, 'pending')}>Undo</button>}
                  <button type="button" className="ghost-button" aria-label={`Edit ${item.title}`} onClick={() => setEditing({ id: item.id, kind: item.kind, title: item.title, dueOn: item.dueOn ?? '', note: item.note ?? '' })}><Pencil size={13} aria-hidden="true" /> Edit</button>
                  <ConfirmButton label="Remove" question={`Remove “${item.title}”?`} onConfirm={async () => { const result = await removeDeliverable(client, item.id); if (result.error) return result.error; refresh('Removed from the checklist.'); return null }} />
                </div>
              </li>
            })}</ul></div>
          })}
          {items.length === 0 && <p className="empty-note">Nothing on the checklist yet.</p>}
          <form className="form-grid" onSubmit={submit}>
            <label>Sponsor<select value={draft.sponsorId || sponsors[0]?.id} onChange={event => setDraft({ ...draft, sponsorId: event.target.value })}>{sponsors.map(sponsor => <option key={sponsor.id} value={sponsor.id}>{sponsor.name}</option>)}</select></label>
            <label>Type<select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as DeliverableKind })}>{(Object.keys(DELIVERABLE_KINDS) as DeliverableKind[]).map(kind => <option key={kind} value={kind}>{DELIVERABLE_KINDS[kind]}</option>)}</select></label>
            <label className="tp-wide">What they receive<input value={draft.title} maxLength={160} placeholder="Banner at the main ground for every match" onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
            <label>Due date (optional)<input type="date" value={draft.dueOn} onChange={event => setDraft({ ...draft, dueOn: event.target.value })} /></label>
            <label>Note (optional)<input value={draft.note} maxLength={500} onChange={event => setDraft({ ...draft, note: event.target.value })} /></label>
            <div className="button-row"><button type="submit" className="primary-button" disabled={busy === 'add'}>{busy === 'add' ? 'Adding…' : 'Add to checklist'}</button></div>
          </form>
        </>}
    {error && <div className="form-error" role="alert">{error}</div>}
  </section>
}

function SponsorsManager({ client, userId, tournamentId, sponsors, error, onChanged }: { client: SupabaseClient; userId: string; tournamentId: string; sponsors: SponsorRecord[]; error: string; onChanged: (message: string) => void }) {
  const empty = { name: '', level: 'Partner', website: '', description: '', is_public: true, agreement_notes: '' }
  const [draft, setDraft] = useState(empty)
  const [editing, setEditing] = useState<string | null>(null)
  const [logo, setLogo] = useState<File | null>(null)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setFormError('')
    let logoPath: string | null | undefined
    if (logo) { const uploaded = await uploadSponsorLogo(client, tournamentId, logo); if (uploaded.error) { setBusy(false); return setFormError(uploaded.error) } logoPath = uploaded.path }
    const result = await saveSponsorRecord(client, userId, tournamentId, editing, { ...draft, ...(logoPath !== undefined ? { logo_path: logoPath } : {}) })
    setBusy(false)
    if (result.error) return setFormError(result.error)
    setDraft(empty); setEditing(null); setLogo(null); onChanged(editing ? 'Sponsor updated.' : 'Sponsor added.')
  }
  return <section className="panel-block" aria-label="Sponsors"><h3><Handshake size={15} /> Sponsors</h3>
    <p className="field-hint">Public sponsors appear on the tournament’s Sponsors tab with their logo, level and description. Agreement notes are private to finance staff.</p>
    {error ? <Problem text={error} /> : null}
    {sponsors.length === 0 ? <p className="empty-note">No sponsors yet.</p> : <ul className="tp-list">{sponsors.map(sponsor => <li key={sponsor.id} className="result-row">
      <div className="tp-sponsor">{sponsor.logo_path ? <img src={sponsorLogoUrl(client, sponsor.logo_path)} alt="" width={48} height={48} /> : <span className="tp-sponsor-mark" aria-hidden="true">{sponsor.name.slice(0, 2).toUpperCase()}</span>}
        <div><strong>{sponsor.name}</strong><span>{sponsor.level}{sponsor.website ? ` · ${sponsor.website}` : ''}</span>{sponsor.agreement_notes ? <small><Lock size={11} /> Agreement notes on file</small> : null}</div></div>
      <div className="button-row">{sponsor.is_public ? <Pill tone="ok">Public</Pill> : <Pill tone="neutral">Private</Pill>}
        <button type="button" className="ghost-button" onClick={() => { setEditing(sponsor.id); setDraft({ name: sponsor.name, level: sponsor.level, website: sponsor.website ?? '', description: sponsor.description ?? '', is_public: sponsor.is_public, agreement_notes: sponsor.agreement_notes ?? '' }) }}>Edit</button>
        <ConfirmButton label="Remove" question={'Remove ' + sponsor.name + '?'} onConfirm={async () => { const result = await removeSponsorRecord(client, sponsor.id); if (result.error) return result.error; onChanged('Sponsor removed.'); return null }} /></div>
    </li>)}</ul>}
    <form className="form-grid" onSubmit={submit}>
      <label>Sponsor name<input value={draft.name} maxLength={120} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>Level<select value={draft.level} onChange={event => setDraft({ ...draft, level: event.target.value })}>{SPONSOR_LEVELS.map(level => <option key={level}>{level}</option>)}</select></label>
      <label>Website (optional)<input value={draft.website} placeholder="https://" onChange={event => setDraft({ ...draft, website: event.target.value })} /></label>
      <label><ImageUp size={13} /> Logo (PNG, JPEG or WebP, up to 2 MB)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setLogo(event.target.files?.[0] ?? null)} /></label>
      <label className="tp-wide">Public description (optional)<textarea rows={2} maxLength={400} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      <label className="tp-wide">Agreement notes (private)<textarea rows={2} maxLength={2000} value={draft.agreement_notes} onChange={event => setDraft({ ...draft, agreement_notes: event.target.value })} /></label>
      <label className="checkbox-row"><input type="checkbox" checked={draft.is_public} onChange={event => setDraft({ ...draft, is_public: event.target.checked })} /> Show on the public Sponsors tab</label>
      {formError && <div className="form-error" role="alert">{formError}</div>}
      <div className="button-row"><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save sponsor' : 'Add sponsor'}</button>{editing && <button type="button" className="outline-button dark" onClick={() => { setEditing(null); setDraft(empty) }}>Cancel</button>}</div>
    </form>
  </section>
}

// ---------------------------------------------------------------------------------------------------
// Page 38: tournament media and news
// ---------------------------------------------------------------------------------------------------
export function TournamentMediaPage({ client, user, organizationId, tournament, teams, matches, canPublish, onNotice }: { client: SupabaseClient; user: User; organizationId: string; tournament: OrganizerTournament; teams: Array<{ id: string; name: string }>; matches: TournamentMatch[]; canPublish: boolean; onNotice: (message: string) => void }) {
  const [articles, setArticles] = useState<TournamentArticle[] | null>(null)
  const [linksAvailable, setLinksAvailable] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<ArticleDraft>(EMPTY_ARTICLE)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [publishAt, setPublishAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(false)
  const reload = useCallback(() => { void loadTournamentNews(client, tournament.id).then(result => { setArticles(result.data); setLinksAvailable(result.linksAvailable); setError(result.error ?? '') }) }, [client, tournament.id])
  useEffect(() => { reload() }, [reload])
  const save = async (mode: 'draft' | 'publish' | 'schedule') => {
    setBusy(true); setError('')
    const result = await saveTournamentArticle(client, { id: editingId, organizationId, tournamentId: tournament.id, authorId: user.id, draft, mode, publishAt: fromMaldivesInput(publishAt), linksAvailable })
    setBusy(false)
    if (result.error) return setError(result.error)
    onNotice(mode === 'publish' ? 'Published to the public News page.' : mode === 'schedule' ? `Scheduled for ${maldivesTime(fromMaldivesInput(publishAt))}.` : 'Draft saved. It stays private until you publish it.')
    setDraft(EMPTY_ARTICLE); setEditingId(null); setPublishAt(''); setPreview(false); reload()
  }
  const cover = async (file: File | undefined) => { if (!file) return; setBusy(true); const result = await uploadNewsCover(client, tournament.id, file); setBusy(false); if (result.error || !result.url) return setError(result.error ?? 'Upload failed.'); setDraft(current => ({ ...current, coverUrl: result.url! })) }
  const edit = (article: TournamentArticle) => { setEditingId(article.id); setDraft({ title: article.title, excerpt: article.excerpt ?? '', body: article.body, contentType: article.content_type, coverUrl: article.cover_image_url ?? '', mediaUrl: article.media_url ?? '', relatedTeamId: article.related_team_id ?? '', relatedPlayerId: article.related_player_id ?? '', relatedMatchId: article.related_match_id ?? '' }); setPublishAt('') }
  const status = async (article: TournamentArticle, next: 'draft' | 'published' | 'archived') => { const result = await setArticleStatus(client, article.id, next); if (result.error) return setError(result.error); onNotice(next === 'published' ? 'Published.' : next === 'archived' ? 'Archived and removed from the public page.' : 'Moved back to draft.'); reload() }
  const matchLabel = (match: TournamentMatch) => `${maldivesTime(match.scheduled_at, false)} · ${match.home_team_name ?? 'TBD'} vs ${match.away_team_name ?? 'TBD'}`
  return <div className="tab-panel">
    <p className="field-hint">News, announcements, match reports and award stories for this tournament. Drafts are private; text is shown as plain text, so no code or formatting can be injected.</p>
    {!canPublish ? <div className="state-block"><Newspaper size={22} /><h3>View only</h3><p>Owner, operations and media members write tournament news.</p></div> : <form className="panel-block news-form" onSubmit={event => { event.preventDefault(); void save('draft') }}>
      <h3><FileText size={15} /> {editingId ? 'Edit article' : 'New article'}</h3>
      <label>Title<input value={draft.title} maxLength={160} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Category<select value={draft.contentType} onChange={event => setDraft({ ...draft, contentType: event.target.value })}>{NEWS_CONTENT_TYPES.map(type => <option value={type} key={type}>{NEWS_CONTENT_LABELS[type as NewsContentType]}</option>)}</select></label>
      <label><ImageUp size={13} /> Cover image (optional){draft.coverUrl ? <span className="tp-cover"><img src={draft.coverUrl} alt="" /><button type="button" className="ghost-button" onClick={() => setDraft({ ...draft, coverUrl: '' })}>Remove</button></span> : null}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void cover(event.target.files?.[0])} /></label>
      <label>Summary (optional)<input value={draft.excerpt} maxLength={300} onChange={event => setDraft({ ...draft, excerpt: event.target.value })} /></label>
      <label>Article<textarea rows={8} value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} /></label>
      <label>Video or media link (optional)<input value={draft.mediaUrl} placeholder="https://" onChange={event => setDraft({ ...draft, mediaUrl: event.target.value })} /></label>
      {linksAvailable ? <div className="form-grid">
        <label>Related team<select value={draft.relatedTeamId} onChange={event => setDraft({ ...draft, relatedTeamId: event.target.value })}><option value="">None</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        <label>Related match<select value={draft.relatedMatchId} onChange={event => setDraft({ ...draft, relatedMatchId: event.target.value })}><option value="">None</option>{matches.map(match => <option key={match.id} value={match.id}>{matchLabel(match)}</option>)}</select></label>
      </div> : <p className="pending-note">Linking a story to a team or match needs migration 202611010036.</p>}
      <label>Publish later (optional, Maldives time)<input type="datetime-local" value={publishAt} onChange={event => setPublishAt(event.target.value)} /></label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="button-row wrap">
        <button type="submit" className="outline-button dark" disabled={busy}>Save draft</button>
        <button type="button" className="outline-button dark" onClick={() => setPreview(value => !value)}><Eye size={14} /> {preview ? 'Hide preview' : 'Preview'}</button>
        {publishAt ? <button type="button" className="primary-button" disabled={busy} onClick={() => void save('schedule')}>Schedule</button> : <button type="button" className="primary-button" disabled={busy} onClick={() => void save('publish')}>Publish now</button>}
        {editingId && <button type="button" className="ghost-button" onClick={() => { setEditingId(null); setDraft(EMPTY_ARTICLE); setPublishAt('') }}>Cancel edit</button>}
      </div>
      {preview && <article className="tp-article-preview" aria-label="Preview">{draft.coverUrl ? <img src={draft.coverUrl} alt="" /> : null}<p className="ed-eyebrow">{NEWS_CONTENT_LABELS[draft.contentType as NewsContentType] ?? 'News'} · {tournament.name}</p><h2>{draft.title || 'Your headline'}</h2>{draft.excerpt ? <p className="tp-lede">{draft.excerpt}</p> : null}{draft.body.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</article>}
    </form>}
    <section className="panel-block" aria-label="Articles"><h3><Newspaper size={15} /> Articles</h3>
      {error && !canPublish ? <Problem text={error} onRetry={reload} /> : null}
      {!articles ? <p className="field-hint">Loading…</p> : articles.length === 0 ? <p className="empty-note">No articles for this tournament yet.</p>
        : <ul className="tp-list">{articles.map(article => { const state = articleState(article); return <li key={article.id} className="result-row">
          <div><strong>{article.title}</strong><span>{NEWS_CONTENT_LABELS[article.content_type as NewsContentType] ?? article.content_type}{state === 'scheduled' ? ` · goes public ${maldivesTime(article.published_at)}` : article.published_at ? ` · ${maldivesTime(article.published_at, false)}` : ''}</span></div>
          <div className="button-row"><Pill tone={state === 'published' ? 'ok' : state === 'scheduled' ? 'info' : 'neutral'}>{state === 'published' ? 'Public' : state === 'scheduled' ? 'Scheduled' : state === 'archived' ? 'Archived' : 'Draft'}</Pill>
            {canPublish && <><button type="button" className="ghost-button" onClick={() => edit(article)}>Edit</button>
              {state !== 'published' && <button type="button" className="ghost-button" onClick={() => void status(article, 'published')}>Publish now</button>}
              {state === 'published' && <><a className="ghost-button" href={`#news/${encodeURIComponent(article.slug)}`} target="_blank" rel="noreferrer">View</a><button type="button" className="ghost-button" onClick={() => void status(article, 'draft')}>Unpublish</button></>}
              {state !== 'archived' && <button type="button" className="ghost-button" onClick={() => void status(article, 'archived')}>Archive</button>}</>}</div>
        </li> })}</ul>}
    </section>
  </div>
}

// ---------------------------------------------------------------------------------------------------
// Page 39: completion and archive
// ---------------------------------------------------------------------------------------------------
export function CompletionPage({ client, tournament, entries, matches, awards, canManage, reloadKey, onNotice, onChanged, onOpenTab, children }: {
  client: SupabaseClient; tournament: OrganizerTournament; entries: TournamentEntry[]; matches: TournamentMatch[]; awards: Array<{ kind: string; label: string; recipient: string }>
  canManage: boolean; reloadKey: number; onNotice: (message: string) => void; onChanged: () => void; onOpenTab: (tab: OrganizerTab) => void; children: ReactNode
}) {
  const [checks, setChecks] = useState<CompletionCheck[] | null>(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<'completed' | 'archived' | null>(null)
  const reload = useCallback(() => { void loadCompletionChecks(client, tournament.id).then(result => { setChecks(result.data); setError(result.error ?? '') }) }, [client, tournament.id])
  useEffect(() => { reload() }, [reload, reloadKey])
  const blocked = checks ? completionBlocked(checks) : true
  const change = async (status: 'completed' | 'archived') => {
    const result = await setTournamentStatus(client, tournament.id, status)
    setConfirming(null)
    if (result.error) return setError(/completion_blocked|archive_requires/.test(result.error) ? 'The server refused: a completion check is not met. Refresh the checks below.' : result.error)
    onNotice(status === 'completed' ? 'Tournament completed. Results and history are now final.' : 'Tournament archived. Everything stays available as history.'); onChanged(); reload()
  }
  const approved = entries.filter(entry => entry.application_status === 'approved')
  const confirmedMatches = matches.filter(match => match.status === 'confirmed').length
  const FIX_TAB: Record<string, OrganizerTab> = { fixtures: 'fixtures', results: 'matches', conflicts: 'matches', standings: 'standings', bracket: 'draw', champion: 'completion', runner_up: 'completion', third_place: 'completion', corrections: 'teams', incidents: 'staff', statistics: 'standings' }
  return <div className="tab-panel">
    <p className="field-hint">Completing locks results as the final record. Archiving keeps the tournament, its results, standings, rosters and awards as permanent history; nothing is deleted.</p>
    <section className="panel-block" aria-label="Completion checks"><h3><CheckCircle2 size={15} /> Completion checks</h3>
      {error ? <Problem text={error} onRetry={reload} /> : !checks ? <p className="field-hint">Checking…</p>
        : <ul className="tp-checks">{checks.map(check => <li key={check.key} className={check.ok ? 'ok' : check.blocking ? 'block' : 'warn'}>
          {check.ok ? <CircleCheck size={16} aria-hidden="true" /> : check.blocking ? <CircleX size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
          <span><strong>{check.label}</strong><small>{check.ok ? 'Done' : check.blocking ? 'Required' : 'Recommended'} · {check.detail}</small></span>
          {!check.ok && FIX_TAB[check.key] && FIX_TAB[check.key] !== 'completion' ? <button type="button" className="ghost-button" onClick={() => onOpenTab(FIX_TAB[check.key])}>Fix</button> : null}
        </li>)}</ul>}
      <button type="button" className="ghost-button" onClick={reload}><RefreshCw size={13} /> Check again</button>
      {canManage && <div className="button-row wrap">
        {tournament.status === 'in_progress' && (confirming === 'completed'
          ? <span className="confirm-group"><span>Complete this tournament? Results become final.</span><button type="button" className="primary-button" onClick={() => void change('completed')}>Complete</button><button type="button" className="outline-button dark" onClick={() => setConfirming(null)}>Cancel</button></span>
          : <button type="button" className="primary-button" disabled={blocked} onClick={() => setConfirming('completed')}><Trophy size={14} /> Complete tournament</button>)}
        {['completed', 'cancelled'].includes(tournament.status) && (confirming === 'archived'
          ? <span className="confirm-group"><span>Archive this tournament? It moves to history; nothing is deleted.</span><button type="button" className="primary-button" onClick={() => void change('archived')}>Archive</button><button type="button" className="outline-button dark" onClick={() => setConfirming(null)}>Cancel</button></span>
          : <button type="button" className="outline-button dark" onClick={() => setConfirming('archived')}><Archive size={14} /> Archive tournament</button>)}
        {tournament.status === 'archived' && <Pill tone="neutral">Archived</Pill>}
        {blocked && tournament.status === 'in_progress' && <span className="field-hint">Complete the required checks first.</span>}
      </div>}
    </section>
    <section className="panel-block" aria-label="Archive record"><h3><Archive size={15} /> What the archive keeps</h3>
      <dl className="tp-dl">
        <div><dt>Champion and awards</dt><dd>{awards.length ? awards.map(award => `${award.label}: ${award.recipient}`).join(' · ') : 'None recorded yet'}</dd></div>
        <div><dt>Results</dt><dd>{confirmedMatches} official result(s) of {matches.length} fixture(s)</dd></div>
        <div><dt>Participating teams</dt><dd>{approved.length ? approved.map(entry => entry.team_name ?? 'Team').join(', ') : 'None'}</dd></div>
        <div><dt>Rosters</dt><dd>{approved.filter(entry => ['approved', 'locked'].includes(entry.roster_status)).length} approved or locked roster(s)</dd></div>
        <div><dt>Documents</dt><dd>Kept private under the same access rules; never made public by archiving.</dd></div>
        <div><dt>Player and team history</dt><dd>Appearances, statistics and milestones stay on each player’s and team’s permanent history.</dd></div>
      </dl>
    </section>
    {children}
  </div>
}

// More → Reports & history: downloads of this tournament's own records and its full
// audit trail. Everything is read with the organizer's client, so it holds only what
// this account may see; nothing private is added to a download.
export function ReportsPage({ client, tournament, entries, matches, scores, reloadKey }: { client: SupabaseClient; tournament: OrganizerTournament; entries: TournamentEntry[]; matches: TournamentMatch[]; scores: Map<string, { homeScore: number; awayScore: number }>; reloadKey: number }) {
  const confirmed = matches.filter(match => match.status === 'confirmed')
  const resultsCsv = () => toCsv(['Date (Maldives time)', 'Home', 'Home score', 'Away score', 'Away', 'Venue'], confirmed.map(match => { const score = scores.get(match.id); return [maldivesTime(match.scheduled_at), match.home_team_name ?? 'Team', score ? score.homeScore : 'Not recorded', score ? score.awayScore : 'Not recorded', match.away_team_name ?? 'Team', match.venue ?? ''] }))
  const name = tournament.slug || 'tournament'
  return <div className="tab-panel">
    <section className="panel-block" aria-label="Downloads"><h3><FileText size={15} /> Reports</h3>
      <p className="field-hint">Spreadsheet files (CSV) of this tournament's records. Private documents, ID numbers and payment proofs are never included.</p>
      <div className="button-row wrap">
        <button type="button" className="outline-button dark" disabled={entries.length === 0} onClick={() => csvDownload(applicationsCsv(entries, { application: applicationStatusLabel, roster: rosterStatusLabel, payment: paymentStatusLabel }), `${name}-teams`)}><Download size={14} /> Teams and applications</button>
        <button type="button" className="outline-button dark" disabled={matches.length === 0} onClick={() => csvDownload(fixturesCsv(matches, matchStatusLabel), `${name}-schedule`)}><Download size={14} /> Schedule</button>
        <button type="button" className="outline-button dark" disabled={confirmed.length === 0} onClick={() => csvDownload(resultsCsv(), `${name}-results`)}><Download size={14} /> Confirmed results</button>
        <PrintButton />
      </div>
      <ReportSheets client={client} tournament={tournament} entries={entries} matches={matches} scores={scores} />
    </section>
    <section className="panel-block" aria-label="Audit history"><h3><History size={15} /> Audit history</h3>
      <TournamentTimeline client={client} tournamentId={tournament.id} title="Every recorded change" limit={60} reloadKey={reloadKey} />
    </section>
  </div>
}
