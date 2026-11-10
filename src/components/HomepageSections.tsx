import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { ArrowRight, CalendarDays, Check, Clock3, Info, PlayCircle, RefreshCw, Shield, Trophy, Users, WifiOff } from 'lucide-react'
import { getPublishedMatches, getPublishedPlayers, getPublishedTeams, getPublishedTournaments, getTournamentDirectoryDetails, type PublicRecord, type TournamentDirectoryDetail } from '../lib/publicData'
import { getPublishedNews } from '../lib/news'
import { RATING_METHOD_SUMMARY } from '../lib/playerRating'
import { publicSupabase } from '../lib/supabase'
import { publicTournamentBranding } from '../lib/tournamentBranding'
import { formatDay, sportClass, sportName } from '../lib/display'
import { activeTeams, completedTournaments, countPublished, daysUntil, formatMvtTime, isLive, loadCapacity, loadMatchFeed, loadTopPlayers, maldivesDayRange, matchStateLabel, NEEDS_032, officialScore, pickSpotlight, registrationInfo, REGISTRATION_STATUS_TEXT, teamLabel, timeAgo, TOURNAMENT_STATUS_TEXT, tournamentStatus, type Capacity, type FeedMatch, type Loaded } from '../lib/landing'
import { TournamentCover, TournamentLogo } from './TournamentBranding'
import { Chip, Crest } from './Editorial'
import { FinalCallToAction } from './LandingFeatures'
import { CoverScene, HERO_PHOTO, HERO_WIDE, PersonAvatar, TeamLogo, SportGlyph } from './HomeArt'
import { HIGHLIGHT_KIND_LABELS, loadLiveHighlights, type Highlight } from '../lib/platformHighlights'
import { DEFAULT_LANDING, featureOn, SPORT_KEYS_ALL, type FeatureFlag } from '../lib/appConfig'
import { useAppConfig } from '../lib/useAppConfig'

const LIVE_REFRESH_MS = 30_000
// Home shows previews only: at most five records per block, then View All.
const HOME_LIMIT = 5
const tournamentHref = (record: PublicRecord) => `#tournament/${encodeURIComponent(String(record.slug ?? record.id))}`
const matchHref = (id: string) => `#matches/${encodeURIComponent(id)}`
const NOT_CONFIGURED = 'Public data is not configured.'

// --- Loading plumbing ------------------------------------------------------------------
type SectionState<T> = { status: 'loading' | 'ready' | 'error'; data: T; error: string | null; needsMigration: boolean; loadedAt: number | null }

// One independent load per section. `enabled` lets below-the-fold sections
// wait until they are near the screen; `key` reloads when inputs change.
function useSection<T>(load: () => Promise<Loaded<T>>, initial: T, key = '', enabled = true): SectionState<T> & { retry: () => void } {
  const [state, setState] = useState<SectionState<T>>({ status: 'loading', data: initial, error: null, needsMigration: false, loadedAt: null })
  const [attempt, setAttempt] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    if (!enabled) return
    let active = true
    setState(previous => ({ ...previous, status: previous.loadedAt ? previous.status : 'loading' }))
    loadRef.current()
      .then(result => { if (active) setState(previous => ({ status: result.error && !result.needsMigration ? 'error' : 'ready', data: result.error && previous.loadedAt ? previous.data : result.data, error: result.error, needsMigration: Boolean(result.needsMigration), loadedAt: result.error ? previous.loadedAt : Date.now() })) })
      .catch((error: unknown) => { if (active) setState(previous => ({ ...previous, status: 'error', error: error instanceof Error ? error.message : 'This section could not be loaded.' })) })
    return () => { active = false }
  }, [attempt, key, enabled])
  return { ...state, retry: () => setAttempt(value => value + 1) }
}

// Mounts its children once they come near the screen.
function useNearScreen<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near || !ref.current) return
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setNear(true); observer.disconnect() } }, { rootMargin: '600px 0px' })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [near])
  return [ref, near]
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  return online
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), intervalMs); return () => window.clearInterval(timer) }, [intervalMs])
  return now
}

// --- Small building blocks ---------------------------------------------------------------
// An empty section is one compact, truthful card with a next step.
function EmptyCard({ children, action }: { children: ReactNode; action?: { label: string; href: string } }) {
  return <p className="lp-empty">{children}{action && <> <a className="ed-link" href={action.href}>{action.label} <ArrowRight size={13} /></a></>}</p>
}

function SectionError({ onRetry, message }: { onRetry: () => void; message?: string | null }) {
  return <div className="lp-error" role="alert"><span><strong>This section could not be loaded.</strong>{message ? <small>{message}</small> : null}</span><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={onRetry}><RefreshCw size={14} /> Retry</button></div>
}

function MigrationNote() { return <p className="lp-empty lp-pending"><Info size={15} /> {NEEDS_032} It appears once the platform owner applies it.</p> }

function Skeleton({ kind }: { kind: 'rail' | 'list' | 'cards' | 'table' | 'feature' }) {
  const count = kind === 'list' ? 4 : kind === 'table' ? 5 : kind === 'feature' ? 1 : 4
  return <div className={`lp-skeleton lp-skeleton-${kind}`} aria-hidden="true">{Array.from({ length: count }, (_, index) => <span key={index} className="skeleton" />)}</div>
}

