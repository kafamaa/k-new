import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { saveStatusLabel, useSaveStatus } from '../lib/saveStatus'

// Saving / Saved / Not saved, announced politely to screen readers.
export function SaveStatusBadge() {
  const status = useSaveStatus()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer) }, [])
  const Icon = status.state === 'saving' ? Loader2 : status.state === 'error' ? AlertTriangle : Check
  return <span className={`save-status save-${status.state}`} role="status" aria-live="polite" title={saveStatusLabel(status, now)}>
    <Icon size={14} className={status.state === 'saving' ? 'spin' : undefined} aria-hidden="true" />
    <span>{saveStatusLabel(status, now)}</span>
  </span>
}
