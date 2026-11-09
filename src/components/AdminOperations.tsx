import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ArrowLeft, GitMerge, Lock, Search, Snowflake } from 'lucide-react'
import { DIRECTORY_PAGE_SIZE, formatWhen } from '../lib/superAdmin'
import {
  ACTION_LABELS, actionOutcome, cancelAction, decideAction, FINANCE_KINDS, financeCsv, financeFinding, findPlayers, formatMvr, freezeResult, listActions, loadDeliveries, loadFinance, loadMatchVersions,
  MERGE_PROBLEMS, previewMerge, proposeAction, recordFinanceExport, retryDelivery,
  type ActionRequest, type DeliveryRow, type FinanceKind, type FinanceRow, type MatchVersion, type MergePreview, type PlayerHit,
} from '../lib/superAdminOps'
import { downloadBlob } from '../lib/cardImage'
import { AdminEmpty, AdminError, AdminLoading, AdminNote, AdminPager, Pill, ReasonAction } from './AdminParts'

// --- Critical approvals (two people) ---------------------------------------------------------------
export function ApprovalsPage({ client, onNotice }: { client: SupabaseClient; onNotice: (message: string) => void }) {
  const [status, setStatus] = useState('pending')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<ActionRequest[] | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(() => { setError(''); void listActions(client, status, page).then(result => { setRows(result.data); setError(result.error ?? '') }) }, [client, status, page])
  useEffect(() => { reload() }, [reload])
  const done = (message: string) => { onNotice(message); reload(); return null }
  return <div className="adm-stack">
    <p className="adm-intro">High-impact changes need two administrators: one proposes, a different one approves, and the server carries it out once. Both are recorded. Approving needs a sign-in within the last 30 minutes.</p>
    <section className="ed-panel adm-stack">
      <div className="ed-toggle" role="group" aria-label="Show">{[['pending', 'Waiting'], ['executed', 'Carried out'], ['rejected', 'Rejected'], ['all', 'All']].map(([value, label]) => <button type="button" key={value} aria-pressed={status === value} className={status === value ? 'active' : ''} onClick={() => { setStatus(value); setPage(0) }}>{label}</button>)}</div>
      {error ? <AdminError message={error} onRetry={reload} /> : !rows ? <AdminLoading /> : rows.length === 0 ? <AdminEmpty>Nothing here.</AdminEmpty>
        : <ul className="adm-list">{rows.map(row => <li key={row.id} className="adm-list-row">
          <span className="adm-list-main"><strong>{ACTION_LABELS[row.action_type]}: {row.target_label}</strong>
            <span className="adm-pills"><Pill tone={row.status === 'pending' ? 'warn' : row.status === 'executed' ? 'ok' : 'neutral'}>{row.status === 'pending' ? 'Waiting for a second administrator' : row.status === 'executed' ? 'Carried out' : row.status.replace(/^./, letter => letter.toUpperCase())}</Pill>
              <small>{row.reference} · proposed by {row.proposed_by_me ? 'you' : row.proposed_by_name ?? 'an administrator'} {formatWhen(row.created_at)}{row.decided_by_name ? ` · decided by ${row.decided_by_name}` : ''}</small></span>
            <small className="adm-cell-sub">Reason: {row.reason}</small>
            {row.action_type === 'result_correction' && row.payload.score ? <small className="adm-cell-sub">New score: {String((row.payload.score as { home?: number }).home)} – {String((row.payload.score as { away?: number }).away)}</small> : null}
            {row.action_type === 'result_restore' ? <small className="adm-cell-sub">Restore result version {String(row.payload.version)}</small> : null}
            {actionOutcome(row) ? <small className="adm-cell-sub">{actionOutcome(row)}</small> : null}
            {row.decision_note ? <small className="adm-cell-sub">Decision: {row.decision_note}</small> : null}
          </span>
          {row.status === 'pending' ? <span className="button-row compact">{row.proposed_by_me
            ? <ReasonAction label="Withdraw" onConfirm={async reason => { const result = await cancelAction(client, row.id, reason); return result.error ?? done('Proposal withdrawn.') }} />
            : <><ReasonAction label="Approve and carry out" tone="primary" hint="This runs immediately and cannot be undone except by another reviewed action." onConfirm={async note => { const result = await decideAction(client, row.id, true, note); return result.error ?? done('Approved and carried out.') }} />
              <ReasonAction label="Reject" onConfirm={async note => { const result = await decideAction(client, row.id, false, note); return result.error ?? done('Rejected.') }} /></>}</span> : null}
        </li>)}</ul>}
      <AdminPager page={page} total={rows?.[0]?.total ?? 0} size={DIRECTORY_PAGE_SIZE} onPage={setPage} label="Approval pages" />
    </section>
  </div>
}

