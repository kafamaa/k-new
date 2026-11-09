import type { SupabaseClient } from '@supabase/supabase-js'
import { attachPersistedGroupIds } from './competition'
import {
  fixtureProblems, groupName, numberFixtures, stageRulesFor, storedFormat, type DrawMode, type FormatConfig, type ScheduledFixture, type TieBreakerKey,
} from './tournamentEngine'
import { saveStageRules, loadStages, updateFixture } from './tournamentPages'

// Saving the engine's work into the existing tables (owner, 2026-11-03):
// competition_stages (format + rules), competition_groups, matches (with date,
// time and venue), competition_fixture_versions (the draw, its seed, match
// numbers and bracket slots) and audit_events. Only confirmed teams are
// accepted, and nothing is written when a check fails.

export type ConfirmDrawInput = {
  tournamentId: string
  categoryId: string | null
  categoryName: string
  confirmedTeams: string[]
  config: FormatConfig
  points: { win: number; draw: number; loss: number }
  tiebreakers: TieBreakerKey[]
  drawMode: DrawMode
  seed: string | null
  groups: string[][]
  fixtures: ScheduledFixture[]
  byes: string[]
  slots: Array<string | null> | null
  expected: number | null
  schedule: { restHours: number; matchMinutes: number; maxPerDay: number | null; matchDays: number[] | null }
}

const STAGE_NAMES: Record<FormatConfig['format'], string> = {
  round_robin: 'League', double_round_robin: 'League', league_playoffs: 'League', group_stage: 'Group stage', groups_knockout: 'Group stage', knockout: 'Knockout', manual: 'Main stage',
}

