import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CircleCheck, CircleX, HelpCircle, RotateCw, ShieldCheck } from 'lucide-react'
import packageInfo from '../../package.json'
import {
  AUDIT_PAGE_SIZE, auditActionLabel, auditCsv, changeAdmin, decideAdmin, formatWhen, listAdmins, loadAudit, loadOverview, proposeAdmin, recordExport, ROLE_LABELS, ROLES, SECURITY_ACTIONS,
  type AdminAssignment, type AuditEvent, type Overview,
} from '../lib/superAdmin'
import { downloadBlob } from '../lib/cardImage'
import { AdminEmpty, AdminError, AdminLoading, AdminNote, AdminPager, Pill, ReasonAction } from './AdminParts'

// --- Audit log ------------------------------------------------------------------------------------
const TARGET_TYPES = ['case', 'account', 'organization', 'team', 'player', 'tournament', 'news', 'admin_assignment', 'configuration', 'audit']

function AuditTable({ rows }: { rows: AuditEvent[] }) {
  return <div className="adm-table-wrap"><table className="adm-table">
    <caption className="sr-only">Audit events</caption>
    <thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">By</th><th scope="col">Reason</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}>
      <td>{formatWhen(row.created_at)}</td>
      <td><strong>{auditActionLabel(row.action)}</strong></td>
      <td>{row.target_label ?? row.target_type.replace(/_/g, ' ')}<small className="adm-cell-sub">{row.target_type.replace(/_/g, ' ')}</small></td>
      <td>{row.actor_roles ? row.actor_roles.split(', ').map(role => ROLE_LABELS[role.replace(' (bootstrap)', '')] ?? role).join(', ') : 'System'}</td>
      <td>{row.reason ?? '—'}</td>
    </tr>)}</tbody>
  </table></div>
}

export function AuditPage({ client, permissions, actions, intro }: { client: SupabaseClient; permissions: string[]; actions?: string[]; intro?: string }) {
  const [page, setPage] = useState(0)
  const [action, setAction] = useState('')
  const [target, setTarget] = useState('')
  const [data, setData] = useState<{ rows: AuditEvent[]; total: number } | null>(null)
  const [error, setError] = useState('')
  const actionKey = actions?.join(',') ?? ''
  const reload = useCallback(() => {
    setError('')
    void loadAudit(client, { action: action.trim() || undefined, target: target || undefined, actions: actionKey ? actionKey.split(',') : undefined, page }).then(result => { setData(result.data); setError(result.error ?? '') })
  }, [client, action, target, actionKey, page])
  useEffect(() => { const timer = window.setTimeout(reload, 250); return () => window.clearTimeout(timer) }, [reload])
  const exportRows = async (reason: string) => {
    if (!data?.rows.length) return 'There is nothing to export on this page.'
    const logged = await recordExport(client, `Audit page ${page + 1}${target ? `, ${target}` : ''}${action ? `, "${action}"` : ''}`, data.rows.length, reason)
    if (logged.error) return logged.error
    downloadBlob(new Blob([auditCsv(data.rows)], { type: 'text/csv;charset=utf-8' }), `kulhivaru-audit-${new Date().toISOString().slice(0, 10)}.csv`)
    return null
  }
  return <div className="adm-stack">
    <p className="adm-intro">{intro ?? 'Every privileged action: who did it, why, what changed and when. The log is append-only; no one, administrators included, can edit or erase it.'}</p>
    <section className="ed-panel adm-stack">
      {!actions && <div className="adm-toolbar">
        <label className="adm-search"><span className="sr-only">Filter by action</span><input type="search" value={action} placeholder="Filter by action (e.g. hidden)" onChange={event => { setAction(event.target.value); setPage(0) }} /></label>
        <label className="adm-select">Target<select value={target} onChange={event => { setTarget(event.target.value); setPage(0) }}><option value="">All</option>{TARGET_TYPES.map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}</select></label>
        {permissions.includes('admin.audit.export') && <ReasonAction label="Export this page" hint="The export itself is recorded in the audit log." onConfirm={exportRows} />}
      </div>}
      {error ? <AdminError message={error} onRetry={reload} /> : !data ? <AdminLoading /> : data.rows.length === 0 ? <AdminEmpty>No audit events yet.</AdminEmpty> : <AuditTable rows={data.rows} />}
      {data ? <AdminPager page={page} total={data.total} size={AUDIT_PAGE_SIZE} onPage={setPage} label="Audit pages" /> : null}
    </section>
  </div>
}

