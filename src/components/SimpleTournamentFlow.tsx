import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { tr } from '../lib/i18n'
import type { FormEvent, ReactNode } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, CircleCheck, Copy, CopyCheck, Flag, Link2, Loader2, MapPin, Pause, Play,
  MoreHorizontal, Plus, Search, Share2, Trophy, Undo2, UserPlus, Users,
} from 'lucide-react'
import {
  addOrganizerEntry, applicationStatusLabel, loadLatestRosterSubmission, paymentStatusLabel, publishTournament, reviewRosterSubmission, rosterStatusLabel, setEntryRosterStatus, sanitizeSearchTerm, searchExistingTeams, setTournamentStatus,
  type OrganizerTab, type OrganizerTournament, type SearchableTeam, type SetupStepRecord, type TournamentEntry, type TournamentMatch,
} from '../lib/organizer'
import { createTeam } from '../lib/records'
import type { Sport } from '../lib/records'
import { confirmMatchResult, correctMatchResult, loadLineupCandidates, loadMatchLineup, recordMatchEvent, setMatchLive, setMatchPhase, submitMatchResult, type LineupCandidate } from '../lib/matchCenter'
import { correctionImpact, loadCompetitionStructure } from '../lib/advancement'
import { loadEntrySquad } from '../lib/teamHub'
import { fixtureWarnings, fromMaldivesInput, loadCompletionChecks, loadRosterChecks, loadStages, reportIncident, saveStageRules, recalculateTournament, setStagePublished, updateFixture, type CompletionCheck } from '../lib/tournamentPages'
import { saveQuickRegistration, saveSetupStep, setupStepKey, SUGGESTED_SPORT_SETTINGS } from '../lib/tournament'
import { loadLatestResultVersion } from '../lib/organizer'
import {
  autoSchedule, CARD_LABELS, careerEvents, chargesFee, type CardEntry, DEFAULT_SCHEDULE_RULES, EMPTY_SCOREBOARD, scheduleRulesProblem, type ScheduleRules, finishChecklist, flowSteps, listedEntries,
  matchWhen, nextMatch, parsePlayingTimes, parseVenues, phaseLabel, scoreboardReducer, scoreButtons,
  homeSummary, scoreTotals, simpleNextAction, simpleStatus, SIMPLE_STATUS_TONE, teamStatus, teamsConfirmBlockers, teamsLabel, teamsSections, type FlowInput, type Scoreboard,
} from '../lib/simpleFlow'
import { LineupEditor } from './LineupEditor'
import { CompetitionEngine } from './CompetitionEngine'
import { loadSuspensions, refreshSuspensions, suspendedPlayerIds } from '../lib/discipline'
import { DisciplinePanel } from './DisciplinePanel'
import { ProtestsPanel } from './ProtestsPanel'
import { useBracketConflicts } from '../lib/bracketConflicts'
import { publishTournamentArchive } from '../lib/engineStore'
import { OrganizerTeamPlayers } from './OrganizerTeamPlayers'

// ---------------------------------------------------------------------------
// Create → Teams → Schedule → Play → Finish. Each step shows only what the
// organizer needs to do now, with one primary button. Everything the full
// workspace already offers stays one click away under "More details" and the
// More menu; nothing here replaces or removes it.
// ---------------------------------------------------------------------------

type Base = { client: SupabaseClient; user: User; tournament: OrganizerTournament; entries: TournamentEntry[]; matches: TournamentMatch[]; canManage: boolean; onNotice: (message: string) => void; onChanged: () => void; onOpenTab: (tab: OrganizerTab, step?: number | null) => void }

const flowInput = (tournament: OrganizerTournament, entries: TournamentEntry[], matches: TournamentMatch[]): FlowInput => ({ status: tournament.status, isPublished: tournament.is_published, entries, matches })
const read = (key: string) => { try { return localStorage.getItem(key) } catch { return null } }
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* preference only */ } }
const stepData = (steps: SetupStepRecord[], wizardStep: number) => (steps.find(item => item.step_number === setupStepKey(wizardStep))?.data ?? {}) as Record<string, unknown>

export function FlowProgress({ tournament, entries, matches, onOpenTab }: Pick<Base, 'tournament' | 'entries' | 'matches' | 'onOpenTab'>) {
  const steps = flowSteps(flowInput(tournament, entries, matches))
  return <ol className="flow-progress" aria-label="Tournament progress">{steps.map((step, index) => <li key={step.id} className={`flow-step is-${step.state}`}>
    <button type="button" onClick={() => onOpenTab(step.tab)} aria-current={step.state === 'current' ? 'step' : undefined}>
      <span className="flow-dot" aria-hidden="true">{step.state === 'done' ? <Check size={13} /> : index + 1}</span>
      <span className="flow-label">{step.label}</span>
      <span className="sr-only">{step.state === 'done' ? ' (done)' : step.state === 'current' ? ' (now)' : ''}</span>
    </button>
  </li>)}</ol>
}

// A collapsed panel holding the full tools for this step.
export function MoreDetails({ open, onToggle, label = 'More details', children }: { open: boolean; onToggle: (open: boolean) => void; label?: string; children: ReactNode }) {
  return <details className="flow-details" open={open} onToggle={event => onToggle((event.currentTarget as HTMLDetailsElement).open)}><summary>{label}</summary>{open ? children : null}</details>
}

// --- Home -------------------------------------------------------------------------

