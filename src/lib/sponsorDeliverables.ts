import type { SupabaseClient } from '@supabase/supabase-js'

// Sponsor deliverables (review-only migration 046, unified plan section 22):
// what the organizer owes each sponsor, with a due date and a fulfilment state.
// Finance staff only. Delivered time and person are stamped by the database.
export type DeliverableKind = 'banner' | 'logo_placement' | 'social_post' | 'announcement' | 'hospitality' | 'branded_item' | 'other'
export type DeliverableStatus = 'pending' | 'delivered' | 'waived'
export type Deliverable = {
  id: string; sponsorId: string; kind: DeliverableKind; title: string; dueOn: string | null
  status: DeliverableStatus; note: string | null; deliveredAt: string | null
}

export const DELIVERABLE_KINDS: Record<DeliverableKind, string> = {
  banner: 'Banner at venue', logo_placement: 'Logo placement', social_post: 'Social media post', announcement: 'Announcement',
  hospitality: 'Hospitality / passes', branded_item: 'Branded item', other: 'Other',
}
export const DELIVERABLE_STATUS: Record<DeliverableStatus, string> = { pending: 'To do', delivered: 'Delivered', waived: 'Not needed' }

const isPending = (message: string) => /does not exist|PGRST20\d|42883|42P01|schema cache|could not find/i.test(message)
export const PENDING_DELIVERABLES = 'The sponsor checklist becomes available once the platform owner applies update 046.'

export function deliverableProblem(input: { title: string; dueOn: string }): string | null {
  if (input.title.trim().length < 2) return 'Describe what the sponsor receives (for example “Banner at the main ground”).'
  if (input.title.trim().length > 160) return 'Keep the description under 160 characters.'
  if (input.dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) return 'Use a valid due date.'
  return null
}

export async function loadDeliverables(client: SupabaseClient, tournamentId: string): Promise<{ data: Deliverable[]; state: 'ready' | 'pending' | 'error' }> {
  const result = await client.from('tournament_sponsor_deliverables').select('id,sponsor_id,kind,title,due_on,status,note,delivered_at').eq('tournament_id', tournamentId).order('due_on', { ascending: true, nullsFirst: false }).order('created_at')
  if (result.error) return { data: [], state: isPending(result.error.message) ? 'pending' : 'error' }
  type Row = { id: string; sponsor_id: string; kind: DeliverableKind; title: string; due_on: string | null; status: DeliverableStatus; note: string | null; delivered_at: string | null }
  return { state: 'ready', data: ((result.data ?? []) as Row[]).map(row => ({ id: row.id, sponsorId: row.sponsor_id, kind: row.kind, title: row.title, dueOn: row.due_on, status: row.status, note: row.note, deliveredAt: row.delivered_at })) }
}

export async function addDeliverable(client: SupabaseClient, userId: string, tournamentId: string, input: { sponsorId: string; kind: DeliverableKind; title: string; dueOn: string; note: string }): Promise<{ error: string | null }> {
  const problem = deliverableProblem(input)
  if (problem) return { error: problem }
  const result = await client.from('tournament_sponsor_deliverables').insert({
    tournament_id: tournamentId, sponsor_id: input.sponsorId, kind: input.kind, title: input.title.trim(), due_on: input.dueOn || null, note: input.note.trim() || null, created_by: userId,
  })
  return { error: result.error ? (isPending(result.error.message) ? PENDING_DELIVERABLES : 'The item could not be saved. Please try again.') : null }
}

export async function setDeliverableStatus(client: SupabaseClient, id: string, status: DeliverableStatus): Promise<{ error: string | null }> {
  const result = await client.from('tournament_sponsor_deliverables').update({ status }).eq('id', id)
  return { error: result.error ? 'The change could not be saved. Please try again.' : null }
}

export async function removeDeliverable(client: SupabaseClient, id: string): Promise<{ error: string | null }> {
  const result = await client.from('tournament_sponsor_deliverables').delete().eq('id', id)
  return { error: result.error ? 'The item could not be removed. Please try again.' : null }
}

// Overdue = still to do and the due date (Maldives calendar day) has passed.
export function isOverdue(item: Pick<Deliverable, 'status' | 'dueOn'>, todayIso: string): boolean {
  return item.status === 'pending' && Boolean(item.dueOn) && String(item.dueOn) < todayIso
}

export function deliverableSummary(items: Deliverable[], todayIso: string): { total: number; delivered: number; overdue: number } {
  return {
    total: items.filter(item => item.status !== 'waived').length,
    delivered: items.filter(item => item.status === 'delivered').length,
    overdue: items.filter(item => isOverdue(item, todayIso)).length,
  }
}

// Today's calendar date in the Maldives (UTC+5), as YYYY-MM-DD.
export function maldivesToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Maldives', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export async function updateDeliverable(client: SupabaseClient, id: string, input: { kind: DeliverableKind; title: string; dueOn: string; note: string }): Promise<{ error: string | null }> {
  const problem = deliverableProblem(input)
  if (problem) return { error: problem }
  const result = await client.from('tournament_sponsor_deliverables').update({ kind: input.kind, title: input.title.trim(), due_on: input.dueOn || null, note: input.note.trim() || null }).eq('id', id)
  return { error: result.error ? 'The change could not be saved. Please try again.' : null }
}
