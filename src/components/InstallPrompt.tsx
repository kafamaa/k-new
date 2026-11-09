import { useState } from 'react'
import { Download, X } from 'lucide-react'
import { DISMISSED_KEY, engaged, promptInstall, recentlyDismissed, useInstallAvailable } from '../lib/install'
import { DEFAULT_INSTALL } from '../lib/appConfig'
import { useAppConfig } from '../lib/useAppConfig'

// Shown only when the browser supports installing, the app is not installed,
// the visitor has engaged, and they have not said "Not now" recently.
export function InstallPrompt() {
  const available = useInstallAvailable()
  const pwa = useAppConfig().config.pwa
  const [hidden, setHidden] = useState(() => recentlyDismissed() || !engaged())
  if (!available || hidden) return null
  const dismiss = () => { try { localStorage.setItem(DISMISSED_KEY, String(Date.now())) } catch { /* storage unavailable */ } setHidden(true) }
  return <aside className="lp-install" role="dialog" aria-labelledby="install-title" aria-describedby="install-text">
    <span className="lp-install-icon" aria-hidden="true"><Download size={20} /></span>
    <span><strong id="install-title">{pwa?.installTitle ?? DEFAULT_INSTALL.installTitle}</strong><small id="install-text">{pwa?.installText ?? DEFAULT_INSTALL.installText}</small></span>
    <span className="lp-install-actions"><button type="button" className="ed-btn ed-btn-primary ed-btn-sm" onClick={() => void promptInstall().then(() => setHidden(true))}>Install</button><button type="button" className="ed-btn ed-btn-ghost ed-btn-sm" onClick={dismiss}>Not Now</button></span>
    <button type="button" className="lp-install-close" aria-label="Close" onClick={dismiss}><X size={16} /></button>
  </aside>
}
