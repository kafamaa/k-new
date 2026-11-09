import { useSyncExternalStore } from 'react'

// One Saving / Saved / Not saved indicator for the workspaces (owner, 2026-11-02).
// Every change already saves as soon as it is made; this only reports that the
// write finished. Reads, sign-in and public loaders never count as saving.
export type SaveState = { state: 'idle' | 'saving' | 'saved' | 'error'; at: number | null }

const READ_RPC = /^(get_|is_|my_|search_|list_|load_|check_)|^(admin_permissions|player_identity_status|player_record_statuses|previous_roster_players|tournament_completion_checks)$/

export function isWriteRequest(method: string, url: string): boolean {
  const verb = method.toUpperCase()
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return false
  if (/\/auth\/v1\//.test(url)) return false
  // The profile refresh on sign-in is automatic, not a change the person made.
  if (/\/rest\/v1\/profiles(\?|$)/.test(url)) return false
  const rpc = /\/rest\/v1\/rpc\/([a-z0-9_]+)/i.exec(url)
  if (rpc) return !READ_RPC.test(rpc[1])
  // Signed-URL requests are reads even though they are POSTs.
  if (/\/storage\/v1\/object\/sign\//.test(url)) return false
  return /\/(rest|storage)\/v1\//.test(url)
}

let pending = 0
let current: SaveState = { state: 'idle', at: null }
const listeners = new Set<() => void>()
const publish = (next: SaveState) => { current = next; listeners.forEach(listener => listener()) }

export const saveStatusSnapshot = () => current
export function subscribeSaveStatus(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }

export function noteWriteStarted() { pending += 1; publish({ state: 'saving', at: current.at }) }
export function noteWriteFinished(ok: boolean) {
  pending = Math.max(0, pending - 1)
  if (!ok) publish({ state: 'error', at: Date.now() })
  else if (pending === 0) publish({ state: 'saved', at: Date.now() })
}

export const trackedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
  if (!isWriteRequest(method, url)) return fetch(input, init)
  noteWriteStarted()
  try {
    const response = await fetch(input, init)
    noteWriteFinished(response.ok)
    return response
  } catch (error) {
    noteWriteFinished(false)
    throw error
  }
}

export function useSaveStatus(): SaveState { return useSyncExternalStore(subscribeSaveStatus, saveStatusSnapshot, saveStatusSnapshot) }

export function saveStatusLabel(status: SaveState, now = Date.now()): string {
  if (status.state === 'saving') return 'Saving…'
  if (status.state === 'error') return 'Not saved. Check the message and try again.'
  if (status.state === 'saved' && status.at) {
    const seconds = Math.round((now - status.at) / 1000)
    return seconds < 60 ? 'Saved' : `Saved ${new Date(status.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Indian/Maldives' })}`
  }
  return 'All changes are saved automatically'
}
