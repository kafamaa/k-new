import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { ArrowDown, ArrowRight, ArrowUp, Check, Loader2, Plus, RefreshCw, Shuffle, Trash2 } from 'lucide-react'
import { publishTournament, setTournamentStatus, type OrganizerTab, type OrganizerTournament, type SetupStepRecord, type TournamentEntry } from '../lib/organizer'
import { saveSetupStep, setupStepKey } from '../lib/tournament'
import { autoSchedule, parsePlayingTimes, parseVenues, recommendFormat } from '../lib/simpleFlow'
import { fromMaldivesInput, loadStages, setStagePublished, toMaldivesInput } from '../lib/tournamentPages'
import {
  DEFAULT_FORMAT_CONFIG, DEFAULT_TIEBREAKERS, drawGroups, ENGINE_FORMAT_LABELS, fixtureIssues, fixtureProblems, formatProblems, groupName, groupProblems,
  newDrawSeed, normalizeTiebreakers, pairingProblems, planFixtures, potsFromSeeding, seededBracket, seededShuffle, TIEBREAKER_LABELS, totalMatchCount,
  type DrawMode, type EngineFormat, type FormatConfig, type ManualPairing, type ScheduledFixture, type TieBreakerKey,
} from '../lib/tournamentEngine'
import { confirmDrawAndFixtures } from '../lib/engineStore'

// The Schedule page (owner, 2026-11-03): 1 Choose Format → 2 When & Where →
// (Draw, when the format needs one) → 3 Preview & Publish. Only the active
// section is open. Only confirmed (approved) teams enter. The draw, its
// reproducible code, every fixture and the schedule version are saved by
// Publish Schedule through the existing engine records.

type Props = {
  client: SupabaseClient; user: User; tournament: OrganizerTournament; entries: TournamentEntry[]; steps: SetupStepRecord[]
  categories: Array<{ id: string; name: string }>; canManage: boolean; onNotice: (message: string) => void; onChanged: () => void
  onOpenTab?: (tab: OrganizerTab) => void
}
type Section = 'format' | 'when' | 'draw' | 'preview'
type Points = { win: number; draw: number; loss: number }
type Saved = { config?: Partial<FormatConfig>; points?: Partial<Points>; tiebreakers?: unknown }
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const NEEDS_GROUPS: EngineFormat[] = ['group_stage', 'groups_knockout']

// The six format cards. Two-leg knockout is the knockout format with two legs.
type CardId = 'league' | 'groups' | 'knockout' | 'groups_knockout' | 'two_leg' | 'league_playoffs'
const FORMAT_CARDS: Array<{ id: CardId; label: string; sentence: string; format: EngineFormat; legs: 1 | 2 }> = [
  { id: 'league', label: 'League', sentence: 'Every team plays every other team.', format: 'round_robin', legs: 1 },
  { id: 'groups', label: 'Groups', sentence: 'Teams play in groups; the group tables are the result.', format: 'group_stage', legs: 1 },
  { id: 'knockout', label: 'Knockout', sentence: 'Lose once and you are out, until the final.', format: 'knockout', legs: 1 },
  { id: 'groups_knockout', label: 'Groups + Knockout', sentence: 'Group matches first, then the best teams play knockout rounds.', format: 'groups_knockout', legs: 1 },
  { id: 'two_leg', label: 'Two-Leg Knockout', sentence: 'Each tie is played home and away; the aggregate score decides.', format: 'knockout', legs: 2 },
  { id: 'league_playoffs', label: 'League + Playoffs', sentence: 'A league, then the top teams play off for the title.', format: 'league_playoffs', legs: 1 },
]
const cardOf = (config: FormatConfig): CardId | null => config.format === 'double_round_robin' || config.format === 'round_robin' ? 'league'
  : config.format === 'knockout' ? (config.knockoutLegs === 2 ? 'two_leg' : 'knockout')
    : config.format === 'group_stage' ? 'groups' : config.format === 'groups_knockout' ? 'groups_knockout' : config.format === 'league_playoffs' ? 'league_playoffs' : null

