// ---------------------------------------------------------------------------
// Internationalization (unified plan section 6).
//
// - English is the complete source language.
// - Dhivehi covers the shared shell first: menus, footer, sign-in, common
//   buttons and every status label. Any key without a Dhivehi entry falls back
//   to English, so a screen is never blank. Coverage is reported so the owner
//   can see exactly what remains.
// - The Dhivehi wording below is a DRAFT written without a native reviewer.
//   It must be checked by a Dhivehi speaker before release (plan section 6:
//   "test translations for meaning and overflow").
// ---------------------------------------------------------------------------
import { useSyncExternalStore } from 'react'

export type Language = 'en' | 'dv'

export const SUPPORTED_LANGUAGES: Language[] = ['en', 'dv']

export const LANGUAGE_LABELS: Record<Language, string> = { en: 'English', dv: 'ދިވެހި' }

export const STORAGE_KEY = 'kulhivaru.language'

export const translations: Record<Language, Record<string, string>> = {
  en: {
    // Navigation and shell
    'nav.home': 'Home', 'nav.tournaments': 'Tournaments', 'nav.matches': 'Matches', 'nav.teams': 'Teams', 'nav.players': 'Players', 'nav.news': 'News',
    'nav.live': 'Live', 'nav.workspace': 'My Work', 'nav.explore': 'Explore', 'nav.search': 'Search', 'nav.organizations': 'Organizations',
    'nav.standings': 'Standings', 'nav.archive': 'Archive', 'nav.coaches': 'Coaches', 'nav.referees': 'Referees', 'nav.account': 'Account Settings',
    'nav.notifications': 'Notifications', 'nav.createTournament': 'Create Tournament', 'nav.language': 'Language',
    // Common actions and states
    'common.signout': 'Sign out', 'common.loading': 'Loading…', 'common.empty': 'No records available yet.', 'common.retry': 'Retry',
    'common.signin': 'Sign in', 'common.signup': 'Create account', 'common.save': 'Save', 'common.saving': 'Saving…', 'common.saved': 'Saved',
    'common.cancel': 'Cancel', 'common.back': 'Back', 'common.close': 'Close', 'common.edit': 'Edit', 'common.remove': 'Remove', 'common.add': 'Add',
    'common.yes': 'Yes', 'common.no': 'No', 'common.continue': 'Continue', 'common.next': 'Next', 'common.export': 'Export', 'common.filters': 'Filters',
    'common.viewAll': 'View all', 'common.notFound': 'Page not found', 'common.loadFailed': 'This page could not be loaded.', 'common.checkConnection': 'Check your connection and try again.',
    'common.offline': 'You are offline.', 'common.savedOnDevice': 'Saved on this device',
    // Workspaces
    'workspace.choose': 'My Work', 'workspace.switch': 'Switch Workspace', 'workspace.player': 'Player', 'workspace.team': 'Team', 'workspace.organizer': 'Organizer',
    'workspace.official': 'Official', 'workspace.admin': 'Platform Admin', 'workspace.nextAction': 'Next action', 'workspace.needsAttention': 'Needs attention',
    'workspace.backToTournaments': 'Back to My Tournaments', 'workspace.viewPublic': 'View Public Page',
    // Tournament workspace menu (five items)
    'tnav.home': 'Home', 'tnav.teams': 'Teams', 'tnav.schedule': 'Schedule', 'tnav.matches': 'Matches', 'tnav.more': 'More',
    // Sign-in dialog
    'auth.welcome': 'Welcome back', 'auth.join': 'Join Kulhivaru+', 'auth.recover': 'Reset your password', 'auth.verify': 'Verify your email',
    'auth.email': 'Email address', 'auth.password': 'Password', 'auth.show': 'Show', 'auth.hide': 'Hide', 'auth.forgot': 'Forgot your password?',
    'auth.needAccount': 'Need an account? Create one', 'auth.haveAccount': 'Already have an account? Sign in', 'auth.name': 'Your name',
    'auth.intro': 'Sign in to access your authorized workspaces.', 'auth.tagline': 'Maldives Plays On',
    // Footer
    'footer.explore': 'Explore', 'footer.help': 'Help', 'footer.legal': 'Legal', 'footer.helpCentre': 'Help Centre', 'footer.contact': 'Contact',
    'footer.privacy': 'Privacy', 'footer.terms': 'Terms', 'footer.report': 'Report an Issue',
    'nav.publicProfile': 'Public profile', 'nav.superAdmin': 'Super Admin', 'nav.install': 'Install app', 'nav.claimProfile': 'Claim Player Profile',
    'footer.accountSupport': 'Account Support', 'footer.community': 'Community Guidelines', 'footer.childSafety': 'Child Safety', 'footer.dataCorrection': 'Data Correction',
    'footer.accountDeletion': 'Account Deletion', 'footer.imageConsent': 'Image Publication and Consent', 'footer.myWork': 'My Work',
    'auth.confirmPassword': 'Confirm password', 'auth.agree': 'I agree to the', 'auth.privacyPolicy': 'Privacy Policy', 'auth.and': 'and', 'auth.resend': 'Send the verification email again',
    'auth.privateWorkspace': 'Private workspace', 'auth.signInToContinue': 'Sign in to continue',
    'auth.sendReset': 'Send reset link', 'auth.joinIntro': 'Create one account for your sports journey.', 'auth.registerIntro': 'Sign in to register your team for this tournament.',
    'auth.resent': 'Verification email sent again. Check your inbox and spam folder.', 'auth.welcomeNotice': 'Welcome back.', 'auth.welcomeReturn': 'Welcome back. Returning you to the tournament registration.',
    // Statuses
    'status.application.draft': 'Draft', 'status.application.submitted': 'Submitted', 'status.application.under_review': 'Under review',
    'status.application.changes_requested': 'Changes requested', 'status.application.approved': 'Approved', 'status.application.rejected': 'Rejected',
    'status.application.withdrawn': 'Withdrawn', 'status.application.waitlisted': 'Waitlisted',
    'status.roster.not_started': 'Not started', 'status.roster.draft': 'Draft', 'status.roster.submitted': 'Submitted', 'status.roster.under_review': 'Under review',
    'status.roster.changes_requested': 'Changes requested', 'status.roster.approved': 'Approved', 'status.roster.locked': 'Locked', 'status.roster.rejected': 'Rejected',
    'status.payment.not_required': 'Not required', 'status.payment.unpaid': 'Pending', 'status.payment.proof_submitted': 'Proof submitted',
    'status.payment.under_review': 'Under review', 'status.payment.paid': 'Verified', 'status.payment.waived': 'Waived', 'status.payment.refunded': 'Refunded', 'status.payment.overdue': 'Overdue', 'status.payment.rejected': 'Rejected',
    'status.match.scheduled': 'Scheduled', 'status.match.live': 'Live', 'status.match.awaiting_confirmation': 'Awaiting confirmation', 'status.match.confirmed': 'Official',
    'status.match.postponed': 'Postponed', 'status.match.abandoned': 'Abandoned', 'status.match.cancelled': 'Cancelled',
    'status.tournament.draft': 'Draft', 'status.tournament.setup': 'In setup', 'status.tournament.registration_open': 'Registration open',
    'status.tournament.registration_closed': 'Registration closed', 'status.tournament.in_progress': 'In progress', 'status.tournament.completed': 'Completed',
    'status.tournament.archived': 'Archived', 'status.tournament.cancelled': 'Cancelled',
    // Sports
    'sport.football': 'Football', 'sport.futsal': 'Futsal', 'sport.handball': 'Handball', 'sport.volleyball': 'Volleyball', 'sport.basketball': 'Basketball', 'sport.basketball_3x3': '3x3 Basketball',
  },
  // DRAFT - needs review by a native Dhivehi speaker before release.
  dv: {
    'nav.home': 'މައި ޞަފްޙާ', 'nav.tournaments': 'ޓޯނަމަންޓްތައް', 'nav.matches': 'މެޗުތައް', 'nav.teams': 'ޓީމުތައް', 'nav.players': 'ކުޅުންތެރިން', 'nav.news': 'ޚަބަރު',
    'nav.live': 'ލައިވް', 'nav.workspace': 'އަހަރެންގެ މަސައްކަތް', 'nav.explore': 'ހޯދާ ބަލާ', 'nav.search': 'ހޯދާ', 'nav.organizations': 'ޖަމްޢިއްޔާތައް',
    'nav.standings': 'ޕޮއިންޓް ޓޭބަލް', 'nav.archive': 'އާކައިވް', 'nav.coaches': 'ކޯޗުން', 'nav.referees': 'ރެފްރީން', 'nav.account': 'އެކައުންޓް ސެޓިންގްސް',
    'nav.notifications': 'ނޯޓިފިކޭޝަންތައް', 'nav.createTournament': 'ޓޯނަމަންޓެއް ހަދާ', 'nav.language': 'ބަސް',
    'common.signout': 'ސައިން އައުޓް', 'common.loading': 'ލޯޑުވަނީ…', 'common.empty': 'އަދި އެއްވެސް ރެކޯޑެއް ނެތް.', 'common.retry': 'އަލުން މަސައްކަތްކުރޭ',
    'common.signin': 'ސައިން އިން', 'common.signup': 'އެކައުންޓެއް ހަދާ', 'common.save': 'ރައްކާކުރޭ', 'common.saving': 'ރައްކާކުރަނީ…', 'common.saved': 'ރައްކާކުރެވިއްޖެ',
    'common.cancel': 'ކެންސަލް', 'common.back': 'ފަހަތަށް', 'common.close': 'ބަންދުކުރޭ', 'common.edit': 'ބަދަލުކުރޭ', 'common.remove': 'ނައްތާލާ', 'common.add': 'އިތުރުކުރޭ',
    'common.yes': 'އާން', 'common.no': 'ނޫން', 'common.continue': 'ކުރިއަށް', 'common.next': 'ދެން', 'common.export': 'އެކްސްޕޯޓް', 'common.filters': 'ފިލްޓަރު',
    'common.viewAll': 'ހުރިހާ އެއްޗެއް ބަލާ', 'common.notFound': 'ޞަފްޙާ ނުފެނުނު', 'common.loadFailed': 'މި ޞަފްޙާ ލޯޑެއް ނުވި.', 'common.checkConnection': 'ކަނެކްޝަން ޗެކްކޮށް އަލުން މަސައްކަތްކުރޭ.',
    'common.offline': 'ތިޔަ އޮތީ އޮފްލައިންގައި.', 'common.savedOnDevice': 'މި ޑިވައިސްގައި ރައްކާކުރެވިއްޖެ',
    'workspace.choose': 'އަހަރެންގެ މަސައްކަތް', 'workspace.switch': 'ވޯކްސްޕޭސް ބަދަލުކުރޭ', 'workspace.player': 'ކުޅުންތެރިޔާ', 'workspace.team': 'ޓީމު', 'workspace.organizer': 'އިންތިޒާމުކުރާ ފަރާތް',
    'workspace.official': 'އޮފިޝަލް', 'workspace.admin': 'ޕްލެޓްފޯމް އެޑްމިން', 'workspace.nextAction': 'ދެން ކުރާނެ ކަންތައް', 'workspace.needsAttention': 'ސަމާލުކަން ދޭންޖެހޭ',
    'workspace.backToTournaments': 'އަހަރެންގެ ޓޯނަމަންޓްތަކަށް', 'workspace.viewPublic': 'ޕަބްލިކް ޞަފްޙާ ބަލާ',
    'tnav.home': 'މައި ޞަފްޙާ', 'tnav.teams': 'ޓީމުތައް', 'tnav.schedule': 'ތާވަލު', 'tnav.matches': 'މެޗުތައް', 'tnav.more': 'އިތުރު',
    'auth.welcome': 'މަރުޙަބާ', 'auth.join': 'ކުޅިވަރު+ އާ ގުޅޭ', 'auth.recover': 'ޕާސްވޯޑް އަލުން ހަދާ', 'auth.verify': 'އީމެއިލް ކަށަވަރުކުރޭ',
    'auth.email': 'އީމެއިލް އެޑްރެސް', 'auth.password': 'ޕާސްވޯޑް', 'auth.show': 'ދައްކާ', 'auth.hide': 'ފޮރުވާ', 'auth.forgot': 'ޕާސްވޯޑް ހަނދާން ނެތީތަ؟',
    'auth.needAccount': 'އެކައުންޓެއް ނެތީތަ؟ އެކައުންޓެއް ހަދާ', 'auth.haveAccount': 'އެކައުންޓެއް އޮތީތަ؟ ސައިން އިން ކުރޭ', 'auth.name': 'ތިބާގެ ނަން',
    'auth.intro': 'ތިބާއަށް ހުއްދަ ލިބިފައިވާ ވޯކްސްޕޭސްތަކަށް ވަނުމަށް ސައިން އިން ކުރޭ.', 'auth.tagline': 'ރާއްޖެ ކުޅެމުންދޭ',
    'footer.explore': 'ހޯދާ ބަލާ', 'footer.help': 'އެހީ', 'footer.legal': 'ޤާނޫނީ', 'footer.helpCentre': 'އެހީތެރިކަމުގެ މަރުކަޒު', 'footer.contact': 'ގުޅުއްވާ',
    'footer.privacy': 'ޕްރައިވެސީ', 'footer.terms': 'ޝަރުތުތައް', 'footer.report': 'މައްސަލައެއް ހުށަހަޅާ',
    'nav.publicProfile': 'ޕަބްލިކް ޕްރޮފައިލް', 'nav.superAdmin': 'ސުޕަރ އެޑްމިން', 'nav.install': 'އެޕް އިންސްޓޯލްކުރޭ', 'nav.claimProfile': 'ކުޅުންތެރިޔާގެ ޕްރޮފައިލް ހޯދާ',
    'footer.accountSupport': 'އެކައުންޓް އެހީ', 'footer.community': 'މުޖުތަމަޢުގެ އުސޫލުތައް', 'footer.childSafety': 'ކުދިންގެ ރައްކާތެރިކަން', 'footer.dataCorrection': 'މަޢުލޫމާތު ރަނގަޅުކުރުން',
    'footer.accountDeletion': 'އެކައުންޓް ފޮހެލުން', 'footer.imageConsent': 'ފޮޓޯ ޝާއިޢުކުރުމާއި ރުހުން', 'footer.myWork': 'އަހަރެންގެ މަސައްކަތް',
    'auth.confirmPassword': 'ޕާސްވޯޑް ކަށަވަރުކުރޭ', 'auth.agree': 'އަހަރެން ބަލައިގަންނަން', 'auth.privacyPolicy': 'ޕްރައިވެސީ ސިޔާސަތު', 'auth.and': 'އަދި', 'auth.resend': 'ކަށަވަރުކުރާ އީމެއިލް އަލުން ފޮނުވާ',
    'auth.privateWorkspace': 'ޕްރައިވެޓް ވޯކްސްޕޭސް', 'auth.signInToContinue': 'ކުރިއަށް ދިއުމަށް ސައިން އިން ކުރޭ',
    'auth.sendReset': 'ރީސެޓް ލިންކު ފޮނުވާ', 'auth.joinIntro': 'ކުޅިވަރުގެ ދަތުރަށް އެއް އެކައުންޓް ހަދާ.', 'auth.registerIntro': 'މި ޓޯނަމަންޓަށް ޓީމު ރަޖިސްޓަރުކުރުމަށް ސައިން އިން ކުރޭ.',
    'auth.resent': 'ކަށަވަރުކުރާ އީމެއިލް އަލުން ފޮނުވިއްޖެ. އިންބޮކްސާއި ސްޕޭމް ޗެކްކުރޭ.', 'auth.welcomeNotice': 'މަރުޙަބާ.', 'auth.welcomeReturn': 'މަރުޙަބާ. ޓޯނަމަންޓުގެ ރަޖިސްޓްރޭޝަނަށް އަނބުރާ ގެންދަނީ.',
    'status.application.draft': 'ޑްރާފްޓް', 'status.application.submitted': 'ހުށަހަޅާފައި', 'status.application.under_review': 'ބަލަމުންދަނީ',
    'status.application.changes_requested': 'ބަދަލު އެދިފައި', 'status.application.approved': 'ފާސްކޮށްފައި', 'status.application.rejected': 'ރިޖެކްޓްކޮށްފައި',
    'status.application.withdrawn': 'ދޫކޮށްލާފައި', 'status.application.waitlisted': 'ވެއިޓްލިސްޓްގައި',
    'status.roster.not_started': 'ފަށާފައި ނުވޭ', 'status.roster.draft': 'ޑްރާފްޓް', 'status.roster.submitted': 'ހުށަހަޅާފައި', 'status.roster.under_review': 'ބަލަމުންދަނީ',
    'status.roster.changes_requested': 'ބަދަލު އެދިފައި', 'status.roster.approved': 'ފާސްކޮށްފައި', 'status.roster.locked': 'ބަންދުކޮށްފައި', 'status.roster.rejected': 'ރިޖެކްޓްކޮށްފައި',
    'status.payment.not_required': 'ފީއެއް ނެތް', 'status.payment.unpaid': 'ނުދައްކާ', 'status.payment.proof_submitted': 'ރަސީދު ހުށަހަޅާފައި',
    'status.payment.under_review': 'ބަލަމުންދަނީ', 'status.payment.paid': 'ކަށަވަރުކޮށްފައި', 'status.payment.waived': 'މާފުކޮށްފައި', 'status.payment.refunded': 'އަނބުރާ ދީފައި', 'status.payment.overdue': 'މުއްދަތު ހަމަވެފައި', 'status.payment.rejected': 'ރިޖެކްޓްކޮށްފައި',
    'status.match.scheduled': 'ތާވަލުކޮށްފައި', 'status.match.live': 'ލައިވް', 'status.match.awaiting_confirmation': 'ކަށަވަރުކުރަން ހުރި', 'status.match.confirmed': 'ރަސްމީ',
    'status.match.postponed': 'ފަސްކޮށްފައި', 'status.match.abandoned': 'ދޫކޮށްލާފައި', 'status.match.cancelled': 'ކެންސަލްކޮށްފައި',
    'status.tournament.draft': 'ޑްރާފްޓް', 'status.tournament.setup': 'ތައްޔާރުކުރަމުން', 'status.tournament.registration_open': 'ރަޖިސްޓްރޭޝަން ހުޅުވިފައި',
    'status.tournament.registration_closed': 'ރަޖިސްޓްރޭޝަން ބަންދު', 'status.tournament.in_progress': 'ކުޅެމުންދަނީ', 'status.tournament.completed': 'ނިމިފައި',
    'status.tournament.archived': 'އާކައިވްކޮށްފައި', 'status.tournament.cancelled': 'ކެންސަލްކޮށްފައި',
    'sport.football': 'ފުޓުބޯޅަ', 'sport.futsal': 'ފުޓްސަލް', 'sport.handball': 'ހޭންޑްބޯޅަ', 'sport.volleyball': 'ވޮލީބޯޅަ', 'sport.basketball': 'ބާސްކެޓްބޯޅަ', 'sport.basketball_3x3': '3x3 ބާސްކެޓްބޯޅަ',
  },
}

