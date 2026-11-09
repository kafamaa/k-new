import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { Check, Copy, CopyCheck, FileSpreadsheet, Loader2, MailPlus, Pencil, ScanSearch, ShieldCheck, UserRoundCheck } from 'lucide-react'
import { CsvImportPanel } from './CsvImportPanel'
import { loadContentReports } from '../lib/landing'
import {
  CLAIM_STATUS_LABELS, findDuplicateGroups, findPublishedNameMatches, invitablePlayers, loadImportHistory, loadManagedPlayers,
  loadMyClaimInvitations, loadOrganizationTeams, playerClaimStatus, requestDuplicateReview, revokeClaimInvitation, sendClaimInvitations,
  type ClaimInvitation, type DuplicateCandidate, type DuplicateGroup, type ImportBatch, type ManagedPlayer, type PlayerClaimStatus, type SentInvitation,
} from '../lib/organizerPeople'
import { loadManagedPlayerDetails, updateManagedPlayer, type ManagedPlayerDetails } from '../lib/records'
import { RecordDeleteAction } from './RecordDeleteAction'
import { ProfilePhotoEditor, type PhotoFit } from './ProfilePhotoEditor'
import { ConfirmAction } from './ConfirmAction'

const dateLabel = (value: string) => value ? new Date(value).toLocaleDateString('en-GB', { timeZone: 'Indian/Maldives', day: '2-digit', month: 'short', year: 'numeric' }) : ''
const STATUS_TONE: Record<PlayerClaimStatus, string> = { claimed: 'ok', invited: 'info', expired: 'warn', not_invited: 'neutral' }

