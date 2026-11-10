import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Building2, CalendarDays, CheckCircle2, Clock3, Globe2, MapPin, Radio, Search, ShieldCheck, SlidersHorizontal, Trophy } from 'lucide-react'
import type { PublicCollectionKind, PublicDetailKind, PublicRoute } from '../lib/publicRoutes'
import { ReportButton } from './ReportContent'
import { BracketDirectory, ExplorePage, MatchesDirectory, NewsDirectory, Pager, SearchDirectory, StandingsDirectory, TournamentSchedule } from './PublicDirectories'
import { loadPublicSponsors, sponsorLogoUrl, type PublicSponsor } from '../lib/tournamentPages'
import { CalendarButton, FixturesCalendar, FollowButton, PrintButton } from './PublicExtras'
import { directionsHref, publicUrl, readingMinutes } from '../lib/publicExtras'
import { MatchKeyEvents, MatchLineups, MatchStatistics, MatchTimeline, OrganizationSections, TournamentDraw, TournamentLive } from './PublicPageParts'
import { archiveOptions, archiveTournaments, EMPTY_ARCHIVE_FILTERS, isArchivedTournament, loadTeamManagement, playerManagementLabel, teamManagementLabel, type ArchiveFilters, type TeamManagement } from '../lib/publicPages'
import { filterOrganizations, getPublicMatchPage, loadOrganizationLocations, loadPlayerSports, loadPlayerTeams, loadTeamSports, loadTournamentCategories, matchEventLabel, NO_MATCH_EXTRAS, optionsFrom, placesState, type MatchExtras } from '../lib/publicPages'
import { loadCapacity, loadMatchFeed, type Capacity, type FeedMatch } from '../lib/landing'
import { pageSlice } from '../lib/directory'
import type { MatchListFilters, MatchListLabels, PlayerHistoryFilterLabels, TournamentDirectoryDetail } from '../lib/publicData'
import { filterPublishedPlayers, filterPublishedTeams, filterPublishedTournaments, currentPublicTeam, filterPlayerPublicHistory, filterPlayerHistoryByTeamLevel, filterPlayerPublicStatistics, filterPlayerHistoryStatistics, formatMaldivesDate, formatMaldivesDateTime, getPlayerAchievements, getPlayerHistory, getPlayerStatistics, getPlayerHistoryFilterLabels, EMPTY_PLAYER_HISTORY_LABELS, labelledFilterOptions, playerPublicTeamLevelOptions, playerPublicSportOptions, playerPublicTeamOptions, getPublishedDetail, getPublishedMatches, getPublishedMatchLabels, getPublishedOrganizations, getPublishedOrganizationPage, getPublishedPlayers, getPublishedStandings, getPublishedTeams, getPublishedTeamPage, getPublishedTournaments, getPublishedTournamentPage, getTournamentDirectoryDetails, searchPublished, PUBLIC_REGISTRATION_STATE_LABELS, PUBLIC_REGISTRATION_EMPTY, EMPTY_MATCH_LIST_FILTERS, EMPTY_MATCH_LIST_LABELS, filterPublishedMatches, formatMatchDay, formatMatchSchedule, matchDayOptions, matchPairTitle, matchSportOptions, matchStatusLabel, matchStatusClass, matchTeamOptions, matchTournamentOptions, registrationButtonState } from '../lib/publicData'
import type { PublicRegistrationInfo } from '../lib/publicData'
import { computePlayerRating, totalOfficialStatistics } from '../lib/playerRating'
import { registrationStage, tournamentStage } from '../lib/homepage'
import { formatDay, monogram, resultState, sportName } from '../lib/display'
import { PublicApplicationForm } from './PublicApplicationForm'
import { PublicRegistrationLayout } from './PublicRegistrationLayout'
import { ArchiveStamp, TournamentAwardsTab, TournamentPlayersTab, TournamentResults, TournamentStatsTab } from './TournamentPublicTabs'
import { loadTournamentPlayers, loadTournamentPlayerStats } from '../lib/publicPages'
import { TournamentCard, TournamentTile } from './HomepageSections'
import { IslandCallToAction, NumberedPager, PageBanner } from './IslandPage'
import { CoverScene, PersonAvatar, TeamLogo, SportGlyph } from './HomeArt'
import { useAppConfig } from '../lib/useAppConfig'
import { TournamentCover, TournamentLogo } from './TournamentBranding'
import { publicTournamentBranding } from '../lib/tournamentBranding'
import { publicSupabase } from '../lib/supabase'
import { PlayerCard } from './PlayerCard'
import { getPublishedNews, getPublishedNewsBySlug } from '../lib/news'
import { BottomSheet, Chip, Crest, EdEmpty, ShareButton, TabStrip } from './Editorial'
import { Honours } from './Honours'
import { EMPTY_EXTRAS, loadProfileExtras, SOCIAL_PLATFORMS, type ProfileExtras } from '../lib/playerProfileExtras'

type PublicCollectionRoute = { kind: Exclude<PublicCollectionKind, 'news' | 'search'> }
type PublicDetailRoute = { kind: PublicDetailKind; slug: string }
function isPublicCollectionRoute(route: PublicRoute): route is PublicCollectionRoute { return ['organizations', 'tournaments', 'teams', 'players', 'matches', 'standings', 'bracket'].includes(route.kind) }
function isPublicDetailRoute(route: PublicRoute): route is PublicDetailRoute { return ['organization', 'tournament', 'team', 'player', 'history', 'match'].includes(route.kind) }

function Loading() { return <div className="public-state public-skeleton"><span className="skeleton sk-block" /><span className="skeleton sk-line" /><span className="skeleton sk-line" style={{ width: '70%' }} /><span className="skeleton sk-block" style={{ height: 120 }} /></div> }
// Plain language only: raw service messages are never shown to visitors.
function ErrorState() { return <div className="public-state error-state" role="alert"><p><strong>This page could not be loaded.</strong> Check your connection and try again.</p><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => window.location.reload()}>Retry</button></div> }
function Empty({ message }: { message: string }) { return <div className="public-state"><Globe2 size={22} /><p>{message}</p></div> }
function NotFound() { return <div className="public-state"><ShieldCheck size={22} /><h3>Public record not found</h3><p>This record may be unpublished, unavailable, or the link may be incorrect.</p></div> }
function Back({ href = '#top', label = 'Back to Kulhivaru+' }: { href?: string; label?: string } = {}) { return <a className="back-link public-back" href={href}><ArrowLeft size={14} /> {label}</a> }

// These pages load, filter and page their own data (PublicDirectories).
const DIRECTORY_KINDS: string[] = ['matches', 'standings', 'bracket', 'search', 'explore']

export function PublicPage({ route, onCreateTournament }: { route: PublicRoute; onCreateTournament?: () => void }) {
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [data, setData] = useState<unknown>(null)
  // Data belongs to the route it was loaded for: after an in-app navigation the first
  // render must not hand the previous page's data to the next page's component.
  const routeKey = JSON.stringify(route); const [loadedKey, setLoadedKey] = useState('')
  useEffect(() => { let active = true; const key = JSON.stringify(route); const load = async () => { setLoading(true); setError(''); setData(null); if (!publicSupabase || route.kind === 'home' || DIRECTORY_KINDS.includes(route.kind) || (route.kind === 'news' && !('slug' in route))) { setLoading(false); setLoadedKey(key); return } let result: { data: unknown; error: string | null } = { data: null, error: null }; if (route.kind === 'organizations') result = await getPublishedOrganizations(publicSupabase); else if (route.kind === 'tournaments' || route.kind === 'archive') result = await getPublishedTournaments(publicSupabase); else if (route.kind === 'teams') result = await getPublishedTeams(publicSupabase); else if (route.kind === 'players') result = await getPublishedPlayers(publicSupabase); else if (route.kind === 'matches' || route.kind === 'bracket') result = await getPublishedMatches(publicSupabase); else if (route.kind === 'standings') result = await getPublishedStandings(publicSupabase); else if (route.kind === 'search') result = await searchPublished(publicSupabase, route.query); else if (route.kind === 'organization') result = await getPublishedOrganizationPage(publicSupabase, route.slug); else if (route.kind === 'team') result = await getPublishedTeamPage(publicSupabase, route.slug); else if (route.kind === 'player') result = await getPublishedDetail(publicSupabase, route.kind, route.slug); else if (route.kind === 'tournament' || route.kind === 'registration') result = await getPublishedTournamentPage(publicSupabase, route.slug); else if (route.kind === 'news' && !('slug' in route)) result = await getPublishedNews(publicSupabase); else if (route.kind === 'news' && 'slug' in route) result = await getPublishedNewsBySlug(publicSupabase, (route as { slug: string }).slug); else if (route.kind === 'history') result = await getPublishedDetail(publicSupabase, 'player', route.slug); else if (route.kind === 'match') result = await getPublicMatchPage(publicSupabase, route.slug); if (active) { setLoading(false); setLoadedKey(key); if (result.error) setError(result.error); else setData(result.data) } }; void load(); return () => { active = false } }, [route])
  const backHref = route.kind === 'organization' ? '#organizations' : route.kind === 'team' ? '#teams' : '#top'; const backLabel = route.kind === 'organization' ? 'Back to Organizations' : route.kind === 'team' ? 'Back to Teams' : 'Back to Kulhivaru+'
  if (route.kind === 'explore') return <ExplorePage />
  if (route.kind === 'matches') return <MatchesDirectory legacy={records => <MatchList records={records} />} />
  if (route.kind === 'standings') return <StandingsDirectory />
  if (route.kind === 'bracket') return <BracketDirectory />
  if (route.kind === 'search') return <SearchDirectory initialQuery={route.query} />
  if (route.kind === 'news' && !('slug' in route)) return <NewsDirectory />
  if (loading || loadedKey !== routeKey) return <section className="public-page ed-page"><Back href={backHref} label={backLabel} /><Loading /></section>
  if (error) return <section className="public-page ed-page"><Back href={backHref} label={backLabel} /><ErrorState /></section>
if (route.kind === 'news' && 'slug' in route) {
  const record = data as Record<string, unknown> | null
  if (!record) return <section className="public-page ed-page"><Back /><NotFound /></section>
  return <NewsDetail record={record} />
}
  if (route.kind === 'tournaments') return <TournamentList records={(data ?? []) as Record<string, unknown>[]} onCreateTournament={onCreateTournament} />
  if (route.kind === 'archive') return <ArchiveList records={(data ?? []) as Record<string, unknown>[]} />
  if (route.kind === 'organizations') return <OrganizationList records={(data ?? []) as Record<string, unknown>[]} />
  if (route.kind === 'teams') return <TeamList records={(data ?? []) as Record<string, unknown>[]} />
  if (route.kind === 'players') return <PlayerList records={(data ?? []) as Record<string, unknown>[]} />
  if (isPublicCollectionRoute(route)) return <PublicList route={route} records={(data ?? []) as Record<string, unknown>[]} />
  if (!data) return <section className="public-page ed-page"><Back href={backHref} label={backLabel} /><NotFound /></section>
  if (route.kind === 'organization') return <OrganizationPublicDetail data={data as { organization: Record<string, unknown>; tournaments: Record<string, unknown>[]; teams: Record<string, unknown>[]; unavailable: string[] }} />
  if (route.kind === 'team') return <TeamPublicDetail data={data as { team: Record<string, unknown>; roster: Record<string, unknown>[]; tournaments: Record<string, unknown>[]; matches: Record<string, unknown>[]; opponents: Record<string, unknown>[]; standings: Record<string, unknown>[]; achievements: Record<string, unknown>[]; unavailable: string[] }} />
  if (route.kind === 'tournament' || route.kind === 'registration') return <TournamentPublicDetail autoOpenApply={route.kind === 'registration'} data={data as { tournament: Record<string, unknown>; matches: Record<string, unknown>[]; teams: Record<string, unknown>[]; registration: PublicRegistrationInfo; notices: string[] }} />
  if (route.kind === 'match') return <MatchPublicDetail record={data as Record<string, unknown>} reportRef={route.slug} />
  if (isPublicDetailRoute(route)) return <PublicDetail route={route} record={data as Record<string, unknown>} />
  return <section className="public-page ed-page"><Back /><NotFound /></section>
}


// Owner's island design: every directory opens with the photo banner. The eyebrow is kept for callers but not shown.
function PageHeading({ title, subtitle }: { title: string; subtitle: string; eyebrow?: string }) { return <PageBanner title={title} subtitle={subtitle} /> }

function hrefFor(kind: Exclude<PublicCollectionKind, 'news' | 'search'>, record: Record<string, unknown>): string {
  const slug = String(record.slug ?? record.id)
  if (kind === 'matches') return `#matches/${slug}`
  if (kind === 'archive') return `#tournament/${encodeURIComponent(slug)}`
  if (kind === 'standings' || kind === 'bracket') return `#${kind}`
  return `#${kind.slice(0, -1)}/${encodeURIComponent(slug)}`
}

function PublicList({ route, records }: { route: PublicCollectionRoute; records: Record<string, unknown>[] }) {
  const titles: Record<Exclude<PublicCollectionKind, 'news' | 'search'>, string[]> = { organizations: ['Organizations', 'Published organizations'], tournaments: ['Tournaments', 'Published competitions'], archive: ['Tournament Archive', 'Completed competitions'], teams: ['Teams', 'Published teams and representatives'], players: ['Players', 'Approved player profiles'], matches: ['Results', 'Confirmed published matches'], standings: ['Standings', 'Published standings'], bracket: ['Tournament brackets', 'Confirmed published fixture records'] }
  const title = titles[route.kind]
  return <section className="public-page ed-page"><Back /><PageHeading title={title[0]} subtitle={title[1]} />
    {!records.length ? <Empty message="No published records are available yet." /> : <ul className="ed-list ed-list-rows">{records.map(record => {
      const cardTitle = String(record.name ?? record.display_name ?? (route.kind === 'matches' ? 'Confirmed match' : 'Published record'))
      return <li key={String(record.id)}><a href={hrefFor(route.kind, record)}><Crest name={cardTitle} logoUrl={String(record.logo_url ?? record.photo_url ?? '') || null} size="sm" /><span className="ed-list-text"><strong>{cardTitle}</strong><small>{String(record.sport ?? record.team_type ?? record.island ?? record.status ?? 'Published record')}</small></span><ArrowRight size={15} /></a></li>
    })}</ul>}
  </section>
}

