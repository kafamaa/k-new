import { useEffect, useState } from 'react'
import { PlayerCard } from './PlayerCard'
import { publicSupabase } from '../lib/supabase'
import { getPublishedPlayers, getPlayerHistory, getPlayerStatistics } from '../lib/publicData'
import { totalOfficialStatistics, computePlayerRating } from '../lib/playerRating'
import type { PublicRecord } from '../lib/publicData'

// Homepage showcase of the Verified Player Card. It renders only a genuinely
// published player and their confirmed official statistics. If no player is
// published yet, it shows an honest empty state instead of inventing a demo
// card, so the "real data only" rule holds on the landing page too.
export function HomepagePlayerCard() {
  const [profile, setProfile] = useState<PublicRecord | null>(null)
  const [statistics, setStatistics] = useState<PublicRecord[]>([])
  const [history, setHistory] = useState<PublicRecord[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!publicSupabase) { setLoaded(true); return }
    let active = true
    void (async () => {
      const players = await getPublishedPlayers(publicSupabase)
      const first = (players.data ?? [])[0] ?? null
      if (!active) return
      if (!first) { setProfile(null); setLoaded(true); return }
      const [stats, history] = await Promise.all([
        getPlayerStatistics(publicSupabase, String(first.id)),
        getPlayerHistory(publicSupabase, String(first.id)),
      ])
      if (!active) return
      setProfile(first)
      setStatistics(stats.data ?? [])
      setHistory(history.data ?? [])
      setLoaded(true)
    })()
    return () => { active = false }
  }, [])

  if (!loaded) return <div className="loading-state">Loading a verified player card…</div>
  if (!profile) return <div className="empty-state"><p>No player profile has been published yet. Once a player is published, their verified card appears here.</p></div>

  const totals = totalOfficialStatistics(statistics)
  const rating = computePlayerRating(totals)
  // Most recent active membership, matching the workspace's current-team logic.
  const current = history
    .filter(row => row.status === 'active')
    .sort((a, b) => String(b.effective_from ?? '').localeCompare(String(a.effective_from ?? '')))[0] ?? null
  const teamName = current ? String((current.teams as Record<string, unknown> | null)?.name ?? '') || null : null

  return <PlayerCard profile={profile} teamName={teamName} totals={totals} rating={rating} isPublished />
}
