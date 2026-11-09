import { useState } from 'react'
import { tr } from '../lib/i18n'
import type { ReactNode } from 'react'
import { ArrowRight, ChevronsLeft, ChevronsRight, CircleCheck, MoreHorizontal, Repeat2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { BottomSheet } from './Editorial'

// shortLabel is the phone bottom-bar label when the full one is too long.
export type ShellItem<T extends string> = { id: T; label: string; shortLabel?: string; icon: LucideIcon; count?: number }

function readCollapsed(): boolean {
  try { return localStorage.getItem('kulhivaru.sidebar-collapsed') === '1' } catch { return false }
}

// The workspace layout: a collapsible sidebar and slim top bar on desktop, a
// compact header with bottom navigation (first four destinations plus More) on
// phones. Only the navigation of the open workspace is shown, and Switch
// Workspace always returns to Choose Workspace without signing out.
// primaryIds picks the phone bottom-bar destinations; by default the first four.
export function WorkspaceShell<T extends string>({ kindLabel, title, subtitle, items, active, onSelect, children, primaryIds, pageTitle, pageLede }: {
  kindLabel: string; title: string; subtitle?: ReactNode; items: Array<ShellItem<T>>; active: T; onSelect: (id: T) => void; children: ReactNode; primaryIds?: T[]
  // Optional page heading and one-line description (owner workspace design); the nav label otherwise.
  pageTitle?: string; pageLede?: string
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [moreOpen, setMoreOpen] = useState(false)
  const toggle = () => setCollapsed(value => { const next = !value; try { localStorage.setItem('kulhivaru.sidebar-collapsed', next ? '1' : '0') } catch { /* preference only */ } return next })
  const primary = primaryIds ? items.filter(item => primaryIds.includes(item.id)) : items.slice(0, 4)
  const rest = items.filter(item => !primary.includes(item))
  const activeItem = items.find(item => item.id === active)
  const select = (id: T) => { onSelect(id); setMoreOpen(false); window.scrollTo({ top: 0 }) }

  return <div className={`ws-shell${collapsed ? ' collapsed' : ''}`}>
    <aside className="ws-sidebar" aria-label={`${kindLabel} workspace navigation`}>
      <div className="ws-sidebar-head">
        <span className="ws-kind">{kindLabel}</span>
        <button type="button" className="ed-icon-btn" onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>{collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}</button>
      </div>
      <nav className="ws-nav">
        {items.map(({ id, label, icon: Icon, count }) => <button type="button" key={id} className={id === active ? 'active' : ''} aria-current={id === active ? 'page' : undefined} onClick={() => select(id)} title={collapsed ? label : undefined}>
          <Icon size={18} aria-hidden="true" /><span className="ws-nav-label">{label}</span>{count ? <span className="ws-count">{count}</span> : null}
        </button>)}
      </nav>
      <a className="ws-switch" href="#workspace"><Repeat2 size={16} aria-hidden="true" /><span className="ws-nav-label">Switch workspace</span></a>
    </aside>

    <div className="ws-main">
      <header className="ws-topbar">
        <nav className="ws-topbar-title ws-crumbs" aria-label="Breadcrumb"><a href="#workspace">My Work</a><span aria-hidden="true">/</span><span className="ws-crumb-kind" title={title}>{kindLabel}</span>{activeItem ? <><span aria-hidden="true">/</span><b aria-current="page">{activeItem.label}</b></> : null}<span className="sr-only">{title}{subtitle ? <> · {subtitle}</> : null}</span></nav>
        <a className="ed-btn ed-btn-ghost ed-btn-sm" href="#workspace" aria-label="Switch workspace"><Repeat2 size={15} aria-hidden="true" /> <span className="ed-hide-sm">Switch workspace</span></a>
      </header>
      <div className="ws-content" key={active}>
        <h1 className="ws-page-title">{pageTitle ?? activeItem?.label ?? title}</h1>
        {pageLede ? <p className="ws-page-lede">{pageLede}</p> : null}
        {children}
      </div>
    </div>

    <nav className="ws-bottomnav" aria-label={`${kindLabel} workspace`}>
      {primary.map(({ id, label, shortLabel, icon: Icon, count }) => <button type="button" key={id} className={id === active ? 'active' : ''} aria-current={id === active ? 'page' : undefined} onClick={() => select(id)}><Icon size={20} aria-hidden="true" /><span>{shortLabel ?? label}</span>{count ? <span className="ws-dot" aria-label={`${count} pending`} /> : null}</button>)}
      {rest.length > 0 && <button type="button" className={rest.some(item => item.id === active) ? 'active' : ''} onClick={() => setMoreOpen(true)} aria-haspopup="dialog"><MoreHorizontal size={20} aria-hidden="true" /><span>More</span></button>}
    </nav>
    <BottomSheet open={moreOpen} title="More" onClose={() => setMoreOpen(false)}>
      <div className="ws-more">
        {rest.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={id === active ? 'active' : ''} onClick={() => select(id)}><Icon size={18} aria-hidden="true" />{label}</button>)}
        <a href="#workspace"><Repeat2 size={18} aria-hidden="true" />Switch workspace</a>
        <a href="#top">View public site</a>
      </div>
    </BottomSheet>
  </div>
}

// Overview building blocks, in the order every workspace overview uses:
// next action, tasks needing attention, a small row of counts.
export function NextActionPanel({ label, hint, action }: { label: string; hint?: string; action?: { text: string; onClick: () => void } }) {
  return <section className="ws-next" aria-label="Next action">
    <div><p className="ed-eyebrow light">{tr('workspace.nextAction', 'Next action')}</p><h2>{label}</h2>{hint ? <p>{hint}</p> : null}</div>
    {action && <button type="button" className="ed-btn ed-btn-primary" onClick={action.onClick}>{action.text} <ArrowRight size={16} /></button>}
  </section>
}

export function AttentionList({ items, empty }: { items: Array<{ key: string; label: string; detail?: string; onOpen?: () => void }>; empty: string }) {
  return <section className="ws-block" aria-label="Needs your attention">
    <h2 className="ed-subhead">Needs your attention</h2>
    {items.length === 0 ? <p className="ws-clear"><CircleCheck size={16} /> {empty}</p>
      : <ul className="ws-tasks">{items.map(item => <li key={item.key}>{item.onOpen ? <button type="button" onClick={item.onOpen}><span><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</span><ArrowRight size={15} /></button> : <span className="ws-task-static"><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</span>}</li>)}</ul>}
  </section>
}

export function CountRow({ counts }: { counts: Array<{ label: string; value: ReactNode; tone?: 'warn' | 'ok' }> }) {
  return <dl className="ws-counts">{counts.map(count => <div key={count.label} className={count.tone ? `tone-${count.tone}` : ''}><dt>{count.label}</dt><dd>{count.value}</dd></div>)}</dl>
}
