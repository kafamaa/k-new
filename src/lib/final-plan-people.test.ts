import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { applyColumnMapping, autoMapColumns, buildImportRows, importTemplate, parseCsv, toCsv } from './csvImport'
import { organizerNav } from './organizer'
import { duplicateKey, duplicateReviewDetails, findDuplicateGroups, groupImportEvents, invitablePlayers, playerClaimStatus, type ClaimInvitation, type ManagedPlayer } from './organizerPeople'
import { columnIndex, decodeXml, readXlsxTable, worksheetRows } from './xlsx'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')

// A real ZIP container: local headers, central directory and end record.
function zip(files: Array<{ name: string; body: string; deflate?: boolean }>): ArrayBuffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const raw = Buffer.from(file.body)
    const data = file.deflate ? deflateRawSync(raw) : raw
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(file.deflate ? 8 : 0, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(file.deflate ? 8 : 0, 10); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42)
    parts.push(local, name, data)
    central.push(entry, name)
    offset += local.length + name.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  const all = Buffer.concat([...parts, directory, end])
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength)
}

const workbook = '<workbook xmlns:r="r"><sheets><sheet name="Squad" sheetId="1" r:id="rId7"/></sheets></workbook>'
const rels = '<Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/squad.xml"/></Relationships>'
const strings = '<sst><si><t>Player Name</t></si><si><t>Island</t></si><si><r><t>Ahmed </t></r><r><t>Ali</t></r></si><si><t>Mal&#233;</t></si></sst>'
const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row><row r="3"/><row r="4"><c r="A4" t="inlineStr"><is><t>Hawwa &amp; Co</t></is></c><c r="C4"><v>7</v></c></row></sheetData></worksheet>'

describe('Final plan 37: Excel import', () => {
  it('reads cells, shared and inline strings, gaps and entities', () => {
    expect(columnIndex('A1')).toBe(0); expect(columnIndex('AB12')).toBe(27)
    expect(decodeXml('a &amp; b &lt;c&gt; &#x41;')).toBe('a & b <c> A')
    expect(worksheetRows(sheet, ['Player Name', 'Island', 'Ahmed Ali', 'Malé'])).toEqual([['Player Name', '', 'Island'], ['Ahmed Ali', '', 'Malé'], ['Hawwa & Co', '', '7']])
  })
  it('opens a real .xlsx, stored or compressed, using the first sheet from the workbook', async () => {
    for (const deflate of [false, true]) {
      const file = zip([{ name: 'xl/workbook.xml', body: workbook, deflate }, { name: 'xl/_rels/workbook.xml.rels', body: rels, deflate }, { name: 'xl/sharedStrings.xml', body: strings, deflate }, { name: 'xl/worksheets/squad.xml', body: sheet, deflate }])
      const result = await readXlsxTable(file)
      expect(result.error).toBeNull()
      expect(result.table[1]).toEqual(['Ahmed Ali', '', 'Malé'])
    }
  })
  it('refuses a file that is not a workbook, without throwing', async () => {
    const result = await readXlsxTable(new TextEncoder().encode('name,island\nA,B').buffer as ArrayBuffer)
    expect(result.table).toEqual([])
    expect(result.error).toMatch(/not a readable \.xlsx/)
  })
})

describe('Final plan 37: template, column mapping and preview', () => {
  it('matches known column names and leaves unknown ones for the organizer', () => {
    expect(autoMapColumns('player', ['Player Name', 'Notes', 'Island'])).toEqual({ name: 0, island: 2 })
    expect(autoMapColumns('team', ['Team', 'Category'])).toEqual({ name: 0, island: -1, team_type: 1 })
    expect(autoMapColumns('player', ['Surname'])).toEqual({ name: -1, island: -1 })
  })
  it('rebuilds the sheet with the expected columns, so the same row checks apply', () => {
    const table = [['Player Name', '', 'Island'], ['Ahmed Ali', '', 'Malé'], ['', '', 'Addu']]
    const mapped = applyColumnMapping('player', table, autoMapColumns('player', table[0]))
    expect(mapped).toEqual([['name', 'island'], ['Ahmed Ali', 'Malé'], ['', 'Addu']])
    const built = buildImportRows('player', mapped)
    expect(built.rows[0]).toMatchObject({ name: 'Ahmed Ali', island: 'Malé', problems: [] })
    expect(built.rows[1].problems).toContain('Name is empty.')
    expect(buildImportRows('player', applyColumnMapping('player', [['Surname'], ['X']], { name: -1, island: -1 })).headerProblems[0]).toMatch(/Missing: name/)
  })
  it('writes CSV that reads back the same, and a template with column names only', () => {
    const table = [['name', 'island'], ['Ali, "Junior"', 'Malé'], [' spaced', 'line\nbreak']]
    expect(parseCsv(toCsv(table))).toEqual(table)
    expect(importTemplate('team')).toBe('name,island,team_type\n')
    expect(importTemplate('player')).toBe('name,island\n')
  })
  it('accepts .xlsx in the import panel and keeps the confirm step', () => {
    const panel = read('src/components/CsvImportPanel.tsx')
    expect(panel).toContain('.xlsx')
    expect(panel).toContain('readXlsxTable')
    expect(panel).toContain('Match your columns')
    expect(panel).toContain('Yes, import')
  })
})

