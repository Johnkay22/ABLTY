// ABLTY Service Worker v3
// Strategy: network-first for HTML, cache-first for static assets
// Includes update detection to notify users of new versions

const CACHE_NAME = 'ablty-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
];

// \u2500\u2500 Install: cache static assets and activate immediately \u2500\u2500\u2500\u2500\u2500
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  // Don't skipWaiting here \u2014 we want to notify the user instead
  // so they can choose when to update
});

// \u2500\u2500 Activate: clean out old caches \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// \u2500\u2500 Fetch: network-first for HTML, cache-first for everything else \u2500\u2500
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  const isHTMLRequest =
    event.request.mode === 'navigate' ||
    event.request.headers.get('accept')?.includes('text/html');

  if (isHTMLRequest) {
    // NETWORK FIRST for HTML
    // Always tries to get the freshest version from GitHub Pages
    // Falls back to cache only if offline
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            // Update the cache with the fresh version
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline fallback
          return caches.match('/index.html');
        })
    );
  } else {
    // CACHE FIRST for everything else (images, fonts, etc.)
    // This keeps the app fast for assets that don't change often
    event.respondWith(