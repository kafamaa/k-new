import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ArrowLeft, Lock, MessageSquare, Plus } from 'lucide-react'
import {
  addCaseNote, CASE_PAGE_SIZE, CASE_QUEUES, CASE_STATUSES, CASE_TYPES, caseFromReport, CLOSED_STATUSES, formatWhen, loadCaseMessages, loadCases, openCase, SEVERITIES, updateCase,
  type AdminCase, type AdminPageId, type CaseMessage,
} from '../lib/superAdmin'
import { AdminEmpty, AdminError, AdminLoading, AdminNote, AdminPager, Pill, ReasonAction } from './AdminParts'
import { ContentReportsAdmin } from './AdminLandingTools'
import { PlayerRequestsReview } from './PlayerRequestsReview'
import { setCaseRequester } from '../lib/superAdminOps'
import { MergeTool } from './AdminOperations'

const severityTone = (severity: string) => severity === 'critical' ? 'danger' : severity === 'high' ? 'warn' : 'neutral'
const statusTone = (status: string) => CLOSED_STATUSES.includes(status) ? 'ok' : status === 'escalated' ? 'danger' : status.startsWith('waiting') ? 'warn' : 'info'

const QUEUE_INTRO: Partial<Record<AdminPageId, string>> = {
  cases: 'Moderation cases. Hiding a record never deletes it, and official history is kept.',
  identities: 'Player claims, duplicates, identity corrections and impersonation. National ID numbers are never shown; only their protected digest is stored.',
  support: 'Account, workspace, claim, registration and roster help.',
  'data-requests': 'Data copies, corrections, unpublication and account closure. Closing an account never deletes official sports history.',
  'security-incidents': 'Compromised accounts and other security incidents. Revoke sessions from Directory → Accounts.',
}
// Player requests (Player Workspace → More) that belong in each queue.
const PLAYER_REQUEST_TYPES: Partial<Record<AdminPageId, string[]>> = {
  identities: ['identity', 'verification', 'impersonation', 'duplicate_profile', 'roster'],
  'data-requests': ['privacy', 'data_copy', 'account_closure'],
  support: ['account_support', 'team_contact', 'organizer_contact'],
}

