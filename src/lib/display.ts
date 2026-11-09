// Small display helpers shared by the editorial components.

export function monogram(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(word => word[0] ?? '').join('').toUpperCase() || '?'
}

export const SPORT_NAMES: Record<string, string> = { football: 'Football', futsal: 'Futsal', handball: 'Handball', volleyball: 'Volleyball', basketball: 'Basketball', basketball_3x3: '3x3 Basketball' }

export function sportName(value: unknown): string {
  const key = String(value ?? '')
  return SPORT_NAMES[key] ?? (key ? key.replace(/_/g, ' ') : 'Sport')
}

export function sportClass(value: unknown): string {
  return `sport-${String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'island'}`
}

// Maldives time (UTC+5), date only.
export function formatDay(value: unknown): string | null {
  if (!value) return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-GB', { timeZone: 'Indian/Maldives', day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatClock(value: unknown): string | null {
  if (!value) return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString('en-GB', { timeZone: 'Indian/Maldives', hour: '2-digit', minute: '2-digit' })
}

// The readable result state of a match. Guests only ever see confirmed
// fixtures, but the workspace match views use the same wording.
export function resultState(status: unknown): { label: string; tone: 'live' | 'provisional' | 'official' | 'plain' } {
  const value = String(status ?? '')
  if (value === 'live') return { label: 'Live', tone: 'live' }
  if (value === 'awaiting_confirmation') return { label: 'Provisional · awaiting confirmation', tone: 'provisional' }
  if (value === 'confirmed') return { label: 'Official result', tone: 'official' }
  if (value === 'postponed') return { label: 'Postponed', tone: 'plain' }
  if (value === 'abandoned') return { label: 'Abandoned', tone: 'plain' }
  if (value === 'cancelled') return { label: 'Cancelled', tone: 'plain' }
  return { label: 'Scheduled', tone: 'plain' }
}
