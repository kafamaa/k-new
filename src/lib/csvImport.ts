import type { SupabaseClient } from '@supabase/supabase-js'
import { createTeam, createUnclaimedPlayer } from './records'
import { linkTeamToOrganization, sanitizeSearchTerm } from './organizer'
import { TEAM_TYPES } from './teamWorkspace'

// ---------------------------------------------------------------------------
// Reviewed CSV import for teams and players (Product Specification 16.6).
// The organizer pastes or uploads a CSV, sees every row with its problems and
// likely duplicates, chooses what to create, and confirms. Nothing is
// overwritten or merged: a likely duplicate is skipped unless the organizer
// explicitly includes it, and every created record gets an audit entry naming
// the import as its source.
// ---------------------------------------------------------------------------

export type ImportKind = 'team' | 'player'
export const IMPORT_COLUMNS: Record<ImportKind, { required: string[]; optional: string[] }> = {
  team: { required: ['name'], optional: ['island', 'team_type'] },
  player: { required: ['name'], optional: ['island'] },
}
export const MAX_IMPORT_ROWS = 300

// RFC 4180-style parsing: quoted fields, doubled quotes, commas and newlines
// inside quotes, CRLF or LF line endings.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const source = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1 }
      else if (char === '"') quoted = false
      else field += char
      continue
    }
    if (char === '"' && field === '') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(field); field = ''
      if (row.some(value => value.trim() !== '')) rows.push(row)
      row = []
    } else field += char
  }
  row.push(field)
  if (row.some(value => value.trim() !== '')) rows.push(row)
  return rows
}

export function normalizeName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export type ImportRow = { line: number; name: string; island: string; teamType: string; problems: string[]; duplicateOf: string | null; duplicateInFile: boolean }

export function buildImportRows(kind: ImportKind, table: string[][]): { rows: ImportRow[]; headerProblems: string[] } {
  if (table.length === 0) return { rows: [], headerProblems: ['The file is empty.'] }
  const header = table[0].map(cell => cell.trim().toLowerCase().replace(/\s+/g, '_'))
  const index = (column: string) => header.indexOf(column === 'name' && kind === 'player' && !header.includes('name') ? 'display_name' : column)
  const missing = IMPORT_COLUMNS[kind].required.filter(column => index(column) < 0)
  if (missing.length) return { rows: [], headerProblems: [`The first row must name the columns. Missing: ${missing.join(', ')}. Expected: ${[...IMPORT_COLUMNS[kind].required, ...IMPORT_COLUMNS[kind].optional].join(', ')}.`] }
  const body = table.slice(1)
  if (body.length > MAX_IMPORT_ROWS) return { rows: [], headerProblems: [`Import at most ${MAX_IMPORT_ROWS} rows at a time (this file has ${body.length}).`] }
  const seen = new Map<string, number>()
  const rows = body.map((cells, offset) => {
    const value = (column: string) => { const at = index(column); return at >= 0 ? (cells[at] ?? '').trim() : '' }
    const name = value('name')
    const teamType = kind === 'team' ? (value('team_type').toLowerCase() || 'club') : ''
    const problems: string[] = []
    if (!name) problems.push('Name is empty.')
    if (name.length > 120) problems.push('Name is longer than 120 characters.')
    if (kind === 'team' && !(TEAM_TYPES as readonly string[]).includes(teamType)) problems.push(`Team type must be one of: ${TEAM_TYPES.join(', ')}.`)
    const key = `${normalizeName(name)}|${normalizeName(value('island'))}`
    const duplicateInFile = Boolean(name) && seen.has(key)
    if (name && !seen.has(key)) seen.set(key, offset)
    return { line: offset + 2, name, island: value('island'), teamType, problems, duplicateOf: null, duplicateInFile }
  })
  return { rows, headerProblems: [] }
}

// Marks rows whose name matches a record this account can already read.
export function markExistingDuplicates(rows: ImportRow[], existing: Array<{ name: string; island: string | null }>): ImportRow[] {
  const byName = new Map<string, Array<{ name: string; island: string | null }>>()
  for (const record of existing) {
    const key = normalizeName(record.name)
    byName.set(key, [...(byName.get(key) ?? []), record])
  }
  return rows.map(row => {
    const matches = byName.get(normalizeName(row.name)) ?? []
    // Same name and same (or unrecorded) island is a likely duplicate; the
    // same name on another island is shown as a possible one.
    const likely = matches.find(record => !record.island || !row.island || normalizeName(record.island) === normalizeName(row.island))
    const match = likely ?? matches[0]
    return { ...row, duplicateOf: match ? `${match.name}${match.island ? ` (${match.island})` : ''}${likely ? '' : ' — different island'}` : null }
  })
}

