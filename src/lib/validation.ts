export type AuthInput = { email: string; password: string; name?: string }

export function validateAuthInput(input: AuthInput, signup: boolean): string | null {
  if (!input.email.trim() || !input.password || (signup && !input.name?.trim())) return 'Please complete all required fields.'
  if (!/^\S+@\S+\.\S+$/.test(input.email)) return 'Enter a valid email address.'
  if (input.password.length < 6) return 'Password must be at least 6 characters.'
  return null
}
