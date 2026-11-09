import { useEffect, useState } from 'react'
import { Image as ImageIcon, Medal, Trophy } from 'lucide-react'
import { publicSupabase } from '../lib/supabase'
import { loadMatchFeed, type FeedMatch } from '../lib/landing'
import { loadPublicAwards, loadTournamentPlayers, loadTournamentPlayerStats, rankBy, type Pending, type PublicAward, type TournamentPlayer, type TournamentPlayerStat } from '../lib/publicPages'
import { formatMatchSchedule } from '../lib/publicData'
import { downloadBlob } from '../lib/cardImage'
import { renderRankingImage, renderResultImage } from '../lib/resultImage'
import { Crest, EdEmpty } from './Editorial'
import { loadTournamentArchive } from '../lib/engineStore'

// Public tournament tabs added with the flat tab row (owner, 2026-11-02): Results
// with shareable images, Players, Statistics and Awards. Public data only; each
// tab says plainly when something is not recorded or not available yet.

function usePending<T>(load: () => Promise<Pending<T>>, initial: T, key: string): Pending<T> & { loading: boolean } {
  const [state, setState] = useState<Pending<T> & { loading: boolean }>({ data: initial, state: 'ready', loading: true })
  useEffect(() => {
    let active = true
    void load().then(result => { if (active) setState({ ...result, loading: false }) })
    return () => { active = false }
    // key identifies the tournament; load is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}

const PENDING_NOTE = 'This list appears once the platform owner applies update 043.'

export function TournamentResults({ tournamentId, tournamentName }: { tournamentId: string; tournamentName: string }) {
  const results = usePending<FeedMatch[]>(async () => {
    if (!publicSupabase) return { data: [], state: 'error' }
    const result = await loadMatchFeed(publicSupabase, { tournamentId, statuses: ['confirmed'], newestFirst: true, limit: 120 })
    return { data: result.data, state: result.error && !result.needsMigration ? 'error' : 'ready' }
  }, [], tournamentId)
  const [busy, setBusy] = useState('')
  const share = async (match: FeedMatch) => {
    const home = match.home.name ?? 'Team'; const away = match.away.name ?? 'Team'
    if (match.homeScore === null || match.awayScore === null) return
    setBusy(match.id)
    const blob = await renderResultImage({ tournament: tournamentName, home, away, homeScore: match.homeScore, awayScore: match.awayScore, when: match.scheduledAt ? formatMatchSchedule(match.scheduledAt) : null, venue: match.venue, corrected: match.corrected })
    setBusy('')
    if (!blob) return
    const file = new File([blob], `${home}-${away}-result.png`.replace(/[^a-z0-9.-]+/gi, '-').toLowerCase(), { type: 'image/png' })
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: `${home} ${match.homeScore}–${match.awayScore} ${away}` }); return }
    } catch { return }
    downloadBlob(blob, file.name)
  }
  if (results.loading) return <EdEmpty>Loading results…</EdEmpty>
  if (results.state === 'error') return <EdEmpty>Results could not be loaded. Please try again.</EdEmpty>
  if (!results.data.length) return <EdEmpty>No confirmed results yet. A result appears here once the organizer confirms it.</EdEmpty>
  return <div className="ed-rows">{results.data.map(match => <div key={match.id} className="ed-match-row pt-result">
    <a className="pt-result-link" href={`#matches/${encodeURIComponent(match.id)}`}>
      <span className="ed-match-side"><Crest name={match.home.name ?? 'Team'} logoUrl={match.home.logo ?? null} size="sm" /><span>{match.home.name ?? 'Team'}</span></span>
      <span className="ed-match-mid"><strong className="pt-score">{match.homeScore !== null && match.awayScore !== null ? `${match.homeScore} – ${match.awayScore}` : 'Not recorded'}</strong></span>
      <span className="ed-match-side ed-away"><span>{match.away.name ?? 'Team'}</span><Crest name={match.away.name ?? 'Team'} logoUrl={match.away.logo ?? null} size="sm" /></span>
      <span className="ed-match-meta">{formatMatchSchedule(match.scheduledAt)}{match.venue ? ` · ${match.venue}` : ''}{match.corrected ? ' · Corrected' : ''}</span>
    </a>
    {match.homeScore !== null && match.awayScore !== null && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={busy === match.id} onClick={() => void share(match)}><ImageIcon size={14} aria-hidden="true" /> {busy === match.id ? 'Making image…' : 'Share image'}</button>}
  </div>)}</div>
}