// --- Security Center -----------------------------------------------------------------------------
export function SecurityPage({ client, permissions }: { client: SupabaseClient; permissions: string[] }) {
  const [overview, setOverview] = useState<Overview | null>(null)
  useEffect(() => { void loadOverview(client).then(result => setOverview(result.data)) }, [client])
  return <div className="adm-stack">
    <dl className="ws-counts">
      <div className={overview?.suspendedAccounts ? 'tone-warn' : ''}><dt>Suspended accounts</dt><dd>{overview?.suspendedAccounts ?? '—'}</dd></div>
      <div><dt>Records hidden by admins</dt><dd>{overview?.hiddenRecords ?? '—'}</dd></div>
      <div className={overview?.pendingAdminApprovals ? 'tone-warn' : ''}><dt>Admin proposals waiting</dt><dd>{overview?.pendingAdminApprovals ?? '—'}</dd></div>
    </dl>
    <AdminNote>Failed sign-ins, rate-limit events and suspicious sessions are recorded by Supabase Auth, not by this app. Review them in the Supabase dashboard (Authentication → Logs). Security findings for tables and storage come from the Supabase Security Advisor. No secret values are shown here.</AdminNote>
    {permissions.includes('admin.audit.read') ? <AuditPage client={client} permissions={permissions} actions={SECURITY_ACTIONS} intro="Recent account suspensions, session revocations and administrator access changes." /> : <AdminNote>Reading the security history needs the audit permission.</AdminNote>}
  </div>
}

// --- Platform health ------------------------------------------------------------------------------
type Probe = { label: string; state: 'checking' | 'ok' | 'problem' | 'unknown'; detail: string }
const FUNCTIONS = ['register-identity', 'claim-player', 'invite-player', 'revoke-player-invitation', 'invite-workspace-member', 'accept-workspace-invitation']
const isMissing = (message: string | undefined) => /PGRST202|PGRST205|42P01|42703|Could not find|does not exist|schema cache/.test(message ?? '')

async function runProbes(client: SupabaseClient): Promise<Probe[]> {
  const probes: Probe[] = []
  const started = performance.now()
  const db = await client.from('tournaments').select('id', { head: true, count: 'exact' }).limit(1)
  probes.push({ label: 'Database and API', state: db.error ? 'problem' : 'ok', detail: db.error ? 'The API did not answer normally.' : `Answered in ${Math.round(performance.now() - started)} ms` })
  const session = await client.auth.getSession()
  probes.push({ label: 'Authentication', state: session.error || !session.data.session ? 'problem' : 'ok', detail: session.data.session ? 'Your session is valid.' : 'No valid session.' })
  // A missing Edge Function fails its CORS preflight, so the request itself errors.
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')
  const key = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '')
  for (const name of FUNCTIONS) {
    try {
      const response = await fetch(`${base}/functions/v1/${name}`, { method: 'GET', headers: { apikey: key } })
      probes.push({ label: `Edge Function: ${name}`, state: response.status === 404 ? 'problem' : 'ok', detail: response.status === 404 ? 'Not deployed.' : 'Deployed and answering.' })
    } catch {
      probes.push({ label: `Edge Function: ${name}`, state: 'problem', detail: 'Not reachable. It is probably not deployed.' })
    }
  }
  // Review-only migrations: probe for one object each without changing anything.
  const migrationChecks: Array<[string, () => PromiseLike<{ error: { message: string } | null }>]> = [
    ['032 landing page', () => client.from('public_announcements').select('id').limit(1)],
    ['033 organization publishing', () => client.rpc('set_organization_published', { p_organization_id: '00000000-0000-0000-0000-000000000000', p_publish: false })],
    ['player_workspace_final', () => client.from('player_profiles').select('public_code').limit(1)],
    ['manual_team_and_roster_entry', () => client.rpc('search_unclaimed_players', { p_query: 'zz' })],
    ['034 super admin', () => client.rpc('admin_permissions')],
  ]
  for (const [label, check] of migrationChecks) {
    const result = await check()
    probes.push({ label: `Migration ${label}`, state: result.error && isMissing(result.error.message) ? 'problem' : 'ok', detail: result.error && isMissing(result.error.message) ? 'Not applied.' : 'Applied.' })
  }
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration().catch(() => undefined) : undefined
  probes.push({ label: 'Offline app (service worker)', state: registration ? 'ok' : 'unknown', detail: registration ? 'Registered in this browser.' : 'Not registered in this browser.' })
  probes.push({ label: 'Storage', state: 'unknown', detail: 'Not checked from the browser. See the Supabase dashboard.' })
  probes.push({ label: 'Background jobs and queues', state: 'unknown', detail: 'No job runner is configured for this app.' })
  return probes
}

