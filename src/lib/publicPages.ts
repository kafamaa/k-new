import type { SupabaseClient } from '@supabase/supabase-js'
import { getPublishedMatch, sanitizeSearchQuery, type PublicRecord, type PublicResult } from './publicData'
import { PUBLIC_NEWS_FIELDS } from './news'
import { loadPublicSponsors, type PublicSponsor } from './tournamentPages'
import type { Capacity } from './landing'

// The remaining public-page parts (migration 202611010038): match timeline and
// lineups, tournament draw, organization teams, plus listing filters that read
// columns the public can already see. Every loader degrades to "not shown" when a
// function is missing, so the pages keep working before the migration is applied.

const missing = (message: string) => /could not find the function|does not exist|schema cache/i.test(message)

// --- Match detail ------------------------------------------------------------------
export type MatchEvent = { minute: number | null; minuteExtra: number | null; type: string; side: 'home' | 'away' | null; player: string | null; playerSlug: string | null }
export type LineupPlayer = { side: 'home' | 'away'; player: string; playerSlug: string; starter: boolean }
export type MatchExtras = { available: boolean; official: boolean; homeScore: number | null; awayScore: number | null; outcome: string | null; events: MatchEvent[]; lineups: LineupPlayer[]; privatePlayers: number }
export const NO_MATCH_EXTRAS: MatchExtras = { available: false, official: false, homeScore: null, awayScore: null, outcome: null, events: [], lineups: [], privatePlayers: 0 }

const asNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null
const asText = (value: unknown) => typeof value === 'string' && value.trim() ? value : null
const asSide = (value: unknown): 'home' | 'away' | null => value === 'home' || value === 'away' ? value : null

export function toMatchExtras(raw: unknown): MatchExtras {
  if (!raw || typeof raw !== 'object') return NO_MATCH_EXTRAS
  const row = raw as Record<string, unknown>
  const events = Array.isArray(row.events) ? row.events as Array<Record<string, unknown>> : []
  const lineups = Array.isArray(row.lineups) ? row.lineups as Array<Record<string, unknown>> : []
  return {
    available: true,
    official: row.official === true,
    homeScore: asNumber(row.home_score), awayScore: asNumber(row.away_score), outcome: asText(row.outcome),
    events: events.map(event => ({ minute: asNumber(event.minute), minuteExtra: asNumber(event.minute_extra), type: String(event.type ?? ''), side: asSide(event.side), player: asText(event.player), playerSlug: asText(event.player_slug) })).filter(event => event.type),
    lineups: lineups.map(item => ({ side: asSide(item.side) ?? 'home', player: asText(item.player) ?? '', playerSlug: asText(item.player_slug) ?? '', starter: item.starter === true })).filter(item => item.player && item.playerSlug),
    privatePlayers: asNumber(row.private_players) ?? 0,
  }
}

// The match record for #matches/<id>. Migration 038 also opens scheduled and live
// fixtures of published stages (as the public match feed already does); before it is
// applied, only confirmed matches load, as before.
export async function getPublicMatchPage(client: SupabaseClient, id: string): Promise<PublicResult<PublicRecord>> {
  const result = await client.rpc('get_public_match_detail', { p_match_id: id })
  if (result.error) {
    // A malformed link is simply not found; a missing function falls back to the old read.
    if (/invalid input syntax/i.test(result.error.message)) return { data: null, error: null }
    if (missing(result.error.message)) return getPublishedMatch(client, id)
    return { data: null, error: result.error.message }
  }
  const row = result.data as Record<string, unknown> | null
  if (!row) return { data: null, error: null }
  return { data: { ...row, extras: toMatchExtras(row) }, error: null }
}

const EVENT_LABELS: Record<string, string> = {
  goal: 'Goal', own_goal: 'Own goal', unassigned_goal: 'Goal', assist: 'Assist', yellow_card: 'Yellow card', red_card: 'Red card', blue_card: 'Blue card',
  substitution: 'Substitution', team_foul: 'Team foul', shootout_score: 'Shoot-out goal', two_minute_suspension: '2-minute suspension',
  point: 'Point', ace: 'Ace', attack_point: 'Attack point', block: 'Block', dig: 'Dig', recorded_error: 'Error',
  one_point: '1 point', two_point: '2 points', three_point: '3 points', rebound: 'Rebound', steal: 'Steal', foul: 'Foul',
}
export function matchEventLabel(type: string): string { return EVENT_LABELS[type] ?? type.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase()) }
// Key events: what changes a match (scores and dismissals), not every recorded action.
const KEY_EVENTS = new Set(['goal', 'own_goal', 'unassigned_goal', 'red_card', 'shootout_score', 'three_point'])
export function keyEvents(events: MatchEvent[]): MatchEvent[] { return events.filter(event => KEY_EVENTS.has(event.type)) }

