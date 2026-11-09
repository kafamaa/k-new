import type { SupabaseClient } from '@supabase/supabase-js'
import type { RecordResult, Sport } from './records'
import type { TournamentCategory } from './organizer'
import { documentLimit, sizeLabel } from './appConfig'

// Nine wizard stages (2026-10-23 revision of the owner's simple 9-step setup).
// The database keeps step_number 1..11, so the wizard maps its stages onto the
// EXISTING keys and no stored row changes meaning or is lost: stages 1-8 use
// keys 1-8, stage 9 (Review and launch) uses key 11, and the retired keys 9-10
// remain real data for the standalone Officials & Operations and Finance
// management modules, which live outside this wizard.
export const SETUP_STEPS = ['Basics', 'Categories', 'Registration', 'Registration form', 'Roster requirements', 'Competition format', 'Rules and standings', 'Venues and scheduling', 'Review and launch'] as const
export type SetupStep = typeof SETUP_STEPS[number]
// 'deferred' = an explicit Set-later decision; 'needs_review' = an earlier
// change invalidated a later stage. Both stay deliberately incomplete in
// progress terms, so the wizard can never claim them done by accident.
export type SetupStepStatus = 'not_started' | 'in_progress' | 'complete' | 'blocked' | 'deferred' | 'needs_review'

export const SETUP_STEP_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 11] as const
export type SetupStepStatuses = SetupStepStatus | (typeof SETUP_STEP_KEYS)[number]
export type RegistrationMethod = 'open' | 'schedule' | 'manual_add'

// Wizard position n (1..9) -> stored step_number.
export function setupStepKey(wizardStep: number): number {
  if (!Number.isInteger(wizardStep) || wizardStep < 1 || wizardStep > SETUP_STEPS.length) return 1
  return SETUP_STEP_KEYS[wizardStep - 1]
}

export function validateSetupStep(stepNumber: number, data: Record<string, unknown>, now = Date.now()): string | null {
  if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > SETUP_STEPS.length) return 'Choose a valid setup step.'
  if (stepNumber === 1 && (typeof data.name !== 'string' || !data.name.trim())) return 'Tournament name is required.'
  if (stepNumber === 3) return validateRegistrationStep(data, now)
  if (stepNumber === 5 && data.rosterMin !== undefined && data.rosterMax !== undefined && Number(data.rosterMax) < Number(data.rosterMin)) return 'Roster maximum cannot be below the minimum.'
  if (stepNumber === 8 && data.startsAt && data.endsAt && new Date(String(data.endsAt)) < new Date(String(data.startsAt))) return 'Tournament end date cannot be before the start date.'
  return null
}

// Stage 3 validation depends on the chosen method. Without a method the legacy
// pair-ordering check applies to keep historical drafts saving as before.
function validateRegistrationStep(data: Record<string, unknown>, now: number): string | null {
  const method = data.method === 'open' || data.method === 'schedule' || data.method === 'manual_add' ? data.method : null
  if (!method) {
    if (data.opensAt && data.closesAt && new Date(String(data.closesAt)) <= new Date(String(data.opensAt))) return 'Registration close must be after it opens.'
    return null
  }
  if (method === 'open') {
    if (!data.closesAt || !String(data.closesAt).trim()) return 'Choose a closing date and time before saving open registration.'
    if (new Date(String(data.closesAt)).getTime() <= now) return 'Closing date cannot be earlier than the current time when opening registration.'
    return null
  }
  if (method === 'schedule') {
    if (!data.opensAt || !String(data.opensAt).trim()) return 'Choose an opening date and time for the schedule.'
    if (!data.closesAt || !String(data.closesAt).trim()) return 'Choose a closing date and time for the schedule.'
    if (new Date(String(data.opensAt)).getTime() <= now) return 'Scheduled opening must be later than the current time.'
    if (new Date(String(data.closesAt)) <= new Date(String(data.opensAt))) return 'Scheduled closing must be later than the scheduled opening.'
    return null
  }
  // manual_add: dates are optional entirely.
  return null
}

