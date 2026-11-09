import { useEffect, useState } from 'react'
import { AlertOctagon, AlertTriangle, ArrowRight, Info, X } from 'lucide-react'
import { dismissalKey, dismissAnnouncement, loadLiveAnnouncements, readDismissed, type Announcement } from '../lib/landing'
import { publicSupabase } from '../lib/supabase'
import type { Language } from '../lib/i18n'

const SEVERITY = {
  info: { icon: Info, label: 'Notice' },
  warning: { icon: AlertTriangle, label: 'Important' },
  critical: { icon: AlertOctagon, label: 'Urgent' },
} as const

// Service announcement above the header: only active announcements inside
// their publication window, highest severity first. Dismissal is remembered in
// this browser; a critical one comes back when it is materially updated.
export function AnnouncementBanner({ language }: { language: Language }) {
  const [items, setItems] = useState<Announcement[]>([])
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed())
  useEffect(() => {
    if (!publicSupabase) return
    let active = true
    const load = () => void loadLiveAnnouncements(publicSupabase!).then(list => { if (active) setItems(list) })
    load()
    const timer = window.setInterval(load, 5 * 60_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  const item = items.find(entry => !dismissed.includes(dismissalKey(entry)))
  if (!item) return null
  const { icon: Icon, label } = SEVERITY[item.severity]
  const dv = language === 'dv'
  const title = dv && item.titleDv ? item.titleDv : item.title
  const body = dv && item.bodyDv ? item.bodyDv : item.body
  const external = Boolean(item.linkUrl?.startsWith('https://'))
  return <div className={`lp-announce lp-announce-${item.severity}`} role={item.severity === 'critical' ? 'alert' : 'status'} dir={dv && item.titleDv ? 'rtl' : undefined}>
    <span className="lp-announce-badge"><Icon size={16} aria-hidden="true" /> {label}</span>
    <p><strong>{title}</strong>{body ? <span> {body}</span> : null}</p>
    {item.linkUrl && <a className="lp-announce-link" href={item.linkUrl} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{item.linkLabel || 'View Update'} <ArrowRight size={14} /></a>}
    <button type="button" className="lp-announce-close" aria-label="Dismiss announcement" onClick={() => { dismissAnnouncement(item); setDismissed(readDismissed()) }}><X size={16} /></button>
  </div>
}
