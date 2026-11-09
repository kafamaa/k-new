import type { SupabaseClient } from '@supabase/supabase-js'

// Protests and appeals (review-only migration 046, unified plan section 23).
// A team manager of an approved entry files; the tournament's organizers decide
// with a written reason; a decided protest can be appealed once. Until the
// owner applies 046 every read reports 'pending' instead of an error.
export type ProtestStatus = 'submitted' | 'under_review' | 'upheld' | 'rejected' | 'withdrawn'
export type Protest = {
  id: string; tournamentId: string; matchId: string | null; teamId: string; teamName: string
  kind: 'protest' | 'appeal'; appealOf: string | null; subject: string; grounds: string
  status: ProtestStatus; decision: string | null; decidedAt: string | null; createdAt: string
}

export const PROTEST_STATUS_LABELS: Record<ProtestStatus, string> = {
  submitted: 'Submitted', under_review: 'Under review', upheld: 'Upheld', rejected: 'Rejected', withdrawn: 'Withdrawn',
}
export const PROTEST_STATUS_TONES: Record<ProtestStatus, 'info' | 'warn' | 'ok' | 'bad' | 'muted'> = {
  submitted: 'info', under_review: 'warn', upheld: 'ok', rejected: 'bad', withdrawn: 'muted',
}
export const PENDING_046 = 'Protests and appeals become available once the platform owner applies update 046.'

const isPending = (message: string) => /does not exist|PGRST20\d|42883|42P01|schema cache|could not find/i.test(message)

export function protestProblem(message: string): string {
  if (isPending(message)) return PENDING_046
  if (/team_manager_required/.test(message)) return 'Only this team’s managers can file a protest.'
  if (/team_not_in_tournament/.test(message)) return 'Your team needs an approved entry in this tournament to file a protest.'
  if (/match_not_in_tournament/.test(message)) return 'That match is not part of this tournament.'
  if (/subject_required/.test(message)) return 'Give the protest a short title (at least 5 characters).'
  if (/grounds_required/.test(message)) return 'Explain the grounds in at least 20 characters.'
  if (/appeal_needs_decided_protest/.test(message)) return 'You can appeal only after the organizer has decided the protest.'
  if (/already_appealed/.test(message)) return 'This decision has already been appealed.'
  if (/decision_reason_required/.test(message)) return 'Write the reason for the decision (at least 10 characters).'
  if (/already_closed/.test(message)) return 'This protest is already closed.'
  if (/organizer_permission_required/.test(message)) return 'Only this tournament’s organizers can decide protests.'
  if (/protest_not_found/.test(message)) return 'This protest could not be found.'
  return 'This could not be saved. Please try again.'
}

// Client-side checks mirror the server, so problems show before sending.
export function protestInputProblem(input: { subject: string; grounds: string }): string | null {
  if (input.subject.trim().length < 5) return protestProblem('subject_required')
  if (input.grounds.trim().length < 20) return protestProblem('grounds_required')
  return null
}

type Row = {
  id: string; tournament_id: string; match_id: string | null; team_id: string; kind: Protest['kind']; appeal_of: string | null
  subject: string; grounds: string; status: ProtestStatus; decision: string | null; decided_at: string | null; created_at: string
  teams: { name?: string } | Array<{ name?: string }> | null
}

export async function loadProtests(client: SupabaseClient, filter: { tournamentId?: string; teamId?: string }): Promise<{ data: Protest[]; state: 'ready' | 'pending' | 'error'; error: string | null }> {
  let query = client.from('tournament_protests').select('id,tournament_id,match_id,team_id,kind,appeal_of,subject,grounds,status,decision,decided_at,created_at,teams(name)').order('created_at', { ascending: false })
  if (filter.tournamentId) query = query.eq('tournament_id', filter.tournamentId)
  if (filter.teamId) query = query.eq('team_id', filter.teamId)
  const result = await query
  if (result.error) return isPending(result.error.message) ? { data: [], state: 'pending', error: null } : { data: [], state: 'error', error: 'Protests could not be loaded.' }
  return {
    state: 'ready', error: null,
    data: ((result.data ?? []) as Row[]).map(row => {
      const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
      return {
        id: row.id, tournamentId: row.tournament_id, matchId: row.match_id, teamId: row.team_id, teamName: team?.name ?? 'Team',
        kind: row.kind, appealOf: row.appeal_of, subject: row.subject, grounds: row.grounds, status: row.status,
        decision: row.decision, decidedAt: row.decided_at, createdAt: row.created_at,
      }
    }),
  }
}

export async function fileProtest(client: SupabaseClient, input: { tournamentId: string; teamId: string; matchId: string | null; subject: string; grounds: string; appealOf?: string | null }): Promise<{ error: string | null }> {
  const problem = protestInputProblem(input)
  if (problem) return { error: problem }
  const result = await client.rpc('file_tournament_protest', {
    p_tournament: input.tournamentId, p_team: input.teamId, p_match: input.matchId, p_subject: input.subject.trim(), p_grounds: input.grounds.trim(), p_appeal_of: input.appealOf ?? null,
  })
  return { error: result.error ? protestProblem(result.error.message) : null }
}

export async function decideProtest(client: SupabaseClient, id: string, status: 'under_review' | 'upheld' | 'rejected', decision: string): Promise<{ error: string | null }> {
  if (status !== 'under_review' && decision.trim().length < 10) return { error: protestProblem('decision_reason_required') }
  const result = await client.rpc('decide_tournament_protest', { p_protest: id, p_status: status, p_decision: decision.trim() || null })
  return { error: result.error ? protestProblem(result.error.message) : null }
}

export async function withdrawProtest(client: SupabaseClient, id: string): Promise<{ error: string | null }> {
  const result = await client.rpc('withdraw_tournament_protest', { p_protest: id })
  return { error: result.error ? protestProblem(result.error.message) : null }
}

// A decided protest that has no live appeal yet may be appealed once.
export function canAppeal(protest: Protest, all: Protest[]): boolean {
  return protest.kind === 'protest' && (protest.status === 'upheld' || protest.status === 'rejected')
    && !all.some(other => other.appealOf === protest.id && other.status !== 'withdrawn')
}

export const openProtestCount = (list: Protest[]) => list.filter(item => item.status === 'submitted' || item.status === 'under_review').length
