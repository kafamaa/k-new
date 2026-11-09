import type { SupabaseClient } from '@supabase/supabase-js'
import { statusLabel } from './i18n'

export type PublicRecord = Record<string, unknown>
export type PublicResult<T> = { data: T | null; error: string | null }
export const PUBLIC_ORGANIZATION_FIELDS = 'id,name,slug,description'
export const PUBLIC_TEAM_FIELDS = 'id,name,slug,team_type,island,description,logo_url'
// public_code and position are public by design (player workspace migration); identity and contact fields never are.
export const PUBLIC_PLAYER_FIELDS = 'id,display_name,slug,island,photo_url,is_claimed,public_code,position'
// Branding columns are object paths in the private tournament-media bucket;
// the UI signs them only for published, non-draft rows (publicTournamentBranding).
export const PUBLIC_TOURNAMENT_FIELDS = 'id,name,slug,sport,status,is_published,logo_path,cover_path,created_at'

async function list(client: SupabaseClient, table: string, columns: string, order = 'name'): Promise<PublicResult<PublicRecord[]>> {
  const result = await client.from(table).select(columns).eq('is_published', true).order(order)
  return { data: result.data as PublicRecord[] | null, error: result.error?.message ?? null }
}

export const getPublishedOrganizations = (client: SupabaseClient) => list(client, 'organizations', PUBLIC_ORGANIZATION_FIELDS)
export async function getPublishedTournaments(client: SupabaseClient): Promise<PublicResult<PublicRecord[]>> {
  const result = await client.from('tournaments').select(`${PUBLIC_TOURNAMENT_FIELDS},updated_at`).eq('is_published', true).neq('status', 'draft').order('updated_at', { ascending: false })
  return { data: result.data as PublicRecord[] | null, error: result.error?.message ?? null }
}
export const getPublishedTeams = (client: SupabaseClient) => list(client, 'teams', PUBLIC_TEAM_FIELDS)
export const getPublishedPlayers = (client: SupabaseClient) => client.from('player_profiles').select(PUBLIC_PLAYER_FIELDS).order('display_name').then(result => ({ data: result.data as PublicRecord[] | null, error: result.error?.message ?? null }))

export function sanitizeSearchQuery(query: string): string { return query.trim().replace(/[%_]/g, '').slice(0, 80) }
export function filterPublishedOrganizations(records: PublicRecord[], query: string): PublicRecord[] { const term = sanitizeSearchQuery(query).toLowerCase(); return records.filter(record => !term || String(record.name ?? '').toLowerCase().includes(term) || String(record.description ?? '').toLowerCase().includes(term)) }

export function filterPublishedTeams(records: PublicRecord[], query: string, teamType = '', island = ''): PublicRecord[] { const term = sanitizeSearchQuery(query).toLowerCase(); return records.filter(record => (!term || String(record.name ?? '').toLowerCase().includes(term) || String(record.description ?? '').toLowerCase().includes(term) || String(record.team_type ?? '').toLowerCase().includes(term) || String(record.island ?? '').toLowerCase().includes(term)) && (!teamType || String(record.team_type ?? '') === teamType) && (!island || String(record.island ?? '') === island)) }
export function filterPublishedPlayers(records: PublicRecord[], query: string, island = ''): PublicRecord[] { const term = sanitizeSearchQuery(query).toLowerCase(); return records.filter(record => (!term || String(record.display_name ?? '').toLowerCase().includes(term) || String(record.island ?? '').toLowerCase().includes(term) || String(record.public_code ?? '').toLowerCase().includes(term)) && (!island || String(record.island ?? '') === island)) }
export function filterPublishedTournaments(records: PublicRecord[], query: string, sport: string, status: string): PublicRecord[] {
  const term = sanitizeSearchQuery(query).toLowerCase(); return records.filter(record => (!term || String(record.name ?? '').toLowerCase().includes(term) || String(record.sport ?? '').toLowerCase().includes(term)) && (!sport || String(record.sport ?? '') === sport) && (!status || String(record.status ?? '') === status))
}
export async function searchPublished(client: SupabaseClient, query: string): Promise<PublicResult<Record<string, PublicRecord[]>>> {
  const term = sanitizeSearchQuery(query); if (!term) return { data: { organizations: [], tournaments: [], teams: [], players: [] }, error: null }
  const pattern = `%${term}%`
  const [organizations, tournaments, teams, players] = await Promise.all([
    client.from('organizations').select('id,name,slug,description').eq('is_published', true).ilike('name', pattern).limit(20),
    client.from('tournaments').select(PUBLIC_TOURNAMENT_FIELDS).eq('is_published', true).neq('status', 'draft').ilike('name', pattern).limit(20),
    client.from('teams').select(PUBLIC_TEAM_FIELDS).eq('is_published', true).ilike('name', pattern).limit(20),
    client.from('player_profiles').select(PUBLIC_PLAYER_FIELDS).ilike('display_name', pattern).limit(20),
  ])
  const error = [organizations, tournaments, teams, players].find(result => result.error)?.error?.message ?? null
  return { data: error ? null : { organizations: organizations.data ?? [], tournaments: tournaments.data ?? [], teams: teams.data ?? [], players: players.data ?? [] }, error }
}

