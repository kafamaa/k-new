import { useEffect, useMemo, useState } from 'react'
import { FormGuide } from './PublicExtras'
import { publicUrl, recentForm } from '../lib/publicExtras'
import { toCsv } from '../lib/tournamentPages'
import { downloadBlob } from '../lib/cardImage'
import type { ReactNode } from 'react'
import { ArrowRight, Building2, CalendarDays, ChevronLeft, ClipboardList, Flag, GitBranch, Info, ListOrdered, MapPin, Newspaper, PlayCircle, RefreshCw, Search, Shield, Trophy, UserRound } from 'lucide-react'
import { NumberedPager, PageBanner } from './IslandPage'
import { publicSupabase } from '../lib/supabase'
import { getPublishedMatches, getTournamentDirectoryDetails, searchPublished, type PublicRecord } from '../lib/publicData'
import { getPublishedNews, NEWS_CONTENT_LABELS, type NewsContentType } from '../lib/news'
import { bracketFromFeed, formatMvtTime, latestStandings, loadMatchFeed, maldivesDayKey, maldivesDayRange, matchStateLabel, officialScore, standingsColumns, teamLabel, timeAgo, type FeedMatch } from '../lib/landing'
import { formatDay, sportName, SPORT_NAMES } from '../lib/display'
import { Chip, Crest, ShareButton } from './Editorial'
import { CoverScene, PersonAvatar } from './HomeArt'
import { hashWithParams, pageSlice, readHashParams, type Params } from '../lib/directory'
import { loadPublicPeople, loadPublicPerson, PENDING_047, ROLE_LABELS, type PersonRole, type PublicPerson, type PublicPersonDetail } from '../lib/publicPeople'

// Public directory pages: Matches, Standings, Bracket, Search and News.
// Published records only; filters and the page number live in the URL so a
// refresh or a shared link shows the same view.

