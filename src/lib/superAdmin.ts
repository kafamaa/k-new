import type { SupabaseClient } from '@supabase/supabase-js'
import { ADMIN_WORKSPACE_HASH, needsMigration } from './adminAccess'
import { csvCell as cell } from './csvSafe'
export { ADMIN_WORKSPACE_HASH, adminRoleLabel, checkAdminAccess, isLegacyAdminHash, legacyAdminTarget, loadAdminAccess, needsMigration, type AdminAccessState } from './adminAccess'

// Super Admin (migration 202611010034). The database decides every permission;
// this file only names pages, maps errors to plain words and wraps the admin RPCs.

export type AdminPermission =
  | 'admin.dashboard.read' | 'admin.cases.manage' | 'admin.cases.child_safety' | 'admin.accounts.read' | 'admin.accounts.suspend'
  | 'admin.sessions.revoke' | 'admin.identities.review' | 'admin.organizations.moderate' | 'admin.teams.moderate' | 'admin.players.moderate'
  | 'admin.tournaments.moderate' | 'admin.results.review' | 'admin.content.moderate' | 'admin.support.manage' | 'admin.data_requests.manage'
  | 'admin.finance.audit' | 'admin.notifications.manage' | 'admin.audit.read' | 'admin.audit.export' | 'admin.security.manage'
  | 'admin.system.read' | 'admin.configuration.manage' | 'admin.customization.edit' | 'admin.customization.publish'
  | 'admin.customization.rollback' | 'admin.admins.manage' | 'admin.records.create'

export type AdminGroupId = 'overview' | 'people' | 'sports' | 'operations' | 'platform'
export type AdminPageId =
  | 'overview' | 'cases' | 'identities' | 'support' | 'data-requests' | 'security-incidents'
  | 'accounts' | 'organizations' | 'teams' | 'players' | 'tournaments'
  | 'matches' | 'approvals' | 'content' | 'finance' | 'notifications'
  | 'audit' | 'security' | 'system' | 'configuration' | 'customization' | 'admins' | 'create'

// `any` lists the permissions that open a page: one of them is enough.
// `later` marks Release Two pages: shown as planned, never as working.
export type AdminPage = { id: AdminPageId; label: string; group: AdminGroupId; any: AdminPermission[]; later?: boolean }

export const ADMIN_PAGES: AdminPage[] = [
  { id: 'overview', label: 'Overview', group: 'overview', any: ['admin.dashboard.read'] },
  { id: 'cases', label: 'Cases & moderation', group: 'operations', any: ['admin.cases.manage', 'admin.content.moderate'] },
  { id: 'identities', label: 'Identity verification', group: 'operations', any: ['admin.identities.review'] },
  { id: 'support', label: 'Support', group: 'platform', any: ['admin.support.manage'] },
  { id: 'data-requests', label: 'Privacy & data', group: 'operations', any: ['admin.data_requests.manage'] },
  { id: 'security-incidents', label: 'Security incidents', group: 'platform', any: ['admin.security.manage'] },
  { id: 'accounts', label: 'Accounts', group: 'people', any: ['admin.accounts.read'] },
  { id: 'organizations', label: 'Organizations', group: 'people', any: ['admin.organizations.moderate'] },
  { id: 'teams', label: 'Teams', group: 'people', any: ['admin.teams.moderate'] },
  { id: 'players', label: 'Players', group: 'people', any: ['admin.players.moderate'] },
  { id: 'create', label: 'Create on behalf', group: 'people', any: ['admin.records.create'] },
  { id: 'tournaments', label: 'Tournaments', group: 'sports', any: ['admin.tournaments.moderate'] },
  { id: 'matches', label: 'Results integrity', group: 'sports', any: ['admin.results.review'] },
  { id: 'approvals', label: 'Critical approvals', group: 'sports', any: ['admin.results.review', 'admin.identities.review'] },
  { id: 'content', label: 'Landing content & news', group: 'platform', any: ['admin.content.moderate'] },
  { id: 'finance', label: 'Finance audit', group: 'sports', any: ['admin.finance.audit'] },
  { id: 'notifications', label: 'Notifications', group: 'platform', any: ['admin.notifications.manage'] },
  { id: 'audit', label: 'Audit log', group: 'operations', any: ['admin.audit.read'] },
  { id: 'security', label: 'Security', group: 'platform', any: ['admin.security.manage'] },
  { id: 'system', label: 'System health', group: 'platform', any: ['admin.system.read'] },
  { id: 'configuration', label: 'Feature controls & configuration', group: 'platform', any: ['admin.configuration.manage'] },
  { id: 'customization', label: 'Full app customization', group: 'platform', any: ['admin.customization.edit', 'admin.customization.publish'] },
  { id: 'admins', label: 'Administrators', group: 'people', any: ['admin.admins.manage'] },
]

