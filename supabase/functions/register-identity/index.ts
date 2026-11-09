// Trusted identity registration (Product Specification 6.4 / 16.3). The
// readable ID number is normalized and turned into a keyed HMAC digest here and
// is never stored, logged, or returned. Required secrets: SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, IDENTITY_HMAC_SECRET.
// Never log request bodies.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const DOCUMENT_TYPES = ['passport', 'national_id', 'residence_permit']

// Maldivian national ID cards read "A" followed by six digits.
export function normalizeMaldivianId(value: string): string | null {
  const normalized = value.toUpperCase().replace(/[\s-]/g, '')
  return /^A\d{6}$/.test(normalized) ? normalized : null
}

export function normalizeForeignDocument(documentType: string, country: string, number: string): string | null {
  const type = documentType.trim().toLowerCase()
  const issuing = country.trim().toUpperCase()
  const value = number.toUpperCase().replace(/[\s-]/g, '')
  if (!DOCUMENT_TYPES.includes(type) || !/^[A-Z]{2}$/.test(issuing) || !/^[A-Z0-9]{4,20}$/.test(value)) return null
  return `${type}|${issuing}|${value}`
}

// Same bytea hex form used for invitation digests.
async function digest(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
  return `\\x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Sign-in required' }, 401)
    const publicClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: authData, error: authError } = await publicClient.auth.getUser()
    if (authError || !authData.user?.email_confirmed_at) return json({ error: 'Verified email required' }, 403)
    const user = authData.user

    const body = await request.json() as { action?: string; entryId?: string; playerId?: string; identifierType?: string; value?: string; documentType?: string; issuingCountry?: string }
    const lookup = body.action === 'lookup'
    if ((!lookup && !body.playerId) || (lookup && !body.entryId) || !body.value) return json({ error: 'Player and identifier are required' }, 400)
    const foreign = body.identifierType === 'foreign_document'
    const normalized = foreign ? normalizeForeignDocument(body.documentType ?? '', body.issuingCountry ?? '', body.value) : normalizeMaldivianId(body.value)
    if (!normalized) return json({ error: foreign ? 'Enter a valid document type, two-letter issuing country, and document number.' : 'Enter a Maldivian ID card number in the form A123456.' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Lookup (final specification, page 42): an exact ID match reuses the existing
    // player instead of creating a duplicate. Only someone who can already see this
    // tournament entry under row-level security (its organizers, or the team's own
    // managers) may ask, and only the record and its display name are returned.
    if (lookup) {
      const { data: entry } = await publicClient.from('tournament_entries').select('id').eq('id', body.entryId!).maybeSingle()
      if (!entry) return json({ error: 'You cannot add players to this team entry' }, 403)
      const lookupSecret = Deno.env.get('IDENTITY_HMAC_SECRET')
      if (!lookupSecret || lookupSecret.length < 32) return json({ error: 'identity_not_configured' }, 503)
      const { data: match } = await admin.from('player_identity_keys').select('player_id').eq('keyed_digest', await digest(normalized, lookupSecret)).maybeSingle()
      if (!match) return json({ status: 'no_match' }, 200)
      const { data: found } = await admin.from('player_profiles').select('id,display_name,merged_into').eq('id', match.player_id).maybeSingle()
      // A merged record points to the one that replaced it.
      const canonical = found?.merged_into ? (await admin.from('player_profiles').select('id,display_name').eq('id', found.merged_into).maybeSingle()).data : found
      if (!canonical) return json({ status: 'no_match' }, 200)
      await admin.from('audit_events').insert({ actor_id: user.id, action: 'player_identity_matched', entity_type: 'player_profile', entity_id: canonical.id, reason: 'Roster entry reused an existing player by ID' })
      return json({ status: 'match', playerId: canonical.id, displayName: canonical.display_name }, 200)
    }
    const { data: player } = await admin.from('player_profiles').select('id,account_id,created_by').eq('id', body.playerId).maybeSingle()
    // The player themself, or the organizer/team manager who created the record.
    if (!player || (player.account_id !== user.id && !(player.account_id === null && player.created_by === user.id))) return json({ error: 'You cannot register an identity for this profile' }, 403)

    const secret = Deno.env.get('IDENTITY_HMAC_SECRET')
    // Without the secret no digest can be made; refuse clearly instead of failing.
    if (!secret || secret.length < 32) return json({ error: 'identity_not_configured' }, 503)
    const keyedDigest = await digest(normalized, secret)
    const { data: existing } = await admin.from('player_identity_keys').select('player_id,linked_account_id').eq('keyed_digest', keyedDigest).maybeSingle()
    if (existing) {
      if (existing.player_id === player.id) return json({ status: 'already_registered' }, 200)
      // Never reveal whose record or account holds this identity.
      return json({ status: 'identity_in_use', message: existing.linked_account_id ? 'This identity already belongs to an account. Sign in to that account or use account recovery; a second account cannot be created.' : 'This identity already matches another player record. Ask the organizer for that record\'s private claim invitation instead of creating a duplicate.' }, 409)
    }
    const { data: ownKey } = await admin.from('player_identity_keys').select('id').eq('player_id', player.id).maybeSingle()
    if (ownKey) return json({ status: 'profile_has_identity', message: 'This profile already has a registered identity. Contact the organizer to correct it.' }, 409)

    const { error } = await admin.from('player_identity_keys').insert({
      player_id: player.id,
      identifier_type: foreign ? 'foreign_document' : 'maldivian_national_id',
      issuing_country: foreign ? (body.issuingCountry ?? '').trim().toUpperCase() : null,
      keyed_digest: keyedDigest,
      linked_account_id: player.account_id,
      created_by: user.id,
    })
    if (error) return json({ status: 'identity_in_use', message: 'This identity could not be registered because it is already in use.' }, 409)
    await admin.from('audit_events').insert({ actor_id: user.id, action: 'player_identity_registered', entity_type: 'player_profile', entity_id: player.id, reason: foreign ? 'Foreign document digest' : 'Maldivian national ID digest' })
    return json({ status: 'registered' }, 200)
  } catch { return json({ error: 'Identity could not be registered' }, 500) }
})
