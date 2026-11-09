import type { SupabaseClient } from '@supabase/supabase-js'
import { setTranslationOverrides } from './i18n'

// Published app customization (migrations 202611010034 and 035). Two kinds:
//  - appearance: theme, landing, fonts, brand, navigation, templates, SEO,
//    install prompt text and translation overrides;
//  - platform: maintenance, feature display, help contacts, sports display,
//    places (atolls, islands, venues), upload limits and legal versions (039).
// The installed app's name, icon and colours (039) reach the manifest through the
// service worker, so they change without a rebuild.
// Only these fixed shapes exist; the server rejects anything else. If loading
// fails the built-in look and behaviour stay in place.

export const THEME_COLOURS = ['accent', 'accentStrong', 'ink', 'ink2', 'live', 'ok', 'warn'] as const
export type ThemeColour = typeof THEME_COLOURS[number]
export type SocialLink = { label: 'Facebook' | 'Instagram' | 'X' | 'YouTube' | 'TikTok' | 'Website'; url: string }
export type AppConfig = {
  theme?: Partial<Record<ThemeColour, string>> & { radius?: number }
  landing?: { heroEyebrow?: string; heroTitle?: string; heroTitleAccent?: string; heroLede?: string; hiddenSections?: string[] }
  fonts?: { heading?: HeadingFont; body?: BodyFont; dhivehi?: 'noto-sans-thaana' | 'system' }
  brand?: { appName?: string; tagline?: string; copyright?: string; supportEmail?: string; logoUrl?: string; logoAlt?: string; social?: SocialLink[] }
  navigation?: { hidden?: string[]; order?: string[]; labels?: Record<string, string> }
  templates?: { publicHero?: 'standard' | 'compact' | 'image-led'; cards?: 'elevated' | 'flat' | 'outlined'; density?: 'compact' | 'comfortable' | 'spacious' }
  seo?: { titleSuffix?: string; description?: string }
  pwa?: { installTitle?: string; installText?: string; appName?: string; shortName?: string; iconUrl?: string; themeColor?: string; backgroundColor?: string }
  translations?: Record<string, { en?: string; dv?: string }>
}
export type PlatformConfig = {
  maintenance?: { enabled?: boolean; message?: string; messageDv?: string; endsAt?: string }
  features?: Partial<Record<FeatureFlag, boolean>>
  help?: { email?: string; phone?: string; hours?: string }
  sports?: { hidden?: string[] }
  places?: { atolls?: string[]; islands?: Array<{ name: string; atoll?: string }>; venues?: Array<{ name: string; island?: string }> }
  uploads?: { imageMb?: number; documentMb?: number }
  legal?: Partial<Record<LegalTopic, { version: string; effective?: string }>>
}
export const LEGAL_TOPICS = ['privacy', 'terms', 'community-guidelines', 'child-safety', 'data-correction', 'account-deletion', 'image-consent'] as const
export type LegalTopic = typeof LEGAL_TOPICS[number]
export const LEGAL_LABELS: Record<LegalTopic, string> = { privacy: 'Privacy', terms: 'Terms', 'community-guidelines': 'Community Guidelines', 'child-safety': 'Child Safety', 'data-correction': 'Data Correction', 'account-deletion': 'Account Deletion', 'image-consent': 'Image Publication and Consent' }
// The 20 administrative atolls and Malé City; used until the platform publishes its own list.
export const BUILT_IN_ATOLLS = ['Haa Alif', 'Haa Dhaalu', 'Shaviyani', 'Noonu', 'Raa', 'Baa', 'Lhaviyani', 'Kaafu', 'Alif Alif', 'Alif Dhaalu', 'Vaavu', 'Meemu', 'Faafu', 'Dhaalu', 'Thaa', 'Laamu', 'Gaafu Alif', 'Gaafu Dhaalu', 'Gnaviyani', 'Seenu', 'Malé City']
// Storage limits; the platform may only lower them.
export const IMAGE_LIMIT_MB = 5
export const DOCUMENT_LIMIT_MB = 10
export type ConfigKind = 'appearance' | 'platform'