// Published overrides from the Localization Studio (Super Admin customization).
// They win over the built-in text; anything missing falls back as before.
let overrides: Partial<Record<Language, Record<string, string>>> = {}
export function setTranslationOverrides(next: Record<string, { en?: string; dv?: string }> | undefined) {
  const result: Partial<Record<Language, Record<string, string>>> = { en: {}, dv: {} }
  for (const [key, value] of Object.entries(next ?? {})) {
    if (value.en) result.en![key] = value.en
    if (value.dv) result.dv![key] = value.dv
  }
  overrides = result
  notify()
}

export function translate(language: Language, key: string, fallback?: string): string {
  return overrides[language]?.[key] ?? translations[language]?.[key] ?? overrides.en?.[key] ?? translations.en[key] ?? fallback ?? key
}

export function isRtl(language: Language): boolean {
  return language === 'dv'
}

export function translationCoverage(): { total: number; translated: number; percent: number; missing: string[] } {
  const baseKeys = Object.keys(translations.en)
  const dv = translations.dv
  const missing = baseKeys.filter(key => !dv[key])
  return { total: baseKeys.length, translated: baseKeys.length - missing.length, percent: Math.round(((baseKeys.length - missing.length) / baseKeys.length) * 100), missing }
}

export function loadLanguagePreference(): Language {
  try {
    const value = (globalThis as { localStorage?: { getItem: (k: string) => string | null } }).localStorage?.getItem(STORAGE_KEY)
    if (value === 'dv' || value === 'en') return value
  } catch { /* ignore */ }
  return 'en'
}

