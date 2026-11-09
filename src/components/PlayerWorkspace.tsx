import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, BarChart3, CalendarDays, Check, Eye, EyeOff, FileText, Gauge, Globe2, HelpCircle, IdCard, ImageOff, ListChecks, Mail, Lock, RotateCcw, Send, ShieldCheck, UserRound, WifiOff } from 'lucide-react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import {
  currentMembership, loadPlayerWorkspace, markNotificationRead, playerRatingFromStatistics, profileCompletion,
  setPlayerPublication, submitTeamRequest, updatePlayerProfileDetails, PLAYER_PRIVATE_DETAIL_NOTE, PLAYER_PROFILE_DETAIL_FIELDS,
  type PlayerWorkspaceData, type ProfileEditFields,
} from '../lib/playerWorkspace'
import { totalOfficialStatistics } from '../lib/playerRating'
import { PlayerCard, type CardChoices } from './PlayerCard'
import { IdentityCheckPanel, NationalIdField } from './IdentityPanels'
import { ProfileExtrasEditor, ProfilePhotoEditor } from './PlayerProfileEditors'
import { PlayerDocumentsTab, TeamInvitationsPanel, TrophyCabinet } from './PlayerSections'
import { loadCardDetails, loadPlayerDocuments, loadTeamInvitations, markAllNotificationsRead, saveCardStyle, type PlayerDocument, type TeamInvitation } from '../lib/playerSections'
import { groupMatches, legacyMatches, loadTournamentCards, loadVisibility, loadWorkspaceMatches, opponentOf, setBioVisibility, setPhotoVisibility, type RequestType, type TournamentCard, type VisibilityState, type WorkspaceMatch } from '../lib/playerHub'
import { isCardStyle, type CardStyle } from '../lib/cardImage'
import { SPORT_NAMES } from '../lib/display'
import { formatMaldivesDateTime } from '../lib/publicData'
import { activeGuardianScopes, loadGuardianApprovals, loadIdentityStatus } from '../lib/identity'
import { isSessionExpiredError } from '../lib/supabase'
import {
  claimStatus, disciplineSummary, eligibilityFor, inboxActions, loadAvailability, locationFor, logCardAction, missingBasics, nextAction, NEEDS_FINAL, onboardingSteps, parsePlayerLocation,
  playerLocationHash, readOnboarding, saveAvailability, SECTION_TABS, tournamentItems, writeOnboarding, CLAIM_STATUS_LABELS,
  type Availability, type OnboardingChoices, type PlayerLocation,
} from '../lib/playerHome'
import { WorkspaceShell, type ShellItem } from './WorkspaceShell'
import { GuardianStatus, MilestoneProgress, NotificationsTab, PrivacyTab, RequestsTab, StatisticsTab, TeamsTab, TournamentsTab, type Hub } from './PlayerHubTabs'
import { AccountSeparation, ActionInbox, ActivitySection, ControlledFields, EligibilitySection, MatchesSection, OnboardingCard, SubTabs, TabPanel, type EligibilityRow } from './PlayerHome'
import { Card } from './HubUi'
import { ActivityPage, CardPage, CareerPage, DocumentsPage, MatchesPage, OverviewPage, PrivacyHelpPage, RequestsPage } from './PlayerPages'

// Owner's workspace design (2026-11-04): nine destinations. Each opens an existing
// section and tab; the tabs inside a destination may come from different sections.
type PlayerNav = 'overview' | 'profile' | 'card' | 'career' | 'matches' | 'requests' | 'documents' | 'activity' | 'privacy'
const NAV: Array<ShellItem<PlayerNav>> = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'profile', label: 'My Profile', shortLabel: 'Profile', icon: UserRound },
  { id: 'card', label: 'Digital Card', shortLabel: 'Card', icon: IdCard },
  { id: 'career', label: 'Career Records', shortLabel: 'Career', icon: BarChart3 },
  { id: 'matches', label: 'My Matches', shortLabel: 'Matches', icon: CalendarDays },
  { id: 'requests', label: 'Requests', icon: Mail },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'privacy', label: 'Privacy & Help', shortLabel: 'Privacy', icon: HelpCircle },
]
const NAV_PRIMARY: PlayerNav[] = ['overview', 'profile', 'career', 'requests']
const NAV_TABS: Record<PlayerNav, string[]> = {
  overview: [], profile: ['profile'], card: ['card'], career: ['statistics', 'achievements', 'teams', 'tournaments'], matches: ['matches', 'availability', 'discipline'],
  requests: ['requests', 'notifications', 'eligibility'], documents: ['documents'], activity: ['history'], privacy: ['privacy', 'help'],
}
const NAV_PAGE: Record<PlayerNav, [string, string]> = {
  overview: ['', 'Your sport, your progress, your next match.'], profile: ['My Profile', 'Keep your player details up to date.'], card: ['Digital Player Card', 'Your sporting identity, ready to share.'],
  career: ['Career Records', 'Your sporting journey, built from official results.'], matches: ['My Matches', 'Follow your fixtures and review your match history.'],
  requests: ['Requests & Invitations', 'Review invitations and track requests linked to your player record.'], documents: ['My Documents', 'Manage private files used for player verification and registration.'],
  activity: ['Activity History', 'See changes and updates linked to your player record.'], privacy: ['Privacy & Help', 'Control your public profile and find the support you need.'],
}
function navFor(location: PlayerLocation): PlayerNav {
  if (location.section === 'overview') return 'overview'
  const found = (Object.keys(NAV_TABS) as PlayerNav[]).find(nav => location.tab && NAV_TABS[nav].includes(location.tab))
  return found ?? (location.section === 'requests' ? 'requests' : location.section === 'career' ? 'career' : location.section === 'more' ? 'documents' : 'profile')
}
// Mirrors the items scored by profileCompletion.
const PROFILE_CHECKLIST = ['Display name', 'Island', 'Photo', 'Team membership', 'Claimed profile']
const CARD_SEEN_KEY = (playerId: string) => `kulhivaru.card-seen.${playerId}`
const readFlag = (key: string) => { try { return localStorage.getItem(key) === '1' } catch { return false } }

