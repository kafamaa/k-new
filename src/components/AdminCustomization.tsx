import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ArrowDown, ArrowUp, CircleCheck, CircleX, ImageUp, Palette, Search } from 'lucide-react'
import {
  BODY_FONTS, cleanConfig, COLOUR_LABELS, configProblems, contrast, contrastChecks, DEFAULT_APP, imageLimit, sizeLabel, DEFAULT_BRAND, DEFAULT_INSTALL, DEFAULT_LANDING, DEFAULT_THEME, DHIVEHI_FONTS, HEADING_FONTS, LANDING_SECTIONS,
  NAV_DESTINATIONS, navigationFor, PREVIEW_MESSAGE, SOCIAL_LABELS, THEME_COLOURS, themeVariables,
  type AppConfig, type BodyFont, type ConfigVersion, type HeadingFont, type SocialLink,
} from '../lib/appConfig'
import { translations } from '../lib/i18n'
import { adminProblem, formatWhen } from '../lib/superAdmin'
import { listMedia, MEDIA_FOLDERS, MEDIA_MAX_BYTES, MEDIA_TYPES, mediaPath, mediaUrl, type MediaAsset } from '../lib/superAdminOps'
import { AdminEmpty, AdminError, AdminLoading, AdminNote, Pill, ReasonAction } from './AdminParts'
import { VersionHistory } from './AdminConfiguration'
import { loadVersions, saveDraft } from '../lib/configVersions'

type Tab = 'theme' | 'brand' | 'landing' | 'navigation' | 'templates' | 'seo' | 'languages' | 'media' | 'preview'
const TABS: Array<[Tab, string]> = [['theme', 'Theme & type'], ['brand', 'Brand'], ['landing', 'Landing page'], ['navigation', 'Navigation'], ['templates', 'Page templates'], ['seo', 'SEO & install'], ['languages', 'Languages'], ['media', 'Media library'], ['preview', 'Preview']]

