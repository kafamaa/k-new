import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { eventCounts, filterOrganizations, groupDraw, keyEvents, matchEventLabel, mergeSponsors, optionsFrom, placesState, toMatchExtras } from './publicPages'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const sql = read('supabase/migrations/202611010038_public_pages_complete.sql')
const fn = (name: string) => { const start = sql.indexOf(`function public.${name}`); return sql.slice(start, sql.indexOf('grant execute', start)) }

describe('Match detail data', () => {
  it('keeps only well-formed events and public lineup players', () => {
    const extras = toMatchExtras({ official: true, home_score: 2, away_score: '1', events: [{ minute: 12, type: 'goal', side: 'home', player: 'Ali', player_slug: 'ali' }, { minute: 30, type: '', side: 'away' }, { minute: null, type: 'red_card', side: 'sideways' }], lineups: [{ side: 'away', player: 'Hassan', player_slug: 'hassan', starter: true }, { side: 'home', player: null }], private_players: 3 })
    expect(extras.homeScore).toBe(2)
    expect(extras.awayScore).toBe(1)
    expect(extras.events).toHaveLength(2)
    expect(extras.events[1].side).toBeNull()
    expect(extras.lineups).toEqual([{ side: 'away', player: 'Hassan', playerSlug: 'hassan', starter: true }])
    expect(extras.privatePlayers).toBe(3)
    expect(toMatchExtras(null).available).toBe(false)
  })
  it('labels events, picks key events and counts each side', () => {
    const events = toMatchExtras({ events: [{ type: 'goal', side: 'home' }, { type: 'yellow_card', side: 'away' }, { type: 'goal', side: 'away' }, { type: 'red_card', side: 'home' }] }).events
    expect(matchEventLabel('two_minute_suspension')).toBe('2-minute suspension')
    expect(matchEventLabel('new_kind')).toBe('New kind')
    expect(keyEvents(events).map(event => event.type)).toEqual(['goal', 'goal', 'red_card'])
    expect(eventCounts(events).find(row => row.type === 'goal')).toMatchObject({ home: 1, away: 1 })
  })
})

describe('Draw, places, sponsors and filters', () => {
  it('groups draw rows by stage and group without duplicates', () => {
    const stages = groupDraw([
      { stage_id: 's2', stage_name: 'Final', stage_format: 'knockout', stage_order: 2, team_id: 'a', team_name: 'Alpha' },
      { stage_id: 's1', stage_name: 'Groups', stage_format: 'group_stage', stage_order: 1, group_name: 'Group B', team_id: 'c', team_name: 'Gamma' },
      { stage_id: 's1', stage_name: 'Groups', stage_format: 'group_stage', stage_order: 1, group_name: 'Group A', team_id: 'b', team_name: 'Beta' },
      { stage_id: 's1', stage_name: 'Groups', stage_format: 'group_stage', stage_order: 1, group_name: 'Group A', team_id: 'b', team_name: 'Beta' },
    ])
    expect(stages.map(stage => stage.name)).toEqual(['Groups', 'Final'])
    expect(stages[0].groups.map(group => group.name)).toEqual(['Group A', 'Group B'])
    expect(stages[0].groups[0].teams).toHaveLength(1)
  })
  it('reports places only when every category has a limit', () => {
    expect(placesState(null)).toEqual({ kind: 'unknown' })
    expect(placesState({ opensAt: null, closesAt: null, categoryCount: 1, teamLimit: null, approved: 3 })).toEqual({ kind: 'unknown' })
    expect(placesState({ opensAt: null, closesAt: null, categoryCount: 1, teamLimit: 8, approved: 5 })).toEqual({ kind: 'open', remaining: 3, total: 8 })
    expect(placesState({ opensAt: null, closesAt: null, categoryCount: 1, teamLimit: 8, approved: 8 })).toEqual({ kind: 'full', total: 8 })
  })
  it('lists a sponsor of several tournaments once', () => {
    const sponsor = { sponsor_name: 'Ocean Bank', sponsor_level: 'Gold', website: null, description: null, logo_path: null }
    const merged = mergeSponsors([{ tournament: { name: 'Cup' }, sponsors: [sponsor] }, { tournament: { name: 'League' }, sponsors: [{ ...sponsor, sponsor_name: 'ocean bank ' }] }])
    expect(merged).toHaveLength(1)
    expect(merged[0].tournaments).toEqual(['Cup', 'League'])
  })
  it('filters organizations by location and builds team options', () => {
    const records = [{ id: 'o1', name: 'Addu FA' }, { id: 'o2', name: 'Malé League' }]
    const locations = new Map([['o1', ['Addu City']], ['o2', ['Malé']]])
    expect(filterOrganizations(records, '', 'Malé', locations).map(record => record.id)).toEqual(['o2'])
    expect(optionsFrom(new Map([['p1', [{ id: 't2', name: 'Zeta' }, { id: 't1', name: 'Alpha' }]], ['p2', [{ id: 't1', name: 'Alpha' }]]]))).toEqual([{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Zeta' }])
  })
})

describe('Migration 038 (static review)', () => {
  it('uses an empty search_path on every definer function and no reserved output names', () => {
    for (const line of sql.match(/security definer set search_path = [^ ]+/g) ?? []) expect(line).toContain("''")
    expect(sql).not.toMatch(/returns table\([^)]*\bposition\b/)
    expect(sql).not.toMatch(/\b(alter|drop|create) (table|policy)\b/)
  })
  it('opens match detail only for published stages and keeps results official', () => {
    const detail = fn('get_public_match_detail')
    expect(detail).toContain('tr.is_published and tr.status <> \'draft\'')
    expect(detail).toContain('st.published_at is not null')
    expect(detail).toContain("v_match.status = 'confirmed'")
    expect(detail).toContain('match_result_freezes')
    expect(detail).toContain('if v_official then')
    expect(detail).not.toMatch(/'payload'|recorded_by|idempotency_key|submitted_by|confirmed_by|correction_reason/)
    expect(detail).toMatch(/case when p\.is_published then p\.display_name end/)
  })
  it('names teams in the draw only when published or approved, and organization teams only when published', () => {
    expect(fn('get_public_tournament_draw')).toContain("e.application_status = 'approved'")
    expect(fn('get_public_tournament_draw')).toContain('case when t.is_published then t.slug end')
    expect(fn('get_public_organization_teams')).toContain('t.is_published')
    expect(fn('get_public_organization_teams')).toContain('o.is_published')
  })
  it('revokes from PUBLIC and grants the read functions to guests', () => {
    for (const name of ['get_public_match_detail', 'get_public_tournament_draw', 'get_public_organization_teams']) {
      expect(sql).toContain(`revoke execute on function public.${name}(`)
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\(uuid\\) to anon, authenticated, service_role`))
    }
  })
})