// Field-level companion to validateSetupStep: maps each failing aspect to the
// input that must show the correction, so the form can point at exact fields
// instead of one summary line. The summary validator stays the single gate
// inside saveSetupStep; this function only shapes the UI display.
export function validateSetupStepFields(stepNumber: number, data: Record<string, unknown>, now = Date.now()): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > SETUP_STEPS.length) return errors
  if (stepNumber === 1 && (typeof data.name !== 'string' || !String(data.name).trim())) errors.name = 'Tournament name is required.'
  if (stepNumber === 3) {
    const method = data.method === 'open' || data.method === 'schedule' || data.method === 'manual_add' ? data.method : null
    if (!method) {
      if (data.opensAt && data.closesAt && new Date(String(data.closesAt)) <= new Date(String(data.opensAt))) errors.closesAt = 'Registration close must be after it opens.'
      return errors
    }
    if (method === 'open') {
      if (data.closesAt && new Date(String(data.closesAt)).getTime() <= now) errors.closesAt = 'Closing date cannot be earlier than the current time.'
      else if (!data.closesAt || !String(data.closesAt).trim()) errors.closesAt = 'Choose a closing date and time.'
      return errors
    }
    if (method === 'schedule') {
      if (!data.opensAt || !String(data.opensAt).trim()) errors.opensAt = 'Choose an opening date and time.'
      else if (new Date(String(data.opensAt)).getTime() <= now) errors.opensAt = 'Scheduled opening must be later than the current time.'
      if (!data.closesAt || !String(data.closesAt).trim()) errors.closesAt = 'Choose a closing date and time.'
      else if (data.opensAt && String(data.closesAt).trim() && new Date(String(data.closesAt)) <= new Date(String(data.opensAt))) errors.closesAt = 'Scheduled closing must be later than the opening.'
      return errors
    }
    return errors
  }
  if (stepNumber === 5 && data.rosterMin !== undefined && data.rosterMax !== undefined && Number(data.rosterMax) < Number(data.rosterMin)) errors.rosterMax = 'Roster maximum cannot be below the minimum.'
  if (stepNumber === 8 && data.startsAt && data.endsAt && new Date(String(data.endsAt)) < new Date(String(data.startsAt))) errors.endsAt = 'Tournament end date cannot be before the start date.'
  return errors
}

export async function saveSetupStep(client: SupabaseClient, tournamentId: string, userId: string, wizardStep: number, status: SetupStepStatus, data: Record<string, unknown>, options: { enforceValidation?: boolean } = {}): Promise<{ error: string | null }> {
  if (options.enforceValidation !== false) {
    const validationError = validateSetupStep(wizardStep, data)
    if (validationError) return { error: validationError }
  }
  // Upsert on the fixed (tournament, step) key: a retry or double submission
  // updates the same row instead of creating duplicates.
  const result = await client.from('tournament_setup_steps').upsert({ tournament_id: tournamentId, step_number: setupStepKey(wizardStep), status, data, updated_by: userId, updated_at: new Date().toISOString() })
  if (result.error) return { error: result.error.message }
  const update = await client.from('tournaments').update({ setup_stage: wizardStep, updated_at: new Date().toISOString() }).eq('id', tournamentId)
  if (update.error) return { error: update.error.message }
  // Only an untouched draft moves to 'setup'. A tournament that is already
  // published, open for registration, or further along must never be pulled
  // back by a later setup save (e.g. the review stage saved right after
  // "Publish and open registration").
  const promote = await client.from('tournaments').update({ status: 'setup' }).eq('id', tournamentId).eq('status', 'draft')
  return { error: promote.error?.message ?? null }
}

export async function saveRegistrationSettings(client: SupabaseClient, tournamentId: string, userId: string, settings: Record<string, unknown>): Promise<{ error: string | null }> {
  const result = await client.from('tournament_registration_settings').upsert({ tournament_id: tournamentId, ...settings, updated_by: userId, updated_at: new Date().toISOString() })
  return { error: result.error?.message ?? null }
}

// Suggested defaults shown at Stages 3 and 5, per sport. These are displayed
// values the organizer can change - nothing is saved without their Save.
export const SUGGESTED_SPORT_SETTINGS: Record<Sport, { rosterMin: number; rosterMax: number; officials: number }> = {
  football: { rosterMin: 7, rosterMax: 18, officials: 3 },
  futsal: { rosterMin: 5, rosterMax: 12, officials: 2 },
  handball: { rosterMin: 7, rosterMax: 14, officials: 2 },
  volleyball: { rosterMin: 6, rosterMax: 12, officials: 2 },
  basketball: { rosterMin: 5, rosterMax: 12, officials: 2 },
  basketball_3x3: { rosterMin: 3, rosterMax: 6, officials: 1 },
}

