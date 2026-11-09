import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Crown, Download, ExternalLink, Info, Lock, Mail, Pencil, Plus, Search, ShieldCheck, Trash2, Trophy, UserPlus, Users, XCircle,
} from 'lucide-react'
import type { TeamCtx } from './TeamHubTabs'
import { addExistingTeamPlayer, endTeamMembership, revokeInvitation, SQUAD_ROLE_LABELS, updateTeamMembership, type SentInvitation } from '../lib/teamHub'
import { sendTeamInvitation } from '../lib/playerSections'
import { searchExistingPlayers, type SearchablePlayer } from '../lib/organizer'
import { csvRow } from '../lib/csvSafe'
import { formatDay, sportName } from '../lib/display'
import { TeamLogo, PersonAvatar } from './HomeArt'
import { ConfirmAction } from './ConfirmAction'
import { ReviewDialog } from './ReviewDialog'

// Team Squad, Player Invitations, Add Player (find → membership → review) and
// Edit Player Membership, in the owner's workspace design (2026-11-04). Every
// row is a real membership or invitation; nothing here is sample data.
type Row = Record<string, unknown>
const one = (value: unknown): Row | null => Array.isArray(value) ? (value[0] as Row | undefined) ?? null : value && typeof value === 'object' ? value as Row : null
const PAGE = 10
type SquadTab = 'active' | 'invitations' | 'former'
type View = { kind: 'list' } | { kind: 'edit'; id: string } | { kind: 'add'; again?: string }

function invitationState(item: SentInvitation): 'awaiting' | 'accepted' | 'expired' | 'closed' {
  if (item.status === 'accepted') return 'accepted'
  if (item.status === 'expired' || (item.status === 'pending' && item.expiresAt && Date.parse(item.expiresAt) < Date.now())) return 'expired'
  if (item.status === 'pending') return 'awaiting'
  return 'closed'
}
const INVITE_PILL: Record<ReturnType<typeof invitationState>, { label: string; tone: string; icon: ReactNode }> = {
  awaiting: { label: 'Awaiting response', tone: 'warn', icon: <Clock3 size={15} aria-hidden="true" /> },
  accepted: { label: 'Accepted', tone: 'info', icon: <CheckCircle2 size={15} aria-hidden="true" /> },
  expired: { label: 'Expired', tone: 'muted', icon: <XCircle size={15} aria-hidden="true" /> },
  closed: { label: 'Closed', tone: 'muted', icon: null },
}

function TeamCard({ ctx, label }: { ctx: TeamCtx; label?: string }) {
  const p = ctx.profile
  return <div className="sq-teamcard">
    {label ? <h2 className="sq-card-title">{label}</h2> : null}
    <div className="sq-teamcard-row"><TeamLogo name={p.name} logoUrl={p.logoUrl} size={66} /><span className="sq-sep" aria-hidden="true" /><div><strong>{p.name}</strong><small>{[p.sports.map(sportName).join(', ') || null, p.island].filter(Boolean).join(' · ') || 'Team'}</small></div></div>
  </div>
}

function PlayerMark({ photo }: { photo?: unknown }) {
  return <span className="sq-avatar">{photo ? <img src={String(photo)} alt="" /> : <PersonAvatar />}</span>
}

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const items = ['Find player', 'Membership details', 'Review']
  return <ol className="sq-steps" aria-label="Add player steps">{items.map((label, index) => { const n = index + 1; const state = n < step ? 'done' : n === step ? 'now' : 'next'; return <li key={label} className={state} aria-current={state === 'now' ? 'step' : undefined}>
    <span className="sq-step-dot">{state === 'done' ? <Check size={18} aria-hidden="true" /> : n}</span><span>{label}</span>
  </li> })}</ol>
}

function Numbered({ items }: { items: string[] }) {
  return <ol className="sq-numbered">{items.map((text, index) => <li key={text}><span>{index + 1}</span>{text}</li>)}</ol>
}