export function TournamentPlayersTab({ tournamentId }: { tournamentId: string }) {
  const players = usePending<TournamentPlayer[]>(() => publicSupabase ? loadTournamentPlayers(publicSupabase, tournamentId) : Promise.resolve({ data: [], state: 'error' }), [], tournamentId)
  if (players.loading) return <EdEmpty>Loading players…</EdEmpty>
  if (players.state === 'pending') return <EdEmpty>{PENDING_NOTE}</EdEmpty>
  if (players.state === 'error') return <EdEmpty>Players could not be loaded. Please try again.</EdEmpty>
  if (!players.data.length) return <EdEmpty>No published players on approved squads yet.</EdEmpty>
  const teams = new Map<string, TournamentPlayer[]>()
  for (const player of players.data) teams.set(player.team ?? 'Team', [...(teams.get(player.team ?? 'Team') ?? []), player])
  return <div className="pt-squads">{[...teams.entries()].map(([team, list]) => <section key={team} className="ed-panel"><h2 className="ed-subhead">{team}</h2>
    <ul className="pt-player-list">{list.map(player => <li key={player.slug}><a href={`#player/${encodeURIComponent(player.slug)}`}><Crest name={player.name} logoUrl={player.photo} size="sm" /><span><strong>{player.name}</strong><small>{[player.shirt ? `#${player.shirt}` : null, player.position].filter(Boolean).join(' · ') || 'Player'}</small></span></a></li>)}</ul>
  </section>)}</div>
}

const RANKINGS: Array<{ key: 'goals' | 'assists' | 'yellow' | 'red'; label: string; unit: string }> = [
  { key: 'goals', label: 'Top scorers', unit: 'Goals / points' },
  { key: 'assists', label: 'Assists', unit: 'Assists' },
  { key: 'yellow', label: 'Yellow cards', unit: 'Yellow' },
  { key: 'red', label: 'Red cards', unit: 'Red' },
]

export function TournamentStatsTab({ tournamentId, tournamentName = 'Tournament' }: { tournamentId: string; tournamentName?: string }) {
  const stats = usePending<TournamentPlayerStat[]>(() => publicSupabase ? loadTournamentPlayerStats(publicSupabase, tournamentId) : Promise.resolve({ data: [], state: 'error' }), [], tournamentId)
  const [players, setPlayers] = useState<TournamentPlayer[]>([])
  useEffect(() => { if (!publicSupabase) return; let active = true; void loadTournamentPlayers(publicSupabase, tournamentId).then(r => { if (active) setPlayers(r.data ?? []) }); return () => { active = false } }, [tournamentId])
  const photoBySlug = new Map(players.map(p => [p.slug, p.photo]))
  const [busy, setBusy] = useState('')
  // Ranking graphic: the same public rows as the list, drawn as a shareable image.
  const shareRanking = async (ranking: (typeof RANKINGS)[number], rows: TournamentPlayerStat[]) => {
    setBusy(ranking.key)
    const blob = await renderRankingImage({ tournament: tournamentName, title: ranking.label, unit: ranking.unit, rows: rows.map(row => ({ name: row.name, team: row.team, value: row[ranking.key] })) })
    setBusy('')
    if (!blob) return
    const file = new File([blob], `${tournamentName}-${ranking.label}.png`.replace(/[^a-z0-9.-]+/gi, '-').toLowerCase(), { type: 'image/png' })
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: `${tournamentName}: ${ranking.label}` }); return } } catch { return }
    downloadBlob(blob, file.name)
  }
  if (stats.loading) return <EdEmpty>Loading statistics…</EdEmpty>
  if (stats.state === 'pending') return <EdEmpty>{PENDING_NOTE}</EdEmpty>
  if (stats.state === 'error') return <EdEmpty>Statistics could not be loaded. Please try again.</EdEmpty>
  if (!stats.data.length) return <EdEmpty>Player statistics were not recorded for this tournament yet.</EdEmpty>
  return <div className="pt-rankings">
    <p className="pf-hint">From confirmed matches only. A player who has no entry for a statistic is not listed; nothing is shown as zero.</p>
    {RANKINGS.map(ranking => { const rows = rankBy(stats.data, ranking.key); return <section key={ranking.key} className="ed-panel"><h2 className="ed-subhead"><Medal size={16} aria-hidden="true" /> {ranking.label}</h2>{rows.length > 0 && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={busy === ranking.key} onClick={() => void shareRanking(ranking, rows)}><ImageIcon size={14} aria-hidden="true" /> {busy === ranking.key ? 'Making image…' : 'Share image'}</button>}
      {rows.length ? <ol className="pt-ranking">{rows.map(row => <li key={row.slug}><a href={`#player/${encodeURIComponent(row.slug)}`}><span className="pt-player-avatar">{photoBySlug.get(row.slug) ? <img src={photoBySlug.get(row.slug)!} alt="" loading="lazy" /> : <span>{row.name.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()}</span>}</span><strong>{row.name}</strong><small>{row.team ?? 'Team'} · {row.appearances} match{row.appearances === 1 ? '' : 'es'}</small></a><b aria-label={ranking.unit}>{row[ranking.key]}</b></li>)}</ol>
        : <p className="pf-hint">Not recorded.</p>}
    </section> })}
  </div>
}

