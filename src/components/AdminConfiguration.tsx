import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Settings2 } from 'lucide-react'
import {
  BUILT_IN_ATOLLS, cleanPlatform, parsePlaceLines, CONFIG_STATUS_LABELS, DOCUMENT_LIMIT_MB, FEATURE_FLAGS, FEATURE_LABELS, IMAGE_LIMIT_MB, LEGAL_LABELS, LEGAL_TOPICS, platformProblems, SPORT_KEYS_ALL,
  type ConfigKind, type ConfigVersion, type PlatformConfig,
} from '../lib/appConfig'
import { adminProblem, formatWhen } from '../lib/superAdmin'
import { loadVersions, saveDraft } from '../lib/configVersions'

import { sportName } from '../lib/display'
import { AdminEmpty, AdminError, AdminLoading, AdminNote, Pill, ReasonAction } from './AdminParts'

export function VersionHistory({ client, kind, me, canEdit, canPublish, canRollback, versions, onEdit, onChanged, onNotice, submitBlock }: {
  client: SupabaseClient; kind: ConfigKind; me: string; canEdit: boolean; canPublish: boolean; canRollback: boolean; versions: ConfigVersion[] | null
  onEdit: (version: ConfigVersion) => void; onChanged: () => void; onNotice: (message: string) => void; submitBlock?: (version: ConfigVersion) => string | null
}) {
  const act = async (name: string, args: Record<string, unknown>, done: string) => {
    const result = await client.rpc(name, args)
    if (result.error) return adminProblem(result.error.message)
    onNotice(done); onChanged(); return null
  }
  const submit = async (version: ConfigVersion) => {
    const blocked = submitBlock?.(version)
    if (blocked) return onNotice(blocked)
    const problem = await act('admin_submit_config', { p_id: version.id }, 'Sent for review.')
    if (problem) onNotice(problem)
  }
  const noun = kind === 'platform' ? 'configuration' : 'customization'
  return <section className="ed-panel adm-stack">
    <h3 className="ed-subhead">Version history</h3>
    {!versions ? <AdminLoading /> : versions.length === 0 ? <AdminEmpty>No versions yet. The built-in {noun} is in use.</AdminEmpty>
      : <ul className="adm-list">{versions.map(version => <li key={version.id} className="adm-list-row">
        <span className="adm-list-main"><strong>Version {version.version}: {version.summary}</strong>
          <span className="adm-pills"><Pill tone={version.status === 'published' ? 'ok' : version.status === 'in_review' ? 'warn' : version.status === 'rejected' ? 'danger' : 'neutral'}>{CONFIG_STATUS_LABELS[version.status] ?? version.status}</Pill>
            <small>{version.created_by === me ? 'Yours · ' : ''}updated {formatWhen(version.updated_at)}{version.published_at ? ` · published ${formatWhen(version.published_at)}` : ''}{version.rollback_of ? ` · rollback of version ${version.rollback_of}` : ''}</small></span>
          {version.review_note ? <small className="adm-cell-sub">Review: {version.review_note}</small> : null}
        </span>
        <span className="button-row compact">
          {canEdit && ['draft', 'rejected'].includes(version.status) && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => onEdit(version)}>Edit</button>}
          {canEdit && version.status === 'draft' && <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => void submit(version)}>Send for review</button>}
          {canPublish && version.status === 'in_review' && <><ReasonAction label="Approve" tone="primary" hint={version.created_by === me ? 'You made this version. Only a Platform Owner may approve their own; it is recorded as self-approved.' : undefined} onConfirm={note => act('admin_review_config', { p_id: version.id, p_approve: true, p_note: note }, 'Approved. Publish it when ready.')} /><ReasonAction label="Request changes" onConfirm={note => act('admin_review_config', { p_id: version.id, p_approve: false, p_note: note }, 'Changes requested.')} /></>}
          {canPublish && version.status === 'approved' && <ReasonAction label="Publish" tone="primary" hint="Replaces the live version in one step. The previous version stays in the history." onConfirm={reason => act('admin_publish_config', { p_id: version.id, p_reason: reason }, 'Published. Visitors see it on their next page load.')} />}
          {canRollback && version.status === 'superseded' && <ReasonAction label="Roll back to this" hint="Creates a new version with these settings; it is reviewed before publishing." onConfirm={reason => act('admin_rollback_config', { p_version: version.version, p_reason: reason }, 'Rollback version created and sent for review.')} />}
        </span>
      </li>)}</ul>}
  </section>
}

const placeLines = (items: Array<{ name: string; detail?: string }>) => items.map(item => item.detail ? `${item.name}, ${item.detail}` : item.name).join('\n')
const placeTextFor = (config: PlatformConfig) => ({ atolls: (config.places?.atolls ?? []).join('\n'), islands: placeLines((config.places?.islands ?? []).map(item => ({ name: item.name, detail: item.atoll }))), venues: placeLines((config.places?.venues ?? []).map(item => ({ name: item.name, detail: item.island }))) })

