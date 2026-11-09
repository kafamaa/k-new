import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ClipboardList } from 'lucide-react'
import { loadRequestsForReview, REQUEST_STATUS_LABELS, REQUEST_TYPE_LABELS, requestTone, reviewPlayerRequest, type ReviewRequest, type ReviewScope } from '../lib/playerHub'
import { formatDay } from '../lib/display'

// Requests players send to a tournament's operators, a team's managers or the
// platform team. The database decides who may read and answer them.
// types narrows the list to some request types (Super Admin queues).
export function PlayerRequestsReview({ client, scope, title = 'Player requests', types }: { client: SupabaseClient; scope: ReviewScope; title?: string; types?: string[] }) {
  const [loaded, setItems] = useState<ReviewRequest[]>([])
  const items = types ? loaded.filter(item => item.type !== null && item.type !== undefined && types.includes(item.type)) : loaded
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const scopeKey = scope.kind === 'admin' ? 'admin' : `${scope.kind}:${scope.id}`
  // scopeKey captures every field of scope that the query depends on.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => { void loadRequestsForReview(client, scope).then(result => { setItems(result.data); setError(result.error ?? '') }) }, [client, scopeKey])
  useEffect(() => { reload() }, [reload])

  const decide = async (item: ReviewRequest, status: 'under_review' | 'changes_requested' | 'resolved' | 'rejected') => {
    setBusy(item.id); setError('')
    const result = await reviewPlayerRequest(client, item.id, status, notes[item.id] ?? '')
    setBusy(null)
    if (result.error) return setError(result.error)
    setNotes({ ...notes, [item.id]: '' }); reload()
  }
  const open = items.filter(item => ['pending', 'under_review'].includes(item.status))
  const shown = showClosed ? items : open
  return <section className="pf-card pw-review">
    <header className="pf-card-head"><span className="pf-card-icon"><ClipboardList size={18} /></span><div><h3>{title}</h3><p>{open.length ? `${open.length} waiting for a decision` : 'Nothing waiting'}</p></div>
      {items.length > open.length && <div className="pw-card-action"><button type="button" className="ed-link-btn" onClick={() => setShowClosed(value => !value)}>{showClosed ? 'Hide closed' : `Show closed (${items.length - open.length})`}</button></div>}</header>
    {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
    {shown.length === 0 ? <p className="pf-hint">No player requests here.</p> : <ul className="pw-requests">{shown.map(item => <li key={item.id}>
      <div className="pw-request-head"><span className="pw-request-type">{item.type ? REQUEST_TYPE_LABELS[item.type] : 'Correction request'} · {item.playerName}</span><span className={`pw-pill tone-${requestTone(item.status)}`}>{REQUEST_STATUS_LABELS[item.status] ?? item.status}</span></div>
      <strong>{item.subject}</strong>
      <p className="pw-request-message">{item.message}</p>
      <small className="pf-hint">Sent {formatDay(item.createdAt) ?? '—'}{item.note ? ` · Response: ${item.note}` : ''}</small>
      {['pending', 'under_review'].includes(item.status) && <div className="pw-inline-form">
        <label className="pf-field">Response to the player<input value={notes[item.id] ?? ''} onChange={event => setNotes({ ...notes, [item.id]: event.target.value })} placeholder="Required when asking for changes or rejecting" /></label>
        <div className="pw-actions">
          {item.status === 'pending' && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={busy === item.id} onClick={() => void decide(item, 'under_review')}>Start review</button>}
          <button type="button" className="ed-btn ed-btn-primary ed-btn-sm" disabled={busy === item.id} onClick={() => void decide(item, 'resolved')}>Approve</button>
          <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={busy === item.id} onClick={() => void decide(item, 'changes_requested')}>Ask for changes</button>
          <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={busy === item.id} onClick={() => void decide(item, 'rejected')}>Reject</button>
        </div>
      </div>}
    </li>)}</ul>}
    <p className="pf-hint">Approving a request records your decision. Change the official record itself (result, statistic or membership) in its own section.</p>
  </section>
}
