import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repair = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261030074639_fix_self_join_rls_policies.sql'), 'utf8')
const sql = repair.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')

// The 13 live policies whose stored predicate compared a column with itself.
const REPAIRED = [
  ['tournaments', 'organization operators read tournaments'],
  ['tournaments', 'organization operators create tournaments'],
  ['tournaments', 'organization operators update tournaments'],
  ['finance_receipts', 'finance staff manage receipts'],
  ['finance_expenses', 'finance staff manage expenses'],
  ['news_articles', 'media roles manage organization news'],
  ['organization_team_links', 'organization operators read team links'],
  ['organization_team_links', 'organization operators create team links'],
  ['player_team_memberships', 'team managers read their player history'],
  ['player_team_memberships', 'team managers end player memberships'],
  ['player_team_memberships', 'authorized users create player history'],
  ['match_player_participants', 'participants read confirmed appearances'],
  ['match_player_participants', 'players read own confirmed appearances'],
] as const

describe('self-join RLS repair migration', () => {
  it('drops and recreates exactly the 13 affected policies', () => {
    for (const [table, name] of REPAIRED) {
      expect(sql).toContain(`drop policy if exists "${name}" on public.${table};`)
      expect(sql).toContain(`create policy "${name}" on public.${table}`)
    }
    expect(sql.match(/create policy/g)).toHaveLength(REPAIRED.length)
  })

  it('never compares a column with itself', () => {
    expect(sql).not.toMatch(/\b(\w+)\.(\w+)\s*=\s*\1\.\2\b/)
  })

  it('qualifies every outer join column inside subqueries', () => {
    expect(sql).not.toMatch(/=\s*(organization_id|team_id|match_id)\b/)
    for (const join of sql.match(/(om\.organization_id|tm\.team_id|rv\.match_id)\s*=\s*[\w.]+/g) ?? []) {
      expect(join).toMatch(/=\s*(tournaments|finance_receipts|finance_expenses|news_articles|organization_team_links|player_team_memberships|match_player_participants)\./)
    }
  })

  it('is policy-only and keeps the original role restrictions', () => {
    expect(sql).not.toMatch(/\b(alter table|insert into|update public\.|delete from|truncate|create (or replace )?function)\b/i)
    expect(sql).toContain("om.role in ('owner','operations')")
    expect(sql).toContain("om.role in ('owner','finance')")
    expect(sql).toContain("om.role in ('owner','media','operations')")
  })
})
