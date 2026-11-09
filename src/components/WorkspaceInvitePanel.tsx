import { useState } from 'react'
import type { FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MailPlus } from 'lucide-react'
import { createWorkspaceInvitation } from '../lib/records'

const ROLE_OPTIONS: Record<'team' | 'organization', Array<{ value: string; label: string }>> = {
  team: [{ value: 'manager', label: 'Team manager' }, { value: 'staff', label: 'Team staff' }],
  organization: [{ value: 'operations', label: 'Operations (runs tournaments)' }, { value: 'finance', label: 'Finance' }, { value: 'media', label: 'Media' }, { value: 'staff', label: 'Staff' }],
}

// Creates a one-time, 7-day invitation. The token is shown once and is not
// stored anywhere in the app; the inviter sends it privately. The invited
// person pastes it in Choose Workspace -> Join by invitation.
export function WorkspaceInvitePanel({ client, workspaceType, workspaceId, onNotice }: { client: SupabaseClient; workspaceType: 'team' | 'organization'; workspaceId: string; onNotice: (message: string) => void }) {
  const [role, setRole] = useState(ROLE_OPTIONS[workspaceType][0].value)
  const [email, setEmail] = useState('')
  const [token, setToken] = useState<{ value: string; expiresAt: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setToken(null)
    const result = await createWorkspaceInvitation(client, { workspaceType, workspaceId, role, invitedEmail: email })
    setBusy(false)
    if (result.error || !result.data) return setError(result.error ?? 'The invitation could not be created.')
    setToken({ value: result.data.invitationToken, expiresAt: result.data.expiresAt })
    onNotice('Invitation created. Send the token privately; it is shown only once.')
  }
  // Not "invite-panel": that class is the slide-in drawer elsewhere.
  return <section className="panel-block invite-card">
    <h3><MailPlus size={15} /> Invite {workspaceType === 'team' ? 'a team member' : 'an organization member'}</h3>
    <form className="invite-form" onSubmit={submit}>
      <label>Role<select value={role} onChange={event => setRole(event.target.value)}>{ROLE_OPTIONS[workspaceType].map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
      <label>Their email (recommended)<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Only this verified email can accept" /></label>
      <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Creating…' : 'Create invitation'}</button>
    </form>
    {token && <div className="warning" role="status">
      <p><strong>One-time invitation token</strong> (expires {new Date(token.expiresAt).toLocaleDateString('en-GB', { timeZone: 'Indian/Maldives' })}):</p>
      <code className="invite-token">{token.value}</code>
      <p>Send it privately. They sign in, open Choose Workspace and select <em>Join by invitation</em>. It cannot be shown again; create a new one if it is lost.</p>
    </div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <small>Invitations never grant ownership. Email delivery is not configured, so the app does not send the token for you.</small>
  </section>
}