function MatchList({ records }: { records: Record<string, unknown>[] }) {
  const [labels, setLabels] = useState<MatchListLabels>(EMPTY_MATCH_LIST_LABELS)
  const [labelsFailed, setLabelsFailed] = useState(false)
  const [labelsReady, setLabelsReady] = useState(false)
  const [filters, setFilters] = useState<MatchListFilters>(EMPTY_MATCH_LIST_FILTERS)
  useEffect(() => {
    let active = true
    if (!records.length) { setLabels(EMPTY_MATCH_LIST_LABELS); setLabelsFailed(false); setLabelsReady(true); return }
    const client = publicSupabase
    if (!client) { setLabels(EMPTY_MATCH_LIST_LABELS); setLabelsFailed(true); setLabelsReady(true); return }
    setLabelsReady(false)
    void getPublishedMatchLabels(client, records).then(result => {
      if (!active) return
      setLabels(result.data ?? EMPTY_MATCH_LIST_LABELS)
      setLabelsFailed(Boolean(result.error))
      setLabelsReady(true)
    })
    return () => { active = false }
  }, [records])
  // Filter dimensions render only when the loaded rows really offer them: each
  // select needs at least two labelled options, and search needs at least one
  // match. Status is never offered because the public policy only admits
  // confirmed matches, so every visible row shares one status.
  const sports = matchSportOptions(records, labels)
  const tournaments = matchTournamentOptions(records, labels)
  const teams = matchTeamOptions(records, labels)
  const days = matchDayOptions(records)
  const filtered = filterPublishedMatches(records, labels, filters)
  return <section className="public-page ed-page">
    <Back />
    <PageHeading title="Results" subtitle="Confirmed published matches" eyebrow="Matches" />
    {!records.length ? <Empty message="No published matches are available yet." /> : !labelsReady ? <Loading /> : <>
      {labelsFailed ? <div className="public-home-warning">Some team and tournament names could not be loaded, so some filters and related links are hidden.</div> : null}
      <div className="ed-filterbar">
        <label className="ed-search-field"><Search size={15} aria-hidden="true" /><input aria-label="Search published matches" value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })} placeholder="Search by team, tournament, or venue" /></label>
        {sports.length > 1 ? <label>Sport<select aria-label="Filter matches by sport" value={filters.sport} onChange={event => setFilters({ ...filters, sport: event.target.value })}><option value="">All sports</option>{sports.map(value => <option value={value} key={value}>{sportName(value)}</option>)}</select></label> : null}
        {tournaments.length > 1 ? <label>Tournament<select aria-label="Filter matches by tournament" value={filters.tournamentId} onChange={event => setFilters({ ...filters, tournamentId: event.target.value })}><option value="">All tournaments</option>{tournaments.map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label> : null}
        {teams.length > 1 ? <label>Team<select aria-label="Filter matches by team" value={filters.teamId} onChange={event => setFilters({ ...filters, teamId: event.target.value })}><option value="">All teams</option>{teams.map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label> : null}
        {days.length > 1 ? <label>Date<select aria-label="Filter matches by date" value={filters.day} onChange={event => setFilters({ ...filters, day: event.target.value })}><option value="">All dates</option>{days.map(value => <option value={value} key={value}>{formatMatchDay(value)}</option>)}</select></label> : null}
      </div>
      <p className="ed-count">{filtered.length} {filtered.length === 1 ? 'match' : 'matches'}</p>
      {!filtered.length ? <Empty message="No matches match these filters." /> : <div className="ed-rows">{filtered.map(record => {
        const id = String(record.id)
        const tournament = labels.tournaments[String(record.tournament_id ?? '')]
        const home = labels.teams[String(record.home_team_id ?? '')]
        const away = labels.teams[String(record.away_team_id ?? '')]
        const homeSlug = home?.slug ?? ''
        const awaySlug = away?.slug ?? ''
        const showAway = Boolean(away) && awaySlug !== homeSlug
        const hasLinks = Boolean(tournament) || Boolean(home) || showAway
        return <div className="ed-match-block" key={id}>
          <a className="ed-match-row" href={`#matches/${encodeURIComponent(id)}`}>
            <span className="ed-match-side"><Crest name={home?.name ?? 'Team'} logoUrl={home?.logo ?? null} size="sm" /><span>{home?.name ?? 'Published team'}</span></span>
            <span className="ed-match-mid"><span className={matchStatusClass(record.status)}>{matchStatusLabel(record.status)}</span></span>
            <span className="ed-match-side ed-away"><span>{away?.name ?? 'Published team'}</span><Crest name={away?.name ?? 'Team'} logoUrl={away?.logo ?? null} size="sm" /></span>
            <span className="ed-match-meta">{formatMatchSchedule(record.scheduled_at)}{record.venue ? ` · ${String(record.venue)}` : ''}</span>
          </a>
          {hasLinks ? <div className="match-links">
            {tournament ? <a href={`#tournament/${encodeURIComponent(tournament.slug)}`}>{tournament.name}</a> : null}
            {home ? <a href={`#team/${encodeURIComponent(home.slug)}`}>{home.name}</a> : null}
            {showAway && away ? <a href={`#team/${encodeURIComponent(away.slug)}`}>{away.name}</a> : null}
          </div> : null}
        </div>
      })}</div>}
    </>}
    <p className="private-note match-policy-note">Only confirmed matches are listed. A score counts as official only after its result is confirmed, and unconfirmed scores are never shown publicly. Confirmed score data is not readable by guests under current public data policies, so scores do not appear on this page.</p>
  </section>
}

type StageFilter = '' | 'Upcoming' | 'Live' | 'Completed'
type RegistrationFilter = '' | 'open'
type TournamentSort = 'updated' | 'starting' | 'name'

function initialSportFromHash(): string {
  const query = window.location.hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get('sport') ?? ''
}

// Owner's Tournaments design (2026-11-04): photo banner, search with a Search button,
// Sport / Atoll / Island / Year selects, status chips, count and sort, a three-column
// card grid, numbered pages and the closing call to action. Only published records.
const STATUS_CHIPS: Array<{ label: string; registration: RegistrationFilter; stage: StageFilter; icon: ReactNode }> = [
  { label: 'All', registration: '', stage: '', icon: null },
  { label: 'Registration Open', registration: 'open', stage: '', icon: <Clock3 size={17} aria-hidden="true" className="tl-ico-open" /> },
  { label: 'Upcoming', registration: '', stage: 'Upcoming', icon: <CalendarDays size={17} aria-hidden="true" /> },
  { label: 'Live', registration: '', stage: 'Live', icon: <Radio size={17} aria-hidden="true" className="tl-ico-live" /> },
  { label: 'Completed', registration: '', stage: 'Completed', icon: <CheckCircle2 size={17} aria-hidden="true" className="tl-ico-done" /> },
]
const TOURNAMENT_PAGE_SIZE = 9

function TournamentList({ records, onCreateTournament }: { records: Record<string, unknown>[]; onCreateTournament?: () => void }) {
  const { platform } = useAppConfig()
  const [query, setQuery] = useState('')
  const [sport, setSport] = useState(initialSportFromHash)
  const [stage, setStage] = useState<StageFilter>('')
  const [registration, setRegistration] = useState<RegistrationFilter>('')
  const [atoll, setAtoll] = useState('')
  const [location, setLocation] = useState('')
  const [year, setYear] = useState('')
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState<TournamentSort>('updated')
  const [categories, setCategories] = useState<Map<string, string[]>>(new Map())
  const [sheetOpen, setSheetOpen] = useState(false)
  const [details, setDetails] = useState<Map<string, TournamentDirectoryDetail>>(new Map())
  // Approved team counts (public aggregate, migration 032).
  const [capacityById, setCapacityById] = useState<Map<string, Capacity>>(new Map())
  const [page, setPage] = useState(1)
  useEffect(() => {
    const client = publicSupabase
    if (!client || !records.length) return
    let active = true
    void getTournamentDirectoryDetails(client, records.map(record => String(record.id))).then(next => { if (active) setDetails(next) })
    void loadTournamentCategories(client, records.map(record => String(record.id))).then(next => { if (active) setCategories(next) })
    void loadCapacity(client, records.slice(0, 60).map(record => String(record.id))).then(next => { if (active) setCapacityById(next) })
    return () => { active = false }
  }, [records])
  useEffect(() => { setPage(1) }, [query, sport, stage, registration, atoll, location, year, category, sort])

  // Atolls come from the platform's place list (island → atoll); without it the Atoll filter is hidden.
  const atollOf = useMemo(() => new Map((platform.places?.islands ?? []).filter(island => island.atoll).map(island => [island.name.trim().toLowerCase(), String(island.atoll)])), [platform])
  const islandOf = (record: Record<string, unknown>) => details.get(String(record.id))?.island ?? ''
  const yearOf = (record: Record<string, unknown>) => { const starts = details.get(String(record.id))?.startsAt; return starts ? formatMaldivesYear(starts) : '' }
  const sports = [...new Set([...records.map(record => String(record.sport ?? '')).filter(Boolean), ...(sport ? [sport] : [])])]
  const locations = [...new Set([...details.values()].map(detail => detail.island).filter((value): value is string => Boolean(value)))].sort()
  const atolls = [...new Set(locations.map(island => atollOf.get(island.toLowerCase())).filter((value): value is string => Boolean(value)))].sort()
  const years = [...new Set(records.map(yearOf).filter(Boolean))].sort().reverse()
  const categoryOptions = [...new Set([...categories.values()].flat())].sort()

  const filtered = filterPublishedTournaments(records, query, sport, '').filter(record => {
    const label = tournamentStage(record.status).label
    if (stage === 'Completed' && !['Completed', 'Archived'].includes(label)) return false
    if (stage && stage !== 'Completed' && label !== stage) return false
    if (registration === 'open' && !registrationStage(record.status, details.get(String(record.id))?.closesAt)?.open) return false
    if (atoll && atollOf.get(islandOf(record).toLowerCase()) !== atoll) return false
    if (location && islandOf(record) !== location) return false
    if (year && yearOf(record) !== year) return false
    if (category && !(categories.get(String(record.id)) ?? []).includes(category)) return false
    return true
  })
  // Recently updated is the published order; the other sorts work on the loaded rows.
  const startOf = (record: Record<string, unknown>) => { const starts = details.get(String(record.id))?.startsAt; return starts ? Date.parse(starts) : Number.POSITIVE_INFINITY }
  const sorted = sort === 'name' ? [...filtered].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
    : sort === 'starting' ? [...filtered].sort((a, b) => startOf(a) - startOf(b)) : filtered
  const paged = pageSlice(sorted, page, TOURNAMENT_PAGE_SIZE)
  const active = [sport, atoll, location, year, category, stage, registration, query.trim()].filter(Boolean).length
  const clearAll = () => { setSport(''); setAtoll(''); setLocation(''); setYear(''); setCategory(''); setStage(''); setRegistration(''); setQuery('') }

  const filterControls = <>
    <label className="tl-select"><span className="sr-only">Sport</span><select aria-label="Filter tournaments by sport" value={sport} onChange={event => setSport(event.target.value)}><option value="">Sport</option>{sports.map(value => <option key={value} value={value}>{sportName(value)}</option>)}</select></label>
    {atolls.length ? <label className="tl-select"><span className="sr-only">Atoll</span><select aria-label="Filter tournaments by atoll" value={atoll} onChange={event => setAtoll(event.target.value)}><option value="">Atoll</option>{atolls.map(value => <option key={value} value={value}>{value}</option>)}</select></label> : null}
    {locations.length ? <label className="tl-select"><span className="sr-only">Island</span><select aria-label="Filter tournaments by island" value={location} onChange={event => setLocation(event.target.value)}><option value="">Island</option>{locations.filter(value => !atoll || atollOf.get(value.toLowerCase()) === atoll).map(value => <option key={value} value={value}>{value}</option>)}</select></label> : null}
    {years.length ? <label className="tl-select"><span className="sr-only">Year</span><select aria-label="Filter tournaments by year" value={year} onChange={event => setYear(event.target.value)}><option value="">Year</option>{years.map(value => <option key={value} value={value}>{value}</option>)}</select></label> : null}
    {categoryOptions.length ? <label className="tl-select"><span className="sr-only">Category</span><select aria-label="Filter tournaments by category" value={category} onChange={event => setCategory(event.target.value)}><option value="">Category</option>{categoryOptions.map(value => <option key={value} value={value}>{value}</option>)}</select></label> : null}
  </>
  return <section className="public-page tl-page">
    <PageBanner title="Tournaments" subtitle="Find your next competition. Follow every result." />
    <div className="tl-body">
      <form className="tl-search" role="search" onSubmit={event => { event.preventDefault(); (document.activeElement as HTMLElement | null)?.blur() }}>
        <label className="tl-search-field"><Search size={22} aria-hidden="true" /><input type="search" aria-label="Search published tournaments" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tournaments…" /></label>
        <button type="submit" className="tl-search-btn"><Search size={20} aria-hidden="true" /> Search</button>
      </form>
      <div className="tl-filters ed-hide-sm">{filterControls}<span className="tl-filters-sep" aria-hidden="true" /><button type="button" className="tl-clear" onClick={clearAll} disabled={!active}>Clear filters</button></div>
      <button type="button" className="ed-btn ed-btn-ghost ed-show-sm tl-filter-btn" onClick={() => setSheetOpen(true)}><SlidersHorizontal size={15} aria-hidden="true" /> Filters{active ? ` (${active})` : ''}</button>
      <BottomSheet open={sheetOpen} title="Filter tournaments" onClose={() => setSheetOpen(false)}><div className="ed-sheet-form">{filterControls}<button type="button" className="ed-btn ed-btn-ghost" onClick={clearAll}>Clear filters</button><button type="button" className="ed-btn ed-btn-primary" onClick={() => setSheetOpen(false)}>Show {filtered.length} result{filtered.length === 1 ? '' : 's'}</button></div></BottomSheet>
      <div className="tl-chips" role="group" aria-label="Quick status">{STATUS_CHIPS.map(chip => { const on = registration === chip.registration && stage === chip.stage; return <button type="button" key={chip.label} aria-pressed={on} className={on ? 'active' : ''} onClick={() => { setRegistration(chip.registration); setStage(chip.stage) }}>{chip.icon}{chip.label}</button> })}</div>
      <div className="tl-resultsbar">
        <p className="tl-count" aria-live="polite"><strong>{filtered.length} {filtered.length === 1 ? 'tournament' : 'tournaments'}</strong></p>
        <label className="tl-sort">Sort: <select aria-label="Sort tournaments" value={sort} onChange={event => setSort(event.target.value as TournamentSort)}><option value="updated">Recently updated</option><option value="starting">Starting soonest</option><option value="name">Name A–Z</option></select></label>
      </div>
      {!filtered.length ? <Empty message={records.length ? 'No published tournaments match these filters.' : 'No published tournaments are available yet.'} />
        : <ul className="tl-grid">{paged.items.map(record => <li key={String(record.id)}><TournamentTile record={record} detail={details.get(String(record.id))} capacity={capacityById.get(String(record.id))} full /></li>)}</ul>}
      <NumberedPager page={paged.page} pages={paged.pages} onPage={setPage} label="Tournament pages" />
    </div>
    <IslandCallToAction title="Bring your island together through sport." actionLabel="Organize a Tournament" onAction={onCreateTournament} />
  </section>
}

