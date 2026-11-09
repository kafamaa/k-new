// Shareable result image for social media: a square card drawn with the Canvas
// API in Kulhivaru+ colours. Only a confirmed result can be drawn, and only
// public fields go in: tournament, team names, score, date and venue.

export type ResultCardData = { tournament: string; home: string; away: string; homeScore: number; awayScore: number; when: string | null; venue: string | null; corrected: boolean }

export const RESULT_IMAGE_SIZE = 1080

// Long names shrink to fit their half of the card.
function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number, start: number, weight = 800): number {
  let size = start
  do { context.font = `${weight} ${size}px system-ui, -apple-system, Segoe UI, sans-serif`; size -= 2 } while (context.measureText(text).width > maxWidth && size > 18)
  return size + 2
}

export function drawResultCard(canvas: HTMLCanvasElement, data: ResultCardData): void {
  const size = RESULT_IMAGE_SIZE
  canvas.width = size; canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return
  const background = context.createLinearGradient(0, 0, size, size)
  background.addColorStop(0, '#061a2c'); background.addColorStop(1, '#0a3a52')
  context.fillStyle = background; context.fillRect(0, 0, size, size)
  // Lagoon glow and a thin island-red rule.
  const glow = context.createRadialGradient(size * .75, size * .2, 10, size * .75, size * .2, size * .6)
  glow.addColorStop(0, 'rgba(0, 194, 220, .35)'); glow.addColorStop(1, 'rgba(0, 194, 220, 0)')
  context.fillStyle = glow; context.fillRect(0, 0, size, size)
  context.fillStyle = '#d21034'; context.fillRect(80, 120, 90, 8)
  context.textAlign = 'left'; context.fillStyle = '#5fd8ea'
  context.font = '700 34px system-ui, -apple-system, Segoe UI, sans-serif'
  context.fillText('FULL TIME', 80, 190)
  context.fillStyle = '#ffffff'
  fitText(context, data.tournament, size - 160, 52, 700)
  context.fillText(data.tournament, 80, 250)
  // Score in the middle, team names either side.
  context.textAlign = 'center'
  context.font = '900 230px system-ui, -apple-system, Segoe UI, sans-serif'
  context.fillText(`${data.homeScore}`, size * .27, 620)
  context.fillText(`${data.awayScore}`, size * .73, 620)
  context.fillStyle = '#5fd8ea'; context.font = '700 90px system-ui, -apple-system, Segoe UI, sans-serif'
  context.fillText('–', size / 2, 590)
  context.fillStyle = '#ffffff'
  for (const [name, x] of [[data.home, size * .27], [data.away, size * .73]] as const) {
    fitText(context, name, size * .42, 54)
    context.fillText(name, x, 720)
  }
  context.fillStyle = 'rgba(255, 255, 255, .75)'; context.font = '500 34px system-ui, -apple-system, Segoe UI, sans-serif'
  const line = [data.when, data.venue].filter(Boolean).join(' · ')
  if (line) context.fillText(line, size / 2, 820)
  if (data.corrected) context.fillText('Result corrected after review', size / 2, 870)
  context.textAlign = 'left'; context.fillStyle = '#ffffff'; context.font = '800 40px system-ui, -apple-system, Segoe UI, sans-serif'
  context.fillText('KULHIVARU', 80, size - 90)
  const width = context.measureText('KULHIVARU').width
  context.fillStyle = '#00c2dc'; context.fillText('+', 80 + width + 4, size - 90)
  context.textAlign = 'right'; context.fillStyle = 'rgba(255, 255, 255, .6)'; context.font = '500 28px system-ui, -apple-system, Segoe UI, sans-serif'
  context.fillText('Confirmed official result', size - 80, size - 92)
}

export async function renderResultImage(data: ResultCardData): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  drawResultCard(canvas, data)
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'))
}

// Ranking graphic (owner, 2026-11-03): the top players for one statistic, from
// confirmed matches only. Public fields only: name, team and the count.
export type RankingCardData = { tournament: string; title: string; unit: string; rows: Array<{ name: string; team: string | null; value: number }> }

export function drawRankingCard(canvas: HTMLCanvasElement, data: RankingCardData): void {
  const size = RESULT_IMAGE_SIZE
  canvas.width = size; canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return
  const background = context.createLinearGradient(0, 0, size, size)
  background.addColorStop(0, '#061a2c'); background.addColorStop(1, '#0a3a52')
  context.fillStyle = background; context.fillRect(0, 0, size, size)
  context.fillStyle = '#d21034'; context.fillRect(80, 110, 90, 8)
  context.textAlign = 'left'; context.fillStyle = '#5fd8ea'; context.font = '700 34px system-ui, -apple-system, Segoe UI, sans-serif'
  context.fillText(data.title.toUpperCase(), 80, 180)
  context.fillStyle = '#ffffff'
  fitText(context, data.tournament, size - 160, 48, 700)
  context.fillText(data.tournament, 80, 238)
  data.rows.slice(0, 8).forEach((row, index) => {
    const y = 330 + index * 82
    context.fillStyle = index === 0 ? 'rgba(0, 194, 220, .22)' : 'rgba(255, 255, 255, .06)'
    context.fillRect(80, y - 52, size - 160, 70)
    context.textAlign = 'left'; context.fillStyle = '#5fd8ea'; context.font = '800 36px system-ui, -apple-system, Segoe UI, sans-serif'
    context.fillText(String(index + 1), 104, y)
    context.fillStyle = '#ffffff'
    const label = row.team ? `${row.name} · ${row.team}` : row.name
    fitText(context, label, size - 420, 34, 700)
    context.fillText(label, 170, y)
    context.textAlign = 'right'; context.font = '900 40px system-ui, -apple-system, Segoe UI, sans-serif'
    context.fillText(String(row.value), size - 104, y)
  })
  context.textAlign = 'left'; context.fillStyle = '#ffffff'; context.font = '800 40px system-ui, -apple-system, Segoe UI, sans-serif'
  context.fillText('KULHIVARU', 80, size - 90)
  const width = context.measureText('KULHIVARU').width
  context.fillStyle = '#00c2dc'; context.fillText('+', 80 + width + 4, size - 90)
  context.textAlign = 'right'; context.fillStyle = 'rgba(255, 255, 255, .6)'; context.font = '500 28px system-ui, -apple-system, Segoe UI, sans-serif'
  context.fillText(`${data.unit} from confirmed matches`, size - 80, size - 92)
}

export async function renderRankingImage(data: RankingCardData): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  drawRankingCard(canvas, data)
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'))
}