export function eventCounts(events: MatchEvent[]): Array<{ type: string; label: string; home: number; away: number }> {
  const counts = new Map<string, { home: number; away: number }>()
  for (const event of events) {
    if (!event.side) continue
    const row = counts.get(event.type) ?? { home: 0, away: 0 }
    row[event.side] += 1
    counts.set(event.type, row)
  }
  return [...counts].map(([type, value]) => ({ type, label: matchEventLabel(type), ...value })).sort((a, b) => a.label.localeCompare(b.label))
}

// --- Tournament draw -----------------------------------------------------------------
export type DrawTeam = { id: string; name: string | null; slug: string | null; logo: string | null }
export type DrawGroup = { name: string | null; teams: DrawTeam[] }
export type DrawStage = { id: string; name: string; format: string; order: number; category: string | null; groups: DrawGroup[] }

export function groupDraw(rows: Array<Record<string, unknown>>): DrawStage[] {
  const stages = new Map<string, DrawStage>()
  for (const row of rows) {
    const id = String(row.stage_id ?? '')
    if (!id) continue
    const stage = stages.get(id) ?? { id, name: String(row.stage_name ?? 'Stage'), format: String(row.stage_format ?? ''), order: Number(row.stage_order ?? 1), category: asText(row.category_name), groups: [] }
    stages.set(id, stage)
    const groupName = asText(row.group_name)
    let group = stage.groups.find(item => item.name === groupName)
    if (!group) { group = { name: groupName, teams: [] }; stage.groups.push(group) }
    const teamId = String(row.team_id ?? '')
    if (teamId && !group.teams.some(team => team.id === teamId)) group.teams.push({ id: teamId, name: asText(row.team_name), slug: asText(row.team_slug), logo: asText(row.team_logo) })
  }
  for (const stage of stages.values()) {
    stage.groups.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    for (const group of stage.groups) group.teams.sort((a, b) => (a.name ?? '~').localeCompare(b.name ?? '~'))
  }
  return [...stages.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

export async function loadTournamentDraw(client: SupabaseClient, tournamentId: string): Promise<{ data: DrawStage[]; available: boolean }> {
  const result = await client.rpc('get_public_tournament_draw', { p_tournament_id: tournamentId })
  if (result.error) return { data: [], available: false }
  return { data: groupDraw((result.data ?? []) as Array<Record<string, unknown>>), available: true }
}

export const STAGE_FORMAT_LABELS: Record<string, string> = { round_robin: 'League', round_robin_then_final: 'League then final', group_stage: 'Group stage', knockout: 'Knockout', groups_knockout: 'Groups then knockout', two_leg: 'League, home and away' }

// --- Registration places and the waitlist ------------------------------------------
export type PlacesState = { kind: 'unknown' } | { kind: 'open'; remaining: number; total: number } | { kind: 'full'; total: number }
export function placesState(capacity: Capacity | null | undefined): PlacesState {
  if (!capacity || capacity.teamLimit === null || capacity.teamLimit <= 0) return { kind: 'unknown' }
  const remaining = capacity.teamLimit - capacity.approved
  return remaining > 0 ? { kind: 'open', remaining, total: capacity.teamLimit } : { kind: 'full', total: capacity.teamLimit }
}

// --- Organization page ---------------------------------------------------------------
export async function loadOrganizationTeams(client: SupabaseClient, organizationId: string): Promise<{ data: PublicRecord[]; available: boolean }> {
  const result = await client.rpc('get_public_organization_teams', { p_organization_id: organizationId })
  if (result.error) return { data: [], available: false }
  return { data: ((result.data ?? []) as PublicRecord[]).map(row => ({ ...row, id: row.team_id })), available: true }
}

export async function loadOrganizationNews(client: SupabaseClient, organizationId: string, tournamentIds: string[]): Promise<PublicRecord[]> {
  const filter = [`organization_id.eq.${organizationId}`, ...(tournamentIds.length ? [`tournament_id.in.(${tournamentIds.join(',')})`] : [])].join(',')
  const result = await client.from('news_articles').select(PUBLIC_NEWS_FIELDS).eq('status', 'published').or(filter).order('published_at', { ascending: false, nullsFirst: false }).limit(12)
  return result.error ? [] : (result.data ?? []) as PublicRecord[]
}

// Sponsors of the organization's tournaments, listed once each with the tournaments they support.
export type OrganizationSponsor = PublicSponsor & { tournaments: string[] }
export async function loadOrganizationSponsors(client: SupabaseClient, tournaments: Array<{ id: string; name: string }>): Promise<OrganizationSponsor[]> {
  const results = await Promise.all(tournaments.slice(0, 12).map(async tournament => ({ tournament, sponsors: (await loadPublicSponsors(client, tournament.id)).data })))
  return mergeSponsors(results)
}
export function mergeSponsors(results: Array<{ tournament: { name: string }; sponsors: PublicSponsor[] }>): OrganizationSponsor[] {
  const byName = new Map<string, OrganizationSponsor>()
  for (const { tournament, sponsors } of results) for (const sponsor of sponsors) {
    const key = sponsor.sponsor_name.trim().toLowerCase()
    const existing = byName.get(key)
    if (existing) { if (!existing.tournaments.includes(tournament.name)) existing.tournaments.push(tournament.name) }
    else byName.set(key, { ...sponsor, tournaments: [tournament.name] })
  }
  return [...byName.values()].sort((a, b) => a.sponsor_name.localeCompare(b.sponsor_name))
}

// Where an organization runs its events: the islands of its published tournaments.
export async function loadOrganizationLocations(client: SupabaseClient): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  const result = await client.from('tournaments').select('organization_id,island').eq('is_published', true).neq('status', 'draft').limit(1000)
  if (result.error) return map
  for (const row of (result.data ?? []) as Array<Record<string, unknown>>) {
    const id = String(row.organization_id ?? ''); const island = asText(row.island)?.trim()
    if (!id || !island) continue
    const list = map.get(id) ?? []
    if (!list.includes(island)) list.push(island)
    map.set(id, list)
  }
  return map
}

// --- Listing filters -----------------------------------------------------------------
export async function loadTournamentCategories(client: SupabaseClient, tournamentIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (!tournamentIds.length) return map
  const result = await client.from('tournament_categories').select('tournament_id,name').in('tournament_id', tournamentIds)
  if (result.error) return map
  for (const row of (result.data ?? []) as Array<Record<string, unknown>>) {
    const id = String(row.tournament_id ?? ''); const name = asText(row.name)?.trim()
    if (!id || !name) continue
    map.set(id, [...(map.get(id) ?? []), name])
  }
  return map
}

// Team sports (team workspace migration 031). A missing column leaves the filter hidden.
export async function loadTeamSports(client: SupabaseClient, teamIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (!teamIds.length) return map
  const result = await client.from('teams').select('id,sports').eq('is_published', true).in('id', teamIds.slice(0, 500))
  if (result.error) return map
  for (const row of (result.data ?? []) as Array<Record<string, unknown>>) if (Array.isArray(row.sports)) map.set(String(row.id), (row.sports as unknown[]).map(String).filter(Boolean))
  return map
}

// Current published teams of each published player, from the public team history.
export async function loadPlayerTeams(client: SupabaseClient, playerIds: string[]): Promise<Map<string, Array<{ id: string; name: string }>>> {
  const map = new Map<string, Array<{ id: string; name: string }>>()
  if (!playerIds.length) return map
  const result = await client.from('player_team_memberships').select('player_id,team_id,status,teams(name,is_published)').eq('status', 'active').in('player_id', playerIds.slice(0, 500))
  if (result.error) return map
  for (const row of (result.data ?? []) as Array<Record<string, unknown>>) {
    const team = row.teams as Record<string, unknown> | null
    if (!team || team.is_published !== true || !asText(team.name)) continue
    const id = String(row.player_id); const list = map.get(id) ?? []
    if (!list.some(item => item.id === String(row.team_id))) list.push({ id: String(row.team_id), name: String(team.name) })
    map.set(id, list)
  }
  return map
}

export function optionsFrom(map: Map<string, Array<{ id: string; name: string }>>): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>()
  for (const list of map.values()) for (const item of list) if (!seen.has(item.id)) seen.set(item.id, item.name)
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

export function filterOrganizations(records: PublicRecord[], query: string, location: string, locations: Map<string, string[]>): PublicRecord[] {
  const term = sanitizeSearchQuery(query).toLowerCase()
  return records.filter(record => (!term || String(record.name ?? '').toLowerCase().includes(term) || String(record.description ?? '').toLowerCase().includes(term))
    && (!location || (locations.get(String(record.id)) ?? []).includes(location)))
}

// Player sports (player workspace migration 013). A missing column leaves the filter hidden.
export async function loadPlayerSports(client: SupabaseClient, playerIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (!playerIds.length) return map
  const result = await client.from('player_profiles').select('id,sports').in('id', playerIds.slice(0, 500))
  if (result.error) return map
  for (const row of (result.data ?? []) as Array<Record<string, unknown>>) if (Array.isArray(row.sports)) map.set(String(row.id), (row.sports as unknown[]).map(String).filter(Boolean))
  return map
}

// --- Management labels (final plan 5.4) ---------------------------------------------
// Claiming decides who manages a record; publishing decides what the public sees. A
// published record that nobody has claimed is labelled neutrally, never as "verified".
export type TeamManagement = 'team' | 'organizer' | null
export function playerManagementLabel(record: { is_claimed?: unknown }): string {
  return record.is_claimed === true ? 'Claimed by the player' : 'Record managed by an authorized organizer'
}
export function teamManagementLabel(value: TeamManagement): string | null {
  return value === 'organizer' ? 'Managed by tournament organizer' : value === 'team' ? 'Managed by the team' : null
}
// Migration 202611010041; shows no label until it is applied.
export async function loadTeamManagement(client: SupabaseClient, teamId: string): Promise<TeamManagement> {
  const result = await client.rpc('get_public_team_management', { p_team_id: teamId })
  if (result.error) return null
  return result.data === 'team' || result.data === 'organizer' ? result.data : null
}

// --- Public archive (final plan 19) -------------------------------------------------
export type ArchiveDetail = { startsAt: string | null; island: string | null; organizerName: string | null }
export type ArchiveFilters = { query: string; sport: string; year: string; island: string; organizer: string }
export const EMPTY_ARCHIVE_FILTERS: ArchiveFilters = { query: '', sport: '', year: '', island: '', organizer: '' }
export function isArchivedTournament(status: unknown): boolean { return status === 'completed' || status === 'archived' }
export function archiveYear(record: PublicRecord, detail?: ArchiveDetail): string {
  const source = detail?.startsAt ?? (typeof record.created_at === 'string' ? record.created_at : null)
  const time = source ? Date.parse(source) : NaN
  return Number.isNaN(time) ? '' : String(new Date(time).getUTCFullYear())
}
export function archiveTournaments(records: PublicRecord[], details: Map<string, ArchiveDetail>, filters: ArchiveFilters): PublicRecord[] {
  const term = sanitizeSearchQuery(filters.query).toLowerCase()
  return records.filter(record => {
    if (!isArchivedTournament(record.status)) return false
    const detail = details.get(String(record.id))
    if (filters.sport && String(record.sport ?? '') !== filters.sport) return false
    if (filters.year && archiveYear(record, detail) !== filters.year) return false
    if (filters.island && detail?.island !== filters.island) return false
    if (filters.organizer && detail?.organizerName !== filters.organizer) return false
    return !term || String(record.name ?? '').toLowerCase().includes(term) || String(detail?.organizerName ?? '').toLowerCase().includes(term)
  }).sort((a, b) => archiveYear(b, details.get(String(b.id))).localeCompare(archiveYear(a, details.get(String(a.id)))) || String(a.name ?? '').localeCompare(String(b.name ?? '')))
}
export function archiveOptions(records: PublicRecord[], details: Map<string, ArchiveDetail>): { sports: string[]; years: string[]; islands: string[]; organizers: string[] } {
  const archived = records.filter(record => isArchivedTournament(record.status))
  const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))]
  return {
    sports: unique(archived.map(record => String(record.sport ?? ''))).sort(),
    years: unique(archived.map(record => archiveYear(record, details.get(String(record.id))))).sort().reverse(),
    islands: unique(archived.map(record => details.get(String(record.id))?.island)).sort(),
    organizers: unique(archived.map(record => details.get(String(record.id))?.organizerName)).sort(),
  }
}