export async function addRegistrationQuestion(client: SupabaseClient, tournamentId: string, fieldKey: string, prompt: string, required: boolean, extra: { instructions?: string; responseType?: string; options?: string[] } = {}): Promise<{ error: string | null }> {
  // The table has a per-tournament unique key on field_key. A double-click or
  // retry with the same label must not fabricate a different question silently:
  // the first insert is the plain slug, and only a real duplicate conflict gets
  // a distinct suffix so both fields survive as genuinely separate questions.
  const base = (payload: string) => client.from('tournament_registration_questions').insert({
    tournament_id: tournamentId,
    field_key: payload,
    prompt: prompt.trim(),
    instructions: extra.instructions?.trim() || null,
    required,
    response_type: extra.responseType ?? 'text',
    options: extra.options ?? [],
  })
  const first = await base(fieldKey.trim())
  if (!first.error) return { error: null }
  if (!/duplicate|unique|conflict/i.test(first.error.message)) return { error: first.error.message }
  const retry = await base(`${fieldKey.trim().slice(0, 60)}_${crypto.randomUUID().slice(0, 6)}`)
  return { error: retry.error?.message ?? null }
}

export type RegistrationQuestion = {
  id: string
  field_key: string
  prompt: string
  instructions: string | null
  response_type: string
  options: string[]
  required: boolean
  sort_order: number
}

// Questions read for one tournament only. The rows drive both the organizer's
// Preview Form and (in the public application flow) what teams answer.
export async function loadRegistrationQuestions(client: SupabaseClient, tournamentId: string): Promise<RecordResult<RegistrationQuestion[]>> {
  const result = await client
    .from('tournament_registration_questions')
    .select('id,field_key,prompt,instructions,response_type,options,required,sort_order')
    .eq('tournament_id', tournamentId)
    .order('sort_order', { ascending: true })
  if (result.error) return { data: null, error: result.error.message }
  const rows = (result.data ?? []) as Array<Record<string, unknown>>
  return { data: rows.map(row => ({
    id: String(row.id),
    field_key: String(row.field_key ?? ''),
    prompt: String(row.prompt ?? ''),
    instructions: typeof row.instructions === 'string' ? row.instructions : null,
    response_type: String(row.response_type ?? 'text'),
    options: Array.isArray(row.options) ? row.options.map(String) : [],
    required: row.required === true,
    sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
  })), error: null }
}

export async function updateRegistrationQuestion(client: SupabaseClient, questionId: string, patch: Partial<Pick<RegistrationQuestion, 'prompt' | 'instructions' | 'required' | 'response_type' | 'options' | 'sort_order'>>): Promise<{ error: string | null }> {
  const result = await client.from('tournament_registration_questions').update(patch).eq('id', questionId)
  return { error: result.error?.message ?? null }
}

export async function deleteRegistrationQuestion(client: SupabaseClient, questionId: string): Promise<{ error: string | null }> {
  const result = await client.from('tournament_registration_questions').delete().eq('id', questionId)
  return { error: result.error?.message ?? null }
}

// Stage 2 edits one real category row: name, description, eligibility, and the
// per-category team limit ("maximum approved teams"). The rename of a question
// never touches answers because questions carry stable field keys; a category
// rename is likewise safe - matches and stages reference categories by id.
export async function updateTournamentCategory(client: SupabaseClient, categoryId: string, patch: Partial<{ name: string; description: string | null; age_group: string | null; gender: string | null; eligibility_instructions: string | null; team_limit: number | null; sort_order: number }>): Promise<{ error: string | null }> {
  const result = await client.from('tournament_categories').update(patch).eq('id', categoryId)
  return { error: result.error?.message ?? null }
}

// Deletion guard: `matches.category_id` references categories with ON DELETE
// RESTRICT, so a category with matches can never be deleted - the loader reads
// the count first so the UI can refuse the action with the real reason instead
// of a raw database error.
export async function countCategoryMatches(client: SupabaseClient, categoryId: string): Promise<RecordResult<number>> {
  const result = await client
    .from('matches')
    .select('id')
    .eq('category_id', categoryId)
  if (result.error) return { data: null, error: result.error.message }
  return { data: ((result.data ?? []) as unknown[]).length, error: null }
}

