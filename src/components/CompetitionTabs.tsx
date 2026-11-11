import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { Award, GitBranch, Loader2, Pencil, RefreshCw, ShieldCheck, Trash2, Trophy } from 'lucide-react'
import { advancementFor, createNextRound, fairPlayFor, latestStage, semiFinalLosers, thirdPlaceEnabled, unresolvedStageMatches, type CardPoints, loadCompetitionStructure, rankedStageTable, type CompetitionStage, type StageGroup, type StageMatch } from '../lib/advancement'
import { configFromRules, qualificationFor, TIEBREAKER_LABELS } from '../lib/tournamentEngine'
import { bracketConflictList } from '../lib/bracketConflicts'
import { replaceMatchParticipants } from '../lib/engineStore'
import { AWARD_KINDS, AWARD_LABELS, TEAM_AWARDS, loadTournamentStandings, uploadAwardImage, recordTournamentAward, removeTournamentAward, renameTournamentAward, sortStandings, type AwardKind, type StandingsRow, type TournamentAward } from '../lib/competitionRecords'
import { searchExistingPlayers, type SearchablePlayer } from '../lib/organizer'

type Structure = { stages: CompetitionStage[]; groups: StageGroup[]; matches: StageMatch[]; cards?: CardPoints[] }

function useStructure(client: SupabaseClient, tournamentId: string, reloadKey: number) {
  const [structure, setStructure] = useState<Structure | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void loadCompetitionStructure(client, tournamentId).then(result => {
      if (!active) return
      if (result.error) { setError(result.error); setStructure(null); return }
      setError(''); setStructure(result)
    })
    return () => { active = false }
  }, [client, tournamentId, reloadKey])
  return { structure, error }
}

// ---------------------------------------------------------------------------
// Standings tab: the database-written snapshots, one table per stage/group.
// ---------------------------------------------------------------------------