// Final plan 37 → Claims. The players this account created, their claim
// status, and invitations sent one by one or together. A claim is not a
// verification: it only links the record to the person's account.
export function ClaimsSection({ client, user, onNotice }: { client: SupabaseClient; user: User; onNotice: (message: string) => void }) {
  const [players, setPlayers] = useState<ManagedPlayer[]>([])
  const [invitations, setInvitations] = useState<ClaimInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<PlayerClaimStatus | 'all'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [sent, setSent] = useState<SentInvitation[]>([])
  const [copied, setCopied] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      const [playerResult, invitationResult] = await Promise.all([loadManagedPlayers(client, user.id), loadMyClaimInvitations(client, user.id)])
      if (!active) return
      setPlayers(playerResult.data); setInvitations(invitationResult.data)
      setError(playerResult.error ?? invitationResult.error ?? '')
      setLoading(false)
    })()
    return () => { active = false }
  }, [client, user.id, reloadKey])

  const statuses = useMemo(() => new Map(players.map(player => [player.id, playerClaimStatus(player, invitations)])), [players, invitations])
  const counts = useMemo(() => { const total: Record<PlayerClaimStatus, number> = { claimed: 0, invited: 0, expired: 0, not_invited: 0 }; for (const status of statuses.values()) total[status] += 1; return total }, [statuses])
  const invitable = useMemo(() => new Set(invitablePlayers(players, invitations).map(player => player.id)), [players, invitations])
  const visible = players.filter(player => filter === 'all' || statuses.get(player.id) === filter)
  const chosen = players.filter(player => selected.has(player.id) && invitable.has(player.id))

  const toggle = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const selectAll = () => setSelected(new Set(visible.filter(player => invitable.has(player.id)).map(player => player.id)))

  const send = async () => {
    setConfirming(false); setProgress(0)
    const result = await sendClaimInvitations(client, chosen, setProgress)
    setProgress(null); setSent(result); setSelected(new Set())
    const created = result.filter(item => item.token).length
    onNotice(`${created} claim invitation${created === 1 ? '' : 's'} created.${result.length - created ? ` ${result.length - created} could not be created.` : ''}`)
    setReloadKey(value => value + 1)
  }
  const revoke = async (invitation: ClaimInvitation) => {
    const result = await revokeClaimInvitation(client, invitation.id)
    if (result.error) return setError(result.error)
    onNotice('Invitation revoked. The token no longer works.')
    setReloadKey(value => value + 1)
  }
  const copy = async (token: string) => { try { await navigator.clipboard.writeText(token); setCopied(token) } catch { setCopied('') } }

  return <div className="organizer-section">
    <div className="section-head"><div><p className="eyebrow">TEAMS & PLAYERS</p><h1>Claims</h1><p>The player records you created and whether each person has claimed theirs. Claiming links a record to the person's own account; it is not an identity verification.</p></div></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {loading ? <div className="loading-state"><Loader2 className="spin" size={16} /> Loading claims…</div>
      : players.length === 0 ? <div className="state-block"><UserRoundCheck size={24} /><h3>No player records yet</h3><p>Players you create under Players or through an import appear here, with their claim status.</p></div>
        : <>
          <div className="pw-subtabs" role="tablist" aria-label="Claim status">
            {(['all', 'not_invited', 'invited', 'expired', 'claimed'] as const).map(value => <button type="button" role="tab" key={value} aria-selected={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value === 'all' ? `All (${players.length})` : `${CLAIM_STATUS_LABELS[value]} (${counts[value]})`}</button>)}
          </div>
          <div className="button-row">
            <button type="button" className="ghost-button" disabled={!visible.some(player => invitable.has(player.id))} onClick={selectAll}>Select all who can be invited</button>
            {confirming ? <span className="confirm-group"><span>Create {chosen.length} claim invitation{chosen.length === 1 ? '' : 's'}? Each token is shown once.</span><button type="button" className="primary-button" onClick={() => void send()}>Yes, create</button><button type="button" className="outline-button dark" onClick={() => setConfirming(false)}>Cancel</button></span>
              : <button type="button" className="primary-button" disabled={chosen.length === 0 || progress !== null} onClick={() => setConfirming(true)}><MailPlus size={15} /> Send claim invitation{chosen.length === 1 ? '' : 's'} ({chosen.length})</button>}
          </div>
          {progress !== null && <div className="loading-state"><Loader2 className="spin" size={14} /> Creating invitations… {progress} of {chosen.length || progress}</div>}
          {sent.length > 0 && <div className="panel-block claim-tokens" role="status">
            <h3><ShieldCheck size={16} /> Deliver each token privately</h3>
            <p className="field-hint">These tokens are shown only now and are not stored. Give each one only to the person named. A token works for 7 days.</p>
            <ul className="ws-rows">{sent.map(item => <li key={item.playerId} className="result-row"><div><strong>{item.name}</strong><span>{item.error ?? `Expires ${dateLabel(item.expiresAt ?? '')}`}</span></div>{item.token && <button type="button" className="outline-button dark" onClick={() => void copy(item.token!)}>{copied === item.token ? <><CopyCheck size={14} /> Copied</> : <><Copy size={14} /> Copy token</>}</button>}</li>)}</ul>
            <button type="button" className="ghost-button" onClick={() => setSent([])}>I have delivered them</button>
          </div>}
          <ul className="ws-rows">{visible.map(player => {
            const status = statuses.get(player.id) ?? 'not_invited'
            const pending = invitations.find(item => item.playerId === player.id && item.state === 'pending')
            return <li key={player.id} className="result-row">
              {invitable.has(player.id) ? <input type="checkbox" aria-label={`Select ${player.name}`} checked={selected.has(player.id)} onChange={() => toggle(player.id)} /> : <span aria-hidden="true" className="claim-check-spacer" />}
              <div className="player-row-identity">{player.photoUrl ? <img className="player-row-avatar" src={player.photoUrl} alt="" /> : <span className="player-row-avatar player-row-avatar-fallback">{player.name.trim().slice(0, 2).toUpperCase()}</span>}<div><strong>{player.name}</strong><span>{player.island ?? 'Island not recorded'}{player.published ? ' · Published' : ' · Private'}{pending ? ` · expires ${dateLabel(pending.expiresAt)}` : ''}</span></div></div>
              <span className={`status-pill status-${STATUS_TONE[status]}`}>{CLAIM_STATUS_LABELS[status]}</span>
              {pending && <ConfirmAction label="Revoke invitation" question="Revoke this claim invitation? The link stops working." confirmLabel="Revoke" onConfirm={async () => { await revoke(pending) }} />}
              {player.published && <a className="ghost-button" href={`#player/${encodeURIComponent(player.slug)}`}>View</a>}
              {player.claimed ? <span className="field-hint">Managed by the player</span>
                : <button type="button" className="outline-button dark" aria-expanded={editing === player.id} aria-label={`Edit ${player.name}`} onClick={() => setEditing(editing === player.id ? null : player.id)}><Pencil size={14} aria-hidden="true" /> {editing === player.id ? 'Close' : 'Edit'}</button>}
              {!player.claimed && <RecordDeleteAction client={client} kind="player" id={player.id} name={player.name} onDeleted={() => { setSelected(current => { const next = new Set(current); next.delete(player.id); return next }); onNotice(`${player.name} deleted.`); setReloadKey(value => value + 1) }} />}
              {editing === player.id && <ManagedPlayerEditor client={client} userId={user.id} playerId={player.id} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onNotice(`${player.name} saved.`); setReloadKey(value => value + 1) }} />}
            </li>
          })}</ul>
        </>}
  </div>
}

