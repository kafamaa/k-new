import type { SupabaseClient } from '@supabase/supabase-js'
import { computePlayerRating, type OfficialTotals } from './playerRating'
import { sanitizeSearchQuery, PUBLIC_PLAYER_FIELDS, PUBLIC_TEAM_FIELDS, PUBLIC_TOURNAMENT_FIELDS } from './publicData'

// ---------------------------------------------------------------------------
// Public Landing Page (migration 032). Every loader here uses the session-less
// public client and returns { data, error } so one failed section never blocks
// another, and a failure is never turned into an empty list or a zero.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
export type Loaded<T> = { data: T; error: string | null; needsMigration?: boolean }

const MISSING = /does not exist|PGRST2\d\d|42P0\d|42703|42883|schema cache|could not find/i
export const isMissing = (message: string | null | undefined) => Boolean(message && MISSING.test(message))
export const NEEDS_032 = 'This section needs migration 032.'
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null
const num = (value: unknown) => value === null || value === undefined || value === '' ? null : Number(value)

// --- Maldives time ------------------------------------------------------------
export const MALDIVES_TZ = 'Indian/Maldives'
const MVT_OFFSET_MS = 5 * 60 * 60 * 1000

// yyyy-mm-dd of an instant, in Maldives time.
export function maldivesDayKey(value: string | number | Date): string {
  const date = new Date(value)
  return new Date(date.getTime() + MVT_OFFSET_MS).toISOString().slice(0, 10)
}

// [start, end) of the Maldives calendar day containing `now`, as UTC instants.
export function maldivesDayRange(now = new Date()): { from: string; to: string } {
  const start = Date.parse(`${maldivesDayKey(now)}T00:00:00Z`) - MVT_OFFSET_MS
  return { from: new Date(start).toISOString(), to: new Date(start + 86_400_000).toISOString() }
}

export function formatMvtTime(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString('en-GB', { timeZone: MALDIVES_TZ, hour: '2-digit', minute: '2-digit' })
}

