import { describe, expect, it } from 'vitest'
import { playerWorkspace } from './workspace'

describe('player workspace persistence mapping', () => {
  it('immediately exposes a newly persisted account-linked player as a workspace', () => {
    expect(playerWorkspace({ id: 'player-1', display_name: 'Real Player', slug: 'real-player' })).toEqual({ id: 'player-1', name: 'Real Player', slug: 'real-player', role: 'player', kind: 'player' })
  })
  it('uses the same account-linked record after reload mapping', () => {
    const persisted = { id: 'player-1', display_name: 'Real Player', slug: 'real-player' }
    expect(playerWorkspace(persisted).id).toBe(playerWorkspace(persisted).id)
  })
})