export function CaseQueue({ client, page, me, permissions, onNotice, initialCase }: { client: SupabaseClient; page: AdminPageId; me: string; permissions: string[]; onNotice: (message: string) => void; initialCase?: string | null }) {
  const types = CASE_QUEUES[page] ?? []
  const [state, setState] = useState<'open' | 'mine' | 'closed' | 'all'>('open')
  const [pageIndex, setPageIndex] = useState(0)
  const [data, setData] = useState<{ rows: AdminCase[]; total: number } | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(initialCase ?? null)
  const [creating, setCreating] = useState(false)
  const canCases = permissions.includes('admin.cases.manage')
  const typeKey = types.join(',')

  const reload = useCallback(() => {
    if (!canCases) return
    setError('')
    void loadCases(client, { types: typeKey ? typeKey.split(',') : [], state, me, page: pageIndex }).then(result => { setData(result.data); setError(result.error ?? '') })
  }, [client, typeKey, state, me, pageIndex, canCases])
  useEffect(() => { reload() }, [reload])

  const fromReport = async (reportId: string) => {
    const result = await caseFromReport(client, reportId)
    if (result.error || !result.data) return onNotice(result.error ?? 'The case could not be opened.')
    onNotice('Case opened from the report.'); setSelected(result.data); reload()
  }

  if (selected) return <CaseDetail client={client} caseId={selected} me={me} onBack={() => { setSelected(null); reload() }} onNotice={onNotice} />
  return <div className="adm-stack">
    {QUEUE_INTRO[page] ? <p className="adm-intro">{QUEUE_INTRO[page]}</p> : null}
    {canCases ? <section className="ed-panel">
      <div className="adm-toolbar">
        <div className="ed-toggle" role="group" aria-label="Show cases">{(['open', 'mine', 'closed', 'all'] as const).map(value => <button type="button" key={value} aria-pressed={state === value} className={state === value ? 'active' : ''} onClick={() => { setState(value); setPageIndex(0) }}>{value === 'open' ? 'Open' : value === 'mine' ? 'Assigned to me' : value === 'closed' ? 'Closed' : 'All'}</button>)}</div>
        <button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={() => setCreating(value => !value)}><Plus size={15} /> New case</button>
      </div>
      {creating && <NewCaseForm client={client} types={types} permissions={permissions} onDone={id => { setCreating(false); if (id) { onNotice('Case opened.'); setSelected(id) } }} />}
      {error ? <AdminError message={error} onRetry={reload} /> : !data ? <AdminLoading /> : data.rows.length === 0 ? <AdminEmpty>No cases here.</AdminEmpty>
        : <div className="adm-table-wrap"><table className="adm-table">
          <caption className="sr-only">Cases</caption>
          <thead><tr><th scope="col">Case</th><th scope="col">Type</th><th scope="col">Severity</th><th scope="col">Status</th><th scope="col">Updated</th></tr></thead>
          <tbody>{data.rows.map(row => <tr key={row.id}>
            <td><button type="button" className="ed-link-btn adm-row-link" onClick={() => setSelected(row.id)}><strong>{row.title}</strong><small>{row.reference}{row.subject_label ? ` · ${row.subject_label}` : ''}{row.assigned_to === me ? ' · yours' : ''}</small></button></td>
            <td>{CASE_TYPES[row.case_type] ?? row.case_type}</td>
            <td><Pill tone={severityTone(row.severity)}>{SEVERITIES[row.severity] ?? row.severity}</Pill></td>
            <td><Pill tone={statusTone(row.status)}>{CASE_STATUSES[row.status] ?? row.status}</Pill></td>
            <td>{formatWhen(row.updated_at)}</td>
          </tr>)}</tbody>
        </table></div>}
      {data ? <AdminPager page={pageIndex} total={data.total} size={CASE_PAGE_SIZE} onPage={setPageIndex} label="Case pages" /> : null}
    </section> : <AdminNote>Your role reviews requests below; tracked cases need the case-management permission.</AdminNote>}
    {page === 'identities' && permissions.includes('admin.identities.review') ? <MergeTool client={client} onNotice={onNotice} /> : null}
    {page === 'cases' && permissions.includes('admin.content.moderate') ? <ContentReportsAdmin client={client} onOpenCase={canCases ? id => void fromReport(id) : undefined} /> : null}
    {PLAYER_REQUEST_TYPES[page] && (permissions.includes('admin.identities.review') || permissions.includes('admin.data_requests.manage') || page === 'support')
      ? <PlayerRequestsReview client={client} scope={{ kind: 'admin' }} types={PLAYER_REQUEST_TYPES[page]} title="Requests from players" /> : null}
  </div>
}

function NewCaseForm({ client, types, permissions, onDone }: { client: SupabaseClient; types: string[]; permissions: string[]; onDone: (id: string | null) => void }) {
  const choices = (types.length ? types : Object.keys(CASE_TYPES)).filter(type => type !== 'child_safety' || permissions.includes('admin.cases.child_safety'))
  const [type, setType] = useState(choices[0] ?? 'technical_support')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [severity, setSeverity] = useState('normal')
  const [subject, setSubject] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (title.trim().length < 3) return setError('Give the case a short title.')
    setBusy(true); setError('')
    const result = await openCase(client, { type, title: title.trim(), summary, severity, subjectType: subject ? 'platform' : null, subjectLabel: subject || null })
    setBusy(false)
    if (result.error) return setError(result.error)
    onDone(result.data)
  }
  return <form className="admin-form adm-newcase" onSubmit={submit}>
    <div className="admin-row">
      <label>Type<select value={type} onChange={event => setType(event.target.value)}>{choices.map(value => <option key={value} value={value}>{CASE_TYPES[value]}</option>)}</select></label>
      <label>Severity<select value={severity} onChange={event => setSeverity(event.target.value)}>{Object.entries(SEVERITIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <label>Title<input value={title} maxLength={160} onChange={event => setTitle(event.target.value)} /></label>
    <label>Subject (optional, a name only)<input value={subject} maxLength={200} onChange={event => setSubject(event.target.value)} placeholder="Team, player, tournament or account name" /></label>
    <label>Summary (internal)<textarea rows={3} maxLength={2000} value={summary} onChange={event => setSummary(event.target.value)} /></label>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="button-row compact"><button type="submit" className="ed-btn ed-btn-primary ed-btn-sm" disabled={busy}>{busy ? 'Opening…' : 'Open case'}</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => onDone(null)}>Cancel</button></div>
  </form>
}

