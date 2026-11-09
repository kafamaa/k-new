import { useRef, useState } from 'react'
import { ArrowLeft, Check, FileText, Info, Lock, Upload, X } from 'lucide-react'
import { formatFileSize } from '../lib/documents'
import { PRIVATE_FILE_TYPES, PAYMENT_STATUS_LABELS } from '../lib/teamHub'

// Payment proof is selected and reviewed before the existing private-document
// upload runs. This page never treats an upload as a verified payment.
export function TeamPaymentProof({ teamName, tournamentName, paymentStatus, busy, error, onBack, onUpload }: {
  teamName: string; tournamentName: string; paymentStatus: string; busy: boolean; error: string
  onBack: () => void; onUpload: (file: File) => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [problem, setProblem] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const choose = (next?: File) => {
    if (!next) return
    if (!PRIVATE_FILE_TYPES.includes(next.type)) { setProblem('Choose a PDF, PNG or JPG receipt.'); return }
    setProblem(''); setFile(next)
  }
  return <div className="sq-page sq-flow payment-proof-page">
    <header className="payment-proof-heading"><button type="button" className="back-link" disabled={busy} onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Back to applications</button><h1>Upload payment proof</h1><p>Send your receipt for {tournamentName}. The organizer will review it.</p></header>
    <div className="sq-two">
      <section className="sq-card payment-proof-form">
        <h2><Upload size={22} aria-hidden="true" /> Payment receipt</h2>
        <p>Upload a clear image or PDF of your receipt. Follow the organizer’s payment instructions before sending proof.</p>
        <input ref={input} type="file" accept={PRIVATE_FILE_TYPES.join(',')} className="sr-only" aria-label="Payment proof file" disabled={busy} onChange={event => { choose(event.target.files?.[0]); event.target.value = '' }} />
        <button type="button" className="payment-proof-drop" disabled={busy} onClick={() => input.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) choose(event.dataTransfer.files[0]) }}><Upload size={36} aria-hidden="true" /><strong>{file ? 'Choose a different receipt' : 'Choose a receipt or drop it here'}</strong><span>PDF, PNG or JPG · private upload</span></button>
        {file ? <div className="payment-proof-file"><FileText size={26} aria-hidden="true" /><span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span><button type="button" className="ed-icon-btn" disabled={busy} aria-label="Remove selected receipt" onClick={() => setFile(null)}><X size={18} /></button></div> : null}
        <p className="sq-note"><Lock size={18} aria-hidden="true" /> Only authorized reviewers can access this receipt.</p>
        {problem || error ? <p className="form-error" role="alert">{problem || error}</p> : null}
        <footer className="payment-proof-actions"><button type="button" className="ed-btn ed-btn-ghost" disabled={busy} onClick={onBack}>Cancel</button><button type="button" className="ed-btn ed-btn-primary" disabled={!file || busy} onClick={() => file && void onUpload(file)}>{busy ? 'Uploading…' : 'Submit payment proof'} <Upload size={16} aria-hidden="true" /></button></footer>
      </section>
      <aside className="sq-col"><section className="sq-card"><h2 className="sq-card-title">Application summary</h2><dl className="payment-proof-summary"><div><dt>Team</dt><dd>{teamName}</dd></div><div><dt>Tournament</dt><dd>{tournamentName}</dd></div><div><dt>Payment</dt><dd>{PAYMENT_STATUS_LABELS[paymentStatus] ?? paymentStatus.replace(/_/g, ' ')}</dd></div></dl></section><section className="sq-card"><h2 className="sq-card-title"><Info size={22} aria-hidden="true" /> What happens next?</h2><ul className="payment-proof-help"><li><Check size={17} aria-hidden="true" /> Your proof is uploaded privately.</li><li><Check size={17} aria-hidden="true" /> The organizer checks the receipt.</li><li><Check size={17} aria-hidden="true" /> Track the payment status in Applications.</li></ul><p className="sq-muted">Uploading a receipt does not confirm payment or approve your application.</p></section></aside>
    </div>
  </div>
}
