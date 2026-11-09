import { useEffect, useState } from 'react'
import { loadMatchFeed, teamLabel, type FeedMatch } from '../lib/landing'
import { ArrowRight } from 'lucide-react'
import { publicSupabase } from '../lib/supabase'
import { formatDay } from '../lib/display'
import { sponsorLogoUrl } from '../lib/tournamentPages'
import { eventCounts, keyEvents, loadOrganizationNews, loadOrganizationSponsors, loadOrganizationTeams, loadTournamentDraw, matchEventLabel, STAGE_FORMAT_LABELS, type DrawStage, type MatchEvent, type MatchExtras, type OrganizationSponsor } from '../lib/publicPages'
import { Crest, EdEmpty } from './Editorial'

// Public-page sections backed by migration 202611010038. Each shows an honest
// "not public yet" state when its function is not available.

export function TournamentDraw({ tournamentId }: { tournamentId: string }) {
  const [state, setState] = useState<{ loading: boolean; stages: DrawStage[]; available: boolean }>({ loading: true, stages: [], available: true })
  useEffect(() => {
    if (!publicSupabase || !tournamentId) { setState({ loading: false, stages: [], available: false }); return }
    let active = true
    void loadTournamentDraw(publicSupabase, tournamentId).then(result => { if (active) setState({ loading: false, stages: result.data, available: result.available }) })
    return () => { active = false }
  }, [tournamentId])
  if (state.loading) return <div className="public-state">Loading the draw…</div>
  if (!state.available) return <EdEmpty>The draw is not public yet.</EdEmpty>
  if (!state.stages.length) return <EdEmpty>The draw appears here once the organizer publishes it.</EdEmpty>
  return <div className="pg-draw">{state.stages.map(stage => <section className="ed-panel" key={stage.id} aria-label={stage.name}>
    <p className="ed-eyebrow">{[stage.category, STAGE_FORMAT_LABELS[stage.format] ?? null].filter(Boolean).join(' · ')}</p>
    <h2 className="ed-subhead">{stage.name}</h2>
    <div className="pg-draw-groups">{stage.groups.map(group => <div className="pg-draw-group" key={group.name ?? 'all'}>
      {group.name ? <h3>{group.name}</h3> : stage.groups.length > 1 ? null : <h3>{stage.format === 'knockout' ? 'Teams in this round' : 'Teams'}</h3>}
      <ul className="ed-list ed-list-rows">{group.teams.map(team => <li key={team.id}>{team.slug
        ? <a href={`#team/${encodeURIComponent(team.slug)}`}><Crest name={team.name ?? 'Team'} logoUrl={team.logo} size="sm" /><span className="ed-list-text"><strong>{team.name}</strong></span><ArrowRight size={14} /></a>
        : <span className="pg-draw-team"><Crest name={team.name ?? 'Team'} size="sm" /><span className="ed-list-text"><strong>{team.name ?? 'Team not public'}</strong></span></span>}</li>)}</ul>
    </div>)}</div>
  </section>)}</div>
}

const EVENT_ICONS: Record<string, string> = { goal: '⚽', own_goal: '⚽', penalty: '⚽', assist: '🅰️', yellow_card: '🟨', red_card: '🟥', blue_card: '🟦', substitution: '🔄', two_minute_suspension: '⏱️', point: '🏀', ace: '🎯', block: '🛡️', dig: '✋' }
function EventLine({ event, home, away }: { event: MatchEvent; home: string; away: string }) {
  const team = event.side === 'home' ? home : event.side === 'away' ? away : null
  const initials = (event.player ?? '').trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?'
  const icon = EVENT_ICONS[event.type] ?? '•'
  return <li className={`pg-event pg-event-${event.side ?? 'none'}`}>
    <span className="pg-minute">{event.minute !== null ? `${event.minute}${event.minuteExtra ? `+${event.minuteExtra}` : ''}′` : '–'}</span>
    <span className="pg-event-icon" aria-hidden="true">{icon}</span>
    <span className="pg-event-avatar" aria-hidden="true">{initials}</span>
    <span className="pg-event-text"><strong>{matchEventLabel(event.type)}</strong>
      <small>{event.player ? event.playerSlug ? <a href={`#player/${encodeURIComponent(event.playerSlug)}`}>{event.player}</a> : event.player : 'Player'}{team ? ` · ${team}` : ''}</small></span>
  </li>
}

const NOT_YET = 'The timeline, lineups and statistics appear here once the result is confirmed. Nothing recorded during the match is public before then.'

export function MatchKeyEvents({ extras, home, away }: { extras: MatchExtras; home: string; away: string }) {
  if (!extras.official) return <EdEmpty>{NOT_YET}</EdEmpty>
  const items = keyEvents(extras.events)
  return items.length ? <ul className="pg-events">{items.map((event, index) => <EventLine key={index} event={event} home={home} away={away} />)}</ul> : <EdEmpty>No goals or dismissals were recorded for this match.</EdEmpty>
}

