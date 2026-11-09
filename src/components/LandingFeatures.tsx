import { ArrowRight, BarChart3, Bell, CalendarDays, CheckCircle2, Clock3, FileBarChart, GitBranch, Image as ImageIcon, Megaphone, Medal, Share2, ShieldCheck, Smartphone, Trophy, UserRound, Users } from 'lucide-react'
import { publicSupabase } from '../lib/supabase'
import { publicTournamentBranding } from '../lib/tournamentBranding'
import type { PublicRecord } from '../lib/publicData'
import { TournamentCover, TournamentLogo } from './TournamentBranding'

// ---------------------------------------------------------------------------
// Landing sections that explain the product. Original Kulhivaru+ wording and
// drawings. Nothing here invents a team, a player or a score: the app preview
// shows a real published tournament when one exists, and otherwise neutral
// placeholder bars standing in for the real screen's content.
// ---------------------------------------------------------------------------

const STEPS = ['Create', 'Teams', 'Schedule', 'Play', 'Finish']

// The tournament screen as organizers see it, drawn in miniature.
export function AppPreview({ spotlight }: { spotlight: PublicRecord | null }) {
  const name = spotlight ? String(spotlight.name ?? '') : ''
  const branding = spotlight ? publicTournamentBranding(spotlight) : null
  return <figure className="lp-app-preview" aria-label="Preview of the Kulhivaru+ tournament screen">
    <div className="lp-app-frame">
      <div className="lp-app-cover">{spotlight && branding ? <TournamentCover client={publicSupabase} path={branding.coverPath} name={name} sport={String(spotlight.sport ?? 'football')} /> : null}</div>
      <div className="lp-app-head">
        <span className="lp-app-logo">{spotlight && branding ? <TournamentLogo client={publicSupabase} path={branding.logoPath} name={name} className="lp-app-logo-img" /> : <Trophy size={16} aria-hidden="true" />}</span>
        <span className="lp-app-title">{name ? <strong>{name}</strong> : <i className="lp-bar w60" />}<i className="lp-bar w30 thin" /></span>
      </div>
      <ol className="lp-app-steps">{STEPS.map((step, index) => <li key={step} className={index < 3 ? 'done' : index === 3 ? 'now' : ''}><span>{index < 3 ? <CheckCircle2 size={11} aria-hidden="true" /> : index + 1}</span>{step}</li>)}</ol>
      <div className="lp-app-next"><small>Next match</small><i className="lp-bar w70 light" /><i className="lp-bar w40 thin light" /><span className="lp-app-btn">Open Match</span></div>
      <div className="lp-app-table" aria-hidden="true">{[0, 1, 2, 3].map(row => <div key={row}><b>{row + 1}</b><i className="lp-bar w50" /><i className="lp-bar w10" /></div>)}</div>
    </div>
    <figcaption>{name ? <>A live tournament page: <a href={`#tournament/${encodeURIComponent(String(spotlight?.slug ?? spotlight?.id ?? ''))}`}>{name}</a></> : 'The tournament screen: one next step, the schedule and the table.'}</figcaption>
  </figure>
}

const FORMATS = [
  { label: 'League', text: 'Every team plays every other team.' },
  { label: 'Groups', text: 'Teams split into groups with their own tables.' },
  { label: 'Knockout', text: 'Winners go through until the final.' },
  { label: 'Groups + knockout', text: 'Group winners move on to a bracket.' },
]

export function FixtureGeneratorSection({ onCreateTournament }: { onCreateTournament: () => void }) {
  return <section className="lp-section lp-feature" id="fixtures" aria-labelledby="fixtures-title">
    <div className="lp-feature-copy">
      <p className="ed-eyebrow"><GitBranch size={14} aria-hidden="true" /> Automatic fixtures</p>
      <h2 id="fixtures-title">From a team list to a full calendar</h2>
      <p>Add your teams and Kulhivaru+ suggests the best format for the number of teams. One click makes the groups, every match and the calendar, keeping teams rested and venues free of clashes. You can still move any match.</p>
      <ul className="lp-format-list">{FORMATS.map(format => <li key={format.label}><strong>{format.label}</strong><span>{format.text}</span></li>)}</ul>
      <button type="button" className="ed-btn ed-btn-primary" onClick={onCreateTournament}>Create Tournament <ArrowRight size={16} /></button>
    </div>
    <div className="lp-feature-art" aria-hidden="true">
      <div className="lp-art-flow"><span><Users size={18} /> Teams</span><ArrowRight size={16} /><span><GitBranch size={18} /> Format</span><ArrowRight size={16} /><span><CalendarDays size={18} /> Calendar</span></div>
      <div className="lp-art-bracket">{[0, 1, 2, 3].map(index => <i key={index} />)}<b /><b /><em /></div>
    </div>
  </section>
}

