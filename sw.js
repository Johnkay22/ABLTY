// ABLTY Service Worker v14
// Strategy: network-first for HTML, cache-first for static assets
// Includes update detection to notify users of new versions

const CACHE_NAME = 'ablty-v14';
const STATIC_ASSETS = [
  '/',
  '/app.html',
];

// -- Install: cache static assets and activate immediately -----
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(STATIC_ASSETS);

      // If there is already an active worker, this install represents an update.
      // Notify open clients so the app can show a refresh banner immediately.
      if (self.registration.active) {
        const allClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        allClients.forEach((client) => {
          client.postMessage({ type: 'UPDATE_READY' });
        });
      }
    })()
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
  let body = '';
  let url  = '/app.html?rc=1';
  let tag  = 'ablty-rc';
  let silent = false;

  if (event.data) {
    try {
      const d = event.data.json();
      body = d.body || '';
    } catch(e) {
      body = event.data.text ? event.data.text() : '';
    }
  }

  // Detect WBTB notification types by body content
  if (body && body.includes('WBTB return')) {
    url  = '/app.html?wbtb=return';
    tag  = 'ablty-wbtb-return';
  } else if (body && body.includes('WBTB wake')) {
    url  = '/app.html?wbtb=1';
    tag  = 'ablty-wbtb';
  } else if (!body) {
    body = REALITY_CHECKS[Math.floor(Math.random() * REALITY_CHECKS.length)];
  }

  event.waitUntil(
    self.registration.showNotification('ABLTY', {
      body,
      icon:     '/icon-192.png',
      badge:    '/badge-72.png',
      tag,
      renotify: true,
      silent,
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const notifUrl = (event.notification.data && event.notification.data.url) || '/app.html?rc=1';
  const isWBTB       = notifUrl.includes('wbtb=1');
  const isWBTBReturn = notifUrl.includes('wbtb=return');
  const fullUrl  = self.location.origin + notifUrl;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({ type: isWBTBReturn ? 'WBTB_RETURN' : isWBTB ? 'WBTB_OPEN' : 'RC_OPEN' });
          return;
        }
      }
      return clients.openWindow(fullUrl);
    })
  );
});
