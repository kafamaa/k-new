import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Info, RotateCw } from 'lucide-react'

// Building blocks shared by the Super Admin pages.

// Every privileged action asks for a reason first. onConfirm returns an error
// message (shown inline) or null when the action succeeded.
export function ReasonAction({ label, confirmLabel, tone = 'ghost', hint, children, onConfirm, disabled }: {
  label: string; confirmLabel?: string; tone?: 'ghost' | 'primary' | 'danger'; hint?: string; children?: ReactNode; disabled?: boolean
  onConfirm: (reason: string) => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const id = useId()
  const buttonClass = tone === 'primary' ? 'ed-btn ed-btn-primary ed-btn-sm' : tone === 'danger' ? 'ed-btn ed-btn-sm adm-danger' : 'ed-btn ed-btn-ghost ed-btn-sm'
  if (!open) return <button type="button" className={buttonClass} disabled={disabled} onClick={() => { setOpen(true); setError('') }}>{label}</button>
  const submit = async () => {
    if (reason.trim().length < 5) return setError('Enter a reason of at least 5 characters.')
    setBusy(true); setError('')
    const problem = await onConfirm(reason.trim())
    setBusy(false)
    if (problem) return setError(problem)
    setOpen(false); setReason('')
  }
  return <div className="adm-reason" role="group" aria-labelledby={`${id}-label`}>
    <label id={`${id}-label`} htmlFor={`${id}-text`}>{label}: reason (kept in the audit log)</label>
    {hint ? <p className="adm-hint">{hint}</p> : null}
    {children}
    <textarea id={`${id}-text`} rows={2} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} autoFocus />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="button-row compact">
      <button type="button" className={tone === 'danger' ? 'ed-btn ed-btn-sm adm-danger' : 'ed-btn ed-btn-primary ed-btn-sm'} disabled={busy} onClick={() => void submit()}>{busy ? 'Working…' : confirmLabel ?? label}</button>
      <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={busy} onClick={() => { setOpen(false); setReason(''); setError('') }}>Cancel</button>
    </div>
  </div>
}

export function AdminPager({ page, total, size, onPage, label = 'Pages' }: { page: number; total: number; size: number; onPage: (page: number) => void; label?: string }) {
  const pages = Math.max(1, Math.ceil(total / size))
  if (total <= size) return null
  return <nav className="adm-pager" aria-label={label}>
    <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft size={15} /> Previous</button>
    <span aria-live="polite">Page {page + 1} of {pages} · {total} total</span>
    <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next <ChevronRight size={15} /></button>
  </nav>
}

export function AdminLoading({ rows = 4 }: { rows?: number }) {
  return <div className="adm-skeleton" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, index) => <span key={index} />)}</div>
}

export function AdminError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="form-error adm-error" role="alert"><AlertTriangle size={16} aria-hidden="true" /> <span>{message}</span>{onRetry ? <button type="button" className="retry-button" onClick={onRetry}><RotateCw size={14} /> Retry</button> : null}</div>
}

export function AdminNote({ children }: { children: ReactNode }) {
  return <p className="pending-note adm-note"><Info size={15} aria-hidden="true" /> <span>{children}</span></p>
}

export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'info'; children: ReactNode }) {
  return <span className={`adm-pill adm-pill-${tone}`}>{children}</span>
}

export function AdminEmpty({ children }: { children: ReactNode }) {
  return <p className="lp-empty adm-empty">{children}</p>
}
