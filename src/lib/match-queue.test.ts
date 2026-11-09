import { describe, expect, it } from 'vitest'
import { loadMatchQueue, saveMatchQueue, type SyncOperation } from './matchOperations'

function memoryStore(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => { data.delete(key) },
    setItem: (key, value) => { data.set(key, String(value)) },
  }
}

const op = (operationId: string, actorId: string): SyncOperation => ({
  operationId, matchId: 'm1', actorId, operationType: 'event', payload: {}, baseResultVersion: null, status: 'queued',
})

describe('offline match queue is scoped to the signed-in account', () => {
  it('never shows one account the queue of another', () => {
    const store = memoryStore()
    saveMatchQueue('official-a', [op('1', 'official-a')], store)
    expect(loadMatchQueue('official-b', store)).toEqual([])
    expect(loadMatchQueue('official-a', store).map(o => o.operationId)).toEqual(['1'])
  })

  it('drops operations recorded by a different actor even if stored under this account', () => {
    const store = memoryStore({ 'kulhivaru.match-queue.official-a': JSON.stringify([op('1', 'official-a'), op('2', 'official-b')]) })
    expect(loadMatchQueue('official-a', store).map(o => o.operationId)).toEqual(['1'])
  })

  it('migrates the old device-wide queue without handing it to the wrong account', () => {
    const store = memoryStore({ 'kulhivaru.match-queue': JSON.stringify([op('1', 'official-a'), op('2', 'official-b')]) })
    expect(loadMatchQueue('official-a', store).map(o => o.operationId)).toEqual(['1'])
    // Official B's unsynced event is kept for B rather than silently dropped.
    expect(JSON.parse(store.getItem('kulhivaru.match-queue') ?? '[]').map((o: SyncOperation) => o.operationId)).toEqual(['2'])
    expect(loadMatchQueue('official-b', store).map(o => o.operationId)).toEqual(['2'])
    expect(store.getItem('kulhivaru.match-queue')).toBeNull()
  })

  it('survives unreadable storage', () => {
    const store = memoryStore({ 'kulhivaru.match-queue.official-a': 'not json' })
    expect(loadMatchQueue('official-a', store)).toEqual([])
  })
})
