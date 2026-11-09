import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowLeft, ArrowRight, Compass, Globe2, LayoutDashboard, LockKeyhole, Moon, Search, Sun, UserRound, X } from 'lucide-react'
import { supabase, publicSupabase, isSupabaseConfigured } from './lib/supabase'
import { isRtl, loadLanguagePreference, saveLanguagePreference, LANGUAGE_LABELS, translate, tr, useLanguage } from './lib/i18n'
import { shouldOpenChooseWorkspace } from './lib/workspace'
import { loadReturnDestination, clearReturnDestination, returnDestinationHash } from './lib/returnDestination'
import { HomepageSections } from './components/HomepageSections'
import { parsePublicHash } from './lib/publicRoutes'
import { validateAuthInput } from './lib/validation'
import { clearOfflineCache } from './lib/offlineCache'
import { saveSignInIntent } from './lib/signInIntent'
import { ADMIN_WORKSPACE_HASH, isLegacyAdminHash, legacyAdminTarget, loadAdminAccess } from './lib/adminAccess'
import { DEFAULT_BRAND, listenForPreview, loadPublishedConfig, maintenanceActive, navigationFor, featureOn } from './lib/appConfig'
import { useAppConfig } from './lib/useAppConfig'
import { BrandLogo, BrandMark } from './components/BrandLogo'
import { Bell, ChevronDown, Download, Home, PlayCircle, Plus, Trophy, Users } from 'lucide-react'
import { AnnouncementBanner } from './components/AnnouncementBanner'
import { NotFoundPage, ResetPasswordPage, VerifyEmailNotice } from './components/AuthPages'
import { appLink, authModeFromHash, authProblem, PASSWORD_RULE, passwordProblem } from './lib/authFlow'
import { promptInstall, recordEngagement, useInstallAvailable } from './lib/install'
import { rememberView } from './lib/landing'
import { PlaceLists } from './components/PlaceLists'

// The workspace cluster (PlayerWorkspace, TournamentCockpit, OperationsPanel,
// WorkspaceChooser) is only needed after sign-in + #workspace, so it is
// code-split off the initial homepage bundle for a faster first load.
const WorkspacePanel = lazy(() => import('./components/WorkspacePanel').then(module => ({ default: module.WorkspacePanel })))
// Public pages are only needed after navigating to a public sub-route, so they
// are code-split off the initial homepage bundle for a faster first load.
const PublicPage = lazy(() => import('./components/PublicPage').then(module => ({ default: module.PublicPage })))
const PeopleDirectory = lazy(() => import('./components/PublicDirectories').then(module => ({ default: module.PeopleDirectory })))
const PersonPage = lazy(() => import('./components/PublicDirectories').then(module => ({ default: module.PersonPage })))
const AccountSettings = lazy(() => import('./components/AccountSettings').then(module => ({ default: module.AccountSettings })))
const InfoPage = lazy(() => import('./components/InfoPage').then(module => ({ default: module.InfoPage })))

// Secondary destinations under "More".
// Explore: the public directories. Hidden or renamed in Customization like before.
const EXPLORE_ITEMS = [
  { id: 'organizations', label: 'Organizations', href: '#organizations', kinds: ['organizations', 'organization'] },
  { id: 'standings', label: 'Standings', href: '#standings', kinds: ['standings'] },
  { id: 'bracket', label: 'Bracket', href: '#bracket', kinds: ['bracket'] },
  { id: 'news', label: 'News', href: '#news', kinds: ['news'] },
  { id: 'archive', label: 'Archive', href: '#archive', kinds: ['archive'] },
] as const
const HOME_TITLE = 'Kulhivaru+ — Maldives Sports Live, Tournaments and Player History'
const ROUTE_TITLES: Partial<Record<string, string>> = {
  home: HOME_TITLE, tournaments: 'Tournaments · Kulhivaru+', teams: 'Teams · Kulhivaru+', players: 'Players · Kulhivaru+',
  organizations: 'Organizations · Kulhivaru+', archive: 'Tournament Archive · Kulhivaru+', tournament: 'Tournament · Kulhivaru+',
  team: 'Team · Kulhivaru+', player: 'Player · Kulhivaru+', organization: 'Organization · Kulhivaru+', history: 'Player History · Kulhivaru+',
  match: 'Match · Kulhivaru+', registration: 'Team Registration · Kulhivaru+', workspace: 'My Work · Kulhivaru+',
}