// --- One match: versions, freeze, correction and restore proposals --------------------------------
export function MatchReview({ client, matchId, label, onBack, onNotice }: { client: SupabaseClient; matchId: string; label: string; onBack: () => void; onNotice: (message: string) => void }) {
  const [versions, setVersions] = useState<MatchVersion[] | null>(null)
  const [error, setError] = useState('')
  const [home, setHome] = useState('')
  const [away, setAway] = useState('')
  const reload = useCallback(() => { void loadMatchVersions(client, matchId).then(result => { setVersions(result.data); setError(result.error ?? '') }) }, [client, matchId])
  useEffect(() => { reload() }, [reload])
  const frozen = versions?.some(version => version.frozen) ?? false
  const done = (message: string) => { onNotice(message); reload(); return null }
  const scoreText = (version: MatchVersion) => version.home === null || version.away === null ? 'No score' : `${version.home} – ${version.away}`
  return <div className="adm-stack">
    <button type="button" className="back-link" onClick={onBack}><ArrowLeft size={14} /> All matches</button>
    <header className="adm-case-head"><div><p className="ed-eyebrow">Result integrity</p><h2>{label}</h2>{frozen ? <p className="adm-meta"><Pill tone="info"><Snowflake size={11} /> Public result frozen</Pill></p> : null}</div>
      <div className="button-row compact">{frozen
        ? <ReasonAction label="Unfreeze public result" onConfirm={async reason => { const result = await freezeResult(client, matchId, false, reason); return result.error ?? done('The result is public again.') }} />
        : <ReasonAction label="Freeze public result" hint="Hides the score publicly while it is reviewed. Nothing is changed or deleted; standings stay as they are until a correction is approved." onConfirm={async reason => { const result = await freezeResult(client, matchId, true, reason); return result.error ?? done('Public result frozen.') }} />}</div></header>
    {error ? <AdminError message={error} onRetry={reload} /> : !versions ? <AdminLoading /> : <section className="ed-panel adm-stack">
      <h3 className="ed-subhead">Result history</h3>
      {versions.length === 0 ? <AdminEmpty>No result has been submitted.</AdminEmpty> : <div className="adm-table-wrap"><table className="adm-table">
        <caption className="sr-only">Result versions</caption>
        <thead><tr><th scope="col">Version</th><th scope="col">Score</th><th scope="col">Status</th><th scope="col">Reason</th><th scope="col"><span className="sr-only">Restore</span></th></tr></thead>
        <tbody>{versions.map(version => <tr key={version.version}>
          <td>{version.version}<small className="adm-cell-sub">{formatWhen(version.created_at)}</small></td>
          <td><strong>{scoreText(version)}</strong></td>
          <td>{version.status === 'confirmed' ? <Pill tone="ok">Official</Pill> : version.status}</td>
          <td>{version.correction_reason ?? '—'}</td>
          <td>{version.status !== 'confirmed' && version.status !== 'submitted' && version.home !== null ? <ReasonAction label="Propose restore" hint="A second administrator must approve. Restoring creates a new official version; history is kept." onConfirm={async reason => { const result = await proposeAction(client, 'result_restore', { matchId, version: version.version }, reason); return result.error ?? done('Restore proposed. A second administrator must approve it.') }} /> : null}</td>
        </tr>)}</tbody>
      </table></div>}
      <h3 className="ed-subhead">Exceptional correction</h3>
      <p className="adm-hint">Use only when the organizer cannot correct it. A second administrator must approve. The correction becomes a new official version, standings and milestones are recalculated once, and the old version stays in the history.</p>
      <div className="adm-inline">
        <span className="adm-score"><label className="pf-field">Home<input inputMode="numeric" value={home} onChange={event => setHome(event.target.value.replace(/[^0-9]/g, ''))} /></label><label className="pf-field">Away<input inputMode="numeric" value={away} onChange={event => setAway(event.target.value.replace(/[^0-9]/g, ''))} /></label></span>
        <ReasonAction label="Propose correction" tone="primary" disabled={home === '' || away === ''} onConfirm={async reason => { const result = await proposeAction(client, 'result_correction', { matchId, score: { home: Number(home), away: Number(away) } }, reason); if (result.error) return result.error; setHome(''); setAway(''); return done('Correction proposed. A second administrator must approve it.') }} />
      </div>
    </section>}
  </div>
}

