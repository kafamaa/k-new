// Sign-in, sign-up, verification and password recovery helpers. Errors from
// the auth service are turned into plain language; links sent by email only
// ever point back into this app (no open redirects).

export const PASSWORD_MIN = 8
export const PASSWORD_RULE = `At least ${PASSWORD_MIN} characters. A mix of letters and numbers is safer.`

export function passwordProblem(password: string, confirm?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  if (confirm !== undefined && password !== confirm) return 'The two passwords do not match.'
  return null
}

export type AuthProblem = { message: string; resendVerification?: boolean }
export function authProblem(raw: string | null | undefined): AuthProblem {
  const text = String(raw ?? '')
  if (/email not confirmed|not confirmed/i.test(text)) return { message: 'Please verify your email first. Open the link we sent you, or send it again.', resendVerification: true }
  if (/invalid login credentials|invalid.*password|invalid grant/i.test(text)) return { message: 'That email and password do not match. Check them, or reset your password.' }
  if (/already registered|already exists|user already/i.test(text)) return { message: 'An account with this email already exists. Sign in, or reset your password.' }
  if (/rate limit|too many|security purposes/i.test(text)) return { message: 'Too many attempts. Please wait a minute and try again.' }
  if (/weak|password should|at least/i.test(text)) return { message: `Choose a stronger password. ${PASSWORD_RULE}` }
  if (/same.*password|different from the old/i.test(text)) return { message: 'Choose a password you have not used for this account before.' }
  if (/expired|invalid.*(link|token)|otp/i.test(text)) return { message: 'This link has expired or was already used. Request a new one.' }
  if (/session|jwt|not authenticated|auth session missing/i.test(text)) return { message: 'Your session expired. Request a new reset link or sign in again.' }
  if (/fetch|network|failed to/i.test(text)) return { message: 'You appear to be offline. Check your connection and try again.' }
  if (/invalid.*email|email.*invalid|unable to validate email/i.test(text)) return { message: 'Enter a valid email address.' }
  return { message: 'Something went wrong. Please try again.' }
}

// Absolute link back into this app for emails. Only internal hash routes from
// a fixed list are allowed, so an attacker cannot make a link that leaves.
const ALLOWED_RETURN = /^#(reset-password|workspace(\/[a-z]+\/[a-zA-Z0-9-]+)?|(tournament\/[a-z0-9-]+\/register|register\/[a-z0-9-]+)(\?category=[A-Za-z0-9%_-]{1,80})?)?$/
export function appLink(hash = ''): string {
  const safe = ALLOWED_RETURN.test(hash) ? hash : ''
  return `${window.location.origin}${window.location.pathname}${safe}`
}
export const isSafeReturnHash = (hash: string) => ALLOWED_RETURN.test(hash)

// Account links: #signin, #signup and #forgot-password (Final specification, pages 16-18).
export function authModeFromHash(hash: string): 'signin' | 'signup' | 'recover' | null {
  const route = hash.replace(/^#\/?/, '').split('?')[0]
  return route === 'signin' ? 'signin' : route === 'signup' ? 'signup' : route === 'forgot-password' ? 'recover' : null
}