// Platform configuration: maintenance, feature display, help contacts, sports display,
// places, upload limits and legal versions.
// Changes are versioned and reviewed; they never change tournaments that already exist.
export function PlatformConfigPage({ client, me, onNotice }: { client: SupabaseClient; me: string; onNotice: (message: string) => void }) {
  const [versions, setVersions] = useState<ConfigVersion[] | null>(null)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<PlatformConfig>({})
  const [summary, setSummary] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = useCallback(() => { void loadVersions(client, 'platform').then(result => { setVersions(result.data); setError(result.error ?? '') }) }, [client])
  useEffect(() => { reload() }, [reload])
  const live = versions?.find(version => version.status === 'published') ?? null
  // Text areas keep what is typed; the parsed lists go into the draft.
  const [placeText, setPlaceText] = useState({ atolls: '', islands: '', venues: '' })
  const start = (version: ConfigVersion | null, id: string | null) => { const config = (version?.config ?? {}) as PlatformConfig; setDraft(config); setPlaceText(placeTextFor(config)); setEditingId(id); setSummary(id ? version?.summary ?? '' : ''); setFormError('') }
  const cleaned = cleanPlatform(draft)
  const problems = platformProblems(cleaned)
  const set = <K extends keyof PlatformConfig>(key: K, value: PlatformConfig[K]) => setDraft(current => ({ ...current, [key]: value }))
  const save = async () => {
    setFormError('')
    if (summary.trim().length < 3) return setFormError('Describe the change in a few words.')
    if (problems.length) return setFormError(problems[0])
    setBusy(true)
    const result = await saveDraft(client, 'platform', editingId, cleaned, summary.trim())
    setBusy(false)
    if (result.error) return setFormError(result.error)
    setEditingId(result.id); onNotice('Draft saved. The live platform has not changed.'); reload()
  }
  const maintenance = draft.maintenance ?? {}
  const hiddenSports = new Set(draft.sports?.hidden ?? [])
  const places = draft.places ?? {}
  const setPlaces = (key: 'atolls' | 'islands' | 'venues', text: string) => {
    setPlaceText(current => ({ ...current, [key]: text }))
    const lines = parsePlaceLines(text)
    set('places', { ...places, [key]: key === 'atolls' ? text.split('\n').map(line => line.trim()).filter(Boolean) : key === 'islands' ? lines.map(line => ({ name: line.name, atoll: line.detail })) : lines.map(line => ({ name: line.name, island: line.detail })) })
  }
  const legal = draft.legal ?? {}
  return <div className="adm-stack">
    <p className="adm-intro">Platform-wide settings. Every change is a reviewed, versioned draft; publishing switches it on for everyone in one step. These settings change what is shown, never permissions or existing tournaments.</p>
    {error ? <AdminError message={error} onRetry={reload} /> : null}
    <section className="ed-panel adm-stack">
      <div className="adm-toolbar"><h3 className="ed-subhead"><Settings2 size={16} /> {editingId ? 'Edit draft' : 'New draft'}</h3>
        <div className="button-row compact"><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => start(live, null)}>Start from live</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => start(null, null)}>Start from built-in</button></div></div>
      <div className="admin-form">
        <fieldset className="adm-fieldset"><legend>Maintenance mode</legend>
          <label className="checkbox-row"><input type="checkbox" checked={Boolean(maintenance.enabled)} onChange={event => set('maintenance', { ...maintenance, enabled: event.target.checked })} /> Show the maintenance page to visitors</label>
          <p className="adm-hint">Administrators keep working. Password reset and the help and legal pages stay available.</p>
          <label>Message (English)<input value={maintenance.message ?? ''} maxLength={200} onChange={event => set('maintenance', { ...maintenance, message: event.target.value })} /></label>
          <label>Message (Dhivehi)<input dir="rtl" value={maintenance.messageDv ?? ''} maxLength={200} onChange={event => set('maintenance', { ...maintenance, messageDv: event.target.value })} /></label>
          <label>Ends (optional, Maldives time)<input type="datetime-local" value={maintenance.endsAt ? maintenance.endsAt.slice(0, 16) : ''} onChange={event => set('maintenance', { ...maintenance, endsAt: event.target.value ? new Date(event.target.value).toISOString() : undefined })} /></label>
        </fieldset>
        <fieldset className="adm-fieldset"><legend>Feature display</legend>
          <p className="adm-hint">Turns optional features off for everyone. This changes what is shown, not who may do what.</p>
          <div className="adm-checks">{FEATURE_FLAGS.map(flag => <label key={flag} className="checkbox-row"><input type="checkbox" checked={draft.features?.[flag] !== false} onChange={event => set('features', { ...draft.features, [flag]: event.target.checked })} /> {FEATURE_LABELS[flag]}</label>)}</div>
        </fieldset>
        <fieldset className="adm-fieldset"><legend>Help contacts (shown in the footer)</legend>
          <div className="admin-row"><label>Email<input type="email" value={draft.help?.email ?? ''} onChange={event => set('help', { ...draft.help, email: event.target.value })} /></label><label>Phone<input value={draft.help?.phone ?? ''} maxLength={20} onChange={event => set('help', { ...draft.help, phone: event.target.value })} /></label></div>
          <label>Hours<input value={draft.help?.hours ?? ''} maxLength={80} placeholder="Sunday–Thursday, 9:00–17:00" onChange={event => set('help', { ...draft.help, hours: event.target.value })} /></label>
        </fieldset>
        <fieldset className="adm-fieldset"><legend>Sports shown</legend>
          <p className="adm-hint">Hiding a sport removes it from browsing and the footer. Existing tournaments and history are unchanged.</p>
          <div className="adm-checks">{SPORT_KEYS_ALL.map(sport => <label key={sport} className="checkbox-row"><input type="checkbox" checked={!hiddenSports.has(sport)} onChange={event => set('sports', { hidden: event.target.checked ? [...hiddenSports].filter(item => item !== sport) : [...hiddenSports, sport] })} /> {sportName(sport)}</label>)}</div>
        </fieldset>
        <fieldset className="adm-fieldset"><legend>Atolls, islands and venues</legend>
          <p className="adm-hint">Suggestions offered in island, atoll and venue fields across the app. People can still type another name. One per line.</p>
          <label>Atolls ({(places.atolls?.length ?? 0) || 'built-in list'})<textarea rows={4} value={placeText.atolls} placeholder={BUILT_IN_ATOLLS.join('\n')} onChange={event => setPlaces('atolls', event.target.value)} /></label>
          <label>Islands, with atoll after a comma ({places.islands?.length ?? 0})<textarea rows={4} value={placeText.islands} placeholder={'Hulhumalé, Kaafu\nKanditheemu, Shaviyani'} onChange={event => setPlaces('islands', event.target.value)} /></label>
          <label>Venues, with island after a comma ({places.venues?.length ?? 0})<textarea rows={4} value={placeText.venues} placeholder={'National Football Stadium, Malé'} onChange={event => setPlaces('venues', event.target.value)} /></label>
        </fieldset>
        <fieldset className="adm-fieldset"><legend>Upload size limits</legend>
          <p className="adm-hint">Lower limits for everyone. They cannot go above the storage limits ({IMAGE_LIMIT_MB} MB for images, {DOCUMENT_LIMIT_MB} MB for documents); a page whose own limit is lower keeps it.</p>
          <div className="admin-row">
            <label>Images (MB)<input type="number" min={1} max={IMAGE_LIMIT_MB} step={1} value={draft.uploads?.imageMb ?? IMAGE_LIMIT_MB} onChange={event => set('uploads', { ...draft.uploads, imageMb: event.target.value ? Number(event.target.value) : undefined })} /></label>
            <label>Documents (MB)<input type="number" min={1} max={DOCUMENT_LIMIT_MB} step={1} value={draft.uploads?.documentMb ?? DOCUMENT_LIMIT_MB} onChange={event => set('uploads', { ...draft.uploads, documentMb: event.target.value ? Number(event.target.value) : undefined })} /></label>
          </div>
        </fieldset>
        <fieldset className="adm-fieldset"><legend>Legal versions</legend>
          <p className="adm-hint">Shown at the top of each legal page. Leave the version empty to show none. The wording itself is edited under Operations → Public content.</p>
          <div className="adm-table-wrap"><table className="adm-table"><caption className="sr-only">Legal page versions</caption>
            <thead><tr><th scope="col">Page</th><th scope="col">Version</th><th scope="col">Effective from</th></tr></thead>
            <tbody>{LEGAL_TOPICS.map(topic => <tr key={topic}><td>{LEGAL_LABELS[topic]}</td>
              <td><input aria-label={`${LEGAL_LABELS[topic]} version`} value={legal[topic]?.version ?? ''} maxLength={12} placeholder="1.0" onChange={event => set('legal', { ...legal, [topic]: { ...legal[topic], version: event.target.value } })} /></td>
              <td><input type="date" aria-label={`${LEGAL_LABELS[topic]} effective date`} value={legal[topic]?.effective ?? ''} onChange={event => set('legal', { ...legal, [topic]: { version: legal[topic]?.version ?? '', effective: event.target.value || undefined } })} /></td></tr>)}</tbody>
          </table></div>
        </fieldset>
        <label>What changed<input value={summary} maxLength={300} onChange={event => setSummary(event.target.value)} /></label>
        {formError || problems.length ? <p className="form-error" role="alert">{formError || problems[0]}</p> : null}
        <div className="button-row compact"><button type="button" className="ed-btn ed-btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save draft'}</button></div>
      </div>
    </section>
    <AdminNote>Notification defaults are not configurable here yet. Legal page text is edited under Operations → Public content.</AdminNote>
    <VersionHistory client={client} kind="platform" me={me} canEdit canPublish canRollback versions={versions} onEdit={version => start(version, version.id)} onChanged={reload} onNotice={onNotice} />
  </div>
}