export async function findExistingRecords(client: SupabaseClient, kind: ImportKind, names: string[]): Promise<{ data: Array<{ name: string; island: string | null }>; error: string | null }> {
  const terms = [...new Set(names.map(name => sanitizeSearchTerm(name)).filter(term => term.length >= 2))]
  const found: Array<{ name: string; island: string | null }> = []
  for (let start = 0; start < terms.length; start += 20) {
    const chunk = terms.slice(start, start + 20)
    const column = kind === 'team' ? 'name' : 'display_name'
    const result = await client.from(kind === 'team' ? 'teams' : 'player_profiles').select(`${column},island`).or(chunk.map(term => `${column}.ilike.${term}`).join(',')).limit(200)
    if (result.error) return { data: [], error: result.error.message }
    for (const row of (result.data ?? []) as Array<Record<string, unknown>>) found.push({ name: String(row[column] ?? ''), island: typeof row.island === 'string' ? row.island : null })
  }
  return { data: found, error: null }
}

// A row is importable when it has no problems; duplicates need an explicit
// include decision from the organizer.
export function defaultSelection(rows: ImportRow[]): Set<number> {
  return new Set(rows.filter(row => row.problems.length === 0 && !row.duplicateOf && !row.duplicateInFile).map(row => row.line))
}

export type ImportOutcome = { created: number; failed: Array<{ line: number; error: string }> }

export async function commitImport(client: SupabaseClient, input: { kind: ImportKind; rows: ImportRow[]; userId: string; organizationId: string; sourceName: string; onProgress?: (done: number) => void }): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { created: 0, failed: [] }
  let done = 0
  for (const row of input.rows) {
    const result = input.kind === 'team'
      ? await createTeam(client, input.userId, row.name, row.island, row.teamType)
      : await createUnclaimedPlayer(client, input.userId, row.name, row.island)
    if (result.error || !result.data) outcome.failed.push({ line: row.line, error: result.error ?? 'Not created.' })
    else {
      outcome.created += 1
      if (input.kind === 'team') {
        const link = await linkTeamToOrganization(client, input.organizationId, result.data.id, input.userId)
        if (link.error) outcome.failed.push({ line: row.line, error: `Created, but not linked to the organization: ${link.error}` })
      }
      // Provenance (migration 026 policy). A missing policy does not undo the record.
      await client.from('audit_events').insert({ actor_id: input.userId, action: 'csv_import', entity_type: input.kind === 'team' ? 'team' : 'player_profile', entity_id: result.data.id, reason: `Imported from ${input.sourceName.slice(0, 80)}, line ${row.line}` })
    }
    done += 1
    input.onProgress?.(done)
  }
  return outcome
}

// --- Template and column mapping (final plan 37) ---------------------------
// The organizer may bring a sheet with their own column names. Known names are
// matched automatically; the rest are chosen by hand before the preview, and the
// file is then read with the expected column names.

const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'display_name', 'player_name', 'team_name', 'full_name', 'player', 'team'],
  island: ['island', 'home_island', 'atoll_island', 'location'],
  team_type: ['team_type', 'type', 'category'],
}

export type ColumnMapping = Record<string, number>

const headerKey = (cell: string) => cell.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

export function autoMapColumns(kind: ImportKind, header: string[]): ColumnMapping {
  const keys = header.map(headerKey)
  const mapping: ColumnMapping = {}
  for (const column of [...IMPORT_COLUMNS[kind].required, ...IMPORT_COLUMNS[kind].optional]) {
    mapping[column] = keys.findIndex(key => (COLUMN_ALIASES[column] ?? [column]).includes(key))
  }
  return mapping
}

// Rebuilds the table with exactly the expected columns, in order. A column
// mapped to -1 is left empty, so buildImportRows reports what is missing.
export function applyColumnMapping(kind: ImportKind, table: string[][], mapping: ColumnMapping): string[][] {
  if (table.length === 0) return table
  const header = [...IMPORT_COLUMNS[kind].required, ...IMPORT_COLUMNS[kind].optional].filter(column => (mapping[column] ?? -1) >= 0)
  return [header, ...table.slice(1).map(cells => header.map(column => cells[mapping[column]] ?? ''))]
}

export function toCsv(table: string[][]): string {
  return table.map(cells => cells.map(cell => /[",\r\n]/.test(cell) || /^\s|\s$/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell).join(',')).join('\n')
}

// Column names only: the template carries no example people or teams.
export function importTemplate(kind: ImportKind): string {
  return `${[...IMPORT_COLUMNS[kind].required, ...IMPORT_COLUMNS[kind].optional].join(',')}\n`
}