export const ADMIN_GROUPS: Array<{ id: AdminGroupId; label: string }> = [
  // Final plan 6.3. The ids stay the same so saved links keep working.
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'Records & Access' },
  { id: 'sports', label: 'Sports Operations' },
  { id: 'operations', label: 'Trust & Safety' },
  { id: 'platform', label: 'Platform Settings' },
]

export const canOpen = (page: AdminPage, permissions: readonly string[]) => page.any.some(permission => permissions.includes(permission))
export const visiblePages = (permissions: readonly string[]) => ADMIN_PAGES.filter(page => canOpen(page, permissions))

// The Super Admin workspace lives at #workspace/platform-admin/<page>?query. Older
// #admin/<page> links still parse (App redirects them). Unknown pages fall back to Overview.
export function parseAdminHash(hash: string): { page: AdminPageId; params: URLSearchParams } {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const parts = path.split('/')
  const segment = (parts[0] === 'workspace' ? parts[2] : parts[1]) ?? ''
  const page = ADMIN_PAGES.find(item => item.id === segment)?.id ?? 'overview'
  return { page, params: new URLSearchParams(query) }
}
export const adminHash = (page: AdminPageId, params?: Record<string, string | null | undefined>) => {
  const query = new URLSearchParams(Object.entries(params ?? {}).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString()
  return `${ADMIN_WORKSPACE_HASH}/${page}${query ? `?${query}` : ''}`
}

export const ROLE_LABELS: Record<string, string> = {
  platform_owner: 'Platform Owner', security_admin: 'Security Admin', identity_reviewer: 'Identity Reviewer', moderator: 'Moderator',
  support_agent: 'Support Agent', finance_auditor: 'Finance Auditor', content_admin: 'Content Admin',
  customization_designer: 'Customization Designer', customization_publisher: 'Customization Publisher', technical_operator: 'Technical Operator', sports_operations: 'Sports Operations',
}
export const ROLES = Object.keys(ROLE_LABELS)

export const CASE_TYPES: Record<string, string> = {
  content_report: 'Content report', duplicate_player: 'Duplicate player', claim_dispute: 'Claim dispute', identity_correction: 'Identity correction',
  impersonation: 'Impersonation', account_compromise: 'Account compromise', team_ownership: 'Team ownership', organization_ownership: 'Organization ownership',
  result_dispute: 'Match/result dispute', privacy_request: 'Privacy request', data_request: 'Data request', account_closure: 'Account closure',
  child_safety: 'Child-safety concern', technical_support: 'Technical support',
}
export const CASE_STATUSES: Record<string, string> = {
  new: 'New', triaged: 'Triaged', assigned: 'Assigned', under_review: 'Under review', waiting_user: 'Waiting for user',
  waiting_organization: 'Waiting for organization', escalated: 'Escalated', resolved: 'Resolved', rejected: 'Rejected', closed: 'Closed', reopened: 'Reopened',
}
export const CLOSED_STATUSES = ['resolved', 'rejected', 'closed']
export const SEVERITIES: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', critical: 'Critical' }

// Which case types each Cases page shows.
export const CASE_QUEUES: Partial<Record<AdminPageId, string[]>> = {
  cases: ['content_report', 'impersonation', 'child_safety', 'result_dispute', 'team_ownership', 'organization_ownership'],
  identities: ['duplicate_player', 'claim_dispute', 'identity_correction', 'impersonation'],
  support: ['technical_support', 'team_ownership', 'organization_ownership'],
  'data-requests': ['privacy_request', 'data_request', 'account_closure'],
  'security-incidents': ['account_compromise'],
}

// Plain words for every error the admin functions raise. Raw service text is never shown.
const ADMIN_ERRORS: Array<[RegExp, string]> = [
  [/admin_permission_denied/, 'Your administrator role does not allow this action.'],
  [/not_signed_in|JWT|jwt/, 'Your session has ended. Please sign in again.'],
  [/invalid_name/, 'Enter a name of 2 to 120 characters.'],
  [/account_not_found/, 'That account could not be found. Search again.'],
  [/organization_not_found/, 'That organization could not be found. Search again.'],
  [/invalid_sport/, 'Choose a sport from the list.'],
  [/invalid_team_type/, 'Choose a team type from the list.'],
  [/reauthentication_required/, 'For your security, sign in again (within the last 30 minutes) before this action.'],
  [/reason_required/, 'Enter a reason of at least 5 characters.'],
  [/reason_too_long/, 'The reason is too long (1,000 characters at most).'],
  [/self_action_not_allowed|self_approval_not_allowed/, 'You cannot approve or change your own access or account.'],
  [/protected_account/, 'This account belongs to an administrator and cannot be changed here.'],
  [/already_hidden/, 'This record is already hidden.'],
  [/not_hidden/, 'This record is not hidden.'],
  [/hidden_by_platform/, 'This record was hidden by the platform and cannot be published.'],
  [/decision_required/, 'Write the decision before resolving or rejecting the case.'],
  [/invalid_transition/, 'That step is not available in the current state.'],
  [/assignee_not_admin/, 'Cases can only be assigned to an active administrator.'],
  [/cannot_grant_more_than_you_hold/, 'You cannot grant permissions you do not have yourself.'],
  [/already_assigned/, 'This person already has that role (or a pending proposal for it).'],
  [/account_not_found/, 'No account uses that email address.'],
  [/invalid_expiry/, 'Choose an expiry date in the future.'],
  [/invalid_configuration/, 'The customization contains a value that is not allowed.'],
  [/version_locked/, 'This version is in review or published and can no longer be edited. Create a new draft.'],
  [/already_pending/, 'There is already a pending proposal for this. Decide on it first.'],
  [/merge_blocked/, 'This merge is blocked. Check the problems listed in the preview.'],
  [/invalid_score/, 'Enter both scores as numbers of zero or more.'],
  [/already_frozen/, 'This result is already frozen.'],
  [/not_frozen/, 'This result is not frozen.'],
  [/already_flagged/, 'This record already has an open finding.'],
  [/finance_record_frozen/, 'This finance record is frozen by a platform audit.'],
  [/media_in_use/, 'This file is used by a live or pending customization and cannot be archived.'],
  [/merged_profile/, 'This player profile was merged into another and cannot be changed.'],
  [/invalid_tags/, 'Tags can use lowercase letters, numbers and dashes only.'],
  [/not_found/, 'This record could not be found. It may have changed; refresh and try again.'],
  [/PGRST202|Could not find the function|does not exist|schema cache/, 'This Super Admin feature needs migrations 202611010034 and 202611010035 to be applied.'],
  [/Failed to fetch|NetworkError|network/i, 'The service could not be reached. Check your connection and try again.'],
]
export function adminProblem(message: string | null | undefined): string {
  if (!message) return 'Something went wrong. Please try again.'
  return ADMIN_ERRORS.find(([pattern]) => pattern.test(message))?.[1] ?? 'This action could not be completed. Please try again.'
}

export type Result<T> = { data: T; error: string | null; missing?: boolean }
export async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>, fallback: T): Promise<Result<T>> {
  const result = await client.rpc(name, args)
  if (result.error) return { data: fallback, error: adminProblem(result.error.message), missing: needsMigration(result.error.message) }
  return { data: (result.data ?? fallback) as T, error: null }
}