// Customization Studio. Drafts never affect the live site; publishing is a
// reviewed, atomic switch and a rollback creates a new version. Only fixed
// fields exist, so no private data, scripts, raw HTML or CSS can be added.
export function CustomizationPage({ client, me, permissions, onNotice }: { client: SupabaseClient; me: string; permissions: string[]; onNotice: (message: string) => void }) {
  const canEdit = permissions.includes('admin.customization.edit')
  const canPublish = permissions.includes('admin.customization.publish')
  const canRollback = permissions.includes('admin.customization.rollback')
  const [tab, setTab] = useState<Tab>('theme')
  const [versions, setVersions] = useState<ConfigVersion[] | null>(null)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AppConfig>({})
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const reload = useCallback(() => { void loadVersions(client, 'appearance').then(result => { setVersions(result.data); setError(result.error ?? '') }) }, [client])
  useEffect(() => { reload() }, [reload])

  const live = versions?.find(version => version.status === 'published') ?? null
  const startFrom = (version: ConfigVersion | null, id: string | null) => { setDraft((version?.config ?? {}) as AppConfig); setEditingId(id); setSummary(id ? version?.summary ?? '' : ''); setFormError('') }
  const cleaned = useMemo(() => cleanConfig(draft), [draft])
  const problems = configProblems(cleaned)
  const checks = contrastChecks(cleaned)
  const blocks = checks.filter(check => check.blocking)
  const update = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => setDraft(current => ({ ...current, [key]: value }))

  const save = async () => {
    setFormError('')
    if (summary.trim().length < 3) return setFormError('Describe the change in a few words.')
    if (problems.length) return setFormError(problems[0])
    setBusy(true)
    const result = await saveDraft(client, 'appearance', editingId, cleaned, summary.trim())
    setBusy(false)
    if (result.error) return setFormError(result.error)
    setEditingId(result.id); onNotice('Draft saved. The live site has not changed.'); reload()
  }
  const submitBlock = (version: ConfigVersion) => contrastChecks(version.config as AppConfig).some(check => check.blocking) ? 'Fix the contrast problems before sending this for review.' : null

  return <div className="adm-stack">
    <p className="adm-intro">Brand, theme, typography, landing page, navigation, page templates, SEO, install prompt and languages. Drafts never affect the live site. A publisher reviews and publishes, and a rollback becomes a new version. Values are checked for contrast and safety.</p>
    {error ? <AdminError message={error} onRetry={reload} /> : null}
    <div className="adm-tabs-scroll"><div className="pw-subtabs" role="tablist" aria-label="Customization">{TABS.map(([id, label]) => <button type="button" role="tab" key={id} aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div></div>

    {tab === 'media' ? <MediaLibrary client={client} canEdit={canEdit} onNotice={onNotice} onUseAsLogo={url => { update('brand', { ...draft.brand, logoUrl: url }); setTab('brand') }} onUseAsIcon={url => { update('pwa', { ...draft.pwa, iconUrl: url }); setTab('seo') }} />
      : tab === 'preview' ? <PreviewFrame config={cleaned} />
      : canEdit ? <section className="ed-panel adm-stack">
        <div className="adm-toolbar"><h3 className="ed-subhead"><Palette size={16} /> {editingId ? 'Edit draft' : 'New draft'}</h3>
          <div className="button-row compact"><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => startFrom(live, null)}>Start from live</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => startFrom(null, null)}>Start from built-in</button></div></div>
        {tab === 'theme' && <ThemeEditor draft={draft} setDraft={setDraft} checks={checks} />}
        {tab === 'brand' && <BrandEditor brand={draft.brand ?? {}} onChange={brand => update('brand', brand)} />}
        {tab === 'landing' && <LandingEditor landing={draft.landing ?? {}} onChange={landing => update('landing', landing)} />}
        {tab === 'navigation' && <NavigationEditor config={draft} onChange={navigation => update('navigation', navigation)} />}
        {tab === 'templates' && <TemplatesEditor templates={draft.templates ?? {}} onChange={templates => update('templates', templates)} />}
        {tab === 'seo' && <SeoEditor client={client} config={draft} onSeo={seo => update('seo', seo)} onPwa={pwa => update('pwa', pwa)} />}
        {tab === 'languages' && <LanguagesEditor value={draft.translations ?? {}} onChange={value => update('translations', value)} />}
        <div className="admin-form">
          <label>What changed<input value={summary} maxLength={300} onChange={event => setSummary(event.target.value)} placeholder="e.g. New logo and darker accent" /></label>
          {formError || problems.length ? <p className="form-error" role="alert">{formError || problems[0]}</p> : null}
          {blocks.length ? <p className="form-error" role="alert">{blocks.length} colour(s) have lower contrast than the built-in theme. Fix them before sending this for review.</p> : null}
          <div className="button-row compact"><button type="button" className="ed-btn ed-btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save draft'}</button><button type="button" className="ed-btn ed-btn-ghost" onClick={() => setTab('preview')}>Preview</button></div>
        </div>
      </section> : <AdminNote>Your role reviews and publishes customization. Drafts are made by a Customization Designer.</AdminNote>}

    <VersionHistory client={client} kind="appearance" me={me} canEdit={canEdit} canPublish={canPublish} canRollback={canRollback} versions={versions}
      onEdit={version => { startFrom(version, version.id); if (tab === 'media' || tab === 'preview') setTab('theme') }} onChanged={reload} onNotice={onNotice} submitBlock={submitBlock} />
  </div>
}

