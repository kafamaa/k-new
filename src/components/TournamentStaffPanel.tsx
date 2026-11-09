import { useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { CalendarCheck, Lock, MoreHorizontal, Search, UserPlus, UsersRound, X } from 'lucide-react'
import {
  assignTournamentStaff, loadTournamentStaff, revokeTournamentStaff,
  searchStaffCandidates, STAFF_PERMISSIONS, TOURNAMENT_STAFF_ROLES,
} from '../lib/staff'
import { formatMaldivesDate } from '../lib/publicData'
import type { StaffCandidate, StaffPermission, TournamentStaffRow } from '../lib/staff'
import { ConfirmAction } from './ConfirmAction'

// The tournament Staff page, broadcast-panel style: stat cards, a searchable
// staff table with role chips and a side-panel invitation flow. The tournament
// is already selected on this page, so no ids are asked for. Honest limits:
// emails never exist in the schema (auth emails are private), so rows show
// initials + real names + when the access was added instead; there is no
// invited/pending state, so every listed assignment is Active.
const AVATAR_TINTS = ['tint-a', 'tint-b', 'tint-c', 'tint-d', 'tint-e']
function avatarTint(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return AVATAR_TINTS[hash % AVATAR_TINTS.length]
}
function initials(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2)
  return (words.map(word => word[0] ?? '').join('').toUpperCase()) || '?'
}
function uniqueStaffCount(rows: TournamentStaffRow[]): number { return new Set(rows.map(row => row.userId)).size }