type AuthMode = 'signin' | 'signup' | 'recover'
type AuthState = { email: string; password: string; name: string; confirm: string; agreed: boolean }

// Primary destinations and the route kinds each one is active for: Home, Tournaments,
// Matches, Players, Teams (owner, 2026-11-02). Organizations, Standings, Bracket,
// News and Archive stay one click away under Explore and in the footer.
// "live" keeps its Customization id so saved labels and hidden settings still apply.
const NAV_ITEMS = [
  { id: 'home', key: 'nav.home', href: '#home', kinds: ['home'] },
  { id: 'tournaments', key: 'nav.tournaments', href: '#tournaments', kinds: ['tournaments', 'tournament', 'registration'] },
  { id: 'live', key: 'nav.matches', href: '#matches', kinds: ['matches', 'match'] },
  { id: 'teams', key: 'nav.teams', href: '#teams', kinds: ['teams', 'team'] },
  { id: 'players', key: 'nav.players', href: '#players', kinds: ['players', 'player', 'history'] },
] as const

function App() {
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('signin')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  // False until the saved session has been read, so a refresh of a private page never
  // shows "Sign in" (or treats the person as signed out) while the session loads.
  const [authReady, setAuthReady] = useState(!supabase)
  const [notice, setNotice] = useState('')
  const [publicRoute, setPublicRoute] = useState(() => parsePublicHash(window.location.hash))
  useEffect(() => {
    const open = () => {
      const mode = authModeFromHash(window.location.hash)
      if (!mode) return
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#home`)
      setPublicRoute({ kind: 'home' }); setAuthMode(mode); setAuthOpen(true)
    }
    open(); window.addEventListener('hashchange', open); return () => window.removeEventListener('hashchange', open)
  }, [])
  useEffect(() => { const redirect = () => { if (isLegacyAdminHash(window.location.hash)) window.location.replace(legacyAdminTarget(window.location.hash)) }; redirect(); window.addEventListener('hashchange', redirect); return () => window.removeEventListener('hashchange', redirect) }, [])
const [language, setLanguage] = useState(loadLanguagePreference)
const [darkMode, setDarkMode] = useState(() => { try { return localStorage.getItem('kulhivaru.dark') === '1' } catch { return false } })
  // Re-render the whole page once the shared language (used by every screen) updates.
  useLanguage()
  const [accountOpen, setAccountOpen] = useState(false)

  useEffect(() => { if (!supabase) return; let initialized = false; let hadSession = false; supabase.auth.getSession().then(({ data }) => { hadSession = Boolean(data.session); initialized = true; setCurrentUser(data.session?.user ?? null); setUserEmail(data.session?.user.email ?? null); setAuthReady(true) }, () => setAuthReady(true)); const { data } = supabase.auth.onAuthStateChange((event, session) => { if (event === 'PASSWORD_RECOVERY') { hadSession = Boolean(session); setCurrentUser(session?.user ?? null); setUserEmail(session?.user.email ?? null); window.location.hash = '#reset-password'; return } const wasSignedOut = initialized && !hadSession; hadSession = Boolean(session); setCurrentUser(session?.user ?? null); setUserEmail(session?.user.email ?? null); if (shouldOpenChooseWorkspace(event, wasSignedOut)) { const destination = loadReturnDestination(); if (destination) { clearReturnDestination(); window.location.hash = returnDestinationHash(destination) } else if (!/^#\/?(workspace\/|admin)/.test(window.location.hash)) window.location.hash = '#workspace' } }); return () => data.subscription.unsubscribe() }, [])
  // Public record visits feed "Continue exploring" (public routes only) and
  // the install prompt's engagement count.
  useEffect(() => { rememberView(window.location.hash) }, [])
  useEffect(() => { const onHashChange = () => { const route = parsePublicHash(window.location.hash); setPublicRoute(route); setMoreOpen(false); setAccountOpen(false); if (!['workspace', 'admin', 'registration'].includes(route.kind)) { rememberView(window.location.hash); recordEngagement() } }; window.addEventListener('hashchange', onHashChange); return () => window.removeEventListener('hashchange', onHashChange) }, [])
  useEffect(() => { saveLanguagePreference(language); document.documentElement.lang = language; document.documentElement.dir = isRtl(language) ? 'rtl' : 'ltr' }, [language])
  useEffect(() => { try { localStorage.setItem('kulhivaru.dark', darkMode ? '1' : '0') } catch { /* ignore */ }; document.documentElement.classList.toggle('dark', darkMode) }, [darkMode])
  // Pages that do not name themselves get a title from their route, so the
  // browser tab never keeps the previous page's title. Pages that set their own
  // title (matches, news, search, standings, info...) are left alone.
  useEffect(() => { const title = ROUTE_TITLES[publicRoute.kind]; if (title) document.title = title }, [publicRoute])
  // The header's glass gets stronger once the page scrolls.
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => { const onScroll = () => setScrolled(window.scrollY > 12); onScroll(); window.addEventListener('scroll', onScroll, { passive: true }); return () => window.removeEventListener('scroll', onScroll) }, [])
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => { if (!moreOpen && !accountOpen) return; const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMoreOpen(false); setAccountOpen(false) } }; const onClick = (event: MouseEvent) => { if (!(event.target as Element).closest('.ed-more, .ed-account')) { setMoreOpen(false); setAccountOpen(false) } }; window.addEventListener('keydown', onKey); document.addEventListener('mousedown', onClick); return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick) } }, [moreOpen, accountOpen])
  const installAvailable = useInstallAvailable()
  // Reviewed Dhivehi labels where they exist; every other key falls back to English.
  const t = (key: string) => translate(language, key)
  const signOut = async () => { await supabase?.auth.signOut(); clearOfflineCache(); setNotice('You have been signed out.') }
  // Create tournament always ends in the Organizer workspace: signed-out
  // visitors sign in first and are then taken there.
  const openTournamentCreator = () => { saveSignInIntent('organizer'); if (currentUser) window.location.hash = '#workspace'; else { setAuthMode('signin'); setAuthOpen(true) } }
  // Shows the Platform admin link only; the admin page re-checks on the server.
  const [isAdmin, setIsAdmin] = useState(false)
  // Any active administrator role (or a bootstrap owner before migration 034) shows the menu link.
  useEffect(() => { if (!supabase || !currentUser) { setIsAdmin(false); return } let active = true; void loadAdminAccess(supabase).then(access => { if (active) setIsAdmin(access.permissions.length > 0 || access.legacyOwner) }); return () => { active = false } }, [currentUser])
  // Published theme and landing customization; the built-in theme stays if this fails.
  useEffect(() => { void loadPublishedConfig(publicSupabase) }, [])
  // Inside the Customization Studio preview frame, drafts arrive by message.
  useEffect(() => listenForPreview(), [])
  const { config: appConfig, platform } = useAppConfig()
  // Home and Help are required; the rest follow the published navigation, and News follows its feature switch.
  const navigation = navigationFor(appConfig).filter(item => item.id !== 'news' || featureOn('news'))
  const shown = new Map(navigation.map(item => [item.id, item.label]))
  const mainNav = NAV_ITEMS.filter(item => item.id === 'home' || shown.has(item.id)).map(item => ({ ...item, label: item.id === 'home' ? undefined : appConfig.navigation?.labels?.[item.id] }))
  const exploreNav = EXPLORE_ITEMS.filter(item => item.id === 'archive' || shown.has(item.id)).map(item => ({ ...item, label: shown.get(item.id) ?? item.label }))
  const inExplore = publicRoute.kind === 'explore' || exploreNav.some(item => (item.kinds as readonly string[]).includes(publicRoute.kind))
  const brand = appConfig.brand
  const appName = brand?.appName ?? DEFAULT_BRAND.appName
  const supportEmail = brand?.supportEmail ?? platform.help?.email
  const inMaintenance = maintenanceActive() && !isAdmin && !['admin', 'reset-password', 'info'].includes(publicRoute.kind)
  const maintenanceText = (language === 'dv' ? platform.maintenance?.messageDv : null) ?? platform.maintenance?.message
  // Signed-in extras: unread notifications and the account's published player
  // profile, both read through the account's own row-level access.
  const [unread, setUnread] = useState<number | null>(null)
  const [publicProfile, setPublicProfile] = useState<string | null>(null)
  useEffect(() => {
    if (!supabase || !currentUser) { setUnread(null); setPublicProfile(null); return }
    let active = true
    void supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', currentUser.id).is('read_at', null).then(result => { if (active) setUnread(result.error ? null : result.count ?? null) })
    void supabase.from('player_profiles').select('slug').eq('account_id', currentUser.id).eq('is_published', true).limit(1).maybeSingle().then(result => { if (active) setPublicProfile(result.data?.slug ? String(result.data.slug) : null) })
    return () => { active = false }
  }, [currentUser, publicRoute.kind])
  const initial = (String(currentUser?.user_metadata?.full_name ?? '') || userEmail || '?').trim().charAt(0).toUpperCase()
  // Signed in on the workspace route, the workspace brings its own slim top bar.
  const inWorkspace = publicRoute.kind === 'workspace' && Boolean(currentUser)

  return <div className={`app-shell${inWorkspace ? ' in-workspace' : ''}${publicRoute.kind === 'home' ? ' is-home' : ''}${publicRoute.kind !== 'workspace' ? ' is-island' : ''}`}>
    <PlaceLists />
    {!inWorkspace && <AnnouncementBanner language={language} />}
    {!inWorkspace && <header className={`ed-topbar${scrolled ? ' scrolled' : ''}`}>
      <BrandLogo size={28} href="#home" className="ed-topbar-brand" />
      <nav className="ed-topnav" aria-label="Main">
        {mainNav.map(item => <a key={item.id} href={item.href} className={(item.kinds as readonly string[]).includes(publicRoute.kind) ? 'active' : ''} aria-current={(item.kinds as readonly string[]).includes(publicRoute.kind) ? 'page' : undefined}>{item.label || t(item.key)}</a>)}
        <details className="ed-topnav-more">
          <summary>{t('tnav.more')} <ChevronDown size={15} aria-hidden="true" /></summary>
          <span className="ed-topnav-menu" onClick={event => { if ((event.target as HTMLElement).closest('a')) (event.currentTarget.parentElement as HTMLDetailsElement).open = false }}>
            <a href="#organizations">{t('nav.organizations')}</a><a href="#standings">{t('nav.standings')}</a><a href="#news">{t('nav.news')}</a><a href="#archive">{t('nav.archive')}</a><a href="#coaches">{t('nav.coaches')}</a><a href="#referees">{t('nav.referees')}</a><a href="#live">{t('nav.live')}</a><a href="#explore">{t('nav.explore')}</a>
          </span>
        </details>
      </nav>
      <div className="ed-topactions">
        <a className={`ed-icon-btn${inExplore ? ' active' : ''}`} href="#explore" aria-label="Explore: organizations, standings, brackets, news and archive"><Compass size={17} /></a>
        <a className="ed-icon-btn" href="#search" aria-label="Search"><Search size={17} /></a>
        <button type="button" className="ed-icon-btn ed-lang-btn" onClick={() => setLanguage(language === 'en' ? 'dv' : 'en')} aria-label={language === 'en' ? 'Switch to Dhivehi' : 'Switch to English'} lang={language === 'en' ? 'dv' : 'en'}>{language === 'en' ? 'ދިވެހި' : 'EN'}</button>
        <button type="button" className="ed-icon-btn" onClick={() => setDarkMode(v => !v)} aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>{darkMode ? <Sun size={17} /> : <Moon size={17} />}</button>
        {userEmail ? <><a className="ed-icon-btn ed-bell" href="#workspace" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}><Bell size={16} />{unread ? <b>{unread > 99 ? '99+' : unread}</b> : null}</a><a className="ed-btn ed-btn-glass ed-btn-sm ed-hide-sm" href="#workspace"><LayoutDashboard size={15} /> {t('nav.workspace')}</a></>
          : <button type="button" className="ed-btn ed-btn-ghost ed-btn-sm ed-signin-btn" onClick={() => { setAuthMode('signin'); setAuthOpen(true) }}>{t('common.signin')}</button>}
        <button type="button" className="ed-btn ed-btn-primary ed-btn-sm ed-create-btn" onClick={openTournamentCreator} aria-label={t('nav.createTournament')}><Plus size={15} aria-hidden="true" /> <span className="ed-create-label">{t('nav.createTournament')}</span></button>
        <span className="ed-account">
          {userEmail ? <button type="button" className="ed-avatar-btn" aria-label="Account menu" aria-haspopup="true" aria-expanded={accountOpen} onClick={() => setAccountOpen(value => !value)}>{initial}</button>
            : <button type="button" className="ed-icon-btn ed-account-btn" aria-label="More account options" aria-haspopup="true" aria-expanded={accountOpen} onClick={() => setAccountOpen(value => !value)}><UserRound size={16} /></button>}
          {accountOpen && <span className="ed-account-menu" role="menu">
            {userEmail ? <><small>{userEmail}</small>
              <a role="menuitem" href="#workspace" onClick={() => setAccountOpen(false)}>{t('workspace.choose')}</a>
              <a role="menuitem" href="#account" onClick={() => setAccountOpen(false)}>{t('nav.account')}</a>
              {publicProfile && <a role="menuitem" href={`#player/${encodeURIComponent(publicProfile)}`} onClick={() => setAccountOpen(false)}>{t('nav.publicProfile')}</a>}
              {isAdmin && <a role="menuitem" href={ADMIN_WORKSPACE_HASH} onClick={() => setAccountOpen(false)}>{t('nav.superAdmin')}</a>}</>
              : <><button type="button" role="menuitem" onClick={() => { setAccountOpen(false); setAuthMode('signin'); setAuthOpen(true) }}>{t('common.signin')}</button>
                <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); setAuthMode('signup'); setAuthOpen(true) }}>{t('common.signup')}</button></>}
            <a role="menuitem" href="#explore" onClick={() => setAccountOpen(false)}>{t('nav.explore')}</a>
            <button type="button" role="menuitem" onClick={() => setLanguage(language === 'en' ? 'dv' : 'en')}><Globe2 size={14} aria-hidden="true" /> {language === 'en' ? 'ދިވެހި' : 'English'}</button>
            {installAvailable && <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); void promptInstall() }}>{t('nav.install')}</button>}
            {userEmail && <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); void signOut() }}>{t('common.signout')}</button>}
          </span>}
        </span>
      </div>
    </header>}
    {notice && <div className="toast" role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
    {maintenanceActive() && isAdmin && <p className="pending-note adm-maintenance-banner" role="status">Maintenance mode is on. Visitors see the maintenance page; administrators can keep working.</p>}
    {inMaintenance ? <main id="top" className="ed-main"><section className="ed-page adm-maintenance" aria-labelledby="maintenance-title"><p className="ed-eyebrow">{appName}</p><h1 id="maintenance-title">We’ll be right back</h1><p>{maintenanceText}</p>{platform.maintenance?.endsAt ? <p className="pf-hint">Expected back {new Date(platform.maintenance.endsAt).toLocaleString('en-GB', { timeZone: 'Indian/Maldives', dateStyle: 'medium', timeStyle: 'short' })} (Maldives time).</p> : null}<p className="pf-hint"><a href="#info/help">{t('footer.helpCentre')}</a> · <a href="#reset-password">Reset password</a></p></section></main>
      : publicRoute.kind === 'workspace' && !authReady ? <main id="workspace"><div className="loading-state" role="status">Checking your session…</div></main>
      : publicRoute.kind === 'workspace' ? <main id="workspace"><WorkspaceRoute user={currentUser} onSignIn={() => { setAuthMode('signin'); setAuthOpen(true) }} onSignOut={signOut} onNotice={setNotice} /></main>
      : publicRoute.kind === 'admin' ? <main id="workspace"><div className="loading-state">Opening the Super Admin workspace…</div></main>
      : publicRoute.kind === 'reset-password' ? <main id="top" className="ed-main"><ResetPasswordPage onNotice={setNotice} /></main>
      : publicRoute.kind === 'not-found' ? <main id="top" className="ed-main"><NotFoundPage /></main>
      : publicRoute.kind === 'account' ? <main id="top" className="ed-main"><Suspense fallback={<div className="loading-state">Loading…</div>}><AccountSettings user={currentUser} language={language} onLanguage={setLanguage} onSignIn={() => { setAuthMode('signin'); setAuthOpen(true) }} onNotice={setNotice} /></Suspense></main>
      : publicRoute.kind === 'info' ? <main id="top" className="ed-main"><Suspense fallback={<div className="loading-state">Loading page…</div>}><InfoPage topic={publicRoute.slug} language={language} /></Suspense></main>
      : publicRoute.kind === 'people' ? <main id="top" className="ed-main"><Suspense fallback={<div className="loading-state">Loading page…</div>}><PeopleDirectory role={publicRoute.role} /></Suspense></main>
      : publicRoute.kind === 'person' ? <main id="top" className="ed-main"><Suspense fallback={<div className="loading-state">Loading page…</div>}><PersonPage role={publicRoute.role} publicId={publicRoute.slug} /></Suspense></main>
      : publicRoute.kind !== 'home' ? <main id="top" className="ed-main"><Suspense fallback={<div className="loading-state">Loading page…</div>}><PublicPage route={publicRoute} onCreateTournament={openTournamentCreator} /></Suspense></main>
        : <main id="top" className="ed-main"><HomepageSections onCreateTournament={openTournamentCreator} /></main>}
    {!inWorkspace && publicRoute.kind !== 'workspace' && <footer className="ed-footer ed-footer-slim">
      <BrandLogo size={26} />
      <nav aria-label="Help and legal"><a href="#info/help">{t('footer.help')}</a><a href="#info/privacy">{t('footer.privacy')}</a><a href="#info/terms">{t('footer.terms')}</a><a href="#info/child-safety">{t('footer.childSafety')}</a></nav>
      <span className="ed-footer-tools"><button type="button" className="ed-link-btn" onClick={() => setLanguage(language === 'en' ? 'dv' : 'en')}><Globe2 size={14} aria-hidden="true" /> {LANGUAGE_LABELS[language]}</button><span>{brand?.copyright ?? `© ${new Date().getFullYear()} ${appName}`}</span></span>
    </footer>}
    {!inWorkspace && publicRoute.kind === 'workspace' && <footer className="ed-footer">
      <div className="footer-brand"><BrandLogo size={30} /><p className="ed-footer-tagline">{brand?.tagline ?? DEFAULT_BRAND.tagline}</p>{supportEmail || platform.help?.phone ? <p className="ed-footer-contact">{supportEmail ? <a href={`mailto:${supportEmail}`}>{supportEmail}</a> : null}{supportEmail && platform.help?.phone ? ' · ' : ''}{platform.help?.phone ?? ''}{platform.help?.hours ? ` · ${platform.help.hours}` : ''}</p> : null}{brand?.social?.length ? <p className="ed-footer-social">{brand.social.map(link => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>)}</p> : null}</div>
      <nav aria-label="Explore"><h4>{t('footer.explore')}</h4><a href="#tournaments">{t('nav.tournaments')}</a><a href="#matches">{t('nav.matches')}</a><a href="#players">{t('nav.players')}</a><a href="#teams">{t('nav.teams')}</a><a href="#organizations">{t('nav.organizations')}</a><a href="#standings">{t('nav.standings')}</a><a href="#news">{t('nav.news')}</a><a href="#archive">{t('nav.archive')}</a><a href="#coaches">{t('nav.coaches')}</a><a href="#referees">{t('nav.referees')}</a><a href="#live">{t('nav.live')}</a><a href="#explore">{t('nav.explore')}</a></nav>
      <nav aria-label="My Work"><h4>{t('footer.myWork')}</h4><a href="#workspace">{t('footer.myWork')}</a><button type="button" className="ed-link-btn" onClick={openTournamentCreator}>{t('nav.createTournament')}</button><a href="#info/claim-profile">{t('nav.claimProfile')}</a><a href="#info/help">{t('footer.helpCentre')}</a><a href="#info/contact">{t('footer.contact')}</a><a href="#info/report">{t('footer.report')}</a><a href="#info/account-support">{t('footer.accountSupport')}</a></nav>
      <nav aria-label="Legal"><h4>{t('footer.legal')}</h4><a href="#info/privacy">{t('footer.privacy')}</a><a href="#info/terms">{t('footer.terms')}</a><a href="#info/community-guidelines">{t('footer.community')}</a><a href="#info/child-safety">{t('footer.childSafety')}</a><a href="#info/data-correction">{t('footer.dataCorrection')}</a><a href="#info/account-deletion">{t('footer.accountDeletion')}</a><a href="#info/image-consent">{t('footer.imageConsent')}</a></nav>
      <div className="ed-footer-base"><span className="ed-footer-tools"><button type="button" className="ed-link-btn" onClick={() => setLanguage(language === 'en' ? 'dv' : 'en')}><Globe2 size={14} /> {LANGUAGE_LABELS[language]}</button>{installAvailable && <button type="button" className="ed-link-btn" onClick={() => void promptInstall()}><Download size={14} /> {t('nav.install')}</button>}</span><span>{brand?.copyright ?? `© ${new Date().getFullYear()} ${appName}`}</span></div>
    </footer>}
    {publicRoute.kind !== 'workspace' && <nav className="ed-bottomnav" aria-label="Public destinations">
      <a className={publicRoute.kind === 'home' ? 'active' : ''} href="#home" aria-current={publicRoute.kind === 'home' ? 'page' : undefined}><Home size={20} /> {t('nav.home')}</a>
      <a className={['tournaments', 'tournament', 'registration'].includes(publicRoute.kind) ? 'active' : ''} href="#tournaments"><Trophy size={20} /> {t('nav.tournaments')}</a>
      <a className={['matches', 'match'].includes(publicRoute.kind) ? 'active' : ''} href="#matches"><PlayCircle size={20} /> {t('nav.matches')}</a>
      <a className={['players', 'player', 'history'].includes(publicRoute.kind) ? 'active' : ''} href="#players"><UserRound size={20} /> {t('nav.players')}</a>
      <a className={['teams', 'team'].includes(publicRoute.kind) ? 'active' : ''} href="#teams"><Users size={20} /> {t('nav.teams')}</a>
    </nav>}
    {authOpen && <AuthDialog mode={authMode} onClose={() => setAuthOpen(false)} onModeChange={setAuthMode} onNotice={setNotice} returnDestination={loadReturnDestination()} />}
  </div>
}

