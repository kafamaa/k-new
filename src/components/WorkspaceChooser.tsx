import { useState } from 'react'
import type { FormEvent } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { ArrowRight, CircleUserRound, HelpCircle, ShieldAlert, ShieldCheck, Star, Trophy, Users } from 'lucide-react'
import { acceptWorkspaceInvitation, createOrganization, createPersonalPlayerProfile, createTeam } from '../lib/records'
import { groupWorkspacesByKind, ONBOARDING_LABELS, WORKSPACE_KIND_LABELS } from '../lib/workspace'
import type { Workspace, WorkspaceKind } from '../lib/workspace'

type CreateKind = 'player' | 'team' | 'organization' | 'join'

const KIND_ICONS: Record<WorkspaceKind, typeof CircleUserRound> = { player: CircleUserRound, team: ShieldCheck, organization: Trophy, official: Users, platform_admin: ShieldAlert }
const KIND_TITLES: Record<WorkspaceKind, string> = { player: 'Player', team: 'Team', organization: 'Organizer', official: 'Official assignments', platform_admin: 'Platform Administration' }
const KIND_BLURB: Record<WorkspaceKind, string> = {
  player: 'Manage your profile, career and player requests.',
  team: 'Manage your squad, tournament entries and team activity.',
  organization: 'Create tournaments and manage your organization.',
  official: 'Match-center tools for matches an organizer assigned you.',
  platform_admin: 'Manage the complete Kulhivaru+ platform',
}
const DISPLAY_ORDER: WorkspaceKind[] = ['player', 'team', 'organization', 'official']
// My Work (owner, 2026-11-02): the five kinds of work, in this order, under these names.
const MY_WORK_LABELS: Record<WorkspaceKind, string> = { player: 'Player Career', team: 'Managed Teams', organization: 'Organizations', official: 'Official Assignments', platform_admin: 'Platform Administration' }
// Matches an organizer assigned: never self-created.
const ASSIGNMENT_KINDS: WorkspaceKind[] = ['official']

function onboardingError(error: string, choice: CreateKind | null): string {
  if (choice === 'player' && (error.includes('player_profiles') || error.includes('row-level security'))) return 'Personal player creation was denied by the connected Supabase RLS policy. This requires an authorized policy/schema inspection; do not manually edit the database or bypass RLS.'
  if ((choice === 'organization' || choice === 'team') && error.includes('row-level security')) return `${choice === 'organization' ? 'Organizer' : 'Team'} workspace creation was denied by the connected Supabase RLS policy. A reviewed policy fix is prepared but not yet applied; do not manually edit the database or bypass RLS.`
  if (choice === 'join' && (error.includes('Function') || error.includes('not found'))) return 'Invitation joining is not enabled in this environment yet. The reviewed workspace-invitation migration and trusted Edge Function must be deployed first.'
  return error
}

function CreateForm({ client, user, choice, onComplete, onNotice, onCancel }: { client: SupabaseClient; user: User; choice: CreateKind; onComplete: () => void; onNotice: (message: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [island, setIsland] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true)
    if (choice === 'player') {
      const result = await createPersonalPlayerProfile(client, user.id, name, island); setSaving(false)
      if (result.error) return setError(onboardingError(result.error, choice))
      onNotice('Your player profile is ready. Open it from My Work.'); return onComplete()
    }
    if (choice === 'team') {
      const result = await createTeam(client, user.id, name, island); setSaving(false)
      if (result.error) return setError(onboardingError(result.error, choice))
      onNotice('Your team is ready and you are its manager. Open it from My Work.'); return onComplete()
    }
    if (choice === 'organization') {
      const result = await createOrganization(client, user.id, name); setSaving(false)
      if (result.error) return setError(onboardingError(result.error, choice))
      onNotice('Your organization is ready and you own it. Open it from My Work.'); return onComplete()
    }
    const result = await acceptWorkspaceInvitation(client, token); setSaving(false)
    if (result.error) return setError(onboardingError(result.error, choice))
    onNotice('Invitation accepted. It now appears in My Work.'); onComplete()
  }
  return <form className="onboarding-form" onSubmit={submit}>
    <button type="button" className="back-link" onClick={onCancel}>← Cancel</button>
    {choice === 'join' ? <label>Private invitation token<input value={token} onChange={event => setToken(event.target.value)} placeholder="Paste the token from an authorized manager" /></label>
      : <><label>{choice === 'player' ? 'Your player display name' : choice === 'team' ? 'Team name' : 'Organization name'}<input value={name} onChange={event => setName(event.target.value)} placeholder="Use your real name" /></label>
        {choice !== 'organization' && <label>Island / atoll (optional)<input value={island} list="kv-islands" onChange={event => setIsland(event.target.value)} /></label>}</>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : choice === 'join' ? 'Accept invitation' : 'Create workspace'} <ArrowRight size={15} /></button>
  </form>
}