export async function getPublishedStandings(client: SupabaseClient): Promise<PublicResult<PublicRecord[]>> {
  const result = await client.from('standings_snapshots').select('stage_id,team_id,played,wins,draws,losses,scored,conceded,points,calculated_from_version,teams(name,slug,is_published)').order('points', { ascending: false })
  return { data: result.data as PublicRecord[] | null, error: result.error?.message ?? null }
}

export async function getPublishedDetail(client: SupabaseClient, kind: 'organization' | 'tournament' | 'team' | 'player', slug: string): Promise<PublicResult<PublicRecord>> {
  const table = kind === 'organization' ? 'organizations' : kind === 'tournament' ? 'tournaments' : kind === 'team' ? 'teams' : 'player_profiles'
  const columns = kind === 'organization' ? PUBLIC_ORGANIZATION_FIELDS : kind === 'tournament' ? `${PUBLIC_TOURNAMENT_FIELDS},updated_at` : kind === 'team' ? PUBLIC_TEAM_FIELDS : `${PUBLIC_PLAYER_FIELDS},is_published`
  const result = await client.from(table).select(columns).eq('slug', slug).eq('is_published', true).maybeSingle()
  return { data: result.data as PublicRecord | null, error: result.error?.message ?? null }
}

// Approved column boundary for the public matches listing. The matches table
// carries no score, notes, documents, or payment fields — official scores live
// in match_result_versions, which has no guest read policy, so this loader can
// never hand score data to a guest. The tournaments embed only joins IS_PUBLISHED
// tournament rows for the competition label (guest-visible columns only).
export const PUBLIC_MATCH_FIELDS = 'id,tournament_id,stage_id,category_id,home_team_id,away_team_id,scheduled_at,venue,status,tournaments(id,name,slug)'

export async function getPublishedMatches(client: SupabaseClient): Promise<PublicResult<PublicRecord[]>> {
  const result = await client.from('matches').select(PUBLIC_MATCH_FIELDS).eq('status', 'confirmed').order('scheduled_at', { ascending: false })
  return { data: result.data as PublicRecord[] | null, error: result.error?.message ?? null }
}

export async function getPublishedMatch(client: SupabaseClient, id: string): Promise<PublicResult<PublicRecord>> {
  const result = await client.from('matches').select(PUBLIC_MATCH_FIELDS).eq('id', id).eq('status', 'confirmed').maybeSingle()
  return { data: result.data as PublicRecord | null, error: result.error?.message ?? null }
}

// --- Matches listing (#matches) ------------------------------------------------------

export type MatchListFilters = { search: string; sport: string; tournamentId: string; teamId: string; day: string }
export const EMPTY_MATCH_LIST_FILTERS: MatchListFilters = { search: '', sport: '', tournamentId: '', teamId: '', day: '' }

export type MatchListLabels = {
  teams: Record<string, { name: string; slug: string; logo: string | null }>
  tournaments: Record<string, { name: string; slug: string; sport: string }>
}
export const EMPTY_MATCH_LIST_LABELS: MatchListLabels = { teams: {}, tournaments: {} }

// Resolve display names for the team and tournament ids referenced by the loaded
// matches. Only published rows are selected (RLS enforces this too), and only the
// three/four label columns are requested — never internal fields.
export async function getPublishedMatchLabels(client: SupabaseClient, matches: PublicRecord[]): Promise<PublicResult<MatchListLabels>> {
  const teamIds = [...new Set(matches.flatMap(row => [String(row.home_team_id ?? ''), String(row.away_team_id ?? '')]).filter(Boolean))]
  const tournamentIds = [...new Set(matches.map(row => String(row.tournament_id ?? '')).filter(Boolean))]
  const [teams, tournaments] = await Promise.all([
    teamIds.length ? client.from('teams').select('id,name,slug,logo_url').eq('is_published', true).in('id', teamIds) : Promise.resolve({ data: [], error: null }),
    tournamentIds.length ? client.from('tournaments').select('id,name,slug,sport').eq('is_published', true).in('id', tournamentIds) : Promise.resolve({ data: [], error: null }),
  ])
  const teamRows = (teams.data ?? []) as PublicRecord[]
  const tournamentRows = (tournaments.data ?? []) as PublicRecord[]
  return {
    data: {
      teams: Object.fromEntries(teamRows.filter(row => String(row.name ?? '').trim() && String(row.slug ?? '').trim()).map(row => [String(row.id), { name: String(row.name), slug: String(row.slug), logo: String(row.logo_url ?? '') || null }])),
      tournaments: Object.fromEntries(tournamentRows.filter(row => String(row.name ?? '').trim() && String(row.slug ?? '').trim()).map(row => [String(row.id), { name: String(row.name), slug: String(row.slug), sport: String(row.sport ?? '') }])),
    },
    error: teams.error?.message ?? tournaments.error?.message ?? null,
  }
}