// --- Duplicate player merge (identity reviewers) --------------------------------------------------
function PlayerPicker({ client, label, value, onPick }: { client: SupabaseClient; label: string; value: PlayerHit | null; onPick: (player: PlayerHit | null) => void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PlayerHit[]>([])
  useEffect(() => {
    if (query.trim().length < 2) { setHits([]); return }
    let active = true
    const timer = window.setTimeout(() => void findPlayers(client, query).then(result => { if (active) setHits(result.data) }), 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [client, query])
  if (value) return <div className="adm-list-row adm-picked"><span className="adm-list-main"><small>{label}</small><strong>{value.display_name}</strong><small>{[value.public_code, value.island, value.claimed ? 'Claimed' : 'Unclaimed', value.published ? 'Published' : 'Not published'].filter(Boolean).join(' · ')}</small></span><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => onPick(null)}>Change</button></div>
  return <div className="adm-stack">
    <label className="adm-search"><Search size={15} aria-hidden="true" /><span className="sr-only">{label}</span><input type="search" value={query} placeholder={`${label}: name or public code`} onChange={event => setQuery(event.target.value)} /></label>
    {hits.length ? <ul className="adm-list">{hits.filter(hit => !hit.merged).map(hit => <li key={hit.id}><button type="button" className="adm-list-head" onClick={() => onPick(hit)}><span><strong>{hit.display_name}</strong><small>{[hit.public_code, hit.island, hit.claimed ? 'Claimed' : 'Unclaimed'].filter(Boolean).join(' · ')}</small></span></button></li>)}</ul> : null}
  </div>
}

export function MergeTool({ client, onNotice }: { client: SupabaseClient; onNotice: (message: string) => void }) {
  const [keep, setKeep] = useState<PlayerHit | null>(null)
  const [duplicate, setDuplicate] = useState<PlayerHit | null>(null)
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setPreview(null); setError('')
    if (!keep || !duplicate) return
    void previewMerge(client, keep.id, duplicate.id).then(result => { setPreview(result.data); setError(result.error ?? '') })
  }, [client, keep, duplicate])
  const blocked = (preview?.blockers.length ?? 0) > 0
  return <section className="ed-panel adm-stack">
    <h3 className="ed-subhead"><GitMerge size={16} /> Merge duplicate players</h3>
    <p className="adm-hint">Sports history (team memberships, rosters, match appearances, events and milestones) moves to the profile you keep. The duplicate is archived, never deleted, and keeps its own documents, requests and identity records. Statistics are rebuilt once, and a second identity reviewer must approve.</p>
    <div className="adm-two"><PlayerPicker client={client} label="Profile to keep" value={keep} onPick={setKeep} /><PlayerPicker client={client} label="Duplicate to archive" value={duplicate} onPick={setDuplicate} /></div>
    {error ? <AdminError message={error} /> : null}
    {preview ? <div className="adm-stack">
      <dl className="adm-dl adm-dl-grid">{[['Team memberships', preview.memberships], ['Rosters', preview.rosters], ['Match appearances', preview.matches], ['Match events', preview.events], ['Milestones', preview.milestones], ['Availability answers', preview.availability]].map(([label, count]) => <div key={String(label)}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
      {preview.blockers.length ? <div className="form-error" role="alert"><strong>This merge cannot go ahead:</strong><ul className="adm-plan">{preview.blockers.map(code => <li key={code}>{MERGE_PROBLEMS[code] ?? 'A safety check failed.'}</li>)}</ul></div> : null}
      {preview.warnings.length ? <AdminNote>{preview.warnings.map(code => MERGE_PROBLEMS[code] ?? code).join(' ')}</AdminNote> : null}
      <ReasonAction label="Propose merge" tone="primary" disabled={blocked} hint="Name the evidence that these are the same person." onConfirm={async reason => {
        const result = await proposeAction(client, 'player_merge', { canonicalId: keep!.id, duplicateId: duplicate!.id }, reason)
        if (result.error) return result.error
        onNotice('Merge proposed. A second identity reviewer must approve it in Critical approvals.'); setKeep(null); setDuplicate(null); return null
      }} />
    </div> : null}
  </section>
}

// --- Finance audit ----------------------------------------------------------------------------------
export function FinancePage({ client, onNotice }: { client: SupabaseClient; onNotice: (message: string) => void }) {
  const [kind, setKind] = useState<FinanceKind>('tournament_payment')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<FinanceRow[] | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(() => { setError(''); void loadFinance(client, kind, filter, page).then(result => { setRows(result.data); setError(result.error ?? '') }) }, [client, kind, filter, page])
  useEffect(() => { reload() }, [reload])
  const act = (row: FinanceRow, action: 'flag' | 'freeze' | 'unfreeze' | 'close', message: string) => async (reason: string) => { const result = await financeFinding(client, kind, row.record_id, action, reason); if (result.error) return result.error; onNotice(message); reload(); return null }
  const exportRows = async (reason: string) => {
    if (!rows?.length) return 'There is nothing to export on this page.'
    const logged = await recordFinanceExport(client, kind, rows.length, reason)
    if (logged.error) return logged.error
    downloadBlob(new Blob([financeCsv(rows)], { type: 'text/csv;charset=utf-8' }), `kulhivaru-${kind.replace(/_/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`)
    return null
  }
  return <div className="adm-stack">
    <p className="adm-intro">Team, organization and tournament finance, kept separate. Amounts are in MVR. Receipt files and private notes are not shown here, only whether a receipt exists. A frozen record cannot be edited or deleted by its owners until it is unfrozen.</p>
    <section className="ed-panel adm-stack">
      <div className="adm-toolbar">
        <div className="ed-toggle" role="group" aria-label="Records">{(Object.keys(FINANCE_KINDS) as FinanceKind[]).map(value => <button type="button" key={value} aria-pressed={kind === value} className={kind === value ? 'active' : ''} onClick={() => { setKind(value); setPage(0) }}>{FINANCE_KINDS[value]}</button>)}</div>
        <div className="ed-toggle" role="group" aria-label="Filter">{[['all', 'All'], ['flagged', 'With findings']].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? 'active' : ''} onClick={() => { setFilter(value); setPage(0) }}>{label}</button>)}</div>
        <ReasonAction label="Export this page" hint="The export is recorded in the audit log." onConfirm={exportRows} />
      </div>
      {error ? <AdminError message={error} onRetry={reload} /> : !rows ? <AdminLoading /> : rows.length === 0 ? <AdminEmpty>No records.</AdminEmpty>
        : <ul className="adm-list">{rows.map(row => <li key={row.record_id} className="adm-list-row">
          <span className="adm-list-main"><strong>{formatMvr(row.amount_mvr)} · {row.related}</strong><small>{row.description ?? '—'}</small>
            <span className="adm-pills"><Pill>{row.record_status.replace(/_/g, ' ')}</Pill>{row.has_receipt ? <Pill tone="ok">Receipt on file</Pill> : <Pill>No receipt</Pill>}{row.finding_status === 'frozen' ? <Pill tone="danger"><Lock size={11} /> Frozen</Pill> : row.finding_status === 'open' ? <Pill tone="warn">Flagged</Pill> : null}<small>{row.actor ? `By ${row.actor} · ` : ''}{formatWhen(row.created_at)}</small></span>
            {row.finding_reason ? <small className="adm-cell-sub">Finding: {row.finding_reason}</small> : null}
          </span>
          <span className="button-row compact">
            {!row.finding_status && <ReasonAction label="Flag" onConfirm={act(row, 'flag', 'Finding opened.')} />}
            {row.finding_status === 'open' && <><ReasonAction label="Freeze" tone="danger" hint="Stops edits and deletion by the owners. Needs a sign-in within the last 30 minutes." onConfirm={act(row, 'freeze', 'Record frozen.')} /><ReasonAction label="Close finding" onConfirm={act(row, 'close', 'Finding closed.')} /></>}
            {row.finding_status === 'frozen' && <ReasonAction label="Unfreeze" onConfirm={act(row, 'unfreeze', 'Record unfrozen.')} />}
          </span>
        </li>)}</ul>}
      <AdminPager page={page} total={rows?.[0]?.total ?? 0} size={DIRECTORY_PAGE_SIZE} onPage={setPage} label="Finance pages" />
    </section>
  </div>
}