export function timeAgo(iso: string | number | null, now = Date.now()): string {
  if (iso === null) return ''
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

// --- Public match feed ------------------------------------------------------------
export type FeedMatch = {
  id: string; tournamentId: string; tournamentName: string; tournamentSlug: string; sport: string
  stageId: string; stageName: string | null; stageFormat: string | null; stageOrder: number; groupName: string | null; leg: number
  scheduledAt: string | null; venue: string | null; status: string
  home: FeedTeam; away: FeedTeam
  homeScore: number | null; awayScore: number | null; outcome: string | null; confirmedAt: string | null; corrected: boolean
}
export type FeedTeam = { id: string | null; name: string | null; slug: string | null; logo: string | null }

export function toFeedMatch(row: Row): FeedMatch {
  return {
    id: String(row.match_id), tournamentId: String(row.tournament_id), tournamentName: String(row.tournament_name ?? 'Tournament'), tournamentSlug: String(row.tournament_slug ?? row.tournament_id ?? ''), sport: String(row.sport ?? ''),
    stageId: String(row.stage_id ?? ''), stageName: text(row.stage_name), stageFormat: text(row.stage_format), stageOrder: Number(row.stage_order ?? 1), groupName: text(row.group_name), leg: Number(row.leg ?? 1),
    scheduledAt: text(row.scheduled_at), venue: text(row.venue), status: String(row.status ?? 'scheduled'),
    home: { id: text(row.home_team_id), name: text(row.home_name), slug: text(row.home_slug), logo: text(row.home_logo) },
    away: { id: text(row.away_team_id), name: text(row.away_name), slug: text(row.away_slug), logo: text(row.away_logo) },
    homeScore: num(row.home_score), awayScore: num(row.away_score), outcome: text(row.result_outcome), confirmedAt: text(row.confirmed_at), corrected: row.corrected === true,
  }
}

export type FeedQuery = { from?: string; to?: string; statuses?: string[]; tournamentId?: string; limit?: number; newestFirst?: boolean }
export async function loadMatchFeed(client: SupabaseClient, query: FeedQuery, signal?: AbortSignal): Promise<Loaded<FeedMatch[]>> {
  let request = client.rpc('get_public_match_feed', { p_from: query.from ?? null, p_to: query.to ?? null, p_statuses: query.statuses ?? null, p_tournament_id: query.tournamentId ?? null, p_limit: query.limit ?? 60, p_newest_first: query.newestFirst ?? false })
  if (signal) request = request.abortSignal(signal)
  const result = await request
  if (result.error) return { data: [], error: isMissing(result.error.message) ? NEEDS_032 : result.error.message, needsMigration: isMissing(result.error.message) }
  return { data: ((result.data ?? []) as Row[]).map(toFeedMatch), error: null }
}

export const teamLabel = (team: FeedTeam) => team.name ?? 'Team to be confirmed'

// The schema has one in-play state, 'live'. Everything else is excluded from
// Live Now, including finished-awaiting-confirmation.
export const LIVE_STATUSES = ['live'] as const
export const isLive = (status: string) => (LIVE_STATUSES as readonly string[]).includes(status)

export function matchStateLabel(match: Pick<FeedMatch, 'status' | 'outcome'>): { label: string; tone: 'live' | 'provisional' | 'official' | 'plain' | 'warn' } {
  if (match.status === 'confirmed' && match.outcome === 'walkover') return { label: 'Official · walkover', tone: 'official' }
  if (match.status === 'confirmed' && match.outcome === 'forfeit') return { label: 'Official · forfeit', tone: 'official' }
  if (match.status === 'confirmed' && match.outcome === 'abandoned') return { label: 'Official · abandoned', tone: 'official' }
  switch (match.status) {
    case 'live': return { label: 'Live', tone: 'live' }
    case 'awaiting_confirmation': return { label: 'Finished — awaiting confirmation', tone: 'provisional' }
    case 'confirmed': return { label: 'Official', tone: 'official' }
    case 'postponed': return { label: 'Postponed', tone: 'warn' }
    case 'cancelled': return { label: 'Cancelled', tone: 'warn' }
    case 'abandoned': return { label: 'Abandoned', tone: 'warn' }
    default: return { label: 'Scheduled', tone: 'plain' }
  }
}

// A score is shown only for an official result with both sides recorded.
export function officialScore(match: FeedMatch): string | null {
  return match.status === 'confirmed' && match.homeScore !== null && match.awayScore !== null ? `${match.homeScore}–${match.awayScore}` : null
}

// --- Tournaments: two separate status systems ---------------------------------------
export type Capacity = { opensAt: string | null; closesAt: string | null; categoryCount: number; teamLimit: number | null; approved: number }
export async function loadCapacity(client: SupabaseClient, tournamentIds: string[]): Promise<Map<string, Capacity>> {
  const map = new Map<string, Capacity>()
  if (!tournamentIds.length) return map
  const result = await client.rpc('get_public_registration_capacity', { p_tournament_ids: tournamentIds })
  if (result.error) return map
  for (const row of (result.data ?? []) as Row[]) map.set(String(row.tournament_id), { opensAt: text(row.opens_at), closesAt: text(row.closes_at), categoryCount: Number(row.category_count ?? 0), teamLimit: num(row.team_limit_total), approved: Number(row.approved_count ?? 0) })
  return map
}

export type TournamentStatus = 'upcoming' | 'active' | 'completed' | 'postponed' | 'cancelled'
export const TOURNAMENT_STATUS_TEXT: Record<TournamentStatus, string> = { upcoming: 'Upcoming', active: 'Active', completed: 'Completed', postponed: 'Postponed', cancelled: 'Cancelled' }
export function tournamentStatus(status: unknown): TournamentStatus {
  const value = String(status ?? '')
  if (value === 'in_progress') return 'active'
  if (value === 'completed' || value === 'archived') return 'completed'
  if (value === 'cancelled') return 'cancelled'
  if (value === 'postponed') return 'postponed'
  return 'upcoming'
}

export type RegistrationStatus = 'not_open' | 'opens_soon' | 'open' | 'closing_soon' | 'closed' | 'full'
export const REGISTRATION_STATUS_TEXT: Record<RegistrationStatus, string> = { not_open: 'Registration not open', opens_soon: 'Registration opens soon', open: 'Registration open', closing_soon: 'Registration closing soon', closed: 'Registration closed', full: 'Registration full' }
const DAY = 86_400_000
const dayDiff = (iso: string, now: number) => Math.round((Date.parse(`${maldivesDayKey(iso)}T00:00:00Z`) - Date.parse(`${maldivesDayKey(now)}T00:00:00Z`)) / DAY)

// Registration state and the one urgency line, both in Maldives time. Nothing
// is said that the data does not support: places only when every category has
// a limit, dates only when the organizer set them.
export function registrationInfo(status: unknown, capacity: Capacity | undefined, closesAt: string | null | undefined, now = Date.now()): { status: RegistrationStatus | null; urgency: string | null; canRegister: boolean } {
  const value = String(status ?? '')
  const closes = capacity?.closesAt ?? closesAt ?? null
  const opens = capacity?.opensAt ?? null
  const places = capacity && capacity.teamLimit !== null ? Math.max(0, capacity.teamLimit - capacity.approved) : null
  if (['completed', 'archived', 'cancelled', 'in_progress'].includes(value)) return { status: value === 'in_progress' ? 'closed' : null, urgency: null, canRegister: false }
  if (value === 'setup' || (opens && Date.parse(opens) > now)) {
    if (opens && Date.parse(opens) > now) {
      const days = dayDiff(opens, now)
      return { status: days <= 7 ? 'opens_soon' : 'not_open', urgency: days <= 0 ? 'Registration opens today' : `Registration opens in ${days} day${days === 1 ? '' : 's'}`, canRegister: false }
    }
    return { status: 'not_open', urgency: null, canRegister: false }
  }
  if (value === 'registration_closed' || (closes && Date.parse(closes) <= now)) return { status: 'closed', urgency: null, canRegister: false }
  if (value !== 'registration_open') return { status: null, urgency: null, canRegister: false }
  if (capacity && capacity.categoryCount === 0) return { status: 'open', urgency: null, canRegister: false }
  if (places === 0) return { status: 'full', urgency: 'No team places remaining', canRegister: false }
  let urgency: string | null = null
  let state: RegistrationStatus = 'open'
  if (closes) {
    const days = dayDiff(closes, now)
    if (days <= 0) { urgency = 'Registration closes today'; state = 'closing_soon' }
    else if (days <= 3) { urgency = `${days} day${days === 1 ? '' : 's'} remaining`; state = 'closing_soon' }
  }
  if (places !== null && places <= 3) urgency = [urgency, `${places} team place${places === 1 ? '' : 's'} remaining`].filter(Boolean).join(' · ')
  return { status: state, urgency, canRegister: true }
}

export function daysUntil(iso: string | null, now = Date.now()): number | null {
  return iso ? dayDiff(iso, now) : null
}

// Upcoming: published, not started, not completed or cancelled; nearest start
// first, undated last. Postponed stays in the list with its own label.
export function upcomingByStart(tournaments: Row[], startOf: (id: string) => string | null, now = Date.now()): Row[] {
  const today = maldivesDayKey(now)
  return tournaments
    .filter(row => ['setup', 'registration_open', 'registration_closed', 'postponed'].includes(String(row.status)))
    .filter(row => { const start = startOf(String(row.id)); return !start || start.slice(0, 10) >= today })
    .sort((a, b) => (startOf(String(a.id)) ?? '9999').localeCompare(startOf(String(b.id)) ?? '9999'))
}

// Spotlight priority: an admin-promoted tournament, then open registration,
// then active, then the nearest upcoming one.
export function pickSpotlight(tournaments: Row[], promotedIds: string[], startOf: (id: string) => string | null, now = Date.now()): Row | null {
  const byId = new Map(tournaments.map(row => [String(row.id), row]))
  for (const id of promotedIds) { const row = byId.get(id); if (row) return row }
  return tournaments.find(row => row.status === 'registration_open')
    ?? tournaments.find(row => row.status === 'in_progress')
    ?? upcomingByStart(tournaments, startOf, now)[0]
    ?? null
}

export const SPORT_KEYS = ['football', 'futsal', 'handball', 'volleyball', 'basketball', 'basketball_3x3'] as const
export function sportCounts(tournaments: Row[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(SPORT_KEYS.map(key => [key, 0]))
  for (const row of tournaments) { const key = String(row.sport ?? ''); if (key in counts) counts[key] += 1 }
  return counts
}

// --- Standings and bracket -----------------------------------------------------------
// Snapshots are versioned per stage. Only the newest version of each stage is
// shown, so an older calculation never sits next to a newer one.
export function latestStandings(rows: Row[]): Row[] {
  const newest = new Map<string, number>()
  for (const row of rows) { const stage = String(row.stage_id); newest.set(stage, Math.max(newest.get(stage) ?? 0, Number(row.calculated_from_version ?? 0))) }
  return rows.filter(row => Number(row.calculated_from_version ?? 0) === newest.get(String(row.stage_id)))
}

export const STANDINGS_COLUMNS: Record<string, Array<{ key: string; label: string; title: string }>> = {
  goals: [{ key: 'played', label: 'P', title: 'Played' }, { key: 'wins', label: 'W', title: 'Won' }, { key: 'draws', label: 'D', title: 'Drawn' }, { key: 'losses', label: 'L', title: 'Lost' }, { key: 'difference', label: 'GD', title: 'Goal difference' }, { key: 'points', label: 'Pts', title: 'Points' }],
  sets: [{ key: 'played', label: 'P', title: 'Played' }, { key: 'wins', label: 'W', title: 'Won' }, { key: 'losses', label: 'L', title: 'Lost' }, { key: 'difference', label: 'Diff', title: 'Set difference' }, { key: 'points', label: 'Pts', title: 'Points' }],
  points: [{ key: 'played', label: 'P', title: 'Played' }, { key: 'wins', label: 'W', title: 'Won' }, { key: 'losses', label: 'L', title: 'Lost' }, { key: 'difference', label: '+/−', title: 'Points difference' }, { key: 'points', label: 'Pts', title: 'Standing points' }],
}
export function standingsColumns(sport: string) {
  if (sport === 'volleyball') return STANDINGS_COLUMNS.sets
  if (sport === 'basketball' || sport === 'basketball_3x3') return STANDINGS_COLUMNS.points
  return STANDINGS_COLUMNS.goals
}

export type BracketTie = { id: string; home: FeedTeam; away: FeedTeam; score: string | null; scheduledAt: string | null; winner: 'home' | 'away' | null; label: string | null }
export type BracketRound = { stageId: string; label: string; ties: BracketTie[] }
const KNOCKOUT = ['knockout', 'two_leg', 'groups_knockout']

// Knockout stages of one tournament, in stage order. Two-leg ties are joined
// into one with an aggregate; advancement only ever comes from official scores.
export function bracketFromFeed(matches: FeedMatch[], tournamentId: string): BracketRound[] {
  const stages = new Map<string, FeedMatch[]>()
  for (const match of matches) if (match.tournamentId === tournamentId && KNOCKOUT.includes(match.stageFormat ?? '') && !match.groupName) stages.set(match.stageId, [...(stages.get(match.stageId) ?? []), match])
  const ordered = [...stages.values()].sort((a, b) => a[0].stageOrder - b[0].stageOrder)
  return ordered.map(stageMatches => {
    const ties = new Map<string, FeedMatch[]>()
    for (const match of stageMatches) { const key = [match.home.id, match.away.id].sort().join(':') || match.id; ties.set(key, [...(ties.get(key) ?? []), match]) }
    const list: BracketTie[] = [...ties.values()].map(legs => {
      const first = [...legs].sort((a, b) => a.leg - b.leg)[0]
      const official = legs.every(leg => officialScore(leg) !== null)
      let home = 0; let away = 0
      for (const leg of legs) {
        const sameSide = leg.home.id === first.home.id
        home += Number(sameSide ? leg.homeScore : leg.awayScore) || 0
        away += Number(sameSide ? leg.awayScore : leg.homeScore) || 0
      }
      const walkover = legs.find(leg => leg.outcome === 'walkover')
      return {
        id: first.id, home: first.home, away: first.away, scheduledAt: first.scheduledAt,
        score: official ? `${home}–${away}` : null,
        winner: official && home !== away ? (home > away ? 'home' : 'away') : null,
        label: !first.away.id || !first.home.id ? 'Bye' : walkover ? 'Walkover' : legs.length > 1 ? (official ? 'Aggregate' : 'Two legs') : null,
      }
    })
    const count = list.length
    const label = stageMatches[0].stageName ?? (count === 1 ? 'Final' : count === 2 ? 'Semi-finals' : count === 4 ? 'Quarter-finals' : `Round of ${count * 2}`)
    return { stageId: stageMatches[0].stageId, label, ties: list }
  })
}

// --- Players and teams ------------------------------------------------------------------
export type TopPlayer = { id: string; name: string; slug: string; photo: string | null; sport: string | null; teamName: string | null; teamSlug: string | null; totals: OfficialTotals; rating: number }
export async function loadTopPlayers(client: SupabaseClient, sport: string | null = null): Promise<Loaded<TopPlayer[]>> {
  const result = await client.rpc('get_public_top_players', { p_sport: sport, p_min_appearances: 3, p_limit: 60 })
  if (result.error) return { data: [], error: isMissing(result.error.message) ? NEEDS_032 : result.error.message, needsMigration: isMissing(result.error.message) }
  return { data: rankTopPlayers((result.data ?? []) as Row[]), error: null }
}

// Documented ranking: the player rating (src/lib/playerRating.ts) from
// confirmed official statistics, players under the minimum excluded; ties by
// appearances, then goals.
export function rankTopPlayers(rows: Row[]): TopPlayer[] {
  const players: TopPlayer[] = []
  for (const row of rows) {
    const totals: OfficialTotals = { appearances: Number(row.appearances ?? 0), goals: Number(row.goals ?? 0), assists: Number(row.assists ?? 0), yellow: Number(row.yellow_cards ?? 0), red: Number(row.red_cards ?? 0) }
    const rating = computePlayerRating(totals)
    if (rating.status !== 'rated') continue
    players.push({ id: String(row.player_id), name: String(row.display_name ?? 'Player'), slug: String(row.slug ?? row.player_id), photo: text(row.photo_url), sport: text(row.sport), teamName: text(row.team_name), teamSlug: text(row.team_slug), totals, rating: rating.value })
  }
  return players.sort((a, b) => b.rating - a.rating || b.totals.appearances - a.totals.appearances || b.totals.goals - a.totals.goals)
}

// Active teams: official matches in the last 90 days. A real, explainable
// activity measure; there are no follower counts to show.
export function activeTeams(results: FeedMatch[], now = Date.now(), days = 90): Array<{ teamId: string; name: string; slug: string | null; logo: string | null; matches: number }> {
  const since = now - days * DAY
  const counts = new Map<string, { teamId: string; name: string; slug: string | null; logo: string | null; matches: number }>()
  for (const match of results) {
    if (match.status !== 'confirmed' || !match.scheduledAt || Date.parse(match.scheduledAt) < since) continue
    for (const team of [match.home, match.away]) {
      if (!team.id || !team.name || !team.slug) continue
      const entry = counts.get(team.id) ?? { teamId: team.id, name: team.name, slug: team.slug, logo: team.logo, matches: 0 }
      entry.matches += 1; counts.set(team.id, entry)
    }
  }
  return [...counts.values()].sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name))
}

