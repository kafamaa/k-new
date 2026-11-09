import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { managedPlayerProblem, updateManagedPlayer } from './records'
import { renameTournamentAward } from './competitionRecords'
import { updateDeliverable } from './sponsorDeliverables'

type Call = { table: string; patch?: unknown; filters: Array<[string, string, unknown]> }

// Records every update and its filters; resolves with `rows` updated.
function fakeClient(rows: unknown[] = [{ id: 'x' }], error: { message: string } | null = null, calls: Call[] = []): SupabaseClient {
  return {
    from: (table: string) => {
      const call: Call = { table, filters: [] }
      const chain: Record<string, unknown> = {
        update: (patch: unknown) => { call.patch = patch; calls.push(call); return chain },
        eq: (column: string, value: unknown) => { call.filters.push(['eq', column, value]); return chain },
        is: (column: string, value: unknown) => { call.filters.push(['is', column, value]); return chain },
        select: () => chain,
        then: (resolve: (value: unknown) => void) => resolve({ data: error ? null : rows, error }),
      }
      return chain
    },
  } as unknown as SupabaseClient
}

describe('editing organizer-created players', () => {
  const valid = { name: 'Ali Ahmed', island: 'Kanditheemu', atoll: 'Shaviyani', position: 'Pivot' }

  it('validates before saving', () => {
    expect(managedPlayerProblem({ ...valid, name: 'A' })).toMatch(/name/)
    expect(managedPlayerProblem({ ...valid, position: 'x'.repeat(41) })).toMatch(/position/)
    expect(managedPlayerProblem(valid)).toBeNull()
  })

  it('only writes this creator’s unclaimed record and never the public link', async () => {
    const calls: Call[] = []
    expect((await updateManagedPlayer(fakeClient([{ id: 'p1' }], null, calls), 'me', 'p1', valid)).error).toBeNull()
    expect(calls[0].filters).toEqual([['eq', 'id', 'p1'], ['eq', 'created_by', 'me'], ['is', 'account_id', null]])
    expect(Object.keys(calls[0].patch as object)).not.toContain('slug')
    expect(calls[0].patch).toMatchObject({ display_name: 'Ali Ahmed', island: 'Kanditheemu', position: 'Pivot' })
  })

  it('explains when the player has already claimed the profile', async () => {
    expect((await updateManagedPlayer(fakeClient([]), 'me', 'p1', valid)).error).toMatch(/claimed/)
  })
})

describe('home hero photo', () => {
  it('always covers the sample card painted on the design photo with a real card', async () => {
    const { readFileSync } = await import('node:fs')
    const page = readFileSync('src/components/HomepageSections.tsx', 'utf8')
    const slot = page.slice(page.indexOf('<div className="lp-hero-slot">'), page.indexOf('</div>\n      </div>\n      <div className="lp-hero-inner">'))
    // Every branch renders a .lp-hero-card: the match, a highlight, or the totals/loading card.
    expect(slot).toContain('<HeroMatch match={heroMatch} />')
    expect(slot).toContain('<HeroNote highlight={highlights[0]}')
    expect(slot).toContain('<div className="lp-hero-card lp-hero-card-stats">')
    expect(page).toContain("className={`lp-hero-card lp-hero-match")
    const css = readFileSync('src/home.css', 'utf8')
    expect(css).toContain('.lp-hero-slot { position: absolute; left: 29.4%; top: 48.4%; width: 65.2%; height: 49.8%;')
    expect(css).toContain('.lp-hero-photo { display: none; }')
  })
})

describe('editing awards and sponsor checklist items', () => {
  it('renames only organizer-entered awards', async () => {
    const calls: Call[] = []
    expect((await renameTournamentAward(fakeClient([], null, calls), 'a1', '  Best Goalkeeper  ')).error).toBeNull()
    expect(calls[0]).toMatchObject({ table: 'sport_milestones', patch: { label: 'Best Goalkeeper' } })
    expect(calls[0].filters).toContainEqual(['eq', 'is_manual', true])
    expect((await renameTournamentAward(fakeClient(), 'a1', ' ')).error).toMatch(/title/)
  })

  it('saves checklist item edits with validation', async () => {
    const calls: Call[] = []
    expect((await updateDeliverable(fakeClient([], null, calls), 'd1', { kind: 'banner', title: 'Two banners', dueOn: '', note: '' })).error).toBeNull()
    expect(calls[0].patch).toEqual({ kind: 'banner', title: 'Two banners', due_on: null, note: null })
    expect((await updateDeliverable(fakeClient(), 'd1', { kind: 'banner', title: '', dueOn: '', note: '' })).error).toBeTruthy()
  })
})
