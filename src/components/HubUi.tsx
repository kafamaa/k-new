import type { ReactNode } from 'react'
import { CircleCheck, Clock3 } from 'lucide-react'

// Shared building blocks for the player and team workspaces.
export function Card({ icon, title, sub, action, className = '', children }: { icon?: ReactNode; title: string; sub?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return <section className={`pf-card ${className}`}>
    <header className="pf-card-head">{icon && <span className="pf-card-icon">{icon}</span>}<div><h3>{title}</h3>{sub ? <p>{sub}</p> : null}</div>{action ? <div className="pw-card-action">{action}</div> : null}</header>
    {children}
  </section>
}
export function Pill({ tone = 'info', children }: { tone?: 'ok' | 'warn' | 'bad' | 'muted' | 'info' | 'live'; children: ReactNode }) {
  return <span className={`pw-pill tone-${tone}`}>{children}</span>
}
export function Empty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return <div className="pw-empty">{icon ?? <CircleCheck size={20} />}<p>{children}</p></div>
}
export function Pending({ children }: { children: ReactNode }) { return <p className="pw-pending"><Clock3 size={14} /> {children}</p> }
export function Segments<T extends string>({ items, active, onChange, label }: { items: Array<{ id: T; label: string; count?: number }>; active: T; onChange: (id: T) => void; label: string }) {
  return <div className="pw-segments" role="tablist" aria-label={label}>{items.map(item => <button type="button" role="tab" key={item.id} aria-selected={item.id === active} className={item.id === active ? 'active' : ''} onClick={() => onChange(item.id)}>{item.label}{item.count !== undefined ? <span>{item.count}</span> : null}</button>)}</div>
}