export function StandingsTab({ client, tournamentId, teamNames, userId, canManage = false, onNotice }: { client: SupabaseClient; tournamentId: string; teamNames: Record<string, string>; userId?: string; canManage?: boolean; onNotice?: (message: string) => void }) {
  const [reloadKey, setReloadKey] = useState(0)
  // Manual decision for a tie no criterion separates: the order, a reason and an audit record.
  const [deciding, setDeciding] = useState<{ stage: CompetitionStage; order: string[]; reason: string } | null>(null)
  const [decideError, setDecideError] = useState('')
  const saveDecision = async () => {
    if (!deciding || !userId) return
    if (deciding.reason.trim().length < 5) return setDecideError('Give a reason of at least five characters.')
    const previous = Array.isArray(deciding.stage.rules.manual_order) ? (deciding.stage.rules.manual_order as unknown[]).map(String).filter(team => !deciding.order.includes(team)) : []
    const tiebreakers = Array.isArray(deciding.stage.rules.tiebreakers) && (deciding.stage.rules.tiebreakers as unknown[]).includes('manual') ? deciding.stage.rules.tiebreakers : [...(Array.isArray(deciding.stage.rules.tiebreakers) && deciding.stage.rules.tiebreakers.length ? deciding.stage.rules.tiebreakers as unknown[] : ['head_to_head_points', 'head_to_head_difference', 'goal_difference', 'goals_scored', 'wins', 'fair_play', 'playoff']), 'manual']
    const result = await client.from('competition_stages').update({ rules: { ...deciding.stage.rules, tiebreakers, manual_order: [...previous, ...deciding.order] } }).eq('id', deciding.stage.id)
    if (result.error) return setDecideError('The decision could not be saved. Please try again.')
    await client.from('audit_events').insert({ actor_id: userId, action: 'standings_manual_decision', entity_type: 'competition_stage', entity_id: deciding.stage.id, reason: `${deciding.reason.trim()} (order: ${deciding.order.map(team => teamNames[team] ?? 'Team').join(', ')})`.slice(0, 500) })
    setDeciding(null); setDecideError(''); onNotice?.('Tie decided. The order and reason are in the audit history.'); setReloadKey(value => value + 1)
  }
  const { structure, error } = useStructure(client, tournamentId, reloadKey)
  const [rows, setRows] = useState<StandingsRow[] | null>(null)
  const [rowsError, setRowsError] = useState('')
  useEffect(() => {
    if (!structure) return
    let active = true
    void loadTournamentStandings(client, structure.stages.map(stage => stage.id)).then(result => { if (!active) return; setRows(result.data); setRowsError(result.error ?? '') })
    return () => { active = false }
  }, [client, structure])

  if (error || rowsError) return <div className="tab-panel"><div className="form-error" role="alert">Standings are unavailable: {error || rowsError}<button type="button" className="retry-button" onClick={() => setReloadKey(value => value + 1)}>Retry</button></div></div>
  if (!structure || rows === null) return <div className="tab-panel"><div className="loading-state"><Loader2 className="spin" size={16} /> Loading standings…</div></div>
  const tableStages = structure.stages.filter(stage => stage.format !== 'knockout' && stage.rules.superseded !== true)
  // Engine order: the stage's points and ordered tie-breakers over confirmed results.
  const rankedFor = (stage: CompetitionStage, groupId: string | null) => { const list = structure.matches.filter(match => match.stageId === stage.id && (groupId === null || match.groupId === groupId)); return rankedStageTable(stage, list, fairPlayFor(structure.cards, list)) }
  const ordered = (stage: CompetitionStage, groupId: string | null, list: StandingsRow[]) => {
    const ranked = rankedFor(stage, groupId)
    const place = new Map(ranked.map(row => [row.teamId, row]))
    return { rows: [...list].sort((a, b) => ((place.get(a.teamId)?.position ?? 999) - (place.get(b.teamId)?.position ?? 999)) || (sortStandings([a, b])[0] === a ? -1 : 1)), place }
  }
  return <div className="tab-panel">
    <p className="field-hint">Standings are recalculated by the database each time a result is confirmed or corrected. Only confirmed results count, and shootout scores never count toward totals.</p>
    {tableStages.length === 0 && <div className="state-block"><ShieldCheck size={22} /><h3>No league or group stage yet</h3><p>Standings tables appear for round-robin and group stages once a draw exists. Knockout progress is shown on the Draw &amp; fixtures tab.</p></div>}
    {tableStages.map(stage => {
      const stageRows = rows.filter(row => row.stageId === stage.id)
      const stageGroups = structure.groups.filter(group => group.stageId === stage.id).sort((a, b) => a.name.localeCompare(b.name))
      const sections = stageGroups.length ? stageGroups.map(group => ({ key: group.id, title: `${stage.name} · ${group.name}`, rows: stageRows.filter(row => row.groupId === group.id) })) : [{ key: stage.id, title: stage.name, rows: stageRows }]
      // Older snapshots without group_id still show as one table for the stage.
      if (stageGroups.length && stageRows.every(row => !row.groupId)) sections.splice(0, sections.length, { key: stage.id, title: stage.name, rows: stageRows })
      const config = configFromRules(stage.rules)
      return sections.map(section => { const groupId = section.key === stage.id ? null : section.key; const { rows: sorted, place } = ordered(stage, groupId, section.rows); const unresolved = sorted.filter(row => place.get(row.teamId)?.unresolved); return <section className="panel-block" key={section.key}>
        <h3>{section.title}</h3>
        {section.rows.length === 0 ? <p className="empty-note">No confirmed results in this stage yet, so no table has been calculated.</p>
          : <div className="table-scroll"><table className="standings-table"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>For</th><th>Against</th><th>Diff</th><th>Pts</th><th><span className="sr-only">Qualification</span></th></tr></thead>
            <tbody>{sorted.map((row, index) => { const ranked = place.get(row.teamId); const status = stage.rules.engine_format ? qualificationFor(index + 1, config) : null; return <tr key={row.teamId} className={status === 'qualified' || status === 'playoff' ? 'is-qualified' : undefined}><td>{index + 1}</td><td>{teamNames[row.teamId] ?? 'Team'}{ranked?.decidedBy && ranked.decidedBy !== 'points' ? <small className="tie-note"> ({TIEBREAKER_LABELS[ranked.decidedBy]})</small> : null}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.scored}</td><td>{row.conceded}</td><td>{row.scored - row.conceded}</td><td><strong>{row.points}</strong></td><td>{status === 'qualified' ? 'Qualifies' : status === 'playoff' ? 'Playoffs' : ''}</td></tr> })}</tbody></table></div>}
        {unresolved.length > 1 && <div className="tp-warn" role="status">{unresolved.map(row => teamNames[row.teamId] ?? 'Team').join(', ')} are level on every tie-breaker. Play a playoff match, or record a manual decision, before this table decides anything.
          {canManage && userId && (deciding?.stage.id === stage.id
            ? <div className="engine-decision"><ol className="engine-ranking">{deciding.order.map((team, index) => <li key={team}><span>{teamNames[team] ?? 'Team'}</span><span className="button-row compact"><button type="button" className="ghost-button" aria-label={`Move ${teamNames[team] ?? 'team'} up`} onClick={() => { const order = [...deciding.order]; if (index > 0) [order[index - 1], order[index]] = [order[index], order[index - 1]]; setDeciding({ ...deciding, order }) }}>↑</button><button type="button" className="ghost-button" aria-label={`Move ${teamNames[team] ?? 'team'} down`} onClick={() => { const order = [...deciding.order]; if (index < order.length - 1) [order[index + 1], order[index]] = [order[index], order[index + 1]]; setDeciding({ ...deciding, order }) }}>↓</button></span></li>)}</ol>
              <input aria-label="Reason" placeholder="Reason, e.g. drawing of lots on 3 December" value={deciding.reason} onChange={event => setDeciding({ ...deciding, reason: event.target.value })} />
              <div className="button-row"><button type="button" className="primary-button" onClick={() => void saveDecision()}>Save decision</button><button type="button" className="outline-button dark" onClick={() => setDeciding(null)}>Cancel</button></div>
              {decideError && <p className="form-error" role="alert">{decideError}</p>}</div>
            : <button type="button" className="ghost-button" onClick={() => setDeciding({ stage, order: unresolved.map(row => row.teamId), reason: '' })}>Record manual decision</button>)}
        </div>}
        {section.rows[0] && <small>Calculation version {section.rows[0].version}. Order: points, then {(Array.isArray(stage.rules.tiebreakers) && stage.rules.tiebreakers.length ? 'the tie-breakers set for this stage' : 'head-to-head, goal difference, goals scored, wins')}.</small>}
      </section> })
    })}
  </div>
}

