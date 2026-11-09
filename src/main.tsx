import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
// Loaded after the legacy stylesheet so the editorial layer takes precedence.
import './editorial.css'
import './landing.css'
import './landing-island.css'
import './home.css'
import './admin.css'
import './super-admin.css'
import './tournament-pages.css'
import './player-sections.css'
import './profile.css'
import './player-hub.css'
import './team-hub.css'
// Shared consistency fixes (dialog text, tap targets, focus, Thaana font).
// Before the workspace theme, which must stay last.
import './mockup-theme.css'
import './consistency.css'
import './workspace-island.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

// Installed-app shell caching (public/sw.js). Production only, so local
// development always loads fresh files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => undefined) })
}
