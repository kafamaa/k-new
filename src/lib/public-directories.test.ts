import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { hashWithParams, pageSlice, readHashParams } from './directory'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const directories = read('src/components/PublicDirectories.tsx')
const page = read('src/components/PublicPage.tsx')

describe('URL state and paging', () => {
  it('keeps filters and the page in the URL', () => {
    expect(readHashParams('#matches?tab=live&sport=futsal')).toEqual({ tab: 'live', sport: 'futsal' })
    expect(hashWithParams('#matches?old=1', { tab: 'results', sport: '', page: '2' })).toBe('#matches?tab=results&page=2')
    expect(hashWithParams('#news', {})).toBe('#news')
  })
  it('pages stably and clamps out-of-range pages', () => {
    const items = Array.from({ length: 45 }, (_, index) => index)
    expect(pageSlice(items, 1)).toMatchObject({ page: 1, pages: 3 })
    expect(pageSlice(items, 3).items).toEqual([40, 41, 42, 43, 44])
    expect(pageSlice(items, 9).page).toBe(3)
    expect(pageSlice([], 2)).toMatchObject({ items: [], page: 1, pages: 1 })
  })
})

describe('public directory pages', () => {
  it('route matches, standings, bracket, search and news to their pages', () => {
    for (const component of ['<StandingsDirectory />', '<BracketDirectory />', '<SearchDirectory initialQuery={route.query} />', '<NewsDirectory />']) expect(page).toContain(component)
  })
  it('never shows raw service errors to visitors', () => {
    expect(page).not.toContain('Unable to load this public page: {message}')
    expect(directories).not.toMatch(/\.error\.message\}/)
    expect(directories).toContain('This page could not be loaded.')
  })
  it('only shows official scores and labels unconfirmed results', () => {
    expect(directories).toContain('officialScore(match)')
    expect(directories).toContain('“Finished — awaiting confirmation” is not an official result.')
  })
  it('shows standings from the newest calculation and published teams only', () => {
    expect(directories).toContain('latestStandings(')
    expect(directories).toContain("const name = published ? String(team?.name ?? 'Team') : 'Team'")
  })
  it('offers an accessible stage list next to the visual bracket', () => {
    expect(directories).toContain("'Stage list'")
    expect(directories).toContain('<ol className="pd-stage-list">')
  })
  it('searches every public record type with per-type tabs and failure isolation', () => {
    for (const type of ['tournaments', 'teams', 'players', 'organizations', 'matches', 'news']) expect(directories).toContain(`id: '${type}'`)
    expect(directories).toContain('Some results could not be loaded right now')
    expect(directories).toContain('Type at least 2 characters to search.')
  })
  it('pages every directory list', () => {
    // Four directories plus the Tournament Archive (final plan 19). Tournaments uses the
    // numbered pager from the owner's design (2026-11-04).
    expect(page.match(/<Pager page=\{paged\.page\}/g)?.length).toBe(4)
    expect(page).toContain('<NumberedPager page={paged.page} pages={paged.pages} onPage={setPage} label="Tournament pages" />')
  })
})