export type HeadingFont = 'space-grotesk' | 'inter' | 'poppins' | 'montserrat' | 'system'
export type BodyFont = 'plus-jakarta' | 'inter' | 'noto-sans' | 'system'
export const HEADING_FONTS: Record<HeadingFont, { label: string; stack: string; google?: string }> = {
  'space-grotesk': { label: 'Space Grotesk (built-in)', stack: "'Space Grotesk', 'Plus Jakarta Sans', system-ui, sans-serif" },
  inter: { label: 'Inter', stack: "'Inter', system-ui, sans-serif", google: 'Inter:wght@500;600;700;800' },
  poppins: { label: 'Poppins', stack: "'Poppins', system-ui, sans-serif", google: 'Poppins:wght@500;600;700;800' },
  montserrat: { label: 'Montserrat', stack: "'Montserrat', system-ui, sans-serif", google: 'Montserrat:wght@500;600;700;800' },
  system: { label: 'System font', stack: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
}
export const BODY_FONTS: Record<BodyFont, { label: string; stack: string; google?: string }> = {
  'plus-jakarta': { label: 'Plus Jakarta Sans (built-in)', stack: "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif" },
  inter: { label: 'Inter', stack: "'Inter', system-ui, sans-serif", google: 'Inter:wght@400;500;600;700' },
  'noto-sans': { label: 'Noto Sans', stack: "'Noto Sans', system-ui, sans-serif", google: 'Noto+Sans:wght@400;500;600;700' },
  system: { label: 'System font', stack: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
}
// Thaana glyphs: Noto Sans Thaana is an open-licence (OFL) font with full Dhivehi coverage.
export const DHIVEHI_FONTS = { 'noto-sans-thaana': { label: 'Noto Sans Thaana', google: 'Noto+Sans+Thaana:wght@400;600;700' }, system: { label: 'System font' } } as const

export const FEATURE_FLAGS = ['recentlyViewed', 'news', 'installPrompt', 'calendarExports', 'topPlayers'] as const
export type FeatureFlag = typeof FEATURE_FLAGS[number]
export const FEATURE_LABELS: Record<FeatureFlag, string> = { recentlyViewed: 'Recently viewed', news: 'News', installPrompt: 'Install prompt', calendarExports: 'Calendar exports', topPlayers: 'Top players and rankings' }

// Header destinations the navigation editor may relabel, reorder or hide. Home, search, help and legal links are required.
export const NAV_DESTINATIONS: Array<{ id: string; label: string; main: boolean }> = [
  { id: 'tournaments', label: 'Tournaments', main: true }, { id: 'live', label: 'Matches', main: true }, { id: 'teams', label: 'Teams', main: true },
  { id: 'players', label: 'Players', main: true }, { id: 'news', label: 'News', main: true },
  { id: 'organizations', label: 'Organizations', main: false }, { id: 'matches', label: 'Matches', main: false }, { id: 'standings', label: 'Standings', main: false },
  { id: 'bracket', label: 'Bracket', main: false }, { id: 'how-it-works', label: 'How It Works', main: false },
]
export const SOCIAL_LABELS: SocialLink['label'][] = ['Facebook', 'Instagram', 'X', 'YouTube', 'TikTok', 'Website']
export const SPORT_KEYS_ALL = ['football', 'futsal', 'handball', 'volleyball', 'basketball', 'basketball_3x3']

// The built-in values from editorial.css; used as the editor's starting point.
export const DEFAULT_THEME: Record<ThemeColour, string> & { radius: number } = {
  accent: '#00c2dc', accentStrong: '#0786a6', ink: '#071a2b', ink2: '#0b2a42', live: '#e5374a', ok: '#0e9a6a', warn: '#a76b0c', radius: 16,
}
export const DEFAULT_LANDING = { heroEyebrow: 'Maldives’ Digital Home of Sports', heroTitle: 'Island sport.', heroTitleAccent: 'Lasting history.', heroLede: 'Follow competitions, discover players and celebrate every result.' }
export const DEFAULT_BRAND = { appName: 'Kulhivaru+', tagline: 'Sports Live. History Forever.' }
export const DEFAULT_INSTALL = { installTitle: 'Install Kulhivaru+', installText: 'Get quicker access to matches, tournaments and updates.' }
// Matches public/manifest.webmanifest.
export const DEFAULT_APP = { appName: 'Kulhivaru+', shortName: 'Kulhivaru+', themeColor: '#0ea5e9', backgroundColor: '#0b1f33', iconUrl: '/assets/kulhivaru-mark.png' }

export const COLOUR_LABELS: Record<ThemeColour, string> = { accent: 'Accent', accentStrong: 'Accent (text and links)', ink: 'Ink (dark background)', ink2: 'Ink, second shade', live: 'Live', ok: 'Success / official', warn: 'Warning' }
const CSS_VARS: Record<ThemeColour, string> = { accent: '--ed-accent', accentStrong: '--ed-accent-strong', ink: '--ed-ink', ink2: '--ed-ink-2', live: '--ed-live', ok: '--ed-ok', warn: '--ed-warn' }

// Optional landing sections. The hero, search, legal footer and help links are required and not listed.
export const LANDING_SECTIONS: Array<{ id: string; label: string }> = [
  { id: 'sports', label: 'Browse by sport' }, { id: 'live-today', label: 'Live now and today' }, { id: 'featured', label: 'Featured tournaments' },
  { id: 'recently-active', label: 'Recently active' }, { id: 'upcoming', label: 'Upcoming tournaments' }, { id: 'standings-bracket', label: 'Standings and bracket' },
  { id: 'top-players', label: 'Top players' }, { id: 'active-teams', label: 'Active teams' }, { id: 'recent-results', label: 'Recent results' },
  { id: 'news', label: 'News' }, { id: 'recently-viewed', label: 'Recently viewed' }, { id: 'organizer-cta', label: 'Organizer call to action' },
  { id: 'how-it-works', label: 'How it works' }, { id: 'install', label: 'Install prompt' },
]

const HEX = /^#[0-9a-fA-F]{6}$/
const UNSAFE = /[<>{}]|(javascript|data|vbscript):/i
const EMAIL = /^[^@\s<>]{1,64}@[A-Za-z0-9.-]{1,120}\.[A-Za-z]{2,}$/
const HTTPS = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~%/?=&#-]*)?$/
const MEDIA_URL = /^https:\/\/[A-Za-z0-9.-]+\/storage\/v1\/object\/public\/platform-media\/[A-Za-z0-9/_.-]{1,200}$/
const textProblem = (value: string | undefined, max: number, label: string) => value === undefined ? null : value.length > max ? `${label} is too long (${max} characters at most).` : UNSAFE.test(value) ? `${label} cannot contain < > { } or script links.` : null

// Mirrors the server's app_config_problem_for so problems show before saving.
export function configProblems(config: AppConfig): string[] {
  const problems: Array<string | null> = []
  for (const key of THEME_COLOURS) { const value = config.theme?.[key]; if (value !== undefined && !HEX.test(value)) problems.push(`${COLOUR_LABELS[key]} must be a colour like #00c2dc.`) }
  const radius = config.theme?.radius
  if (radius !== undefined && (!Number.isFinite(radius) || radius < 4 || radius > 28)) problems.push('Corner radius must be between 4 and 28.')
  const landing = config.landing ?? {}
  for (const [key, max] of [['heroEyebrow', 60], ['heroTitle', 60], ['heroTitleAccent', 60], ['heroLede', 200]] as const) problems.push(textProblem(landing[key], max, 'Hero text'))
  if (landing.hiddenSections?.some(id => !LANDING_SECTIONS.some(section => section.id === id))) problems.push('Unknown landing section.')
  const brand = config.brand ?? {}
  if (brand.appName !== undefined && brand.appName.trim().length < 2) problems.push('The app name needs at least 2 characters.')
  problems.push(textProblem(brand.appName, 30, 'The app name'), textProblem(brand.tagline, 80, 'The tagline'), textProblem(brand.copyright, 80, 'The copyright line'), textProblem(brand.logoAlt, 80, 'The logo description'))
  if (brand.supportEmail !== undefined && !EMAIL.test(brand.supportEmail)) problems.push('Enter a valid support email.')
  if (brand.logoUrl !== undefined && !MEDIA_URL.test(brand.logoUrl)) problems.push('The logo must come from the media library.')
  if (brand.logoUrl && !brand.logoAlt?.trim()) problems.push('Describe the logo for screen readers.')
  if ((brand.social?.length ?? 0) > 6 || brand.social?.some(link => !SOCIAL_LABELS.includes(link.label) || !HTTPS.test(link.url) || link.url.length > 200)) problems.push('Social links must be https:// addresses (6 at most).')
  const nav = config.navigation ?? {}
  const navIds = NAV_DESTINATIONS.map(item => item.id)
  if ([...(nav.hidden ?? []), ...(nav.order ?? []), ...Object.keys(nav.labels ?? {})].some(id => !navIds.includes(id))) problems.push('Unknown navigation destination.')
  for (const label of Object.values(nav.labels ?? {})) { if (label.trim().length < 2) problems.push('Navigation labels need at least 2 characters.'); problems.push(textProblem(label, 24, 'A navigation label')) }
  problems.push(textProblem(config.seo?.titleSuffix, 40, 'The title suffix'), textProblem(config.seo?.description, 160, 'The description'))
  const pwa = config.pwa ?? {}
  problems.push(textProblem(pwa.installTitle, 60, 'The install title'), textProblem(pwa.installText, 160, 'The install text'), textProblem(pwa.appName, 30, 'The installed app name'), textProblem(pwa.shortName, 12, 'The short name'))
  if (pwa.appName !== undefined && pwa.appName.trim().length < 2) problems.push('The installed app name needs at least 2 characters.')
  if (pwa.shortName !== undefined && pwa.shortName.trim().length < 2) problems.push('The short name needs at least 2 characters.')
  if (pwa.iconUrl !== undefined && !(MEDIA_URL.test(pwa.iconUrl) && /\.png$/i.test(pwa.iconUrl))) problems.push('The app icon must be a PNG from the media library.')
  if ((pwa.themeColor !== undefined && !HEX.test(pwa.themeColor)) || (pwa.backgroundColor !== undefined && !HEX.test(pwa.backgroundColor))) problems.push('App colours must look like #0b1f33.')
  const translations = Object.entries(config.translations ?? {})
  if (translations.length > 400) problems.push('Too many translation overrides (400 at most).')
  for (const [key, value] of translations) { if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_-]+)+$/.test(key)) problems.push('Unknown translation key.'); problems.push(textProblem(value.en, 200, 'A translation'), textProblem(value.dv, 200, 'A translation')) }
  return [...new Set(problems.filter((problem): problem is string => Boolean(problem)))]
}