// --- Recently active rail -------------------------------------------------------------------
// There is no popularity model, so the rail is "Recently active": records
// with real recent activity (an official result or an open registration),
// labelled by type, newest activity first.
export type ActiveItem = { kind: 'Tournament' | 'Team' | 'Player'; record: Row; reason: string; at: number }
export function recentlyActive(tournaments: Row[], results: FeedMatch[], topPlayers: TopPlayer[], limit = 10): ActiveItem[] {
  const items: ActiveItem[] = []
  const seenTeams = new Set<string>()
  const lastResultByTournament = new Map<string, number>()
  for (const match of results) {
    const at = Date.parse(match.confirmedAt ?? match.scheduledAt ?? '') || 0
    lastResultByTournament.set(match.tournamentId, Math.max(lastResultByTournament.get(match.tournamentId) ?? 0, at))
    for (const team of [match.home, match.away]) if (team.id && team.slug && team.name && !seenTeams.has(team.id)) {
      seenTeams.add(team.id)
      items.push({ kind: 'Team', record: { id: team.id, name: team.name, slug: team.slug, logo_url: team.logo }, reason: 'Recent official result', at })
    }
  }
  for (const row of tournaments) {
    const last = lastResultByTournament.get(String(row.id))
    if (last) items.push({ kind: 'Tournament', record: row, reason: 'Recent official result', at: last })
    else if (row.status === 'registration_open') items.push({ kind: 'Tournament', record: row, reason: 'Registration open', at: Date.parse(String(row.updated_at ?? '')) || 0 })
  }
  for (const player of topPlayers.slice(0, 4)) items.push({ kind: 'Player', record: { id: player.id, display_name: player.name, slug: player.slug, photo_url: player.photo, island: player.teamName }, reason: `${player.totals.appearances} official matches`, at: 0 })
  return items.sort((a, b) => b.at - a.at).slice(0, limit)
}