function useHashParams(): [Params, (patch: Params) => void] {
  const [params, setParams] = useState<Params>(() => readHashParams())
  const update = (patch: Params) => {
    const next = { ...params, ...patch }
    if (!('page' in patch)) next.page = ''
    setParams(next)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hashWithParams(window.location.hash, next)}`)
  }
  return [params, update]
}
export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null
  return <div className="pd-pager" aria-live="polite"><span className="pd-page-summary">Page {page} of {pages} · {total} results</span><NumberedPager page={page} pages={pages} onPage={onPage} /></div>
}

// Owner's island design: the photo banner (the eyebrow is kept for callers but not shown).
function Head({ title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <PageBanner title={title} subtitle={subtitle} />
}
function Skeleton() { return <div className="lp-skeleton" aria-hidden="true">{[0, 1, 2, 3, 4].map(index => <span key={index} className="skeleton" />)}</div> }
function Failed({ onRetry }: { onRetry: () => void }) { return <div className="lp-error" role="alert"><span><strong>This page could not be loaded.</strong><small>Check your connection and try again.</small></span><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={onRetry}><RefreshCw size={14} /> Retry</button></div> }
function EmptyBox({ children }: { children: ReactNode }) { return <p className="lp-empty">{children}</p> }
function Tabs<T extends string>({ label, items, active, onChange }: { label: string; items: Array<{ id: T; label: string; count?: number }>; active: T; onChange: (id: T) => void }) {
  return <div className="pw-subtabs" role="tablist" aria-label={label}>{items.map(item => <button type="button" role="tab" key={item.id} aria-selected={item.id === active} className={item.id === active ? 'active' : ''} onClick={() => onChange(item.id)}>{item.label}{item.count !== undefined ? <span className="ws-count">{item.count}</span> : null}</button>)}</div>
}
type Load<T> = { state: 'loading' | 'ready' | 'error'; data: T; legacy?: boolean }

// --- Matches ----------------------------------------------------------------------
type MatchTab = 'live' | 'today' | 'upcoming' | 'results'
export function MatchesDirectory({ legacy }: { legacy: (records: PublicRecord[]) => ReactNode }) {
  const [params, set] = useHashParams()
  // #live opens on the Live tab; #matches on Upcoming.
  const tab = (['live', 'today', 'upcoming', 'results'].includes(params.tab) ? params.tab : /^#\/?live/.test(window.location.hash) ? 'live' : 'upcoming') as MatchTab
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<Load<FeedMatch[]>>({ state: 'loading', data: [] })
  const [legacyRows, setLegacyRows] = useState<PublicRecord[] | null>(null)
  const [islands, setIslands] = useState<Map<string, string>>(new Map())
  useEffect(() => { document.title = 'Matches · Kulhivaru+' }, [])
  useEffect(() => {
    const client = publicSupabase
    if (!client) { setLoad({ state: 'error', data: [] }); return }
    let active = true
    setLoad(current => ({ ...current, state: 'loading' }))
    const query = tab === 'live' ? { statuses: ['live'], limit: 60 } : tab === 'today' ? { ...maldivesDayRange(), limit: 120 } : tab === 'results' ? { statuses: ['confirmed'], newestFirst: true, limit: 200 } : { from: new Date(Date.now() - 6 * 3600_000).toISOString(), statuses: ['scheduled', 'postponed', 'cancelled', 'awaiting_confirmation', 'abandoned'], limit: 200 }
    void loadMatchFeed(client, query).then(async result => {
      if (!active) return
      if (result.needsMigration) { const old = await getPublishedMatches(client); if (active) { setLegacyRows(old.data ?? []); setLoad({ state: old.error ? 'error' : 'ready', data: [], legacy: true }) } return }
      setLoad({ state: result.error ? 'error' : 'ready', data: result.data })
    })
    return () => { active = false }
  }, [tab, attempt])
  const filtered = useMemo(() => {
    const term = (params.q ?? '').trim().toLowerCase()
    return load.data.filter(match => (!params.sport || match.sport === params.sport) && (!params.tournament || match.tournamentId === params.tournament)
      && (!params.date || (match.scheduledAt && maldivesDayKey(match.scheduledAt) === params.date))
      && (!params.status || match.status === params.status)
      && (!params.island || islands.get(match.tournamentId) === params.island)
      && (!term || [teamLabel(match.home), teamLabel(match.away), match.tournamentName, match.venue ?? ''].some(value => value.toLowerCase().includes(term))))
  }, [load.data, params, islands])
  const tournaments = [...new Map(load.data.map(match => [match.tournamentId, match.tournamentName])).entries()]
  const tournamentKey = tournaments.map(([id]) => id).join(',')
  useEffect(() => {
    if (!publicSupabase || !tournamentKey) return
    let active = true
    void getTournamentDirectoryDetails(publicSupabase, tournamentKey.split(',')).then(details => { if (active) setIslands(new Map([...details].filter(([, detail]) => detail.island).map(([id, detail]) => [id, String(detail.island)]))) })
    return () => { active = false }
  }, [tournamentKey])
  const islandOptions = [...new Set(islands.values())].sort()
  const statuses = [...new Set(load.data.map(match => match.status))]
  const paged = pageSlice(filtered, Number(params.page))
  return <section className="public-page ed-page pd-page">
    <Head eyebrow="Competition" title="Matches & Live Scores" subtitle="Follow the action across the islands. All times Maldives time (MVT)." />
    {load.legacy ? <>{legacyRows ? legacy(legacyRows) : <Skeleton />}<p className="lp-empty lp-pending"><Info size={15} /> Upcoming and live fixtures, and scores, appear once the platform owner applies migration 032.</p></> : <>
      <Tabs label="Match view" active={tab} onChange={id => set({ tab: id, status: '' })} items={[{ id: 'live', label: 'Live' }, { id: 'today', label: 'Today' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'results', label: 'Results' }]} />
      <div className="pd-filters">
        <label className="ed-search-field"><Search size={15} aria-hidden="true" /><input aria-label="Search matches by team, tournament or venue" value={params.q ?? ''} onChange={event => set({ q: event.target.value })} placeholder="Team, tournament or venue" /></label>
        <label>Sport<select value={params.sport ?? ''} onChange={event => set({ sport: event.target.value })}><option value="">All sports</option>{Object.entries(SPORT_NAMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {islandOptions.length ? <label>Island<select value={params.island ?? ''} onChange={event => set({ island: event.target.value })}><option value="">All islands</option>{islandOptions.map(value => <option key={value} value={value}>{value}</option>)}</select></label> : null}
        <label>Tournament<select value={params.tournament ?? ''} onChange={event => set({ tournament: event.target.value })}><option value="">All tournaments</option>{tournaments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Date<input type="date" value={params.date ?? ''} onChange={event => set({ date: event.target.value })} /></label>
        {tab === 'upcoming' && statuses.length > 1 && <label>Status<select value={params.status ?? ''} onChange={event => set({ status: event.target.value })}><option value="">Any status</option>{statuses.map(status => <option key={status} value={status}>{matchStateLabel({ status, outcome: null }).label}</option>)}</select></label>}
      </div>
      {load.state === 'loading' ? <Skeleton /> : load.state === 'error' ? <Failed onRetry={() => setAttempt(value => value + 1)} />
        : paged.items.length ? <ul className="pd-matches">{paged.items.map(match => { const state = matchStateLabel(match); const score = officialScore(match); return <li key={match.id}><a href={`#matches/${encodeURIComponent(match.id)}`}>
          <time>{match.scheduledAt ? <>{formatDay(match.scheduledAt)}<b>{formatMvtTime(match.scheduledAt)}</b></> : 'Date to be confirmed'}</time>
          <span className="pd-teams"><span><Crest name={teamLabel(match.home)} logoUrl={match.home.logo} size="sm" />{teamLabel(match.home)}</span><b className="pd-score">{score ?? 'v'}</b><span><Crest name={teamLabel(match.away)} logoUrl={match.away.logo} size="sm" />{teamLabel(match.away)}</span></span>
          <small>{[match.tournamentName, match.stageName, match.groupName, sportName(match.sport), match.venue].filter(Boolean).join(' · ')}</small>
          <Chip tone={state.tone}>{state.label}{match.corrected ? ' · corrected' : ''}</Chip>
        </a></li> })}</ul>
          : <EmptyBox>{tab === 'live' ? 'No matches are live right now. See Today or Upcoming for what is next.' : tab === 'today' ? 'No published matches are scheduled for today.' : tab === 'results' ? 'No official results match these filters.' : 'No published fixtures match these filters.'}</EmptyBox>}
      <Pager page={paged.page} pages={paged.pages} total={filtered.length} onPage={page => set({ page: String(page) })} />
      <p className="pf-hint">Scores show only once confirmed. “Finished — awaiting confirmation” is not an official result.</p>
    </>}
  </section>
}

