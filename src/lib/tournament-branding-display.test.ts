import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BRANDING_SIGNED_URL_TTL_SECONDS, TOURNAMENT_MEDIA_BUCKET, isBrandingObjectPath, publicTournamentBranding,
  resolveBrandingUrl, uploadBrandingFile,
} from './tournamentBranding'
import { loadOrganizationTournaments, loadOrganizerTournament, updateTournamentBasics, updateTournamentBranding } from './organizer'
import { getPublishedDetail, getPublishedTournaments, searchPublished } from './publicData'
import { TournamentCover, TournamentLogo } from '../components/TournamentBranding'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const ORG = '6df81b3e-f422-4e2b-8425-2a4eabe1afab'
const TOURN = '9e122e5f-cc84-4cb2-8135-5cd1a3fef6ad'
const LOGO = `organizations/${ORG}/tournaments/${TOURN}/logo/6eea272b-9d93-4e4c-a69b-168da99eb2ce.png`
const COVER = `organizations/${ORG}/tournaments/${TOURN}/cover/ae2ea105-b761-41af-954d-2510f6f6d03b.png`

type SignCall = { bucket: string; path: string; ttl: number }
// Storage-only fake: any database access (`client.from`) throws, which proves
// that resolving a display URL never writes anything back to a table.
function storageClient(sign: (path: string) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>) {
  const calls: SignCall[] = []
  const client = {
    from: () => { throw new Error('display must not touch database tables') },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, ttl: number) => { calls.push({ bucket, path, ttl }); return sign(path) },
        getPublicUrl: () => { throw new Error('getPublicUrl must not be used for a private bucket') },
      }),
    },
  } as unknown as SupabaseClient
  return { client, calls }
}
const signOk = (path: string) => Promise.resolve({ data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/tournament-media/${path}?token=t` }, error: null })

// Query-builder fake that records the selected columns per table.
function queryClient() {
  const selects: Array<{ table: string; columns: string }> = []
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = []
  const builder = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {}
    for (const method of ['eq', 'neq', 'order', 'ilike', 'limit', 'in', 'or', 'not']) chain[method] = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
    chain.then = (resolve: (value: unknown) => void) => resolve({ data: [], error: null })
    return chain
  }
  const client = {
    from: (table: string) => ({
      select: (columns: string) => { selects.push({ table, columns }); return builder() },
      update: (patch: Record<string, unknown>) => { updates.push({ table, patch }); return builder() },
    }),
  } as unknown as SupabaseClient
  return { client, selects, updates }
}

describe('tournament branding storage access', () => {
  it('uses the private tournament-media bucket with short-lived signed URLs', async () => {
    expect(TOURNAMENT_MEDIA_BUCKET).toBe('tournament-media')
    const { client, calls } = storageClient(signOk)
    const url = await resolveBrandingUrl(client, LOGO)
    expect(url).toContain('/object/sign/tournament-media/')
    expect(calls).toEqual([{ bucket: 'tournament-media', path: LOGO, ttl: BRANDING_SIGNED_URL_TTL_SECONDS }])
    expect(BRANDING_SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(60 * 60)
  })

  it('never calls getPublicUrl for tournament branding', () => {
    for (const file of ['src/lib/tournamentBranding.ts', 'src/components/TournamentBranding.tsx', 'src/components/HomepageSections.tsx', 'src/components/PublicPage.tsx', 'src/components/OrganizerWorkspace.tsx', 'src/components/TournamentWorkspace.tsx']) {
      expect(source(file), file).not.toMatch(/getPublicUrl/)
    }
  })

  it('reuses a signed URL until close to expiry, then re-signs', async () => {
    let clock = 1_000_000
    const { client, calls } = storageClient(signOk)
    await resolveBrandingUrl(client, COVER, () => clock)
    await resolveBrandingUrl(client, COVER, () => clock)
    expect(calls).toHaveLength(1)
    clock += BRANDING_SIGNED_URL_TTL_SECONDS * 1000
    await resolveBrandingUrl(client, COVER, () => clock)
    expect(calls).toHaveLength(2)
  })

  it('keeps signed URLs separate per client so organizer results never reach guests', async () => {
    const organizer = storageClient(signOk)
    const guest = storageClient(() => Promise.resolve({ data: null, error: { message: 'Object not found' } }))
    expect(await resolveBrandingUrl(organizer.client, LOGO)).not.toBeNull()
    expect(await resolveBrandingUrl(guest.client, LOGO)).toBeNull()
  })

  it('returns null safely when signing fails or throws, and retries on the next fetch', async () => {
    let attempt = 0
    const { client, calls } = storageClient(path => {
      attempt += 1
      if (attempt === 1) return Promise.resolve({ data: null, error: { message: 'Object not found' } })
      if (attempt === 2) return Promise.reject(new Error('network down'))
      return signOk(path)
    })
    expect(await resolveBrandingUrl(client, `organizations/${ORG}/tournaments/${TOURN}/logo/retry.png`)).toBeNull()
    expect(await resolveBrandingUrl(client, `organizations/${ORG}/tournaments/${TOURN}/logo/retry.png`)).toBeNull()
    expect(await resolveBrandingUrl(client, `organizations/${ORG}/tournaments/${TOURN}/logo/retry.png`)).toContain('token=')
    expect(calls).toHaveLength(3)
  })

  it('returns null without signing when there is no image, no client, or the value is not an object path', async () => {
    const { client, calls } = storageClient(signOk)
    expect(await resolveBrandingUrl(client, null)).toBeNull()
    expect(await resolveBrandingUrl(client, '')).toBeNull()
    expect(await resolveBrandingUrl(null, LOGO)).toBeNull()
    expect(await resolveBrandingUrl(client, `https://x.supabase.co/storage/v1/object/sign/tournament-media/${LOGO}?token=abc`)).toBeNull()
    expect(await resolveBrandingUrl(client, 'blob:http://localhost:5173/1234')).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('tournament branding persistence', () => {
  it('accepts only bare object paths, never signed, public, blob or data URLs', () => {
    expect(isBrandingObjectPath(LOGO)).toBe(true)
    expect(isBrandingObjectPath(COVER)).toBe(true)
    expect(isBrandingObjectPath(`https://x.supabase.co/storage/v1/object/public/tournament-media/${LOGO}`)).toBe(false)
    expect(isBrandingObjectPath('blob:http://localhost/abc')).toBe(false)
    expect(isBrandingObjectPath('data:image/png;base64,AAAA')).toBe(false)
    expect(isBrandingObjectPath(`organizations/${ORG}/tournaments/${TOURN}/logo/../x.png`)).toBe(false)
  })

  it('upload returns the object path, and the tournament update stores only that path', async () => {
    const uploads: string[] = []
    const client = { storage: { from: (bucket: string) => ({ upload: async (path: string) => { uploads.push(`${bucket}:${path}`); return { data: { path }, error: null } } }) } } as unknown as SupabaseClient
    const file = new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' })
    const uploaded = await uploadBrandingFile(client, ORG, TOURN, 'logo', file)
    expect(uploads[0]).toMatch(/^tournament-media:organizations\//)
    expect(isBrandingObjectPath(uploaded.path)).toBe(true)

    const query = queryClient()
    await updateTournamentBasics(query.client, TOURN, 'Cup', 'football', { logoPath: uploaded.path })
    const patch = query.updates[0].patch
    expect(patch.logo_path).toBe(uploaded.path)
    expect(Object.values(patch).some(value => typeof value === 'string' && /^(https?:|blob:|data:)/.test(value))).toBe(false)
  })

  it('branding-only update writes paths without touching name or sport', async () => {
    const query = queryClient()
    await updateTournamentBranding(query.client, TOURN, { coverPath: COVER })
    expect(Object.keys(query.updates[0].patch).sort()).toEqual(['cover_path', 'updated_at'])
  })

  it('Save & Exit and Save & Continue both upload selected branding files', () => {
    const workspace = source('src/components/TournamentWorkspace.tsx')
    const saveExit = workspace.slice(workspace.indexOf('const saveExit = async'), workspace.indexOf('const submitSave = async'))
    const submit = workspace.slice(workspace.indexOf('const submitSave = async'))
    expect(saveExit).toContain('await saveBrandingFiles()')
    expect(submit).toContain('await saveBrandingFiles()')
  })

  it('display helpers contain no database write for signed URLs', () => {
    const helper = source('src/lib/tournamentBranding.ts')
    const display = helper.slice(helper.indexOf('export const TOURNAMENT_MEDIA_BUCKET'))
    expect(display).not.toMatch(/\.update\(|\.insert\(|\.upsert\(/)
    expect(source('src/components/TournamentBranding.tsx')).not.toMatch(/\.update\(|\.insert\(|\.upsert\(|localStorage/)
  })
})

describe('tournament branding loaders', () => {
  it('organizer loaders select logo_path and cover_path', async () => {
    const query = queryClient()
    await loadOrganizationTournaments(query.client, ORG)
    await loadOrganizerTournament(query.client, TOURN)
    const tournamentSelects = query.selects.filter(item => item.table === 'tournaments')
    expect(tournamentSelects).toHaveLength(2)
    for (const item of tournamentSelects) expect(item.columns).toMatch(/logo_path.*cover_path|cover_path.*logo_path/)
  })

  it('public loaders select logo_path, cover_path and the publication fields the guard needs', async () => {
    const query = queryClient()
    await getPublishedTournaments(query.client)
    await getPublishedDetail(query.client, 'tournament', 'cup')
    await searchPublished(query.client, 'cup')
    const tournamentSelects = query.selects.filter(item => item.table === 'tournaments')
    expect(tournamentSelects.length).toBeGreaterThanOrEqual(3)
    for (const item of tournamentSelects) for (const column of ['logo_path', 'cover_path', 'is_published', 'status']) expect(item.columns).toContain(column)
  })
})

describe('tournament branding visibility', () => {
  it('guests get branding for a published, non-draft tournament', () => {
    expect(publicTournamentBranding({ is_published: true, status: 'registration_open', logo_path: LOGO, cover_path: COVER })).toEqual({ logoPath: LOGO, coverPath: COVER })
  })

  it('guests never get branding for unpublished or draft tournaments', () => {
    expect(publicTournamentBranding({ is_published: false, status: 'setup', logo_path: LOGO, cover_path: COVER })).toEqual({ logoPath: null, coverPath: null })
    expect(publicTournamentBranding({ is_published: true, status: 'draft', logo_path: LOGO, cover_path: COVER })).toEqual({ logoPath: null, coverPath: null })
    expect(publicTournamentBranding({ status: 'registration_open', logo_path: LOGO, cover_path: COVER })).toEqual({ logoPath: null, coverPath: null })
    expect(publicTournamentBranding(null)).toEqual({ logoPath: null, coverPath: null })
  })

  it('public pages sign with the session-less public client through the publication guard', () => {
    for (const file of ['src/components/HomepageSections.tsx', 'src/components/PublicPage.tsx']) {
      const text = source(file)
      expect(text, file).toContain('publicTournamentBranding(')
      expect(text, file).toMatch(/client=\{publicSupabase\}/)
      expect(text, file).not.toMatch(/path=\{(record|tournament|spotlight)\.(logo|cover)_path\}/)
    }
  })

  it('organizer views sign draft branding with the authenticated client and no publication filter', async () => {
    for (const file of ['src/components/OrganizerWorkspace.tsx', 'src/components/TournamentWorkspace.tsx']) {
      const text = source(file)
      expect(text, file).toContain('path={tournament.logo_path}')
      expect(text, file).toContain('path={tournament.cover_path}')
      expect(text, file).not.toContain('publicTournamentBranding')
      expect(text, file).not.toContain('publicSupabase')
    }
    const organizer = storageClient(signOk)
    expect(await resolveBrandingUrl(organizer.client, `organizations/${ORG}/tournaments/${TOURN}/cover/draft.png`)).toContain('token=')
  })
})

describe('tournament branding fallbacks', () => {
  it('renders a branded monogram and no image when the logo is missing', () => {
    const html = renderToStaticMarkup(createElement(TournamentLogo, { client: null, path: null, name: 'Male Island Cup' }))
    expect(html).toContain('data-state="empty"')
    expect(html).toContain('MI')
    expect(html).not.toContain('<img')
  })

  it('renders the sport artwork fallback when the cover is missing', () => {
    const html = renderToStaticMarkup(createElement(TournamentCover, { client: null, path: null, name: 'Male Island Cup', sport: 'futsal' }))
    expect(html).toContain('sport-futsal')
    expect(html).toContain('data-state="empty"')
    expect(html).not.toContain('<img')
  })

  it('shows the fallback while a signed URL is still loading', () => {
    const { client } = storageClient(signOk)
    const html = renderToStaticMarkup(createElement(TournamentLogo, { client, path: LOGO, name: 'Cup' }))
    expect(html).toContain('data-state="loading"')
    expect(html).toContain('tournament-logo-fallback')
  })

  it('uses object-fit cover for covers, contain for logos, and meaningful alt text', () => {
    const css = source('src/styles.css')
    expect(css).toMatch(/\.tournament-cover img\{[^}]*object-fit:cover/)
    expect(css).toMatch(/\.tournament-logo img\{[^}]*object-fit:contain/)
    const component = source('src/components/TournamentBranding.tsx')
    expect(component).toContain('alt={`${name} logo`}')
    expect(component).toContain('alt={`${name} cover image`}')
  })
})

describe('tournament branding read-policy repair migration', () => {
  const repair = source('supabase/migrations/20261030071738_fix_tournament_branding_reads.sql')
  const original = source('supabase/migrations/202610240023_tournament_branding.sql')

  it('leaves the applied 023 migration and the private bucket untouched', () => {
    expect(original).toContain("values ('tournament-media', 'tournament-media', false)")
    expect(repair).not.toMatch(/update\s+storage\.buckets|public\s*=\s*true|insert into storage\.buckets/i)
    expect(repair).not.toMatch(/\b(delete from|truncate|alter table|insert into)\b/i)
  })

  it('replaces the broken policy with a helper that receives storage.objects.name', () => {
    expect(repair).toContain('drop policy if exists "tournament media public read for published" on storage.objects')
    expect(repair).toMatch(/for select to anon, authenticated\s+using \(bucket_id = 'tournament-media' and public\.tournament_media_read_allowed\(name\)\)/)
    expect(repair).toMatch(/security definer set search_path = public/)
  })

  it('lets organization members read draft branding but guests only current published branding', () => {
    expect(repair).toMatch(/om\.organization_id = t\.organization_id and om\.user_id = auth\.uid\(\)/)
    expect(repair).toMatch(/t\.is_published and t\.status <> 'draft'\s+and \(t\.logo_path = p_object_name or t\.cover_path = p_object_name\)/)
  })

  it('parses the exact uploaded path shape', () => {
    const pattern = repair.match(/'\^organizations\/(.+?)\$'/)?.[0]
    expect(pattern).toBeTruthy()
    const regex = new RegExp(pattern!.slice(1, -1))
    expect(regex.test(LOGO)).toBe(true)
    expect(regex.test(COVER)).toBe(true)
    expect(regex.test(`organizations/${ORG}/tournaments/${TOURN}/documents/x.pdf`)).toBe(false)
    expect(regex.test(`organizations/------------------------------------/tournaments/${TOURN}/logo/x.png`)).toBe(false)
  })
})