// --- The squad page ----------------------------------------------------------------------------
export function SquadPage({ ctx, createRecord }: { ctx: TeamCtx; createRecord: (onDone: () => void) => ReactNode }) {
  const [view, setView] = useState<View>({ kind: 'list' })
  const [tab, setTab] = useState<SquadTab>('active')
  const canManage = ctx.access.can('manage_players')
  const canInvite = ctx.access.can('send_invitations')
  const active = ctx.data.playerHistory.filter(row => row.status === 'active' || row.status === 'loaned')
  const former = ctx.data.playerHistory.filter(row => row.status === 'ended')
  const pending = ctx.invitations.filter(item => invitationState(item) === 'awaiting')
  const captain = active.find(row => row.squad_role === 'captain')
  const editing = view.kind === 'edit' ? active.find(row => String(row.id) === view.id) : undefined

  if (view.kind === 'edit' && editing) return <EditMembership ctx={ctx} row={editing} captain={captain} onBack={() => setView({ kind: 'list' })} />
  if (view.kind === 'add') return <AddPlayerFlow ctx={ctx} createRecord={createRecord} onBack={() => setView({ kind: 'list' })} onDone={() => { setView({ kind: 'list' }); setTab('invitations') }} />

  return <div className="sq-page">
    <header className="sq-pagehead">
      <p className="sq-lede">Manage players and memberships for {ctx.profile.name}.</p>
      {canManage || canInvite ? <div className="sq-head-actions">
        <button type="button" className="ed-btn ed-btn-primary" onClick={() => setView({ kind: 'add' })}><Plus size={18} aria-hidden="true" /> Add Player</button>
        {canInvite ? <button type="button" className="ed-btn ed-btn-ghost" onClick={() => setView({ kind: 'add' })}><UserPlus size={18} aria-hidden="true" /> Invite Player</button> : null}
      </div> : null}
    </header>
    <section className="sq-summary" aria-label="Squad summary">
      <div className="sq-summary-team"><TeamLogo name={ctx.profile.name} logoUrl={ctx.profile.logoUrl} size={74} /><div><strong>{ctx.profile.name}</strong><small>{[ctx.profile.sports.map(sportName).join(', ') || null, ctx.profile.island].filter(Boolean).join(' · ')}</small></div></div>
      <dl className="sq-tiles">
        <div><span className="sq-tile-icon"><Users size={22} aria-hidden="true" /></span><dd>{active.length}</dd><dt>Active players</dt></div>
        <div><span className="sq-tile-icon"><Mail size={22} aria-hidden="true" /></span><dd>{pending.length}</dd><dt>Pending invitations</dt></div>
        <div><span className="sq-tile-icon"><Crown size={22} aria-hidden="true" /></span><dd>{captain ? 1 : 0}</dd><dt>Captain</dt></div>
      </dl>
    </section>
    <div className="sq-tabs" role="tablist" aria-label="Squad">
      {([['active', `Active squad (${active.length})`], ['invitations', `Invitations (${ctx.invitations.length})`], ['former', 'Former players']] as Array<[SquadTab, string]>).map(([id, label]) => <button type="button" role="tab" key={id} aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    {tab === 'active' && <SquadTable ctx={ctx} rows={active} canManage={canManage} onEdit={id => setView({ kind: 'edit', id })} />}
    {tab === 'invitations' && <InvitationsPanel ctx={ctx} canInvite={canInvite} onInvite={() => setView({ kind: 'add' })} />}
    {tab === 'former' && <SquadTable ctx={ctx} rows={former} canManage={false} former onEdit={() => undefined} />}
    <div className="sq-info-row">
      <section className="sq-info"><span className="sq-info-icon"><Trophy size={22} aria-hidden="true" /></span><div><h3>Squad vs tournament roster</h3><p>Adding a player here does not automatically add them to a tournament roster. <button type="button" className="ed-link-btn inline" onClick={() => ctx.open('rosters')}>Manage tournament entries</button>.</p></div></section>
      <section className="sq-info"><span className="sq-info-icon"><Info size={22} aria-hidden="true" /></span><div><h3>Removing a membership</h3><p>Removal asks for confirmation and preserves past match records.</p></div></section>
    </div>
  </div>
}

function SquadTable({ ctx, rows, canManage, former = false, onEdit }: { ctx: TeamCtx; rows: Row[]; canManage: boolean; former?: boolean; onEdit: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [query, position])
  const positions = [...new Set(rows.map(row => String(row.position ?? '').trim()).filter(Boolean))].sort()
  const term = query.trim().toLowerCase()
  const filtered = rows.filter(row => { const player = one(row.player_profiles); return (!position || String(row.position ?? '').trim() === position) && (!term || `${player?.display_name ?? ''} ${player?.public_code ?? ''}`.toLowerCase().includes(term)) })
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const current = Math.min(page, pages)
  const shown = filtered.slice((current - 1) * PAGE, current * PAGE)
  const exportCsv = () => {
    const lines = [csvRow(['Player', 'Player ID', 'Shirt', 'Position', 'Role', 'From', 'To']), ...filtered.map(row => { const player = one(row.player_profiles); return csvRow([player?.display_name ?? 'Private player record', player?.public_code ?? '', row.jersey_number ?? '', row.position ?? '', SQUAD_ROLE_LABELS[String(row.squad_role ?? 'player')] ?? '', row.effective_from ?? '', row.effective_to ?? '']) })]
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const link = document.createElement('a'); link.href = url; link.download = `${ctx.profile.name.replace(/[^\w-]+/g, '-')}-squad.csv`; link.click(); URL.revokeObjectURL(url)
  }
  return <>
    <div className="sq-filterbar">
      <label className="sq-search"><Search size={20} aria-hidden="true" /><input type="search" aria-label="Search name or player ID" placeholder="Search name or player ID" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {positions.length ? <label className="sq-select">Position: <select aria-label="Filter by position" value={position} onChange={event => setPosition(event.target.value)}><option value="">All positions</option>{positions.map(value => <option key={value}>{value}</option>)}</select></label> : null}
      <span className="sq-filter-sep" aria-hidden="true" />
      <button type="button" className="ed-btn ed-btn-ghost" onClick={exportCsv} disabled={!filtered.length}><Download size={17} aria-hidden="true" /> Export squad</button>
    </div>
    <section className="sq-table-card">
      {shown.length ? <div className="sq-table-wrap" role="region" aria-label={former ? 'Former players' : 'Active squad'} tabIndex={0}><table className="sq-table">
        <thead><tr><th scope="col">Player</th><th scope="col">Shirt</th><th scope="col">Position</th><th scope="col">Membership</th>{canManage || !former ? <th scope="col">Actions</th> : <th scope="col">Dates</th>}</tr></thead>
        <tbody>{shown.map(row => { const player = one(row.player_profiles); const name = String(player?.display_name ?? 'Private player record'); const id = String(row.id); const slug = player?.is_published === true && player.slug ? String(player.slug) : null; return <tr key={id}>
          <td><span className="sq-player"><PlayerMark photo={player?.photo_url} /><span><strong>{name}</strong>{player?.public_code ? <small>{String(player.public_code)}</small> : null}</span>{row.squad_role && row.squad_role !== 'player' ? <span className="sq-captain"><Crown size={14} aria-hidden="true" /> {SQUAD_ROLE_LABELS[String(row.squad_role)]}</span> : null}</span></td>
          <td>{row.jersey_number != null ? <span className="sq-shirt" aria-label={`Shirt ${String(row.jersey_number)}`}>{String(row.jersey_number)}</span> : <span className="sq-dim">—</span>}</td>
          <td>{row.position ? String(row.position) : <span className="sq-dim">Not set</span>}</td>
          <td><span className={`sq-pill ${former ? 'tone-muted' : 'tone-ok'}`}>{former ? 'Ended' : row.status === 'loaned' ? 'On loan' : 'Active'}</span></td>
          {former ? <td className="sq-dim">{formatDay(row.effective_from) ?? '—'} – {formatDay(row.effective_to) ?? '—'}</td>
            : <td><span className="sq-actions">{slug ? <a className="sq-btn" href={`#player/${encodeURIComponent(slug)}`}>View</a> : <span className="sq-btn is-off" title="This player has no public profile">View</span>}{canManage ? <><button type="button" className="sq-btn" onClick={() => onEdit(id)} aria-label={`Edit ${name}`}><Pencil size={14} aria-hidden="true" /> Edit</button><button type="button" className="sq-remove" onClick={() => onEdit(id)} aria-label={`Remove ${name}`}>Remove</button></> : null}</span></td>}
        </tr> })}</tbody>
      </table></div> : <p className="sq-empty">{rows.length ? 'No players match this search.' : former ? 'No former players yet. Ended memberships stay here with their dates.' : 'No active players yet. Use Add Player to build your squad.'}</p>}
      {filtered.length ? <div className="sq-tablefoot"><span>Showing {(current - 1) * PAGE + 1}–{Math.min(current * PAGE, filtered.length)} of {filtered.length} players</span>
        {pages > 1 ? <nav className="sq-pager" aria-label="Squad pages"><button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)}><ChevronLeft size={16} aria-hidden="true" /> Previous</button>{Array.from({ length: pages }, (_, index) => index + 1).map(n => <button type="button" key={n} className={n === current ? 'active' : ''} aria-current={n === current ? 'page' : undefined} aria-label={`Page ${n}`} onClick={() => setPage(n)}>{n}</button>)}<button type="button" disabled={current >= pages} onClick={() => setPage(current + 1)}>Next <ChevronRight size={16} aria-hidden="true" /></button></nav> : null}
      </div> : null}
    </section>
  </>
}