export function MatchTimeline({ extras, home, away }: { extras: MatchExtras; home: string; away: string }) {
  if (!extras.official) return <EdEmpty>{NOT_YET}</EdEmpty>
  return extras.events.length ? <ul className="pg-events">{extras.events.map((event, index) => <EventLine key={index} event={event} home={home} away={away} />)}</ul> : <EdEmpty>No match events were recorded for this match.</EdEmpty>
}

export function MatchLineups({ extras, home, away }: { extras: MatchExtras; home: string; away: string }) {
  if (!extras.official) return <EdEmpty>{NOT_YET}</EdEmpty>
  if (!extras.lineups.length) return <EdEmpty>{extras.privatePlayers ? `${extras.privatePlayers} players took part; their profiles are not public.` : 'No lineup was recorded for this match.'}</EdEmpty>
  const side = (key: 'home' | 'away', name: string) => {
    const players = extras.lineups.filter(item => item.side === key)
    const list = (starter: boolean) => players.filter(item => item.starter === starter)
    return <div className="pg-lineup"><h3>{name}</h3>
      {players.length ? <>{list(true).length ? <><h4>Starting</h4><ul>{list(true).map(item => <li key={item.playerSlug}><a href={`#player/${encodeURIComponent(item.playerSlug)}`}><span className="pg-event-avatar">{item.player.trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()}</span>{item.player}</a></li>)}</ul></> : null}
        {list(false).length ? <><h4>{list(true).length ? 'Substitutes and others' : 'Players'}</h4><ul>{list(false).map(item => <li key={item.playerSlug}><a href={`#player/${encodeURIComponent(item.playerSlug)}`}><span className="pg-event-avatar">{item.player.trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()}</span>{item.player}</a></li>)}</ul></> : null}</>
        : <p className="pg-muted">No public players recorded.</p>}
    </div>
  }
  return <>
    <div className="pg-lineups">{side('home', home)}{side('away', away)}</div>
    {extras.lineups.filter(p => p.starter).length >= 4 && <div className="pg-formation">
      <h4>Starting XI formation</h4>
      <div className="pg-formation-grid">
        {['home', 'away'].map(sideKey => {
          const starters = extras.lineups.filter(p => p.side === sideKey && p.starter)
          return <div key={sideKey} className={`pg-formation-side pg-formation-${sideKey}`}>
            <span className="pg-formation-label">{sideKey === 'home' ? home : away}</span>
            <div className="pg-formation-rows">
              {starters.map(p => <a key={p.playerSlug} className="pg-formation-player" href={`#player/${encodeURIComponent(p.playerSlug)}`}><span className="pg-event-avatar">{p.player.trim().split(/\\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()}</span><small>{p.player}</small></a>)}
            </div>
          </div>
        })}
      </div>
    </div>}
    {extras.privatePlayers ? <p className="pg-muted">{extras.privatePlayers} more {extras.privatePlayers === 1 ? 'player' : 'players'} took part; their profiles are not public.</p> : null}
  </>
}

export function MatchStatistics({ extras, home, away }: { extras: MatchExtras; home: string; away: string }) {
  if (!extras.official) return <EdEmpty>{NOT_YET}</EdEmpty>
  const rows = eventCounts(extras.events)
  if (!rows.length) return <EdEmpty>Player statistics were not recorded for this match.</EdEmpty>
  const max = Math.max(1, ...rows.map(row => Math.max(row.home, row.away)))
  return <div className="pg-stats-bars">
    <div className="pg-stats-head"><span>{home}</span><span>Statistic</span><span>{away}</span></div>
    {rows.map(row => {
      const homePct = Math.round((row.home / max) * 100)
      const awayPct = Math.round((row.away / max) * 100)
      return <div className="pg-stat-row" key={row.type}>
        <span className="pg-stat-val pg-stat-home">{row.home}</span>
        <span className="pg-stat-barwrap"><span className="pg-stat-bar pg-stat-bar-home" style={{ width: `${homePct}%` }} /><span className="pg-stat-label">{row.label}</span><span className="pg-stat-bar pg-stat-bar-away" style={{ width: `${awayPct}%` }} /></span>
        <span className="pg-stat-val pg-stat-away">{row.away}</span>
      </div>
    })}
  </div>
}

// part: the one block a tab shows (teams, news or sponsors); only its data is loaded.
export function OrganizationSections({ organizationId, tournaments, part }: { organizationId: string; tournaments: Array<Record<string, unknown>>; part: 'teams' | 'news' | 'sponsors' }) {
  const [teams, setTeams] = useState<{ loading: boolean; rows: Array<Record<string, unknown>>; available: boolean }>({ loading: true, rows: [], available: true })
  const [news, setNews] = useState<Array<Record<string, unknown>>>([])
  const [sponsors, setSponsors] = useState<OrganizationSponsor[]>([])
  const tournamentKey = tournaments.map(item => String(item.id)).join(',')
  useEffect(() => {
    const client = publicSupabase
    if (!client) { setTeams({ loading: false, rows: [], available: false }); return }
    let active = true
    const list = tournaments.map(item => ({ id: String(item.id), name: String(item.name ?? 'Tournament') }))
    if (part === 'teams') void loadOrganizationTeams(client, organizationId).then(result => { if (active) setTeams({ loading: false, rows: result.data, available: result.available }) })
    if (part === 'news') void loadOrganizationNews(client, organizationId, list.map(item => item.id)).then(rows => { if (active) setNews(rows) })
    if (part === 'sponsors') void loadOrganizationSponsors(client, list).then(rows => { if (active) setSponsors(rows) })
    return () => { active = false }
    // tournamentKey stands for the tournaments list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, tournamentKey, part])
  return <>
    {part === 'teams' && <>
    <h2 className="ed-subhead">Teams</h2>
    {teams.loading ? <div className="public-state">Loading teams…</div>
      : !teams.available ? <EdEmpty>The teams that play in this organization’s tournaments are not public yet.</EdEmpty>
        : teams.rows.length ? <div className="ed-team-grid">{teams.rows.map(team => <a className="ed-team" href={`#team/${encodeURIComponent(String(team.slug))}`} key={String(team.id)}><Crest name={String(team.name)} logoUrl={String(team.logo_url ?? '') || null} size="lg" /><strong>{String(team.name)}</strong><small>{[team.team_type, team.island].filter(Boolean).map(String).join(' · ')}{Number(team.tournament_count) > 0 ? ` · ${Number(team.tournament_count)} ${Number(team.tournament_count) === 1 ? 'tournament' : 'tournaments'}` : ''}</small></a>)}</div>
          : <EdEmpty>No published teams play in this organization’s tournaments yet.</EdEmpty>}
    </>}
    {part === 'news' && <>
    <h2 className="ed-subhead">News</h2>
    {news.length ? <div className="ed-news">{news.map((item, index) => <a key={String(item.id)} className={`ed-news-item${index === 0 ? ' lead' : ''}`} href={`#news/${encodeURIComponent(String(item.slug ?? item.id))}`}><small>{formatDay(item.published_at)}</small><strong>{String(item.title)}</strong>{item.excerpt ? <span>{String(item.excerpt)}</span> : null}</a>)}</div> : <EdEmpty>No published news from this organization yet.</EdEmpty>}
    </>}
    {part === 'sponsors' && <>
    <h2 className="ed-subhead">Sponsors</h2>
    {sponsors.length ? <div className="ed-sponsor-grid">{sponsors.map(sponsor => <article className="ed-panel ed-sponsor" key={sponsor.sponsor_name}>
      {sponsor.logo_path && publicSupabase ? <img src={sponsorLogoUrl(publicSupabase, sponsor.logo_path)} alt={`${sponsor.sponsor_name} logo`} loading="lazy" width={96} height={96} /> : <span className="ed-sponsor-mark" aria-hidden="true">{sponsor.sponsor_name.slice(0, 2).toUpperCase()}</span>}
      <p className="ed-eyebrow">{sponsor.sponsor_level}</p><h3>{sponsor.sponsor_name}</h3>
      <p className="pg-muted">Supports {sponsor.tournaments.join(', ')}</p>
      {sponsor.website ? <a className="ed-link" href={sponsor.website} target="_blank" rel="noopener noreferrer nofollow">Visit website</a> : null}
    </article>)}</div> : <EdEmpty>No public sponsors for this organization’s tournaments yet.</EdEmpty>}
    </>}
  </>
}

// Live matches of one tournament (published fixtures only; scores stay off until confirmed).
export function TournamentLive({ tournamentId }: { tournamentId: string }) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; matches: FeedMatch[] }>({ status: 'loading', matches: [] })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!publicSupabase) { setState({ status: 'error', matches: [] }); return }
    let active = true
    setState(current => ({ ...current, status: 'loading' }))
    void loadMatchFeed(publicSupabase, { tournamentId, statuses: ['live'], limit: 20 }).then(result => { if (active) setState({ status: result.error && !result.needsMigration ? 'error' : 'ready', matches: result.data }) })
    return () => { active = false }
  }, [tournamentId, attempt])
  if (state.status === 'loading') return <div className="public-state">Loading live matches…</div>
  if (state.status === 'error') return <div className="public-state error-state" role="alert"><p>Live matches could not be loaded.</p><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>
  if (!state.matches.length) return <EdEmpty>No match in this tournament is live right now. Upcoming fixtures are under Upcoming.</EdEmpty>
  return <ul className="pg-live-list">{state.matches.map(match => <li key={match.id}><a href={`#matches/${encodeURIComponent(match.id)}`}><span className="pg-live-tag">Live</span><strong>{teamLabel(match.home)}</strong><small>v</small><strong>{teamLabel(match.away)}</strong>{match.venue ? <small className="pg-muted">{match.venue}</small> : null}<ArrowRight size={14} aria-hidden="true" /></a></li>)}</ul>
}