export function platformProblems(config: PlatformConfig): string[] {
  const problems: Array<string | null> = []
  const maintenance = config.maintenance ?? {}
  problems.push(textProblem(maintenance.message, 200, 'The maintenance message'), textProblem(maintenance.messageDv, 200, 'The Dhivehi maintenance message'))
  if (maintenance.enabled && (maintenance.message ?? '').trim().length < 5) problems.push('Write the maintenance message visitors will see.')
  if (maintenance.endsAt !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(maintenance.endsAt)) problems.push('Choose a valid end time.')
  const help = config.help ?? {}
  if (help.email !== undefined && !EMAIL.test(help.email)) problems.push('Enter a valid help email.')
  if (help.phone !== undefined && !/^[0-9 +()-]{3,20}$/.test(help.phone)) problems.push('Enter a valid phone number.')
  problems.push(textProblem(help.hours, 80, 'Opening hours'))
  const hidden = config.sports?.hidden ?? []
  if (hidden.some(sport => !SPORT_KEYS_ALL.includes(sport))) problems.push('Unknown sport.')
  if (hidden.length >= SPORT_KEYS_ALL.length) problems.push('At least one sport must stay visible.')
  const places = config.places ?? {}
  if ((places.atolls?.length ?? 0) > 30) problems.push('List 30 atolls at most.')
  if ((places.islands?.length ?? 0) > 300) problems.push('List 300 islands at most.')
  if ((places.venues?.length ?? 0) > 200) problems.push('List 200 venues at most.')
  for (const atoll of places.atolls ?? []) { if (atoll.trim().length < 2) problems.push('Atoll names need at least 2 characters.'); problems.push(textProblem(atoll, 40, 'An atoll name')) }
  for (const island of places.islands ?? []) { if (island.name.trim().length < 2) problems.push('Island names need at least 2 characters.'); problems.push(textProblem(island.name, 80, 'An island name'), textProblem(island.atoll, 40, 'An atoll name')) }
  for (const venue of places.venues ?? []) { if (venue.name.trim().length < 2) problems.push('Venue names need at least 2 characters.'); problems.push(textProblem(venue.name, 120, 'A venue name'), textProblem(venue.island, 80, 'An island name')) }
  const uploads = config.uploads ?? {}
  if (uploads.imageMb !== undefined && !(Number.isInteger(uploads.imageMb) && uploads.imageMb >= 1 && uploads.imageMb <= IMAGE_LIMIT_MB)) problems.push(`The image limit must be a whole number from 1 to ${IMAGE_LIMIT_MB} MB.`)
  if (uploads.documentMb !== undefined && !(Number.isInteger(uploads.documentMb) && uploads.documentMb >= 1 && uploads.documentMb <= DOCUMENT_LIMIT_MB)) problems.push(`The document limit must be a whole number from 1 to ${DOCUMENT_LIMIT_MB} MB.`)
  for (const [topic, value] of Object.entries(config.legal ?? {})) {
    if (!(LEGAL_TOPICS as readonly string[]).includes(topic) || !value) { problems.push('Unknown legal page.'); continue }
    if (!/^[0-9A-Za-z][0-9A-Za-z.-]{0,11}$/.test(value.version ?? '')) problems.push(`The ${LEGAL_LABELS[topic as LegalTopic]} version must be like 1.0 or 2026-1.`)
    if (value.effective !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value.effective)) problems.push(`Choose a valid effective date for ${LEGAL_LABELS[topic as LegalTopic]}.`)
  }
  return [...new Set(problems.filter((problem): problem is string => Boolean(problem)))]
}

