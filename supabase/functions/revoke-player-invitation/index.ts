import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authorization = request.headers.get('Authorization'); if (!authorization) throw new Error('Sign-in required')
    const publicClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: authData, error: authError } = await publicClient.auth.getUser(); if (authError || !authData.user) throw new Error('Sign-in required')
    const body = await request.json() as { invitationId?: string }; if (!body.invitationId) throw new Error('Invitation required')
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: invitation } = await admin.from('claim_invitations').select('id,player_id,created_by,accepted_at').eq('id', body.invitationId).maybeSingle()
    if (!invitation || invitation.created_by !== authData.user.id || invitation.accepted_at) throw new Error('Invitation cannot be revoked')
    const { error } = await admin.from('claim_invitations').update({ revoked_at: new Date().toISOString() }).eq('id', invitation.id).is('revoked_at', null)
    if (error) throw new Error('Invitation could not be revoked')
    return new Response(JSON.stringify({ revoked: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (error) { return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Invitation could not be revoked' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }) }
})
