import type { SupabaseClient } from '@supabase/supabase-js'
import { imageLimit, sizeLabel } from './appConfig'

// ---------------------------------------------------------------------------
// Homepage highlight panel, managed by platform (super) admins (migration 027).
// Guests read only active highlights inside their schedule window; the
// database enforces that, and admin rights are checked server-side by
// is_platform_admin(). Nothing here grants or checks admin rights on its own.
// ---------------------------------------------------------------------------

export const HIGHLIGHT_KINDS = ['notice', 'sponsor', 'tournament', 'promotion'] as const
export type HighlightKind = (typeof HIGHLIGHT_KINDS)[number]
export const HIGHLIGHT_KIND_LABELS: Record<HighlightKind, string> = { notice: 'Platform notice', sponsor: 'Sponsor', tournament: 'Featured tournament', promotion: 'Announcement' }

export type Highlight = {
  id: string; kind: HighlightKind; title: string; body: string | null; imageUrl: string | null; linkUrl: string | null; linkLabel: string | null
  tournamentId: string | null; startsAt: string | null; endsAt: string | null; priority: number; isActive: boolean; updatedAt: string | null
}
export type HighlightDraft = Omit<Highlight, 'id' | 'updatedAt'>
export const EMPTY_HIGHLIGHT: HighlightDraft = { kind: 'notice', title: '', body: '', imageUrl: '', linkUrl: '', linkLabel: '', tournamentId: null, startsAt: null, endsAt: null, priority: 0, isActive: false }

const FIELDS = 'id,kind,title,body,image_url,link_url,link_label,tournament_id,starts_at,ends_at,priority,is_active,updated_at'

function toHighlight(row: Record<string, unknown>): Highlight {
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null
  return {
    id: String(row.id), kind: (HIGHLIGHT_KINDS as readonly string[]).includes(String(row.kind)) ? row.kind as HighlightKind : 'notice',
    title: String(row.title ?? ''), body: text(row.body), imageUrl: text(row.image_url), linkUrl: text(row.link_url), linkLabel: text(row.link_label),
    tournamentId: text(row.tournament_id), startsAt: text(row.starts_at), endsAt: text(row.ends_at), priority: Number(row.priority ?? 0), isActive: row.is_active === true, updatedAt: text(row.updated_at),
  }
}

// Public: what the homepage panel may show right now, highest priority first.
// An error (for example, migration 027 not applied) yields no highlights, and
// the panel falls back to the featured tournament.
export async function loadLiveHighlights(client: SupabaseClient): Promise<Highlight[]> {
  const result = await client.from('platform_highlights').select(FIELDS).eq('is_active', true).order('priority', { ascending: false }).order('updated_at', { ascending: false }).limit(8)
  if (result.error) return []
  const now = Date.now()
  return ((result.data ?? []) as Array<Record<string, unknown>>).map(toHighlight)
    .filter(item => (!item.startsAt || Date.parse(item.startsAt) <= now) && (!item.endsAt || Date.parse(item.endsAt) > now))
}

export async function isPlatformAdmin(client: SupabaseClient): Promise<boolean> {
  const result = await client.rpc('is_platform_admin')
  return !result.error && result.data === true
}

export async function loadAllHighlights(client: SupabaseClient): Promise<{ data: Highlight[]; error: string | null }> {
  const result = await client.from('platform_highlights').select(FIELDS).order('is_active', { ascending: false }).order('priority', { ascending: false }).order('updated_at', { ascending: false })
  if (result.error) return { data: [], error: result.error.message }
  return { data: ((result.data ?? []) as Array<Record<string, unknown>>).map(toHighlight), error: null }
}

export function validateHighlight(draft: HighlightDraft): string | null {
  if (!draft.title.trim()) return 'Give the highlight a title.'
  if (draft.title.trim().length > 120) return 'Keep the title under 120 characters.'
  if ((draft.body ?? '').length > 400) return 'Keep the text under 400 characters.'
  if (draft.imageUrl && !/^https:\/\//.test(draft.imageUrl)) return 'Image links must start with https://.'
  if (draft.linkUrl && !/^(https:\/\/|#)/.test(draft.linkUrl)) return 'Links must start with https:// or point to a page in Kulhivaru+ (#...).'
  if (draft.startsAt && draft.endsAt && Date.parse(draft.endsAt) <= Date.parse(draft.startsAt)) return 'The end must be after the start.'
  if (draft.kind === 'tournament' && !draft.tournamentId) return 'Choose the tournament to feature.'
  return null
}

export async function saveHighlight(client: SupabaseClient, userId: string, draft: HighlightDraft, id?: string): Promise<{ error: string | null }> {
  const problem = validateHighlight(draft)
  if (problem) return { error: problem }
  const row = {
    kind: draft.kind, title: draft.title.trim(), body: draft.body?.trim() || null, image_url: draft.imageUrl?.trim() || null,
    link_url: draft.linkUrl?.trim() || null, link_label: draft.linkLabel?.trim() || null, tournament_id: draft.kind === 'tournament' ? draft.tournamentId : null,
    starts_at: draft.startsAt || null, ends_at: draft.endsAt || null, priority: Math.round(draft.priority) || 0, is_active: draft.isActive, updated_at: new Date().toISOString(),
  }
  const result = id ? await client.from('platform_highlights').update(row).eq('id', id).select('id') : await client.from('platform_highlights').insert({ ...row, created_by: userId }).select('id')
  if (result.error) return { error: /row-level security/i.test(result.error.message) ? 'Only platform admins can manage highlights.' : result.error.message }
  if (!result.data?.length) return { error: 'The highlight was not saved.' }
  return { error: null }
}

export async function setHighlightActive(client: SupabaseClient, id: string, isActive: boolean): Promise<{ error: string | null }> {
  const result = await client.from('platform_highlights').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id).select('id')
  return { error: result.error?.message ?? (result.data?.length ? null : 'Not changed.') }
}

export async function deleteHighlight(client: SupabaseClient, id: string): Promise<{ error: string | null }> {
  const result = await client.from('platform_highlights').delete().eq('id', id)
  return { error: result.error?.message ?? null }
}

export const HIGHLIGHT_IMAGE_MAX = 5 * 1024 * 1024

// Uploads to public-media/platform/highlights/ and returns the public URL.
export async function uploadHighlightImage(client: SupabaseClient, file: File): Promise<{ url: string | null; error: string | null }> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return { url: null, error: 'Use a PNG, JPG or WebP image.' }
  if (file.size === 0 || file.size > imageLimit(HIGHLIGHT_IMAGE_MAX)) return { url: null, error: `Images must be under ${sizeLabel(imageLimit(HIGHLIGHT_IMAGE_MAX))}.` }
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `platform/highlights/${crypto.randomUUID()}.${extension}`
  const upload = await client.storage.from('public-media').upload(path, file, { contentType: file.type, upsert: false })
  if (upload.error) return { url: null, error: /bucket|not found/i.test(upload.error.message) ? 'Image storage needs migrations 024 and 027. Paste an https image link instead.' : upload.error.message }
  return { url: client.storage.from('public-media').getPublicUrl(path).data.publicUrl, error: null }
}
