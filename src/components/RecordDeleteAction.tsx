import { useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Trash2 } from 'lucide-react'
import { deleteManagedRecord, deletionProblem, type DeletionKind } from '../lib/managedDeletion'
import { ReviewDialog } from './ReviewDialog'

export function RecordDeleteAction({ client, kind, id, name, onDeleted, disabled = false }: {
  client: SupabaseClient; kind: DeletionKind; id: string; name: string; onDeleted: () => void; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const submit = async () => {
    if (inFlight.current || disabled) return
    const problem = deletionProblem(name, confirmation)
    if (problem) { setError(problem); return }
    inFlight.current = true; setBusy(true); setError('')
    const result = await deleteManagedRecord(client, kind, id, name, confirmation, '')
    inFlight.current = false; setBusy(false)
    if (result.error) { setError(result.error); return }
    setOpen(false); onDeleted()
  }
  return <><button type="button" className="outline-button dark record-delete-button" title={kind === 'tournament' ? 'Permanently deletes this tournament and ALL its fixtures, entries and setup data. Irreversible.' : 'Only unused, unclaimed player records created within 24 hours can be deleted.'} aria-label={`Delete ${name}`} onClick={() => { setConfirmation(''); setError(''); setOpen(true) }}><Trash2 size={14} aria-hidden="true" /> Delete {kind}</button>
    <ReviewDialog open={open} title={`Delete ${kind}?`} busy={busy} onClose={() => setOpen(false)}>
      <div className="record-delete-body"><p>You are deleting <strong>{name}</strong>. This cannot be undone.</p>
        <p className="field-hint">{kind === 'player' ? 'Only private, unclaimed records created within 24 hours with no linked records can be deleted. Team membership, roster, claim, identity and match history are protected. To remove a squad member, use Remove in the team squad.' : 'Only private draft or setup tournaments without entries, matches, payments or other operational records can be deleted. Setup details will be removed. For an active tournament, use Cancel or Finish & archive.'}</p>
        <label>Type “{name}” to confirm<input value={confirmation} autoComplete="off" disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="button-row"><button type="button" className="outline-button dark" data-dialog-cancel disabled={busy} onClick={() => setOpen(false)}>Keep {kind}</button><button type="button" className="primary-button record-delete-confirm" disabled={busy || disabled || Boolean(deletionProblem(name, confirmation))} onClick={() => void submit()}>{busy ? 'Deleting…' : `Delete ${kind} permanently`}</button></div>
      </div>
    </ReviewDialog></>
}
