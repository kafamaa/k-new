import type { OfficialTotals, RatingResult } from './playerRating'

// The Digital Player Card: a neon shield drawn with the Canvas API (no extra
// library). The same function draws the on-screen preview and the exported
// PNG, so what the player sees is exactly what is downloaded. Only approved
// public fields are passed in; there is no field for identity data.

export const CARD_STYLES = ['classic', 'ocean', 'gold', 'night'] as const
export type CardStyle = (typeof CARD_STYLES)[number]
export const CARD_STYLE_LABELS: Record<CardStyle, string> = { classic: 'Classic', ocean: 'Ocean', gold: 'Gold', night: 'Night' }

const PALETTES: Record<CardStyle, { top: string; bottom: string; accent: string; glow: string; text: string; muted: string }> = {
  classic: { top: '#0b2f6b', bottom: '#030d24', accent: '#19e3ff', glow: 'rgba(25, 227, 255, .75)', text: '#ffffff', muted: '#a9e9f5' },
  ocean: { top: '#0b5a7a', bottom: '#02202f', accent: '#5ff5df', glow: 'rgba(95, 245, 223, .7)', text: '#ffffff', muted: '#c4f6ee' },
  gold: { top: '#2c2412', bottom: '#0c0905', accent: '#ffc53d', glow: 'rgba(255, 197, 61, .7)', text: '#fff8e6', muted: '#ecd59a' },
  night: { top: '#24195a', bottom: '#07051a', accent: '#b69bff', glow: 'rgba(182, 155, 255, .7)', text: '#ffffff', muted: '#d8ccff' },
}

export function isCardStyle(value: unknown): value is CardStyle {
  return typeof value === 'string' && (CARD_STYLES as readonly string[]).includes(value)
}

export type CardData = {
  style: CardStyle; name: string; code: string | null
  teamName: string | null; teamLogoUrl: string | null; position: string | null; jersey: number | null
  foot: string | null; island: string | null; country: string
  photoUrl: string | null; photoY: number
  stats: Array<[string, string]>
  stars: number | null; ratingText: string
}
// Fields a card may carry. Anything else (IDs, dates of birth, contacts) has
// no place in the drawing at all.
export const CARD_FIELDS: Array<keyof CardData> = ['style', 'name', 'code', 'teamName', 'teamLogoUrl', 'position', 'jersey', 'foot', 'island', 'country', 'photoUrl', 'photoY', 'stats', 'stars', 'ratingText']

export const CARD_WIDTH = 1000
export const CARD_HEIGHT = 1600

const images = new Map<string, Promise<HTMLImageElement | null>>()
function loadImage(url: string): Promise<HTMLImageElement | null> {
  // Cached for the session so re-drawing never re-requests the photo.
  if (!images.has(url)) images.set(url, new Promise(resolve => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  }))
  return images.get(url)!
}

function shieldPath(context: CanvasRenderingContext2D, inset: number) {
  const w = CARD_WIDTH; const h = CARD_HEIGHT; const cut = 90
  context.beginPath()
  context.moveTo(inset + cut, inset)
  context.lineTo(w - inset - cut, inset)
  context.lineTo(w - inset, inset + cut)
  context.lineTo(w - inset, h - 360)
  context.quadraticCurveTo(w - inset, h - 210, w / 2 + 120, h - 120 - inset / 2)
  context.lineTo(w / 2, h - 50 - inset)
  context.lineTo(w / 2 - 120, h - 120 - inset / 2)
  context.quadraticCurveTo(inset, h - 210, inset, h - 360)
  context.lineTo(inset, inset + cut)
  context.closePath()
}

// Shrinks the font until the text fits, so long names are never clipped.
function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number, weight: string, size: number, family: string, min = 28): number {
  let current = size
  context.font = `${weight} ${current}px ${family}`
  while (context.measureText(text).width > maxWidth && current > min) { current -= 2; context.font = `${weight} ${current}px ${family}` }
  return current
}

function maldivesFlag(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  context.fillStyle = '#d21034'; context.fillRect(x, y, w, h)
  context.fillStyle = '#007e3a'; context.fillRect(x + w * .25, y + h * .25, w * .5, h * .5)
  context.fillStyle = '#ffffff'; context.beginPath(); context.arc(x + w * .52, y + h / 2, h * .17, 0, Math.PI * 2); context.fill()
  context.fillStyle = '#007e3a'; context.beginPath(); context.arc(x + w * .56, y + h / 2, h * .15, 0, Math.PI * 2); context.fill()
}

function silhouette(context: CanvasRenderingContext2D, cx: number, top: number, size: number, color: string) {
  context.fillStyle = color
  context.beginPath(); context.arc(cx, top + size * .32, size * .2, 0, Math.PI * 2); context.fill()
  context.beginPath(); context.ellipse(cx, top + size * .95, size * .42, size * .36, 0, Math.PI, 0); context.fill()
}

