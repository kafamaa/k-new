import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const migration = readFileSync(resolve(root, 'supabase/migrations/202610210002_persistent_records.sql'), 'utf8')
const claimFunction = readFileSync(resolve(root, 'supabase/functions/claim-player/index.ts'), 'utf8')
const inviteFunction = readFileSync(resolve(root, 'supabase/functions/invite-player/index.ts'), 'utf8')
const revokeFunction = readFileSync(resolve(root, 'supabase/functions/revoke-player-invitation/index.ts'), 'utf8')

describe('claim safeguards', () => {
  it('keeps the HMAC secret and raw identifier processing on trusted server paths', () => {
    expect(claimFunction).toContain('CLAIM_TOKEN_HMAC_SECRET')
    expect(inviteFunction).toContain('CLAIM_TOKEN_HMAC_SECRET')
    expect(claimFunction).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(inviteFunction).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(revokeFunction).toContain('SUPABASE_SERVICE_ROLE_KEY')
  })
  it('stores only unique token digests and enforces expiry/revocation', () => {
    expect(migration).toContain('token_digest bytea not null unique')
    expect(migration).toContain('expires_at timestamptz not null')
    expect(migration).toContain('revoked_at timestamptz')
    expect(claimFunction).toContain('invitation.revoked_at')
    expect(claimFunction).toContain('invitation.expires_at')
    expect(inviteFunction).toContain('tokenDigest')
  })
  it('claims atomically with row locks, one-time invitation state, and a unique account link', () => {
    expect(migration).toContain('select * into invitation from public.claim_invitations where id = p_invitation_id for update')
    expect(migration).toContain('select * into player from public.player_profiles where id = p_player_id for update')
    expect(migration).toContain('accepted_at is null')
    expect(migration).toContain('account_id uuid unique')
    expect(claimFunction).toContain("admin.rpc('claim_player_profile'")
  })
  it('keeps revocation as an explicit trusted operation', () => {
    expect(revokeFunction).toContain('revoked_at')
    expect(revokeFunction).toContain('accepted_at')
    expect(revokeFunction).toContain('created_by !== authData.user.id')
  })
})