// Sports come from the tournaments that own the matches (matches carry no sport column).
export function matchSportOptions(matches: PublicRecord[], labels: MatchListLabels): string[] {
  const sports = new Set<string>()
  for (const row of matches) { const sport = labels.tournaments[String(row.tournament_id ?? '')]?.sport; if (sport) sports.add(sport) }
  return [...sports].sort()
}
export function matchTournamentOptions(matches: PublicRecord[], labels: MatchListLabels): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>()
  for (const row of matches) { const id = String(row.tournament_id ?? ''); const name = labels.tournaments[id]?.name; if (id && name && !seen.has(id)) seen.set(id, name) }
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}
export function matchTeamOptions(matches: PublicRecord[], labels: MatchListLabels): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>()
  for (const row of matches) for (const id of [String(row.home_team_id ?? ''), String(row.away_team_id ?? '')]) { const name = labels.teams[id]?.name; if (id && name && !seen.has(id)) seen.set(id, name) }
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

// Local calendar day of a match timestamp, so the day filter never shifts across time zones.
export function matchDayKey(value: unknown): string {
  if (!value) return ''
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
export function matchDayOptions(matches: PublicRecord[]): string[] {
  return [...new Set(matches.map(row => matchDayKey(row.scheduled_at)).filter(Boolean))].sort()
}
export function formatMatchDay(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  if (!year || !month || !day) return dayKey
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}
export function formatMatchSchedule(value: unknown): string {
  if (!value) return 'Date not published'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return 'Date not published'
  return date.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const MATCH_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled', live: 'Live', awaiting_confirmation: 'Awaiting confirmation', confirmed: 'Official',
  postponed: 'Postponed', abandoned: 'Abandoned', cancelled: 'Cancelled',
}
// Only 'confirmed' rows are visible to guests under the public RLS policy; the other
// labels exist so the badge stays truthful if that policy ever widens.
export function matchStatusLabel(status: unknown): string {
  const key = String(status ?? '')
  return MATCH_STATUS_LABELS[key] ? statusLabel('match', key, MATCH_STATUS_LABELS[key]) : 'Status not published'
}
// Badge tone is derived from the record's own status, never assumed from visibility.
export function matchStatusClass(status: unknown): string {
  const key = String(status ?? '')
  return key === 'confirmed' ? 'match-status confirmed' : key === 'live' ? 'match-status live' : 'match-status'
}

export function matchPairTitle(match: PublicRecord, labels: MatchListLabels): string {
  const nameOf = (id: unknown) => labels.teams[String(id ?? '')]?.name ?? 'Published team'
  return `${nameOf(match.home_team_id)} vs ${nameOf(match.away_team_id)}`
}

export function filterPublishedMatches(matches: PublicRecord[], labels: MatchListLabels, filters: MatchListFilters): PublicRecord[] {
  const term = sanitizeSearchQuery(filters.search).toLowerCase()
  return matches.filter(row => {
    const tournamentId = String(row.tournament_id ?? '')
    const homeId = String(row.home_team_id ?? '')
    const awayId = String(row.away_team_id ?? '')
    const tournament = labels.tournaments[tournamentId]
    const home = labels.teams[homeId]
    const away = labels.teams[awayId]
    if (filters.sport && String(tournament?.sport ?? '') !== filters.sport) return false
    if (filters.tournamentId && tournamentId !== filters.tournamentId) return false
    if (filters.teamId && homeId !== filters.teamId && awayId !== filters.teamId) return false
    if (filters.day && matchDayKey(row.scheduled_at) !== filters.day) return false
    if (term) {
      const haystack = [home?.name, away?.name, tournament?.name, String(row.venue ?? '')].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(term)) return false
    }
    return true
  })
}

export type PublicTournamentPage = { tournament: PublicRecord; matches: PublicRecord[]; teams: PublicRecord[]; registration: PublicRegistrationInfo; notices: string[] }
export async function getPublishedTournamentPage(client: SupabaseClient, slug: string): Promise<PublicResult<PublicTournamentPage>> {
  const tournament = await getPublishedDetail(client, 'tournament', slug)
  if (tournament.error || !tournament.data) return { data: null, error: tournament.error }
  const matches = await getPublishedMatches(client)
  const tournamentMatches = (matches.data ?? []).filter(match => String(match.tournament_id) === String(tournament.data?.id))
  const teamIds = [...new Set(tournamentMatches.flatMap(match => [String(match.home_team_id ?? ''), String(match.away_team_id ?? '')]).filter(Boolean))]
  let teams: PublicRecord[] = []
  let teamError: string | null = null
  if (teamIds.length) { const teamResult = await client.from('teams').select('id,name,slug,team_type,island,logo_url').eq('is_published', true).in('id', teamIds); teams = (teamResult.data ?? []) as PublicRecord[]; teamError = teamResult.error?.message ?? null }
  // Registration state for visitors (spec section 6): settings, questions, and
  // categories are real applicant-facing rows. The settings and categories
  // policies ship in review-only migration 020, which is not applied by the
  // app - until then the page says the details are not public yet instead of
  // inventing a state.
  const registration = await getPublicRegistration(client, String(tournament.data.id), String(tournament.data.status ?? ''))
  return { data: { tournament: tournament.data, matches: tournamentMatches, teams, registration, notices: [matches.error ? 'confirmed matches' : '', teamError ? 'published teams' : ''].filter(Boolean) }, error: null }
}

