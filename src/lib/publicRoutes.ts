export type PublicCollectionKind = 'organizations' | 'tournaments' | 'teams' | 'players' | 'matches' | 'news' | 'standings' | 'bracket' | 'archive' | 'search'
export type PublicDetailKind = 'organization' | 'tournament' | 'team' | 'player' | 'history' | 'match' | 'news'
export type PublicRoute = { kind: 'home' | 'workspace' | 'admin' | 'explore' } | { kind: Exclude<PublicCollectionKind, 'search'> } | { kind: 'search'; query: string } | { kind: PublicDetailKind; slug: string } | { kind: 'registration'; slug: string } | { kind: 'info'; slug: string } | { kind: 'account' } | { kind: 'reset-password' } | { kind: 'not-found' } | { kind: 'people'; role: 'coach' | 'referee' } | { kind: 'person'; role: 'coach' | 'referee'; slug: string }

export function parsePublicHash(hash: string): PublicRoute {
  const raw = hash.replace(/^#\/?/, '')
  const [path, queryString] = raw.split('?')
  const parts = path.split('/').filter(Boolean)
  if (!parts.length || parts[0] === 'top' || parts[0] === 'home') return { kind: 'home' }
  if (parts[0] === 'workspace') return { kind: 'workspace' }
  if (parts[0] === 'admin') return { kind: 'admin' }
  // Explore: one page of tiles for every public directory. Live: the matches page, Live tab first.
  if (parts[0] === 'explore' && !parts[1]) return { kind: 'explore' }
  if (parts[0] === 'live' && !parts[1]) return { kind: 'matches' }
  // Account Settings (the sign-in account, separate from sports profiles)
  if (parts[0] === 'account') return { kind: 'account' }
  if (parts[0] === 'reset-password') return { kind: 'reset-password' }
  // Help and legal pages linked from the footer: #info/<topic>
  if (parts[0] === 'info') return { kind: 'info', slug: decodeURIComponent(parts[1] ?? 'help') }
  // Registration route: #register/<slug> or #tournament/<slug>/register
  if (parts[0] === 'register' && parts[1]) return { kind: 'registration', slug: decodeURIComponent(parts.slice(1).join('/')) }
  if (parts[0] === 'tournament' && parts[2] === 'register' && parts[1]) return { kind: 'registration', slug: decodeURIComponent(parts[1]) }
  const collection = ['organizations', 'tournaments', 'teams', 'players', 'matches', 'news', 'standings', 'bracket', 'archive'] as const
  // Coaches and referees with a public profile (migration 047).
  if ((parts[0] === 'coaches' || parts[0] === 'referees') && !parts[1]) return { kind: 'people', role: parts[0] === 'coaches' ? 'coach' : 'referee' }
  if ((parts[0] === 'coach' || parts[0] === 'referee' || parts[0] === 'coaches' || parts[0] === 'referees') && parts[1] && !parts[2]) return { kind: 'person', role: parts[0].startsWith('coach') ? 'coach' : 'referee', slug: decodeURIComponent(parts[1]) }
  if (parts[0] === 'search') return { kind: 'search', query: new URLSearchParams(queryString ?? '').get('q') ?? '' }
  if (collection.includes(parts[0] as typeof collection[number]) && !parts[1]) return { kind: parts[0] as typeof collection[number] }
  const detail = { organization: 'organization', organizations: 'organization', tournament: 'tournament', tournaments: 'tournament', team: 'team', teams: 'team', player: 'player', players: 'player', history: 'history', match: 'match', matches: 'match', news: 'news' } as const
  const kind = detail[parts[0] as keyof typeof detail]
  if (kind && parts[1]) return { kind, slug: decodeURIComponent(parts.slice(1).join('/')) }
  // A one-word hash is an in-page anchor (#how-it-works) or an auth callback;
  // an unknown path with several parts is a page that does not exist.
  return parts.length > 1 ? { kind: 'not-found' } : { kind: 'home' }
}
