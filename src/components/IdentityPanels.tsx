import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ManagedPlayerEditor } from './OrganizerPeopleTabs'
import { RecordDeleteAction } from './RecordDeleteAction'
import { Fingerprint, Lock, ShieldCheck, UserRoundCheck } from 'lucide-react'
import {
  activeGuardianScopes, GUARDIAN_RELATIONSHIP_LABELS, guardianError, loadGuardianApprovals, loadIdentityStatus, recordGuardianApproval,
  registerIdentity, revokeGuardianApproval, setPlayerMinor, type GuardianApproval, type GuardianRelationship, type IdentityOutcome,
} from '../lib/identity'
import { ConfirmAction } from './ConfirmAction'

// Identity check. The typed number leaves this component only inside the
// request to the trusted Edge Function and is cleared straight afterwards.
export function IdentityCheckPanel({ client, playerId, onNotice }: { client: SupabaseClient; playerId: string; onNotice: (message: string) => void }) {
  const [status, setStatus] = useState<'registered' | 'not_registered' | 'unavailable' | null>(null)
  const [type, setType] = useState<'maldivian_national_id' | 'foreign_document'>('maldivian_national_id')
  const [value, setValue] = useState('')
  const [documentType, setDocumentType] = useState('passport')
  const [country, setCountry] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { let active = true; void loadIdentityStatus(client, playerId).then(next => { if (active) setStatus(next) }); return () => { active = false } }, [client, playerId])

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('')
    const outcome = await registerIdentity(client, playerId, { identifierType: type, value, documentType, issuingCountry: country })
    setBusy(false); setValue('')
    setMessage(outcome.message)
    if (outcome.status === 'registered' || outcome.status === 'already_registered') { setStatus('registered'); onNotice(outcome.message) }
  }

  return <section className="player-card-section identity-panel">
    <h4><Fingerprint size={15} /> Identity check</h4>
    <p>Your ID number is used only to prevent duplicate accounts and to match a record an organizer already created for you. It is turned into a protected digest on the server and is never stored, shown, or shared. This is not a government-registry verification.</p>
    {status === 'registered' ? <p className="status-pill status-ok">Identity registered</p>
      : status === 'unavailable' ? <small>Identity status could not be read (migration 026 may not be applied yet).</small>
        : <form className="identity-form" onSubmit={submit}>
          <label>Document<select value={type} onChange={event => setType(event.target.value as typeof type)}><option value="maldivian_national_id">Maldivian ID card</option><option value="foreign_document">Foreign document</option></select></label>
          {type === 'foreign_document' && <>
            <label>Document type<select value={documentType} onChange={event => setDocumentType(event.target.value)}><option value="passport">Passport</option><option value="national_id">National ID</option><option value="residence_permit">Residence permit</option></select></label>
            <label>Issuing country (2 letters)<input value={country} maxLength={2} onChange={event => setCountry(event.target.value.toUpperCase())} placeholder="IN" /></label>
          </>}
          <label>{type === 'maldivian_national_id' ? 'ID card number' : 'Document number'}<input value={value} autoComplete="off" onChange={event => setValue(event.target.value)} placeholder={type === 'maldivian_national_id' ? 'A123456' : ''} /></label>
          <button type="submit" className="primary-button" disabled={busy || !value.trim()}>{busy ? 'Checking…' : 'Register identity'}</button>
        </form>}
    {message && <div className={status === 'registered' ? 'field-hint' : 'warning'} role="status">{message}</div>}
  </section>
}

