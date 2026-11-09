import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { RefreshCw, ShieldAlert } from 'lucide-react'
import { loadSuspensions, refreshSuspensions, resolveSuspension, SUSPENSION_REASONS, type Suspension } from '../lib/discipline'

// Suspensions for one tournament: worked out from confirmed cards, reviewed by
// the organizer. Private to the tournament's organizers (migration 044).
export function DisciplinePanel({ client, tournamentId, canManage, onNotice, onLoaded }: { client: SupabaseClient; tournamentId: string; canManage: boolean; onNotice: (message: string) => void; onLoaded?: (state: { state: 'ready' | 'pending' | 'error'; active: number }) => void }) {
  const [list, setList] = useState<Suspension[] | null>(null)
  const [state, setState] = useState<'ready' | 'pending' | 'error'>('ready')
  const [busy, setBusy] = useState('')
  const [resolving, setResolving] = useState<{ id: string; status: 'served' | 'overturned'; reason: string } | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(() => {
    void loadSuspensions(client, tournamentId).then(result => {
      setList(result.data); setState(result.state)
      onLoaded?.({ state: result.state, active: result.data.filter(item => item.status === 'active').length })
    })
  }, [client, tournamentId, onLoaded])
  useEffect(() => { reload() }, [reload])
  const refresh = async () => {
    setBusy('refresh'); setError('')
    const result = await refreshSuspensions(client, tournamentId)
    setBusy('')
    if (result.error) return setError(result.error)
    onNotice(result.pending ? 'Suspensions become available once the platform owner applies update 044.' : result.added ? `${result.added} new suspension${result.added === 1 ? '' : 's'} from confirmed cards.` : 'Suspensions are up to date.')
    reload()
  }
  const resolve = async () => {
    if (!resolving) return
    setBusy(resolving.id); setError('')
    const result = await resolveSuspension(client, resolving.id, resolving.status, resolving.reason)
    setBusy('')
    if (result.error) return setError(result.error)
    setResolving(null); onNotice(resolving.status === 'served' ? 'Marked as served.' : 'Suspension overturned. The reason is in the audit history.'); reload()
  }
  if (state === 'pending') return <section className="flow-panel"><header><h4><ShieldAlert size={15} /> Suspensions</h4></header><p className="pending-note">Suspensions from red and yellow cards appear once the platform owner applies update 044.</p></section>
  const active = (list ?? []).filter(item => item.status === 'active')
  return <section className="flow-panel" aria-label="Suspensions">
    <header><h4><ShieldAlert size={15} /> Suspensions</h4>{canManage && <button type="button" className="ghost-button" disabled={busy === 'refresh'} onClick={() => void refresh()}><RefreshCw size={13} /> {busy === 'refresh' ? 'Checking…' : 'Check cards'}</button>}</header>
    {state === 'error' ? <p className="form-error" role="alert">Suspensions could not be loaded. <button type="button" className="retry-button" onClick={reload}>Retry</button></p>
      : list === null ? <p className="field-hint">Loading…</p>
        : active.length === 0 ? <p className="empty-note">No player is suspended.</p>
          : <ul className="flow-mini-list">{active.map(item => <li key={item.id}>
            <strong>{item.playerName}</strong> · {SUSPENSION_REASONS[item.reason]} · {item.matchesBanned} match{item.matchesBanned === 1 ? '' : 'es'}
            {canManage && (resolving?.id === item.id
              ? <span className="confirm-group"><input aria-label="Reason" placeholder="Reason" value={resolving.reason} onChange={event => setResolving({ ...resolving, reason: event.target.value })} /><button type="button" className="primary-button" disabled={busy === item.id} onClick={() => void resolve()}>Save</button><button type="button" className="outline-button dark" onClick={() => setResolving(null)}>Cancel</button></span>
              : <span className="button-row compact"><button type="button" className="ghost-button" onClick={() => setResolving({ id: item.id, status: 'served', reason: '' })}>Mark served</button><button type="button" className="ghost-button" onClick={() => setResolving({ id: item.id, status: 'overturned', reason: '' })}>Overturn</button></span>)}
          </li>)}</ul>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}
