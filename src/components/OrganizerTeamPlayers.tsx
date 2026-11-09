import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ArrowLeft, Check, Copy, Download, Fingerprint, ListChecks, Lock, Printer, Search, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { QuickRosterEntry } from './QuickRosterEntry'
import { loadPreviousRoster, loadRecordStatuses, RECORD_STATUS_LABELS, rosterCsv } from '../lib/quickRoster'
import { downloadBlob } from '../lib/cardImage'
import { loadEntrySquad, loadRosterLimits, organizerAddPlayer, searchUnclaimedPlayers, submitRosterLines, validateRosterLines, type RosterLine, type SquadPlayer, type UnclaimedMatch } from '../lib/teamHub'
import type { IdentityInput } from '../lib/identity'

// Organizer view of one entered team: add players to it, then submit its
// tournament roster. Organizers can add players without an account (existing
// or new); players with an account join a team only through its manager's
// invitation, which they accept. The roster is then reviewed as usual.
export function OrganizerTeamPlayers({ client, userId, entryId, tournamentId, teamName, locked, onNotice, onChanged }: {
  client: SupabaseClient; userId: string; entryId: string; tournamentId: string; teamName: string; locked: boolean; onNotice: (message: string) => void; onChanged: () => void
}) {
  const [squad, setSquad] = useState<SquadPlayer[]>([])
  const [loadError, setLoadError] = useState('')
  const [lines, setLines] = useState<Record<string, { selected: boolean; shirt: string; position: string; captain: boolean; goalkeeper: boolean }>>({})
  const [limits, setLimits] = useState<{ min: number | null; max: number | null }>({ min: null, max: null })
  const [mode, setMode] = useState<'quick' | 'search' | 'new' | null>(null)
  const [statuses, setStatuses] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reload = useCallback(() => {
    void loadEntrySquad(client, entryId).then(result => {
      setSquad(result.data); setLoadError(result.error ?? '')
      setLines(current => Object.fromEntries(result.data.map(player => [player.id, current[player.id] ?? { selected: false, shirt: player.jerseyNumber !== null ? String(player.jerseyNumber) : '', position: player.position ?? '', captain: player.squadRole === 'captain', goalkeeper: false }])))
    })
  }, [client, entryId])
  useEffect(() => { reload() }, [reload])
  useEffect(() => { if (!squad.length) return; let active = true; void loadRecordStatuses(client, squad.map(player => player.id)).then(next => { if (active) setStatuses(next) }); return () => { active = false } }, [client, squad])
  const copyPrevious = async () => {
    setError('')
    const previous = await loadPreviousRoster(client, entryId)
    if (previous.error) return setError(previous.error)
    if (!previous.data.length) return onNotice('No earlier roster with current squad players was found for this team.')
    setLines(current => { const next = { ...current }; for (const line of previous.data) if (next[line.playerId]) next[line.playerId] = { ...next[line.playerId], selected: true, shirt: next[line.playerId].shirt || line.shirt, position: next[line.playerId].position || line.position }; return next })
    onNotice(`${previous.data.length} player${previous.data.length === 1 ? '' : 's'} selected from the roster for ${previous.data[0].tournament}. Check numbers and positions, then submit.`)
  }
  useEffect(() => { void loadRosterLimits(client, tournamentId).then(setLimits) }, [client, tournamentId])

  const chosen: RosterLine[] = squad.filter(player => lines[player.id]?.selected).map(player => ({ playerId: player.id, name: player.name, shirtNumber: lines[player.id].shirt, position: lines[player.id].position, isCaptain: lines[player.id].captain, isGoalkeeper: lines[player.id].goalkeeper, claimed: player.claimed, identity: 'unknown' }))
  const problems = validateRosterLines(chosen, limits)
  const set = (id: string, patch: Partial<(typeof lines)[string]>) => setLines(current => ({ ...current, [id]: { ...current[id], ...patch } }))
  const setCaptain = (id: string) => setLines(current => Object.fromEntries(Object.entries(current).map(([key, line]) => [key, { ...line, captain: key === id ? !line.captain : false }])))
  const submit = async () => {
    if (problems.length) return setError(problems[0])
    setBusy(true); setError('')
    const result = await submitRosterLines(client, entryId, userId, chosen)
    setBusy(false)
    if (result.error) return setError(result.error)
    onNotice(`Roster for ${teamName} submitted with ${chosen.length} players. Approve or lock it when ready.`); onChanged()
  }

  if (loadError) return <p className={loadError.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{loadError}</p>
  if (mode === 'search' || mode === 'new') return <section className="org-player-entry"><button type="button" className="back-link" onClick={() => setMode(null)}><ArrowLeft size={16} aria-hidden="true" /> Back to team roster</button><header><h2>{mode === 'search' ? 'Find or add a player' : 'Create player record'}</h2><p>{mode === 'search' ? 'Find an existing record before creating a new player.' : 'Create a record only when this player does not already have one.'}</p></header><div className="sq-two"><AddPlayerForm client={client} userId={userId} entryId={entryId} mode={mode} onDone={added => { setMode(null); if (added) { onNotice(`${added} was added to ${teamName}.`); reload() } }} /><aside className="sq-col"><section className="sq-card"><h3 className="sq-card-title"><Users size={22} aria-hidden="true" /> Adding to</h3><strong className="org-player-team-name">{teamName}</strong><p>Team squad and tournament roster membership are tracked separately.</p></section><section className="sq-card"><h3 className="sq-card-title"><ShieldCheck size={22} aria-hidden="true" /> Keep one player record</h3><p>Search first to preserve a player’s complete sporting history. Players with an account join through their team manager’s invitation.</p><p className="sq-lockline"><Lock size={18} aria-hidden="true" /> Identification is checked privately. It is never shown on public pages.</p></section></aside></div></section>
  return <div className="org-team-players">
    <div className="org-team-head"><h4><Users size={15} /> Players in {teamName}</h4>
      {!locked && <div className="button-row"><button type="button" className="primary-button" aria-expanded={mode === 'quick'} onClick={() => setMode(mode === 'quick' ? null : 'quick')}><ListChecks size={13} /> Quick add players</button><button type="button" className="outline-button dark" onClick={() => setMode('search')}><Search size={13} /> Add existing player</button><button type="button" className="outline-button dark" onClick={() => setMode('new')}><UserPlus size={13} /> Create new player</button></div>}
    </div>
    {mode === 'quick' && <QuickRosterEntry client={client} userId={userId} entryId={entryId} takenJerseys={squad.map(player => player.jerseyNumber).filter((value): value is number => value !== null)} onDone={added => { onNotice(`${added} player${added === 1 ? '' : 's'} added to ${teamName}.`); reload() }} />}
    {squad.length > 0 && <div className="button-row compact org-batch" aria-label="Roster batch actions">
      {!locked && <><button type="button" className="outline-button dark" onClick={() => void copyPrevious()}><Copy size={13} /> Copy previous roster</button><button type="button" className="outline-button dark" onClick={() => setLines(current => Object.fromEntries(Object.entries(current).map(([key, line]) => [key, { ...line, selected: true }])))}>Select all</button>
      <button type="button" className="outline-button dark" onClick={() => setLines(current => Object.fromEntries(Object.entries(current).map(([key, line]) => [key, { ...line, selected: false }])))}>Clear selection</button></>}
      <button type="button" className="outline-button dark" onClick={() => downloadBlob(new Blob([rosterCsv(squad.map(player => ({ name: player.name, jersey: lines[player.id]?.shirt || player.jerseyNumber, position: lines[player.id]?.position || player.position, claimed: player.claimed, onRoster: Boolean(lines[player.id]?.selected) })))], { type: 'text/csv;charset=utf-8' }), `${teamName.replace(/[^A-Za-z0-9-]+/g, '-')}-roster.csv`)}><Download size={13} /> Export CSV</button>
      <button type="button" className="outline-button dark" onClick={() => window.print()}><Printer size={13} /> Print</button>
    </div>}
    {squad.length ? <div className="org-roster-table"><table>
      <thead><tr><th scope="col">On roster</th><th scope="col">Player</th><th scope="col">Shirt</th><th scope="col">Position</th><th scope="col">Captain</th><th scope="col">GK</th></tr></thead>
      <tbody>{squad.map(player => { const line = lines[player.id]; if (!line) return null; return <tr key={player.id} className={line.selected ? 'on' : ''}>
        <td><input type="checkbox" aria-label={`Put ${player.name} on the roster`} checked={line.selected} disabled={locked} onChange={event => set(player.id, { selected: event.target.checked })} /></td>
        <td>{player.name}{statuses.get(player.id) ? <small className={`org-tag${['claimed', 'verified'].includes(statuses.get(player.id) ?? '') ? '' : ' muted'}`}>{['claimed', 'verified'].includes(statuses.get(player.id) ?? '') ? <Check size={11} /> : null} {RECORD_STATUS_LABELS[statuses.get(player.id) ?? ''] ?? 'Unclaimed'}</small> : player.claimed ? <small className="org-tag"><Check size={11} /> Has account</small> : <small className="org-tag muted">No account yet</small>}</td>
        <td><input className="org-shirt" inputMode="numeric" maxLength={2} aria-label={`${player.name} shirt number`} value={line.shirt} disabled={!line.selected || locked} onChange={event => set(player.id, { shirt: event.target.value.replace(/\D/g, '') })} /></td>
        <td><input maxLength={40} aria-label={`${player.name} position`} value={line.position} disabled={!line.selected || locked} onChange={event => set(player.id, { position: event.target.value })} /></td>
        <td><input type="radio" name={`captain-${entryId}`} aria-label={`${player.name} is captain`} checked={line.captain} disabled={!line.selected || locked} onChange={() => setCaptain(player.id)} /></td>
        <td><input type="checkbox" aria-label={`${player.name} is goalkeeper`} checked={line.goalkeeper} disabled={!line.selected || locked} onChange={event => set(player.id, { goalkeeper: event.target.checked })} /></td>
      </tr> })}</tbody>
    </table></div> : <p className="empty-note">No players in this team yet. Add existing players or create new ones above.</p>}
    {chosen.length > 0 && problems.length > 0 && <ul className="org-problems">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {!locked && squad.length > 0 && <div className="button-row"><button type="button" className="primary-button" disabled={busy || chosen.length === 0 || problems.length > 0} onClick={() => void submit()}>{busy ? 'Submitting…' : `Submit roster (${chosen.length})`}</button><span className="field-hint">{limits.min !== null || limits.max !== null ? `Roster size ${limits.min ?? 0}–${limits.max ?? 'any'}. ` : ''}Every submission is kept as a new version.</span></div>}
    {locked && <p className="field-hint"><Lock size={12} /> The roster is locked.</p>}
  </div>
}

function AddPlayerForm({ client, userId, entryId, mode, onDone }: { client: SupabaseClient; userId: string; entryId: string; mode: 'search' | 'new'; onDone: (added: string | null) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UnclaimedMatch[]>([])
  const [picked, setPicked] = useState<UnclaimedMatch | null>(null)
  const [form, setForm] = useState({ name: '', island: '', position: '', jerseyNumber: '', idType: 'maldivian_national_id' as IdentityInput['identifierType'], idValue: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (mode !== 'search' || query.trim().length < 2) { setResults([]); return }
    let active = true
    const timer = window.setTimeout(() => { void searchUnclaimedPlayers(client, query, { entryId }).then(result => { if (active) { setResults(result.data); setError(result.error ?? '') } }) }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [client, entryId, mode, query])
  const submit = async () => {
    setBusy(true); setError('')
    const identity: IdentityInput | null = mode === 'new' && form.idValue.trim() ? { identifierType: form.idType, value: form.idValue } : null
    const result = await organizerAddPlayer(client, { entryId, userId, playerId: mode === 'search' ? picked?.id ?? null : null, name: form.name, island: form.island, position: form.position, jerseyNumber: form.jerseyNumber, identity })
    setBusy(false); setForm(current => ({ ...current, idValue: '' }))
    if (result.error) return setError(result.error)
    onDone(mode === 'search' ? picked?.name ?? 'The player' : form.name.trim())
  }
  return <div className="panel-block org-add-player">
    {mode === 'search' ? (!picked ? <>
      <label>Search players without an account<input value={query} autoComplete="off" onChange={event => setQuery(event.target.value)} placeholder="At least 2 letters" /></label>
      {results.map(item => <div className="result-row" key={item.id}><div><strong>{item.name}</strong><span>{item.island ?? 'Island not recorded'}</span></div><button type="button" className="outline-button dark" onClick={() => setPicked(item)}>Choose</button></div>)}
      {query.trim().length >= 2 && !results.length && !error && <p className="field-hint">No match. Create a new player instead; players with an account join through their team’s invitation.</p>}
    </> : <p className="field-hint"><Check size={12} /> Adding <strong>{picked.name}</strong> <button type="button" className="ed-link-btn inline" onClick={() => setPicked(null)}>Change</button></p>)
      : <div className="form-grid">
        <label>Name<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label>Island<input value={form.island} list="kv-islands" onChange={event => setForm({ ...form, island: event.target.value })} /></label>
        <label><span><Fingerprint size={13} /> National ID (recommended, private)</span><input value={form.idValue} autoComplete="off" spellCheck={false} placeholder="A123456" onChange={event => setForm({ ...form, idValue: event.target.value })} /></label>
        <label>Document<select value={form.idType} onChange={event => setForm({ ...form, idType: event.target.value as IdentityInput['identifierType'] })}><option value="maldivian_national_id">Maldivian ID card</option><option value="foreign_document">Foreign document</option></select></label>
      </div>}
    {(mode === 'new' || picked) && <div className="form-grid">
      <label>Position<input value={form.position} maxLength={40} onChange={event => setForm({ ...form, position: event.target.value })} /></label>
      <label>Jersey number<input inputMode="numeric" maxLength={2} value={form.jerseyNumber} onChange={event => setForm({ ...form, jerseyNumber: event.target.value.replace(/\D/g, '') })} /></label>
    </div>}
    {mode === 'new' && <p className="field-hint"><ShieldCheck size={12} /> The ID is checked privately against every profile and never stored. If the player already exists, nothing is created.</p>}
    {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
    <div className="button-row"><button type="button" className="primary-button" disabled={busy || (mode === 'search' ? !picked : form.name.trim().length < 2)} onClick={() => void submit()}>{busy ? 'Adding…' : 'Add to team'}</button><button type="button" className="outline-button dark" onClick={() => onDone(null)}>Cancel</button></div>
  </div>
}
