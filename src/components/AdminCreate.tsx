import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Building2, ShieldCheck, Trophy, UserPlus, Users } from 'lucide-react'
import { createOrganizationFor, createPlayerFor, createTeamFor, createTournamentFor, loadDirectory, searchAccounts } from '../lib/superAdmin'
import { registerIdentity } from '../lib/identity'
import { SPORT_NAMES } from '../lib/display'
import { AdminNote } from './AdminParts'

// Create on behalf (final specification, Super Admin). An authorized administrator
// creates an organization, team, tournament or unclaimed player for its owner. The
// database checks the permission, a reason (5+ characters) and a recent sign-in, and
// writes an audit event. Nothing is ever deleted from here.
type Kind = 'organization' | 'team' | 'tournament' | 'player'
const KINDS: Array<[Kind, string, typeof Building2]> = [['organization', 'Organization', Building2], ['team', 'Team', Users], ['tournament', 'Tournament', Trophy], ['player', 'Player', UserPlus]]

// Search instead of a long list: accounts by name/email, organizations by name.
function Picker({ label, kind, client, value, onChange }: { label: string; kind: 'account' | 'organization'; client: SupabaseClient; value: { id: string; text: string } | null; onChange: (value: { id: string; text: string } | null) => void }) {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<Array<{ id: string; text: string }>>([])
  useEffect(() => {
    if (query.trim().length < 2) { setOptions([]); return }
    let active = true
    const timer = window.setTimeout(() => {
      const load = kind === 'account'
        ? searchAccounts(client, query.trim(), 0).then(result => result.data.slice(0, 6).map(row => ({ id: row.id, text: `${row.display_name || 'Unnamed account'} · ${row.email}` })))
        : loadDirectory(client, 'organization', query.trim(), 'all', 0).then(result => result.data.slice(0, 6).map(row => ({ id: row.id, text: row.label })))
      void load.then(rows => { if (active) setOptions(rows) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [client, kind, query])
  if (value) return <p className="adm-hint">{label}: <strong>{value.text}</strong> <button type="button" className="ed-link-btn" onClick={() => onChange(null)}>Change</button></p>
  return <div className="adm-picker">
    <label>{label}<input type="search" value={query} autoComplete="off" placeholder={kind === 'account' ? 'Search name or email' : 'Search organization'} onChange={event => setQuery(event.target.value)} /></label>
    {options.length > 0 && <ul className="adm-picker-list">{options.map(option => <li key={option.id}><button type="button" className="ed-link-btn" onClick={() => { onChange(option); setQuery(''); setOptions([]) }}>{option.text}</button></li>)}</ul>}
  </div>
}

export function CreateOnBehalfPage({ client, onNotice }: { client: SupabaseClient; onNotice: (message: string) => void }) {
  const [kind, setKind] = useState<Kind>('organization')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [island, setIsland] = useState('')
  const [teamType, setTeamType] = useState('club')
  const [sport, setSport] = useState('football')
  const [nationalId, setNationalId] = useState('')
  const [person, setPerson] = useState<{ id: string; text: string } | null>(null)
  const [organization, setOrganization] = useState<{ id: string; text: string } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<{ kind: Kind; name: string } | null>(null)
  const reset = () => { setName(''); setDescription(''); setIsland(''); setNationalId(''); setPerson(null); setOrganization(null); setReason(''); setError('') }

  const submit = async () => {
    setError(''); setCreated(null)
    if (name.trim().length < 2) return setError('Enter a name.')
    if (reason.trim().length < 5) return setError('Explain why you are creating this (at least 5 characters). It is kept in the audit log.')
    if (kind === 'tournament' && !organization) return setError('Choose the organization that will run this tournament.')
    setBusy(true)
    const result = kind === 'organization' ? await createOrganizationFor(client, { name, description, owner: person?.id ?? null, reason })
      : kind === 'team' ? await createTeamFor(client, { name, teamType, island, organization: organization?.id ?? null, manager: person?.id ?? null, reason })
        : kind === 'tournament' ? await createTournamentFor(client, { organization: organization!.id, name, sport, reason })
          : await createPlayerFor(client, { name, island, reason })
    if (result.error || !result.data) { setBusy(false); return setError(result.error ?? 'The record could not be created.') }
    // A player's ID card goes to the private identity check; the number is never kept here.
    if (kind === 'player' && nationalId.trim()) {
      const identity = await registerIdentity(client, result.data, { identifierType: 'maldivian_national_id', value: nationalId })
      setNationalId('')
      if (identity.status !== 'registered' && identity.status !== 'already_registered') { setBusy(false); setCreated({ kind, name: name.trim() }); onNotice('Player created. The ID card was not registered.'); return setError(`${identity.message} The player record was created without it; an identity reviewer can link it later.`) }
    }
    setBusy(false)
    setCreated({ kind, name: name.trim() }); onNotice(`${KINDS.find(item => item[0] === kind)![1]} created and recorded in the audit log.`)
    reset()
  }

  return <div className="adm-stack">
    <p className="adm-intro">Create records for organizations, teams and players who are not yet on Kulhivaru+. Each creation needs a reason and a recent sign-in, and is written to the audit log. Owners and managers can be assigned now or invited later; players are created unclaimed and can claim their record later without losing history.</p>
    <div className="pw-subtabs" role="tablist" aria-label="What to create">{KINDS.map(([id, label, Icon]) => <button type="button" role="tab" key={id} aria-selected={kind === id} className={kind === id ? 'active' : ''} onClick={() => { setKind(id); reset(); setCreated(null) }}><Icon size={14} aria-hidden="true" /> {label}</button>)}</div>
    <section className="ed-panel admin-form">
      <label>{kind === 'player' ? 'Player’s full name' : 'Name'}<input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label>
      {kind === 'organization' && <>
        <label>Short description (optional)<textarea rows={2} maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></label>
        <Picker label="Owner account (optional)" kind="account" client={client} value={person} onChange={setPerson} />
      </>}
      {kind === 'team' && <>
        <div className="admin-row"><label>Team type<select value={teamType} onChange={event => setTeamType(event.target.value)}><option value="club">Club</option><option value="island">Island</option><option value="national">National</option><option value="school">School</option><option value="other">Other</option></select></label><label>Island (optional)<input value={island} list="kv-islands" maxLength={80} onChange={event => setIsland(event.target.value)} /></label></div>
        <Picker label="Organization (optional)" kind="organization" client={client} value={organization} onChange={setOrganization} />
        <Picker label="Manager account (optional)" kind="account" client={client} value={person} onChange={setPerson} />
      </>}
      {kind === 'tournament' && <>
        <Picker label="Organization" kind="organization" client={client} value={organization} onChange={setOrganization} />
        <label>Sport<select value={sport} onChange={event => setSport(event.target.value)}>{Object.entries(SPORT_NAMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <p className="adm-hint">Created as a draft. The organization’s owners finish setup in their workspace.</p>
      </>}
      {kind === 'player' && <>
        <label>Island (optional)<input value={island} list="kv-islands" maxLength={80} onChange={event => setIsland(event.target.value)} /></label>
        <label>Maldivian ID card (recommended, private)<input type="password" value={nationalId} autoComplete="off" spellCheck={false} placeholder="A123456" onChange={event => setNationalId(event.target.value)} /></label>
        <p className="adm-hint"><ShieldCheck size={13} /> The ID card is checked privately; only a protected digest is kept, so the same person is never created twice.</p>
      </>}
      <label>Reason (kept in the audit log)<textarea rows={2} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder="e.g. Atoll council asked us to set up their league" /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {created && <p className="publication-notice" role="status">{created.name} was created. Find it under Sports or People to publish, assign or hand it over.</p>}
      <div className="button-row compact"><button type="button" className="ed-btn ed-btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Creating…' : `Create ${KINDS.find(item => item[0] === kind)![1].toLowerCase()}`}</button></div>
    </section>
    <AdminNote>Records created here start unpublished. Their owners publish them from their own workspace once they are ready.</AdminNote>
  </div>
}
