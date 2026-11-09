import { useEffect, useState } from 'react'
import { activeConfig, activePlatform, type AppConfig, type PlatformConfig } from './appConfig'

// Re-renders when the published (or previewed) configuration changes.
export function useAppConfig(): { config: AppConfig; platform: PlatformConfig } {
  const [state, setState] = useState(() => ({ config: activeConfig(), platform: activePlatform() }))
  useEffect(() => {
    const update = () => setState({ config: activeConfig(), platform: activePlatform() })
    update()
    window.addEventListener('kulhivaru:config', update)
    return () => window.removeEventListener('kulhivaru:config', update)
  }, [])
  return state
}