// ---------------------------------------------------------------------------
// Next round: knockout winners or group qualifiers into a new knockout stage.
// ---------------------------------------------------------------------------

export function NextRoundPanel({ client, user, tournamentId, teamNames, canManage, onNotice, onChanged }: { client: SupabaseClient; user: User; tournamentId: string; teamNames: Record<string, string>; canManage: boolean; onNotice: (message: string) => void; onChanged: () => void }) {
  const [reloadKey, setReloadKey] = useState(0)
  const { structure, error } = useStructure(client, tournamentId, reloadKey)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const autoDone = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!structure || !canManage) return
    const categoryIds = [...new Set(structure.stages.map(stage => stage.categoryId))]
    for (const categoryId of categoryIds) {
      const stage = latestStage(structure.stages, categoryId)
      if (!stage) continue
      const plan = advancementFor(stage, structure.matches, structure.groups, structure.cards)
      if (!plan || plan.problems.length || plan.fixtures.length === 0) continue
      if (autoDone.current.has(stage.id)) continue
      // Only auto-generate when every match in the stage is confirmed.
      const stageMatches = structure.matches.filter(match => match.stageId === stage.id)
      if (unresolvedStageMatches(stageMatches).length > 0) continue
      autoDone.current.add(stage.id)
      void createNextRound(client, user.id, tournamentId, stage, plan, { thirdPlace: thirdPlaceEnabled(structure.stages, stage.categoryId) && !structure.stages.some(item => item.rules.third_place_match === true && item.rules.previous_stage_id === stage.id) ? semiFinalLosers(stage, structure.matches) : null })
        .then(result => {
          if (result.error) { autoDone.current.delete(stage.id); return }
          onNotice(`${result.fixtureCount} fixture${result.fixtureCount === 1 ? '' : 's'} auto-created for the next round.`)
          setReloadKey(value => value + 1)
          onChanged()
        })
    }
  }, [structure, canManage, client, user.id, tournamentId, onNotice, onChanged])
  if (error) return <div className="form-error" role="alert">Competition stages are unavailable: {error}</div>
  if (!structure) return null
  const categoryIds = [...new Set(structure.stages.map(stage => stage.categoryId))]
  const candidates = categoryIds.map(categoryId => latestStage(structure.stages, categoryId)).filter((stage): stage is CompetitionStage => Boolean(stage))
    .map(stage => ({ stage, plan: advancementFor(stage, structure.matches, structure.groups, structure.cards) }))
    .filter(item => item.plan !== null)
  if (candidates.length === 0) return null
  const name = (id: string) => teamNames[id] ?? 'Team'
  // Semi-final losers meet in a third-place match when the organizer chose one.
  const thirdPlaceFor = (stage: CompetitionStage) => thirdPlaceEnabled(structure.stages, stage.categoryId) && !structure.stages.some(item => item.rules.third_place_match === true && item.rules.previous_stage_id === stage.id) ? semiFinalLosers(stage, structure.matches) : null

  const create = async (stage: CompetitionStage) => {
    const plan = advancementFor(stage, structure.matches, structure.groups, structure.cards)
    if (!plan) return
    setBusy(true); setActionError('')
    const result = await createNextRound(client, user.id, tournamentId, stage, plan, { thirdPlace: thirdPlaceFor(stage) })
    setBusy(false)
    if (result.error) return setActionError(result.error)
    onNotice(`${result.fixtureCount} fixture${result.fixtureCount === 1 ? '' : 's'} created for the next round. Set dates and venues before play.`)
    setReloadKey(value => value + 1)
    onChanged()
  }

  return <section className="panel-block next-round">
    <h3><GitBranch size={16} /> Next round</h3>
    {candidates.map(({ stage, plan }) => <div key={stage.id} className="next-round-stage">
      <strong>{stage.name}</strong>
      {plan!.problems.length > 0 ? <ul className="plain-list">{plan!.problems.map(problem => <li key={problem}>{problem}</li>)}</ul>
        : plan!.champion ? <p><Trophy size={14} /> {name(plan!.champion)} won this stage. Record the champion under Settings → Awards.</p>
          : <>
            <p>{plan!.teams.length} team{plan!.teams.length === 1 ? '' : 's'} advance{plan!.byes.length ? `; ${plan!.byes.map(name).join(', ')} receive a bye` : ''}.</p>
            <ul className="plain-list">{plan!.fixtures.map((fixture, index) => <li key={index}>{name(fixture.homeTeamId)} vs {name(fixture.awayTeamId)}</li>)}{plan!.teams.length === 2 && thirdPlaceFor(stage) && <li>Third-place match: {name(thirdPlaceFor(stage)![0])} vs {name(thirdPlaceFor(stage)![1])}</li>}</ul>
            {canManage && <button type="button" className="primary-button" disabled={busy} onClick={() => void create(stage)}>{busy ? <Loader2 className="spin" size={14} /> : <GitBranch size={14} />} Generate next round</button>}
          </>}
    </div>)}
    {actionError && <div className="form-error" role="alert">{actionError}</div>}
    <button type="button" className="ghost-button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw size={13} /> Refresh</button>
  </section>
}

