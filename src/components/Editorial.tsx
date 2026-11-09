import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, Check, Share2, X } from 'lucide-react'
import { monogram } from '../lib/display'

// Shared building blocks for the Liquid Glass Sports Editorial layout. Every
// page composes these so spacing, headings, rows and chips stay consistent.

export function EdSection({ id, eyebrow, title, action, children, tone }: { id?: string; eyebrow?: string; title: string; action?: { label: string; href: string }; children: ReactNode; tone?: 'tint' | 'dark' }) {
  return <section className={`ed-section${tone ? ` ed-section-${tone}` : ''}`} id={id} aria-labelledby={id ? `${id}-title` : undefined}>
    <header className="ed-section-head">
      <div>{eyebrow && <p className="ed-eyebrow">{eyebrow}</p>}<h2 id={id ? `${id}-title` : undefined}>{title}</h2></div>
      {action && <a className="ed-link" href={action.href}>{action.label} <ArrowRight size={14} /></a>}
    </header>
    {children}
  </section>
}

export function EdEmpty({ children }: { children: ReactNode }) {
  return <p className="ed-empty">{children}</p>
}

export function Crest({ name, logoUrl, size = 'md' }: { name: string; logoUrl?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return <span className={`ed-crest ed-crest-${size}`} aria-hidden="true">{logoUrl ? <img src={logoUrl} alt="" loading="lazy" /> : <span>{monogram(name)}</span>}</span>
}

export function Chip({ tone = 'plain', children }: { tone?: 'live' | 'open' | 'done' | 'plain' | 'provisional' | 'official' | 'warn'; children: ReactNode }) {
  return <span className={`ed-chip ed-chip-${tone}`}>{tone === 'live' && <span className="ed-live-dot" aria-hidden="true" />}{children}</span>
}

// One compact, repeatable match row: home | middle | away. Used for today's
// matches, results, schedules and team fixtures instead of a card per match.
export function MatchRow({ href, home, away, middle, meta, state }: { href: string; home: { name: string; logo?: string | null }; away: { name: string; logo?: string | null }; middle: ReactNode; meta?: ReactNode; state?: ReactNode }) {
  return <a className="ed-match-row" href={href}>
    <span className="ed-match-side"><Crest name={home.name} logoUrl={home.logo} size="sm" /><span>{home.name}</span></span>
    <span className="ed-match-mid">{middle}</span>
    <span className="ed-match-side ed-away"><span>{away.name}</span><Crest name={away.name} logoUrl={away.logo} size="sm" /></span>
    {(meta || state) && <span className="ed-match-meta">{state}{meta}</span>}
  </a>
}

// Horizontally scrollable tab strip. On narrow screens it scrolls instead of
// wrapping; the active tab is scrolled into view.
export function TabStrip<T extends string>({ tabs, active, onChange, label, sticky }: { tabs: Array<{ id: T; label: string; count?: number }>; active: T; onChange: (id: T) => void; label: string; sticky?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [active])
  return <div ref={ref} className={`ed-tabs${sticky ? ' ed-tabs-sticky' : ''}`} role="tablist" aria-label={label}>
    {tabs.map(tab => <button key={tab.id} type="button" role="tab" aria-selected={tab.id === active} className={tab.id === active ? 'active' : ''} onClick={() => onChange(tab.id)}>{tab.label}{tab.count ? <span className="ed-tab-count">{tab.count}</span> : null}</button>)}
  </div>
}

// Share the current page with the system share sheet, or copy its link.
export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    const url = window.location.href
    try {
      if (navigator.share) { await navigator.share({ title, url }); return }
      await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch { /* the viewer dismissed the share sheet */ }
  }
  return <button type="button" className="ed-btn ed-btn-glass" onClick={() => void share()}>{copied ? <><Check size={15} /> Link copied</> : <><Share2 size={15} /> Share</>}</button>
}

// A sheet that rises from the bottom on phones and sits as a side panel on
// larger screens. Used for mobile filters and "More" navigation.
export function BottomSheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return <div className="ed-sheet-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="ed-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ed-sheet-head"><strong>{title}</strong><button type="button" className="ed-icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
      <div className="ed-sheet-body">{children}</div>
    </div>
  </div>
}
