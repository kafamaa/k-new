import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ExternalLink, Pencil, Trash2 } from 'lucide-react'
import {
  EDITABLE_PAGES, loadAllAnnouncements, loadAllPlatformPages, loadContentReports, removeAnnouncement, REPORT_REASONS, reportedHref, resolveContentReport, saveAnnouncement, savePlatformPage,
  type Announcement, type AnnouncementDraft, type ContentReport, type PlatformPage,
} from '../lib/landing'
import { formatDay } from '../lib/display'

const toLocalInput = (iso: string | null) => { if (!iso) return ''; const date = new Date(iso); return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
const fromLocalInput = (value: string) => value ? new Date(value).toISOString() : null
const EMPTY_ANNOUNCEMENT: AnnouncementDraft = { severity: 'warning', title: '', titleDv: '', body: '', bodyDv: '', linkUrl: '', linkLabel: '', startsAt: null, endsAt: null, isActive: false }
const SEVERITY_LABELS = { info: 'Notice', warning: 'Important', critical: 'Urgent' } as const

function announcementState(item: Announcement): string {
  const now = Date.now()
  if (!item.isActive) return 'Draft'
  if (item.startsAt && Date.parse(item.startsAt) > now) return 'Scheduled'
  if (item.endsAt && Date.parse(item.endsAt) <= now) return 'Ended'
  return 'Showing now'
}

// Service banner shown above the public header (migration 032).
export function AnnouncementsAdmin({ client, onNotice }: { client: SupabaseClient; onNotice: (message: string) => void }) {
  const [items, setItems] = useState<Announcement[]>([])
  const [draft, setDraft] = useState<AnnouncementDraft>(EMPTY_ANNOUNCEMENT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = useCallback(() => { void loadAllAnnouncements(client).then(result => { setItems(result.data); setError(result.error ?? '') }) }, [client])
  useEffect(() => { reload() }, [reload])
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true)
    const result = await saveAnnouncement(client, draft, editingId ?? undefined)
    setBusy(false)
    if (result.error) return setError(result.error)
    onNotice(editingId ? 'Announcement updated.' : 'Announcement created.'); setDraft(EMPTY_ANNOUNCEMENT); setEditingId(null); reload()
  }
  const remove = async (item: Announcement) => { const result = await removeAnnouncement(client, item.id); if (result.error) return setError(result.error); onNotice('Announcement deleted.'); reload() }
  return <>
    <form className="ed-panel admin-form" onSubmit={save}>
      <h2 className="ed-subhead">{editingId ? 'Edit announcement' : 'New service announcement'}</h2>
      <p className="pf-hint">Shown as a banner above the header on public pages, for postponements, cancellations, venue changes, deadline extensions or maintenance. Visitors can dismiss it; an urgent one returns when you update it.</p>
      <div className="admin-row">
        <label>Severity<select value={draft.severity} onChange={event => setDraft({ ...draft, severity: event.target.value as AnnouncementDraft['severity'] })}>{(['info', 'warning', 'critical'] as const).map(value => <option key={value} value={value}>{SEVERITY_LABELS[value]}</option>)}</select></label>
        <label className="checkbox-row"><input type="checkbox" checked={draft.isActive} onChange={event => setDraft({ ...draft, isActive: event.target.checked })} /> Active</label>
      </div>
      <label>Message (English)<input value={draft.title} maxLength={160} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Tonight’s futsal matches have been postponed." /></label>
      <label>Message (Dhivehi, optional)<input dir="rtl" value={draft.titleDv ?? ''} maxLength={160} onChange={event => setDraft({ ...draft, titleDv: event.target.value })} /></label>
      <label>Details (English, optional)<textarea rows={2} maxLength={400} value={draft.body ?? ''} onChange={event => setDraft({ ...draft, body: event.target.value })} /></label>
      <label>Details (Dhivehi, optional)<textarea dir="rtl" rows={2} maxLength={400} value={draft.bodyDv ?? ''} onChange={event => setDraft({ ...draft, bodyDv: event.target.value })} /></label>
      <div className="admin-row">
        <label>Related link (optional)<input value={draft.linkUrl ?? ''} placeholder="#tournament/… or https://" onChange={event => setDraft({ ...draft, linkUrl: event.target.value })} /></label>
        <label>Link text<input value={draft.linkLabel ?? ''} maxLength={40} placeholder="View Update" onChange={event => setDraft({ ...draft, linkLabel: event.target.value })} /></label>
      </div>
      <div className="admin-row">
        <label>Show from (optional)<input type="datetime-local" value={toLocalInput(draft.startsAt)} onChange={event => setDraft({ ...draft, startsAt: fromLocalInput(event.target.value) })} /></label>
        <label>Show until (optional)<input type="datetime-local" value={toLocalInput(draft.endsAt)} onChange={event => setDraft({ ...draft, endsAt: fromLocalInput(event.target.value) })} /></label>
      </div>
      {error && <div className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</div>}
      <div className="button-row"><button type="submit" className="ed-btn ed-btn-primary" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Create announcement'}</button>{editingId && <button type="button" className="ed-btn ed-btn-ghost" onClick={() => { setEditingId(null); setDraft(EMPTY_ANNOUNCEMENT) }}>Cancel</button>}</div>
    </form>
    {items.length > 0 && <ul className="ws-tasks admin-list">{items.map(item => <li key={item.id}><span className="ws-task-static"><strong>{item.title}</strong><small>{SEVERITY_LABELS[item.severity]} · {announcementState(item)}</small></span>
      <span className="button-row compact">
        <button type="button" className="ed-icon-btn" aria-label={`Edit ${item.title}`} onClick={() => { setEditingId(item.id); setDraft({ ...item }) }}><Pencil size={15} /></button>
        <button type="button" className="ed-icon-btn" aria-label={`Delete ${item.title}`} onClick={() => void remove(item)}><Trash2 size={15} /></button>
      </span></li>)}</ul>}
  </>
}

