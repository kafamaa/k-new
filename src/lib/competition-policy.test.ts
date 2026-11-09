import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210005_competition_engine.sql'), 'utf8')

describe('competition engine authorization', () => {
  it('supports tested formats and result states', () => {
    expect(sql).toContain("format in ('round_robin','group_stage','knockout','groups_knockout','two_leg')")
    expect(sql).toContain("status in ('scheduled','live','awaiting_confirmation','confirmed'")
    expect(sql).toContain("status in ('submitted','confirmed','rejected','conflict')")
  })
  it('keeps match writes scoped to operators or assigned participants', () => {
    expect(sql).toContain('is_match_participant')
    expect(sql).toContain('assigned officials manage events')
    expect(sql).toContain('operators confirm results')
    expect(sql).toContain('published matches are public')
  })
  it('versions automatic and manual draws and audits fixture changes', () => {
    expect(sql).toContain('competition_fixture_versions')
    expect(sql).toContain("draw_mode in ('automatic','manual')")
    expect(sql).toContain('operators append fixture audit')
  })
})