export function SectionIntro({ id, eyebrow, icon: Icon, title, text }: { id: string; eyebrow: string; icon: typeof Trophy; title: string; text: string }) {
  return <header className="lp-section lp-intro" id={id}><p className="ed-eyebrow"><Icon size={14} aria-hidden="true" /> {eyebrow}</p><h2>{title}</h2><p>{text}</p></header>
}

const ORGANIZER_BENEFITS = [
  { icon: Clock3, title: 'Ready in minutes', text: 'Name and sport are enough to start. Everything else can wait.' },
  { icon: Share2, title: 'Registration link', text: 'Share one link and teams apply themselves, or add teams yourself.' },
  { icon: CalendarDays, title: 'Fixtures made for you', text: 'Formats, groups, the draw and the calendar from your team list.' },
  { icon: Smartphone, title: 'Score from your phone', text: 'Big buttons for the score, scorers and cards. The score stays on your phone until you submit it.' },
  { icon: ShieldCheck, title: 'Staff and moderators', text: 'Give officials and helpers only the access they need.' },
  { icon: FileBarChart, title: 'Reports and archive', text: 'Exports, an audit trail and a permanent public archive.' },
]

export function OrganizerBenefits({ onCreateTournament }: { onCreateTournament: () => void }) {
  return <section className="lp-section lp-benefits" id="organize" aria-labelledby="organize-title">
    <header className="ed-section-head"><h2 id="organize-title">For organizers</h2></header>
    <ul className="lp-benefit-grid">{ORGANIZER_BENEFITS.map(item => <li key={item.title}><item.icon size={22} aria-hidden="true" /><strong>{item.title}</strong><span>{item.text}</span></li>)}</ul>
    <button type="button" className="ed-btn ed-btn-primary" onClick={onCreateTournament}>Start Organizing <ArrowRight size={16} /></button>
  </section>
}

const FAN_BENEFITS = [
  { icon: UserRound, title: 'One career for life', text: 'Every confirmed match adds to your permanent player record, across teams and seasons.', href: '#info/claim-profile', action: 'Claim your profile' },
  { icon: Medal, title: 'Statistics that are checked', text: 'Goals, assists and cards count only after the organizer confirms the result.', href: '#players', action: 'Find a player' },
  { icon: Bell, title: 'Follow teams and tournaments', text: 'Live scores, results and tables for the teams you follow.', href: '#matches', action: 'See matches' },
  { icon: Users, title: 'Team managers', text: 'Apply to tournaments, send squads and follow every result.', href: '#workspace', action: 'Set up your team' },
]

export function FanBenefits() {
  return <section className="lp-section lp-benefits lp-fans" id="players-fans" aria-labelledby="fans-title">
    <header className="ed-section-head"><h2 id="fans-title">For players, teams and fans</h2></header>
    <ul className="lp-benefit-grid">{FAN_BENEFITS.map(item => <li key={item.title}><item.icon size={22} aria-hidden="true" /><strong>{item.title}</strong><span>{item.text}</span><a className="ed-link" href={item.href}>{item.action} <ArrowRight size={14} /></a></li>)}</ul>
  </section>
}

export function MediaAndSponsors() {
  return <section className="lp-section lp-media" id="media" aria-labelledby="media-title">
    <header className="ed-section-head"><h2 id="media-title">News, photos and sponsors</h2></header>
    <ul className="lp-benefit-grid compact">
      <li><Megaphone size={22} aria-hidden="true" /><strong>News and announcements</strong><span>Match reports and notices on the tournament page.</span></li>
      <li><ImageIcon size={22} aria-hidden="true" /><strong>Photos and videos</strong><span>Galleries and highlights next to the results.</span></li>
      <li><Trophy size={22} aria-hidden="true" /><strong>Sponsors</strong><span>Sponsor logos and links shown on the tournament page.</span></li>
      <li><BarChart3 size={22} aria-hidden="true" /><strong>Shareable results</strong><span>Result and player cards ready to post on social media.</span></li>
    </ul>
  </section>
}

export function FinalCallToAction({ onCreateTournament }: { onCreateTournament: () => void }) {
  return <section className="lp-section lp-final-cta" aria-labelledby="final-cta-title">
    <h2 id="final-cta-title">Your competition. Your community.</h2>
    <p>Bring your island together through sport.</p>
    <div className="lp-hero-actions"><button type="button" className="ed-btn ed-btn-primary ed-btn-lg" onClick={onCreateTournament}><Trophy size={18} aria-hidden="true" /> Create a Tournament</button></div>
  </section>
}
