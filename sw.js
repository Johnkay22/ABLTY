// ABLTY Service Worker v91
// Strategy: network-first for HTML, cache-first for static assets
// Includes update detection to notify users of new versions

const CACHE_NAME = 'ablty-v91';
const STATIC_ASSETS = [
  '/',
  '/app.html',
  '/version.json',
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
    // Update probes (version.json?update_check=..., fetched with
    // cache: 'no-store') carry a unique URL each time; storing them would
    // grow the cache by one entry per check and they must never be served
    // from cache anyway.
    const storable = event.request.cache !== 'no-store';
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok && storable) {
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

// -- Update detection and notification hand-off ------------------
self.addEventListener('message', event => {
  const d = event.data;
  if (!d) return;
  if (d.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (d.type === 'NOTIFICATION_INTENT_PROBE_REPLY') {
    const onReply = intentProbes.get(d.intentId);
    if (onReply) onReply(event.source, d);
  } else if (d.type === 'NOTIFICATION_INTENT_ACK') {
    if (d.accepted) intentAccepted(d.intentId);
  } else if (d.type === 'NOTIFICATION_INTENT_CLAIM') {
    answerIntentClaim(event.source, d.intentId);
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
  let requireInteraction = false;
  let vibrate = [200];
  if (body && body.includes('WBTB return')) {
    url  = '/app.html?wbtb=return';
    tag  = 'ablty-wbtb-return';
    requireInteraction = true;
    vibrate = [300, 100, 300, 100, 300];
  } else if (body && body.includes('WBTB wake')) {
    url  = '/app.html?wbtb=1';
    tag  = 'ablty-wbtb';
    requireInteraction = true;
    vibrate = [500, 200, 500, 200, 500, 200, 500];
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
      requireInteraction,
      vibrate,
      silent,
      data: { url },
    })
  );
});

// -- Notification tap ------------------------------------------
// Each tap becomes one intent with an id. The app answers with an ACK once
// it has stored the intent (it may still be on the splash, onboarding or the
// Terms gate), and it acts on each id at most once.
//
// A browser allows one focus() or openWindow() per tap, so open app windows
// are asked first whether they are the installed app (a browser tab of
// app.html shows the "open the installed app" guard and says no), and only
// then is one of them focused, or a new one opened.
//
// An app window that is already open is never reloaded or replaced, however
// slowly it answers: it may hold an unsaved dream, sketch or session. A slow
// window handles the queued message once it catches up.
const APP_PATHS        = ['/app.html', '/app'];
const INTENT_PROBE_MS  = 1000;
// Keeps this worker alive while the app takes the tap, so a window that
// starts (or restarts) without the notification URL can still claim it.
const INTENT_LAUNCH_MS = 20000;

let launchingIntent = null;
const intentProbes = new Map();
const intentAcks   = new Map();

function newIntentId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function notificationTarget(notification) {
  const raw = (notification && notification.data && notification.data.url) || '/app.html?rc=1';
  let url = null;
  try { url = new URL(raw, self.location.origin); } catch (e) {}
  if (!url || url.origin !== self.location.origin) url = new URL('/app.html?rc=1', self.location.origin);
  const wbtb = url.searchParams.get('wbtb');
  const type = wbtb === 'return' ? 'WBTB_RETURN' : wbtb === '1' ? 'WBTB_OPEN' : 'RC_OPEN';
  return { type, url };
}

function isAppWindowUrl(href) {
  try {
    const u = new URL(href);
    return u.origin === self.location.origin && APP_PATHS.includes(u.pathname);
  } catch (e) {
    return false;
  }
}

function orderWindows(list) {
  const rank = c => (c.focused ? 0 : c.visibilityState === 'visible' ? 1 : 2);
  return list.map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(x => x.c);
}

function waitForAck(intentId, ms) {
  return new Promise(resolve => {
    const timer = setTimeout(() => { intentAcks.delete(intentId); resolve(false); }, ms);
    intentAcks.set(intentId, () => { clearTimeout(timer); intentAcks.delete(intentId); resolve(true); });
  });
}

function intentAccepted(intentId) {
  const done = intentAcks.get(intentId);
  if (done) done();
  if (launchingIntent && launchingIntent.id === intentId) launchingIntent = null;
}

// Resolves with a Map of client id -> true (installed app) / false (not).
// Windows that did not answer in time are missing from the map.
function probeAppWindows(intentId, candidates) {
  return new Promise(resolve => {
    const replies = new Map();
    const finish = () => { clearTimeout(timer); intentProbes.delete(intentId); resolve(replies); };
    const timer = setTimeout(finish, INTENT_PROBE_MS);
    intentProbes.set(intentId, (source, reply) => {
      if (!source || !candidates.some(c => c.id === source.id)) return;
      replies.set(source.id, !!reply.app);
      if (replies.size >= candidates.length) finish();
    });
    candidates.forEach(c => {
      try { c.postMessage({ type: 'NOTIFICATION_INTENT_PROBE', intentId }); } catch (e) {}
    });
  });
}

// A freshly started app window asks for the tap that launched it. If its
// URL already carries this intent it only confirms; otherwise (the platform
// opened the app without the notification URL) the intent is sent to it.
function answerIntentClaim(source, urlIntentId) {
  const intent = launchingIntent;
  if (!intent || !source) return;
  if (urlIntentId && urlIntentId === intent.id) { intentAccepted(intent.id); return; }
  try { source.postMessage({ type: intent.type, intentId: intent.id }); } catch (e) {}
}

async function handleNotificationClick(notification) {
  const target  = notificationTarget(notification);
  const intent  = { id: newIntentId(), type: target.type };
  const message = { type: intent.type, intentId: intent.id };
  target.url.searchParams.set('nid', intent.id);
  const launchUrl = target.url.href;

  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const candidates = orderWindows(all.filter(c => isAppWindowUrl(c.url)));

  let win = null;
  if (candidates.length) {
    const replies = await probeAppWindows(intent.id, candidates);
    // An app window frozen in the background only answers once focused.
    win = candidates.find(c => replies.get(c.id) === true)
      || candidates.find(c => !replies.has(c.id))
      || null;
  }

  launchingIntent = intent;
  const accepted = waitForAck(intent.id, INTENT_LAUNCH_MS);
  if (win) {
    try { await win.focus(); } catch (e) {}
    try { win.postMessage(message); } catch (e) {}
  } else {
    try { await self.clients.openWindow(launchUrl); } catch (e) {}
  }
  await accepted;
  if (launchingIntent === intent) launchingIntent = null;
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(handleNotificationClick(event.notification).catch(() => {}));
});