// --- Search suggestions ------------------------------------------------------------------------
export type Suggestion = { kind: 'Tournament' | 'Team' | 'Player' | 'Organization' | 'Place'; label: string; detail: string | null; href: string; image: string | null }
export const SEARCH_MIN = 2
export const SEARCH_MAX = 60

export async function searchSuggestions(client: SupabaseClient, query: string, signal: AbortSignal): Promise<Loaded<Suggestion[]>> {
  // Wildcards are stripped by sanitizeSearchQuery; filter-syntax characters
  // are stripped here because the term is placed inside an or() filter.
  const term = sanitizeSearchQuery(query).replace(/[,()*:"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX)
  if (term.length < SEARCH_MIN) return { data: [], error: null }
  const pattern = `%${term}%`
  const [tournaments, teams, players, organizations] = await Promise.all([
    client.from('tournaments').select(`${PUBLIC_TOURNAMENT_FIELDS},island`).eq('is_published', true).neq('status', 'draft').or(`name.ilike.${pattern},island.ilike.${pattern}`).limit(5).abortSignal(signal),
    client.from('teams').select(PUBLIC_TEAM_FIELDS).eq('is_published', true).or(`name.ilike.${pattern},island.ilike.${pattern}`).limit(5).abortSignal(signal),
    client.from('player_profiles').select(PUBLIC_PLAYER_FIELDS).eq('is_published', true).ilike('display_name', pattern).limit(5).abortSignal(signal),
    client.from('organizations').select('id,name,slug').eq('is_published', true).ilike('name', pattern).limit(4).abortSignal(signal),
  ])
  const error = [tournaments, teams, players, organizations].find(result => result.error)?.error?.message ?? null
  if (error) return { data: [], error }
  const out: Suggestion[] = []
  const places = new Set<string>()
  const lower = term.toLowerCase()
  for (const row of (tournaments.data ?? []) as Row[]) { out.push({ kind: 'Tournament', label: String(row.name), detail: [text(row.island)].filter(Boolean).join(' · ') || null, href: `#tournament/${encodeURIComponent(String(row.slug ?? row.id))}`, image: null }); const island = text(row.island); if (island?.toLowerCase().includes(lower)) places.add(island) }
  for (const row of (teams.data ?? []) as Row[]) { out.push({ kind: 'Team', label: String(row.name), detail: text(row.island), href: `#team/${encodeURIComponent(String(row.slug ?? row.id))}`, image: text(row.logo_url) }); const island = text(row.island); if (island?.toLowerCase().includes(lower)) places.add(island) }
  for (const row of (players.data ?? []) as Row[]) out.push({ kind: 'Player', label: String(row.display_name), detail: text(row.island), href: `#player/${encodeURIComponent(String(row.slug ?? row.id))}`, image: text(row.photo_url) })
  for (const row of (organizations.data ?? []) as Row[]) out.push({ kind: 'Organization', label: String(row.name), detail: null, href: `#organization/${encodeURIComponent(String(row.slug ?? row.id))}`, image: null })
  for (const place of places) out.push({ kind: 'Place', label: place, detail: 'Island or atoll', href: `#search?q=${encodeURIComponent(place)}`, image: null })
  return { data: out, error: null }
}

// Typo help: the closest published name already on the page, when the search
// found nothing. Plain edit distance; no server-side fuzzy matching is needed.
export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]; row[0] = i
    for (let j = 1; j <= b.length; j += 1) { const current = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = current }
  }
  return row[b.length]
}
export function closestName(term: string, names: string[]): string | null {
  const needle = term.trim().toLowerCase()
  if (needle.length < 3) return null
  let best: { name: string; score: number } | null = null
  for (const name of names) {
    const words = [name.toLowerCase(), ...name.toLowerCase().split(/\s+/)]
    const score = Math.min(...words.map(word => editDistance(needle, word)))
    if (score > 0 && score <= Math.max(1, Math.floor(needle.length / 4)) && (!best || score < best.score)) best = { name, score }
  }
  return best?.name ?? null
}

