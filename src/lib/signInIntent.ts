// Where to go after sign-in when the visitor started from "Create tournament".
// Only a fixed, known value is ever stored, in sessionStorage for this tab.
const KEY = 'kulhivaru.after-sign-in'

export type SignInIntent = 'organizer'

export function saveSignInIntent(intent: SignInIntent): void {
  try { sessionStorage.setItem(KEY, intent) } catch { /* storage blocked: the visitor lands on Choose Workspace */ }
}

export function takeSignInIntent(): SignInIntent | null {
  try {
    const value = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return value === 'organizer' ? value : null
  } catch { return null }
}
