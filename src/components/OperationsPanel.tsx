import { useState } from 'react'
import type { FormEvent } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { Bell, Download, Search, WalletCards, UsersRound } from 'lucide-react'
import { createExpense, updateExpenseStatus } from '../lib/finance'
import { createNotification } from '../lib/notifications'
import { exportTournamentReport } from '../lib/reports'
import { assignTournamentStaff, revokeTournamentStaff, searchStaffCandidates, STAFF_PERMISSIONS, type StaffCandidate, type StaffPermission } from '../lib/staff'
import { canManageStaff, canManageFinance, canViewReports } from '../lib/organizer'
import type { Workspace } from '../lib/workspace'
import { ConfirmAction } from './ConfirmAction'

// The four organization operations capabilities, split into the sections the
// Organizer navigation spec calls for (Finance, Reports, Staff) plus the
// participant notification form. Every handler below is unchanged from the
// original OperationsPanel: same tables, same policies, same audit behaviour.
// Splitting them removes the old cross-form state where typing a tournament ID
// for a finance expense silently changed the export and staff targets too.

function operatorOrganizations(organizations: Workspace[]): Workspace[] {
  return organizations.filter(item => item.kind === 'organization' && ['owner', 'operations'].includes(item.role))
}

type TournamentOption = { id: string; name: string }

// Choose a tournament by name from this organization (never a typed ID).
function TournamentPicker({ tournaments, value, onChange, optional = false, label = 'Tournament' }: { tournaments: TournamentOption[]; value: string; onChange: (value: string) => void; optional?: boolean; label?: string }) {
  return <label>{label}{optional ? ' (optional)' : ''}<select value={value} onChange={event => onChange(event.target.value)}>
    <option value="">{optional ? 'Whole organization' : tournaments.length ? 'Choose a tournament' : 'No tournaments yet'}</option>
    {tournaments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
  </select></label>
}

// Find a person by name: only published player profiles linked to an account.
function PersonPicker({ client, label, value, onChange }: { client: SupabaseClient; label: string; value: StaffCandidate | null; onChange: (person: StaffCandidate | null) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StaffCandidate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const search = async () => { setBusy(true); const found = await searchStaffCandidates(client, query); setBusy(false); setResults(found.candidates) }
  if (value) return <div className="ops-person"><span>{label}</span><strong>{value.name}</strong><button type="button" className="ghost-button" onClick={() => { onChange(null); setResults(null) }}>Change</button></div>
  return <div className="ops-person-search">
    <label>{label}<span className="ops-search-row"><input value={query} onChange={event => { setQuery(event.target.value); setResults(null) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search() } }} placeholder="Type at least two letters of their name" /><button type="button" className="outline-button dark" disabled={busy || query.trim().length < 2} onClick={() => void search()}><Search size={14} /> {busy ? 'Searching…' : 'Find'}</button></span></label>
    {results && (results.length ? <ul className="ops-results">{results.map(person => <li key={person.accountId}><button type="button" onClick={() => onChange(person)}><strong>{person.name}</strong><small>Choose</small></button></li>)}</ul>
      : <p className="field-hint">No one with a published profile matches. They need a player profile linked to their account, or invite them as an organization member.</p>)}
  </div>
}

const PERMISSION_LABELS: Record<StaffPermission, string> = { registration: 'Registration and rosters', operations: 'Tournament manager', match_data: 'Match results', finance: 'Finance', media: 'News and media' }

export function FinanceSection({ client, user, organizations, organizationId, tournaments = [], onNotice }: { client: SupabaseClient; user: User; organizations: Workspace[]; organizationId: string; tournaments?: TournamentOption[]; onNotice: (message: string) => void }) {
  const [tournamentId, setTournamentId] = useState(''); const [category, setCategory] = useState(''); const [description, setDescription] = useState(''); const [amount, setAmount] = useState(''); const [expenseId, setExpenseId] = useState(''); const [status, setStatus] = useState<'submitted' | 'approved' | 'rejected' | 'refunded'>('submitted'); const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const role = organizations.find(item => item.id === organizationId)?.role ?? 'staff'
  if (!canManageFinance(role, [])) return <div className="workspace-note">Finance is restricted to organization owners, operations, and finance members. You have view-only access here.</div>
  const submitExpense = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (!organizationId) return setError('Choose an authorized organization first.')
    if (!category.trim()) return setError('Enter what the expense is for.')
    if (!(Number(amount) > 0)) return setError('Enter an amount above zero.')
    setSaving(true); const result = await createExpense(client, organizationId, tournamentId || null, user.id, category, description, Number(amount)); setSaving(false)
    if (result.error) return setError(result.error)
    if (result.data) setExpenseId(result.data.id)
    setCategory(''); setDescription(''); setAmount('')
    onNotice('MVR expense submitted for finance review.')
  }
  const changeExpense = async () => { setSaving(true); const result = await updateExpenseStatus(client, expenseId, status); setSaving(false); if (result.error) return setError(result.error); onNotice(`Expense status changed to ${status}; the audit trigger records the action.`) }
  return <section className="ops-card" aria-labelledby="ops-finance"><header><span className="ops-icon"><WalletCards size={18} /></span><div><h3 id="ops-finance">Record an expense</h3><p>Amounts are in Maldives rufiyaa (MVR). No online payments are used; receipts stay private.</p></div></header>
    <form className="ops-form" onSubmit={submitExpense}>
      <TournamentPicker tournaments={tournaments} value={tournamentId} onChange={setTournamentId} optional />
      <label>What it is for<input value={category} onChange={event => setCategory(event.target.value)} placeholder="Venue, officials, equipment…" /></label>
      <label>Amount (MVR)<input type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label>
      <label className="ops-wide">Description (optional)<textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label>
      <div className="ops-actions"><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Submit expense'}</button></div>
    </form>
    {expenseId && <div className="ops-followup"><label>Status of the last expense<select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="refunded">Refunded</option></select></label><button type="button" className="outline-button dark" disabled={saving} onClick={() => void changeExpense()}>Save status</button></div>}
    {error && <div className="form-error" role="alert">{error}</div>}
  </section>
}