// ---------------------------------------------------------------------------
// Awards, recorded as labelled organizer milestones.
// ---------------------------------------------------------------------------


export function AwardsPanel({ client, user, organizationId, tournamentId, teams, canManage, awards, awardsError, onReload, onNotice }: { client: SupabaseClient; user: User; organizationId: string; tournamentId: string; teams: Array<{ id: string; name: string }>; canManage: boolean; awards: TournamentAward[]; awardsError: string; onReload: () => void; onNotice: (message: string) => void }) {
  const [kind, setKind] = useState<AwardKind>('champion')
  const [teamId, setTeamId] = useState('')
  const [label, setLabel] = useState('')
  const [query, setQuery] = useState('')
  const [players, setPlayers] = useState<SearchablePlayer[]>([])
  const [playerId, setPlayerId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const teamAward = TEAM_AWARDS.includes(kind)
  const uploadImage = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setError('')
    const result = await uploadAwardImage(client, organizationId, file)
    setBusy(false)
    if (result.error || !result.url) return setError(result.error ?? 'Upload failed.')
    setImageUrl(result.url)
  }
  const teamName = (id: string | null) => teams.find(team => team.id === id)?.name ?? 'Team'

  const search = async (event: FormEvent) => { event.preventDefault(); const result = await searchExistingPlayers(client, query); setPlayers(result.data ?? []); if (result.error) setError(result.error) }
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    const result = await recordTournamentAward(client, { tournamentId, kind, teamId: teamId || null, playerId: playerId || null, label, userId: user.id, imageUrl })
    setBusy(false)
    if (result.error) return setError(result.error)
    onNotice(`${AWARD_LABELS[kind]} recorded. It appears on the public team or player history as an organizer-entered award.`)
    setLabel(''); setPlayerId(''); setPlayers([]); setQuery(''); setImageUrl(null)
    onReload()
  }
  const remove = async (id: string) => { const result = await removeTournamentAward(client, id); setRemoving(null); if (result.error) return setError(result.error); onNotice('Award removed.'); onReload() }
  // Rename an award in place; removing asks first (it changes public histories).
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const rename = async (event: FormEvent) => {
    event.preventDefault(); if (!renaming) return
    setBusy(true); setError('')
    const result = await renameTournamentAward(client, renaming.id, renaming.label)
    setBusy(false)
    if (result.error) return setError(result.error)
    setRenaming(null); onNotice('Award renamed.'); onReload()
  }

  return <section className="panel-block awards">
    <h3><Award size={16} /> Awards</h3>
    {awardsError && <div className="form-error" role="alert">Awards could not be loaded: {awardsError}</div>}
    {awards.length === 0 ? <p className="empty-note">No awards recorded yet. A champion must be recorded before the tournament can be completed.</p>
      : <ul className="plain-list award-list">{awards.map(award => <li key={award.id}>
        {renaming?.id === award.id
          ? <form className="inline-editor" onSubmit={event => void rename(event)}><label>Award title<input value={renaming.label} maxLength={120} autoFocus onChange={event => setRenaming({ ...renaming, label: event.target.value })} /></label><div className="button-row"><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button><button type="button" className="outline-button dark" onClick={() => setRenaming(null)}>Cancel</button></div></form>
          : <><strong>{award.label}</strong> · {award.playerId ? 'Player award' : teamName(award.teamId)} <span className="status-pill status-neutral">Organizer-entered</span></>}
        {canManage && renaming?.id !== award.id && (removing === award.id
          ? <span className="confirm-group"><span>Remove “{award.label}”? It disappears from public histories.</span><button type="button" className="primary-button" onClick={() => void remove(award.id)}>Remove</button><button type="button" className="outline-button dark" onClick={() => setRemoving(null)}>Keep</button></span>
          : <span className="button-row"><button type="button" className="ghost-button" aria-label={`Rename ${award.label}`} onClick={() => setRenaming({ id: award.id, label: award.label })}><Pencil size={13} aria-hidden="true" /> Rename</button><button type="button" className="ghost-button" aria-label={`Remove ${award.label}`} onClick={() => setRemoving(award.id)}><Trash2 size={13} aria-hidden="true" /> Remove</button></span>)}
      </li>)}</ul>}
    {canManage && <form className="award-form" onSubmit={save}>
      <label>Award<select value={kind} onChange={event => { setKind(event.target.value as AwardKind); setPlayerId('') }}>{AWARD_KINDS.map(item => <option value={item} key={item}>{AWARD_LABELS[item]}</option>)}</select></label>
      {kind === 'other' && <label>Award name<input value={label} onChange={event => setLabel(event.target.value)} /></label>}
      <label>{teamAward ? 'Team' : 'Player\'s team (optional)'}<select value={teamId} onChange={event => setTeamId(event.target.value)}><option value="">{teamAward ? 'Choose a team…' : 'Not recorded'}</option>{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label>
      {!teamAward && <div className="award-player">
        <label>Find player<input value={query} onChange={event => setQuery(event.target.value)} placeholder="At least 2 characters" /></label>
        <button type="button" className="outline-button dark" onClick={event => void search(event as unknown as FormEvent)}>Search</button>
        {players.length > 0 && <label>Player<select value={playerId} onChange={event => setPlayerId(event.target.value)}><option value="">Choose…</option>{players.map(player => <option value={player.id} key={player.id}>{player.display_name}</option>)}</select></label>}
      </div>}
      <label>Trophy image (optional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void uploadImage(event.target.files?.[0]); event.target.value = '' }} /></label>
      {imageUrl && <img className="award-preview" src={imageUrl} alt="Trophy preview" />}
      {error && <div className="form-error" role="alert">{error}</div>}
      <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Record award'}</button>
    </form>}
  </section>
}