// --- Announcements --------------------------------------------------------------------------------
export type Announcement = { id: string; severity: 'info' | 'warning' | 'critical'; title: string; titleDv: string | null; body: string | null; bodyDv: string | null; linkUrl: string | null; linkLabel: string | null; startsAt: string | null; endsAt: string | null; isActive: boolean; updatedAt: string }
const ANNOUNCEMENT_FIELDS = 'id,severity,title,title_dv,body,body_dv,link_url,link_label,starts_at,ends_at,is_active,updated_at'
export function toAnnouncement(row: Row): Announcement {
  const severity = ['info', 'warning', 'critical'].includes(String(row.severity)) ? row.severity as Announcement['severity'] : 'info'
  return { id: String(row.id), severity, title: String(row.title ?? ''), titleDv: text(row.title_dv), body: text(row.body), bodyDv: text(row.body_dv), linkUrl: text(row.link_url), linkLabel: text(row.link_label), startsAt: text(row.starts_at), endsAt: text(row.ends_at), isActive: row.is_active === true, updatedAt: String(row.updated_at ?? '') }
}
export async function loadLiveAnnouncements(client: SupabaseClient, now = Date.now()): Promise<Announcement[]> {
  const result = await client.from('public_announcements').select(ANNOUNCEMENT_FIELDS).eq('is_active', true).order('updated_at', { ascending: false }).limit(5)
  if (result.error) return []
  const rank = { critical: 0, warning: 1, info: 2 }
  return ((result.data ?? []) as Row[]).map(toAnnouncement)
    .filter(item => (!item.startsAt || Date.parse(item.startsAt) <= now) && (!item.endsAt || Date.parse(item.endsAt) > now))
    .sort((a, b) => rank[a.severity] - rank[b.severity])
}
export async function loadAllAnnouncements(client: SupabaseClient): Promise<Loaded<Announcement[]>> {
  const result = await client.from('public_announcements').select(ANNOUNCEMENT_FIELDS).order('updated_at', { ascending: false })
  if (result.error) return { data: [], error: isMissing(result.error.message) ? 'Announcements need migration 032.' : result.error.message }
  return { data: ((result.data ?? []) as Row[]).map(toAnnouncement), error: null }
}
export type AnnouncementDraft = Omit<Announcement, 'id' | 'updatedAt'>
export function validateAnnouncement(draft: AnnouncementDraft): string | null {
  if (!draft.title.trim()) return 'Give the announcement a short message.'
  if (draft.title.length > 160 || (draft.titleDv ?? '').length > 160) return 'Keep the message under 160 characters.'
  if ((draft.body ?? '').length > 400 || (draft.bodyDv ?? '').length > 400) return 'Keep the details under 400 characters.'
  if (draft.linkUrl && !/^(https:\/\/|#)/.test(draft.linkUrl)) return 'Links must start with https:// or point to a page in Kulhivaru+ (#...).'
  if (draft.startsAt && draft.endsAt && Date.parse(draft.endsAt) <= Date.parse(draft.startsAt)) return 'The end must be after the start.'
  return null
}
export async function saveAnnouncement(client: SupabaseClient, draft: AnnouncementDraft, id?: string): Promise<{ error: string | null }> {
  const invalid = validateAnnouncement(draft); if (invalid) return { error: invalid }
  const row = { severity: draft.severity, title: draft.title.trim(), title_dv: draft.titleDv?.trim() || null, body: draft.body?.trim() || null, body_dv: draft.bodyDv?.trim() || null, link_url: draft.linkUrl?.trim() || null, link_label: draft.linkLabel?.trim() || null, starts_at: draft.startsAt || null, ends_at: draft.endsAt || null, is_active: draft.isActive }
  const result = id ? await client.from('public_announcements').update(row).eq('id', id) : await client.from('public_announcements').insert(row)
  return { error: result.error ? (isMissing(result.error.message) ? 'Announcements need migration 032.' : result.error.message) : null }
}
export async function removeAnnouncement(client: SupabaseClient, id: string): Promise<{ error: string | null }> {
  const result = await client.from('public_announcements').delete().eq('id', id)
  return { error: result.error?.message ?? null }
}

// Dismissal is remembered per version: a material update (new updated_at)
// brings a critical announcement back.
const DISMISSED_KEY = 'kulhivaru.dismissed-announcements'
export const dismissalKey = (item: Pick<Announcement, 'id' | 'updatedAt' | 'severity'>) => item.severity === 'critical' ? `${item.id}@${item.updatedAt}` : item.id
export function readDismissed(): string[] { try { const value = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]'); return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [] } catch { return [] } }
export function dismissAnnouncement(item: Announcement): void { try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...readDismissed(), dismissalKey(item)].slice(-40))) } catch { /* storage unavailable */ } }

