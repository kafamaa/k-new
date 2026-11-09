import { describe, expect, it } from 'vitest'
import { csvCell } from './csvSafe'
import { toCsv as reportCsv } from './reports'
import { toCsv as standingsCsv } from './tournamentPages'
import { rosterCsv } from './quickRoster'

describe('CSV exports cannot smuggle spreadsheet formulas', () => {
  it.each(['=HYPERLINK("http://x","click")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1'])('neutralizes %j', value => {
    expect(csvCell(value).startsWith(`"'`)).toBe(true)
  })

  it('keeps real numbers numeric, including negatives', () => {
    expect(csvCell(-3)).toBe('-3')
    expect(csvCell(12)).toBe('12')
  })

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Hulhumale, "North"\nside')).toBe('"Hulhumale, ""North""\nside"')
  })

  it('protects every export path', () => {
    const evil = '=cmd|calc'
    expect(reportCsv([{ name: evil }], ['name'])).toContain(`"'${evil}"`)
    expect(standingsCsv(['Team'], [[evil]])).toContain(`"'${evil}"`)
    expect(rosterCsv([{ name: evil, jersey: 7, position: null, claimed: false, onRoster: true }])).toContain(`"'${evil}"`)
  })
})
