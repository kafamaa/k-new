import type { SupabaseClient } from '@supabase/supabase-js'
import { imageLimit, sizeLabel } from './appConfig'

// ---------------------------------------------------------------------------
// Player-editable public profile details (migration 028) and profile photos.
// Photos go to the public-media bucket under players/<playerId>/, which the
// storage policy (migration 024) lets only the profile's own account write.
// ---------------------------------------------------------------------------

export const SOCIAL_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', hosts: ['instagram.com'], example: 'https://instagram.com/yourname' },
  { key: 'facebook', label: 'Facebook', hosts: ['facebook.com', 'fb.com'], example: 'https://facebook.com/yourname' },
  { key: 'tiktok', label: 'TikTok', hosts: ['tiktok.com'], example: 'https://tiktok.com/@yourname' },
  { key: 'x', label: 'X (Twitter)', hosts: ['x.com', 'twitter.com'], example: 'https://x.com/yourname' },
  { key: 'youtube', label: 'YouTube', hosts: ['youtube.com', 'youtu.be'], example: 'https://youtube.com/@yourname' },
] as const
export type SocialKey = (typeof SOCIAL_PLATFORMS)[number]['key']
export type SocialLinks = Partial<Record<SocialKey, string>>

export type ProfileExtras = { atoll: string; preferredSide: '' | 'left' | 'right' | 'both'; jerseyNumber: string; bio: string; socialLinks: SocialLinks }
export const EMPTY_EXTRAS: ProfileExtras = { atoll: '', preferredSide: '', jerseyNumber: '', bio: '', socialLinks: {} }
export const EXTRA_FIELDS = 'atoll,preferred_side,jersey_number,bio,social_links'

// Accepts a full link, or a bare handle that is turned into the platform's
// profile link. Only https links to the platform's own domain are allowed.
export function normalizeSocialLink(key: SocialKey, value: string): { url: string | null; error: string | null } {
  const platform = SOCIAL_PLATFORMS.find(item => item.key === key)!
  const raw = value.trim()
  if (!raw) return { url: null, error: null }
  const handle = raw.replace(/^@/, '')
  const candidate = /^https?:\/\//i.test(raw) ? raw.replace(/^http:/i, 'https:') : /^[\w.-]{1,60}$/.test(handle) ? `https://${platform.hosts[0]}/${key === 'tiktok' || key === 'youtube' ? '@' : ''}${handle}` : raw
  let parsed: URL
  try { parsed = new URL(candidate) } catch { return { url: null, error: `${platform.label}: enter a profile link or username.` } }
  const host = parsed.hostname.toLowerCase().replace(/^www\.|^m\./, '')
  if (parsed.protocol !== 'https:' || !platform.hosts.some(item => host === item || host.endsWith(`.${item}`))) return { url: null, error: `${platform.label}: the link must be a ${platform.hosts[0]} address.` }
  if (parsed.pathname.length < 2) return { url: null, error: `${platform.label}: include your profile name in the link.` }
  const url = `https://${parsed.hostname.toLowerCase()}${parsed.pathname}`.replace(/\/$/, '')
  if (url.length > 200) return { url: null, error: `${platform.label}: the link is too long.` }
  return { url, error: null }
}

export function validateExtras(extras: ProfileExtras): { links: SocialLinks; error: string | null } {
  if (extras.bio.length > 400) return { links: {}, error: 'Keep your biography under 400 characters.' }
  if (extras.atoll.length > 60) return { links: {}, error: 'Atoll name is too long.' }
  if (extras.jerseyNumber && !/^\d{1,2}$/.test(extras.jerseyNumber)) return { links: {}, error: 'Jersey number must be between 0 and 99.' }
  const links: SocialLinks = {}
  for (const platform of SOCIAL_PLATFORMS) {
    const result = normalizeSocialLink(platform.key, extras.socialLinks[platform.key] ?? '')
    if (result.error) return { links: {}, error: result.error }
    if (result.url) links[platform.key] = result.url
  }
  return { links, error: null }
}

function isMissingColumn(message: string): boolean { return /does not exist|42703|schema cache|PGRST204/i.test(message) }

export function extrasFromRow(row: Record<string, unknown> | null): ProfileExtras {
  if (!row) return EMPTY_EXTRAS
  const side = String(row.preferred_side ?? '')
  const links = row.social_links && typeof row.social_links === 'object' ? row.social_links as Record<string, unknown> : {}
  return {
    atoll: typeof row.atoll === 'string' ? row.atoll : '',
    preferredSide: side === 'left' || side === 'right' || side === 'both' ? side : '',
    jerseyNumber: typeof row.jersey_number === 'number' ? String(row.jersey_number) : '',
    bio: typeof row.bio === 'string' ? row.bio : '',
    socialLinks: Object.fromEntries(SOCIAL_PLATFORMS.map(platform => [platform.key, typeof links[platform.key] === 'string' ? String(links[platform.key]) : '']).filter(([, value]) => value)) as SocialLinks,
  }
}