function KindPanel({ kind, workspaces, onSelect, onComplete, onNotice, client, user }: { kind: WorkspaceKind; workspaces: Workspace[]; onSelect: (workspace: Workspace) => void; onComplete: () => void; onNotice: (message: string) => void; client: SupabaseClient; user: User }) {
  const [creating, setCreating] = useState<CreateKind | null>(null)
  const Icon = KIND_ICONS[kind]
  const hasWorkspaces = workspaces.length > 0
  const assignmentOnly = ASSIGNMENT_KINDS.includes(kind)
  return <section className={`ws-choice ws-choice-${kind}`} aria-labelledby={`choice-${kind}`}>
    <header className="ws-choice-head"><span className="ws-choice-icon"><Icon size={20} aria-hidden="true" /></span><div><h2 id={`choice-${kind}`}>{KIND_TITLES[kind]}</h2><span className="sr-only">{MY_WORK_LABELS[kind]}</span><p>{KIND_BLURB[kind]}</p></div></header>
    {hasWorkspaces && <ul className="ws-choice-list">{workspaces.map(workspace => <li key={workspace.id}>
      <div className="ws-choice-identity">{workspace.logoUrl ? <img className="ws-workspace-mark ws-workspace-logo" src={workspace.logoUrl} alt="" /> : <span className="ws-workspace-mark" aria-hidden="true">{workspace.name.trim().slice(0, 2).toUpperCase()}</span>}<span className="ws-workspace-text"><strong>{workspace.name}</strong><small>{workspace.role.replace(/_/g, ' ')}</small></span></div>
      <button type="button" className="ed-btn ed-btn-primary ws-choice-open" onClick={() => onSelect(workspace)} aria-label={`Open ${workspace.name} ${KIND_TITLES[kind].toLowerCase()} workspace`}>Open {KIND_TITLES[kind]} Workspace <ArrowRight size={17} aria-hidden="true" /></button>
    </li>)}</ul>}
    {creating ? <CreateForm client={client} user={user} choice={creating} onComplete={onComplete} onNotice={onNotice} onCancel={() => setCreating(null)} />
      : !hasWorkspaces ? <div className="ws-choice-create">
        <p>{assignmentOnly ? 'No official assignments yet. An organizer adds you to a match, and it appears here.' : kind === 'player' ? 'You do not have a player profile yet.' : kind === 'team' ? 'You do not manage a team yet.' : 'You do not run an organization yet.'}</p>
        <div className="chooser-actions">
          {kind !== 'official' && <button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={() => setCreating(kind as CreateKind)}>{ONBOARDING_LABELS[kind as Exclude<WorkspaceKind, 'official' | 'platform_admin'>]} <ArrowRight size={14} /></button>}
          {kind !== 'player' && kind !== 'official' && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setCreating('join')}>Join by invitation</button>}
        </div>
      </div> : kind !== 'player' && !assignmentOnly ? <div className="ws-choice-links"><button type="button" className="ed-link-btn" onClick={() => setCreating(kind as CreateKind)}>Create {kind === 'team' ? 'a team' : 'an organization'}</button><button type="button" className="ed-link-btn" onClick={() => setCreating('join')}>Join by invitation</button></div> : null}
  </section>
}

// Choose Workspace: the always-first screen after sign-in. It lists only the
// authorized workspaces and, for any kind the account does not have, the single
// appropriate onboarding choice. Nothing is opened automatically.
// Recently used and pinned workspaces live on this device only (they are a convenience,
// never a permission): an entry that is no longer authorized simply is not shown.
const RECENT_KEY = 'kulhivaru.recent-workspaces'
const PINNED_KEY = 'kulhivaru.pinned-workspaces'
const workspaceKey = (workspace: Workspace) => `${workspace.kind}:${workspace.id}`
function readList(key: string): string[] { try { const value = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 20) : [] } catch { return [] } }
function writeList(key: string, list: string[]) { try { localStorage.setItem(key, JSON.stringify(list.slice(0, 20))) } catch { /* convenience only */ } }

