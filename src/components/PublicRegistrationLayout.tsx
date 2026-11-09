import type { ReactNode } from 'react'
import { ArrowLeft, CalendarDays, Info, Lock, ShieldCheck, Trophy, Users } from 'lucide-react'
import type { PublicRegistrationInfo } from '../lib/publicData'
import { formatMaldivesDateTime, PUBLIC_REGISTRATION_STATE_LABELS } from '../lib/publicData'
import { sportName } from '../lib/display'
import { publicTournamentBranding } from '../lib/tournamentBranding'
import { publicSupabase } from '../lib/supabase'
import { TournamentCover, TournamentLogo } from './TournamentBranding'

// A dedicated registration page. The form and all its authorization/submission
// handlers stay in PublicApplicationForm; this component only composes the page.
export function PublicRegistrationLayout({ tournament, registration, children }: {
  tournament: Record<string, unknown>; registration: PublicRegistrationInfo; children: ReactNode
}) {
  const name = String(tournament.name ?? 'Tournament')
  const href = `#tournament/${encodeURIComponent(String(tournament.slug ?? tournament.id))}`
  const branding = publicTournamentBranding(tournament)
  return <section className="ed-page public-registration-page">
    <nav className="registration-breadcrumb" aria-label="Breadcrumb"><a href="#tournaments">Tournaments</a><span aria-hidden="true">/</span><a href={href}>{name}</a><span aria-hidden="true">/</span><strong>Team registration</strong></nav>
    <header className="registration-hero">
      <TournamentCover client={publicSupabase} path={branding.coverPath} name={name} sport={String(tournament.sport ?? '')} />
      <div className="registration-hero-content"><TournamentLogo client={publicSupabase} path={branding.logoPath} name={name} className="registration-logo" fallback={<Trophy size={36} />} /><div><p>Team registration</p><h1>{name}</h1><span>{sportName(tournament.sport)} · {PUBLIC_REGISTRATION_STATE_LABELS[registration.state]}</span></div></div>
    </header>
    <div className="registration-layout">
      <div className="registration-main"><section className="ed-panel registration-form-panel">{registration.state === 'open' ? children : <><h2>{PUBLIC_REGISTRATION_STATE_LABELS[registration.state]}</h2><p>Applications can be submitted only while registration is open.</p><a className="ed-btn ed-btn-ghost" href={href}>View tournament</a></>}</section><a className="back-link" href={href}><ArrowLeft size={16} /> Back to tournament</a></div>
      <aside className="registration-sidebar">
        <section className="ed-panel"><h2><Trophy size={22} aria-hidden="true" /> Tournament summary</h2><dl className="registration-facts">
          <div><dt>Sport</dt><dd>{sportName(tournament.sport)}</dd></div>
          {registration.categories.length ? <div><dt>Categories</dt><dd>{registration.categories.map(category => category.name).join(', ')}</dd></div> : null}
          {registration.closesAt ? <div><dt><CalendarDays size={15} /> Registration closes</dt><dd>{formatMaldivesDateTime(registration.closesAt)}</dd></div> : null}
          {registration.rosterMin !== null ? <div><dt><Users size={15} /> Roster size</dt><dd>{registration.rosterMin}{registration.rosterMax !== null ? `–${registration.rosterMax}` : '+'} players</dd></div> : null}
          {registration.rosterDeadline ? <div><dt>Roster deadline</dt><dd>{formatMaldivesDateTime(registration.rosterDeadline)}</dd></div> : null}
        </dl><a className="ed-btn ed-btn-ghost" href={`${href}?tab=rules`}>View rules & requirements</a></section>
        <section className="ed-panel"><h2><ShieldCheck size={22} aria-hidden="true" /> Before you submit</h2><ul className="registration-checklist"><li>Choose a team you are authorized to manage.</li><li>Check your details before submitting.</li><li>The organizer reviews your application.</li><li>Track payment and roster requests in your Team Workspace.</li></ul></section>
        {registration.entryRequirements ? <section className="ed-panel"><h2><Info size={22} aria-hidden="true" /> Entry requirements</h2><p>{registration.entryRequirements}</p></section> : null}
        {registration.contactInstructions ? <section className="ed-panel"><h2>Need help?</h2><p>{registration.contactInstructions}</p></section> : null}
        <p className="registration-private"><Lock size={16} aria-hidden="true" /> Your application and supporting documents are private. They are reviewed by authorized organizers.</p>
      </aside>
    </div>
  </section>
}
