import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanConfig, cleanPlatform, configProblems, fontHref, maintenanceActive, applyConfig, navigationFor, platformProblems, featureOn, sportVisible } from './appConfig'
import { actionOutcome, financeCsv, mediaPath, type FinanceRow } from './superAdminOps'
import { setTranslationOverrides, translate } from './i18n'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const migration = read('supabase/migrations/202611010035_super_admin_release_two.sql')

describe('Release Two migration (static review)', () => {
  it('requires a second, different administrator for critical actions, with no owner exception', () => {
    const decide = migration.slice(migration.indexOf('function public.admin_decide_action'), migration.indexOf('function public.admin_list_actions'))
    expect(decide).toContain("if v_row.proposed_by = v_me then raise exception 'self_approval_not_allowed'")
    expect(decide).not.toContain('admin_is_owner')
    expect(decide).toContain('perform public.admin_require_recent_auth();')
  })
  it('corrects results as new versions and recalculates once', () => {
    const execute = migration.slice(migration.indexOf('function public.admin_execute_result_change'), migration.indexOf('function public.admin_execute_merge'))
    expect(execute).toContain('insert into public.match_result_versions')
    expect(execute).not.toMatch(/delete from public\.match_result_versions|update public\.match_result_versions set score/)
    expect(execute.match(/recalculate_stage_standings/g)?.length).toBe(1)
  })
  it('merges without deleting history and stops on double counting', () => {
    expect(migration).toContain("'same_match'")
    expect(migration).toContain("'same_roster'")
    expect(migration).toContain('merged_into = v_c')
    const merge = migration.slice(migration.indexOf('function public.admin_execute_merge'), migration.indexOf('function public.admin_decide_action'))
    expect(merge).not.toMatch(/delete from public\.(player_profiles|match_player_participants|player_team_memberships|match_events|sport_milestones)/)
    expect(merge).not.toMatch(/player_identity_keys|private_documents|player_private_details/)
  })
  it('hides frozen results from the public with a restrictive policy and from the feed', () => {
    expect(migration).toContain('as restrictive for select to anon, authenticated')
    expect(migration).toContain('and not exists (select 1 from public.match_result_freezes f where f.match_id = v.match_id and f.lifted_at is null)')
  })
  it('never returns receipt files, private notes or document paths from finance audit', () => {
    const finance = migration.slice(migration.indexOf('function public.admin_finance_records'), migration.indexOf('function public.admin_finance_finding'))
    expect(finance).not.toMatch(/private_notes|tf\.receipt_path,|proof_document_id,/)
  })
  it('keeps the media bucket to images and blocks overwriting', () => {
    expect(migration).toContain("array['image/png', 'image/jpeg', 'image/webp']")
    expect(migration).not.toMatch(/on storage\.objects for (update|delete)/)
  })
  it('uses an empty search_path on every SECURITY DEFINER function it adds (feed keeps 032 setting)', () => {
    const definers = migration.match(/security definer set search_path = [^ ]+/g) ?? []
    expect(definers.filter(line => !line.endsWith("''")).length).toBe(1)
  })
})