export type Overview = Partial<Record<'openCases' | 'criticalCases' | 'myCases' | 'overdueCases' | 'supportCases' | 'openReports' | 'identityRequests' | 'dataRequests' | 'deliveryFailures' | 'syncConflicts' | 'pendingAdminApprovals' | 'pendingActions' | 'suspendedAccounts' | 'customizationReviews' | 'hiddenRecords', number>>
export const loadOverview = (client: SupabaseClient) => rpc<Overview>(client, 'admin_overview', {}, {})

// The single most urgent task the caller may act on (specification section 8).
export function adminNextAction(overview: Overview): { label: string; hint: string; page: AdminPageId } | null {
  const steps: Array<[number | undefined, string, string, AdminPageId]> = [
    [overview.criticalCases, 'Review critical cases', 'critical case(s) are open', 'cases'],
    [overview.pendingActions, 'Decide on critical approvals', 'high-impact change(s) need a second administrator', 'approvals'],
    [overview.identityRequests, 'Review identity requests', 'identity or duplicate request(s) are waiting', 'identities'],
    [overview.pendingAdminApprovals, 'Decide on administrator proposals', 'proposal(s) need a second administrator', 'admins'],
    [overview.openReports, 'Triage public reports', 'report(s) from visitors are open', 'cases'],
    [overview.dataRequests, 'Handle privacy and data requests', 'request(s) are waiting', 'data-requests'],
    [overview.overdueCases, 'Catch up on overdue cases', 'case(s) are past their target date', 'cases'],
    [overview.syncConflicts, 'Review result conflicts', 'match result conflict(s) need review', 'matches'],
    [overview.customizationReviews, 'Review customization', 'version(s) are waiting for review', 'customization'],
    [overview.deliveryFailures, 'Check failed notifications', 'notification(s) failed to deliver', 'notifications'],
    [overview.myCases, 'Continue your assigned cases', 'case(s) are assigned to you', 'cases'],
  ]
  const step = steps.find(([count]) => (count ?? 0) > 0)
  return step ? { label: step[1], hint: `${step[0]} ${step[2]}.`, page: step[3] } : null
}