export function saveLanguagePreference(language: Language): void {
  try { (globalThis as { localStorage?: { setItem: (k: string, v: string) => void } }).localStorage?.setItem(STORAGE_KEY, language) } catch { /* ignore */ }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language === 'dv' ? 'dv' : 'en'
    document.documentElement.dir = isRtl(language) ? 'rtl' : 'ltr'
  }
  setActiveLanguage(language)
}

// --- The language every screen uses -------------------------------------------
// One shared value, so any component or helper can translate without the
// language being passed down through every screen. Components that call
// useLanguage() re-render when it changes.
let active: Language = loadLanguagePreference()
const listeners = new Set<() => void>()
function notify() { for (const listener of listeners) listener() }

export function activeLanguage(): Language { return active }
export function setActiveLanguage(language: Language): void {
  if (language === active) return
  active = language
  notify()
}
export function useLanguage(): Language {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, activeLanguage, activeLanguage)
}

// Translate in the active language. `fallback` is the English text shown when a
// key is not in the dictionary yet, so screens are never blank.
export function tr(key: string, fallback?: string): string {
  return translate(active, key, fallback)
}

// A status label in the active language, e.g. statusLabel('match', 'confirmed').
export function statusLabel(group: 'application' | 'roster' | 'payment' | 'match' | 'tournament', status: string, fallback?: string): string {
  return translate(active, `status.${group}.${status}`, fallback ?? status)
}
