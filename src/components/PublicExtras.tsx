import { useEffect, useState } from 'react'
import { CalendarPlus, Heart, Printer } from 'lucide-react'
import { publicSupabase, supabase } from '../lib/supabase'
import { loadMatchFeed, type FeedMatch } from '../lib/landing'
import { calendarFile, isFollowing, safeFileName, setFollowing, type CalendarEvent, type FollowType } from '../lib/publicExtras'
import { downloadBlob } from '../lib/cardImage'

// Follow a published record. Signed out, the button explains that following needs an account.
export function FollowButton({ type, id, name }: { type: FollowType; id: string; name: string }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [state, setState] = useState<{ following: boolean; available: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!supabase || !id) return
    let active = true
    void supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user.id ?? null
      if (!active) return
      setUserId(uid)
      if (uid && supabase) { const result = await isFollowing(supabase, uid, type, id); if (active) setState(result) }
    })
    return () => { active = false }
  }, [type, id])
  if (state && !state.available) return null
  const toggle = async () => {
    if (!supabase) return
    if (!userId) { setMessage('Sign in to follow and see it in Account Settings.'); return }
    setBusy(true); setMessage('')
    const next = !state?.following
    const result = await setFollowing(supabase, userId, type, id, next)
    setBusy(false)
    if (result.error) return setMessage(result.error)
    setState({ following: next, available: true })
    setMessage(next ? `Following ${name}.` : `Stopped following ${name}.`)
  }
  const following = Boolean(state?.following)
  return <span className="px-follow">
    <button type="button" className={`ed-btn ${following ? 'ed-btn-primary' : 'ed-btn-ghost'}`} aria-pressed={following} disabled={busy} onClick={() => void toggle()}><Heart size={15} aria-hidden="true" fill={following ? 'currentColor' : 'none'} /> {following ? 'Following' : 'Follow'}</button>
    {message ? <small role="status">{message}</small> : null}
  </span>
}

// Download a calendar file for the given events (Maldives times are stored as UTC instants).
export function CalendarButton({ name, events, label = 'Add to calendar' }: { name: string; events: CalendarEvent[]; label?: string }) {
  const file = calendarFile(name, events)
  if (!file) return null
  return <button type="button" className="ed-btn ed-btn-ghost" onClick={() => downloadBlob(new Blob([file], { type: 'text/calendar;charset=utf-8' }), `${safeFileName(name)}.ics`)}><CalendarPlus size={15} aria-hidden="true" /> {label}{events.length > 1 ? ` (${events.length})` : ''}</button>
}

export function PrintButton() {
  return <button type="button" className="ed-btn ed-btn-ghost px-no-print" onClick={() => window.print()}><Printer size={15} aria-hidden="true" /> Print</button>
}

export function FormGuide({ form }: { form: Array<'W' | 'D' | 'L'> }) {
  if (!form.length) return null
  const words = { W: 'Win', D: 'Draw', L: 'Loss' }
  return <span className="px-form" aria-label={`Recent form, newest first: ${form.map(item => words[item]).join(', ')}`}>{form.map((item, index) => <b key={index} className={`px-form-${item}`} aria-hidden="true">{item}</b>)}</span>
}

// Upcoming published fixtures (a tournament's, or one team's) as one calendar file,
// plus a notice when any of them is postponed. Reads the public match feed only.
export function FixturesCalendar({ name, tournamentId, teamId }: { name: string; tournamentId?: string; teamId?: string }) {
  const [matches, setMatches] = useState<FeedMatch[] | null>(null)
  useEffect(() => {
    if (!publicSupabase) return
    let active = true
    void loadMatchFeed(publicSupabase, { statuses: ['scheduled', 'postponed', 'live'], from: new Date(Date.now() - 3 * 3600_000).toISOString(), tournamentId, limit: 200 }).then(result => {
      if (!active) return
      setMatches((result.data ?? []).filter(match => !teamId || match.home.id === teamId || match.away.id === teamId))
    })
    return () => { active = false }
  }, [tournamentId, teamId])
  if (!matches?.length) return null
  const postponed = matches.filter(match => match.status === 'postponed').length
  const events: CalendarEvent[] = matches.filter(match => match.status !== 'postponed' && match.scheduledAt).map(match => ({
    uid: match.id, title: `${match.home.name ?? 'To be decided'} vs ${match.away.name ?? 'To be decided'}`, start: match.scheduledAt as string,
    location: match.venue, description: [match.tournamentName, match.stageName].filter(Boolean).join(' · '), url: `${window.location.origin}${window.location.pathname}#matches/${match.id}`,
  }))
  return <span className="px-calendar">
    <CalendarButton name={`${name} fixtures`} events={events} label="Download fixtures" />
    {postponed ? <small className="px-alert" role="status">{postponed} upcoming fixture{postponed === 1 ? ' is' : 's are'} postponed.</small> : null}
  </span>
}
