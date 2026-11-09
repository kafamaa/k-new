import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ADMIN_PAGES, ROLE_LABELS, visiblePages } from './superAdmin'
import { RECORD_STATUS_LABELS } from './quickRoster'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const sql = read('supabase/migrations/202611010040_organizer_first_and_admin_on_behalf.sql')
const fn = (name: string) => { const start = sql.indexOf(`function public.${name}(`); return sql.slice(start, sql.indexOf('$$;', start)) }

describe('Migration 040: player record status', () => {
  it('derives one status from existing data, in a safe order', () => {
    const status = fn('player_record_status_for')
    const order = ["then 'merged'", "then 'restricted'", "then 'verified'", "then 'claimed'", "then 'invited'", "else 'unclaimed'"].map(part => status.indexOf(part))
    expect(order.every(position => position > 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    // Moderation state is shown only to administrators who may moderate players.
    expect(fn('player_record_statuses')).toContain("public.admin_has('admin.players.moderate')")
    expect(fn('player_record_statuses')).toContain('(select auth.uid()) is not null')
    expect(sql).toContain('revoke execute on function public.player_record_status_for(uuid, boolean) from public, anon, authenticated;')
    for (const value of ['unclaimed', 'invited', 'claimed', 'verified', 'restricted', 'merged']) expect(RECORD_STATUS_LABELS[value]).toBeTruthy()
  })
})

describe('Migration 040: Super Admin create on behalf', () => {
  it('checks permission, reason and a recent sign-in, and audits every creation', () => {
    const check = fn('admin_check_create')
    for (const part of ["public.admin_assert('admin.records.create')", 'public.admin_require_reason(p_reason)', 'public.admin_require_recent_auth()']) expect(check).toContain(part)
    for (const name of ['admin_create_organization', 'admin_create_team', 'admin_create_tournament', 'admin_create_player']) {
      const body = fn(name)
      expect(body, name).toContain('public.admin_check_create(')
      expect(body, name).toMatch(/public\.admin_audit\('[a-z]+_created_on_behalf'/)
      expect(body, name).not.toMatch(/\bdelete from\b/i)
      expect(sql).toContain(`revoke execute on function public.${name}(`)
    }
    expect(fn('admin_create_player')).toContain('account_id, is_claimed')
    expect(fn('admin_create_player')).toContain('null, false)')
    expect(fn('admin_create_tournament')).not.toMatch(/'registration_open'|is_published/)
  })
  it('gives the new permission to Platform Owners and Sports Operations, not Moderators', () => {
    expect(fn('admin_all_permissions')).toContain("'admin.records.create'")
    const roles = fn('admin_role_permissions')
    const moderator = roles.slice(roles.indexOf("when 'moderator'"), roles.indexOf("when 'support_agent'"))
    expect(moderator).not.toContain('admin.records.create')
    expect(roles).toMatch(/when 'sports_operations' then array\[[^\]]*'admin\.records\.create'/)
    expect(ROLE_LABELS.sports_operations).toBe('Sports Operations')
    expect(visiblePages(['admin.dashboard.read', 'admin.cases.manage', 'admin.content.moderate', 'admin.teams.moderate']).map(page => page.id)).not.toContain('create')
    // Final plan 56: creating records on behalf belongs to Records & Access (group id "people").
    expect(ADMIN_PAGES.find(page => page.id === 'create')).toMatchObject({ group: 'people', any: ['admin.records.create'] })
  })
  it('uses empty search paths and no reserved output names', () => {
    for (const line of sql.match(/security definer set search_path = [^ ]+/g) ?? []) expect(line).toContain("''")
    expect(sql).not.toMatch(/returns table\([^)]*\bposition\b/)
  })
})

describe('Copy previous roster', () => {
  it('lets only tournament operators or roster managers copy, and only current squad players', () => {
    const body = fn('previous_roster_players')
    expect(body).toContain("public.is_tournament_operator(v_tournament) or public.team_has_permission(v_team, 'manage_rosters')")
    expect(body).toContain("ms.status in ('active', 'loaned') and ms.effective_to is null")
    expect(body).toContain('e.tournament_id <> v_tournament')
    const panel = read('src/components/OrganizerTeamPlayers.tsx')
    expect(panel).toContain('Copy previous roster')
    expect(panel).toContain('RECORD_STATUS_LABELS[statuses.get(player.id)')
  })
  it('never keeps the ID card typed on the create page', () => {
    const page = read('src/components/AdminCreate.tsx')
    expect(page).toContain("setNationalId('')")
    expect(page).not.toMatch(/console\.|localStorage/)
  })
})
