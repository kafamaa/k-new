import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610210008_histories_statistics.sql'), 'utf8')

describe('history and statistics privacy', () => {
  it('derives statistics from confirmed result versions and scoped appearances', () => {
    expect(sql).toContain('match_player_participants')
    expect(sql).toContain("rv.status = 'confirmed'")
    expect(sql).toContain('get_player_official_statistics')
    expect(sql).toContain('p.is_published or p.account_id = auth.uid()')
    expect(sql).toContain('tr.is_published')
  })
  it('sources milestones and preserves manual/source labels', () => {
    expect(sql).toContain('sport_milestones')
    expect(sql).toContain('source_match_id')
    expect(sql).toContain('source_result_version_id')
    expect(sql).toContain('is_manual boolean not null default false')
  })
})