export function SimpleHome({ client, tournament, entries, matches, awards, onOpenTab, scores, warnings, activity = [] }: Pick<Base, 'client' | 'tournament' | 'entries' | 'matches' | 'onOpenTab'> & { awards: Array<{ kind: string; label: string; recipient: string }>; onExit?: () => void; registrationOpen?: boolean; scores: Map<string, { homeScore: number; awayScore: number }>; warnings: string[]; activity?: Array<{ id: string; label: string; at: string }> }) {
  // Tournament Home is a short control centre (owner, 2026-11-03): one next
  // action, six counts, and four short lists. No forms or settings here.
  const conflicts = useBracketConflicts(client, tournament.id, matches.length + entries.length)
  const input = { ...flowInput(tournament, entries, matches), conflicts: conflicts ?? 0 }
  const action = simpleNextAction(input)
  const finished = ['completed', 'archived'].includes(tournament.status)
  const publicHref = `#tournament/${encodeURIComponent(tournament.slug)}`
  const approved = entries.filter(entry => entry.application_status === 'approved')
  const approvedKey = approved.map(entry => `${entry.id}:${entry.roster_status}`).join(',')
  const [players, setPlayers] = useState<number | null>(null)
  useEffect(() => {
    let active = true
    void Promise.all(approved.map(async entry => (await loadEntrySquad(client, entry.id)).data.length)).then(counts => { if (active) setPlayers(counts.reduce((sum, value) => sum + value, 0)) })
    return () => { active = false }
    // approvedKey captures the entries that matter for the count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, approvedKey])
  if (finished) return <FinishedSummary tournament={tournament} matches={matches} awards={awards} publicHref={publicHref} />
  const issues = warnings.length + (conflicts ?? 0)
  const upcoming = matches.filter(match => ['scheduled', 'live'].includes(match.status) && match.scheduled_at).sort((a, b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!)).slice(0, 3)
  const recent = matches.filter(match => match.status === 'confirmed').sort((a, b) => (b.scheduled_at ? Date.parse(b.scheduled_at) : 0) - (a.scheduled_at ? Date.parse(a.scheduled_at) : 0)).slice(0, 3)
  const attention = [
    ...(conflicts ? [{ text: `${conflicts} later match${conflicts === 1 ? '' : 'es'} hold a team that no longer qualifies.`, tab: 'standings' as OrganizerTab }] : []),
    ...warnings.map(text => ({ text, tab: (/payment|squad/i.test(text) ? 'teams' : 'fixtures') as OrganizerTab })),
  ].slice(0, 5)
  return <div className="flow-home">
    <section className="flow-next" aria-label="Next action">
      <p className="ed-eyebrow">{tr('workspace.nextAction', 'Next action')}</p>
      <h3>{action.label}</h3>
      <p>{action.reason}</p>
      <div className="button-row">{action.publicPage ? <a className="primary-button flow-primary" href={publicHref}>{action.label} <ArrowRight size={16} /></a> : <button type="button" className="primary-button flow-primary" onClick={() => onOpenTab(action.tab)}>{action.label} <ArrowRight size={16} /></button>}</div>
    </section>
    <div className="flow-cards flow-cards-6">{homeSummary(entries, matches, { players, issues }).map(card => <button type="button" key={card.key} className={`flow-card${card.warn ? ' tone-warn' : ''}`} onClick={() => onOpenTab(card.tab)}><span>{card.label}</span><strong>{card.value}</strong></button>)}</div>
    <div className="flow-home-grid">
      <section className="flow-panel"><header><h4>Next matches</h4><button type="button" className="ghost-button" onClick={() => onOpenTab('matches')}>All matches</button></header>
        {upcoming.length ? <ul className="flow-mini-list">{upcoming.map(match => <li key={match.id}><strong>{teamsLabel(match)}</strong><small>{match.status === 'live' ? 'Live now' : matchWhen(match.scheduled_at!)}{match.venue ? ` · ${match.venue}` : ''}</small></li>)}</ul> : <p className="empty-note">No match with a date yet.</p>}
      </section>
      <section className="flow-panel"><header><h4>Latest results</h4><button type="button" className="ghost-button" onClick={() => onOpenTab('matches')}>Results</button></header>
        {recent.length ? <ul className="flow-mini-list">{recent.map(match => { const score = scores.get(match.id); return <li key={match.id}><strong>{match.home_team_name ?? 'Team'} {score ? `${score.homeScore} – ${score.awayScore}` : 'vs'} {match.away_team_name ?? 'Team'}</strong><small>{score ? 'Official' : 'Score not recorded'}</small></li> })}</ul> : <p className="empty-note">No official results yet.</p>}
      </section>
      <section className="flow-panel"><header><h4>{tr('workspace.needsAttention', 'Needs attention')}</h4></header>
        {attention.length ? <ul className="flow-attention">{attention.map(item => <li key={item.text}><button type="button" onClick={() => onOpenTab(item.tab)}><span>{item.text}</span><ArrowRight size={14} /></button></li>)}</ul> : <p className="empty-note">Nothing needs fixing.</p>}
      </section>
      <section className="flow-panel"><header><h4>Latest activity</h4><button type="button" className="ghost-button" onClick={() => onOpenTab('reports')}>History</button></header>
        {activity.length ? <ul className="flow-mini-list">{activity.slice(0, 5).map(item => <li key={item.id}><strong>{item.label}</strong><small>{new Date(item.at).toLocaleString('en-GB', { timeZone: 'Indian/Maldives', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></li>)}</ul> : <p className="empty-note">Changes appear here as you work.</p>}
      </section>
    </div>
  </div>
}

function FinishedSummary({ tournament, matches, awards, publicHref }: { tournament: OrganizerTournament; matches: TournamentMatch[]; awards: Array<{ kind: string; label: string; recipient: string }>; publicHref: string }) {
  const champion = awards.find(award => award.kind.replace(/^award_/, '') === 'champion')
  const runnerUp = awards.find(award => award.kind.replace(/^award_/, '') === 'runner_up')
  const others = awards.filter(award => award !== champion && award !== runnerUp)
  const confirmed = matches.filter(match => match.status === 'confirmed').length
  return <div className="flow-finished">
    <section className="flow-next tone-ok"><p className="ed-eyebrow">Finished</p><h3><Trophy size={20} /> {tournament.name}</h3><p>This tournament is a permanent record. Corrections go through an audited request.</p>
      <dl className="flow-podium"><div><dt>Champion</dt><dd>{champion?.recipient ?? 'Not recorded'}</dd></div><div><dt>Runner-up</dt><dd>{runnerUp?.recipient ?? 'Not recorded'}</dd></div><div><dt>Results</dt><dd>{confirmed} confirmed</dd></div></dl>
      {others.length > 0 && <ul className="plain-list">{others.map(award => <li key={`${award.kind}-${award.recipient}`}><strong>{award.label}:</strong> {award.recipient}</li>)}</ul>}
      <div className="button-row wrap">{([['standings', 'Final standings'], ['bracket', 'Bracket'], ['teams', 'Teams'], ['results', 'Results'], ['statistics', 'Player statistics']] as const).map(([part, label]) => <a key={part} className="outline-button dark" href={`${publicHref}?tab=${part}`}>{label}</a>)}<a className="primary-button" href={publicHref}>Open the archive</a></div>
    </section>
  </div>
}

// --- Teams --------------------------------------------------------------------------

export function SimpleTeams({ client, user, tournament, entries, matches, steps, canManage, onNotice, onChanged, onOpenTab }: Base & { steps: SetupStepRecord[] }) {
  // Teams and players (owner, 2026-11-03): confirmed count, two big actions,
  // team cards with one plain status, and a Manage Team panel for the details.
  const [mode, setMode] = useState<'link' | 'manual' | null>(() => tournament.status === 'registration_open' ? 'link' : null)
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const listed = listedEntries(entries)
  const entryKey = listed.map(entry => `${entry.id}:${entry.roster_status}`).join(',')
  useEffect(() => {
    let active = true
    void Promise.all(listed.map(async entry => [entry.id, (await loadEntrySquad(client, entry.id)).data.length] as const)).then(pairs => { if (active) setCounts(new Map(pairs)) })
    return () => { active = false }
    // entryKey captures the entries that matter for the counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, entryKey, openEntry])
  const rosterStep = stepData(steps, 5)
  const minimum = Number(rosterStep.rosterMin) > 0 ? Number(rosterStep.rosterMin) : SUGGESTED_SPORT_SETTINGS[tournament.sport as Sport]?.rosterMin ?? 1
  const fee = chargesFee(entries)
  const approved = entries.filter(entry => entry.application_status === 'approved')
  const teamsLocked = flowSteps(flowInput(tournament, entries, matches)).find(step => step.id === 'teams')?.state === 'done'
  const [eligibility, setEligibility] = useState<Map<string, string[]> | null>(null)
  const rosterMax = Number(rosterStep.rosterMax) > 0 ? Number(rosterStep.rosterMax) : null
  useEffect(() => {
    let active = true
    void loadRosterChecks(client, approved, { min: minimum, max: rosterMax }).then(result => { if (active) setEligibility(result.error ? null : new Map(result.data.map(check => [check.entryId, check.problems]))) })
    return () => { active = false }
    // entryKey captures the entries that matter for the checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, entryKey, minimum, rosterMax])
  const totalPlayers = listed.every(entry => counts.has(entry.id)) ? listed.reduce((sum, entry) => sum + (counts.get(entry.id) ?? 0), 0) : null
  const sections = teamsSections({ status: tournament.status, entries, players: totalPlayers, eligibilityProblems: eligibility, fee })
  const blockers = teamsConfirmBlockers(entries, eligibility ?? new Map())

  const confirmTeams = async () => {
    setBusy(true); setError('')
    if (['draft', 'setup', 'registration_open'].includes(tournament.status)) {
      const result = await setTournamentStatus(client, tournament.id, 'registration_closed')
      if (result.error) { setBusy(false); setConfirming(false); return setError('The teams could not be confirmed. Please try again.') }
    }
    setBusy(false); setConfirming(false)
    onNotice(`${approved.length} teams confirmed. Next: the schedule.`)
    onChanged(); onOpenTab('fixtures')
  }
  const added = (entryId: string | null) => { if (entryId) setOpenEntry(entryId); setMode(null) }

  return <div className="flow-step-panel">
    <header className="flow-step-head"><p className="ed-eyebrow">Step 2 of 5</p><h3>{approved.length} confirmed team{approved.length === 1 ? '' : 's'}</h3>
      <p className="field-hint">{approved.length < 2 ? 'At least 2 are required to create a schedule.' : teamsLocked ? 'Teams are confirmed. You can still add players and fix details.' : 'When every team is ready, confirm the teams.'}</p></header>
    {canManage && !teamsLocked && <div className="flow-choices" role="group" aria-label="How will teams join?">
      <button type="button" className={`flow-choice${mode === 'link' ? ' active' : ''}`} aria-pressed={mode === 'link'} onClick={() => setMode(mode === 'link' ? null : 'link')}><Link2 size={20} /><strong>Share Registration Link</strong><span>Teams apply themselves. You approve them.</span></button>
      <button type="button" className={`flow-choice${mode === 'manual' ? ' active' : ''}`} aria-pressed={mode === 'manual'} onClick={() => setMode(mode === 'manual' ? null : 'manual')}><UserPlus size={20} /><strong>Add Team</strong><span>Search for a team, or create it, and add it now.</span></button>
    </div>}
    {canManage && mode === 'link' && <RegistrationLink client={client} user={user} tournament={tournament} steps={steps} onNotice={onNotice} onChanged={onChanged} onOpenTab={onOpenTab} />}
    {canManage && mode === 'manual' && <AddTeamMyself client={client} user={user} tournament={tournament} entries={entries} onNotice={onNotice} onChanged={onChanged} onAdded={added} />}

    <details className="flow-create-more flow-glance"><summary>At a glance</summary>
      <ul className="flow-sections" aria-label="Teams at a glance">{sections.map(section => <li key={section.id}><button type="button" className={`flow-section tone-${section.tone}`} onClick={() => section.id === 'registration' ? setMode('link') : onOpenTab(section.tab)}><small>{section.label}</small><strong>{section.value}</strong></button></li>)}</ul>
    </details>

    {listed.length === 0 ? <p className="empty-note">No teams yet. {canManage ? 'Share the registration link or add a team.' : ''}</p>
      : <ul className="team-cards">{listed.map(entry => {
        const problems = eligibility?.get(entry.id) ?? []
        const status = teamStatus(entry, problems)
        const players = counts.has(entry.id) ? counts.get(entry.id)! : null
        const open = openEntry === entry.id
        return <li key={entry.id} className={`team-card${open ? ' is-open' : ''}`}>
          <div className="team-card-main">
            <span className="team-card-crest" aria-hidden="true">{(entry.team_name ?? 'T').split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase()}</span>
            <div className="team-card-text">
              <strong>{entry.team_name ?? 'Team'}</strong>
              <span>{applicationStatusLabel(entry.application_status)} · {players === null ? '… players' : `${players}/${minimum} players`}{fee ? ` · ${paymentStatusLabel(entry.payment_status)}` : ''}{problems.length ? ` · ${problems.length} eligibility issue${problems.length === 1 ? '' : 's'}` : ''}</span>
            </div>
            <span className={`status-pill status-${SIMPLE_STATUS_TONE[status]}`}>{status}</span>
            {canManage && <button type="button" className="outline-button dark" aria-expanded={open} onClick={() => setOpenEntry(open ? null : entry.id)}>{open ? 'Close' : 'Manage Team'}</button>}
          </div>
          {canManage && open && <ManageTeam client={client} user={user} tournament={tournament} entry={entry} problems={problems} minimum={minimum} players={players} onNotice={onNotice} onChanged={onChanged} onOpenTab={onOpenTab} />}
        </li>
      })}</ul>}

    {error && <p className="form-error" role="alert">{error}</p>}
    {canManage && !teamsLocked && blockers.length > 0 && <div className="flow-warnings" role="status"><strong>Before you confirm the teams</strong><ul>{blockers.map(item => <li key={item}>{item}</li>)}</ul></div>}
    {canManage && !teamsLocked && <div className="flow-primary-row flow-sticky">
      {confirming && blockers.length === 0 ? <span className="confirm-group"><span>Confirm {approved.length} teams and close registration? Only confirmed teams enter the draw.</span><button type="button" className="primary-button" disabled={busy} onClick={() => void confirmTeams()}>{busy ? 'Confirming…' : 'Yes, confirm'}</button><button type="button" className="outline-button dark" onClick={() => setConfirming(false)}>Cancel</button></span>
        : <button type="button" className="primary-button flow-primary" disabled={approved.length < 2 || blockers.length > 0} onClick={() => setConfirming(true)}>Confirm Teams and Continue <ArrowRight size={16} /></button>}
    </div>}
  </div>
}

// One team's details: the exact statuses and problems, its players (search
// first, then quick create), and the roster decisions.
function ManageTeam({ client, user, tournament, entry, problems, minimum, players, onNotice, onChanged, onOpenTab }: { client: SupabaseClient; user: User; tournament: OrganizerTournament; entry: TournamentEntry; problems: string[]; minimum: number; players: number | null; onNotice: (message: string) => void; onChanged: () => void; onOpenTab: (tab: OrganizerTab, step?: number | null) => void }) {
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const decide = async (decision: 'approved' | 'changes_requested' | 'rejected' | 'locked') => {
    if ((decision === 'changes_requested' || decision === 'rejected') && note.trim().length < 5) return setError('Write what needs to change (at least five characters).')
    setBusy(decision); setError('')
    const latest = await loadLatestRosterSubmission(client, entry.id)
    if (latest.error || !latest.data) { setBusy(''); return setError('This team has not submitted a squad list yet. Add players first.') }
    const result = await reviewRosterSubmission(client, latest.data.id, decision, note, user.id)
    const synced = result.error ? result : await setEntryRosterStatus(client, entry.id, decision)
    setBusy('')
    if (synced.error) return setError('The decision could not be saved. Please try again.')
    setNote('')
    onNotice(decision === 'approved' ? 'Squad list approved.' : decision === 'locked' ? 'Squad list locked.' : decision === 'rejected' ? 'Squad list rejected.' : 'Correction requested from the team.')
    onChanged()
  }
  const waiting = ['submitted', 'under_review'].includes(entry.roster_status)
  return <div className="team-manage">
    <dl className="team-manage-facts">
      <div><dt>Application</dt><dd>{applicationStatusLabel(entry.application_status)}</dd></div>
      <div><dt>Squad list</dt><dd>{rosterStatusLabel(entry.roster_status)}</dd></div>
      <div><dt>Players</dt><dd>{players === null ? '…' : `${players} of at least ${minimum}`}</dd></div>
      <div><dt>Payment</dt><dd>{paymentStatusLabel(entry.payment_status)}</dd></div>
    </dl>
    {entry.application_status !== 'approved' && <p className="tp-warn">This application needs a decision. <button type="button" className="ghost-button" onClick={() => onOpenTab('applications')}>Review application</button></p>}
    {problems.length > 0 && <ul className="flow-warnings">{problems.map(item => <li key={item}>{item}</li>)}</ul>}
    <OrganizerTeamPlayers client={client} userId={user.id} entryId={entry.id} tournamentId={tournament.id} teamName={entry.team_name ?? 'this team'} locked={entry.roster_status === 'locked'} onNotice={onNotice} onChanged={onChanged} />
    {entry.application_status === 'approved' && entry.roster_status !== 'locked' && <div className="team-manage-decide">
      <label>Note for the team (needed to request a correction or reject)<input value={note} onChange={event => setNote(event.target.value)} maxLength={300} /></label>
      <div className="button-row">
        <button type="button" className="primary-button" disabled={Boolean(busy) || !waiting && entry.roster_status !== 'changes_requested'} onClick={() => void decide('approved')}>{busy === 'approved' ? 'Saving…' : 'Approve Roster'}</button>
        <button type="button" className="outline-button dark" disabled={Boolean(busy) || entry.roster_status !== 'approved'} onClick={() => void decide('locked')}>{busy === 'locked' ? 'Saving…' : 'Lock Roster'}</button>
        <button type="button" className="ghost-button" disabled={Boolean(busy)} onClick={() => void decide('changes_requested')}>Request Correction</button>
        <button type="button" className="ghost-button" disabled={Boolean(busy)} onClick={() => void decide('rejected')}>Reject</button>
      </div>
      {!waiting && entry.roster_status !== 'approved' && <p className="field-hint">Add the players, then approve the squad list. A squad list submitted by the team appears here for review.</p>}
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>
}

function RegistrationLink({ client, user, tournament, steps, onNotice, onChanged, onOpenTab }: { client: SupabaseClient; user: User; tournament: OrganizerTournament; steps: SetupStepRecord[]; onNotice: (message: string) => void; onChanged: () => void; onOpenTab: (tab: OrganizerTab, step?: number | null) => void }) {
  const saved = stepData(steps, 3)
  const [closesAt, setClosesAt] = useState(String(saved.closesAt ?? '').slice(0, 16))
  const [maxTeams, setMaxTeams] = useState(saved.maxApplications ? String(saved.maxApplications) : '')
  const [feeMvr, setFeeMvr] = useState('')
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState(false)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState('')
  const url = `${window.location.origin}${window.location.pathname}#register/${encodeURIComponent(tournament.slug)}`
  const open = tournament.is_published && tournament.status === 'registration_open'
  const openRegistration = async () => {
    if (!closesAt) return setError('Choose when registration closes.')
    const closes = fromMaldivesInput(closesAt)
    if (!closes || Date.parse(closes) <= Date.now()) return setError('The closing date must be in the future.')
    if (maxTeams && !(Number(maxTeams) >= 2)) return setError('Maximum teams must be 2 or more, or left empty.')
    if (feeMvr && !(Number(feeMvr) >= 0)) return setError('The fee must be a number of rufiyaa, or left empty.')
    setBusy('open'); setError('')
    const settings = await saveQuickRegistration(client, tournament.id, user.id, { closesAt: closes, maxApplications: maxTeams ? Number(maxTeams) : null, feeMvr: feeMvr ? Number(feeMvr) : null, current: saved })
    if (settings.error) { setBusy(''); return setError(settings.error) }
    const result = await publishTournament(client, tournament.id, true)
    setBusy('')
    if (result.error) return setError('Registration could not be opened. Please try again.')
    onNotice('Registration is open. Share the link with the teams.'); onChanged()
  }
  const close = async () => {
    setBusy('close'); setError('')
    const result = await setTournamentStatus(client, tournament.id, 'registration_closed')
    setBusy(''); setClosing(false)
    if (result.error) return setError('Registration could not be closed. Please try again.')
    onNotice('Registration is closed. Approved teams stay in the tournament.'); onChanged()
  }
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true) } catch { setCopied(false) } }
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`Register your team for ${tournament.name}: ${url}`)}`
  if (!open) return <section className="flow-question" aria-label="Registration">
    <h4>Open registration</h4>
    <div className="flow-create-grid">
      <label>Registration closes<input type="datetime-local" value={closesAt} onChange={event => setClosesAt(event.target.value)} /><small className="field-hint">Maldives time.</small></label>
      <label>Maximum teams (optional)<input type="number" min={2} value={maxTeams} onChange={event => setMaxTeams(event.target.value)} /></label>
      <label>Registration fee in MVR (optional)<input type="number" min={0} step="0.01" value={feeMvr} onChange={event => setFeeMvr(event.target.value)} /></label>
    </div>
    <p className="field-hint">Opening registration makes the tournament page public so teams can apply. <button type="button" className="ghost-button" onClick={() => onOpenTab('setup', 4)}>Customize Form</button></p>
    <div className="flow-primary-row"><button type="button" className="primary-button flow-primary" disabled={busy === 'open'} onClick={() => void openRegistration()}>{busy === 'open' ? 'Opening…' : <><Link2 size={15} /> Open Registration</>}</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
  return <section className="flow-question" aria-label="Registration link">
    <h4>Registration is open</h4>
    <div className="flow-inline flow-link"><input readOnly value={url} aria-label="Registration link" onFocus={event => event.currentTarget.select()} /></div>
    <div className="button-row">
      <button type="button" className="primary-button" onClick={() => void copy()}>{copied ? <><CopyCheck size={14} /> Copied</> : <><Copy size={14} /> Copy Link</>}</button>
      <a className="outline-button dark" href={whatsapp} target="_blank" rel="noreferrer"><Share2 size={14} /> Share via WhatsApp</a>
      <a className="outline-button dark" href={url} target="_blank" rel="noreferrer">Preview Form</a>
      {closing ? <span className="confirm-group"><span>Close registration? Teams can no longer apply.</span><button type="button" className="primary-button" disabled={busy === 'close'} onClick={() => void close()}>{busy === 'close' ? 'Closing…' : 'Yes, close'}</button><button type="button" className="outline-button dark" onClick={() => setClosing(false)}>Cancel</button></span>
        : <button type="button" className="ghost-button" onClick={() => setClosing(true)}>Close Registration</button>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}

const TEAM_TYPES: Array<{ value: string; label: string }> = [{ value: 'club', label: 'Club' }, { value: 'island', label: 'Island team' }, { value: 'school', label: 'School' }, { value: 'national', label: 'National team' }, { value: 'other', label: 'Other' }]

function AddTeamMyself({ client, user, tournament, entries, onNotice, onChanged, onAdded }: { client: SupabaseClient; user: User; tournament: OrganizerTournament; entries: TournamentEntry[]; onNotice: (message: string) => void; onChanged: () => void; onAdded: (entryId: string | null) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchableTeam[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', type: 'club', island: '' })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const entered = new Set(entries.map(entry => entry.team_id))
  const search = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setCreating(false)
    if (sanitizeSearchTerm(query).length < 2) return setError('Type at least two letters of the team name.')
    setBusy('search'); const result = await searchExistingTeams(client, query); setBusy('')
    setResults(result.data ?? []); if (result.error) setError('Teams could not be searched. Please try again.')
  }
  const entryFor = async (teamId: string) => { const rows = await client.from('tournament_entries').select('id').eq('tournament_id', tournament.id).eq('team_id', teamId).maybeSingle(); return rows.data?.id ? String(rows.data.id) : null }
  const add = async (teamId: string, name: string) => {
    setBusy(teamId); setError('')
    const result = await addOrganizerEntry(client, tournament.id, teamId, user.id)
    if (result.error) { setBusy(''); return setError(`${name} could not be added. Please try again.`) }
    const entryId = await entryFor(teamId)
    setBusy('')
    onNotice(`${name} added. Now add its players.`); onChanged(); onAdded(entryId)
  }
  const create = async (event: FormEvent) => {
    event.preventDefault()
    const name = draft.name.trim()
    if (name.length < 2) return setError('Enter the team name.')
    if (!draft.island.trim()) return setError('Enter the team’s island.')
    setBusy('create'); setError('')
    const created = await createTeam(client, user.id, name, draft.island.trim(), draft.type)
    if (created.error || !created.data) { setBusy(''); return setError('The team could not be created. Please try again.') }
    const entry = await addOrganizerEntry(client, tournament.id, created.data.id, user.id)
    if (entry.error) { setBusy(''); return setError('The team was created but not added. Search for it and add it.') }
    const entryId = await entryFor(created.data.id)
    setBusy('')
    setQuery(''); setResults(null); setCreating(false); setDraft({ name: '', type: 'club', island: '' })
    onNotice(`${name} created and added. Now add its players.`); onChanged(); onAdded(entryId)
  }
  return <section className="flow-question" aria-label="Add Team">
    <h4>Add Team</h4>
    <form className="search-bar" onSubmit={search}><Search size={15} /><input value={query} onChange={event => { setQuery(event.target.value); setResults(null) }} placeholder="Search team name" aria-label="Search team name" /><button type="submit" className="outline-button dark" disabled={busy === 'search'}>{busy === 'search' ? 'Searching…' : 'Search'}</button></form>
    {results && <ul className="ws-rows team-search-results">
      {results.filter(team => !entered.has(team.id)).map(team => <li key={team.id} className="result-row"><span className="team-card-crest" aria-hidden="true">{team.name.split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase()}</span><div><strong>{team.name}</strong><span>{team.island ?? 'Island not recorded'}</span></div><button type="button" className="primary-button" disabled={busy === team.id} onClick={() => void add(team.id, team.name)}><Plus size={14} /> Add to Tournament</button></li>)}
      {results.filter(team => !entered.has(team.id)).length === 0 && <li className="empty-note">No team found with that name.</li>}
    </ul>}
    {results && !creating && <button type="button" className="outline-button dark" onClick={() => { setCreating(true); setDraft({ ...draft, name: query.trim() }) }}><Plus size={14} /> Create New Team</button>}
    {creating && <form className="flow-create-grid team-create" onSubmit={create}>
      <label>Team name<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} maxLength={80} /></label>
      <label>Team type<select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value })}>{TEAM_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label>Island<input value={draft.island} onChange={event => setDraft({ ...draft, island: event.target.value })} maxLength={80} placeholder="e.g. Malé" /></label>
      <p className="field-hint flow-create-wide">Logo, colours and manager details can be added later from the team’s page.</p>
      <div className="button-row flow-create-wide"><button type="submit" className="primary-button" disabled={busy === 'create'}>{busy === 'create' ? 'Creating…' : 'Create and Add Team'}</button><button type="button" className="ghost-button" onClick={() => setCreating(false)}>Cancel</button></div>
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}

// --- Schedule -------------------------------------------------------------------------

export function SimpleSchedule({ client, user, tournament, entries, matches, steps, categories, canManage, onNotice, onChanged, onOpenTab, onMakeChanges }: Base & { steps: SetupStepRecord[]; categories: Array<{ id: string; name: string }>; onMakeChanges: () => void }) {
  const approved = entries.filter(entry => entry.application_status === 'approved')
  const venueStep = stepData(steps, 8)
  const knownVenues = [...new Set([String(venueStep.venue ?? '').trim(), ...matches.map(match => match.venue ?? '')].filter(Boolean))]
  const [startDate, setStartDate] = useState(String(venueStep.startsAt ?? '').slice(0, 10))
  const [venues, setVenues] = useState(knownVenues.join(', '))
  const [times, setTimes] = useState(String(venueStep.playingTimes ?? '16:00, 18:00, 20:00'))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const savedRules = venueStep.scheduleRules as Partial<ScheduleRules> | undefined
  // Rest and match length come from the engine's saved schedule settings.
  const [rules] = useState<ScheduleRules>({ ...DEFAULT_SCHEDULE_RULES, ...(savedRules ?? {}) })
  const active = matches.filter(match => !['cancelled', 'abandoned'].includes(match.status))
  const unscheduled = active.filter(match => !match.scheduled_at && match.status === 'scheduled')
  const warnings = useMemo(() => fixtureWarnings(matches, rules.restHours), [matches, rules.restHours])
  const warningCount = [...warnings.values()].filter(list => list.length).length
  const published = tournament.is_published && ['in_progress', 'completed', 'archived'].includes(tournament.status)

  const scheduleMatches = async (rows: Array<{ id: string; home_team_id: string; away_team_id: string }>) => {
    const timeList = parsePlayingTimes(times); const venueList = parseVenues(venues)
    const placed = autoSchedule(rows.map(row => ({ id: row.id, homeTeamId: row.home_team_id, awayTeamId: row.away_team_id })), { startDate, times: timeList, venues: venueList, restHours: rules.restHours })
    for (const slot of placed.slots) {
      const result = await updateFixture(client, slot.id, { scheduled_at: slot.scheduledAt, venue: slot.venue })
      if (result.error) return 'Some match times could not be saved. Open Make Changes to finish them.'
    }
    return placed.unplaced.length ? `${placed.unplaced.length} match(es) did not fit. Add more playing times or venues.` : null
  }
  const validate = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return 'Choose the tournament starting date.'
    if (parseVenues(venues).length === 0) return 'Enter the venue.'
    if (parsePlayingTimes(times).length === 0) return 'Enter at least one playing time, for example 18:00.'
    return scheduleRulesProblem(rules, parsePlayingTimes(times))
  }
  // The answers are kept with the tournament's scheduling details, so the next visit starts from them.
  const remember = () => saveSetupStep(client, tournament.id, user.id, 8, 'in_progress', { ...venueStep, startsAt: startDate, venue: parseVenues(venues)[0] ?? '', venues: parseVenues(venues), playingTimes: parsePlayingTimes(times).join(', '), scheduleRules: rules }, { enforceValidation: false })

  const fill = async () => {
    const problem = validate(); if (problem) return setError(problem)
    setBusy('fill'); setError('')
    await remember()
    const note = await scheduleMatches(unscheduled)
    setBusy('')
    if (note) setError(note)
    onNotice('Match times set.'); onChanged()
  }
  const publish = async () => {
    setBusy('publish'); setError('')
    if (!tournament.is_published) { const result = await publishTournament(client, tournament.id, false); if (result.error) { setBusy(''); setPublishing(false); return setError('The schedule could not be published. Please try again.') } }
    const stages = await loadStages(client, tournament.id)
    for (const stage of stages.data.filter(item => !item.published_at && !(item.rules as Record<string, unknown>).superseded)) await setStagePublished(client, stage.id, true)
    if (!['in_progress', 'completed', 'archived'].includes(tournament.status)) await setTournamentStatus(client, tournament.id, 'in_progress')
    setBusy(''); setPublishing(false)
    onNotice('Schedule published. Teams and fans can see it now.'); onChanged(); onOpenTab('matches')
  }

  // Regenerate Draft: only before publishing and before any match is played. The old
  // draft is cancelled with a reason and kept in the fixture history, never deleted.
  const canRegenerate = !published && active.length > 0 && active.every(match => match.status === 'scheduled')
  const regenerate = async () => {
    setBusy('regenerate'); setError('')
    for (const match of active) {
      const result = await updateFixture(client, match.id, { status: 'cancelled' }, 'Draft schedule replaced before publishing')
      if (result.error) { setBusy(''); setRegenerating(false); return setError('The draft could not be replaced. Please try again.') }
    }
    const stages = await loadStages(client, tournament.id)
    for (const stage of stages.data.filter(item => !item.published_at)) await saveStageRules(client, stage.id, { ...stage.rules, superseded: true } as typeof stage.rules)
    setBusy(''); setRegenerating(false)
    onNotice('The draft schedule was set aside. Preview a new draw.'); onChanged()
  }

  const form = <div className="flow-fields">
    <label>Tournament starting date<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
    <label>Venue<input value={venues} onChange={event => setVenues(event.target.value)} placeholder="e.g. Main Court" /><small>More than one? Separate with commas.</small></label>
    <label>Available playing times<input value={times} onChange={event => setTimes(event.target.value)} placeholder="16:00, 18:00, 20:00" /><small>Maldives time. Teams get at least 20 hours of rest.</small></label>
  </div>

  return <div className="flow-step-panel">
    <header className="flow-step-head"><p className="ed-eyebrow">Step 3 of 5</p><h3>Schedule</h3></header>
    {active.length === 0 ? (approved.length < 2
      ? <div className="state-block"><Users size={22} /><h3>Teams come first</h3><p>Add and confirm at least two teams, then the schedule is made for you.</p><button type="button" className="primary-button" onClick={() => onOpenTab('teams')}>Go to Teams</button></div>
      : <CompetitionEngine client={client} user={user} tournament={tournament} entries={entries} steps={steps} categories={categories} canManage={canManage} onNotice={onNotice} onChanged={onChanged} onOpenTab={onOpenTab} />)
      : <>
        {unscheduled.length > 0 && canManage && <section className="flow-question"><h4>{unscheduled.length} match{unscheduled.length === 1 ? '' : 'es'} still need a time</h4>{form}<div className="flow-primary-row"><button type="button" className="primary-button flow-primary" disabled={busy === 'fill'} onClick={() => void fill()}>{busy === 'fill' ? 'Placing matches…' : 'Set Match Times'}</button></div></section>}
        <ScheduleCalendar matches={active} warnings={warnings} />
        {warningCount > 0 && <p className="tp-warn">{warningCount} match{warningCount === 1 ? ' has' : 'es have'} a team or venue clash. Use Make Changes to move them.</p>}
        {canManage && <div className="flow-primary-row">
          {published ? <p className="publication-notice"><CircleCheck size={15} /> The schedule is published.</p>
            : publishing ? <span className="confirm-group"><span>Publish the schedule? Teams and fans will see every match.</span><button type="button" className="primary-button" disabled={busy === 'publish'} onClick={() => void publish()}>{busy === 'publish' ? 'Publishing…' : 'Publish'}</button><button type="button" className="outline-button dark" onClick={() => setPublishing(false)}>Cancel</button></span>
              : <button type="button" className="primary-button flow-primary" disabled={unscheduled.length > 0} onClick={() => setPublishing(true)}>Publish Schedule <ArrowRight size={16} /></button>}
          <button type="button" className="outline-button dark" onClick={onMakeChanges}>Edit Fixture</button>
          {canRegenerate && (regenerating
            ? <span className="confirm-group"><span>Replace this draft? Its matches are cancelled and kept in the history, then you make a new draw.</span><button type="button" className="primary-button" disabled={busy === 'regenerate'} onClick={() => void regenerate()}>{busy === 'regenerate' ? 'Replacing…' : 'Yes, regenerate'}</button><button type="button" className="outline-button dark" onClick={() => setRegenerating(false)}>Cancel</button></span>
            : <button type="button" className="ghost-button" onClick={() => setRegenerating(true)}>Regenerate Draft</button>)}
        </div>}
        {published && canManage && <p className="field-hint">A published schedule is never replaced. Edit Fixture records the reason and tells both teams.</p>}
      </>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>
}

function ScheduleCalendar({ matches, warnings }: { matches: TournamentMatch[]; warnings: Map<string, string[]> }) {
  const days = new Map<string, TournamentMatch[]>()
  const sorted = [...matches].sort((a, b) => (a.scheduled_at ? Date.parse(a.scheduled_at) : Infinity) - (b.scheduled_at ? Date.parse(b.scheduled_at) : Infinity))
  for (const match of sorted) {
    const key = match.scheduled_at ? new Date(match.scheduled_at).toLocaleDateString('en-GB', { timeZone: 'Indian/Maldives', weekday: 'long', day: 'numeric', month: 'long' }) : 'Not scheduled yet'
    days.set(key, [...(days.get(key) ?? []), match])
  }
  return <div className="flow-calendar">{[...days.entries()].map(([day, list]) => <section key={day} className="flow-day"><h4><CalendarDays size={15} /> {day}</h4><ul>{list.map(match => <li key={match.id} className={warnings.get(match.id)?.length ? 'has-warning' : ''}>
    <time>{match.scheduled_at ? new Date(match.scheduled_at).toLocaleTimeString('en-GB', { timeZone: 'Indian/Maldives', hour: '2-digit', minute: '2-digit' }) : '—'}</time>
    <strong>{teamsLabel(match)}</strong>
    <span><MapPin size={12} /> {match.venue ?? 'Venue not set'}</span>
  </li>)}</ul></section>)}</div>
}

// --- Play ------------------------------------------------------------------------------

type MatchFilter = 'next' | 'live' | 'review' | 'completed' | 'all'
const MATCH_FILTERS: Array<{ id: MatchFilter; label: string }> = [{ id: 'next', label: 'Next' }, { id: 'live', label: 'Live' }, { id: 'review', label: 'Needs Review' }, { id: 'completed', label: 'Completed' }, { id: 'all', label: 'All' }]
const matchBucket = (match: TournamentMatch): MatchFilter => match.status === 'live' ? 'live' : match.status === 'awaiting_confirmation' ? 'review' : match.status === 'confirmed' ? 'completed' : 'next'
const MATCH_LABEL: Record<string, string> = { scheduled: 'Scheduled', live: 'Live', awaiting_confirmation: 'Needs review', confirmed: 'Official', postponed: 'Postponed', cancelled: 'Cancelled', abandoned: 'Abandoned' }

export function SimplePlay({ client, user, tournament, entries, matches, canManage, onNotice, onChanged, onOpenTab }: Base) {
  // Matches (owner, 2026-11-03): one top card with the next required action,
  // simple filters, and a focused view per match. Simple result by default;
  // full career details on request; corrections inside the match menu.
  const modeKey = `kulhivaru.recording.${tournament.id}`
  const [recording, setRecordingState] = useState<'simple' | 'career'>(() => read(modeKey) === 'career' ? 'career' : 'simple')
  const setRecording = (value: 'simple' | 'career') => { setRecordingState(value); write(modeKey, value) }
  const [filter, setFilter] = useState<MatchFilter>(() => matches.some(match => match.status === 'awaiting_confirmation') ? 'review' : matches.some(match => match.status === 'live') ? 'live' : 'next')
  const [openMatch, setOpenMatch] = useState<string | null>(null)
  const [stage, setStage] = useState<'check' | 'play' | 'correct' | null>(null)
  const next = nextMatch(matches)
  const awaiting = matches.filter(match => match.status === 'awaiting_confirmation')
  const open = matches.find(match => match.id === openMatch) ?? null
  const done = flowSteps(flowInput(tournament, entries, matches)).find(step => step.id === 'play')?.state === 'done'
  const visible = matches.filter(match => match.status !== 'cancelled' || filter === 'all').filter(match => filter === 'all' || matchBucket(match) === filter)
    .sort((a, b) => filter === 'completed' ? (b.scheduled_at ?? '').localeCompare(a.scheduled_at ?? '') : (a.scheduled_at ?? '9').localeCompare(b.scheduled_at ?? '9'))
  const openFor = (id: string, view: 'check' | 'play' | 'correct') => { setOpenMatch(id); setStage(view) }
  const close = () => { setOpenMatch(null); setStage(null) }
  if (matches.length === 0) return <div className="flow-step-panel"><div className="state-block"><CalendarDays size={22} /><h3>No matches yet</h3><p>Publish the schedule first.</p><button type="button" className="primary-button" onClick={() => onOpenTab('fixtures')}>Go to Schedule</button></div></div>

  if (open && stage && canManage) return <div className="flow-step-panel match-focus">
    <button type="button" className="ghost-button" onClick={close}><ArrowLeft size={14} /> All matches</button>
    {stage === 'check' && <PreStartCheck client={client} match={open} onStart={() => setStage('play')} onOpenTab={onOpenTab} />}
    {stage === 'play' && <>
      <label className="flow-check match-full-toggle"><input type="checkbox" checked={recording === 'career'} onChange={event => setRecording(event.target.checked ? 'career' : 'simple')} /> Record Full Match Details (lineups, scorers, cards, minutes)</label>
      <SimpleMatchCenter key={`${open.id}-${recording}`} client={client} user={user} tournamentId={tournament.id} sport={tournament.sport} match={open} recording={recording} onClose={close} onNotice={onNotice} onChanged={onChanged} />
    </>}
    {stage === 'correct' && <CorrectResult client={client} user={user} tournamentId={tournament.id} match={open} onDone={close} onNotice={onNotice} onChanged={onChanged} />}
  </div>

  return <div className="flow-step-panel">
    <header className="flow-step-head"><p className="ed-eyebrow">Step 4 of 5</p><h3>Matches</h3></header>
    {awaiting.length ? <div className="result-review-list" aria-label="Results waiting for confirmation">{awaiting.map(match => <ConfirmResultCard key={match.id} client={client} user={user} tournamentId={tournament.id} match={match} canManage={canManage} onNotice={onNotice} onChanged={onChanged} />)}</div>
      : next ? <section className="flow-next flow-match-card" aria-label="Next match">
        <p className="ed-eyebrow">{next.status === 'live' ? 'Live now' : 'Next match'}</p>
        <h3>{teamsLabel(next)}</h3>
        <p>{next.scheduled_at ? matchWhen(next.scheduled_at) : 'Time not set'}{next.venue ? ` · ${next.venue}` : ''}</p>
        {canManage && <button type="button" className="primary-button flow-primary" onClick={() => openFor(next.id, next.status === 'live' ? 'play' : 'check')}>{next.status === 'live' ? 'Enter Result' : 'Start Match'} <ArrowRight size={16} /></button>}
      </section>
        : done ? <section className="flow-next tone-ok"><h3><CircleCheck size={18} /> Every match is complete</h3><p>If the competition has another round, create it under Schedule. Otherwise, finish the tournament.</p><div className="button-row"><button type="button" className="primary-button flow-primary" onClick={() => onOpenTab('completion')}>Finish Tournament <ArrowRight size={16} /></button></div></section>
          : <p className="empty-note">No match is scheduled right now. Postponed matches need a new date under Schedule.</p>}
    <div className="match-filters" role="tablist" aria-label="Show matches">{MATCH_FILTERS.map(item => { const count = item.id === 'all' ? matches.length : matches.filter(match => matchBucket(match) === item.id && match.status !== 'cancelled').length; return <button type="button" role="tab" key={item.id} aria-selected={filter === item.id} className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>{item.label}{count ? <span>{count}</span> : null}</button> })}</div>
    {visible.length === 0 ? <p className="empty-note">No matches here.</p> : <ul className="match-cards">{visible.map(match => {
      const status = matchBucket(match)
      return <li key={match.id} className={`match-card is-${status}`}>
        <div className="match-card-text"><strong>{teamsLabel(match)}</strong><small>{match.scheduled_at ? matchWhen(match.scheduled_at) : 'Time not set'}{match.venue ? ` · ${match.venue}` : ''}</small></div>
        <span className={`status-pill status-${SIMPLE_STATUS_TONE[simpleStatus(match.status)]}`}>{MATCH_LABEL[match.status] ?? match.status}</span>
        {canManage && (match.status === 'confirmed'
          ? <details className="match-menu"><summary aria-label={`More for ${teamsLabel(match)}`}><MoreHorizontal size={16} /></summary><button type="button" onClick={() => openFor(match.id, 'correct')}>Correct Result</button></details>
          : match.status === 'awaiting_confirmation' ? <span className="field-hint">Confirm above</span>
            : ['scheduled', 'live'].includes(match.status) ? <button type="button" className="outline-button dark" onClick={() => openFor(match.id, match.status === 'live' ? 'play' : 'check')}>{match.status === 'live' ? 'Enter Result' : 'Start'}</button>
              : <button type="button" className="ghost-button" onClick={() => onOpenTab('fixtures')}>Reschedule</button>)}
      </li>
    })}</ul>}
    {['football', 'futsal', 'handball'].includes(tournament.sport) && <DisciplinePanel client={client} tournamentId={tournament.id} canManage={canManage} onNotice={onNotice} />}
    <ProtestsPanel client={client} tournamentId={tournament.id} canManage={canManage} onNotice={onNotice} matchLabel={id => { const found = matches.find(match => match.id === id); return found ? teamsLabel(found) : null }} />
  </div>
}

// Before a match starts: venue, officials and the two lineups. Lineups are
// optional in Simple Result; the full details stay one tap away.
function PreStartCheck({ client, match, onStart, onOpenTab }: { client: SupabaseClient; match: TournamentMatch; onStart: () => void; onOpenTab: (tab: OrganizerTab) => void }) {
  const [officials, setOfficials] = useState<number | null>(null)
  const [lineup, setLineup] = useState<{ home: number; away: number } | null>(null)
  useEffect(() => {
    let active = true
    void client.from('match_official_assignments').select('user_id', { count: 'exact', head: true }).eq('match_id', match.id).then(result => { if (active) setOfficials(result.error ? null : result.count ?? 0) })
    void loadMatchLineup(client, match.id).then(result => { if (active) setLineup({ home: result.data.filter(row => row.teamId === match.home_team_id).length, away: result.data.filter(row => row.teamId === match.away_team_id).length }) })
    return () => { active = false }
  }, [client, match.id, match.home_team_id, match.away_team_id])
  const items = [
    { label: 'Venue', ok: Boolean(match.venue), detail: match.venue ?? 'Not set', fix: () => onOpenTab('fixtures') },
    { label: 'Officials', ok: (officials ?? 0) > 0, detail: officials === null ? 'Checking…' : officials ? `${officials} assigned` : 'None assigned (optional)', fix: () => onOpenTab('staff') },
    { label: `${match.home_team_name ?? 'Home'} lineup`, ok: (lineup?.home ?? 0) > 0, detail: lineup === null ? 'Checking…' : lineup.home ? `${lineup.home} players` : 'Not set (optional)', fix: null },
    { label: `${match.away_team_name ?? 'Away'} lineup`, ok: (lineup?.away ?? 0) > 0, detail: lineup === null ? 'Checking…' : lineup.away ? `${lineup.away} players` : 'Not set (optional)', fix: null },
  ]
  return <section className="flow-question" aria-label="Before the match">
    <h3>{teamsLabel(match)}</h3>
    <p className="field-hint">{match.scheduled_at ? matchWhen(match.scheduled_at) : 'Time not set'}</p>
    <ul className="flow-checklist">{items.map(item => <li key={item.label} className={item.ok ? 'ok' : 'optional'}>{item.ok ? <CircleCheck size={16} /> : <span className="flow-todo" aria-hidden="true" />}<span>{item.label}</span><small>{item.detail}</small>{!item.ok && item.fix && <button type="button" className="ghost-button" onClick={item.fix}>Set</button>}</li>)}</ul>
    <p className="field-hint">Lineups can be added in Record Full Match Details after you start.</p>
    <div className="flow-primary-row flow-sticky"><button type="button" className="primary-button flow-primary" onClick={onStart}><Play size={16} /> Start Match</button></div>
  </section>
}

// Correct Result (match menu): reason, the result being replaced, the affected
// tables and any bracket effect, then an explicit confirmation.
function CorrectResult({ client, user, tournamentId, match, onDone, onNotice, onChanged }: { client: SupabaseClient; user: User; tournamentId: string; match: TournamentMatch; onDone: () => void; onNotice: (message: string) => void; onChanged: () => void }) {
  const [home, setHome] = useState(''); const [away, setAway] = useState('')
  const [shootout, setShootout] = useState({ home: '', away: '' })
  const [reason, setReason] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [structure, setStructure] = useState<Awaited<ReturnType<typeof loadCompetitionStructure>> | null>(null)
  useEffect(() => { let active = true; void loadCompetitionStructure(client, tournamentId).then(result => { if (active && !result.error) setStructure(result) }); return () => { active = false } }, [client, tournamentId])
  const draft = home !== '' && away !== '' ? { home: Number(home), away: Number(away), ...(shootout.home !== '' && shootout.away !== '' ? { homeShootout: Number(shootout.home), awayShootout: Number(shootout.away) } : {}) } : null
  const impact = structure ? correctionImpact(structure, match.id, draft ?? { home: -1, away: -1 }) : null
  const stageName = structure?.stages.find(stage => stage.id === structure.matches.find(item => item.id === match.id)?.stageId)?.name
  const submit = async () => {
    if (!draft || ![draft.home, draft.away].every(value => Number.isInteger(value) && value >= 0)) return setError('Enter both scores as whole numbers.')
    if (reason.trim().length < 5) return setError('Give a reason of at least five characters.')
    if (impact?.winnerChanges && !acknowledged) return setError(`This changes who won, and ${impact.laterRound} already exists. Tick the box first.`)
    setBusy(true); setError('')
    const result = await correctMatchResult(client, match.id, draft, reason.trim(), user.id)
    if (result.error) { setBusy(false); setConfirming(false); return setError('The correction could not be saved. Please try again.') }
    await refreshSuspensions(client, tournamentId)
    setBusy(false)
    onNotice('Result corrected. The previous version is kept, and standings, statistics and careers are recalculated.'); onChanged(); onDone()
  }
  return <section className="flow-question" aria-label="Correct result">
    <h3>Correct result: {teamsLabel(match)}</h3>
    {impact?.previous ? <p className="field-hint">Current official result: {impact.previous.home} – {impact.previous.away}. It is kept as the previous version.</p> : <p className="field-hint">Loading the current result…</p>}
    <div className="flow-score-form"><label>{match.home_team_name ?? 'Home'}<input type="number" min="0" value={home} onChange={event => setHome(event.target.value)} /></label><label>{match.away_team_name ?? 'Away'}<input type="number" min="0" value={away} onChange={event => setAway(event.target.value)} /></label></div>
    <details className="flow-create-more"><summary>Penalties (knockout matches)</summary><div className="flow-score-form"><label>{match.home_team_name ?? 'Home'}<input type="number" min="0" value={shootout.home} onChange={event => setShootout({ ...shootout, home: event.target.value })} /></label><label>{match.away_team_name ?? 'Away'}<input type="number" min="0" value={shootout.away} onChange={event => setShootout({ ...shootout, away: event.target.value })} /></label></div></details>
    <label className="flow-note">Reason (required)<input value={reason} onChange={event => setReason(event.target.value)} placeholder="e.g. Score entered against the wrong team" /></label>
    <div className="tp-warn"><strong>What this changes:</strong> {stageName ? `the ${stageName} table, ` : ''}player statistics, team history and player careers are recalculated from the corrected result.{impact?.winnerChanges && <> <strong>It also changes who won the tie.</strong> {impact.laterRound} already holds the old winner. The tournament cannot finish until you fix it under Bracket needs attention.
      <label className="flow-check"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> I understand and will fix {impact.laterRound}.</label></>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="flow-primary-row">{confirming
      ? <span className="confirm-group"><span>Save this correction? The previous result stays in the history.</span><button type="button" className="primary-button" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Yes, correct the result'}</button><button type="button" className="outline-button dark" onClick={() => setConfirming(false)}>Cancel</button></span>
      : <button type="button" className="primary-button flow-primary" onClick={() => { setError(''); setConfirming(true) }}>Correct Result</button>}</div>
  </section>
}

function ConfirmResultCard({ client, user, tournamentId, match, canManage, onNotice, onChanged }: { client: SupabaseClient; user: User; tournamentId: string; match: TournamentMatch; canManage: boolean; onNotice: (message: string) => void; onChanged: () => void }) {
  const [result, setResult] = useState<{ id: string; score: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true); setError('')
      const latest = await loadLatestResultVersion(client, match.id)
      if (!active) return
      if (latest.error) { setError(`Could not load the submitted result: ${latest.error}`); setLoading(false); return }
      if (!latest.data || latest.data.status !== 'submitted') {
        setError('There is no submitted result waiting for confirmation. Refresh the match list.')
        setLoading(false); return
      }
      const score = await client.from('match_result_versions').select('score').eq('id', latest.data.id).maybeSingle()
      if (!active) return
      if (score.error) setError(`Could not load the submitted score: ${score.error.message}`)
      const value = (score.data?.score ?? {}) as Record<string, unknown>
      setResult({ id: latest.data.id, score: typeof value.home === 'number' && typeof value.away === 'number' ? `${value.home} – ${value.away}` : '' })
      setLoading(false)
    })()
    return () => { active = false }
  }, [client, match.id])
  const confirm = async () => {
    if (!result || busy) return
    setBusy(true); setError('')
    const confirmed = await confirmMatchResult(client, result.id, user.id)
    setBusy(false)
    if (confirmed.error) return setError(`Confirmation failed: ${confirmed.error.message}`)
    const discipline = await refreshSuspensions(client, tournamentId)
    onNotice(`Result confirmed. Standings, bracket, histories and statistics have been updated.${discipline.added ? ` ${discipline.added} new suspension${discipline.added === 1 ? '' : 's'} from cards.` : ''}`); onChanged()
  }
  return <section className="flow-next tone-warn result-review-card" aria-label="Result waiting for confirmation">
    <div className="result-review-heading"><div><p className="ed-eyebrow">Needs your review</p><h3>{teamsLabel(match)}</h3></div><span className="status-pill status-review">Awaiting confirmation</span></div>
    <p className="result-review-score">{loading ? 'Loading submitted score…' : result?.score || 'Submitted result'}</p>
    {canManage ? <div className="result-review-actions"><button type="button" className="primary-button flow-primary" disabled={!result || loading || busy} onClick={() => void confirm()}>{busy ? 'Confirming…' : error ? 'Try Again' : 'Confirm Result'}</button><span className="field-hint">Confirming updates standings and tournament records.</span></div> : <p className="field-hint">An organizer confirms this result.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}

function loadBoard(matchId: string): Scoreboard {
  try { const saved = read(`kulhivaru.scoreboard.${matchId}`); return saved ? { ...EMPTY_SCOREBOARD, ...JSON.parse(saved) as Scoreboard } : EMPTY_SCOREBOARD } catch { return EMPTY_SCOREBOARD }
}

export function SimpleMatchCenter({ client, user, tournamentId, sport, match, recording, onClose, onNotice, onChanged }: { client: SupabaseClient; user: User; tournamentId: string; sport: string; match: TournamentMatch; recording: 'simple' | 'career'; onClose: () => void; onNotice: (message: string) => void; onChanged: () => void }) {
  const boardKey = `kulhivaru.scoreboard.${match.id}`
  const [board, dispatch] = useReducer(scoreboardReducer, match.id, loadBoard)
  useEffect(() => { write(boardKey, board.phase === 'not_started' && board.history.length === 0 ? null : JSON.stringify(board)) }, [board, boardKey])
  const [players, setPlayers] = useState<LineupCandidate[]>([])
  const [picking, setPicking] = useState<{ side: 'home' | 'away'; points: number; kind: 'score' | 'card' } | null>(null)
  const [scorer, setScorer] = useState(''); const [assist, setAssist] = useState(''); const [card, setCard] = useState<CardEntry['card']>('yellow_card'); const [minute, setMinute] = useState('')
  const [method, setMethod] = useState<'goal' | 'penalty' | 'own_goal'>('goal')
  // Simple Result Mode extras: how the match ended, and a note only organizers see.
  const [outcome, setOutcome] = useState<'played' | 'walkover' | 'forfeit'>('played')
  const [resultNote, setResultNote] = useState('')
  const [incident, setIncident] = useState<{ category: string; description: string } | null>(null)
  const [suspended, setSuspended] = useState<Set<string>>(new Set())
  useEffect(() => { let active = true; void loadSuspensions(client, tournamentId).then(result => { if (active) setSuspended(suspendedPlayerIds(result.data)) }); return () => { active = false } }, [client, tournamentId])
  const [final, setFinal] = useState<{ home: string; away: string } | null>(null)
  const [details, setDetails] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const career = recording === 'career'
  const goalSport = ['football', 'futsal', 'handball'].includes(sport)
  useEffect(() => { if (!career) return; let active = true; void loadLineupCandidates(client, match.id).then(result => { if (active) setPlayers(result.data) }); return () => { active = false } }, [client, match.id, career])
  const totals = scoreTotals(board)
  const names = { home: match.home_team_name ?? 'Home', away: match.away_team_name ?? 'Away' }
  const teamPlayers = (side: 'home' | 'away') => players.filter(player => player.teamId === (side === 'home' ? match.home_team_id : match.away_team_id))
  const key = () => crypto.randomUUID()

  const start = async () => {
    dispatch({ type: 'start' })
    const result = await setMatchLive(client, match.id, true)
    if (result.error) setError(result.error)
    else if (result.pending) setNote('The match is being scored here. The public “Live” label appears after the platform owner applies update 042.')
  }
  const undo = async () => {
    const last = board.history[board.history.length - 1]
    dispatch({ type: 'undo' })
    if (last?.kind === 'phase' && last.from === 'not_started') { const result = await setMatchLive(client, match.id, false); if (result.error) setError(result.error) }
  }
  const tapScore = (side: 'home' | 'away', points: number) => {
    if (career && (goalSport || sport.startsWith('basketball')) && teamPlayers(side).length > 0) { setPicking({ side, points, kind: 'score' }); setScorer(''); setAssist(''); setMinute(''); return }
    dispatch({ type: 'score', entry: { key: key(), side, points, playerId: null, assistId: null } })
  }
  const savePick = () => {
    if (!picking) return
    if (picking.kind === 'score') dispatch({ type: 'score', entry: { key: key(), side: picking.side, points: picking.points, playerId: scorer || null, assistId: method === 'own_goal' ? null : assist || null, minute: minute ? Number(minute) : null, ...(goalSport ? { method } : {}) } })
    else dispatch({ type: 'card', entry: { key: key(), side: picking.side, card, playerId: scorer || null, minute: minute ? Number(minute) : null } })
    setPicking(null)
  }
  // The phase is also saved on the match (migration 045) so the public page and officials see it.
  const phase = (type: 'half_time' | 'resume' | 'finish' | 'reopen') => {
    dispatch({ type })
    void setMatchPhase(client, match.id, type === 'half_time' ? 'half_time' : type === 'finish' ? 'finished' : 'second_half').then(result => { if (result.error) setError(result.error) })
  }
  const finish = () => { phase('finish'); setFinal({ home: String(totals.home), away: String(totals.away) }) }
  // Knockout extras: extra time is included in the score; penalties only decide a level tie.
  const [extraTime, setExtraTime] = useState(false)
  const [shootout, setShootout] = useState({ home: '', away: '' })

  const submit = async () => {
    const home = Number(final?.home ?? totals.home); const away = Number(final?.away ?? totals.away)
    if (![home, away].every(value => Number.isInteger(value) && value >= 0)) return setError('Scores must be whole numbers of zero or more.')
    setBusy(true); setError('')
    let skippedMisses = 0
    if (career) {
      // Events carry stable keys, so sending again after a failure never adds them twice.
      for (const event of careerEvents(board, sport, { home: match.home_team_id, away: match.away_team_id })) {
        const recorded = await recordMatchEvent(client, { operationId: event.key, matchId: match.id, actorId: user.id, operationType: 'event', payload: { ...(event.payload ?? {}), eventType: event.eventType, teamId: event.teamId, playerId: event.playerId }, baseResultVersion: null, status: 'queued' })
        // Penalty misses need update 044; until then they are left out rather than blocking the result.
        if (recorded.error && event.eventType === 'penalty_miss' && /unsupported_event_type/.test(recorded.error)) { skippedMisses += 1; continue }
        if (recorded.error) { setBusy(false); return setError('Player details could not be saved. Check your connection and submit again.') }
      }
    }
    const score: Record<string, unknown> = { home, away }
    if (extraTime) score.extraTime = true
    if (shootout.home !== '' || shootout.away !== '') {
      const sh = Number(shootout.home); const sa = Number(shootout.away)
      if (![sh, sa].every(value => Number.isInteger(value) && value >= 0) || sh === sa) { setBusy(false); return setError('Penalty scores must be two different whole numbers.') }
      if (home !== away) { setBusy(false); return setError('Penalties are only recorded when the score is level.') }
      score.homeShootout = sh; score.awayShootout = sa
    }
    if (outcome !== 'played') score.outcome = outcome
    if (resultNote.trim()) score.note = resultNote.trim().slice(0, 500)
    const result = await submitMatchResult(client, match.id, score, user.id)
    setBusy(false)
    if (result.error) return setError('The result could not be submitted. Please try again.')
    write(boardKey, null)
    onNotice(`Result submitted. Confirm it to update standings and histories.${skippedMisses ? ' Penalty misses are kept once the platform owner applies update 044.' : ''}`); onChanged(); onClose()
  }

  const playing = board.phase === 'first_half' || board.phase === 'second_half'
  return <section className="flow-match-center" aria-label="Match Center">
    <div className="flow-scoreboard">
      <div><span>{names.home}</span><strong>{board.phase === 'finished' && final ? final.home : totals.home}</strong></div>
      <small className={`flow-phase phase-${board.phase}`}>{phaseLabel(board.phase, sport)}</small>
      <div><span>{names.away}</span><strong>{board.phase === 'finished' && final ? final.away : totals.away}</strong></div>
    </div>
    {board.phase === 'not_started' && <button type="button" className="primary-button flow-big" onClick={() => void start()}><Play size={20} /> Start Match</button>}
    {(playing || board.phase === 'half_time') && <>
      <div className="flow-score-buttons">{(['home', 'away'] as const).map(side => <div key={side}><span>{names[side]}</span>{scoreButtons(sport).map(button => <button type="button" key={button.label} className="flow-big outline-button dark" disabled={!playing} onClick={() => tapScore(side, button.points)}>Add Score {button.label}</button>)}{career && goalSport && <button type="button" className="ghost-button" onClick={() => { setPicking({ side, points: 0, kind: 'card' }); setScorer(''); setMinute('') }}><Flag size={14} /> Card</button>}</div>)}</div>
      <div className="flow-control-row">
        <button type="button" className="outline-button dark flow-big" onClick={() => void undo()} disabled={board.history.length === 0}><Undo2 size={18} /> Undo</button>
        {board.phase === 'first_half' && <button type="button" className="outline-button dark flow-big" onClick={() => phase('half_time')}><Pause size={18} /> {phaseLabel('half_time', sport)}</button>}
        {board.phase === 'half_time' && <button type="button" className="outline-button dark flow-big" onClick={() => phase('resume')}><Play size={18} /> Restart</button>}
        <button type="button" className="primary-button flow-big" onClick={finish}><Flag size={18} /> Finish Match</button>
      </div>
    </>}
    {picking && <div className="flow-picker" role="dialog" aria-label={picking.kind === 'score' ? 'Who scored?' : 'Card'}>
      <h4>{picking.kind === 'score' ? `Who scored for ${names[picking.side]}?` : `Card for ${names[picking.side]}`}</h4>
      {picking.kind === 'card' && <label>Card or penalty<select value={card} onChange={event => setCard(event.target.value as typeof card)}>{(Object.keys(CARD_LABELS) as Array<CardEntry['card']>).map(item => <option key={item} value={item}>{CARD_LABELS[item]}</option>)}</select></label>}
      {picking.kind === 'score' && goalSport && <label>How<select value={method} onChange={event => { setMethod(event.target.value as typeof method); setScorer('') }}><option value="goal">Goal</option><option value="penalty">Penalty goal</option><option value="own_goal">Own goal (by the other team)</option></select></label>}
      <label>Player<select value={scorer} onChange={event => setScorer(event.target.value)}><option value="">Not known</option>{teamPlayers(picking.kind === 'score' && method === 'own_goal' ? (picking.side === 'home' ? 'away' : 'home') : picking.side).map(player => <option key={player.playerId} value={player.playerId}>{player.shirtNumber ? `${player.shirtNumber} · ` : ''}{player.name}{suspended.has(player.playerId) ? ' (suspended)' : ''}</option>)}</select></label>
      {picking.kind === 'score' && goalSport && method !== 'own_goal' && <label>Assist (optional)<select value={assist} onChange={event => setAssist(event.target.value)}><option value="">None</option>{teamPlayers(picking.side).filter(player => player.playerId !== scorer).map(player => <option key={player.playerId} value={player.playerId}>{player.name}</option>)}</select></label>}
      <label>Minute (optional)<input type="number" min="0" max="130" value={minute} onChange={event => setMinute(event.target.value)} /></label>
      <div className="button-row"><button type="button" className="primary-button" onClick={savePick}>Save</button><button type="button" className="outline-button dark" onClick={() => setPicking(null)}>Cancel</button></div>
    </div>}
    {board.phase === 'finished' && final && <div className="flow-final">
      <h4>Final score</h4>
      <details className="flow-create-more"><summary>Extra time and penalties (knockout matches)</summary><div className="flow-create-grid">
        <label className="flow-check"><input type="checkbox" checked={extraTime} onChange={event => setExtraTime(event.target.checked)} /> Extra time was played (the final score above includes it)</label>
        <label>{names.home} penalties<input type="number" min="0" value={shootout.home} onChange={event => setShootout({ ...shootout, home: event.target.value })} /></label>
        <label>{names.away} penalties<input type="number" min="0" value={shootout.away} onChange={event => setShootout({ ...shootout, away: event.target.value })} /></label>
      </div></details>
      <label className="flow-outcome">How it ended<select value={outcome} onChange={event => setOutcome(event.target.value as typeof outcome)}><option value="played">Played</option><option value="walkover">Walkover</option><option value="forfeit">Forfeit</option></select></label>
      <div className="flow-score-form"><label>{names.home}<input type="number" min="0" value={final.home} onChange={event => setFinal({ ...final, home: event.target.value })} /></label><label>{names.away}<input type="number" min="0" value={final.away} onChange={event => setFinal({ ...final, away: event.target.value })} /></label></div>
      {career ? <>
        <button type="button" className="ghost-button" aria-expanded={details} onClick={() => setDetails(value => !value)}>{details ? 'Hide player details' : 'Add player details (lineups and minutes)'}</button>
        {details && <LineupEditor client={client} userId={user.id} matchId={match.id} teamNames={{ [match.home_team_id]: names.home, [match.away_team_id]: names.away }} onNotice={onNotice} />}
      </> : <p className="field-hint">Simple Mode: player statistics will not be recorded for this match.</p>}
      <label className="flow-note">Note for the organizers (optional)<textarea rows={2} maxLength={500} value={resultNote} onChange={event => setResultNote(event.target.value)} /><small className="field-hint">Never shown on the public page.</small></label>
      <div className="flow-control-row"><button type="button" className="primary-button flow-big" disabled={busy} onClick={() => void submit()}>{busy ? 'Submitting…' : 'Submit Result'}</button><button type="button" className="outline-button dark" onClick={() => phase('reopen')}>Back to the match</button></div>
    </div>}
    {note && <p className="pending-note">{note}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {incident ? <form className="flow-picker" aria-label="Injury or incident" onSubmit={event => { event.preventDefault(); void (async () => {
      if (incident.description.trim().length < 5) return setError('Describe what happened in a few words.')
      const result = await reportIncident(client, user.id, { tournamentId, matchId: match.id, category: incident.category, severity: 'medium', description: incident.description })
      if (result.error) return setError(result.error)
      setIncident(null); onNotice('Recorded privately in the tournament incident log.')
    })() }}>
      <h4>Injury or incident</h4>
      <label>Type<select value={incident.category} onChange={event => setIncident({ ...incident, category: event.target.value })}><option value="injury">Injury</option><option value="discipline">Discipline</option><option value="venue">Venue</option><option value="other">Other</option></select></label>
      <label>What happened<textarea rows={2} maxLength={500} value={incident.description} onChange={event => setIncident({ ...incident, description: event.target.value })} /></label>
      <p className="field-hint">Private to the tournament organizers. Medical details stay off public pages.</p>
      <div className="button-row"><button type="submit" className="primary-button">Save</button><button type="button" className="outline-button dark" onClick={() => setIncident(null)}>Cancel</button></div>
    </form> : board.phase !== 'not_started' && <button type="button" className="ghost-button" onClick={() => setIncident({ category: 'injury', description: '' })}>Record injury or incident</button>}
    <button type="button" className="ghost-button" onClick={onClose}>Close (the score is kept on this device)</button>
  </section>
}

// --- Finish -------------------------------------------------------------------------------

export function SimpleFinish({ client, tournament, matches, awards, canManage, onNotice, onChanged, onOpenTab, reloadKey, awardsPanel }: Pick<Base, 'client' | 'tournament' | 'matches' | 'canManage' | 'onNotice' | 'onChanged' | 'onOpenTab'> & { awards: Array<{ kind: string; label: string; recipient: string }>; reloadKey: number; awardsPanel: ReactNode }) {
  const [checks, setChecks] = useState<CompletionCheck[] | null>(null)
  const [previewed, setPreviewed] = useState(() => read(`kulhivaru.archive-previewed.${tournament.id}`) === '1')
  const [discipline, setDiscipline] = useState<{ state: 'ready' | 'pending' | 'error'; active: number } | null>(null)
  const [reviewedDiscipline, setReviewedDiscipline] = useState(() => read(`kulhivaru.discipline-reviewed.${tournament.id}`) === '1')
  // Unresolved bracket conflicts after a correction block the archive.
  const conflicts = useBracketConflicts(client, tournament.id, reloadKey)
  const onDiscipline = useCallback((value: { state: 'ready' | 'pending' | 'error'; active: number }) => setDiscipline(value), [])
  // Open protests or appeals must be decided before the archive (plan section 21).
  const [protests, setProtests] = useState<{ state: 'ready' | 'pending' | 'error'; open: number } | null>(null)
  const onProtests = useCallback((value: { state: 'ready' | 'pending' | 'error'; open: number }) => setProtests(value), [])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Recalculates standings and tables from confirmed results only (existing recalculate_tournament).
  const [rebuilt, setRebuilt] = useState<'idle' | 'busy' | 'done'>('idle')
  const rebuild = async () => { setRebuilt('busy'); const result = await recalculateTournament(client, tournament.id); if (result.error) { setRebuilt('idle'); return setError('Statistics could not be rebuilt. Please try again.') } setRebuilt('done'); onChanged() }
  const reload = useCallback(() => { void loadCompletionChecks(client, tournament.id).then(result => setChecks(result.error ? [] : result.data)) }, [client, tournament.id])
  useEffect(() => { reload() }, [reload, reloadKey])
  const open = matches.filter(match => ['scheduled', 'live', 'awaiting_confirmation', 'postponed'].includes(match.status)).length
  const finished = ['completed', 'archived'].includes(tournament.status)
  const list = checks ? finishChecklist(checks) : []
  const blocked = !checks || list.some(item => item.blocking) || (conflicts ?? 0) > 0 || (protests?.open ?? 0) > 0
  const extraAwards = awards.filter(award => !['champion', 'runner_up', 'third_place'].includes(award.kind.replace(/^award_/, ''))).length
  const href = `#tournament/${encodeURIComponent(tournament.slug)}`
  const finish = async () => {
    setBusy(true); setError('')
    if (!tournament.is_published) { const published = await publishTournament(client, tournament.id, false); if (published.error) { setBusy(false); setConfirming(false); return setError('The archive could not be published. Please try again.') } }
    const archive = await publishTournamentArchive(client, tournament.id)
    if (archive.error) { setBusy(false); setConfirming(false); reload(); return setError(archive.error) }
    const result = archive.pending ? await setTournamentStatus(client, tournament.id, 'completed') : { error: null }
    setBusy(false); setConfirming(false)
    if (result.error) { reload(); return setError('Something still needs finishing. Check the list above and try again.') }
    onNotice(archive.version ? `Tournament finished. Archive version ${archive.version} is published.` : 'Tournament finished. The permanent archive is published.'); onChanged(); onOpenTab('overview')
  }
  if (finished) return <div className="flow-step-panel"><p className="publication-notice"><CircleCheck size={15} /> This tournament is finished. <a href={href}>Open the archive</a></p></div>
  if (open > 0) return <div className="flow-step-panel"><header className="flow-step-head"><p className="ed-eyebrow">Step 5 of 5</p><h3>Finish</h3></header><p className="empty-note">{open} match{open === 1 ? ' is' : 'es are'} not complete yet. Finish opens when every match has a confirmed result.</p><button type="button" className="outline-button dark" onClick={() => onOpenTab('matches')}>Go to Matches</button></div>
  return <div className="flow-step-panel">
    <header className="flow-step-head"><p className="ed-eyebrow">Step 5 of 5</p><h3>Your tournament is almost complete.</h3></header>
    <ul className="flow-checklist">
      {checks === null ? <li><Loader2 className="spin" size={14} /> Checking…</li> : list.map(item => <li key={item.key} className={item.ok ? 'ok' : 'todo'}>{item.ok ? <CircleCheck size={16} /> : <span className="flow-todo" aria-hidden="true" />}<span>{item.label}</span>{!item.ok && ['champion', 'runner_up', 'third_place'].includes(item.key) && <small>{item.key === 'third_place' ? 'Optional. Add it below if a third place was decided.' : 'Add it under Awards below.'}</small>}{!item.ok && !['champion', 'runner_up', 'third_place'].includes(item.key) && <button type="button" className="ghost-button" onClick={() => onOpenTab(item.key === 'results' ? 'matches' : 'standings')}>Fix</button>}</li>)}
      <li className={rebuilt === 'done' ? 'ok' : 'optional'}>{rebuilt === 'done' ? <CircleCheck size={16} /> : <span className="flow-todo" aria-hidden="true" />}<span>Statistics rebuilt from confirmed results</span>{canManage && <button type="button" className="ghost-button" disabled={rebuilt === 'busy'} onClick={() => void rebuild()}>{rebuilt === 'busy' ? 'Rebuilding…' : rebuilt === 'done' ? 'Rebuild again' : 'Rebuild'}</button>}</li>
      <li className={conflicts === 0 ? 'ok' : 'todo'}>{conflicts === 0 ? <CircleCheck size={16} /> : <span className="flow-todo" aria-hidden="true" />}<span>No bracket conflicts from corrections</span>{(conflicts ?? 0) > 0 && <button type="button" className="ghost-button" onClick={() => onOpenTab('standings')}>Review {conflicts}</button>}</li>
      {protests?.state === 'ready' && <li className={protests.open === 0 ? 'ok' : 'todo'}>{protests.open === 0 ? <CircleCheck size={16} /> : <span className="flow-todo" aria-hidden="true" />}<span>{protests.open === 0 ? 'No open protests or appeals' : `${protests.open} protest${protests.open === 1 ? '' : 's'} or appeal${protests.open === 1 ? '' : 's'} still open`}</span>{protests.open > 0 && <small>Decide them below.</small>}</li>}
      <li className={reviewedDiscipline ? 'ok' : 'optional'}>{reviewedDiscipline ? <CircleCheck size={16} /> : <span className="flow-todo" aria-hidden="true" />}<span>Suspensions reviewed</span>{discipline?.state === 'pending' ? <small>Available after update 044</small> : <button type="button" className="ghost-button" onClick={() => { setReviewedDiscipline(true); write(`kulhivaru.discipline-reviewed.${tournament.id}`, '1') }}>{discipline?.active ? `Reviewed (${discipline.active} active)` : 'Mark reviewed'}</button>}</li>
      <li className={extraAwards ? 'ok' : 'optional'}>{extraAwards ? <CircleCheck size={16} /> : <span className="flow-todo" aria-hidden="true" />}<span>Awards recorded (top scorer, best player, best goalkeeper, team awards)</span><small>Optional</small></li>
      <li className={previewed ? 'ok' : 'optional'}>{previewed ? <CircleCheck size={16} /> : <span className="flow-todo" aria-hidden="true" />}<span>Public archive previewed</span><a className="ghost-button" href={href} target="_blank" rel="noreferrer" onClick={() => { setPreviewed(true); write(`kulhivaru.archive-previewed.${tournament.id}`, '1') }}>Preview</a></li>
    </ul>
    <DisciplinePanel client={client} tournamentId={tournament.id} canManage={canManage} onNotice={onNotice} onLoaded={onDiscipline} />
    <ProtestsPanel client={client} tournamentId={tournament.id} canManage={canManage} onNotice={onNotice} onLoaded={onProtests} matchLabel={id => { const found = matches.find(match => match.id === id); return found ? teamsLabel(found) : null }} />
    <section className="flow-awards"><h4>Awards</h4><p className="field-hint">Champion and runner-up, plus optional awards: best player, top scorer, best goalkeeper or any other award.</p>{awardsPanel}</section>
    {error && <p className="form-error" role="alert">{error}</p>}
    {canManage && <div className="flow-primary-row">
      {confirming ? <span className="confirm-group flow-confirm"><span>This archives the tournament (nothing is deleted) and publishes its permanent record. Later corrections keep the earlier version and are audited.</span><button type="button" className="primary-button" disabled={busy} onClick={() => void finish()}>{busy ? 'Publishing…' : 'Finish and Publish Archive'}</button><button type="button" className="outline-button dark" onClick={() => setConfirming(false)}>Cancel</button></span>
        : <button type="button" className="primary-button flow-primary" disabled={blocked} onClick={() => setConfirming(true)}><Trophy size={16} /> Finish and Publish Archive</button>}
      {blocked && checks && <span className="field-hint">Complete the items above first.</span>}
    </div>}
  </div>
}