// Sensible settings when the organizer picks another format for this many teams.
function defaultsFor(format: EngineFormat, teamCount: number, current: FormatConfig): FormatConfig {
  const groupCount = Math.max(2, Math.min(8, Math.floor(teamCount / 4) || 2))
  const smallest = Math.floor(teamCount / groupCount)
  const playoffTeams = [16, 8, 4, 2].find(value => value <= teamCount && value < teamCount) ?? 2
  return {
    ...current, format,
    groupCount: format === 'group_stage' || format === 'groups_knockout' ? groupCount : current.groupCount,
    qualifiersPerGroup: Math.max(1, Math.min(2, smallest - 1)),
    bestThirds: 0, playoffTeams,
    thirdPlace: ['knockout', 'groups_knockout', 'league_playoffs'].includes(format) ? current.thirdPlace : false,
  }
}

// A saved number within range, or the first-time default.
function savedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback
}

function recommendedConfig(teamCount: number): FormatConfig {
  const plan = recommendFormat(teamCount)
  if (!plan) return DEFAULT_FORMAT_CONFIG
  if (plan.format === 'knockout') return { ...DEFAULT_FORMAT_CONFIG, format: 'knockout' }
  if (plan.format === 'groups_knockout') return { ...DEFAULT_FORMAT_CONFIG, format: 'groups_knockout', groupCount: plan.groupCount, qualifiersPerGroup: 2 }
  return { ...DEFAULT_FORMAT_CONFIG, format: 'round_robin' }
}