export async function drawCard(canvas: HTMLCanvasElement, data: CardData): Promise<void> {
  canvas.width = CARD_WIDTH; canvas.height = CARD_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) return
  // Wait for the brand fonts so export and preview use the same lettering.
  try { await document.fonts?.ready } catch { /* system fonts */ }
  const [photo, logo] = await Promise.all([data.photoUrl ? loadImage(data.photoUrl) : null, data.teamLogoUrl ? loadImage(data.teamLogoUrl) : null])
  const palette = PALETTES[data.style]
  const w = CARD_WIDTH; const display = '"Space Grotesk", "Segoe UI", sans-serif'; const body = '"Plus Jakarta Sans", "Segoe UI", sans-serif'
  context.clearRect(0, 0, w, CARD_HEIGHT) // transparent outside the shield

  // Shield body.
  context.save(); shieldPath(context, 30)
  const fill = context.createLinearGradient(0, 0, 0, CARD_HEIGHT); fill.addColorStop(0, palette.top); fill.addColorStop(1, palette.bottom)
  context.fillStyle = fill; context.fill(); context.clip()
  // Angular broadcast graphics and the large, faint brand mark.
  context.globalAlpha = .1; context.fillStyle = palette.accent
  for (let i = 0; i < 6; i += 1) { context.beginPath(); context.moveTo(-200 + i * 260, 0); context.lineTo(-60 + i * 260, 0); context.lineTo(-460 + i * 260, CARD_HEIGHT); context.lineTo(-600 + i * 260, CARD_HEIGHT); context.fill() }
  context.globalAlpha = .07; context.fillStyle = '#ffffff'; context.font = `700 520px ${display}`; context.textAlign = 'center'; context.fillText('K+', w / 2, 760)
  context.globalAlpha = 1
  // Photo with a cyan rim light; a silhouette when there is no photo.
  const px = 200; const py = 170; const pw = 600; const ph = 640
  const glow = context.createRadialGradient(w / 2, py + ph * .55, 60, w / 2, py + ph * .55, 420); glow.addColorStop(0, palette.glow); glow.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = glow; context.fillRect(0, py - 60, w, ph + 120)
  const framePath = () => { context.beginPath(); context.moveTo(px + 60, py); context.lineTo(px + pw - 60, py); context.lineTo(px + pw, py + 60); context.lineTo(px + pw, py + ph); context.lineTo(px, py + ph); context.lineTo(px, py + 60); context.closePath() }
  context.save(); framePath(); context.clip()
  if (photo) {
    const scale = Math.max(pw / photo.width, ph / photo.height)
    const dw = photo.width * scale; const dh = photo.height * scale
    const offsetY = (ph - dh) * (Math.min(100, Math.max(0, data.photoY)) / 100)
    context.drawImage(photo, px + (pw - dw) / 2, py + offsetY, dw, dh)
  } else silhouette(context, w / 2, py + 60, 520, 'rgba(255,255,255,.18)')
  const fade = context.createLinearGradient(0, py + ph * .55, 0, py + ph); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, palette.bottom)
  context.fillStyle = fade; context.fillRect(px, py, pw, ph)
  context.restore()
  context.strokeStyle = palette.accent; context.lineWidth = 4; context.shadowColor = palette.glow; context.shadowBlur = 30
  framePath(); context.stroke()
  context.shadowBlur = 0
  context.restore()

  // Neon frame.
  context.save(); shieldPath(context, 30); context.lineWidth = 10; context.strokeStyle = palette.accent; context.shadowColor = palette.glow; context.shadowBlur = 50; context.stroke(); context.restore()
  context.save(); shieldPath(context, 52); context.lineWidth = 2; context.strokeStyle = 'rgba(255,255,255,.25)'; context.stroke(); context.restore()

  // Brand and public code.
  context.textAlign = 'left'; context.fillStyle = palette.text; context.font = `700 44px ${display}`
  context.fillText('KULHIVARU', 150, 130); context.fillStyle = palette.accent; context.fillText('+', 150 + context.measureText('KULHIVARU').width + 2, 130)
  if (data.code) { context.textAlign = 'right'; context.fillStyle = palette.muted; context.font = `700 28px ${body}`; context.fillText(data.code, w - 150, 128) }

  // Name.
  context.textAlign = 'center'; context.fillStyle = palette.text
  fitText(context, data.name.toUpperCase(), 760, '700', 78, display)
  context.shadowColor = palette.glow; context.shadowBlur = 18; context.fillText(data.name.toUpperCase(), w / 2, 880); context.shadowBlur = 0

  // Glass information panel.
  const gx = 140; const gy = 915; const gw = 720; const gh = 420
  context.save(); context.fillStyle = 'rgba(255,255,255,.08)'; context.strokeStyle = 'rgba(255,255,255,.18)'; context.lineWidth = 2
  context.beginPath(); context.roundRect?.(gx, gy, gw, gh, 26); if (!context.roundRect) context.rect(gx, gy, gw, gh); context.fill(); context.stroke(); context.restore()
  const rows: Array<{ label: string; draw?: (x: number, y: number) => void }> = []
  if (data.teamName) rows.push({ label: [data.teamName, [data.position, data.jersey !== null ? `#${data.jersey}` : null].filter(Boolean).join(' • ')].filter(Boolean).join('   ·   '), draw: logo ? (x, y) => context.drawImage(logo, x, y - 34, 44, 44) : undefined })
  else if (data.position || data.jersey !== null) rows.push({ label: [data.position, data.jersey !== null ? `#${data.jersey}` : null].filter(Boolean).join(' • ') })
  if (data.foot) rows.push({ label: data.foot })
  if (data.island) rows.push({ label: data.island })
  rows.push({ label: data.country, draw: data.country === 'Maldives' ? (x, y) => maldivesFlag(context, x, y - 30, 48, 32) : undefined })
  context.textAlign = 'left'
  rows.slice(0, 4).forEach((row, index) => {
    const y = gy + 62 + index * 62
    if (row.draw) row.draw(gx + 36, y)
    context.fillStyle = palette.text; fitText(context, row.label, gw - 140, '600', 32, body, 22)
    context.fillText(row.label, gx + (row.draw ? 100 : 40), y)
    if (index < 3) { context.fillStyle = 'rgba(255,255,255,.1)'; context.fillRect(gx + 30, y + 22, gw - 60, 2) }
  })

  // Statistics and rating.
  context.textAlign = 'center'
  const columnWidth = gw / data.stats.length
  data.stats.forEach(([value, label], index) => {
    const cx = gx + columnWidth * index + columnWidth / 2
    context.fillStyle = palette.text; context.font = `700 62px ${display}`; context.fillText(value, cx, 1400)
    context.fillStyle = palette.muted; context.font = `700 22px ${body}`; context.fillText(label.toUpperCase(), cx, 1434)
  })
  if (data.stars !== null) {
    context.font = `700 40px ${body}`; context.fillStyle = palette.accent
    context.fillText('★'.repeat(data.stars) + '☆'.repeat(5 - data.stars), w / 2, 1486)
  }
  context.fillStyle = palette.muted; context.font = `600 24px ${body}`; context.fillText(data.ratingText, w / 2, data.stars !== null ? 1520 : 1490)
}

