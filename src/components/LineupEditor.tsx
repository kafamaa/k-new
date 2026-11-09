import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Users } from 'lucide-react'
import { loadLineupCandidates, loadMatchLineup, recordMatchParticipants, type LineupCandidate, type LineupEntry } from '../lib/matchCenter'
import { isOffline, readOffline, saveOffline } from '../lib/offlineCache'

// Who played in one match. Candidates come from each team's latest approved or
// locked roster (get_match_lineup_candidates), so an official picks from real
// roster rows instead of typing identifiers. Saved lineups drive appearances,
// starts and minutes once the result is confirmed.
export function LineupEditor({ client, userId, matchId, teamNames, onNotice, onCandidates }: {
  client: SupabaseClient; userId: string; matchId: string; teamNames: Record<string, string>; onNotice: (message: string) => void; onCandidates?: (candidates: LineupCandidate[]) => void
}) {
  const [candidates, setCandidates] = useState<LineupCandidate[]>([])
  const [lineup, setLineup] = useState<Record<string, LineupEntry>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true); setError('')
      const [options, saved] = await Promise.all([loadLineupCandidates(client, matchId), loadMatchLineup(client, matchId)])
      if (!active) return
      setLoading(false)
      // Offline: use the rosters last loaded for this match by this account.
      const cached = options.error && isOffline() ? readOffline<LineupCandidate[]>(userId, `lineup.${matchId}`) : null
      if (cached) { setCandidates(cached.value); onCandidates?.(cached.value); setError('Offline: rosters as last loaded. The lineup can be saved once you reconnect.'); return }
      if (options.error) { setError(options.error); return }
      saveOffline(userId, `lineup.${matchId}`, options.data)
      setCandidates(options.data)
      onCandidates?.(options.data)
      setLineup(Object.fromEntries(saved.data.map(entry => [entry.playerId, entry])))
    })()
    return () => { active = false }
  }, [client, matchId, onCandidates, userId])

  const toggle = (candidate: LineupCandidate) => setLineup(current => {
    const next = { ...current }
    if (next[candidate.playerId]) delete next[candidate.playerId]
    else next[candidate.playerId] = { playerId: candidate.playerId, teamId: candidate.teamId, starter: true, minutes: null }
    return next
  })
  const patch = (playerId: string, change: Partial<LineupEntry>) => setLineup(current => ({ ...current, [playerId]: { ...current[playerId], ...change } }))

  const save = async () => {
    setSaving(true); setError('')
    const result = await recordMatchParticipants(client, matchId, Object.values(lineup), userId)
    setSaving(false)
    if (result.error) return setError(result.error.includes('function') ? 'Lineups need migration 025 to be applied.' : result.error)
    onNotice(`Lineup saved: ${result.count} player${result.count === 1 ? '' : 's'}.`)
  }

  if (loading) return <div className="loading-state">Loading the match rosters…</div>
  const teams = [...new Set(candidates.map(candidate => candidate.teamId))]
  return <section className="player-card-section lineup-editor">
    <h4><Users size={15} /> Lineup</h4>
    {error && <div className="form-error" role="alert">{error.includes('function') ? 'Lineups need migration 025 to be applied.' : error}</div>}
    {!error && candidates.length === 0 && <small>No approved or locked roster exists for either team yet, so no players can be selected.</small>}
    {teams.map(teamId => <div key={teamId} className="lineup-team">
      <strong>{teamNames[teamId] ?? 'Team'}</strong>
      <ul className="plain-list">{candidates.filter(candidate => candidate.teamId === teamId).map(candidate => {
        const entry = lineup[candidate.playerId]
        return <li key={candidate.playerId}>
          <label><input type="checkbox" checked={Boolean(entry)} onChange={() => toggle(candidate)} /> {candidate.shirtNumber ? `#${candidate.shirtNumber} ` : ''}{candidate.name}</label>
          {entry && <>
            <label><input type="checkbox" checked={entry.starter} onChange={event => patch(candidate.playerId, { starter: event.target.checked })} /> Starter</label>
            <label>Minutes<input type="number" min="0" value={entry.minutes ?? ''} onChange={event => patch(candidate.playerId, { minutes: event.target.value === '' ? null : Math.max(0, Number(event.target.value)) })} /></label>
          </>}
        </li>
      })}</ul>
    </div>)}
    {candidates.length > 0 && <button type="button" className="outline-button dark" disabled={saving} onClick={() => { void save() }}>{saving ? 'Saving…' : 'Save lineup'}</button>}
    <small>Minutes are optional; leave them empty when not captured, so they are never counted as zero.</small>
  </section>
}
