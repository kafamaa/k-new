import { ArrowLeft, ArrowRight, Trophy } from 'lucide-react'
import { PAGE_BANNER } from './HomeArt'

// Shared pieces of the owner's island design for public directory pages:
// a photo banner with the page title, the closing call-to-action band and a
// numbered pager. The photo is decorative; the title is the page's only h1.
export function PageBanner({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="ip-banner">
    <span className="ip-banner-backdrop" aria-hidden="true" style={{ backgroundImage: `url(${PAGE_BANNER})` }} />
    <img className="ip-banner-photo" src={PAGE_BANNER} alt="" width={597} height={166} decoding="async" />
    <div className="ip-banner-copy"><h1>{title}</h1><p>{subtitle}</p></div>
  </header>
}

export function IslandCallToAction({ title, actionLabel, onAction }: { title: string; actionLabel: string; onAction?: () => void }) {
  return <section className="ip-cta" aria-labelledby="ip-cta-title">
    <h2 id="ip-cta-title">{title}</h2>
    {onAction ? <button type="button" className="ed-btn ed-btn-primary ed-btn-lg" onClick={onAction}><Trophy size={18} aria-hidden="true" /> {actionLabel}</button>
      : <a className="ed-btn ed-btn-primary ed-btn-lg" href="#workspace"><Trophy size={18} aria-hidden="true" /> {actionLabel}</a>}
  </section>
}

// Previous · 1 2 3 … · Next. Long runs collapse around the current page.
function pageNumbers(page: number, pages: number): Array<number | 'gap'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1)
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter(value => value >= 1 && value <= pages))
  const sorted = [...wanted].sort((a, b) => a - b)
  return sorted.flatMap((value, index) => index > 0 && value - sorted[index - 1] > 1 ? ['gap' as const, value] : [value])
}

export function NumberedPager({ page, pages, onPage, label = 'Pages' }: { page: number; pages: number; onPage: (page: number) => void; label?: string }) {
  if (pages <= 1) return null
  const go = (next: number) => { onPage(next); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  return <nav className="ip-pager" aria-label={label}>
    <button type="button" className="ip-pager-step" disabled={page <= 1} onClick={() => go(page - 1)}><ArrowLeft size={16} aria-hidden="true" /> Previous</button>
    {pageNumbers(page, pages).map((value, index) => value === 'gap' ? <span key={`gap-${index}`} className="ip-pager-gap" aria-hidden="true">…</span>
      : <button type="button" key={value} className={`ip-pager-num${value === page ? ' active' : ''}`} aria-current={value === page ? 'page' : undefined} aria-label={`Page ${value}`} onClick={() => go(value)}>{value}</button>)}
    <button type="button" className="ip-pager-step" disabled={page >= pages} onClick={() => go(page + 1)}>Next <ArrowRight size={16} aria-hidden="true" /></button>
  </nav>
}
