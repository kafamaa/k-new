import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { featuredTournament, registrationStage, tournamentStage } from './homepage'
import { resultState, sportName } from './display'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('editorial status labels', () => {
  it('keeps tournament status and registration status separate', () => {
    expect(tournamentStage('in_progress')).toEqual({ label: 'Live', tone: 'live' })
    expect(tournamentStage('registration_open').label).toBe('Upcoming')
    expect(registrationStage('registration_open')).toEqual({ label: 'Registration open', open: true })
    expect(registrationStage('in_progress')).toBeNull()
  })
  it('treats a passed closing time as closed even if the status was never changed', () => {
    const now = Date.parse('2026-10-30T00:00:00Z')
    expect(registrationStage('registration_open', '2026-10-26T07:14:00Z', now)).toEqual({ label: 'Registration closed', open: false })
    expect(registrationStage('registration_open', '2026-11-26T07:14:00Z', now)?.open).toBe(true)
  })
  it('features a live tournament first, then one open for registration, and never invents one', () => {
    expect(featuredTournament([{ id: 'a', status: 'completed' }, { id: 'b', status: 'registration_open' }, { id: 'c', status: 'in_progress' }])?.id).toBe('c')
    expect(featuredTournament([{ id: 'a', status: 'completed' }, { id: 'b', status: 'registration_open' }])?.id).toBe('b')
    expect(featuredTournament([])).toBeNull()
  })
  it('distinguishes live, provisional and official results', () => {
    expect(resultState('live').tone).toBe('live')
    expect(resultState('awaiting_confirmation').tone).toBe('provisional')
    expect(resultState('confirmed').label).toBe('Official result')
    expect(sportName('basketball_3x3')).toBe('3x3 Basketball')
  })
})

describe('layout contracts', () => {
  it('gives every shell-based workspace a visible switcher and mobile More navigation', () => {
    const shell = source('src/components/WorkspaceShell.tsx')
    expect(shell).toContain('Switch workspace')
    expect(shell).toContain('items.slice(0, 4)')
    for (const file of ['PlayerWorkspace', 'TeamWorkspace', 'OfficialWorkspace']) expect(source(`src/components/${file}.tsx`)).toContain('<WorkspaceShell')
  })
  // Updated for the final menu table (2 Nov 2026): grouping and labels changed; every page/tab is still listed.
  // Final plan 6.3: five areas (Overview, Registration, Competition, Match Day, More); Setup sits under Overview.
  it('groups the cockpit into the five workflow areas', () => {
    const cockpit = source('src/components/TournamentWorkspace.tsx')
    // Owner's simple flow (2026-11-02): Home, Teams, Schedule, Matches, More; Setup is under More.
    for (const group of ['Home', 'Teams', 'Schedule', 'Matches', 'More']) expect(cockpit).toContain(`label: '${group}'`)
    expect(cockpit).toContain("{ label: 'Teams', tabs: ['teams', 'applications'] }")
    expect(cockpit).toContain("{ label: 'More', tabs: ['settings', 'setup', 'staff', 'finance', 'media', 'reports', 'completion'] }")
    // Every tab is still in a group.
    for (const tab of ['overview', 'setup', 'applications', 'teams', 'draw', 'fixtures', 'standings', 'matches', 'staff', 'finance', 'media', 'settings', 'completion']) expect(cockpit.slice(cockpit.indexOf('const TAB_GROUPS'), cockpit.indexOf('const TAB_GROUPS') + 700)).toContain(`'${tab}'`)
  })
})