// Private moderation queue for public content reports.
// onOpenCase (Super Admin) turns a report into a tracked case.
export function ContentReportsAdmin({ client, onOpenCase }: { client: SupabaseClient; onOpenCase?: (reportId: string) => void }) {
  const [items, setItems] = useState<ContentReport[]>([])
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const reload = useCallback(() => { void loadContentReports(client).then(result => { setItems(result.data); setError(result.error ?? '') }) }, [client])
  useEffect(() => { reload() }, [reload])
  const decide = async (item: ContentReport, status: 'reviewing' | 'resolved' | 'dismissed') => {
    const result = await resolveContentReport(client, item.id, status, notes[item.id] ?? item.adminNote ?? '')
    if (result.error) return setError(result.error)
    reload()
  }
  const shown = items.filter(item => filter === 'all' || ['open', 'reviewing'].includes(item.status))
  return <div className="ed-panel admin-form">
    <div className="admin-row"><h2 className="ed-subhead">Content reports</h2><div className="ed-toggle" role="group" aria-label="Show">{(['open', 'all'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value === 'open' ? 'Waiting' : 'All'}</button>)}</div></div>
    <p className="pf-hint">Reports never change a record. Fix the record where it is managed, then mark the report resolved. Reporters are not shown here or anywhere public.</p>
    {error && <p className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</p>}
    {shown.length ? <ul className="pw-requests">{shown.map(item => <li key={item.id}>
      <div className="pw-request-head"><span className="pw-request-type">{item.entity} · {REPORT_REASONS.find(reason => reason.value === item.reason)?.label ?? item.reason} · {formatDay(item.createdAt)}</span><span className={`ps-doc-status status-${item.status}`}>{item.status}</span></div>
      <a className="ed-link" href={reportedHref(item)} target="_blank" rel="noopener noreferrer">{item.label ?? item.ref} <ExternalLink size={12} /></a>
      {item.details && <p className="pw-request-message">{item.details}</p>}
      {item.adminNote && <p className="pw-note-box">{item.adminNote}</p>}
      {['open', 'reviewing'].includes(item.status) && <div className="pw-inline-form">
        <label className="pf-field">Internal note<input value={notes[item.id] ?? ''} maxLength={1000} onChange={event => setNotes({ ...notes, [item.id]: event.target.value })} /></label>
        <div className="pw-actions">{onOpenCase && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => onOpenCase(item.id)}>Open case</button>}{item.status === 'open' && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => void decide(item, 'reviewing')}>Start review</button>}<button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={() => void decide(item, 'resolved')}>Resolved</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => void decide(item, 'dismissed')}>Dismiss</button></div>
      </div>}
    </li>)}</ul> : !error && <p className="pf-hint">No reports {filter === 'open' ? 'waiting' : 'yet'}.</p>}
  </div>
}