// Null data with available=false means migration 028 is not applied yet.
export async function loadProfileExtras(client: SupabaseClient, playerId: string): Promise<{ data: ProfileExtras; available: boolean; error: string | null }> {
  const result = await client.from('player_profiles').select(EXTRA_FIELDS).eq('id', playerId).maybeSingle()
  if (result.error) return { data: EMPTY_EXTRAS, available: !isMissingColumn(result.error.message), error: isMissingColumn(result.error.message) ? null : result.error.message }
  return { data: extrasFromRow(result.data as Record<string, unknown> | null), available: true, error: null }
}

export async function saveProfileExtras(client: SupabaseClient, userId: string, playerId: string, extras: ProfileExtras): Promise<{ links: SocialLinks; error: string | null }> {
  const { links, error } = validateExtras(extras)
  if (error) return { links, error }
  const result = await client.from('player_profiles').update({
    atoll: extras.atoll.trim() || null,
    preferred_side: extras.preferredSide || null,
    jersey_number: extras.jerseyNumber === '' ? null : Number(extras.jerseyNumber),
    bio: extras.bio.trim() || null,
    social_links: links,
  }).eq('id', playerId).eq('account_id', userId).select('id')
  if (result.error) return { links, error: isMissingColumn(result.error.message) ? 'These details need migration 028 to be applied.' : result.error.message }
  if (!result.data?.length) return { links, error: 'Nothing was saved. Only the owner of this profile can edit it.' }
  return { links, error: null }
}

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export function validatePhoto(file: File): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return 'Use a PNG, JPG or WebP photo.'
  if (file.size === 0) return 'The selected file is empty.'
  if (file.size > imageLimit(PHOTO_MAX_BYTES)) return `Photos must be under ${sizeLabel(imageLimit(PHOTO_MAX_BYTES))}.`
  return null
}

// Uploads a new profile photo and points the profile at it. The previous
// uploaded photo (if any) is removed only after the profile has switched.
export async function uploadPlayerPhoto(client: SupabaseClient, userId: string, playerId: string, file: File, previousPath: string | null): Promise<{ url: string | null; path: string | null; error: string | null }> {
  const problem = validatePhoto(file)
  if (problem) return { url: null, path: null, error: problem }
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `players/${playerId}/photo-${crypto.randomUUID()}.${extension}`
  const upload = await client.storage.from('public-media').upload(path, file, { contentType: file.type, upsert: false })
  if (upload.error) return { url: null, path: null, error: /bucket|not found/i.test(upload.error.message) ? 'Photo storage needs migration 024 to be applied.' : /row-level security|policy/i.test(upload.error.message) ? 'Only the owner of this profile can change its photo.' : upload.error.message }
  const url = client.storage.from('public-media').getPublicUrl(path).data.publicUrl
  const withPath = await client.from('player_profiles').update({ photo_url: url, photo_path: path }).eq('id', playerId).eq('account_id', userId).select('id')
  const saved = withPath.error && isMissingColumn(withPath.error.message)
    ? await client.from('player_profiles').update({ photo_url: url }).eq('id', playerId).eq('account_id', userId).select('id')
    : withPath
  if (saved.error || !saved.data?.length) {
    await client.storage.from('public-media').remove([path])
    return { url: null, path: null, error: saved.error?.message ?? 'The photo was not saved to your profile.' }
  }
  if (previousPath && previousPath !== path && previousPath.startsWith(`players/${playerId}/`)) await client.storage.from('public-media').remove([previousPath])
  return { url, path, error: null }
}

export async function removePlayerPhoto(client: SupabaseClient, userId: string, playerId: string, previousPath: string | null): Promise<{ error: string | null }> {
  const cleared = await client.from('player_profiles').update({ photo_url: null, photo_path: null }).eq('id', playerId).eq('account_id', userId).select('id')
  const saved = cleared.error && isMissingColumn(cleared.error.message) ? await client.from('player_profiles').update({ photo_url: null }).eq('id', playerId).eq('account_id', userId).select('id') : cleared
  if (saved.error) return { error: saved.error.message }
  if (previousPath?.startsWith(`players/${playerId}/`)) await client.storage.from('public-media').remove([previousPath])
  return { error: null }
}
