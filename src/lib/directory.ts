// URL state and paging for public directory pages.
export const PAGE_SIZE = 20
export type Params = Record<string, string>
export function readHashParams(hash = window.location.hash): Params { return Object.fromEntries(new URLSearchParams(hash.split('?')[1] ?? '')) }
export function hashWithParams(hash: string, params: Params): string {
  const [base] = hash.split('?')
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value !== undefined)).toString()
  return `${base}${query ? `?${query}` : ''}`
}
export function pageSlice<T>(items: T[], page: number, size = PAGE_SIZE): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const current = Math.min(Math.max(1, page || 1), pages)
  return { items: items.slice((current - 1) * size, current * size), page: current, pages }
}

