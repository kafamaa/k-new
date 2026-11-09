import type { SupabaseClient } from '@supabase/supabase-js'
import { imageLimit, sizeLabel } from './appConfig'

// ---------------------------------------------------------------------------
// Standings snapshots and tournament awards.
//
// Standings are written only by the database when a result is confirmed or
// corrected (migration 025), so the app reads them and never computes its own
// official table. Awards are organizer-entered milestones: they are always
// stored with is_manual = true so they stay labelled as custom records and are
// never touched by automatic recalculation.
// ---------------------------------------------------------------------------

export type StandingsRow = { stageId: string; groupId: string | null; teamId: string; played: number; wins: number; draws: number; losses: number; scored: number; conceded: number; points: number; version: number }

export async function loadTournamentStandings(client: SupabaseClient, stageIds: string[]): Promise<{ data: StandingsRow[]; error: string | null }> {
  if (stageIds.length === 0) return { data: [], error: null }
  const withGroups = await client.from('standings_snapshots').select('stage_id,group_id,team_id,played,wins,draws,losses,scored,conceded,points,calculated_from_version').in('stage_id', stageIds)
  // group_id arrives with migration 025; older databases still return a table.
  const result = withGroups.error && /group_id/.test(withGroups.error.message)
    ? await client.from('standings_snapshots').select('stage_id,team_id,played,wins,draws,losses,scored,conceded,points,calculated_from_version').in('stage_id', stageIds)
    : withGroups
  if (result.error) return { data: [], error: result.error.message }
  const rows = ((result.data ?? []) as Array<Record<string, unknown>>).map(row => ({
    stageId: String(row.stage_id), groupId: row.group_id ? String(row.group_id) : null, teamId: String(row.team_id),
    played: Number(row.played ?? 0), wins: Number(row.wins ?? 0), draws: Number(row.draws ?? 0), losses: Number(row.losses ?? 0),
    scored: Number(row.scored ?? 0), conceded: Number(row.conceded ?? 0), points: Number(row.points ?? 0), version: Number(row.calculated_from_version ?? 0),
  }))
  return { data: rows, error: null }
}

// Display order: points, then goal difference, then goals scored, then name
// order is left to the caller. This mirrors calculateStandings' defaults.
export function sortStandings(rows: StandingsRow[]): StandingsRow[] {
  return [...rows].sort((a, b) => b.points - a.points || (b.scored - b.conceded) - (a.scored - a.conceded) || b.scored - a.scored || a.teamId.localeCompare(b.teamId))
}

export const AWARD_KINDS = ['champion', 'runner_up', 'third_place', 'top_scorer', 'best_player', 'best_goalkeeper', 'fair_play', 'other'] as const
export type AwardKind = (typeof AWARD_KINDS)[number]
export const AWARD_LABELS: Record<AwardKind, string> = {
  champion: 'Champion', runner_up: 'Runner-up', third_place: 'Third place', top_scorer: 'Top scorer',
  best_player: 'Best player', best_goalkeeper: 'Best goalkeeper', fair_play: 'Fair play award', other: 'Award',
}
// Team awards attach to a team; individual awards attach to a player.
export const TEAM_AWARDS: AwardKind[] = ['champion', 'runner_up', 'third_place', 'fair_play']

export type TournamentAward = { id: string; kind: string; label: string; teamId: string | null; playerId: string | null; reachedAt: string | null }

export async function loadTournamentAwards(client: SupabaseClient, tournamentId: string): Promise<{ data: TournamentAward[]; error: string | null }> {
  const result = await client.from('sport_milestones').select('id,milestone_type,label,team_id,player_id,reached_at').eq('tournament_id', tournamentId).eq('is_manual', true).like('milestone_type', 'award_%').order('created_at', { ascending: true })
  if (result.error) return { data: [], error: result.error.message }
  return { data: ((result.data ?? []) as Array<Record<string, unknown>>).map(row => ({ id: String(row.id), kind: String(row.milestone_type).replace(/^award_/, ''), label: String(row.label ?? ''), teamId: row.team_id ? String(row.team_id) : null, playerId: row.player_id ? String(row.player_id) : null, reachedAt: typeof row.reached_at === 'string' ? row.reached_at : null })), error: null }
}

export function validateAward(input: { kind: AwardKind; teamId: string | null; playerId: string | null; label: string }): string | null {
  if (TEAM_AWARDS.includes(input.kind) && !input.teamId) return 'Choose the team receiving this award.'
  if (!TEAM_AWARDS.includes(input.kind) && !input.playerId) return 'Choose the player receiving this award.'
  if (input.kind === 'other' && !input.label.trim()) return 'Name the award.'
  return null
}

export async function recordTournamentAward(client: SupabaseClient, input: { tournamentId: string; seasonId?: string | null; kind: AwardKind; teamId: string | null; playerId: string | null; label: string; userId: string; imageUrl?: string | null }): Promise<{ error: string | null }> {
  const problem = validateAward(input)
  if (problem) return { error: problem }
  const team = TEAM_AWARDS.includes(input.kind)
  const result = await client.from('sport_milestones').insert({
    tournament_id: input.tournamentId, season_id: input.seasonId ?? null,
    team_id: team ? input.teamId : input.teamId ?? null, player_id: team ? null : input.playerId,
    milestone_type: `award_${input.kind}`, label: input.label.trim() || AWARD_LABELS[input.kind],
    state: 'reached', reached_at: new Date().toISOString(), is_manual: true, created_by: input.userId,
    // Trophy image (migration 029); only sent when one was uploaded.
    ...(input.imageUrl ? { image_url: input.imageUrl } : {}),
  })
  return { error: result.error?.message ?? null }
}

export async function removeTournamentAward(client: SupabaseClient, awardId: string): Promise<{ error: string | null }> {
  const result = await client.from('sport_milestones').delete().eq('id', awardId).eq('is_manual', true)
  return { error: result.error?.message ?? null }
}

// Completion check (spec 5.5): a champion must be recorded before completion.
export function awardBlockers(awards: TournamentAward[]): string[] {
  return awards.some(award => award.kind === 'champion') ? [] : ['No champion award is recorded yet. Record awards before completing the tournament.']
}

// Trophy images go to the public-media bucket under the organization's folder
// (migration 024 lets organization members write there).
export async function uploadAwardImage(client: SupabaseClient, organizationId: string, file: File): Promise<{ url: string | null; error: string | null }> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return { url: null, error: 'Use a PNG, JPG or WebP image.' }
  if (file.size === 0 || file.size > imageLimit()) return { url: null, error: `Images must be under ${sizeLabel(imageLimit())}.` }
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `organizations/${organizationId}/awards/${crypto.randomUUID()}.${extension}`
  const upload = await client.storage.from('public-media').upload(path, file, { contentType: file.type, upsert: false })
  if (upload.error) return { url: null, error: /bucket|not found/i.test(upload.error.message) ? 'Image storage needs migration 024.' : upload.error.message }
  return { url: client.storage.from('public-media').getPublicUrl(path).data.publicUrl, error: null }
}

// Rename an organizer-entered award (the recipient is changed by removing and
// adding again, so the history shows both).
export async function renameTournamentAward(client: SupabaseClient, awardId: string, label: string): Promise<{ error: string | null }> {
  const clean = label.trim()
  if (clean.length < 2) return { error: 'Enter the award title.' }
  if (clean.length > 120) return { error: 'Keep the award title under 120 characters.' }
  const result = await client.from('sport_milestones').update({ label: clean }).eq('id', awardId).eq('is_manual', true)
  return { error: result.error ? 'The award could not be renamed. Please try again.' : null }
}
