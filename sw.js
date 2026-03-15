// ABLTY Service Worker
// Handles: offline caching, push notifications, background sync

const CACHE_NAME = 'ablty-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
];

// ── Install: cache static assets ─────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: serve from cache, fall back to network ─────
self.addEventListener('fetch', event => {
  // Only handle same-origin GET requests
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful responses for static assets
        if (response.ok && !event.request.url.includes('api.')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ── Push: receive and display notification ────────────
const REALITY_CHECKS = [
  'Are you dreaming right now?',
  'Stop. Perform a reality check.',
  'Reality check time.',
  'Are you awake? Check now.',
  'Perform a reality check.',
];

self.addEventListener('push', event => {
  let title = 'ABLTY';
  let body  = REALITY_CHECKS[Math.floor(Math.random() * REALITY_CHECKS.length)];
  let url   = '/#reality-check';

  if (event.data) {
    try {
      const data = event.data.json();
      if (data.title) title = data.title;
      if (data.body)  body  = data.body;
      if (data.url)   url   = data.url;
    } catch(e) {
      const text = event.data.text();
      if (text) body = text;
    }
  }

  const options = {
    body,
    icon:     '/icon-192.png',
    badge:    '/icon-192.png',
    tag:      'ablty-reality-check',
    renotify: true,
    silent:   false,
    data:     { url },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: open app ──────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const url = (event.notification.data && event.notification.data.url) || '/#reality-check';
  const fullUrl = self.location.origin + url;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.postMessage({ type: 'RC_OPEN' });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(fullUrl);
    })
  );
});
