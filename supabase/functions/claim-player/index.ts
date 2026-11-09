// Trusted claim flow. Deploy only as an Edge Function with server-side secrets.
// Required secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
// CLAIM_TOKEN_HMAC_SECRET. Never log request bodies, raw tokens, or identity IDs.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

async function digest(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
  return `\\x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return new Response(JSON.stringify({ error: 'Sign-in required' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    const publicClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: authData, error: authError } = await publicClient.auth.getUser()
    if (authError || !authData.user?.email_confirmed_at) return new Response(JSON.stringify({ error: 'Verified email required' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
    const body = await request.json() as { invitationToken?: string }
    if (!body.invitationToken || body.invitationToken.length < 20) return new Response(JSON.stringify({ error: 'Invalid invitation' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const tokenDigest = await digest(body.invitationToken, Deno.env.get('CLAIM_TOKEN_HMAC_SECRET')!)
    const { data: invitation, error: invitationError } = await admin.from('claim_invitations').select('id,player_id,invited_email,expires_at,revoked_at,accepted_at').eq('token_digest', tokenDigest).maybeSingle()
    if (invitationError || !invitation || invitation.revoked_at || invitation.accepted_at || new Date(invitation.expires_at) <= new Date() || (invitation.invited_email && invitation.invited_email.toLowerCase() !== authData.user.email?.toLowerCase())) return new Response(JSON.stringify({ error: 'Invitation is invalid or expired' }), { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } })
    const { data: claimedPlayer, error: claimError } = await admin.rpc('claim_player_profile', { p_invitation_id: invitation.id, p_player_id: invitation.player_id, p_account_id: authData.user.id })
    if (claimError?.message?.includes('guardian_approval_required')) return new Response(JSON.stringify({ error: 'This profile belongs to a minor. A guardian must approve the claim first; ask the organizer who added you.' }), { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } })
    if (claimError || !claimedPlayer) return new Response(JSON.stringify({ error: 'Profile claim could not be completed' }), { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ claimed: true, playerId: claimedPlayer }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch { return new Response(JSON.stringify({ error: 'Claim could not be completed' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }) }
})