function WorkspaceRoute({ user, onSignIn, onSignOut, onNotice }: { user: User | null; onSignIn: () => void; onSignOut: () => void; onNotice: (message: string) => void }) { return user ? <Suspense fallback={<div className="loading-state">Loading workspace…</div>}><WorkspacePanel user={user} onNotice={onNotice} onSignIn={onSignIn} onSignOut={onSignOut} /></Suspense> : <section className="workspace-section section"><div className="onboarding-panel"><p className="eyebrow">PRIVATE WORKSPACE</p><h2>Sign in to continue</h2><p>Your authorized player, team, and organization workspaces are only available after sign-in.</p><button type="button" className="primary-button" onClick={onSignIn}>Sign in <ArrowRight size={15} /></button></div></section> }

function AuthDialog({ mode, onClose, onModeChange, onNotice, returnDestination }: { mode: AuthMode; onClose: () => void; onModeChange: (mode: AuthMode) => void; onNotice: (message: string) => void; returnDestination: ReturnType<typeof loadReturnDestination> }) {
  const screenRef = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    screenRef.current?.querySelector<HTMLInputElement>('input')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const controls = [...(screenRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled)') ?? [])].filter(node => node.getClientRects().length > 0)
      const first = controls[0]; const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [])
  const [form, setForm] = useState<AuthState>({ email: '', password: '', name: '', confirm: '', agreed: false }); const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  const [canResend, setCanResend] = useState(false)
  const [verifyEmail, setVerifyEmail] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  // Verification and recovery emails link back into this app only.
  const resend = async (email: string): Promise<string | null> => { if (!supabase) return 'Account actions are not available right now.'; const result = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: appLink(returnDestination ? returnDestinationHash(returnDestination) : '#workspace') } }); return result.error ? authProblem(result.error.message).message : null }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setCanResend(false)
    if (!supabase) return setError('Account actions are not available right now. Please try again later.')
    if (mode === 'recover') {
      if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return setError('Enter your account email.')
      setLoading(true); const result = await supabase.auth.resetPasswordForEmail(form.email.trim(), { redirectTo: appLink('#reset-password') }); setLoading(false)
      // The same answer whether or not the account exists, so emails cannot be probed.
      if (result.error && !/rate|too many/i.test(result.error.message)) { onClose(); return onNotice('If an account exists for that email, a reset link has been sent.') }
      if (result.error) return setError(authProblem(result.error.message).message)
      onClose(); return onNotice('If an account exists for that email, a reset link has been sent.')
    }
    const validationError = validateAuthInput(form, mode === 'signup') ?? (mode === 'signup' ? passwordProblem(form.password) ?? (form.confirm !== form.password ? 'The two passwords do not match.' : null) ?? (form.agreed ? null : 'Please agree to the Terms and Privacy Policy to create your account.') : null)
    if (validationError) return setError(validationError)
    setLoading(true)
    const result = mode === 'signin' ? await supabase.auth.signInWithPassword({ email: form.email.trim(), password: form.password }) : await supabase.auth.signUp({ email: form.email.trim(), password: form.password, options: { data: { full_name: form.name.trim() }, emailRedirectTo: appLink(returnDestination ? returnDestinationHash(returnDestination) : '#workspace') } })
    setLoading(false)
    if (result.error) { const problem = authProblem(result.error.message); setCanResend(Boolean(problem.resendVerification)); return setError(problem.message) }
    if (mode === 'signup') { setVerifyEmail(form.email.trim()); return }
    if (returnDestination) { clearReturnDestination(); window.location.hash = returnDestinationHash(returnDestination) }
    onClose(); onNotice(returnDestination ? tr('auth.welcomeReturn') : tr('auth.welcomeNotice'))
  }
  const title = verifyEmail ? tr('auth.verify') : mode === 'recover' ? tr('auth.recover') : mode === 'signin' ? tr('auth.welcome') : tr('auth.join')
  return <div className="modal-backdrop auth-backdrop" role="presentation"><section ref={screenRef} className="auth-screen" role="dialog" aria-modal="true" aria-labelledby="auth-title"><header className="auth-screen-header"><BrandLogo size={38} /><button type="button" className="ed-btn ed-btn-ghost" onClick={onClose}><ArrowLeft size={17} aria-hidden="true" /> Back to website</button></header><div className="auth-modal"><div className="auth-photo" aria-hidden="true"><img src={`${import.meta.env.BASE_URL}assets/covers/auth-photo.jpg`} alt="" width={711} height={486} /><p className="auth-photo-title">{verifyEmail ? 'One step to your sporting world.' : mode === 'signup' ? 'One account. Your sporting world.' : 'Your sport. Your community.'}</p><p className="auth-photo-text">{verifyEmail ? 'Verify your email to continue to your workspaces.' : mode === 'signup' ? 'Play, manage a team or organize competitions.' : 'Competitions, teams and sporting history in one place.'}</p></div><div className="auth-form-col"><button type="button" className="modal-close" onClick={onClose} aria-label="Close"><X /></button><div className="modal-brand"><BrandMark size={44} /><span className="brand-word">KULHIVARU<b>+</b></span><small>{tr('auth.tagline')}</small></div><h2 id="auth-title">{title}</h2>
    {verifyEmail ? <VerifyEmailNotice email={verifyEmail} onResend={() => resend(verifyEmail)} /> : <>
      {returnDestination ? <div className="warning" role="status">{tr('auth.registerIntro')}</div> : null}
      <p>{mode === 'recover' ? 'Enter your account email and we will send a secure link to set a new password.' : mode === 'signin' ? tr('auth.intro') : tr('auth.joinIntro')}</p>
      {!isSupabaseConfigured && <div className="warning"><LockKeyhole size={15} /> Account actions are not available right now.</div>}
      <form onSubmit={submit}>{mode === 'signup' && <label>{tr('auth.name')}<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoComplete="name" /></label>}<label>{tr('auth.email')}<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} autoComplete="email" /></label>{mode !== 'recover' && <label>{tr('auth.password')}<span className="px-password"><input type={showPassword ? 'text' : 'password'} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} aria-describedby={mode === 'signup' ? 'password-rule' : undefined} /><button type="button" className="ed-link-btn" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? tr('auth.hide') : tr('auth.show')}</button></span>{mode === 'signup' && <small id="password-rule" className="field-hint">{PASSWORD_RULE}</small>}</label>}{mode === 'signup' && <><label>{tr('auth.confirmPassword')}<input type={showPassword ? 'text' : 'password'} value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" /></label><label className="checkbox-row auth-agree"><input type="checkbox" checked={form.agreed} onChange={e => setForm({ ...form, agreed: e.target.checked })} aria-describedby="agree-hint" /> <span id="agree-hint">{tr('auth.agree')} <a href="#info/terms" target="_blank" rel="noopener">Terms</a> and <a href="#info/privacy" target="_blank" rel="noopener">{tr('auth.privacyPolicy')}</a> (required).</span></label></>}
        {error && <div className="form-error" role="alert">{error}{canResend && <button type="button" className="switch-auth" onClick={() => void resend(form.email.trim()).then(problem => { setCanResend(false); setError(problem ?? tr('auth.resent')) })}>{tr('auth.resend')}</button>}</div>}
        <button type="submit" className="primary-button full" disabled={loading}>{loading ? 'Please wait…' : mode === 'recover' ? tr('auth.sendReset') : mode === 'signin' ? tr('common.signin') : tr('common.signup')} <ArrowRight size={16} /></button></form>
      {mode === 'signin' && <button type="button" className="switch-auth" onClick={() => onModeChange('recover')}>{tr('auth.forgot')}</button>}
      <button type="button" className="switch-auth" onClick={() => onModeChange(mode === 'signin' || mode === 'recover' ? 'signup' : 'signin')}>{mode === 'signin' || mode === 'recover' ? tr('auth.needAccount') : tr('auth.haveAccount')}</button>
    </>}</div></div><footer className="auth-screen-footer"><BrandLogo size={25} /><nav aria-label="Help and legal"><a href="#info/help" onClick={onClose}>Help</a><a href="#info/privacy" onClick={onClose}>Privacy</a><a href="#info/terms" onClick={onClose}>Terms</a></nav><span>Your sport. Your community.</span></footer></section></div>
}

export default App
