import { useEffect, useMemo, useState } from 'react'
import { Gavel, Send } from 'lucide-react'
import { canAppeal, fileProtest, loadProtests, PENDING_046, PROTEST_STATUS_LABELS, PROTEST_STATUS_TONES, withdrawProtest, type Protest } from '../lib/protests'
import { Card, Empty, Pending, Pill } from './HubUi'
import type { TeamCtx } from './TeamHubTabs'

// Team side of protests and appeals (unified plan section 23): a manager files
// a protest for a tournament the team is approved in, follows the organizer's
// decision, may withdraw while it is open and may appeal a decision once.
export function TeamProtests({ ctx }: { ctx: TeamCtx }) {
  const canFile = ctx.access.can('manage_rosters')
  const approved = useMemo(() => ctx.data.entries.filter(entry => entry.application_status === 'approved').map(entry => String(entry.tournament_id)), [ctx.data.entries])
  const [list, setList] = useState<Protest[] | null>(null)
  const [state, setState] = useState<'ready' | 'pending' | 'error'>('ready')
  const [reloadKey, setReloadKey] = useState(0)
  const [form, setForm] = useState<{ tournamentId: string; matchId: string; subject: string; grounds: string; appealOf: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; void loadProtests(ctx.client, { teamId: ctx.teamId }).then(result => { if (active) { setList(result.data); setState(result.state) } }); return () => { active = false } }, [ctx.client, ctx.teamId, reloadKey])

  const tournamentName = (id: string) => ctx.tournaments.get(id)?.name ?? 'Tournament'
  const matchName = (id: string | null) => { if (!id) return null; const match = ctx.matches.find(item => item.id === id); return match ? `vs ${match.opponentName}` : null }
  const start = (appealOf: Protest | null) => {
    setError('')
    setForm(appealOf
      ? { tournamentId: appealOf.tournamentId, matchId: appealOf.matchId ?? '', subject: `Appeal: ${appealOf.subject}`.slice(0, 160), grounds: '', appealOf: appealOf.id }
      : { tournamentId: approved[0] ?? '', matchId: '', subject: '', grounds: '', appealOf: null })
  }
  const send = async () => {
    if (!form) return
    if (!form.tournamentId) return setError('Choose the tournament.')
    setBusy(true); setError('')
    const result = await fileProtest(ctx.client, { tournamentId: form.tournamentId, teamId: ctx.teamId, matchId: form.matchId || null, subject: form.subject, grounds: form.grounds, appealOf: form.appealOf })
    setBusy(false)
    if (result.error) return setError(result.error)
    ctx.notice(form.appealOf ? 'Appeal sent to the tournament organizer.' : 'Protest sent to the tournament organizer.')
    setForm(null); setReloadKey(value => value + 1)
  }
  const withdraw = async (id: string) => {
    const result = await withdrawProtest(ctx.client, id)
    if (result.error) return setError(result.error)
    ctx.notice('Protest withdrawn.'); setReloadKey(value => value + 1)
  }

  const matchesFor = form ? ctx.matches.filter(match => match.tournamentId === form.tournamentId) : []
  return <Card title="Protests and appeals" icon={<Gavel size={15} />}>
    {state === 'pending' ? <Pending>{PENDING_046}</Pending>
      : state === 'error' ? <p className="form-error" role="alert">Protests could not be loaded.</p>
        : list === null ? <p className="pf-hint">Loading…</p>
          : list.length === 0 ? <Empty icon={<Gavel size={22} />}>No protests filed. Use a protest for a formal complaint about a match or decision; for a wrong score, use Report issue on the match instead.</Empty>
            : <ul className="pw-requests">{list.map(item => <li key={item.id}>
              <div className="pw-request-head">
                <span className="pw-request-type">{[item.kind === 'appeal' ? 'Appeal' : 'Protest', tournamentName(item.tournamentId), matchName(item.matchId)].filter(Boolean).join(' · ')}</span>
                <Pill tone={PROTEST_STATUS_TONES[item.status]}>{PROTEST_STATUS_LABELS[item.status]}</Pill>
              </div>
              <strong>{item.subject}</strong>
              <p className="pw-request-message">{item.grounds}</p>
              {item.decision && <p className="pw-request-message"><b>Organizer’s decision:</b> {item.decision}</p>}
              <div className="pw-actions">
                {canFile && ['submitted', 'under_review'].includes(item.status) && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => void withdraw(item.id)}>Withdraw</button>}
                {canFile && canAppeal(item, list) && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => start(item)}>Appeal</button>}
              </div>
            </li>)}</ul>}
    {canFile && state === 'ready' && !form && (approved.length
      ? <div className="pw-actions"><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={() => start(null)}><Gavel size={13} /> File a protest</button></div>
      : <p className="pf-hint">Protests can be filed once the team has an approved entry in a tournament.</p>)}
    {form && <div className="pw-inline-form">
      {!form.appealOf && <label className="pf-field">Tournament<select value={form.tournamentId} onChange={event => setForm({ ...form, tournamentId: event.target.value, matchId: '' })}>{approved.map(id => <option key={id} value={id}>{tournamentName(id)}</option>)}</select></label>}
      {!form.appealOf && <label className="pf-field">Match (optional)<select value={form.matchId} onChange={event => setForm({ ...form, matchId: event.target.value })}><option value="">Not about one match</option>{matchesFor.map(match => <option key={match.id} value={match.id}>{`vs ${match.opponentName}${match.scheduledAt ? ` · ${new Date(match.scheduledAt).toLocaleDateString('en-GB', { timeZone: 'Indian/Maldives', day: 'numeric', month: 'short' })}` : ''}`}</option>)}</select></label>}
      <label className="pf-field">Title<input value={form.subject} maxLength={160} onChange={event => setForm({ ...form, subject: event.target.value })} placeholder="For example: Ineligible player in the second half" /></label>
      <label className="pf-field">Grounds and evidence<textarea rows={4} maxLength={4000} value={form.grounds} onChange={event => setForm({ ...form, grounds: event.target.value })} placeholder="What happened, which rule applies, and what you are asking for. Mention any match sheet, photo or video." /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="pw-actions"><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" disabled={busy} onClick={() => void send()}><Send size={13} /> {busy ? 'Sending…' : form.appealOf ? 'Send appeal' : 'Send protest'}</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => { setForm(null); setError('') }}>Cancel</button></div>
    </div>}
    {!form && error && <p className="form-error" role="alert">{error}</p>}
  </Card>
}