export async function renderCardImage(data: CardData): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  await drawCard(canvas, data)
  return new Promise(resolve => {
    try { canvas.toBlob(blob => resolve(blob), 'image/png') } catch { resolve(null) }
  })
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = fileName
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export type CardStatVariant = 'attack' | 'discipline'
export type CardChoices = { style: CardStyle; teamId: string | null; photoY: number; statVariant: CardStatVariant }

const HAND_SPORTS = ['handball', 'basketball', 'basketball_3x3', 'volleyball']
export function preferredSideLabel(side: unknown, sport: unknown): string | null {
  const limb = HAND_SPORTS.includes(String(sport ?? '')) ? 'hand' : 'foot'
  if (side === 'left') return `Left ${limb}`
  if (side === 'right') return `Right ${limb}`
  if (side === 'both') return limb === 'foot' ? 'Both feet' : 'Both hands'
  return null
}

// Builds the card's data from approved profile fields and confirmed
// statistics only. Missing pieces are left out, never invented: no team, no
// jersey number, no photo and too few matches each have a defined look.
export function cardDataFor(input: { profile: Record<string, unknown>; teamName: string | null; teamLogo: string | null; totals: OfficialTotals; rating: RatingResult; style: CardStyle; photoY: number; statVariant: CardStatVariant }): CardData {
  const { profile, totals, rating } = input
  const sport = Array.isArray(profile.sports) ? profile.sports[0] : null
  const stats: Array<[string, string]> = input.statVariant === 'discipline'
    ? [[String(totals.appearances), 'Matches'], [String(totals.yellow), 'Yellow'], [String(totals.red), 'Red']]
    : [[String(totals.appearances), 'Matches'], [String(totals.goals), 'Goals'], [String(totals.assists), 'Assists']]
  return {
    style: input.style,
    name: String(profile.display_name ?? 'Player'),
    code: typeof profile.public_code === 'string' && profile.public_code ? profile.public_code : null,
    teamName: input.teamName, teamLogoUrl: input.teamLogo,
    position: typeof profile.position === 'string' && profile.position ? profile.position : null,
    jersey: typeof profile.jersey_number === 'number' ? profile.jersey_number : null,
    foot: preferredSideLabel(profile.preferred_side, sport),
    island: typeof profile.island === 'string' && profile.island ? profile.island : null,
    country: typeof profile.nationality === 'string' && profile.nationality ? profile.nationality : 'Maldives',
    photoUrl: typeof profile.photo_url === 'string' && profile.photo_url ? profile.photo_url : null,
    photoY: input.photoY, stats,
    stars: rating.status === 'rated' ? rating.stars : null,
    ratingText: rating.status === 'rated' ? `Rating ${rating.value.toFixed(1)}` : 'Rating unavailable',
  }
}
