import type { SupabaseClient } from '@supabase/supabase-js'
import { saveSetupStep } from './tournament'
import { addTournamentCategory } from './organizer'
import { parseVenues } from './simpleFlow'

// Optional details on Create (owner, 2026-11-02). Only name and sport are
// required. Anything filled in here is saved into the same setup records the
// tournament settings use (Basics, Rules, Venues and dates, Categories), so it
// can be changed later under More and nothing is stored twice.
export type CreateDetails = {
  season: string; atoll: string; island: string; venues: string
  startsAt: string; endsAt: string; description: string; rules: string; categories: string
}
export const EMPTY_CREATE_DETAILS: CreateDetails = { season: '', atoll: '', island: '', venues: '', startsAt: '', endsAt: '', description: '', rules: '', categories: '' }

export function createDetailsProblem(details: CreateDetails): string | null {
  if (details.startsAt && details.endsAt && details.endsAt < details.startsAt) return 'The end date cannot be before the start date.'
  if (details.description.length > 2000) return 'Keep the description under 2,000 characters.'
  return null
}

export function parseCategories(value: string): string[] {
  return [...new Set(value.split(/[,\n]/).map(item => item.trim()).filter(Boolean))].slice(0, 12)
}

// Setup records to write, by wizard stage. Empty values are left out, so
// nothing blank or invented is ever saved.
export function createDetailSteps(name: string, sport: string, details: CreateDetails): Array<{ step: number; data: Record<string, unknown> }> {
  const clean = (record: Record<string, string | string[]>) => Object.fromEntries(Object.entries(record).filter(([, value]) => Array.isArray(value) ? value.length > 0 : value.trim() !== ''))
  const basics = clean({ season: details.season, atoll: details.atoll, island: details.island, description: details.description.trim() })
  const venues = parseVenues(details.venues)
  const schedule = clean({ startsAt: details.startsAt, endsAt: details.endsAt, venue: venues[0] ?? '', venues })
  const steps: Array<{ step: number; data: Record<string, unknown> }> = []
  if (Object.keys(basics).length) steps.push({ step: 1, data: { name, sport, ...basics } })
  if (details.rules.trim()) steps.push({ step: 7, data: { rules: details.rules.trim() } })
  if (Object.keys(schedule).length) steps.push({ step: 8, data: schedule })
  return steps
}

export async function saveCreateDetails(client: SupabaseClient, tournamentId: string, userId: string, name: string, sport: string, details: CreateDetails): Promise<{ failed: number }> {
  let failed = 0
  for (const item of createDetailSteps(name, sport, details)) {
    const result = await saveSetupStep(client, tournamentId, userId, item.step, 'in_progress', item.data, { enforceValidation: false })
    if (result.error) failed += 1
  }
  for (const category of parseCategories(details.categories)) {
    const result = await addTournamentCategory(client, tournamentId, category)
    if (result.error) failed += 1
  }
  return { failed }
}
