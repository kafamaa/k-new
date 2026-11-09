import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowLeft, BellRing, CircleCheck, FileText, Globe2, Heart, ImageUp, KeyRound, LogOut, Mail, MapPin, MonitorSmartphone, UserRound } from 'lucide-react'
import { followHref, FOLLOW_LABELS, loadMyFollows, setFollowing, type FollowRow } from '../lib/publicExtras'
import { loadNotificationPreferences, NOTIFICATION_CATEGORIES, saveNotificationPreferences, type NotificationPreferences } from '../lib/playerHub'
import { supabase } from '../lib/supabase'
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type Language } from '../lib/i18n'
import { imageLimit, sizeLabel } from '../lib/appConfig'
import { PublicPeopleSettings } from './PublicPeopleSettings'
import { ConfirmAction } from './ConfirmAction'

// Account Settings: the login account, kept apart from any sports profile.
// Player, team and organizer details are edited in their own workspaces.
// Errors are shown in plain words; raw service messages are not.
function plain(message: string): string {
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Please wait a minute and try again.'
  if (/weak|short|at least/i.test(message)) return 'Choose a longer password (at least 8 characters).'
  if (/reauthent|recent/i.test(message)) return 'For your security, sign in again before changing this.'
  if (/invalid.*email|email.*invalid/i.test(message)) return 'Enter a valid email address.'
  return 'This could not be saved. Please try again.'
}

