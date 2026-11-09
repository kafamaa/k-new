// Trusted team/organization invitation acceptance. Deploy only as an Edge
// Function with server-side secrets. Required secrets: SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CLAIM_TOKEN_HMAC_SECRET.
// Never log request bodies, raw tokens, or email addresses.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Roles an invitation may grant. Ownership is never handed out by invitation.
const TEAM_ROLES = ['manager', 'staff']
const ORGANIZATION_ROLES = ['staff', 'finance', 'operations', 'media']

// Same bytea hex form as invite-player / claim-player.
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

    const body = await request.json() as { invitationToken?: string }
    if (!body.invitationToken || body.invitationToken.length < 20) return json({ error: 'Invalid invitation' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const tokenDigest = await digest(body.invitationToken, Deno.env.get('CLAIM_TOKEN_HMAC_SECRET')!)
    const { data: invitation, error: invitationError } = await admin.from('workspace_invitations').select('id,workspace_type,team_id,organization_id,invited_email,role,expires_at,revoked_at,accepted_at').eq('token_digest', tokenDigest).maybeSingle()
    if (invitationError || !invitation || invitation.revoked_at || invitation.accepted_at || new Date(invitation.expires_at) <= new Date()) return json({ error: 'Invitation is invalid or expired' }, 409)
    if (invitation.invited_email && invitation.invited_email.toLowerCase() !== user.email?.toLowerCase()) return json({ error: 'Invitation is invalid or expired' }, 409)

    const isTeam = invitation.workspace_type === 'team'
    const workspaceId: string | null = isTeam ? invitation.team_id : invitation.organization_id
    if (!workspaceId || !(isTeam ? TEAM_ROLES : ORGANIZATION_ROLES).includes(invitation.role)) return json({ error: 'Invitation is invalid or expired' }, 409)

    // Mark accepted first, conditionally, so two concurrent requests cannot
    // both use one invitation.
    const { data: accepted, error: acceptError } = await admin.from('workspace_invitations').update({ accepted_at: new Date().toISOString() }).eq('id', invitation.id).is('accepted_at', null).is('revoked_at', null).select('id')
    if (acceptError || !accepted?.length) return json({ error: 'Invitation is invalid or expired' }, 409)

    const membership = isTeam
      ? await admin.from('team_memberships').insert({ team_id: workspaceId, user_id: user.id, role: invitation.role })
      : await admin.from('organization_memberships').insert({ organization_id: workspaceId, user_id: user.id, role: invitation.role })
    // 23505: the account is already a member. The invitation is consumed and
    // the existing role is kept, so an invitation never changes a role silently.
    if (membership.error && membership.error.code !== '23505') {
      await admin.from('workspace_invitations').update({ accepted_at: null }).eq('id', invitation.id)
      return json({ error: 'Invitation could not be accepted' }, 409)
    }

    await admin.from('audit_events').insert({ actor_id: user.id, action: 'workspace_invitation_accepted', entity_type: isTeam ? 'team' : 'organization', entity_id: workspaceId, reason: `Joined as ${invitation.role}` })
    return json({ workspaceType: invitation.workspace_type, workspaceId }, 200)
  } catch { return json({ error: 'Invitation could not be accepted' }, 500) }
})
