import { useState } from 'react'
import type { ReactNode } from 'react'
import { Trash2 } from 'lucide-react'

// One confirmation pattern for every remove/delete/revoke in the workspaces
// (unified plan section 3: destructive changes need a review, ordinary edits
// do not). The first press asks inline; only the second, explicit press acts.
// The action returns an error message or null; errors stay next to the button.
export function ConfirmAction({ label, question, confirmLabel = 'Remove', onConfirm, icon = <Trash2 size={14} aria-hidden="true" />, className = 'ghost-button', disabled = false }: {
  label: string; question: string; confirmLabel?: string; onConfirm: () => Promise<string | null | void>; icon?: ReactNode; className?: string; disabled?: boolean
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!asking) return <button type="button" className={className} disabled={disabled} aria-label={label} onClick={() => { setError(''); setAsking(true) }}>{icon} <span>{label.split(' ')[0]}</span></button>
  const run = async () => {
    setBusy(true); setError('')
    const problem = await onConfirm()
    setBusy(false)
    if (problem) return setError(problem)
    setAsking(false)
  }
  return <span className="confirm-group" role="group" aria-label={question}>
    <span>{question}</span>
    <button type="button" className="primary-button danger" disabled={busy} onClick={() => void run()}>{busy ? 'Working…' : confirmLabel}</button>
    <button type="button" className="outline-button dark" disabled={busy} onClick={() => setAsking(false)}>Keep</button>
    {error ? <span className="form-error" role="alert">{error}</span> : null}
  </span>
}