export type AdminCase = {
  id: string; reference: string; case_type: string; status: string; severity: string; title: string; summary: string | null
  subject_type: string | null; subject_ref: string | null; subject_label: string | null; assigned_to: string | null; due_at: string | null
  decision: string | null; user_response: string | null; related_case_ids: string[]; created_at: string; updated_at: string; resolved_at: string | null; source_report_id: string | null
}
export type CaseMessage = { id: string; body: string; is_internal: boolean; author_id: string | null; created_at: string }
const CASE_FIELDS = 'id,reference,case_type,status,severity,title,summary,subject_type,subject_ref,subject_label,assigned_to,due_at,decision,user_response,related_case_ids,created_at,updated_at,resolved_at,source_report_id'
export const CASE_PAGE_SIZE = 20

export async function loadCases(client: SupabaseClient, options: { types?: string[]; state: 'open' | 'closed' | 'mine' | 'all'; me: string; page: number }): Promise<Result<{ rows: AdminCase[]; total: number }>> {
  let query = client.from('platform_cases').select(CASE_FIELDS, { count: 'exact' })
  if (options.types?.length) query = query.in('case_type', options.types)
  if (options.state === 'open') query = query.not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
  if (options.state === 'closed') query = query.in('status', CLOSED_STATUSES)
  if (options.state === 'mine') query = query.eq('assigned_to', options.me).not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
  const from = options.page * CASE_PAGE_SIZE
  const result = await query.order('updated_at', { ascending: false }).order('id').range(from, from + CASE_PAGE_SIZE - 1)
  if (result.error) return { data: { rows: [], total: 0 }, error: adminProblem(result.error.message), missing: needsMigration(result.error.message) }
  return { data: { rows: (result.data ?? []) as AdminCase[], total: result.count ?? 0 }, error: null }
}
export async function loadCaseMessages(client: SupabaseClient, caseId: string): Promise<Result<CaseMessage[]>> {
  const result = await client.from('platform_case_messages').select('id,body,is_internal,author_id,created_at').eq('case_id', caseId).order('created_at')
  if (result.error) return { data: [], error: adminProblem(result.error.message) }
  return { data: (result.data ?? []) as CaseMessage[], error: null }
}
export const openCase = (client: SupabaseClient, input: { type: string; title: string; summary: string; severity: string; subjectType?: string | null; subjectRef?: string | null; subjectLabel?: string | null }) =>
  rpc<string | null>(client, 'admin_open_case', { p_type: input.type, p_title: input.title, p_summary: input.summary, p_severity: input.severity, p_subject_type: input.subjectType ?? null, p_subject_ref: input.subjectRef ?? null, p_subject_label: input.subjectLabel ?? null }, null)
