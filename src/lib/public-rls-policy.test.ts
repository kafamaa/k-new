import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210011_public_rls_policy_split.sql'), 'utf8')

describe('public RLS policy split', () => {
  it('keeps helper functions out of anon while making private policies authenticated-only', () => {
    expect(sql).toContain('to authenticated')
    expect(sql).toContain('drop policy if exists "operators manage matches"')
    expect(sql).toContain('drop policy if exists "assigned officials read matches"')
    expect(sql).not.toContain('grant execute on function public.is_tournament_operator')
    expect(sql).not.toContain('grant execute on function public.is_match_participant')
  })
  it('preserves separate published-read policies and does not add guest writes', () => {
    expect(sql).not.toContain('drop policy if exists "published matches are public"')
    expect(sql).not.toContain('drop policy if exists "published registration questions are public"')
    expect(sql).not.toContain('for insert to anon')
    expect(sql).not.toContain('for update to anon')
    expect(sql).not.toContain('for delete to anon')
  })
})