// PL/pgSQL ends an IF condition at the first THEN, so a bare CASE inside it is a
// syntax error (found when the owner ran 034). A CASE there must be in parentheses.
describe('PL/pgSQL syntax guard', () => {
  it('never puts an unparenthesized CASE inside an IF condition', () => {
    for (const file of ['202611010034_super_admin_release_one.sql', '202611010035_super_admin_release_two.sql']) {
      const offending = read(`supabase/migrations/${file}`).split('\n').filter(line => /^\s*(if|elsif)\b/.test(line) && /[^(]\s*case when/.test(line.split(/\bthen\b/)[0] + ' then'))
      expect(offending, file).toEqual([])
    }
  })
})

describe('Wider customization', () => {
  it('validates brand, links and navigation', () => {
    expect(configProblems({ brand: { appName: 'Kulhivaru+', supportEmail: 'help@example.mv' } })).toEqual([])
    expect(configProblems({ brand: { logoUrl: 'https://evil.example/logo.png', logoAlt: 'Logo' } }).length).toBe(1)
    expect(configProblems({ brand: { logoUrl: 'https://abc.supabase.co/storage/v1/object/public/platform-media/brand/logo.png' } })).toContain('Describe the logo for screen readers.')
    expect(configProblems({ brand: { social: [{ label: 'X', url: 'javascript:alert(1)' }] } }).length).toBeGreaterThan(0)
    expect(configProblems({ navigation: { hidden: ['admin'] } })).toContain('Unknown navigation destination.')
  })
  it('orders, relabels and hides navigation', () => {
    const nav = navigationFor({ navigation: { order: ['news', 'teams'], hidden: ['players'], labels: { news: 'Stories' } } })
    // The "live" destination is labelled Matches since the final plan (6.1).
    expect(nav.filter(item => item.main).map(item => item.label)).toEqual(['Stories', 'Teams', 'Tournaments', 'Matches'])
  })
  it('loads only whitelisted Google fonts', () => {
    expect(fontHref({})).toBeNull()
    expect(fontHref({ fonts: { heading: 'inter', dhivehi: 'noto-sans-thaana' } })).toBe('https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=Noto+Sans+Thaana:wght@400;600;700&display=swap')
  })
  it('drops values equal to the built-in look', () => {
    expect(cleanConfig({ brand: { appName: 'Kulhivaru+' }, templates: { publicHero: 'standard' }, translations: { 'nav.home': { en: '' } } })).toEqual({})
  })
  it('applies translation overrides with fallback', () => {
    setTranslationOverrides({ 'nav.news': { en: 'Stories' } })
    expect(translate('en', 'nav.news')).toBe('Stories')
    expect(translate('dv', 'nav.home')).not.toBe('nav.home')
    setTranslationOverrides({})
    expect(translate('en', 'nav.news')).toBe('News')
  })
})

describe('Platform configuration', () => {
  it('requires a message for maintenance and keeps at least one sport', () => {
    expect(platformProblems({ maintenance: { enabled: true } })).toContain('Write the maintenance message visitors will see.')
    expect(platformProblems({ sports: { hidden: ['football', 'futsal', 'handball', 'volleyball', 'basketball', 'basketball_3x3'] } })).toContain('At least one sport must stay visible.')
    expect(cleanPlatform({ features: { news: true, recentlyViewed: false } })).toEqual({ features: { recentlyViewed: false } })
  })
  it('turns maintenance, features and sports on and off from the published config', () => {
    applyConfig({}, { maintenance: { enabled: true, message: 'Back soon', endsAt: '2000-01-01T00:00:00Z' }, features: { news: false }, sports: { hidden: ['handball'] } })
    expect(maintenanceActive()).toBe(false)
    expect(featureOn('news')).toBe(false)
    expect(sportVisible('handball')).toBe(false)
    applyConfig({}, { maintenance: { enabled: true, message: 'Back soon' } })
    expect(maintenanceActive()).toBe(true)
    applyConfig({}, {})
    expect(maintenanceActive()).toBe(false)
  })
})

describe('Operations helpers', () => {
  it('builds safe media paths matching the server rule', () => {
    const path = mediaPath('brand', 'My Logo (final).PNG', new Date('2026-10-31T00:00:00Z'))
    expect(path).toMatch(/^brand\/2026-10-31-[a-z0-9]+-my-logo-final\.png$/)
    expect(path).toMatch(/^(brand|hero|backgrounds|sports|covers|icons|email|pwa|social|help)\/[A-Za-z0-9_.-]{1,160}$/)
  })
  it('exports finance without formula injection or identifiers', () => {
    const row: FinanceRow = { record_id: 'secret-id', amount_mvr: 1500, record_status: 'paid', related: '=cmd', actor: 'Ali', description: 'Entry fee', has_receipt: true, created_at: '2026-10-31', finding_status: null, finding_reason: null, total: 1 }
    const csv = financeCsv([row])
    expect(csv).toContain(`"'=cmd"`)
    expect(csv).toContain('"1500.00"')
    expect(csv).not.toContain('secret-id')
  })
  it('describes what an approved action did', () => {
    expect(actionOutcome({ action_type: 'player_merge', result: { matches: 3, memberships: 1, events: 2, milestones: 0, recalculatedMatches: 3 } })).toMatch(/Moved 3 match appearance/)
    expect(actionOutcome({ action_type: 'result_correction', result: { version: 4 } })).toMatch(/version 4/)
    expect(actionOutcome({ action_type: 'result_restore', result: null })).toBeNull()
  })
})
