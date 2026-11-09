import { describe, expect, it } from 'vitest'
import { visibleWorkspaces } from './authorization'
import { canAccessWorkspace, profilePayload } from './workspace'

describe('workspace authorization boundaries', () => {
  const workspace = { id: 'org-1', name: 'Authorized org', slug: 'authorized-org', role: 'owner', kind: 'organization' as const }
  it('does not expose workspaces to a guest', () => {
    expect(visibleWorkspaces([workspace], '')).toEqual([])
  })
  it('requires a scoped membership before allowing workspace access', () => {
    expect(canAccessWorkspace(workspace, 'user-1')).toBe(true)
    expect(canAccessWorkspace({ ...workspace, role: '' }, 'user-1')).toBe(false)
  })
})

describe('profile persistence payload', () => {
  it('uses account metadata without copying sensitive fields', () => {
    const payload = profilePayload({ id: 'user-1', user_metadata: { full_name: 'Real User', national_id: 'PRIVATE' } } as never)
    expect(payload).toMatchObject({ id: 'user-1', display_name: 'Real User', locale: 'en', timezone: 'Indian/Maldives' })
    expect(payload).not.toHaveProperty('national_id')
  })
})