// --- Notification operations ------------------------------------------------------------------------
export function NotificationsPage({ client, onNotice }: { client: SupabaseClient; onNotice: (message: string) => void }) {
  const [state, setState] = useState('failed')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<DeliveryRow[] | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(() => { setError(''); void loadDeliveries(client, state, page).then(result => { setRows(result.data); setError(result.error ?? '') }) }, [client, state, page])
  useEffect(() => { reload() }, [reload])
  return <div className="adm-stack">
    <p className="adm-intro">In-app and email delivery records. A delivery is shown as sent only once it has been confirmed. Provider secrets are never shown.</p>
    <AdminNote>No email sender is deployed yet, so email deliveries stay queued. In-app notifications appear in the person’s workspace without a delivery step. There are no notification templates to edit: organizer notifications are written by the organizer each time, and the only automatic message is the reply to a platform case.</AdminNote>
    <section className="ed-panel adm-stack">
      <div className="ed-toggle" role="group" aria-label="Show">{[['failed', 'Failed'], ['queued', 'Queued'], ['sent', 'Sent'], ['all', 'All']].map(([value, label]) => <button type="button" key={value} aria-pressed={state === value} className={state === value ? 'active' : ''} onClick={() => { setState(value); setPage(0) }}>{label}</button>)}</div>
      {error ? <AdminError message={error} onRetry={reload} /> : !rows ? <AdminLoading /> : rows.length === 0 ? <AdminEmpty>No deliveries here.</AdminEmpty>
        : <ul className="adm-list">{rows.map(row => <li key={row.delivery_id} className="adm-list-row">
          <span className="adm-list-main"><strong>{row.title}</strong><small>{row.notification_type.replace(/_/g, ' ')} · {row.channel === 'email' ? 'Email' : 'In-app'} · {row.attempts} attempt(s) · {formatWhen(row.created_at)}</small>
            <span className="adm-pills"><Pill tone={row.state === 'failed' ? 'danger' : row.state === 'sent' ? 'ok' : 'warn'}>{row.state === 'sent' ? `Sent ${formatWhen(row.delivered_at)}` : row.state.replace(/^./, letter => letter.toUpperCase())}</Pill></span>
            {row.problem ? <small className="adm-cell-sub">Problem: {row.problem}</small> : null}
          </span>
          {row.state === 'failed' ? <ReasonAction label="Retry" onConfirm={async reason => { const result = await retryDelivery(client, row.delivery_id, reason); if (result.error) return result.error; onNotice('Delivery queued again.'); reload(); return null }} /> : null}
        </li>)}</ul>}
      <AdminPager page={page} total={rows?.[0]?.total ?? 0} size={DIRECTORY_PAGE_SIZE} onPage={setPage} label="Delivery pages" />
    </section>
  </div>
}