// --- Recently viewed -----------------------------------------------------------------------------------
// Only public record routes, identified by slug or match id. Never workspace,
// admin, registration or search routes. Names are re-read from published
// records when shown, so a record that was unpublished simply disappears.
export type ViewedKind = 'tournament' | 'team' | 'player' | 'match'
export type Viewed = { kind: ViewedKind; ref: string; at: number }
const RECENT_KEY = 'kulhivaru.recently-viewed'
const SAFE_REF = /^[a-z0-9][a-z0-9-]{0,120}$/i
export function viewedFromHash(hash: string): Omit<Viewed, 'at'> | null {
  const [path] = hash.replace(/^#\/?/, '').split('?')
  const [head, ref, extra] = path.split('/')
  const kinds: Record<string, ViewedKind> = { tournament: 'tournament', tournaments: 'tournament', team: 'team', teams: 'team', player: 'player', players: 'player', match: 'match', matches: 'match' }
  const kind = kinds[head]
  if (!kind || !ref || extra) return null
  const decoded = (() => { try { return decodeURIComponent(ref) } catch { return '' } })()
  return SAFE_REF.test(decoded) ? { kind, ref: decoded } : null
}
export function readRecentlyViewed(): Viewed[] {
  try { const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(value) ? value.filter((entry): entry is Viewed => entry && typeof entry.ref === 'string' && SAFE_REF.test(entry.ref) && ['tournament', 'team', 'player', 'match'].includes(entry.kind)).slice(0, 12) : [] } catch { return [] }
}
export function rememberView(hash: string, now = Date.now()): void {
  const view = viewedFromHash(hash)
  if (!view) return
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([{ ...view, at: now }, ...readRecentlyViewed().filter(entry => !(entry.kind === view.kind && entry.ref === view.ref))].slice(0, 12))) } catch { /* storage unavailable */ }
}
export function clearRecentlyViewed(): void { try { localStorage.removeItem(RECENT_KEY) } catch { /* storage unavailable */ } }

