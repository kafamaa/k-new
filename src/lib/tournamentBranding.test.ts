import { describe, expect, it } from 'vitest'
import { validateBrandingFile, brandingObjectPath } from './tournamentBranding'

describe('tournamentBranding', () => {
  it('validateBrandingFile rejects bad types and sizes', () => {
    const big = new File([new Uint8Array(3 * 1024 * 1024)], 'x.png', { type: 'image/png' })
    expect(validateBrandingFile('logo', big)).toContain('exceeds')
    const bad = new File([new Uint8Array(10)], 'x.gif', { type: 'image/gif' })
    expect(validateBrandingFile('logo', bad)).toContain('PNG, JPG')
    const empty = new File([], 'x.png', { type: 'image/png' })
    expect(validateBrandingFile('logo', empty)).toBe('The selected file is empty.')
  })
  it('validateBrandingFile accepts valid files', () => {
    const ok = new File([new Uint8Array(100)], 'x.png', { type: 'image/png' })
    expect(validateBrandingFile('logo', ok)).toBeNull()
    expect(validateBrandingFile('cover', ok)).toBeNull()
  })
  it('brandingObjectPath uses generated safe names and never the original filename', () => {
    const file = new File([new Uint8Array(10)], 'evil/../name.png', { type: 'image/png' })
    const path = brandingObjectPath('org-1', 'tourn-1', 'logo', file)
    expect(path).toMatch(/^organizations\/org-1\/tournaments\/tourn-1\/logo\/[0-9a-f-]+\.png$/)
    expect(path).not.toContain('evil')
  })
})
