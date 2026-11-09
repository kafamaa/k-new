import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Download, Printer, Share2, SlidersHorizontal } from 'lucide-react'
import type { OfficialTotals, RatingResult } from '../lib/playerRating'
import { RATING_METHOD_SUMMARY } from '../lib/playerRating'
import { CARD_STYLE_LABELS, CARD_STYLES, cardDataFor, downloadBlob, drawCard, isCardStyle, renderCardImage, type CardChoices, type CardStyle } from '../lib/cardImage'
import { safeFileName } from '../lib/playerHome'

export type { CardChoices } from '../lib/cardImage'

// The Digital Player Card: a live preview drawn by the same renderer as the
// download. Sharing and the public link need a published profile; a private
// player can still preview, download and print their own card.
export function PlayerCard({ profile, teamName, teamLogo = null, totals, rating, isPublished, onStyleChange, choices, teamOptions, onCustomize, onAction }: {
  profile: Record<string, unknown>
  teamName: string | null
  teamLogo?: string | null
  totals: OfficialTotals
  rating: RatingResult
  isPublished: boolean
  onStyleChange?: (style: CardStyle) => void
  choices?: CardChoices
  teamOptions?: Array<{ id: string; name: string }>
  onCustomize?: (choices: CardChoices) => void
  onAction?: (event: 'card_downloaded' | 'card_shared' | 'card_printed') => void
}) {
  const [message, setMessage] = useState('')
  const [rendering, setRendering] = useState(false)
  const [customizing, setCustomizing] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const style: CardStyle = choices?.style ?? (isCardStyle(profile.card_style) ? profile.card_style : 'classic')
  const data = useMemo(() => cardDataFor({ profile, teamName, teamLogo, totals, rating, style, photoY: choices?.photoY ?? 30, statVariant: choices?.statVariant ?? 'attack' }), [profile, teamName, teamLogo, totals, rating, style, choices?.photoY, choices?.statVariant])
  const slug = String(profile.slug ?? '')
  const publicUrl = `${window.location.origin}${window.location.pathname}#player/${encodeURIComponent(slug)}`
  const label = [data.name, data.code, data.teamName, data.position, data.jersey !== null ? `number ${data.jersey}` : null, data.foot, data.island, data.country, data.stats.map(([value, name]) => `${value} ${name}`).join(', '), data.ratingText].filter(Boolean).join(', ')

  useEffect(() => { if (canvasRef.current) void drawCard(canvasRef.current, data) }, [data])

  const copyPublicLink = async () => {
    if (!isPublished) return
    try { await navigator.clipboard.writeText(publicUrl); setMessage('Public link copied.') } catch { setMessage(`Your public link is: ${publicUrl}`) }
  }
  const share = async () => {
    if (!isPublished) return
    try {
      if (navigator.share) { await navigator.share({ title: `${data.name} · Kulhivaru+`, url: publicUrl }); onAction?.('card_shared') }
      else { await copyPublicLink(); onAction?.('card_shared') }
    } catch { /* share sheet dismissed */ }
  }
  const download = async () => {
    setRendering(true); setMessage('')
    const blob = await renderCardImage(data)
    setRendering(false)
    if (!blob) return setMessage('The image could not be created in this browser. Use Print / save PDF instead.')
    downloadBlob(blob, `${safeFileName(data.name)}-kulhivaru-card.png`)
    onAction?.('card_downloaded')
  }
  const print = () => { onAction?.('card_printed'); window.print() }
  const set = (patch: Partial<CardChoices>) => { const next = { style, teamId: choices?.teamId ?? null, photoY: choices?.photoY ?? 30, statVariant: choices?.statVariant ?? 'attack', ...patch }; if (patch.style) onStyleChange?.(patch.style); onCustomize?.(next) }

  return <div className="player-card-wrap">
    <div className="player-card-print pc-stage"><canvas ref={canvasRef} className="pc-canvas" width={1000} height={1600} role="img" aria-label={`Digital Player Card: ${label}`} /></div>
    <div className="player-card-actions">
      <button type="button" className="ed-btn ed-btn-primary" onClick={() => void download()} disabled={rendering}><Download size={15} /> {rendering ? 'Preparing…' : 'Download Card'}</button>
      <button type="button" className="ed-btn ed-btn-ghost" onClick={() => void share()} disabled={!isPublished} title={isPublished ? 'Share your public profile' : 'Publish your profile to share it'}><Share2 size={15} /> Share</button>
      {(onCustomize || onStyleChange) && <button type="button" className="ed-btn ed-btn-ghost" aria-expanded={customizing} onClick={() => setCustomizing(value => !value)}><SlidersHorizontal size={15} /> Customize</button>}
    </div>
    {customizing && <div className="pc-customize">
      <fieldset><legend>Card style</legend><div className="pw-segments" role="radiogroup" aria-label="Card style">{CARD_STYLES.map(option => <button type="button" role="radio" key={option} aria-checked={style === option} className={style === option ? 'active' : ''} onClick={() => set({ style: option })}><span className={`pc-swatch swatch-${option}`} aria-hidden="true" />{CARD_STYLE_LABELS[option]}</button>)}</div></fieldset>
      {onCustomize && teamOptions && teamOptions.length > 1 && <label className="pf-field">Team shown<select value={choices?.teamId ?? ''} onChange={event => set({ teamId: event.target.value || null })}><option value="">Current team</option>{teamOptions.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
      {onCustomize && data.photoUrl && <label className="pf-field">Photo position<input type="range" min={0} max={100} value={choices?.photoY ?? 30} onChange={event => set({ photoY: Number(event.target.value) })} aria-valuetext={`${choices?.photoY ?? 30}% from the top`} /></label>}
      {onCustomize && <fieldset><legend>Statistics shown</legend><div className="pw-segments" role="radiogroup" aria-label="Statistics shown">{(['attack', 'discipline'] as const).map(option => <button type="button" role="radio" key={option} aria-checked={(choices?.statVariant ?? 'attack') === option} className={(choices?.statVariant ?? 'attack') === option ? 'active' : ''} onClick={() => set({ statVariant: option })}>{option === 'attack' ? 'Goals and assists' : 'Cards'}</button>)}</div></fieldset>}
      <p className="pf-hint">Official numbers cannot be edited here. To change one, send a correction request.</p>
    </div>}
    <div className="pc-secondary">
      <button type="button" className="ed-link-btn" onClick={() => void copyPublicLink()} disabled={!isPublished}><Copy size={13} /> Copy public link</button>
      <button type="button" className="ed-link-btn" onClick={print}><Printer size={13} /> Print / save PDF</button>
    </div>
    {!isPublished && <p className="player-card-note">Your profile is private: you can preview, download and print your card, but sharing and the public link need a published profile.</p>}
    {message && <p className="publication-notice" role="status">{message}</p>}
    <details className="player-card-method"><summary>How the rating is calculated</summary><p>{RATING_METHOD_SUMMARY}</p></details>
  </div>
}
