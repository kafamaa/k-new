import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Gavel, RefreshCw } from 'lucide-react'
import { decideProtest, loadProtests, openProtestCount, PENDING_046, PROTEST_STATUS_LABELS, type Protest } from '../lib/protests'

const TONE: Record<Protest['status'], string> = { submitted: 'info', under_review: 'warn', upheld: 'ok', rejected: 'danger', withdrawn: 'neutral' }

// Organizer side of protests and appeals (unified plan section 23). Teams file
// from their own workspace; organizers review and decide here with a written
// reason. Private to this tournament's organizers and the filing team.
export function ProtestsPanel({ client, tournamentId, canManage, matchLabel, onNotice, onLoaded }: {
  client: SupabaseClient; tournamentId: string; canManage: boolean; matchLabel?: (matchId: string) => string | null
  onNotice: (message: string) => void; onLoaded?: (state: { state: 'ready' | 'pending' | 'error'; open: number }) => void
}) {
  const [list, setList] = useState<Protest[] | null>(null)
  const [state, setState] = useState<'ready' | 'pending' | 'error'>('ready')
  const [deciding, setDeciding] = useState<{ id: string; status: 'upheld' | 'rejected'; reason: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const reload = useCallback(() => {
    void loadProtests(client, { tournamentId }).then(result => {
      setList(result.data); setState(result.state)
      onLoaded?.({ state: result.state, open: openProtestCount(result.data) })
    })
  }, [client, tournamentId, onLoaded])
  useEffect(() => { reload() }, [reload])

  const review = async (id: string) => {
    setBusy(id); setError('')
    const result = await decideProtest(client, id, 'under_review', '')
    setBusy('')
    if (result.error) return setError(result.error)
    onNotice('Marked as under review.'); reload()
  }
  const decide = async () => {
    if (!deciding) return
    setBusy(deciding.id); setError('')
    const result = await decideProtest(client, deciding.id, deciding.status, deciding.reason)
    setBusy('')
    if (result.error) return setError(result.error)
    onNotice(deciding.status === 'upheld' ? 'Protest upheld. The team can see your decision.' : 'Protest rejected. The team can see your reason and may appeal once.')
    setDeciding(null); reload()
  }

  const open = list ? openProtestCount(list) : 0
  return <section className="panel-block" aria-label="Protests and appeals">
    <h3><Gavel size={15} /> Protests and appeals{open ? ` · ${open} open` : ''}</h3>
    <p className="field-hint">Teams file protests about a match or decision from their own workspace. Decide each with a written reason; a decided protest can be appealed once. Private to organizers and the filing team.</p>
    {state === 'pending' ? <p className="pending-note" role="status">{PENDING_046}</p>
      : state === 'error' ? <div className="form-error" role="alert">Protests could not be loaded.<button type="button" className="retry-button" onClick={reload}><RefreshCw size={13} /> Retry</button></div>
        : list === null ? <p className="field-hint">Loading…</p>
          : list.length === 0 ? <p className="empty-note">No protests or appeals.</p>
            : <ul className="tp-list">{list.map(item => {
              const closed = !['submitted', 'under_review'].includes(item.status)
              const match = item.matchId ? matchLabel?.(item.matchId) : null
              return <li key={item.id} className="result-row protest-row">
                <div>
                  <strong>{item.kind === 'appeal' ? 'Appeal: ' : ''}{item.subject}</strong>
                  <span>{item.teamName}{match ? ` · ${match}` : ''} · filed {new Date(item.createdAt).toLocaleDateString('en-GB', { timeZone: 'Indian/Maldives', day: 'numeric', month: 'short' })}</span>
                  <p className="protest-grounds">{item.grounds}</p>
                  {item.decision && <p className="protest-decision"><b>Decision:</b> {item.decision}</p>}
                </div>
                <div className="button-row">
                  <span className={`status-pill status-${TONE[item.status]}`}>{PROTEST_STATUS_LABELS[item.status]}</span>
                  {canManage && !closed && <>
                    {item.status === 'submitted' && <button type="button" className="ghost-button" disabled={busy === item.id} onClick={() => void review(item.id)}>Start review</button>}
                    <button type="button" className="outline-button dark" onClick={() => setDeciding({ id: item.id, status: 'upheld', reason: '' })}>Uphold</button>
                    <button type="button" className="outline-button dark" onClick={() => setDeciding({ id: item.id, status: 'rejected', reason: '' })}>Reject</button>
                  </>}
                </div>
                {deciding?.id === item.id && <div className="inline-review">
                  <label>{deciding.status === 'upheld' ? 'Why is the protest upheld, and what changes?' : 'Why is the protest rejected?'}
                    <textarea rows={3} maxLength={4000} value={deciding.reason} onChange={event => setDeciding({ ...deciding, reason: event.target.value })} placeholder="The team sees this reason." /></label>
                  <p className="field-hint">If the decision changes a result, correct the match under Matches too; the correction is versioned and audited.</p>
                  <div className="button-row">
                    <button type="button" className="primary-button" disabled={busy === item.id} onClick={() => void decide()}>{busy === item.id ? 'Saving…' : deciding.status === 'upheld' ? 'Uphold protest' : 'Reject protest'}</button>
                    <button type="button" className="outline-button dark" onClick={() => { setDeciding(null); setError('') }}>Cancel</button>
                  </div>
                </div>}
              </li>
            })}</ul>}
    {error && <div className="form-error" role="alert">{error}</div>}
  </section>
}
