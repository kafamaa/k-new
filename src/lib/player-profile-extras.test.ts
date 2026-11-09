import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EMPTY_EXTRAS, normalizeSocialLink, validateExtras, validatePhoto } from './playerProfileExtras'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202610300028_player_profile_details.sql'), 'utf8')
const workspace = readFileSync(resolve(process.cwd(), 'src/components/PlayerWorkspace.tsx'), 'utf8')

describe('social media links', () => {
  it('turns a username into the platform profile link', () => {
    expect(normalizeSocialLink('instagram', '@ali.shiyam').url).toBe('https://instagram.com/ali.shiyam')
    expect(normalizeSocialLink('tiktok', 'ali').url).toBe('https://tiktok.com/@ali')
  })
  it('accepts the platform domain only, always over https', () => {
    expect(normalizeSocialLink('facebook', 'http://www.facebook.com/ali/').url).toBe('https://www.facebook.com/ali')
    expect(normalizeSocialLink('instagram', 'https://evil.example/instagram.com/ali').error).toMatch(/instagram\.com/)
    expect(normalizeSocialLink('x', 'javascript:alert(1)').error).toBeTruthy()
    expect(normalizeSocialLink('youtube', '').url).toBeNull()
  })
  it('validates the other details', () => {
    expect(validateExtras({ ...EMPTY_EXTRAS, jerseyNumber: '123' }).error).toMatch(/0 and 99/)
    expect(validateExtras({ ...EMPTY_EXTRAS, bio: 'x'.repeat(401) }).error).toMatch(/400/)
  })
})

describe('profile photo', () => {
  it('accepts only images under 5 MB', () => {
    expect(validatePhoto(new File(['x'], 'a.gif', { type: 'image/gif' }))).toMatch(/PNG/)
    expect(validatePhoto(new File(['x'], 'a.png', { type: 'image/png' }))).toBeNull()
  })
  it('is uploaded, never typed in as a link', () => {
    expect(workspace).toContain('<ProfilePhotoEditor')
    expect(workspace).not.toMatch(/Photo URL<input/)
  })
})

describe('migration 028', () => {
  it('restricts social links to supported networks over https', () => {
    expect(sql).toContain("key in ('instagram', 'facebook', 'tiktok', 'x', 'youtube')")
    expect(sql).toContain("^https://")
    expect(sql).toContain('jersey_number between 0 and 99')
  })
})
