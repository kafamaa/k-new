import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { formatMaldivesDate, formatMaldivesDateTime } from './publicData'

const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []
})

describe('Maldives time (UTC+5)', () => {
  it('shows 10:00 UTC as 15:00 in the Maldives, not 16:00', () => {
    expect(formatMaldivesDateTime('2026-11-03T10:00:00Z')).toContain('15:00')
  })

  it('rolls the date over at Maldives midnight', () => {
    expect(formatMaldivesDate('2026-11-03T19:30:00Z')).toBe('4 Nov 2026')
  })

  it('never formats with a zone other than Indian/Maldives', () => {
    const offenders = files(resolve(process.cwd(), 'src')).flatMap(path => {
      const zones = [...readFileSync(path, 'utf8').matchAll(/timeZone:\s*'([^']+)'/g)].map(match => match[1]).filter(zone => zone !== 'Indian/Maldives' && zone !== 'UTC')
      return zones.map(zone => `${path}: ${zone}`)
    })
    expect(offenders).toEqual([])
  })
})
