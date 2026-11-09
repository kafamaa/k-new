import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { ExternalLink, Newspaper, Pencil } from 'lucide-react'
import { loadOrganizationNews, NEWS_CONTENT_LABELS, NEWS_CONTENT_TYPES, saveNewsArticle, setNewsStatus, type NewsDraft, type NewsContentType, type OrganizationArticle } from '../lib/news'

const EMPTY: NewsDraft = { title: '', excerpt: '', body: '', contentType: 'news', tournamentId: null, mediaUrl: '', featured: false }

// Organizer news: write a draft, publish it to the public News page, or move
// it back to draft / archive. Only published articles are ever public.
export function NewsSection({ client, user, organizationId, tournaments, onNotice }: { client: SupabaseClient; user: User; organizationId: string; tournaments: Array<{ id: string; name: string; is_published: boolean }>; onNotice: (message: string) => void }) {
  const [articles, setArticles] = useState<OrganizationArticle[]>([])
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState<NewsDraft>(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => { void loadOrganizationNews(client, organizationId).then(result => { setArticles(result.data); setLoadError(result.error ?? '') }) }, [client, organizationId])
  useEffect(() => { reload() }, [reload])

  const save = async (event: FormEvent, publish: boolean) => {
    event.preventDefault(); setBusy(true); setError('')
    const result = await saveNewsArticle(client, { id: editingId ?? undefined, organizationId, authorId: user.id, draft, publish })
    setBusy(false)
    if (result.error) return setError(result.error)
    onNotice(publish ? 'Article published to the public News page.' : 'Draft saved. It stays private until you publish it.')
    setDraft(EMPTY); setEditingId(null); reload()
  }
  const edit = (article: OrganizationArticle) => {
    setEditingId(article.id)
    setDraft({ title: article.title, excerpt: article.excerpt ?? '', body: article.body, contentType: (NEWS_CONTENT_TYPES as readonly string[]).includes(article.contentType) ? article.contentType as NewsContentType : 'news', tournamentId: article.tournamentId, mediaUrl: article.mediaUrl ?? '', featured: article.featured })
  }
  const changeStatus = async (article: OrganizationArticle, status: 'draft' | 'published' | 'archived') => {
    const result = await setNewsStatus(client, article.id, status)
    if (result.error) return setError(result.error)
    onNotice(status === 'published' ? 'Article published.' : status === 'archived' ? 'Article archived and removed from the public page.' : 'Article moved back to draft.')
    reload()
  }
  const tournamentName = (id: string | null) => tournaments.find(tournament => tournament.id === id)?.name

  return <div className="organizer-section">
    <div className="section-head"><div><p className="eyebrow">NEWS</p><h1>News &amp; announcements</h1><p>Drafts are private. Publishing puts the article on the public News page.</p></div></div>
    <form className="panel-block news-form" onSubmit={event => void save(event, false)}>
      <h3><Pencil size={15} /> {editingId ? 'Edit article' : 'New article'}</h3>
      <label>Title<input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Type<select value={draft.contentType} onChange={event => setDraft({ ...draft, contentType: event.target.value as NewsContentType })}>{NEWS_CONTENT_TYPES.map(type => <option value={type} key={type}>{NEWS_CONTENT_LABELS[type]}</option>)}</select></label>
      <label>Tournament (optional)<select value={draft.tournamentId ?? ''} onChange={event => setDraft({ ...draft, tournamentId: event.target.value || null })}><option value="">Whole organization</option>{tournaments.map(tournament => <option value={tournament.id} key={tournament.id}>{tournament.name}{tournament.is_published ? '' : ' (private draft)'}</option>)}</select></label>
      <label>Summary (optional)<input value={draft.excerpt} onChange={event => setDraft({ ...draft, excerpt: event.target.value })} /></label>
      <label>Article<textarea rows={8} value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} /></label>
      <label>Video or media link (optional)<input value={draft.mediaUrl} onChange={event => setDraft({ ...draft, mediaUrl: event.target.value })} placeholder="https://" /></label>
      <label className="checkbox-row"><input type="checkbox" checked={draft.featured} onChange={event => setDraft({ ...draft, featured: event.target.checked })} /> Feature on the homepage</label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="button-row">
        <button type="submit" className="outline-button dark" disabled={busy}>Save draft</button>
        <button type="button" className="primary-button" disabled={busy} onClick={event => void save(event as unknown as FormEvent, true)}>Publish</button>
        {editingId && <button type="button" className="ghost-button" onClick={() => { setEditingId(null); setDraft(EMPTY) }}>Cancel edit</button>}
      </div>
    </form>
    <div className="panel-block"><h3><Newspaper size={15} /> Articles</h3>
      {loadError && <div className="form-error" role="alert">News could not be loaded: {loadError}</div>}
      {articles.length === 0 ? <p className="empty-note">No articles yet.</p>
        : <ul className="plain-list news-list">{articles.map(article => <li key={article.id}>
          <strong>{article.title}</strong> · {NEWS_CONTENT_LABELS[article.contentType as NewsContentType] ?? article.contentType}{tournamentName(article.tournamentId) ? ` · ${tournamentName(article.tournamentId)}` : ''} <span className={`status-pill status-${article.status === 'published' ? 'ok' : 'neutral'}`}>{article.status}</span>
          <span className="button-row compact">
            <button type="button" className="ghost-button" onClick={() => edit(article)}>Edit</button>
            {article.status !== 'published' && <button type="button" className="ghost-button" onClick={() => void changeStatus(article, 'published')}>Publish</button>}
            {article.status === 'published' && <><a className="ghost-button" href={`#news/${encodeURIComponent(article.slug)}`} target="_blank" rel="noreferrer">View <ExternalLink size={12} /></a><button type="button" className="ghost-button" onClick={() => void changeStatus(article, 'draft')}>Unpublish</button></>}
            {article.status !== 'archived' && <button type="button" className="ghost-button" onClick={() => void changeStatus(article, 'archived')}>Archive</button>}
          </span>
        </li>)}</ul>}
    </div>
  </div>
}