function ThemeEditor({ draft, setDraft, checks }: { draft: AppConfig; setDraft: (update: (current: AppConfig) => AppConfig) => void; checks: ReturnType<typeof contrastChecks> }) {
  const theme = { ...DEFAULT_THEME, ...draft.theme }
  const landing = { ...DEFAULT_LANDING, ...draft.landing }
  const setTheme = (key: string, value: string | number) => setDraft(current => ({ ...current, theme: { ...current.theme, [key]: value } }))
  const setFont = (key: string, value: string) => setDraft(current => ({ ...current, fonts: { ...current.fonts, [key]: value } }))
  return <div className="adm-two">
    <div className="admin-form">
      <fieldset className="adm-fieldset"><legend>Colours</legend>
        <div className="adm-colours">{THEME_COLOURS.map(key => <label key={key} className="adm-colour"><input type="color" value={theme[key]} onChange={event => setTheme(key, event.target.value)} /><span>{COLOUR_LABELS[key]}<small>{theme[key]}</small></span></label>)}</div>
      </fieldset>
      <label>Corner radius: {theme.radius}px<input type="range" min={4} max={28} value={theme.radius} onChange={event => setTheme('radius', Number(event.target.value))} /></label>
      <fieldset className="adm-fieldset"><legend>Typography</legend>
        <label>Headings<select value={draft.fonts?.heading ?? 'space-grotesk'} onChange={event => setFont('heading', event.target.value as HeadingFont)}>{Object.entries(HEADING_FONTS).map(([id, font]) => <option key={id} value={id}>{font.label}</option>)}</select></label>
        <label>Body text<select value={draft.fonts?.body ?? 'plus-jakarta'} onChange={event => setFont('body', event.target.value as BodyFont)}>{Object.entries(BODY_FONTS).map(([id, font]) => <option key={id} value={id}>{font.label}</option>)}</select></label>
        <label>Dhivehi (Thaana) text<select value={draft.fonts?.dhivehi ?? 'system'} onChange={event => setFont('dhivehi', event.target.value)}>{Object.entries(DHIVEHI_FONTS).map(([id, font]) => <option key={id} value={id}>{font.label}</option>)}</select></label>
        <p className="adm-hint">Only open-licence fonts from the existing font service are offered. Noto Sans Thaana covers every Dhivehi character.</p>
      </fieldset>
    </div>
    <div className="adm-stack">
      <div className="adm-preview" style={themeVariables(cleanConfig(draft)) as CSSProperties} aria-label="Small preview">
        <div className="adm-preview-hero" style={{ fontFamily: 'var(--ed-font-body)' }}><p className="ed-eyebrow light">{landing.heroEyebrow}</p><strong style={{ fontFamily: 'var(--ed-font-display)' }}>{landing.heroTitle} <span>{landing.heroTitleAccent}</span></strong><p>{landing.heroLede}</p>
          <span className="button-row compact"><span className="ed-btn ed-btn-primary ed-btn-sm">Explore Tournaments</span><span className="ed-btn ed-btn-glass ed-btn-sm">Create Tournament</span></span></div>
        <div className="adm-preview-body"><span className="adm-preview-card"><b>Card</b><a className="ed-link" href="#workspace/platform-admin/customization" onClick={event => event.preventDefault()}>A link</a></span>
          <span className="adm-pills"><span className="adm-swatch" style={{ background: 'var(--ed-live)' }}>Live</span><span className="adm-swatch" style={{ background: 'var(--ed-ok)' }}>Official</span><span className="adm-swatch" style={{ background: 'var(--ed-warn)' }}>Warning</span></span>
          <p dir="rtl" lang="dv" style={{ margin: 0, fontFamily: 'var(--ed-font-thaana, var(--ed-font-body))' }}>މައި ޞަފްޙާ · ޓޯނަމެންޓް</p></div>
      </div>
      <section aria-label="Accessibility checks"><h4 className="adm-mini-head">Contrast checks</h4>
        <ul className="adm-health">{checks.map(check => <li key={check.label} className={check.pass ? 'adm-health-ok' : 'adm-health-problem'}>{check.pass ? <CircleCheck size={15} aria-hidden="true" /> : <CircleX size={15} aria-hidden="true" />}<span><strong>{check.label}</strong><small>{check.ratio.toFixed(2)}:1 · needs {check.minimum}:1 · {check.pass ? 'Pass' : check.blocking ? 'Fail (worse than built-in)' : 'Below target, as in the built-in theme'}</small></span></li>)}</ul>
      </section>
    </div>
  </div>
}

function BrandEditor({ brand, onChange }: { brand: NonNullable<AppConfig['brand']>; onChange: (brand: NonNullable<AppConfig['brand']>) => void }) {
  const social = brand.social ?? []
  const setSocial = (next: SocialLink[]) => onChange({ ...brand, social: next })
  return <div className="admin-form">
    <div className="admin-row">
      <label>App name<input value={brand.appName ?? DEFAULT_BRAND.appName} maxLength={30} onChange={event => onChange({ ...brand, appName: event.target.value })} /></label>
      <label>Tagline<input value={brand.tagline ?? DEFAULT_BRAND.tagline} maxLength={80} onChange={event => onChange({ ...brand, tagline: event.target.value })} /></label>
    </div>
    <p className="adm-hint">The name appears in the logo, page titles and footer. A name ending in “+” keeps the highlighted plus.</p>
    <fieldset className="adm-fieldset"><legend>Logo</legend>
      {brand.logoUrl ? <div className="adm-inline"><img src={brand.logoUrl} alt="" width={56} height={56} style={{ objectFit: 'contain', background: '#071a2b', borderRadius: 12 }} /><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => onChange({ ...brand, logoUrl: undefined, logoAlt: undefined })}>Use the built-in mark</button></div>
        : <p className="adm-hint">Using the built-in mark. Upload a square logo in the Media library, then choose “Use as logo”.</p>}
      {brand.logoUrl ? <label>Logo description (for screen readers)<input value={brand.logoAlt ?? ''} maxLength={80} onChange={event => onChange({ ...brand, logoAlt: event.target.value })} /></label> : null}
    </fieldset>
    <div className="admin-row">
      <label>Support email<input type="email" value={brand.supportEmail ?? ''} onChange={event => onChange({ ...brand, supportEmail: event.target.value })} /></label>
      <label>Copyright line<input value={brand.copyright ?? ''} maxLength={80} placeholder={`© ${new Date().getFullYear()} ${brand.appName ?? DEFAULT_BRAND.appName}`} onChange={event => onChange({ ...brand, copyright: event.target.value })} /></label>
    </div>
    <fieldset className="adm-fieldset"><legend>Social links (https only, up to 6)</legend>
      {social.map((link, index) => <div key={index} className="adm-inline">
        <label>Network<select value={link.label} onChange={event => setSocial(social.map((item, i) => i === index ? { ...item, label: event.target.value as SocialLink['label'] } : item))}>{SOCIAL_LABELS.map(label => <option key={label}>{label}</option>)}</select></label>
        <label>Address<input value={link.url} placeholder="https://" onChange={event => setSocial(social.map((item, i) => i === index ? { ...item, url: event.target.value } : item))} /></label>
        <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setSocial(social.filter((_, i) => i !== index))}>Remove</button>
      </div>)}
      {social.length < 6 ? <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => setSocial([...social, { label: 'Facebook', url: '' }])}>Add a link</button> : null}
    </fieldset>
  </div>
}