// Minor flag and guardian approvals for a record this account created.
export function GuardianPanel({ client, userId, playerId, onNotice }: { client: SupabaseClient; userId: string; playerId: string; onNotice: (message: string) => void }) {
  const [isMinor, setIsMinor] = useState(false)
  const [approvals, setApprovals] = useState<GuardianApproval[]>([])
  const [error, setError] = useState('')
  const [form, setForm] = useState({ guardianName: '', relationship: 'parent' as GuardianRelationship, contact: '', approvesClaim: true, approvesPublicProfile: false, note: '' })
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    void client.from('player_profiles').select('is_minor').eq('id', playerId).maybeSingle().then(result => { if (result.error) setError(guardianError(result.error.message)); else setIsMinor(result.data?.is_minor === true) })
    void loadGuardianApprovals(client, playerId).then(result => { setApprovals(result.data); if (result.error) setError(guardianError(result.error)) })
  }, [client, playerId])
  useEffect(() => { reload() }, [reload])
  const scopes = activeGuardianScopes(approvals)

  const toggleMinor = async (next: boolean) => {
    const result = await setPlayerMinor(client, playerId, next)
    if (result.error) return setError(result.error)
    setIsMinor(next); setError('')
    onNotice(next ? 'Marked as a minor. A guardian must approve before the profile is claimed or made public.' : 'Minor flag removed.')
  }
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    const result = await recordGuardianApproval(client, { playerId, userId, ...form })
    setBusy(false)
    if (result.error) return setError(result.error)
    onNotice('Guardian approval recorded.')
    setForm({ ...form, guardianName: '', contact: '', note: '' })
    reload()
  }
  const revoke = async (id: string) => { const result = await revokeGuardianApproval(client, id, userId); if (result.error) return setError(result.error); reload() }

  return <section className="player-card-section guardian-panel">
    <h4><UserRoundCheck size={15} /> Minor and guardian approval</h4>
    <label className="checkbox-row"><input type="checkbox" checked={isMinor} onChange={event => void toggleMinor(event.target.checked)} /> This player is under 18</label>
    {isMinor && <>
      <p>Claim: {scopes.claim ? <span className="status-pill status-ok">Guardian approved</span> : <span className="status-pill status-warn">Needs guardian approval</span>} · Public profile: {scopes.publicProfile ? <span className="status-pill status-ok">Guardian approved</span> : <span className="status-pill status-warn">Needs guardian approval</span>}</p>
      {approvals.length > 0 && <ul className="plain-list">{approvals.map(approval => <li key={approval.id}><ShieldCheck size={13} /> {approval.guardianName} · {GUARDIAN_RELATIONSHIP_LABELS[approval.relationship as GuardianRelationship] ?? approval.relationship} · {[approval.approvesClaim ? 'claim' : '', approval.approvesPublicProfile ? 'public profile' : ''].filter(Boolean).join(' and ')}{approval.revokedAt ? ' · revoked' : <ConfirmAction label="Revoke approval" question="Revoke this guardian approval?" confirmLabel="Revoke" onConfirm={async () => { await revoke(approval.id) }} />}</li>)}</ul>}
      <form className="guardian-form" onSubmit={save}>
        <label>Guardian name<input value={form.guardianName} onChange={event => setForm({ ...form, guardianName: event.target.value })} /></label>
        <label>Relationship<select value={form.relationship} onChange={event => setForm({ ...form, relationship: event.target.value as GuardianRelationship })}>{Object.entries(GUARDIAN_RELATIONSHIP_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label>Guardian contact (private, optional)<input value={form.contact} onChange={event => setForm({ ...form, contact: event.target.value })} /></label>
        <label className="checkbox-row"><input type="checkbox" checked={form.approvesClaim} onChange={event => setForm({ ...form, approvesClaim: event.target.checked })} /> Approves the player claiming this profile</label>
        <label className="checkbox-row"><input type="checkbox" checked={form.approvesPublicProfile} onChange={event => setForm({ ...form, approvesPublicProfile: event.target.checked })} /> Approves making the profile public</label>
        <label>How approval was given (optional)<input value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} placeholder="e.g. Signed consent form seen at registration" /></label>
        <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Record guardian approval'}</button>
      </form>
    </>}
    {error && <div className="form-error" role="alert">{error}</div>}
  </section>
}

// One search result in the organizer's Players section. Unclaimed records can
// be opened to register an identity and manage minor / guardian approval; the
// database decides whether this account created the record and may do so.
export function ManagedPlayerRow({ client, userId, player, onNotice, onChanged }: { client: SupabaseClient; userId: string; player: { id: string; display_name: string; is_claimed: boolean; is_published: boolean; created_by?: string; account_id?: string | null }; onNotice: (message: string) => void; onChanged?: () => void }) {
  const [editing, setEditing] = useState(false)
  const canEdit = player.created_by === userId && !player.is_claimed && !player.account_id
  const [open, setOpen] = useState(false)
  return <div className="result-row managed-player">
    <div><strong>{player.display_name}</strong><span>{player.is_claimed ? 'Claimed' : 'Unclaimed'}{player.is_published ? ' · Published' : ''}</span></div>
    {canEdit && <><button type="button" className="outline-button dark" onClick={() => setEditing(value => !value)}>Edit player</button><RecordDeleteAction client={client} kind="player" id={player.id} name={player.display_name} onDeleted={() => { onNotice(`${player.display_name} deleted.`); onChanged?.() }} /></>}
    {editing && canEdit && <ManagedPlayerEditor client={client} userId={userId} playerId={player.id} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onNotice('Player details saved.'); onChanged?.() }} />}
    {!player.is_claimed && <button type="button" className="outline-button dark" onClick={() => setOpen(value => !value)}>{open ? 'Close' : 'Identity & guardian'}</button>}
    {open && <div className="managed-player-panels">
      <IdentityCheckPanel client={client} playerId={player.id} onNotice={onNotice} />
      <GuardianPanel client={client} userId={userId} playerId={player.id} onNotice={onNotice} />
    </div>}
  </div>
}

