import type { SupabaseClient } from '@supabase/supabase-js'

// Follows (migration 202611010037), calendar files and small public-page helpers.
// Follows are private to the person: nobody else can read who follows what.

export type FollowType = 'tournament' | 'team' | 'player' | 'organization'
export type FollowRow = { entity_type: FollowType; entity_id: string; label: string; slug: string | null; available: boolean; followed_at: string }

const missing = (message: string) => /PGRST20[25]|42P01|Could not find|does not exist|schema cache/.test(message)

export async function isFollowing(client: SupabaseClient, userId: string, type: FollowType, id: string): Promise<{ following: boolean; available: boolean }> {
  const result = await client.from('follows').select('entity_id').eq('user_id', userId).eq('entity_type', type).eq('entity_id', id).maybeSingle()
  if (result.error) return { following: false, available: !missing(result.error.message) }
  return { following: Boolean(result.data), available: true }
}
export async function setFollowing(client: SupabaseClient, userId: string, type: FollowType, id: string, follow: boolean): Promise<{ error: string | null }> {
  const result = follow
    ? await client.from('follows').insert({ user_id: userId, entity_type: type, entity_id: id })
    : await client.from('follows').delete().eq('user_id', userId).eq('entity_type', type).eq('entity_id', id)
  if (!result.error || /duplicate key|23505/.test(result.error.message)) return { error: null }
  if (missing(result.error.message)) return { error: 'Following needs migration 202611010037 to be applied.' }
  return { error: /row-level security|42501/.test(result.error.message) ? 'Only published records can be followed.' : 'This could not be saved. Please try again.' }
}
export async function loadMyFollows(client: SupabaseClient): Promise<{ data: FollowRow[]; error: string | null }> {
  const result = await client.rpc('my_follows')
  if (result.error) return { data: [], error: missing(result.error.message) ? 'Following needs migration 202611010037 to be applied.' : 'Your follows could not be loaded.' }
  return { data: (result.data ?? []) as FollowRow[], error: null }
}
export const followHref = (row: Pick<FollowRow, 'entity_type' | 'slug' | 'entity_id'>) => `#${row.entity_type}/${encodeURIComponent(row.slug ?? row.entity_id)}`
export const FOLLOW_LABELS: Record<FollowType, string> = { tournament: 'Tournament', team: 'Team', player: 'Player', organization: 'Organization' }

// --- Calendar (.ics) ------------------------------------------------------------------------------
export type CalendarEvent = { uid: string; title: string; start: string; end?: string | null; location?: string | null; description?: string | null; url?: string | null }
const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
// One calendar file for any number of events; events without a start time are skipped.
export function calendarFile(name: string, events: CalendarEvent[], now = new Date()): string | null {
  const dated = events.filter(event => event.start && !Number.isNaN(Date.parse(event.start)))
  if (!dated.length) return null
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kulhivaru+//Public calendar//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(name)}`, 'X-WR-TIMEZONE:Indian/Maldives']
  for (const event of dated) {
    const end = event.end && !Number.isNaN(Date.parse(event.end)) ? event.end : new Date(Date.parse(event.start) + 2 * 3600_000).toISOString()
    lines.push('BEGIN:VEVENT', `UID:${event.uid}@kulhivaru.plus`, `DTSTAMP:${icsDate(now.toISOString())}`, `DTSTART:${icsDate(event.start)}`, `DTEND:${icsDate(end)}`, `SUMMARY:${icsText(event.title)}`)
    if (event.location) lines.push(`LOCATION:${icsText(event.location)}`)
    if (event.description) lines.push(`DESCRIPTION:${icsText(event.description)}`)
    if (event.url) lines.push(`URL:${event.url}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}
export const safeFileName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'kulhivaru'
export const publicUrl = (hash: string) => `${window.location.origin}${window.location.pathname}${hash}`

// --- Small helpers ----------------------------------------------------------------------------------
// Reading time at 200 words per minute, at least one minute.
export const readingMinutes = (text: string) => Math.max(1, Math.round(text.trim().split(/\s+/).filter(Boolean).length / 200))
// Last five official results for a team, newest first: W, D or L. Only confirmed numeric scores count.
export function recentForm(teamId: string, matches: Array<Record<string, unknown>>, limit = 5): Array<'W' | 'D' | 'L'> {
  return matches
    .filter(match => match.status === 'confirmed' && (match.home_team_id === teamId || match.away_team_id === teamId) && typeof match.home_score === 'number' && typeof match.away_score === 'number')
    .sort((a, b) => Date.parse(String(b.scheduled_at ?? '')) - Date.parse(String(a.scheduled_at ?? '')))
    .slice(0, limit)
    .map(match => { const home = match.home_team_id === teamId; const mine = Number(home ? match.home_score : match.away_score); const theirs = Number(home ? match.away_score : match.home_score); return mine > theirs ? 'W' : mine === theirs ? 'D' : 'L' })
}
// Directions open the map app on a search for the venue; no location is sent anywhere else.
export const directionsHref = (venue: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue}, Maldives`)}`