function LandingEditor({ landing, onChange }: { landing: NonNullable<AppConfig['landing']>; onChange: (landing: NonNullable<AppConfig['landing']>) => void }) {
  const value = { ...DEFAULT_LANDING, ...landing }
  const hidden = new Set(landing.hiddenSections ?? [])
  return <div className="admin-form">
    <fieldset className="adm-fieldset"><legend>Hero (English)</legend>
      <label>Small heading<input value={value.heroEyebrow} maxLength={60} onChange={event => onChange({ ...landing, heroEyebrow: event.target.value })} /></label>
      <div className="admin-row"><label>Title<input value={value.heroTitle} maxLength={60} onChange={event => onChange({ ...landing, heroTitle: event.target.value })} /></label><label>Title, second line<input value={value.heroTitleAccent} maxLength={60} onChange={event => onChange({ ...landing, heroTitleAccent: event.target.value })} /></label></div>
      <label>Introduction<textarea rows={2} maxLength={200} value={value.heroLede} onChange={event => onChange({ ...landing, heroLede: event.target.value })} /></label>
    </fieldset>
    <fieldset className="adm-fieldset"><legend>Optional sections</legend>
      <p className="adm-hint">The hero, search, footer, legal and help links are required and always shown. Sections only ever show real published data.</p>
      <div className="adm-checks">{LANDING_SECTIONS.map(section => <label key={section.id} className="checkbox-row"><input type="checkbox" checked={!hidden.has(section.id)} onChange={event => onChange({ ...landing, hiddenSections: event.target.checked ? [...hidden].filter(id => id !== section.id) : [...hidden, section.id] })} /> {section.label}</label>)}</div>
    </fieldset>
  </div>
}

function NavigationEditor({ config, onChange }: { config: AppConfig; onChange: (navigation: NonNullable<AppConfig['navigation']>) => void }) {
  const nav = config.navigation ?? {}
  const hidden = new Set(nav.hidden ?? [])
  const ordered = navigationFor({ navigation: { ...nav, hidden: [] } })
  const move = (id: string, direction: -1 | 1) => {
    const group = ordered.filter(item => item.main === ordered.find(entry => entry.id === id)?.main).map(item => item.id)
    const index = group.indexOf(id)
    const target = index + direction
    if (target < 0 || target >= group.length) return
    const next = [...group]; [next[index], next[target]] = [next[target], next[index]]
    const others = ordered.filter(item => !group.includes(item.id)).map(item => item.id)
    onChange({ ...nav, order: [...next, ...others] })
  }
  const renderGroup = (main: boolean) => <ul className="adm-list">{ordered.filter(item => item.main === main).map(item => <li key={item.id} className="adm-list-row">
    <label className="checkbox-row"><input type="checkbox" checked={!hidden.has(item.id)} onChange={event => onChange({ ...nav, hidden: event.target.checked ? [...hidden].filter(id => id !== item.id) : [...hidden, item.id] })} /> <span className="sr-only">Show {item.label}</span></label>
    <label className="adm-list-main">Label<input value={nav.labels?.[item.id] ?? NAV_DESTINATIONS.find(entry => entry.id === item.id)?.label ?? ''} maxLength={24} onChange={event => onChange({ ...nav, labels: { ...nav.labels, [item.id]: event.target.value } })} /></label>
    <span className="button-row compact"><button type="button" className="ed-icon-btn" aria-label={`Move ${item.label} up`} onClick={() => move(item.id, -1)}><ArrowUp size={15} /></button><button type="button" className="ed-icon-btn" aria-label={`Move ${item.label} down`} onClick={() => move(item.id, 1)}><ArrowDown size={15} /></button></span>
  </li>)}</ul>
  return <div className="admin-form">
    <p className="adm-hint">Destinations are fixed pages inside the app, so no outside or script links can be added. Home, search, Help and the legal links are always shown.</p>
    <h4 className="adm-mini-head">Main menu</h4>{renderGroup(true)}
    <h4 className="adm-mini-head">More menu</h4>{renderGroup(false)}
  </div>
}

