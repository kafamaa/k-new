import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parsePublicHash } from './publicRoutes'
import { loadPublicPerson, saveMyPublicProfile, PENDING_047 } from './publicPeople'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/202611030047_public_coach_referee_profiles.sql'), 'utf8')
const rpcClient = (result: { data?: unknown; error?: { message: string } | null }, calls: string[] = []) => ({ rpc: (name: string) => { calls.push(name); return Promise.resolve({ data: result.data ?? null, error: result.error ?? null }) } }) as unknown as SupabaseClient

describe('coach and referee routes', () => {
  it('parses directories and profiles', () => {
    expect(parsePublicHash('#coaches')).toEqual({ kind: 'people', role: 'coach' })
    expect(parsePublicHash('#referees')).toEqual({ kind: 'people', role: 'referee' })
    expect(parsePublicHash('#referee/1b4e28ba-2fa1-11d2-883f-0016d3cca427')).toEqual({ kind: 'person', role: 'referee', slug: '1b4e28ba-2fa1-11d2-883f-0016d3cca427' })
    expect(parsePublicHash('#coach/x/y')).toEqual({ kind: 'not-found' })
  })
})

describe('public people', () => {
  it('never asks the server for a malformed id', async () => {
    const calls: string[] = []
    expect(await loadPublicPerson(rpcClient({}, calls), "x' or 1=1")).toEqual({ data: null, state: 'ready' })
    expect(calls).toEqual([])
  })

  it('explains a missing role and a missing update in plain words', async () => {
    expect((await saveMyPublicProfile(rpcClient({ error: { message: 'role_not_held' } }), { role: 'referee', isPublic: true, name: 'Ahmed', island: '', bio: '' })).error).toMatch(/match assignment/)
    expect((await saveMyPublicProfile(rpcClient({ error: { message: 'function public.save_public_person_profile does not exist' } }), { role: 'coach', isPublic: true, name: 'Ali', island: '', bio: '' })).error).toBe(PENDING_047)
  })

  it('is opt-in and exposes no contact or account data', () => {
    expect(sql).toContain('is_public boolean not null default false')
    expect(sql).toContain("raise exception 'role_not_held'")
    expect(sql).toContain('where p.role = p_role and p.is_public and public.person_holds_role(p.user_id, p.role)')
    const publicFunctions = sql.slice(sql.indexOf('create or replace function public.get_public_people'))
    for (const field of ['email', 'phone', 'user_id\'', 'avatar']) expect(publicFunctions).not.toContain(field)
    expect(sql).toContain('revoke execute on function public.person_holds_role(uuid, text) from public, anon, authenticated')
  })
})
