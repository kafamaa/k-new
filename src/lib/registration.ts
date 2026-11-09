import type { SupabaseClient } from '@supabase/supabase-js'
import { loadRegistrationQuestions, registrationFormFields, type RegistrationQuestion } from './tournament'

// ---------------------------------------------------------------------------
// Public application submission (Product Specification section 13).
//
// The authorized writer is a signed-in team manager: the applied entries
// insert policy ("team managers submit applications", migration 0004 with the
// amended open-window check in review-only 019) verifies ownership server-side,
// the entries table enforces one application per (tournament, team) through a
// UNIQUE constraint, and answers are written through the participant policies
// on tournament_registration_answers. This module never relaxes those bounds;
// it only prepares validated values and maps database denials into honest
// messages.
// ---------------------------------------------------------------------------

export type ManagedTeam = { id: string; name: string; slug: string; teamType: string; island: string }

export async function loadManagedTeams(client: SupabaseClient, userId: string): Promise<{ data: ManagedTeam[]; error: string | null }> {
  // Membership rows are self-readable ("team members read memberships", 0001);
  // the team embed resolves through the membership-based policy on teams.
  const result = await client.from('team_memberships').select('role,teams(id,name,slug,team_type,island)').eq('user_id', userId).order('created_at')
  if (result.error) return { data: [], error: result.error.message }
  const teams: ManagedTeam[] = (result.data ?? []).flatMap(row => {
    if (String(row.role ?? '') !== 'manager') return []
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
    if (!team || !team.name || !team.slug) return []
    return [{ id: String(team.id), name: String(team.name), slug: String(team.slug), teamType: String(team.team_type ?? ''), island: String(team.island ?? '') }]
  })
  return { data: teams, error: null }
}

export type AnswerValues = Record<string, string | number | boolean>

// Per-field validation against the canonical form model the organizer
// previewed and the public page rendered. Returns per-field problems plus the
// coerced, submission-ready answer map.
export function validateApplicationValues(fields: ReturnType<typeof registrationFormFields>, values: AnswerValues): { problems: Record<string, string>; answers: AnswerValues } {
  const problems: Record<string, string> = {}
  const answers: AnswerValues = {}
  for (const field of fields) {
    const raw = values[field.key]
    const empty = raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())
    if (empty) {
      if (field.required) problems[field.key] = 'This field is required.'
      continue
    }
    if (field.kind === 'number') {
      const parsed = Number(raw)
      if (Number.isNaN(parsed)) { problems[field.key] = 'Enter a number.'; continue }
      answers[field.key] = parsed
    } else if (field.kind === 'checkbox') {
      answers[field.key] = raw === true || raw === 'true'
    } else if (field.kind === 'select') {
      const value = String(raw)
      if (field.options.length && !field.options.includes(value)) { problems[field.key] = 'Choose one of the offered options.'; continue }
      answers[field.key] = value
    } else {
      answers[field.key] = String(raw).trim()
    }
  }
  return { problems, answers }
}

export async function loadApplicationQuestions(client: SupabaseClient, tournamentId: string): Promise<{ questions: RegistrationQuestion[]; error: string | null }> {
  const result = await loadRegistrationQuestions(client, tournamentId)
  return { questions: result.data ?? [], error: result.error }
}

export function questionIdByKey(questions: readonly RegistrationQuestion[]): Map<string, string> {
  return new Map(questions.filter(question => Boolean(question.id)).map(question => [question.field_key, question.id]))
}

export async function loadExistingApplication(client: SupabaseClient, tournamentId: string, teamId: string): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  // Reading the paired entry first avoids a hard unique-violation error when
  // the team already applied: a draft can be submitted from here, an already
  // submitted one shows its status instead of a second insert.
  const result = await client.from('tournament_entries').select('id,application_status,roster_status,review_notes').eq('tournament_id', tournamentId).eq('team_id', teamId).maybeSingle()
  return { data: (result.data ?? null) as Record<string, unknown> | null, error: result.error?.message ?? null }
}