// --- Standings ----------------------------------------------------------------------
type Table = { stageId: string; stageName: string; tables: PublicRecord[][]; updated: number }
// embedded: shown inside one tournament's public page, fixed to that tournament.
export function StandingsDirectory({ tournamentId, embedded = false }: { tournamentId?: string; embedded?: boolean } = {}) {
  const [params, set] = useHashParams()
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<Load<{ rows: PublicRecord[]; feed: FeedMatch[] }>>({ state: 'loading', data: { rows: [], feed: [] } })
  useEffect(() => { if (!embedded) document.title = 'Standings · Kulhivaru+' }, [embedded])
  useEffect(() => {
    const client = publicSupabase
    if (!client) { setLoad({ state: 'error', data: { rows: [], feed: [] } }); return }
    let active = true
    setLoad(current => ({ ...current, state: 'loading' }))
    void Promise.all([
      client.from('standings_snapshots').select('stage_id,group_id,team_id,played,wins,draws,losses,scored,conceded,points,calculated_from_version,created_at,teams(name,slug,logo_url,is_published)').limit(1000),
      loadMatchFeed(client, { statuses: ['confirmed', 'scheduled', 'live'], limit: 200, newestFirst: true }),
    ]).then(([standings, feed]) => {
      if (!active) return
      if (standings.error) return setLoad({ state: 'error', data: { rows: [], feed: [] } })
      setLoad({ state: 'ready', data: { rows: latestStandings((standings.data ?? []) as PublicRecord[]), feed: feed.data }, legacy: feed.needsMigration })
    })
    return () => { active = false }
  }, [attempt])
  // Each table's tournament comes from its published matches, never a guess.
  const byTournament = useMemo(() => {
    const stageInfo = new Map(load.data.feed.map(match => [match.stageId, { tournamentId: match.tournamentId, tournamentName: match.tournamentName, stageName: match.stageName ?? 'Table', sport: match.sport }]))
    const result = new Map<string, { name: string; sport: string; stages: Map<string, Table> }>()
    for (const row of load.data.rows) {
      const info = stageInfo.get(String(row.stage_id)); if (!info) continue
      const tournament = result.get(info.tournamentId) ?? { name: info.tournamentName, sport: info.sport, stages: new Map() }
      const stage = tournament.stages.get(String(row.stage_id)) ?? { stageId: String(row.stage_id), stageName: info.stageName, tables: [], updated: 0 }
      const groupIndex = [...new Set(load.data.rows.filter(other => other.stage_id === row.stage_id).map(other => String(other.group_id ?? '')))].indexOf(String(row.group_id ?? ''))
      stage.tables[groupIndex] = [...(stage.tables[groupIndex] ?? []), row]
      stage.updated = Math.max(stage.updated, Date.parse(String(row.created_at ?? '')) || 0)
      tournament.stages.set(stage.stageId, stage); result.set(info.tournamentId, tournament)
    }
    return result
  }, [load.data])
  const ids = [...byTournament.keys()]
  const chosen = tournamentId ?? (params.tournament && byTournament.has(params.tournament) ? params.tournament : ids[0])
  const tournament = chosen ? byTournament.get(chosen) : undefined
  const columns = standingsColumns(tournament?.sport ?? '')
  const sort = (rows: PublicRecord[]) => [...rows].sort((a, b) => Number(b.points) - Number(a.points) || (Number(b.scored) - Number(b.conceded)) - (Number(a.scored) - Number(a.conceded)) || Number(b.scored) - Number(a.scored))
  // Form guide: the last five official results in this tournament, newest first.
  const formMatches = load.data.feed.filter(match => match.tournamentId === chosen).map(match => ({ status: match.status, home_team_id: match.home.id, away_team_id: match.away.id, home_score: match.homeScore, away_score: match.awayScore, scheduled_at: match.scheduledAt }))
  const teamLabel = (row: PublicRecord) => { const team = (Array.isArray(row.teams) ? row.teams[0] : row.teams) as PublicRecord | null; return team?.is_published === true ? String(team.name ?? 'Team') : 'Team' }
  const [copied, setCopied] = useState(false)
  const download = () => {
    if (!tournament) return
    const lines = [...tournament.stages.values()].flatMap(stage => stage.tables.flatMap((rows, index) => sort(rows).map((row, position) => [stage.stageName + (stage.tables.length > 1 ? ` · group ${index + 1}` : ''), position + 1, teamLabel(row), ...columns.map(column => column.key === 'difference' ? Number(row.scored ?? 0) - Number(row.conceded ?? 0) : String(row[column.key] ?? 0))])))
    downloadBlob(new Blob([toCsv(['Stage', 'Position', 'Team', ...columns.map(column => column.title)], lines)], { type: 'text/csv;charset=utf-8' }), `${tournament.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-standings.csv`)
  }
  const share = async () => {
    const url = publicUrl(`#standings?tournament=${encodeURIComponent(chosen ?? '')}`)
    try { if (navigator.share) await navigator.share({ title: `${tournament?.name ?? ''} standings`, url }); else { await navigator.clipboard.writeText(url); setCopied(true) } } catch { /* the person closed the share sheet */ }
  }
  return <section className={embedded ? 'pd-embedded' : 'public-page ed-page pd-page'}>
    {!embedded && <Head eyebrow="Competition" title="Standings" subtitle="Every result. Every position." />}
    {load.state === 'loading' ? <Skeleton /> : load.state === 'error' ? <Failed onRetry={() => setAttempt(value => value + 1)} />
      : load.legacy ? <p className="lp-empty lp-pending"><Info size={15} /> Standings tables appear here once the platform owner applies migration 032 (it links each table to its tournament).</p>
        : !tournament ? <EmptyBox>No published standings yet. Tables appear once results are confirmed.</EmptyBox>
          : <>
            {!embedded && ids.length > 1 && <label className="pd-select">Tournament<select value={chosen} onChange={event => set({ tournament: event.target.value })}>{ids.map(id => <option key={id} value={id}>{byTournament.get(id)?.name}</option>)}</select></label>}
            {!embedded && <h2 className="ed-subhead">{tournament.name}</h2>}
            <div className="px-actions"><button type="button" className="ed-btn ed-btn-ghost" onClick={download}>Download table</button><button type="button" className="ed-btn ed-btn-ghost" onClick={() => void share()}>{copied ? 'Link copied' : 'Share standings'}</button></div>
            {[...tournament.stages.values()].map(stage => <section key={stage.stageId} className="pd-stage" aria-label={stage.stageName}>
              <h3>{stage.stageName}</h3>
              {stage.tables.map((rows, index) => <div key={index} className="ed-table-wrap" tabIndex={0} role="region" aria-label={`${stage.stageName}${stage.tables.length > 1 ? ` table ${index + 1}` : ''}`}>
                {stage.tables.length > 1 && <p className="pd-group">Group table {index + 1}</p>}
                <table className="ed-table"><thead><tr><th scope="col">#</th><th scope="col">Team</th>{columns.map(column => <th key={column.key} scope="col"><abbr title={column.title}>{column.label}</abbr></th>)}<th scope="col"><abbr title="Last five official results, newest first">Form</abbr></th></tr></thead>
                  <tbody>{sort(rows).map((row, position) => { const team = (Array.isArray(row.teams) ? row.teams[0] : row.teams) as PublicRecord | null; const published = team?.is_published === true; const name = published ? String(team?.name ?? 'Team') : 'Team'; const difference = Number(row.scored ?? 0) - Number(row.conceded ?? 0); return <tr key={String(row.team_id)}><td>{position + 1}</td><td><span className="ed-cell-team"><Crest name={name} logoUrl={published ? String(team?.logo_url ?? '') || null : null} size="sm" />{published && team?.slug ? <a href={`#team/${encodeURIComponent(String(team.slug))}`}>{name}</a> : name}</span></td>{columns.map(column => <td key={column.key}>{column.key === 'difference' ? (difference > 0 ? `+${difference}` : difference) : column.key === 'points' ? <b>{String(row.points ?? 0)}</b> : String(row[column.key] ?? 0)}</td>)}<td><FormGuide form={recentForm(String(row.team_id), formMatches)} /></td></tr> })}</tbody></table>
              </div>)}
              {stage.updated > 0 && <p className="lp-updated">Updated {timeAgo(stage.updated)}</p>}
            </section>)}
            <p className="pf-hint">Order: points, then {columns.some(column => column.key === 'difference') ? 'difference' : 'goal difference'}, then scored. The organizer’s configured tie-breakers decide the official table. Unconfirmed results are never counted.</p>
          </>}
  </section>
}

