// Device cache for work an official was already authorized to see. Data is
// written only after a successful authorized read, keyed by the account, and
// cleared on sign-out, so offline mode never reveals anything that was not
// already loaded for this account (Product Specification 16.1).
const PREFIX = 'kulhivaru.offline.'

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export function offlineKey(userId: string, name: string): string {
  return `${PREFIX}${userId}.${name}`
}

export function saveOffline<T>(userId: string, name: string, value: T): void {
  try { storage()?.setItem(offlineKey(userId, name), JSON.stringify({ savedAt: new Date().toISOString(), value })) } catch { /* storage full or blocked */ }
}

export function readOffline<T>(userId: string, name: string): { savedAt: string; value: T } | null {
  try {
    const raw = storage()?.getItem(offlineKey(userId, name))
    return raw ? JSON.parse(raw) as { savedAt: string; value: T } : null
  } catch { return null }
}

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

// Called on sign-out: removes every cached record for every account.
export function clearOfflineCache(): void {
  const store = storage()
  if (!store) return
  try {
    const keys: string[] = []
    for (let index = 0; index < store.length; index += 1) { const key = store.key(index); if (key?.startsWith(PREFIX)) keys.push(key) }
    for (const key of keys) store.removeItem(key)
  } catch { /* ignore */ }
}
