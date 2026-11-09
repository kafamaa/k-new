import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { authProblem, isSafeReturnHash, passwordProblem } from './authFlow'
import { parsePublicHash } from './publicRoutes'

const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('authentication pages', () => {
  it('turns auth service errors into plain language', () => {
    expect(authProblem('Invalid login credentials').message).toMatch(/do not match/)
    expect(authProblem('Email not confirmed')).toEqual({ message: expect.stringMatching(/verify your email/), resendVerification: true })
    expect(authProblem('User already registered').message).toMatch(/already exists/)
    expect(authProblem('Email rate limit exceeded').message).toMatch(/wait a minute/)
    expect(authProblem('AuthApiError: JWT expired').message).toMatch(/expired/)
    for (const raw of ['duplicate key value violates unique constraint "x"', 'PGRST301', 'new row violates row-level security']) expect(authProblem(raw).message).toBe('Something went wrong. Please try again.')
  })
  it('requires 8 characters for new passwords and matching confirmation', () => {
    expect(passwordProblem('short')).toMatch(/8 characters/)
    expect(passwordProblem('long enough 1', 'different')).toMatch(/do not match/)
    expect(passwordProblem('long enough 1', 'long enough 1')).toBeNull()
  })
  it('only links back to known pages inside the app', () => {
    for (const hash of ['#reset-password', '#workspace', '#workspace/player/abc-123', '#register/kanditheemu-cup', '#register/kanditheemu-cup?category=open']) expect(isSafeReturnHash(hash)).toBe(true)
    for (const hash of ['https://evil.example', '//evil.example', '#register/x?next=https://evil', '#admin', 'javascript:alert(1)']) expect(isSafeReturnHash(hash)).toBe(false)
  })
  it('sends recovery and verification emails back into the app', () => {
    expect(app).toContain("resetPasswordForEmail(form.email.trim(), { redirectTo: appLink('#reset-password') })")
    expect(app).toContain('emailRedirectTo: appLink(')
    expect(app).toContain("if (event === 'PASSWORD_RECOVERY')")
    expect(app).not.toMatch(/setError\(result\.error\.message\)/)
  })
  it('answers the same whether or not an account exists', () => {
    expect(app.match(/If an account exists for that email, a reset link has been sent\./g)?.length).toBe(2)
  })
})

describe('routes', () => {
  it('has reset-password and not-found pages without breaking in-page anchors', () => {
    expect(parsePublicHash('#reset-password')).toEqual({ kind: 'reset-password' })
    expect(parsePublicHash('#private/settings')).toEqual({ kind: 'not-found' })
    expect(parsePublicHash('#how-it-works')).toEqual({ kind: 'home' })
    expect(parsePublicHash('#access_token=abc&type=recovery')).toEqual({ kind: 'home' })
  })
})