// WCAG relative luminance and contrast ratio.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}
export function contrast(a: string, b: string): number {
  if (!HEX.test(a) || !HEX.test(b)) return 0
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

// The pairs the interface actually uses: primary buttons are ink on accent,
// links are accent-strong on white, the hero is white on ink, badges are white on status colours.
// The built-in link colour itself is below 4.5:1, so a failing check only blocks
// a draft when it is worse than the built-in theme (`blocking`).
export function contrastChecks(config: AppConfig): Array<{ label: string; ratio: number; minimum: number; pass: boolean; blocking: boolean }> {
  const pairsFor = (theme: typeof DEFAULT_THEME): Array<[string, string, string, number]> => [
    ['Button text on accent', theme.ink, theme.accent, 4.5],
    ['Links on white', theme.accentStrong, '#ffffff', 4.5],
    ['White text on ink', '#ffffff', theme.ink, 4.5],
    ['White text on ink, second shade', '#ffffff', theme.ink2, 4.5],
    ['White text on live badge', '#ffffff', theme.live, 3],
    ['Success text on white', theme.ok, '#ffffff', 3],
    ['Warning text on white', theme.warn, '#ffffff', 3],
  ]
  const builtIn = pairsFor(DEFAULT_THEME).map(([, a, b]) => contrast(a, b))
  return pairsFor({ ...DEFAULT_THEME, ...config.theme }).map(([label, a, b, minimum], index) => {
    const ratio = contrast(a, b)
    const pass = ratio >= minimum
    return { label, ratio, minimum, pass, blocking: !pass && ratio < builtIn[index] - 0.005 }
  })
}

// Only values that differ from the built-in look are stored; empty sections are dropped.
const prune = <T extends Record<string, unknown>>(value: T): T | undefined => {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined && item !== '' && !(Array.isArray(item) && item.length === 0) && !(typeof item === 'object' && item !== null && !Array.isArray(item) && Object.keys(item).length === 0))
  return entries.length ? Object.fromEntries(entries) as T : undefined
}
const differs = (value: string | undefined, fallback: string) => { const trimmed = value?.trim(); return trimmed && trimmed !== fallback ? trimmed : undefined }