export function TournamentAwardsTab({ tournamentId }: { tournamentId: string }) {
  const awards = usePending<PublicAward[]>(() => publicSupabase ? loadPublicAwards(publicSupabase, tournamentId) : Promise.resolve({ data: [], state: 'error' }), [], tournamentId)
  const [players, setPlayers] = useState<TournamentPlayer[]>([])
  useEffect(() => { if (!publicSupabase) return; let active = true; void loadTournamentPlayers(publicSupabase, tournamentId).then(r => { if (active) setPlayers(r.data ?? []) }); return () => { active = false } }, [tournamentId])
  const photoBySlug = new Map(players.map(p => [p.slug, p.photo]))
  if (awards.loading) return <EdEmpty>Loading awards…</EdEmpty>
  if (awards.state === 'error') return <EdEmpty>Awards could not be loaded. Please try again.</EdEmpty>
  if (!awards.data.length) return <EdEmpty>No awards recorded yet. The champion and other awards appear when the organizer records them.</EdEmpty>
  return <ul className="pt-awards">{awards.data.map(award => {
    const slug = award.href ? award.href.split('/').pop() ?? '' : ''
    const photo = slug ? photoBySlug.get(decodeURIComponent(slug)) : null
    const initials = award.recipient.trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?'
    return <li key={`${award.kind}-${award.recipient}`} className={`ed-panel${award.kind === 'champion' ? ' is-champion' : ''}`}>
      <span className="pt-award-avatar">{photo ? <img src={photo} alt="" loading="lazy" /> : <span>{initials}</span>}</span>
      <Trophy size={22} aria-hidden="true" /><small>{award.label}</small>{award.href ? <a href={award.href}><strong>{award.recipient}</strong></a> : <strong>{award.recipient}</strong>}
    </li>
  })}</ul>
}

// The permanent archive record (migration 045): version and publication date.
export function ArchiveStamp({ tournamentId }: { tournamentId: string }) {
  const [archive, setArchive] = useState<{ version: number; createdAt: string } | null>(null)
  useEffect(() => {
    if (!publicSupabase) return
    let active = true
    void loadTournamentArchive(publicSupabase, tournamentId).then(result => { if (active && result.data) setArchive({ version: result.data.version, createdAt: result.data.createdAt }) })
    return () => { active = false }
  }, [tournamentId])
  if (!archive) return null
  return <p className="pf-hint">Permanent archive version {archive.version}, published {formatMatchSchedule(archive.createdAt)}.</p>
}
