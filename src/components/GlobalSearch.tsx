import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Building2, Loader2, MapPin, Search, Trophy, UserRound, Users, X } from 'lucide-react'
import { closestName, SEARCH_MAX, SEARCH_MIN, searchSuggestions, type Suggestion } from '../lib/landing'
import { publicSupabase } from '../lib/supabase'

const GROUPS: Array<{ kind: Suggestion['kind']; label: string; icon: typeof Trophy }> = [
  { kind: 'Tournament', label: 'Tournaments', icon: Trophy }, { kind: 'Team', label: 'Teams', icon: Users }, { kind: 'Player', label: 'Players', icon: UserRound },
  { kind: 'Organization', label: 'Organizations', icon: Building2 }, { kind: 'Place', label: 'Islands and atolls', icon: MapPin },
]

// Hero search: debounced, cancellable public suggestions grouped by type.
// Arrow keys move through results, Enter opens one (or the full results page),
// Escape closes the list. Only published records are ever requested.
export function GlobalSearch({ knownNames = [] }: { knownNames?: string[] }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Suggestion[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
  const wrapRef = useRef<HTMLFormElement>(null)
  const term = query.trim()

  useEffect(() => {
    if (term.length < SEARCH_MIN || !publicSupabase) { setItems([]); setStatus('idle'); return }
    const controller = new AbortController()
    setStatus('loading')
    const timer = window.setTimeout(() => {
      void searchSuggestions(publicSupabase!, term, controller.signal).then(result => {
        if (controller.signal.aborted) return
        setItems(result.data); setStatus(result.error ? 'error' : 'ready'); setActive(-1)
      }).catch(() => { if (!controller.signal.aborted) setStatus('error') })
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [term])

  useEffect(() => {
    const close = (event: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const ordered = useMemo(() => GROUPS.flatMap(group => items.filter(item => item.kind === group.kind)), [items])
  const suggestion = status === 'ready' && !items.length ? closestName(term, knownNames.filter(Boolean)) : null
  const go = (href: string) => { setOpen(false); window.location.hash = href }
  const submit = () => { if (active >= 0 && ordered[active]) go(ordered[active].href); else if (term) go(`#search?q=${encodeURIComponent(term.slice(0, SEARCH_MAX))}`) }
  const announce = status === 'loading' ? 'Searching…' : status === 'error' ? 'Search is unavailable right now.' : status === 'ready' ? (items.length ? `${items.length} suggestion${items.length === 1 ? '' : 's'} available.` : `No results found for ${term}.`) : ''

  return <form ref={wrapRef} className="lp-hero-search lp-search" role="search" onSubmit={event => { event.preventDefault(); submit() }}>
    <label className="sr-only" htmlFor={`${listId}-input`}>Search tournaments, teams, players, organizations and islands</label>
    <input id={`${listId}-input`} role="combobox" aria-expanded={open && term.length >= SEARCH_MIN} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
      value={query} maxLength={SEARCH_MAX} autoComplete="off" placeholder="Search tournaments, teams, players or islands"
      onChange={event => { setQuery(event.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
      onKeyDown={event => {
        if (event.key === 'Escape') { setOpen(false); setActive(-1) }
        else if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(index => Math.min(ordered.length - 1, index + 1)) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(-1, index - 1)) }
      }} />
    {query && <button type="button" className="lp-search-clear" aria-label="Clear search" onClick={() => { setQuery(''); setItems([]); setActive(-1) }}><X size={16} /></button>}
    <button type="submit" aria-label="Search">{status === 'loading' ? <Loader2 size={18} className="spin" /> : <Search size={18} />}</button>
    <span className="sr-only" aria-live="polite">{announce}</span>
    {open && term.length >= SEARCH_MIN && status !== 'idle' && <div className="lp-suggest" id={listId} role="listbox" aria-label="Search suggestions">
      {status === 'loading' && !items.length && <p className="lp-suggest-state">Searching…</p>}
      {status === 'error' && <p className="lp-suggest-state">Search is unavailable right now. Press Enter to try the full search.</p>}
      {status === 'ready' && !items.length && <div className="lp-suggest-state"><strong>No results found for “{term}”.</strong><span>Try another spelling, sport, team or island.</span>{suggestion && <button type="button" className="ed-link-btn" onClick={() => setQuery(suggestion)}>Did you mean “{suggestion}”?</button>}</div>}
      {GROUPS.map(group => { const groupItems = items.filter(item => item.kind === group.kind); if (!groupItems.length) return null; const Icon = group.icon; return <div key={group.kind} className="lp-suggest-group" role="group" aria-label={group.label}>
        <p className="lp-suggest-label">{group.label}</p>
        {groupItems.map(item => { const index = ordered.indexOf(item); return <a key={`${item.kind}-${item.href}`} id={`${listId}-${index}`} role="option" aria-selected={index === active} className={index === active ? 'active' : ''} href={item.href} onClick={() => setOpen(false)}>
          <span className="lp-suggest-mark">{item.image ? <img src={item.image} alt="" width={32} height={32} /> : <Icon size={16} />}</span>
          <span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span>
        </a> })}
      </div> })}
      {status === 'ready' && items.length > 0 && <a className="lp-suggest-all" href={`#search?q=${encodeURIComponent(term)}`} onClick={() => setOpen(false)}>See all results for “{term}”</a>}
    </div>}
  </form>
}