export function cleanConfig(config: AppConfig): AppConfig {
  const theme: NonNullable<AppConfig['theme']> = {}
  for (const key of THEME_COLOURS) { const value = config.theme?.[key]; if (value && value.toLowerCase() !== DEFAULT_THEME[key]) theme[key] = value.toLowerCase() }
  if (config.theme?.radius !== undefined && config.theme.radius !== DEFAULT_THEME.radius) theme.radius = Math.round(config.theme.radius)
  const landing: NonNullable<AppConfig['landing']> = {}
  for (const key of ['heroEyebrow', 'heroTitle', 'heroTitleAccent', 'heroLede'] as const) { const value = differs(config.landing?.[key], DEFAULT_LANDING[key]); if (value) landing[key] = value }
  if (config.landing?.hiddenSections?.length) landing.hiddenSections = [...new Set(config.landing.hiddenSections)]
  const fonts = prune({ heading: config.fonts?.heading !== 'space-grotesk' ? config.fonts?.heading : undefined, body: config.fonts?.body !== 'plus-jakarta' ? config.fonts?.body : undefined, dhivehi: config.fonts?.dhivehi !== 'system' ? config.fonts?.dhivehi : undefined })
  const logoUrl = config.brand?.logoUrl?.trim() || undefined
  const brand = prune({
    appName: differs(config.brand?.appName, DEFAULT_BRAND.appName), tagline: differs(config.brand?.tagline, DEFAULT_BRAND.tagline), copyright: config.brand?.copyright?.trim() || undefined,
    supportEmail: config.brand?.supportEmail?.trim() || undefined, logoUrl, logoAlt: logoUrl ? config.brand?.logoAlt?.trim() || undefined : undefined,
    social: config.brand?.social?.filter(link => link.url.trim()).map(link => ({ label: link.label, url: link.url.trim() })),
  })
  const labels = prune(Object.fromEntries(Object.entries(config.navigation?.labels ?? {}).map(([id, label]) => [id, differs(label, NAV_DESTINATIONS.find(item => item.id === id)?.label ?? '')])))
  const navigation = prune({ hidden: config.navigation?.hidden?.length ? [...new Set(config.navigation.hidden)] : undefined, order: config.navigation?.order?.length ? config.navigation.order : undefined, labels })
  const templates = prune({ publicHero: config.templates?.publicHero !== 'standard' ? config.templates?.publicHero : undefined, cards: config.templates?.cards !== 'elevated' ? config.templates?.cards : undefined, density: config.templates?.density !== 'comfortable' ? config.templates?.density : undefined })
  const seo = prune({ titleSuffix: config.seo?.titleSuffix?.trim() || undefined, description: config.seo?.description?.trim() || undefined })
  const colour = (value: string | undefined, fallback: string) => value && value.toLowerCase() !== fallback ? value.toLowerCase() : undefined
  const pwa = prune({
    installTitle: differs(config.pwa?.installTitle, DEFAULT_INSTALL.installTitle), installText: differs(config.pwa?.installText, DEFAULT_INSTALL.installText),
    appName: differs(config.pwa?.appName, DEFAULT_APP.appName), shortName: differs(config.pwa?.shortName, DEFAULT_APP.shortName), iconUrl: config.pwa?.iconUrl?.trim() || undefined,
    themeColor: colour(config.pwa?.themeColor, DEFAULT_APP.themeColor), backgroundColor: colour(config.pwa?.backgroundColor, DEFAULT_APP.backgroundColor),
  })
  const translations = prune(Object.fromEntries(Object.entries(config.translations ?? {}).map(([key, value]) => [key, prune({ en: value.en?.trim() || undefined, dv: value.dv?.trim() || undefined })])) as Record<string, { en?: string; dv?: string } | undefined>)
  return Object.fromEntries(Object.entries({ theme: prune(theme), landing: prune(landing), fonts, brand, navigation, templates, seo, pwa, translations }).filter(([, value]) => value !== undefined)) as AppConfig
}

