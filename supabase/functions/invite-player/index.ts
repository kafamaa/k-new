// Trusted invitation creation. The raw token is returned once to the authorized
// organizer for delivery; only its HMAC digest is persisted.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
// token_digest is bytea: write it in Postgres hex input form (\x...), the exact
// format claim-player uses for its lookup, so a stored digest can be matched.
async function digest(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
  return `\\x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authorization = request.headers.get('Authorization'); if (!authorization) throw new Error('Sign-in required')
    const publicClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: authData, error: authError } = await publicClient.auth.getUser(); if (authError || !authData.user) throw new Error('Sign-in required')
    const body = await request.json() as { playerId?: string; invitedEmail?: string }
    if (!body.playerId) throw new Error('Player profile required')
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: player } = await admin.from('player_profiles').select('id,created_by,account_id,is_claimed').eq('id', body.playerId).maybeSingle()
    if (!player || player.created_by !== authData.user.id || player.account_id || player.is_claimed) throw new Error('Only the record creator may invite an unclaimed profile')
    const raw = encode(crypto.getRandomValues(new Uint8Array(32))); const tokenDigest = await digest(raw, Deno.env.get('CLAIM_TOKEN_HMAC_SECRET')!); const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
    const { error } = await admin.from('claim_invitations').insert({ player_id: player.id, invited_email: body.invitedEmail?.trim().toLowerCase() || null, token_digest: tokenDigest, expires_at: expiresAt, created_by: authData.user.id })
    if (error) throw new Error('Invitation could not be created')
    return new Response(JSON.stringify({ invitationToken: raw, expiresAt }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (error) { return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Invitation could not be created' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }) }
})
