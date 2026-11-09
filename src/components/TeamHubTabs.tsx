import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AlertTriangle, ArchiveRestore, ArrowRight, BadgeCheck, CalendarClock, CalendarDays, Check, ClipboardList, Crown, Eye, EyeOff, Fingerprint, Globe2, History, ImageUp, Lock,
  MapPin, Medal, Palette, Pencil, Settings, Shield, ShieldCheck, Trash2, Trophy, UserMinus, UserPlus, Users, X,
} from 'lucide-react'
import type { TeamWorkspaceData } from '../lib/teamWorkspace'
import {
  addUnclaimedPlayer, AUDIT_LABELS, groupFixtures, INVITATION_STATUS_LABELS, loadTeamAudit, loadTeamPrivateDetails, loadTeamStaff, PERMISSION_LABELS,
  removeTeamStaff, resolveJoinRequest, revokeInvitation, saveTeamPrivateDetails, saveTeamProfile, setTeamArchived, setTeamPublished, setTeamStaff, STAFF_ROLE_LABELS, STAFF_ROLES,
  statusTone, TEAM_PERMISSIONS, TEAM_SOCIAL, TEAM_TYPE_LABELS, TEAM_TYPE_OPTIONS, teamOutcome, transferTeamOwnership, uploadTeamImage, APPLICATION_STATUS_LABELS, ROSTER_STATUS_LABELS,
  type AuditRow, type SentInvitation, type StaffMember, type StaffRole, type TeamAccess, type TeamMatch, type TeamPermission, type TeamPrivateDetails, type TeamProfile,
} from '../lib/teamHub'
import type { TournamentCard } from '../lib/playerHub'
import type { IdentityInput } from '../lib/identity'
import { formatMaldivesDateTime } from '../lib/publicData'
import { formatDay, SPORT_NAMES, sportName } from '../lib/display'
import { Crest } from './Editorial'
import { Card, Empty, Pending, Pill } from './HubUi'
import { InvitePlayerPanel } from './TeamPlayerPanels'
import { PlayerRequestsReview } from './PlayerRequestsReview'
import { WorkspaceInvitePanel } from './WorkspaceInvitePanel'
import { ConfirmAction } from './ConfirmAction'
import { SquadPage } from './TeamSquad'
import { TeamStaffEditor } from './TeamStaffEditor'

export type TeamSection = 'overview' | 'profile' | 'players' | 'invitations' | 'tournaments' | 'applications' | 'rosters' | 'matches' | 'statistics' | 'finance' | 'documents' | 'notifications' | 'staff' | 'public' | 'settings'

// Everything a section needs; the workspace owns loading.
export type TeamCtx = {
  client: SupabaseClient; userId: string; teamId: string
  data: TeamWorkspaceData; access: TeamAccess; profile: TeamProfile; profileExtended: boolean
  matches: TeamMatch[]; matchesAvailable: boolean; invitations: SentInvitation[]
  tournaments: Map<string, TournamentCard>; openTournaments: TournamentCard[]
  open: (section: TeamSection) => void; reload: () => void; notice: (message: string) => void
}

const one = (value: unknown): Record<string, unknown> | null => Array.isArray(value) ? (value[0] as Record<string, unknown> | undefined) ?? null : value && typeof value === 'object' ? value as Record<string, unknown> : null
const NOW = () => new Date().toISOString()
const when = (iso: string | null) => iso ? formatMaldivesDateTime(iso) : 'Date to be confirmed'
const activeMembers = (ctx: TeamCtx) => ctx.data.playerHistory.filter(row => row.status === 'active' || row.status === 'loaned')
function Denied({ permission }: { permission: TeamPermission }) {
  return <Empty icon={<Lock size={22} />}>You need the “{PERMISSION_LABELS[permission]}” permission for this section. Ask the team owner or a manager.</Empty>
}
export { Denied }

export function TeamContextBanner({ ctx }: { ctx: TeamCtx }) {
  const slug = String(ctx.data.team?.slug ?? '')
  return <section className="team-context-banner" aria-label="Current team"><span className="team-context-mark">{ctx.profile.logoUrl ? <img src={ctx.profile.logoUrl} alt="" /> : <Shield size={36} aria-hidden="true" />}</span><div><strong>{ctx.profile.name}</strong><small>{[ctx.profile.sports.map(sportName).join(', '), ctx.profile.island].filter(Boolean).join(' · ') || 'Team Workspace'}</small></div>{ctx.profile.isPublished && slug ? <a className="ed-btn ed-btn-sm pw-glass-btn" href={`#team/${encodeURIComponent(slug)}`}><Eye size={15} aria-hidden="true" /> View public team</a> : null}</section>
}

// --- Header -----------------------------------------------------------------------------
export function TeamHeader({ ctx }: { ctx: TeamCtx }) {
  const p = ctx.profile
  const [busy, setBusy] = useState(false)
  const currentEntries = ctx.data.entries.filter(entry => entry.application_status === 'approved' && !['completed', 'archived'].includes(String(one(entry.tournaments)?.status ?? ctx.tournaments.get(String(entry.tournament_id))?.status ?? '')))
  const canPublish = ctx.access.can('publish_content') || ctx.access.can('edit_profile')
  const toggle = async () => {
    setBusy(true)
    const result = await setTeamPublished(ctx.client, ctx.teamId, !p.isPublished)
    setBusy(false)
    if (result.error) return ctx.notice(result.error)
    ctx.notice(p.isPublished ? 'Team page unpublished. History is kept; guests no longer see it.' : 'Team page published.'); ctx.reload()
  }
  const slug = String(ctx.data.team?.slug ?? '')
  return <header className="tw-header">
    <div className="tw-cover" style={p.coverUrl ? { backgroundImage: `url("${p.coverUrl}")` } : p.primaryColor ? { background: `linear-gradient(135deg, ${p.primaryColor}, ${p.secondaryColor || '#071a2b'})` } : undefined} />
    <div className="tw-header-body">
      <span className="tw-logo">{p.logoUrl ? <img src={p.logoUrl} alt={`${p.name} logo`} /> : <span>{p.name.slice(0, 2).toUpperCase()}</span>}</span>
      <div className="tw-header-text">
        <div className="pw-header-title"><h2>{p.name}</h2><Pill tone={p.isPublished ? 'ok' : 'muted'}>{p.isPublished ? <Eye size={12} /> : <EyeOff size={12} />} {p.isPublished ? 'Published' : 'Private'}</Pill>{p.isVerified ? <Pill tone="ok"><BadgeCheck size={12} /> Verified</Pill> : null}{p.archivedAt ? <Pill tone="bad">Archived</Pill> : null}</div>
        <p>{[TEAM_TYPE_LABELS[p.teamType] ?? p.teamType, p.sports.map(sportName).join(', ') || null, [p.island, p.atoll].filter(Boolean).join(', ') || null].filter(Boolean).join(' · ')}</p>
        <div className="tw-header-stats"><span><Users size={13} /> {activeMembers(ctx).length} active players</span><span><Trophy size={13} /> {currentEntries.length} current tournament{currentEntries.length === 1 ? '' : 's'}</span><span><Shield size={13} /> {STAFF_ROLE_LABELS[ctx.access.role as StaffRole] ?? ctx.access.role}{ctx.access.isOwner ? ' · Owner' : ''}</span></div>
      </div>
      <div className="tw-header-actions">
        {p.isPublished && slug ? <a className="ed-btn ed-btn-sm pw-glass-btn" href={`#team/${encodeURIComponent(slug)}`}><Eye size={14} /> Preview public page</a> : <button type="button" className="ed-btn ed-btn-sm pw-glass-btn" onClick={() => ctx.open('public')}><Eye size={14} /> Preview public page</button>}
        {ctx.access.can('edit_profile') && <button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={() => ctx.open('profile')}><Pencil size={14} /> Edit team</button>}
        {canPublish && <button type="button" className="ed-btn ed-btn-sm pw-glass-btn" disabled={busy || Boolean(p.archivedAt)} onClick={() => void toggle()}>{p.isPublished ? <EyeOff size={14} /> : <Globe2 size={14} />} {p.isPublished ? 'Unpublish' : 'Publish'}</button>}
        <button type="button" className="ed-btn ed-btn-sm pw-glass-btn" onClick={() => ctx.open('settings')}><Settings size={14} /> Settings</button>
      </div>
    </div>
  </header>
}