export function CompetitionEngine({ client, user, tournament, entries, steps, categories, canManage, onNotice, onChanged, onOpenTab }: Props) {
  const confirmed = useMemo(() => entries.filter(entry => entry.application_status === 'approved'), [entries])
  const teamIds = useMemo(() => confirmed.map(entry => entry.team_id), [confirmed])
  const name = (id: string | null) => confirmed.find(entry => entry.team_id === id)?.team_name ?? 'Team'
  const saved = ((steps.find(item => item.step_number === setupStepKey(6))?.data ?? {}) as Record<string, unknown>).engine as Saved | undefined
  const recommended = recommendedConfig(teamIds.length)
  const [section, setSection] = useState<Section>(saved?.config ? 'when' : 'format')
  const [config, setConfig] = useState<FormatConfig>({ ...recommended, ...(saved?.config ?? {}) })
  const [points, setPoints] = useState<Points>({ win: 3, draw: 1, loss: 0, ...(saved?.points ?? {}) })
  const [tiebreakers, setTiebreakers] = useState<TieBreakerKey[]>(normalizeTiebreakers(saved?.tiebreakers ?? DEFAULT_TIEBREAKERS))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const set = <K extends keyof FormatConfig>(key: K, value: FormatConfig[K]) => setConfig(current => ({ ...current, [key]: value }))
  const problems = formatProblems(config, teamIds.length)
  const usesDraw = NEEDS_GROUPS.includes(config.format) || config.format === 'knockout' || config.format === 'manual'
  const pickCard = (id: CardId) => { const card = FORMAT_CARDS.find(item => item.id === id)!; setConfig(current => ({ ...defaultsFor(card.format, teamIds.length, current), knockoutLegs: card.legs, awayGoals: card.legs === 2 ? current.awayGoals : false })); setError('') }
  const recommendedCard = cardOf(recommended)

  // --- Draw state
  const [mode, setMode] = useState<DrawMode>('random')
  const [seed, setSeed] = useState<string | null>(null)
  const [ranking, setRanking] = useState<string[]>(teamIds)
  useEffect(() => { setRanking(current => [...current.filter(id => teamIds.includes(id)), ...teamIds.filter(id => !current.includes(id))]) }, [teamIds])
  const [avoidIsland, setAvoidIsland] = useState(false)
  const [islands, setIslands] = useState<Record<string, string | null>>({})
  useEffect(() => {
    if (!avoidIsland || !teamIds.length) return
    let active = true
    void client.from('teams').select('id,island').in('id', teamIds).then(result => { if (active && !result.error) setIslands(Object.fromEntries(((result.data ?? []) as Array<{ id: string; island: string | null }>).map(row => [row.id, row.island?.trim() || null]))) })
    return () => { active = false }
  }, [client, avoidIsland, teamIds])
  const [groups, setGroups] = useState<string[][] | null>(null)
  const [drawNotes, setDrawNotes] = useState<string[]>([])
  const [pairings, setPairings] = useState<ManualPairing[]>([])
  const [drawAccepted, setDrawAccepted] = useState(false)

  const runDraw = (nextSeed = newDrawSeed()) => {
    setSeed(nextSeed); setDrawAccepted(false); setError('')
    if (NEEDS_GROUPS.includes(config.format)) {
      const drawMode = mode === 'manual' ? 'random' : mode
      const result = drawGroups({ teams: drawMode === 'random' ? teamIds : ranking, groupCount: config.groupCount, seed: nextSeed, mode: drawMode, pots: drawMode === 'pots' ? potsFromSeeding(ranking, config.groupCount) : undefined, avoid: avoidIsland ? islands : undefined })
      setGroups(result.groups); setDrawNotes(result.problems)
    } else if (config.format === 'knockout') {
      setRanking(mode === 'seeded' ? ranking : seededShuffle(teamIds, nextSeed)); setGroups(null); setDrawNotes([])
    }
  }
  const moveTeam = (team: string, groupIndex: number) => setGroups(current => (current ?? []).map((group, index) => index === groupIndex ? [...group.filter(item => item !== team), team] : group.filter(item => item !== team)))
  const moveRank = (index: number, step: -1 | 1) => setRanking(current => { const list = [...current]; const target = index + step; if (target < 0 || target >= list.length) return list; [list[index], list[target]] = [list[target], list[index]]; return list })
  const drawProblems = NEEDS_GROUPS.includes(config.format) ? (groups ? groupProblems(groups, teamIds) : ['Run the draw first.'])
    : config.format === 'manual' ? (pairings.length ? pairingProblems(pairings, teamIds) : ['Add the pairings first.'])
      : config.format === 'knockout' && !seed ? ['Run the draw first.'] : []

  // --- When & where
  const venueStep = (steps.find(item => item.step_number === setupStepKey(8))?.data ?? {}) as Record<string, unknown>
  const [startDate, setStartDate] = useState(String(venueStep.startsAt ?? '').slice(0, 10))
  const [venues, setVenues] = useState(Array.isArray(venueStep.venues) ? (venueStep.venues as string[]).join(', ') : String(venueStep.venue ?? ''))
  const [times, setTimes] = useState(String(venueStep.playingTimes ?? '16:00, 18:00, 20:00'))
  // Reopen with the organizer's saved rules; 20 h rest and 90 min are only the
  // first-time defaults (unified plan 18.1: rest is configurable, not universal).
  const savedRules = (venueStep.scheduleRules ?? {}) as { restHours?: unknown; matchMinutes?: unknown }
  const [restHours, setRestHours] = useState(() => savedNumber(savedRules.restHours, 0, 168, 20))
  const [matchMinutes, setMatchMinutes] = useState(() => savedNumber(savedRules.matchMinutes, 10, 240, 90))
  const [maxPerDay, setMaxPerDay] = useState('')
  const [days, setDays] = useState<number[]>([])
  const [fixtures, setFixtures] = useState<Array<ScheduledFixture & { key: string }> | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const plan = useMemo(() => planFixtures(config, config.format === 'knockout' ? ranking : teamIds, groups, pairings), [config, ranking, teamIds, groups, pairings])
  const playingTeams = config.format === 'knockout' ? teamIds.filter(team => !plan.byes.includes(team)) : teamIds
  const checks = fixtures ? fixtureProblems(fixtures, { teams: playingTeams, expected: plan.expected, restHours, matchMinutes, checkBalance: false }) : []
  const issues = useMemo(() => fixtures ? fixtureIssues(fixtures, { restHours, matchMinutes }) : new Map<number, string[]>(), [fixtures, restHours, matchMinutes])

  const whenProblem = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return 'Choose the start date.'
    if (!parseVenues(venues).length) return 'Enter at least one venue.'
    if (!parsePlayingTimes(times).length) return 'Enter at least one time slot, for example 18:00.'
    return null
  }
  const generate = () => {
    setError('')
    const problem = whenProblem(); if (problem) return setError(problem)
    const keyed = plan.fixtures.map((fixture, index) => ({ ...fixture, key: `f${index}` }))
    const placed = autoSchedule(keyed.map(item => ({ id: item.key, homeTeamId: item.homeTeamId, awayTeamId: item.awayTeamId })), { startDate, times: parsePlayingTimes(times), venues: parseVenues(venues), restHours, maxPerDay: Number(maxPerDay) > 0 ? Number(maxPerDay) : null, days: days.length ? days : null })
    const slot = new Map(placed.slots.map(item => [item.id, item]))
    setFixtures(keyed.map(item => ({ ...item, scheduledAt: slot.get(item.key)?.scheduledAt ?? null, venue: slot.get(item.key)?.venue ?? null })))
    setEditing(null); setSection('preview')
    if (placed.unplaced.length) setError(`${placed.unplaced.length} match${placed.unplaced.length === 1 ? '' : 'es'} did not fit. Add match days, times or venues, or set them on the highlighted cards.`)
  }
  const editFixture = (key: string, patch: Partial<ScheduledFixture>) => setFixtures(current => (current ?? []).map(item => item.key === key ? { ...item, ...patch } : item))

  const chooseFormat = async () => {
    if (problems.length) return setError(problems[0])
    for (const value of [points.win, points.draw, points.loss]) if (!Number.isInteger(value) || value < -5 || value > 10) return setError('Points must be whole numbers between -5 and 10.')
    setBusy('rules'); setError('')
    const current = (steps.find(item => item.step_number === setupStepKey(6))?.data ?? {}) as Record<string, unknown>
    const result = await saveSetupStep(client, tournament.id, user.id, 6, 'in_progress', { ...current, format: config.format, engine: { config, points, tiebreakers } }, { enforceValidation: false })
    setBusy('')
    if (result.error) return setError('The format could not be saved. Please try again.')
    setGroups(null); setSeed(null); setDrawAccepted(false); setFixtures(null)
    onNotice('Format saved.'); setSection('when')
  }
  const generateSchedule = () => {
    const problem = whenProblem(); if (problem) return setError(problem)
    setError('')
    if (usesDraw && !drawAccepted) {
      setSection('draw')
      if (mode !== 'manual' && config.format !== 'manual' && !seed) runDraw()
      return
    }
    generate()
  }
  const acceptDraw = () => { if (drawProblems.length) return setError(drawProblems[0]); setDrawAccepted(true); generate() }

  // Publish Schedule: save the draw, fixtures and version, then make them public.
  const publish = async () => {
    if (!fixtures) return
    if (checks.length) return setError(checks[0])
    setBusy('publish'); setError('')
    const result = await confirmDrawAndFixtures(client, user.id, {
      tournamentId: tournament.id, categoryId: categories[0]?.id ?? null, categoryName: categories[0]?.name ?? 'Open', confirmedTeams: teamIds,
      config, points, tiebreakers, drawMode: config.format === 'manual' ? 'manual' : mode, seed, groups: groups ?? [], fixtures, byes: plan.byes,
      slots: config.format === 'knockout' ? seededBracket(ranking, config.knockoutLegs).slots : null, expected: plan.expected,
      schedule: { restHours, matchMinutes, maxPerDay: Number(maxPerDay) > 0 ? Number(maxPerDay) : null, matchDays: days.length ? days : null },
    })
    if (result.error) { setBusy(''); return setError(result.error) }
    await saveSetupStep(client, tournament.id, user.id, 8, 'in_progress', { ...venueStep, startsAt: startDate, venue: parseVenues(venues)[0] ?? '', venues: parseVenues(venues), playingTimes: parsePlayingTimes(times).join(', '), scheduleRules: { restHours, matchMinutes } }, { enforceValidation: false })
    if (!tournament.is_published) { const published = await publishTournament(client, tournament.id, false); if (published.error) { setBusy(''); onChanged(); return setError('The fixtures were saved, but the schedule could not be published. Use Publish Schedule on the calendar.') } }
    const stages = await loadStages(client, tournament.id)
    for (const stage of stages.data.filter(item => !item.published_at && !(item.rules as Record<string, unknown>).superseded)) await setStagePublished(client, stage.id, true)
    if (!['in_progress', 'completed', 'archived'].includes(tournament.status)) await setTournamentStatus(client, tournament.id, 'in_progress')
    setBusy('')
    onNotice(`Schedule published: ${result.fixtureCount} matches. Teams and fans can see it now.`); onChanged(); onOpenTab?.('matches')
  }

  if (!canManage) return <p className="empty-note">The organizer has not published the schedule yet.</p>
  if (teamIds.length < 2) return <p className="empty-note">At least two confirmed teams are needed before the schedule.</p>
  const sectionList: Array<{ id: Section; label: string }> = [{ id: 'format', label: 'Choose Format' }, { id: 'when', label: 'When & Where' }, { id: 'preview', label: 'Preview & Publish' }]
  const order: Section[] = ['format', 'when', 'draw', 'preview']
  const reached = (id: Section) => order.indexOf(section) > order.indexOf(id)
  const byDate = fixtures ? [...fixtures.map((fixture, index) => ({ fixture, index }))].sort((a, b) => (a.fixture.scheduledAt ?? '9').localeCompare(b.fixture.scheduledAt ?? '9')).reduce((map, item) => {
    const day = item.fixture.scheduledAt ? new Date(item.fixture.scheduledAt).toLocaleDateString('en-GB', { timeZone: 'Indian/Maldives', weekday: 'long', day: 'numeric', month: 'long' }) : 'No date yet'
    map.set(day, [...(map.get(day) ?? []), item]); return map
  }, new Map<string, Array<{ fixture: ScheduledFixture & { key: string }; index: number }>>()) : null
  let number = 0

  return <section className="engine" aria-label="Schedule">
    <ol className="engine-steps">{sectionList.map((item, index) => <li key={item.id} className={section === item.id || (item.id === 'when' && section === 'draw') ? 'current' : reached(item.id) ? 'done' : ''}><button type="button" onClick={() => setSection(item.id)} disabled={!reached(item.id) && section !== item.id && !(item.id === 'when' && section === 'draw')} aria-current={section === item.id ? 'step' : undefined}>{reached(item.id) && !(item.id === 'when' && section === 'draw') ? <Check size={14} /> : index + 1} {item.label}</button></li>)}</ol>
    <p className="flow-lede">{teamIds.length} teams confirmed. Only confirmed teams enter the schedule.</p>

    {section === 'format' && <div className="engine-panel">
      {recommendedCard && <p className="engine-recommend"><strong>Recommended:</strong> {recommendFormat(teamIds.length)?.summary}</p>}
      <div className="format-cards" role="radiogroup" aria-label="Format">{FORMAT_CARDS.map(card => {
        const preview = { ...defaultsFor(card.format, teamIds.length, config), knockoutLegs: card.legs } as FormatConfig
        const total = totalMatchCount(cardOf(config) === card.id ? config : preview, teamIds.length)
        const active = cardOf(config) === card.id
        return <button type="button" role="radio" aria-checked={active} key={card.id} className={`format-card${active ? ' active' : ''}`} onClick={() => pickCard(card.id)}>
          <span className="format-card-head"><strong>{card.label}</strong>{card.id === recommendedCard && <small className="status-pill status-ok">Recommended</small>}</span>
          <span>{card.sentence}</span>
          <small>{total === null ? 'You set the matches' : `About ${total} match${total === 1 ? '' : 'es'}`}</small>
        </button>
      })}</div>
      <details className="flow-create-more"><summary>Advanced settings</summary><div className="engine-advanced">
        <div className="flow-create-grid">
          {cardOf(config) === 'league' && <label className="flow-check"><input type="checkbox" checked={config.format === 'double_round_robin'} onChange={event => setConfig(current => ({ ...current, format: event.target.checked ? 'double_round_robin' : 'round_robin' }))} /> Play every team twice (home and away)</label>}
          {NEEDS_GROUPS.includes(config.format) && <label>Number of groups<input type="number" min={2} max={16} value={config.groupCount} onChange={event => set('groupCount', Number(event.target.value))} /></label>}
          {NEEDS_GROUPS.includes(config.format) && <label className="flow-check"><input type="checkbox" checked={config.groupDoubleRound} onChange={event => set('groupDoubleRound', event.target.checked)} /> Home and away inside groups</label>}
          {config.format === 'groups_knockout' && <label>Qualifiers per group<input type="number" min={1} max={4} value={config.qualifiersPerGroup} onChange={event => set('qualifiersPerGroup', Number(event.target.value))} /></label>}
          {config.format === 'groups_knockout' && <label>Best third-placed teams also qualify<input type="number" min={0} max={config.groupCount} value={config.bestThirds} onChange={event => set('bestThirds', Number(event.target.value))} /></label>}
          {config.format === 'league_playoffs' && <label>Playoff places<select value={config.playoffTeams} onChange={event => set('playoffTeams', Number(event.target.value))}>{[2, 4, 8, 16].filter(value => value <= teamIds.length).map(value => <option key={value} value={value}>Top {value}</option>)}</select></label>}
          {config.format === 'league_playoffs' && <label className="flow-check"><input type="checkbox" checked={config.leagueDoubleRound} onChange={event => set('leagueDoubleRound', event.target.checked)} /> League home and away</label>}
          {['knockout', 'groups_knockout', 'league_playoffs'].includes(config.format) && <label className="flow-check"><input type="checkbox" checked={config.thirdPlace} onChange={event => set('thirdPlace', event.target.checked)} /> Third-place match</label>}
          {['groups_knockout', 'league_playoffs'].includes(config.format) && <label>Knockout ties<select value={config.knockoutLegs} onChange={event => set('knockoutLegs', Number(event.target.value) === 2 ? 2 : 1)}><option value={1}>One match</option><option value={2}>Two legs (final is one match)</option></select></label>}
          {config.knockoutLegs === 2 && <label className="flow-check"><input type="checkbox" checked={config.awayGoals} onChange={event => set('awayGoals', event.target.checked)} /> Away goals decide a level tie</label>}
          <label className="flow-check"><input type="checkbox" checked={config.extraTime} onChange={event => set('extraTime', event.target.checked)} /> Extra time in knockout matches</label>
          <label className="flow-check"><input type="checkbox" checked={config.penalties} onChange={event => set('penalties', event.target.checked)} /> Penalties decide a level knockout tie</label>
          <label className="flow-check"><input type="checkbox" checked={config.format === 'manual'} onChange={event => setConfig(current => event.target.checked ? { ...current, format: 'manual' } : recommended)} /> Make the pairings myself</label>
        </div>
        <h4>Points</h4>
        <div className="tp-points">{(['win', 'draw', 'loss'] as const).map(key => <label key={key}>{key === 'win' ? 'Win' : key === 'draw' ? 'Draw' : 'Loss'}<input type="number" min={-5} max={10} value={points[key]} onChange={event => setPoints({ ...points, [key]: Number(event.target.value) })} /></label>)}</div>
        <p className="field-hint">Tie-breakers, in order (points always come first):</p>
        <ol className="tp-tiebreakers">{tiebreakers.map((item, index) => <li key={item}>{TIEBREAKER_LABELS[item]}<span className="button-row compact">
          <button type="button" className="ghost-button" aria-label={`Move ${TIEBREAKER_LABELS[item]} up`} onClick={() => setTiebreakers(list => { const next = [...list]; if (index > 0) [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next })}><ArrowUp size={13} /></button>
          <button type="button" className="ghost-button" aria-label={`Move ${TIEBREAKER_LABELS[item]} down`} onClick={() => setTiebreakers(list => { const next = [...list]; if (index < next.length - 1) [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next })}><ArrowDown size={13} /></button>
        </span></li>)}</ol>
      </div></details>
      {problems.length > 0 && <ul className="flow-warnings">{problems.map(item => <li key={item}>{item}</li>)}</ul>}
      <div className="flow-primary-row flow-sticky"><button type="button" className="primary-button flow-primary" disabled={busy === 'rules' || problems.length > 0} onClick={() => void chooseFormat()}>{busy === 'rules' ? 'Saving…' : <>Use This Format <ArrowRight size={16} /></>}</button></div>
    </div>}

    {section === 'when' && <div className="engine-panel">
      <p className="field-hint">{ENGINE_FORMAT_LABELS[config.format]}{config.knockoutLegs === 2 && config.format === 'knockout' ? ', two legs' : ''}. <button type="button" className="ghost-button" onClick={() => setSection('format')}>Change format</button></p>
      <div className="flow-create-grid">
        <label>Start date<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
        <label>Venue or venues<input value={venues} onChange={event => setVenues(event.target.value)} placeholder="e.g. National Stadium, Henveiru Ground" /></label>
        <label>Time slots<input value={times} onChange={event => setTimes(event.target.value)} placeholder="16:00, 18:00, 20:00" /><small className="field-hint">Maldives time. Separate with commas.</small></label>
      </div>
      <fieldset className="engine-days"><legend>Match days (none ticked = every day)</legend>{WEEKDAYS.map((day, index) => <label key={day}><input type="checkbox" checked={days.includes(index)} onChange={event => setDays(list => event.target.checked ? [...list, index] : list.filter(item => item !== index))} /> {day}</label>)}</fieldset>
      <details className="flow-create-more"><summary>Advanced settings</summary><div className="flow-create-grid">
        <label>Match length (minutes)<input type="number" min={10} max={240} value={matchMinutes} onChange={event => setMatchMinutes(Number(event.target.value))} /></label>
        <label>Minimum rest for a team (hours)<input type="number" min={0} max={168} value={restHours} onChange={event => setRestHours(Number(event.target.value))} /></label>
        <label>Most matches per day (optional)<input type="number" min={1} max={40} value={maxPerDay} onChange={event => setMaxPerDay(event.target.value)} /></label>
      </div></details>
      <div className="flow-primary-row flow-sticky"><button type="button" className="primary-button flow-primary" onClick={generateSchedule}>Generate Schedule <ArrowRight size={16} /></button></div>
    </div>}

    {section === 'draw' && <div className="engine-panel">
      <h4>Draw</h4>
      {config.format === 'manual' ? <>
        <p className="field-hint">Add each pairing. A team cannot play itself, the same pairing cannot appear twice, and a team cannot play twice in one round.</p>
        <ul className="engine-pairings">{pairings.map((pairing, index) => <li key={index}>
          <label>Round<input type="number" min={1} value={pairing.round} onChange={event => setPairings(list => list.map((item, at) => at === index ? { ...item, round: Number(event.target.value) } : item))} /></label>
          {(['homeTeamId', 'awayTeamId'] as const).map(side => <label key={side}>{side === 'homeTeamId' ? 'Home' : 'Away'}<select value={pairing[side]} onChange={event => setPairings(list => list.map((item, at) => at === index ? { ...item, [side]: event.target.value } : item))}><option value="">Choose</option>{teamIds.map(team => <option key={team} value={team}>{name(team)}</option>)}</select></label>)}
          <button type="button" className="ghost-button" aria-label="Remove pairing" onClick={() => setPairings(list => list.filter((_, at) => at !== index))}><Trash2 size={14} /></button>
        </li>)}</ul>
        <button type="button" className="outline-button dark" onClick={() => setPairings(list => [...list, { homeTeamId: '', awayTeamId: '', round: list.length ? list[list.length - 1].round : 1 }])}><Plus size={14} /> Add pairing</button>
      </> : <>
        {!seed && mode !== 'manual' && <div className="flow-primary-row"><button type="button" className="primary-button flow-primary" onClick={() => runDraw()}><Shuffle size={15} /> Run Automatic Draw</button></div>}
        {groups && <div className="flow-draw-groups">{groups.map((group, index) => <div key={index}><strong>{groupName(index)}</strong><ol>{group.map(team => <li key={team}>{name(team)}{mode === 'manual' && <select aria-label={`Move ${name(team)} to another group`} value={index} onChange={event => moveTeam(team, Number(event.target.value))}>{groups.map((_, target) => <option key={target} value={target}>{groupName(target)}</option>)}</select>}</li>)}</ol></div>)}</div>}
        {config.format === 'knockout' && seed && <ul className="flow-mini-list">{plan.fixtures.filter(item => item.leg === 1).map((fixture, index) => <li key={index}>{name(fixture.homeTeamId)} vs {name(fixture.awayTeamId)}</li>)}{plan.byes.length > 0 && <li>Straight to the next round: {plan.byes.map(name).join(', ')}</li>}</ul>}
        {drawNotes.map(note => <p key={note} className="tp-warn">{note}</p>)}
        <details className="flow-create-more"><summary>Draw options</summary><div className="engine-advanced">
          <fieldset className="engine-modes"><legend>How to draw</legend>
            {(NEEDS_GROUPS.includes(config.format) ? ['random', 'seeded', 'pots', 'manual'] as DrawMode[] : ['random', 'seeded'] as DrawMode[]).map(item => <label key={item}><input type="radio" name="draw-mode" checked={mode === item} onChange={() => { setMode(item); setDrawAccepted(false); if (item === 'manual') setGroups(current => current ?? Array.from({ length: config.groupCount }, (_, index) => teamIds.filter((_, teamIndex) => teamIndex % config.groupCount === index))) }} /> {item === 'random' ? 'Automatic draw' : item === 'seeded' ? 'Seeded draw (by the order below)' : item === 'pots' ? 'Pots (one team from each pot per group)' : 'Manual draw'}</label>)}
          </fieldset>
          {(mode === 'seeded' || mode === 'pots') && <ol className="engine-ranking">{ranking.map((team, index) => <li key={team}><span>{name(team)}{mode === 'pots' ? <small> · Pot {Math.floor(index / Math.max(1, config.groupCount)) + 1}</small> : null}</span><span className="button-row compact"><button type="button" className="ghost-button" aria-label={`Move ${name(team)} up`} onClick={() => moveRank(index, -1)}><ArrowUp size={13} /></button><button type="button" className="ghost-button" aria-label={`Move ${name(team)} down`} onClick={() => moveRank(index, 1)}><ArrowDown size={13} /></button></span></li>)}</ol>}
          {NEEDS_GROUPS.includes(config.format) && mode !== 'manual' && <label className="flow-check"><input type="checkbox" checked={avoidIsland} onChange={event => setAvoidIsland(event.target.checked)} /> Separate teams from the same island</label>}
        </div></details>
      </>}
      {(seed || mode === 'manual' || config.format === 'manual') && drawProblems.length > 0 && <ul className="flow-warnings">{drawProblems.map(item => <li key={item}>{item}</li>)}</ul>}
      {(seed || mode === 'manual' || config.format === 'manual') && <div className="flow-primary-row flow-sticky">
        <button type="button" className="primary-button flow-primary" disabled={drawProblems.length > 0} onClick={acceptDraw}>Accept Draw <ArrowRight size={16} /></button>
        {config.format !== 'manual' && mode !== 'manual' && <button type="button" className="outline-button dark" onClick={() => runDraw()}><RefreshCw size={14} /> Try Again</button>}
        {NEEDS_GROUPS.includes(config.format) && mode !== 'manual' && <button type="button" className="ghost-button" onClick={() => { setMode('manual'); setDrawAccepted(false) }}>Edit Manually</button>}
      </div>}
    </div>}

    {section === 'preview' && fixtures && byDate && <div className="engine-panel">
      <p className="field-hint">{fixtures.length} matches{plan.expected !== null ? ` (expected ${plan.expected})` : ''}. Tap Edit on any match to change it.</p>
      {[...byDate.entries()].map(([day, list]) => <section key={day} className="fixture-day"><h4>{day}</h4>
        <ul className="fixture-cards">{list.map(({ fixture, index }) => {
          number += 1
          const problemsHere = issues.get(index) ?? []
          return <li key={fixture.key} className={`fixture-card${problemsHere.length ? ' has-issue' : ''}`}>
            <div className="fixture-card-main">
              <span className="fixture-no">#{number}</span>
              <div className="fixture-teams"><strong>{name(fixture.homeTeamId)} vs {name(fixture.awayTeamId)}</strong><small>{[fixture.scheduledAt ? new Date(fixture.scheduledAt).toLocaleTimeString('en-GB', { timeZone: 'Indian/Maldives', hour: '2-digit', minute: '2-digit' }) : 'Time not set', fixture.venue, fixture.group, fixture.leg === 2 ? 'Second leg' : null, fixture.round ? `Round ${fixture.round}` : null].filter(Boolean).join(' · ')}</small></div>
              <button type="button" className="ghost-button" aria-expanded={editing === fixture.key} onClick={() => setEditing(editing === fixture.key ? null : fixture.key)}>{editing === fixture.key ? 'Done' : 'Edit'}</button>
            </div>
            {problemsHere.length > 0 && <ul className="fixture-issues">{problemsHere.map(item => <li key={item}>{item}</li>)}</ul>}
            {editing === fixture.key && <div className="fixture-edit">
              <label>Date and time<input type="datetime-local" value={toMaldivesInput(fixture.scheduledAt ?? null)} onChange={event => editFixture(fixture.key, { scheduledAt: fromMaldivesInput(event.target.value) })} /></label>
              <label>Venue<input value={fixture.venue ?? ''} onChange={event => editFixture(fixture.key, { venue: event.target.value || null })} /></label>
              <button type="button" className="outline-button dark" onClick={() => editFixture(fixture.key, { homeTeamId: fixture.awayTeamId, awayTeamId: fixture.homeTeamId })}>Swap home and away</button>
            </div>}
          </li>
        })}</ul>
      </section>)}
      {checks.length > 0 ? <ul className="flow-warnings">{checks.map(item => <li key={item}>{item}</li>)}</ul> : <p className="publication-notice"><Check size={14} /> Every check passed.</p>}
      <div className="flow-primary-row flow-sticky">
        <button type="button" className="primary-button flow-primary" disabled={busy === 'publish' || checks.length > 0} onClick={() => void publish()}>{busy === 'publish' ? <><Loader2 className="spin" size={15} /> Publishing…</> : <>Publish Schedule <ArrowRight size={16} /></>}</button>
        <button type="button" className="ghost-button" onClick={generate}><RefreshCw size={14} /> Regenerate Draft</button>
      </div>
      <p className="field-hint">Publishing makes the fixtures public, notifies the teams and keeps this schedule version. Later changes need a reason and tell both teams.</p>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}
