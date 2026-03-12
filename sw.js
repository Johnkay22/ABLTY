// ABLTY Service Worker
// Handles: offline caching, push notifications, background sync

const CACHE_NAME = 'ablty-v1';
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
  'Reality check. Are you dreaming right now?',
  'Stop. Look at your hands. Count your fingers.',
  'Reality check. Can you read this twice?',
  'Pinch your nose. Can you still breathe?',
  'State check. Where are you? How did you get here?',
  'Look around. Does anything seem off?',
];

self.addEventListener('push', event => {
  let title = 'ABLTY';
  let body  = REALITY_CHECKS[Math.floor(Math.random() * REALITY_CHECKS.length)];

  if (event.data) {
    try {
      const data = event.data.json();
      if (data.title) title = data.title;
      if (data.body)  body  = data.body;
    } catch(e) {
      const text = event.data.text();
      if (text) body = text;
    }
  }

  const options = {
    body,
    icon:     '/icons/icon-192.png',
    badge:    '/icons/icon-192.png',
    tag:      'ablty-reality-check',
    renotify: true,
    silent:   false,
    data:     { url: '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: open app ──────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing window if open
      for (const client of windowClients) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      // Otherwise open new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
