import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210006_match_operations.sql'), 'utf8')

describe('match operation authorization', () => {
  it('stores idempotent operations with conflict states', () => {
    expect(sql).toContain('operation_id uuid not null unique')
    expect(sql).toContain("status text not null default 'queued'")
    expect(sql).toContain("'conflict'")
  })
  it('scopes writes to the assigned actor and conflict resolution to organizers', () => {
    expect(sql).toContain('actor_id = auth.uid() and public.is_match_participant(match_id)')
    expect(sql).toContain('operators resolve sync conflicts')
  })
})
