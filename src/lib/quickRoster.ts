import { normalizeMaldivianId } from './identity'
import { csvCell as cell } from './csvSafe'

// Quick roster entry (Final specification, page 41): an organizer enters many
// players at once — name, Maldivian ID card, jersey and position — by typing,
// pasting a list or importing a CSV file. The ID number lives only in this form
// until it is sent to the private identity check; it is never stored or logged
// here, and rows are cleared of it once processed.

export type QuickRowStatus = 'new' | 'existing' | 'possible_duplicate' | 'added' | 'error'
export type QuickRow = {
  key: string
  name: string
  nationalId: string
  jersey: string
  position: string
  status: QuickRowStatus
  existingId: string | null
  matches: Array<{ id: string; name: string; island: string | null }>
  message: string | null
}

let counter = 0
export function emptyRow(values: Partial<Pick<QuickRow, 'name' | 'nationalId' | 'jersey' | 'position'>> = {}): QuickRow {
  counter += 1
  return { key: `row-${Date.now()}-${counter}`, name: values.name ?? '', nationalId: values.nationalId ?? '', jersey: values.jersey ?? '', position: values.position ?? '', status: 'new', existingId: null, matches: [], message: null }
}

const HEADER_NAMES: Record<string, keyof Pick<QuickRow, 'name' | 'nationalId' | 'jersey' | 'position'>> = {
  name: 'name', 'player name': 'name', 'full name': 'name', player: 'name',
  id: 'nationalId', 'national id': 'nationalId', 'id card': 'nationalId', nid: 'nationalId', 'id number': 'nationalId',
  jersey: 'jersey', number: 'jersey', 'shirt number': 'jersey', shirt: 'jersey', no: 'jersey',
  position: 'position', pos: 'position',
}

// One line → cells. Tabs (pasted from a spreadsheet) win over commas; quoted
// CSV cells keep their commas.
export function splitLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map(cell => cell.trim())
  const cells: string[] = []
  let current = '', quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') { if (quoted && line[index + 1] === '"') { current += '"'; index += 1 } else quoted = !quoted }
    else if (char === ',' && !quoted) { cells.push(current.trim()); current = '' }
    else current += char
  }
  cells.push(current.trim())
  return cells
}

// Pasted text or CSV content → rows. A first line of known column names is used
// as the header; otherwise the order is Name, ID, Jersey, Position.
export function parseRosterText(text: string, limit = 60): { rows: QuickRow[]; skipped: number } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean)
  if (!lines.length) return { rows: [], skipped: 0 }
  const first = splitLine(lines[0]).map(cell => cell.toLowerCase())
  const headerMap = first.map(cell => HEADER_NAMES[cell] ?? null)
  const hasHeader = headerMap.filter(Boolean).length >= 2
  const order: Array<keyof Pick<QuickRow, 'name' | 'nationalId' | 'jersey' | 'position'> | null> = hasHeader ? headerMap : ['name', 'nationalId', 'jersey', 'position']
  const body = hasHeader ? lines.slice(1) : lines
  const rows: QuickRow[] = []
  let skipped = 0
  for (const line of body) {
    const cells = splitLine(line)
    const values: Partial<Pick<QuickRow, 'name' | 'nationalId' | 'jersey' | 'position'>> = {}
    order.forEach((field, index) => { if (field && cells[index] !== undefined) values[field] = cells[index] })
    if (!values.name?.trim()) { skipped += 1; continue }
    if (rows.length >= limit) { skipped += 1; continue }
    rows.push(emptyRow({ ...values, jersey: (values.jersey ?? '').replace(/\D/g, '').slice(0, 2), position: (values.position ?? '').slice(0, 40), name: values.name.trim().slice(0, 80) }))
  }
  return { rows, skipped }
}

const normalName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