export async function confirmDrawAndFixtures(client: SupabaseClient, userId: string, input: ConfirmDrawInput): Promise<{ stageId: string | null; fixtureCount: number; error: string | null }> {
  const playing = input.confirmedTeams.filter(team => !input.byes.includes(team))
  const problems = fixtureProblems(input.fixtures, { teams: input.config.format === 'knockout' ? playing : input.confirmedTeams, expected: input.expected, restHours: input.schedule.restHours, matchMinutes: input.schedule.matchMinutes, checkBalance: input.config.format === 'round_robin' || input.config.format === 'double_round_robin' })
  if (problems.length) return { stageId: null, fixtureCount: 0, error: problems.join(' ') }
  let categoryId = input.categoryId
  if (!categoryId) {
    const category = await client.from('tournament_categories').insert({ tournament_id: input.tournamentId, name: input.categoryName.trim() || 'Open' }).select('id').single()
    if (category.error || !category.data) return { stageId: null, fixtureCount: 0, error: 'The category could not be created.' }
    categoryId = String(category.data.id)
  }
  // A stage name is unique per category; a later draw after Regenerate gets a number.
  const existing = await loadStages(client, input.tournamentId)
  const base = STAGE_NAMES[input.config.format]
  const taken = new Set(existing.data.filter(stage => stage.category_id === categoryId).map(stage => stage.name))
  let stageName = base
  for (let index = 2; taken.has(stageName); index += 1) stageName = `${base} (draw ${index})`
  const rules = {
    ...stageRulesFor(input.config),
    points_win: input.points.win, points_draw: input.points.draw, points_loss: input.points.loss,
    tiebreakers: input.tiebreakers, byes: input.byes, ...(input.slots ? { slots: input.slots } : {}),
    draw_seed: input.seed, draw_mode_detail: input.drawMode,
    rest_hours: input.schedule.restHours, match_minutes: input.schedule.matchMinutes, max_per_day: input.schedule.maxPerDay, match_days: input.schedule.matchDays,
  }
  const drawMode = input.drawMode === 'manual' ? 'manual' : 'automatic'
  const stage = await client.from('competition_stages').insert({ tournament_id: input.tournamentId, category_id: categoryId, name: stageName, format: storedFormat(input.config), draw_mode: drawMode, rules }).select('id').single()
  if (stage.error || !stage.data) return { stageId: null, fixtureCount: 0, error: 'The competition stage could not be created.' }
  const stageId = String(stage.data.id)
  let groups: Array<{ name: string; id: string }> = []
  if (input.groups.length > 1) {
    const created = await client.from('competition_groups').insert(input.groups.map((_, index) => ({ stage_id: stageId, name: groupName(index) }))).select('id,name')
    if (created.error) return { stageId, fixtureCount: 0, error: 'The groups could not be saved.' }
    groups = (created.data ?? []) as Array<{ name: string; id: string }>
  }
  const numbered = numberFixtures(input.fixtures)
  const rows = attachPersistedGroupIds(numbered, groups)
  const matches = await client.from('matches').insert(rows.map(fixture => ({
    tournament_id: input.tournamentId, stage_id: stageId, category_id: categoryId, group_id: fixture.groupId,
    home_team_id: fixture.homeTeamId, away_team_id: fixture.awayTeamId, leg: fixture.leg,
    scheduled_at: fixture.scheduledAt ?? null, venue: fixture.venue ?? null, created_by: userId,
  })))
  if (matches.error) return { stageId, fixtureCount: 0, error: 'The fixtures could not be saved.' }
  const version = await client.from('competition_fixture_versions').insert({
    stage_id: stageId, version: 1, draw_mode: drawMode, created_by: userId,
    fixture_payload: { engine: 1, format: input.config.format, seed: input.seed, draw_mode: input.drawMode, groups: input.groups, byes: input.byes, slots: input.slots, fixtures: numbered.map(item => ({ match_number: item.matchNumber, home: item.homeTeamId, away: item.awayTeamId, leg: item.leg, round: item.round ?? null, group: item.group ?? null, scheduled_at: item.scheduledAt ?? null, venue: item.venue ?? null })) },
  }).select('id').single()
  if (version.error || !version.data) return { stageId, fixtureCount: numbered.length, error: 'The fixtures were saved, but the draw record was not. Open Format & draw to check.' }
  await client.from('audit_events').insert({ actor_id: userId, action: 'draw_confirmed', entity_type: 'fixture_version', entity_id: version.data.id, reason: `${input.drawMode} draw${input.seed ? `, seed ${input.seed}` : ''}, ${numbered.length} fixtures` })
  return { stageId, fixtureCount: numbered.length, error: null }
}

// Saving format and rules before the draw (Save Rules and Continue) keeps them
// with the tournament's setup record, so the next visit starts from them.
export type SavedEngineRules = { config: FormatConfig; points: { win: number; draw: number; loss: number }; tiebreakers: TieBreakerKey[] }

// Points and tie-breaker changes on an existing stage keep its draw details.
export async function updateStageScoring(client: SupabaseClient, stage: { id: string; rules: Record<string, unknown> }, scoring: { points: { win: number; draw: number; loss: number }; tiebreakers: TieBreakerKey[]; manualOrder?: string[] }) {
  return saveStageRules(client, stage.id, { ...stage.rules, points_win: scoring.points.win, points_draw: scoring.points.draw, points_loss: scoring.points.loss, tiebreakers: scoring.tiebreakers, ...(scoring.manualOrder ? { manual_order: scoring.manualOrder } : {}) } as never)
}

