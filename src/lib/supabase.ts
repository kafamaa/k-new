import { createClient } from '@supabase/supabase-js'
import { trackedFetch } from './saveStatus'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Writes through the signed-in client drive the Saving / Saved / Not saved indicator.
export const supabase = url && key ? createClient(url, key, { global: { fetch: trackedFetch } }) : null
export const publicSupabase = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null
export const isSupabaseConfigured = Boolean(supabase)

export function isSessionExpiredError(message: string | null | undefined): boolean {
  return Boolean(message && /jwt expired|invalid jwt|token has expired|refresh token/i.test(message))
}