// --- Public registration state (spec sections 2 and 6) -------------------------

export const PUBLIC_REGISTRATION_SETTINGS_FIELDS = 'opens_at,closes_at,application_method,entry_requirements,contact_instructions,roster_min,roster_max,roster_deadline,documents_required,change_rules'
export const PUBLIC_REGISTRATION_QUESTION_FIELDS = 'field_key,prompt,instructions,response_type,options,required,sort_order'

export type PublicRegistrationQuestion = { key: string; label: string; instructions: string | null; type: string; required: boolean; options: string[] }

export type PublicRegistrationInfo = {
  state: 'preparing' | 'scheduled' | 'open' | 'closed' | 'disabled' | 'unknown'
  method: string | null
  opensAt: string | null
  closesAt: string | null
  entryRequirements: string | null
  contactInstructions: string | null
  rosterMin: number | null
  rosterMax: number | null
  rosterDeadline: string | null
  documentsRequired: boolean
  changeRules: string | null
  categories: Array<{ id: string; name: string; team_limit: number | null }>
  questions: PublicRegistrationQuestion[]
  unavailable: string[]
}

export const PUBLIC_REGISTRATION_EMPTY: PublicRegistrationInfo = {
  state: 'unknown', method: null, opensAt: null, closesAt: null, entryRequirements: null,
  contactInstructions: null, rosterMin: null, rosterMax: null, rosterDeadline: null,
  documentsRequired: false, changeRules: null, categories: [], questions: [], unavailable: [],
}

// Pure state rule (spec section 6): Preparing / Scheduled / Open / Closed /
// Disabled. Closing is enforced even if the organizer's status flip was missed,
// and a Copy Link never activates anything - only the real status does.
export function publicRegistrationState(
  settings: { application_method: string | null; opens_at: string | null; closes_at: string | null } | null,
  tournamentStatus: string,
  now: Date = new Date(),
): 'preparing' | 'scheduled' | 'open' | 'closed' | 'disabled' {
  if (!settings) {
    // The organizer's status is the truth: a tournament opened for
    // registration (even without Stage 3 settings saved - an older draft or a
    // direct Open click) must show open to visitors, not "not available".
    return tournamentStatus === 'registration_open' ? 'open' : 'preparing'
  }
  if (settings.application_method === 'invite_only') return 'disabled'
  const opensAt = settings.opens_at ? new Date(settings.opens_at) : null
  const closesAt = settings.closes_at ? new Date(settings.closes_at) : null
  if (closesAt && closesAt.getTime() <= now.getTime()) return 'closed'
  if (tournamentStatus === 'registration_open') {
    if (opensAt && opensAt.getTime() > now.getTime()) return 'scheduled'
    return 'open'
  }
  if (opensAt && opensAt.getTime() > now.getTime()) return 'scheduled'
  if (opensAt) return 'closed'
  return 'preparing'
}

type RegistrationSettingsRow = { application_method: string | null; opens_at: string | null; closes_at: string | null }

export function registrationButtonState(registration: PublicRegistrationInfo, tournamentStatus: string): { enabled: boolean; label: string; reason: string | null } {
  const status = String(tournamentStatus ?? '').toLowerCase()
  if (['cancelled', 'completed', 'archived'].includes(status)) {
    return { enabled: false, label: 'Registration unavailable', reason: `This tournament is ${status}.` }
  }
  if (registration.state === 'disabled') {
    return { enabled: false, label: 'Teams added by organizer', reason: 'Teams are added by the organizer; public registration is not available.' }
  }
  if (registration.state === 'unknown') {
    return { enabled: false, label: 'Registration not available', reason: 'Registration details are not public yet.' }
  }
  if (registration.state === 'preparing') {
    return { enabled: false, label: 'Registration not open', reason: 'Registration has not been opened yet.' }
  }
  if (registration.state === 'scheduled') {
    const opens = registration.opensAt ? `Opens ${new Date(registration.opensAt).toLocaleString()}.` : 'Opens soon.'
    return { enabled: false, label: 'Registration not open yet', reason: opens }
  }
  if (registration.state === 'closed') {
    return { enabled: false, label: 'Registration closed', reason: 'Registration closed.' }
  }
  return { enabled: true, label: 'Register Team', reason: registration.closesAt ? `Closes ${new Date(registration.closesAt).toLocaleString()}.` : null }
}