// --- Public tournament page: Players, Statistics, Awards (owner, 2026-11-02) ---------------
// Players and Statistics come from review-only migration 043; until it is applied the
// tabs say so instead of showing empty or zero rankings.
export type TournamentPlayer = { slug: string; name: string; photo: string | null; team: string | null; teamSlug: string | null; shirt: string | null; position: string | null }
export type TournamentPlayerStat = { slug: string; name: string; team: string | null; appearances: number; goals: number; assists: number; yellow: number; red: number }
export type Pending<T> = { data: T; state: 'ready' | 'pending' | 'error' }
const pendingFunction = (message: string) => /does not exist|PGRST20\d|42883|schema cache|could not find/i.test(message)
const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null)

export async function loadTournamentPlayers(client: SupabaseClient, tournamentId: string): Promise<Pending<TournamentPlayer[]>> {
  const result = await client.rpc('get_public_tournament_players', { p_tournament: tournamentId })
  if (result.error) return { data: [], state: pendingFunction(result.error.message) ? 'pending' : 'error' }
  return { data: ((result.data ?? []) as Array<Record<string, unknown>>).map(row => ({ slug: String(row.player_slug), name: String(row.player_name ?? 'Player'), photo: str(row.photo_url), team: str(row.team_name), teamSlug: str(row.team_slug), shirt: str(row.shirt_number), position: str(row.player_position) })), state: 'ready' }
}

