import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { BadgeCheck, Handshake, Trash2, UserPlus } from 'lucide-react'
import { assignMatchOfficial, loadMatchOfficials, loadSponsors, OFFICIAL_ROLES, removeMatchOfficial, saveSponsors, SPONSOR_TIERS, validateSponsor, type MatchOfficial, type Sponsor } from '../lib/tournamentOperations'
import { searchStaffCandidates, type StaffCandidate } from '../lib/staff'
import { ConfirmAction } from './ConfirmAction'

// Sponsors, kept with the tournament after creation (Finance group).
export function SponsorsPanel({ client, user, tournamentId, canManage, onNotice }: { client: SupabaseClient; user: User; tournamentId: string; canManage: boolean; onNotice: (message: string) => void }) {
  const [sponsors, setSponsors] = useState<Sponsor[]>([])
  const [draft, setDraft] = useState<Sponsor>({ name: '', tier: 'Partner', website: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { let active = true; void loadSponsors(client, tournamentId).then(result => { if (!active) return; setSponsors(result.data); if (result.error) setError(result.error) }); return () => { active = false } }, [client, tournamentId])
  const persist = async (next: Sponsor[], message: string) => {
    setBusy(true); setError('')
    const result = await saveSponsors(client, tournamentId, user.id, next)
    setBusy(false)
    if (result.error) return setError(result.error)
    setSponsors(next); onNotice(message)
  }
  const add = async (event: FormEvent) => {
    event.preventDefault()
    const problem = validateSponsor(draft)
    if (problem) return setError(problem)
    await persist([...sponsors, draft], `${draft.name.trim()} added as a sponsor.`)
    setDraft({ name: '', tier: 'Partner', website: '' })
  }
  return <section className="panel-block">
    <h3><Handshake size={16} /> Sponsors</h3>
    {sponsors.length === 0 ? <p className="empty-note">No sponsors recorded for this tournament.</p>
      : <ul className="ws-rows">{sponsors.map((sponsor, index) => <li key={`${sponsor.name}-${index}`}><strong>{sponsor.name}</strong><span>{sponsor.tier}{sponsor.website ? ` · ${sponsor.website}` : ''}</span>{canManage && <button type="button" className="ed-icon-btn" aria-label={`Remove ${sponsor.name}`} disabled={busy} onClick={() => void persist(sponsors.filter((_, i) => i !== index), `${sponsor.name} removed.`)}><Trash2 size={14} /></button>}</li>)}</ul>}
    {canManage && <form className="award-form" onSubmit={add}>
      <label>Sponsor name<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>Tier<select value={draft.tier} onChange={event => setDraft({ ...draft, tier: event.target.value })}>{SPONSOR_TIERS.map(tier => <option key={tier} value={tier}>{tier}</option>)}</select></label>
      <label>Website (optional)<input value={draft.website} onChange={event => setDraft({ ...draft, website: event.target.value })} placeholder="https://" /></label>
      <button type="submit" className="primary-button" disabled={busy}>Add sponsor</button>
    </form>}
    {error && <div className="form-error" role="alert">{error}</div>}
  </section>
}

// Match officials for one match (Operations group). People are found by their
// published player profile name; the assignment grants match-center access to
// that match only.
export function MatchOfficialsPanel({ client, user, matchId, canManage, onNotice }: { client: SupabaseClient; user: User; matchId: string; canManage: boolean; onNotice: (message: string) => void }) {
  const [officials, setOfficials] = useState<MatchOfficial[]>([])
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<StaffCandidate[]>([])
  const [role, setRole] = useState<string>('official')
  const [error, setError] = useState('')
  const reload = useCallback(() => { void loadMatchOfficials(client, [matchId]).then(result => { setOfficials(result.data); if (result.error) setError(result.error) }) }, [client, matchId])
  useEffect(() => { reload() }, [reload])
  const search = async () => { const result = await searchStaffCandidates(client, query); setCandidates(result.candidates); if (result.error) setError(result.error) }
  const assign = async (candidate: StaffCandidate) => {
    const result = await assignMatchOfficial(client, matchId, candidate.accountId, role, user.id)
    if (result.error) return setError(result.error)
    onNotice(`${candidate.name} assigned to this match.`); setCandidates([]); setQuery(''); reload()
  }
  const remove = async (official: MatchOfficial) => { const result = await removeMatchOfficial(client, matchId, official.userId, official.role); if (result.error) return setError(result.error); reload() }
  return <div className="match-officials">
    <strong><BadgeCheck size={14} /> Officials</strong>
    {officials.length === 0 ? <small>No official assigned. Assigned officials record events and submit the result.</small>
      : <ul className="plain-list">{officials.map(official => <li key={`${official.userId}-${official.role}`}>{official.name ?? 'Account without a public profile'} · {OFFICIAL_ROLES.find(item => item.value === official.role)?.label ?? official.role}{canManage && <ConfirmAction label="Remove official" question="Remove this official from the match?" onConfirm={async () => { await remove(official) }} />}</li>)}</ul>}
    {canManage && <div className="award-player">
      <label>Find person<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name on their public profile" /></label>
      <label>Role<select value={role} onChange={event => setRole(event.target.value)}>{OFFICIAL_ROLES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <button type="button" className="outline-button dark" onClick={() => void search()}><UserPlus size={14} /> Search</button>
    </div>}
    {candidates.length > 0 && <ul className="plain-list">{candidates.map(candidate => <li key={candidate.accountId}>{candidate.name}<button type="button" className="ghost-button" onClick={() => void assign(candidate)}>Assign</button></li>)}</ul>}
    {error && <div className="form-error" role="alert">{error}</div>}
  </div>
}
