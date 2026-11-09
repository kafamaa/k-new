import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { Activity, ArrowRight, FolderSearch, Inbox, LayoutDashboard, ServerCog, ShieldAlert } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  ADMIN_GROUPS, ADMIN_PAGES, adminHash, adminNextAction, adminRoleLabel, auditActionLabel, checkAdminAccess, formatWhen, loadAudit, loadOverview, parseAdminHash, visiblePages,
  type AdminAccessState, type AdminGroupId, type AdminPageId, type AuditEvent, type Overview,
} from '../lib/superAdmin'
import { WorkspaceShell, type ShellItem } from './WorkspaceShell'
import { listActions } from '../lib/superAdminOps'
import { AdminError, AdminLoading, AdminNote } from './AdminParts'
import { AdminPage } from './AdminPage'

const CaseQueue = lazy(() => import('./AdminCases').then(module => ({ default: module.CaseQueue })))
const AccountsPage = lazy(() => import('./AdminDirectory').then(module => ({ default: module.AccountsPage })))
const DirectoryPage = lazy(() => import('./AdminDirectory').then(module => ({ default: module.DirectoryPage })))
const MatchesIntegrityPage = lazy(() => import('./AdminDirectory').then(module => ({ default: module.MatchesIntegrityPage })))
const AuditPage = lazy(() => import('./AdminSystem').then(module => ({ default: module.AuditPage })))
const SecurityPage = lazy(() => import('./AdminSystem').then(module => ({ default: module.SecurityPage })))
const HealthPage = lazy(() => import('./AdminSystem').then(module => ({ default: module.HealthPage })))
const AdminsPage = lazy(() => import('./AdminSystem').then(module => ({ default: module.AdminsPage })))
const CustomizationPage = lazy(() => import('./AdminCustomization').then(module => ({ default: module.CustomizationPage })))
const PlatformConfigPage = lazy(() => import('./AdminConfiguration').then(module => ({ default: module.PlatformConfigPage })))
const ApprovalsPage = lazy(() => import('./AdminOperations').then(module => ({ default: module.ApprovalsPage })))
const FinancePage = lazy(() => import('./AdminOperations').then(module => ({ default: module.FinancePage })))
const CreateOnBehalfPage = lazy(() => import('./AdminCreate').then(module => ({ default: module.CreateOnBehalfPage })))
const NotificationsPage = lazy(() => import('./AdminOperations').then(module => ({ default: module.NotificationsPage })))

const GROUP_ICONS = { overview: LayoutDashboard, people: FolderSearch, sports: Activity, operations: Inbox, platform: ServerCog } as const
const DIRECTORY_TYPES = { organizations: 'organization', teams: 'team', players: 'player', tournaments: 'tournament' } as const

type Access = { state: 'checking' } | AdminAccessState

