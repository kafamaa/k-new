import type { SupabaseClient } from '@supabase/supabase-js'
import { imageLimit } from './appConfig'

export const LOGO_MAX_BYTES = 2 * 1024 * 1024
export const COVER_MAX_BYTES = 5 * 1024 * 1024
export const LOGO_ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']
export const COVER_ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']

export type BrandingAsset = 'logo' | 'cover'

export function validateBrandingFile(asset: BrandingAsset, file: File): string | null {
  const accepted = asset === 'logo' ? LOGO_ACCEPTED : COVER_ACCEPTED
  const max = imageLimit(asset === 'logo' ? LOGO_MAX_BYTES : COVER_MAX_BYTES)
  if (!accepted.includes(file.type)) return `${asset === 'logo' ? 'Logo' : 'Cover'} must be PNG, JPG/JPEG or WebP.`
  if (file.size > max) return `${asset === 'logo' ? 'Logo' : 'Cover'} exceeds the ${Math.round(max / (1024 * 1024))} MB limit.`
  if (file.size === 0) return 'The selected file is empty.'
  return null
}

function extensionFor(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

export function brandingObjectPath(organizationId: string, tournamentId: string, asset: BrandingAsset, file: File): string {
  const ext = extensionFor(file.type)
  const generated = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `organizations/${organizationId}/tournaments/${tournamentId}/${asset}/${generated}.${ext}`
}

export async function uploadBrandingFile(client: SupabaseClient, organizationId: string, tournamentId: string, asset: BrandingAsset, file: File): Promise<{ path: string | null; error: string | null }> {
  const problem = validateBrandingFile(asset, file)
  if (problem) return { path: null, error: problem }
  const path = brandingObjectPath(organizationId, tournamentId, asset, file)
  const result = await client.storage.from('tournament-media').upload(path, file, { contentType: file.type, upsert: false })
  if (result.error) return { path: null, error: result.error.message }
  return { path, error: null }
}

export async function removeBrandingFile(client: SupabaseClient, path: string | null): Promise<{ error: string | null }> {
  if (!path) return { error: null }
  const result = await client.storage.from('tournament-media').remove([path])
  if (result.error) return { error: result.error.message }
  return { error: null }
}

// ---------------------------------------------------------------------------
// Display. `tournament-media` is a private bucket, so images are shown through
// short-lived signed URLs created at read time with the caller's own client:
// the authenticated client for organizers (draft branding included, per the
// operator read policy) and the session-less public client for guests (only
// published tournaments, per the public read policy). Signed URLs live in
// memory only and are never written back to the database.
// ---------------------------------------------------------------------------

export const TOURNAMENT_MEDIA_BUCKET = 'tournament-media'
export const BRANDING_SIGNED_URL_TTL_SECONDS = 60 * 60
// Re-sign a little before expiry so an <img> never receives a dead URL.
const SIGNED_URL_REFRESH_MARGIN_MS = 5 * 60 * 1000

const OBJECT_PATH_PATTERN = /^organizations\/[0-9a-f-]{36}\/tournaments\/[0-9a-f-]{36}\/(logo|cover)\/[A-Za-z0-9._-]+$/i

// A stored value is usable only when it is a bare object path in the shape the
// uploader generates. Signed, public, blob or data URLs are rejected so a
// wrongly persisted URL is never rendered or re-signed.
export function isBrandingObjectPath(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_PATH_PATTERN.test(value) && !value.includes('..')
}

export type TournamentBrandingPaths = { logoPath: string | null; coverPath: string | null }

// Guests only ever receive branding for publicly visible tournaments, matching
// the tournaments public read policy (published and not a draft). The storage
// policy enforces the same rule; this keeps the UI from even asking otherwise.
export function publicTournamentBranding(record: Record<string, unknown> | null | undefined): TournamentBrandingPaths {
  if (!record || record.is_published !== true || String(record.status ?? '') === 'draft') return { logoPath: null, coverPath: null }
  return {
    logoPath: isBrandingObjectPath(record.logo_path) ? record.logo_path : null,
    coverPath: isBrandingObjectPath(record.cover_path) ? record.cover_path : null,
  }
}

type SignedEntry = { url: string; expiresAt: number }
// Keyed per client: an organizer's client may sign a draft image that the
// public client must not, so results are never shared between them.
const signedUrlCache = new WeakMap<SupabaseClient, Map<string, SignedEntry>>()
const pendingSignatures = new WeakMap<SupabaseClient, Map<string, Promise<string | null>>>()

function cacheFor<T>(store: WeakMap<SupabaseClient, Map<string, T>>, client: SupabaseClient): Map<string, T> {
  let map = store.get(client)
  if (!map) { map = new Map(); store.set(client, map) }
  return map
}

// Resolves a stored object path to a signed display URL, or null when there is
// no image, the path is not a valid object path, or signing fails (missing
// object, policy refusal, network). Failures are not cached, so a re-fetch or
// reload tries again.
export async function resolveBrandingUrl(client: SupabaseClient | null, path: string | null | undefined, now: () => number = Date.now): Promise<string | null> {
  if (!client || !isBrandingObjectPath(path)) return null
  const cache = cacheFor(signedUrlCache, client)
  const cached = cache.get(path)
  if (cached && cached.expiresAt - SIGNED_URL_REFRESH_MARGIN_MS > now()) return cached.url
  const pending = cacheFor(pendingSignatures, client)
  const inFlight = pending.get(path)
  if (inFlight) return inFlight
  const request = (async () => {
    try {
      const result = await client.storage.from(TOURNAMENT_MEDIA_BUCKET).createSignedUrl(path, BRANDING_SIGNED_URL_TTL_SECONDS)
      const url = result.error ? null : result.data?.signedUrl ?? null
      if (url) cache.set(path, { url, expiresAt: now() + BRANDING_SIGNED_URL_TTL_SECONDS * 1000 })
      else cache.delete(path)
      return url
    } catch {
      cache.delete(path)
      return null
    } finally {
      pending.delete(path)
    }
  })()
  pending.set(path, request)
  return request
}

// Drops a cached URL, e.g. after the browser failed to load it, so the next
// render signs a fresh one.
export function forgetBrandingUrl(client: SupabaseClient | null, path: string | null | undefined): void {
  if (client && path) signedUrlCache.get(client)?.delete(path)
}
