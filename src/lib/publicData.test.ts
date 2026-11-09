import { describe, expect, it } from 'vitest'
import { filterPublishedOrganizations, filterPublishedPlayers, filterPublishedTeams, filterPublishedTournaments, PUBLIC_ORGANIZATION_FIELDS, PUBLIC_PLAYER_FIELDS, PUBLIC_TEAM_FIELDS, PUBLIC_TEAM_ROSTER_FIELDS, sanitizeSearchQuery, selectPublishedRoster } from './publicData'

describe('published public data boundaries', () => {
  it('sanitizes search wildcards and bounds query length', () => {
    expect(sanitizeSearchQuery('  real%_team  ')).toBe('realteam')
    expect(sanitizeSearchQuery('x'.repeat(100))).toHaveLength(80)
  })
  it('filters only the already-published tournament result set', () => {
    const records = [{ name: 'Island Cup', sport: 'football', status: 'registration_open' }, { name: 'Island Cup Futsal', sport: 'futsal', status: 'completed' }]
    expect(filterPublishedTournaments(records, 'cup', 'football', '')).toHaveLength(1)
    expect(filterPublishedTournaments(records, '', '', 'completed')).toEqual([records[1]])
  })
  it('filters published organizations by public name and description', () => {
    const records = [{ name: 'Island Sports Council', description: 'Football events' }, { name: 'School Association', description: 'Youth competitions' }]
    expect(filterPublishedOrganizations(records, 'football')).toEqual([records[0]])
    expect(filterPublishedOrganizations(records, '')).toHaveLength(2)
  })
  it('selects only approved public organization fields', () => {
    expect(PUBLIC_ORGANIZATION_FIELDS).toBe('id,name,slug,description')
    expect(PUBLIC_ORGANIZATION_FIELDS).not.toMatch(/email|phone|payment|document|staff|membership/i)
  })
  it('filters published teams by public name, description, team_type, and island', () => {
    const records = [{ name: 'Island Warriors', description: 'Football club', team_type: 'club', island: 'Malé' }, { name: 'National Team', description: 'National team', team_type: 'national', island: 'Malé' }]
    expect(filterPublishedTeams(records, 'football')).toEqual([records[0]])
    expect(filterPublishedTeams(records, 'national')).toEqual([records[1]])
    expect(filterPublishedTeams(records, 'malé')).toHaveLength(2)
  })
  it('filters published teams by team type and island facets', () => {
    const records = [{ name: 'Island Warriors', team_type: 'club', island: 'Malé' }, { name: 'Addu Select', team_type: 'island', island: 'Addu' }, { name: 'National Team', team_type: 'national', island: 'Malé' }]
    expect(filterPublishedTeams(records, '', 'island', '')).toEqual([records[1]])
    expect(filterPublishedTeams(records, '', '', 'Malé')).toHaveLength(2)
    expect(filterPublishedTeams(records, '', 'national', 'Malé')).toEqual([records[2]])
    expect(filterPublishedTeams(records, '', 'school', '')).toHaveLength(0)
  })
  it('selects only approved public team fields', () => {
    expect(PUBLIC_TEAM_FIELDS).toBe('id,name,slug,team_type,island,description,logo_url')
    expect(PUBLIC_TEAM_FIELDS).not.toMatch(/contact|email|phone|payment|document|note|membership|manager|created_by/i)
  })
  it('selects only approved public roster fields', () => {
    expect(PUBLIC_TEAM_ROSTER_FIELDS).not.toMatch(/account_id|national|email|phone|payment|document|created_by|source/i)
    expect(PUBLIC_TEAM_ROSTER_FIELDS).toContain('player_profiles')
  })
  it('selects only approved public player fields', () => {
    // Updated: public code and position added for the Players directory filters.
    expect(PUBLIC_PLAYER_FIELDS).toBe('id,display_name,slug,island,photo_url,is_claimed,public_code,position')
    expect(PUBLIC_PLAYER_FIELDS).not.toMatch(/account|national|email|phone|payment|document|note|created_by|digest|token/i)
  })
  it('filters published players by public name and island', () => {
    const records = [{ display_name: 'Ibrahim Shiyam', island: 'Malé' }, { display_name: 'Ali Hassan', island: 'Addu' }, { display_name: 'Moosa Kareem', island: 'Malé' }]
    expect(filterPublishedPlayers(records, 'ibrahim')).toEqual([records[0]])
    expect(filterPublishedPlayers(records, '', 'Addu')).toEqual([records[1]])
    expect(filterPublishedPlayers(records, 'malé')).toHaveLength(2)
    expect(filterPublishedPlayers(records, 'unknown')).toHaveLength(0)
  })
  it('keeps only published players with a public name in the team roster', () => {
    const rows = [
      { id: 'r1', player_id: 'p1', status: 'active', player_profiles: { display_name: 'Published Player', slug: 'published-player', is_published: true } },
      { id: 'r2', player_id: 'p2', status: 'active', player_profiles: { display_name: 'Private Player', slug: 'private-player', is_published: false } },
      { id: 'r3', player_id: 'p3', status: 'ended', player_profiles: { display_name: 'Former Player', slug: 'former-player', is_published: true } },
      { id: 'r4', player_id: 'p4', status: 'active', player_profiles: null },
      { id: 'r5', player_id: 'p5', status: 'active', player_profiles: { display_name: '  ', slug: 'blank', is_published: true } },
    ]
    const roster = selectPublishedRoster(rows)
    expect(roster.map(row => row.id)).toEqual(['r1', 'r2', 'r3'])
  })
})
