import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FileLock2, Flag } from 'lucide-react'
import { loadResultReports, openTeamPrivateFile, RESULT_REPORT_TYPES, resolveResultReport, statusTone, TEAM_DOCUMENT_CATEGORIES, type ResultReport } from '../lib/teamHub'
import { formatDay } from '../lib/display'
import { Card, Pill } from './HubUi'

// Organizer side: result correction reports that teams sent for this
// tournament. Deciding a report records the decision; the result itself is
// corrected in Matches, which keeps the earlier version.
export function TeamResultReportsReview({ client, tournamentId }: { client: SupabaseClient; tournamentId: string }) {
  const [items, setItems] = useState<ResultReport[]>([])
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const reload = useCallback(() => { void loadResultReports(client, { tournamentId }).then(result => { setItems(result.data); setError(result.error ?? '') }) }, [client, tournamentId])
  useEffect(() => { reload() }, [reload])
  const decide = async (item: ResultReport, status: 'under_review' | 'resolved' | 'rejected') => {
    const result = await resolveResultReport(client, item.id, status, notes[item.id] ?? '')
    if (result.error) return setError(result.error)
    reload()
  }
  const open = items.filter(item => ['pending', 'under_review'].includes(item.status))
  return <Card icon={<Flag size={18} />} title="Team result reports" sub={open.length ? `${open.length} waiting` : 'Nothing waiting'} className="pw-review">
    {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
    {items.length ? <ul className="pw-requests">{items.map(item => <li key={item.id}>
      <div className="pw-request-head"><span className="pw-request-type">{item.teamName} · {RESULT_REPORT_TYPES.find(type => type.value === item.type)?.label ?? item.type} · {formatDay(item.createdAt)}</span><Pill tone={statusTone(item.status === 'pending' ? 'pending' : item.status)}>{item.status.replace('_', ' ')}</Pill></div>
      <p className="pw-request-message">{item.message}</p>
      {item.note && <p className="pw-note-box">{item.note}</p>}
      {['pending', 'under_review'].includes(item.status) && <div className="pw-inline-form">
        <label className="pf-field">Response<input value={notes[item.id] ?? ''} onChange={event => setNotes({ ...notes, [item.id]: event.target.value })} placeholder="Required to reject" /></label>
        <div className="pw-actions">{item.status === 'pending' && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => void decide(item, 'under_review')}>Start review</button>}<button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={() => void decide(item, 'resolved')}>Mark corrected</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => void decide(item, 'rejected')}>Reject</button></div>
      </div>}
    </li>)}</ul> : <p className="pf-hint">No team has reported a result problem.</p>}
    <p className="pf-hint">Correct the result itself from the match: a new confirmed version replaces the old one, which stays in the audit trail.</p>
  </Card>
}

type TeamDoc = { id: string; teamName: string; category: string; originalName: string; storagePath: string; status: string; reviewerNote: string | null; createdAt: string }
// Organizer side: team documents uploaded for this tournament.
export function TeamDocumentsReview({ client, userId, tournamentId }: { client: SupabaseClient; userId: string; tournamentId: string }) {
  const [items, setItems] = useState<TeamDoc[]>([])
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const reload = useCallback(() => {
    void client.from('team_documents').select('id,category,original_name,storage_path,status,reviewer_note,created_at,teams(name)').eq('tournament_id', tournamentId).order('created_at', { ascending: false }).then(result => {
      if (result.error) { setError(/does not exist|schema cache|PGRST2/i.test(result.error.message) ? 'Team documents need migration 031.' : result.error.message); return }
      setItems(((result.data ?? []) as Record<string, unknown>[]).map(row => { const team = (Array.isArray(row.teams) ? row.teams[0] : row.teams) as Record<string, unknown> | null; return { id: String(row.id), teamName: String(team?.name ?? 'Team'), category: String(row.category), originalName: String(row.original_name), storagePath: String(row.storage_path), status: String(row.status), reviewerNote: typeof row.reviewer_note === 'string' ? row.reviewer_note : null, createdAt: String(row.created_at ?? '') } }))
    })
  }, [client, tournamentId])
  useEffect(() => { reload() }, [reload])
  const review = async (item: TeamDoc, status: 'under_review' | 'changes_requested' | 'verified' | 'rejected') => {
    const note = (notes[item.id] ?? '').trim()
    if ((status === 'changes_requested' || status === 'rejected') && !note) return setError('Add a note so the team knows what to fix.')
    const result = await client.from('team_documents').update({ status, reviewer_note: note || null, reviewed_by: userId, reviewed_at: new Date().toISOString() }).eq('id', item.id).select('id')
    if (result.error) return setError(result.error.message)
    setError(''); reload()
  }
  const open = async (item: TeamDoc) => { const result = await openTeamPrivateFile(client, item.storagePath); if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer'); else setError(result.error ?? 'The file could not be opened.') }
  if (!items.length && !error) return null
  return <Card icon={<FileLock2 size={18} />} title="Team documents" sub="Uploaded by teams for this tournament" className="pw-review">
    {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
    <ul className="pw-requests">{items.map(item => <li key={item.id}>
      <div className="pw-request-head"><span className="pw-request-type">{item.teamName} · {TEAM_DOCUMENT_CATEGORIES.find(category => category.value === item.category)?.label ?? item.category}</span><span className={`ps-doc-status status-${item.status}`}>{item.status.replace('_', ' ')}</span></div>
      <button type="button" className="ed-link-btn" onClick={() => void open(item)}>{item.originalName}</button>
      {item.reviewerNote && <p className="pw-note-box">{item.reviewerNote}</p>}
      <div className="pw-inline-form"><label className="pf-field">Note<input value={notes[item.id] ?? ''} onChange={event => setNotes({ ...notes, [item.id]: event.target.value })} /></label>
        <div className="pw-actions"><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={() => void review(item, 'verified')}>Verify</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => void review(item, 'changes_requested')}>Request changes</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => void review(item, 'rejected')}>Reject</button></div></div>
    </li>)}</ul>
  </Card>
}