// Links the person the case is about (by their account email) so replies reach them.
function RequesterForm({ client, caseId, onDone }: { client: SupabaseClient; caseId: string; onDone: () => void }) {
  const [email, setEmail] = useState('')
  return <ReasonAction label="Set the person to reply to" onConfirm={async reason => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return 'Enter the person’s account email address.'
    const result = await setCaseRequester(client, caseId, email.trim(), reason)
    if (result.error) return result.error
    setEmail(''); onDone(); return null
  }}><label className="pf-field">Account email<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" /></label></ReasonAction>
}

function CaseDetail({ client, caseId, me, onBack, onNotice }: { client: SupabaseClient; caseId: string; me: string; onBack: () => void; onNotice: (message: string) => void }) {
  const [record, setRecord] = useState<AdminCase | null>(null)
  const [messages, setMessages] = useState<CaseMessage[]>([])
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [internal, setInternal] = useState(true)
  const [status, setStatus] = useState('')
  const [severity, setSeverity] = useState('')
  const [decision, setDecision] = useState('')
  const [response, setResponse] = useState('')
  const reload = useCallback(() => {
    void client.from('platform_cases').select('*').eq('id', caseId).maybeSingle().then(result => {
      if (result.error || !result.data) { setError('This case could not be loaded. It may be outside your role.'); return }
      const row = result.data as AdminCase
      setRecord(row); setStatus(row.status); setSeverity(row.severity); setDecision(row.decision ?? ''); setResponse(row.user_response ?? '')
    })
    void loadCaseMessages(client, caseId).then(result => setMessages(result.data))
  }, [client, caseId])
  useEffect(() => { reload() }, [reload])
  if (error) return <div className="adm-stack"><button type="button" className="back-link" onClick={onBack}><ArrowLeft size={14} /> All cases</button><AdminError message={error} onRetry={reload} /></div>
  if (!record) return <AdminLoading />
  const closed = CLOSED_STATUSES.includes(record.status)
  const statusChoices = closed ? [record.status, 'reopened', 'closed'] : Object.keys(CASE_STATUSES).filter(value => value !== 'reopened')
  const save = async (reason: string) => {
    const result = await updateCase(client, record.id, reason, { status: status !== record.status ? status : undefined, severity: severity !== record.severity ? severity : undefined, decision: decision !== (record.decision ?? '') ? decision : undefined, userResponse: response !== (record.user_response ?? '') ? response : undefined })
    if (result.error) return result.error
    onNotice('Case updated.'); reload(); return null
  }
  const assign = async (reason: string, unassign: boolean) => {
    const result = await updateCase(client, record.id, reason, unassign ? { unassign: true } : { assignee: me })
    if (result.error) return result.error
    onNotice(unassign ? 'Case unassigned.' : 'Case assigned to you.'); reload(); return null
  }
  const addNote = async (event: FormEvent) => {
    event.preventDefault()
    if (!note.trim()) return
    const result = await addCaseNote(client, record.id, note.trim(), internal)
    if (result.error) return onNotice(result.error)
    setNote(''); reload()
  }
  return <div className="adm-stack">
    <button type="button" className="back-link" onClick={onBack}><ArrowLeft size={14} /> All cases</button>
    <header className="adm-case-head">
      <div><p className="ed-eyebrow">{record.reference} · {CASE_TYPES[record.case_type] ?? record.case_type}</p><h2>{record.title}</h2>
        <p className="adm-meta"><Pill tone={statusTone(record.status)}>{CASE_STATUSES[record.status]}</Pill> <Pill tone={severityTone(record.severity)}>{SEVERITIES[record.severity]}</Pill> Opened {formatWhen(record.created_at)}{record.assigned_to ? record.assigned_to === me ? ' · Assigned to you' : ' · Assigned' : ' · Unassigned'}{record.due_at ? ` · Target ${formatWhen(record.due_at)}` : ''}</p></div>
      <div className="button-row compact">{record.assigned_to !== me ? <ReasonAction label="Assign to me" onConfirm={reason => assign(reason, false)} /> : <ReasonAction label="Unassign" onConfirm={reason => assign(reason, true)} />}</div>
    </header>
    <div className="adm-two">
      <section className="ed-panel adm-stack">
        <h3 className="ed-subhead">Details</h3>
        <dl className="adm-dl">
          <div><dt>Subject</dt><dd>{record.subject_label ?? '—'}{record.subject_type ? ` (${record.subject_type})` : ''}</dd></div>
          <div><dt>Summary</dt><dd>{record.summary ?? '—'}</dd></div>
          {record.subject_type === 'match' && record.subject_ref ? <div><dt>Result</dt><dd><a className="ed-link" href={`#workspace/platform-admin/matches?match=${encodeURIComponent(record.subject_ref)}`}>Review this match result</a></dd></div> : null}
          {record.related_case_ids.length ? <div><dt>Linked cases</dt><dd>{record.related_case_ids.length}</dd></div> : null}
        </dl>
        <div className="admin-form">
          <div className="admin-row">
            <label>Status<select value={status} onChange={event => setStatus(event.target.value)}>{statusChoices.map(value => <option key={value} value={value}>{CASE_STATUSES[value]}</option>)}</select></label>
            <label>Severity<select value={severity} onChange={event => setSeverity(event.target.value)}>{Object.entries(SEVERITIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          <label>Decision (needed to resolve or reject)<textarea rows={2} maxLength={2000} value={decision} onChange={event => setDecision(event.target.value)} /></label>
          <label>Response to the person (user-visible)<textarea rows={2} maxLength={2000} value={response} onChange={event => setResponse(event.target.value)} /></label>
          <ReasonAction label="Save changes" tone="primary" onConfirm={save} />
        </div>
      </section>
      <section className="ed-panel adm-stack">
        <h3 className="ed-subhead"><MessageSquare size={16} /> Timeline</h3>
        {messages.length === 0 ? <AdminEmpty>No notes yet.</AdminEmpty> : <ol className="adm-timeline">{messages.map(item => <li key={item.id} className={item.is_internal ? 'internal' : ''}>
          <small>{formatWhen(item.created_at)} · {item.is_internal ? <><Lock size={11} /> Internal note</> : 'Message to the person'}{item.author_id === me ? ' · you' : ''}</small>
          <p>{item.body}</p>
        </li>)}</ol>}
        <form className="admin-form" onSubmit={addNote}>
          <label>Add a note<textarea rows={3} maxLength={4000} value={note} onChange={event => setNote(event.target.value)} /></label>
          <label className="checkbox-row"><input type="checkbox" checked={internal} onChange={event => setInternal(event.target.checked)} /> Internal (never shown publicly or to the person)</label>
          <div className="button-row compact"><button type="submit" className="ed-btn ed-btn-primary ed-btn-sm" disabled={!note.trim()}>Add note</button></div>
        </form>
        <AdminNote>{record.case_type === 'child_safety' ? 'Child-safety cases never send messages automatically; contact the person through a safe channel.' : 'Messages for the person, and the response above, are sent to them as an in-app notification. Without a reporter or requester they are only stored with the case.'}</AdminNote>
        <RequesterForm client={client} caseId={record.id} onDone={() => { onNotice('The person was linked to this case.'); reload() }} />
      </section>
    </div>
  </div>
}
