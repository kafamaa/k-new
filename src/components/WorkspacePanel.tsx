import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { clearOfflineCache } from '../lib/offlineCache'
import type { User } from '@supabase/supabase-js'
import { supabase, isSessionExpiredError } from '../lib/supabase'
import { isPlatformAdminRoute, loadWorkspaceSummary, upsertProfile, parseWorkspaceRoute, playerShortcutTarget, resolveAuthorizedWorkspace, workspaceRouteHash } from '../lib/workspace'
import type { Workspace } from '../lib/workspace'
import { WorkspaceChooser } from './WorkspaceChooser'
import { OrganizerWorkspace } from './OrganizerWorkspace'
import { TeamWorkspace } from './TeamWorkspace'
import { OfficialWorkspace } from './OfficialWorkspace'
import { ExternalLink, LogOut } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
const WORKSPACE_KIND_LABEL: Record<string, string> = { player: 'Player Workspace', team: 'Team Workspace', organization: 'Organizer Workspace', official: 'Official Workspace', platform_admin: 'Platform Administration' }
import { BrandLogo } from './BrandLogo'
import { takeSignInIntent } from '../lib/signInIntent'
import { organizerHash, tournamentRouteId } from '../lib/organizer'

// Each workspace is its own chunk, loaded only when opened.
const PlayerWorkspace = lazy(() => import('./PlayerWorkspace').then(module => ({ default: module.PlayerWorkspace })))
// The Super Admin workspace checks access with the database itself before showing anything.
const AdminWorkspace = lazy(() => import('./AdminWorkspace').then(module => ({ default: module.AdminWorkspace })))

