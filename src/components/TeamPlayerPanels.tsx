import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FileLock2, Medal } from 'lucide-react'
import { DOCUMENT_CATEGORIES, DOCUMENT_STATUS_LABELS, reviewDocument, sendTeamInvitation } from '../lib/playerSections'
import { searchExistingPlayers, type SearchablePlayer } from '../lib/organizer'
import { privateDocumentLink } from '../lib/documents'
import { formatDay } from '../lib/display'

// Team manager: invite a player profile to the team. The player decides in
// their own workspace; accepting adds a new dated membership.
export function InvitePlayerPanel({ client, userId, teamId, onNotice }: { client: SupabaseClient; userId: string; teamId: string; onNotice: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchablePlayer[]>([])
  const [chosen, setChosen] = useState<SearchablePlayer | null>(null)
  const [form, setForm] = useState({ position: '', jerseyNumber: '', message: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const search = async () => { setError(''); const result = await searchExistingPlayers(client, query); setResults(result.data ?? []); if (result.error) setError(result.error) }
  const send = async () => {
    if (!chosen) return
    setBusy(true); setError('')
    const result = await sendTeamInvitation(client, { teamId, playerId: chosen.id, userId, ...form })
    setBusy(false)
    if (result.error) return setError(result.error)
    onNotice(`Invitation sent to ${chosen.display_name}. They accept or decline it in their player workspace.`)
    setChosen(null); setResults([]); setQuery(''); setForm({ position: '', jerseyNumber: '', message: '' })
  }
  return <section className="player-card-section">
    <h4><Medal size={15} /> Invite a player</h4>
    <p className="player-note">The player decides. Accepting adds a new dated membership to your team and never changes their earlier history.</p>
    {chosen ? <div className="workspace-form pp-grid">
      <p className="pp-wide"><strong>{chosen.display_name}</strong>{chosen.island ? ` · ${chosen.island}` : ''} <button type="button" className="ed-link-btn" onClick={() => setChosen(null)}>Change</button></p>
      <label>Position (optional)<input value={form.position} maxLength={40} onChange={event => setForm({ ...form, position: event.target.value })} /></label>
      <label>Jersey number (optional)<input inputMode="numeric" maxLength={2} value={form.jerseyNumber} onChange={event => setForm({ ...form, jerseyNumber: event.target.value.replace(/\D/g, '') })} /></label>
      <label className="pp-wide">Message (optional)<textarea rows={2} maxLength={400} value={form.message} onChange={event => setForm({ ...form, message: event.target.value })} /></label>
      <div className="button-row pp-wide"><button type="button" className="ed-btn ed-btn-primary" disabled={busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Send invitation'}</button></div>
    </div> : <div className="award-player">
      <label>Find player<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name (at least 2 characters)" /></label>
      <button type="button" className="outline-button dark" onClick={() => void search()}>Search</button>
    </div>}
    {!chosen && results.length > 0 && <ul className="plain-list">{results.map(player => <li key={player.id}>{player.display_name}{player.island ? ` · ${player.island}` : ''}{player.is_claimed ? ' · claimed' : ' · unclaimed'}<button type="button" className="ghost-button" onClick={() => setChosen(player)}>Choose</button></li>)}</ul>}
    {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
  </section>
}

type ReviewRow = { id: string; category: string; originalName: string; storagePath: string; status: string; reviewerNote: string | null; createdAt: string; playerName: string }

// Organizer: review the documents players uploaded for this tournament.
export function PlayerDocumentsReview({ client, userId, tournamentId, canManage }: { client: SupabaseClient; userId: string; tournamentId: string; canManage: boolean }) {
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const reload = useCallback(() => {
    void client.from('private_documents').select('id,document_type,original_name,storage_path,status,reviewer_note,created_at,player_profiles(display_name)').eq('tournament_id', tournamentId).not('player_id', 'is', null).order('created_at', { ascending: false }).then(result => {
      if (result.error) { setError(/status|reviewer_note|does not exist/.test(result.error.message) ? 'Player document review needs migration 029.' : result.error.message); return }
      setRows(((result.data ?? []) as Array<Record<string, unknown>>).map(row => {
        const player = (Array.isArray(row.player_profiles) ? row.player_profiles[0] : row.player_profiles) as Record<string, unknown> | null
        return { id: String(row.id), category: String(row.document_type), originalName: String(row.original_name), storagePath: String(row.storage_path), status: String(row.status ?? 'uploaded'), reviewerNote: row.reviewer_note ? String(row.reviewer_note) : null, createdAt: String(row.created_at), playerName: String(player?.display_name ?? 'Player') }
      }))
    })
  }, [client, tournamentId])
  useEffect(() => { reload() }, [reload])
  const open = async (row: ReviewRow) => { const link = await privateDocumentLink(client, row.storagePath); if (link.url) window.open(link.url, '_blank', 'noopener,noreferrer'); else setError(link.error ?? 'Could not open the document.') }
  const review = async (row: ReviewRow, status: 'changes_requested' | 'verified' | 'rejected') => {
    const result = await reviewDocument(client, row.id, userId, status, notes[row.id] ?? '')
    if (result.error) return setError(result.error)
    reload()
  }
  return <section className="panel-block">
    <h3><FileLock2 size={16} /> Player documents</h3>
    {error && <div className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</div>}
    {!error && rows.length === 0 && <p className="empty-note">No player has uploaded documents for this tournament.</p>}
    {rows.length > 0 && <ul className="ps-docs">{rows.map(row => <li key={row.id}>
      <div><strong>{row.playerName}</strong><small>{DOCUMENT_CATEGORIES.find(item => item.value === row.category)?.label ?? row.category} · {row.originalName} · {formatDay(row.createdAt)}</small>{row.reviewerNote && <small className="ps-review-note">Note: {row.reviewerNote}</small>}</div>
      <span className={`ps-doc-status status-${row.status}`}>{DOCUMENT_STATUS_LABELS[row.status] ?? row.status}</span>
      <div className="ps-review-actions">
        <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => void open(row)}>Open</button>
        {canManage && <>
          <input aria-label={`Note for ${row.playerName}`} placeholder="Note to player (optional)" value={notes[row.id] ?? ''} onChange={event => setNotes({ ...notes, [row.id]: event.target.value })} />
          <button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={() => void review(row, 'verified')}>Verify</button>
          <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => void review(row, 'changes_requested')}>Request changes</button>
          <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => void review(row, 'rejected')}>Reject</button>
        </>}
      </div>
    </li>)}</ul>}
  </section>
}