// Controlled replacement of a later-round team after a correction changed who
// qualified (owner rule: never silently). Uses replace_match_participants
// (migration 045) when applied; until then the same guarded update through the
// organizer's own access, with an audit record.
export async function replaceMatchParticipants(client: SupabaseClient, userId: string, matchId: string, teams: { home: string; away: string }, reason: string): Promise<{ error: string | null }> {
  if (reason.trim().length < 5) return { error: 'Give a reason of at least five characters.' }
  if (teams.home === teams.away) return { error: 'A team cannot play itself.' }
  const rpc = await client.rpc('replace_match_participants', { p_match: matchId, p_home: teams.home, p_away: teams.away, p_reason: reason.trim() })
  if (!rpc.error) return { error: null }
  if (!/does not exist|PGRST20\d|42883|schema cache|could not find/i.test(rpc.error.message)) return { error: /match_already_played|events_recorded/.test(rpc.error.message) ? 'This match already has a result or player events, so its teams cannot change. Correct its result instead.' : 'The teams could not be changed. Please try again.' }
  const current = await client.from('matches').select('status').eq('id', matchId).maybeSingle()
  if (current.error || !current.data) return { error: 'The match could not be loaded.' }
  if (!['scheduled', 'postponed'].includes(String(current.data.status))) return { error: 'This match already has a result or is being played, so its teams cannot change. Correct its result instead.' }
  const events = await client.from('match_events').select('id', { count: 'exact', head: true }).eq('match_id', matchId)
  if ((events.count ?? 0) > 0) return { error: 'This match already has player events, so its teams cannot change.' }
  const update = await client.from('matches').update({ home_team_id: teams.home, away_team_id: teams.away }).eq('id', matchId).in('status', ['scheduled', 'postponed'])
  if (update.error) return { error: 'The teams could not be changed. Please try again.' }
  await client.from('audit_events').insert({ actor_id: userId, action: 'progression_conflict_resolved', entity_type: 'match', entity_id: matchId, reason: reason.trim() })
  return { error: null }
}

// Regenerate Draft (before publishing, before play): the old draft is cancelled
// with a reason and kept; its stage is marked superseded.
export async function supersedeDraft(client: SupabaseClient, tournamentId: string, matchIds: string[]): Promise<{ error: string | null }> {
  for (const id of matchIds) {
    const result = await updateFixture(client, id, { status: 'cancelled' }, 'Draft schedule replaced before publishing')
    if (result.error) return { error: 'The draft could not be replaced. Please try again.' }
  }
  const stages = await loadStages(client, tournamentId)
  for (const stage of stages.data.filter(item => !item.published_at)) await saveStageRules(client, stage.id, { ...stage.rules, superseded: true } as never)
  return { error: null }
}

// Finish and Publish Archive (migration 045): one immutable snapshot of the final
// standings, results, bracket, awards, team and player statistics, then the
// tournament is completed. Until 045 is applied the caller completes the
// tournament the existing way, and the public pages remain the record.
export async function publishTournamentArchive(client: SupabaseClient, tournamentId: string): Promise<{ version: number | null; pending: boolean; error: string | null }> {
  const result = await client.rpc('publish_tournament_archive', { p_tournament: tournamentId })
  if (!result.error) return { version: Number(result.data), pending: false, error: null }
  const message = result.error.message
  if (/does not exist|PGRST20\d|42883|schema cache|could not find/i.test(message)) return { version: null, pending: true, error: null }
  if (message.includes('matches_unresolved')) return { version: null, pending: false, error: 'Some matches are still open. Resolve every match first.' }
  if (message.includes('champion_required')) return { version: null, pending: false, error: 'Record the champion under Awards first.' }
  return { version: null, pending: false, error: 'The archive could not be published. Please try again.' }
}

export type TournamentArchive = { version: number; createdAt: string; snapshot: Record<string, unknown> }
export async function loadTournamentArchive(client: SupabaseClient, tournamentId: string): Promise<{ data: TournamentArchive | null; state: 'ready' | 'pending' | 'error' }> {
  const result = await client.from('tournament_archives').select('version,created_at,snapshot').eq('tournament_id', tournamentId).order('version', { ascending: false }).limit(1).maybeSingle()
  if (result.error) return { data: null, state: /does not exist|PGRST20\d|42P01|schema cache|could not find/i.test(result.error.message) ? 'pending' : 'error' }
  return { data: result.data ? { version: Number(result.data.version), createdAt: String(result.data.created_at), snapshot: (result.data.snapshot ?? {}) as Record<string, unknown> } : null, state: 'ready' }
}
