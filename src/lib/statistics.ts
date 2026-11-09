import type { SupabaseClient } from '@supabase/supabase-js'

export type TeamLevel = 'club' | 'island' | 'national' | 'school' | 'other'
export type ConfirmedAppearance = { matchId: string; tournamentId: string; seasonId?: string; sport: string; teamId: string; teamName: string; teamType: TeamLevel; playerId: string; starter: boolean; minutes?: number | null; events: Array<{ type: string }> ; confirmed: boolean }
export type OfficialPlayerStats = { key: string; teamId: string; teamName: string; teamType: TeamLevel; tournamentId: string; seasonId?: string; sport: string; appearances: number; starts: number; minutes: number | null; goals: number; assists: number; yellowCards: number; redCards: number; points: number; setsPlayed: number }

export function calculateOfficialPlayerStats(records: ConfirmedAppearance[], filters: { teamType?: TeamLevel; teamId?: string; tournamentId?: string; seasonId?: string; sport?: string } = {}): OfficialPlayerStats[] {
  const filtered = records.filter(record => record.confirmed && (!filters.teamType || record.teamType === filters.teamType) && (!filters.teamId || record.teamId === filters.teamId) && (!filters.tournamentId || record.tournamentId === filters.tournamentId) && (!filters.seasonId || record.seasonId === filters.seasonId) && (!filters.sport || record.sport === filters.sport))
  const totals = new Map<string, OfficialPlayerStats>()
  for (const record of filtered) { const key = [record.teamId, record.tournamentId, record.seasonId ?? '', record.sport].join('|'); const current = totals.get(key) ?? { key, teamId: record.teamId, teamName: record.teamName, teamType: record.teamType, tournamentId: record.tournamentId, seasonId: record.seasonId, sport: record.sport, appearances: 0, starts: 0, minutes: null, goals: 0, assists: 0, yellowCards: 0, redCards: 0, points: 0, setsPlayed: 0 }; current.appearances += 1; current.starts += record.starter ? 1 : 0; current.minutes = record.minutes == null ? current.minutes : (current.minutes ?? 0) + record.minutes; for (const event of record.events) { if (event.type === 'goal') current.goals += 1; if (event.type === 'assist') current.assists += 1; if (event.type === 'yellow_card') current.yellowCards += 1; if (event.type === 'red_card' || event.type === 'blue_card') current.redCards += 1; if (['one_point', 'two_point', 'three_point', 'point'].includes(event.type)) current.points += event.type === 'two_point' ? 2 : event.type === 'three_point' ? 3 : 1; if (event.type === 'set_played') current.setsPlayed += 1 } totals.set(key, current) }
  return [...totals.values()]
}

export function calculateTeamHistory(records: Array<{ teamId: string; tournamentId: string; confirmed: boolean; scored: number; conceded: number }>) {
  const totals = new Map<string, { teamId: string; matches: number; wins: number; draws: number; losses: number; scored: number; conceded: number }>()
  for (const record of records.filter(item => item.confirmed)) { const current = totals.get(record.teamId) ?? { teamId: record.teamId, matches: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 }; current.matches += 1; current.scored += record.scored; current.conceded += record.conceded; if (record.scored > record.conceded) current.wins += 1; else if (record.scored < record.conceded) current.losses += 1; else current.draws += 1; totals.set(record.teamId, current) }
  return [...totals.values()]
}

export type Milestone = { id: string; subjectId: string; label: string; type: string; reachedAt: string; sourceMatchId: string; isManual: boolean }
export function calculateAutomaticMilestones(records: ConfirmedAppearance[]): Milestone[] {
  const confirmed = records.filter(record => record.confirmed).sort((a, b) => a.matchId.localeCompare(b.matchId)); if (!confirmed.length) return []
  const milestones: Milestone[] = []; const first = confirmed[0]; milestones.push({ id: `first-appearance-${first.playerId}`, subjectId: first.playerId, label: 'First confirmed appearance', type: 'first_appearance', reachedAt: new Date(0).toISOString(), sourceMatchId: first.matchId, isManual: false })
  const goals = confirmed.flatMap(record => record.events.filter(event => event.type === 'goal').map(() => record)); if (goals.length) milestones.push({ id: `first-goal-${first.playerId}`, subjectId: first.playerId, label: 'First confirmed goal', type: 'first_goal', reachedAt: new Date(0).toISOString(), sourceMatchId: goals[0].matchId, isManual: false })
  return milestones
}

export function publicPlayerCardData(profile: { displayName: string; photoUrl?: string | null; island?: string | null; countryCode?: string | null; approved: boolean }, stats: OfficialPlayerStats[], currentTeam?: { name: string; badgeUrl?: string | null }) {
  if (!profile.approved) return null
  return { displayName: profile.displayName, photoUrl: profile.photoUrl ?? null, island: profile.island ?? null, countryCode: profile.countryCode ?? null, team: currentTeam ?? null, stats: { appearances: stats.reduce((sum, item) => sum + item.appearances, 0), goals: stats.reduce((sum, item) => sum + item.goals, 0), assists: stats.reduce((sum, item) => sum + item.assists, 0), cards: stats.reduce((sum, item) => sum + item.yellowCards + item.redCards, 0) } }
}

export async function loadPublicPlayerCard(client: SupabaseClient, playerId: string) {
  const profile = await client.from('player_profiles').select('display_name,photo_url,island,is_published').eq('id', playerId).maybeSingle()
  if (profile.error) return { data: null, error: profile.error.message }
  if (!profile.data?.is_published) return { data: null, error: null }
  const stats = await client.rpc('get_player_official_statistics', { p_player_id: playerId })
  if (stats.error) return { data: null, error: stats.error.message }
  const normalized = (stats.data ?? []) as OfficialPlayerStats[]
  return { data: publicPlayerCardData({ displayName: profile.data.display_name, photoUrl: profile.data.photo_url, island: profile.data.island, approved: true }, normalized), error: null }
}
