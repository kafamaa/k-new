import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, Megaphone, Sparkles, Star, Trophy } from 'lucide-react'
import { HIGHLIGHT_KIND_LABELS, type Highlight, type HighlightKind } from '../lib/platformHighlights'
import { publicTournamentBranding } from '../lib/tournamentBranding'
import { publicSupabase } from '../lib/supabase'
import { TournamentCover, TournamentLogo } from './TournamentBranding'

const KIND_ICONS: Record<HighlightKind, typeof Megaphone> = { notice: Megaphone, sponsor: Star, tournament: Trophy, promotion: Sparkles }

function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

// The hero's right-hand panel. Platform admins decide what runs here (notices,
// sponsors, promoted tournaments, announcements); with nothing active it shows
// the featured tournament passed in as the fallback.
export function HeroHighlights({ highlights, tournaments, fallback, overlay }: { highlights: Highlight[]; tournaments: Map<string, Record<string, unknown>>; fallback: ReactNode; overlay?: ReactNode }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const count = highlights.length
  useEffect(() => { if (index >= count) setIndex(0) }, [count, index])
  useEffect(() => {
    if (count < 2 || paused || prefersReducedMotion()) return
    const timer = window.setInterval(() => setIndex(value => (value + 1) % count), 7000)
    return () => window.clearInterval(timer)
  }, [count, paused])

  if (count === 0) return <div className="lp-hero-visual">{fallback}{overlay}</div>
  const item = highlights[Math.min(index, count - 1)]
  const tournament = item.tournamentId ? tournaments.get(item.tournamentId) : undefined
  const tournamentHref = tournament ? `#tournament/${encodeURIComponent(String(tournament.slug ?? tournament.id))}` : null
  const href = item.linkUrl || tournamentHref
  const Icon = KIND_ICONS[item.kind]
  const branding = publicTournamentBranding(tournament ?? null)
  const external = Boolean(href && href.startsWith('https://'))

  const body = <>
    {item.imageUrl ? <img className="lp-hl-image" src={item.imageUrl} alt="" />
      : tournament ? <TournamentCover client={publicSupabase} path={branding.coverPath} name={String(tournament.name ?? '')} sport={String(tournament.sport ?? '')} />
        : <span className={`lp-hl-art lp-hl-art-${item.kind}`} aria-hidden="true" />}
    <span className="lp-hl-shade" aria-hidden="true" />
    <span className="lp-hl-content">
      <span className={`lp-hl-kind lp-hl-kind-${item.kind}`}><Icon size={13} /> {HIGHLIGHT_KIND_LABELS[item.kind]}</span>
      {tournament && <TournamentLogo client={publicSupabase} path={branding.logoPath} name={String(tournament.name ?? '')} className="lp-mini-logo" />}
      <strong>{item.title}</strong>
      {item.body ? <span className="lp-hl-text">{item.body}</span> : null}
      {href ? <span className="lp-hl-cta">{item.linkLabel || (tournament ? 'View tournament' : 'Learn more')} <ArrowRight size={15} /></span> : null}
    </span>
  </>

  return <div className="lp-hero-visual" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    <section className="lp-hero-media lp-hl" aria-roledescription="carousel" aria-label="Highlights">
      <div aria-live={paused ? 'polite' : 'off'} key={item.id} className="lp-hl-slide">
        {href ? <a className="lp-hl-link" href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{body}</a> : <div className="lp-hl-link">{body}</div>}
      </div>
      {count > 1 && <div className="lp-hl-dots" role="tablist" aria-label="Choose highlight">{highlights.map((entry, position) => <button type="button" key={entry.id} role="tab" aria-selected={position === index} aria-label={`${HIGHLIGHT_KIND_LABELS[entry.kind]}: ${entry.title}`} className={position === index ? 'active' : ''} onClick={() => setIndex(position)} />)}</div>}
    </section>
    {overlay}
  </div>
}