export async function getPublicRegistration(client: SupabaseClient, tournamentId: string, tournamentStatus: string): Promise<PublicRegistrationInfo> {
  const info: PublicRegistrationInfo = { ...PUBLIC_REGISTRATION_EMPTY, unavailable: [] }
  const settingsResult = await client
    .from('tournament_registration_settings')
    .select(PUBLIC_REGISTRATION_SETTINGS_FIELDS)
    .eq('tournament_id', tournamentId)
    .maybeSingle()

  // A permission error means the public settings policy (migration 020) is not
  // applied yet; a null row simply means registration was never configured.
  let settingsRead = false
  if (settingsResult.error) {
    info.unavailable.push('public registration settings (needs migration 020 policy)')
  } else {
    settingsRead = true
    const settings = (settingsResult.data ?? null) as Record<string, unknown> | null
    info.method = typeof settings?.application_method === 'string' ? settings.application_method : null
    info.opensAt = typeof settings?.opens_at === 'string' ? settings.opens_at : null
    info.closesAt = typeof settings?.closes_at === 'string' ? settings.closes_at : null
    info.entryRequirements = typeof settings?.entry_requirements === 'string' ? settings.entry_requirements : null
    info.contactInstructions = typeof settings?.contact_instructions === 'string' ? settings.contact_instructions : null
    info.rosterMin = typeof settings?.roster_min === 'number' ? settings.roster_min : null
    info.rosterMax = typeof settings?.roster_max === 'number' ? settings.roster_max : null
    info.rosterDeadline = typeof settings?.roster_deadline === 'string' ? settings.roster_deadline : null
    info.documentsRequired = settings?.documents_required === true
    info.changeRules = typeof settings?.change_rules === 'string' ? settings.change_rules : null
  }

  // Categories become selectable/applicant-facing with migration 020; until
  // then the list is empty with a note, never invented.
  const categoriesResult = await client
    .from('tournament_categories')
    .select('id,name,team_limit,sort_order')
    .eq('tournament_id', tournamentId)
    .order('sort_order', { ascending: true })
  if (categoriesResult.error) info.unavailable.push('tournament categories (needs migration 020 policy)')
  else {
    info.categories = ((categoriesResult.data ?? []) as Array<Record<string, unknown>>).map(row => ({
      id: String(row.id),
      name: String(row.name ?? ''),
      team_limit: typeof row.team_limit === 'number' ? row.team_limit : null,
    }))
  }

  // Questions are publicly readable under the existing "published registration
  // questions are public" policy. The instructions column only exists after
  // migration 019, so retry without it on that specific error.
  let questionRows: { data: Array<Record<string, unknown>> | null; error: { message: string } | null } = (await client
    .from('tournament_registration_questions')
    .select(PUBLIC_REGISTRATION_QUESTION_FIELDS)
    .eq('tournament_id', tournamentId)
    .order('sort_order', { ascending: true })) as unknown as { data: Array<Record<string, unknown>> | null; error: { message: string } | null }
  if (questionRows.error && /instructions/i.test(questionRows.error.message)) {
    questionRows = (await client
      .from('tournament_registration_questions')
      .select('field_key,prompt,response_type,options,required,sort_order')
      .eq('tournament_id', tournamentId)
      .order('sort_order', { ascending: true })) as unknown as { data: Array<Record<string, unknown>> | null; error: { message: string } | null }
  }
  if (questionRows.error) info.unavailable.push('registration form questions')
  else {
    info.questions = ((questionRows.data ?? []) as Array<Record<string, unknown>>).map(row => ({
      key: String(row.field_key ?? ''),
      label: String(row.prompt ?? ''),
      instructions: typeof row.instructions === 'string' ? row.instructions : null,
      type: String(row.response_type ?? 'text'),
      required: row.required === true,
      options: Array.isArray(row.options) ? (row.options as unknown[]).map(option => String(option)).filter(Boolean) : [],
    }))
  }

  return { ...info, state: settingsRead ? publicRegistrationState((settingsResult.data ?? null) as RegistrationSettingsRow | null, tournamentStatus) : 'unknown' }
}

// Maldives time is the tournament standard (spec section 3): UTC+5, no
// daylight saving. The IANA zone is "Indian/Maldives". (An earlier version used
// "Asia/Dhaka", which is UTC+6 and showed every time one hour late.) Browser
// timezones are never used, so a visitor never sees their local time by accident.
export function formatMaldivesDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Maldives', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function formatMaldivesDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Maldives', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
  } catch {
    return iso
  }
}

