import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('five-destination workspace navigation', () => {
  it('groups the Team Workspace into Overview, Squad, Tournaments, Matches and More', () => {
    const team = read('src/components/TeamWorkspace.tsx')
    expect(team).toContain("{ id: 'competitions', label: 'Tournaments', icon: Trophy, tabs: ['tournaments', 'applications', 'rosters'] }")
    // Owner's workspace design (2026-11-04): nine sidebar destinations; every page and tab is still reachable.
    expect(team).toContain("{ id: 'games', label: 'Matches', icon: CalendarDays, tabs: ['matches'] }")
    for (const label of ["label: 'Overview'", "label: 'Squad'", "label: 'Team History'", "label: 'Finance'", "label: 'Staff'", "label: 'Documents'", "label: 'Team Settings'"]) expect(team).toContain(label)
    // Groups whose tabs are all hidden by permission do not appear.
    expect(team).toContain('.filter(group => group.tabs.length > 0)')
    // Permission-hidden tabs (finance, documents) stay hidden inside their group.
    expect(team).toContain('tabs: group.tabs.filter(tab => visible.has(tab))')
    expect(team).toContain("get('section')")
    expect(team).not.toContain('could not load: ${state.message}')
  })
  it('groups the Organizer Workspace and keeps role-based permissions', () => {
    const organizer = read('src/components/OrganizerWorkspace.tsx')
    // Updated for the final menu table (2 Nov 2026): grouping and labels changed; every page/tab is still listed.
    // Final plan 6.3: Overview, Tournaments, Teams & Players, Operations, Settings.
    // Owner (2026-11-02): Home, Tournaments, Players & Teams, More.
    for (const label of ["label: 'Home'", "label: 'Tournaments'", "label: 'Players & Teams'", "label: 'More'"]) expect(organizer).toContain(label)
    for (const section of ['overview', 'tournaments', 'teams', 'players', 'staff', 'reports', 'profile', 'finance', 'news', 'settings']) expect(organizer).toContain(`'${section}'`)
    expect(organizer).toContain('group.sections.map(section => nav.find(item => item.section === section))')
    expect(organizer).toContain('.filter(group => group.items.length > 0)')
    expect(organizer).not.toContain('Unable to load this workspace: {error}')
  })
})
