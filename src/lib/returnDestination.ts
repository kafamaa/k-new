// ---------------------------------------------------------------------------
// Safe internal return destinations for the registration flow.
//
// Only validated, internal, hash-based routes are ever stored. The destination
// never carries tokens, emails, private form values, or document URLs — only a
// tournament slug/id and an optional category id. External or malformed values
// are rejected and never persisted.
// ---------------------------------------------------------------------------

function sessionStorageRef(): { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } | null {
  try {
    const g = globalThis as { sessionStorage?: unknown; window?: { sessionStorage?: unknown } }
    const candidate = g.sessionStorage ?? g.window?.sessionStorage
    if (candidate && typeof (candidate as { getItem?: unknown }).getItem === 'function') {
      return candidate as { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
    }
    return null
  } catch {
    return null
  }
}

export type RegistrationReturnDestination = {
  tournamentSlug: string
  tournamentId?: string
  category?: string
  createdAt: number
}

const STORAGE_KEY = 'kulhivaru.registration-return-destination'
const MAX_AGE_MS = 30 * 60 * 1000

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/i

function isSafeSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_PATTERN.test(value) && !value.includes('..') && !value.includes('//')
}

export function validateReturnDestination(input: unknown): RegistrationReturnDestination | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  if (record.route !== 'registration') return null
  if (!isSafeSlug(record.tournamentSlug)) return null
  const destination: RegistrationReturnDestination = {
    tournamentSlug: String(record.tournamentSlug),
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
  }
  if (typeof record.tournamentId === 'string' && isSafeSlug(record.tournamentId)) destination.tournamentId = record.tournamentId
  if (typeof record.category === 'string' && isSafeSlug(record.category)) destination.category = record.category
  if (Date.now() - destination.createdAt > MAX_AGE_MS) return null
  return destination
}

export function saveReturnDestination(destination: { tournamentSlug: string; tournamentId?: string; category?: string; createdAt?: number }): void {
  const validated = validateReturnDestination({ ...destination, route: 'registration', createdAt: destination.createdAt ?? Date.now() })
  if (!validated) return
  const storage = sessionStorageRef()
  if (!storage) return
  try { storage.setItem(STORAGE_KEY, JSON.stringify(validated)) } catch { /* ignore */ }
}

export function loadReturnDestination(): RegistrationReturnDestination | null {
  const storage = sessionStorageRef()
  if (!storage) return null
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    const validated = validateReturnDestination(parsed && typeof parsed === 'object' ? { ...(parsed as Record<string, unknown>), route: 'registration' } : parsed)
    if (!validated) { storage.removeItem(STORAGE_KEY); return null }
    return validated
  } catch {
    return null
  }
}

export function clearReturnDestination(): void {
  const storage = sessionStorageRef()
  if (!storage) return
  try { storage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

export function returnDestinationHash(destination: RegistrationReturnDestination): string {
  const base = `#register/${encodeURIComponent(destination.tournamentSlug)}`
  return destination.category ? `${base}?category=${encodeURIComponent(destination.category)}` : base
}

export function parseReturnDestinationFromHash(hash: string): RegistrationReturnDestination | null {
  const raw = hash.replace(/^#\/?/, '')
  const parts = raw.split('?')[0].split('/').filter(Boolean)
  if (parts[0] !== 'register' || !parts[1]) return null
  const slug = decodeURIComponent(parts[1])
  const params = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?')) : '')
  const category = params.get('category') ?? undefined
  return validateReturnDestination({ route: 'registration', tournamentSlug: slug, category, createdAt: Date.now() })
}