export type ViewedCard = { kind: ViewedKind; label: string; href: string; detail: string | null; image: string | null }
export async function resolveRecentlyViewed(client: SupabaseClient, views: Viewed[]): Promise<ViewedCard[]> {
  if (!views.length) return []
  const refs = (kind: ViewedKind) => views.filter(view => view.kind === kind).map(view => view.ref)
  const bySlug = async (table: string, columns: string, list: string[]) => list.length ? ((await client.from(table).select(columns).eq('is_published', true).in('slug', list)).data ?? []) as unknown as Row[] : []
  const [tournaments, teams, players] = await Promise.all([
    bySlug('tournaments', 'id,name,slug,sport,status', refs('tournament')),
    bySlug('teams', 'id,name,slug,island,logo_url', refs('team')),
    bySlug('player_profiles', 'id,display_name,slug,island,photo_url', refs('player')),
  ])
  const matchIds = refs('match').filter(ref => /^[0-9a-f-]{36}$/i.test(ref))
  const matches = matchIds.length ? ((await client.from('matches').select('id,tournaments(name)').in('id', matchIds)).data ?? []) as Row[] : []
  const cards: ViewedCard[] = []
  for (const view of views) {
    if (view.kind === 'tournament') { const row = tournaments.find(item => item.slug === view.ref); if (row && row.status !== 'draft') cards.push({ kind: 'tournament', label: String(row.name), href: `#tournament/${encodeURIComponent(view.ref)}`, detail: null, image: null }) }
    if (view.kind === 'team') { const row = teams.find(item => item.slug === view.ref); if (row) cards.push({ kind: 'team', label: String(row.name), href: `#team/${encodeURIComponent(view.ref)}`, detail: text(row.island), image: text(row.logo_url) }) }
    if (view.kind === 'player') { const row = players.find(item => item.slug === view.ref); if (row) cards.push({ kind: 'player', label: String(row.display_name), href: `#player/${encodeURIComponent(view.ref)}`, detail: text(row.island), image: text(row.photo_url) }) }
    if (view.kind === 'match') { const row = matches.find(item => item.id === view.ref); const tournament = row ? (Array.isArray(row.tournaments) ? row.tournaments[0] : row.tournaments) as Row | null : null; if (row) cards.push({ kind: 'match', label: 'Official match', href: `#matches/${encodeURIComponent(view.ref)}`, detail: tournament ? String(tournament.name) : null, image: null }) }
  }
  return cards.slice(0, 8)
}

// --- Content reports ----------------------------------------------------------------------------------------
export const REPORT_REASONS = [
  { value: 'incorrect_information', label: 'Incorrect information' },
  { value: 'duplicate_player', label: 'Duplicate player' },
  { value: 'impersonated_team', label: 'Impersonated team' },
  { value: 'inappropriate_content', label: 'Inappropriate image or content' },
  { value: 'incorrect_match', label: 'Incorrect match information' },
  { value: 'privacy_concern', label: 'Privacy concern' },
  { value: 'other', label: 'Other' },
] as const
export type ReportReason = (typeof REPORT_REASONS)[number]['value']
export type ReportEntity = 'tournament' | 'team' | 'player' | 'match' | 'news' | 'organization'
const REPORT_ERRORS: Record<string, string> = {
  sign_in_required: 'Sign in to send a report.',
  report_limit_reached: 'You have sent the most reports allowed in 24 hours. Please try again tomorrow.',
  report_already_open: 'You already reported this record. The team will review it.',
}
export async function submitContentReport(client: SupabaseClient, input: { entity: ReportEntity; ref: string; label: string; reason: ReportReason; details: string }): Promise<{ error: string | null }> {
  if (input.reason === 'other' && !input.details.trim()) return { error: 'Tell us what is wrong.' }
  if (input.details.length > 1000) return { error: 'Keep the details under 1000 characters.' }
  const result = await client.rpc('submit_content_report', { p_entity_type: input.entity, p_entity_ref: input.ref, p_entity_label: input.label, p_reason: input.reason, p_details: input.details })
  if (!result.error) return { error: null }
  const code = Object.keys(REPORT_ERRORS).find(key => result.error!.message.includes(key))
  return { error: code ? REPORT_ERRORS[code] : isMissing(result.error.message) ? 'Reporting needs migration 032.' : result.error.message }
}
export type ContentReport = { id: string; entity: string; ref: string; label: string | null; reason: string; details: string | null; status: string; adminNote: string | null; createdAt: string }
export async function loadContentReports(client: SupabaseClient): Promise<Loaded<ContentReport[]>> {
  const result = await client.from('content_reports').select('id,entity_type,entity_ref,entity_label,reason,details,status,admin_note,created_at').order('created_at', { ascending: false }).limit(100)
  if (result.error) return { data: [], error: isMissing(result.error.message) ? 'Content reports need migration 032.' : result.error.message }
  return { data: ((result.data ?? []) as Row[]).map(row => ({ id: String(row.id), entity: String(row.entity_type), ref: String(row.entity_ref), label: text(row.entity_label), reason: String(row.reason), details: text(row.details), status: String(row.status), adminNote: text(row.admin_note), createdAt: String(row.created_at ?? '') })), error: null }
}
export async function resolveContentReport(client: SupabaseClient, id: string, status: 'reviewing' | 'resolved' | 'dismissed', note: string): Promise<{ error: string | null }> {
  const result = await client.from('content_reports').update({ status, admin_note: note.trim() || null }).eq('id', id)
  return { error: result.error?.message ?? null }
}
export function reportedHref(report: Pick<ContentReport, 'entity' | 'ref'>): string {
  const head = report.entity === 'match' ? 'matches' : report.entity
  return `#${head}/${encodeURIComponent(report.ref)}`
}