// --- Overview --------------------------------------------------------------------------
export function TeamOverview({ ctx, unread, financeBalance, documentIssues }: { ctx: TeamCtx; unread: number; financeBalance: string | null; documentIssues: number }) {
  const groups = groupFixtures(ctx.matches, NOW())
  const next = groups.live[0] ?? groups.upcoming[0] ?? null
  const recent = groups.completed.filter(match => match.resultConfirmed).slice(0, 5)
  const pendingRequests = ctx.data.teamRequests.filter(row => row.status === 'pending')
  const pendingInvites = ctx.invitations.filter(item => item.status === 'pending')
  const entries = ctx.data.entries
  const activeEntries = entries.filter(entry => entry.application_status === 'approved' && !['completed', 'archived'].includes(ctx.tournaments.get(String(entry.tournament_id))?.status ?? ''))
  const rosterAction = entries.filter(entry => entry.application_status === 'approved' && ['not_started', 'draft', 'changes_requested', 'rejected'].includes(String(entry.roster_status)))
  const name = (entry: Record<string, unknown>) => String(one(entry.tournaments)?.name ?? ctx.tournaments.get(String(entry.tournament_id))?.name ?? 'Tournament')
  const profileMissing = [!ctx.profile.logoUrl && 'logo', !ctx.profile.island && 'island', !ctx.profile.description && 'description', ctx.profileExtended && !ctx.profile.sports.length && 'sport'].filter(Boolean) as string[]
  const soon = next && next.scheduledAt && Date.parse(next.scheduledAt) - Date.now() < 7 * 86400000 ? next : null

  // One highest-priority task, in the order of the specification.
  const draft = entries.find(entry => ['draft', 'changes_requested'].includes(String(entry.application_status)))
  const unpaid = entries.find(entry => ['unpaid', 'overdue'].includes(String(entry.payment_status)) && entry.application_status !== 'withdrawn')
  const notStarted = entries.find(entry => entry.application_status === 'approved' && ['not_started', 'draft'].includes(String(entry.roster_status)))
  const rejected = entries.find(entry => ['changes_requested', 'rejected'].includes(String(entry.roster_status)))
  const action = profileMissing.length && ctx.access.can('edit_profile') ? { label: 'Complete the team profile', hint: `Missing: ${profileMissing.join(', ')}.`, text: 'Edit profile', to: 'profile' as TeamSection }
    : pendingRequests.length ? { label: `Review ${pendingRequests.length} player join request${pendingRequests.length === 1 ? '' : 's'}`, hint: 'Approve, reject or ask for more information.', text: 'Review requests', to: 'invitations' as TeamSection }
    : draft ? { label: `Complete the application for ${name(draft)}`, hint: draft.review_notes ? `Organizer note: ${String(draft.review_notes)}` : 'The application is not submitted yet.', text: 'Open application', to: 'applications' as TeamSection }
    : unpaid ? { label: `Upload payment proof for ${name(unpaid)}`, hint: 'The organizer is waiting for the registration fee.', text: 'Open application', to: 'applications' as TeamSection }
    : notStarted ? { label: `Submit the roster for ${name(notStarted)}`, hint: 'The application is approved; the roster is not submitted yet.', text: 'Build roster', to: 'rosters' as TeamSection }
    : rejected ? { label: `The roster for ${name(rejected)} needs corrections`, hint: 'Review the organizer’s notes and resubmit.', text: 'Review roster', to: 'rosters' as TeamSection }
    : soon ? { label: `Upcoming: vs ${soon.opponentName}`, hint: `${when(soon.scheduledAt)} · ${soon.venue ?? 'venue to be confirmed'}`, text: 'View fixture', to: 'matches' as TeamSection }
    : documentIssues ? { label: 'Resolve a document issue', hint: `${documentIssues} team document${documentIssues === 1 ? ' needs' : 's need'} changes.`, text: 'Open documents', to: 'documents' as TeamSection }
    : null

  const TOP_CARDS = ['Active players', 'Active entries', 'Upcoming matches', 'Rosters needing action']
  const cards: Array<{ label: string; value: ReactNode; to: TeamSection; icon: ReactNode }> = [
    { label: 'Active players', value: activeMembers(ctx).length, to: 'players', icon: <Users size={16} /> },
    { label: 'Pending invitations', value: pendingInvites.length + pendingRequests.length, to: 'invitations', icon: <UserPlus size={16} /> },
    { label: 'Active entries', value: activeEntries.length, to: 'tournaments', icon: <Trophy size={16} /> },
    { label: 'Rosters needing action', value: rosterAction.length, to: 'rosters', icon: <ClipboardList size={16} /> },
    { label: 'Upcoming matches', value: ctx.matchesAvailable || ctx.matches.length ? groups.upcoming.length + groups.live.length : '—', to: 'matches', icon: <CalendarClock size={16} /> },
    { label: 'Unread notifications', value: unread, to: 'notifications', icon: <ShieldCheck size={16} /> },
    ...(financeBalance !== null ? [{ label: 'Finance balance', value: financeBalance, to: 'finance' as TeamSection, icon: <Medal size={16} /> }] : []),
  ]
  return <div className="pw-page team-overview" role="tabpanel">
    {/* Keep the next action first for reading order; the reference layout places
        four summary cards above it and secondary counts below the dashboard. */}
    {action ? <section className="pw-next tw-next"><div><p className="pf-eyebrow">Next action</p><h2>{action.label}</h2><p>{action.hint}</p></div><button type="button" className="ed-btn ed-btn-primary" onClick={() => ctx.open(action.to)}>{action.text} <ArrowRight size={16} /></button></section>
      : <section className="pw-next calm tw-next"><div><p className="pf-eyebrow">All set</p><h2>Nothing needs your attention</h2><p>Applications, rosters and fixtures are up to date.</p></div></section>}
    <div className="pw-rail tw-rail">{cards.filter(card => TOP_CARDS.includes(card.label)).sort((a, b) => TOP_CARDS.indexOf(a.label) - TOP_CARDS.indexOf(b.label)).map(card => <button type="button" key={card.label} className="pw-stat" onClick={() => ctx.open(card.to)}><span className="pw-stat-icon">{card.icon}</span><b>{card.value}</b><small>{card.label}</small></button>)}</div>
    <p className="summary-more">{cards.filter(card => !TOP_CARDS.includes(card.label)).map(card => <button type="button" key={card.label} className="ed-link-btn" onClick={() => ctx.open(card.to)}><b>{card.value}</b> {card.label.toLowerCase()}</button>)}</p>
    <div className="team-overview-main">
      <Card icon={<CalendarClock size={18} />} title="Next match" action={next ? <button type="button" className="ed-link-btn" onClick={() => ctx.open('matches')}>Fixtures <ArrowRight size={13} /></button> : undefined}>
        {next ? <div className="pw-nextmatch"><div className="team-overview-fixture"><span><Crest name={ctx.profile.name} logoUrl={ctx.profile.logoUrl} size="md" /><strong>{ctx.profile.name}</strong></span><b>vs</b><span><Crest name={next.opponentName} logoUrl={next.opponentLogo} size="md" /><strong>{next.opponentName}</strong></span></div><ul className="pw-facts"><li><CalendarDays size={14} /> {when(next.scheduledAt)} <em>Maldives time</em></li>{next.venue && <li><MapPin size={14} /> {next.venue}</li>}<li><Trophy size={14} /> {next.tournamentName}{next.stage ? ` · ${next.stage}` : ''}</li></ul></div>
          : <Empty icon={<CalendarDays size={20} />}>{ctx.matchesAvailable ? 'No upcoming fixture is scheduled.' : 'Fixture details with opponents appear once migration 031 is applied.'}</Empty>}
      </Card>
      <Card icon={<History size={18} />} title="Recent results" sub="Confirmed results only" action={<button type="button" className="ed-link-btn" onClick={() => ctx.open('statistics')}>Statistics <ArrowRight size={13} /></button>}>
        {recent.length ? <ul className="pw-form-list">{recent.map(match => { const outcome = teamOutcome(match); return <li key={match.id}><span className={`pw-outcome o-${outcome ?? 'n'}`}>{outcome ?? '–'}</span><span className="pw-form-main"><strong>vs {match.opponentName}</strong><small>{formatDay(match.scheduledAt) ?? ''} · {match.tournamentName}</small></span><b className="pw-score">{match.teamScore}–{match.opponentScore}</b></li> })}</ul>
          : <Empty icon={<History size={20} />}>No confirmed results yet.</Empty>}
      </Card>
      <Card icon={<UserPlus size={18} />} title="Player requests" action={<button type="button" className="ed-link-btn" onClick={() => ctx.open('invitations')}>Open <ArrowRight size={13} /></button>}>
        {pendingRequests.length || pendingInvites.length ? <ul className="pw-mini-list">
          {pendingRequests.slice(0, 3).map(row => <li key={String(row.id)}><span><strong>{String(one(row.player_profiles)?.display_name ?? 'A player')}</strong><small>Wants to join · {formatDay(row.created_at)}</small></span><Pill tone="warn">Join request</Pill></li>)}
          {pendingInvites.slice(0, 3).map(item => <li key={item.id}><span><strong>{item.playerName}</strong><small>Invited {formatDay(item.createdAt)}</small></span><Pill tone="info">Invitation</Pill></li>)}
        </ul> : <Empty>No pending invitations or join requests.</Empty>}
      </Card>
      <Card icon={<ShieldCheck size={18} />} title="Notifications" action={<button type="button" className="ed-link-btn" onClick={() => ctx.open('notifications')}>All <ArrowRight size={13} /></button>}>
        {ctx.data.notifications.length ? <ul className="pw-notice-mini">{ctx.data.notifications.slice(0, 3).map(row => <li key={String(row.id)} className={row.read_at == null && row.state !== 'read' ? 'unread' : ''}><strong>{String(row.title ?? 'Notice')}</strong><small>{formatDay(row.created_at)}</small></li>)}</ul> : <Empty>No notifications yet.</Empty>}
      </Card>
    </div>
    <aside className="team-overview-aside">
      <Card icon={<ArrowRight size={18} />} title="Quick actions" className="team-quick-actions">
        {ctx.access.can('manage_players') || ctx.access.can('send_invitations') ? <button type="button" className="ed-btn ed-btn-ghost" onClick={() => ctx.open('players')}><UserPlus size={17} /> Manage squad</button> : null}
        <button type="button" className="ed-btn ed-btn-ghost" onClick={() => ctx.open('tournaments')}><Trophy size={17} /> Browse tournaments</button>
        {ctx.access.can('manage_staff') ? <button type="button" className="ed-btn ed-btn-ghost" onClick={() => ctx.open('staff')}><Users size={17} /> Manage staff</button> : null}
      </Card>
      <Card icon={<Trophy size={18} />} title="Current tournament entries" action={<button type="button" className="ed-link-btn" onClick={() => ctx.open('tournaments')}>All <ArrowRight size={13} /></button>}>
        {entries.length ? <ul className="pw-mini-list">{entries.slice(0, 4).map(entry => <li key={String(entry.id)}><span><strong>{name(entry)}</strong><small>Roster {ROSTER_STATUS_LABELS[String(entry.roster_status)] ?? String(entry.roster_status)}</small></span><Pill tone={statusTone(String(entry.application_status))}>{APPLICATION_STATUS_LABELS[String(entry.application_status)] ?? String(entry.application_status)}</Pill></li>)}</ul>
          : <Empty icon={<Trophy size={20} />}>No tournament entries yet. Find a tournament with open registration in Tournaments.</Empty>}
      </Card>
      {ctx.access.can('manage_finance') ? <Card icon={<Medal size={18} />} title="Team finance" sub="Track income, expenses and receipts.">
        {financeBalance !== null ? <p className="team-finance-balance">{financeBalance}<small>Current balance</small></p> : null}
        <button type="button" className="ed-btn ed-btn-ghost pp-block" onClick={() => ctx.open('finance')}>Open finance <ArrowRight size={16} /></button>
      </Card> : null}
    </aside>
  </div>
}

