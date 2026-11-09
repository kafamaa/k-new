import { describe, expect, it } from 'vitest'
import { detectConflict, enqueueOperation, markConflict, pendingOperations } from './matchOperations'

const operation = { operationId: 'op-1', matchId: 'match-1', actorId: 'user-1', operationType: 'score_submission' as const, payload: { home: 1, away: 0 }, baseResultVersion: 2, status: 'queued' as const }

describe('offline match operations', () => {
  it('deduplicates idempotency keys', () => expect(enqueueOperation([operation], operation)).toHaveLength(1))
  it('surfaces newer result versions instead of overwriting them', () => {
    const reason = detectConflict(2, 3); expect(reason).toContain('newer'); expect(markConflict(operation, reason!)).toMatchObject({ status: 'conflict', conflictReason: reason })
  })
  it('keeps queued and conflict work visible for sync review', () => expect(pendingOperations([operation, { ...operation, operationId: 'op-2', status: 'synced' }])).toHaveLength(1))
})
