import { useState } from 'react'
import { ArrowLeft, Check, Info, Lock, Pencil, Trophy, Users } from 'lucide-react'
import { validateRosterLines, type RosterLine } from '../lib/teamHub'
import { PersonAvatar, TeamLogo } from './HomeArt'

// Edits the current roster selection, not the player's identity or a submitted
// version. The existing roster submission remains the only persistence action.
export function RosterPlayerEditor({ line, otherLines, teamName, teamLogo, tournamentName, code, photo, onApply, onBack }: {
  line: RosterLine; otherLines: RosterLine[]; teamName: string; teamLogo: string | null; tournamentName: string
  code?: string | null; photo?: string | null; onApply: (line: RosterLine) => void; onBack: () => void
}) {
  const [draft, setDraft] = useState(line)
  const checked = [...otherLines.map(other => draft.isCaptain ? { ...other, isCaptain: false } : other), draft]
  const problems = validateRosterLines(checked, { min: null, max: null })
  return <div className="sq-page sq-flow roster-player-editor">
    <button type="button" className="back-link" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Back to roster</button>
    <header><h1 className="sq-flow-title">Edit roster player</h1><p className="sq-lede">Update {line.name}’s tournament roster details.</p></header>
    <div className="sq-two"><div className="sq-col">
      <section className="sq-card sq-card-row"><span className="sq-avatar">{photo ? <img src={photo} alt="" /> : <PersonAvatar />}</span><div><strong className="roster-player-name">{line.name}</strong>{code ? <p className="sq-muted">{code}</p> : null}</div><span className="sq-pill tone-info">Selected for roster</span></section>
      <section className="sq-card"><h2 className="sq-card-title"><Pencil size={22} aria-hidden="true" /> Playing details</h2><div className="sq-fields"><label>Shirt number<input inputMode="numeric" maxLength={2} value={draft.shirtNumber} onChange={event => setDraft({ ...draft, shirtNumber: event.target.value.replace(/\D/g, '') })} /></label><label>Playing position<input maxLength={40} value={draft.position} onChange={event => setDraft({ ...draft, position: event.target.value })} /></label></div><label className="sq-toggle"><input type="checkbox" role="switch" checked={draft.isCaptain} onChange={event => setDraft({ ...draft, isCaptain: event.target.checked })} /><span><strong>Team captain</strong><small>Only one player can be captain in this roster.</small></span></label><label className="sq-toggle"><input type="checkbox" role="switch" checked={draft.isGoalkeeper} onChange={event => setDraft({ ...draft, isGoalkeeper: event.target.checked })} /><span><strong>Goalkeeper</strong><small>Mark this player’s role for the tournament.</small></span></label></section>
      <section className="sq-card"><h2 className="sq-card-title"><Lock size={22} aria-hidden="true" /> Player record</h2><p>Name, identity verification and career records are maintained through the player record and authorized correction requests.</p><p className="sq-note"><Info size={18} aria-hidden="true" /> Editing roster details does not change the player’s team membership or earlier submissions.</p></section>
    </div><aside className="sq-col"><section className="sq-card"><h2 className="sq-card-title"><Trophy size={22} aria-hidden="true" /> Tournament</h2><strong className="org-player-team-name">{tournamentName}</strong><div className="pp-membership"><TeamLogo name={teamName} logoUrl={teamLogo} size={54} /><strong>{teamName}</strong></div></section><section className="sq-card"><h2 className="sq-card-title"><Users size={22} aria-hidden="true" /> Before applying</h2><ul className="payment-proof-help"><li><Check size={17} aria-hidden="true" /> Check the shirt number is unique.</li><li><Check size={17} aria-hidden="true" /> Confirm position and captaincy.</li><li><Check size={17} aria-hidden="true" /> Submit the complete roster after editing.</li></ul></section></aside></div>
    {problems.length ? <div className="form-error" role="alert">{problems.join(' ')}</div> : null}
    <div className="sq-footbar"><p className="sq-muted"><Info size={18} aria-hidden="true" /> Changes are included when you submit the roster.</p><span className="sq-foot-actions"><button type="button" className="ed-btn ed-btn-ghost" onClick={onBack}>Cancel</button><button type="button" className="ed-btn ed-btn-primary" disabled={problems.length > 0} onClick={() => onApply(draft)}>Apply to roster <Check size={17} aria-hidden="true" /></button></span></div>
  </div>
}
