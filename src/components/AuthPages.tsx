import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, Compass, KeyRound, MailCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { authProblem, PASSWORD_RULE, passwordProblem } from '../lib/authFlow'

// Opened from the password-recovery email. Supabase signs the visitor in with
// a short recovery session; this page sets the new password with it.
export function ResetPasswordPage({ onNotice }: { onNotice: (message: string) => void }) {
  const [ready, setReady] = useState<'checking' | 'ready' | 'missing'>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { document.title = 'Reset password · Kulhivaru+' }, [])
  useEffect(() => {
    if (!supabase) { setReady('missing'); return }
    let active = true
    // The session from the email link may arrive a moment after the page.
    const check = () => void supabase!.auth.getSession().then(({ data }) => { if (active) setReady(data.session ? 'ready' : 'missing') })
    check()
    const { data } = supabase.auth.onAuthStateChange(event => { if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') check() })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const problem = passwordProblem(password, confirm)
    if (problem) return setError(problem)
    if (!supabase) return
    setBusy(true); setError('')
    const result = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (result.error) return setError(authProblem(result.error.message).message)
    setPassword(''); setConfirm('')
    onNotice('Your password was changed. You are signed in.')
    window.location.hash = '#workspace'
  }
  return <section className="ed-page acc-page auth-page auth-split">
    <div className="auth-photo" aria-hidden="true"><img src={`${import.meta.env.BASE_URL}assets/covers/auth-photo.jpg`} alt="" width={711} height={486} /><p className="auth-photo-title">A fresh start.</p><p className="auth-photo-text">Get back to your sporting community.</p></div>
    <div className="auth-form-col">
    <header className="ed-page-head auth-split-head"><span className="auth-split-icon" aria-hidden="true"><KeyRound size={30} /></span><h1>Set a new password</h1><p>Choose a strong password for your account.</p></header>
    {ready === 'checking' ? <div className="loading-state" role="status">Checking your reset link…</div>
      : ready === 'missing' ? <div className="pf-card"><p>This reset link has expired, was already used, or was opened in a different browser.</p><p className="pf-hint">Request a new one from Sign in → Forgot your password.</p><a className="ed-btn ed-btn-primary" href="#home">Back to Kulhivaru+</a></div>
        : <form className="pf-card" onSubmit={submit}>
          <header className="pf-card-head"><span className="pf-card-icon"><KeyRound size={18} /></span><div><h3>New password</h3><p>{PASSWORD_RULE}</p></div></header>
          <label className="pf-field">New password<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
          <label className="pf-field">Repeat new password<input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <footer className="pf-card-foot"><button type="submit" className="ed-btn ed-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button></footer>
          <p className="auth-split-note">After resetting, you stay signed in with your new password.</p>
        </form>}
    </div>
  </section>
}

// Shown after sign-up: what happens next, and a way to resend the email.
export function VerifyEmailNotice({ email, onResend }: { email: string; onResend: () => Promise<string | null> }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  return <div className="auth-verify" role="status">
    <MailCheck size={28} aria-hidden="true" />
    <p><strong>Check your email.</strong> We sent a confirmation link to {email}. Open it to finish creating your account.</p>
    <button type="button" className="switch-auth" disabled={busy} onClick={() => { setBusy(true); void onResend().then(error => { setBusy(false); setMessage(error ?? 'Sent again. It can take a minute to arrive; check spam too.') }) }}>{busy ? 'Sending…' : 'Send the email again'}</button>
    {message && <p className="pf-hint">{message}</p>}
  </div>
}

// A link that does not match any page.
export function NotFoundPage() {
  useEffect(() => { document.title = 'Page not found · Kulhivaru+' }, [])
  return <section className="ed-page not-found-page">
    <Compass size={40} aria-hidden="true" />
    <h1>Page not found</h1>
    <p>This link does not match any page. It may be mistyped, or the record may no longer be public.</p>
    <div className="button-row"><a className="ed-btn ed-btn-primary" href="#home"><ArrowLeft size={15} /> Go to Home</a><a className="ed-btn ed-btn-ghost" href="#search">Search Kulhivaru+</a></div>
  </section>
}