function TemplatesEditor({ templates, onChange }: { templates: NonNullable<AppConfig['templates']>; onChange: (templates: NonNullable<AppConfig['templates']>) => void }) {
  const radio = <K extends keyof NonNullable<AppConfig['templates']>>(key: K, options: Array<[NonNullable<AppConfig['templates']>[K], string, string]>, fallback: string) =>
    <div className="adm-checks" role="radiogroup">{options.map(([value, label, hint]) => <label key={String(value)} className="checkbox-row"><input type="radio" name={key} checked={(templates[key] ?? fallback) === value} onChange={() => onChange({ ...templates, [key]: value })} /> <span>{label}<small className="adm-cell-sub">{hint}</small></span></label>)}</div>
  return <div className="admin-form">
    <fieldset className="adm-fieldset"><legend>Public page header (tournament, team, player, organization)</legend>
      {radio('publicHero', [['standard', 'Broadcast', 'Large cover with logo and title (built-in)'], ['compact', 'Compact', 'Shorter header, content sooner'], ['image-led', 'Image-led', 'Tall cover image']], 'standard')}
    </fieldset>
    <fieldset className="adm-fieldset"><legend>Cards</legend>
      {radio('cards', [['elevated', 'Elevated', 'Soft shadow (built-in)'], ['flat', 'Flat', 'No shadow'], ['outlined', 'Outlined', 'Thin border']], 'elevated')}
    </fieldset>
    <fieldset className="adm-fieldset"><legend>Spacing</legend>
      {radio('density', [['compact', 'Compact', 'More on screen'], ['comfortable', 'Comfortable', 'Built-in'], ['spacious', 'Spacious', 'More breathing room']], 'comfortable')}
    </fieldset>
    <p className="adm-hint">Templates change presentation only. What each page shows, and who may see it, is unchanged.</p>
  </div>
}

// App icons: a square PNG of at least 512 × 512 from the media library.
const iconReady = (item: MediaAsset) => item.mime === 'image/png' && !item.archived && item.width !== null && item.width === item.height && item.width >= 512