export async function loadTournamentPlayerStats(client: SupabaseClient, tournamentId: string): Promise<Pending<TournamentPlayerStat[]>> {
  const result = await client.rpc('get_public_tournament_player_statistics', { p_tournament: tournamentId })
  if (result.error) return { data: [], state: pendingFunction(result.error.message) ? 'pending' : 'error' }
  return { data: ((result.data ?? []) as Array<Record<string, unknown>>).map(row => ({ slug: String(row.player_slug), name: String(row.player_name ?? 'Player'), team: str(row.team_name), appearances: Number(row.appearances ?? 0), goals: Number(row.goals ?? 0), assists: Number(row.assists ?? 0), yellow: Number(row.yellow_cards ?? 0), red: Number(row.red_cards ?? 0) })), state: 'ready' }
}

// Rankings for one statistic: only players who recorded it, highest first.
export function rankBy(stats: TournamentPlayerStat[], key: 'goals' | 'assists' | 'yellow' | 'red', limit = 10): TournamentPlayerStat[] {
  return stats.filter(row => row[key] > 0).sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name)).slice(0, limit)
}

export type PublicAward = { kind: string; label: string; recipient: string; href: string | null }
const AWARD_NAMES: Record<string, string> = { champion: 'Champion', runner_up: 'Runner-up', third_place: 'Third place', top_scorer: 'Top scorer', best_player: 'Best player', best_goalkeeper: 'Best goalkeeper', fair_play: 'Fair play award', other: 'Award' }