// Super Admin (#workspace/platform-admin). Access is decided by the database
// (admin_permissions) for the session confirmed by getUser; no admin data is requested
// and nothing admin is shown before that check succeeds, and every page re-checks on
// the server. The check runs again on every load and whenever the account changes.
export function AdminWorkspace({ user, onNotice, onSignIn }: { user: User | null; onNotice: (message: string) => void; onSignIn: () => void }) {
  const client = supabase
  const [access, setAccess] = useState<Access>({ state: 'checking' })
  const [route, setRoute] = useState(() => parseAdminHash(window.location.hash))
  const [overview, setOverview] = useState<Overview | null>(null)

  const check = useCallback(() => {
    if (!client || !user) { setAccess({ state: 'denied' }); return () => undefined }
    let active = true
    setAccess({ state: 'checking' })
    void checkAdminAccess(client, user.id).then(result => { if (active) setAccess(result) })
    return () => { active = false }
  }, [client, user])
  useEffect(() => check(), [check])
  useEffect(() => { const onHash = () => setRoute(parseAdminHash(window.location.hash)); window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash) }, [])
  useEffect(() => { document.title = 'Platform Admin · Kulhivaru+' }, [])
  const permissions = access.state === 'admin' ? access.permissions : null
  // Waiting two-person approvals come from their own list (migration 035).
  const reloadOverview = useCallback(() => {
    if (!client || !permissions) return
    const approvals = permissions.includes('admin.results.review') || permissions.includes('admin.identities.review') ? listActions(client, 'pending', 0) : Promise.resolve(null)
    void Promise.all([loadOverview(client), approvals]).then(([result, pending]) => setOverview(result.error ? null : { ...result.data, ...(pending && !pending.error ? { pendingActions: pending.data[0]?.total ?? 0 } : {}) }))
  }, [client, permissions])
  useEffect(() => { reloadOverview() }, [reloadOverview])

  if (!user) return <section className="ed-page"><header className="ed-page-head"><p className="ed-eyebrow">Platform</p><h1>Sign in required</h1><p>Platform administration is only available to signed-in administrators.</p></header><button type="button" className="ed-btn ed-btn-primary" onClick={onSignIn}>Sign in</button></section>
  if (access.state === 'checking') return <section className="ed-page"><div className="loading-state" role="status">Checking administrator access…</div></section>
  if (access.state === 'expired') return <section className="ed-page"><header className="ed-page-head"><p className="ed-eyebrow">Platform</p><h1>Session expired — sign in again</h1><p>Your sign-in could not be renewed, so administrator access was not checked.</p></header><button type="button" className="ed-btn ed-btn-primary" onClick={onSignIn}>Sign in again</button></section>
  if (access.state === 'error') return <section className="ed-page"><header className="ed-page-head"><p className="ed-eyebrow">Platform</p><h1>Unable to verify administrator access</h1><p>This is not a decision about your access. Try again in a moment.</p></header><AdminError message={access.message} onRetry={check} /></section>
  if (access.state === 'legacy') return <><AdminNote>The full Super Admin workspace needs migration 202611010034. Until it is applied, only the homepage and content tools below are available.</AdminNote><AdminPage user={user} onNotice={onNotice} /></>
  if (access.state === 'denied' || !client || !permissions) return <section className="ed-page"><header className="ed-page-head"><p className="ed-eyebrow">Platform</p><h1>Access denied</h1><p>Not a platform administrator. This area is for Kulhivaru+ platform administrators only. Administrator access is granted by the platform owner, never through signup, workspaces or a link.</p></header><p className="lp-empty"><ShieldAlert size={16} /> If you expected access, ask a Platform Owner. Expired or revoked roles no longer open this area.</p></section>

  const pages = visiblePages(permissions)
  const current = pages.find(page => page.id === route.page) ?? pages[0]
  if (!current) return <section className="ed-page"><AdminNote>Your administrator role has no pages yet.</AdminNote></section>
  const groups = ADMIN_GROUPS.filter(group => pages.some(page => page.group === group.id))
  const groupPages = pages.filter(page => page.group === current.group)
  const go = (page: AdminPageId) => { window.location.hash = adminHash(page) }
  const items: Array<ShellItem<AdminGroupId>> = groups.map(group => ({ id: group.id, label: group.label, icon: GROUP_ICONS[group.id], count: group.id === 'operations' ? (overview?.openCases ?? 0) + (overview?.openReports ?? 0) || undefined : undefined }))
  const roleText = adminRoleLabel(permissions)
  const me = user.id

  const body = (() => {
    switch (current.id) {
      case 'overview': return <AdminOverview client={client} overview={overview} permissions={permissions} onGo={go} onReload={reloadOverview} />
      case 'cases': case 'identities': case 'support': case 'data-requests': case 'security-incidents':
        return <CaseQueue key={current.id} client={client} page={current.id} me={me} permissions={permissions} onNotice={onNotice} initialCase={route.params.get('case')} />
      case 'accounts': return <AccountsPage client={client} permissions={permissions} onNotice={onNotice} />
      case 'organizations': case 'teams': case 'players': case 'tournaments': return <DirectoryPage key={current.id} client={client} type={DIRECTORY_TYPES[current.id]} onNotice={onNotice} />
      case 'matches': return <MatchesIntegrityPage client={client} onNotice={onNotice} initialMatch={route.params.get('match')} />
      case 'approvals': return <ApprovalsPage client={client} onNotice={onNotice} />
      case 'finance': return <FinancePage client={client} onNotice={onNotice} />
      case 'notifications': return <NotificationsPage client={client} onNotice={onNotice} />
      case 'configuration': return <PlatformConfigPage client={client} me={me} onNotice={onNotice} />
      case 'content': return <div className="adm-stack"><DirectoryPage client={client} type="news" onNotice={onNotice} /><AdminPage user={user} onNotice={onNotice} embedded /></div>
      case 'audit': return <AuditPage client={client} permissions={permissions} />
      case 'security': return <SecurityPage client={client} permissions={permissions} />
      case 'system': return <HealthPage client={client} />
      case 'customization': return <CustomizationPage client={client} me={me} permissions={permissions} onNotice={onNotice} />
      case 'admins': return <AdminsPage client={client} me={me} onNotice={onNotice} />
      case 'create': return <CreateOnBehalfPage client={client} onNotice={onNotice} />
      default: return null
    }
  })()

  return <WorkspaceShell kindLabel="Platform admin" title="Kulhivaru+ Platform Admin" subtitle={`Production · ${roleText}`} items={items} active={current.group}
    primaryIds={['overview', 'people', 'sports', 'operations', 'platform']} onSelect={group => { const first = pages.find(page => page.group === group); if (first) go(first.id) }}>
    {groupPages.length > 1 && <div className="pw-subtabs" role="tablist" aria-label={ADMIN_GROUPS.find(group => group.id === current.group)?.label}>{groupPages.map(page => <button type="button" role="tab" key={page.id} aria-selected={page.id === current.id} className={page.id === current.id ? 'active' : ''} onClick={() => go(page.id)}>{page.label}{page.later ? ' (planned)' : ''}</button>)}</div>}
    {groupPages.length > 1 && <h2 className="adm-page-title">{current.label}</h2>}
    <Suspense fallback={<AdminLoading />}>{body}</Suspense>
    <p className="adm-footnote">Critical actions are easier to review on a larger screen.</p>
  </WorkspaceShell>
}