function SeoEditor({ client, config, onSeo, onPwa }: { client: SupabaseClient; config: AppConfig; onSeo: (seo: NonNullable<AppConfig['seo']>) => void; onPwa: (pwa: NonNullable<AppConfig['pwa']>) => void }) {
  const seo = config.seo ?? {}
  const pwa = config.pwa ?? {}
  const [icons, setIcons] = useState<MediaAsset[] | null>(null)
  useEffect(() => { void listMedia(client, '', false).then(result => setIcons((result.data ?? []).filter(iconReady))) }, [client])
  const appName = pwa.appName ?? config.brand?.appName ?? DEFAULT_APP.appName
  const shortName = pwa.shortName ?? pwa.appName ?? DEFAULT_APP.shortName
  const theme = pwa.themeColor ?? DEFAULT_APP.themeColor
  const background = pwa.backgroundColor ?? DEFAULT_APP.backgroundColor
  const iconSrc = pwa.iconUrl ?? DEFAULT_APP.iconUrl
  return <div className="admin-form">
    <fieldset className="adm-fieldset"><legend>Search and sharing</legend>
      <label>Page title ending<input value={seo.titleSuffix ?? ''} maxLength={40} placeholder={` · ${config.brand?.appName ?? DEFAULT_BRAND.appName}`} onChange={event => onSeo({ ...seo, titleSuffix: event.target.value })} /></label>
      <label>Default description<textarea rows={2} maxLength={160} value={seo.description ?? ''} onChange={event => onSeo({ ...seo, description: event.target.value })} /></label>
      <p className="adm-hint">Workspaces, admin and draft records are never indexed. Social preview images use public cover images only.</p>
    </fieldset>
    <fieldset className="adm-fieldset"><legend>Install prompt</legend>
      <label>Title<input value={pwa.installTitle ?? DEFAULT_INSTALL.installTitle} maxLength={60} onChange={event => onPwa({ ...pwa, installTitle: event.target.value })} /></label>
      <label>Text<input value={pwa.installText ?? DEFAULT_INSTALL.installText} maxLength={160} onChange={event => onPwa({ ...pwa, installText: event.target.value })} /></label>
    </fieldset>
    <fieldset className="adm-fieldset"><legend>Installed app</legend>
      <p className="adm-hint">The name, icon and colours people see after installing Kulhivaru+ on a phone or computer. No rebuild is needed: the site serves them once this version is published.</p>
      <div className="admin-row">
        <label>App name<input value={pwa.appName ?? ''} maxLength={30} placeholder={config.brand?.appName ?? DEFAULT_APP.appName} onChange={event => onPwa({ ...pwa, appName: event.target.value || undefined })} /></label>
        <label>Short name (home screen, 12 characters)<input value={pwa.shortName ?? ''} maxLength={12} placeholder={DEFAULT_APP.shortName} onChange={event => onPwa({ ...pwa, shortName: event.target.value || undefined })} /></label>
      </div>
      <div className="admin-row">
        <label>Toolbar colour<input type="color" value={theme} onChange={event => onPwa({ ...pwa, themeColor: event.target.value })} /></label>
        <label>Splash background<input type="color" value={background} onChange={event => onPwa({ ...pwa, backgroundColor: event.target.value })} /></label>
      </div>
      {contrast('#ffffff', theme) < 3 ? <p className="adm-hint">White status-bar text is hard to read on this toolbar colour; consider a darker one.</p> : null}
      <label>Icon<select value={pwa.iconUrl ?? ''} onChange={event => onPwa({ ...pwa, iconUrl: event.target.value || undefined })}>
        <option value="">Built-in Kulhivaru+ mark</option>
        {(icons ?? []).map(item => { const url = mediaUrl(client, item.path); return <option key={item.id} value={url}>{item.alt_text} ({item.width}×{item.height})</option> })}
        {pwa.iconUrl && icons && !icons.some(item => mediaUrl(client, item.path) === pwa.iconUrl) ? <option value={pwa.iconUrl}>Current icon</option> : null}
      </select></label>
      {icons && icons.length === 0 ? <p className="adm-hint">Upload a square PNG of at least 512 × 512 to the media library (folder “pwa” or “icons”) to use it here. Keep the logo inside the central 80% so it survives round icon masks.</p> : null}
      <div className="adm-app-preview" aria-label="Installed app preview">
        <span className="adm-app-splash" style={{ background }}><img src={iconSrc} alt="" width={64} height={64} /><strong style={{ color: contrast('#ffffff', background) >= 4.5 ? '#ffffff' : '#071a2b' }}>{appName}</strong></span>
        <span className="adm-app-tile"><img src={iconSrc} alt="" width={48} height={48} /><small>{shortName}</small></span>
      </div>
    </fieldset>
    <AdminNote>Installed copies update when the device next checks the app: Android and desktop browsers do this on their own, usually within a day; on iPhone and iPad, the new name and icon appear after the app is added to the Home Screen again.</AdminNote>
  </div>
}