// Recorded awards whose team or player is published; others are left out.
export async function loadPublicAwards(client: SupabaseClient, tournamentId: string): Promise<Pending<PublicAward[]>> {
  const result = await client.from('sport_milestones').select('milestone_type,label,teams(name,slug,is_published),player_profiles(display_name,slug,is_published)').eq('tournament_id', tournamentId).eq('state', 'reached').like('milestone_type', 'award_%')
  if (result.error) return { data: [], state: 'error' }
  const awards: PublicAward[] = []
  for (const row of (result.data ?? []) as Array<Record<string, unknown>>) {
    const kind = String(row.milestone_type).replace(/^award_/, '')
    const team = (Array.isArray(row.teams) ? row.teams[0] : row.teams) as Record<string, unknown> | null
    const player = (Array.isArray(row.player_profiles) ? row.player_profiles[0] : row.player_profiles) as Record<string, unknown> | null
    const label = kind === 'other' && str(row.label) ? String(row.label) : AWARD_NAMES[kind] ?? 'Award'
    if (player?.is_published === true) awards.push({ kind, label, recipient: String(player.display_name), href: `#player/${encodeURIComponent(String(player.slug))}` })
    else if (team?.is_published === true) awards.push({ kind, label, recipient: String(team.name), href: `#team/${encodeURIComponent(String(team.slug))}` })
  }
  const order = Object.keys(AWARD_NAMES)
  return { data: awards.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)), state: 'ready' }
}