// National ID inside My Profile → Basic details. Same trusted check as
// IdentityCheckPanel: the number goes only to the register-identity Edge
// Function, which stores a keyed digest and rejects an ID that another profile
// already uses. The number is cleared from the field straight after sending.
export function NationalIdField({ client, playerId, onRegistered }: { client: SupabaseClient; playerId: string; onRegistered?: () => void }) {
  const [status, setStatus] = useState<'registered' | 'not_registered' | 'unavailable' | null>(null)
  const [type, setType] = useState<'maldivian_national_id' | 'foreign_document'>('maldivian_national_id')
  const [value, setValue] = useState('')
  const [documentType, setDocumentType] = useState('passport')
  const [country, setCountry] = useState('')
  const [outcome, setOutcome] = useState<IdentityOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { let active = true; void loadIdentityStatus(client, playerId).then(next => { if (active) setStatus(next) }); return () => { active = false } }, [client, playerId])

  const submit = async () => {
    setBusy(true); setOutcome(null)
    const result = await registerIdentity(client, playerId, { identifierType: type, value, documentType, issuingCountry: country })
    setBusy(false); setValue('')
    setOutcome(result)
    if (result.status === 'registered' || result.status === 'already_registered') { setStatus('registered'); onRegistered?.() }
  }

  if (status === null) return null
  if (status === 'registered') return <div className="pf-idfield registered">
    <span className="pf-id-badge"><ShieldCheck size={16} /></span>
    <div><strong>National ID registered</strong><small>Checked against all profiles, with no duplicate found. The number itself is not stored and is never shown.</small></div>
    <span className="pw-pill tone-ok"><Lock size={11} /> Private</span>
  </div>
  if (status === 'unavailable') return <p className="pending-note">National ID checks need migration 026 and the register-identity Edge Function.</p>
  return <div className="pf-idfield">
    <div className="pf-idfield-head"><strong><Fingerprint size={15} /> National ID number</strong><span className="pw-pill tone-muted"><Lock size={11} /> Private · never public</span></div>
    <div className="pf-fields">
      <label className="pf-field">Document<select value={type} onChange={event => { setType(event.target.value as typeof type); setOutcome(null) }}><option value="maldivian_national_id">Maldivian ID card</option><option value="foreign_document">Foreign document</option></select></label>
      <label className="pf-field">{type === 'maldivian_national_id' ? 'ID card number' : 'Document number'}<input value={value} autoComplete="off" spellCheck={false} inputMode={type === 'maldivian_national_id' ? 'text' : undefined} maxLength={24} onChange={event => setValue(event.target.value)} placeholder={type === 'maldivian_national_id' ? 'A123456' : 'Document number'} /></label>
      {type === 'foreign_document' && <>
        <label className="pf-field">Document type<select value={documentType} onChange={event => setDocumentType(event.target.value)}><option value="passport">Passport</option><option value="national_id">National ID</option><option value="other">Other</option></select></label>
        <label className="pf-field">Issuing country<input value={country} maxLength={2} onChange={event => setCountry(event.target.value.toUpperCase())} placeholder="e.g. IN" /></label>
      </>}
    </div>
    {outcome && <p className={outcome.status === 'registered' || outcome.status === 'already_registered' ? 'publication-notice' : 'form-error'} role={outcome.status === 'error' || outcome.status === 'identity_in_use' || outcome.status === 'profile_has_identity' ? 'alert' : 'status'}>{outcome.message}</p>}
    <div className="pf-idfield-foot">
      <small><ShieldCheck size={12} /> Used only to stop duplicate profiles. It is turned into a protected code on the server; nobody, including organizers, can read the number back.</small>
      <button type="button" className="ed-btn ed-btn-primary ed-btn-sm" disabled={busy || !value.trim()} onClick={() => void submit()}>{busy ? 'Checking…' : 'Verify and save ID'}</button>
    </div>
  </div>
}