export function ReportsSection({ client, organizations, organizationId, tournaments = [], onNotice }: { client: SupabaseClient; organizations: Workspace[]; organizationId: string; tournaments?: TournamentOption[]; onNotice: (message: string) => void }) {
  const [tournamentId, setTournamentId] = useState(''); const [error, setError] = useState('')
  const role = organizations.find(item => item.id === organizationId)?.role ?? 'staff'
  if (!canViewReports(role)) return <div className="workspace-note">Reports are restricted to organization owners and operations members.</div>
  const exportReport = async (kind: 'entries' | 'fixtures' | 'finance') => {
    if (!tournamentId) return setError('Choose a tournament first.')
    setError('')
    const result = await exportTournamentReport(client, tournamentId, kind, kind === 'finance')
    if (result.error || !result.csv) return setError(result.error ?? 'No authorized records to export.')
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv' })); link.download = `kulhivaru-${kind}.csv`; link.click(); URL.revokeObjectURL(link.href)
    onNotice('Report downloaded.')
  }
  return <section className="ops-card" aria-labelledby="ops-reports"><header><span className="ops-icon"><Download size={18} /></span><div><h3 id="ops-reports">Download reports</h3><p>Spreadsheet files (CSV). Private identity details and documents are never included.</p></div></header>
    <div className="ops-form"><TournamentPicker tournaments={tournaments} value={tournamentId} onChange={value => { setTournamentId(value); setError('') }} /></div>
    <div className="ops-actions"><button type="button" className="outline-button dark" disabled={!tournamentId} onClick={() => void exportReport('entries')}><Download size={14} /> Teams and entries</button><button type="button" className="outline-button dark" disabled={!tournamentId} onClick={() => void exportReport('fixtures')}><Download size={14} /> Fixtures</button><button type="button" className="outline-button dark" disabled={!tournamentId} onClick={() => void exportReport('finance')}><Download size={14} /> Finance</button></div>
    {error && <div className="form-error" role="alert">{error}</div>}
  </section>
}