export function cleanPlatform(config: PlatformConfig): PlatformConfig {
  const maintenance = config.maintenance?.enabled ? prune({ enabled: true, message: config.maintenance.message?.trim() || undefined, messageDv: config.maintenance.messageDv?.trim() || undefined, endsAt: config.maintenance.endsAt || undefined }) : undefined
  const features = prune(Object.fromEntries(FEATURE_FLAGS.map(flag => [flag, config.features?.[flag] === false ? false : undefined])))
  const help = prune({ email: config.help?.email?.trim() || undefined, phone: config.help?.phone?.trim() || undefined, hours: config.help?.hours?.trim() || undefined })
  const sports = config.sports?.hidden?.length ? { hidden: [...new Set(config.sports.hidden)] } : undefined
  const unique = <T,>(items: T[] | undefined, key: (item: T) => string) => { const seen = new Set<string>(); return (items ?? []).filter(item => { const id = key(item).toLowerCase(); if (!id || seen.has(id)) return false; seen.add(id); return true }) }
  const places = prune({
    atolls: unique(config.places?.atolls?.map(atoll => atoll.trim()), atoll => atoll),
    islands: unique(config.places?.islands?.filter(island => island.name.trim()).map(island => island.atoll?.trim() ? { name: island.name.trim(), atoll: island.atoll.trim() } : { name: island.name.trim() }), island => island.name),
    venues: unique(config.places?.venues?.filter(venue => venue.name.trim()).map(venue => venue.island?.trim() ? { name: venue.name.trim(), island: venue.island.trim() } : { name: venue.name.trim() }), venue => venue.name),
  })
  const uploads = prune({ imageMb: config.uploads?.imageMb !== undefined && config.uploads.imageMb !== IMAGE_LIMIT_MB ? config.uploads.imageMb : undefined, documentMb: config.uploads?.documentMb !== undefined && config.uploads.documentMb !== DOCUMENT_LIMIT_MB ? config.uploads.documentMb : undefined })
  const legal = prune(Object.fromEntries(Object.entries(config.legal ?? {}).map(([topic, value]) => [topic, value?.version?.trim() ? prune({ version: value.version.trim(), effective: value.effective || undefined }) : undefined])) as NonNullable<PlatformConfig['legal']>)
  return Object.fromEntries(Object.entries({ maintenance, features, help, sports, places, uploads, legal }).filter(([, value]) => value !== undefined)) as PlatformConfig
}

const softAccent = (hex: string) => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, .12)`

// CSS variables for a configuration; used on :root and on the editor preview.
export function themeVariables(config: AppConfig): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const key of THEME_COLOURS) { const value = config.theme?.[key]; if (value && HEX.test(value)) vars[CSS_VARS[key]] = value }
  if (vars['--ed-accent']) vars['--ed-accent-soft'] = softAccent(vars['--ed-accent'])
  const radius = config.theme?.radius
  if (radius !== undefined && radius >= 4 && radius <= 28) { vars['--ed-radius'] = `${radius}px`; vars['--ed-radius-sm'] = `${Math.round(radius * 0.62)}px` }
  if (config.fonts?.heading && HEADING_FONTS[config.fonts.heading]) vars['--ed-font-display'] = HEADING_FONTS[config.fonts.heading].stack
  if (config.fonts?.body && BODY_FONTS[config.fonts.body]) vars['--ed-font-body'] = BODY_FONTS[config.fonts.body].stack
  if (config.fonts?.dhivehi === 'noto-sans-thaana') vars['--ed-font-thaana'] = "'Noto Sans Thaana', system-ui, sans-serif"
  return vars
}

// Fonts load only from Google Fonts (the existing font host), from a fixed list.
export function fontHref(config: AppConfig): string | null {
  const families = [config.fonts?.heading ? HEADING_FONTS[config.fonts.heading]?.google : undefined, config.fonts?.body ? BODY_FONTS[config.fonts.body]?.google : undefined, config.fonts?.dhivehi === 'noto-sans-thaana' ? DHIVEHI_FONTS['noto-sans-thaana'].google : undefined]
    .filter((family): family is string => Boolean(family))
  return families.length ? `https://fonts.googleapis.com/css2?${[...new Set(families)].map(family => `family=${family}`).join('&')}&display=swap` : null
}

