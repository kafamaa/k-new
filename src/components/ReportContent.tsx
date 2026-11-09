import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Flag, X } from 'lucide-react'
import { REPORT_REASONS, submitContentReport, type ReportEntity, type ReportReason } from '../lib/landing'
import { supabase } from '../lib/supabase'

// "Report" on a public record. It never edits the record: it files a private
// moderation request that only platform admins read. Reporters sign in so
// repeated submissions can be limited; their identity is never shown publicly.
export function ReportButton({ entity, refId, label }: { entity: ReportEntity; refId: string; label: string }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm lp-report-btn" onClick={() => setOpen(true)}><Flag size={14} /> Report</button>
    {open && <ReportDialog entity={entity} refId={refId} label={label} onClose={() => setOpen(false)} />}
  </>
}

function ReportDialog({ entity, refId, label, onClose }: { entity: ReportEntity; refId: string; label: string; onClose: () => void }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [reason, setReason] = useState<ReportReason>('incorrect_information')
  const [details, setDetails] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!supabase) { setSignedIn(false); return } void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session))) }, [])
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onClose])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!supabase) return
    setBusy(true); setError('')
    const result = await submitContentReport(supabase, { entity, ref: refId, label, reason, details })
    setBusy(false)
    if (result.error) setError(result.error); else setSent(true)
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="modal lp-report" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><X /></button>
      <h2 id="report-title">Report “{label}”</h2>
      {sent ? <><p>Thank you. Your report was sent privately to the Kulhivaru+ team. The public record does not change until it is reviewed.</p><button type="button" className="primary-button full" onClick={onClose}>Done</button></>
        : signedIn === false ? <><p>Sign in to send a report. This keeps reports accountable and stops repeated submissions. Your name is never shown publicly.</p><button type="button" className="primary-button full" onClick={onClose}>Close and sign in from the header</button></>
          : <form onSubmit={submit}>
            <p>Reports are private. They do not change the record; the team reviews them first.</p>
            <fieldset className="lp-report-reasons"><legend>What is wrong?</legend>{REPORT_REASONS.map(option => <label key={option.value}><input type="radio" name="reason" value={option.value} checked={reason === option.value} onChange={() => setReason(option.value)} /> {option.label}</label>)}</fieldset>
            <label>Details {reason === 'other' ? '(required)' : '(optional)'}<textarea value={details} maxLength={1000} rows={4} onChange={event => setDetails(event.target.value)} placeholder="What should be checked? Do not include ID numbers or private contact details." /></label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button type="submit" className="primary-button full" disabled={busy || signedIn === null}>{busy ? 'Sending…' : 'Send private report'}</button>
          </form>}
    </section>
  </div>
}