// --- Platform information pages ---------------------------------------------------------------------------------
export const INFO_TOPICS = ['help', 'contact', 'report', 'claim-profile', 'account-support', 'privacy', 'terms', 'community-guidelines', 'child-safety', 'data-correction', 'account-deletion', 'image-consent'] as const
export type InfoTopic = (typeof INFO_TOPICS)[number]
// Topics whose text the owner must write (legal and contact details). The
// others describe how the platform already works.
export const OWNER_WRITTEN: InfoTopic[] = ['privacy', 'terms', 'community-guidelines', 'contact']
export const EDITABLE_PAGES = ['privacy', 'terms', 'community-guidelines', 'child-safety', 'contact', 'account-deletion', 'image-consent', 'help', 'data-correction'] as const
export type PlatformPage = { slug: string; title: string; body: string; bodyDv: string | null; isPublished: boolean; updatedAt: string | null }
export async function loadPlatformPage(client: SupabaseClient, slug: string): Promise<Loaded<PlatformPage | null>> {
  const result = await client.from('platform_pages').select('slug,title,body,body_dv,is_published,updated_at').eq('slug', slug).maybeSingle()
  if (result.error) return { data: null, error: isMissing(result.error.message) ? null : result.error.message }
  const row = result.data as Row | null
  return { data: row ? { slug: String(row.slug), title: String(row.title), body: String(row.body ?? ''), bodyDv: text(row.body_dv), isPublished: row.is_published === true, updatedAt: text(row.updated_at) } : null, error: null }
}
export async function loadAllPlatformPages(client: SupabaseClient): Promise<Loaded<PlatformPage[]>> {
  const result = await client.from('platform_pages').select('slug,title,body,body_dv,is_published,updated_at')
  if (result.error) return { data: [], error: isMissing(result.error.message) ? 'Information pages need migration 032.' : result.error.message }
  return { data: ((result.data ?? []) as Row[]).map(row => ({ slug: String(row.slug), title: String(row.title), body: String(row.body ?? ''), bodyDv: text(row.body_dv), isPublished: row.is_published === true, updatedAt: text(row.updated_at) })), error: null }
}
export async function savePlatformPage(client: SupabaseClient, page: Omit<PlatformPage, 'updatedAt'>): Promise<{ error: string | null }> {
  if (!page.title.trim()) return { error: 'Give the page a title.' }
  if (page.body.length > 20000) return { error: 'Keep the page under 20,000 characters.' }
  const result = await client.from('platform_pages').upsert({ slug: page.slug, title: page.title.trim(), body: page.body, body_dv: page.bodyDv?.trim() || null, is_published: page.isPublished, updated_at: new Date().toISOString() })
  return { error: result.error ? (isMissing(result.error.message) ? 'Information pages need migration 032.' : result.error.message) : null }
}

// --- Sharing ------------------------------------------------------------------------------------------------------------
export async function shareLink(title: string, hash: string): Promise<'shared' | 'copied' | 'failed'> {
  const url = `${window.location.origin}${window.location.pathname}${hash}`
  try {
    if (navigator.share) { await navigator.share({ title, url }); return 'shared' }
    await navigator.clipboard.writeText(url); return 'copied'
  } catch { return 'failed' }
}

// --- Summary counts --------------------------------------------------------------------------------------------------------
// Exact counts from head requests. A failed count is null and its chip is
// hidden; it never becomes a zero.
export async function countPublished(client: SupabaseClient, table: 'teams' | 'player_profiles' | 'tournaments', statuses?: string[]): Promise<number | null> {
  let request = client.from(table).select('id', { count: 'exact', head: true }).eq('is_published', true)
  if (statuses) request = request.in('status', statuses)
  const result = await request
  return result.error ? null : result.count ?? null
}

// --- Sports history -------------------------------------------------------------------------
// Completed tournaments and the champion recorded in Awards (award_champion). A
// champion's name is shown only when its team is published.
export type Champion = { name: string; slug: string }
export async function loadChampions(client: SupabaseClient, tournamentIds: string[]): Promise<Loaded<Map<string, Champion>>> {
  const map = new Map<string, Champion>()
  if (!tournamentIds.length) return { data: map, error: null }
  const result = await client.from('sport_milestones').select('tournament_id,teams(name,slug,is_published)').eq('milestone_type', 'award_champion').eq('state', 'reached').in('tournament_id', tournamentIds.slice(0, 40))
  if (result.error) return { data: map, error: result.error.message }
  for (const row of (result.data ?? []) as Row[]) {
    const team = (Array.isArray(row.teams) ? row.teams[0] : row.teams) as Row | null
    if (team?.is_published === true && text(team.name) && text(team.slug)) map.set(String(row.tournament_id), { name: String(team.name), slug: String(team.slug) })
  }
  return { data: map, error: null }
}
export function completedTournaments(tournaments: Row[]): Row[] {
  return tournaments.filter(row => ['completed', 'archived'].includes(String(row.status))).sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
}
