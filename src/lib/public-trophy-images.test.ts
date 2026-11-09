import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAchievementImages } from './publicData'

function client(result: { data: unknown; error: { message: string } | null }) {
  const call: { table?: string; columns?: string; ids?: unknown } = {}
  const chain = { select: (columns: string) => { call.columns = columns; return chain }, in: (_column: string, ids: unknown) => { call.ids = ids; return Promise.resolve(result) } }
  return { client: { from: (table: string) => { call.table = table; return chain } } as unknown as SupabaseClient, call }
}

describe('public trophy images', () => {
  it('reads only id and image for the given achievements and keeps https images', async () => {
    const { client: db, call } = client({ data: [{ id: 'a', image_url: 'https://x/t.png' }, { id: 'b', image_url: 'http://x/t.png' }, { id: 'c', image_url: null }], error: null })
    const images = await getAchievementImages(db, ['a', 'b', 'c'])
    expect(call).toEqual({ table: 'sport_milestones', columns: 'id,image_url', ids: ['a', 'b', 'c'] })
    expect([...images]).toEqual([['a', 'https://x/t.png']])
  })
  it('degrades to no images when the column is missing', async () => {
    expect((await getAchievementImages(client({ data: null, error: { message: 'column sport_milestones.image_url does not exist' } }).client, ['a'])).size).toBe(0)
    expect((await getAchievementImages(client({ data: [], error: null }).client, [])).size).toBe(0)
  })
  it('is used on the public player and team pages', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/components/PublicPage.tsx'), 'utf8')
    expect(page.match(/<Honours items=/g)).toHaveLength(2)
  })
})
