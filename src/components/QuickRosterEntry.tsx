import { useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ClipboardPaste, Eye, EyeOff, FileUp, Plus, SearchCheck, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { organizerAddPlayer, searchUnclaimedPlayers } from '../lib/teamHub'
import { duplicateMatches, emptyRow, parseRosterText, rowProblems, type QuickRow } from '../lib/quickRoster'

// Quick roster entry for one entered team (Final specification, page 41).
// Each new player needs a name and a Maldivian ID card; the ID is checked
// privately (only a digest is kept server-side) so the same person is never
// created twice. Names that match a player the organizer can already see are
// flagged for the organizer to decide; nothing is merged automatically.
const STATUS_LABEL: Record<QuickRow['status'], string> = { new: 'New', existing: 'Existing player', possible_duplicate: 'Possible duplicate', added: 'Added', error: 'Not added' }

export function QuickRosterEntry({ client, userId, entryId, takenJerseys, onDone }: { client: SupabaseClient; userId: string; entryId: string; takenJerseys: number[]; onDone: (added: number) => void }) {
  const [rows, setRows] = useState<QuickRow[]>(() => [emptyRow(), emptyRow(), emptyRow()])
  const [confirmedNew, setConfirmedNew] = useState<Set<string>>(new Set())
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState<'' | 'checking' | 'adding'>('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const update = (key: string, patch: Partial<QuickRow>) => setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row))
  const pending = rows.filter(row => row.status !== 'added' && (row.name.trim() || row.nationalId.trim() || row.jersey || row.position.trim()))
  const problems = rowProblems(pending, takenJerseys)

  const addParsed = (text: string, source: string) => {
    const { rows: parsed, skipped } = parseRosterText(text)
    if (!parsed.length) return setError(`No players were found in the ${source}. Use one player per line: name, ID card, jersey, position.`)
    setRows(current => [...current.filter(row => row.name.trim() || row.nationalId.trim()), ...parsed])
    setError(''); setNote(`${parsed.length} player${parsed.length === 1 ? '' : 's'} added to the table from the ${source}${skipped ? `; ${skipped} line${skipped === 1 ? '' : 's'} skipped` : ''}. Check them, then add.`)
  }
  const importFile = async (file: File | undefined) => {
    if (!file) return
    if (/\.xlsx?$/i.test(file.name)) return setError('Save the spreadsheet as CSV (File → Save As → CSV), then import that file.')
    if (file.size > 200_000) return setError('The file is too large for one roster (200 KB at most).')
    addParsed(await file.text(), 'file')
    if (fileRef.current) fileRef.current.value = ''
  }

  // Possible duplicates: the same name as a player this organizer can already see.
  const checkDuplicates = async (): Promise<boolean> => {
    setBusy('checking'); setError('')
    let flagged = 0
    for (const row of rows) {
      if (row.status === 'added' || row.existingId || confirmedNew.has(row.key) || row.name.trim().length < 2) continue
      const found = await searchUnclaimedPlayers(client, row.name.trim(), { entryId })
      if (found.error) { setBusy(''); setError(found.error); return false }
      const matches = duplicateMatches(row, found.data)
      if (matches.length) { flagged += 1; update(row.key, { status: 'possible_duplicate', matches, message: null }) }
    }
    setBusy('')
    setNote(flagged ? `${flagged} possible duplicate${flagged === 1 ? '' : 's'} found. Choose the existing player or keep each as new.` : 'No possible duplicates found.')
    return flagged === 0
  }

  const addAll = async () => {
    setError('')
    if (!pending.length) return setError('Enter at least one player.')
    if (problems.size) return setError([...problems.values()][0])
    if (!(await checkDuplicates())) return
    setBusy('adding')
    let added = 0
    for (const row of pending) {
      const result = await organizerAddPlayer(client, { entryId, userId, playerId: row.existingId, name: row.name, island: '', position: row.position, jerseyNumber: row.jersey, identity: row.existingId ? null : { identifierType: 'maldivian_national_id', value: row.nationalId } })
      // The ID number is cleared after every attempt; it is never kept.
      if (result.error) update(row.key, { status: 'error', message: result.error, nationalId: '' })
      else { added += 1; update(row.key, { status: 'added', message: result.matched ? `Matched an existing player by ID card: ${result.matched}. No duplicate was created.` : null, nationalId: '' }) }
    }
    setBusy('')
    setNote(`${added} of ${pending.length} player${pending.length === 1 ? '' : 's'} added.${added < pending.length ? ' Fix the rows marked “Not added” and try again.' : ''}`)
    if (added) onDone(added)
  }

  return <section className="panel-block qr" aria-labelledby={`qr-title-${entryId}`}>
    <header className="qr-head"><h5 id={`qr-title-${entryId}`}><UserPlus size={15} /> Quick add players</h5>
      <div className="button-row compact">
        <button type="button" className="outline-button dark" onClick={() => setRows(current => [...current, emptyRow()])}><Plus size={13} /> Add row</button>
        <button type="button" className="outline-button dark" aria-expanded={pasteOpen} onClick={() => setPasteOpen(value => !value)}><ClipboardPaste size={13} /> Paste list</button>
        <label className="outline-button dark qr-file"><FileUp size={13} /> Import CSV<input ref={fileRef} type="file" accept=".csv,text/csv,.xlsx,.xls" className="sr-only" onChange={event => void importFile(event.target.files?.[0])} /></label>
        <button type="button" className="outline-button dark" disabled={Boolean(busy)} onClick={() => void checkDuplicates()}><SearchCheck size={13} /> Check duplicates</button>
      </div>
    </header>
    {pasteOpen && <div className="qr-paste">
      <label>Paste players, one per line: name, ID card, jersey, position (copied spreadsheet columns work too)<textarea rows={5} value={pasteText} spellCheck={false} autoComplete="off" onChange={event => setPasteText(event.target.value)} placeholder={'Ali Ahmed, A123456, 10, Forward\nHassan Ibrahim, A654321, 1, Goalkeeper'} /></label>
      <div className="button-row compact"><button type="button" className="primary-button" onClick={() => { addParsed(pasteText, 'pasted list'); setPasteText(''); setPasteOpen(false) }}>Add to table</button><button type="button" className="outline-button dark" onClick={() => { setPasteText(''); setPasteOpen(false) }}>Cancel</button></div>
    </div>}
    <div className="org-roster-table qr-table"><table>
      <caption className="sr-only">Players to add</caption>
      <thead><tr><th scope="col">Name</th><th scope="col">ID card <button type="button" className="ed-link-btn inline" aria-pressed={reveal} aria-label={reveal ? 'Hide ID numbers' : 'Show ID numbers'} onClick={() => setReveal(value => !value)}>{reveal ? <EyeOff size={13} /> : <Eye size={13} />}</button></th><th scope="col">Jersey</th><th scope="col">Position</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
      <tbody>{rows.map((row, index) => { const done = row.status === 'added'; const problem = problems.get(row.key); return <tr key={row.key} className={`qr-${row.status}`}>
        <td><input aria-label={`Player ${index + 1} name`} value={row.name} maxLength={80} disabled={done || Boolean(busy)} onChange={event => update(row.key, { name: event.target.value, status: row.existingId ? row.status : 'new', matches: [], message: null })} /></td>
        <td>{row.existingId ? <small>Not needed</small> : <input aria-label={`Player ${index + 1} ID card`} type={reveal ? 'text' : 'password'} value={row.nationalId} autoComplete="off" spellCheck={false} inputMode="text" placeholder="A123456" disabled={done || Boolean(busy)} onChange={event => update(row.key, { nationalId: event.target.value })} />}</td>
        <td><input className="org-shirt" aria-label={`Player ${index + 1} jersey`} inputMode="numeric" maxLength={2} value={row.jersey} disabled={done || Boolean(busy)} onChange={event => update(row.key, { jersey: event.target.value.replace(/\D/g, '') })} /></td>
        <td><input aria-label={`Player ${index + 1} position`} value={row.position} maxLength={40} disabled={done || Boolean(busy)} onChange={event => update(row.key, { position: event.target.value })} /></td>
        <td className="qr-status">
          <span className={`org-tag${row.status === 'added' ? '' : ' muted'}`}>{STATUS_LABEL[row.status]}</span>
          {row.status === 'possible_duplicate' && <span className="qr-matches">{row.matches.map(match => <button type="button" key={match.id} className="ed-link-btn inline" onClick={() => update(row.key, { status: 'existing', existingId: match.id, nationalId: '', matches: [], message: null })}>Use {match.name}{match.island ? ` (${match.island})` : ''}</button>)}<button type="button" className="ed-link-btn inline" onClick={() => { setConfirmedNew(current => new Set(current).add(row.key)); update(row.key, { status: 'new', matches: [] }) }}>Keep as new</button></span>}
          {row.message ? <small className="qr-message" role="status">{row.message}</small> : problem && (row.name || row.nationalId) ? <small className="qr-message">{problem}</small> : null}
        </td>
        <td>{!done && <button type="button" className="ed-icon-btn" aria-label={`Remove player ${index + 1}`} disabled={Boolean(busy)} onClick={() => setRows(current => current.filter(item => item.key !== row.key))}><Trash2 size={14} /></button>}</td>
      </tr> })}</tbody>
    </table></div>
    <p className="field-hint"><ShieldCheck size={12} /> Each ID card is checked privately against every player and never stored; only a protected digest is kept. A player already registered with that ID is never created twice. Claimed players with an account join through their team’s invitation instead.</p>
    {note && <p className="field-hint" role="status">{note}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="button-row"><button type="button" className="primary-button" disabled={Boolean(busy) || !pending.length} onClick={() => void addAll()}>{busy === 'adding' ? 'Adding players…' : busy === 'checking' ? 'Checking…' : `Add ${pending.length || ''} player${pending.length === 1 ? '' : 's'} to the team`}</button></div>
  </section>
}