// --- Player Invitations ------------------------------------------------------------------------
function InvitationsPanel({ ctx, canInvite, onInvite }: { ctx: TeamCtx; canInvite: boolean; onInvite: () => void }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const counts = { awaiting: 0, accepted: 0, expired: 0, closed: 0 }
  for (const item of ctx.invitations) counts[invitationState(item)]++
  const term = query.trim().toLowerCase()
  const rows = ctx.invitations.filter(item => (!status || invitationState(item) === status) && (!term || item.playerName.toLowerCase().includes(term)))
  return <>
    <dl className="sq-statusbar" aria-label="Invitation status">
      <div className="tone-warn"><dd>{counts.awaiting}</dd><dt>Awaiting response</dt></div>
      <div className="tone-ok"><dd>{counts.accepted}</dd><dt>Accepted</dt></div>
      <div className="tone-muted"><dd>{counts.expired}</dd><dt>Expired</dt></div>
    </dl>
    <div className="sq-filterbar">
      <label className="sq-search"><Search size={20} aria-hidden="true" /><input type="search" aria-label="Search player or invitation" placeholder="Search player or invitation" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label className="sq-select"><span className="sr-only">Status</span><select aria-label="Filter invitations by status" value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option><option value="awaiting">Awaiting response</option><option value="accepted">Accepted</option><option value="expired">Expired</option><option value="closed">Closed</option></select></label>
      <button type="button" className="ed-btn ed-btn-ghost" onClick={() => { setQuery(''); setStatus('') }}>Reset</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="sq-table-card">
      <h2 className="sq-card-title">Invitations</h2>
      {rows.length ? <div className="sq-table-wrap" role="region" aria-label="Invitations" tabIndex={0}><table className="sq-table">
        <thead><tr><th scope="col">Player</th><th scope="col">Sent</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
        <tbody>{rows.map(item => { const state = invitationState(item); const pill = INVITE_PILL[state]; return <tr key={item.id}>
          <td><span className="sq-player"><PlayerMark /><span><strong>{item.playerName}</strong><small>{[item.position, item.jerseyNumber !== null ? `#${item.jerseyNumber}` : null].filter(Boolean).join(' · ') || 'No position set'}</small></span></span></td>
          <td>{formatDay(item.createdAt) ?? '—'}{item.expiresAt && state === 'awaiting' ? <small className="sq-sub">Expires {formatDay(item.expiresAt)}</small> : null}</td>
          <td><span className={`sq-pill tone-${pill.tone}`}>{pill.icon}{pill.label}</span></td>
          <td><span className="sq-actions">
            {item.playerSlug ? <a className="sq-btn" href={`#player/${encodeURIComponent(item.playerSlug)}`}>View details</a> : null}
            {state === 'awaiting' && canInvite ? <ConfirmAction className="sq-remove" label={`Cancel invitation to ${item.playerName}`} question="Cancel this invitation? The player can no longer accept it." confirmLabel="Cancel invitation" icon={null} onConfirm={async () => { const result = await revokeInvitation(ctx.client, item.id); if (result.error) { setError(result.error); return result.error } ctx.notice('Invitation cancelled.'); ctx.reload() }} /> : null}
            {state === 'accepted' ? <em className="sq-dim">Membership approval may follow</em> : null}
            {state === 'expired' && canInvite ? <button type="button" className="sq-btn" onClick={onInvite}>Invite again</button> : null}
          </span></td>
        </tr> })}</tbody>
      </table></div> : <p className="sq-empty">{ctx.invitations.length ? 'No invitations match this search.' : 'No invitations sent yet.'}</p>}
    </section>
    <div className="sq-info-row">
      <section className="sq-info sq-progress"><div><h3>Invitation progress</h3><ol className="sq-track"><li>Sent</li><li>Player response</li><li>Required approvals</li><li>Active membership</li></ol></div></section>
      <section className="sq-info"><div><h3>Manage invitations</h3><ul className="sq-bullets"><li>Cancelling stops an unanswered invitation.</li><li>Past activity remains in the invitation history.</li><li>Membership and tournament eligibility are reviewed separately.</li></ul></div></section>
    </div>
  </>
}