function formatMaldivesYear(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { timeZone: 'Indian/Maldives', year: 'numeric' })
}

// Final plan 19: completed tournaments by sport, year, island and organizer, with the
// same permanent links as the directory. Only published, completed records appear.
function ArchiveList({ records }: { records: Record<string, unknown>[] }) {
  const [filters, setFilters] = useState<ArchiveFilters>(EMPTY_ARCHIVE_FILTERS)
  const [details, setDetails] = useState<Map<string, TournamentDirectoryDetail>>(new Map())
  const [capacityById, setCapacityById] = useState<Map<string, Capacity>>(new Map())
  const archived = useMemo(() => records.filter(record => isArchivedTournament(record.status)), [records])
  useEffect(() => {
    const client = publicSupabase
    if (!client || !archived.length) return
    let active = true
    void getTournamentDirectoryDetails(client, archived.map(record => String(record.id))).then(next => { if (active) setDetails(next) })
    void loadCapacity(client, archived.slice(0, 60).map(record => String(record.id))).then(next => { if (active) setCapacityById(next) })
    return () => { active = false }
  }, [archived])
  const options = archiveOptions(archived, details)
  const filtered = archiveTournaments(archived, details, filters)
  const [page, setPage] = useState(1); const paged = pageSlice(filtered, page)
  const set = (key: keyof ArchiveFilters) => (value: string) => { setFilters(current => ({ ...current, [key]: value })); setPage(1) }
  const filtering = Object.values(filters).some(Boolean)
  return <section className="public-page ed-page">
    <Back />
    <PageHeading title="Tournament Archive" subtitle="Past competitions. Permanent sporting history." eyebrow="History" />
    <label className="ed-search-field ed-search-lg"><Search size={18} aria-hidden="true" /><input aria-label="Search past tournaments" value={filters.query} onChange={event => set('query')(event.target.value)} placeholder="Search past tournaments or organizers" /></label>
    <div className="ed-filterbar">
      {options.sports.length ? <label>Sport<select aria-label="Filter archive by sport" value={filters.sport} onChange={event => set('sport')(event.target.value)}><option value="">All sports</option>{options.sports.map(value => <option key={value} value={value}>{sportName(value)}</option>)}</select></label> : null}
      {options.years.length ? <label>Year<select aria-label="Filter archive by year" value={filters.year} onChange={event => set('year')(event.target.value)}><option value="">Any year</option>{options.years.map(value => <option key={value} value={value}>{value}</option>)}</select></label> : null}
      {options.islands.length ? <label>Island<select aria-label="Filter archive by island" value={filters.island} onChange={event => set('island')(event.target.value)}><option value="">Anywhere</option>{options.islands.map(value => <option key={value} value={value}>{value}</option>)}</select></label> : null}
      {options.organizers.length ? <label>Organizer<select aria-label="Filter archive by organizer" value={filters.organizer} onChange={event => set('organizer')(event.target.value)}><option value="">Any organizer</option>{options.organizers.map(value => <option key={value} value={value}>{value}</option>)}</select></label> : null}
      {filtering ? <button type="button" className="ed-link-btn" onClick={() => setFilters(EMPTY_ARCHIVE_FILTERS)}>Clear filters</button> : null}
    </div>
    <p className="ed-count">{filtered.length} completed {filtered.length === 1 ? 'tournament' : 'tournaments'}</p>
    {!filtered.length ? <Empty message={archived.length ? 'No completed tournaments match these filters.' : 'No completed tournaments have been published yet. A tournament joins the archive when its organizer completes it.'} />
      : <div className="ed-tgrid">{paged.items.map(record => <TournamentCard key={String(record.id)} record={record} detail={details.get(String(record.id))} capacity={capacityById.get(String(record.id))} layout="grid" />)}</div>}
    <Pager page={paged.page} pages={paged.pages} total={filtered.length} onPage={setPage} />
    <p className="pf-hint">Looking for someone who played in a past tournament? <a href="#players">Search players</a> or <a href="#teams">search teams</a>; every career keeps its full history.</p>
  </section>
}

function SearchableDirectory({ title, subtitle, eyebrow, children }: { title: string; subtitle: string; eyebrow: string; children: ReactNode }) {
  return <section className="public-page ed-page public-directory"><PageHeading title={title} subtitle={subtitle} eyebrow={eyebrow} />{children}<IslandCallToAction title={title === 'Teams' ? 'Your team. A history worth keeping.' : title === 'Players' ? 'Your sporting journey starts here.' : 'Bring island sport together.'} actionLabel={title === 'Teams' ? 'Create a team' : title === 'Players' ? 'Open Player Workspace' : 'Create an organization'} /></section>
}

function OrganizationList({ records }: { records: Record<string, unknown>[] }) {
  const [query, setQuery] = useState(''); const [location, setLocation] = useState('')
  const [locations, setLocations] = useState<Map<string, string[]>>(new Map())
  useEffect(() => {
    if (!publicSupabase || !records.length) return
    let active = true
    void loadOrganizationLocations(publicSupabase).then(next => { if (active) setLocations(next) })
    return () => { active = false }
  }, [records])
  const islands = [...new Set([...locations.values()].flat())].sort()
  const filtered = filterOrganizations(records, query, location, locations)
  const [page, setPage] = useState(1); const paged = pageSlice(filtered, page)
  return <SearchableDirectory title="Organizations" subtitle="Meet the people bringing island sport together." eyebrow="Directory">
    <label className="ed-search-field ed-search-lg"><Search size={18} aria-hidden="true" /><input aria-label="Search published organizations" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by organization name or description" /></label>
    {islands.length ? <div className="ed-filterbar"><label>Location<select aria-label="Filter organizations by location" value={location} onChange={event => setLocation(event.target.value)}><option value="">Anywhere</option>{islands.map(value => <option key={value} value={value}>{value}</option>)}</select></label>{query || location ? <button type="button" className="ed-link-btn" onClick={() => { setQuery(''); setLocation('') }}>Clear filters</button> : null}</div> : null}
    <p className="ed-count">{filtered.length} {filtered.length === 1 ? 'organization' : 'organizations'}</p>
    {!filtered.length ? <Empty message={records.length ? 'No published organizations match your search.' : 'No published organizations yet. An organization appears here once its owner publishes it from Organization Profile in the organizer workspace.'} />
       : <ul className="ic-grid">{paged.items.map(record => { const id = String(record.id); const name = String(record.name); const href = `#organization/${encodeURIComponent(String(record.slug ?? record.id))}`; const places = locations.get(id) ?? []; return <li key={id}><article className="ic-card ic-organization">
        <span className="ic-cover"><CoverScene sport="football" /></span>
        <span className="ic-org-mark" aria-hidden="true"><Building2 size={42} /></span>
        <h2 className="ic-name"><a href={href}>{name}</a></h2>
        <p className="ic-meta"><MapPin size={15} aria-hidden="true" /> {places.length ? places.join(', ') : 'Location not published'}</p>
        <p className="ic-description">{String(record.description ?? '').trim() || 'Discover this organization’s published tournaments, teams and news.'}</p>
        <div className="ic-actions"><a className="ic-primary" href={href}>View Organization <ArrowRight size={16} aria-hidden="true" /></a></div>
      </article></li> })}</ul>}
    <Pager page={paged.page} pages={paged.pages} total={filtered.length} onPage={setPage} />
  </SearchableDirectory>
}

