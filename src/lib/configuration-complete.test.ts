import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyConfig, cleanConfig, cleanPlatform, configProblems, documentLimit, imageLimit, legalVersion, manifestFor, parsePlaceLines, placeLists, platformProblems, sizeLabel, BUILT_IN_ATOLLS } from './appConfig'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const sql = read('supabase/migrations/202611010039_configuration_complete.sql')
const v035 = read('supabase/migrations/202611010035_super_admin_release_two.sql')
const icon = 'https://abc.supabase.co/storage/v1/object/public/platform-media/pwa/2026-11-01-icon.png'
const MB = 1024 * 1024

afterEach(() => applyConfig({}, {}))

describe('Places, upload limits and legal versions', () => {
  it('parses one place per line with the detail after the last comma', () => {
    expect(parsePlaceLines('Hulhumalé, Kaafu\n\n  Kanditheemu \nStadium, Block A, Malé')).toEqual([{ name: 'Hulhumalé', detail: 'Kaafu' }, { name: 'Kanditheemu' }, { name: 'Stadium, Block A', detail: 'Malé' }])
  })
  it('cleans duplicates and drops built-in limits', () => {
    const cleaned = cleanPlatform({ places: { atolls: ['Kaafu', ' kaafu ', ''], islands: [{ name: 'Malé ', atoll: ' ' }, { name: 'malé' }], venues: [] }, uploads: { imageMb: 5, documentMb: 4 }, legal: { terms: { version: ' 2.0 ', effective: '2026-11-01' }, privacy: { version: '' } } })
    expect(cleaned.places).toEqual({ atolls: ['Kaafu'], islands: [{ name: 'Malé' }] })
    expect(cleaned.uploads).toEqual({ documentMb: 4 })
    expect(cleaned.legal).toEqual({ terms: { version: '2.0', effective: '2026-11-01' } })
  })
  it('rejects limits above storage, bad versions and unsafe names', () => {
    expect(platformProblems({ uploads: { imageMb: 6 } })[0]).toMatch(/1 to 5 MB/)
    expect(platformProblems({ uploads: { documentMb: 2.5 } })[0]).toMatch(/1 to 10 MB/)
    expect(platformProblems({ legal: { terms: { version: 'v 1' } } })[0]).toMatch(/Terms version/)
    expect(platformProblems({ places: { venues: [{ name: '<b>' }] } }).length).toBeGreaterThan(0)
    expect(platformProblems({ places: { atolls: ['Kaafu'] }, uploads: { imageMb: 3 }, legal: { privacy: { version: '1.1', effective: '2026-11-01' } } })).toEqual([])
  })
  it('applies the published lists, limits and versions', () => {
    expect(placeLists().atolls).toEqual(BUILT_IN_ATOLLS)
    expect(imageLimit(2 * MB)).toBe(2 * MB)
    applyConfig({}, { places: { atolls: ['Kaafu'], venues: [{ name: 'National Stadium', island: 'Malé' }] }, uploads: { imageMb: 1, documentMb: 4 }, legal: { terms: { version: '2.0' } } })
    expect(placeLists()).toEqual({ atolls: ['Kaafu'], islands: [], venues: ['National Stadium'] })
    expect(imageLimit(2 * MB)).toBe(1 * MB)
    expect(documentLimit()).toBe(4 * MB)
    expect(documentLimit(2 * MB)).toBe(2 * MB)
    expect(sizeLabel(imageLimit())).toBe('1 MB')
    expect(legalVersion('terms')).toEqual({ version: '2.0' })
    expect(legalVersion('privacy')).toBeNull()
  })
})

describe('Installed app', () => {
  it('checks the name, icon and colours', () => {
    expect(configProblems({ pwa: { appName: 'K' } })[0]).toMatch(/at least 2/)
    expect(configProblems({ pwa: { iconUrl: icon.replace('.png', '.jpg') } })[0]).toMatch(/PNG from the media library/)
    expect(configProblems({ pwa: { iconUrl: 'https://evil.example/icon.png' } })[0]).toMatch(/PNG from the media library/)
    expect(configProblems({ pwa: { themeColor: 'red' } })[0]).toMatch(/colours/)
    expect(configProblems({ pwa: { appName: 'Kulhivaru Sports', shortName: 'Kulhivaru', iconUrl: icon, themeColor: '#071a2b' } })).toEqual([])
  })
  it('stores only changes and builds a manifest with absolute icons', () => {
    expect(cleanConfig({ pwa: { appName: 'Kulhivaru+', themeColor: '#0EA5E9', backgroundColor: '#123456' } }).pwa).toEqual({ backgroundColor: '#123456' })
    const manifest = manifestFor({ pwa: { appName: 'Kulhivaru Sports', iconUrl: icon } }, 'https://kulhivaru.mv')
    expect(manifest).toMatchObject({ id: '/', name: 'Kulhivaru Sports', short_name: 'Kulhivaru Sports', start_url: '/', scope: '/' })
    expect((manifest.icons as Array<{ src: string }>).every(item => item.src === icon)).toBe(true)
    expect((manifestFor({}, 'https://kulhivaru.mv').icons as Array<{ src: string }>)[0].src).toBe('https://kulhivaru.mv/assets/kulhivaru-mark.png')
  })
  it('lets the service worker accept only a same-origin, fixed-shape manifest', () => {
    const sw = read('public/sw.js')
    expect(sw).toContain("new URL(source.url).origin !== self.location.origin")
    expect(sw).toContain('if (!validManifest(data.manifest)) return undefined')
    expect(sw).toContain("key !== CACHE && key !== CONFIG_CACHE")
    expect(sw).toMatch(/platform-media\\\/\[A-Za-z0-9\/_\.-\]\{1,200\}\\\.png\$/)
  })
})

describe('Migration 039 (static review)', () => {
  const v035fn = v035.slice(v035.indexOf('create or replace function public.app_config_problem_for'), v035.indexOf('$$;', v035.indexOf('create or replace function public.app_config_problem_for')))
  it('changes only the configuration check', () => {
    expect(sql.match(/create or replace function/g)).toHaveLength(1)
    expect(sql).toContain('create or replace function public.app_config_problem_for(p_kind text, p_config jsonb)')
    expect(sql.replace(/--.*$/gm, '')).not.toMatch(/\b(alter|drop|create) (table|policy)\b|\bgrant\b|\brevoke\b/)
    expect(sql).toContain("immutable set search_path = ''")
  })
  it('keeps every 035 rule', () => {
    const codes = [...new Set(v035fn.match(/return '[a-z_:]+'/g) ?? [])]
    expect(codes.length).toBeGreaterThan(20)
    for (const code of codes) expect(sql, code).toContain(code)
  })
  it('accepts only the fixed new fields', () => {
    expect(sql).toContain("array['maintenance', 'features', 'help', 'sports', 'places', 'uploads', 'legal']")
    expect(sql).toContain("array['installTitle', 'installText', 'appName', 'shortName', 'iconUrl', 'themeColor', 'backgroundColor']")
    expect(sql).toContain("::integer between 1 and 5")
    expect(sql).toContain("::integer between 1 and 10")
    expect(sql).toContain("!~* '\\.png$'")
  })
})