export const updateCase = (client: SupabaseClient, caseId: string, reason: string, change: { status?: string; severity?: string; assignee?: string; unassign?: boolean; decision?: string; userResponse?: string }) =>
  rpc<null>(client, 'admin_update_case', { p_case: caseId, p_reason: reason, p_status: change.status ?? null, p_severity: change.severity ?? null, p_assignee: change.assignee ?? null, p_unassign: change.unassign ?? false, p_decision: change.decision ?? null, p_user_response: change.userResponse ?? null }, null)
export const addCaseNote = (client: SupabaseClient, caseId: string, body: string, internal: boolean) => rpc<string | null>(client, 'admin_add_case_note', { p_case: caseId, p_body: body, p_internal: internal }, null)
export const caseFromReport = (client: SupabaseClient, reportId: string) => rpc<string | null>(client, 'admin_case_from_report', { p_report: reportId }, null)

export type DirectoryType = 'organization' | 'team' | 'player' | 'tournament' | 'news'
export type DirectoryRow = { id: string; label: string; slug: string; published: boolean; hidden: boolean; created_at: string; detail: Record<string, unknown>; open_reports: number; total: number }
export const DIRECTORY_PAGE_SIZE = 20
export const loadDirectory = (client: SupabaseClient, type: DirectoryType, query: string, filter: string, page: number) =>
  rpc<DirectoryRow[]>(client, 'admin_directory', { p_type: type, p_query: query || null, p_filter: filter, p_limit: DIRECTORY_PAGE_SIZE, p_offset: page * DIRECTORY_PAGE_SIZE }, [])
export const setVisibility = (client: SupabaseClient, type: DirectoryType, id: string, hide: boolean, reason: string, caseId?: string | null) =>
  rpc<null>(client, 'admin_set_visibility', { p_target_type: type, p_target_id: id, p_hide: hide, p_reason: reason, p_case: caseId ?? null }, null)
export const PUBLIC_PATH: Record<DirectoryType, string> = { organization: 'organization', team: 'team', player: 'player', tournament: 'tournament', news: 'news' }

export type AccountRow = { id: string; display_name: string; email: string; email_verified: boolean; created_at: string; last_sign_in_at: string | null; status: string; session_count: number; player_profiles: number; teams: number; organizations: number; is_admin: boolean; total: number }
export const searchAccounts = (client: SupabaseClient, query: string, page: number) =>
  rpc<AccountRow[]>(client, 'admin_search_accounts', { p_query: query || null, p_limit: DIRECTORY_PAGE_SIZE, p_offset: page * DIRECTORY_PAGE_SIZE }, [])
export const revokeSessions = (client: SupabaseClient, userId: string, reason: string) => rpc<number>(client, 'admin_revoke_sessions', { p_user: userId, p_reason: reason, p_case: null }, 0)
export const setAccountStatus = (client: SupabaseClient, userId: string, status: 'active' | 'suspended', reason: string) => rpc<null>(client, 'admin_set_account_status', { p_user: userId, p_status: status, p_reason: reason, p_case: null }, null)

export type ResultIssue = { match_id: string; tournament_name: string; tournament_slug: string; home_name: string | null; away_name: string | null; status: string; scheduled_at: string | null; versions: number; conflicts: number; sync_conflicts: number; corrected: boolean; total: number }
export const loadResultIssues = (client: SupabaseClient, filter: string, page: number) =>
  rpc<ResultIssue[]>(client, 'admin_result_issues', { p_filter: filter, p_limit: DIRECTORY_PAGE_SIZE, p_offset: page * DIRECTORY_PAGE_SIZE }, [])