// ---------------------------------------------------------------------------
// Progression conflicts (owner, 2026-11-03): when a corrected result changes who
// qualified after the next round exists, the affected matches are listed here.
// Nothing changes until an organizer replaces a team with a reason; a played
// match is never changed, so its result must be corrected first.
// ---------------------------------------------------------------------------

export function ProgressionConflictsPanel({ client, user, tournamentId, teamNames, canManage, onNotice, onChanged }: { client: SupabaseClient; user: User; tournamentId: string; teamNames: Record<string, string>; canManage: boolean; onNotice: (message: string) => void; onChanged: () => void }) {
  const [reloadKey, setReloadKey] = useState(0)
  const { structure } = useStructure(client, tournamentId, reloadKey)
  const [fixing, setFixing] = useState<{ matchId: string; out: string; into: string; reason: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!structure) return null
  const conflicts = bracketConflictList(structure)
  if (!conflicts.length) return null
  const name = (id: string) => teamNames[id] ?? 'Team'
  const save = async () => {
    if (!fixing) return
    const match = structure.matches.find(item => item.id === fixing.matchId)
    if (!match?.homeTeamId || !match.awayTeamId) return
    setBusy(true); setError('')
    const teams = { home: match.homeTeamId === fixing.out ? fixing.into : match.homeTeamId, away: match.awayTeamId === fixing.out ? fixing.into : match.awayTeamId }
    const result = await replaceMatchParticipants(client, user.id, match.id, teams, fixing.reason)
    setBusy(false)
    if (result.error) return setError(result.error)
    setFixing(null); onNotice(`${name(fixing.into)} now plays in place of ${name(fixing.out)}. The change and its reason are in the audit history.`); setReloadKey(value => value + 1); onChanged()
  }
  return <section className="panel-block progression-conflicts" role="alert" aria-label="Progression conflicts">
    <h3><GitBranch size={16} /> Bracket needs attention</h3>
    <p className="field-hint">A corrected result changed who qualified. These later matches still hold the old team. Nothing has been changed automatically.</p>
    <ul className="plain-list">{conflicts.map(conflict => <li key={conflict.matchId}>
      <strong>{conflict.stageName}</strong>: {conflict.unexpected.map(name).join(', ')} no longer qualif{conflict.unexpected.length === 1 ? 'ies' : 'y'}{conflict.missing.length ? `; ${conflict.missing.map(name).join(', ')} should play` : ''}.
      {conflict.played ? <span className="field-hint"> This match already has a result: correct that result before the tournament can finish.</span>
        : canManage && (fixing?.matchId === conflict.matchId
          ? <span className="confirm-group">
            <label>Replace<select value={fixing.out} onChange={event => setFixing({ ...fixing, out: event.target.value })}>{conflict.unexpected.map(team => <option key={team} value={team}>{name(team)}</option>)}</select></label>
            <label>with<select value={fixing.into} onChange={event => setFixing({ ...fixing, into: event.target.value })}>{conflict.missing.map(team => <option key={team} value={team}>{name(team)}</option>)}</select></label>
            <input aria-label="Reason" placeholder="Reason" value={fixing.reason} onChange={event => setFixing({ ...fixing, reason: event.target.value })} />
            <button type="button" className="primary-button" disabled={busy || !fixing.into} onClick={() => void save()}>{busy ? 'Saving…' : 'Confirm change'}</button>
            <button type="button" className="outline-button dark" onClick={() => setFixing(null)}>Cancel</button></span>
          : conflict.missing.length > 0 && <button type="button" className="ghost-button" onClick={() => setFixing({ matchId: conflict.matchId, out: conflict.unexpected[0], into: conflict.missing[0], reason: '' })}>Review and fix</button>)}
    </li>)}</ul>
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}
