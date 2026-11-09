import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrations = resolve(process.cwd(), 'supabase/migrations')
const fix = readFileSync(resolve(migrations, '202610240021_team_official_workspace_access.sql'), 'utf8')
const entries = readFileSync(resolve(migrations, '202610210004_tournament_registration.sql'), 'utf8')

describe('review-only migration 202610240021 (team + official workspace access)', () => {
  it('adds the self-scoped official assignment read policy', () => {
    expect(fix).toContain('create policy "officials read own assignments" on public.match_official_assignments')
    expect(fix).toContain('for select to authenticated')
    expect(fix).toContain('using (user_id = auth.uid())')
  })
  it('adds the self-scoped tournament-staff assignment read policy', () => {
    expect(fix).toContain('create policy "assigned staff read own assignments" on public.tournament_staff_assignments')
  })
  it('adds the team-manager update policy on teams', () => {
    expect(fix).toContain('create policy "team managers update their team" on public.teams')
    expect(fix).toContain('using (public.is_team_manager(id)) with check (public.is_team_manager(id))')
  })
  it('adds the team-manager membership-end policy', () => {
    expect(fix).toContain('create policy "team managers end player memberships" on public.player_team_memberships')
  })
  it('adds an official_availability table owned by the caller', () => {
    expect(fix).toContain('create table if not exists public.official_availability')
    expect(fix).toContain('create policy "officials manage own availability" on public.official_availability')
    expect(fix).toContain('for all to authenticated')
    expect(fix).toContain('using (user_id = auth.uid()) with check (user_id = auth.uid())')
  })
  it('amends the entry-status trigger to allow withdrawal with guards', () => {
    expect(fix).toContain("if new.application_status not in ('draft','submitted','changes_requested','withdrawn')")
    expect(fix).toContain('team_manager_cannot_reopen_withdrawn_entry')
    expect(fix).toContain('team_manager_withdrawal_not_permitted_from_current_status')
  })
  it('never touches anon or public roles', () => {
    expect(fix).not.toMatch(/to anon|to public\b/i)
    expect(fix).not.toMatch(/grant .* to (anon|public)/i)
  })
  it('recreates the trigger rather than weakening the entries insert/update policies', () => {
    expect(fix).toContain('create or replace function public.protect_entry_statuses()')
    expect(fix).toContain('drop trigger if exists protect_entry_statuses_trigger')
  })
  it('does not duplicate the existing unique (tournament_id, team_id) constraint', () => {
    expect(entries).toContain('unique (tournament_id, team_id)')
  })
})