function AdminOverview({ client, overview, permissions, onGo, onReload }: { client: NonNullable<typeof supabase>; overview: Overview | null; permissions: string[]; onGo: (page: AdminPageId) => void; onReload: () => void }) {
  const [recent, setRecent] = useState<AuditEvent[] | null>(null)
  const canAudit = permissions.includes('admin.audit.read')
  useEffect(() => { if (canAudit) void loadAudit(client, { page: 0 }).then(result => setRecent(result.data.rows.slice(0, 6))) }, [client, canAudit])
  if (!overview) return <div className="adm-stack"><AdminLoading rows={3} /><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={onReload}>Retry</button></div>
  const next = adminNextAction(overview)
  const card = (key: keyof Overview, label: string, page: AdminPageId, warn = true) => overview[key] === undefined ? null
    : <button type="button" key={key} className={`adm-stat${warn && overview[key] ? ' warn' : ''}`} onClick={() => onGo(page)}><span>{label}</span><strong>{overview[key]}</strong></button>
  const allowed = (page: AdminPageId) => ADMIN_PAGES.some(item => item.id === page && item.any.some(permission => permissions.includes(permission)))
  return <div className="adm-stack">
    {next ? <section className="ws-next" aria-label="Next action"><div><p className="ed-eyebrow light">Next action</p><h2>{next.label}</h2><p>{next.hint}</p></div>{allowed(next.page) && <button type="button" className="ed-btn ed-btn-primary" onClick={() => onGo(next.page)}>Open <ArrowRight size={16} /></button>}</section>
      : <section className="ws-next" aria-label="Next action"><div><p className="ed-eyebrow light">Next action</p><h2>Nothing urgent</h2><p>No critical cases, waiting approvals or failures in your areas.</p></div></section>}
    <div className="adm-stats">
      {card('openCases', 'Open cases', 'cases')}
      {card('openReports', 'Public reports', 'cases')}
      {card('identityRequests', 'Identity requests', 'identities')}
      {card('supportCases', 'Support cases', 'support')}
      {card('dataRequests', 'Privacy & data requests', 'data-requests')}
      {card('syncConflicts', 'Result conflicts', 'matches')}
      {card('deliveryFailures', 'Failed notifications', 'notifications')}
      {card('pendingAdminApprovals', 'Admin approvals', 'admins')}
      {card('pendingActions', 'Critical approvals', 'approvals')}
      {card('customizationReviews', 'Customization reviews', 'customization')}
      {card('suspendedAccounts', 'Suspended accounts', 'accounts', false)}
      {card('hiddenRecords', 'Hidden records', 'organizations', false)}
    </div>
    <div className="adm-two">
      <section className="ed-panel"><h3 className="ed-subhead">Critical alerts</h3>
        {(overview.criticalCases ?? 0) + (overview.overdueCases ?? 0) === 0 ? <p className="ws-clear">No critical or overdue cases.</p>
          : <ul className="adm-plan">{overview.criticalCases ? <li>{overview.criticalCases} critical case(s)</li> : null}{overview.overdueCases ? <li>{overview.overdueCases} case(s) past their target date</li> : null}</ul>}
        {overview.myCases !== undefined && <p className="adm-hint">{overview.myCases} open case(s) assigned to you.</p>}
      </section>
      <section className="ed-panel"><h3 className="ed-subhead">Recent admin actions</h3>
        {!canAudit ? <p className="adm-hint">Needs the audit permission.</p> : !recent ? <AdminLoading rows={2} /> : recent.length === 0 ? <p className="ws-clear">No admin actions recorded yet.</p>
          : <ul className="adm-recent">{recent.map(row => <li key={row.id}><strong>{auditActionLabel(row.action)}</strong><small>{row.target_label ?? row.target_type.replace(/_/g, ' ')} · {formatWhen(row.created_at)}</small></li>)}</ul>}
        {canAudit && <button type="button" className="ed-link-btn" onClick={() => onGo('audit')}>Open audit log</button>}
      </section>
    </div>
    {permissions.includes('admin.system.read') && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => onGo('system')}>Check platform health</button>}
  </div>
}