function TeamList({ records }: { records: Record<string, unknown>[] }) {
  const [query, setQuery] = useState(''); const [teamType, setTeamType] = useState(''); const [island, setIsland] = useState(''); const [sport, setSport] = useState('')
  const [sportsByTeam, setSportsByTeam] = useState<Map<string, string[]>>(new Map())
  useEffect(() => {
    if (!publicSupabase || !records.length) return
    let active = true
    void loadTeamSports(publicSupabase, records.map(record => String(record.id))).then(next => { if (active) setSportsByTeam(next) })
    return () => { active = false }
  }, [records])
  const sports = [...new Set([...sportsByTeam.values()].flat())].sort()
  const filtered = filterPublishedTeams(records, query, teamType, island).filter(record => !sport || (sportsByTeam.get(String(record.id)) ?? []).includes(sport))
  const [page, setPage] = useState(1); const paged = pageSlice(filtered, page)
  const teamTypes = [...new Set(records.map(record => String(record.team_type ?? '')).filter(Boolean))]
  const islands = [...new Set(records.map(record => String(record.island ?? '')).filter(Boolean))]
  return <SearchableDirectory title="Teams" subtitle="Discover island teams. Follow their journey." eyebrow="Directory">
    <div className="ed-filterbar">
      <label className="ed-search-field"><Search size={15} aria-hidden="true" /><input aria-label="Search published teams" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by team name, island, or type" /></label>
      <label>Team type<select aria-label="Filter teams by type" value={teamType} onChange={event => setTeamType(event.target.value)}><option value="">All types</option>{teamTypes.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
      <label>Island<select aria-label="Filter teams by island" value={island} onChange={event => setIsland(event.target.value)}><option value="">All islands</option>{islands.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
      {sports.length ? <label>Sport<select aria-label="Filter teams by sport" value={sport} onChange={event => setSport(event.target.value)}><option value="">All sports</option>{sports.map(value => <option value={value} key={value}>{sportName(value)}</option>)}</select></label> : null}
      {query || teamType || island || sport ? <button type="button" className="ed-link-btn" onClick={() => { setQuery(''); setTeamType(''); setIsland(''); setSport('') }}>Clear filters</button> : null}
    </div>
    <p className="ed-count">{filtered.length} {filtered.length === 1 ? 'team' : 'teams'}</p>
    {!filtered.length ? <Empty message={records.length ? 'No published teams match these filters.' : 'No published teams yet. A team appears here once its manager publishes it from the Team Workspace.'} />
      : <ul className="ic-grid">{paged.items.map(record => { const id = String(record.id); const name = String(record.name); const href = `#team/${encodeURIComponent(String(record.slug ?? record.id))}`; const sports = sportsByTeam.get(id) ?? []; return <li key={id}><article className="ic-card ic-team">
        <span className="ic-cover">{record.logo_url ? <img src={String(record.logo_url)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <CoverScene sport={sports[0] ?? ''} />}</span>
        <span className="ic-crest"><TeamLogo name={name} logoUrl={String(record.logo_url ?? '') || null} size={88} /></span>
        <h2 className="ic-name"><a href={href}>{name}</a></h2>
        <p className="ic-meta"><MapPin size={15} aria-hidden="true" /> {record.island ? String(record.island) : 'Island not published'}</p>
        <p className="ic-pills">{sports.length ? sports.slice(0, 2).map(value => <span key={value} className="ic-pill"><SportGlyph sport={value} />{sportName(value)}</span>) : <span className="ic-pill">{String(record.team_type ?? 'Team')}</span>}</p>
        <div className="ic-actions"><a className="ic-primary" href={href}>View Team <ArrowRight size={16} aria-hidden="true" /></a><FollowButton type="team" id={id} name={name} /></div>
      </article></li> })}</ul>}
    <Pager page={paged.page} pages={paged.pages} total={filtered.length} onPage={setPage} />
  </SearchableDirectory>
}

type PlayerSort = 'name' | 'island' | 'verified'
function PlayerList({ records }: { records: Record<string, unknown>[] }) {
  const [query, setQuery] = useState(''); const [island, setIsland] = useState(''); const [position, setPosition] = useState(''); const [sort, setSort] = useState<PlayerSort>('name'); const [team, setTeam] = useState('')
  const [teamsByPlayer, setTeamsByPlayer] = useState<Map<string, Array<{ id: string; name: string }>>>(new Map())
  const [playerSport, setPlayerSport] = useState('')
  const [sportsByPlayer, setSportsByPlayer] = useState<Map<string, string[]>>(new Map())
  useEffect(() => {
    if (!publicSupabase || !records.length) return
    let active = true
    void loadPlayerTeams(publicSupabase, records.map(record => String(record.id))).then(next => { if (active) setTeamsByPlayer(next) })
    void loadPlayerSports(publicSupabase, records.map(record => String(record.id))).then(next => { if (active) setSportsByPlayer(next) })
    return () => { active = false }
  }, [records])
  const teamOptions = optionsFrom(teamsByPlayer)
  const positions = [...new Set(records.map(record => String(record.position ?? '').trim()).filter(Boolean))].sort()
  const filtered = filterPublishedPlayers(records, query, island).filter(record => !position || String(record.position ?? '').trim() === position).filter(record => !team || (teamsByPlayer.get(String(record.id)) ?? []).some(item => item.id === team)).filter(record => !playerSport || (sportsByPlayer.get(String(record.id)) ?? []).includes(playerSport))
    .sort((a, b) => sort === 'verified' ? Number(Boolean(b.is_claimed)) - Number(Boolean(a.is_claimed)) || String(a.display_name).localeCompare(String(b.display_name)) : sort === 'island' ? String(a.island ?? '~').localeCompare(String(b.island ?? '~')) || String(a.display_name).localeCompare(String(b.display_name)) : String(a.display_name).localeCompare(String(b.display_name)))
  const [page, setPage] = useState(1); const paged = pageSlice(filtered, page)
  const islands = [...new Set(records.map(record => String(record.island ?? '')).filter(Boolean))]
  return <SearchableDirectory title="Players" subtitle="Discover talent. Follow every career." eyebrow="Directory">
    <div className="ed-filterbar">
      <label className="ed-search-field"><Search size={15} aria-hidden="true" /><input aria-label="Search published players" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by name, island or player code" /></label>
      <label>Island<select aria-label="Filter players by island" value={island} onChange={event => setIsland(event.target.value)}><option value="">All islands</option>{islands.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
      {positions.length ? <label>Position<select aria-label="Filter players by position" value={position} onChange={event => setPosition(event.target.value)}><option value="">All positions</option>{positions.map(value => <option value={value} key={value}>{value}</option>)}</select></label> : null}
      {[...new Set([...sportsByPlayer.values()].flat())].length ? <label>Sport<select aria-label="Filter players by sport" value={playerSport} onChange={event => setPlayerSport(event.target.value)}><option value="">All sports</option>{[...new Set([...sportsByPlayer.values()].flat())].sort().map(value => <option key={value} value={value}>{sportName(value)}</option>)}</select></label> : null}
      {teamOptions.length ? <label>Team<select aria-label="Filter players by team" value={team} onChange={event => setTeam(event.target.value)}><option value="">All teams</option>{teamOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label> : null}
      <label>Sort<select aria-label="Sort players" value={sort} onChange={event => setSort(event.target.value as PlayerSort)}><option value="name">Name A–Z</option><option value="island">Island</option><option value="verified">Claimed first</option></select></label>
      {query || island || position || team || playerSport ? <button type="button" className="ed-link-btn" onClick={() => { setQuery(''); setIsland(''); setPosition(''); setTeam(''); setPlayerSport('') }}>Clear filters</button> : null}
    </div>
    <p className="ed-count">{filtered.length} {filtered.length === 1 ? 'player' : 'players'}</p>
    {!filtered.length ? <Empty message={records.length ? 'No published players match these filters.' : 'No published player profiles are available yet.'} />
      : <ul className="ic-grid">{paged.items.map(record => { const id = String(record.id); const name = String(record.display_name); const href = `#player/${encodeURIComponent(String(record.slug ?? record.id))}`; const sport = (sportsByPlayer.get(id) ?? [])[0]; const team = (teamsByPlayer.get(id) ?? [])[0]; return <li key={id}><article className="ic-card ic-player">
        <span className="ic-band" aria-hidden="true" />
        <span className="ic-avatar">{record.photo_url ? <img className="public-player-photo" src={String(record.photo_url)} alt="" loading="lazy" /> : <PersonAvatar />}</span>
        <h2 className="ic-name"><a href={href}>{name}</a></h2>
        {record.public_code ? <p className="ic-code">{String(record.public_code)}</p> : null}
        <p className="ic-meta">{[sport ? sportName(sport) : null, record.position ? String(record.position) : null].filter(Boolean).join(' · ') || (record.is_claimed ? 'Claimed profile' : 'Published player')}</p>
        <div className="ic-team-row">{team ? <TeamLogo name={team.name} logoUrl={String((team as Record<string, unknown>)?.logo_url ?? '') || null} size={40} /> : null}<span><strong>{team ? team.name : 'No current team'}</strong><small><MapPin size={13} aria-hidden="true" /> {record.island ? String(record.island) : 'Island not published'}</small></span></div>
        <div className="ic-actions"><a className="ic-primary" href={href}>View Profile <ArrowRight size={16} aria-hidden="true" /></a><FollowButton type="player" id={id} name={name} /></div>
      </article></li> })}</ul>}
    <Pager page={paged.page} pages={paged.pages} total={filtered.length} onPage={setPage} />
  </SearchableDirectory>
}

function NewsDetail({ record }: { record: Record<string, unknown> }) {
  const [related, setRelated] = useState<Record<string, unknown>[]>([])
  useEffect(() => {
    if (!publicSupabase) return
    let active = true
    // Related: same tournament first, then same category; published stories only.
    void getPublishedNews(publicSupabase).then(result => {
      if (!active) return
      const others = (result.data ?? []).filter(item => item.id !== record.id)
      const score = (item: Record<string, unknown>) => (record.tournament_id && item.tournament_id === record.tournament_id ? 2 : 0) + (item.content_type === record.content_type ? 1 : 0)
      setRelated(others.filter(item => score(item) > 0).sort((a, b) => score(b) - score(a)).slice(0, 3))
    })
    return () => { active = false }
  }, [record.id, record.tournament_id, record.content_type])
  const title = String(record.title)
  return <section className="public-page ed-page ed-article-page"><Back href="#news" label="Back to News" />
    <div className="public-article-layout"><article className="ed-article">
      <p className="ed-eyebrow">{String(record.content_type ?? 'news').replace(/_/g, ' ')}{record.published_at ? ` · ${formatDay(record.published_at)}` : ''} · {readingMinutes(String(record.body ?? ''))} min read</p>
      <h1>{String(record.title)}</h1>
      {record.excerpt ? <p className="ed-standfirst">{String(record.excerpt)}</p> : null}
      {record.cover_image_url ? <img className="ed-article-cover" src={String(record.cover_image_url)} alt="" loading="lazy" /> : null}
      <div className="ed-article-body">{String(record.body ?? '').split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
      <p className="lp-report-row px-no-print"><ShareButton title={title} /><PrintButton /><ReportButton entity="news" refId={String(record.slug ?? record.id)} label={title} /></p>
      {record.media_url ? <p><a className="ed-btn ed-btn-ghost" href={String(record.media_url)} target="_blank" rel="noopener noreferrer">Open media <ArrowRight size={14} /></a></p> : null}
    </article>
    <aside className="public-article-sidebar"><section className="ed-panel"><h2 className="ed-subhead">Island sport, in focus</h2><p>Explore the competitions, teams and careers behind the stories.</p><a className="ed-btn ed-btn-primary" href="#tournaments">Browse tournaments <ArrowRight size={16} /></a></section>{related.length ? <aside className="px-related px-no-print" aria-label="Related stories"><h2 className="ed-subhead">Related stories</h2><ul className="ed-list ed-list-rows">{related.map(item => <li key={String(item.id)}><a href={`#news/${encodeURIComponent(String(item.slug ?? item.id))}`}><span className="ed-list-text"><strong>{String(item.title)}</strong><small>{String(item.content_type ?? 'news').replace(/_/g, ' ')}{item.published_at ? ` · ${formatDay(item.published_at)}` : ''}</small></span><ArrowRight size={15} /></a></li>)}</ul></aside> : null}</aside></div>
  </section>
}

// One flat row of tabs, like a tournament site (owner, 2026-11-02): Overview, Schedule,
// Results, Standings, Bracket, Teams, Players, Statistics, News & media, Rules,
// Sponsors, Awards. Tabs with nothing to show are hidden. Old ?tab= links still work.
type TournamentTab = 'overview' | 'schedule' | 'results' | 'standings' | 'bracket' | 'teams' | 'players' | 'statistics' | 'news' | 'rules' | 'sponsors' | 'awards'
const OLD_TAB: Record<string, TournamentTab> = {
  overview: 'overview', teams: 'teams', players: 'players', matches: 'schedule', schedule: 'schedule', live: 'schedule', results: 'results',
  competition: 'standings', draw: 'standings', groups: 'standings', standings: 'standings', bracket: 'bracket', statistics: 'statistics',
  more: 'rules', registration: 'rules', rules: 'rules', sponsors: 'sponsors', news: 'news', media: 'news', awards: 'awards',
}

function TournamentPublicDetail({ data, autoOpenApply = false }: { data: { tournament: Record<string, unknown>; matches: Record<string, unknown>[]; teams: Record<string, unknown>[]; registration: PublicRegistrationInfo; notices: string[] }; autoOpenApply?: boolean }) {
  const tournament = data.tournament
  const [confirmedFeed, setConfirmedFeed] = useState<FeedMatch[]>([])
  const [allFeed, setAllFeed] = useState<FeedMatch[]>([])
  const [topScorers, setTopScorers] = useState<Array<{ slug: string; name: string; photo: string | null; team: string | null; goals: number }>>([])
  // Merge published teams from confirmed matches with teams referenced by any
  // fixture (including scheduled ones) so every squad in the tournament shows.
  const mergedTeams = (() => {
    const map = new Map<string, Record<string, unknown>>()
    for (const t of data.teams) map.set(String(t.id ?? ''), t)
    for (const m of allFeed) {
      for (const side of [m.home, m.away]) {
        if (!side.id || map.has(side.id)) continue
        map.set(side.id, { id: side.id, name: side.name ?? 'Team', slug: side.slug, logo_url: side.logo })
      }
    }
    return [...map.values()]
  })()
  const teamsById = new Map(mergedTeams.map(team => [String(team.id), team]))
  const teamOf = (id: unknown) => { const team = teamsById.get(String(id ?? '')); return { name: team ? String(team.name ?? 'Published team') : 'Published team', logo: team ? String(team.logo_url ?? '') || null : null } }
  // Defensive defaults: a stale transform or a loader gap must never blank the
  // whole public page - showing the honest "not public yet" state instead.
  const registration = data.registration ?? PUBLIC_REGISTRATION_EMPTY
  const notices = data.notices ?? []
  const [showApply, setShowApply] = useState(autoOpenApply)
  // #tournament/<slug>?tab=results|standings|bracket opens that section directly.
  const requestedTab = OLD_TAB[new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tab') ?? ''] ?? null
  const [tab, setTab] = useState<TournamentTab>(() => autoOpenApply ? 'rules' : requestedTab ?? 'overview')
  // A live match, for the Watch Live action and the live ticker (published fixtures only).
  const [liveMatch, setLiveMatch] = useState<FeedMatch | null>(null)
  const [detail, setDetail] = useState<TournamentDirectoryDetail | null>(null)
  const [news, setNews] = useState<Record<string, unknown>[]>([])
  // Public sponsors (migration 036): public fields only, through get_public_tournament_sponsors.
  const [sponsors, setSponsors] = useState<PublicSponsor[]>([])
  // Places come as counts only (get_public_registration_capacity, migration 032).
  const [capacity, setCapacity] = useState<Capacity | null>(null)
  const [hasSession, setHasSession] = useState(false)
  const tournamentId = String(tournament.id ?? '')
  useEffect(() => {
    const client = publicSupabase
    if (!client || !tournamentId) return
    void client.auth.getSession().then(({ data }) => setHasSession(Boolean(data.session)))
    let active = true
    void getTournamentDirectoryDetails(client, [tournamentId]).then(next => { if (active) setDetail(next.get(tournamentId) ?? null) })
    void getPublishedNews(client).then(result => { if (active) setNews((result.data ?? []).filter(item => String(item.tournament_id ?? '') === tournamentId)) })
    void loadPublicSponsors(client, tournamentId).then(result => { if (active) setSponsors(result.data) })
    void loadCapacity(client, [tournamentId]).then(map => { if (active) setCapacity(map.get(tournamentId) ?? null) })
    void loadMatchFeed(client, { tournamentId, statuses: ['live'], limit: 1 }).then(result => { if (active) setLiveMatch(result.data[0] ?? null) })
    void loadMatchFeed(client, { tournamentId, statuses: ['confirmed'], limit: 200 }).then(result => { if (active) setConfirmedFeed(result.data ?? []) })
    void loadMatchFeed(client, { tournamentId, limit: 200 }).then(result => { if (active) setAllFeed(result.data ?? []) })
    void Promise.all([loadTournamentPlayerStats(client, tournamentId), loadTournamentPlayers(client, tournamentId)]).then(([stats, players]) => {
      if (!active) return
      const photoBySlug = new Map((players.data ?? []).map(p => [p.slug, p.photo]))
      const ranked = (stats.data ?? []).filter(s => s.goals > 0).sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name)).slice(0, 3)
      setTopScorers(ranked.map(s => ({ slug: s.slug, name: s.name, photo: photoBySlug.get(s.slug) ?? null, team: s.team, goals: s.goals })))
    })
    return () => { active = false }
  }, [tournamentId])
  const tournamentName = String(tournament.name ?? 'Published tournament')
  const branding = publicTournamentBranding(tournament)
  const stage = tournamentStage(tournament.status)
  const buttonState = registrationButtonState(registration, String(tournament.status ?? ''))
  const places = placesState(capacity)
  const registrationLive = registration.state === 'open' && buttonState.enabled
  const hasRules = Boolean(registration.entryRequirements || registration.changeRules || registration.rosterMin)
  const finished = isArchivedTournament(tournament.status)
  const tabs: Array<{ id: TournamentTab; label: string; count?: number }> = ([
    { id: 'overview', label: 'Overview' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'results', label: 'Results' },
    { id: 'standings', label: 'Standings' },
    { id: 'teams', label: 'Teams', count: mergedTeams.length },
    { id: 'bracket', label: 'Bracket' },
    { id: 'players', label: 'Players' },
    { id: 'statistics', label: 'Statistics' },
    news.length > 0 || tab === 'news' ? { id: 'news', label: 'News & media', count: news.length } : null,
    { id: 'rules', label: 'Rules' },
    sponsors.length > 0 || tab === 'sponsors' ? { id: 'sponsors', label: 'Sponsors' } : null,
    finished || tab === 'awards' ? { id: 'awards', label: 'Awards' } : null,
  ] as Array<{ id: TournamentTab; label: string; count?: number } | null>).filter((item): item is { id: TournamentTab; label: string; count?: number } => Boolean(item))
  const openRegistration = () => { setTab('rules'); if (buttonState.enabled) { setShowApply(true); window.location.hash = `#register/${encodeURIComponent(String(tournament.slug ?? tournament.id))}` } }
  const latest = data.matches[0]
  const liveMatchId = liveMatch?.id ?? null
  const nextMatch = allFeed
    .filter(m => m.status === 'scheduled' && m.scheduledAt)
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))[0] ?? null
  const standingsRows = (() => {
    const table = new Map<string, { name: string; logo: string | null; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number }>()
    const seed = (id: string | null, name: string | null, logo: string | null) => {
      if (!id || table.has(id)) return
      table.set(id, { name: name ?? 'Team', logo, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 })
    }
    for (const t of data.teams) seed(String(t.id ?? ''), String(t.name ?? 'Team'), String(t.logo_url ?? '') || null)
    for (const m of allFeed) { seed(m.home.id, m.home.name, m.home.logo); seed(m.away.id, m.away.name, m.away.logo) }
    for (const m of confirmedFeed) {
      if (m.homeScore === null || m.awayScore === null) continue
      const home = table.get(m.home.id ?? '') ?? { name: m.home.name ?? 'Team', logo: m.home.logo, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }
      const away = table.get(m.away.id ?? '') ?? { name: m.away.name ?? 'Team', logo: m.away.logo, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }
      home.p += 1; away.p += 1
      home.gf += m.homeScore; home.ga += m.awayScore
      away.gf += m.awayScore; away.ga += m.homeScore
      if (m.homeScore > m.awayScore) { home.w += 1; home.pts += 3; away.l += 1 }
      else if (m.homeScore < m.awayScore) { away.w += 1; away.pts += 3; home.l += 1 }
      else { home.d += 1; away.d += 1; home.pts += 1; away.pts += 1 }
      table.set(m.home.id ?? '', home); table.set(m.away.id ?? '', away)
    }
    return [...table.entries()].sort((a, b) => b[1].pts - a[1].pts || (b[1].gf - b[1].ga) - (a[1].gf - a[1].ga) || b[1].gf - a[1].gf)
  })()

  if (autoOpenApply) return <PublicRegistrationLayout tournament={tournament} registration={registration}><PublicApplicationForm tournamentId={tournamentId} tournamentSlug={String(tournament.slug ?? tournament.id)} registrationState={registration.state} /></PublicRegistrationLayout>

  return <section className="public-page ed-detail">
    <div className="ed-cover">
      <TournamentCover client={publicSupabase} path={branding.coverPath} name={tournamentName} sport={String(tournament.sport ?? '')} />
      <span className="ed-cover-shade" aria-hidden="true" />
      <div className="ed-cover-inner">
        <Back href="#tournaments" label="All tournaments" />
        <div className="ed-identity">
          <TournamentLogo client={publicSupabase} path={branding.logoPath} name={tournamentName} className="ed-identity-logo" />
          <div>
            <p className="ed-eyebrow light">{sportName(tournament.sport)}{detail?.organizerName ? ` · ${detail.organizerName}` : ''}</p>
            <h1>{tournamentName}</h1>
            <p className="ed-identity-meta">{detail?.island ? <><MapPin size={14} /> {detail.island}</> : null}{detail?.startsAt ? <><CalendarDays size={14} /> From {formatDay(detail.startsAt)}</> : null}</p>
            {isArchivedTournament(tournament.status) ? <p className="pd-archive-banner" role="note"><Trophy size={14} aria-hidden="true" /> Completed historical record · <a href="#archive">Tournament Archive</a></p> : null}
            <div className="ed-hero-chips"><Chip tone={stage.tone}>{stage.label}</Chip><Chip tone={registration.state === 'open' ? 'open' : 'plain'}>{PUBLIC_REGISTRATION_STATE_LABELS[registration.state]}</Chip></div>
          </div>
        </div>
        <div className="ed-identity-actions">{/* Report sits beside the registration action. */}<FollowButton type="tournament" id={tournamentId} name={tournamentName} /><ReportButton entity="tournament" refId={String(tournament.slug ?? tournament.id)} label={tournamentName} />
          {buttonState.enabled ? <button type="button" className="ed-btn ed-btn-primary ed-btn-lg" onClick={openRegistration}>{buttonState.label}</button>
            : liveMatchId ? <a className="ed-btn ed-btn-live ed-btn-lg" href={`#matches/${encodeURIComponent(liveMatchId)}`}>Watch Live</a>
              : data.matches.length ? <button type="button" className="ed-btn ed-btn-primary ed-btn-lg" onClick={() => setTab('results')}>View Results</button>
                : registration.state === 'closed' ? <button type="button" className="ed-btn ed-btn-ghost ed-btn-lg" disabled>Registration Closed</button> : null}
          <ShareButton title={tournamentName} />
        </div>
      </div>
    </div>

    <TabStrip tabs={tabs} active={tab} onChange={setTab} label="Tournament sections" sticky />

    <div className="ed-detail-body">
      {notices.length > 0 ? <div className="public-home-warning">Some tournament details are not publicly available yet: {notices.join(', ')}.</div> : null}
      {tournament.status === 'cancelled' ? <div className="px-banner" role="alert"><strong>This tournament has been cancelled.</strong> Results and history already recorded stay available.</div> : null}
      <div className="px-actions"><FixturesCalendar name={tournamentName} tournamentId={tournamentId} />{tournament.updated_at ? <small className="px-updated">Last updated {formatDay(tournament.updated_at)}</small> : null}</div>

      {tab === 'overview' && <div className="ed-overview">
        {hasSession ? <div className="ed-organizer-quickbar" role="toolbar" aria-label="Organizer quick actions"><span className="ed-eyebrow">Organizer tools</span><a className="ed-btn ed-btn-ghost ed-btn-sm" href={`#workspace`}>Open workspace</a><a className="ed-btn ed-btn-ghost ed-btn-sm" href={`#workspace`}>Update scores</a><a className="ed-btn ed-btn-ghost ed-btn-sm" href={`#workspace`}>Manage teams</a></div> : null}
        {nextMatch && !liveMatch ? <section className="ed-panel">
          <p className="ed-eyebrow">NEXT MATCH</p>
          <a className="ed-match-row ed-match-row-lg" href={`#matches/${encodeURIComponent(nextMatch.id)}`}>
            <span className="ed-match-side"><Crest name={nextMatch.home.name ?? 'Team'} logoUrl={nextMatch.home.logo} /><span>{nextMatch.home.name ?? 'Team'}</span></span>
            <span className="ed-match-mid"><Chip tone="plain">vs</Chip></span>
            <span className="ed-match-side ed-away"><span>{nextMatch.away.name ?? 'Team'}</span><Crest name={nextMatch.away.name ?? 'Team'} logoUrl={nextMatch.away.logo} /></span>
            <span className="ed-match-meta">{formatMatchSchedule(nextMatch.scheduledAt)}{nextMatch.venue ? ` · ${nextMatch.venue}` : ''}</span>
          </a>
        </section> : null}
        {topScorers.length ? <section className="ed-panel">
          <p className="ed-eyebrow">TOP SCORERS</p>
          <div className="ed-topscorer-grid">
            {topScorers.map((p, i) => <a key={p.slug} className="ed-topscorer-card" href={`#player/${encodeURIComponent(p.slug)}`}>
              <span className="ed-topscorer-rank">{i + 1}</span>
              <span className="ed-topscorer-photo">{p.photo ? <img src={p.photo} alt={p.name} loading="lazy" /> : <span>{p.name.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()}</span>}</span>
              <strong>{p.name}</strong>
              <small>{p.team ?? 'Team'} · {p.goals} goal{p.goals === 1 ? '' : 's'}</small>
            </a>)}
          </div>
        </section> : null}
        {liveMatch ? <section className="ed-panel ed-panel-live">
          <p className="ed-eyebrow"><span className="ed-live-dot" aria-hidden="true" /> LIVE NOW</p>
          <a className="ed-match-row ed-match-row-lg" href={`#matches/${encodeURIComponent(liveMatch.id)}`}>
            <span className="ed-match-side"><Crest name={liveMatch.home.name ?? 'Team'} logoUrl={liveMatch.home.logo} /><span>{liveMatch.home.name ?? 'Team'}</span></span>
            <span className="ed-match-mid"><strong className="pt-score">{liveMatch.homeScore !== null && liveMatch.awayScore !== null ? `${liveMatch.homeScore} – ${liveMatch.awayScore}` : 'In progress'}</strong><Chip tone="live">Live</Chip></span>
            <span className="ed-match-side ed-away"><span>{liveMatch.away.name ?? 'Team'}</span><Crest name={liveMatch.away.name ?? 'Team'} logoUrl={liveMatch.away.logo} /></span>
            <span className="ed-match-meta">{liveMatch.venue ? `${liveMatch.venue} · ` : ''}{formatMatchSchedule(liveMatch.scheduledAt)}</span>
          </a>
        </section> : null}
        <section className="ed-panel ed-panel-feature">
          <p className="ed-eyebrow">{latest ? 'Latest confirmed result' : 'Next up'}</p>
          {latest ? <a className="ed-match-row ed-match-row-lg" href={`#matches/${encodeURIComponent(String(latest.id))}`}>
            <span className="ed-match-side"><Crest name={teamOf(latest.home_team_id).name} logoUrl={teamOf(latest.home_team_id).logo} /><span>{teamOf(latest.home_team_id).name}</span></span>
            <span className="ed-match-mid"><Chip tone={resultState(latest.status).tone}>{resultState(latest.status).label}</Chip></span>
            <span className="ed-match-side ed-away"><span>{teamOf(latest.away_team_id).name}</span><Crest name={teamOf(latest.away_team_id).name} logoUrl={teamOf(latest.away_team_id).logo} /></span>
            <span className="ed-match-meta">{formatMatchSchedule(latest.scheduled_at)}{latest.venue ? ` · ${String(latest.venue)}` : ''}</span>
          </a> : <EdEmpty>Upcoming fixtures become public once their results are confirmed. {registration.state === 'open' ? 'Registration is open now.' : ''}</EdEmpty>}
        </section>
        {tournament.description ? <section className="ed-panel"><p className="ed-standfirst">{String(tournament.description)}</p></section> : null}
        <section className="ed-panel">
          <h2 className="ed-subhead">Standings</h2>
          {standingsRows.length ? <div className="ed-table-wrap" tabIndex={0} role="region" aria-label="Standings"><table className="ed-table"><thead><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col">P</th><th scope="col">W</th><th scope="col">D</th><th scope="col">L</th><th scope="col">GF</th><th scope="col">GA</th><th scope="col">GD</th><th scope="col">Pts</th></tr></thead><tbody>{standingsRows.map(([id, r], i) => <tr key={id}><td>{i + 1}</td><td><span className="ed-cell-team"><Crest name={r.name} logoUrl={r.logo} size="sm" />{r.name}</span></td><td>{r.p}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td><td>{r.gf}</td><td>{r.ga}</td><td>{r.gf - r.ga > 0 ? `+${r.gf - r.ga}` : r.gf - r.ga}</td><td><b>{r.pts}</b></td></tr>)}</tbody></table></div> : <p className="pf-hint">No confirmed results yet. Standings appear once a result is confirmed.</p>}
        </section>
      </div>}

      {tab === 'rules' && <section className="ed-panel public-registration" aria-labelledby="more-registration">
        <h2 className="ed-subhead" id="more-registration">Registration</h2>
        <p><span className={`status-pill ${REGISTRATION_PILL_CLASS[registration.state]}`}>{PUBLIC_REGISTRATION_STATE_LABELS[registration.state]}</span></p>
        {places.kind === 'open' ? <p>{places.remaining} of {places.total} places left. A place is taken when the organizer approves an application.</p> : null}
        {places.kind === 'full' ? <div className="public-home-warning" role="status"><strong>All {places.total} places are filled.</strong> {registrationLive ? 'You can still apply: the organizer can put your application on the waitlist and approve it if a place becomes free. Your team workspace shows the status.' : 'No more teams can be approved for this tournament.'}</div> : null}
        {(registration.state === 'open' || registration.state === 'scheduled' || registration.state === 'closed') && (registration.opensAt || registration.closesAt)
          ? <p>{registration.opensAt ? <>Opens {formatMaldivesDateTime(registration.opensAt)}. </> : null}{registration.closesAt ? <>Closes {formatMaldivesDateTime(registration.closesAt)}, Maldives time (UTC+5).</> : null}</p>
          : null}
        {registration.categories.length > 1 ? <p>Categories: {registration.categories.map(category => `${category.name}${category.team_limit ? ` (max ${category.team_limit} teams)` : ''}`).join(', ')}</p> : null}
        {registration.entryRequirements ? <p>Requirements: {registration.entryRequirements}</p> : null}
        {registration.documentsRequired ? <p>Supporting identity documents are required and are stored privately, visible only to the tournament organizers.</p> : null}
        {registration.rosterDeadline && registration.rosterMin ? <p>Rosters: {registration.rosterMin}{registration.rosterMax ? `–${registration.rosterMax}` : ''} players, due {formatMaldivesDate(registration.rosterDeadline)}.</p> : null}
        {registration.questions.length ? <div className="public-questions"><strong>Registration form</strong><ul>{registration.questions.map(question => <li key={question.key}>{question.label}{question.required ? ' *' : ''}{question.instructions ? <small>{question.instructions}</small> : null}</li>)}</ul></div> : null}
        {registration.contactInstructions ? <p>Contact: {registration.contactInstructions}</p> : null}
        {showApply
          ? <PublicApplicationForm tournamentId={String(data.tournament.id ?? '')} tournamentSlug={String(data.tournament.slug ?? data.tournament.id ?? '')} registrationState={registration.state} />
          : <div className="button-row">
            <button type="button" className="ed-btn ed-btn-primary" disabled={!buttonState.enabled} onClick={() => buttonState.enabled && setShowApply(true)}>{buttonState.label}</button>
            {buttonState.reason ? <small>{buttonState.reason}</small> : null}
          </div>}
        {registration.state === 'unknown' ? <p><small>{registration.unavailable[0] ?? ''}</small></p> : null}
        {registration.state === 'scheduled' ? <p><small>The Apply button appears automatically when registration opens.</small></p> : null}
      </section>}

      {tab === 'teams' && (mergedTeams.length ? <div className="ed-team-grid">{mergedTeams.map(team => <a className="ed-team" href={`#team/${encodeURIComponent(String(team.slug ?? team.id))}`} key={String(team.id)}><Crest name={String(team.name)} logoUrl={String(team.logo_url ?? '') || null} size="lg" /><strong>{String(team.name)}</strong><small>{[team.team_type, team.island].filter(Boolean).map(String).join(' · ')}</small></a>)}</div> : <Empty message="No published teams are linked to this tournament yet." />)}

      {tab === 'standings' && <><TournamentDraw tournamentId={tournamentId} /><h2 className="ed-subhead">Standings</h2><StandingsDirectory tournamentId={tournamentId} embedded /></>}
      {tab === 'bracket' && <BracketDirectory tournamentId={tournamentId} embedded />}
      {tab === 'schedule' && <>{liveMatch ? <TournamentLive tournamentId={tournamentId} /> : null}<TournamentSchedule tournamentId={tournamentId} /></>}
      {tab === 'results' && <TournamentResults tournamentId={tournamentId} tournamentName={tournamentName} />}
      {tab === 'players' && <TournamentPlayersTab tournamentId={tournamentId} />}
      {tab === 'statistics' && <TournamentStatsTab tournamentId={tournamentId} tournamentName={tournamentName} />}
      {tab === 'awards' && <>{finished && <section className="ed-panel pt-archive"><h2 className="ed-subhead">Final archive</h2><ArchiveStamp tournamentId={tournamentId} /><p>This tournament is finished. Its results, standings, bracket, player statistics and awards are the permanent record, built from confirmed results only. A later correction keeps the earlier version.</p><div className="button-row"><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setTab('results')}>Results</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setTab('standings')}>Final standings</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setTab('statistics')}>Player rankings</button></div></section>}<TournamentAwardsTab tournamentId={tournamentId} /></>}
      {tab === 'sponsors' && sponsors.length === 0 && <Empty message="No sponsors are listed for this tournament." />}
      {tab === 'sponsors' && sponsors.length > 0 && <div className="ed-sponsor-grid">{sponsors.map((sponsor, index) => <article className="ed-panel ed-sponsor" key={`${sponsor.sponsor_name}-${index}`}>
        {sponsor.logo_path && publicSupabase ? <img src={sponsorLogoUrl(publicSupabase, sponsor.logo_path)} alt={`${sponsor.sponsor_name} logo`} loading="lazy" width={96} height={96} /> : <span className="ed-sponsor-mark" aria-hidden="true">{sponsor.sponsor_name.slice(0, 2).toUpperCase()}</span>}
        <p className="ed-eyebrow">{sponsor.sponsor_level}</p><h3>{sponsor.sponsor_name}</h3>{sponsor.description ? <p>{sponsor.description}</p> : null}
        {sponsor.website ? <a className="ed-link" href={sponsor.website} target="_blank" rel="noopener noreferrer nofollow">Visit website</a> : null}
      </article>)}</div>}

      {tab === 'news' && news.length === 0 && <Empty message="No news has been published for this tournament yet." />}
      {tab === 'news' && news.length > 0 && <div className="ed-news">{news.map((item, index) => <a key={String(item.id)} className={`ed-news-item${index === 0 ? ' lead' : ''}`} href={`#news/${encodeURIComponent(String(item.slug ?? item.id))}`}><small>{formatDay(item.published_at)}</small><strong>{String(item.title)}</strong>{item.excerpt ? <span>{String(item.excerpt)}</span> : null}</a>)}</div>}
      {tab === 'rules' && hasRules && <section className="ed-panel">
        {registration.entryRequirements ? <><h2 className="ed-subhead">Entry requirements</h2><p>{registration.entryRequirements}</p></> : null}
        {registration.rosterMin ? <><h2 className="ed-subhead">Rosters</h2><p>{registration.rosterMin}{registration.rosterMax ? `–${registration.rosterMax}` : ''} players per team{registration.rosterDeadline ? `, due ${formatMaldivesDate(registration.rosterDeadline)}` : ''}.</p></> : null}
        {registration.changeRules ? <><h2 className="ed-subhead">Roster changes</h2><p>{registration.changeRules}</p></> : null}
      </section>}
    </div>
  </section>
}

const REGISTRATION_PILL_CLASS: Record<PublicRegistrationInfo['state'], string> = {
  preparing: 'status-neutral', scheduled: 'status-neutral', open: 'status-ok', closed: 'status-neutral', disabled: 'status-neutral', unknown: 'status-neutral',
}

function OrganizationPublicDetail({ data }: { data: { organization: Record<string, unknown>; tournaments: Record<string, unknown>[]; teams: Record<string, unknown>[]; unavailable: string[] } }) {
  const organization = data.organization
  const name = String(organization.name)
  const [tab, setTab] = useState<OrganizationTab>(() => initialTab(ORGANIZATION_TABS.map(item => item.id), 'overview'))
  return <section className="public-page ed-detail">
    <div className="ed-cover ed-cover-plain"><span className="ed-cover-shade" aria-hidden="true" /><div className="ed-cover-inner">
      <Back href="#organizations" label="Back to Organizations" />
      <div className="ed-identity"><Crest name={name} size="xl" /><div><p className="ed-eyebrow light">Organization</p><h1>{name}</h1>{organization.description ? <p className="ed-identity-meta">{String(organization.description)}</p> : null}</div></div>
      <div className="ed-identity-actions"><FollowButton type="organization" id={String(organization.id)} name={name} /><ShareButton title={name} /><ReportButton entity="organization" refId={String(organization.slug ?? organization.id)} label={name} /></div>
    </div></div>
    <TabStrip tabs={ORGANIZATION_TABS.map(item => item.id === 'tournaments' ? { ...item, count: data.tournaments.length } : item)} active={tab} onChange={setTab} label="Organization sections" sticky />
    <div className="ed-detail-body">
      {data.unavailable.length > 0 && <div className="public-home-warning">Some organization relationships are not publicly available yet: {data.unavailable.join(', ')}.</div>}
      {tab === 'overview' && <>
        {organization.description ? <p className="ed-standfirst">{String(organization.description)}</p> : <p className="ed-standfirst">This organization has not published a description yet.</p>}
        <OrganizationSections organizationId={String(organization.id)} tournaments={data.tournaments} part="sponsors" />
      </>}
      {tab === 'tournaments' && <>
        <h2 className="ed-subhead">Tournaments</h2>
        {data.tournaments.length ? <div className="ed-tgrid">{data.tournaments.map(record => <TournamentCard key={String(record.id)} record={record} />)}</div> : <Empty message="No published tournaments belong to this organization yet." />}
      </>}
      {tab === 'teams' && <OrganizationSections organizationId={String(organization.id)} tournaments={data.tournaments} part="teams" />}
      {tab === 'news' && <OrganizationSections organizationId={String(organization.id)} tournaments={data.tournaments} part="news" />}
      <p className="private-note">Private memberships, staff assignments, finance, documents, contact details, and workspace controls are not shown on public pages.</p>
    </div>
  </section>
}

// Detail pages open the tab named in ?tab= when it exists (final specification, pages 9, 11, 12).
function initialTab<T extends string>(ids: readonly T[], fallback: T): T {
  const requested = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tab') ?? ''
  return (ids as readonly string[]).includes(requested) ? requested as T : fallback
}
const TEAM_TABS = [{ id: 'overview', label: 'Overview' }, { id: 'players', label: 'Players' }, { id: 'matches', label: 'Matches' }, { id: 'history', label: 'History' }] as const
const PLAYER_TABS = [{ id: 'overview', label: 'Overview' }, { id: 'card', label: 'Digital Card' }, { id: 'career', label: 'Career' }, { id: 'history', label: 'History' }] as const
const ORGANIZATION_TABS = [{ id: 'overview', label: 'Overview' }, { id: 'tournaments', label: 'Tournaments' }, { id: 'teams', label: 'Teams' }, { id: 'news', label: 'News' }] as const
type TeamTab = typeof TEAM_TABS[number]['id']
type PlayerTab = typeof PLAYER_TABS[number]['id']
type OrganizationTab = typeof ORGANIZATION_TABS[number]['id']

function isTrophy(item: Record<string, unknown>): boolean { return String(item.milestone_type ?? '').startsWith('award_') }

function TeamPublicDetail({ data }: { data: { team: Record<string, unknown>; roster: Record<string, unknown>[]; tournaments: Record<string, unknown>[]; matches: Record<string, unknown>[]; opponents: Record<string, unknown>[]; standings: Record<string, unknown>[]; achievements: Record<string, unknown>[]; unavailable: string[] } }) {
  const team = data.team
  const name = String(team.name)
  const logo = String(team.logo_url ?? '') || null
  const opponentNames = new Map(data.opponents.map(opponent => [String(opponent.id), String(opponent.name)]))
  const teamName = (id: unknown) => String(id ?? '') === String(team.id) ? name : opponentNames.get(String(id ?? '')) ?? 'Published team'
  const totals = data.standings.reduce<{ played: number; wins: number; draws: number; losses: number; scored: number; conceded: number }>((sum, row) => ({ played: sum.played + Number(row.played ?? 0), wins: sum.wins + Number(row.wins ?? 0), draws: sum.draws + Number(row.draws ?? 0), losses: sum.losses + Number(row.losses ?? 0), scored: sum.scored + Number(row.scored ?? 0), conceded: sum.conceded + Number(row.conceded ?? 0) }), { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 })
  const trophies = data.achievements.filter(isTrophy)
  const milestones = data.achievements.filter(item => !isTrophy(item))
  const latest = data.matches[0]
  const [tab, setTab] = useState<TeamTab>(() => initialTab(TEAM_TABS.map(item => item.id), 'overview'))
  const [management, setManagement] = useState<TeamManagement>(null)
  useEffect(() => { if (!publicSupabase) return; let active = true; void loadTeamManagement(publicSupabase, String(team.id)).then(value => { if (active) setManagement(value) }); return () => { active = false } }, [team.id])
  const managedBy = teamManagementLabel(management)
  return <section className="public-page ed-detail">
    <div className="ed-cover ed-cover-plain"><span className="ed-cover-shade" aria-hidden="true" /><div className="ed-cover-inner">
      <Back href="#teams" label="Back to Teams" />
      <div className="ed-identity"><Crest name={name} logoUrl={logo} size="xl" /><div><p className="ed-eyebrow light">{String(team.team_type ?? 'Team')}</p><h1>{name}</h1><p className="ed-identity-meta">{team.island ? <><MapPin size={14} /> {String(team.island)}</> : null}{trophies.length ? <><Trophy size={14} /> {trophies.length} trophies</> : null}{managedBy ? <span className="pd-manage-label"><ShieldCheck size={14} aria-hidden="true" /> {managedBy}</span> : null}</p></div></div>
      <div className="ed-identity-actions"><FollowButton type="team" id={String(team.id)} name={name} /><ShareButton title={name} /><ReportButton entity="team" refId={String(team.slug ?? team.id)} label={name} /></div>
    </div></div>
    <TabStrip tabs={TEAM_TABS.map(item => item.id === 'players' ? { ...item, count: data.roster.length } : item)} active={tab} onChange={setTab} label="Team sections" sticky />
    <div className="ed-detail-body">
      {data.unavailable.length > 0 && <div className="public-home-warning">Some team information is not publicly available yet: {data.unavailable.join(', ')}.</div>}
      {tab === 'overview' && <>
      {team.description ? <p className="ed-standfirst">{String(team.description)}</p> : null}
      <div className="ed-overview">
        <section className="ed-panel ed-panel-feature">
          <p className="ed-eyebrow">Latest confirmed match</p>
          {latest ? <a className="ed-match-row ed-match-row-lg" href={`#matches/${String(latest.id)}`}><span className="ed-match-side"><span>{teamName(latest.home_team_id)}</span></span><span className="ed-match-mid"><Chip tone="official">Official</Chip></span><span className="ed-match-side ed-away"><span>{teamName(latest.away_team_id)}</span></span><span className="ed-match-meta">{formatMatchSchedule(latest.scheduled_at)}</span></a>
            : <EdEmpty>No confirmed published matches yet. Upcoming fixtures appear once results are confirmed.</EdEmpty>}
        </section>
        <section className="ed-panel">
          <h2 className="ed-subhead">Statistics</h2>
          {totals.played ? <div className="ed-stat-row"><div><b>{totals.played}</b><small>Played</small></div><div><b>{totals.wins}</b><small>Won</small></div><div><b>{totals.draws}</b><small>Drawn</small></div><div><b>{totals.losses}</b><small>Lost</small></div><div><b>{totals.scored - totals.conceded > 0 ? `+${totals.scored - totals.conceded}` : totals.scored - totals.conceded}</b><small>Difference</small></div></div>
            : <EdEmpty>Statistics appear once confirmed results are in published standings.</EdEmpty>}
        </section>
      </div>
      </>}

      {tab === 'players' && <>
      <h2 className="ed-subhead">Squad</h2>
      {data.roster.length ? <ul className="ed-list ed-list-rows ed-list-cols">{data.roster.map(row => { const player = row.player_profiles as Record<string, unknown> | null; const playerName = String(player?.display_name ?? 'Published player'); return <li key={String(row.id)}><a href={`#player/${encodeURIComponent(String(player?.slug ?? row.player_id))}`}><span className="ed-avatar">{player?.photo_url ? <img src={String(player.photo_url)} alt="" loading="lazy" /> : monogram(playerName)}</span><span className="ed-list-text"><strong>{playerName}</strong><small>{String(row.status) !== 'active' ? String(row.status) : 'Current squad'}</small></span></a></li> })}</ul> : <Empty message="No published roster players are available for this team yet." />}

      </>}

      {tab === 'matches' && <>
      <h2 className="ed-subhead">Upcoming</h2>
      <div className="px-actions"><FixturesCalendar name={name} teamId={String(team.id)} /></div>
      <h2 className="ed-subhead">Results</h2>
      {data.matches.length ? <div className="ed-rows">{data.matches.map(match => <a key={String(match.id)} className="ed-match-row" href={`#matches/${String(match.id)}`}><span className="ed-match-side"><span>{teamName(match.home_team_id)}</span></span><span className="ed-match-mid"><Chip tone={resultState(match.status).tone}>{resultState(match.status).label}</Chip></span><span className="ed-match-side ed-away"><span>{teamName(match.away_team_id)}</span></span><span className="ed-match-meta">{formatMatchSchedule(match.scheduled_at)}</span></a>)}</div> : <Empty message="No confirmed published matches are available for this team yet." />}

      </>}

      {tab === 'history' && <>
      <h2 className="ed-subhead">History</h2>
      {data.tournaments.length ? <div className="ed-tgrid">{data.tournaments.map(record => <TournamentCard key={String(record.id)} record={record} layout="list" />)}</div> : <Empty message="No published tournaments are available for this team yet." />}
      {data.standings.length ? <div className="ed-table-wrap"><table className="ed-table"><thead><tr><th>P</th><th>W</th><th>D</th><th>L</th><th>For</th><th>Against</th><th>Pts</th></tr></thead><tbody>{data.standings.map((record, index) => <tr key={`${String(record.stage_id)}-${index}`}><td>{String(record.played ?? 0)}</td><td>{String(record.wins ?? 0)}</td><td>{String(record.draws ?? 0)}</td><td>{String(record.losses ?? 0)}</td><td>{String(record.scored ?? 0)}</td><td>{String(record.conceded ?? 0)}</td><td><b>{String(record.points ?? 0)}</b></td></tr>)}</tbody></table></div> : null}

      <h2 className="ed-subhead">Trophies and milestones</h2>
      {trophies.length || milestones.length ? <Honours items={[...trophies, ...milestones]} /> : <Empty message="No published achievements are available for this team yet." />}
      </>}

      <p className="private-note">Private contact information, payments, internal notes, documents, manager controls, and workspace actions are not shown on public pages.</p>
    </div>
  </section>
}

function PublicDetail({ route, record }: { route: PublicDetailRoute; record: Record<string, unknown> }) {
  const title = String(record.name ?? record.display_name ?? 'Published record')
  const isPlayer = route.kind === 'player' || route.kind === 'history'
  const photo = typeof record.photo_url === 'string' && record.photo_url ? record.photo_url : null
  return <section className="public-page ed-detail">
    <div className="ed-cover ed-cover-plain"><span className="ed-cover-shade" aria-hidden="true" /><div className="ed-cover-inner">
      <Back href={isPlayer ? '#players' : '#top'} label={isPlayer ? 'Back to Players' : 'Back to Kulhivaru+'} />
      <div className="ed-identity">
        {isPlayer ? <span className="ed-portrait">{photo ? <img src={photo} alt={`${title} photo`} /> : <PersonAvatar />}</span> : <Crest name={title} size="xl" />}
        <div><p className="ed-eyebrow light">{isPlayer ? (route.kind === 'history' ? 'Full history & statistics' : 'Player') : 'Published record'}</p><h1>{title}</h1>
          <p className="ed-identity-meta">{record.island ? <><MapPin size={14} /> {String(record.island)}</> : null}{isPlayer ? <span className="pd-manage-label"><ShieldCheck size={14} aria-hidden="true" /> {playerManagementLabel(record)}</span> : null}{isPlayer && record.public_code ? <span className="px-code">{String(record.public_code)}</span> : null}{isPlayer && record.position ? <span>{String(record.position)}</span> : null}{!isPlayer ? String(record.sport ?? record.team_type ?? record.status ?? '') : null}</p></div>
      </div>
      <div className="ed-identity-actions">{isPlayer ? <FollowButton type="player" id={String(record.id)} name={title} /> : null}<ShareButton title={title} /><ReportButton entity={isPlayer ? 'player' : 'organization'} refId={String(record.slug ?? record.id)} label={title} /></div>
    </div></div>
    <div className="ed-detail-body">
      {route.kind === 'history' ? <PlayerHistoryDetail record={record} /> : isPlayer ? <PlayerPublicDetail record={record} /> : <p>{String(record.description ?? 'Approved public information will appear here as it is published.')}</p>}
    </div>
  </section>
}

function PlayerPublicDetail({ record }: { record: Record<string, unknown> }) {
  const [statistics, setStatistics] = useState<Record<string, unknown>[]>([])
  const [history, setHistory] = useState<Record<string, unknown>[]>([])
  const [achievements, setAchievements] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState<string[]>([])
  const [sportFilter, setSportFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [tab, setTab] = useState<PlayerTab>(() => initialTab(PLAYER_TABS.map(item => item.id), 'overview'))
  const playerId = String(record.id ?? '')
  const slug = String(record.slug ?? '')

  useEffect(() => {
    if (!publicSupabase || !playerId) { setLoading(false); return }
    let active = true
    setLoading(true)
    void Promise.all([
      getPlayerStatistics(publicSupabase, playerId),
      getPlayerHistory(publicSupabase, playerId),
      getPlayerAchievements(publicSupabase, playerId),
    ]).then(([statisticsResult, historyResult, achievementsResult]) => {
      if (!active) return
      setStatistics(statisticsResult.data ?? [])
      setHistory(historyResult.data ?? [])
      setAchievements(achievementsResult.data ?? [])
      const missing: string[] = []
      if (statisticsResult.error) missing.push('official statistics')
      if (historyResult.error) missing.push('team history')
      if (achievementsResult.error) missing.push('achievements and trophies')
      setUnavailable(missing)
      setLoading(false)
    })
    return () => { active = false }
  }, [playerId])

  const totals = useMemo(() => totalOfficialStatistics(statistics), [statistics])
  // Optional public details (migration 028); absent columns simply show nothing.
  const [extras, setExtras] = useState<ProfileExtras>(EMPTY_EXTRAS)
  useEffect(() => {
    if (!publicSupabase || !playerId) return
    let active = true
    void loadProfileExtras(publicSupabase, playerId).then(result => { if (active) setExtras(result.data) })
    return () => { active = false }
  }, [playerId])
  if (loading) return <div className="public-state">Loading published player records…</div>

  const isPublished = record.is_published === true
  const current = currentPublicTeam(history)
  const teamName = current ? String((current.teams as Record<string, unknown> | null)?.name ?? '') || null : null
  const rating = computePlayerRating(totals)
  const sports = playerPublicSportOptions(statistics)
  const teams = playerPublicTeamOptions(history)
  const filteredStatistics = filterPlayerPublicStatistics(statistics, sportFilter, teamFilter)
  const filteredHistory = filterPlayerPublicHistory(history, teamFilter)
  const activeTeams = history.filter(item => item.status === 'active')
  const trophies = achievements.filter(isTrophy)
  const milestones = achievements.filter(item => !isTrophy(item))

  return <>
    <TabStrip tabs={[...PLAYER_TABS]} active={tab} onChange={setTab} label="Player sections" />
    {tab === 'card' && <div className="ed-player-top ed-player-single"><div className="ed-player-card"><PlayerCard profile={record} teamName={teamName} totals={totals} rating={rating} isPublished={isPublished} /></div><p className="pf-hint pg-verify">Verify this card: its official page is <span className="px-code">{publicUrl(`#player/${encodeURIComponent(slug)}`)}</span>. Statistics shown come only from confirmed matches.</p></div>}
    {tab === 'overview' && <div className="ed-player-top ed-player-single">
      <div className="ed-player-summary">
        <h2 className="ed-subhead">Verified statistics</h2>
        <div className="ed-stat-row"><div><b>{totals.appearances}</b><small>Appearances</small></div><div><b>{totals.goals}</b><small>Goals</small></div><div><b>{totals.assists}</b><small>Assists</small></div><div><b>{totals.yellow}/{totals.red}</b><small>Cards</small></div></div>
        {extras.bio ? <p className="ed-standfirst pp-bio">{extras.bio}</p> : null}
        {(extras.atoll || extras.jerseyNumber || extras.preferredSide) ? <p className="pp-facts">{[extras.atoll ? `${extras.atoll} atoll` : null, extras.jerseyNumber ? `#${extras.jerseyNumber}` : null, extras.preferredSide ? `${extras.preferredSide === 'both' ? 'Both sides' : `${extras.preferredSide[0].toUpperCase()}${extras.preferredSide.slice(1)}-footed/handed`}` : null].filter(Boolean).join(' · ')}</p> : null}
        {Object.keys(extras.socialLinks).length > 0 && <ul className="pp-social" aria-label="Social media">{SOCIAL_PLATFORMS.filter(platform => extras.socialLinks[platform.key]).map(platform => <li key={platform.key}><a href={extras.socialLinks[platform.key]} target="_blank" rel="noopener noreferrer nofollow">{platform.label}</a></li>)}</ul>}
        <h2 className="ed-subhead">Current teams</h2>
        {activeTeams.length ? <ul className="ed-list ed-list-rows">{activeTeams.map(item => { const team = item.teams as Record<string, unknown> | null; const teamSlug = team?.slug ? String(team.slug) : String(item.team_id); return <li key={`${String(item.team_id)}-${String(item.effective_from)}`}><a href={`#team/${encodeURIComponent(teamSlug)}`}><Crest name={String(team?.name ?? 'Team')} logoUrl={String(team?.logo_url ?? '') || null} size="sm" /><span className="ed-list-text"><strong>{String(team?.name ?? 'Published team')}</strong><small>{String(team?.team_type ?? '')}</small></span></a></li> })}</ul> : <EdEmpty>No current published team.</EdEmpty>}
      </div>
    </div>}

    {unavailable.length > 0 && <div className="public-home-warning">Some player records are not publicly available yet: {unavailable.join(', ')}.</div>}

    {tab === 'career' && <>
    <h2 className="ed-subhead">Statistics by team and sport</h2>
    {!statistics.length
      ? <Empty message={unavailable.includes('official statistics') ? 'Confirmed public statistics are not available yet.' : 'No confirmed public statistics are available yet.'} />
      : <>
        {(sports.length > 1 || teams.length > 1) && <div className="ed-filterbar">
          {sports.length > 1 && <label>Sport<select aria-label="Filter statistics by sport" value={sportFilter} onChange={event => setSportFilter(event.target.value)}><option value="">All sports</option>{sports.map(sport => <option value={sport} key={sport}>{sportName(sport)}</option>)}</select></label>}
          {teams.length > 1 && <label>Team<select aria-label="Filter statistics by team" value={teamFilter} onChange={event => setTeamFilter(event.target.value)}><option value="">All teams</option>{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label>}
        </div>}
        {filteredStatistics.length
          ? <div className="ed-table-wrap"><table className="ed-table"><thead><tr><th>Team</th><th>Sport</th><th>Apps</th><th>Goals</th><th>Assists</th><th>Y/R</th></tr></thead><tbody>{filteredStatistics.map((item, index) => <tr key={index}><td>{teams.find(team => team.id === String(item.team_id ?? ''))?.name ?? 'Published team'}</td><td>{sportName(item.sport)}</td><td>{String(item.appearances ?? 0)}</td><td>{String(item.goals ?? 0)}</td><td>{String(item.assists ?? 0)}</td><td>{String(item.yellow_cards ?? 0)}/{String(item.red_cards ?? 0)}</td></tr>)}</tbody></table></div>
          : <Empty message="No statistics match these filters." />}
      </>}

    <h2 className="ed-subhead">Team history</h2>
    {!history.length
      ? <Empty message={unavailable.includes('team history') ? 'Published team history is not publicly available yet.' : 'No published team history is available yet.'} />
      : filteredHistory.length
        ? <ul className="ed-list ed-list-rows">{filteredHistory.map(item => { const team = item.teams as Record<string, unknown> | null; const teamSlug = team?.slug ? String(team.slug) : String(item.team_id); return <li key={`${String(item.team_id)}-${String(item.effective_from)}`}><a href={`#team/${encodeURIComponent(teamSlug)}`}><Crest name={String(team?.name ?? 'Team')} logoUrl={String(team?.logo_url ?? '') || null} size="sm" /><span className="ed-list-text"><strong>{String(team?.name ?? 'Published team')}</strong><small>{[formatDay(item.effective_from), item.effective_to ? formatDay(item.effective_to) : 'present'].filter(Boolean).join(' – ')}{String(item.status) !== 'active' ? ` · ${String(item.status)}` : ''}</small></span></a></li> })}</ul>
        : <Empty message="No team history matches this filter." />}

    </>}

    {tab === 'history' && <>
    <h2 className="ed-subhead">Achievements and trophies</h2>
    {unavailable.includes('achievements and trophies')
      ? <Empty message="Achievements and trophies are not publicly available yet." />
      : !achievements.length
        ? <Empty message="No published achievements are available yet." />
        : <Honours items={[...trophies, ...milestones]} />}
    </>}

    <p className="private-note">Identity documents, private contact details, payments, internal notes, and account identifiers are never shown on public pages. Detailed per-match records are only available to signed-in participants and organizers.</p>

    <div className="button-row">
      <a className="ed-btn ed-btn-primary" href={`#history/${encodeURIComponent(slug)}`}>View full history &amp; statistics <ArrowRight size={14} /></a>
      <a className="ed-btn ed-btn-ghost" href="#players">Back to Players</a>
    </div>
  </>
}

// Full history & statistics page (#history/:slug). Shares the same approved
// public sources as the player summary but presents the complete record with
// the full filter set (team level, tournament, season, sport). Every filter
// renders only when the published data offers 2+ distinct options, so a filter
// is never shown against data that cannot support it.
function PlayerHistoryDetail({ record }: { record: Record<string, unknown> }) {
  const [statistics, setStatistics] = useState<Record<string, unknown>[]>([])
  const [history, setHistory] = useState<Record<string, unknown>[]>([])
  const [achievements, setAchievements] = useState<Record<string, unknown>[]>([])
  const [labels, setLabels] = useState<PlayerHistoryFilterLabels>(EMPTY_PLAYER_HISTORY_LABELS)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState<string[]>([])
  const [teamLevel, setTeamLevel] = useState('')
  const [sport, setSport] = useState('')
  const [tournamentId, setTournamentId] = useState('')
  const [seasonId, setSeasonId] = useState('')
  const playerId = String(record.id ?? '')
  const slug = String(record.slug ?? '')

  useEffect(() => {
    const client = publicSupabase
    if (!client || !playerId) { setLoading(false); return }
    let active = true
    setLoading(true)
    void Promise.all([
      getPlayerStatistics(client, playerId),
      getPlayerHistory(client, playerId),
      getPlayerAchievements(client, playerId),
    ]).then(async ([statisticsResult, historyResult, achievementsResult]) => {
      if (!active) return
      const statisticsRows = statisticsResult.data ?? []
      setStatistics(statisticsRows)
      setHistory(historyResult.data ?? [])
      setAchievements(achievementsResult.data ?? [])
      // Tournament/season names are resolved only from rows already loaded, so
      // an empty result never triggers extra requests.
      const labelResult = statisticsRows.length
        ? await getPlayerHistoryFilterLabels(client, statisticsRows)
        : { data: EMPTY_PLAYER_HISTORY_LABELS, error: null }
      if (!active) return
      setLabels(labelResult.data ?? EMPTY_PLAYER_HISTORY_LABELS)
      const missing: string[] = []
      if (statisticsResult.error) missing.push('official statistics')
      if (historyResult.error) missing.push('team history')
      if (achievementsResult.error) missing.push('achievements and trophies')
      if (labelResult.error) missing.push('tournament and season names')
      setUnavailable(missing)
      setLoading(false)
    })
    return () => { active = false }
  }, [playerId])

  if (loading) return <div className="public-state">Loading published player history…</div>

  const isPublished = record.is_published === true
  const teamLevels = playerPublicTeamLevelOptions(statistics)
  const sports = playerPublicSportOptions(statistics)
  const tournaments = labelledFilterOptions([...new Set(statistics.map(row => String(row.tournament_id ?? '')).filter(Boolean))], labels.tournaments)
  const seasons = labelledFilterOptions([...new Set(statistics.map(row => String(row.season_id ?? '')).filter(Boolean))], labels.seasons)
  const teams = playerPublicTeamOptions(history)
  const filteredStatistics = filterPlayerHistoryStatistics(statistics, { teamLevel, sport, tournamentId, seasonId })
  const filteredHistory = filterPlayerHistoryByTeamLevel(history, teamLevel)
  const showFilters = teamLevels.length > 1 || sports.length > 1 || tournaments.length > 1 || seasons.length > 1

  return <>

    {!isPublished && <div className="public-home-warning">This profile is not currently published. Only published profiles are visible to guests.</div>}

    {unavailable.length > 0 && <div className="public-home-warning">Some player records are not publicly available yet: {unavailable.join(', ')}.</div>}

    {showFilters && <div className="ed-filterbar">
      {teamLevels.length > 1 && <label>Team level<select aria-label="Filter history by team level" value={teamLevel} onChange={event => setTeamLevel(event.target.value)}><option value="">All levels</option>{teamLevels.map(level => <option value={level} key={level}>{level}</option>)}</select></label>}
      {sports.length > 1 && <label>Sport<select aria-label="Filter history by sport" value={sport} onChange={event => setSport(event.target.value)}><option value="">All sports</option>{sports.map(value => <option value={value} key={value}>{value}</option>)}</select></label>}
      {tournaments.length > 1 && <label>Tournament<select aria-label="Filter history by tournament" value={tournamentId} onChange={event => setTournamentId(event.target.value)}><option value="">All tournaments</option>{tournaments.map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label>}
      {seasons.length > 1 && <label>Season<select aria-label="Filter history by season" value={seasonId} onChange={event => setSeasonId(event.target.value)}><option value="">All seasons</option>{seasons.map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label>}
    </div>}

    <h2 className="ed-subhead">Verified team history</h2>
    {!history.length
      ? <div className="public-state"><p>{unavailable.includes('team history') ? 'Published team history is not publicly available yet.' : 'No published team history is available yet.'}</p></div>
      : filteredHistory.length
        ? <div className="public-history">{filteredHistory.map(item => { const team = item.teams as Record<string, unknown> | null; const teamSlug = team?.slug ? String(team.slug) : String(item.team_id); return <a href={`#team/${encodeURIComponent(teamSlug)}`} key={`${String(item.team_id)}-${String(item.effective_from)}`}>{String(team?.name ?? 'Published team')}{String(item.status) !== 'active' ? ` · ${String(item.status)}` : ''}</a> })}</div>
        : <div className="public-state"><p>No team history matches these filters.</p></div>}

    <h2 className="ed-subhead">Official statistics</h2>
    {!statistics.length
      ? <div className="public-state"><p>{unavailable.includes('official statistics') ? 'Confirmed public statistics are not available yet.' : 'No confirmed public statistics are available yet.'}</p></div>
      : !filteredStatistics.length
        ? <div className="public-state"><p>No statistics match these filters.</p></div>
        : <div className="ed-table-wrap"><table className="ed-table"><thead><tr><th>Team</th><th>Level</th><th>Sport</th><th>Tournament</th><th>Apps</th><th>Starts</th><th>Min</th><th>G</th><th>A</th><th>Y/R</th></tr></thead><tbody>{filteredStatistics.map((item, index) => { const tournamentId = String(item.tournament_id ?? ''); const tournamentName = labels.tournaments[tournamentId]; const tournamentSlug = labels.tournamentSlugs[tournamentId]; return <tr key={index}><td>{teams.find(team => team.id === String(item.team_id ?? ''))?.name ?? 'Published team'}</td><td>{String(item.team_type ?? '')}</td><td>{String(item.sport ?? '')}</td><td>{tournamentName ? (tournamentSlug ? <a href={`#tournament/${encodeURIComponent(tournamentSlug)}`}>{tournamentName}</a> : tournamentName) : '—'}</td><td>{String(item.appearances ?? 0)}</td><td>{String(item.starts ?? 0)}</td><td>{String(item.minutes ?? 0)}</td><td>{String(item.goals ?? 0)}</td><td>{String(item.assists ?? 0)}</td><td>{String(item.yellow_cards ?? 0)}/{String(item.red_cards ?? 0)}</td></tr> })}</tbody></table></div>}

    <h2 className="ed-subhead">Achievements and trophies</h2>
    {unavailable.includes('achievements and trophies')
      ? <div className="public-state"><p>Achievements and trophies are not publicly available yet.</p></div>
      : !achievements.length
        ? <div className="public-state"><p>No published achievements are available yet.</p></div>
        : <div className="public-history">{achievements.map(item => <span key={String(item.id)}>{String(item.label)}{item.reached_at ? ` · ${new Date(String(item.reached_at)).toLocaleDateString()}` : ''}</span>)}</div>}

    <p className="private-note">Identity documents, private contact details, payments, internal notes, and account identifiers are never shown on public pages. Detailed per-match records are only available to signed-in participants and organizers.</p>

    <div className="button-row">
      <a className="ed-btn ed-btn-ghost" href={`#player/${encodeURIComponent(slug)}`}>Back to player profile</a>
      <a className="ed-btn ed-btn-ghost" href="#players">Back to Players</a>
    </div>
  </>
}

type MatchTab = 'timeline' | 'lineups' | 'statistics' | 'commentary'
const MATCH_TABS: Array<{ id: MatchTab; label: string }> = [{ id: 'timeline', label: 'Timeline' }, { id: 'lineups', label: 'Lineups' }, { id: 'statistics', label: 'Statistics' }, { id: 'commentary', label: 'Commentary' }]

// Match center for guests: scoreboard first, then key events, then tabs. The
// tabs are keyboard-operable tab elements rather than form controls, because
// this page stays strictly view-only.
function MatchPublicDetail({ record, reportRef }: { record: Record<string, unknown>; reportRef: string }) {
  const [labels, setLabels] = useState<MatchListLabels>(EMPTY_MATCH_LIST_LABELS)
  const [labelsFailed, setLabelsFailed] = useState(false)
  const [labelsReady, setLabelsReady] = useState(false)
  const [tab, setTab] = useState<MatchTab>('timeline')
  useEffect(() => {
    let active = true
    const client = publicSupabase
    if (!client) { setLabels(EMPTY_MATCH_LIST_LABELS); setLabelsFailed(true); setLabelsReady(true); return }
    setLabelsReady(false)
    void getPublishedMatchLabels(client, [record]).then(result => {
      if (!active) return
      setLabels(result.data ?? EMPTY_MATCH_LIST_LABELS)
      setLabelsFailed(Boolean(result.error))
      setLabelsReady(true)
    })
    return () => { active = false }
  }, [record])
  // Auto-refresh disabled: live updates are manual to keep the page stable.
  const tournament = labels.tournaments[String(record.tournament_id ?? '')]
  const home = labels.teams[String(record.home_team_id ?? '')]
  const away = labels.teams[String(record.away_team_id ?? '')]
  const homeSlug = home?.slug ?? ''
  const showAway = Boolean(away) && (away?.slug ?? '') !== homeSlug
  const state = resultState(record.status)
  // Calendar data only; the page itself shows the formatted Maldives time.
  const calendarStart = typeof record.scheduled_at === 'string' ? record.scheduled_at : null
  const venue = String(record.venue ?? '').trim() ? String(record.venue) : 'Venue not published'
  // Score, events and lineups come from get_public_match_detail (migration 038) and only
  // for a confirmed, unfrozen result; before that migration nothing extra is public.
  const extras = (record.extras as MatchExtras | undefined) ?? NO_MATCH_EXTRAS
  const homeName = home?.name ?? 'Home'
  const awayName = away?.name ?? 'Away'
  const score = extras.official && extras.homeScore !== null && extras.awayScore !== null ? `${extras.homeScore} : ${extras.awayScore}` : null
  // Man of the match: player with most goal contributions (goals + assists).
  const motm = (() => {
    if (!extras.official || !extras.events.length) return null
    const tally = new Map<string, { name: string; slug: string | null; goals: number; assists: number }>()
    for (const e of extras.events) {
      if (!e.player) continue
      const key = e.playerSlug ?? e.player
      const cur = tally.get(key) ?? { name: e.player, slug: e.playerSlug, goals: 0, assists: 0 }
      if (e.type === 'goal' || e.type === 'own_goal' || e.type === 'penalty') cur.goals += 1
      if (e.type === 'assist') cur.assists += 1
      tally.set(key, cur)
    }
    let best: { name: string; slug: string | null; goals: number; assists: number } | null = null
    for (const v of tally.values()) {
      if (!best || v.goals + v.assists > best.goals + best.assists) best = v
    }
    return best && (best.goals + best.assists > 0) ? best : null
  })()
  return <section className="public-page ed-detail">
    <div className="ed-detail-body ed-match-page">
      <Back href="#matches" label="Back to Matches" />
      {!labelsReady ? <Loading /> : <article>
        <p className="ed-eyebrow">{tournament ? <a href={`#tournament/${encodeURIComponent(tournament.slug)}`}>{tournament.name}</a> : 'Tournament not published'}</p>
        <h1 className="ed-sr-title">{matchPairTitle(record, labels)}</h1>
        <p className="lp-report-row"><ShareButton title={matchPairTitle(record, labels)} />{extras.official && extras.homeScore !== null && extras.awayScore !== null ? <a className="ed-btn ed-btn-ghost" href="#" onClick={async (e) => { e.preventDefault(); const { renderResultImage } = await import('../lib/resultImage'); const { downloadBlob } = await import('../lib/cardImage'); const blob = await renderResultImage({ tournament: tournament?.name ?? 'Match', home: homeName, away: awayName, homeScore: extras.homeScore!, awayScore: extras.awayScore!, when: formatMatchSchedule(record.scheduled_at), venue: record.venue ? String(record.venue) : null, corrected: extras.outcome === 'corrected' }); if (!blob) return; const file = new File([blob], 'match-result.png', { type: 'image/png' }); try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Match result' }); return } } catch { return } downloadBlob(blob, file.name) }}>Share image</a> : null}{calendarStart && ['scheduled', 'live'].includes(String(record.status)) ? <CalendarButton name={matchPairTitle(record, labels)} events={[{ uid: `match-${reportRef}`, title: matchPairTitle(record, labels), start: calendarStart, location: record.venue ? String(record.venue) : null, description: tournament?.name ?? null, url: publicUrl(`#matches/${reportRef}`) }]} /> : null}{String(record.venue ?? '').trim() ? <a className="ed-btn ed-btn-ghost" href={directionsHref(String(record.venue))} target="_blank" rel="noopener noreferrer">Directions</a> : null}<ReportButton entity="match" refId={reportRef} label={matchPairTitle(record, labels)} /></p>
        {labelsFailed ? <div className="public-home-warning">Team and tournament names could not be loaded, so some links are hidden.</div> : null}

        <div className="ed-scoreboard" aria-label="Scoreboard" aria-live="polite" aria-atomic="true">
          <div className="ed-score-team">
            <Crest name={home?.name ?? 'Home'} logoUrl={home?.logo ?? null} size="xl" />
            {home ? <a href={`#team/${encodeURIComponent(home.slug)}`}>{home.name}</a> : <span>{'Published team'}</span>}
          </div>
          <div className="ed-score-mid">
            <span className={matchStatusClass(record.status)}>{matchStatusLabel(record.status)}</span>
            {score ? <strong className="ed-score-value" aria-label={`Official score ${score}`}>{score}</strong> : <strong className="ed-score-value" aria-label="Score not public">– : –</strong>}
            {extras.outcome ? <small>Result by {extras.outcome}</small> : null}
            <Chip tone={state.tone}>{state.label}</Chip>
            <small>{formatMatchSchedule(record.scheduled_at)}</small>
            <small><MapPin size={13} /> {venue}</small>
          </div>
          <div className="ed-score-team">
            <Crest name={away?.name ?? 'Away'} logoUrl={away?.logo ?? null} size="xl" />
            {away ? showAway ? <a href={`#team/${encodeURIComponent(away.slug)}`}>{away.name}</a> : <span>{away.name}</span> : <span>{'Published team'}</span>}
          </div>
        </div>

        {motm ? <section className="ed-panel ed-panel-motm">
          <p className="ed-eyebrow">MAN OF THE MATCH</p>
          <div className="motm-card">
            <span className="motm-avatar">{motm.name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}</span>
            <div><strong>{motm.slug ? <a href={`#player/${encodeURIComponent(motm.slug)}`}>{motm.name}</a> : motm.name}</strong><small>{motm.goals} goal{motm.goals === 1 ? '' : 's'} · {motm.assists} assist{motm.assists === 1 ? '' : 's'}</small></div>
          </div>
        </section> : null}
        <section className="ed-panel">
          <h2 className="ed-subhead">Key events</h2>
          {extras.available ? <MatchKeyEvents extras={extras} home={homeName} away={awayName} /> : <div className="public-state"><Globe2 size={22} /><p>Only the fixture is public for this match: teams, tournament, date/time, venue, and status. Official scores and match events are stored in confirmed result records that current public data policies do not expose to guests - assigned officials, stage/round and category names, and result change history are unavailable for the same reason. Signed-in match participants and organizers can view them.</p></div>}
        </section>

        <div className="ed-tabs" role="tablist" aria-label="Match details">
          {MATCH_TABS.map(item => <span key={item.id} role="tab" tabIndex={0} aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setTab(item.id) } }}>{item.label}</span>)}
        </div>
        <section className="ed-panel" role="tabpanel">
          {!extras.available ? <EdEmpty>The timeline, lineups and match statistics are not public yet.</EdEmpty> : null}
          {extras.available && tab === 'timeline' && <MatchTimeline extras={extras} home={homeName} away={awayName} />}
          {extras.available && tab === 'lineups' && <MatchLineups extras={extras} home={homeName} away={awayName} />}
          {extras.available && tab === 'statistics' && <MatchStatistics extras={extras} home={homeName} away={awayName} />}
          {extras.available && tab === 'commentary' && (extras.events.length ? <ul className="pg-events pg-commentary">{extras.events.map((e, i) => <li key={i} className={`pg-event pg-event-${e.side ?? 'none'}`}><span className="pg-minute">{e.minute !== null ? `${e.minute}${e.minuteExtra ? `+${e.minuteExtra}` : ''}′` : '–'}</span><span className="pg-event-icon" aria-hidden="true">•</span><span className="pg-event-text"><strong>{matchEventLabel(e.type)}</strong><small>{e.player ? `${e.player}${e.side ? ` (${e.side === 'home' ? homeName : awayName})` : ''}` : 'Match update'}</small></span></li>)}</ul> : <EdEmpty>No commentary yet.</EdEmpty>)}
        </section>

        <p className="private-note">Identity documents, contact details, payments, internal notes, result submitters and confirmation reasons, event recording metadata, account identifiers, and workspace controls are never shown on public pages.</p>
      </article>}
    </div>
  </section>
}
