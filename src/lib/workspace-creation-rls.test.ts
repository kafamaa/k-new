import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Regression documentation for the workspace-creation RLS defect reported by the
// owner on 2026-10-23 ("new row violates row-level security policy for table
// organization_memberships" when creating an Organizer). The fix migration is
// prepared for review but intentionally NOT applied; these tests pin both the
// defect conditions and the exact content of the prepared fix file.

const migrations = resolve(process.cwd(), 'supabase/migrations')
const foundation = readFileSync(resolve(migrations, '202610210001_foundation.sql'), 'utf8')
const persistent = readFileSync(resolve(migrations, '202610210002_persistent_records.sql'), 'utf8')
const drafts = readFileSync(resolve(migrations, '202610210003_tournament_drafts.sql'), 'utf8')
const fix = readFileSync(resolve(migrations, '202610230015_organization_team_creator_read.sql'), 'utf8')

describe('workspace-creation RLS defect (why "Create Organizer" fails)', () => {
  it('requires an already-visible organization inside the membership insert check', () => {
    expect(persistent).toContain('create policy "organization creator assigns self owner" on public.organization_memberships for insert with check (')
    expect(persistent).toContain('exists (select 1 from public.organizations o where o.id = organization_id and o.created_by = auth.uid())')
  })
  it('gives organizations exactly one SELECT policy, which hides new unpublished rows', () => {
    const orgSelect = foundation.split('\n').filter(line => line.includes('on public.organizations for select'))
    expect(orgSelect).toHaveLength(1)
    expect(orgSelect[0]).toContain('is_published or exists')
    expect(foundation).toContain('is_published boolean not null default false')
  })
  it('has the identical defect shape for team creation', () => {
    expect(persistent).toContain('exists (select 1 from public.teams t where t.id = team_id and t.created_by = auth.uid())')
    const teamSelect = foundation.split('\n').filter(line => line.includes('on public.teams for select'))
    expect(teamSelect).toHaveLength(1)
    expect(teamSelect[0]).toContain('is_published or exists')
  })
  it('leaves tournament creation free of the defect (its checks read memberships, which exist by then)', () => {
    expect(drafts).toContain('om.role in (\'owner\',\'operations\')')
  })
})

describe('prepared fix migration 202610230015 (review-only, not applied)', () => {
  it('adds exactly two creator-read SELECT policies and nothing else executable', () => {
    const policyLines = fix.split('\n').map(line => line.trim()).filter(line => line.startsWith('create policy'))
    expect(policyLines).toEqual([
      'create policy "creators read their organizations" on public.organizations for select to authenticated using (created_by = auth.uid());',
      'create policy "creators read their teams" on public.teams for select to authenticated using (created_by = auth.uid());',
    ])
  })
  it('is purely additive: no drops, table changes, deletes, grants, or anon scoping', () => {
    expect(fix).not.toMatch(/drop policy|alter table|delete from|grant /i)
    for (const line of fix.split('\n').map(entry => entry.trim()).filter(entry => entry.startsWith('create policy'))) {
      expect(line).toContain('for select to authenticated')
      expect(line).toContain('created_by = auth.uid()')
      expect(line).not.toContain('with check')
    }
  })
  it('does not duplicate policies already present in applied migrations', () => {
    expect(foundation).not.toContain('creators read their organizations')
    expect(persistent).not.toContain('creators read their teams')
  })
})

describe('app creation flow shape (records.ts and onboarding error guidance)', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/records.ts'), 'utf8')
  const chooser = readFileSync(resolve(process.cwd(), 'src/components/WorkspaceChooser.tsx'), 'utf8')

  it('inserts each workspace row before its first membership and never reads the row back', () => {
    const orgInsert = source.indexOf(".from('organizations').insert(")
    const orgMembership = source.indexOf(".from('organization_memberships').insert(")
    const teamInsert = source.indexOf(".from('teams').insert(")
    const teamMembership = source.indexOf(".from('team_memberships').insert(")
    expect(orgInsert).toBeGreaterThan(-1)
    expect(orgMembership).toBeGreaterThan(orgInsert)
    expect(teamInsert).toBeGreaterThan(-1)
    expect(teamMembership).toBeGreaterThan(teamInsert)
    // No RETURNING/select on the pre-membership inserts: the new row is not
    // SELECT-visible to the creator until the fix policy or a membership exists.
    expect(source).not.toMatch(/from\('organizations'\)\.insert\([^)]*\)\.select/)
    expect(source).not.toMatch(/from\('teams'\)\.insert\([^)]*\)\.select/)
  })
  it('surfaces RLS creation failures for organizer and team choices without bypass advice', () => {
    expect(chooser).toMatch(/choice === 'organization' \|\| choice === 'team'/)
    expect(chooser).toContain('do not manually edit the database or bypass RLS')
  })
})
