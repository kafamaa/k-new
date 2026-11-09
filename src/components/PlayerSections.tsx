import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Award, Check, Eye, EyeOff, FileLock2, Flag, Loader2, Medal, RefreshCw, ShieldCheck, Trophy, Upload, X } from 'lucide-react'
import { DOCUMENT_CATEGORIES, DOCUMENT_STATUS_LABELS, DOCUMENT_TYPES, loadMilestoneExtras, loadPlayerDocuments, loadTeamInvitations, removePlayerDocument, respondToInvitation, setMilestoneVisibility, uploadPlayerDocument, type PlayerDocument, type TeamInvitation } from '../lib/playerSections'
import { formatFileSize, privateDocumentLink } from '../lib/documents'
import { formatDay } from '../lib/display'
import { Crest } from './Editorial'
import { ConfirmAction } from './ConfirmAction'

// --- Team invitations ------------------------------------------------------------
export function TeamInvitationsPanel({ client, playerId, onAccepted }: { client: SupabaseClient; playerId: string; onAccepted?: () => void }) {
  const [items, setItems] = useState<TeamInvitation[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [reporting, setReporting] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const reload = useCallback(() => { void loadTeamInvitations(client, playerId).then(result => { setItems(result.data); setError(result.error ?? '') }) }, [client, playerId])
  useEffect(() => { reload() }, [reload])

  const respond = async (item: TeamInvitation, response: 'accepted' | 'declined' | 'reported') => {
    setBusy(item.id); setError(''); setNotice('')
    const result = await respondToInvitation(client, item.id, response, response === 'reported' ? note : '')
    setBusy(null)
    if (result.error) return setError(result.error)
    setReporting(null); setNote('')
    setNotice(response === 'accepted' ? `You joined ${item.teamName}. A new dated membership was added; your earlier team history is unchanged.` : response === 'declined' ? 'Invitation declined.' : 'Thanks. The invitation was reported as incorrect.')
    if (response === 'accepted') onAccepted?.()
    reload()
  }
  const pending = items.filter(item => item.status === 'pending')
  const answered = items.filter(item => item.status !== 'pending')
  return <section className="pf-card pw-invites-card">
    <header className="pf-card-head"><span className="pf-card-icon"><Medal size={18} /></span><div><h3>Team invitations</h3><p>{pending.length ? `${pending.length} waiting for your answer` : 'Accepting adds a dated membership'}</p></div></header>
    {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
    {notice && <p className="publication-notice" role="status">{notice}</p>}
    {!error && pending.length === 0 && <p className="pf-hint">No team invitations are waiting for you.</p>}
    {pending.length > 0 && <ul className="ps-invites">{pending.map(item => <li key={item.id}>
      <div className="ps-invite-head"><Crest name={item.teamName} logoUrl={item.teamLogo} size="md" /><div><strong>{item.teamName}</strong><small>{[item.position, item.jerseyNumber !== null ? `#${item.jerseyNumber}` : null, `sent ${formatDay(item.createdAt)}`, item.expiresAt ? `expires ${formatDay(item.expiresAt)}` : null].filter(Boolean).join(' · ')}</small></div></div>
      {item.message && <p className="ps-invite-message">“{item.message}”</p>}
      {reporting === item.id ? <div className="workspace-form">
        <label>What is wrong with this invitation?<textarea rows={2} maxLength={400} value={note} onChange={event => setNote(event.target.value)} placeholder="e.g. I never played for this team" /></label>
        <div className="button-row compact"><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" disabled={busy === item.id} onClick={() => void respond(item, 'reported')}>Send report</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => { setReporting(null); setNote('') }}>Cancel</button></div>
      </div> : <div className="button-row compact">
        <button type="button" className="ed-btn ed-btn-primary ed-btn-sm" disabled={busy === item.id} onClick={() => void respond(item, 'accepted')}>{busy === item.id ? <Loader2 className="spin" size={14} /> : <Check size={14} />} Accept</button>
        <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={busy === item.id} onClick={() => void respond(item, 'declined')}><X size={14} /> Decline</button>
        <button type="button" className="ed-link-btn" onClick={() => setReporting(item.id)}><Flag size={13} /> Report incorrect</button>
      </div>}
    </li>)}</ul>}
    {answered.length > 0 && <details className="ps-history"><summary>Past invitations ({answered.length})</summary><ul className="plain-list">{answered.map(item => <li key={item.id}>{item.teamName} · {item.status}{item.responseNote ? ` · ${item.responseNote}` : ''}</li>)}</ul></details>}
  </section>
}

// --- Documents -------------------------------------------------------------------------
export function PlayerDocumentsTab({ client, userId, playerId, tournaments, onChanged }: { client: SupabaseClient; userId: string; playerId: string; tournaments: Array<{ id: string; name: string }>; onChanged?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<PlayerDocument[]>([])
  const [category, setCategory] = useState<string>(DOCUMENT_CATEGORIES[0].value)
  const [tournamentId, setTournamentId] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [replacing, setReplacing] = useState<PlayerDocument | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = useCallback(() => { void loadPlayerDocuments(client, playerId).then(result => { setItems(result.data); setError(result.error ?? '') }) }, [client, playerId])
  useEffect(() => { reload() }, [reload])
  const tournamentName = (id: string | null) => tournaments.find(item => item.id === id)?.name ?? null
  const removable = (document: PlayerDocument) => ['uploaded', 'changes_requested', 'rejected'].includes(document.status)

  const send = async (file: File, input: { category: string; tournamentId: string | null; expiresAt: string | null }, previous: PlayerDocument | null) => {
    setBusy(true); setError(''); setNotice('')
    const result = await uploadPlayerDocument(client, { userId, playerId, file, ...input })
    // The old file goes only when the player may remove it; a reviewed one stays on record.
    if (!result.error && previous && removable(previous)) await removePlayerDocument(client, previous)
    setBusy(false)
    if (result.error) return setError(result.error)
    setNotice(previous ? 'Replacement uploaded. The organizer reviews the new version.' : 'Document uploaded privately. The tournament organizer reviews it.')
    reload(); onChanged?.()
  }
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''
    if (file) void send(file, { category, tournamentId: tournamentId || null, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null }, null)
  }
  const replace = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''
    const previous = replacing; setReplacing(null)
    if (file && previous) void send(file, { category: previous.category, tournamentId: previous.tournamentId, expiresAt: previous.expiresAt }, previous)
  }
  const open = async (document: PlayerDocument) => {
    const link = await privateDocumentLink(client, document.storagePath)
    if (link.error || !link.url) return setError(link.error ?? 'The document could not be opened.')
    window.open(link.url, '_blank', 'noopener,noreferrer')
  }
  const remove = async (document: PlayerDocument) => { const result = await removePlayerDocument(client, document); if (result.error) return setError(result.error); reload(); onChanged?.() }
  // Latest document per type decides the checklist status.
  const latest = new Map<string, PlayerDocument>()
  for (const document of items) if (!latest.has(document.category)) latest.set(document.category, document)
  const expired = (document: PlayerDocument) => document.status === 'expired' || Boolean(document.expiresAt && document.expiresAt < new Date().toISOString())

  return <div className="pw-page" role="tabpanel">
    <div className="pw-doc-checklist">{DOCUMENT_CATEGORIES.map(item => {
      const document = latest.get(item.value)
      const status = document ? (expired(document) ? 'expired' : document.status) : 'not_submitted'
      return <button type="button" key={item.value} className={`pw-doc-tile status-${status}`} onClick={() => { setCategory(item.value); inputRef.current?.focus() }}>
        <FileLock2 size={18} /><strong>{item.label}</strong><span className={`ps-doc-status status-${status}`}>{status === 'not_submitted' ? 'Not submitted' : DOCUMENT_STATUS_LABELS[status] ?? status}</span>
      </button>
    })}</div>
    <div className="pw-two">
      <section className="pf-card">
        <header className="pf-card-head"><span className="pf-card-icon"><FileLock2 size={18} /></span><div><h3>My documents</h3><p>{items.length ? `${items.length} file${items.length === 1 ? '' : 's'}` : 'Nothing uploaded yet'}</p></div></header>
        {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
        {notice && <p className="publication-notice" role="status">{notice}</p>}
        {items.length === 0 ? <p className="pf-hint">Upload the documents your tournaments ask for. Each one is reviewed by the organizer.</p> : <ul className="ps-docs">{items.map(document => <li key={document.id}>
          <div><strong>{DOCUMENT_CATEGORIES.find(item => item.value === document.category)?.label ?? document.category}</strong><small>{document.originalName} · {formatFileSize(document.sizeBytes)} · uploaded {formatDay(document.createdAt)}{tournamentName(document.tournamentId) ? ` · ${tournamentName(document.tournamentId)}` : ' · General'}{document.expiresAt ? ` · valid until ${formatDay(document.expiresAt)}` : ''}</small>{document.reviewerNote && <small className="ps-review-note">Reviewer: {document.reviewerNote}</small>}</div>
          <span className={`ps-doc-status status-${expired(document) ? 'expired' : document.status}`}>{expired(document) ? 'Expired' : DOCUMENT_STATUS_LABELS[document.status] ?? document.status}</span>
          <div className="button-row compact">
            <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => void open(document)}>Open</button>
            <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={busy} onClick={() => { setReplacing(document); replaceRef.current?.click() }}><RefreshCw size={13} /> Replace</button>
            {removable(document) && <ConfirmAction className="ed-btn ed-btn-ghost ed-btn-sm" label={`Remove ${document.originalName}`} question={`Remove ${document.originalName}? You can upload it again later.`} onConfirm={async () => { await remove(document) }} />}
          </div>
        </li>)}</ul>}
        <input ref={replaceRef} type="file" accept={DOCUMENT_TYPES.join(',')} className="sr-only" aria-label="Replacement file" onChange={replace} />
      </section>
      <section className="pf-card pw-sticky">
        <header className="pf-card-head"><span className="pf-card-icon"><Upload size={18} /></span><div><h3>Upload a document</h3><p>Secure private storage</p></div></header>
        <label className="pf-field">Document type<select value={category} onChange={event => setCategory(event.target.value)}>{DOCUMENT_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="pf-field">For tournament<select value={tournamentId} onChange={event => setTournamentId(event.target.value)}><option value="">General (no tournament yet)</option>{tournaments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="pf-field">Valid until (optional)<input type="date" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label>
        <button type="button" className="pw-dropzone" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? <Loader2 className="spin" size={22} /> : <Upload size={22} />}<strong>{busy ? 'Uploading…' : 'Choose a file'}</strong><small>PDF, PNG or JPG · up to 10 MB</small></button>
        <input ref={inputRef} type="file" accept={DOCUMENT_TYPES.join(',')} className="sr-only" aria-label="Document file" onChange={upload} />
        {!tournamentId && <p className="pf-hint">A general document is visible only to you until you upload one for a specific tournament.</p>}
        <p className="pf-hint"><ShieldCheck size={13} /> Only you and that tournament’s organizers can open your files, through links that expire after one minute. Documents never appear on your public profile.</p>
      </section>
    </div>
  </div>
}

// --- Trophy cabinet ---------------------------------------------------------------------
export function TrophyCabinet({ client, milestones }: { client: SupabaseClient; milestones: Record<string, unknown>[] }) {
  const [extras, setExtras] = useState<Awaited<ReturnType<typeof loadMilestoneExtras>>>(new Map())
  const [error, setError] = useState('')
  const ids = milestones.map(item => String(item.id)).join(',')
  useEffect(() => { let active = true; void loadMilestoneExtras(client, ids ? ids.split(',') : []).then(map => { if (active) setExtras(map) }); return () => { active = false } }, [client, ids])
  const toggle = async (id: string, isPublic: boolean) => {
    const result = await setMilestoneVisibility(client, id, isPublic)
    if (result.error) return setError(result.error)
    setExtras(current => { const next = new Map(current); const entry = next.get(id); if (entry) next.set(id, { ...entry, isPublic }); return next })
  }
  const isAward = (item: Record<string, unknown>) => String(item.milestone_type ?? '').startsWith('award_')
  const trophies = milestones.filter(isAward)
  const achievements = milestones.filter(item => !isAward(item))
  const card = (item: Record<string, unknown>, trophy: boolean) => {
    const id = String(item.id); const extra = extras.get(id); const visible = extra?.isPublic !== false
    return <li key={id} className={trophy ? 'trophy' : ''}>
      <span className="ps-trophy-image">{extra?.imageUrl ? <img src={extra.imageUrl} alt="" loading="lazy" /> : trophy ? <Trophy size={30} aria-hidden="true" /> : <Award size={26} aria-hidden="true" />}</span>
      <span className="ps-trophy-body">
        <strong>{String(item.label)}</strong>
        <small>{[extra?.tournamentName, extra?.teamName, typeof item.reached_at === 'string' ? `Season ${item.reached_at.slice(0, 4)}` : null, formatDay(item.reached_at)].filter(Boolean).join(' · ')}</small>
        <small className="ps-source"><ShieldCheck size={12} /> {item.is_manual ? 'Organizer-awarded' : 'Automatic · from confirmed matches'} · {visible ? 'Public' : 'Hidden'}</small>
      </span>
      <button type="button" className="ed-icon-btn" aria-label={visible ? 'Hide from public profile' : 'Show on public profile'} title={visible ? 'Public' : 'Hidden from public'} onClick={() => void toggle(id, !visible)}>{visible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
    </li>
  }
  return <div className="pw-page" role="tabpanel">
    {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
    <section className="pf-card">
      <header className="pf-card-head"><span className="pf-card-icon pw-gold"><Trophy size={18} /></span><div><h3>Trophy cabinet</h3><p>Awards recorded by tournament organizers</p></div></header>
      {trophies.length ? <ul className="ps-trophies">{trophies.map(item => card(item, true))}</ul> : <p className="pf-hint">No trophies yet. Awards recorded by tournament organizers appear here.</p>}
    </section>
    <section className="pf-card">
      <header className="pf-card-head"><span className="pf-card-icon"><Award size={18} /></span><div><h3>Achievements</h3><p>Added automatically from confirmed matches</p></div></header>
      {achievements.length ? <ul className="ps-trophies">{achievements.map(item => card(item, false))}</ul> : <p className="pf-hint">No achievements yet. Milestones are added automatically from confirmed matches.</p>}
      <p className="pf-hint"><Eye size={13} /> Use the eye button to hide an item from your public profile. It stays in your official record.</p>
    </section>
  </div>
}