function first(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? null
  if (value && typeof value === 'object') return value as Record<string, unknown>
  return null
}
function formatDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  useEffect(() => { const update = () => setOnline(navigator.onLine !== false); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) } }, [])
  return online
}

// Card choices saved on the profile (player_workspace_final). Before that
// migration only the style and jersey number load, as they did before.
async function loadCardChoices(client: SupabaseClient, playerId: string) {
  const result = await client.from('player_profiles').select('card_style,jersey_number,public_code,card_team_id,card_photo_y,card_stat_variant,preferred_side').eq('id', playerId).maybeSingle()
  if (result.error || !result.data) { const basic = await loadCardDetails(client, playerId); return { cardStyle: basic.cardStyle, jerseyNumber: basic.jerseyNumber, code: null, teamId: null, photoY: 30, statVariant: 'attack' as const, preferredSide: null, available: false } }
  const row = result.data as Record<string, unknown>
  return { cardStyle: isCardStyle(row.card_style) ? row.card_style : null, jerseyNumber: typeof row.jersey_number === 'number' ? row.jersey_number : null, code: typeof row.public_code === 'string' ? row.public_code : null, teamId: typeof row.card_team_id === 'string' ? row.card_team_id : null, photoY: typeof row.card_photo_y === 'number' ? row.card_photo_y : 30, statVariant: row.card_stat_variant === 'discipline' ? 'discipline' as const : 'attack' as const, preferredSide: typeof row.preferred_side === 'string' ? row.preferred_side : null, available: true }
}