export type AuditEvent = { id: number; actor_id: string | null; actor_roles: string | null; action: string; target_type: string; target_id: string | null; target_label: string | null; reason: string | null; case_id: string | null; before_summary: unknown; after_summary: unknown; created_at: string }
export const AUDIT_PAGE_SIZE = 25
export async function loadAudit(client: SupabaseClient, options: { action?: string; target?: string; actions?: string[]; page: number }): Promise<Result<{ rows: AuditEvent[]; total: number }>> {
  let query = client.from('platform_audit_events').select('id,actor_id,actor_roles,action,target_type,target_id,target_label,reason,case_id,before_summary,after_summary,created_at', { count: 'exact' })
  if (options.actions?.length) query = query.in('action', options.actions)
  if (options.action) query = query.ilike('action', `%${options.action.replace(/[%_,()]/g, '')}%`)
  if (options.target) query = query.eq('target_type', options.target)
  const from = options.page * AUDIT_PAGE_SIZE
  const result = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + AUDIT_PAGE_SIZE - 1)
  if (result.error) return { data: { rows: [], total: 0 }, error: adminProblem(result.error.message), missing: needsMigration(result.error.message) }
  return { data: { rows: (result.data ?? []) as AuditEvent[], total: result.count ?? 0 }, error: null }
}
export const SECURITY_ACTIONS = ['account_suspended', 'account_restored', 'sessions_revoked', 'admin_granted', 'admin_proposed', 'admin_approved', 'admin_rejected', 'admin_suspend', 'admin_reactivate', 'admin_revoke', 'admin_extend']
export const auditActionLabel = (action: string) => action.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase())

// Audit export: CSV of the rows already loaded under this permission, with no raw identifiers.
export function auditCsv(rows: AuditEvent[]): string {
  const header = ['Time', 'Action', 'Target type', 'Target', 'Actor roles', 'Reason']
  return [header.map(cell).join(','), ...rows.map(row => [row.created_at, auditActionLabel(row.action), row.target_type, row.target_label ?? '', row.actor_roles ?? '', row.reason ?? ''].map(cell).join(','))].join('\r\n')
}

export const recordExport = (client: SupabaseClient, scope: string, rows: number, reason: string) => rpc<null>(client, 'admin_record_export', { p_scope: scope, p_rows: rows, p_reason: reason }, null)

export type AdminAssignment = { assignment_id: string | null; user_id: string; display_name: string; email: string; role: string; extra_permissions: string[]; status: string; reason: string; proposed_by_name: string | null; decided_by_name: string | null; starts_at: string; expires_at: string | null; last_used_at: string | null; created_at: string; bootstrap: boolean }
export const listAdmins = (client: SupabaseClient) => rpc<AdminAssignment[]>(client, 'admin_list_admins', {}, [])
export const proposeAdmin = (client: SupabaseClient, input: { email: string; role: string; reason: string; expiresAt: string | null }) =>
  rpc<string | null>(client, 'admin_propose_assignment', { p_email: input.email, p_role: input.role, p_reason: input.reason, p_expires_at: input.expiresAt, p_extra: [] }, null)
export const decideAdmin = (client: SupabaseClient, id: string, approve: boolean, reason: string) => rpc<null>(client, 'admin_decide_assignment', { p_assignment: id, p_approve: approve, p_reason: reason }, null)
export const changeAdmin = (client: SupabaseClient, id: string, action: 'suspend' | 'reactivate' | 'revoke' | 'extend', reason: string, expiresAt?: string | null) =>
  rpc<null>(client, 'admin_change_assignment', { p_assignment: id, p_action: action, p_reason: reason, p_expires_at: expiresAt ?? null }, null)

export const formatWhen = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-GB', { timeZone: 'Indian/Maldives', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Create on behalf (migration 040): reason, recent sign-in and audit are enforced in the database.
export const createOrganizationFor = (client: SupabaseClient, input: { name: string; description: string; owner: string | null; reason: string }) => rpc<string | null>(client, 'admin_create_organization', { p_name: input.name, p_description: input.description || null, p_owner: input.owner, p_reason: input.reason }, null)
export const createTeamFor = (client: SupabaseClient, input: { name: string; teamType: string; island: string; organization: string | null; manager: string | null; reason: string }) => rpc<string | null>(client, 'admin_create_team', { p_name: input.name, p_team_type: input.teamType, p_island: input.island || null, p_organization: input.organization, p_manager: input.manager, p_reason: input.reason }, null)
export const createTournamentFor = (client: SupabaseClient, input: { organization: string; name: string; sport: string; reason: string }) => rpc<string | null>(client, 'admin_create_tournament', { p_organization: input.organization, p_name: input.name, p_sport: input.sport, p_reason: input.reason }, null)
export const createPlayerFor = (client: SupabaseClient, input: { name: string; island: string; reason: string }) => rpc<string | null>(client, 'admin_create_player', { p_display_name: input.name, p_island: input.island || null, p_reason: input.reason }, null)