// --- Bracket -------------------------------------------------------------------------
export function BracketDirectory({ tournamentId, embedded = false }: { tournamentId?: string; embedded?: boolean } = {}) {
  const [params, set] = useHashParams()
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<Load<FeedMatch[]>>({ state: 'loading', data: [] })
  useEffect(() => { if (!embedded) document.title = 'Bracket · Kulhivaru+' }, [embedded])
  useEffect(() => {
    const client = publicSupabase
    if (!client) { setLoad({ state: 'error', data: [] }); return }
    let active = true
    void loadMatchFeed(client, { limit: 200, newestFirst: true }).then(result => { if (active) setLoad({ state: result.error && !result.needsMigration ? 'error' : 'ready', data: result.data, legacy: result.needsMigration }) })
    return () => { active = false }
  }, [attempt])
  const candidates = [...new Map(load.data.filter(match => ['knockout', 'two_leg', 'groups_knockout'].includes(match.stageFormat ?? '')).map(match => [match.tournamentId, match.tournamentName])).entries()]
  const chosen = tournamentId ? (candidates.some(([id]) => id === tournamentId) ? tournamentId : undefined) : params.tournament && candidates.some(([id]) => id === params.tournament) ? params.tournament : candidates[0]?.[0]
  const [rounds, setRounds] = useState<ReturnType<typeof bracketFromFeed>>([])
  // Phones show one round at a time (Previous / Next); wider screens show them all.
  const [roundIndex, setRoundIndex] = useState(0)
  useEffect(() => {
    const client = publicSupabase
    if (!client || !chosen) { setRounds([]); return }
    let active = true
    void loadMatchFeed(client, { tournamentId: chosen, limit: 200 }).then(result => { if (active) setRounds(bracketFromFeed(result.data, chosen)) })
    return () => { active = false }
  }, [chosen])
  const [view, setView] = useState<'bracket' | 'list'>('bracket')
  return <section className={embedded ? 'pd-embedded' : 'public-page ed-page pd-page'}>
    {!embedded && <Head eyebrow="Competition" title="Knockout Bracket" subtitle="Follow the road to the final." />}
    {load.state === 'loading' ? <Skeleton /> : load.state === 'error' ? <Failed onRetry={() => setAttempt(value => value + 1)} />
      : load.legacy ? <p className="lp-empty lp-pending"><Info size={15} /> Brackets appear here once the platform owner applies migration 032.</p>
        : !chosen ? <EmptyBox>{embedded ? 'This tournament has no published knockout round yet.' : 'No published knockout draw yet.'}</EmptyBox> : <>
          <div className="pd-filters">
            {!embedded && candidates.length > 1 && <label>Tournament<select value={chosen} onChange={event => set({ tournament: event.target.value })}>{candidates.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
            <div className="pw-segments" role="radiogroup" aria-label="Bracket view">{(['bracket', 'list'] as const).map(id => <button type="button" role="radio" key={id} aria-checked={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{id === 'bracket' ? 'Bracket' : 'Stage list'}</button>)}</div>
          </div>
          {!rounds.length ? <Skeleton /> : view === 'bracket' ? <><div className="pd-round-pager"><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={Math.min(roundIndex, rounds.length - 1) <= 0} onClick={() => setRoundIndex(value => Math.max(0, Math.min(value, rounds.length - 1) - 1))}>Previous round</button><span aria-live="polite">{rounds[Math.min(roundIndex, rounds.length - 1)]?.label} · {Math.min(roundIndex, rounds.length - 1) + 1} of {rounds.length}</span><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={Math.min(roundIndex, rounds.length - 1) >= rounds.length - 1} onClick={() => setRoundIndex(value => Math.min(rounds.length - 1, value + 1))}>Next round</button></div><div className="lp-bracket pd-bracket" tabIndex={0} role="region" aria-label="Bracket">{rounds.map((round, roundPosition) => <div key={round.stageId} className={`lp-round${roundPosition === Math.min(roundIndex, rounds.length - 1) ? ' is-current' : ''}`}><strong>{round.label}</strong>{round.ties.map(tie => <a key={tie.id} href={`#matches/${encodeURIComponent(tie.id)}`}>
            <span className={tie.winner === 'home' ? 'won' : ''}>{teamLabel(tie.home)}<b>{tie.score ? tie.score.split('–')[0] : ''}</b></span>
            <span className={tie.winner === 'away' ? 'won' : ''}>{tie.away.id ? teamLabel(tie.away) : 'Bye'}<b>{tie.score ? tie.score.split('–')[1] : ''}</b></span>
            <small>{[tie.label, formatDay(tie.scheduledAt)].filter(Boolean).join(' · ') || 'Date to be confirmed'}</small>
          </a>)}</div>)}</div></>
            : <ol className="pd-stage-list">{rounds.map(round => <li key={round.stageId}><h3>{round.label}</h3><ul>{round.ties.map(tie => <li key={tie.id}><a href={`#matches/${encodeURIComponent(tie.id)}`}>{teamLabel(tie.home)} v {tie.away.id ? teamLabel(tie.away) : 'Bye'}</a> — {tie.score ? `${tie.score}${tie.winner ? `, ${teamLabel(tie.winner === 'home' ? tie.home : tie.away)} advance` : ''}` : 'not played yet'}{tie.label ? ` (${tie.label})` : ''}</li>)}</ul></li>)}</ol>}
        </>}
  </section>
}

// --- Search ----------------------------------------------------------------------------
type SearchType = 'all' | 'tournaments' | 'teams' | 'players' | 'organizations' | 'matches' | 'news'
const SEARCH_TYPES: Array<{ id: SearchType; label: string; icon: typeof Trophy }> = [{ id: 'all', label: 'All', icon: Search }, { id: 'tournaments', label: 'Tournaments', icon: Trophy }, { id: 'teams', label: 'Teams', icon: Shield }, { id: 'players', label: 'Players', icon: UserRound }, { id: 'organizations', label: 'Organizations', icon: Building2 }, { id: 'matches', label: 'Matches', icon: CalendarDays }, { id: 'news', label: 'News', icon: Newspaper }]
type Hit = { type: Exclude<SearchType, 'all'>; label: string; detail: string; href: string; image: string | null }
export function SearchDirectory({ initialQuery }: { initialQuery: string }) {
  const [params, set] = useHashParams()
  const [input, setInput] = useState(initialQuery)
  const query = (params.q ?? initialQuery).trim()
  const type = (SEARCH_TYPES.some(item => item.id === params.type) ? params.type : 'all') as SearchType
  const [hits, setHits] = useState<{ state: 'idle' | 'loading' | 'ready'; data: Hit[]; failed: string[] }>({ state: 'idle', data: [], failed: [] })
  useEffect(() => { document.title = query ? `“${query}” · Search · Kulhivaru+` : 'Search · Kulhivaru+' }, [query])
  // Debounced: the URL follows typing after a short pause.
  useEffect(() => { const timer = window.setTimeout(() => { if (input.trim() !== query) set({ q: input.trim() }) }, 300); return () => window.clearTimeout(timer) }, [input]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const client = publicSupabase
    if (!client || query.length < 2) { setHits({ state: 'idle', data: [], failed: [] }); return }
    let active = true
    setHits(current => ({ ...current, state: 'loading' }))
    const term = query.toLowerCase()
    void Promise.all([
      searchPublished(client, query),
      getPublishedNews(client),
      loadMatchFeed(client, { limit: 200, newestFirst: true }),
    ]).then(([records, news, feed]) => {
      if (!active) return
      const failed: string[] = []
      const data: Hit[] = []
      if (records.error) failed.push('tournaments, teams, players and organizations')
      const groups = records.data ?? {}
      for (const row of groups.tournaments ?? []) data.push({ type: 'tournaments', label: String(row.name), detail: sportName(row.sport), href: `#tournament/${encodeURIComponent(String(row.slug ?? row.id))}`, image: null })
      for (const row of groups.teams ?? []) data.push({ type: 'teams', label: String(row.name), detail: [row.team_type, row.island].filter(Boolean).map(String).join(' · '), href: `#team/${encodeURIComponent(String(row.slug ?? row.id))}`, image: String(row.logo_url ?? '') || null })
      for (const row of groups.players ?? []) data.push({ type: 'players', label: String(row.display_name), detail: String(row.island ?? ''), href: `#player/${encodeURIComponent(String(row.slug ?? row.id))}`, image: String(row.photo_url ?? '') || null })
      for (const row of groups.organizations ?? []) data.push({ type: 'organizations', label: String(row.name), detail: String(row.description ?? '').slice(0, 90), href: `#organization/${encodeURIComponent(String(row.slug ?? row.id))}`, image: null })
      if (news.error) failed.push('news')
      for (const row of (news.data ?? []).filter(item => [item.title, item.excerpt].some(value => String(value ?? '').toLowerCase().includes(term))).slice(0, 30)) data.push({ type: 'news', label: String(row.title), detail: `${NEWS_CONTENT_LABELS[String(row.content_type) as NewsContentType] ?? 'News'}${row.published_at ? ` · ${formatDay(row.published_at)}` : ''}`, href: `#news/${encodeURIComponent(String(row.slug ?? row.id))}`, image: null })
      if (feed.error && !feed.needsMigration) failed.push('matches')
      for (const match of feed.data.filter(item => [teamLabel(item.home), teamLabel(item.away), item.tournamentName].some(value => value.toLowerCase().includes(term))).slice(0, 30)) data.push({ type: 'matches', label: `${teamLabel(match.home)} v ${teamLabel(match.away)}`, detail: [match.tournamentName, formatDay(match.scheduledAt), matchStateLabel(match).label].filter(Boolean).join(' · '), href: `#matches/${encodeURIComponent(match.id)}`, image: null })
      setHits({ state: 'ready', data, failed })
    })
    return () => { active = false }
  }, [query])
  const counts = Object.fromEntries(SEARCH_TYPES.map(item => [item.id, item.id === 'all' ? hits.data.length : hits.data.filter(hit => hit.type === item.id).length]))
  const shown = type === 'all' ? hits.data : hits.data.filter(hit => hit.type === type)
  const best = type === 'all' ? hits.data.filter(hit => hit.label.toLowerCase() === query.toLowerCase() || hit.label.toLowerCase().startsWith(query.toLowerCase())).slice(0, 3) : []
  const paged = pageSlice(shown, Number(params.page))
  const iconFor = (kind: Hit['type']) => SEARCH_TYPES.find(item => item.id === kind)!.icon
  return <section className="public-page ed-page pd-page">
    <Head eyebrow="Search" title={query ? `Results for “${query}”` : 'Search Kulhivaru+'} subtitle="Find competitions, teams, players and organizers." />
    <form className="pd-search" role="search" onSubmit={event => { event.preventDefault(); set({ q: input.trim() }) }}><Search size={18} aria-hidden="true" /><input aria-label="Search published records" value={input} maxLength={60} onChange={event => setInput(event.target.value)} placeholder="Search by name, team, tournament or island" /><button type="submit" className="ed-btn ed-btn-primary ed-btn-sm">Search</button></form>
    {query.length < 2 ? <EmptyBox>Type at least 2 characters to search.</EmptyBox> : <>
      <Tabs label="Result type" active={type} onChange={id => set({ type: id === 'all' ? '' : id })} items={SEARCH_TYPES.map(item => ({ id: item.id, label: item.label, count: hits.state === 'ready' ? counts[item.id] : undefined }))} />
      <p className="sr-only" aria-live="polite">{hits.state === 'loading' ? 'Searching' : `${shown.length} results`}</p>
      {hits.failed.length > 0 && <p className="lp-stale" role="status">Some results could not be loaded right now: {hits.failed.join(', ')}.</p>}
      {hits.state === 'loading' ? <Skeleton /> : !shown.length ? <EmptyBox>No published {type === 'all' ? 'records' : SEARCH_TYPES.find(item => item.id === type)?.label.toLowerCase()} match “{query}”. Try another spelling, sport, team or island.</EmptyBox> : <>
        {best.length > 0 && paged.page === 1 && <section className="pd-best" aria-label="Best matches"><h2 className="ed-subhead">Best matches</h2><div className="pd-best-grid">{best.map(hit => { const Icon = iconFor(hit.type); return <a key={`b-${hit.href}`} href={hit.href}><span className="lp-trend-type"><Icon size={13} /> {SEARCH_TYPES.find(item => item.id === hit.type)?.label.replace(/s$/, '')}</span><strong>{hit.label}</strong>{hit.detail && <small>{hit.detail}</small>}</a> })}</div></section>}
        <ul className="ed-list ed-list-rows pd-hits">{paged.items.map(hit => { const Icon = iconFor(hit.type); return <li key={`${hit.type}-${hit.href}`}><a href={hit.href}><span className="pd-hit-mark">{hit.image ? <img src={hit.image} alt="" width={36} height={36} loading="lazy" /> : <Icon size={16} aria-hidden="true" />}</span><span className="ed-list-text"><strong>{hit.label}</strong><small>{SEARCH_TYPES.find(item => item.id === hit.type)?.label.replace(/s$/, '')}{hit.detail ? ` · ${hit.detail}` : ''}</small></span><ArrowRight size={15} /></a></li> })}</ul>
        <Pager page={paged.page} pages={paged.pages} total={shown.length} onPage={page => set({ page: String(page) })} />
      </>}
    </>}
  </section>
}

// --- News -------------------------------------------------------------------------------
export function NewsDirectory() {
  const [params, set] = useHashParams()
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<Load<{ news: PublicRecord[]; organizations: Map<string, string> }>>({ state: 'loading', data: { news: [], organizations: new Map() } })
  useEffect(() => { document.title = 'News · Kulhivaru+' }, [])
  useEffect(() => {
    const client = publicSupabase
    if (!client) { setLoad({ state: 'error', data: { news: [], organizations: new Map() } }); return }
    let active = true
    setLoad(current => ({ ...current, state: 'loading' }))
    void getPublishedNews(client).then(async news => {
      if (!active) return
      if (news.error) return setLoad({ state: 'error', data: { news: [], organizations: new Map() } })
      const ids = [...new Set((news.data ?? []).map(row => String(row.organization_id ?? '')).filter(Boolean))]
      const organizations = ids.length ? await client.from('organizations').select('id,name').eq('is_published', true).in('id', ids) : { data: [] }
      if (active) setLoad({ state: 'ready', data: { news: news.data ?? [], organizations: new Map(((organizations.data ?? []) as PublicRecord[]).map(row => [String(row.id), String(row.name)])) } })
    })
    return () => { active = false }
  }, [attempt])
  const term = (params.q ?? '').trim().toLowerCase()
  const filtered = load.data.news.filter(row => (!term || [row.title, row.excerpt].some(value => String(value ?? '').toLowerCase().includes(term))) && (!params.category || row.content_type === params.category) && (!params.organization || row.organization_id === params.organization))
    .sort((a, b) => (params.sort === 'oldest' ? 1 : -1) * String(a.published_at ?? '').localeCompare(String(b.published_at ?? '')))
  const categories = [...new Set(load.data.news.map(row => String(row.content_type ?? 'news')))]
  const paged = pageSlice(filtered, Number(params.page), 12)
  return <section className="public-page ed-page pd-page news-directory">
    <Head eyebrow="Stories" title="News & Updates" subtitle="Stories from our island sporting community." />
    <div className="pd-filters">
      <label className="ed-search-field"><Search size={15} aria-hidden="true" /><input aria-label="Search news" value={params.q ?? ''} onChange={event => set({ q: event.target.value })} placeholder="Search stories" /></label>
      <label>Category<select value={params.category ?? ''} onChange={event => set({ category: event.target.value })}><option value="">All categories</option>{categories.map(value => <option key={value} value={value}>{NEWS_CONTENT_LABELS[value as NewsContentType] ?? value}</option>)}</select></label>
      {load.data.organizations.size > 1 && <label>Organization<select value={params.organization ?? ''} onChange={event => set({ organization: event.target.value })}><option value="">All organizations</option>{[...load.data.organizations].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
      <label>Sort<select value={params.sort ?? ''} onChange={event => set({ sort: event.target.value })}><option value="">Newest first</option><option value="oldest">Oldest first</option></select></label>
    </div>
    {load.state === 'loading' ? <Skeleton /> : load.state === 'error' ? <Failed onRetry={() => setAttempt(value => value + 1)} />
      : !paged.items.length ? <EmptyBox>{load.data.news.length ? 'No stories match these filters.' : 'No published news yet.'}</EmptyBox>
        : <div className="ed-news pd-news-grid">{paged.items.map((record, index) => <a className={`ed-news-item${index === 0 && paged.page === 1 ? ' lead' : ''}`} href={`#news/${encodeURIComponent(String(record.slug ?? record.id))}`} key={String(record.id)}>
          <span className="pd-news-image">{record.cover_image_url ? <img src={String(record.cover_image_url)} alt="" loading="lazy" /> : <CoverScene sport="" />}</span><span className="pd-news-copy">
          <small>{NEWS_CONTENT_LABELS[String(record.content_type) as NewsContentType] ?? 'News'}{record.published_at ? ` · ${formatDay(record.published_at)}` : ''}{load.data.organizations.get(String(record.organization_id ?? '')) ? ` · ${load.data.organizations.get(String(record.organization_id))}` : ''}</small>
          <strong>{String(record.title)}</strong>{record.excerpt ? <span>{String(record.excerpt)}</span> : null}<span className="pd-news-read">Read story <ArrowRight size={16} aria-hidden="true" /></span></span>
        </a>)}</div>}
    <Pager page={paged.page} pages={paged.pages} total={filtered.length} onPage={page => set({ page: String(page) })} />
  </section>
}


// --- One tournament's published schedule (tournament page, Schedule tab) ----------
export function TournamentSchedule({ tournamentId }: { tournamentId: string }) {
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<Load<FeedMatch[]>>({ state: 'loading', data: [] })
  useEffect(() => {
    const client = publicSupabase
    if (!client) { setLoad({ state: 'error', data: [] }); return }
    let active = true
    void loadMatchFeed(client, { tournamentId, limit: 200 }).then(result => { if (active) setLoad({ state: result.error && !result.needsMigration ? 'error' : 'ready', data: result.data, legacy: result.needsMigration }) })
    return () => { active = false }
  }, [tournamentId, attempt])
  if (load.state === 'loading') return <Skeleton />
  if (load.state === 'error') return <Failed onRetry={() => setAttempt(value => value + 1)} />
  if (load.legacy) return <p className="lp-empty lp-pending"><Info size={15} /> The full schedule appears once the platform owner applies migration 032. Confirmed results are under Results.</p>
  if (!load.data.length) return <EmptyBox>No published fixtures yet. The schedule appears once the organizer publishes the draw.</EmptyBox>
  const byDay = new Map<string, FeedMatch[]>()
  for (const match of load.data) { const key = match.scheduledAt ? maldivesDayKey(match.scheduledAt) : 'tbc'; byDay.set(key, [...(byDay.get(key) ?? []), match]) }
  return <div className="pd-page">{[...byDay].map(([day, matches]) => <section key={day} aria-label={day === 'tbc' ? 'Date to be confirmed' : formatDay(`${day}T12:00:00Z`) ?? day}>
    <h3 className="pd-group">{day === 'tbc' ? 'Date to be confirmed' : formatDay(`${day}T12:00:00Z`)}</h3>
    <ul className="pd-matches">{matches.map(match => { const state = matchStateLabel(match); const score = officialScore(match); return <li key={match.id}><a href={`#matches/${encodeURIComponent(match.id)}`}>
      <time>{match.scheduledAt ? <b>{formatMvtTime(match.scheduledAt)}</b> : 'TBC'}</time>
      <span className="pd-teams"><span><Crest name={teamLabel(match.home)} logoUrl={match.home.logo} size="sm" />{teamLabel(match.home)}</span><b className="pd-score">{score ?? 'v'}</b><span><Crest name={teamLabel(match.away)} logoUrl={match.away.logo} size="sm" />{teamLabel(match.away)}</span></span>
      <small>{[match.stageName, match.groupName, match.venue].filter(Boolean).join(' · ')}</small>
      <Chip tone={state.tone}>{state.label}</Chip>
    </a></li> })}</ul>
  </section>)}<p className="pf-hint">Times are Maldives time (MVT). Only official results show a score.</p></div>
}

// --- Coaches and referees (#coaches, #referees, #coach/<id>, #referee/<id>) --------------
// Only people who switched on their own public profile appear (migration 047).
export function PeopleDirectory({ role }: { role: PersonRole }) {
  const [params, set] = useHashParams()
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<{ state: 'loading' | 'ready' | 'error'; data: PublicPerson[]; pending?: boolean }>({ state: 'loading', data: [] })
  const label = ROLE_LABELS[role]
  const search = params.q ?? ''
  useEffect(() => { document.title = `${label.many} · Kulhivaru+` }, [label.many])
  useEffect(() => {
    const client = publicSupabase
    if (!client) { setLoad({ state: 'error', data: [] }); return }
    let active = true
    const timer = window.setTimeout(() => {
      setLoad(current => ({ ...current, state: 'loading' }))
      void loadPublicPeople(client, role, search).then(result => { if (active) setLoad({ state: result.state === 'error' ? 'error' : 'ready', data: result.data, pending: result.state === 'pending' }) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [role, search, attempt])
  const paged = pageSlice(load.data, Number(params.page), 24)
  return <section className="public-page ed-page pd-page people-directory">
    <Head eyebrow="Directory" title={role === 'coach' ? 'Find a Coach' : 'Find a Referee'} subtitle={role === 'coach' ? 'Coaches who chose to show a public profile, with the published teams they coach.' : 'Match officials who chose to show a public profile, with their official matches.'} />
    <div className="pd-filters"><label className="ed-search-field"><Search size={15} aria-hidden="true" /><input aria-label={`Search ${label.many.toLowerCase()}`} value={search} onChange={event => set({ q: event.target.value })} placeholder="Search by name or island" /></label></div>
    {load.state === 'loading' ? <Skeleton /> : load.state === 'error' ? <Failed onRetry={() => setAttempt(value => value + 1)} />
      : load.pending ? <p className="lp-empty lp-pending"><Info size={15} /> {PENDING_047}</p>
        : !paged.items.length ? <EmptyBox>{search ? `No ${label.many.toLowerCase()} match this search.` : `No ${label.many.toLowerCase()} have a public profile yet. ${label.many} can switch one on in Account Settings.`}</EmptyBox>
          : <><p className="people-result-count" role="status">{load.data.length} public {load.data.length === 1 ? label.one.toLowerCase() : label.many.toLowerCase()}</p>
          <ul className="people-grid">{paged.items.map(person => <li key={person.publicId}>
            <article className="people-card">
              <div className="people-card-identity"><span className="people-avatar"><UserRound size={34} aria-hidden="true" /></span><div><h2>{person.name}</h2><span className="people-role">{label.one}</span></div></div>
              <p className="people-location"><MapPin size={16} aria-hidden="true" />{person.island ?? 'Maldives'}</p>
              <p className="people-count">{role === 'referee' ? `${person.matchesOfficiated} official match${person.matchesOfficiated === 1 ? '' : 'es'}` : `${person.teamsCoached} published team${person.teamsCoached === 1 ? '' : 's'}`}</p>
              {person.bio && <p className="people-card-bio">{person.bio}</p>}
              <a className="ed-btn ed-btn-ghost" href={`#${role}/${person.publicId}`}>View Profile <ArrowRight size={16} aria-hidden="true" /></a>
            </article>
          </li>)}</ul></>}
    <Pager page={paged.page} pages={paged.pages} total={load.data.length} onPage={page => set({ page: String(page) })} />
    <p className="pf-hint">Profiles show only what each person chose to publish. Contact details are never shown.</p>
  </section>
}

export function PersonPage({ role, publicId }: { role: PersonRole; publicId: string }) {
  const [attempt, setAttempt] = useState(0)
  const [tab, setTab] = useState<'overview' | 'records'>('overview')
  const [load, setLoad] = useState<{ state: 'loading' | 'ready' | 'error'; data: PublicPersonDetail | null; pending?: boolean }>({ state: 'loading', data: null })
  useEffect(() => {
    const client = publicSupabase
    if (!client) { setLoad({ state: 'error', data: null }); return }
    let active = true
    void loadPublicPerson(client, publicId).then(result => { if (active) setLoad({ state: result.state === 'error' ? 'error' : 'ready', data: result.data, pending: result.state === 'pending' }) })
    return () => { active = false }
  }, [publicId, attempt])
  const person = load.data && load.data.role === role ? load.data : null
  useEffect(() => { document.title = person ? `${person.name} · ${ROLE_LABELS[role].one} · Kulhivaru+` : `${ROLE_LABELS[role].one} · Kulhivaru+` }, [person, role])
  const back = <a className="back-link" href={`#${role === 'coach' ? 'coaches' : 'referees'}`}><ChevronLeft size={14} /> All {ROLE_LABELS[role].many.toLowerCase()}</a>
  if (load.state === 'loading') return <section className="public-page ed-page pd-page">{back}<Skeleton /></section>
  if (load.state === 'error') return <section className="public-page ed-page pd-page">{back}<Failed onRetry={() => setAttempt(value => value + 1)} /></section>
  if (load.pending) return <section className="public-page ed-page pd-page">{back}<p className="lp-empty lp-pending"><Info size={15} /> {PENDING_047}</p></section>
  // A hidden, unknown or wrong-role profile never falls back to someone else (plan section 3).
  if (!person) return <section className="public-page ed-page pd-page">{back}<EmptyBox>This profile is not public or does not exist.</EmptyBox></section>
  return <section className="public-page ed-page pd-page person-profile">
    {back}
    <div className="person-profile-hero"><Head eyebrow={ROLE_LABELS[role].one} title={person.name} subtitle={`${ROLE_LABELS[role].one}${person.island ? ` · ${person.island}` : ''}`} /><span className="person-profile-avatar" aria-hidden="true"><PersonAvatar /></span><div className="person-profile-share"><ShareButton title={`${person.name} · Kulhivaru+`} /></div></div>
    <Tabs label="Profile sections" active={tab} onChange={setTab} items={[{id:'overview',label:'Overview'},{id:'records',label:role === 'coach' ? 'Teams coached' : 'Official matches'}]} />
    <div className="person-profile-grid"><div className="person-profile-main">
    {tab === 'overview' ? <section className="person-about"><span className="people-role">{ROLE_LABELS[role].one}</span><h2>About</h2><p>{person.bio || 'No biography published yet.'}</p></section> : null}
    {role === 'coach' ? <>
      <h2 className="pd-group">Teams coached</h2>
      {person.teams.length ? <ul className="pd-explore">{person.teams.map(team => <li key={team.slug}><a href={`#team/${encodeURIComponent(team.slug)}`}><Shield size={24} aria-hidden="true" /><strong>{team.name}</strong></a></li>)}</ul> : <EmptyBox>No published teams yet.</EmptyBox>}
    </> : <>
      <h2 className="pd-group">Recent official matches</h2>
      {person.matches.length ? <ul className="pd-matches">{person.matches.map(match => <li key={match.id}><a href={`#matches/${encodeURIComponent(match.id)}`}>
        <time>{match.scheduledAt ? formatDay(match.scheduledAt) : 'Date TBC'}</time>
        <span className="pd-teams"><span>{match.home ?? 'Team'}</span><b className="pd-score">v</b><span>{match.away ?? 'Team'}</span></span>
        <small>{match.tournament}</small>
      </a></li>)}</ul> : <EmptyBox>No official matches in published tournaments yet.</EmptyBox>}
    </>}
    </div><aside className="person-profile-side"><section className="person-about"><h2>Profile information</h2><dl className="registration-facts"><div><dt>Role</dt><dd>{ROLE_LABELS[role].one}</dd></div><div><dt>Island</dt><dd>{person.island || 'Not published'}</dd></div><div><dt>Published records</dt><dd>{role === 'coach' ? `${person.teams.length} team associations` : `${person.matches.length} official matches`}</dd></div></dl></section>{role === 'coach' ? <section className="person-about"><h2>Qualifications</h2><p>Qualifications are not included in this public profile.</p></section> : null}<p className="pf-hint"><Info size={16} aria-hidden="true" /> Only information this person chose to publish is shown. Contact details remain private.</p></aside></div>
  </section>
}

// Explore (#explore): one tile per public directory. Nothing is loaded here; each
// directory loads its own published records when it is opened.
const EXPLORE_TILES = [
  { href: '#teams', label: 'Teams', text: 'Clubs, island and national teams', icon: Shield },
  { href: '#players', label: 'Players', text: 'Published player profiles and Digital Cards', icon: UserRound },
  { href: '#organizations', label: 'Organizations', text: 'Associations and tournament organizers', icon: Building2 },
  { href: '#matches', label: 'Matches', text: 'Fixtures, live matches and official results', icon: PlayCircle },
  { href: '#standings', label: 'Standings', text: 'League and group tables from confirmed results', icon: ListOrdered },
  { href: '#bracket', label: 'Brackets', text: 'Knockout rounds and winners', icon: GitBranch },
  { href: '#news', label: 'News', text: 'Stories, reports and announcements', icon: Newspaper },
  { href: '#archive', label: 'Archive', text: 'Completed tournaments kept as permanent records', icon: Trophy },
  { href: '#coaches', label: 'Coaches', text: 'Coaches who chose to show a public profile', icon: ClipboardList },
  { href: '#referees', label: 'Referees', text: 'Match officials who chose to show a public profile', icon: Flag },
] as const
export function ExplorePage() {
  useEffect(() => { document.title = 'Explore · Kulhivaru+' }, [])
  return <section className="public-page ed-page pd-page">
    <Head eyebrow="Explore" title="Explore Kulhivaru+" subtitle="Every public part of Maldivian sport in one place. Choose where to start." />
    <ul className="pd-explore">{EXPLORE_TILES.map(tile => { const Icon = tile.icon; return <li key={tile.href}><a href={tile.href}><Icon size={28} aria-hidden="true" /><strong>{tile.label}</strong><small>{tile.text}</small></a></li> })}</ul>
    <p className="pf-hint">Looking for something specific? <a className="ed-link" href="#search">Search everything <ArrowRight size={14} /></a></p>
  </section>
}
