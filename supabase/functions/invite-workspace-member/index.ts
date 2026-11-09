// Trusted team / organization invitation creation. The raw token is returned
// once to the authorized inviter for delivery outside the app; only its HMAC
// digest is stored. Required secrets: SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, CLAIM_TOKEN_HMAC_SECRET. Never log tokens.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

// Roles an invitation may grant; matches accept-workspace-invitation.
const TEAM_ROLES = ['manager', 'staff']
const ORGANIZATION_ROLES = ['staff', 'finance', 'operations', 'media']

// Same bytea hex form as the acceptance lookup.
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
    if (authError || !authData.user) return json({ error: 'Sign-in required' }, 401)
    const user = authData.user

    const body = await request.json() as { workspaceType?: string; workspaceId?: string; role?: string; invitedEmail?: string }
    const isTeam = body.workspaceType === 'team'
    if (!body.workspaceId || (!isTeam && body.workspaceType !== 'organization')) return json({ error: 'Workspace required' }, 400)
    if (!body.role || !(isTeam ? TEAM_ROLES : ORGANIZATION_ROLES).includes(body.role)) return json({ error: 'Unsupported role' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    // Team managers invite to their team; organization owners invite to theirs.
    const membership = isTeam
      ? await admin.from('team_memberships').select('role').eq('team_id', body.workspaceId).eq('user_id', user.id).maybeSingle()
      : await admin.from('organization_memberships').select('role').eq('organization_id', body.workspaceId).eq('user_id', user.id).maybeSingle()
    if (!membership.data || membership.data.role !== (isTeam ? 'manager' : 'owner')) return json({ error: 'Only a team manager or organization owner can invite members' }, 403)

    const raw = encode(crypto.getRandomValues(new Uint8Array(32)))
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
    const { error } = await admin.from('workspace_invitations').insert({
      workspace_type: isTeam ? 'team' : 'organization',
      team_id: isTeam ? body.workspaceId : null,
      organization_id: isTeam ? null : body.workspaceId,
      invited_email: body.invitedEmail?.trim().toLowerCase() || null,
      token_digest: await digest(raw, Deno.env.get('CLAIM_TOKEN_HMAC_SECRET')!),
      role: body.role,
      expires_at: expiresAt,
      created_by: user.id,
    })
    if (error) return json({ error: 'Invitation could not be created' }, 400)
    return json({ invitationToken: raw, expiresAt }, 200)
  } catch { return json({ error: 'Invitation could not be created' }, 500) }
})