export function StaffSection({ client, user, organizations, organizationId, tournaments = [], onNotice }: { client: SupabaseClient; user: User; organizations: Workspace[]; organizationId: string; tournaments?: TournamentOption[]; onNotice: (message: string) => void }) {
  const [tournamentId, setTournamentId] = useState(''); const [person, setPerson] = useState<StaffCandidate | null>(null); const [staffPermission, setStaffPermission] = useState<StaffPermission>('registration'); const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const role = organizations.find(item => item.id === organizationId)?.role ?? 'staff'
  if (!canManageStaff(role)) return <div className="workspace-note">Assigning tournament staff is restricted to organization owners and operations members.</div>
  const ready = Boolean(tournamentId && person)
  const tournamentName = tournaments.find(item => item.id === tournamentId)?.name ?? 'this tournament'
  const assignStaff = async () => { if (!person) return; setSaving(true); setError(''); const result = await assignTournamentStaff(client, tournamentId, person.accountId, staffPermission, user.id); setSaving(false); if (result.error) return setError('The permission could not be given. Check that you can manage this tournament.'); onNotice(`${person.name} can now help with ${PERMISSION_LABELS[staffPermission].toLowerCase()} in ${tournamentName}.`) }
  const revokeStaff = async () => { if (!person) return; setSaving(true); setError(''); const result = await revokeTournamentStaff(client, tournamentId, person.accountId, staffPermission); setSaving(false); if (result.error) return setError('The permission could not be removed. Please try again.'); onNotice(`${person.name} no longer has ${PERMISSION_LABELS[staffPermission].toLowerCase()} in ${tournamentName}.`) }
  return <section className="ops-card" aria-labelledby="ops-staff"><header><span className="ops-icon"><UsersRound size={18} /></span><div><h3 id="ops-staff">Tournament staff</h3><p>Give someone one job in one tournament. It never gives access to other tournaments or to the organization. Each tournament's Officials &amp; staff page does the same.</p></div></header>
    <div className="ops-form">
      <TournamentPicker tournaments={tournaments} value={tournamentId} onChange={setTournamentId} />
      <label>Job<select value={staffPermission} onChange={event => setStaffPermission(event.target.value as StaffPermission)}>{STAFF_PERMISSIONS.map(permission => <option value={permission} key={permission}>{PERMISSION_LABELS[permission]}</option>)}</select></label>
      <div className="ops-wide"><PersonPicker client={client} label="Person" value={person} onChange={setPerson} /></div>
    </div>
    <div className="ops-actions"><button type="button" className="primary-button" disabled={saving || !ready} onClick={() => void assignStaff()}>Give access</button><ConfirmAction className="outline-button dark" disabled={saving || !ready} label="Remove access" question="Remove this permission? The person loses it immediately." confirmLabel="Remove access" onConfirm={async () => { await revokeStaff() }} /></div>
    {error && <div className="form-error" role="alert">{error}</div>}
  </section>
}

export function NotificationSection({ client, user, tournaments = [], onNotice }: { client: SupabaseClient; user: User; tournaments?: TournamentOption[]; onNotice: (message: string) => void }) {
  const [person, setPerson] = useState<StaffCandidate | null>(null); const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [channel, setChannel] = useState<'in_app' | 'email'>('in_app'); const [tournamentId, setTournamentId] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const notify = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (!person) return setError('Choose who to notify.')
    if (!title.trim() || !body.trim()) return setError('Write a title and a message.')
    setSaving(true); const result = await createNotification(client, person.accountId, user.id, title, body, channel, tournamentId || undefined); setSaving(false)
    if (result.error) return setError('The notification could not be sent. Please try again.')
    setTitle(''); setBody('')
    onNotice(channel === 'email' ? 'Email queued. Email delivery is not switched on yet, so they will also see it in the app.' : `Notification sent to ${person.name}.`)
  }
  return <section className="ops-card" aria-labelledby="ops-notify"><header><span className="ops-icon"><Bell size={18} /></span><div><h3 id="ops-notify">Notify a participant</h3><p>Send one person a message about a tournament. It appears in their notifications.</p></div></header>
    <form className="ops-form" onSubmit={notify}>
      <div className="ops-wide"><PersonPicker client={client} label="To" value={person} onChange={setPerson} /></div>
      <TournamentPicker tournaments={tournaments} value={tournamentId} onChange={setTournamentId} optional label="About" />
      <label>Send as<select value={channel} onChange={event => setChannel(event.target.value as typeof channel)}><option value="in_app">In the app</option><option value="email">Email (queued)</option></select></label>
      <label className="ops-wide">Title<input value={title} onChange={event => setTitle(event.target.value)} maxLength={120} /></label>
      <label className="ops-wide">Message<textarea rows={4} value={body} onChange={event => setBody(event.target.value)} maxLength={1000} /></label>
      <div className="ops-actions"><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Sending…' : 'Send notification'}</button></div>
    </form>
    {error && <div className="form-error" role="alert">{error}</div>}
  </section>
}

// The combined operations panel, kept for the pre-shell layout. It simply hosts
// the four sections together so the same capabilities remain reachable.
export function OperationsPanel({ client, user, organizations, onNotice }: { client: SupabaseClient; user: User; organizations: Workspace[]; onNotice: (message: string) => void }) {
  const organizationId = operatorOrganizations(organizations).find(() => true)?.id ?? organizations.find(item => item.kind === 'organization')?.id ?? ''
  return <section className="operations-panel"><div className="cockpit-title"><div><p className="eyebrow">ORGANIZATION OPERATIONS</p><h3>Finance, reports and notifications</h3><p>Actions are scoped to the selected authorized organization/tournament. No online payments are used.</p></div><WalletCards size={28} /></div><div className="operations-grid"><FinanceSection client={client} user={user} organizations={organizations} organizationId={organizationId} onNotice={onNotice} /><ReportsSection client={client} organizations={organizations} organizationId={organizationId} onNotice={onNotice} /><StaffSection client={client} user={user} organizations={organizations} organizationId={organizationId} onNotice={onNotice} /><NotificationSection client={client} user={user} onNotice={onNotice} /></div></section>
}