function Body<T>({ state, skeleton, children }: { state: SectionState<T> & { retry: () => void }; skeleton: 'rail' | 'list' | 'cards' | 'table' | 'feature'; children: ReactNode }) {
  if (state.status === 'loading') return <Skeleton kind={skeleton} />
  if (state.status === 'error' && !state.loadedAt) return <SectionError onRetry={state.retry} message={state.error} />
  if (state.needsMigration) return <MigrationNote />
  return <>{children}</>
}

function TeamMark({ team, size = 'md' }: { team: FeedMatch['home']; size?: 'md' | 'lg' }) {
  return <TeamLogo name={teamLabel(team)} logoUrl={team.logo} size={size === 'lg' ? 52 : 46} />
}

// --- Tournament card (also used by the public tournament pages) ----------------------------
// Tournament status and registration status are two separate labels. Branding
// is signed with the session-less client, only for published, non-draft rows.
export function TournamentCard({ record, detail, capacity, layout = 'grid', lead }: { record: PublicRecord; detail?: TournamentDirectoryDetail; capacity?: Capacity; layout?: 'grid' | 'list' | 'compact'; lead?: boolean }) {
  const name = String(record.name ?? 'Published tournament')
  const branding = publicTournamentBranding(record)
  const stage = tournamentStatus(record.status)
  const registration = registrationInfo(record.status, capacity, detail?.closesAt)
  const starts = formatDay(detail?.startsAt)
  const until = stage === 'upcoming' ? daysUntil(detail?.startsAt ?? null) : null
  const tone = stage === 'active' ? 'live' : stage === 'completed' ? 'done' : stage === 'cancelled' || stage === 'postponed' ? 'warn' : 'plain'
  return <a className={`ed-tcard ed-tcard-${layout === 'compact' ? 'grid' : layout}${layout === 'compact' ? ' ed-tcard-compact' : ''}${lead ? ' ed-tcard-lead' : ''}`} href={tournamentHref(record)}>
    <span className="ed-tcard-cover"><TournamentCover client={publicSupabase} path={branding.coverPath} name={name} sport={sportClass(record.sport).replace('sport-', '')} /></span>
    <TournamentLogo client={publicSupabase} path={branding.logoPath} name={name} className="ed-tcard-logo" />
    <span className="ed-tcard-body">
      <span className="ed-tcard-chips"><Chip tone={tone}>{TOURNAMENT_STATUS_TEXT[stage]}</Chip>{registration.status && <Chip tone={registration.canRegister ? 'open' : registration.status === 'full' ? 'warn' : 'plain'}>{REGISTRATION_STATUS_TEXT[registration.status]}</Chip>}</span>
      <strong className="ed-tcard-name">{name}</strong>
      <span className="ed-tcard-meta">{[sportName(record.sport), detail?.island, starts ? `From ${starts}` : null, capacity && capacity.approved > 0 ? `${capacity.approved} team${capacity.approved === 1 ? '' : 's'}` : null, layout === 'compact' ? null : detail?.organizerName].filter(Boolean).join(' · ')}</span>
      {(registration.urgency || (until !== null && until >= 0 && layout !== 'list')) && <span className="ed-tcard-urgency"><Clock3 size={13} /> {registration.urgency ?? (until === 0 ? 'Starts today' : `Starts in ${until} day${until === 1 ? '' : 's'}`)}</span>}
      {layout !== 'compact' && <span className="ed-tcard-action">{registration.canRegister ? 'View and register' : 'View tournament'} <ArrowRight size={14} /></span>}
    </span>
  </a>
}

// --- The page ----------------------------------------------------------------------------------
type TournamentData = { tournaments: PublicRecord[]; details: Map<string, TournamentDirectoryDetail>; capacity: Map<string, Capacity> }
const EMPTY_TOURNAMENTS: TournamentData = { tournaments: [], details: new Map(), capacity: new Map() }

// Before migration 032, recent results fall back to the confirmed-match list
// guests could always read (names only, no scores).
async function legacyResults(): Promise<Loaded<FeedMatch[]>> {
  const client = publicSupabase
  if (!client) return { data: [], error: NOT_CONFIGURED }
  const [matches, teams] = await Promise.all([getPublishedMatches(client), getPublishedTeams(client)])
  if (matches.error) return { data: [], error: matches.error }
  const byId = new Map((teams.data ?? []).map(team => [String(team.id), team]))
  const side = (id: unknown) => { const team = byId.get(String(id ?? '')); return { id: id ? String(id) : null, name: team ? String(team.name) : null, slug: team ? String(team.slug ?? '') || null : null, logo: team ? String(team.logo_url ?? '') || null : null } }
  return { data: (matches.data ?? []).slice(0, 40).map(row => { const tournament = row.tournaments as PublicRecord | null; return { id: String(row.id), tournamentId: String(row.tournament_id), tournamentName: String(tournament?.name ?? 'Tournament'), tournamentSlug: String(tournament?.slug ?? row.tournament_id), sport: '', stageId: String(row.stage_id ?? ''), stageName: null, stageFormat: null, stageOrder: 1, groupName: null, leg: 1, scheduledAt: row.scheduled_at ? String(row.scheduled_at) : null, venue: row.venue ? String(row.venue) : null, status: 'confirmed', home: side(row.home_team_id), away: side(row.away_team_id), homeScore: null, awayScore: null, outcome: null, confirmedAt: null, corrected: false } }), error: null }
}