const player = (id: string, name: string, extra: Partial<ManagedPlayer> = {}): ManagedPlayer => ({ id, name, slug: `${id}-slug`, island: 'Malé', claimed: false, published: false, createdAt: '2026-10-01', ...extra })
const invitation = (playerId: string, state: ClaimInvitation['state']): ClaimInvitation => ({ id: `${playerId}-${state}`, playerId, email: null, state, expiresAt: '2026-11-09', createdAt: '2026-11-02' })

describe('Final plan 37: claims', () => {
  it('gives each player one claim status', () => {
    const invitations = [invitation('b', 'pending'), invitation('c', 'expired'), invitation('c', 'revoked')]
    expect(playerClaimStatus(player('a', 'A', { claimed: true }), invitations)).toBe('claimed')
    expect(playerClaimStatus(player('b', 'B'), invitations)).toBe('invited')
    expect(playerClaimStatus(player('c', 'C'), invitations)).toBe('expired')
    expect(playerClaimStatus(player('d', 'D'), invitations)).toBe('not_invited')
  })
  it('offers batch invitations only to unclaimed players without a pending one', () => {
    const players = [player('a', 'A', { claimed: true }), player('b', 'B'), player('c', 'C'), player('d', 'D')]
    expect(invitablePlayers(players, [invitation('b', 'pending'), invitation('c', 'expired')]).map(item => item.id)).toEqual(['c', 'd'])
  })
})

describe('Final plan 37: possible duplicates', () => {
  it('matches names in any order and ignores case, accents in spacing and punctuation', () => {
    expect(duplicateKey('Ahmed  Ali')).toBe(duplicateKey('ali, AHMED'))
    expect(duplicateKey('Ahmed Ali')).not.toBe(duplicateKey('Ahmed Alim'))
  })
  it('reports only groups that include a record this organizer manages, same island first', () => {
    const groups = findDuplicateGroups([
      { id: '1', name: 'Ahmed Ali', slug: 'ahmed-ali-1', island: 'Malé', managed: true },
      { id: '2', name: 'Ali Ahmed', slug: 'ali-ahmed-2', island: 'Malé', managed: false, claimed: true },
      { id: '3', name: 'Hawwa Moosa', slug: 'hawwa-3', island: 'Addu', managed: true },
      { id: '4', name: 'Hawwa Moosa', slug: 'hawwa-4', island: 'Fuvahmulah', managed: true },
      { id: '5', name: 'Ibrahim', slug: 'ibrahim-5', island: null, managed: false },
      { id: '6', name: 'Ibrahim', slug: 'ibrahim-6', island: null, managed: false },
      { id: '1', name: 'Ahmed Ali', slug: 'ahmed-ali-1', island: 'Malé', managed: false },
    ])
    expect(groups.map(group => [group.records.map(record => record.id), group.sameIsland])).toEqual([[['1', '2'], true], [['3', '4'], false]])
  })
  it('names records by public address in the review request, never by internal id', () => {
    const [group] = findDuplicateGroups([
      { id: '0b6f1c1e-0000-4000-8000-000000000001', name: 'Ahmed Ali', slug: 'ahmed-ali-1', island: 'Malé', managed: true },
      { id: '0b6f1c1e-0000-4000-8000-000000000002', name: 'Ahmed Ali', slug: 'ahmed-ali-2', island: null, managed: false },
    ])
    const details = duplicateReviewDetails('player', group)
    expect(details).toBe('Possible duplicate player records: Ahmed Ali (Malé) #player/ahmed-ali-1; Ahmed Ali #player/ahmed-ali-2')
    expect(details).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
  })
  it('never merges, hides or deletes from the organizer side', () => {
    const source = read('src/lib/organizerPeople.ts') + read('src/components/OrganizerPeopleTabs.tsx')
    expect(source).not.toMatch(/\.from\('[^']+'\)\.(delete|update|upsert|insert)\(/)
    expect(source).toContain(".from('player_profiles').select(")
    expect(source).toContain("reason: kind === 'player' ? 'duplicate_player' : 'other'")
  })
})

describe('Final plan 37: imports history and tabs', () => {
  it('groups audit rows into one batch per file, kind and day', () => {
    const batches = groupImportEvents([
      { entity_type: 'player_profile', reason: 'Imported from squad.xlsx, line 2', created_at: '2026-11-02T05:00:00Z' },
      { entity_type: 'player_profile', reason: 'Imported from squad.xlsx, line 3', created_at: '2026-11-02T05:00:01Z' },
      { entity_type: 'team', reason: 'Imported from teams.csv, line 2', created_at: '2026-10-30T05:00:00Z' },
      { entity_type: 'player_profile', reason: 'Something else', created_at: '2026-11-02T05:00:00Z' },
    ])
    expect(batches).toEqual([
      { source: 'squad.xlsx', kind: 'player', created: 2, lastAt: '2026-11-02T05:00:01Z' },
      { source: 'teams.csv', kind: 'team', created: 1, lastAt: '2026-10-30T05:00:00Z' },
    ])
  })
  it('shows Teams, Players, Claims, Possible duplicates and Imports to every organization role', () => {
    for (const role of ['owner', 'operations', 'staff', 'finance', 'media']) {
      expect(organizerNav(role).map(item => item.section).slice(0, 7)).toEqual(['overview', 'tournaments', 'teams', 'players', 'claims', 'duplicates', 'imports'])
    }
    const workspace = read('src/components/OrganizerWorkspace.tsx')
    expect(workspace).toContain("sections: ['players', 'teams', 'claims', 'duplicates', 'imports']")
    expect(workspace).toContain('canImportTeams={canManageTournaments(role)}')
  })
})
