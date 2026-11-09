import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { forgetBrandingUrl, resolveBrandingUrl } from '../lib/tournamentBranding'

// Tournament logo and cover images from the private `tournament-media` bucket.
// Each component signs its own stored object path with the client it is given
// and always renders a fixed-size branded fallback underneath, so a missing,
// slow, or failed image never shifts the layout or leaves an empty box.

type BrandingState = 'empty' | 'loading' | 'ready' | 'error'

function useBrandingImage(client: SupabaseClient | null, path: string | null | undefined) {
  const [resolved, setResolved] = useState<{ path: string; url: string | null } | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!client || !path) return
    let active = true
    void resolveBrandingUrl(client, path).then(url => { if (active) setResolved({ path, url }) })
    return () => { active = false }
  }, [client, path])
  const url = resolved && resolved.path === path ? resolved.url : null
  const state: BrandingState = !client || !path ? 'empty'
    : !resolved || resolved.path !== path ? 'loading'
    : !url || failedUrl === url ? 'error'
    : loadedUrl === url ? 'ready' : 'loading'
  const onError = () => { if (url) { setFailedUrl(url); forgetBrandingUrl(client, path) } }
  const onLoad = () => { if (url) setLoadedUrl(url) }
  return { url: url && failedUrl !== url ? url : null, state, onError, onLoad }
}

function brandingMonogram(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(word => word[0] ?? '').join('').toUpperCase() || '?'
}

export function TournamentLogo({ client, path, name, className = '', fallback }: { client: SupabaseClient | null; path: string | null | undefined; name: string; className?: string; fallback?: ReactNode }) {
  const image = useBrandingImage(client, path)
  return <span className={`tournament-logo ${className}`.trim()} data-state={image.state}>
    <span className="tournament-logo-fallback" aria-hidden="true">{fallback ?? brandingMonogram(name)}</span>
    {image.url ? <img src={image.url} alt={`${name} logo`} loading="lazy" decoding="async" onLoad={image.onLoad} onError={image.onError} /> : null}
  </span>
}

export function TournamentCover({ client, path, name, sport, className = '' }: { client: SupabaseClient | null; path: string | null | undefined; name: string; sport?: string; className?: string }) {
  const image = useBrandingImage(client, path)
  const sportKey = String(sport ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'island'
  return <span className={`tournament-cover tf-cover sport-${sportKey} ${className}`.trim()} data-state={image.state}>
    {image.url ? <img src={image.url} alt={`${name} cover image`} loading="lazy" decoding="async" onLoad={image.onLoad} onError={image.onError} /> : null}
  </span>
}
