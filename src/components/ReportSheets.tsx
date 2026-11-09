import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ClipboardList, Download, FileText } from 'lucide-react'
import type { OrganizerTournament, TournamentEntry, TournamentMatch } from '../lib/organizer'
import { loadStages, maldivesTime, toCsv } from '../lib/tournamentPages'
import { AWARD_LABELS, loadTournamentAwards, loadTournamentStandings, sortStandings, type StandingsRow } from '../lib/competitionRecords'
import { loadLineupCandidates, type LineupCandidate } from '../lib/matchCenter'
import { downloadBlob } from '../lib/cardImage'

// Standings report, printable match sheets and the final tournament report
// (owner, 2026-11-03). Public fields only: no ID numbers, contact details,
// documents, payment proofs or private notes.

type Sheet = { kind: 'match'; match: TournamentMatch; players: LineupCandidate[] } | { kind: 'final'; standings: StandingsRow[]; stageNames: Record<string, string>; awards: Array<{ label: string; recipient: string }> }

// Prints only the sheet: the rest of the page is hidden while it prints.
function printSheet() {
  document.body.classList.add('kv-printing-sheet')
  const done = () => { document.body.classList.remove('kv-printing-sheet'); window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done)
  window.setTimeout(() => { window.print(); window.setTimeout(done, 1000) }, 50)
}

