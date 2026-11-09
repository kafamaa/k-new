import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ExternalLink, Search } from 'lucide-react'
import {
  DIRECTORY_PAGE_SIZE, formatWhen, loadDirectory, loadResultIssues, PUBLIC_PATH, revokeSessions, searchAccounts, setAccountStatus, setVisibility,
  type AccountRow, type DirectoryRow, type DirectoryType, type ResultIssue,
} from '../lib/superAdmin'
import { sportName } from '../lib/display'
import { AdminEmpty, AdminError, AdminLoading, AdminNote, AdminPager, Pill, ReasonAction } from './AdminParts'
import { MatchReview } from './AdminOperations'

function useDebounced(value: string, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(value), delay); return () => window.clearTimeout(timer) }, [value, delay])
  return debounced
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return <label className="adm-search"><Search size={15} aria-hidden="true" /><span className="sr-only">{label}</span><input type="search" value={value} placeholder={label} onChange={event => onChange(event.target.value)} /></label>
}

// --- Accounts --------------------------------------------------------------------------------------
export function AccountsPage({ client, permissions, onNotice }: { client: SupabaseClient; permissions: string[]; onNotice: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<AccountRow[] | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const reload = useCallback(() => {
    let active = true
    setError('')
    void searchAccounts(client, debounced, page).then(result => { if (!active) return; setRows(result.data); setError(result.error ?? '') })
    return () => { active = false }
  }, [client, debounced, page])
  useEffect(() => reload(), [reload])
  useEffect(() => { setPage(0) }, [debounced])
  const total = rows?.[0]?.total ?? 0
  return <div className="adm-stack">
    <p className="adm-intro">Login accounts. Passwords and access tokens are never visible, and no one can sign in as another person. Suspension blocks sign-in and keeps every record.</p>
    <section className="ed-panel adm-stack">
      <div className="adm-toolbar"><SearchBox value={query} onChange={setQuery} label="Search by name or email" /></div>
      {error ? <AdminError message={error} onRetry={reload} /> : !rows ? <AdminLoading /> : rows.length === 0 ? <AdminEmpty>No accounts match.</AdminEmpty>
        : <ul className="adm-list">{rows.map(row => <li key={row.id}>
          <button type="button" className="adm-list-head" aria-expanded={open === row.id} onClick={() => setOpen(open === row.id ? null : row.id)}>
            <span><strong>{row.display_name}</strong><small>{row.email} · {row.email_verified ? 'Email verified' : 'Email not verified'}</small></span>
            <span className="adm-pills">{row.is_admin ? <Pill tone="info">Administrator</Pill> : null}<Pill tone={row.status === 'suspended' ? 'danger' : 'ok'}>{row.status === 'suspended' ? 'Suspended' : 'Active'}</Pill></span>
          </button>
          {open === row.id && <div className="adm-list-body">
            <dl className="adm-dl adm-dl-grid">
              <div><dt>Created</dt><dd>{formatWhen(row.created_at)}</dd></div>
              <div><dt>Last sign-in</dt><dd>{formatWhen(row.last_sign_in_at)}</dd></div>
              <div><dt>Active sessions</dt><dd>{row.session_count}</dd></div>
              <div><dt>Workspaces</dt><dd>{[row.player_profiles ? `${row.player_profiles} player` : null, row.teams ? `${row.teams} team` : null, row.organizations ? `${row.organizations} organization` : null].filter(Boolean).join(' · ') || 'None'}</dd></div>
            </dl>
            <div className="button-row compact">
              {permissions.includes('admin.sessions.revoke') && <ReasonAction label="Sign out everywhere" hint="Ends every session. Pages already open stop working within an hour." onConfirm={async reason => { const result = await revokeSessions(client, row.id, reason); if (result.error) return result.error; onNotice(`${result.data} session(s) ended.`); reload(); return null }} />}
              {permissions.includes('admin.accounts.suspend') && (row.status === 'suspended'
                ? <ReasonAction label="Restore account" onConfirm={async reason => { const result = await setAccountStatus(client, row.id, 'active', reason); if (result.error) return result.error; onNotice('Account restored.'); reload(); return null }} />
                : <ReasonAction label="Suspend account" tone="danger" hint="Blocks sign-in and ends sessions. Records, teams and match history are kept. You need to have signed in within the last 30 minutes." onConfirm={async reason => { const result = await setAccountStatus(client, row.id, 'suspended', reason); if (result.error) return result.error; onNotice('Account suspended.'); reload(); return null }} />)}
            </div>
            {!row.email_verified && <AdminNote>Send recovery guidance by email outside the app; administrators cannot set or see passwords.</AdminNote>}
          </div>}
        </li>)}</ul>}
      <AdminPager page={page} total={total} size={DIRECTORY_PAGE_SIZE} onPage={setPage} label="Account pages" />
    </section>
  </div>
}

// --- Organizations, teams, players, tournaments, news ---------------------------------------------
const TYPE_TEXT: Record<DirectoryType, { noun: string; intro: string }> = {
  organization: { noun: 'organizations', intro: 'Hiding an organization removes its public page. Its tournaments and history are kept.' },
  team: { noun: 'teams', intro: 'Hiding a team removes its public page. Players, rosters and match history are kept.' },
  player: { noun: 'players', intro: 'Names, public codes and status only. Identity documents and National ID values are never shown here.' },
  tournament: { noun: 'tournaments', intro: 'Hiding a tournament removes its public page. Admins do not run tournaments for organizers.' },
  news: { noun: 'news stories', intro: 'Hiding a story archives it. Restoring returns it to its previous state.' },
}

function detailLine(type: DirectoryType, detail: Record<string, unknown>): string {
  const n = (key: string) => Number(detail[key] ?? 0)
  if (type === 'organization') return [detail.owner ? `Owner ${String(detail.owner)}` : null, `${n('tournaments')} tournament(s)`, `${n('members')} member(s)`].filter(Boolean).join(' · ')
  if (type === 'team') return [detail.island ? String(detail.island) : null, `${n('players')} player(s)`, `${n('tournaments')} tournament entr${n('tournaments') === 1 ? 'y' : 'ies'}`].filter(Boolean).join(' · ')
  if (type === 'player') return [detail.code ? String(detail.code) : null, detail.claimed ? 'Claimed' : 'Unclaimed', detail.minor ? 'Minor' : null, Array.isArray(detail.teams) && detail.teams.length ? (detail.teams as string[]).join(', ') : null, n('openRequests') ? `${n('openRequests')} open request(s)` : null].filter(Boolean).join(' · ')
  if (type === 'tournament') return [detail.organization ? String(detail.organization) : null, detail.sport ? sportName(String(detail.sport)) : null, detail.status ? String(detail.status).replace(/_/g, ' ') : null, `${n('entries')} entr${n('entries') === 1 ? 'y' : 'ies'}`, `${n('matches')} match(es)`].filter(Boolean).join(' · ')
  return [detail.organization ? String(detail.organization) : null, detail.status ? String(detail.status) : null].filter(Boolean).join(' · ')
}

export function DirectoryPage({ client, type, onNotice }: { client: SupabaseClient; type: DirectoryType; onNotice: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query)
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<DirectoryRow[] | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(() => {
    let active = true
    setError('')
    void loadDirectory(client, type, debounced, filter, page).then(result => { if (!active) return; setRows(result.data); setError(result.error ?? '') })
    return () => { active = false }
  }, [client, type, debounced, filter, page])
  useEffect(() => reload(), [reload])
  useEffect(() => { setPage(0) }, [debounced, filter, type])
  const text = TYPE_TEXT[type]
  const total = rows?.[0]?.total ?? 0
  return <div className="adm-stack">
    <p className="adm-intro">{text.intro}</p>
    <section className="ed-panel adm-stack">
      <div className="adm-toolbar">
        <SearchBox value={query} onChange={setQuery} label={`Search ${text.noun}`} />
        <div className="ed-toggle" role="group" aria-label="Filter">{[['all', 'All'], ['published', 'Published'], ['unpublished', 'Not published'], ['hidden', 'Hidden by admin']].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>
      </div>
      {error ? <AdminError message={error} onRetry={reload} /> : !rows ? <AdminLoading /> : rows.length === 0 ? <AdminEmpty>No {text.noun} match.</AdminEmpty>
        : <ul className="adm-list">{rows.map(row => <li key={row.id} className="adm-list-row">
          <span className="adm-list-main"><strong>{row.label}</strong><small>{detailLine(type, row.detail)}</small>
            <span className="adm-pills">{row.hidden ? <Pill tone="danger">Hidden by admin</Pill> : row.published ? <Pill tone="ok">Published</Pill> : <Pill>Not published</Pill>}{row.open_reports ? <Pill tone="warn">{row.open_reports} open report(s)</Pill> : null}<small>Created {formatWhen(row.created_at)}</small></span>
          </span>
          <span className="button-row compact">
            {row.published && !row.hidden ? <a className="ed-btn ed-btn-ghost ed-btn-sm" href={`#${PUBLIC_PATH[type]}/${encodeURIComponent(row.slug)}`} target="_blank" rel="noopener noreferrer">Public page <ExternalLink size={12} /></a> : null}
            {row.hidden
              ? <ReasonAction label="Restore" onConfirm={async reason => { const result = await setVisibility(client, type, row.id, false, reason); if (result.error) return result.error; onNotice(`${row.label} restored.`); reload(); return null }} />
              : <ReasonAction label="Hide publicly" tone="danger" hint="The record is kept. The owner cannot publish it again until it is restored." onConfirm={async reason => { const result = await setVisibility(client, type, row.id, true, reason); if (result.error) return result.error; onNotice(`${row.label} hidden.`); reload(); return null }} />}
          </span>
        </li>)}</ul>}
      <AdminPager page={page} total={total} size={DIRECTORY_PAGE_SIZE} onPage={setPage} label={`${text.noun} pages`} />
    </section>
  </div>
}

// --- Matches and result integrity -----------------------------------------------------------------
// initialMatch opens one match directly (#workspace/platform-admin/matches?match=…, e.g. from a report).
export function MatchesIntegrityPage({ client, onNotice, initialMatch }: { client: SupabaseClient; onNotice: (message: string) => void; initialMatch?: string | null }) {
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<ResultIssue[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<{ id: string; label: string } | null>(initialMatch ? { id: initialMatch, label: 'Match' } : null)
  const reload = useCallback(() => { setError(''); void loadResultIssues(client, filter, page).then(result => { setRows(result.data); setError(result.error ?? '') }) }, [client, filter, page])
  useEffect(() => { reload() }, [reload])
  if (selected) return <MatchReview client={client} matchId={selected.id} label={selected.label} onNotice={onNotice} onBack={() => { setSelected(null); reload() }} />
  return <div className="adm-stack">
    <p className="adm-intro">Matches with conflicting result versions, offline sync conflicts or corrections. Results are never overwritten: every correction is a new version made by the organizer’s match officials.</p>
    <section className="ed-panel adm-stack">
      <div className="ed-toggle" role="group" aria-label="Filter">{[['all', 'All issues'], ['conflicts', 'Conflicts'], ['corrected', 'Corrected']].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? 'active' : ''} onClick={() => { setFilter(value); setPage(0) }}>{label}</button>)}</div>
      {error ? <AdminError message={error} onRetry={reload} /> : !rows ? <AdminLoading /> : rows.length === 0 ? <AdminEmpty>No result conflicts or corrections.</AdminEmpty>
        : <div className="adm-table-wrap"><table className="adm-table">
          <caption className="sr-only">Matches needing review</caption>
          <thead><tr><th scope="col">Match</th><th scope="col">Status</th><th scope="col">Versions</th><th scope="col">Conflicts</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.match_id}>
            <td><strong>{row.home_name ?? 'To be decided'} vs {row.away_name ?? 'To be decided'}</strong><small className="adm-cell-sub">{row.tournament_name} · {formatWhen(row.scheduled_at)}</small></td>
            <td>{row.status.replace(/_/g, ' ')}{row.corrected ? <> <Pill tone="info">Corrected</Pill></> : null}</td>
            <td>{row.versions}</td>
            <td>{row.conflicts + row.sync_conflicts ? <Pill tone="danger">{row.conflicts + row.sync_conflicts}</Pill> : '0'}</td>
            <td><span className="button-row compact"><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setSelected({ id: row.match_id, label: `${row.home_name ?? 'To be decided'} vs ${row.away_name ?? 'To be decided'}` })}>Review</button><a className="ed-link" href={`#matches/${encodeURIComponent(row.match_id)}`} target="_blank" rel="noopener noreferrer">Public match <ExternalLink size={12} /></a></span></td>
          </tr>)}</tbody>
        </table></div>}
      <AdminPager page={page} total={rows?.[0]?.total ?? 0} size={DIRECTORY_PAGE_SIZE} onPage={setPage} label="Match pages" />
      <AdminNote>Ask the organizer to correct a result first. Open Review to freeze a disputed public result, or to propose an exceptional correction or restore; a second administrator approves those under Critical approvals.</AdminNote>
    </section>
  </div>
}