// Full Stage 2 editing needs the extended category columns (description,
// eligibility instructions, sort order). Those columns exist only after
// review-only migration 019 is applied, so the loader reports a typed result
// and the setup stage falls back to the plain loader with a hint instead of
// breaking category display on a not-yet-applied migration.
export type EditableTournamentCategory = TournamentCategory & {
  description: string | null
  eligibility_instructions: string | null
  sort_order: number | null
}
export async function loadEditableTournamentCategories(client: SupabaseClient, tournamentId: string): Promise<RecordResult<EditableTournamentCategory[]>> {
  const result = await client
    .from('tournament_categories')
    .select('id,name,age_group,gender,team_limit,description,eligibility_instructions,sort_order')
    .eq('tournament_id', tournamentId)
    .order('sort_order', { ascending: true })
  if (result.error) return { data: null, error: result.error.message }
  const rows = (result.data ?? []) as Array<Record<string, unknown>>
  return { data: rows.map(row => ({
    id: String(row.id),
    name: String(row.name ?? ''),
    age_group: typeof row.age_group === 'string' ? row.age_group : null,
    gender: typeof row.gender === 'string' ? row.gender : null,
    team_limit: typeof row.team_limit === 'number' ? row.team_limit : null,
    description: typeof row.description === 'string' ? row.description : null,
    eligibility_instructions: typeof row.eligibility_instructions === 'string' ? row.eligibility_instructions : null,
    sort_order: typeof row.sort_order === 'number' ? row.sort_order : null,
  })), error: null }
}

// The ready-made part of the application form. These are not re-entered by the
// organizer: each line states the real record the answer comes from, so a team
// does not type what Kulhivaru+ already stores. Fields with no column anywhere
// in the schema are absent instead of pretended.
export const REGISTRATION_STANDARD_FIELDS: ReadonlyArray<{ label: string; source: string; optional?: boolean }> = [
  { label: 'Team name', source: 'the team’s existing Kulhivaru+ record (teams.name)' },
  { label: 'Category', source: 'the category the team applies into (tournament_categories)', optional: false },
  { label: 'Team logo', source: 'the team’s record (teams.logo_url)', optional: true },
  { label: 'Manager name', source: 'the team record’s manager details' },
  { label: 'Manager phone number', source: 'the team record’s manager contact' },
  { label: 'Manager email', source: 'the team record’s manager contact', optional: true },
  { label: 'Island', source: 'the team’s record (teams.island)' },
  { label: 'First jersey colour', source: 'captured at first use — no column exists yet' },
  { label: 'Second jersey colour', source: 'captured at first use — no column exists yet' },
]

export type RegistrationFormField = {
  key: string
  label: string
  instructions: string | null
  required: boolean
  kind: 'text' | 'long_text' | 'number' | 'select' | 'checkbox' | 'date'
  options: string[]
}

// One canonical model of the form teams see. Silver preview (organizer side
// now) and the future public application form must both render from THIS list,
// so they can never drift apart.
export function registrationFormFields(questions: ReadonlyArray<RegistrationQuestion>): RegistrationFormField[] {
  return questions.map(question => ({
    key: question.field_key,
    label: question.prompt,
    instructions: question.instructions,
    required: question.required,
    kind: question.response_type === 'long_text' || question.response_type === 'number' || question.response_type === 'select' || question.response_type === 'date'
      ? question.response_type as RegistrationFormField['kind']
      : question.response_type === 'boolean' ? 'checkbox' : 'text',
    options: question.options,
  }))
}

