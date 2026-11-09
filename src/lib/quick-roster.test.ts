import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { duplicateMatches, emptyRow, parseRosterText, rosterCsv, rowProblems, splitLine } from './quickRoster'

const component = readFileSync(resolve(process.cwd(), 'src/components/QuickRosterEntry.tsx'), 'utf8')

describe('Quick roster entry (page 41)', () => {
  it('reads pasted lines, spreadsheet columns and CSV with a header', () => {
    expect(parseRosterText('Ali Ahmed, A123456, 10, Forward\nHassan Ibrahim, A654321, 1, Goalkeeper').rows.map(row => [row.name, row.nationalId, row.jersey, row.position])).toEqual([['Ali Ahmed', 'A123456', '10', 'Forward'], ['Hassan Ibrahim', 'A654321', '1', 'Goalkeeper']])
    expect(parseRosterText('Name\tPosition\tNo\tNational ID\nAli\tDefender\t4\tA111111').rows[0]).toMatchObject({ name: 'Ali', position: 'Defender', jersey: '4', nationalId: 'A111111' })
    expect(splitLine('"Ahmed, Ali",A123456,7,"Left, wing"')).toEqual(['Ahmed, Ali', 'A123456', '7', 'Left, wing'])
    const { rows, skipped } = parseRosterText(',A1,2,\nOk Name,A123456,abc,')
    expect(rows).toHaveLength(1)
    expect(rows[0].jersey).toBe('')
    expect(skipped).toBe(1)
  })
  it('needs a name and a valid ID card for every new player, with no repeats', () => {
    const rows = [emptyRow({ name: 'Ali', nationalId: 'A123456', jersey: '10' }), emptyRow({ name: 'Hassan', nationalId: 'a 123456', jersey: '11' }), emptyRow({ name: 'Moosa', nationalId: 'B1', jersey: '12' }), emptyRow({ name: 'Ibrahim', nationalId: 'A222222', jersey: '10' }), emptyRow({ name: 'Zaid', nationalId: 'A333333', jersey: '7' })]
    const problems = rowProblems(rows, [7])
    expect(problems.get(rows[0].key)).toBeUndefined()
    expect(problems.get(rows[1].key)).toMatch(/appears twice/)
    expect(problems.get(rows[2].key)).toMatch(/A123456/)
    expect(problems.get(rows[3].key)).toMatch(/Jersey 10/)
    expect(problems.get(rows[4].key)).toMatch(/Jersey 7/)
    // An existing player needs no ID card.
    expect(rowProblems([{ ...emptyRow({ name: 'Ali' }), existingId: 'p1', status: 'existing' }]).size).toBe(0)
  })
  it('flags a same-name player as a possible duplicate for the organizer to decide', () => {
    const row = emptyRow({ name: '  ali   AHMED ' })
    expect(duplicateMatches(row, [{ id: 'p1', name: 'Ali Ahmed', island: 'Malé' }, { id: 'p2', name: 'Ali Ahmed Rasheed', island: null }]).map(match => match.id)).toEqual(['p1'])
    expect(rowProblems([{ ...row, status: 'possible_duplicate' }]).values().next().value).toMatch(/existing player or keep/)
  })
  it('exports a spreadsheet-safe roster without ID numbers', () => {
    const csv = rosterCsv([{ name: '=HYPERLINK("x")', jersey: 9, position: 'Forward', claimed: false, onRoster: true }])
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).not.toMatch(/national|A\d{6}/i)
  })
  it('never keeps an ID number after it is sent, and never logs it', () => {
    expect(component).toContain("update(row.key, { status: 'error', message: result.error, nationalId: '' })")
    // Updated: the added row may also say it matched an existing player; the ID is still cleared.
    const added = component.slice(component.indexOf("update(row.key, { status: 'added'"), component.indexOf("update(row.key, { status: 'added'") + 260)
    expect(added).toContain("nationalId: '' })")
    expect(component).not.toMatch(/console\.|localStorage|sessionStorage/)
    expect(component).toContain("type={reveal ? 'text' : 'password'}")
  })
})