const PAGE_TITLES: Record<(typeof EDITABLE_PAGES)[number], string> = { privacy: 'Privacy', terms: 'Terms', 'community-guidelines': 'Community Guidelines', 'child-safety': 'Child Safety', contact: 'Contact', 'account-deletion': 'Account Deletion', 'image-consent': 'Image Publication and Consent', help: 'Help Centre', 'data-correction': 'Data Correction' }

// The owner's own text for the footer's legal and help pages.
export function PlatformPagesAdmin({ client, onNotice }: { client: SupabaseClient; onNotice: (message: string) => void }) {
  const [pages, setPages] = useState<PlatformPage[]>([])
  const [slug, setSlug] = useState<(typeof EDITABLE_PAGES)[number]>('privacy')
  const [draft, setDraft] = useState<Omit<PlatformPage, 'updatedAt'>>({ slug: 'privacy', title: PAGE_TITLES.privacy, body: '', bodyDv: '', isPublished: false })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = useCallback(() => { void loadAllPlatformPages(client).then(result => { setPages(result.data); setError(result.error ?? '') }) }, [client])
  useEffect(() => { reload() }, [reload])
  useEffect(() => { const existing = pages.find(page => page.slug === slug); setDraft(existing ? { ...existing } : { slug, title: PAGE_TITLES[slug], body: '', bodyDv: '', isPublished: false }) }, [slug, pages])
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true)
    const result = await savePlatformPage(client, draft)
    setBusy(false)
    if (result.error) return setError(result.error)
    onNotice('Page saved.'); reload()
  }
  return <form className="ed-panel admin-form" onSubmit={save}>
    <h2 className="ed-subhead">Help and legal pages</h2>
    <p className="pf-hint">Write these yourself. Until a page is published, the site says it has not been published; help pages explain how the platform works. Leave a blank line between paragraphs.</p>
    <div className="admin-row">
      <label>Page<select value={slug} onChange={event => setSlug(event.target.value as typeof slug)}>{EDITABLE_PAGES.map(value => <option key={value} value={value}>{PAGE_TITLES[value]}{pages.find(page => page.slug === value)?.isPublished ? ' · published' : ''}</option>)}</select></label>
      <label className="checkbox-row"><input type="checkbox" checked={draft.isPublished} onChange={event => setDraft({ ...draft, isPublished: event.target.checked })} /> Published</label>
    </div>
    <label>Title<input value={draft.title} maxLength={120} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
    <label>Text (English)<textarea rows={10} maxLength={20000} value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} /></label>
    <label>Text (Dhivehi, optional)<textarea dir="rtl" rows={6} maxLength={20000} value={draft.bodyDv ?? ''} onChange={event => setDraft({ ...draft, bodyDv: event.target.value })} /></label>
    {error && <div className={error.includes('migration') ? 'pending-note' : 'form-error'} role="alert">{error}</div>}
    <div className="button-row"><button type="submit" className="ed-btn ed-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save page'}</button><a className="ed-btn ed-btn-ghost" href={`#info/${slug}`} target="_blank" rel="noopener noreferrer">Open page <ExternalLink size={14} /></a></div>
  </form>
}