export type ApplicationOutcome = {
  entryId: string | null
  status: 'submitted' | 'already_submitted' | 'draft_resubmitted' | null
  error: string | null
}

export async function submitApplication(
  client: SupabaseClient,
  input: { tournamentId: string; teamId: string; userId: string; questions: readonly RegistrationQuestion[]; fields: ReturnType<typeof registrationFormFields>; values: AnswerValues },
): Promise<ApplicationOutcome> {
  const { problems, answers } = validateApplicationValues(input.fields, input.values)
  if (Object.keys(problems).length) return { entryId: null, status: null, error: `Fix the highlighted fields: ${Object.keys(problems).length} field${Object.keys(problems).length === 1 ? '' : 's'} need attention.` }

  const existing = await loadExistingApplication(client, input.tournamentId, input.teamId)
  if (existing.error) return { entryId: null, status: null, error: `The application state could not be checked: ${existing.error}` }
  if (existing.data && String(existing.data.application_status) !== 'draft') {
    return { entryId: String(existing.data.id), status: 'already_submitted', error: null }
  }

  let entryId: string
  if (existing.data) {
    // A saved draft becomes the official submission. The entry-status trigger
    // keeps this transition team-manager-legal (draft -> submitted).
    const update = await client.from('tournament_entries').update({ application_status: 'submitted', submitted_at: new Date().toISOString() }).eq('id', String(existing.data.id)).select('id')
    if (update.error) return { entryId: null, status: null, error: applicationWriteError(update.error) }
    entryId = String((update.data as Array<{ id: string }>)[0].id)
  } else {
    const insert = await client.from('tournament_entries').insert({ tournament_id: input.tournamentId, team_id: input.teamId, application_status: 'submitted', submitted_by: input.userId, submitted_at: new Date().toISOString() }).select('id')
    if (insert.error) return { entryId: null, status: null, error: applicationWriteError(insert.error) }
    entryId = String((insert.data as Array<{ id: string }>)[0].id)
  }

  const ids = questionIdByKey(input.questions)
  const answerRows = Object.entries(answers).flatMap(([fieldKey, value]) => {
    const questionId = ids.get(fieldKey)
    return questionId ? [{ entry_id: entryId, question_id: questionId, answer: value }] : []
  })
  if (answerRows.length) {
    const written = await client.from('tournament_registration_answers').upsert(answerRows, { onConflict: 'entry_id,question_id' })
    if (written.error) return { entryId, status: 'submitted', error: `The application was submitted, but ${written.error.message.includes('row-level security') ? 'the form answers could not be stored (answers are private to this team and the organizer)' : written.error.message}` }
  }
  return { entryId, status: existing.data ? 'draft_resubmitted' : 'submitted', error: null }
}

export function applicationWriteError(error: { message: string; code?: string }): string {
  const message = error.message ?? ''
  const code = error.code ?? ''
  // Unique (tournament_id, team_id) - migration 0004 line 71.
  if (code === '23505' || /duplicate key/i.test(message)) return 'This team already has an application in this tournament.'
  if (/row-level security/i.test(message)) {
    if (/team managers submit applications|registration_open|status = 'registration_open'/i.test(message)) return 'Registration is not open for submissions right now. The tournament page shows the current window.'
    return 'The database denied this submission under the application policies. Verify you manage this team and that registration is open.'
  }
  return message
}

export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', submitted: 'Submitted', under_review: 'Under review', changes_requested: 'Changes requested',
  approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn', waitlisted: 'Waitlisted',
}

export function applicationStatusLabel(status: string): string {
  return APPLICATION_STATUS_LABELS[status] ?? 'Status recorded'
}

export function actionsForApplicationStatus(status: string): Array<'submit' | 'resubmit' | 'withdraw'> {
  if (status === 'draft') return ['submit', 'withdraw']
  if (status === 'changes_requested') return ['resubmit', 'withdraw']
  if (status === 'submitted') return ['withdraw']
  return []
}