export function PlayerWorkspace({ client, user, playerId, onSignIn }: { client: SupabaseClient; user: User; playerId: string; onSignIn?: () => void }) {
  const [data, setData] = useState<PlayerWorkspaceData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [location, setLocationState] = useState<PlayerLocation>(() => parsePlayerLocation(window.location.hash))
  const [reloadKey, setReloadKey] = useState(0)
  const [card, setCard] = useState<Awaited<ReturnType<typeof loadCardChoices>>>({ cardStyle: null, jerseyNumber: null, code: null, teamId: null, photoY: 30, statVariant: 'attack', preferredSide: null, available: false })
  const [cardNotice, setCardNotice] = useState('')
  const [matches, setMatches] = useState<{ data: WorkspaceMatch[]; available: boolean }>({ data: [], available: false })
  const [tournamentCards, setTournamentCards] = useState<Map<string, TournamentCard>>(new Map())
  const [invitations, setInvitations] = useState<TeamInvitation[]>([])
  const [documents, setDocuments] = useState<PlayerDocument[]>([])
  const [visibility, setVisibility] = useState<VisibilityState>({ photoPath: null, photoVisible: true, bioVisible: true, hasBio: false, available: false })
  const [visibilityBusy, setVisibilityBusy] = useState(false)
  const [visibilityNotice, setVisibilityNotice] = useState('')
  const [requestPreset, setRequestPreset] = useState<RequestType | null>(null)
  const [identity, setIdentity] = useState<'registered' | 'not_registered' | 'unavailable'>('unavailable')
  const [guardian, setGuardian] = useState<{ isMinor: boolean; approved: boolean }>({ isMinor: false, approved: false })
  const [availability, setAvailability] = useState<{ data: Map<string, { status: Availability; reason: string | null }>; available: boolean }>({ data: new Map(), available: true })
  const [onboarding, setOnboarding] = useState<OnboardingChoices>(() => readOnboarding(playerId))
  const [cardSeen, setCardSeen] = useState(() => readFlag(CARD_SEEN_KEY(playerId)))
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  const online = useOnline()

  const go = useCallback((next: PlayerLocation) => {
    const tabs = SECTION_TABS[next.section] as readonly string[]
    const resolved = { section: next.section, tab: next.tab ?? (tabs[0] ?? null) }
    setLocationState(resolved)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${playerLocationHash(window.location.hash, resolved)}`)
    window.scrollTo({ top: 0 })
  }, [])
  const open = useCallback((target: string | PlayerLocation) => go(typeof target === 'string' ? locationFor(target) : target), [go])
  const reload = useCallback(() => setReloadKey(value => value + 1), [])
  const clearPreset = useCallback(() => setRequestPreset(null), [])
  const request = (type: RequestType) => { setRequestPreset(type); go(locationFor('requests')) }

  const [confirmChecked, setConfirmChecked] = useState(false)
  const [publicationBusy, setPublicationBusy] = useState(false)
  const [publicationError, setPublicationError] = useState('')
  const [publicationNotice, setPublicationNotice] = useState('')
  const [form, setForm] = useState({ display_name: '', island: '', nationality: '', position: '', primarySport: '', otherSports: [] as string[] })
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveNotice, setSaveNotice] = useState('')
  const [requestTeamId, setRequestTeamId] = useState('')
  const [requestMessage, setRequestMessage] = useState('')
  const [requestBusy, setRequestBusy] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [requestNotice, setRequestNotice] = useState('')

  useEffect(() => {
    let active = true
    const load = async () => {
      const result = await loadPlayerWorkspace(client, user.id, playerId)
      if (!active) return
      setLoading(false)
      if (result.error) { setError(result.error); return }
      setError(''); setData(result.data); setLoadedAt(new Date().toISOString())
      const profile = result.data!.profile
      // Form values survive a failed save; they are only refreshed from the
      // database when nothing is being edited.
      setForm(current => saveBusy ? current : {
        display_name: typeof profile.display_name === 'string' ? profile.display_name : '',
        island: typeof profile.island === 'string' ? profile.island : '',
        nationality: typeof profile.nationality === 'string' ? profile.nationality : '',
        position: typeof profile.position === 'string' ? profile.position : '',
        primarySport: Array.isArray(profile.sports) && profile.sports[0] ? String(profile.sports[0]) : '',
        otherSports: Array.isArray(profile.sports) ? profile.sports.slice(1).map(String) : [],
      })
    }
    void load()
    return () => { active = false }
  }, [client, user.id, playerId, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { let active = true; void loadCardChoices(client, playerId).then(details => { if (active) setCard(details) }); return () => { active = false } }, [client, playerId, reloadKey])
  // Workspace-wide extras. Each loads and fails on its own.
  useEffect(() => {
    let active = true
    void loadWorkspaceMatches(client, playerId).then(result => { if (active) setMatches({ data: result.data, available: result.available && !result.error }) })
    void loadTeamInvitations(client, playerId).then(result => { if (active) setInvitations(result.data) })
    void loadPlayerDocuments(client, playerId).then(result => { if (active) setDocuments(result.data) })
    void loadVisibility(client, playerId).then(result => { if (active) setVisibility(result) })
    void loadIdentityStatus(client, playerId).then(result => { if (active) setIdentity(result) })
    void loadAvailability(client, playerId).then(result => { if (active) setAvailability(result) })
    void Promise.all([client.from('player_profiles').select('is_minor').eq('id', playerId).maybeSingle(), loadGuardianApprovals(client, playerId)]).then(([profile, approvals]) => { if (active && !profile.error) setGuardian({ isMinor: profile.data?.is_minor === true, approved: activeGuardianScopes(approvals.data).claim }) })
    return () => { active = false }
  }, [client, playerId, reloadKey])

  const tournamentIds = useMemo(() => [...new Set([...(data?.tournaments ?? []).map(row => String(row.id)), ...matches.data.map(match => match.tournamentId)].filter(Boolean))].sort().join(','), [data?.tournaments, matches.data])
  useEffect(() => { let active = true; void loadTournamentCards(client, tournamentIds ? tournamentIds.split(',') : []).then(map => { if (active) setTournamentCards(map) }); return () => { active = false } }, [client, tournamentIds])
  useEffect(() => { if (location.section === 'profile' && location.tab === 'card' && !cardSeen) { try { localStorage.setItem(CARD_SEEN_KEY(playerId), '1') } catch { /* preference only */ } setCardSeen(true) } }, [location.section, location.tab, cardSeen, playerId])

  if (loading) return <div className="pw-loading" aria-busy="true"><span className="skeleton pw-sk-header" /><span className="skeleton pw-sk-block" /><div className="pw-sk-row">{[0, 1, 2, 3].map(index => <span key={index} className="skeleton" />)}</div><span className="sr-only" role="status">Loading your player workspace…</span></div>
  if (error || !data) {
    const expired = isSessionExpiredError(error)
    const denied = /permission|not authorized|row-level/i.test(error)
    return <section className="pw-state" role="alert">
      <h2>{expired ? 'Your session expired' : denied ? 'You cannot open this player workspace' : !online ? 'You are offline' : 'Your player workspace could not be loaded'}</h2>
      <p>{expired ? 'Sign in again to continue. Your unsaved changes are still here.' : denied ? 'Only the account linked to this player profile can open it.' : !online ? 'Reconnect to load your workspace.' : 'Please try again. If it keeps happening, contact support.'}</p>
      <div className="pw-actions">{expired && onSignIn ? <button type="button" className="ed-btn ed-btn-primary" onClick={onSignIn}>Sign In Again</button> : <button type="button" className="ed-btn ed-btn-primary" onClick={() => { setLoading(true); reload() }}><RotateCcw size={15} /> Retry</button>}<a className="ed-btn ed-btn-ghost" href="#workspace">Switch workspace</a></div>
    </section>
  }

  const profile = data.profile
  const isPublished = profile.is_published === true
  const name = String(profile.display_name ?? 'Player')
  // A hidden photo keeps its file; the owner still sees it here. The URL is
  // resolved at display time from the stored path.
  const photo = typeof profile.photo_url === 'string' && profile.photo_url ? profile.photo_url : visibility.photoPath ? client.storage.from('public-media').getPublicUrl(visibility.photoPath).data.publicUrl : ''
  const slug = String(profile.slug ?? '')
  const initials = name.split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || 'P'
  const position = typeof profile.position === 'string' && profile.position ? profile.position : null
  const sport = Array.isArray(profile.sports) && profile.sports[0] ? SPORT_NAMES[String(profile.sports[0])] ?? String(profile.sports[0]) : null
  const totals = totalOfficialStatistics(data.statistics)
  const rating = playerRatingFromStatistics(data.statistics)
  const completion = profileCompletion(profile, data.teams.length > 0)
  const current = currentMembership(data.teams)
  const currentTeam = current ? first(current.teams) : null
  const currentTeamName = currentTeam ? String(currentTeam.name ?? 'Team') : null
  const notifications = data.notifications ?? []
  const unreadNotifications = notifications.filter(row => row.read_at == null).length
  const tournamentsById = new Map(data.tournaments.map(row => [String(row.id), row]))
  const shownMatches = matches.available ? matches.data : legacyMatches(data.matches, tournamentsById)
  const documentsNeedingAction = documents.filter(item => ['changes_requested', 'rejected', 'expired'].includes(item.status)).length
  const emailVerified = Boolean(user.email_confirmed_at)

  const hub: Hub = {
    client, userId: user.id, playerId, data, matches: shownMatches, matchesAvailable: matches.available, tournaments: tournamentCards, invitations, documentsNeedingAction,
    name, photo, initials, slug, isPublished, position, sport, jersey: card.jerseyNumber, completion, currentTeamName, totals, rating, open, reload,
  }

  // Derived, never stored: eligibility, discipline, status and the next action.
  const activeTeamIds = new Set(data.teams.filter(row => !row.effective_to && ['active', 'loaned'].includes(String(row.status))).map(row => String(row.team_id)))
  const eligibility: EligibilityRow[] = tournamentItems(hub).filter(item => !['completed', 'archived', 'cancelled'].includes(tournamentCards.get(item.id)?.status ?? '')).map(item => {
    const result = eligibilityFor({ tournamentName: tournamentCards.get(item.id)?.name ?? 'this tournament', identity, emailVerified, isMinor: guardian.isMinor, guardianApproved: guardian.approved, activeMembership: item.teamId ? activeTeamIds.has(item.teamId) : activeTeamIds.size > 0, rosterStatus: item.rosterStatus, documents: documents.filter(doc => doc.tournamentId === item.id).map(doc => ({ status: doc.status, retentionUntil: doc.expiresAt })) })
    return { tournamentId: item.id, tournamentName: tournamentCards.get(item.id)?.name ?? 'Tournament', teamName: item.teamName, ...result }
  })
  const eligibilityIssues = eligibility.filter(row => ['action_required', 'ineligible', 'expired'].includes(row.status)).map(row => row.tournamentName)
  const rosterCorrections = tournamentItems(hub).filter(item => item.rosterStatus === 'changes_requested').map(item => tournamentCards.get(item.id)?.name ?? 'a tournament')
  const discipline = disciplineSummary(shownMatches)
  const groups = groupMatches(shownMatches, new Date().toISOString())
  const upcoming = groups.live[0] ?? groups.upcoming[0] ?? null
  const needsAvailability = availability.available ? groups.upcoming.find(match => match.status === 'scheduled' && !availability.data.has(match.id)) ?? null : null
  const openIdentityRequest = (data.correctionRequests ?? []).some(row => ['pending', 'under_review', 'changes_requested'].includes(String(row.status)) && /identity|verification/i.test(String(row.subject ?? '') + String(row.request_type ?? '')))
  const status = claimStatus({ claimed: profile.is_claimed === true, pendingClaimInvitation: (data.claimInvitations ?? []).some(row => row.state === 'pending'), identity, openIdentityRequest, conflict: false })
  const basics = missingBasics(profile, photo)
  const action = nextAction({
    claimed: profile.is_claimed === true, emailVerified, identity, identityConflict: false, missingProfile: basics,
    pendingInvitation: invitations.find(item => item.status === 'pending')?.teamName ?? null, eligibilityIssue: eligibilityIssues[0] ?? null, documentsNeedingAction,
    rosterCorrection: rosterCorrections[0] ?? null, availabilityNeeded: needsAvailability ? { matchId: needsAvailability.id, label: `against ${opponentOf(needsAvailability).name}` } : null,
    upcomingMatch: upcoming ? { label: `vs ${opponentOf(upcoming).name}`, when: `${upcoming.scheduledAt ? formatMaldivesDateTime(upcoming.scheduledAt) : 'Date to be confirmed'} · ${upcoming.tournamentName}` } : null,
    isPublished, cardSeen,
  })
  const steps = onboardingSteps({ identity, missingBasics: basics, hasTeam: data.teams.length > 0, isPublished, choices: onboarding })
  const showOnboarding = !onboarding.dismissed && !steps[steps.length - 1].done
  const actions = inboxActions({ invitations, rosterCorrections, documentsNeedingAction, eligibilityIssues, verification: identity === 'not_registered' })
  const choose = (patch: OnboardingChoices) => { const next = { ...onboarding, ...patch }; setOnboarding(next); writeOnboarding(playerId, next) }

  const markAllRead = async () => {
    const result = await markAllNotificationsRead(client, user.id)
    if (result.error) return
    const now = new Date().toISOString()
    setData({ ...data, notifications: notifications.map(row => row.read_at == null ? { ...row, state: 'read', read_at: now } : row) })
  }
  const markRead = async (notificationId: string) => {
    const result = await markNotificationRead(client, user.id, notificationId)
    if (result.error) return
    setData({ ...data, notifications: notifications.map(row => row.id === notificationId ? { ...row, state: 'read', read_at: new Date().toISOString() } : row) })
  }
  const customizeCard = async (choices: CardChoices) => {
    const previous = card
    setCard({ ...card, cardStyle: choices.style, teamId: choices.teamId, photoY: choices.photoY, statVariant: choices.statVariant }); setCardNotice('')
    if (choices.style !== previous.cardStyle) { const result = await saveCardStyle(client, user.id, playerId, choices.style); if (result.error) { setCard(previous); return setCardNotice(result.error) } }
    if (!card.available) { if (choices.teamId !== previous.teamId || choices.photoY !== previous.photoY || choices.statVariant !== previous.statVariant) setCardNotice(`Saving these choices ${NEEDS_FINAL.toLowerCase().replace('this needs', 'needs')}`); return }
    const result = await client.from('player_profiles').update({ card_team_id: choices.teamId, card_photo_y: choices.photoY, card_stat_variant: choices.statVariant }).eq('id', playerId).eq('account_id', user.id).select('id')
    if (result.error) { setCard(previous); setCardNotice(result.error.message.includes('card_team_not_allowed') ? 'Only a published team you have played for can be shown.' : 'Your card choices could not be saved.') }
  }
  const togglePublication = async (publish: boolean) => {
    setPublicationBusy(true); setPublicationError(''); setPublicationNotice('')
    const result = await setPlayerPublication(client, user.id, playerId, publish)
    setPublicationBusy(false)
    if (result.error) { setPublicationError(result.error); return }
    setData({ ...data, profile: { ...profile, is_published: publish } })
    setConfirmChecked(false)
    setPublicationNotice(publish ? 'Your profile is now public. Guests can see it in the Players listing.' : 'Your profile is now private. It is hidden from guests again.')
  }
  const saveProfile = async () => {
    setSaveBusy(true); setSaveError(''); setSaveNotice('')
    // The photo is saved by its own uploader, so it is not part of this form.
    const sports = [form.primarySport, ...form.otherSports.filter(item => item !== form.primarySport)].filter(Boolean)
    const fields: ProfileEditFields = { display_name: form.display_name, island: form.island }
    if (data.profileDetailsAvailable) { fields.nationality = form.nationality; fields.position = form.position; fields.sports = sports }
    const result = await updatePlayerProfileDetails(client, user.id, playerId, fields)
    setSaveBusy(false)
    if (result.error) { setSaveError(isSessionExpiredError(result.error) ? 'Your session expired. Sign in again; your changes are still in the form.' : result.error); return }
    setSaveNotice('Saved. Your player profile is up to date.')
    const updated: Record<string, unknown> = { ...profile, display_name: form.display_name.trim(), island: form.island.trim() }
    if (data.profileDetailsAvailable) { updated.nationality = form.nationality.trim() || null; updated.position = form.position.trim() || null; updated.sports = sports }
    setData({ ...data, profile: updated })
  }
  const sendTeamRequest = async () => {
    setRequestBusy(true); setRequestError(''); setRequestNotice('')
    const result = await submitTeamRequest(client, user.id, playerId, requestTeamId, requestMessage)
    setRequestBusy(false)
    if (result.error) { setRequestError(result.error); return }
    setRequestMessage(''); setRequestNotice('Your team join request was recorded. A team manager will review it.'); reload()
  }
  const changePhotoVisibility = async (visible: boolean) => {
    setVisibilityBusy(true); setVisibilityNotice('')
    const result = await setPhotoVisibility(client, user.id, playerId, visibility.photoPath, visible)
    setVisibilityBusy(false)
    if (result.error) return setVisibilityNotice(result.error)
    setData({ ...data, profile: { ...profile, photo_url: result.url } })
    setVisibility({ ...visibility, photoVisible: visible })
    setVisibilityNotice(visible ? 'Your photo is visible again.' : 'Your photo is hidden from the public. You still see it here.')
  }
  const changeBioVisibility = async (visible: boolean) => {
    setVisibilityBusy(true); setVisibilityNotice('')
    const result = await setBioVisibility(client, user.id, playerId, visible)
    setVisibilityBusy(false)
    if (result.error) return setVisibilityNotice(result.error)
    setVisibility({ ...visibility, bioVisible: visible })
    setVisibilityNotice(visible ? 'Your biography is public again.' : 'Your biography is hidden and stored privately.')
  }
  const setMatchAvailability = async (matchId: string, value: Availability, reason: string) => {
    const result = await saveAvailability(client, playerId, matchId, value, reason)
    if (!result.error) setAvailability({ ...availability, data: new Map(availability.data).set(matchId, { status: value, reason: reason.trim() || null }) })
    return result.error
  }

  const publicationCard = <section className={`pf-card pf-visibility${isPublished ? ' is-public' : ''}`}>
    <header className="pf-card-head"><span className="pf-card-icon"><Globe2 size={18} /></span><div><h3>Public visibility</h3><p className="publication-status">{isPublished ? 'Your profile is public.' : 'Your profile is private.'}</p></div></header>
    <p className="publication-explain">If you publish, the public sees only: your display name, photo, island, nationality, sport, position, published team history, confirmed match appearances, verified statistics, achievements, your Digital Card and public player code. Your national ID, contact details, identity documents, date of birth, payments, guardian details and internal notes are never public.</p>
    {guardian.isMinor && <p className="pf-hint"><Lock size={13} /> You are under 18: publishing needs a guardian’s approval on file{guardian.approved ? ' (approved).' : '.'}</p>}
    {!isPublished && <label className="publication-confirm"><input type="checkbox" checked={confirmChecked} onChange={event => setConfirmChecked(event.target.checked)} /> I understand what will become public and want to publish my profile.</label>}
    {publicationError && <p className="form-error" role="alert">{publicationError}</p>}
    {publicationNotice && <p className="publication-notice" role="status">{publicationNotice}</p>}
    {isPublished ? <button type="button" className="ed-btn ed-btn-ghost pf-block" disabled={publicationBusy} onClick={() => void togglePublication(false)}>{publicationBusy ? 'Please wait…' : 'Unpublish profile'}</button> : <button type="button" className="ed-btn ed-btn-primary pf-block" disabled={!confirmChecked || publicationBusy} onClick={() => void togglePublication(true)}>{publicationBusy ? 'Please wait…' : 'Publish profile'}</button>}
  </section>
  const visibilityCard = <section className="pf-card">
    <header className="pf-card-head"><span className="pf-card-icon"><EyeOff size={18} /></span><div><h3>Optional details</h3><p>Choose what appears on your public page</p></div></header>
    <ul className="pw-toggles">
      <li><span>{visibility.photoVisible ? <Eye size={16} /> : <ImageOff size={16} />} Profile photo</span><button type="button" role="switch" aria-checked={visibility.photoVisible} aria-label="Show profile photo publicly" className={`pw-switch${visibility.photoVisible ? ' on' : ''}`} disabled={visibilityBusy || !visibility.photoPath} onClick={() => void changePhotoVisibility(!visibility.photoVisible)}><span /></button></li>
      <li><span>{visibility.bioVisible ? <Eye size={16} /> : <EyeOff size={16} />} Biography</span><button type="button" role="switch" aria-checked={visibility.bioVisible} aria-label="Show biography publicly" className={`pw-switch${visibility.bioVisible ? ' on' : ''}`} disabled={visibilityBusy || !visibility.hasBio || !visibility.available} onClick={() => void changeBioVisibility(!visibility.bioVisible)}><span /></button></li>
    </ul>
    <p className="pf-hint"><Lock size={13} /> A hidden photo or biography is removed from your public profile, the players list and team rosters; your official history stays. Team affiliation follows each team’s own publication. {!visibility.photoPath ? 'Upload a photo in My Profile to control it here.' : ''}{!visibility.available ? ' Biography visibility needs migration 030.' : ''}</p>
    {visibilityNotice && <p className={visibilityNotice.includes('migration') ? 'pending-note' : 'publication-notice'} role="status">{visibilityNotice}</p>}
  </section>
  const joinForm = <section className="pf-card">
    <header className="pf-card-head"><span className="pf-card-icon"><Send size={18} /></span><div><h3>Find a team</h3><p>The team manager reviews your request</p></div></header>
    {data.teamRequests !== null ? <>
      <div className="pf-fields">
        <label className="pf-field">Team<select value={requestTeamId} onChange={event => setRequestTeamId(event.target.value)}><option value="">Choose a published team…</option>{(data.teamDirectory ?? []).map(team => <option key={String(team.id)} value={String(team.id)}>{String(team.name)}</option>)}</select></label>
        <label className="pf-field">Message<input value={requestMessage} placeholder="Why would you like to join?" onChange={event => setRequestMessage(event.target.value)} /></label>
      </div>
      {(data.teamRequests ?? []).length > 0 && <ul className="pw-mini-list">{(data.teamRequests ?? []).slice(0, 4).map(row => <li key={String(row.id)}><span><strong>{String(first(row.teams)?.name ?? 'Team')}</strong><small>{row.resolution_note ? String(row.resolution_note) : `Sent ${formatDate(row.created_at)}`}</small></span><span className={`pw-pill tone-${row.status === 'approved' ? 'ok' : row.status === 'rejected' ? 'bad' : row.status === 'pending' ? 'warn' : 'muted'}`}>{row.status === 'pending' ? 'Waiting' : String(row.status)}</span></li>)}</ul>}
      {requestError && <p className="form-error" role="alert">{requestError}</p>}
      {requestNotice && <p className="publication-notice" role="status">{requestNotice}</p>}
      <footer className="pf-card-foot"><button type="button" className="ed-btn ed-btn-primary" disabled={requestBusy} onClick={() => void sendTeamRequest()}>{requestBusy ? 'Sending…' : 'Send join request'}</button></footer>
    </> : <p className="pending-note">Team join requests become available once the reviewed profile-requests migration is applied.</p>}
    {(data.claimInvitations?.length ?? 0) > 0 && <><div className="pf-divider" /><h4 className="pf-subhead">Profile claim invitations</h4><ul className="pw-mini-list">{(data.claimInvitations ?? []).map(row => <li key={String(row.id)}><span><strong>Claim this player profile</strong><small>{row.invited_email ? `Sent to ${String(row.invited_email)} · ` : ''}{row.state === 'accepted' ? `accepted ${formatDate(row.accepted_at)}` : `expires ${formatDate(row.expires_at)}`}</small></span><span className={`pw-pill tone-${row.state === 'accepted' ? 'ok' : row.state === 'pending' ? 'warn' : 'muted'}`}>{({ accepted: 'Accepted', revoked: 'Withdrawn', expired: 'Expired', pending: 'Waiting' } as Record<string, string>)[String(row.state)] ?? String(row.state)}</span></li>)}</ul></>}
  </section>

  // The card's team: the chosen published team, else the current one.
  const cardTeams = data.teams.map(row => ({ id: String(row.team_id), team: first(row.teams) })).filter((item, index, all) => item.team?.is_published === true && all.findIndex(other => other.id === item.id) === index).map(item => ({ id: item.id, name: String(item.team?.name ?? 'Team'), logo: (item.team?.logo_url as string | null) ?? null }))
  const chosenTeam = cardTeams.find(team => team.id === card.teamId) ?? (currentTeam?.is_published === true ? { id: String(current?.team_id), name: String(currentTeam.name ?? 'Team'), logo: (currentTeam.logo_url as string | null) ?? null } : null)
  const cardProfile = { ...profile, photo_url: photo || null, card_style: card.cardStyle ?? 'classic', jersey_number: card.jerseyNumber, public_code: card.code, preferred_side: card.preferredSide ?? profile.preferred_side }
  const cardChoices: CardChoices = { style: (card.cardStyle ?? 'classic') as CardStyle, teamId: card.teamId, photoY: card.photoY, statVariant: card.statVariant }
  const cardElement = <PlayerCard profile={cardProfile} teamName={chosenTeam?.name ?? null} teamLogo={chosenTeam?.logo ?? null} totals={totals} rating={rating} isPublished={isPublished} choices={cardChoices} teamOptions={cardTeams} onCustomize={choices => void customizeCard(choices)} onAction={event => void logCardAction(client, user.id, playerId, event)} />

  const tab = location.tab ?? (SECTION_TABS[location.section] as readonly string[])[0] ?? null
  const sourceMatches = shownMatches.filter(match => match.resultConfirmed && match.participated).length

  const nav = navFor(location)
  const navItems = NAV.map(item => item.id === 'requests' ? { ...item, count: unreadNotifications + actions.length } : item)
  const navTabs = NAV_TABS[nav]
  return <WorkspaceShell kindLabel="Player" title={name} subtitle={`${CLAIM_STATUS_LABELS[status]} · ${isPublished ? 'Public' : 'Private'} profile`} items={navItems} primaryIds={NAV_PRIMARY} active={nav} onSelect={id => go(id === 'overview' ? { section: 'overview', tab: null } : locationFor(NAV_TABS[id][0]))} pageTitle={nav === 'overview' ? `Welcome back, ${name.split(' ')[0]}` : NAV_PAGE[nav][0]} pageLede={NAV_PAGE[nav][1]}>
    {!online && <p className="lp-stale" role="status"><WifiOff size={14} /> You are offline. What you see was loaded at {loadedAt ? formatMaldivesDateTime(loadedAt) : 'an earlier time'}; changes cannot be saved until you reconnect.</p>}
    {data.unavailable.length > 0 && <div className="pending-note">Some sections could not be loaded right now: {data.unavailable.join(', ')}. Nothing private is shown in their place.</div>}
    {data.pendingSchema.length > 0 && <div className="pending-note">Waiting for the reviewed profile-requests migration: {data.pendingSchema.join(', ')}. These features stay clearly marked until the migration is approved and applied.</div>}
    {nav === 'profile' && isPublished && slug ? <div className="pp-head-action"><a className="ed-btn ed-btn-ghost" href={`#player/${encodeURIComponent(slug)}`}><Eye size={17} aria-hidden="true" /> View Public Profile</a></div> : null}
    {navTabs.length > 1 && <SubTabs label={NAV_PAGE[nav][0]} tabs={navTabs} active={tab ?? navTabs[0]} onChange={next => go(locationFor(next))} counts={{ matches: groups.live.length, eligibility: eligibilityIssues.length, notifications: unreadNotifications + actions.length }} />}

    {location.section === 'overview' && <OverviewPage hub={hub} code={card.code} attention={action && !actions.some(item => item.target.section === action.target.section && item.target.tab === action.target.tab) ? [{ key: `next-${action.id}`, title: action.title, detail: action.text, target: action.target }, ...actions] : actions} onGo={open} upcoming={groups.upcoming} completed={groups.completed}
      onboarding={showOnboarding ? <OnboardingCard steps={steps} onGo={go} onChoose={choice => choose({ [choice]: true })} onHide={() => choose({ dismissed: true })} /> : null} />}

    {location.section === 'profile' && <>
      <TabPanel tab={tab ?? 'profile'}>
        {tab === 'profile' && <div className="pf-page">
          <AccountSeparation />
          <div className="pf-layout">
            <div className="pf-main">
              <section className="pf-card profile-appearance">
                <header className="pf-card-head"><span className="pf-card-icon"><UserRound size={20} aria-hidden="true" /></span><div><h3>Profile appearance</h3><p>Your photo appears on your public profile and player card.</p></div></header>
                <div className="profile-appearance-cover" aria-hidden="true" />
                <ProfilePhotoEditor compact client={client} userId={user.id} playerId={playerId} name={name} photoUrl={photo || null} onChanged={url => { setData({ ...data, profile: { ...profile, photo_url: url } }); reload() }} />
              </section>

              <section className="pf-card">
                <header className="pf-card-head"><span className="pf-card-icon"><UserRound size={18} /></span><div><h3>Basic information</h3><p>How you appear across Kulhivaru+</p></div></header>
                <div className="pf-fields">
                  <label className="pf-field">Display name<input value={form.display_name} onChange={event => setForm({ ...form, display_name: event.target.value })} /></label>
                  <label className="pf-field">Island<input value={form.island} list="kv-islands" onChange={event => setForm({ ...form, island: event.target.value })} placeholder="e.g. Kanditheemu" /></label>
                  {data.profileDetailsAvailable && <label className="pf-field">Nationality<input value={form.nationality} onChange={event => setForm({ ...form, nationality: event.target.value })} /></label>}
                </div>
                <div className="pf-divider" />
                <h4 className="pf-subhead">Playing information</h4>
                {data.profileDetailsAvailable ? <div className="pf-fields">
                  <label className="pf-field">Primary sport<select value={form.primarySport} onChange={event => setForm({ ...form, primarySport: event.target.value, otherSports: form.otherSports.filter(item => item !== event.target.value) })}><option value="">Choose…</option>{Object.entries(SPORT_NAMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                  <label className="pf-field">Position<input value={form.position} onChange={event => setForm({ ...form, position: event.target.value })} placeholder="e.g. Midfielder" /></label>
                  <fieldset className="pf-wide pf-chip-group"><legend>Additional sports</legend>{Object.entries(SPORT_NAMES).filter(([key]) => key !== form.primarySport).map(([key, label]) => <label key={key} className={`pf-toggle${form.otherSports.includes(key) ? ' on' : ''}`}><input type="checkbox" checked={form.otherSports.includes(key)} onChange={event => setForm({ ...form, otherSports: event.target.checked ? [...form.otherSports, key] : form.otherSports.filter(item => item !== key) })} />{form.otherSports.includes(key) && <Check size={13} />} {label}</label>)}</fieldset>
                </div> : <p className="pending-note">Nationality, sports and position become editable once the reviewed profile-requests migration ({PLAYER_PROFILE_DETAIL_FIELDS}) is applied.</p>}
                <div className="pf-divider" />
                <NationalIdField client={client} playerId={playerId} onRegistered={() => { setIdentity('registered'); reload() }} />
                {identity === 'registered' && <button type="button" className="ed-link-btn" onClick={() => request('identity')}>Request identity correction</button>}
                {saveError && <p className="form-error" role="alert">{saveError}</p>}
                {saveNotice && <p className="publication-notice" role="status">{saveNotice}</p>}
                <footer className="pf-card-foot"><button type="button" className="ed-btn ed-btn-primary" disabled={saveBusy} onClick={() => void saveProfile()}>{saveBusy ? 'Saving…' : 'Save changes'}</button></footer>
              </section>
              <ProfileExtrasEditor client={client} userId={user.id} playerId={playerId} bioHidden={!visibility.bioVisible} onSaved={reload} />
              <section className="pf-card">
                <header className="pf-card-head"><span className="pf-card-icon"><Lock size={18} /></span><div><h3>Private details</h3><p>Only you and authorized staff can see these</p></div></header>
                <dl className="pw-dl">
                  <div><dt>Date of birth</dt><dd>{data.privateDetails && typeof data.privateDetails.date_of_birth === 'string' ? formatDate(data.privateDetails.date_of_birth) : 'Not on file'}</dd></div>
                  <div><dt>Profile claim</dt><dd>{profile.is_claimed === true ? 'Claimed by you' : 'Not claimed yet'}</dd></div>
                </dl>
                <p className="pf-hint"><Lock size={13} /> {PLAYER_PRIVATE_DETAIL_NOTE} Email and phone belong to your <a href="#account">account</a>.</p>
              </section>
            </div>
            <aside className="pf-side">
              <section className="pf-card profile-record"><header className="pf-card-head"><span className="pf-card-icon"><Lock size={20} aria-hidden="true" /></span><div><h3>Player record</h3><p>Managed through verified requests</p></div></header>{card.code ? <strong className="profile-record-code">{card.code}</strong> : null}<dl><div><dt>Record name</dt><dd>{name}</dd></div>{currentTeamName ? <div><dt>Current team</dt><dd>{currentTeamName}</dd></div> : null}<div><dt>Profile claim</dt><dd>{CLAIM_STATUS_LABELS[status]}</dd></div></dl><button type="button" className="ed-btn ed-btn-ghost" onClick={() => request('profile')}>Request a correction</button><details className="profile-correction-options"><summary>All correction options</summary><ControlledFields onRequest={request} /></details></section>
              {publicationCard}
              <button type="button" className="ed-link-btn" onClick={() => go(locationFor('privacy'))}>Manage privacy & visibility</button>
              <section className="pf-card">
                <header className="pf-card-head"><span className="pf-card-icon"><ListChecks size={18} /></span><div><h3>Checklist</h3><p>{completion.completed} of {completion.total} done</p></div></header>
                <ul className="pf-checklist">{PROFILE_CHECKLIST.map(item => <li key={item} className={completion.missing.includes(item) ? '' : 'done'}><span>{completion.missing.includes(item) ? null : <Check size={12} />}</span>{item}</li>)}</ul>
              </section>
            </aside>
          </div>
        </div>}
        {tab === 'card' && <CardPage hub={hub} card={cardElement} notice={cardNotice ? <p className="pending-note" role="status">{cardNotice}</p> : null} onEdit={() => go(locationFor('profile'))} onPrivacy={() => go(locationFor('privacy'))} />}
        {tab === 'privacy' && <>
          <PrivacyHelpPage visibility={<div className="pw-stack">{publicationCard}{visibilityCard}</div>}
            information={<ul className="pp-info-rows">{([['data_copy', 'Request a copy of my data', 'Request copy'], ['profile', 'Correct my player record', 'Start request'], ['duplicate_profile', 'Report a duplicate profile', 'Report'], ['account_closure', 'Request account deletion', 'Review options']] as Array<[RequestType, string, string]>).map(([type, label, action]) => <li key={type}><FileText size={20} aria-hidden="true" /><span>{label}</span><button type="button" className={`sq-btn${type === 'account_closure' ? ' pp-danger' : ''}`} onClick={() => request(type)}>{action}</button></li>)}
              <li className="pp-info-links"><a className="ed-link" href="#account">Account Settings</a>{onboarding.dismissed && <button type="button" className="ed-link-btn" onClick={() => { choose({ dismissed: false }); go({ section: 'overview', tab: null }) }}>Reopen setup guide</button>}</li></ul>} />
          <PrivacyTab hub={hub} publication={null} visibility={null} onHelp={request}
            identity={<div className="pw-stack pw-identity"><IdentityCheckPanel client={client} playerId={playerId} onNotice={() => undefined} /><GuardianStatus client={client} playerId={playerId} /></div>} />
        </>}
      </TabPanel>
    </>}

    {location.section === 'career' && <>
      <TabPanel tab={tab ?? 'teams'}>
        {tab === 'teams' && <TeamsTab hub={hub} invitations={<TeamInvitationsPanel client={client} playerId={playerId} onAccepted={reload} />} joinForm={joinForm} />}
        {tab === 'tournaments' && <TournamentsTab hub={hub} />}
        {tab === 'statistics' && <CareerPage hub={hub} onCorrection={() => request('statistics')} details={<>
          <p className="pw-source" role="note"><ShieldCheck size={14} /> {totals.appearances} appearance{totals.appearances === 1 ? '' : 's'} calculated from {matches.available ? `${sourceMatches} confirmed match record${sourceMatches === 1 ? '' : 's'}` : 'confirmed match records'}. As of {loadedAt ? formatMaldivesDateTime(loadedAt) : '—'} MVT. <button type="button" className="ed-link-btn" onClick={() => go(locationFor('completed'))}>View source matches</button></p>
          <StatisticsTab hub={hub} /></>} />}
        {tab === 'achievements' && <><MilestoneProgress hub={hub} /><TrophyCabinet client={client} milestones={data.milestones} /><p className="pw-footnote"><ShieldCheck size={13} /> Automatic milestones come from confirmed matches; awards are issued by organizers. Something wrong? <button type="button" className="ed-link-btn inline" onClick={() => request('statistics')}>Report a problem</button></p></>}
        {tab === 'matches' && <MatchesPage hub={hub} upcoming={groups.upcoming} completed={groups.completed} more={<details className="pp-more"><summary>Live matches, availability and full match list</summary><div className="pw-stack">{groups.live.length > 0 && <MatchesSection hub={hub} tab="live" availability={availability.data} availabilityReady={availability.available} onAvailability={setMatchAvailability} discipline={discipline} />}<MatchesSection hub={hub} tab="upcoming" availability={availability.data} availabilityReady={availability.available} onAvailability={setMatchAvailability} discipline={discipline} /><MatchesSection hub={hub} tab="completed" availability={availability.data} availabilityReady={availability.available} onAvailability={setMatchAvailability} discipline={discipline} /></div></details>} />}
        {tab === 'history' && <ActivityPage hub={hub} code={card.code}><ActivitySection hub={hub} /></ActivityPage>}
      </TabPanel>
    </>}

    {location.section === 'requests' && <>
      <TabPanel tab={tab ?? 'requests'}>
        {tab === 'requests' && <RequestsPage hub={hub} code={card.code} onNewRequest={() => request('profile')}><RequestsTab hub={hub} preset={requestPreset} onPresetUsed={clearPreset} /></RequestsPage>}
        {tab === 'eligibility' && <EligibilitySection rows={eligibility} onGo={open} />}
      </TabPanel>
    </>}

    {location.section === 'more' && <>
      <TabPanel tab={tab ?? 'documents'}>
        {tab === 'documents' && <DocumentsPage hub={hub} code={card.code} documents={documents}><PlayerDocumentsTab client={client} userId={user.id} playerId={playerId} tournaments={[...tournamentCards.values()].map(item => ({ id: item.id, name: item.name }))} onChanged={reload} /></DocumentsPage>}
        {tab === 'discipline' && <MatchesSection hub={hub} tab="discipline" availability={availability.data} availabilityReady={availability.available} onAvailability={setMatchAvailability} discipline={discipline} />}
        {tab === 'availability' && <MatchesSection hub={hub} tab="availability" availability={availability.data} availabilityReady={availability.available} onAvailability={setMatchAvailability} discipline={discipline} />}
        {tab === 'notifications' && <div className="pw-page"><ActionInbox actions={actions} onGo={go} /><NotificationsTab hub={hub} onMarkRead={id => void markRead(id)} onMarkAll={() => void markAllRead()} /></div>}
        {tab === 'help' && <Card icon={<HelpCircle size={18} />} title="Help and settings" sub="Where to go for everything else">
          <p className="pf-hint">Privacy, public visibility and data requests are under Profile → Privacy & visibility.</p>
          <div className="pw-actions"><a className="ed-btn ed-btn-ghost ed-btn-sm" href="#info/help">Help Centre</a><a className="ed-btn ed-btn-ghost ed-btn-sm" href="#account">Account Settings</a><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => go(locationFor('privacy'))}>Privacy & visibility</button><a className="ed-btn ed-btn-ghost ed-btn-sm" href="#workspace">Switch workspace</a></div>
        </Card>}
      </TabPanel>
    </>}
  </WorkspaceShell>
}