export const PUBLIC_REGISTRATION_STATE_LABELS: Record<PublicRegistrationInfo['state'], string> = {
  preparing: 'Registration is not available yet',
  scheduled: 'Registration is scheduled',
  open: 'Registration is open',
  closed: 'Registration closed',
  disabled: 'Public registration is not available for this tournament',
  unknown: 'Registration details are not public yet',
}

// Teams, news and sponsors load separately on the page (publicPages.ts, migration 038).
export type PublicOrganizationPage = { organization: PublicRecord; tournaments: PublicRecord[]; teams: PublicRecord[]; unavailable: string[] }
export async function getPublishedOrganizationPage(client: SupabaseClient, slug: string): Promise<PublicResult<PublicOrganizationPage>> {
  const organization = await getPublishedDetail(client, 'organization', slug)
  if (organization.error || !organization.data) return { data: null, error: organization.error }
  const tournaments = await client.from('tournaments').select(PUBLIC_TOURNAMENT_FIELDS).eq('organization_id', organization.data.id).eq('is_published', true).neq('status', 'draft')
  return { data: { organization: organization.data, tournaments: (tournaments.data ?? []) as PublicRecord[], teams: [], unavailable: [] }, error: tournaments.error?.message ?? null }
}

export const PUBLIC_TEAM_ROSTER_FIELDS = 'id,player_id,status,effective_from,effective_to,player_profiles(id,display_name,slug,island,photo_url,is_published)'
export function selectPublishedRoster(rows: PublicRecord[]): PublicRecord[] { return rows.filter(row => { const player = row.player_profiles as Record<string, unknown> | null; return Boolean(player) && String(player?.display_name ?? '').trim().length > 0 }) }

