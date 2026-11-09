import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateDocument } from './playerSections'
import { CARD_STYLES, isCardStyle } from './cardImage'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const sql = read('supabase/migrations/202610300029_player_workspace_sections.sql')
const workspace = read('src/components/PlayerWorkspace.tsx')

describe('player workspace sections', () => {
  // Final specification: Home, Profile, Career, Requests, More; every other feature a tab inside one.
  // Owner's workspace design (2026-11-04): nine destinations, each opening existing sections and tabs.
  it('has the sidebar destinations in order, with the rest as tabs', () => {
    const order = ['overview', 'profile', 'card', 'career', 'matches', 'requests', 'documents', 'activity', 'privacy'].map(id => workspace.indexOf(`{ id: '${id}'`))
    expect(order.every(position => position > 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    const home = read('src/lib/playerHome.ts')
    for (const tab of ['profile', 'card', 'privacy', 'teams', 'tournaments', 'matches', 'statistics', 'achievements', 'history', 'upcoming', 'live', 'completed', 'availability', 'discipline', 'eligibility', 'requests', 'documents', 'notifications', 'help']) expect(home).toContain(`'${tab}'`)
  })
  it('accepts only PDF, PNG and JPG documents under 10 MB', () => {
    expect(validateDocument(new File(['x'], 'a.docx', { type: 'application/msword' }))).toMatch(/PDF/)
    expect(validateDocument(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBeNull()
  })
  it('offers only the approved card styles', () => {
    expect(CARD_STYLES).toEqual(['classic', 'ocean', 'gold', 'night'])
    expect(isCardStyle('neon')).toBe(false)
    expect(sql).toContain("check (card_style in ('classic', 'ocean', 'gold', 'night'))")
  })
})

describe('migration 029 contracts', () => {
  it('accepting an invitation adds a dated membership and never edits history', () => {
    expect(sql).toContain("insert into public.player_team_memberships(player_id, team_id, status, effective_from, source, created_by)")
    expect(sql).not.toMatch(/update public\.player_team_memberships/)
    expect(sql).toContain("check (status in ('pending', 'accepted', 'declined', 'reported', 'withdrawn', 'expired'))")
  })
  it('lets only tournament operators change a document review status', () => {
    expect(sql).toContain('only_tournament_operators_review_documents')
    expect(sql).toContain("with check (uploaded_by = auth.uid() and status = 'uploaded'")
  })
  it('guards the uuid casts in the existing document storage policies', () => {
    expect(sql).toContain("case when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$' then (")
    expect(sql).not.toMatch(/\(storage\.foldername\(name\)\)\[1\]::uuid/)
  })
  it('hides achievements the player chose to hide', () => {
    expect(sql).toContain('create policy "published milestones are public" on public.sport_milestones for select using (\n  is_public and (')
  })
})
