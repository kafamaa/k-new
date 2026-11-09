import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Camera, Dumbbell, Facebook, Instagram, Link2, Loader2, Music2, Twitter, Youtube } from 'lucide-react'
import { EMPTY_EXTRAS, loadProfileExtras, PHOTO_TYPES, removePlayerPhoto, saveProfileExtras, SOCIAL_PLATFORMS, uploadPlayerPhoto, validatePhoto, type ProfileExtras, type SocialKey } from '../lib/playerProfileExtras'
import { ConfirmAction } from './ConfirmAction'
import { PersonAvatar } from './HomeArt'

const SIDES: Array<[ProfileExtras['preferredSide'], string]> = [['', 'Not set'], ['right', 'Right'], ['left', 'Left'], ['both', 'Both']]
const SOCIAL_MARKS: Record<SocialKey, ReactNode> = { instagram: <Instagram size={16} />, facebook: <Facebook size={16} />, tiktok: <Music2 size={16} />, x: <Twitter size={16} />, youtube: <Youtube size={16} /> }

// Profile photo: choose or drop a file, see it immediately, upload to storage.
// There is no link field; the stored URL always points at our own bucket.
// `compact` drops the heading for use inside the profile hero.
export function ProfilePhotoEditor({ client, userId, playerId, name, photoUrl, onChanged, compact = false }: { client: SupabaseClient; userId: string; playerId: string; name: string; photoUrl: string | null; onChanged: (url: string | null) => void; compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [path, setPath] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let active = true
    void client.from('player_profiles').select('photo_path').eq('id', playerId).maybeSingle().then(result => { if (active && !result.error) setPath(typeof result.data?.photo_path === 'string' ? result.data.photo_path : null) })
    return () => { active = false }
  }, [client, playerId])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const handle = async (file: File | null | undefined) => {
    if (!file) return
    setError(''); setNotice('')
    const problem = validatePhoto(file)
    if (problem) return setError(problem)
    setPreview(URL.createObjectURL(file))
    setBusy(true)
    const result = await uploadPlayerPhoto(client, userId, playerId, file, path)
    setBusy(false)
    if (result.error || !result.url) { setPreview(null); return setError(result.error ?? 'Upload failed.') }
    setPath(result.path); setNotice('Photo updated.'); onChanged(result.url)
  }
  const onInput = (event: ChangeEvent<HTMLInputElement>) => { void handle(event.target.files?.[0]); event.target.value = '' }
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); void handle(event.dataTransfer.files?.[0]) }
  const remove = async () => {
    setBusy(true); setError(''); setNotice('')
    const result = await removePlayerPhoto(client, userId, playerId, path)
    setBusy(false)
    if (result.error) return setError(result.error)
    setPath(null); setPreview(null); setNotice('Photo removed.'); onChanged(null)
  }

  const shown = preview ?? photoUrl
  return <section className={`pp-photo${compact ? ' compact' : ''}`} aria-label="Profile photo">
    <div className={`pp-photo-drop${dragging ? ' dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <button type="button" className="pp-photo-frame" onClick={() => inputRef.current?.click()} disabled={busy} aria-label="Choose a new profile photo">
        {shown ? <img src={shown} alt={`${name} profile photo`} /> : <span aria-hidden="true"><PersonAvatar /></span>}
        <span className="pp-photo-badge">{busy ? <Loader2 className="spin" size={16} /> : <Camera size={16} />}</span>
      </button>
      <div className="pp-photo-text">
        {!compact && <strong>Profile photo</strong>}
        <small>{compact ? 'PNG, JPG or WebP · max 5 MB' : 'PNG, JPG or WebP, up to 5 MB. A clear, front-facing photo works best on your player card.'}</small>
        <div className="button-row compact">
          <button type="button" className="ed-btn ed-btn-primary ed-btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}><Camera size={14} /> {photoUrl ? 'Change photo' : 'Upload photo'}</button>
          {photoUrl && <ConfirmAction className="ed-btn ed-btn-ghost ed-btn-sm" disabled={busy} label="Remove photo" question="Remove your photo? Your initials are shown instead." onConfirm={async () => { await remove() }} />}
        </div>
        <input ref={inputRef} type="file" accept={PHOTO_TYPES.join(',')} className="sr-only" onChange={onInput} aria-label="Profile photo file" />
        {error && <span className="form-error-inline" role="alert">{error}</span>}
        {notice && <span className="publication-notice" role="status">{notice}</span>}
      </div>
    </div>
  </section>
}

// Sports details, biography and social media links.
// bioHidden: the biography was moved to private storage from Privacy & Help,
// so it is not edited here until it is shown again.
export function ProfileExtrasEditor({ client, userId, playerId, onSaved, bioHidden = false }: { client: SupabaseClient; userId: string; playerId: string; onSaved?: () => void; bioHidden?: boolean }) {
  const [extras, setExtras] = useState<ProfileExtras>(EMPTY_EXTRAS)
  const [available, setAvailable] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    void loadProfileExtras(client, playerId).then(result => { if (!active) return; setExtras(result.data); setAvailable(result.available); if (result.error) setError(result.error); setLoaded(true) })
    return () => { active = false }
  }, [client, playerId])

  const save = async () => {
    setBusy(true); setError(''); setNotice('')
    const result = await saveProfileExtras(client, userId, playerId, extras)
    setBusy(false)
    if (result.error) return setError(result.error)
    setExtras({ ...extras, socialLinks: result.links }); setNotice('Profile details saved.'); onSaved?.()
  }

  if (!loaded) return null
  if (!available) return <p className="pending-note">Atoll, preferred side, jersey number, biography and social links become editable once migration 028 is applied.</p>
  return <section className="pf-card">
    <header className="pf-card-head"><span className="pf-card-icon"><Dumbbell size={18} /></span><div><h3>Player details</h3><p>Shown on your card and public page.</p></div></header>
    <div className="pf-fields">
      <label className="pf-field">Atoll<input value={extras.atoll} list="kv-atolls" maxLength={60} onChange={event => setExtras({ ...extras, atoll: event.target.value })} placeholder="e.g. Shaviyani" /></label>
      <label className="pf-field">Jersey number<input inputMode="numeric" value={extras.jerseyNumber} maxLength={2} onChange={event => setExtras({ ...extras, jerseyNumber: event.target.value.replace(/\D/g, '') })} placeholder="0–99" /></label>
      <div className="pf-field pf-wide" role="group" aria-label="Preferred foot or hand">Preferred foot / hand
        <div className="pf-segment">{SIDES.map(([value, label]) => <button key={value} type="button" className={extras.preferredSide === value ? 'active' : ''} aria-pressed={extras.preferredSide === value} onClick={() => setExtras({ ...extras, preferredSide: value })}>{label}</button>)}</div>
      </div>
      {bioHidden ? <p className="pf-field pf-wide pf-hint">Your biography is hidden from the public and stored privately. Show it again in Privacy & Help to edit it.</p>
        : <label className="pf-field pf-wide">Short public biography<textarea rows={4} maxLength={400} value={extras.bio} onChange={event => setExtras({ ...extras, bio: event.target.value })} placeholder="A few lines about you as a player" /><small className="pf-counter">{extras.bio.length}/400</small></label>}
    </div>
    <div className="pf-divider" />
    <h4 className="pf-subhead"><Link2 size={15} /> Social media</h4>
    <p className="pf-hint">Shown on your public profile when it is published. Paste your profile link or just your username.</p>
    <div className="pf-social">
      {SOCIAL_PLATFORMS.map(platform => <label key={platform.key} className="pf-social-row"><span className={`pf-social-badge social-${platform.key}`} aria-hidden="true">{SOCIAL_MARKS[platform.key]}</span><span className="sr-only">{platform.label}</span><input value={extras.socialLinks[platform.key] ?? ''} onChange={event => setExtras({ ...extras, socialLinks: { ...extras.socialLinks, [platform.key]: event.target.value } })} placeholder={platform.example} autoComplete="off" aria-label={platform.label} /></label>)}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="publication-notice" role="status">{notice}</p>}
    <footer className="pf-card-foot"><button type="button" className="ed-btn ed-btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save player details'}</button></footer>
  </section>
}