export function AccountSettings({ user, language, onLanguage, onSignIn, onNotice }: { user: User | null; language: Language; onLanguage: (language: Language) => void; onSignIn: () => void; onNotice: (message: string) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ field: string; text: string } | null>(null)
  const [prefs, setPrefs] = useState<{ data: NotificationPreferences; available: boolean } | null>(null)
  const [avatar, setAvatar] = useState<string | null>(null)
  const [place, setPlace] = useState<{ island: string; atoll: string; available: boolean }>({ island: '', atoll: '', available: true })
  const [follows, setFollows] = useState<{ data: FollowRow[]; error: string | null } | null>(null)
  useEffect(() => { document.title = 'Account Settings · Kulhivaru+' }, [])
  useEffect(() => { if (!supabase || !user) return; let active = true; void loadNotificationPreferences(supabase, user.id).then(result => { if (active) setPrefs(result) }); return () => { active = false } }, [user])
  useEffect(() => {
    if (!supabase || !user) return
    let active = true
    setEmail(user.email ?? '')
    void supabase.from('profiles').select('display_name,avatar_url').eq('id', user.id).maybeSingle().then(result => { if (!active) return; setName(String(result.data?.display_name ?? user.user_metadata?.full_name ?? '')); setAvatar(result.data?.avatar_url ? String(result.data.avatar_url) : null) })
    // Island and atoll need migration 202611010037; without it the card explains that.
    void supabase.from('profiles').select('island,atoll').eq('id', user.id).maybeSingle().then(result => { if (active) setPlace(result.error ? { island: '', atoll: '', available: false } : { island: String(result.data?.island ?? ''), atoll: String(result.data?.atoll ?? ''), available: true }) })
    void loadMyFollows(supabase).then(result => { if (active) setFollows(result) })
    return () => { active = false }
  }, [user])

  if (!user || !supabase) return <section className="ed-page acc-page"><header className="ed-page-head"><p className="ed-eyebrow">Account</p><h1>Sign in to manage your account</h1><p>Account Settings are available after you sign in.</p></header><button type="button" className="ed-btn ed-btn-primary" onClick={onSignIn}>Sign in</button></section>
  const client = supabase
  const run = async (field: string, action: () => Promise<{ error: { message: string } | null }>, done: string) => {
    setBusy(field); setError(null)
    const result = await action()
    setBusy(null)
    if (result.error) return setError({ field, text: plain(result.error.message) })
    onNotice(done)
  }
  const saveName = (event: FormEvent) => { event.preventDefault(); if (!name.trim()) return setError({ field: 'name', text: 'Enter your name.' }); void run('name', async () => (await client.from('profiles').update({ display_name: name.trim() }).eq('id', user.id)), 'Your account name was saved.') }
  const saveEmail = (event: FormEvent) => { event.preventDefault(); if (email.trim() === user.email) return; void run('email', async () => (await client.auth.updateUser({ email: email.trim() })), 'Check both inboxes: confirm the change from the link we sent.') }
  const savePassword = (event: FormEvent) => { event.preventDefault(); if (password.length < 8) return setError({ field: 'password', text: 'Choose a longer password (at least 8 characters).' }); void run('password', async () => (await client.auth.updateUser({ password })), 'Your password was changed.').then(() => setPassword('')) }
  const signOutOthers = () => void run('sessions', async () => (await client.auth.signOut({ scope: 'others' })), 'You were signed out on your other devices.')
  // Preferences apply to every workspace of this account.
  const savePrefs = async (next: NotificationPreferences) => { const previous = prefs; setPrefs({ data: next, available: true }); const result = await saveNotificationPreferences(client, user.id, next); if (result.error) { setPrefs(previous); setError({ field: 'prefs', text: result.error.includes('migration') ? 'Notification preferences need migration 030.' : 'Your preferences could not be saved.' }) } else onNotice('Notification preferences saved.') }
  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setError({ field: 'avatar', text: 'Use a PNG, JPEG or WebP image.' })
    if (file.size > imageLimit(2 * 1024 * 1024)) return setError({ field: 'avatar', text: `Choose an image of ${sizeLabel(imageLimit(2 * 1024 * 1024))} or less.` })
    setBusy('avatar'); setError(null)
    const path = `accounts/${user.id}/avatar-${Date.now().toString(36)}.${file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'}`
    const stored = await client.storage.from('public-media').upload(path, file, { contentType: file.type, upsert: false })
    if (stored.error) { setBusy(null); return setError({ field: 'avatar', text: 'The photo could not be uploaded. Please try again.' }) }
    const url = client.storage.from('public-media').getPublicUrl(path).data.publicUrl
    const saved = await client.from('profiles').update({ avatar_url: url }).eq('id', user.id)
    setBusy(null)
    if (saved.error) return setError({ field: 'avatar', text: 'The photo could not be saved. Please try again.' })
    setAvatar(url); onNotice('Account photo updated.')
  }
  const removeAvatar = async () => {
    setBusy('avatar'); setError(null)
    const result = await client.from('profiles').update({ avatar_url: null }).eq('id', user.id)
    setBusy(null)
    if (result.error) return setError({ field: 'avatar', text: 'The photo could not be removed. Please try again.' })
    setAvatar(null); onNotice('Account photo removed.')
  }
  const savePlace = (event: FormEvent) => { event.preventDefault(); void run('place', async () => (await client.from('profiles').update({ island: place.island.trim() || null, atoll: place.atoll.trim() || null }).eq('id', user.id)), 'Location saved.') }
  const unfollow = async (row: FollowRow) => {
    const result = await setFollowing(client, user.id, row.entity_type, row.entity_id, false)
    if (result.error) return setError({ field: 'follows', text: result.error })
    setFollows(current => current ? { ...current, data: current.data.filter(item => !(item.entity_type === row.entity_type && item.entity_id === row.entity_id)) } : current)
    onNotice(`Stopped following ${row.label}.`)
  }
  const fieldError = (field: string) => error?.field === field ? <p className="form-error" role="alert">{error.text}</p> : null

  return <section className="ed-page acc-page">
    <a className="back-link public-back" href="#workspace"><ArrowLeft size={14} /> Back to workspaces</a>
    <header className="ed-page-head"><p className="ed-eyebrow">Account</p><h1>Account Settings</h1><p>Your sign-in account. Your player profile, teams and organizations are edited in their own workspaces.</p></header>
    <div className="acc-grid">
      <form className="pf-card" onSubmit={saveName}>
        <header className="pf-card-head"><span className="pf-card-icon"><UserRound size={18} /></span><div><h3>Account name</h3><p>Shown to people you work with in workspaces</p></div></header>
        <label className="pf-field">Name<input value={name} maxLength={80} autoComplete="name" onChange={event => setName(event.target.value)} /></label>
        {fieldError('name')}
        <footer className="pf-card-foot"><button type="submit" className="ed-btn ed-btn-primary" disabled={busy === 'name'}>{busy === 'name' ? 'Saving…' : 'Save name'}</button></footer>
      </form>
      <section className="pf-card">
        <header className="pf-card-head"><span className="pf-card-icon"><ImageUp size={18} /></span><div><h3>Account photo</h3><p>Shown in your account menu. Your player photo is set in the Player Workspace.</p></div></header>
        <div className="px-avatar-row">{avatar ? <img className="px-avatar" src={avatar} alt="Your account photo" width={64} height={64} /> : <span className="px-avatar px-avatar-empty" aria-hidden="true">{(name || user.email || '?').trim().charAt(0).toUpperCase()}</span>}
          <label className="ed-btn ed-btn-ghost">{busy === 'avatar' ? 'Uploading…' : 'Upload photo'}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={event => { void uploadAvatar(event.target.files?.[0]); event.target.value = '' }} /></label>
          {avatar ? <ConfirmAction className="ed-link-btn" label="Remove photo" question="Remove your account photo?" onConfirm={async () => { await removeAvatar() }} /> : null}</div>
        {fieldError('avatar')}
      </section>
      <form className="pf-card" onSubmit={savePlace}>
        <header className="pf-card-head"><span className="pf-card-icon"><MapPin size={18} /></span><div><h3>Island and atoll</h3><p>Private to your account.</p></div></header>
        {!place.available ? <p className="pending-note">Island and atoll need migration 202611010037.</p> : <>
          <label className="pf-field">Island<input value={place.island} list="kv-islands" maxLength={80} onChange={event => setPlace({ ...place, island: event.target.value })} placeholder="e.g. Hulhumalé" /></label>
          <label className="pf-field">Atoll<input value={place.atoll} list="kv-atolls" maxLength={40} onChange={event => setPlace({ ...place, atoll: event.target.value })} placeholder="e.g. Kaafu" /></label>
          {fieldError('place')}
          <footer className="pf-card-foot"><button type="submit" className="ed-btn ed-btn-primary" disabled={busy === 'place'}>{busy === 'place' ? 'Saving…' : 'Save location'}</button></footer></>}
      </form>
      <section className="pf-card">
        <header className="pf-card-head"><span className="pf-card-icon"><Heart size={18} /></span><div><h3>Following</h3><p>Tournaments, teams, players and organizations you follow. Nobody else can see this list.</p></div></header>
        {!follows ? <p className="pf-hint">Loading…</p> : follows.error ? <p className={follows.error.includes('migration') ? 'pending-note' : 'form-error'}>{follows.error}</p> : follows.data.length === 0 ? <p className="pf-hint">You are not following anything yet. Use Follow on a tournament, team, player or organization page.</p>
          : <ul className="pw-toggles">{follows.data.map(row => <li key={`${row.entity_type}-${row.entity_id}`}><span>{row.available ? <a href={followHref(row)}>{row.label}</a> : row.label} <small className="pf-hint">{FOLLOW_LABELS[row.entity_type]}</small></span><button type="button" className="ed-link-btn" onClick={() => void unfollow(row)}>Unfollow</button></li>)}</ul>}
        {fieldError('follows')}
      </section>
      <PublicPeopleSettings client={supabase} onNotice={onNotice} />
      <form className="pf-card" onSubmit={saveEmail}>
        <header className="pf-card-head"><span className="pf-card-icon"><Mail size={18} /></span><div><h3>Email</h3><p>{user.email_confirmed_at ? <><CircleCheck size={13} /> Verified</> : 'Not verified yet: open the confirmation email we sent'}</p></div></header>
        <label className="pf-field">Email address<input type="email" value={email} autoComplete="email" onChange={event => setEmail(event.target.value)} /></label>
        {fieldError('email')}
        <footer className="pf-card-foot"><button type="submit" className="ed-btn ed-btn-primary" disabled={busy === 'email' || email.trim() === user.email}>{busy === 'email' ? 'Sending…' : 'Change email'}</button></footer>
      </form>
      <form className="pf-card" onSubmit={savePassword}>
        <header className="pf-card-head"><span className="pf-card-icon"><KeyRound size={18} /></span><div><h3>Password</h3><p>At least 8 characters</p></div></header>
        <label className="pf-field">New password<input type="password" value={password} autoComplete="new-password" onChange={event => setPassword(event.target.value)} /></label>
        {fieldError('password')}
        <footer className="pf-card-foot"><button type="submit" className="ed-btn ed-btn-primary" disabled={busy === 'password' || !password}>{busy === 'password' ? 'Saving…' : 'Change password'}</button></footer>
      </form>
      <section className="pf-card">
        <header className="pf-card-head"><span className="pf-card-icon"><Globe2 size={18} /></span><div><h3>Language</h3><p>Used across Kulhivaru+ on this device</p></div></header>
        <div className="pw-segments" role="radiogroup" aria-label="Language">{SUPPORTED_LANGUAGES.map(item => <button type="button" role="radio" key={item} aria-checked={language === item} className={language === item ? 'active' : ''} onClick={() => onLanguage(item)}>{LANGUAGE_LABELS[item]}</button>)}</div>
      </section>
      <section className="pf-card">
        <header className="pf-card-head"><span className="pf-card-icon"><BellRing size={18} /></span><div><h3>Notifications</h3><p>For all your workspaces</p></div></header>
        {!prefs ? <p className="pf-hint">Loading…</p> : !prefs.available ? <p className="pending-note">Notification preferences need migration 030.</p> : <ul className="pw-toggles">
          {NOTIFICATION_CATEGORIES.map(item => { const on = !prefs.data.mutedCategories.includes(item.value); return <li key={item.value}><span>{item.label}</span><button type="button" role="switch" aria-checked={on} aria-label={item.label} className={`pw-switch${on ? ' on' : ''}`} onClick={() => void savePrefs({ ...prefs.data, mutedCategories: on ? [...prefs.data.mutedCategories, item.value] : prefs.data.mutedCategories.filter(value => value !== item.value) })}><span /></button></li> })}
          <li><span>Email copies (when email is configured)</span><button type="button" role="switch" aria-checked={prefs.data.emailEnabled} aria-label="Email copies" className={`pw-switch${prefs.data.emailEnabled ? ' on' : ''}`} onClick={() => void savePrefs({ ...prefs.data, emailEnabled: !prefs.data.emailEnabled })}><span /></button></li>
        </ul>}
        {fieldError('prefs')}
      </section>
      <section className="pf-card">
        <header className="pf-card-head"><span className="pf-card-icon"><FileText size={18} /></span><div><h3>Your data</h3><p>Corrections, a copy of your data, or closing your account</p></div></header>
        <p className="pf-hint">Players send these from Player Workspace → More → Privacy &amp; Help, so they reach the right reviewer with your records attached. Closing an account never deletes official match history.</p>
        <div className="pw-actions"><a className="ed-btn ed-btn-ghost ed-btn-sm" href="#workspace/player?section=more&amp;tab=privacy">Open privacy requests</a><a className="ed-btn ed-btn-ghost ed-btn-sm" href="#info/data-correction">Data correction</a><a className="ed-btn ed-btn-ghost ed-btn-sm" href="#info/account-deletion">Account deletion</a></div>
      </section>
      <section className="pf-card">
        <header className="pf-card-head"><span className="pf-card-icon"><MonitorSmartphone size={18} /></span><div><h3>Active sessions</h3><p>Signed in on a phone or computer you no longer use?</p></div></header>
        {fieldError('sessions')}
        <button type="button" className="ed-btn ed-btn-ghost" disabled={busy === 'sessions'} onClick={signOutOthers}><LogOut size={15} /> Sign out on other devices</button>
      </section>
    </div>
  </section>
}
