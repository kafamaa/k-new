import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addExistingTeamPlayer, organizerAddPlayer, searchUnclaimedPlayers } from './teamHub'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const file = readdirSync(resolve(process.cwd(), 'supabase/migrations')).find(name => name.endsWith('_manual_team_and_roster_entry.sql'))!
const sql = read(`supabase/migrations/${file}`)

// A client whose rpc answers with a fixed error, to check the plain-language mapping.
const failing = (message: string) => ({ rpc: async () => ({ data: null, error: { message } }), from: () => ({ delete: () => ({ eq: async () => ({}) }) }) }) as unknown as SupabaseClient

describe('manual team and roster entry — database rules', () => {
  it('never adds a player who has an account without their consent', () => {
    expect(sql).toContain("if claimed then raise exception 'player_claimed_invite_instead'; end if;")
    expect(sql).toContain('and (p.account_id is null')
    expect(sql).toContain("r.status in ('pending', 'info_requested')")
  })
  it('checks the caller and audits every add', () => {
    expect(sql).toContain("if not public.team_has_permission(p_team_id, 'manage_players') then raise exception 'team_permission_required'")
    expect(sql).toContain("not public.is_tournament_operator(entry.tournament_id) then raise exception 'organizer_permission_required'")
    expect(sql).toContain("values (auth.uid(), 'team_player_added', 'team', p_team_id, p_source)")
    expect(sql).toContain("raise exception 'duplicate_jersey'")
    expect(sql).toContain("if entry.roster_status = 'locked' then raise exception 'roster_locked'")
  })
  it('keeps the shared helper private and guests out', () => {
    expect(sql).toContain('revoke execute on function public.add_player_membership(uuid, uuid, text, integer, text) from public, anon, authenticated')
    for (const fn of ['add_team_player(uuid, uuid, text, integer)', 'organizer_add_team_player(uuid, uuid, text, integer)', 'get_entry_team_players(uuid)', 'search_unclaimed_players(text, uuid, uuid)']) expect(sql).toContain(`revoke execute on function public.${fn} from public, anon`)
  })
  // "position" is reserved in Postgres and cannot name a returns-table column (owner hit this when applying).
  it('does not use reserved words as output column names', () => {
    expect(sql).not.toMatch(/returns table\([^)]*\bposition text/)
    expect(sql).toContain('player_position text')
  })
  it('searches only names and islands of records the caller may know, ten at a most', () => {
    expect(sql).toContain('returns table(player_id uuid, display_name text, island text)')
    expect(sql).toContain('limit 10')
    expect(sql).toMatch(/p\.is_published or p\.created_by = auth\.uid\(\)/)
  })
})

describe('manual team and roster entry — app', () => {
  it('explains refusals in plain words', async () => {
    expect((await addExistingTeamPlayer(failing('player_claimed_invite_instead'), { teamId: 't', playerId: 'p', position: '', jerseyNumber: '' })).error).toMatch(/Send them an invitation/)
    expect((await addExistingTeamPlayer(failing('function public.add_team_player does not exist'), { teamId: 't', playerId: 'p', position: '', jerseyNumber: '' })).error).toMatch(/migration/)
    expect((await organizerAddPlayer(failing('duplicate_jersey'), { entryId: 'e', userId: 'u', playerId: 'p', name: '', island: '', position: '', jerseyNumber: '7', identity: null })).error).toMatch(/already wears/)
    expect((await searchUnclaimedPlayers(failing('x'), 'a', { teamId: 't' })).data).toEqual([])
  })
  it('offers the actions in the Team and Tournament workspaces', () => {
    const team = read('src/components/TeamHubTabs.tsx')
    // Owner design (2026-11-04): one Add Player flow finds existing players; creating a record stays here.
    expect(read('src/components/TeamSquad.tsx')).toContain('addExistingTeamPlayer(ctx.client')
    expect(team).toContain('Create new player')
    const tournament = read('src/components/TournamentWorkspace.tsx')
    expect(tournament).toContain('Create and enter team')
    expect(tournament).toContain('<OrganizerTeamPlayers')
    expect(read('src/components/OrganizerTeamPlayers.tsx')).toContain('submitRosterLines(client, entryId, userId, chosen)')
  })
})
