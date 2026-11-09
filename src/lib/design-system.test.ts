import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = resolve(process.cwd(), 'src')
const sheets = readdirSync(src).filter(name => name.endsWith('.css')).map(name => ({ name, css: readFileSync(resolve(src, name), 'utf8') }))
const ds = readFileSync(resolve(src, 'consistency.css'), 'utf8')
const main = readFileSync(resolve(src, 'main.tsx'), 'utf8')

describe('design system', () => {
  it('defines shared tokens and loads before the workspace theme', () => {
    for (const token of ['--ds-navy', '--ds-turquoise', '--ds-ok-bg', '--ds-warn-bg', '--ds-bad-bg', '--ds-info-bg', '--ds-radius', '--ds-control', '--ds-text-xs']) expect(ds).toContain(token)
    const imports = [...main.matchAll(/^import '\.\/([a-z-]+)\.css'/gm)].map(match => match[1])
    expect(imports.indexOf('consistency')).toBe(imports.length - 2)
  })

  it('never sets text smaller than 12px', () => {
    const tiny = sheets.flatMap(({ name, css }) => [...css.matchAll(/font(?:-size)?:\s*(?:\d{3}\s+)?(\d+(?:\.\d+)?)px/g)].filter(match => Number(match[1]) < 12).map(match => `${name}: ${match[0]}`))
    expect(tiny).toEqual([])
  })

  it('gives every status badge component the same tones', () => {
    for (const tone of ['ok', 'warn', 'danger', 'info', 'neutral']) expect(ds).toContain(`.status-pill.status-${tone}`)
    for (const tone of ['tone-ok', 'tone-warn', 'tone-bad', 'tone-info', 'tone-muted']) expect(ds).toContain(`.pw-pill.${tone}`)
  })

  it('keeps wide tables and tab rows from widening the page', () => {
    expect(ds).toMatch(/table-scroll[^{]*\{[^}]*contain: paint/)
    expect(ds).toMatch(/:is\(\.cockpit-group-tabs, \.pw-subtabs\) \{[^}]*max-width: 100%; overflow-x: auto/)
    expect(ds).toContain('.flow-nav, .pw-page { grid-template-columns: minmax(0, 1fr); }')
    // Containment on an auto-width toggle collapses it; only the full-width toolbar row is contained.
    expect(ds).not.toMatch(/^\.ed-toggle \{[^}]*[^-]contain:/m)
  })

  it('keeps old site-footer rules off card footers', () => {
    const legacy = sheets.find(sheet => sheet.name === 'styles.css')!.css
    expect(legacy).not.toMatch(/\}footer\{/)
    expect(legacy).toContain('footer:not(.pf-card-foot){')
  })

  it('keeps labels hidden on phones available to screen readers', () => {
    expect(ds).toMatch(/:is\(button, a\) > \.ed-hide-sm \{[^}]*position: absolute !important/)
    const organizer = readFileSync(resolve(src, 'components/OrganizerWorkspace.tsx'), 'utf8')
    expect(organizer.match(/onClick=\{onSwitchWorkspace\} aria-label="Switch workspace"/g)?.length).toBe(2)
  })
})