export function WorkspacePanel({ user, onNotice, onSignIn, onSignOut }: { user: User; onNotice: (message: string) => void; onSignIn: () => void; onSignOut: () => void }) {
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [name, setName] = useState(''); const [workspaces, setWorkspaces] = useState<Workspace[]>([]); const [reloadKey, setReloadKey] = useState(0); const [hash, setHash] = useState(() => window.location.hash); const [adminError, setAdminError] = useState('')
  useEffect(() => { const onHashChange = () => setHash(window.location.hash); window.addEventListener('hashchange', onHashChange); return () => window.removeEventListener('hashchange', onHashChange) }, [])
  useEffect(() => { const client = supabase; if (!client) return; let active = true; const load = async (allowRefresh = true) => { setLoading(true); setError(''); setAdminError(''); const profile = await upsertProfile(client, user); const profileError = profile.error; const result = await loadWorkspaceSummary(client, user); if (allowRefresh && (isSessionExpiredError(profileError) || isSessionExpiredError(result.error))) { const refreshed = await client.auth.refreshSession(); if (!refreshed.error && refreshed.data.session?.user) return load(false); await client.auth.signOut(); clearOfflineCache(); if (active) { setLoading(false); setError('Your session expired. Please sign in again.'); onNotice('Your session expired. Please sign in again.'); } return } if (!active) return; setLoading(false); if (profileError) setError(profileError); if (result.error) setError(result.error); if (result.data) { setWorkspaces(result.data.workspaces); setAdminError(result.data.adminError ?? ''); setDuplicatePlayers(result.data.duplicatePlayers === true); setName(result.data.profile?.display_name || user.email || '') } }; void load(); return () => { active = false } }, [user, reloadKey, onNotice])
  const [duplicatePlayers, setDuplicatePlayers] = useState(false)
  // A different account never sees the previous account's workspaces, even briefly.
  useEffect(() => { setWorkspaces([]); setName(''); setAdminError('') }, [user.id])
  // #workspace/player opens the account's own linked player (never an id
  // from the browser). With no linked player the chooser offers Create/Claim.
  const shortcut = loading || error ? null : playerShortcutTarget(hash, workspaces)
  useEffect(() => {
    if (!shortcut?.target) return
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${shortcut.target}`)
    setHash(shortcut.target)
  }, [shortcut?.target])
  // The open workspace is derived from the route and the authorized list. A route
  // that does not resolve to an authorized workspace falls back to Choose
  // Workspace, so an unauthorized or stale workspace is never opened.
  // #workspace/tournament/<id> opens inside the organization that runs it, and only
  // when this account is a member of that organization (RLS hides the rest).
  const routeTournament = tournamentRouteId(hash)
  const [tournamentOwner, setTournamentOwner] = useState<{ id: string; organizationId: string | null } | null>(null)
  useEffect(() => {
    if (!routeTournament || !supabase || tournamentOwner?.id === routeTournament) return
    let active = true
    void supabase.from('tournaments').select('organization_id').eq('id', routeTournament).maybeSingle().then(result => {
      if (active) setTournamentOwner({ id: routeTournament, organizationId: result.error ? null : (result.data?.organization_id as string | undefined) ?? null })
    })
    return () => { active = false }
  }, [routeTournament, tournamentOwner?.id])
  const tournamentResolved = !routeTournament || tournamentOwner?.id === routeTournament
  const selected = useMemo(() => {
    if (routeTournament) return tournamentOwner?.id === routeTournament ? workspaces.find(workspace => workspace.kind === 'organization' && workspace.id === tournamentOwner.organizationId) ?? null : null
    return resolveAuthorizedWorkspace(parseWorkspaceRoute(hash), workspaces)
  }, [hash, workspaces, routeTournament, tournamentOwner])
  useEffect(() => {
    if (loading || error || !routeTournament || !tournamentResolved || selected) return
    onNotice('That tournament is not available to this account. Choose a workspace to continue.')
    window.location.hash = '#workspace'
  }, [loading, error, routeTournament, tournamentResolved, selected, onNotice])
  // The Super Admin route is never redirected: its own check shows Access denied or a retry.
  const adminRoute = isPlatformAdminRoute(hash)
  useEffect(() => { if (!loading && !error && !adminRoute && parseWorkspaceRoute(hash).kind === 'open' && !selected) window.location.hash = '#workspace' }, [loading, error, hash, selected, adminRoute])
  const openWorkspace = (workspace: Workspace) => { window.location.hash = workspaceRouteHash(workspace) }
  // Arrived from "Create tournament": open the organizer workspace (its
  // Tournaments section creates the draft), or explain the first step.
  useEffect(() => {
    if (loading || error) return
    const intent = takeSignInIntent()
    if (intent !== 'organizer') return
    const organization = workspaces.find(workspace => workspace.kind === 'organization')
    if (organization) window.location.hash = organizerHash(organization.id, { section: 'tournaments' })
    else { window.location.hash = '#workspace'; onNotice('Create an organization first, then you can create its tournaments.') }
  }, [loading, error, workspaces, onNotice])
  const backToChooser = () => { window.location.hash = '#workspace'; onNotice('Choose a workspace to open.') }
  const onWorkspaceCreated = () => setReloadKey(value => value + 1)
  const client = supabase!
  const organizationWorkspaces = workspaces.filter(workspace => workspace.kind === 'organization')
  // When a workspace is open, its own chrome (organizer header, sidebar
  // breadcrumbs) is the only visible shell: no separate "Your Authorized
  // Space" heading and no second "Open Workspace" banner above it. The chooser
  // keeps its own heading because it is the page there.
  // The organizer brings its own header (organization switcher, inbox,
  // account); every other view shares this slim workspace top bar.
  const ownHeader = selected?.kind === 'organization'
  return <section className="ws-root" id="workspace">
    {!ownHeader && <header className="ws-appbar">
      <BrandLogo size={26} href="#workspace" label="My Work" />
      {selected ? <a className="ws-appbar-kind" href="#workspace" aria-label={`${WORKSPACE_KIND_LABEL[selected.kind] ?? 'Workspace'}: switch workspace`}>{WORKSPACE_KIND_LABEL[selected.kind] ?? 'Workspace'} <ChevronDown size={15} aria-hidden="true" /></a> : null}
      <span className="ws-appbar-user">{name || user.email}</span>
      <a className="ed-btn ed-btn-ghost ed-btn-sm" href="#top" aria-label="Browse website"><ExternalLink size={14} aria-hidden="true" /> <span className="ed-hide-sm">Browse website</span></a>
      <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={onSignOut} aria-label="Sign out"><LogOut size={14} aria-hidden="true" /> <span className="ed-hide-sm">Sign out</span></button>
    </header>}
    {adminRoute ? <Suspense fallback={<div className="loading-state">Checking administrator access…</div>}><AdminWorkspace user={user} onNotice={onNotice} onSignIn={onSignIn} /></Suspense>
      : loading || !tournamentResolved ? <div className="loading-state">Loading your profile and authorized workspaces…</div>
      : error ? <>
        <div className="workspace-heading"><p className="eyebrow">YOUR AUTHORIZED SPACE</p><h2>{selected ? selected.name : name ? `Welcome, ${name}` : 'My Work'}</h2></div>
        <div className="form-error" role="alert">Unable to load workspace data: {error}<button type="button" className="retry-button" onClick={() => onNotice('Refresh the page to retry workspace loading.')}>Dismiss</button><button type="button" className="outline-button dark" onClick={onSignIn}>Sign in again</button></div>
      </>
        : selected ? <>{selected.kind === 'player' ? <Suspense fallback={<div className="loading-state">Loading your player workspace…</div>}><PlayerWorkspace client={client} user={user} playerId={selected.id} onSignIn={onSignIn} /></Suspense>
            : selected.kind === 'organization' ? <OrganizerWorkspace client={client} user={user} organization={selected} organizations={organizationWorkspaces} onNotice={onNotice} onSwitchWorkspace={backToChooser} />
              : selected.kind === 'team' ? <TeamWorkspace client={client} user={user} teamId={selected.id} onNotice={onNotice} />
                : selected.kind === 'official' ? <OfficialWorkspace client={client} user={user} onNotice={onNotice} />
                  : <div className="workspace-note">No workspace tools are available for this selection. Use Switch Workspace to choose another one.</div>}
        </>
          : <><nav className="ws-chooser-crumbs" aria-label="Breadcrumb"><a href="#home">Home</a><span aria-hidden="true">/</span><strong>My Work</strong></nav><div className="ws-chooser-head"><h1>My Work</h1><p>Choose a workspace to get started.</p><span>Switch workspaces anytime from the top menu.</span></div>
            {duplicatePlayers && <div className="form-error" role="alert"><strong>Multiple player profiles are connected to this account.</strong> To keep your records safe, none was opened. Contact support to resolve this: <a href="#info/account-support">Account support</a>.</div>}{shortcut && !shortcut.target && !duplicatePlayers && <div className="warning" role="status">You do not have a player profile yet. Create your player profile, claim an existing one, or use a claim invitation below.</div>}<WorkspaceChooser client={client} user={user} workspaces={workspaces} onSelect={openWorkspace} onComplete={onWorkspaceCreated} onNotice={onNotice} adminError={adminError} onRetryAdmin={onWorkspaceCreated} /></>}</section>
}
