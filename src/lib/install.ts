import { useEffect, useState } from 'react'

// The browser's install event, captured once for the whole app so the header
// menu and footer can offer "Install App" too.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: InstallEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(listener => listener())
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferred = event as InstallEvent; notify() })
  window.addEventListener('appinstalled', () => { deferred = null; notify() })
}

export const DISMISSED_KEY = 'kulhivaru.install-dismissed-at'
const ENGAGED_KEY = 'kulhivaru.engagement'
const QUIET_DAYS = 14

export function isStandalone(): boolean {
  try { return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true } catch { return false }
}

export function useInstallAvailable(): boolean {
  const [available, setAvailable] = useState(() => Boolean(deferred) && !isStandalone())
  useEffect(() => { const update = () => setAvailable(Boolean(deferred) && !isStandalone()); listeners.add(update); return () => { listeners.delete(update) } }, [])
  return available
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const event = deferred
  await event.prompt()
  const choice = await event.userChoice
  deferred = null; notify()
  return choice.outcome === 'accepted'
}

// Meaningful engagement: a few public pages opened, counted across visits.
export function recordEngagement(): void {
  try { localStorage.setItem(ENGAGED_KEY, String(Number(localStorage.getItem(ENGAGED_KEY) ?? '0') + 1)) } catch { /* storage unavailable */ }
}
export function engaged(): boolean { try { return Number(localStorage.getItem(ENGAGED_KEY) ?? '0') >= 3 } catch { return false } }
export function recentlyDismissed(): boolean { try { const at = Number(localStorage.getItem(DISMISSED_KEY) ?? '0'); return Date.now() - at < QUIET_DAYS * 86_400_000 } catch { return false } }