// --- Team profile ----------------------------------------------------------------------
export function TeamProfileSection({ ctx }: { ctx: TeamCtx }) {
  const [form, setForm] = useState<TeamProfile>(ctx.profile)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [imageBusy, setImageBusy] = useState<'logo' | 'cover' | null>(null)
  const logoRef = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  if (!ctx.access.can('edit_profile')) return <Denied permission="edit_profile" />
  const set = (patch: Partial<TeamProfile>) => setForm(current => ({ ...current, ...patch }))
  const save = async () => {
    setBusy(true); setMessage(null)
    const result = await saveTeamProfile(ctx.client, ctx.teamId, form, ctx.profileExtended)
    setBusy(false)
    if (result.error) return setMessage({ tone: 'error', text: result.error })
    setMessage({ tone: 'ok', text: 'Team profile saved.' }); ctx.reload()
  }
  const image = async (kind: 'logo' | 'cover', event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    setImageBusy(kind); setMessage(null)
    const result = await uploadTeamImage(ctx.client, ctx.teamId, kind, file, kind === 'logo' ? form.logoPath : form.coverPath, ctx.profileExtended)
    setImageBusy(null)
    if (result.error) return setMessage({ tone: 'error', text: result.error })
    set(kind === 'logo' ? { logoUrl: result.url } : { coverUrl: result.url }); ctx.reload()
  }
  const ext = ctx.profileExtended
  return <div className="pw-page" role="tabpanel">
    {!ext && <Pending>Atoll, sports, colours, venue, social links, public contact and the cover image need migration 031. Name, type, island, description and logo can be edited now.</Pending>}
    <div className="pw-two">
      <div className="pw-stack">
        <Card icon={<ImageUp size={18} />} title="Logo and cover" sub="Uploaded files only">
          <div className="tw-images">
            <button type="button" className="tw-cover-drop" style={form.coverUrl ? { backgroundImage: `url("${form.coverUrl}")` } : undefined} disabled={!ext || imageBusy !== null} onClick={() => coverRef.current?.click()}><span>{imageBusy === 'cover' ? 'Uploading…' : form.coverUrl ? 'Change cover' : 'Upload cover'}</span><small>Wide image · up to 5 MB</small></button>
            <button type="button" className="tw-logo-drop" disabled={imageBusy !== null} onClick={() => logoRef.current?.click()}>{form.logoUrl ? <img src={form.logoUrl} alt="Team logo" /> : <ImageUp size={22} />}<small>{imageBusy === 'logo' ? 'Uploading…' : form.logoUrl ? 'Change logo' : 'Upload logo'}</small></button>
          </div>
          <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Logo file" onChange={event => void image('logo', event)} />
          <input ref={coverRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Cover file" onChange={event => void image('cover', event)} />
        </Card>
        <Card icon={<Pencil size={18} />} title="Team details">
          <div className="pf-fields">
            <label className="pf-field">Team name<input value={form.name} maxLength={120} onChange={event => set({ name: event.target.value })} /></label>
            <label className="pf-field">Team type<select value={form.teamType} onChange={event => set({ teamType: event.target.value })}>{TEAM_TYPE_OPTIONS.filter(value => ext || ['club', 'island', 'national', 'school', 'other'].includes(value)).map(value => <option key={value} value={value}>{TEAM_TYPE_LABELS[value]}</option>)}</select></label>
            <label className="pf-field">Atoll<input value={form.atoll} list="kv-atolls" disabled={!ext} onChange={event => set({ atoll: event.target.value })} placeholder="e.g. Shaviyani" /></label>
            <label className="pf-field">Island<input value={form.island} list="kv-islands" onChange={event => set({ island: event.target.value })} placeholder="e.g. Kanditheemu" /></label>
            <label className="pf-field">Established<input inputMode="numeric" maxLength={4} value={form.establishedYear} disabled={!ext} onChange={event => set({ establishedYear: event.target.value.replace(/\D/g, '') })} placeholder="e.g. 2012" /></label>
            <label className="pf-field">Home venue<input value={form.homeVenue} list="kv-venues" disabled={!ext} onChange={event => set({ homeVenue: event.target.value })} placeholder="e.g. Kanditheemu Stadium" /></label>
            <fieldset className="pf-wide pf-chip-group"><legend>Sports (first is primary)</legend>{Object.entries(SPORT_NAMES).map(([key, label]) => { const on = form.sports.includes(key); return <label key={key} className={`pf-toggle${on ? ' on' : ''}`}><input type="checkbox" disabled={!ext} checked={on} onChange={() => set({ sports: on ? form.sports.filter(item => item !== key) : [...form.sports, key] })} />{on && <Check size={13} />} {label}{on && form.sports[0] === key ? ' · primary' : ''}</label> })}</fieldset>
            <label className="pf-field pf-wide">Public description<textarea rows={4} maxLength={600} value={form.description} onChange={event => set({ description: event.target.value })} /><small className="pf-counter">{form.description.length}/600</small></label>
          </div>
        </Card>
        <Card icon={<Palette size={18} />} title="Colours and links">
          <div className="pf-fields">
            {(['primaryColor', 'secondaryColor'] as const).map(key => <label key={key} className="pf-field">{key === 'primaryColor' ? 'Primary colour' : 'Secondary colour'}<span className="tw-color"><input type="color" disabled={!ext} value={form[key] || '#00c2dc'} onChange={event => set({ [key]: event.target.value } as Partial<TeamProfile>)} /><input value={form[key]} disabled={!ext} maxLength={7} placeholder="#00C2DC" onChange={event => set({ [key]: event.target.value } as Partial<TeamProfile>)} /></span></label>)}
            {TEAM_SOCIAL.map(item => <label key={item.key} className="pf-field">{item.label}<input value={form.socialLinks[item.key] ?? ''} disabled={!ext} placeholder="https://" onChange={event => set({ socialLinks: { ...form.socialLinks, [item.key]: event.target.value } })} /></label>)}
            <label className="pf-field pf-wide">Public contact (shown only if enabled)<input value={form.publicContact} disabled={!ext} onChange={event => set({ publicContact: event.target.value })} placeholder="e.g. team@example.mv or 7xx xxxx" /></label>
            <label className="publication-confirm pf-wide"><input type="checkbox" disabled={!ext} checked={form.showPublicContact} onChange={event => set({ showPublicContact: event.target.checked })} /> Show this contact on the public team page</label>
          </div>
        </Card>
        {message && <p className={message.tone === 'ok' ? 'publication-notice' : 'form-error'} role={message.tone === 'ok' ? 'status' : 'alert'}>{message.text}</p>}
        <div className="pw-actions"><button type="button" className="ed-btn ed-btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save team profile'}</button><button type="button" className="ed-btn ed-btn-ghost" onClick={() => ctx.open('public')}><Eye size={14} /> Review what guests see</button></div>
      </div>
      <PrivateDetailsCard ctx={ctx} />
    </div>
  </div>
}

function PrivateDetailsCard({ ctx }: { ctx: TeamCtx }) {
  const [details, setDetails] = useState<TeamPrivateDetails | null>(null)
  const [available, setAvailable] = useState(true)
  const [message, setMessage] = useState('')
  useEffect(() => { let active = true; void loadTeamPrivateDetails(ctx.client, ctx.teamId).then(result => { if (active) { setDetails(result.data); setAvailable(result.available) } }); return () => { active = false } }, [ctx.client, ctx.teamId])
  const save = async () => { if (!details) return; const result = await saveTeamPrivateDetails(ctx.client, ctx.teamId, ctx.userId, details); setMessage(result.error ?? 'Private details saved.') }
  return <Card icon={<Lock size={18} />} title="Private information" sub="Never shown publicly" className="pw-sticky">
    {!available ? <Pending>Private team details need migration 031.</Pending> : details && <>
      <label className="pf-field">Manager legal name<input value={details.managerLegalName} onChange={event => setDetails({ ...details, managerLegalName: event.target.value })} /></label>
      <label className="pf-field">Manager phone<input value={details.managerPhone} inputMode="tel" onChange={event => setDetails({ ...details, managerPhone: event.target.value })} /></label>
      <label className="pf-field">Internal email<input value={details.internalEmail} inputMode="email" onChange={event => setDetails({ ...details, internalEmail: event.target.value })} /></label>
      <label className="pf-field">Private notes<textarea rows={3} maxLength={2000} value={details.privateNotes} onChange={event => setDetails({ ...details, privateNotes: event.target.value })} /></label>
      {message && <p className={message.includes('saved') ? 'publication-notice' : 'form-error'} role="status">{message}</p>}
      <button type="button" className="ed-btn ed-btn-primary pf-block" onClick={() => void save()}>Save private details</button>
    </>}
    <p className="pf-hint"><Fingerprint size={13} /> Manager national ID: verify it on your own player profile (My Profile → Basic details). It is stored only as a protected code. Payment information and documents are in Finance and Documents.</p>
  </Card>
}

// --- Players ---------------------------------------------------------------------------
// Squad (owner design, 2026-11-04): table, Add Player in three steps, invitations and
// Edit Player Membership live in TeamSquad.tsx. "Create new player" stays here.
export function TeamPlayersSection({ ctx }: { ctx: TeamCtx }) {
  return <SquadPage ctx={ctx} createRecord={onDone => <AddUnclaimedPlayer ctx={ctx} onDone={onDone} />} />
}

function AddUnclaimedPlayer({ ctx, onDone }: { ctx: TeamCtx; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', island: '', position: '', jerseyNumber: '', idType: 'maldivian_national_id' as IdentityInput['identifierType'], idValue: '', documentType: 'passport', country: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    setBusy(true); setError('')
    const identity: IdentityInput | null = form.idValue.trim() ? { identifierType: form.idType, value: form.idValue, documentType: form.documentType, issuingCountry: form.country } : null
    const result = await addUnclaimedPlayer(ctx.client, { userId: ctx.userId, teamId: ctx.teamId, name: form.name, island: form.island, position: form.position, jerseyNumber: form.jerseyNumber, identity })
    setBusy(false); setForm(current => ({ ...current, idValue: '' }))
    if (result.error) return setError(result.error)
    ctx.notice(`${form.name.trim()} was added as an unclaimed player. Send them a claim invitation later so they can take over the profile; their history stays.`); ctx.reload(); onDone()
  }
  return <Card icon={<UserPlus size={18} />} title="Create new player" sub="Only when the player has no profile yet" className="tw-panel">
    <div className="pf-fields">
      <label className="pf-field">Name<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
      <label className="pf-field">Island<input value={form.island} list="kv-islands" onChange={event => setForm({ ...form, island: event.target.value })} /></label>
      <label className="pf-field">Position<input value={form.position} onChange={event => setForm({ ...form, position: event.target.value })} /></label>
      <label className="pf-field">Jersey number<input inputMode="numeric" maxLength={2} value={form.jerseyNumber} onChange={event => setForm({ ...form, jerseyNumber: event.target.value.replace(/\D/g, '') })} /></label>
    </div>
    <div className="pf-idfield">
      <div className="pf-idfield-head"><strong><Fingerprint size={15} /> National ID (recommended)</strong><span className="pw-pill tone-muted"><Lock size={11} /> Private</span></div>
      <div className="pf-fields">
        <label className="pf-field">Document<select value={form.idType} onChange={event => setForm({ ...form, idType: event.target.value as IdentityInput['identifierType'] })}><option value="maldivian_national_id">Maldivian ID card</option><option value="foreign_document">Foreign document</option></select></label>
        <label className="pf-field">Number<input value={form.idValue} autoComplete="off" spellCheck={false} onChange={event => setForm({ ...form, idValue: event.target.value })} placeholder={form.idType === 'maldivian_national_id' ? 'A123456' : 'Document number'} /></label>
        {form.idType === 'foreign_document' && <><label className="pf-field">Document type<select value={form.documentType} onChange={event => setForm({ ...form, documentType: event.target.value })}><option value="passport">Passport</option><option value="national_id">National ID</option><option value="other">Other</option></select></label><label className="pf-field">Issuing country<input maxLength={2} value={form.country} onChange={event => setForm({ ...form, country: event.target.value.toUpperCase() })} /></label></>}
      </div>
      <p className="pf-hint"><ShieldCheck size={12} /> Checked on the server against every profile. If this ID already exists, nothing is created and you are asked to invite that player instead. The number is never stored.</p>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer className="pf-card-foot"><button type="button" className="ed-btn ed-btn-ghost" onClick={onDone}>Cancel</button><button type="button" className="ed-btn ed-btn-primary" disabled={busy || form.name.trim().length < 2} onClick={() => void submit()}>{busy ? 'Checking…' : 'Add player'}</button></footer>
  </Card>
}

// --- Invitations and requests ---------------------------------------------------------------
export function TeamInvitationsSection({ ctx }: { ctx: TeamCtx }) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const canInvite = ctx.access.can('send_invitations')
  const canManage = ctx.access.can('manage_players')
  const revoke = async (item: SentInvitation) => { setBusy(item.id); const result = await revokeInvitation(ctx.client, item.id); setBusy(null); if (result.error) return setError(result.error); ctx.notice('Invitation revoked.'); ctx.reload() }
  const decide = async (row: Record<string, unknown>, decision: 'approved' | 'rejected' | 'info_requested') => {
    const id = String(row.id); setBusy(id); setError('')
    const result = await resolveJoinRequest(ctx.client, { requestId: id, playerId: String(row.player_id), teamId: ctx.teamId, userId: ctx.userId, decision, note: notes[id] ?? '' })
    setBusy(null)
    if (result.error) return setError(result.error)
    ctx.notice(decision === 'approved' ? 'Player approved; a dated membership was added.' : decision === 'rejected' ? 'Request rejected.' : 'Asked the player for more information.'); ctx.reload()
  }
  const requests = ctx.data.teamRequests
  return <div className="pw-page" role="tabpanel">
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="pw-two">
      <div className="pw-stack">
        <Card icon={<UserPlus size={18} />} title="Join requests" sub={`${requests.filter(row => row.status === 'pending').length} waiting`}>
          {requests.length ? <ul className="pw-requests">{requests.map(row => { const id = String(row.id); const player = one(row.player_profiles); return <li key={id}>
            <div className="pw-request-head"><span className="pw-request-type">Join request · {formatDay(row.created_at)}</span><Pill tone={statusTone(String(row.status))}>{({ pending: 'Pending', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn', info_requested: 'More info requested' } as Record<string, string>)[String(row.status)] ?? String(row.status)}</Pill></div>
            <strong>{String(player?.display_name ?? 'A player')}{player?.slug ? <a className="ed-link tw-inline-link" href={`#player/${encodeURIComponent(String(player.slug))}`}>profile <ArrowRight size={11} /></a> : null}</strong>
            {row.message ? <p className="pw-request-message">“{String(row.message)}”</p> : null}
            {row.resolution_note ? <p className="pw-note-box">{String(row.resolution_note)}</p> : null}
            {canManage && ['pending', 'info_requested'].includes(String(row.status)) && <div className="pw-inline-form">
              <label className="pf-field">Note to the player<input value={notes[id] ?? ''} onChange={event => setNotes({ ...notes, [id]: event.target.value })} placeholder="Required to reject or ask for information" /></label>
              <div className="pw-actions"><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" disabled={busy === id} onClick={() => void decide(row, 'approved')}><Check size={13} /> Approve</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={busy === id} onClick={() => void decide(row, 'info_requested')}>Request more information</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" disabled={busy === id} onClick={() => void decide(row, 'rejected')}><X size={13} /> Reject</button></div>
            </div>}
          </li> })}</ul> : <Empty>No join requests yet.</Empty>}
        </Card>
        <Card icon={<Medal size={18} />} title="Sent invitations">
          {ctx.invitations.length ? <ul className="pw-requests">{ctx.invitations.map(item => <li key={item.id}>
            <div className="pw-request-head"><span className="pw-request-type">Sent {formatDay(item.createdAt)}{item.expiresAt ? ` · expires ${formatDay(item.expiresAt)}` : ''}</span><Pill tone={statusTone(item.status === 'withdrawn' ? 'withdrawn' : item.status)}>{INVITATION_STATUS_LABELS[item.status] ?? item.status}</Pill></div>
            <strong>{item.playerName}</strong>
            <small className="pf-hint">{[item.sport ? sportName(item.sport) : null, item.position, item.jerseyNumber !== null ? `#${item.jerseyNumber}` : null].filter(Boolean).join(' · ') || 'No position set'}</small>
            {item.responseNote && <p className="pw-note-box">{item.responseNote}</p>}
            {canInvite && item.status === 'pending' && <div className="pw-actions"><ConfirmAction className="ed-btn ed-btn-ghost ed-btn-sm" disabled={busy === item.id} label="Revoke invitation" question="Revoke this invitation? The link stops working." confirmLabel="Revoke" onConfirm={async () => { await revoke(item) }} /></div>}
          </li>)}</ul> : <Empty>No invitations sent yet.</Empty>}
        </Card>
      </div>
      <div className="pw-stack">
        {canInvite ? <div className="tw-panel"><InvitePlayerPanel client={ctx.client} userId={ctx.userId} teamId={ctx.teamId} onNotice={message => { ctx.notice(message); ctx.reload() }} /></div> : <Denied permission="send_invitations" />}
        <PlayerRequestsReview client={ctx.client} scope={{ kind: 'team', id: ctx.teamId }} title="Player correction requests" />
        <p className="pf-hint"><Lock size={13} /> Claim tokens are stored as digests and expire. A verified email is required to claim, and one account can never claim two copies of the same player.</p>
      </div>
    </div>
  </div>
}

// --- Staff & permissions ----------------------------------------------------------------------
export function TeamStaffSection({ ctx }: { ctx: TeamCtx }) {
  const [saving, setSaving] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ role: StaffRole; permissions: TeamPermission[] }>({ role: 'staff', permissions: [] })
  const [reloadKey, setReloadKey] = useState(0)
  const canManage = ctx.access.can('manage_staff')
  useEffect(() => {
    let active = true
    void loadTeamStaff(ctx.client, ctx.teamId).then(result => { if (active) { setStaff(result.data); setError(result.error ?? '') } })
    if (canManage) void loadTeamAudit(ctx.client, ctx.teamId).then(result => { if (active) setAudit(result.data) })
    return () => { active = false }
  }, [ctx.client, ctx.teamId, canManage, reloadKey])
  const save = async (member: StaffMember) => {
    setError(''); setSaving(true)
    const result = await setTeamStaff(ctx.client, ctx.teamId, member.userId, draft.role, draft.permissions)
    setSaving(false)
    if (result.error) return setError(result.error)
    setEditing(null); ctx.notice('Permissions updated. They apply immediately.'); setReloadKey(value => value + 1)
  }
  const remove = async (member: StaffMember) => {
    setError('')
    const result = await removeTeamStaff(ctx.client, ctx.teamId, member.userId)
    if (result.error) return setError(result.error)
    ctx.notice(`${member.name} was removed. Their access ended immediately.`); setReloadKey(value => value + 1)
  }
  const editingMember = staff.find(member => member.userId === editing && !member.isOwner)
  if (canManage && editingMember) return <TeamStaffEditor ctx={ctx} member={editingMember} draft={draft} busy={saving} error={error} onChange={setDraft} onSave={() => void save(editingMember)} onBack={() => { setEditing(null); setError('') }} />
  if (inviting && (ctx.access.role === 'manager' || ctx.access.isOwner)) return <div className="sq-page sq-flow"><button type="button" className="back-link" onClick={() => setInviting(false)}>← Back to staff</button><header><h1 className="sq-flow-title">Invite team staff</h1><p className="sq-lede">Invite someone to help manage {ctx.profile.name}.</p></header><div className="sq-two"><WorkspaceInvitePanel client={ctx.client} workspaceType="team" workspaceId={ctx.teamId} onNotice={ctx.notice} /><aside className="sq-col"><Card icon={<ShieldCheck size={20} />} title="Invitation access"><p>Invitations grant the selected role within {ctx.profile.name}. They never transfer ownership.</p><p>Review and adjust the person’s permissions in Staff after they join.</p></Card><Card icon={<Lock size={20} />} title="After creating the invitation"><p>A one-time token is shown. Send it privately to the intended recipient; the app does not send an email.</p></Card></aside></div></div>
  return <div className="pw-page" role="tabpanel">
    {ctx.access.role === 'manager' || ctx.access.isOwner ? <div className="pp-head-action"><button type="button" className="ed-btn ed-btn-primary" onClick={() => setInviting(true)}><UserPlus size={17} aria-hidden="true" /> Invite staff</button></div> : null}
    {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
    <div className="pw-two">
      <Card icon={<Shield size={18} />} title="Team staff" sub={`${staff.length} member${staff.length === 1 ? '' : 's'}`}>
        {staff.length ? <ul className="tw-staff">{staff.map(member => <li key={member.userId}>
          <div className="tw-staff-head"><span className="ed-avatar">{member.name.slice(0, 2).toUpperCase()}</span><div><strong>{member.name}{member.isSelf ? ' (you)' : ''}</strong><small>{member.isOwner ? 'Owner · full authority' : STAFF_ROLE_LABELS[member.role as StaffRole] ?? member.role} · since {formatDay(member.joinedAt) ?? '—'}</small></div>{member.isOwner ? <Pill tone="ok"><Crown size={11} /> Owner</Pill> : null}</div>
          <div className="pw-chips">{(member.isOwner ? [...TEAM_PERMISSIONS] : member.permissions).map(permission => <span key={permission} className="pw-chip">{PERMISSION_LABELS[permission]}</span>)}</div>
          {canManage && !member.isOwner && editing !== member.userId && <div className="pw-actions"><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => { setEditing(member.userId); setDraft({ role: (STAFF_ROLES as readonly string[]).includes(member.role) ? member.role as StaffRole : 'staff', permissions: member.permissions }) }}><Pencil size={13} /> Change role</button>{!member.isSelf && <ConfirmAction className="ed-btn ed-btn-ghost ed-btn-sm" label="Remove member" question="Remove this person from the team’s managers? They lose access immediately." onConfirm={async () => { await remove(member) }} icon={<UserMinus size={13} aria-hidden="true" />} />}</div>}

        </li>)}</ul> : <Empty icon={<Shield size={22} />}>{error ? 'Staff list unavailable.' : 'Loading staff…'}</Empty>}
      </Card>
      <div className="pw-stack">
        <Card icon={<ShieldCheck size={18} />} title="Permission groups"><p>Manage squad, tournament entries, matches, finance, documents and staff access separately.</p><p className="pf-hint">Only a team manager can invite new staff. Existing access can be changed by staff with permission.</p></Card>
        <p className="pf-hint"><ShieldCheck size={13} /> New staff join as manager or team staff; adjust their role and permissions here afterwards.</p>
        {canManage && <Card icon={<History size={18} />} title="Audit log" sub="Permission, membership and finance changes">
          {audit.length ? <ul className="tw-audit">{audit.slice(0, 30).map((row, index) => <li key={index}><strong>{AUDIT_LABELS[row.action] ?? row.action.replace(/_/g, ' ')}</strong><small>{row.actor} · {formatMaldivesDateTime(row.createdAt)}</small>{row.reason ? <span>{row.reason}</span> : null}</li>)}</ul> : <p className="pf-hint">No audited changes yet.</p>}
        </Card>}
      </div>
    </div>
  </div>
}

// --- Public page preview ---------------------------------------------------------------------
export function TeamPublicSection({ ctx }: { ctx: TeamCtx }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const p = ctx.profile
  const slug = String(ctx.data.team?.slug ?? '')
  const canPublish = ctx.access.can('publish_content') || ctx.access.can('edit_profile')
  const toggle = async () => {
    setBusy(true)
    const result = await setTeamPublished(ctx.client, ctx.teamId, !p.isPublished)
    setBusy(false); setConfirm(false)
    if (result.error) return ctx.notice(result.error)
    ctx.notice(p.isPublished ? 'Unpublished. The team is hidden from directories; its history is kept.' : 'Published. Guests can now open the team page.'); ctx.reload()
  }
  const shown: Array<[string, string]> = [
    ['Team name', p.name], ['Logo and cover', [p.logoUrl ? 'Logo' : null, p.coverUrl ? 'Cover' : null].filter(Boolean).join(' and ') || 'None uploaded'], ['Team type', TEAM_TYPE_LABELS[p.teamType] ?? p.teamType],
    ['Sport', p.sports.map(sportName).join(', ') || 'Not set'], ['Island / atoll', [p.island, p.atoll].filter(Boolean).join(', ') || 'Not set'], ['Description', p.description ? 'Shown' : 'Empty'],
    ['Roster', `${activeMembers(ctx).filter(row => one(row.player_profiles)?.is_published === true).length} published players`], ['Tournaments, fixtures and results', 'Published and confirmed only'],
    ['Standings, statistics and trophies', 'Official records only'], ['Public contact', p.showPublicContact && p.publicContact ? p.publicContact : 'Hidden'],
  ]
  const hidden = ['Manager national ID', 'Email and private phone', 'Payment records and receipts', 'Player documents', 'Internal notes', 'Account IDs', 'Invitations and claim tokens', 'Application review discussions', 'Unpublished players']
  return <div className="pw-page" role="tabpanel">
    <div className="tw-preview" style={p.coverUrl ? { backgroundImage: `linear-gradient(180deg, rgba(7,26,43,.15), rgba(7,26,43,.85)), url("${p.coverUrl}")` } : undefined}>
      <span className="tw-logo">{p.logoUrl ? <img src={p.logoUrl} alt="" /> : <span>{p.name.slice(0, 2).toUpperCase()}</span>}</span>
      <div><p className="pf-eyebrow">Guest view</p><h2>{p.name}</h2><p>{[TEAM_TYPE_LABELS[p.teamType], p.sports.map(sportName).join(', ') || null, p.island || null].filter(Boolean).join(' · ')}</p>{p.description && <p className="tw-preview-desc">{p.description}</p>}</div>
    </div>
    <div className="pw-two">
      <div className="pw-stack">
        <Card icon={<Eye size={18} />} title="What guests can see" action={p.isPublished && slug ? <a className="ed-link" href={`#team/${encodeURIComponent(slug)}`}>Open public page <ArrowRight size={13} /></a> : undefined}>
          <ul className="pw-public-list">{shown.map(([label, value]) => <li key={label}><Eye size={14} /><span>{label}</span><small>{value}</small></li>)}</ul>
        </Card>
        <Card icon={<Lock size={18} />} title="Always private"><ul className="pw-private-list">{hidden.map(item => <li key={item}><Lock size={13} /> {item}</li>)}</ul></Card>
      </div>
      <Card icon={<Globe2 size={18} />} title="Publication" sub={p.isPublished ? 'The team page is public' : 'The team page is private'} className={`pf-visibility pw-sticky${p.isPublished ? ' is-public' : ''}`}>
        <p className="publication-explain">Unpublishing hides the team from public directories. It never deletes fixtures, results, rosters or player history.</p>
        {p.archivedAt ? <p className="pw-pending">This team is archived. Restore it in Settings before publishing.</p> : !canPublish ? <p className="pf-hint">You need the Publish team content permission.</p> : <>
          {!p.isPublished && <label className="publication-confirm"><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} /> I reviewed what guests will see.</label>}
          <button type="button" className={`ed-btn pf-block ${p.isPublished ? 'ed-btn-ghost' : 'ed-btn-primary'}`} disabled={busy || (!p.isPublished && !confirm)} onClick={() => void toggle()}>{busy ? 'Please wait…' : p.isPublished ? 'Unpublish team page' : 'Publish team page'}</button>
        </>}
        <button type="button" className="ed-link-btn" onClick={() => ctx.open('profile')}>Choose the optional public contact in Team Profile</button>
      </Card>
    </div>
  </div>
}

// --- Settings ----------------------------------------------------------------------------------
export function TeamSettingsSection({ ctx, onLeft }: { ctx: TeamCtx; onLeft: () => void }) {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [newOwner, setNewOwner] = useState('')
  const [archiveReason, setArchiveReason] = useState('')
  const [typed, setTyped] = useState('')
  const [danger, setDanger] = useState<'archive' | 'transfer' | 'leave' | 'delete' | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; void loadTeamStaff(ctx.client, ctx.teamId).then(result => { if (active) setStaff(result.data) }); return () => { active = false } }, [ctx.client, ctx.teamId])
  const p = ctx.profile
  const canArchive = ctx.access.isOwner || ctx.access.role === 'manager'
  const run = async (action: () => Promise<{ error: string | null }>, done: string, after?: () => void) => {
    setError('')
    const result = await action()
    if (result.error) return setError(result.error)
    setDanger(null); setTyped(''); ctx.notice(done); if (after) after(); else ctx.reload()
  }
  return <div className="pw-page" role="tabpanel">
    {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
    <div className="pw-grid">
      <Card icon={<Settings size={18} />} title="General">
        <ul className="pw-toggles readonly">
          <li><span>Team profile</span><button type="button" className="ed-link-btn" onClick={() => ctx.open('profile')}>Edit <ArrowRight size={12} /></button></li>
          <li><span>Language</span><small>Set in your account menu (English / ދިވެހި)</small></li>
          <li><span>Time zone display</span><small>Maldives time (UTC+5) everywhere</small></li>
          <li><span>Notification preferences</span><button type="button" className="ed-link-btn" onClick={() => ctx.open('notifications')}>Open <ArrowRight size={12} /></button></li>
        </ul>
      </Card>
      <Card icon={<Globe2 size={18} />} title="Publication">
        <ul className="pw-toggles readonly">
          <li><span>Team page</span><Pill tone={p.isPublished ? 'ok' : 'muted'}>{p.isPublished ? 'Published' : 'Private'}</Pill></li>
          <li><span>Public contact</span><small>{p.showPublicContact ? 'Shown' : 'Hidden'}</small></li>
        </ul>
        <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => ctx.open('public')}><Eye size={13} /> Preview and publish</button>
      </Card>
      <Card icon={<Users size={18} />} title="Membership" sub={`${staff.length} staff`}>
        <ul className="pw-toggles readonly">
          <li><span>Owner</span><small>{staff.find(member => member.isOwner)?.name ?? (ctx.access.isOwner ? 'You' : '—')}</small></li>
          <li><span>Managers</span><small>{staff.filter(member => member.role === 'manager').length}</small></li>
          <li><span>Delegated staff</span><small>{staff.filter(member => member.role !== 'manager' && !member.isOwner).length}</small></li>
        </ul>
        <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => ctx.open('staff')}><Shield size={13} /> Review permissions</button>
      </Card>
      <Card icon={<AlertTriangle size={18} />} title="Danger zone" sub="Controlled, audited actions" className="tw-danger">
        <p className="pf-hint">Teams with history are never hard-deleted. Archiving unpublishes the team and keeps every record.</p>
        <div className="pw-actions">
          {canArchive && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setDanger(danger === 'archive' ? null : 'archive')}>{p.archivedAt ? <><ArchiveRestore size={13} /> Restore team</> : 'Archive team'}</button>}
          {ctx.access.isOwner && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setDanger(danger === 'transfer' ? null : 'transfer')}><Crown size={13} /> Transfer ownership</button>}
        {ctx.access.isOwner && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setDanger(danger === 'delete' ? null : 'delete')}><Trash2 size={13} /> Delete team</button>}
          {!ctx.access.isOwner && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setDanger(danger === 'leave' ? null : 'leave')}><UserMinus size={13} /> Leave management role</button>}
        </div>
        {danger === 'archive' && <div className="pw-inline-form tw-warn-box">
          {p.archivedAt ? <p className="pf-hint">Restoring makes the team active again. It stays private until you publish it.</p> : <>
            <p className="pf-hint"><AlertTriangle size={13} /> The team is hidden from the public and marked inactive. Fixtures, results, rosters and memberships are kept.</p>
            <label className="pf-field">Reason<input value={archiveReason} onChange={event => setArchiveReason(event.target.value)} /></label>
            <label className="pf-field">Type the team name to confirm<input value={typed} onChange={event => setTyped(event.target.value)} placeholder={p.name} /></label>
          </>}
          <div className="pw-actions"><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" disabled={!p.archivedAt && (typed.trim() !== p.name.trim() || !archiveReason.trim())} onClick={() => void run(() => setTeamArchived(ctx.client, ctx.teamId, !p.archivedAt, archiveReason), p.archivedAt ? 'Team restored.' : 'Team archived. Its history is kept.')}>{p.archivedAt ? 'Restore' : 'Archive team'}</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setDanger(null)}>Cancel</button></div>
        </div>}
        {danger === 'transfer' && <div className="pw-inline-form tw-warn-box">
          <p className="pf-hint"><AlertTriangle size={13} /> The new owner gets full authority. You stay on the team as a manager.</p>
          <label className="pf-field">New owner<select value={newOwner} onChange={event => setNewOwner(event.target.value)}><option value="">Choose a staff member…</option>{staff.filter(member => !member.isOwner).map(member => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select></label>
          <label className="pf-field">Type the team name to confirm<input value={typed} onChange={event => setTyped(event.target.value)} placeholder={p.name} /></label>
          <div className="pw-actions"><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" disabled={!newOwner || typed.trim() !== p.name.trim()} onClick={() => void run(() => transferTeamOwnership(ctx.client, ctx.teamId, newOwner), 'Ownership transferred.')}>Transfer</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setDanger(null)}>Cancel</button></div>
        </div>}
        {danger === 'leave' && <div className="pw-inline-form tw-warn-box">
          <p className="pf-hint"><AlertTriangle size={13} /> You lose access to this Team Workspace immediately. The team and its records are unchanged.</p>
          <div className="pw-actions"><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={() => void run(() => removeTeamStaff(ctx.client, ctx.teamId, ctx.userId), 'You left the team management role.', onLeft)}>Leave team</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setDanger(null)}>Cancel</button></div>
        </div>}
        {danger === 'delete' && <div className="pw-inline-form tw-warn-box">
          <p className="pf-hint"><AlertTriangle size={13} /> Permanently delete this team. Only possible when the team has no tournament entries, matches, or other records. Type the team name to confirm.</p>
          <label className="pf-field">Type the team name to confirm<input value={typed} onChange={event => setTyped(event.target.value)} placeholder={p.name} /></label>
          <div className="pw-actions"><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" disabled={typed.trim() !== p.name.trim()} onClick={() => void run(async () => { const r = await ctx.client.from('teams').delete().eq('id', ctx.teamId); return { error: r.error?.message ?? null } }, 'Team deleted.', () => { window.location.hash = '#workspace' })}>Delete team permanently</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setDanger(null)}>Cancel</button></div>
        </div>}
      </Card>
    </div>
  </div>
}
