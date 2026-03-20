// ABLTY Service Worker v3
// Strategy: network-first for HTML, cache-first for static assets
// Includes update detection to notify users of new versions

const CACHE_NAME = 'ablty-v4';
const STATIC_ASSETS = [
  '/',
  '/app.html',
];

// -- Install: cache static assets and activate immediately -----
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  // Don't skipWaiting here - we want to notify the user instead
  // so they can choose when to update
});

// -- Activate: clean out old caches ----------------------------
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

// -- Fetch: network-first for HTML, cache-first for everything else --
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  const isHTMLRequest =
    event.request.mode === 'navigate' ||
    event.request.headers.get('accept')?.includes('text/html');

  if (isHTMLRequest) {
    // NETWORK FIRST for HTML
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match('/app.html');
        })
    );
  } else {
    // CACHE FIRST for everything else (images, fonts, etc.)
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => {
          if (event.request.mode === 'navigate') {
            return caches.match('/app.html');
          }
        });
      })
    );
  }
});

// -- Update detection ------------------------------------------
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// -- Push: receive and display notification -------------------
const REALITY_CHECKS = [
  'Are you dreaming right now?',
  'Stop. Perform a reality check.',
  'Reality check time.',
  'Are you awake? Check now.',
  'Perform a reality check.',
  'Look around. Are things normal?',
  'Pause. Check your reality.',
  'Is this a dream?',
];

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}

  const msg = data.body ||
    REALITY_CHECKS[Math.floor(Math.random() * REALITY_CHECKS.length)];

  event.waitUntil(
    self.registration.showNotification('ABLTY', {
      body: msg,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      tag: 'ablty-rc',
      renotify: true,
      data: { url: '/app.html?rc=1' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'RC_OPEN' });
          return;
        }
      }
      return clients.openWindow('/app.html?rc=1');
    })
  );
});