export type PublicTeamPage = { team: PublicRecord; roster: PublicRecord[]; tournaments: PublicRecord[]; matches: PublicRecord[]; opponents: PublicRecord[]; standings: PublicRecord[]; achievements: PublicRecord[]; unavailable: string[] }
export async function getPublishedTeamPage(client: SupabaseClient, slug: string): Promise<PublicResult<PublicTeamPage>> {
  const team = await getPublishedDetail(client, 'team', slug)
  if (team.error || !team.data) return { data: null, error: team.error }
  const teamId = String(team.data.id)
  const [roster, matches, standings, achievements] = await Promise.all([
    client.from('player_team_memberships').select(PUBLIC_TEAM_ROSTER_FIELDS).eq('team_id', teamId).order('effective_from', { ascending: false }).limit(100),
    client.from('matches').select('id,tournament_id,home_team_id,away_team_id,scheduled_at,venue,status').eq('status', 'confirmed').or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`).order('scheduled_at', { ascending: false }).limit(30),
    client.from('standings_snapshots').select('stage_id,team_id,played,wins,draws,losses,scored,conceded,points,calculated_from_version').eq('team_id', teamId).order('points', { ascending: false }),
    client.from('sport_milestones').select('id,milestone_type,label,state,reached_at,tournament_id').eq('team_id', teamId).eq('state', 'reached').order('reached_at', { ascending: false }).limit(20),
  ])
  const opponentIds = [...new Set((matches.data ?? []).flatMap(match => [String(match.home_team_id ?? ''), String(match.away_team_id ?? '')]).filter(id => id && id !== teamId))]
  const tournamentIds = [...new Set((matches.data ?? []).map(match => String(match.tournament_id)).filter(Boolean))]
  // Tournament names and opponent names depend only on the matches above and are
  // independent of each other, so fetch them concurrently.
  const [tournamentResult, opponentResult] = await Promise.all([
    tournamentIds.length ? client.from('tournaments').select(PUBLIC_TOURNAMENT_FIELDS).eq('is_published', true).neq('status', 'draft').in('id', tournamentIds) : Promise.resolve(null),
    opponentIds.length ? client.from('teams').select('id,name,slug').eq('is_published', true).in('id', opponentIds) : Promise.resolve(null),
  ])
  const tournaments = (tournamentResult?.data ?? []) as PublicRecord[]
  const opponents = (opponentResult?.data ?? []) as PublicRecord[]
  const tournamentError = tournamentResult?.error?.message ?? null
  const opponentError = opponentResult?.error?.message ?? null
  return { data: { team: team.data, roster: selectPublishedRoster((roster.data ?? []) as PublicRecord[]), tournaments, matches: (matches.data ?? []) as PublicRecord[], opponents, standings: (standings.data ?? []) as PublicRecord[], achievements: (achievements.data ?? []) as PublicRecord[], unavailable: [roster.error ? 'public roster' : '', matches.error ? 'fixtures and results' : '', standings.error ? 'standings' : '', achievements.error ? 'achievements' : '', tournamentError ? 'tournaments' : '', opponentError ? 'opponent teams' : ''].filter(Boolean) }, error: null }
}

export async function getPlayerStatistics(client: SupabaseClient, playerId: string): Promise<PublicResult<PublicRecord[]>> {
  const result = await client.rpc('get_player_official_statistics', { p_player_id: playerId })
  return { data: result.data as PublicRecord[] | null, error: result.error?.message ?? null }
}

export async function getPlayerHistory(client: SupabaseClient, playerId: string): Promise<PublicResult<PublicRecord[]>> {
  const result = await client.from('player_team_memberships').select('team_id,status,effective_from,effective_to,teams(name,slug,team_type,is_published)').eq('player_id', playerId)
  return { data: result.data as PublicRecord[] | null, error: result.error?.message ?? null }
}

// Published achievements/trophies for a player (sport_milestones). Under the
// current public policy this read errors for guests when an operator-managed
// milestone policy references a helper anon cannot execute; the caller surfaces
// that truthfully instead of inventing data.
export async function getPlayerAchievements(client: SupabaseClient, playerId: string): Promise<PublicResult<PublicRecord[]>> {
  const result = await client.from('sport_milestones').select('id,label,milestone_type,state,reached_at,is_manual').eq('player_id', playerId).order('reached_at', { ascending: false })
  return { data: result.data as PublicRecord[] | null, error: result.error?.message ?? null }
}

// Most recent active team membership, used for the digital card's team label.
export function currentPublicTeam(history: PublicRecord[]): PublicRecord | null {
  const active = history
    .filter(row => row.status === 'active')
    .sort((a, b) => String(b.effective_from ?? '').localeCompare(String(a.effective_from ?? '')))
  return active[0] ?? null
}

export function playerPublicSportOptions(statistics: PublicRecord[]): string[] {
  return [...new Set(statistics.map(row => String(row.sport ?? '')).filter(Boolean))]
}

export function playerPublicTeamOptions(history: PublicRecord[]): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>()
  for (const row of history) {
    const id = String(row.team_id ?? '')
    if (!id || seen.has(id)) continue
    const team = row.teams as Record<string, unknown> | null
    seen.set(id, String(team?.name ?? 'Published team'))
  }
  return [...seen].map(([id, name]) => ({ id, name }))
}

export function filterPlayerPublicStatistics(statistics: PublicRecord[], sport: string, teamId: string): PublicRecord[] {
  return statistics.filter(row => (!sport || String(row.sport ?? '') === sport) && (!teamId || String(row.team_id ?? '') === teamId))
}

export function filterPlayerPublicHistory(history: PublicRecord[], teamId: string): PublicRecord[] {
  return history.filter(row => !teamId || String(row.team_id ?? '') === teamId)
}

// Filters team history by team level (club / island / national), read from the
// joined team row so unpublished teams never contribute an option.
export function filterPlayerHistoryByTeamLevel(history: PublicRecord[], teamLevel: string): PublicRecord[] {
  return history.filter(row => {
    if (!teamLevel) return true
    const team = row.teams as Record<string, unknown> | null
    return String(team?.team_type ?? '') === teamLevel
  })
}

// --- Player history & statistics page (#history/:slug) ----------------------
//
// The history page offers the full filter set from the product spec (team
// level, tournament, season, sport). Every option is derived from rows the
// guest can already see, and each filter renders only when the data actually
// supports it (2+ distinct options), so nothing is invented and no internal
// identifier is ever shown as a label.

export type PlayerHistoryFilters = { teamLevel: string; sport: string; tournamentId: string; seasonId: string }

export const EMPTY_PLAYER_HISTORY_FILTERS: PlayerHistoryFilters = { teamLevel: '', sport: '', tournamentId: '', seasonId: '' }

// Distinct team levels (club / island / national / ...) present in the rows.
export function playerPublicTeamLevelOptions(statistics: PublicRecord[]): string[] {
  return [...new Set(statistics.map(row => String(row.team_type ?? '')).filter(Boolean))]
}

export function playerPublicSeasonIdOptions(statistics: PublicRecord[]): string[] {
  return [...new Set(statistics.map(row => String(row.season_id ?? '')).filter(Boolean))]
}

export function playerPublicTournamentIdOptions(statistics: PublicRecord[]): string[] {
  return [...new Set(statistics.map(row => String(row.tournament_id ?? '')).filter(Boolean))]
}

// A filter option only exists when it can be labelled with a real published
// name. Season names have no public read policy today, so they resolve to no
// option and the season filter stays hidden rather than showing a raw id.
export function labelledFilterOptions(ids: string[], labels: Record<string, string>): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    const name = labels[id]
    if (name) seen.set(id, name)
  }
  return [...seen].map(([id, name]) => ({ id, name }))
}

// Resolves display names for the tournament/season ids in a player's rows.
// Guests may read published tournaments only; seasons currently expose no
// public read policy, so that lookup returns no rows and is not an error.
// Tournament slugs are resolved too so the statistics table can link to a real
// `#tournament/:slug` page — public detail routes resolve by slug, never by id.
export type PlayerHistoryFilterLabels = { tournaments: Record<string, string>; tournamentSlugs: Record<string, string>; seasons: Record<string, string> }
export const EMPTY_PLAYER_HISTORY_LABELS: PlayerHistoryFilterLabels = { tournaments: {}, tournamentSlugs: {}, seasons: {} }

export async function getPlayerHistoryFilterLabels(client: SupabaseClient, statistics: PublicRecord[]): Promise<PublicResult<PlayerHistoryFilterLabels>> {
  const tournamentIds = playerPublicTournamentIdOptions(statistics)
  const seasonIds = playerPublicSeasonIdOptions(statistics)
  const [tournaments, seasons] = await Promise.all([
    tournamentIds.length ? client.from('tournaments').select('id,name,slug').eq('is_published', true).in('id', tournamentIds) : Promise.resolve({ data: [], error: null }),
    seasonIds.length ? client.from('seasons').select('id,name').in('id', seasonIds) : Promise.resolve({ data: [], error: null }),
  ])
  const toMap = (rows: PublicRecord[] | null): Record<string, string> => Object.fromEntries((rows ?? []).map(row => [String(row.id), String(row.name ?? '')]))
  const tournamentRows = (tournaments.data ?? []) as PublicRecord[]
  const error = tournaments.error?.message ?? seasons.error?.message ?? null
  return { data: { tournaments: toMap(tournamentRows), tournamentSlugs: Object.fromEntries(tournamentRows.map(row => [String(row.id), String(row.slug ?? '')]).filter(([, slug]) => slug)), seasons: toMap(seasons.data as PublicRecord[] | null) }, error }
}

export function filterPlayerHistoryStatistics(statistics: PublicRecord[], filters: PlayerHistoryFilters): PublicRecord[] {
  return statistics.filter(row =>
    (!filters.teamLevel || String(row.team_type ?? '') === filters.teamLevel) &&
    (!filters.sport || String(row.sport ?? '') === filters.sport) &&
    (!filters.tournamentId || String(row.tournament_id ?? '') === filters.tournamentId) &&
    (!filters.seasonId || String(row.season_id ?? '') === filters.seasonId)
  )
}

// --- Directory details (dates, location, organizer) ----------------------------
// Optional columns (starts_at, island from migration 018) and the organizer name
// are read in a separate query so a missing column or an unpublished
// organization can never break the tournament pages; absent values stay absent.
export type TournamentDirectoryDetail = { startsAt: string | null; island: string | null; organizerName: string | null; organizerSlug: string | null; closesAt: string | null }

export async function getTournamentDirectoryDetails(client: SupabaseClient, tournamentIds: string[]): Promise<Map<string, TournamentDirectoryDetail>> {
  const details = new Map<string, TournamentDirectoryDetail>()
  if (tournamentIds.length === 0) return details
  const rows = await client.from('tournaments').select('id,starts_at,island,organization_id').eq('is_published', true).in('id', tournamentIds)
  if (rows.error) return details
  const records = (rows.data ?? []) as Array<Record<string, unknown>>
  const organizationIds = [...new Set(records.map(row => String(row.organization_id ?? '')).filter(Boolean))]
  // Registration closing times (public settings policy, migration 020). A read
  // failure just leaves them unknown; the tournament status still applies.
  const settings = await client.from('tournament_registration_settings').select('tournament_id,closes_at').in('tournament_id', tournamentIds)
  const closing = new Map(((settings.error ? [] : settings.data ?? []) as Array<Record<string, unknown>>).map(row => [String(row.tournament_id), typeof row.closes_at === 'string' ? row.closes_at : null]))
  const organizations = organizationIds.length ? await client.from('organizations').select('id,name,slug').eq('is_published', true).in('id', organizationIds) : { data: [], error: null }
  const byOrganization = new Map(((organizations.data ?? []) as Array<Record<string, unknown>>).map(row => [String(row.id), { name: String(row.name ?? ''), slug: String(row.slug ?? '') }]))
  for (const row of records) {
    const organization = byOrganization.get(String(row.organization_id ?? ''))
    details.set(String(row.id), { startsAt: typeof row.starts_at === 'string' ? row.starts_at : null, island: typeof row.island === 'string' && row.island.trim() ? row.island : null, organizerName: organization?.name || null, organizerSlug: organization?.slug || null, closesAt: closing.get(String(row.id)) ?? null })
  }
  return details
}

// Trophy images (migration 029) for achievements the public can already read.
// Kept out of getPlayerAchievements so its approved column list is unchanged;
// a missing column simply yields no images.
export async function getAchievementImages(client: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const images = new Map<string, string>()
  if (!ids.length) return images
  const result = await client.from('sport_milestones').select('id,image_url').in('id', ids)
  if (result.error) return images
  for (const row of (result.data ?? []) as Array<Record<string, unknown>>) if (typeof row.image_url === 'string' && row.image_url.startsWith('https://')) images.set(String(row.id), row.image_url)
  return images
}
