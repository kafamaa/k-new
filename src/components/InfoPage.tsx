import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, FileText } from 'lucide-react'
import { INFO_TOPICS, loadPlatformPage, OWNER_WRITTEN, type InfoTopic, type PlatformPage } from '../lib/landing'
import { publicSupabase } from '../lib/supabase'
import type { Language } from '../lib/i18n'
import { useAppConfig } from '../lib/useAppConfig'
import { legalVersion } from '../lib/appConfig'

// Help and legal pages linked from the footer. Pages the platform owner
// publishes (migration 032, managed in Platform admin) are shown as written.
// Otherwise help topics explain how the platform already works, and legal
// topics say plainly that the owner has not published them yet; the app never
// invents legal terms or contact details.
const TITLES: Record<InfoTopic, string> = {
  help: 'Help Centre', contact: 'Contact', report: 'Report an Issue', 'claim-profile': 'Claim a Player Profile', 'account-support': 'Account Support',
  privacy: 'Privacy', terms: 'Terms', 'community-guidelines': 'Community Guidelines', 'child-safety': 'Child Safety', 'data-correction': 'Data Correction',
  'account-deletion': 'Account Deletion', 'image-consent': 'Image Publication and Consent',
}

const BUILT_IN: Partial<Record<InfoTopic, ReactNode>> = {
  help: <><p>Kulhivaru+ shows published Maldives tournaments, teams, players, fixtures, official results and standings. Anyone can browse; an account is needed to take part.</p><ul><li><a href="#info/claim-profile">Claim a player profile</a> an organizer created for you.</li><li>Teams register through a tournament’s <strong>Register Team</strong> button while registration is open.</li><li>Organizers start from <strong>Create Tournament</strong> on the home page.</li><li>Something wrong on a public page? Use <a href="#info/report">Report</a>.</li></ul></>,
  report: <><p>Every public tournament, team, player, match and article has a <strong>Report</strong> button. Choose a reason (incorrect information, duplicate player, impersonated team, inappropriate image or content, incorrect match information, privacy concern or other) and add details.</p><p>Reports are private requests to the platform team. They never change the record by themselves, and the reporter is never shown publicly. You need to be signed in, and the number of reports per day is limited.</p></>,
  'claim-profile': <><p>Organizers and teams often create player records before the player has an account. To take over your record, ask the organizer or team for a claim invitation sent to your email. Accept it after signing in, and the profile, its history and Digital Card become yours.</p><p>Each person can hold only one profile: identity numbers are checked privately (never stored readable) to stop duplicates.</p></>,
  'account-support': <><p>Use <strong>Forgot your password?</strong> in the sign-in window to receive a recovery email. If you cannot reach your account’s email address, use the platform contact details on the <a href="#info/contact">Contact</a> page.</p></>,
  'child-safety': <><p>When a player is marked as under 18, their profile cannot be published until a guardian’s approval has been recorded. Private details such as date of birth, identity numbers and contact details are never shown on public pages.</p><p>Report any concern about a minor’s information with the <strong>Report</strong> button and the reason “Privacy concern”.</p></>,
  'data-correction': <><p>Players can ask for corrections from their Player Workspace (Requests). Each request goes to the right reviewer: the tournament organizer for match data, the team for membership, or the platform team for identity and account matters.</p><p>Official results are corrected by issuing a new confirmed version; the earlier version stays in the audit trail and only the newest appears publicly.</p></>,
  'account-deletion': <><p>To close your account, contact the platform team (see <a href="#info/contact">Contact</a>). Official results belong to tournament records and stay as confirmed. You can unpublish your player profile yourself at any time from the Player Workspace.</p></>,
  'image-consent': <><p>Photos and logos appear publicly only after the owner publishes them. Players control whether their photo is public from Privacy in the Player Workspace; hiding it removes it from public pages straight away. A minor’s profile, including its photo, is not published without guardian approval.</p><p>Private documents (identity, payment proof, finance) live in private storage and are never shown on public pages.</p></>,
}

export function InfoPage({ topic, language }: { topic: string; language: Language }) {
  const known = (INFO_TOPICS as readonly string[]).includes(topic) ? topic as InfoTopic : 'help'
  const [page, setPage] = useState<PlatformPage | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let active = true; setLoaded(false); setPage(null)
    if (!publicSupabase || known === 'report' || known === 'claim-profile' || known === 'account-support') { setLoaded(true); return }
    void loadPlatformPage(publicSupabase, known).then(result => { if (active) { setPage(result.data?.isPublished ? result.data : null); setLoaded(true) } })
    return () => { active = false }
  }, [known])
  useEffect(() => { document.title = `${TITLES[known]} · Kulhivaru+` }, [known])
  const body = page ? (language === 'dv' && page.bodyDv ? page.bodyDv : page.body) : null
  // Version label and effective date (Platform admin → Configuration → Legal versions).
  useAppConfig()
  const version = legalVersion(known)
  return <article className="ed-page lp-info">
    <a className="back-link public-back" href="#home"><ArrowLeft size={14} /> Back to Kulhivaru+</a>
    <header className="ed-page-head"><p className="ed-eyebrow">{OWNER_WRITTEN.includes(known) || known === 'terms' ? 'Legal' : 'Help'}</p><h1>{page?.title ?? TITLES[known]}</h1>{version ? <p className="lp-legal-version">Version {version.version}{version.effective ? ` · effective ${new Date(`${version.effective}T00:00:00+05:00`).toLocaleDateString('en-GB', { timeZone: 'Indian/Maldives', day: 'numeric', month: 'long', year: 'numeric' })}` : ''}</p> : null}{page?.updatedAt && <p>Last updated {new Date(page.updatedAt).toLocaleDateString('en-GB', { timeZone: 'Indian/Maldives', day: 'numeric', month: 'long', year: 'numeric' })}</p>}</header>
    {!loaded ? <div className="loading-state">Loading…</div>
      : body ? <div className="lp-info-body" dir={language === 'dv' && page?.bodyDv ? 'rtl' : undefined}>{body.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        : BUILT_IN[known] ? <div className="lp-info-body">{BUILT_IN[known]}</div>
          : <p className="lp-empty"><FileText size={16} /> The {TITLES[known]} page has not been published yet. The platform owner publishes it from Platform admin.</p>}
    <nav className="lp-info-nav" aria-label="Help and legal pages">{INFO_TOPICS.map(item => <a key={item} href={`#info/${item}`} aria-current={item === known ? 'page' : undefined}>{TITLES[item]}</a>)}</nav>
  </article>
}