export async function createTournamentDraft(client: SupabaseClient, userId: string, organizationId: string, name: string, sport: Sport): Promise<RecordResult<{ id: string }>> {
  const result = await client.from('tournaments').insert({ organization_id: organizationId, name: name.trim(), slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${crypto.randomUUID().slice(0, 8)}`, sport, status: 'draft', setup_stage: 1, created_by: userId }).select('id').single()
  return { data: result.data, error: result.error?.message ?? null }
}

export async function submitTeamApplication(client: SupabaseClient, tournamentId: string, teamId: string): Promise<RecordResult<{ id: string }>> {
  const result = await client.from('tournament_entries').insert({ tournament_id: tournamentId, team_id: teamId, application_status: 'submitted', submitted_at: new Date().toISOString() }).select('id').single()
  return { data: result.data, error: result.error?.message ?? null }
}

export async function reviewApplication(client: SupabaseClient, entryId: string, status: 'approved' | 'rejected' | 'changes_requested' | 'waitlisted' | 'withdrawn' | 'under_review', notes: string): Promise<{ error: string | null }> {
  const result = await client.from('tournament_entries').update({ application_status: status, review_notes: notes.trim(), reviewed_at: new Date().toISOString() }).eq('id', entryId)
  return { error: result.error?.message ?? null }
}

export async function updateEntryPaymentStatus(client: SupabaseClient, entryId: string, paymentStatus: 'not_required' | 'unpaid' | 'proof_submitted' | 'under_review' | 'paid' | 'waived' | 'refunded' | 'overdue' | 'rejected'): Promise<{ error: string | null }> {
  const result = await client.from('tournament_entries').update({ payment_status: paymentStatus, updated_at: new Date().toISOString() }).eq('id', entryId)
  return { error: result.error?.message ?? null }
}

export async function submitRoster(client: SupabaseClient, entryId: string, playerIds: string[], actorId: string): Promise<RecordResult<{ id: string }>> {
  if (playerIds.length === 0) return { data: null, error: 'Add at least one player to the roster.' }
  const result = await client.rpc('submit_roster', { p_entry_id: entryId, p_player_ids: playerIds, p_actor_id: actorId })
  return { data: result.data ? { id: result.data as string } : null, error: result.error?.message ?? null }
}

export async function uploadPrivateDocument(client: SupabaseClient, tournamentId: string, entryId: string, userId: string, file: File, documentType: string): Promise<RecordResult<{ id: string }>> {
  if (file.size === 0 || file.size > documentLimit()) return { data: null, error: `Document must be smaller than ${sizeLabel(documentLimit())}.` }
  const path = `${tournamentId}/${entryId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const upload = await client.storage.from('tournament-private-documents').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upload.error) return { data: null, error: upload.error.message }
  const metadata = await client.from('private_documents').insert({ tournament_id: tournamentId, entry_id: entryId, document_type: documentType, storage_path: path, original_name: file.name, mime_type: file.type || 'application/octet-stream', size_bytes: file.size, uploaded_by: userId }).select('id').single()
  if (metadata.error) { await client.storage.from('tournament-private-documents').remove([path]); return { data: null, error: metadata.error.message } }
  return { data: metadata.data, error: null }
}

// Teams page "Open registration" (owner, 2026-11-03): the closing date, an
// optional team cap and an optional entry fee, saved into the same records the
// Registration stage of More → Tournament settings uses.
export async function saveQuickRegistration(client: SupabaseClient, tournamentId: string, userId: string, input: { closesAt: string; maxApplications: number | null; feeMvr: number | null; current: Record<string, unknown> }): Promise<{ error: string | null }> {
  const step = await saveSetupStep(client, tournamentId, userId, 3, 'complete', { ...input.current, method: 'open', closesAt: input.closesAt, ...(input.maxApplications ? { maxApplications: input.maxApplications } : {}) }, { enforceValidation: false })
  if (step.error) return { error: 'The registration settings could not be saved. Please try again.' }
  const settings = await saveRegistrationSettings(client, tournamentId, userId, { application_method: 'team_application', closes_at: input.closesAt, ...(input.maxApplications ? { max_applications: input.maxApplications } : {}) })
  if (settings.error) return { error: 'The registration settings could not be saved. Please try again.' }
  if (input.feeMvr !== null && input.feeMvr > 0) {
    const existing = await client.from('tournament_fees').select('id').eq('tournament_id', tournamentId).eq('label', 'Entry fee').maybeSingle()
    const fee = existing.data?.id
      ? await client.from('tournament_fees').update({ amount_mvr: input.feeMvr }).eq('id', existing.data.id)
      : await client.from('tournament_fees').insert({ tournament_id: tournamentId, label: 'Entry fee', amount_mvr: input.feeMvr, required: true })
    if (fee.error) return { error: 'Registration settings were saved, but the fee was not. Add it under More → Finance & sponsors.' }
  }
  return { error: null }
}