// Final plan 37 → Possible duplicates. Records with the same name (words in any
// order) among those this account manages and published records. Nothing is
// merged or hidden here: a reviewer decides, after a review request.
// Inline editor for an unclaimed player this organizer created. The public link
// and player ID stay the same; only the details below change.
export function ManagedPlayerEditor({ client, userId, playerId, onCancel, onSaved }: { client: SupabaseClient; userId: string; playerId: string; onCancel: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<ManagedPlayerDetails | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { let active = true; void loadManagedPlayerDetails(client, playerId).then(result => { if (!active) return; setDraft(result.data); if (result.error) setError(result.error) }); return () => { active = false } }, [client, playerId])
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!draft) return
    setSaving(true); setError('')
    const result = await updateManagedPlayer(client, userId, playerId, draft)
    setSaving(false)
    if (result.error) return setError(result.error)
    onSaved()
  }
  if (!draft) return <div className="inline-editor" role="status">{error || 'Loading…'}</div>
  const field = (key: keyof ManagedPlayerDetails, label: string, extra: Record<string, unknown> = {}) => <label>{label}<input value={String(draft[key] ?? '')} onChange={event => setDraft({ ...draft, [key]: event.target.value })} {...extra} /></label>
  return <div className="inline-editor">
    <form className="form-grid" onSubmit={event => void save(event)} aria-label="Edit player">
      {field('name', 'Name', { maxLength: 120, required: true, autoComplete: 'off' })}
      {field('island', 'Island (optional)', { maxLength: 80, list: 'kv-islands' })}
      {field('atoll', 'Atoll (optional)', { maxLength: 60, list: 'kv-atolls' })}
      {field('position', 'Position (optional)', { maxLength: 40 })}
      <p className="field-hint tp-wide">The player’s public link and Kulhivaru+ ID stay the same. Once the player claims this profile, only they can change it.</p>
      {error && <div className="form-error tp-wide" role="alert">{error}</div>}
      <div className="button-row tp-wide"><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button><button type="button" className="outline-button dark" onClick={onCancel}>Cancel</button></div>
    </form>
    <div className="tp-wide" style={{ marginTop: 12 }}>
      <ProfilePhotoEditor client={client} playerId={playerId} currentUrl={draft.photoUrl ?? null} currentFit={(draft.photoFit as PhotoFit | null) ?? null} onSaved={(url, _path, fit) => { setDraft(prev => prev ? { ...prev, photoUrl: url, photoFit: fit } : prev); onSaved() }} onRemoved={() => { setDraft(prev => prev ? { ...prev, photoUrl: null, photoFit: null } : prev); onSaved() }} onCancel={() => {}} />
    </div>
  </div>
}