export function HealthPage({ client }: { client: SupabaseClient }) {
  const [probes, setProbes] = useState<Probe[] | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const run = useCallback(() => { setProbes(null); void runProbes(client).then(result => { setProbes(result); setCheckedAt(new Date().toISOString()) }) }, [client])
  useEffect(() => { run() }, [run])
  return <div className="adm-stack">
    <p className="adm-intro">Checks run from your browser against the live project. Nothing is changed. There is no SQL console here by design.</p>
    <section className="ed-panel adm-stack">
      <div className="adm-toolbar"><span>App version {packageInfo.version} · {import.meta.env.MODE}{checkedAt ? ` · Last checked ${formatWhen(checkedAt)}` : ''}</span><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={run} disabled={!probes}><RotateCw size={14} /> Check again</button></div>
      {!probes ? <AdminLoading rows={6} /> : <ul className="adm-health">{probes.map(probe => <li key={probe.label} className={`adm-health-${probe.state}`}>
        {probe.state === 'ok' ? <CircleCheck size={16} aria-hidden="true" /> : probe.state === 'problem' ? <CircleX size={16} aria-hidden="true" /> : <HelpCircle size={16} aria-hidden="true" />}
        <span><strong>{probe.label}</strong><small>{probe.state === 'ok' ? 'OK' : probe.state === 'problem' ? 'Needs attention' : 'Unknown'} · {probe.detail}</small></span>
      </li>)}</ul>}
    </section>
  </div>
}

// --- Administrators -------------------------------------------------------------------------------
const assignmentTone = (status: string) => status === 'active' ? 'ok' : status === 'proposed' ? 'warn' : status === 'suspended' || status === 'expired' ? 'warn' : 'neutral'