function AnimatedNumber({ value }: { value: number | null }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    if (value === null) return
    const target = value
    const start = performance.now()
    const duration = 900
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(target * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{value === null ? '\u2013' : display.toLocaleString()}</>
}

export function HomepageSections({ onCreateTournament }: { onCreateTournament: () => void }) {
  const client = publicSupabase
  const [parallax, setParallax] = useState(0)
  useEffect(() => {
    const onScroll = () => { if (document.visibilityState === 'visible') setParallax(Math.min(120, window.scrollY * 0.25)) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  // Published landing customization; built-in otherwise.
  const { config: appConfig } = useAppConfig()
  const landing = { ...DEFAULT_LANDING, ...appConfig.landing }
  const FEATURE_OF: Record<string, FeatureFlag> = { news: 'news', 'top-players': 'topPlayers' }
  const show = (id: string) => !landing.hiddenSections?.includes(id) && (!FEATURE_OF[id] || featureOn(FEATURE_OF[id]))
  const online = useOnline()
  const [highlights, setHighlights] = useState<Highlight[]>([])
  useEffect(() => { if (!client) return; let active = true; void loadLiveHighlights(client).then(items => { if (active) setHighlights(items) }); return () => { active = false } }, [client])

  const tournaments = useSection<TournamentData>(async () => {
    if (!client) return { data: EMPTY_TOURNAMENTS, error: NOT_CONFIGURED }
    const list = await getPublishedTournaments(client)
    if (list.error) return { data: EMPTY_TOURNAMENTS, error: list.error }
    const rows = list.data ?? []
    const ids = rows.slice(0, 40).map(row => String(row.id))
    const [details, capacity] = await Promise.all([getTournamentDirectoryDetails(client, ids), loadCapacity(client, ids)])
    return { data: { tournaments: rows, details, capacity }, error: null }
  }, EMPTY_TOURNAMENTS)

  // At most three real statistics; a count whose query failed is hidden, never shown as zero.
  const counts = useSection<{ active: number | null; teams: number | null; players: number | null }>(async () => {
    if (!client) return { data: { active: null, teams: null, players: null }, error: NOT_CONFIGURED }
    const [active, teams, players] = await Promise.all([countPublished(client, 'tournaments', ['in_progress', 'registration_open']), countPublished(client, 'teams'), countPublished(client, 'player_profiles')])
    return { data: { active, teams, players }, error: null }
  }, { active: null, teams: null, players: null })

  // Live refreshes every 30 seconds while the page is visible.
  const [liveTick, setLiveTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine !== false) setLiveTick(value => value + 1) }, LIVE_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])
  const feed = (query: Parameters<typeof loadMatchFeed>[1]) => client ? loadMatchFeed(client, query) : Promise.resolve({ data: [] as FeedMatch[], error: NOT_CONFIGURED })
  const live = useSection<FeedMatch[]>(() => feed({ statuses: ['live'], limit: HOME_LIMIT }), [], String(liveTick))
  const dayRange = useMemo(() => maldivesDayRange(), [])
  const today = useSection<FeedMatch[]>(() => feed({ from: dayRange.from, to: dayRange.to, limit: 40 }), [], String(liveTick))
  const upcomingMatches = useSection<FeedMatch[]>(() => feed({ from: new Date().toISOString(), statuses: ['scheduled', 'postponed'], limit: HOME_LIMIT }), [])
  const results = useSection<FeedMatch[]>(async () => {
    if (!client) return { data: [], error: NOT_CONFIGURED }
    const result = await loadMatchFeed(client, { statuses: ['confirmed'], newestFirst: true, limit: 80 })
    return result.needsMigration ? legacyResults() : result
  }, [])
  const news = useSection<Record<string, unknown>[]>(async () => {
    if (!client) return { data: [], error: NOT_CONFIGURED }
    const result = await getPublishedNews(client)
    return { data: result.data ?? [], error: result.error, needsMigration: false }
  }, [])

  const tournamentRows = tournaments.data.tournaments
  const startOf = (id: string) => tournaments.data.details.get(id)?.startsAt ?? null
  const promoted = highlights.filter(item => item.kind === 'tournament' && item.tournamentId).map(item => String(item.tournamentId))
  const spotlight = tournaments.status === 'ready' ? pickSpotlight(tournamentRows, promoted, startOf) : null
  const tournamentsById = useMemo(() => new Map(tournamentRows.map(row => [String(row.id), row])), [tournamentRows])
  // Watch Live appears only when a published live match really exists.
  const firstLive = live.status === 'ready' ? live.data.find(match => isLive(match.status)) : undefined
  // The hero card shows a real match: the one being played, else the next scheduled one.
  const nextMatch = upcomingMatches.status === 'ready' ? upcomingMatches.data.find(match => match.status === 'scheduled') : undefined
  const heroMatch = firstLive ?? nextMatch
  const stats = <dl className="lp-hero-stats" aria-label="Platform summary">
    {counts.data.active !== null && <div><dt>Active tournaments</dt><dd><AnimatedNumber value={counts.data.active} /></dd></div>}
    {counts.data.teams !== null && <div><dt>Published teams</dt><dd><AnimatedNumber value={counts.data.teams} /></dd></div>}
    {counts.data.players !== null && <div><dt>Published players</dt><dd><AnimatedNumber value={counts.data.players} /></dd></div>}
  </dl>

  return <div className="lp lp-home">
    {live.status === 'ready' && live.data.length > 0 && <div className="lp-live-ticker" role="region" aria-label="Live matches">
      <span className="lp-live-ticker-label"><span className="ed-live-dot" aria-hidden="true" /> LIVE</span>
      <div className="lp-live-ticker-track">
        {[...live.data, ...live.data].map((m, i) => <a key={`${m.id}-${i}`} className="lp-live-ticker-item" href={`#matches/${encodeURIComponent(m.id)}`}>
          <Crest name={m.home.name ?? 'Team'} logoUrl={m.home.logo} size="sm" />
          <span className="lp-live-ticker-score">{m.homeScore !== null && m.awayScore !== null ? `${m.homeScore}–${m.awayScore}` : 'vs'}</span>
          <Crest name={m.away.name ?? 'Team'} logoUrl={m.away.logo} size="sm" />
          <span className="lp-live-ticker-names">{m.home.name ?? 'Team'} vs {m.away.name ?? 'Team'}</span>
        </a>)}
      </div>
    </div>}
    {!online && <p className="lp-offline" role="status"><WifiOff size={16} /> <span><strong>You are offline.</strong> Previously viewed information may be available, but live scores can be outdated.</span></p>}

    {/* Landing layout (owner mockup, 2026-11-04): hero with the live or next real match, Find your
        sport, Match Center, Discover Tournaments, Players & Teams and the closing call to action.
        Standings, brackets, news and the archive keep their own pages. Real published data only. */}
    <section className="lp-hero" aria-labelledby="lp-hero-title" style={{ ['--parallax' as string]: `${parallax}px` } as React.CSSProperties}>
      <span className="lp-hero-backdrop" aria-hidden="true" style={{ backgroundImage: `url(${HERO_WIDE})`, transform: `translateY(${parallax}px)` }}>
        <video className="lp-hero-video" autoPlay muted loop playsInline poster={HERO_WIDE} src="/assets/hero-loop.mp4" aria-hidden="true" onError={(e) => { (e.currentTarget as HTMLVideoElement).style.display = 'none' }} />
      </span>
      <span className="lp-hero-sea" aria-hidden="true" />
      {/* The design photo has a sample card painted on it; the slot always covers it with a real card. */}
      <div className="lp-hero-frame">
        <img className="lp-hero-photo" src={HERO_PHOTO} alt="" width={502} height={293} decoding="async" fetchPriority="high" />
        <div className="lp-hero-slot">
          {heroMatch ? <HeroMatch match={heroMatch} />
            : highlights.length ? <HeroNote highlight={highlights[0]} tournaments={tournamentsById} />
              : <div className="lp-hero-card lp-hero-card-stats">{live.status === 'loading' || upcomingMatches.status === 'loading' ? <span className="lp-hero-match-when">Loading matches…</span>
                : <><span className="lp-hero-match-when">Kulhivaru+ today</span>{stats}<a className="ed-link" href="#matches">Matches appear here once published <ArrowRight size={14} aria-hidden="true" /></a></>}</div>}
        </div>
      </div>
      <div className="lp-hero-inner">
        <div className="lp-hero-copy">
          <h1 id="lp-hero-title">{landing.heroTitle}<br /><span>{landing.heroTitleAccent}</span></h1>
          <p className="lp-hero-lede">{landing.heroLede}</p>
          <div className="lp-hero-actions">
            <a className="ed-btn ed-btn-primary ed-btn-lg" href="#tournaments"><Trophy size={18} aria-hidden="true" /> Explore Tournaments</a>
            <button type="button" className="ed-btn ed-btn-glass ed-btn-lg" onClick={onCreateTournament}><Users size={18} aria-hidden="true" /> Organize a Tournament</button>
            {firstLive && <a className="ed-btn ed-btn-live ed-btn-lg" href={matchHref(firstLive.id)}><PlayCircle size={18} /> Watch Live</a>}
          </div>
        </div>
      </div>
    </section>

    <section className="lp-section lp-social-proof" aria-label="Platform activity">
      <div className="lp-social-proof-inner">
        <span><AnimatedNumber value={counts.data.active} /> tournaments running</span>
        <span><AnimatedNumber value={counts.data.teams} /> teams registered</span>
        <span><AnimatedNumber value={counts.data.players} /> players published</span>
      </div>
    </section>
    <BrowseBySport tournaments={tournamentRows} ready={tournaments.status !== 'loading'} failed={tournaments.status === 'error' && !tournaments.loadedAt} />
    <SportsHub live={live} today={today} upcoming={upcomingMatches} results={results} online={online} />
    {show('featured') && <TournamentShowcase state={tournaments} promoted={promoted} spotlight={spotlight} />}
    {show('news') && news.status === 'ready' && news.data.length > 0 && <section className="lp-section lp-news" id="news" aria-labelledby="news-title">
      <header className="ed-section-head"><h2 id="news-title">News &amp; Announcements</h2><a className="ed-link" href="#news">View all <ArrowRight size={14} aria-hidden="true" /></a></header>
      <ul className="lp-people">{news.data.slice(0, 4).map(item => <li key={String(item.id)}><a href={`#news/${encodeURIComponent(String(item.slug ?? item.id))}`}>
        <span className="lp-people-mark lp-people-team"><SportGlyph sport={String(item.content_type ?? 'news')} /></span>
        <span className="lp-people-text"><strong>{String(item.title)}</strong><small>{item.published_at ? new Date(String(item.published_at)).toLocaleDateString() : ''}</small></span>
      </a></li>)}</ul>
    </section>}
    <CommunitySpotlight results={results.data} showPlayers={show('top-players')} />

    <FinalCallToAction onCreateTournament={onCreateTournament} />
  </div>
}

// --- Hero match card ------------------------------------------------------------------------------
// "Tonight · 20:30", "Tomorrow · 16:00" or the date, all in Maldives time.
const MVT_ZONE = 'Indian/Maldives'
function heroWhen(iso: string | null): string {
  const time = formatMvtTime(iso)
  if (!iso || !time) return 'Next match · time to be confirmed'
  const dayOf = (value: Date) => value.toLocaleDateString('en-CA', { timeZone: MVT_ZONE })
  const at = new Date(iso)
  const now = new Date()
  if (dayOf(at) === dayOf(now)) return `${Number(new Intl.DateTimeFormat('en-GB', { timeZone: MVT_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(at)) >= 18 ? 'Tonight' : 'Today'} · ${time}`
  if (dayOf(at) === dayOf(new Date(now.getTime() + 86_400_000))) return `Tomorrow · ${time}`
  return `${formatDay(iso)} · ${time}`
}

function HeroMatch({ match }: { match: FeedMatch }) {
  const live = isLive(match.status)
  const score = officialScore(match)
  return <a className={`lp-hero-card lp-hero-match${live ? ' is-live' : ''}`} href={matchHref(match.id)} aria-label={`${live ? 'Live now' : 'Next match'}: ${teamLabel(match.home)} against ${teamLabel(match.away)}, ${match.tournamentName}`}>
    <span className="lp-hero-match-when">{live ? <><span className="ed-live-dot" aria-hidden="true" /> Live now</> : heroWhen(match.scheduledAt)}</span>
    <span className="lp-hero-match-teams">
      <span><TeamMark team={match.home} size="lg" /><strong>{teamLabel(match.home)}</strong></span>
      <b>{score ?? 'vs'}<i aria-hidden="true" /></b>
      <span><TeamMark team={match.away} size="lg" /><strong>{teamLabel(match.away)}</strong></span>
    </span>
    <small>{[match.tournamentName, match.venue].filter(Boolean).join(' · ')}</small>
  </a>
}

const SPORT_ORDER = ['football', 'futsal', 'volleyball', 'handball', 'basketball', 'basketball_3x3']
// A platform highlight (notice, sponsor, promoted tournament) when no match is published.
function HeroNote({ highlight, tournaments }: { highlight: Highlight; tournaments: Map<string, PublicRecord> }) {
  const tournament = highlight.tournamentId ? tournaments.get(highlight.tournamentId) : undefined
  const href = highlight.linkUrl || (tournament ? tournamentHref(tournament) : null)
  const external = Boolean(href && href.startsWith('https://'))
  const body = <><span className="lp-hero-match-when">{HIGHLIGHT_KIND_LABELS[highlight.kind]}</span><strong className="lp-hero-note-title">{highlight.title}</strong>{highlight.body ? <small>{highlight.body}</small> : null}</>
  return href ? <a className="lp-hero-card lp-hero-note" href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{body}</a> : <div className="lp-hero-card lp-hero-note">{body}</div>
}

// --- Find your sport ------------------------------------------------------------------------------
// Six release sports, each a direct filter link; the published count is read out to screen readers.
function BrowseBySport({ tournaments, ready, failed }: { tournaments: PublicRecord[]; ready: boolean; failed: boolean }) {
  const counts = new Map<string, number>()
  for (const row of tournaments) counts.set(String(row.sport ?? ''), (counts.get(String(row.sport ?? '')) ?? 0) + 1)
  const order = [...SPORT_ORDER.filter(key => (SPORT_KEYS_ALL as readonly string[]).includes(key)), ...SPORT_KEYS_ALL.filter(key => !SPORT_ORDER.includes(key))]
  return <section className="lp-section lp-sports" id="sports" aria-labelledby="sports-title">
    <header className="ed-section-head"><h2 id="sports-title">Find your sport</h2></header>
    <ul className="lp-sport-tiles">{order.map(key => { const count = counts.get(key) ?? 0; const label = !ready ? '' : failed ? '' : `${count} ${count === 1 ? 'tournament' : 'tournaments'}`; return <li key={key}><a className={sportClass(key)} href={`#tournaments?sport=${encodeURIComponent(key)}`} title={label || undefined}>
      <SportGlyph sport={key} /><strong>{key === 'basketball_3x3' ? <><span aria-hidden="true">3x3</span><span className="sr-only">3x3 Basketball</span></> : sportName(key)}</strong>{label ? <span className="sr-only">, {label}</span> : null}
    </a></li> })}</ul>
  </section>
}

// --- Match Center ------------------------------------------------------------------------------------
// Live, Today, Upcoming and Results, three match cards at a time. It opens on the
// first tab that has matches; a choice the visitor makes is kept.
const HUB_LIMIT = 3
type HubTab = 'live' | 'today' | 'upcoming' | 'results'
type FeedState = SectionState<FeedMatch[]> & { retry: () => void }
const HUB_TABS: Array<{ id: HubTab; label: string; href: string; empty: string }> = [
  { id: 'live', label: 'Live', href: '#live', empty: 'No matches are live right now.' },
  { id: 'today', label: 'Today', href: '#matches?tab=upcoming', empty: 'No published matches are scheduled for today.' },
  { id: 'upcoming', label: 'Upcoming', href: '#matches?tab=upcoming', empty: 'No upcoming published fixtures.' },
  { id: 'results', label: 'Results', href: '#matches?tab=results', empty: 'No official results have been published yet.' },
]
function SportsHub({ live, today, upcoming, results, online }: { live: FeedState; today: FeedState; upcoming: FeedState; results: FeedState; online: boolean }) {
  const now = useNow(10_000)
  const [chosen, setChosen] = useState<HubTab | null>(null)
  const states: Record<HubTab, FeedState> = { live, today, upcoming, results }
  const loaded = (Object.values(states)).every(state => state.status !== 'loading')
  const automatic: HubTab = live.data.some(match => isLive(match.status)) ? 'live' : today.data.length ? 'today' : upcoming.data.length ? 'upcoming' : results.data.length ? 'results' : 'live'
  const tab = chosen ?? (loaded ? automatic : 'live')
  const state = states[tab]
  const info = HUB_TABS.find(item => item.id === tab)!
  const matches = (tab === 'live' ? state.data.filter(match => isLive(match.status)) : state.data).slice(0, HUB_LIMIT)
  const stale = tab === 'live' && (!online || (live.error !== null && live.loadedAt !== null))
  return <section className="lp-section lp-hub" id="sports-hub" aria-labelledby="hub-title">
    <header className="ed-section-head"><h2 id="hub-title">Match Center</h2></header>
    <div className="lp-hub-bar">
      <div className="lp-tabs" role="tablist" aria-label="Matches">{HUB_TABS.map(item => <button type="button" role="tab" key={item.id} id={`hub-${item.id}`} aria-selected={tab === item.id} aria-controls="hub-panel" className={tab === item.id ? 'active' : ''} onClick={() => setChosen(item.id)}>{item.label}{item.id === 'live' && live.data.length ? <b>{live.data.length}</b> : null}</button>)}</div>
      {tab === 'live' && live.loadedAt ? <span className="lp-updated" aria-live="polite">{stale ? `Last updated at ${formatMvtTime(new Date(live.loadedAt).toISOString())} MVT` : `Updated ${timeAgo(live.loadedAt, now)}`}</span> : null}
    </div>
    <div id="hub-panel" role="tabpanel" aria-labelledby={`hub-${tab}`} aria-busy={state.status === 'loading'}>
      {stale && <p className="lp-stale" role="status">Live updates are temporarily unavailable. Scores shown may be out of date.</p>}
      {state.status === 'loading' ? <Skeleton kind="cards" />
        : state.status === 'error' && !state.loadedAt ? <SectionError onRetry={state.retry} message={state.error} />
          : state.needsMigration ? <MigrationNote />
            : matches.length ? <ul className="lp-match-cards">{matches.map(match => <li key={match.id}><MatchCard match={match} /></li>)}</ul>
              : <EmptyCard action={{ label: 'View All Matches', href: info.href }}>{info.empty}{tab === 'live' ? ' See Today or Upcoming for what is next.' : ''}</EmptyCard>}
    </div>
  </section>
}

function MatchCard({ match }: { match: FeedMatch }) {
  const status = matchStateLabel(match)
  const score = officialScore(match)
  const live = isLive(match.status)
  return <a className={`lp-mcard${live ? ' is-live' : ''}`} href={matchHref(match.id)}>
    <span className="lp-mcard-top"><small className="lp-mcard-meta">{[match.tournamentName, match.sport ? sportName(match.sport) : null].filter(Boolean).join(' · ')}</small><Chip tone={status.tone}>{status.label}</Chip></span>
    <span className="lp-mcard-teams">
      <span><TeamMark team={match.home} size="md" /><strong>{teamLabel(match.home)}</strong></span>
      <b className="lp-mcard-score">{score ?? 'v'}</b>
      <span><TeamMark team={match.away} size="md" /><strong>{teamLabel(match.away)}</strong></span>
    </span>
    <small className="lp-mcard-foot" title={match.venue ?? undefined}>{match.scheduledAt ? `${formatDay(match.scheduledAt)} · ${formatMvtTime(match.scheduledAt)} MVT` : 'Time to be confirmed'}</small>
  </a>
}

// --- Discover Tournaments -----------------------------------------------------------------------------
// Three cards: the spotlight, then promoted, open, live and upcoming tournaments;
// completed ones fill the row only when nothing current is published.
function TournamentShowcase({ state, promoted, spotlight }: { state: SectionState<TournamentData> & { retry: () => void }; promoted: string[]; spotlight: PublicRecord | null }) {
  const { tournaments, details, capacity } = state.data
  const rows = useMemo(() => {
    const current = tournaments.filter(row => !['completed', 'archived', 'cancelled', 'draft'].includes(String(row.status)))
    const rank = (row: PublicRecord) => promoted.includes(String(row.id)) ? 0 : row.status === 'registration_open' ? 1 : row.status === 'in_progress' ? 2 : 3
    const ordered = [...(spotlight ? [spotlight] : []), ...[...current].sort((a, b) => rank(a) - rank(b)).filter(row => row !== spotlight), ...completedTournaments(tournaments)]
    return ordered.filter((row, index) => ordered.findIndex(other => other.id === row.id) === index)
  }, [tournaments, promoted, spotlight]).slice(0, 3)
  return <section className="lp-section lp-showcase" id="featured" aria-labelledby="showcase-title">
    <header className="ed-section-head"><h2 id="showcase-title">Discover Tournaments</h2>
      <span className="lp-head-tools"><a className="ed-link lp-head-link" href="#tournaments">View all<span className="sr-only"> tournaments</span> <ArrowRight size={15} aria-hidden="true" /></a></span>
    </header>
    <Body state={state} skeleton="cards">
      {rows.length ? <ul className="lp-discover">{rows.map(record => <li key={String(record.id)}><TournamentTile record={record} detail={details.get(String(record.id))} capacity={capacity.get(String(record.id))} /></li>)}</ul>
        : <EmptyCard>No published tournaments are available yet.</EmptyCard>}
    </Body>
  </section>
}

// One tournament card for Home (compact) and the Tournaments page (full: team count and View Tournament).
export function TournamentTile({ record, detail, capacity, full = false }: { record: PublicRecord; detail?: TournamentDirectoryDetail; capacity?: Capacity; full?: boolean }) {
  const name = String(record.name ?? 'Published tournament')
  const sport = String(record.sport ?? '')
  const branding = publicTournamentBranding(record)
  const stage = tournamentStatus(record.status)
  const registration = registrationInfo(record.status, capacity, detail?.closesAt)
  const starts = formatDay(detail?.startsAt)
  const status = registration.canRegister ? { kind: 'open', icon: <Check size={14} aria-hidden="true" />, text: REGISTRATION_STATUS_TEXT[registration.status!] }
    : stage === 'active' ? { kind: 'live', icon: <span className="ed-live-dot" aria-hidden="true" />, text: 'Live' }
      : stage === 'upcoming' ? { kind: 'upcoming', icon: <Clock3 size={14} aria-hidden="true" />, text: TOURNAMENT_STATUS_TEXT.upcoming }
        : { kind: stage === 'completed' ? 'done' : 'warn', icon: stage === 'completed' ? <Trophy size={14} aria-hidden="true" /> : null, text: TOURNAMENT_STATUS_TEXT[stage] }
  const teams = capacity && capacity.approved > 0 ? capacity.approved : null
  return <a className={`lp-dcard${full ? ' lp-dcard-full' : ''}`} href={tournamentHref(record)}>
    <span className="lp-dcard-cover"><CoverScene sport={sport} /><TournamentCover client={publicSupabase} path={branding.coverPath} name={name} sport={sportClass(sport).replace('sport-', '')} /></span>
    <span className="lp-dcard-body">
      <span className="lp-dcard-badge"><TournamentLogo client={publicSupabase} path={branding.logoPath} name={name} className="lp-dcard-logo" /></span>
      <span className="lp-dcard-title"><strong>{name}</strong><small>{[sportName(sport), detail?.island].filter(Boolean).join(' · ')}</small></span>
      <span className="lp-dcard-foot">
        <span className="lp-dcard-facts">
          <span className="lp-dcard-date"><CalendarDays size={15} aria-hidden="true" /> {starts ? `From ${starts}` : 'Dates to be announced'}</span>
          {full && teams ? <span className="lp-dcard-date"><Users size={15} aria-hidden="true" /> {teams} {teams === 1 ? 'Team' : 'Teams'}</span> : null}
        </span>
        <span className={`lp-status lp-status-${status.kind}`}>{status.icon}{status.text}</span>
      </span>
      {registration.urgency ? <span className="lp-dcard-urgency"><Clock3 size={13} aria-hidden="true" /> {registration.urgency}</span> : null}
    </span>
    {full ? <span className="lp-dcard-cta">View Tournament <ArrowRight size={16} aria-hidden="true" /></span> : null}
  </a>
}

// --- Players & Teams -------------------------------------------------------------------------------
// Players are ranked by the published rating method (published players when no one
// qualifies yet); teams by official matches in the last 90 days, then the published
// list. Both lists load only once the section is near the screen.
const PEOPLE_LIMIT = 3
type CommunityItem = { id: string; name: string; href: string; image: string | null; detail: string }
function CommunitySpotlight({ results, showPlayers }: { results: FeedMatch[]; showPlayers: boolean }) {
  const [ref, near] = useNearScreen<HTMLElement>()
  const players = useSection<CommunityItem[]>(async () => {
    if (!publicSupabase) return { data: [], error: NOT_CONFIGURED }
    const ranked = await loadTopPlayers(publicSupabase)
    if (ranked.data.length) return { data: ranked.data.slice(0, PEOPLE_LIMIT).map(player => ({ id: player.id, name: player.name, href: `#player/${encodeURIComponent(player.slug)}`, image: player.photo, detail: [player.sport ? sportName(player.sport) : null, player.teamName].filter(Boolean).join(' · ') || `Rating ${player.rating.toFixed(1)}` })), error: null }
    const list = await getPublishedPlayers(publicSupabase)
    return { data: (list.data ?? []).slice(0, PEOPLE_LIMIT).map(row => ({ id: String(row.id), name: String(row.display_name), href: `#player/${encodeURIComponent(String(row.slug ?? row.id))}`, image: row.photo_url ? String(row.photo_url) : null, detail: [row.position, row.island].filter(Boolean).map(String).join(' · ') || 'Published player' })), error: list.error ?? ranked.error }
  }, [], 'players', near && showPlayers)
  const teams = useSection<CommunityItem[]>(async () => {
    if (!publicSupabase) return { data: [], error: NOT_CONFIGURED }
    const list = await getPublishedTeams(publicSupabase)
    const activity = new Map(activeTeams(results).map(team => [team.teamId, team.matches]))
    const rows = [...(list.data ?? [])].sort((a, b) => (activity.get(String(b.id)) ?? 0) - (activity.get(String(a.id)) ?? 0))
    return { data: rows.slice(0, PEOPLE_LIMIT).map(row => { const played = activity.get(String(row.id)); return { id: String(row.id), name: String(row.name), href: `#team/${encodeURIComponent(String(row.slug ?? row.id))}`, image: row.logo_url ? String(row.logo_url) : null, detail: [row.island, played ? `${played} official match${played === 1 ? '' : 'es'} in 90 days` : null].filter(Boolean).map(String).join(' · ') || 'Published team' } }), error: list.error }
  }, [], `teams:${results.length}`, near)
  return <section ref={ref} className="lp-section lp-community" id="community" aria-labelledby="community-title">
    <header className="ed-section-head"><h2 id="community-title">Players &amp; Teams</h2></header>
    <div className={`lp-people-cols${showPlayers ? '' : ' single'}`}>
      {showPlayers && <PeopleCard id="players" title="Players" icon={<Users size={20} aria-hidden="true" />} href="#players" state={players} empty="No published player profiles yet." kind="player" note={<details className="lp-method"><summary>How players are ranked</summary><p>{RATING_METHOD_SUMMARY} When no one has enough official matches yet, published players are listed instead.</p></details>} />}
      <PeopleCard id="teams" title="Teams" icon={<Shield size={20} aria-hidden="true" />} href="#teams" state={teams} empty="No published teams yet." kind="team" />
    </div>
  </section>
}

function PeopleCard({ id, title, icon, href, state, empty, kind, note }: { id: string; title: string; icon: ReactNode; href: string; state: SectionState<CommunityItem[]> & { retry: () => void }; empty: string; kind: 'player' | 'team'; note?: ReactNode }) {
  return <article className="lp-people-card" aria-labelledby={`people-${id}-title`}>
    <header><h3 id={`people-${id}-title`}>{icon} {title}</h3><a className="ed-link" href={href}>View all<span className="sr-only"> {title.toLowerCase()}</span> <ArrowRight size={14} aria-hidden="true" /></a></header>
    <Body state={state} skeleton="list">
      {state.data.length ? <ul className="lp-people">{state.data.map(item => <li key={item.id}><a href={item.href}>
        <span className={`lp-people-mark lp-people-${kind}`}>{kind === 'team' ? <TeamLogo name={item.name} logoUrl={item.image} size={38} /> : item.image ? <img src={item.image} alt="" loading="lazy" width={44} height={44} /> : <PersonAvatar />}</span>
        <span className="lp-people-text"><strong>{item.name}</strong><small>{item.detail}</small></span>
      </a></li>)}</ul> : <EmptyCard>{empty}</EmptyCard>}
    </Body>
    {note}
  </article>
}
