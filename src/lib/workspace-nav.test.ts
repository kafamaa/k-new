import { describe, expect, it } from 'vitest'
import {
  groupWorkspacesByKind, ONBOARDING_LABELS, parseWorkspaceRoute, resolveAuthorizedWorkspace,
  shouldOpenChooseWorkspace, workspaceKindsNeedingOnboarding, workspaceRouteHash, WORKSPACE_KIND_LABELS,
} from './workspace'
import type { Workspace } from './workspace'

const player: Workspace = { id: 'p-1', name: 'Real Player', slug: 'real-player', role: 'player', kind: 'player' }
const team: Workspace = { id: 't-1', name: 'Real Team', slug: 'real-team', role: 'manager', kind: 'team' }
const teamTwo: Workspace = { id: 't-2', name: 'Second Team', slug: 'second-team', role: 'manager', kind: 'team' }
const org: Workspace = { id: 'o-1', name: 'Real Org', slug: 'real-org', role: 'owner', kind: 'organization' }

describe('choose-workspace route parsing', () => {
  it('treats the bare workspace route as Choose Workspace', () => {
    expect(parseWorkspaceRoute('#workspace')).toEqual({ kind: 'choose' })
    expect(parseWorkspaceRoute('#workspace/')).toEqual({ kind: 'choose' })
  })
  it('parses a specific authorized workspace route', () => {
    expect(parseWorkspaceRoute('#workspace/player/p-1')).toEqual({ kind: 'open', workspaceKind: 'player', id: 'p-1' })
    expect(parseWorkspaceRoute('#workspace/team/t-1')).toEqual({ kind: 'open', workspaceKind: 'team', id: 't-1' })
    expect(parseWorkspaceRoute('#workspace/organization/o-1')).toEqual({ kind: 'open', workspaceKind: 'organization', id: 'o-1' })
  })
  it('decodes ids and ignores malformed or non-workspace hashes', () => {
    expect(parseWorkspaceRoute('#workspace/player/a%2Fb')).toEqual({ kind: 'open', workspaceKind: 'player', id: 'a/b' })
    expect(parseWorkspaceRoute('#workspace/player')).toEqual({ kind: 'choose' })
    expect(parseWorkspaceRoute('#workspace/unknown/x')).toEqual({ kind: 'choose' })
    expect(parseWorkspaceRoute('#home')).toEqual({ kind: 'choose' })
  })
  it('round-trips a workspace through its route hash', () => {
    expect(parseWorkspaceRoute(workspaceRouteHash(team))).toEqual({ kind: 'open', workspaceKind: 'team', id: 't-1' })
  })
})

describe('authorization boundary on open', () => {
  it('opens only a workspace the account is authorized to use', () => {
    const target = parseWorkspaceRoute('#workspace/team/t-1')
    expect(resolveAuthorizedWorkspace(target, [team, org])).toEqual(team)
  })
  it('denies an unauthorized or unknown workspace id', () => {
    expect(resolveAuthorizedWorkspace(parseWorkspaceRoute('#workspace/team/not-mine'), [team, org])).toBeNull()
    expect(resolveAuthorizedWorkspace(parseWorkspaceRoute('#workspace/player/p-1'), [team, org])).toBeNull()
  })
  it('never opens anything for the choose route', () => {
    expect(resolveAuthorizedWorkspace(parseWorkspaceRoute('#workspace'), [player])).toBeNull()
  })
})

describe('choose-workspace content by authorization', () => {
  it('groups the authorized workspaces by kind (multiple teams stay selectable)', () => {
    const groups = groupWorkspacesByKind([player, team, teamTwo, org])
    expect(groups.player).toEqual([player])
    expect(groups.team).toEqual([team, teamTwo])
    expect(groups.organization).toEqual([org])
  })
  it('shows onboarding only for kinds with no authorized workspace', () => {
    expect(workspaceKindsNeedingOnboarding([])).toEqual(['player', 'team', 'organization'])
    expect(workspaceKindsNeedingOnboarding([player])).toEqual(['team', 'organization'])
    expect(workspaceKindsNeedingOnboarding([player, team, org])).toEqual([])
  })
  it('labels the single onboarding action per kind', () => {
    expect(ONBOARDING_LABELS.player).toBe('Create Player Profile')
    expect(ONBOARDING_LABELS.team).toBe('Create/Join Team')
    expect(ONBOARDING_LABELS.organization).toBe('Create Organization')
    expect(WORKSPACE_KIND_LABELS.organization).toBe('Organizer')
  })
})

describe('sign-in navigation and refresh restore', () => {
  it('sends a fresh sign-in to Choose Workspace', () => {
    expect(shouldOpenChooseWorkspace('SIGNED_IN', true)).toBe(true)
  })
  it('preserves the current route on a normal page refresh', () => {
    expect(shouldOpenChooseWorkspace('INITIAL_SESSION', false)).toBe(false)
  })
  it('preserves the current route on a background token refresh', () => {
    expect(shouldOpenChooseWorkspace('TOKEN_REFRESHED', false)).toBe(false)
  })
  it('does not redirect a sign-in that arrives while already signed in', () => {
    expect(shouldOpenChooseWorkspace('SIGNED_IN', false)).toBe(false)
  })
})

describe('workspace switching restores the authorized route', () => {
  it('switching to another authorized workspace resolves it without new permissions', () => {
    const authorized = [player, team, teamTwo]
    const restored = resolveAuthorizedWorkspace(parseWorkspaceRoute(workspaceRouteHash(teamTwo)), authorized)
    expect(restored).toEqual(teamTwo)
  })
  it('a route to a workspace no longer authorized falls back to choose', () => {
    const authorized = [player] // team was removed / revoked
    expect(resolveAuthorizedWorkspace(parseWorkspaceRoute('#workspace/team/t-1'), authorized)).toBeNull()
  })
})