// Super Admin: its own card, shown only when the database confirmed administrator
// access for this session. It is never opened automatically.
function AdminCard({ workspace, onOpen }: { workspace: Workspace; onOpen: () => void }) {
  return <section className="ws-choice ws-choice-platform_admin" aria-labelledby="choice-platform_admin">
    <header className="ws-choice-head"><span className="ws-choice-icon"><ShieldAlert size={20} /></span><div><h2 id="choice-platform_admin">{MY_WORK_LABELS.platform_admin}</h2><p><strong>{workspace.role}</strong> · {KIND_BLURB.platform_admin}</p></div></header>
    <div className="chooser-actions"><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={onOpen}>Open Platform Administration <ArrowRight size={14} /></button></div>
  </section>
}

export function WorkspaceChooser({ client, user, workspaces, onSelect, onComplete, onNotice, adminError, onRetryAdmin }: { client: SupabaseClient; user: User; workspaces: Workspace[]; onSelect: (workspace: Workspace) => void; onComplete: () => void; onNotice: (message: string) => void; adminError?: string; onRetryAdmin?: () => void }) {
  const groups = groupWorkspacesByKind(workspaces)
  const [pinned, setPinned] = useState<string[]>(() => readList(PINNED_KEY))
  const recent = readList(RECENT_KEY)
  const open = (workspace: Workspace) => { writeList(RECENT_KEY, [workspaceKey(workspace), ...recent.filter(key => key !== workspaceKey(workspace))]); onSelect(workspace) }
  const togglePin = (workspace: Workspace) => { const key = workspaceKey(workspace); const next = pinned.includes(key) ? pinned.filter(item => item !== key) : [key, ...pinned]; setPinned(next); writeList(PINNED_KEY, next) }
  const byKey = new Map(workspaces.map(workspace => [workspaceKey(workspace), workspace]))
  const quick = [...new Set([...pinned, ...recent])].map(key => byKey.get(key)).filter((workspace): workspace is Workspace => Boolean(workspace)).slice(0, 6)
  return <div className="ws-chooser">
    {quick.length > 0 && workspaces.length > 1 && <section className="ws-quick" aria-label="Pinned and recent workspaces">
      <h2 className="ed-subhead">Pinned and recent</h2>
      <ul className="ws-quick-list">{quick.map(workspace => { const key = workspaceKey(workspace); const isPinned = pinned.includes(key); return <li key={key}>
        <button type="button" className="ws-quick-open" onClick={() => open(workspace)}><strong>{workspace.name}</strong><small>{WORKSPACE_KIND_LABELS[workspace.kind]}{isPinned ? ' · Pinned' : ' · Recent'}</small></button>
        <button type="button" className="ed-icon-btn" aria-pressed={isPinned} aria-label={isPinned ? `Unpin ${workspace.name}` : `Pin ${workspace.name}`} onClick={() => togglePin(workspace)}><Star size={15} fill={isPinned ? 'currentColor' : 'none'} /></button>
      </li> })}</ul>
      <p className="ws-chooser-note">Pin a workspace to keep it at the top. This list is saved on this device only.</p>
    </section>}
    {quick.length === 0 && workspaces.length > 1 && <p className="ws-chooser-note">Workspaces you open appear here for quick access; pin one to keep it at the top.</p>}
    {DISPLAY_ORDER.map(kind => <KindPanel key={kind} kind={kind} workspaces={groups[kind]} onSelect={open} onComplete={onComplete} onNotice={onNotice} client={client} user={user} />)}
    {groups.platform_admin[0] ? <AdminCard workspace={groups.platform_admin[0]} onOpen={() => open(groups.platform_admin[0])} /> : null}
    {adminError ? <div className="form-error" role="alert"><strong>Unable to verify administrator access.</strong> {adminError}{onRetryAdmin ? <> <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={onRetryAdmin}>Retry</button></> : null}</div> : null}
    {workspaces.length === 0 && <p className="ws-chooser-note">No workspaces yet. Create your first one above; you can add more roles later.</p>}
    <nav className="ws-chooser-help" aria-label="Workspace help"><a href="#info/help"><HelpCircle size={17} aria-hidden="true" /> Need help choosing?</a><a href="#home">Continue browsing <ArrowRight size={16} aria-hidden="true" /></a></nav>
    <p className="ws-chooser-note"><ShieldCheck size={14} aria-hidden="true" /> Only workspaces you are authorized to use appear here. Opening one never grants new permissions.</p>
  </div>
}
