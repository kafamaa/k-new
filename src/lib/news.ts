import type { SupabaseClient } from '@supabase/supabase-js'

export const PUBLIC_NEWS_FIELDS = 'id,slug,title,excerpt,body,content_type,cover_image_url,media_url,tournament_id,organization_id,author_id,status,featured,published_at,created_at'

export async function getPublishedNews(client: SupabaseClient): Promise<{ data: Record<string, unknown>[] | null; error: string | null }> {
  const result = await client.from('news_articles').select(PUBLIC_NEWS_FIELDS).eq('status', 'published').order('published_at', { ascending: false, nullsFirst: false })
  return { data: (result.data ?? null) as Record<string, unknown>[] | null, error: result.error?.message ?? null }
}

export async function getPublishedNewsBySlug(client: SupabaseClient, slug: string): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const result = await client.from('news_articles').select(PUBLIC_NEWS_FIELDS).eq('slug', slug).eq('status', 'published').maybeSingle()
  return { data: (result.data ?? null) as Record<string, unknown> | null, error: result.error?.message ?? null }
}

// --- Authoring (organizer News section) ----------------------------------------
// Writes go through the "media roles manage organization news" policy (0022):
// owner, operations and media members of the organization, or tournament
// operators / media staff for tournament-scoped articles.

export const NEWS_CONTENT_TYPES = ['news', 'announcement', 'match_report', 'organizer_update', 'highlight', 'video_link', 'photo_gallery'] as const
export type NewsContentType = (typeof NEWS_CONTENT_TYPES)[number]
export const NEWS_CONTENT_LABELS: Record<NewsContentType, string> = { news: 'News', announcement: 'Announcement', match_report: 'Match report', organizer_update: 'Organizer update', highlight: 'Highlight', video_link: 'Video link', photo_gallery: 'Photo gallery' }

export type NewsDraft = { title: string; excerpt: string; body: string; contentType: NewsContentType; tournamentId: string | null; mediaUrl: string; featured: boolean }
export type OrganizationArticle = { id: string; slug: string; title: string; status: string; contentType: string; tournamentId: string | null; publishedAt: string | null; createdAt: string; excerpt: string | null; body: string; mediaUrl: string | null; featured: boolean }

export function validateNewsDraft(draft: NewsDraft): string | null {
  if (!draft.title.trim()) return 'Give the article a title.'
  if (draft.title.trim().length > 160) return 'Keep the title under 160 characters.'
  if (!draft.body.trim() && !draft.mediaUrl.trim()) return 'Write the article or add a media link.'
  if (draft.mediaUrl.trim() && !/^https:\/\/\S+$/i.test(draft.mediaUrl.trim())) return 'Media links must start with https://.'
  return null
}

export function newsSlug(title: string): string {
  const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'article'
  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

export async function loadOrganizationNews(client: SupabaseClient, organizationId: string): Promise<{ data: OrganizationArticle[]; error: string | null }> {
  const result = await client.from('news_articles').select('id,slug,title,status,content_type,tournament_id,published_at,created_at,excerpt,body,media_url,featured').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(100)
  if (result.error) return { data: [], error: result.error.message }
  return { data: ((result.data ?? []) as Array<Record<string, unknown>>).map(row => ({ id: String(row.id), slug: String(row.slug), title: String(row.title ?? ''), status: String(row.status ?? 'draft'), contentType: String(row.content_type ?? 'news'), tournamentId: row.tournament_id ? String(row.tournament_id) : null, publishedAt: typeof row.published_at === 'string' ? row.published_at : null, createdAt: String(row.created_at ?? ''), excerpt: typeof row.excerpt === 'string' ? row.excerpt : null, body: String(row.body ?? ''), mediaUrl: typeof row.media_url === 'string' ? row.media_url : null, featured: row.featured === true })), error: null }
}

export async function saveNewsArticle(client: SupabaseClient, input: { id?: string; organizationId: string; authorId: string; draft: NewsDraft; publish: boolean }): Promise<{ error: string | null }> {
  const problem = validateNewsDraft(input.draft)
  if (problem) return { error: problem }
  const fields = {
    title: input.draft.title.trim(), excerpt: input.draft.excerpt.trim() || null, body: input.draft.body.trim(), content_type: input.draft.contentType,
    tournament_id: input.draft.tournamentId, media_url: input.draft.mediaUrl.trim() || null, featured: input.draft.featured,
    status: input.publish ? 'published' : 'draft', published_at: input.publish ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  }
  const result = input.id
    ? await client.from('news_articles').update(fields).eq('id', input.id).select('id')
    : await client.from('news_articles').insert({ ...fields, slug: newsSlug(input.draft.title), organization_id: input.organizationId, author_id: input.authorId }).select('id')
  if (result.error) return { error: /updated_at/.test(result.error.message) ? 'News needs migration 022 to be applied.' : /row-level security/i.test(result.error.message) ? 'Only owner, operations or media members of this organization can manage its news.' : result.error.message }
  if (!result.data?.length) return { error: 'The article was not saved. You may no longer have permission to edit it.' }
  return { error: null }
}

export async function setNewsStatus(client: SupabaseClient, articleId: string, status: 'draft' | 'published' | 'archived'): Promise<{ error: string | null }> {
  const result = await client.from('news_articles').update({ status, published_at: status === 'published' ? new Date().toISOString() : undefined, updated_at: new Date().toISOString() }).eq('id', articleId).select('id')
  if (result.error) return { error: result.error.message }
  if (!result.data?.length) return { error: 'The article was not changed.' }
  return { error: null }
}