// --- Add Player: find → membership details → review ----------------------------------------------
function AddPlayerFlow({ ctx, createRecord, onBack, onDone }: { ctx: TeamCtx; createRecord: (onDone: () => void) => ReactNode; onBack: () => void; onDone: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchablePlayer[] | null>(null)
  const [picked, setPicked] = useState<SearchablePlayer | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ position: '', jerseyNumber: '', message: '' })
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const memberIds = useMemo(() => new Set(ctx.data.playerHistory.filter(row => row.status !== 'ended').map(row => String(row.player_id))), [ctx.data.playerHistory])
  const search = async () => { setError(''); const result = await searchExistingPlayers(ctx.client, query, 12); setResults((result.data ?? []).filter(player => !memberIds.has(player.id))); if (result.error) setError(result.error) }
  // Players with an account decide for themselves (invitation); records without
  // an account are added directly, as before.
  const invites = Boolean(picked?.is_claimed)
  const submit = async () => {
    if (!picked) return
    setBusy(true); setError('')
    const result = invites ? await sendTeamInvitation(ctx.client, { teamId: ctx.teamId, playerId: picked.id, userId: ctx.userId, ...form })
      : await addExistingTeamPlayer(ctx.client, { teamId: ctx.teamId, playerId: picked.id, position: form.position, jerseyNumber: form.jerseyNumber })
    setBusy(false)
    if (result.error) return setError(result.error)
    ctx.notice(invites ? `Invitation sent to ${picked.display_name}. They accept or decline it in their player workspace.` : `${picked.display_name} was added to the squad. Their earlier history stays with them.`)
    ctx.reload(); onDone()
  }
  const titles = { 1: ['Add Player to Team', 'Find an existing player before creating a new record.', 'Back to squad'], 2: ['Player Membership Details', 'Set the player’s role in your team before reviewing the request.', 'Back to player search'], 3: [invites ? 'Review Player Invitation' : 'Review New Membership', invites ? 'Check the details before sending an invitation.' : 'Check the details before adding the player.', 'Back to membership details'] } as const
  const [title, sub, back] = titles[step]
  const playerLine = picked ? <div className="sq-picked"><PlayerMark /><div><strong>{picked.display_name}</strong><small>{picked.island ?? 'Island not recorded'} · {picked.is_claimed ? 'Has an account' : 'No account yet'}</small></div></div> : null

  if (creating) return <div className="sq-page sq-flow"><button type="button" className="sq-backpill" onClick={() => setCreating(false)}><ArrowLeft size={17} aria-hidden="true" /> Back to player search</button><h1 className="sq-flow-title">Create player record</h1>{createRecord(() => { setCreating(false); onDone() })}</div>

  return <div className="sq-page sq-flow">
    <button type="button" className="sq-backpill" onClick={() => step === 1 ? onBack() : setStep((step - 1) as 1 | 2)}><ArrowLeft size={17} aria-hidden="true" /> {back}</button>
    <h1 className="sq-flow-title">{title}</h1><p className="sq-lede">{sub}</p>
    <Steps step={step} />
    {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
    <div className="sq-two">
      <div className="sq-col">
        {step === 1 && <>
          <section className="sq-card">
            <h2 className="sq-card-title">Find a player</h2><p className="sq-muted">Search by name or player link.</p>
            <form className="sq-findbar" role="search" onSubmit={event => { event.preventDefault(); void search() }}>
              <label className="sq-search"><Search size={20} aria-hidden="true" /><input type="search" aria-label="Search players by name" value={query} onChange={event => setQuery(event.target.value)} placeholder="At least 2 letters" /></label>
              <button type="submit" className="ed-btn ed-btn-primary" disabled={query.trim().length < 2}>Search</button>
            </form>
            {results ? <><h3 className="sq-subtitle">{results.length} matching player{results.length === 1 ? '' : 's'}</h3>
              <ul className="sq-results">{results.map(player => <li key={player.id} className={picked?.id === player.id ? 'chosen' : ''}><label>
                <input type="radio" name="sq-player" checked={picked?.id === player.id} onChange={() => setPicked(player)} />
                <PlayerMark /><span><strong>{player.display_name}</strong><small>{player.island ?? 'Island not recorded'} · {player.is_claimed ? 'Has an account' : 'No account yet'}</small></span>
              </label>{player.is_published && player.slug ? <a className="sq-btn" href={`#player/${encodeURIComponent(player.slug)}`} target="_blank" rel="noopener noreferrer">View profile</a> : null}</li>)}</ul>
              <p className="sq-note"><Info size={17} aria-hidden="true" /> Check the player’s island and profile before continuing.</p></> : null}
          </section>
          {ctx.access.can('manage_players') ? <section className="sq-card sq-cantfind"><span className="sq-info-icon"><UserPlus size={22} aria-hidden="true" /></span><div><h3>Cannot find the player?</h3><p>Try another spelling, or create a record when the player has no profile yet.</p></div><button type="button" className="ed-btn ed-btn-ghost" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> Create player record</button></section> : null}
        </>}
        {step === 2 && <>
          <section className="sq-card sq-card-row">{playerLine}<button type="button" className="ed-btn ed-btn-ghost" onClick={() => setStep(1)}>Change player</button></section>
          <section className="sq-card">
            <h2 className="sq-card-title">Team membership</h2>
            <div className="sq-fields">
              <label>Shirt number<input inputMode="numeric" maxLength={2} value={form.jerseyNumber} onChange={event => setForm({ ...form, jerseyNumber: event.target.value.replace(/\D/g, '') })} /></label>
              <label>Playing position<input value={form.position} maxLength={40} onChange={event => setForm({ ...form, position: event.target.value })} placeholder="e.g. Forward" /></label>
              {invites ? <label className="sq-wide">Message to player (optional)<textarea rows={3} maxLength={400} value={form.message} onChange={event => setForm({ ...form, message: event.target.value })} placeholder={`We would like you to join ${ctx.profile.name}.`} /></label> : null}
            </div>
            <p className="sq-muted">{invites ? 'The membership starts on the day the player accepts.' : 'The membership starts today.'} Captain and vice-captain are set from the squad once the player has joined.</p>
          </section>
        </>}
        {step === 3 && picked && <>
          <section className="sq-card"><div className="sq-card-head"><h2 className="sq-card-title">Selected player</h2><button type="button" className="ed-link-btn inline" onClick={() => setStep(1)}><Pencil size={15} aria-hidden="true" /> Change player</button></div>{playerLine}</section>
          <section className="sq-card"><div className="sq-card-head"><h2 className="sq-card-title">Membership summary</h2><button type="button" className="ed-link-btn inline" onClick={() => setStep(2)}><Pencil size={15} aria-hidden="true" /> Edit details</button></div>
            <dl className="sq-dl"><div><dt>Team</dt><dd>{ctx.profile.name}</dd></div><div><dt>Team role</dt><dd>Player</dd></div><div><dt>Shirt number</dt><dd>{form.jerseyNumber || <em>Not set</em>}</dd></div><div><dt>Playing position</dt><dd>{form.position || <em>Not set</em>}</dd></div><div><dt>Start date</dt><dd>{invites ? 'When the player accepts' : formatDay(new Date().toISOString())}</dd></div><div><dt>End date</dt><dd><em>No end date</em></dd></div></dl>
          </section>
          {invites ? <section className="sq-card"><div className="sq-card-head"><h2 className="sq-card-title">Message to player</h2><button type="button" className="ed-link-btn inline" onClick={() => setStep(2)}><Pencil size={15} aria-hidden="true" /> Edit message</button></div><p className="sq-quote">{form.message.trim() ? `“${form.message.trim()}”` : <em>No message</em>}</p></section> : null}
        </>}
      </div>
      <aside className="sq-col">
        <section className="sq-card"><TeamCard ctx={ctx} label={step === 1 ? 'Adding to' : step === 2 ? 'Team' : undefined} /></section>
        <section className="sq-card">
          <h2 className="sq-card-title">{step === 1 ? 'What happens next' : step === 2 ? 'Before you continue' : invites ? 'What happens after sending' : 'What happens next'}</h2>
          <Numbered items={step === 1 ? ['Choose the correct player', 'Set team membership details', 'Review and send the request'] : step === 2 ? ['Membership details apply to this team.', 'Tournament rosters are managed separately.', 'Player consent or other approvals may be required.'] : invites ? ['The player receives an invitation.', 'Their response appears under Invitations.', 'Required membership approvals follow separately.'] : ['The player joins the active squad.', 'Their earlier history stays with them.', 'Add them to tournament rosters separately.']} />
          <p className="sq-note"><Info size={17} aria-hidden="true" /> {step === 3 && invites ? 'Sending an invitation does not activate membership or approve a tournament roster.' : 'No membership is created until you review and submit.'}</p>
        </section>
      </aside>
    </div>
    <div className="sq-footbar">
      {step === 3 ? <label className="sq-check"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} /><span><strong>I have checked the player and membership details.</strong><small>Confirm the details to enable {invites ? 'sending' : 'adding'}.</small></span></label> : <span className="sq-muted">{step === 1 ? (picked ? `${picked.display_name} selected.` : 'Select a player to continue.') : 'Step 2 of 3'}</span>}
      <span className="sq-foot-actions">
        <button type="button" className="ed-btn ed-btn-ghost" onClick={() => step === 1 ? onBack() : setStep((step - 1) as 1 | 2)}>{step === 1 ? 'Cancel' : 'Back'}</button>
        {step === 1 && <button type="button" className="ed-btn ed-btn-primary" disabled={!picked} onClick={() => setStep(2)}>Continue</button>}
        {step === 2 && <button type="button" className="ed-btn ed-btn-primary" onClick={() => { setChecked(false); setStep(3) }}>Review Request</button>}
        {step === 3 && <button type="button" className="ed-btn ed-btn-primary" disabled={!checked || busy} onClick={() => void submit()}>{invites ? <Mail size={18} aria-hidden="true" /> : <UserPlus size={18} aria-hidden="true" />} {busy ? 'Working…' : invites ? 'Send Invitation' : 'Add to Squad'}</button>}
      </span>
    </div>
  </div>
}

