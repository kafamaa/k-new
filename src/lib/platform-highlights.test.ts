import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EMPTY_HIGHLIGHT, validateHighlight } from './platformHighlights'
import { parsePublicHash } from './publicRoutes'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610300027_platform_admin_highlights.sql'), 'utf8')

describe('platform highlights', () => {
  it('validates content before saving', () => {
    expect(validateHighlight({ ...EMPTY_HIGHLIGHT, title: '' })).toMatch(/title/)
    expect(validateHighlight({ ...EMPTY_HIGHLIGHT, title: 'Hi', imageUrl: 'http://x' })).toMatch(/https/)
    expect(validateHighlight({ ...EMPTY_HIGHLIGHT, title: 'Hi', linkUrl: 'javascript:alert(1)' })).toMatch(/https/)
    expect(validateHighlight({ ...EMPTY_HIGHLIGHT, title: 'Hi', kind: 'tournament' })).toMatch(/tournament/)
    expect(validateHighlight({ ...EMPTY_HIGHLIGHT, title: 'Hi', linkUrl: '#tournaments' })).toBeNull()
  })
  it('routes #admin to the admin page', () => {
    expect(parsePublicHash('#admin')).toEqual({ kind: 'admin' })
  })
  it('never lets the app grant admin rights and only shows guests live items', () => {
    expect(sql).not.toMatch(/on public\.platform_admins for (insert|update|delete|all)/)
    expect(sql).toContain("using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()))")
    expect(sql).toContain("check (link_url is null or link_url ~ '^(https://|#)')")
  })
})