// Problems that stop the batch before anything is sent.
export function rowProblems(rows: QuickRow[], takenJerseys: number[] = []): Map<string, string> {
  const problems = new Map<string, string>()
  const pending = rows.filter(row => row.status !== 'added')
  const ids = new Map<string, string>()
  const jerseys = new Map<string, string>()
  for (const row of pending) {
    if (row.name.trim().length < 2) { problems.set(row.key, 'Enter the player’s name.'); continue }
    // Decide on a possible duplicate first: choosing the existing player needs no ID card.
    if (row.status === 'possible_duplicate') { problems.set(row.key, 'Choose the existing player or keep this as a new player.'); continue }
    if (!row.existingId) {
      const id = normalizeMaldivianId(row.nationalId)
      if (!id) { problems.set(row.key, 'Enter the Maldivian ID card number (A123456).'); continue }
      if (ids.has(id)) { problems.set(row.key, 'The same ID card appears twice in this list.'); continue }
      ids.set(id, row.key)
    }
    if (row.jersey) {
      const number = Number(row.jersey)
      if (!Number.isInteger(number) || number < 0 || number > 99) { problems.set(row.key, 'Jersey numbers are 0–99.'); continue }
      if (jerseys.has(row.jersey) || takenJerseys.includes(number)) { problems.set(row.key, `Jersey ${row.jersey} is already used.`); continue }
      jerseys.set(row.jersey, row.key)
    }
  }
  return problems
}

// A name that already belongs to a player the organizer can see is a possible
// duplicate: the organizer decides; nothing is merged automatically.
export function duplicateMatches(row: QuickRow, candidates: Array<{ id: string; name: string; island: string | null }>): Array<{ id: string; name: string; island: string | null }> {
  const target = normalName(row.name)
  return candidates.filter(candidate => normalName(candidate.name) === target)
}

// Spreadsheet-safe CSV of a roster for printing or sharing. No ID numbers.
export function rosterCsv(rows: Array<{ name: string; jersey: string | number | null; position: string | null; claimed: boolean; onRoster: boolean }>): string {
  return [['Name', 'Jersey', 'Position', 'Account', 'On roster'].map(cell).join(','), ...rows.map(row => [row.name, row.jersey ?? '', row.position ?? '', row.claimed ? 'Claimed' : 'Unclaimed', row.onRoster ? 'Yes' : 'No'].map(cell).join(','))].join('\r\n')
}

// Player record status (final specification 1.2, migration 040). Before the migration
// is applied the roster table falls back to "has an account / not yet".
export const RECORD_STATUS_LABELS: Record<string, string> = {
  unclaimed: 'Unclaimed', invited: 'Claim invited', claimed: 'Claimed', verified: 'Verified', restricted: 'Under review', merged: 'Merged', archived: 'Archived',
}
export async function loadRecordStatuses(client: import('@supabase/supabase-js').SupabaseClient, playerIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (!playerIds.length) return map
  const result = await client.rpc('player_record_statuses', { p_players: playerIds.slice(0, 200) })
  if (result.error) return map
  for (const row of (result.data ?? []) as Array<{ player_id: string; status: string }>) map.set(String(row.player_id), String(row.status))
  return map
}

// Copy previous roster (page 41): squad players from the team's latest roster elsewhere.
export type PreviousRosterLine = { playerId: string; shirt: string; position: string; tournament: string }
export async function loadPreviousRoster(client: import('@supabase/supabase-js').SupabaseClient, entryId: string): Promise<{ data: PreviousRosterLine[]; error: string | null }> {
  const result = await client.rpc('previous_roster_players', { p_entry_id: entryId })
  if (result.error) return { data: [], error: /could not find the function|schema cache/i.test(result.error.message) ? 'Copying a previous roster becomes available once the platform owner applies migration 040.' : 'The previous roster could not be loaded. Please try again.' }
  return { data: ((result.data ?? []) as Array<Record<string, unknown>>).map(row => ({ playerId: String(row.player_id), shirt: String(row.shirt_number ?? '').replace(/\D/g, '').slice(0, 2), position: String(row.player_position ?? '').slice(0, 40), tournament: String(row.tournament_name ?? 'a previous tournament') })), error: null }
}