export function TournamentStaffPanel({ client, user, tournamentName, tournamentId, canManage, onNotice }: {
  client: SupabaseClient
  user: User
  tournamentName: string
  tournamentId: string
  canManage: boolean
  onNotice: (message: string) => void
}) {
  const [staff, setStaff] = useState<TournamentStaffRow[]>([])
  const [loading, setLoading] = useState(canManage)
  const [error, setError] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<StaffCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<StaffCandidate | null>(null)
  const [role, setRole] = useState<StaffPermission>('registration')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<{ userId: string; permission: StaffPermission; name: string | null } | null>(null)
  const [tableFilter, setTableFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | StaffPermission>('all')
  const [reloadKey, setReloadKey] = useState(0)
  const searchTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!canManage || panelOpen) return
    let active = true
    setLoading(true)
    const load = async () => {
      const result = await loadTournamentStaff(client, tournamentId)
      if (!active) return
      setStaff(result.staff)
      setError(result.error ?? 'Unable to load the staff list.')
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [client, tournamentId, canManage, panelOpen, saving, reloadKey])

  useEffect(() => { if (editing) { setSelected({ name: editing.name ?? '', slug: '', accountId: editing.userId }); setRole(editing.permission) } }, [editing])

  // Debounced person search while the invite panel is open.
  useEffect(() => {
    if (!panelOpen) return
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    const trimmed = query.trim()
    if (trimmed.length < 2) return setCandidates([])
    searchTimer.current = window.setTimeout(async () => {
      setSearching(true)
      const result = await searchStaffCandidates(client, trimmed)
      setSearching(false)
      if (result.error) return setError(result.error || 'Unable to search people.')
      setCandidates(result.candidates)
    }, 300)
    return () => { if (searchTimer.current) window.clearTimeout(searchTimer.current) }
  }, [client, query, panelOpen])

  const filteredStaff = useMemo(() => staff.filter(row => {
    const matchesText = !tableFilter.trim() || (row.name ?? '').toLowerCase().includes(tableFilter.trim().toLowerCase())
    const matchesRole = roleFilter === 'all' || row.permission === roleFilter
    return matchesText && matchesRole
  }), [staff, tableFilter, roleFilter])

  if (!canManage) {
    return <div className="staff-blocked workspace-note"><UsersRound size={16} /> Only organization owners and operations members can view and manage the tournament staff list. Ask the organization to grant you access.</div>
  }

  const openPanel = () => { setEditing(null); setSelected(null); setQuery(''); setCandidates([]); setRole('registration'); setPanelOpen(true) }
  const closePanel = () => { setPanelOpen(false); setEditing(null); setSelected(null) }

  const sendInvitation = async () => {
    if (!selected) return
    setSaving(true)
    const result = await assignTournamentStaff(client, tournamentId, selected.accountId, role, user.id)
    setSaving(false)
    if (result.error) return setError(result.error)
    onNotice(`${selected.name || 'Staff member'} now has ${TOURNAMENT_STAFF_ROLES[role].label} access. The invite takes effect immediately; they see the workspace on their next sign-in.`)
    closePanel()
  }

  const changeAccess = async () => {
    if (!selected || !editing) return
    setSaving(true)
    if (role !== editing.permission) {
      const added = await assignTournamentStaff(client, tournamentId, selected.accountId, role, user.id)
      if (added.error) { setSaving(false); return setError(added.error) }
      const removed = await revokeTournamentStaff(client, tournamentId, selected.accountId, editing.permission)
      if (removed.error) onNotice(`Access changed, but the old ${TOURNAMENT_STAFF_ROLES[editing.permission].label} row could not be removed (${removed.error}). Remove it from the table.`)
    }
    setSaving(false)
    onNotice(`${selected.name || 'Staff member'} now has ${TOURNAMENT_STAFF_ROLES[role].label} access.`)
    closePanel()
  }

  const removeAccess = async (row: TournamentStaffRow) => {
    const result = await revokeTournamentStaff(client, tournamentId, row.userId, row.permission)
    if (result.error) return setError(result.error)
    onNotice(`Removed ${TOURNAMENT_STAFF_ROLES[row.permission].label} access${row.name ? ` from ${row.name}` : ''}.`)
  }

  return <div className="tab-panel staff-tab" data-testid="tournament-staff-panel">
    <div className="staff-page-head">
      <div>
        <h4>Tournament Staff</h4>
        <p>Manage who can access and operate this tournament.</p>
      </div>
      <button type="button" className="primary-button" onClick={openPanel}><UserPlus size={16} /> Invite Staff</button>
    </div>

    {loading ? <div className="loading-state"><CalendarCheck className="spin" size={15} /> Loading the staff list…</div>
      : error ? <div className="form-error" role="alert">{error}<button type="button" className="retry-button" onClick={() => setReloadKey(value => value + 1)}>Retry</button></div>
        : <>
          <div className="staff-stats">
            <div className="staff-stat"><span className="stat-bubble"><UsersRound size={19} /></span><div><b>{uniqueStaffCount(staff)}</b><small>Active staff</small></div></div>
            <div className="staff-stat"><span className="stat-bubble gold"><CalendarCheck size={19} /></span><div><b>{staff.length}</b><small>Role assignments</small></div></div>
            <div className="staff-stat"><span className="stat-bubble"><Lock size={19} /></span><div><b className="stat-words">Tournament-only access</b><small>Scope of every role</small></div></div>
          </div>

          <div className="staff-card">
            <div className="staff-toolbar">
              <label className="staff-search"><Search size={16} /><input value={tableFilter} onChange={event => setTableFilter(event.target.value)} placeholder="Search staff by name" aria-label="Search staff by name" /></label>
              <label className="staff-role-filter" aria-label="Filter by role">
                <select value={roleFilter} onChange={event => setRoleFilter(event.target.value as typeof roleFilter)}>
                  <option value="all">All roles</option>
                  {STAFF_PERMISSIONS.map(permission => <option value={permission} key={permission}>{TOURNAMENT_STAFF_ROLES[permission].label}</option>)}
                </select>
              </label>
            </div>
            {staff.length === 0 ? <div className="staff-empty"><UsersRound size={18} /><p>No staff has access yet.</p><button type="button" className="outline-button dark" onClick={openPanel}><UserPlus size={14} /> Invite your first staff member</button></div>
              : filteredStaff.length === 0 ? <div className="staff-empty"><p>No staff matches "{tableFilter.replace(/<|>/g, '').slice(0, 30)}".</p></div>
                : <div className="staff-table-wrap"><table className="staff-table"><thead><tr><th>Staff member</th><th>Role</th><th>Access</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredStaff.map(row => <tr key={`${row.userId}-${row.permission}`}>
                      <td data-label="Staff member"><span className="staff-cell"><span className={`staff-avatar ${avatarTint(row.name ?? row.userId)}`} aria-hidden="true">{initials(row.name ?? '?')}</span><span className="staff-identity"><strong>{row.name ?? 'No public profile'}</strong><small>Added {row.createdAt ? formatMaldivesDate(row.createdAt) : 'recently'}</small></span></span></td>
                      <td data-label="Role"><span className={`role-pill ${row.permission}`}>{TOURNAMENT_STAFF_ROLES[row.permission as StaffPermission].label}</span></td>
                      <td data-label="Access">{TOURNAMENT_STAFF_ROLES[row.permission as StaffPermission].access}</td>
                      <td data-label="Status"><span className="staff-status"><span className="staff-dot" aria-hidden="true" /> Active</span></td>
                      <td data-label="Actions" className="staff-actions">
                        <details className="row-menu">
                          <summary aria-label={`Actions for ${row.name ?? 'this staff member'}`}><MoreHorizontal size={17} /></summary>
                          <ul>
                            <li><button type="button" onClick={() => { setEditing({ userId: row.userId, permission: row.permission, name: row.name }); setPanelOpen(true) }}>Edit access</button></li>
                            <li><ConfirmAction className="danger" label={`Remove access for ${row.name ?? 'this staff member'}`} question={`Remove ${row.name ?? 'this person'}’s access? They lose it immediately.`} confirmLabel="Remove access" onConfirm={async () => { await removeAccess(row) }} /></li>
                          </ul>
                        </details>
                      </td>
                    </tr>)}
                  </tbody></table></div>}
          </div>
          <div className="staff-footer-note"><Lock size={14} /> Staff permissions apply only to {tournamentName}. A person's real permissions are checked by the database before every write.</div>
        </>}

    {panelOpen && <aside className="invite-panel" role="dialog" aria-label="Invite staff">
      <header><div><h4>{editing ? 'Edit staff access' : 'Invite Staff'}</h4><small>Give someone access to {tournamentName}.</small></div><button type="button" className="icon-button" aria-label="Close panel" onClick={closePanel}><X size={18} /></button></header>
      <div className="invite-step">
        <label>{editing ? 'Staff member' : 'Name or email'}
          {editing
            ? <input value={selected?.name || 'Member (no public profile)'} readOnly />
            : <span className="invite-input"><Search size={16} /><input value={query} onChange={event => { setQuery(event.target.value); setSelected(null) }} placeholder="Search registered users" autoComplete="off" /></span>}
        </label>
        {!editing && query.trim().length < 2 && <p className="field-hint">Type at least two letters. People search covers registered users with a published player profile - email search is not supported yet, because the platform never exposes other users' email addresses.</p>}
        {!editing && searching && <p className="field-hint">Searching…</p>}
        {!editing && !selected && candidates.length > 0 && <ul className="invite-candidates">{candidates.map(person => <li key={person.accountId}><button type="button" onClick={() => { setSelected(person); setQuery(person.name) }}>{person.name}</button></li>)}</ul>}
        {!editing && query.trim().length >= 2 && !selected && !searching && candidates.length === 0 && <p className="field-hint">No published player profile matches "{query.replace(/<|>/g, '').slice(0, 40)}". Ask this person to create and publish a player profile first, then search again.</p>}
        {!editing && selected && <p className="invite-selected">Selected: <strong>{selected.name}</strong></p>}
      </div>
      {selected && <div className="invite-step">
        <label>Role
          <select value={role} onChange={event => setRole(event.target.value as StaffPermission)} disabled={saving}>
            {STAFF_PERMISSIONS.map(permission => <option value={permission} key={permission}>{TOURNAMENT_STAFF_ROLES[permission].label}</option>)}
          </select>
        </label>
      </div>}
      {selected && <div className="invite-perms">
        <strong><Lock size={14} /> Can access</strong>
        <ul>{TOURNAMENT_STAFF_ROLES[role].bullets(tournamentName).map((bullet, index) => <li key={index}>{bullet}</li>)}</ul>
      </div>}
      {selected && <div className="invite-panel-actions">
        <button type="button" className="outline-button" onClick={closePanel}>Cancel</button>
        <button type="button" className="primary-button" onClick={() => void (editing ? changeAccess() : sendInvitation())} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save access' : 'Send Invitation'}</button>
      </div>}
      {!editing && selected && <p className="field-hint">No email is sent: the person appears in the staff list immediately and sees this tournament's workspace on their next sign-in.</p>}
      {error && <div className="form-error" role="alert">{error}</div>}
    </aside>}
    {panelOpen && <div className="invite-scrim" onClick={closePanel} aria-hidden="true" />}
  </div>
}