function LanguagesEditor({ value, onChange }: { value: NonNullable<AppConfig['translations']>; onChange: (value: NonNullable<AppConfig['translations']>) => void }) {
  const [query, setQuery] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)
  const keys = Object.keys(translations.en).sort()
  const hasDv = (key: string) => Boolean(value[key]?.dv || translations.dv[key])
  const coverage = Math.round((keys.filter(hasDv).length / Math.max(keys.length, 1)) * 100)
  const shown = keys.filter(key => (!missingOnly || !hasDv(key)) && (!query || key.includes(query.toLowerCase()) || translations.en[key].toLowerCase().includes(query.toLowerCase())))
  const set = (key: string, language: 'en' | 'dv', text: string) => onChange({ ...value, [key]: { ...value[key], [language]: text } })
  return <div className="admin-form">
    <div className="adm-toolbar"><span>Dhivehi coverage: {coverage}% of {keys.length} interface labels</span><label className="checkbox-row"><input type="checkbox" checked={missingOnly} onChange={event => setMissingOnly(event.target.checked)} /> Only missing Dhivehi</label></div>
    <div className="adm-coverage" aria-hidden="true"><span style={{ width: `${coverage}%` }} /></div>
    <label className="adm-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search labels</span><input type="search" value={query} placeholder="Search labels" onChange={event => setQuery(event.target.value)} /></label>
    <div className="adm-table-wrap"><table className="adm-table">
      <caption className="sr-only">Interface labels</caption>
      <thead><tr><th scope="col">Label</th><th scope="col">English</th><th scope="col">Dhivehi</th></tr></thead>
      <tbody>{shown.map(key => <tr key={key}>
        <td><small className="adm-cell-sub">{key}</small>{translations.en[key]}</td>
        <td><input aria-label={`English for ${translations.en[key]}`} value={value[key]?.en ?? ''} placeholder={translations.en[key]} maxLength={200} onChange={event => set(key, 'en', event.target.value)} /></td>
        <td><input dir="rtl" lang="dv" aria-label={`Dhivehi for ${translations.en[key]}`} value={value[key]?.dv ?? ''} placeholder={translations.dv[key] ?? 'Missing'} maxLength={200} onChange={event => set(key, 'dv', event.target.value)} /></td>
      </tr>)}</tbody>
    </table></div>
    <p className="adm-hint">Only reviewed interface labels are listed. Leave a field empty to keep the built-in text. Translations are never generated automatically.</p>
  </div>
}

function MediaLibrary({ client, canEdit, onNotice, onUseAsLogo, onUseAsIcon }: { client: SupabaseClient; canEdit: boolean; onNotice: (message: string) => void; onUseAsLogo: (url: string) => void; onUseAsIcon: (url: string) => void }) {
  const [items, setItems] = useState<MediaAsset[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [archived, setArchived] = useState(false)
  const [folder, setFolder] = useState<string>('brand')
  const [alt, setAlt] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const reload = useCallback(() => { void listMedia(client, query, archived).then(result => { setItems(result.data); setError(result.error ?? '') }) }, [client, query, archived])
  useEffect(() => { const timer = window.setTimeout(reload, 250); return () => window.clearTimeout(timer) }, [reload])
  const tagList = tags.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean).slice(0, 10)
  const upload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) return onNotice('Choose an image first.')
    if (!MEDIA_TYPES.includes(file.type)) return onNotice('Use a PNG, JPEG or WebP image.')
    if (file.size > imageLimit(MEDIA_MAX_BYTES)) return onNotice(`Images must be ${sizeLabel(imageLimit(MEDIA_MAX_BYTES))} or smaller.`)
    if (alt.trim().length < 3) return onNotice('Describe the image for screen readers (at least 3 characters).')
    if (tagList.some(tag => !/^[a-z0-9-]{1,24}$/.test(tag))) return onNotice('Tags can use lowercase letters, numbers and dashes only.')
    setBusy(true)
    let width: number | null = null, height: number | null = null
    try { const bitmap = await createImageBitmap(file); width = bitmap.width; height = bitmap.height; bitmap.close() } catch { /* dimensions are optional */ }
    const path = mediaPath(folder, file.name)
    const stored = await client.storage.from('platform-media').upload(path, file, { contentType: file.type, upsert: false })
    if (stored.error) { setBusy(false); return onNotice(adminProblem(stored.error.message)) }
    const registered = await client.rpc('admin_register_media', { p_path: path, p_alt: alt.trim(), p_tags: tagList, p_mime: file.type, p_size: file.size, p_width: width, p_height: height })
    setBusy(false)
    if (registered.error) return onNotice(adminProblem(registered.error.message))
    setAlt(''); setTags(''); if (fileRef.current) fileRef.current.value = ''
    onNotice('Image added to the library.'); reload()
  }
  const change = async (item: MediaAsset, archive: boolean | null, reason?: string, nextAlt?: string) => {
    const result = await client.rpc('admin_update_media', { p_id: item.id, p_alt: nextAlt ?? item.alt_text, p_tags: item.tags, p_archive: archive, p_reason: reason ?? null })
    if (result.error) return adminProblem(result.error.message)
    onNotice(archive === true ? 'Archived.' : archive === false ? 'Restored.' : 'Saved.'); reload(); return null
  }
  return <div className="adm-stack">
    <p className="adm-intro">Brand and page images only, stored in a public folder. Private identity, payment and team documents never go here. Files in use by a live or pending customization cannot be archived.</p>
    {canEdit ? <section className="ed-panel admin-form">
      <h3 className="ed-subhead"><ImageUp size={16} /> Upload</h3>
      <div className="admin-row">
        <label>Image (PNG, JPEG or WebP, up to 5 MB)<input ref={fileRef} type="file" accept={MEDIA_TYPES.join(',')} /></label>
        <label>Folder<select value={folder} onChange={event => setFolder(event.target.value)}>{MEDIA_FOLDERS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      <label>Description (alt text)<input value={alt} maxLength={200} onChange={event => setAlt(event.target.value)} /></label>
      <label>Tags (comma-separated)<input value={tags} onChange={event => setTags(event.target.value)} placeholder="logo, dark" /></label>
      <div className="button-row compact"><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" disabled={busy} onClick={() => void upload()}>{busy ? 'Uploading…' : 'Upload'}</button></div>
    </section> : null}
    <section className="ed-panel adm-stack">
      <div className="adm-toolbar"><label className="adm-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search media</span><input type="search" value={query} placeholder="Search by name, description or tag" onChange={event => setQuery(event.target.value)} /></label><label className="checkbox-row"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} /> Show archived</label></div>
      {error ? <AdminError message={error} onRetry={reload} /> : !items ? <AdminLoading /> : items.length === 0 ? <AdminEmpty>No images yet.</AdminEmpty>
        : <ul className="adm-media-grid">{items.map(item => { const url = mediaUrl(client, item.path); return <li key={item.id}>
          <img src={url} alt={item.alt_text} loading="lazy" />
          <strong>{item.alt_text}</strong>
          <small>{item.kind} · {Math.round(item.size_bytes / 1024)} KB{item.width ? ` · ${item.width}×${item.height}` : ''} · {formatWhen(item.created_at)}</small>
          <span className="adm-pills">{item.in_use ? <Pill tone="info">In use</Pill> : null}{item.archived ? <Pill>Archived</Pill> : null}{item.tags.map(tag => <Pill key={tag}>{tag}</Pill>)}</span>
          {canEdit && !item.archived ? <span className="button-row compact">
            {item.kind === 'brand' || item.kind === 'icons' ? <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => onUseAsLogo(url)}>Use as logo</button> : null}
            {iconReady(item) ? <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => onUseAsIcon(url)}>Use as app icon</button> : null}
            {!item.in_use ? <ReasonAction label="Archive" onConfirm={reason => change(item, true, reason)} /> : null}
          </span> : canEdit && item.archived ? <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={() => void change(item, false)}>Restore</button> : null}
        </li> })}</ul>}
    </section>
  </div>
}