// Ordered, relabelled and filtered header destinations.
export function navigationFor(config: AppConfig): Array<{ id: string; label: string; main: boolean }> {
  const nav = config.navigation ?? {}
  const rank = (id: string) => { const index = nav.order?.indexOf(id) ?? -1; return index < 0 ? 100 + NAV_DESTINATIONS.findIndex(item => item.id === id) : index }
  return NAV_DESTINATIONS.filter(item => !nav.hidden?.includes(item.id)).map(item => ({ ...item, label: nav.labels?.[item.id] ?? item.label })).sort((a, b) => rank(a.id) - rank(b.id))
}

const ALL_VARS = [...Object.values(CSS_VARS), '--ed-accent-soft', '--ed-radius', '--ed-radius-sm', '--ed-font-display', '--ed-font-body', '--ed-font-thaana']
const BUILT_IN_SUFFIX = ' · Kulhivaru+'
let active: AppConfig = {}
let platform: PlatformConfig = {}
let previewing = false
let titleObserver: MutationObserver | null = null
const CACHE_KEY = 'kulhivaru.app-config'

// Pages set titles ending in "· Kulhivaru+"; a configured suffix or app name replaces it.
function applyTitle() {
  const suffix = active.seo?.titleSuffix ?? (active.brand?.appName ? ` · ${active.brand.appName}` : null)
  if (!suffix || !document.title.endsWith(BUILT_IN_SUFFIX)) return
  document.title = document.title.slice(0, -BUILT_IN_SUFFIX.length) + (suffix.startsWith(' ') ? suffix : ` ${suffix}`)
}

function applyDocument(config: AppConfig) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const name of ALL_VARS) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(themeVariables(config))) root.style.setProperty(name, value)
  root.dataset.hero = config.templates?.publicHero ?? 'standard'
  root.dataset.cards = config.templates?.cards ?? 'elevated'
  root.dataset.density = config.templates?.density ?? 'comfortable'
  const href = fontHref(config)
  let link = document.getElementById('kulhivaru-config-fonts') as HTMLLinkElement | null
  if (href) { if (!link) { link = document.createElement('link'); link.id = 'kulhivaru-config-fonts'; link.rel = 'stylesheet'; document.head.appendChild(link) } if (link.href !== href) link.href = href } else link?.remove()
  const description = document.querySelector('meta[name="description"]')
  if (description && config.seo?.description) description.setAttribute('content', config.seo.description)
  setTranslationOverrides(config.translations)
  applyInstalledApp(config)
  if (!titleObserver && typeof MutationObserver !== 'undefined') {
    const title = document.querySelector('title')
    if (title) { titleObserver = new MutationObserver(applyTitle); titleObserver.observe(title, { childList: true }) }
  }
  applyTitle()
}