export function ReportSheets({ client, tournament, entries, matches, scores }: { client: SupabaseClient; tournament: OrganizerTournament; entries: TournamentEntry[]; matches: TournamentMatch[]; scores: Map<string, { homeScore: number; awayScore: number }> }) {
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [matchId, setMatchId] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const teamName = (id: string) => entries.find(entry => entry.team_id === id)?.team_name ?? matches.find(match => match.home_team_id === id)?.home_team_name ?? matches.find(match => match.away_team_id === id)?.away_team_name ?? 'Team'
  const name = tournament.slug || 'tournament'
  const loadStandings = async () => {
    const stages = await loadStages(client, tournament.id)
    if (stages.error) return null
    const usable = stages.data.filter(stage => !(stage.rules as Record<string, unknown>).superseded)
    const standings = await loadTournamentStandings(client, usable.map(stage => stage.id))
    if (standings.error) return null
    return { rows: standings.data, stageNames: Object.fromEntries(usable.map(stage => [stage.id, stage.name])) }
  }
  const standingsCsv = async () => {
    setBusy('standings'); setError('')
    const loaded = await loadStandings()
    setBusy('')
    if (!loaded) return setError('Standings could not be loaded. Please try again.')
    if (!loaded.rows.length) return setError('No standings yet: they are calculated from confirmed results.')
    const csv = toCsv(['Stage', 'Position', 'Team', 'Played', 'Won', 'Drawn', 'Lost', 'For', 'Against', 'Difference', 'Points'], Object.keys(loaded.stageNames).flatMap(stageId => sortStandings(loaded.rows.filter(row => row.stageId === stageId)).map((row, index) => [loaded.stageNames[stageId], index + 1, teamName(row.teamId), row.played, row.wins, row.draws, row.losses, row.scored, row.conceded, row.scored - row.conceded, row.points])))
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${name}-standings.csv`)
  }
  const matchSheet = async () => {
    const match = matches.find(item => item.id === matchId)
    if (!match) return setError('Choose a match first.')
    setBusy('sheet'); setError('')
    const players = await loadLineupCandidates(client, match.id)
    setBusy('')
    if (players.error) return setError('The squads could not be loaded. Please try again.')
    setSheet({ kind: 'match', match, players: players.data }); printSheet()
  }
  const finalReport = async () => {
    setBusy('final'); setError('')
    const [loaded, awards] = await Promise.all([loadStandings(), loadTournamentAwards(client, tournament.id)])
    setBusy('')
    if (!loaded || awards.error) return setError('The report could not be prepared. Please try again.')
    setSheet({ kind: 'final', standings: loaded.rows, stageNames: loaded.stageNames, awards: awards.data.map(award => ({ label: AWARD_LABELS[award.kind.replace(/^award_/, '') as keyof typeof AWARD_LABELS] ?? 'Award', recipient: award.label })) }); printSheet()
  }
  const confirmed = matches.filter(match => match.status === 'confirmed')
  return <>
    <div className="button-row wrap">
      <button type="button" className="outline-button dark" disabled={busy === 'standings'} onClick={() => void standingsCsv()}><Download size={14} /> {busy === 'standings' ? 'Preparing…' : 'Standings'}</button>
      <button type="button" className="outline-button dark" disabled={busy === 'final'} onClick={() => void finalReport()}><FileText size={14} /> {busy === 'final' ? 'Preparing…' : 'Final tournament report (print or PDF)'}</button>
    </div>
    <div className="flow-inline">
      <label>Match sheet<select value={matchId} onChange={event => setMatchId(event.target.value)}><option value="">Choose a match</option>{matches.filter(match => match.status !== 'cancelled').map(match => <option key={match.id} value={match.id}>{match.home_team_name ?? 'Team'} vs {match.away_team_name ?? 'Team'}{match.scheduled_at ? ` · ${maldivesTime(match.scheduled_at)}` : ''}</option>)}</select></label>
      <button type="button" className="outline-button dark" disabled={!matchId || busy === 'sheet'} onClick={() => void matchSheet()}><ClipboardList size={14} /> {busy === 'sheet' ? 'Preparing…' : 'Print match sheet'}</button>
    </div>
    <p className="field-hint">Use your browser's print window to save as PDF.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {sheet && createPortal(<div className="kv-print-sheet" aria-hidden="true">
      <h1>{tournament.name}</h1>
      {sheet.kind === 'match' ? <>
        <h2>Match sheet: {sheet.match.home_team_name ?? 'Team'} vs {sheet.match.away_team_name ?? 'Team'}</h2>
        <p>{sheet.match.scheduled_at ? maldivesTime(sheet.match.scheduled_at) : 'Time not set'} · {sheet.match.venue ?? 'Venue not set'}</p>
        <div className="kv-sheet-teams">{[sheet.match.home_team_id, sheet.match.away_team_id].map(teamId => <table key={teamId}><caption>{teamName(teamId)}</caption><thead><tr><th>No.</th><th>Player</th><th>Started</th><th>Goals</th><th>Cards</th></tr></thead>
          <tbody>{sheet.players.filter(player => player.teamId === teamId).map(player => <tr key={player.playerId}><td>{player.shirtNumber ?? ''}</td><td>{player.name}</td><td /><td /><td /></tr>)}{sheet.players.every(player => player.teamId !== teamId) && <tr><td colSpan={5}>No approved squad list.</td></tr>}</tbody></table>)}</div>
        <p className="kv-sheet-score">Final score: ______ – ______</p>
        <p>Referee: ____________________ Signature: ____________________</p>
        <p>Home captain: ____________________ Away captain: ____________________</p>
      </> : <>
        <h2>Final tournament report</h2>
        <p>{entries.filter(entry => entry.application_status === 'approved').length} teams · {confirmed.length} confirmed results. Built from confirmed results only.</p>
        <h3>Awards</h3>
        {sheet.awards.length ? <ul>{sheet.awards.map(award => <li key={`${award.label}-${award.recipient}`}>{award.label}: {award.recipient}</li>)}</ul> : <p>No awards recorded.</p>}
        {Object.keys(sheet.stageNames).map(stageId => { const rows = sortStandings(sheet.standings.filter(row => row.stageId === stageId)); return rows.length ? <table key={stageId}><caption>{sheet.stageNames[stageId]}</caption><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Diff</th><th>Pts</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.teamId}><td>{index + 1}</td><td>{teamName(row.teamId)}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.scored - row.conceded}</td><td>{row.points}</td></tr>)}</tbody></table> : null })}
        <h3>Confirmed results</h3>
        {confirmed.length ? <table><tbody>{confirmed.map(match => { const score = scores.get(match.id); return <tr key={match.id}><td>{maldivesTime(match.scheduled_at)}</td><td>{match.home_team_name ?? 'Team'}</td><td>{score ? `${score.homeScore} – ${score.awayScore}` : 'Not recorded'}</td><td>{match.away_team_name ?? 'Team'}</td></tr> })}</tbody></table> : <p>No confirmed results.</p>}
      </>}
      <p className="kv-sheet-foot">Kulhivaru+ · printed {new Date().toLocaleString('en-GB', { timeZone: 'Indian/Maldives' })} (Maldives time)</p>
    </div>, document.body)}
  </>
}