// The real site in a frame, with the draft applied only inside it (nothing is saved).
function PreviewFrame({ config }: { config: AppConfig }) {
  const [width, setWidth] = useState(1280)
  const [route, setRoute] = useState('#home')
  const [rtl, setRtl] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const send = useCallback(() => frame.current?.contentWindow?.postMessage({ type: PREVIEW_MESSAGE, config, rtl }, window.location.origin), [config, rtl])
  useEffect(() => { send() }, [send])
  return <section className="ed-panel adm-stack">
    <div className="adm-toolbar">
      <div className="ed-toggle" role="group" aria-label="Width">{[[1440, 'Desktop 1440'], [1280, 'Desktop 1280'], [768, 'Tablet'], [390, 'Mobile 390']].map(([value, label]) => <button type="button" key={value} aria-pressed={width === value} className={width === value ? 'active' : ''} onClick={() => setWidth(Number(value))}>{label}</button>)}</div>
      <label className="adm-select">Page<select value={route} onChange={event => setRoute(event.target.value)}>{[['#home', 'Landing'], ['#tournaments', 'Tournaments'], ['#matches', 'Matches'], ['#teams', 'Teams'], ['#players', 'Players'], ['#news', 'News'], ['#info/help', 'Help']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="checkbox-row"><input type="checkbox" checked={rtl} onChange={event => setRtl(event.target.checked)} /> Right-to-left (Dhivehi)</label>
    </div>
    <p className="adm-hint">This is the live site with your draft applied only inside this frame. It shows real published records; nothing here is saved or visible to anyone else. Use your browser or system settings to check dark mode and reduced motion.</p>
    <div className="adm-frame-wrap"><iframe ref={frame} className="adm-frame" title="Customization preview" src={`${window.location.pathname}${route}`} style={{ width }} onLoad={send} /></div>
  </section>
}