// The installed app (039): theme colour and iOS home-screen title and icon are set on
// the page; the web app manifest is handed to the service worker, which serves it at
// /manifest.webmanifest. Only the published configuration is sent, never a preview.
export function manifestFor(config: AppConfig, origin: string): Record<string, unknown> {
  const pwa = config.pwa ?? {}
  const icon = pwa.iconUrl ?? `${origin}${DEFAULT_APP.iconUrl}`
  return {
    id: '/', name: pwa.appName ?? config.brand?.appName ?? DEFAULT_APP.appName, short_name: pwa.shortName ?? pwa.appName ?? DEFAULT_APP.shortName,
    description: config.seo?.description ?? 'Maldives sports tournaments, teams, players, and history.',
    start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait-primary',
    background_color: pwa.backgroundColor ?? DEFAULT_APP.backgroundColor, theme_color: pwa.themeColor ?? DEFAULT_APP.themeColor,
    icons: [{ src: icon, sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: icon, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
  }
}
export const MANIFEST_MESSAGE = 'kulhivaru:manifest'
function setHead(selector: string, create: () => HTMLElement, attribute: string, value: string | null) {
  let element = document.head.querySelector(selector) as HTMLElement | null
  if (value === null) { if (element?.dataset.config) element.remove(); return }
  if (!element) { element = create(); element.dataset.config = 'true'; document.head.appendChild(element) }
  element.setAttribute(attribute, value)
}
function applyInstalledApp(config: AppConfig) {
  const pwa = config.pwa ?? {}
  const theme = document.querySelector('meta[name="theme-color"]')
  if (theme) { theme.setAttribute('data-built-in', theme.getAttribute('data-built-in') ?? theme.getAttribute('content') ?? ''); theme.setAttribute('content', pwa.themeColor ?? theme.getAttribute('data-built-in') ?? '') }
  setHead('meta[name="apple-mobile-web-app-title"]', () => Object.assign(document.createElement('meta'), { name: 'apple-mobile-web-app-title' }), 'content', pwa.shortName ?? pwa.appName ?? null)
  setHead('link[rel="apple-touch-icon"]', () => Object.assign(document.createElement('link'), { rel: 'apple-touch-icon' }), 'href', pwa.iconUrl ?? null)
  if (previewing || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const manifest = config.pwa?.appName || config.pwa?.shortName || config.pwa?.iconUrl || config.pwa?.themeColor || config.pwa?.backgroundColor ? manifestFor(config, window.location.origin) : null
  void navigator.serviceWorker.ready.then(registration => registration.active?.postMessage({ type: MANIFEST_MESSAGE, manifest })).catch(() => undefined)
}

export function applyConfig(config: AppConfig, platformConfig: PlatformConfig = platform) {
  active = configProblems(config).length ? {} : config
  platform = platformProblems(platformConfig).length ? {} : platformConfig
  applyDocument(active)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('kulhivaru:config'))
}
export const activeConfig = () => active
export const activePlatform = () => platform
export const featureOn = (flag: FeatureFlag) => platform.features?.[flag] !== false
export const sportVisible = (sport: string) => !platform.sports?.hidden?.includes(sport)
// Suggestions for island, atoll and venue fields (free text is still accepted).
export function placeLists(): { atolls: string[]; islands: string[]; venues: string[] } {
  const places = platform.places ?? {}
  return { atolls: places.atolls?.length ? places.atolls : BUILT_IN_ATOLLS, islands: (places.islands ?? []).map(island => island.name), venues: (places.venues ?? []).map(venue => venue.name) }
}
// Upload size limits: the published limit when lower than the built-in one.
const mb = 1024 * 1024
export const imageLimit = (builtInBytes: number = IMAGE_LIMIT_MB * mb) => Math.min(builtInBytes, (platform.uploads?.imageMb ?? Infinity) * mb)
export const documentLimit = (builtInBytes: number = DOCUMENT_LIMIT_MB * mb) => Math.min(builtInBytes, (platform.uploads?.documentMb ?? Infinity) * mb)
export const sizeLabel = (bytes: number) => `${Math.round((bytes / mb) * 10) / 10} MB`
export const legalVersion = (topic: string) => (platform.legal as Record<string, { version: string; effective?: string } | undefined> | undefined)?.[topic] ?? null
export function maintenanceActive(now = Date.now()): boolean {
  const maintenance = platform.maintenance
  if (!maintenance?.enabled) return false
  return !maintenance.endsAt || Date.parse(maintenance.endsAt) > now
}

// Cached copy first (no flash), then the published version. A failure keeps what is shown.
export async function loadPublishedConfig(client: SupabaseClient | null) {
  try { const cached = localStorage.getItem(CACHE_KEY); if (cached) { const parsed = JSON.parse(cached) as { config?: AppConfig; platform?: PlatformConfig }; applyConfig(parsed.config ?? {}, parsed.platform ?? {}) } } catch { /* cache is optional */ }
  if (!client) return
  const result = await client.rpc('get_active_configuration')
  if (result.error || previewing) return
  const data = (result.data ?? {}) as { config?: AppConfig; platform?: PlatformConfig }
  applyConfig(data.config ?? {}, data.platform ?? {})
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ config: data.config ?? {}, platform: data.platform ?? {} })) } catch { /* cache is optional */ }
}

// Customization preview: the admin editor shows the real site in an iframe and sends
// the draft here. Accepted only from the same origin and the parent window, applied
// only inside that frame and never cached or saved.
export const PREVIEW_MESSAGE = 'kulhivaru:preview-config'
export function listenForPreview() {
  if (typeof window === 'undefined' || window.parent === window) return () => undefined
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return
    const data = event.data as { type?: string; config?: AppConfig; platform?: PlatformConfig; rtl?: boolean } | null
    if (!data || data.type !== PREVIEW_MESSAGE) return
    previewing = true
    applyConfig(data.config ?? {}, data.platform ?? {})
    document.documentElement.dir = data.rtl ? 'rtl' : 'ltr'
  }
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}

export type ConfigVersion = { id: string; version: number; kind?: ConfigKind; status: string; config: AppConfig & PlatformConfig; summary: string; created_by: string; reviewed_by: string | null; review_note: string | null; published_at: string | null; rollback_of: number | null; created_at: string; updated_at: string }
export const CONFIG_STATUS_LABELS: Record<string, string> = { draft: 'Draft', in_review: 'Waiting for review', approved: 'Approved', rejected: 'Changes requested', published: 'Live', superseded: 'Previous version' }

// One entry per line; "Name, Detail" splits off the island or atoll after the last comma.
export function parsePlaceLines(text: string): Array<{ name: string; detail?: string }> {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => { const index = line.lastIndexOf(','); return index > 0 ? { name: line.slice(0, index).trim(), detail: line.slice(index + 1).trim() || undefined } : { name: line } })
}
