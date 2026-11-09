import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { calendarFile, directionsHref, followHref, readingMinutes, recentForm } from './publicExtras'
import { filterPublishedPlayers } from './publicData'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const sql = read('supabase/migrations/202611010037_follows_and_account_profile.sql')

describe('Calendar files', () => {
  it('builds a valid calendar in UTC with escaped text and skips undated events', () => {
    const file = calendarFile('Futsal Cup fixtures', [
      { uid: 'm1', title: 'Maziya vs Eagles, round 1', start: '2026-11-05T14:00:00.000Z', location: 'Futsal Ground; Malé', url: 'https://example.mv/#matches/m1' },
      { uid: 'm2', title: 'Undated', start: '' },
    ], new Date('2026-11-01T00:00:00Z'))!
    expect(file).toContain('BEGIN:VCALENDAR')
    expect(file).toContain('DTSTART:20261105T140000Z')
    expect(file).toContain('DTEND:20261105T160000Z')
    expect(file).toContain('SUMMARY:Maziya vs Eagles\\, round 1')
    expect(file).toContain('LOCATION:Futsal Ground\\; Malé')
    expect(file.match(/BEGIN:VEVENT/g)?.length).toBe(1)
    expect(calendarFile('Empty', [{ uid: 'x', title: 'x', start: '' }])).toBeNull()
  })
})

describe('Public helpers', () => {
  it('derives form only from confirmed numeric scores, newest first', () => {
    const matches = [
      { status: 'confirmed', home_team_id: 'a', away_team_id: 'b', home_score: 2, away_score: 1, scheduled_at: '2026-10-01' },
      { status: 'confirmed', home_team_id: 'c', away_team_id: 'a', home_score: 3, away_score: 0, scheduled_at: '2026-10-08' },
      { status: 'confirmed', home_team_id: 'a', away_team_id: 'd', home_score: 1, away_score: 1, scheduled_at: '2026-10-15' },
      { status: 'scheduled', home_team_id: 'a', away_team_id: 'e', home_score: null, away_score: null, scheduled_at: '2026-10-22' },
    ]
    expect(recentForm('a', matches)).toEqual(['D', 'L', 'W'])
    expect(recentForm('z', matches)).toEqual([])
  })
  it('estimates reading time and builds safe links', () => {
    expect(readingMinutes('word '.repeat(450))).toBe(2)
    expect(readingMinutes('')).toBe(1)
    expect(directionsHref('National Football Stadium')).toBe('https://www.google.com/maps/search/?api=1&query=National%20Football%20Stadium%2C%20Maldives')
    expect(followHref({ entity_type: 'team', slug: 'new-radiant', entity_id: 'x' })).toBe('#team/new-radiant')
  })
  it('finds players by public code', () => {
    const records = [{ display_name: 'Ali Ahmed', island: 'Malé', public_code: 'KHP-000184' }, { display_name: 'Hassan', island: 'Addu', public_code: 'KHP-000002' }]
    expect(filterPublishedPlayers(records, 'khp-000184').map(item => item.display_name)).toEqual(['Ali Ahmed'])
  })
})

describe('Migration 037 (static review)', () => {
  it('keeps follows private to each person and limited to published records', () => {
    expect(sql).toContain('using (user_id = (select auth.uid()))')
    expect(sql).toContain('with check (user_id = (select auth.uid()) and public.is_followable(entity_type, entity_id))')
    expect(sql).not.toMatch(/to anon/)
    expect(sql).toContain('revoke all on public.follows from anon')
  })
  it('returns only public names for followed records', () => {
    const fn = sql.slice(sql.indexOf('function public.my_follows'), sql.indexOf('revoke execute on function public.is_followable'))
    expect(fn).toContain("where f.user_id = (select auth.uid())")
    expect(fn).toMatch(/t\.is_published/)
    expect(fn).not.toMatch(/email|phone|private/)
  })
  it('uses an empty search_path on its definer functions', () => {
    for (const line of sql.match(/security definer set search_path = [^ ]+/g) ?? []) expect(line).toContain("''")
  })
})