// --- Edit Player Membership ----------------------------------------------------------------------
function EditMembership({ ctx, row, captain, onBack }: { ctx: TeamCtx; row: Row; captain?: Row; onBack: () => void }) {
  const player = one(row.player_profiles)
  const name = String(player?.display_name ?? 'Private player record')
  const [form, setForm] = useState({ position: String(row.position ?? ''), jerseyNumber: row.jersey_number != null ? String(row.jersey_number) : '', squadRole: String(row.squad_role ?? 'player') })
  const [ending, setEnding] = useState(false)
  const [end, setEnd] = useState({ date: new Date().toISOString().slice(0, 10), reason: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const captainName = captain && captain !== row ? String(one(captain.player_profiles)?.display_name ?? 'Another player') : null
  const save = async () => {
    setBusy(true); setError('')
    const result = await updateTeamMembership(ctx.client, String(row.id), form)
    setBusy(false)
    if (result.error) return setError(result.error)
    ctx.notice('Membership updated.'); ctx.reload(); onBack()
  }
  const remove = async () => {
    setBusy(true); setError('')
    const result = await endTeamMembership(ctx.client, ctx.teamId, String(row.id), end.date, end.reason)
    setBusy(false)
    if (result.error) return setError(result.error)
    ctx.notice('Membership ended. The player’s history with the team is kept; submitted rosters are unchanged.'); ctx.reload(); onBack()
  }
  return <div className="sq-page sq-flow">
    <h1 className="sq-flow-title">Edit Player Membership</h1><p className="sq-lede">Update this player’s details within {ctx.profile.name}.</p>
    <button type="button" className="sq-backpill" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" /> Back to squad</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="sq-two">
      <div className="sq-col">
        <section className="sq-card sq-card-row"><div className="sq-picked"><PlayerMark photo={player?.photo_url} /><div><strong>{name}</strong>{player?.public_code ? <small>{String(player.public_code)}</small> : null}</div></div>
          <span className="sq-pill tone-ok"><Check size={15} aria-hidden="true" /> {row.status === 'loaned' ? 'On loan' : 'Active membership'}</span>
          {player?.is_published === true && player.slug ? <a className="ed-link" href={`#player/${encodeURIComponent(String(player.slug))}`} target="_blank" rel="noopener noreferrer">View player profile <ExternalLink size={14} aria-hidden="true" /></a> : null}</section>
        <section className="sq-card">
          <h2 className="sq-card-title">Team details</h2>
          <div className="sq-fields">
            <label>Shirt number<input inputMode="numeric" maxLength={2} value={form.jerseyNumber} onChange={event => setForm({ ...form, jerseyNumber: event.target.value.replace(/\D/g, '') })} /></label>
            <label>Playing position<input value={form.position} maxLength={40} onChange={event => setForm({ ...form, position: event.target.value })} /></label>
            <label>Team role<select value={form.squadRole} onChange={event => setForm({ ...form, squadRole: event.target.value })}>{Object.entries(SQUAD_ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Membership type<span className="sq-locked"><Lock size={16} aria-hidden="true" /> {row.source ? String(row.source).replace(/_/g, ' ').replace(/^\w/, letter => letter.toUpperCase()) : 'Team membership'}</span></label>
            <label>Start date<span className="sq-locked">{formatDay(row.effective_from) ?? '—'}</span></label>
            <label>End date (optional)<span className="sq-locked">{row.effective_to ? formatDay(row.effective_to) : 'No end date'}</span></label>
          </div>
          <label className="sq-toggle"><input type="checkbox" role="switch" checked={form.squadRole === 'captain'} onChange={event => setForm({ ...form, squadRole: event.target.checked ? 'captain' : 'player' })} /><span><strong>Assign as captain</strong><small>{captainName ? `${captainName} is the current captain. Saving moves the captaincy to ${name}.` : 'No captain is assigned yet.'}</small></span></label>
        </section>
      </div>
      <aside className="sq-col">
        <section className="sq-card"><TeamCard ctx={ctx} /></section>
        <section className="sq-card"><h2 className="sq-card-title"><Pencil size={20} aria-hidden="true" /> What you can edit</h2><p>Team role, shirt number and playing position apply to this membership.</p><hr /><p className="sq-lockline"><Lock size={18} aria-hidden="true" /> Identity and official career records are managed through correction requests.</p></section>
        <section className="sq-card sq-danger"><h2 className="sq-card-title"><Trash2 size={20} aria-hidden="true" /> End membership</h2><p>Remove the player from the active squad while preserving past records.</p>
          <button type="button" className="sq-danger-btn" onClick={() => setEnding(true)}>Review removal</button>
        </section>
      </aside>
    </div>
    <div className="sq-footbar"><span className="sq-muted"><Info size={18} aria-hidden="true" /> Changes are recorded in team activity.</span><span className="sq-foot-actions"><button type="button" className="ed-btn ed-btn-ghost" onClick={onBack}>Cancel</button><button type="button" className="ed-btn ed-btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save Changes'}</button></span></div>
    <p className="sq-dim"><ShieldCheck size={14} aria-hidden="true" /> Shirt numbers must be unique within the active squad. <ArrowRight size={12} aria-hidden="true" /> The server checks this when you save.</p>
    <ReviewDialog open={ending} title="End player membership?" busy={busy} onClose={() => setEnding(false)}><p>End {name}’s active membership with {ctx.profile.name}?</p><div className="review-dialog-record"><PlayerMark photo={player?.photo_url} /><span><strong>{name}</strong><small>{ctx.profile.name} · {form.position || 'Player'}</small></span></div><p className="review-dialog-note"><ShieldCheck size={18} aria-hidden="true" /> Past matches, career records and submitted tournament rosters are kept.</p><div className="sq-fields one"><label>End date<input type="date" disabled={busy} value={end.date} onChange={event => setEnd({ ...end, date: event.target.value })} /></label><label>Private reason (optional)<textarea disabled={busy} value={end.reason} maxLength={300} onChange={event => setEnd({ ...end, reason: event.target.value })} /></label></div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="review-dialog-actions"><button type="button" data-dialog-cancel className="ed-btn ed-btn-ghost" disabled={busy} onClick={() => setEnding(false)}>Keep membership</button><button type="button" className="primary-button danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Ending membership…' : 'End membership'}</button></footer></ReviewDialog>
  </div>
}
