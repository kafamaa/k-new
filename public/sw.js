/* global self, caches, fetch, URL, Response */
// Kulhivaru+ service worker: makes the installed app open without a network.
// It caches only this site's own static files (the app shell and hashed build
// assets). API requests to Supabase are cross-origin and are never cached
// here, so private data is never stored by the service worker. Offline match
// work is kept by the app itself (see OfficialWorkspace).
const CACHE = 'kulhivaru-shell-v1'
// The published installed-app settings (Platform admin → Customization → SEO & install).
// Kept apart from the shell cache so a new release does not drop them.
const CONFIG_CACHE = 'kulhivaru-config-v1'
const MANIFEST_PATH = '/manifest.webmanifest'
const MEDIA_ICON = /^https:\/\/[A-Za-z0-9.-]+\/storage\/v1\/object\/public\/platform-media\/[A-Za-z0-9/_.-]{1,200}\.png$/i
const HEX = /^#[0-9a-fA-F]{6}$/
const SAFE_TEXT = /^[^<>{}]{2,160}$/

// Accepts only the fixed manifest shape the app builds (appConfig.manifestFor).
function validManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return false
  const text = value => typeof value === 'string' && SAFE_TEXT.test(value)
  if (!text(manifest.name) || manifest.name.length > 30 || !text(manifest.short_name) || manifest.short_name.length > 30 || !text(manifest.description)) return false
  if (!HEX.test(manifest.theme_color) || !HEX.test(manifest.background_color)) return false
  if (manifest.start_url !== '/' || manifest.scope !== '/' || manifest.id !== '/') return false
  return Array.isArray(manifest.icons) && manifest.icons.length <= 4 && manifest.icons.every(icon => icon && typeof icon.src === 'string' && (MEDIA_ICON.test(icon.src) || icon.src === self.location.origin + '/assets/kulhivaru-mark.png'))
}

self.addEventListener('message', event => {
  const data = event.data
  if (!data || data.type !== 'kulhivaru:manifest') return
  const source = event.source
  if (!source || typeof source.url !== 'string' || new URL(source.url).origin !== self.location.origin) return
  event.waitUntil(caches.open(CONFIG_CACHE).then(cache => {
    if (data.manifest === null) return cache.delete(MANIFEST_PATH)
    if (!validManifest(data.manifest)) return undefined
    const body = JSON.stringify({ ...data.manifest, display: 'standalone', orientation: 'portrait-primary' })
    return cache.put(MANIFEST_PATH, new Response(body, { headers: { 'Content-Type': 'application/manifest+json' } }))
  }))
})
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/assets/kulhivaru-mark.png']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE && key !== CONFIG_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // The manifest: the published settings when there are any, otherwise the built-in file.
  if (url.pathname === MANIFEST_PATH) {
    event.respondWith(caches.open(CONFIG_CACHE).then(cache => cache.match(MANIFEST_PATH)).then(custom => custom || fetch(request).catch(() => caches.match(MANIFEST_PATH))))
    return
  }

  // Pages: network first so a new release is picked up, cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone()
      caches.open(CACHE).then(cache => cache.put('/index.html', copy))
      return response
    }).catch(() => caches.match('/index.html')))
    return
  }

  // Hashed build assets never change for a given URL: cache first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)) }
      return response
    })))
  }
})