export function AdminsPage({ client, me, onNotice }: { client: SupabaseClient; me: string; onNotice: (message: string) => void }) {
  const [rows, setRows] = useState<AdminAssignment[] | null>(null)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('moderator')
  const [expires, setExpires] = useState('')
  const [formError, setFormError] = useState('')
  const reload = useCallback(() => { setError(''); void listAdmins(client).then(result => { setRows(result.data); setError(result.error ?? '') }) }, [client])
  useEffect(() => { reload() }, [reload])
  const done = (message: string) => { onNotice(message); reload(); return null }
  const propose = async (reason: string) => {
    setFormError('')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return 'Enter the person’s account email address.'
    const result = await proposeAdmin(client, { email: email.trim(), role, reason, expiresAt: expires ? new Date(expires).toISOString() : null })
    if (result.error) return result.error
    setEmail(''); setExpires('')
    return done(role === 'platform_owner' ? 'Proposal saved. A different Platform Owner must approve it.' : 'Role granted.')
  }
  return <div className="adm-stack">
    <p className="adm-intro">Administrator roles. You cannot grant permissions you do not hold, change your own access or approve your own proposal. Platform Owner grants need a second owner. Granting, approving and revoking need a sign-in within the last 30 minutes.</p>
    <form className="ed-panel admin-form" onSubmit={(event: FormEvent) => event.preventDefault()}>
      <h3 className="ed-subhead"><ShieldCheck size={16} /> Add an administrator</h3>
      <div className="admin-row">
        <label>Account email<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" /></label>
        <label>Role<select value={role} onChange={event => setRole(event.target.value)}>{ROLES.map(value => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}</select></label>
      </div>
      <label>Expires (optional, for temporary access)<input type="datetime-local" value={expires} onChange={event => setExpires(event.target.value)} /></label>
      {formError ? <p className="form-error" role="alert">{formError}</p> : null}
      <ReasonAction label={role === 'platform_owner' ? 'Propose Platform Owner' : 'Grant role'} tone="primary" onConfirm={propose} />
    </form>
    <section className="ed-panel adm-stack">
      <h3 className="ed-subhead">Current and proposed</h3>
      {error ? <AdminError message={error} onRetry={reload} /> : !rows ? <AdminLoading /> : rows.length === 0 ? <AdminEmpty>No administrators.</AdminEmpty>
        : <ul className="adm-list">{rows.map(row => <li key={row.assignment_id ?? `owner-${row.user_id}`} className="adm-list-row">
          <span className="adm-list-main"><strong>{row.display_name}{row.user_id === me ? ' (you)' : ''}</strong><small>{row.email}</small>
            <span className="adm-pills"><Pill tone="info">{ROLE_LABELS[row.role] ?? row.role}</Pill><Pill tone={assignmentTone(row.status)}>{row.status === 'proposed' ? 'Waiting for approval' : row.status.replace(/^./, letter => letter.toUpperCase())}</Pill>
              {row.bootstrap ? <small>Granted in the database</small> : <small>{row.proposed_by_name ? `By ${row.proposed_by_name}` : ''}{row.decided_by_name && row.decided_by_name !== row.proposed_by_name ? ` · approved by ${row.decided_by_name}` : ''} · {row.expires_at ? `expires ${formatWhen(row.expires_at)}` : 'no expiry'} · last used {formatWhen(row.last_used_at)}</small>}</span>
            <small className="adm-cell-sub">Reason: {row.reason}</small>
          </span>
          {!row.bootstrap && row.assignment_id && row.user_id !== me ? <span className="button-row compact">
            {row.status === 'proposed' && <><ReasonAction label="Approve" tone="primary" onConfirm={async reason => { const result = await decideAdmin(client, row.assignment_id!, true, reason); return result.error ?? done('Approved.') }} /><ReasonAction label="Reject" onConfirm={async reason => { const result = await decideAdmin(client, row.assignment_id!, false, reason); return result.error ?? done('Rejected.') }} /></>}
            {row.status === 'active' && <ReasonAction label="Suspend" onConfirm={async reason => { const result = await changeAdmin(client, row.assignment_id!, 'suspend', reason); return result.error ?? done('Suspended.') }} />}
            {row.status === 'suspended' && <ReasonAction label="Reactivate" onConfirm={async reason => { const result = await changeAdmin(client, row.assignment_id!, 'reactivate', reason); return result.error ?? done('Reactivated.') }} />}
            {['active', 'suspended', 'expired'].includes(row.status) && <ExtendAction onConfirm={async (reason, until) => { const result = await changeAdmin(client, row.assignment_id!, 'extend', reason, until); return result.error ?? done('Expiry updated.') }} />}
            {['active', 'suspended', 'proposed', 'expired'].includes(row.status) && <ReasonAction label="Revoke" tone="danger" onConfirm={async reason => { const result = await changeAdmin(client, row.assignment_id!, 'revoke', reason); return result.error ?? done('Revoked.') }} />}
          </span> : null}
        </li>)}</ul>}
      <AdminNote>Bootstrap owners are granted and removed only in the Supabase SQL editor (table platform_admins). Strong sign-in (MFA or passkey) is set up in Supabase Auth; this app checks for a recent sign-in or a second factor before high-impact actions.</AdminNote>
    </section>
  </div>
}

function ExtendAction({ onConfirm }: { onConfirm: (reason: string, until: string) => Promise<string | null> }) {
  const [until, setUntil] = useState('')
  return <ReasonAction label="Change expiry" onConfirm={reason => until ? onConfirm(reason, new Date(until).toISOString()) : Promise.resolve('Choose the new expiry date.')}>
    <label className="pf-field">New expiry<input type="datetime-local" value={until} onChange={event => setUntil(event.target.value)} /></label>
  </ReasonAction>
}
