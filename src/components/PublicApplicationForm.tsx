import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Check, ClipboardList } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { loadApplicationQuestions, loadManagedTeams, submitApplication, validateApplicationValues, applicationStatusLabel } from '../lib/registration'
import { registrationFormFields } from '../lib/tournament'
import type { RegistrationQuestion } from '../lib/tournament'
import { saveReturnDestination } from '../lib/returnDestination'

export function PublicApplicationForm({ tournamentId, tournamentSlug, registrationState, onNotice }: { tournamentId: string; tournamentSlug: string; registrationState: string; onNotice?: (message: string) => void }) {
  const [sessionUser, setSessionUser] = useState<{ id: string; email: string | null } | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [questions, setQuestions] = useState<RegistrationQuestion[] | null>(null)
  const [questionsError, setQuestionsError] = useState('')
  const [teams, setTeams] = useState<Array<{ id: string; name: string; slug: string; teamType: string; island: string }>>([])
  const [teamsError, setTeamsError] = useState('')
  const [teamId, setTeamId] = useState('')
  const [values, setValues] = useState<Record<string, string | number | boolean>>({})
  const [existingStatus, setExistingStatus] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState<{ entryId: string; status: 'submitted' | 'already_submitted' | 'draft_resubmitted' } | null>(null)
  const [reviewing, setReviewing] = useState(false)

  const fields = useMemo(() => registrationFormFields(questions ?? []), [questions])

  useEffect(() => {
    // The signed-in (persisted) client is required here: the public client
    // never keeps a session, so it could never see the team manager.
    const client = supabase
    if (!client) { setSessionChecked(true); return }
    let active = true
    const establish = async () => {
      const current = await client.auth.getSession()
      if (!active) return
      if (current.error) setSessionExpired(true)
      const user = current.data.session?.user
      if (user) setSessionUser({ id: user.id, email: user.email ?? null })
      setSessionChecked(true)
    }
    void establish()
    const subscription = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      const user = session?.user
      if (user) { setSessionUser({ id: user.id, email: user.email ?? null }); setSessionExpired(false) }
      else setSessionUser(null)
    })
    return () => { active = false; subscription.data.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!sessionUser) return
    const client = supabase
    if (!client) return
    let active = true
    void loadApplicationQuestions(client, tournamentId).then(r => {
      if (!active) return
      if (r.error) setQuestionsError(r.error)
      else setQuestions(r.questions)
    })
    void loadManagedTeams(client, sessionUser.id).then(r => {
      if (!active) return
      if (r.error) setTeamsError(r.error)
      else { setTeams(r.data); if (r.data.length) setTeamId(r.data[0].id) }
    })
    return () => { active = false }
  }, [sessionUser, tournamentId])

  useEffect(() => {
    if (!sessionUser || !teamId) { setExistingStatus(null); return }
    const client = supabase
    if (!client) return
    let active = true
    void client.from('tournament_entries').select('application_status').eq('tournament_id', tournamentId).eq('team_id', teamId).maybeSingle().then(r => {
      if (!active) return
      if (r.error) return
      setExistingStatus(r.data ? String(r.data.application_status ?? '') : null)
    })
    return () => { active = false }
  }, [sessionUser, teamId, tournamentId])

  if (registrationState !== 'open') return null

  if (sessionExpired) {
    return <div className="application-panel">
      <h4>Sign in again</h4>
      <p>Your session expired. Sign in again to continue the registration; your return destination is preserved.</p>
      <a className="primary-button small" href="#workspace">Sign in again <ArrowRight size={13} /></a>
    </div>
  }

  if (!sessionChecked) return <div className="loading-state">Checking your sign-in…</div>

  if (!sessionUser) {
    return <div className="application-panel">
      <h4>Apply as a team manager</h4>
      <p>Sign in to apply with a team you manage. One account may manage several teams; the application window and any required documents are shown above.</p>
      <a className="primary-button small" href="#workspace" onClick={() => saveReturnDestination({ tournamentSlug, tournamentId })}>Sign in to apply <ArrowRight size={13} /></a>
    </div>
  }

  if (teamsError) return <div className="form-error" role="alert">Your managed teams could not be loaded: {teamsError}</div>
  if (teams.length === 0) return <div className="application-panel">
    <h4>Apply as a team manager</h4>
    <p>You do not manage any team yet. Create a team in your workspace, then return to apply here.</p>
    <a className="outline-button dark" href="#workspace">Open your workspace <ArrowRight size={13} /></a>
  </div>

  if (questionsError) return <div className="form-error" role="alert">The registration form could not be loaded: {questionsError}</div>
  if (questions === null) return <div className="loading-state">Loading the registration form…</div>

  if (existingStatus && ['submitted', 'under_review', 'approved', 'rejected', 'withdrawn', 'waitlisted'].includes(existingStatus)) {
    return <div className="application-panel">
      <h4>Application status: {applicationStatusLabel(existingStatus)}</h4>
      <p>{existingStatus === 'submitted' ? 'Your application is submitted and waiting for organizer review.' : existingStatus === 'under_review' ? 'The organizer is reviewing your application.' : existingStatus === 'approved' ? 'Your application is approved. Open your team workspace to build and submit the roster.' : existingStatus === 'waitlisted' ? 'Your application is on the waitlist. The tournament is full; the organizer approves waitlisted teams in order if a place becomes free, and your team workspace shows any change.' : existingStatus === 'rejected' ? 'Your application was rejected. Contact the organizer through the tournament page for the permitted next action.' : 'Your application was withdrawn.'}</p>
      {existingStatus === 'approved' ? <a className="outline-button dark" href="#workspace">Open team workspace <ArrowRight size={13} /></a> : null}
    </div>
  }

  if (result) {
    return <div className="application-panel">
      <h4>Application {applicationStatusLabel(result.status === 'already_submitted' ? 'submitted' : result.status === 'draft_resubmitted' ? 'submitted' : 'submitted')}</h4>
      <p>{result.status === 'already_submitted' ? 'This team already has an application in this tournament.' : result.status === 'draft_resubmitted' ? 'Your saved draft was submitted. Watch the Applications section of your team workspace for the organizer review.' : 'Your application was submitted. Watch the Applications section of your team workspace for the organizer review.'}</p>
      <a className="outline-button dark" href="#workspace">Open your workspace <ArrowRight size={13} /></a>
    </div>
  }

  const { problems } = validateApplicationValues(fields, values)

  return <form className="application-panel" onSubmit={async (event: FormEvent) => {
    event.preventDefault()
    if (!teamId) return setSubmitError('Select the team that is applying.')
    if (Object.keys(problems).length) return setSubmitError('Complete the required fields before continuing.')
    if (!reviewing) { setSubmitError(''); setReviewing(true); return }
    setSubmitting(true); setSubmitError('')
    const outcome = await submitApplication(supabase!, {
      tournamentId, teamId, userId: sessionUser.id, questions, fields, values,
    })
    setSubmitting(false)
    if (outcome.error) return setSubmitError(outcome.error)
    setResult({ entryId: outcome.entryId!, status: outcome.status! })
    if (onNotice) onNotice(outcome.status === 'already_submitted' ? 'This team already applied.' : 'Application submitted.')
  }}>
    <ol className="registration-form-steps" aria-label="Application progress"><li className={reviewing ? 'done' : 'active'} aria-current={!reviewing ? 'step' : undefined}><span>{reviewing ? <Check size={16} aria-hidden="true" /> : 1}</span> Team details</li><li className={reviewing ? 'active' : ''} aria-current={reviewing ? 'step' : undefined}><span>2</span> Review & submit</li></ol>
    <h4>{reviewing ? 'Review your application' : 'Team details'}</h4>
    <p>{reviewing ? 'Check these details before sending your application to the organizer.' : 'Select your team and complete the information requested by the organizer.'}</p>
    {existingStatus ? <div className="public-home-warning">This team already has an application in this tournament (status: {applicationStatusLabel(existingStatus)}). Submitting is disabled.</div> : null}
    {reviewing ? <section className="registration-review" aria-label="Application summary"><h3><ClipboardList size={20} aria-hidden="true" /> Application summary</h3><dl><div><dt>Team</dt><dd>{teams.find(team => team.id === teamId)?.name}</dd></div>{fields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{typeof values[field.key] === 'boolean' ? values[field.key] ? 'Yes' : 'No' : String(values[field.key] ?? '').trim() || 'Not provided'}</dd></div>)}</dl><p>Submitting sends an application for review. It does not automatically approve your team or roster.</p></section> : <>
    <label>Team applying<select aria-label="Team applying" value={teamId} onChange={event => { setTeamId(event.target.value); setReviewing(false) }}>{teams.map(team => <option value={team.id} key={team.id}>{team.name}{team.island ? ` · ${team.island}` : ''}</option>)}</select></label>
    {fields.length ? fields.map(field => {
      const error = problems[field.key]
      return <label key={field.key}>
        {field.label}{field.required ? ' *' : ''}
        {field.kind === 'long_text'
          ? <textarea aria-label={field.label} value={String(values[field.key] ?? '')} onChange={event => setValues({ ...values, [field.key]: event.target.value })} />
          : field.kind === 'number'
            ? <input type="number" value={String(values[field.key] ?? '')} onChange={event => setValues({ ...values, [field.key]: event.target.value })} />
            : field.kind === 'date'
              ? <input type="date" value={String(values[field.key] ?? '')} onChange={event => setValues({ ...values, [field.key]: event.target.value })} />
              : field.kind === 'checkbox'
                ? <input type="checkbox" checked={Boolean(values[field.key])} onChange={event => setValues({ ...values, [field.key]: event.target.checked })} />
                : field.kind === 'select'
                  ? <select aria-label={field.label} value={String(values[field.key] ?? '')} onChange={event => setValues({ ...values, [field.key]: event.target.value })}>
                      <option value="">Select…</option>{field.options.map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                  : <input value={String(values[field.key] ?? '')} onChange={event => setValues({ ...values, [field.key]: event.target.value })} />}
        {field.instructions ? <small>{field.instructions}</small> : null}
        {error ? <small className="form-error-inline">{error}</small> : null}
      </label>
    }) : <small>The organizer has not added any custom questions to this form.</small>}</>}
    {submitError && <div className="form-error" role="alert">{submitError}</div>}
    <div className="button-row">
      {reviewing ? <button type="button" className="ed-btn ed-btn-ghost" disabled={submitting} onClick={() => setReviewing(false)}><ArrowLeft size={16} aria-hidden="true" /> Edit details</button> : null}
      <button type="submit" className="primary-button" disabled={submitting || Boolean(existingStatus) || Object.keys(problems).length > 0}>{submitting ? 'Submitting…' : reviewing ? 'Submit application' : 'Continue to review'} <ArrowRight size={16} aria-hidden="true" /></button>
    </div>
  </form>
}