export function DuplicatesSection({ client, user, organizationId, onNotice }: { client: SupabaseClient; user: User; organizationId: string; onNotice: (message: string) => void }) {
  const [kind, setKind] = useState<'player' | 'team'>('player')
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [requested, setRequested] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const managed = kind === 'player'
      ? (await loadManagedPlayers(client, user.id))
      : (await loadOrganizationTeams(client, organizationId))
    const records: DuplicateCandidate[] = managed.data.map(record => ({ id: record.id, name: record.name, slug: record.slug, island: record.island, managed: true, claimed: 'claimed' in record ? record.claimed === true : undefined }))
    const published = await findPublishedNameMatches(client, kind, records.map(record => record.name))
    const reports = await loadContentReports(client)
    setGroups(findDuplicateGroups([...records, ...published.data]))
    setRequested(new Set(reports.data.filter(report => report.entity === kind && ['open', 'reviewing'].includes(report.status)).map(report => report.ref)))
    setError(managed.error ?? published.error ?? '')
    setLoading(false)
  }, [client, user.id, organizationId, kind])
  useEffect(() => { void load() }, [load])

  const request = async (group: DuplicateGroup) => {
    setConfirming(''); setBusy(group.key)
    const result = await requestDuplicateReview(client, kind, group)
    setBusy('')
    if (result.error) return setError(result.error)
    onNotice('Review requested. A platform reviewer will compare these records; nothing changes until then.')
    void load()
  }

  return <div className="organizer-section">
    <div className="section-head"><div><p className="eyebrow">TEAMS & PLAYERS</p><h1>Possible duplicates</h1><p>Records that may be the same {kind === 'player' ? 'person' : 'team'}. Records are never merged here: send a pair for review, and a platform reviewer decides with both histories in view.</p></div></div>
    <div className="pw-subtabs" role="tablist" aria-label="Record type">{(['player', 'team'] as const).map(value => <button type="button" role="tab" key={value} aria-selected={kind === value} className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>{value === 'player' ? 'Players you created' : 'Teams linked to this organization'}</button>)}</div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {loading ? <div className="loading-state"><Loader2 className="spin" size={16} /> Checking for possible duplicates…</div>
      : groups.length === 0 ? <div className="state-block"><Check size={24} /><h3>No possible duplicates found</h3><p>None of your {kind === 'player' ? 'player records' : 'linked teams'} share a name with another record you manage or a published record.</p></div>
        : <ul className="dup-groups">{groups.map(group => {
          const sent = group.records.some(record => requested.has(record.slug))
          return <li key={group.key} className="panel-block">
            <h3><ScanSearch size={16} /> {group.records.length} records named “{group.records[0].name}”{group.sameIsland ? '' : ' · different islands'}</h3>
            <ul className="ws-rows">{group.records.map(record => <li key={record.id} className="result-row"><div><strong>{record.name}</strong><span>{record.island ?? 'Island not recorded'} · {record.managed ? (kind === 'player' ? 'Created by you' : 'Linked to this organization') : 'Published record'}{record.claimed ? ' · Claimed' : ''}</span></div><a className="ghost-button" href={`#${kind}/${encodeURIComponent(record.slug)}`}>View</a></li>)}</ul>
            {sent ? <p className="publication-notice">Review requested. Updates from the reviewer appear in your notifications.</p>
              : confirming === group.key ? <span className="confirm-group"><span>Send these {group.records.length} records for review?</span><button type="button" className="primary-button" onClick={() => void request(group)}>Yes, request review</button><button type="button" className="outline-button dark" onClick={() => setConfirming('')}>Cancel</button></span>
                : <button type="button" className="outline-button dark" disabled={busy === group.key} onClick={() => setConfirming(group.key)}>{busy === group.key ? 'Sending…' : 'Request duplicate review'}</button>}
          </li>
        })}</ul>}
    <p className="field-hint">Matching uses names only, so two different people can share a name. National ID numbers are never shown or compared here; the identity check runs on the server when an ID is registered.</p>
  </div>
}

// Final plan 37 → Imports. Bulk import from CSV or Excel with a template,
// column matching, a preview with row checks, and the history of past imports.
export function ImportsSection({ client, user, organizationId, canImportTeams, onNotice, onImported }: { client: SupabaseClient; user: User; organizationId: string; canImportTeams: boolean; onNotice: (message: string) => void; onImported: () => void }) {
  const [history, setHistory] = useState<ImportBatch[]>([])
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => { let active = true; void loadImportHistory(client, user.id).then(result => { if (active) { setHistory(result.data); setError(result.error ?? '') } }); return () => { active = false } }, [client, user.id, reloadKey])
  const imported = () => { setReloadKey(value => value + 1); onImported() }
  return <div className="organizer-section">
    <div className="section-head"><div><p className="eyebrow">TEAMS & PLAYERS</p><h1>Imports</h1><p>Add many records at once from a CSV or Excel (.xlsx) file. Download the template, match your columns, check every row in the preview, then confirm. Existing records are never changed.</p></div></div>
    <CsvImportPanel client={client} user={user} organizationId={organizationId} kind="player" onNotice={onNotice} onImported={imported} defaultOpen />
    {canImportTeams ? <CsvImportPanel client={client} user={user} organizationId={organizationId} kind="team" onNotice={onNotice} onImported={imported} defaultOpen />
      : <p className="field-hint">Team imports are available to organization owners and operations members, because imported teams are linked to this organization.</p>}
    <div className="panel-block"><h3><FileSpreadsheet size={16} /> Import history</h3>
      {error ? <div className="form-error" role="alert">{error}</div>
        : history.length === 0 ? <p className="empty-note">No imports yet. Each import you confirm is listed here with the file name and the number of records created.</p>
          : <div className="table-scroll"><table className="import-table"><thead><tr><th>File</th><th>Records</th><th>Created</th><th>Date</th></tr></thead><tbody>{history.map(batch => <tr key={`${batch.kind}-${batch.source}-${batch.lastAt}`}><td>{batch.source}</td><td>{batch.kind === 'team' ? 'Teams' : 'Players'}</td><td>{batch.created}</td><td>{dateLabel(batch.lastAt)}</td></tr>)}</tbody></table></div>}
    </div>
  </div>
}
