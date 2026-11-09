import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const claim = readFileSync(resolve(root, 'supabase/functions/claim-player/index.ts'), 'utf8')
const invite = readFileSync(resolve(root, 'supabase/functions/invite-player/index.ts'), 'utf8')
const revoke = readFileSync(resolve(root, 'supabase/functions/revoke-player-invitation/index.ts'), 'utf8')

describe('Edge Function security contracts', () => {
  it('keeps privileged clients and HMAC secrets server-side', () => {
    for (const source of [claim, invite, revoke]) { expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY'); expect(source).toContain('Deno.env'); expect(source).not.toContain('console.log') }
  })
  it('covers verified claim, invitation creation, and revocation paths', () => {
    expect(claim).toContain('email_confirmed_at'); expect(claim).toContain('claim_player_profile'); expect(claim).toContain('revoked_at')
    expect(invite).toContain('Only the record creator may invite an unclaimed profile'); expect(invite).toContain('tokenDigest')
    expect(revoke).toContain('created_by !== authData.user.id'); expect(revoke).toContain('revoked_at')
  })
})

const accept = readFileSync(resolve(root, 'supabase/functions/accept-workspace-invitation/index.ts'), 'utf8')

describe('invitation token digests', () => {
  // token_digest is bytea. Every function that writes or looks up a digest must
  // use the same Postgres hex form, otherwise a stored invitation can never match.
  const hexDigest = "`\\\\x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`"
  it('writes and reads the digest in the same bytea hex form', () => {
    for (const source of [invite, claim, accept]) expect(source).toContain(hexDigest)
  })
})

describe('workspace invitation acceptance', () => {
  it('exists for the client invoke and keeps privileged work server-side', () => {
    expect(accept).toContain('SUPABASE_SERVICE_ROLE_KEY'); expect(accept).toContain('CLAIM_TOKEN_HMAC_SECRET'); expect(accept).not.toContain('console.log')
    expect(accept).toContain('email_confirmed_at')
  })
  it('consumes an invitation once and never grants ownership', () => {
    expect(accept).toContain(".is('accepted_at', null).is('revoked_at', null)")
    expect(accept).toContain("const ORGANIZATION_ROLES = ['staff', 'finance', 'operations', 'media']")
    expect(accept).not.toMatch(/ORGANIZATION_ROLES = \[[^\]]*'owner'/)
  })
})
