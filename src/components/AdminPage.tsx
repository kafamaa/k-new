import { useCallback, useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { Eye, EyeOff, ImageUp, Pencil, ShieldAlert, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { deleteHighlight, EMPTY_HIGHLIGHT, HIGHLIGHT_KIND_LABELS, HIGHLIGHT_KINDS, isPlatformAdmin, loadAllHighlights, saveHighlight, setHighlightActive, uploadHighlightImage, type Highlight, type HighlightDraft, type HighlightKind } from '../lib/platformHighlights'
import { HeroHighlights } from './HeroHighlights'
import { PlayerRequestsReview } from './PlayerRequestsReview'
import { AnnouncementsAdmin, ContentReportsAdmin, PlatformPagesAdmin } from './AdminLandingTools'

// datetime-local works in local wall time; convert to and from ISO for storage.
const toLocalInput = (iso: string | null) => { if (!iso) return ''; const date = new Date(iso); return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
const fromLocalInput = (value: string) => value ? new Date(value).toISOString() : null

function windowLabel(item: Highlight): string {
  const now = Date.now()
  if (!item.isActive) return 'Draft'
  if (item.startsAt && Date.parse(item.startsAt) > now) return 'Scheduled'
  if (item.endsAt && Date.parse(item.endsAt) <= now) return 'Ended'
  return 'Live on homepage'
}

// Platform administration: the homepage highlight panel. The database decides
// who is an admin (is_platform_admin); this page only reflects that decision.
// embedded: shown inside the Super Admin workspace, which has already checked
// the content permission (RLS still enforces every write).
export function AdminPage({ user, onNotice, embedded = false }: { user: User | null; onNotice: (message: string) => void; embedded?: boolean }) {
  const client = supabase
  const [access, setAccess] = useState<'checking' | 'admin' | 'denied'>('checking')
  const [items, setItems] = useState<Highlight[]>([])
  const [tournaments, setTournaments] = useState<Array<Record<string, unknown>>>([])
  const [draft, setDraft] = useState<HighlightDraft>(EMPTY_HIGHLIGHT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    if (!client) return
    void loadAllHighlights(client).then(result => { setItems(result.data); if (result.error) setError(result.error) })
  }, [client])

  useEffect(() => {
    if (!client || !user) { setAccess('denied'); return }
    let active = true
    void (embedded ? Promise.resolve(true) : isPlatformAdmin(client)).then(admin => {
      if (!active) return
      setAccess(admin ? 'admin' : 'denied')
      if (!admin) return
      reload()
      void client.from('tournaments').select('id,name,slug,sport,status,is_published,logo_path,cover_path').eq('is_published', true).order('updated_at', { ascending: false }).then(result => { if (active) setTournaments((result.data ?? []) as Array<Record<string, unknown>>) })
    })
    return () => { active = false }
  }, [client, user, reload, embedded])

  if (!user) return <section className="ed-page"><header className="ed-page-head"><p className="ed-eyebrow">Platform</p><h1>Sign in required</h1><p>Platform administration is only available to signed-in platform admins.</p></header></section>
  if (access === 'checking') return <section className="ed-page"><div className="loading-state">Checking access…</div></section>
  if (access === 'denied' || !client) return <section className="ed-page"><header className="ed-page-head"><p className="ed-eyebrow">Platform</p><h1>Not authorized</h1><p>This area is for Kulhivaru+ platform admins only. Admin rights are granted by the platform owner directly in the database, never through the app.</p></header><p className="lp-empty"><ShieldAlert size={16} /> If you are the owner: apply migration 027, then add your account to <code>platform_admins</code> in the Supabase SQL editor.</p></section>

  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    const result = await saveHighlight(client, user.id, draft, editingId ?? undefined)
    setBusy(false)
    if (result.error) return setError(result.error)
    onNotice(editingId ? 'Highlight updated.' : 'Highlight created.')
    setDraft(EMPTY_HIGHLIGHT); setEditingId(null); reload()
  }
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    setBusy(true); setError('')
    const result = await uploadHighlightImage(client, file)
    setBusy(false)
    if (result.error || !result.url) return setError(result.error ?? 'Upload failed.')
    setDraft(current => ({ ...current, imageUrl: result.url }))
  }
  const toggle = async (item: Highlight) => { const result = await setHighlightActive(client, item.id, !item.isActive); if (result.error) return setError(result.error); reload() }
  const remove = async (item: Highlight) => { const result = await deleteHighlight(client, item.id); if (result.error) return setError(result.error); onNotice('Highlight deleted.'); reload() }
  const edit = (item: Highlight) => { setEditingId(item.id); setDraft({ ...item }); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const tournamentMap = new Map(tournaments.map(row => [String(row.id), row]))
  const preview: Highlight = { ...draft, id: 'preview', title: draft.title || 'Your headline', updatedAt: null }

  return <section className="ed-page admin-page">
    <header className="ed-page-head"><p className="ed-eyebrow">Platform admin</p><h1>Homepage highlights</h1><p>Notices, sponsors, promoted tournaments and announcements shown in the homepage hero panel. Active items rotate by priority.</p></header>
    <div className="admin-grid">
      <form className="ed-panel admin-form" onSubmit={save}>
        <h2 className="ed-subhead">{editingId ? 'Edit highlight' : 'New highlight'}</h2>
        <label>Type<select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as HighlightKind })}>{HIGHLIGHT_KINDS.map(kind => <option key={kind} value={kind}>{HIGHLIGHT_KIND_LABELS[kind]}</option>)}</select></label>
        {draft.kind === 'tournament' && <label>Tournament<select value={draft.tournamentId ?? ''} onChange={event => setDraft({ ...draft, tournamentId: event.target.value || null })}><option value="">Choose a published tournament…</option>{tournaments.map(row => <option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select></label>}
        <label>Headline<input value={draft.title} maxLength={120} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>Text (optional)<textarea rows={3} maxLength={400} value={draft.body ?? ''} onChange={event => setDraft({ ...draft, body: event.target.value })} /></label>
        <div className="admin-image">
          <label>Image link (optional)<input value={draft.imageUrl ?? ''} placeholder="https://" onChange={event => setDraft({ ...draft, imageUrl: event.target.value })} /></label>
          <label className="ed-btn ed-btn-ghost ed-btn-sm admin-upload"><ImageUp size={15} /> Upload image<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={event => void upload(event)} /></label>
        </div>
        <div className="admin-row">
          <label>Button link (optional)<input value={draft.linkUrl ?? ''} placeholder="https://… or #tournament/…" onChange={event => setDraft({ ...draft, linkUrl: event.target.value })} /></label>
          <label>Button text<input value={draft.linkLabel ?? ''} maxLength={40} placeholder="Learn more" onChange={event => setDraft({ ...draft, linkLabel: event.target.value })} /></label>
        </div>
        <div className="admin-row">
          <label>Show from (optional)<input type="datetime-local" value={toLocalInput(draft.startsAt)} onChange={event => setDraft({ ...draft, startsAt: fromLocalInput(event.target.value) })} /></label>
          <label>Show until (optional)<input type="datetime-local" value={toLocalInput(draft.endsAt)} onChange={event => setDraft({ ...draft, endsAt: fromLocalInput(event.target.value) })} /></label>
        </div>
        <div className="admin-row">
          <label>Priority (higher shows first)<input type="number" value={draft.priority} onChange={event => setDraft({ ...draft, priority: Number(event.target.value) })} /></label>
          <label className="checkbox-row"><input type="checkbox" checked={draft.isActive} onChange={event => setDraft({ ...draft, isActive: event.target.checked })} /> Active</label>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="button-row"><button type="submit" className="ed-btn ed-btn-primary" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Create highlight'}</button>{editingId && <button type="button" className="ed-btn ed-btn-ghost" onClick={() => { setEditingId(null); setDraft(EMPTY_HIGHLIGHT) }}>Cancel</button>}</div>
      </form>
      <div className="admin-preview">
        <p className="ed-eyebrow">Preview</p>
        <div className="admin-preview-frame"><HeroHighlights highlights={[preview]} tournaments={tournamentMap} fallback={null} /></div>
      </div>
    </div>

    <h2 className="ed-subhead">All highlights</h2>
    {items.length === 0 ? <p className="lp-empty">No highlights yet. Until one is active, the homepage shows the featured tournament.</p>
      : <ul className="ws-tasks admin-list">{items.map(item => <li key={item.id}><span className="ws-task-static"><strong>{item.title}</strong><small>{HIGHLIGHT_KIND_LABELS[item.kind]} · {windowLabel(item)} · priority {item.priority}</small></span>
        <span className="button-row compact">
          <button type="button" className="ed-icon-btn" aria-label={item.isActive ? `Deactivate ${item.title}` : `Activate ${item.title}`} onClick={() => void toggle(item)}>{item.isActive ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          <button type="button" className="ed-icon-btn" aria-label={`Edit ${item.title}`} onClick={() => edit(item)}><Pencil size={15} /></button>
          <button type="button" className="ed-icon-btn" aria-label={`Delete ${item.title}`} onClick={() => void remove(item)}><Trash2 size={15} /></button>
        </span></li>)}</ul>}
    <h2 className="ed-subhead">Service announcements</h2>
    <AnnouncementsAdmin client={client} onNotice={onNotice} />
    <ContentReportsAdmin client={client} />
    <PlatformPagesAdmin client={client} onNotice={onNotice} />
    {!embedded && <><h2 className="ed-subhead">Player requests</h2>
    <PlayerRequestsReview client={client} scope={{ kind: 'admin' }} title="Profile, verification and account requests" /></>}
  </section>
}
