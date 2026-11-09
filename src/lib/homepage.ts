import type { SupabaseClient } from '@supabase/supabase-js'
import { getPublishedMatches, getPublishedOrganizations, getPublishedPlayers, getPublishedStandings, getPublishedTeams, getPublishedTournaments } from './publicData'
import { getPublishedNews } from './news'

export type HomepageData = { organizations: Record<string, unknown>[]; tournaments: Record<string, unknown>[]; teams: Record<string, unknown>[]; players: Record<string, unknown>[]; matches: Record<string, unknown>[]; standings: Record<string, unknown>[]; news: Record<string, unknown>[]; errors: string[] }
export const REQUIRED_HOMEPAGE_SECTIONS = ['live', 'today', 'tournaments', 'trending', 'upcoming', 'standings', 'bracket', 'top-players', 'popular-teams', 'recent-results', 'news'] as const
export const EMPTY_HOMEPAGE_DATA: HomepageData = { organizations: [], tournaments: [], teams: [], players: [], matches: [], standings: [], news: [], errors: [] }

export async function loadHomepageData(client: SupabaseClient): Promise<HomepageData> {
  const results = await Promise.all([getPublishedOrganizations(client), getPublishedTournaments(client), getPublishedTeams(client), getPublishedPlayers(client), getPublishedMatches(client), getPublishedStandings(client), getPublishedNews(client)])
  return { organizations: results[0].data ?? [], tournaments: results[1].data ?? [], teams: results[2].data ?? [], players: results[3].data ?? [], matches: results[4].data ?? [], standings: results[5].data ?? [], news: results[6].data ?? [], errors: results.map(result => result.error).filter((error): error is string => Boolean(error)) }
}

export function todayMatches(matches: Record<string, unknown>[], now = new Date()): Record<string, unknown>[] {
  const day = now.toDateString(); return matches.filter(match => match.scheduled_at && new Date(String(match.scheduled_at)).toDateString() === day)
}

// The editorial hero features one real tournament: a live one first, then one
// open for registration, then the most recently updated. Null means there is
// no published tournament and the hero falls back to the brand message.
export function featuredTournament(tournaments: Record<string, unknown>[]): Record<string, unknown> | null {
  return tournaments.find(record => record.status === 'in_progress')
    ?? tournaments.find(record => record.status === 'registration_open')
    ?? tournaments[0]
    ?? null
}

// Tournament lifecycle and registration are separate facts, shown as two
// labels. Registration is derived from the tournament's own status only.
export function tournamentStage(status: unknown): { label: string; tone: 'live' | 'open' | 'done' | 'plain' } {
  const value = String(status ?? '')
  if (value === 'in_progress') return { label: 'Live', tone: 'live' }
  if (value === 'completed') return { label: 'Completed', tone: 'done' }
  if (value === 'archived') return { label: 'Archived', tone: 'done' }
  if (value === 'cancelled') return { label: 'Cancelled', tone: 'done' }
  return { label: 'Upcoming', tone: 'plain' }
}

export function registrationStage(status: unknown, closesAt?: string | null, now = Date.now()): { label: string; open: boolean } | null {
  const value = String(status ?? '')
  // A passed closing time wins over a status that was never flipped, matching
  // the tournament page's registration state.
  if (value === 'registration_open' && closesAt && Date.parse(closesAt) <= now) return { label: 'Registration closed', open: false }
  if (value === 'registration_open') return { label: 'Registration open', open: true }
  if (value === 'registration_closed') return { label: 'Registration closed', open: false }
  if (value === 'setup') return { label: 'Registration not open yet', open: false }
  return null
}

// --- Landing page arrangement helpers -----------------------------------------
type Row = Record<string, unknown>

// Public standings rows carry a stage id; public match rows carry both the
// stage and its tournament, so the tournament for each table is derived from
// matches rather than guessed. Tables whose stage has no public match are left
// out instead of being attached to the wrong tournament.
export function standingsByTournament(standings: Row[], matches: Row[]): Array<{ tournamentId: string; rows: Row[] }> {
  const tournamentOfStage = new Map<string, string>()
  for (const match of matches) if (match.stage_id && match.tournament_id) tournamentOfStage.set(String(match.stage_id), String(match.tournament_id))
  const groups = new Map<string, Row[]>()
  for (const row of standings) {
    const tournamentId = tournamentOfStage.get(String(row.stage_id ?? ''))
    if (!tournamentId) continue
    groups.set(tournamentId, [...(groups.get(tournamentId) ?? []), row])
  }
  return [...groups].map(([tournamentId, rows]) => ({ tournamentId, rows: [...rows].sort((a, b) => Number(b.points ?? 0) - Number(a.points ?? 0) || (Number(b.scored ?? 0) - Number(b.conceded ?? 0)) - (Number(a.scored ?? 0) - Number(a.conceded ?? 0))) }))
}

// Confirmed matches of one tournament grouped into rounds (one per stage, in
// date order). Round names are only given when the match counts halve like a
// knockout bracket; otherwise rounds are simply numbered.
export function bracketRounds(matches: Row[], tournamentId: string): Array<{ label: string; matches: Row[] }> {
  const byStage = new Map<string, Row[]>()
  for (const match of matches) if (String(match.tournament_id) === tournamentId) byStage.set(String(match.stage_id ?? 'stage'), [...(byStage.get(String(match.stage_id ?? 'stage')) ?? []), match])
  const firstDate = (rows: Row[]) => Math.min(...rows.map(row => Date.parse(String(row.scheduled_at ?? '')) || Number.MAX_SAFE_INTEGER))
  const rounds = [...byStage.values()].sort((a, b) => firstDate(a) - firstDate(b))
  const halving = rounds.length > 1 && rounds.every((round, index) => index === 0 || round.length * 2 === rounds[index - 1].length) && rounds[rounds.length - 1].length === 1
  const knockoutName = (count: number) => count === 1 ? 'Final' : count === 2 ? 'Semi-finals' : count === 4 ? 'Quarter-finals' : `Round of ${count * 2}`
  return rounds.map((round, index) => ({ label: halving ? knockoutName(round.length) : `Round ${index + 1}`, matches: round }))
}

export type TrendingItem = { kind: 'Tournament' | 'Team' | 'Player'; record: Row }

// One mixed rail, interleaving the most recent published records of each kind.
export function trendingItems(tournaments: Row[], teams: Row[], players: Row[], limit = 9): TrendingItem[] {
  const lanes: TrendingItem[][] = [tournaments.map(record => ({ kind: 'Tournament' as const, record })), teams.map(record => ({ kind: 'Team' as const, record })), players.map(record => ({ kind: 'Player' as const, record }))]
  const items: TrendingItem[] = []
  for (let index = 0; items.length < limit && lanes.some(lane => lane[index]); index += 1) for (const lane of lanes) if (lane[index] && items.length < limit) items.push(lane[index])
  return items
}

export function upcomingTournaments(tournaments: Row[]): Row[] {
  return tournaments.filter(record => !['completed', 'archived', 'cancelled', 'in_progress'].includes(String(record.status)))
}
