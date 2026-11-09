export type OperationType = 'event' | 'score_submission' | 'status_change'
export type SyncOperation = { operationId: string; matchId: string; actorId: string; operationType: OperationType; payload: Record<string, unknown>; baseResultVersion: number | null; status: 'queued' | 'synced' | 'conflict' | 'rejected'; conflictReason?: string }

export function enqueueOperation(queue: SyncOperation[], operation: SyncOperation): SyncOperation[] {
  if (queue.some(item => item.operationId === operation.operationId)) return queue
  return [...queue, operation]
}

export function detectConflict(baseResultVersion: number | null, currentResultVersion: number): string | null {
  if (baseResultVersion !== null && baseResultVersion !== currentResultVersion) return 'A newer result version exists; review is required.'
  return null
}

export function markConflict(operation: SyncOperation, reason: string): SyncOperation { return { ...operation, status: 'conflict', conflictReason: reason } }

export function pendingOperations(queue: SyncOperation[]): SyncOperation[] { return queue.filter(operation => operation.status === 'queued' || operation.status === 'conflict') }

// ---------------------------------------------------------------------------
// Device storage for an official's offline queue, scoped to the signed-in
// account (unified plan section 28: account switch must not replay or reveal
// another account's queued work; unsynced work is never silently dropped).
// ---------------------------------------------------------------------------
const LEGACY_QUEUE_KEY = 'kulhivaru.match-queue'
const queueKey = (userId: string) => `kulhivaru.match-queue.${userId}`

function parseQueue(raw: string | null): SyncOperation[] {
  if (!raw) return []
  try { const value = JSON.parse(raw) as unknown; return Array.isArray(value) ? value as SyncOperation[] : [] } catch { return [] }
}

// Reads this account's queue and moves this account's
// operations out of the old device-wide key; other accounts' operations stay
// in the legacy key for that account to collect when it next signs in.
export function loadMatchQueue(userId: string, store: Storage | undefined = globalThis.localStorage): SyncOperation[] {
  if (!store) return []
  try {
    const own = parseQueue(store.getItem(queueKey(userId))).filter(operation => operation.actorId === userId)
    const legacy = parseQueue(store.getItem(LEGACY_QUEUE_KEY))
    if (!legacy.length) return own
    const moved = legacy.filter(operation => operation.actorId === userId && !own.some(existing => existing.operationId === operation.operationId))
    const remaining = legacy.filter(operation => operation.actorId !== userId)
    if (remaining.length) store.setItem(LEGACY_QUEUE_KEY, JSON.stringify(remaining)); else store.removeItem(LEGACY_QUEUE_KEY)
    const merged = [...own, ...moved]
    store.setItem(queueKey(userId), JSON.stringify(merged))
    return merged
  } catch { return [] }
}

export function saveMatchQueue(userId: string, queue: SyncOperation[], store: Storage | undefined = globalThis.localStorage): void {
  try {
    const own = queue.filter(operation => operation.actorId === userId)
    if (own.length) store?.setItem(queueKey(userId), JSON.stringify(own)); else store?.removeItem(queueKey(userId))
  } catch { /* storage full or blocked: the queue stays in memory and the pending count stays visible */ }
}
