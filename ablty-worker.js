// ABLTY Cloudflare Worker
// Routes:
//   POST /grade           - AI grading via Gemini
//   POST /subscribe       - Save push subscription
//   POST /wbtb-schedule   - Schedule WBTB push alarms
//   POST /wbtb-cancel     - Cancel WBTB alarms
//   POST /stripe-webhook  - Stripe subscription status webhook
//   GET  /ping            - Health check

const ALLOWED_ORIGINS = [
  'https://ablty.app',
  'https://www.ablty.app',
];

const STRIPE_TIER_EVENTS = new Set([
  'customer.subscription.created',
  'invoice.paid',
  'customer.subscription.deleted',
  'checkout.session.completed',
]);

// Returns CORS headers for a given request origin
function getCORS(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
    Vary: 'Origin',
  };
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCORS(origin), 'Content-Type': 'application/json' },
  });
}

function isAllowedOrigin(origin) {
  // Allow during local development (empty origin or localhost)
  if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([
      runRealityCheckCron(env),
      runWBTBCron(env),
    ]));
  },

  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCORS(origin) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/ping') return json({ status: 'ok' }, 200, origin);

    // Stripe sends webhooks server-to-server without browser Origin headers.
    // Signature verification on this route is the actual security gate.
    if (url.pathname === '/stripe-webhook' && request.method === 'POST') {
      return handleStripeWebhook(request, env);
    }

    // -- ORIGIN CHECK: all browser endpoints require allowed origin --
    if (!isAllowedOrigin(origin)) {
      return json({ error: 'Forbidden' }, 403, origin);
    }

    // -- ADMIN ENDPOINTS: disabled from browser entirely --
    if (url.pathname === '/debug' || url.pathname === '/send-push') {
      return json({ error: 'Not found' }, 404, origin);
    }

    if (url.pathname === '/grade' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rateLimitKey = 'ratelimit:grade:' + ip + ':' + new Date().toISOString().slice(0, 10);
      const current = parseInt(await env.ABLTY_KV.get(rateLimitKey) || '0', 10);
      if (current >= 100) {
        return json({ error: 'rate_limit', message: 'Too many requests. Try again tomorrow.' }, 429, origin);
      }
      await env.ABLTY_KV.put(rateLimitKey, String(current + 1), { expirationTtl: 86400 });
      return handleGrade(request, env, origin);
    }

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rlKey = 'ratelimit:sub:' + ip + ':' + new Date().toISOString().slice(0, 10);
      const count = parseInt(await env.ABLTY_KV.get(rlKey) || '0', 10);
      if (count >= 20) return json({ error: 'rate_limit' }, 429, origin);
      await env.ABLTY_KV.put(rlKey, String(count + 1), { expirationTtl: 86400 });
      return handleSubscribe(request, env, origin);
    }

    if (url.pathname === '/wbtb-schedule' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rlKey = 'ratelimit:wbtb:' + ip + ':' + new Date().toISOString().slice(0, 10);
      const count = parseInt(await env.ABLTY_KV.get(rlKey) || '0', 10);
      if (count >= 10) return json({ error: 'rate_limit' }, 429, origin);
      await env.ABLTY_KV.put(rlKey, String(count + 1), { expirationTtl: 86400 });
      return handleWBTBSchedule(request, env, origin);
    }

    if (url.pathname === '/wbtb-cancel' && request.method === 'POST') {
      return handleWBTBCancel(request, env, origin);
    }

    return json({ error: 'Not found' }, 404, origin);
  },
};

// --- STRIPE WEBHOOK ----------------------------------
async function handleStripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: 'Missing STRIPE_WEBHOOK_SECRET' }, 500, '');
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'Missing Supabase service credentials' }, 500, '');
  }

  const signature = request.headers.get('Stripe-Signature');
  if (!signature) return json({ error: 'Missing Stripe-Signature' }, 400, '');

  const rawBody = await request.text();

  let event;
  try {
    event = await verifyStripeWebhook(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return json({ error: 'Invalid signature', detail: e.message }, 400, '');
  }

  try {
    if (STRIPE_TIER_EVENTS.has(event?.type)) {
      await processStripeTierEvent(event, env);
    }
  } catch (e) {
    // Non-2xx response tells Stripe to retry later.
    return json({ error: 'Webhook processing failed', detail: e.message }, 500, '');
  }

  return json({ received: true }, 200, '');
}

async function processStripeTierEvent(event, env) {
  const eventType = event?.type || '';
  const obj = event?.data?.object || {};

  const targetTier = eventType === 'customer.subscription.deleted' ? 'free' : 'premium';
  const userId = await resolveSupabaseUserIdFromStripe(event, env);
  if (!userId) return;

  await updateProfileTierByUserId(userId, targetTier, env);

  const customerId = getStripeCustomerId(obj);
  if (customerId && env.ABLTY_KV) {
    await env.ABLTY_KV.put('stripe_customer:' + customerId, userId, { expirationTtl: 60 * 60 * 24 * 365 });
  }
}

function getStripeCustomerId(stripeObject) {
  const raw = stripeObject?.customer;
  if (typeof raw === 'string' && raw) return raw;
  if (raw && typeof raw === 'object' && typeof raw.id === 'string' && raw.id) return raw.id;
  return '';
}

function getStripeEmail(stripeObject) {
  return (
    stripeObject?.customer_email ||
    stripeObject?.email ||
    stripeObject?.receipt_email ||
    stripeObject?.customer_details?.email ||
    ''
  );
}

function parseUuidCandidate(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : '';
}

function getUserIdFromStripeObject(stripeObject) {
  const metadata = stripeObject?.metadata || {};
  return (
    parseUuidCandidate(metadata.supabase_user_id) ||
    parseUuidCandidate(metadata.user_id) ||
    parseUuidCandidate(stripeObject?.client_reference_id) ||
    ''
  );
}

async function resolveSupabaseUserIdFromStripe(event, env) {
  const obj = event?.data?.object || {};
  let userId = getUserIdFromStripeObject(obj);

  const customerId = getStripeCustomerId(obj);
  if (!userId && customerId && env.ABLTY_KV) {
    userId = await env.ABLTY_KV.get('stripe_customer:' + customerId);
  }

  if (!userId) {
    const email = getStripeEmail(obj);
    if (email) userId = await findSupabaseUserIdByEmail(email, env);
  }

  if (!userId) return '';
  const parsed = parseUuidCandidate(userId);
  return parsed || '';
}

async function findSupabaseUserIdByEmail(email, env) {
  const needle = String(email || '').trim().toLowerCase();
  if (!needle) return '';

  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY,
  };

  for (let page = 1; page <= 8; page++) {
    const u = new URL(env.SUPABASE_URL + '/auth/v1/admin/users');
    u.searchParams.set('page', String(page));
    u.searchParams.set('per_page', '200');

    const res = await fetch(u.toString(), { headers });
    if (!res.ok) break;
    const payload = await res.json().catch(() => ({}));
    const users = payload?.users || [];
    const match = users.find((u2) => String(u2?.email || '').toLowerCase() === needle);
    if (match?.id) return match.id;
    if (users.length < 200) break;
  }

  return '';
}

async function updateProfileTierByUserId(userId, tier, env) {
  const url = new URL(env.SUPABASE_URL + '/rest/v1/profiles');
  url.searchParams.set('id', 'eq.' + userId);

  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      tier,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('profiles tier update failed: ' + res.status + ' ' + txt);
  }
}

async function verifyStripeWebhook(rawBody, signatureHeader, secret) {
  const parsed = parseStripeSignature(signatureHeader);
  const ts = Number(parsed.t || 0);
  const signatures = parsed.v1 || [];
  if (!ts || !signatures.length) throw new Error('Malformed Stripe signature header');

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) throw new Error('Stripe signature timestamp outside tolerance');

  const signedPayload = ts + '.' + rawBody;
  const expected = await hmacSha256Hex(secret, signedPayload);
  const valid = signatures.some((sig) => timingSafeEqualHex(expected, sig));
  if (!valid) throw new Error('No matching Stripe v1 signature');

  const parsedEvent = JSON.parse(rawBody);
  if (!parsedEvent?.id || !parsedEvent?.type) throw new Error('Invalid Stripe event payload');
  return parsedEvent;
}

function parseStripeSignature(header) {
  const out = { v1: [] };
  const parts = String(header || '').split(',');
  for (const p of parts) {
    const [k, ...rest] = p.split('=');
    const key = (k || '').trim();
    const value = rest.join('=').trim();
    if (!key || !value) continue;
    if (key === 't') out.t = value;
    if (key === 'v1') out.v1.push(value);
  }
  return out;
}

async function hmacSha256Hex(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return bytesToHex(new Uint8Array(sig));
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualHex(a, b) {
  const aa = (a || '').toLowerCase();
  const bb = (b || '').toLowerCase();
  if (!aa || !bb || aa.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < aa.length; i++) out |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  return out === 0;
}

// --- DEBUG --------------------------------------------
async function handleDebug(env) {
  if (!env.ABLTY_KV) return json({ error: 'KV not bound' });

  const list = await env.ABLTY_KV.list({ prefix: 'sub:' });
  const keys = list.keys.map((k) => k.name);
  const nowUtc = Date.now();

  const results = await Promise.all(keys.map(async (key) => {
    const raw = await env.ABLTY_KV.get(key);
    if (!raw) return { key, error: 'missing' };
    const sub = JSON.parse(raw);

    const utcOffset = sub.utcOffset || 0;
    const localMs = nowUtc + utcOffset * 60000;
    const localDate = new Date(localMs);
    const localHour = localDate.getUTCHours();
    const localMin = localDate.getUTCMinutes();

    let bedHour = sub.bedtimeHour || 11;
    const bedMin = sub.bedtimeMin || 0;
    const bedAmpm = sub.bedtimeAmpm || 'PM';
    if (bedAmpm === 'PM' && bedHour !== 12) bedHour += 12;
    if (bedAmpm === 'AM' && bedHour === 12) bedHour = 0;
    const bedtimeMinutes = bedHour * 60 + bedMin;
    const currentMinutes = localHour * 60 + localMin;
    const windowStart = 7 * 60;
    const primerCutoff = bedtimeMinutes - 30;
    const postMidnightBedtime = bedtimeMinutes < windowStart;
    const inWindow = postMidnightBedtime
      ? (currentMinutes >= windowStart || currentMinutes < primerCutoff)
      : (currentMinutes >= windowStart && currentMinutes < primerCutoff);

    const countKey = 'sends:' + getTodayStr(utcOffset) + ':' + key;
    const sentToday = parseInt(await env.ABLTY_KV.get(countKey) || '0', 10);

    const lastKey = 'last:' + key;
    const lastSent = parseInt(await env.ABLTY_KV.get(lastKey) || '0', 10);
    const minutesSinceLast = lastSent ? Math.round((nowUtc - lastSent) / 60000) : null;

    return {
      freq: sub.frequency,
      bedtime: `${sub.bedtimeHour}:${String(sub.bedtimeMin || 0).padStart(2, '0')} ${sub.bedtimeAmpm}`,
      utcOffset,
      localTime: `${localHour}:${String(localMin).padStart(2, '0')}`,
      currentMinutes,
      bedtimeMinutes,
      windowStart,
      inWindow,
      sentToday,
      minutesSinceLast,
      todayKey: getTodayStr(utcOffset),
      endpointPrefix: sub.endpoint ? sub.endpoint.slice(0, 60) + '...' : 'missing',
    };
  }));

  return json({ now_utc: new Date(nowUtc).toISOString(), subscribers: results });
}

// --- CRON ---------------------------------------------
async function runRealityCheckCron(env) {
  await sendToAll(env, null);
}

async function sendToAll(env, forcePayload) {
  if (!env.ABLTY_KV) return { error: 'KV not bound' };
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return { error: 'VAPID keys missing' };

  const list = await env.ABLTY_KV.list({ prefix: 'sub:' });
  const keys = list.keys.map((k) => k.name);
  if (!keys.length) return { sent: 0, skipped: 0, total: 0 };

  const nowUtc = Date.now();
  let sent = 0;
  let skipped = 0;
  const errors = [];

  for (const key of keys) {
    const raw = await env.ABLTY_KV.get(key);
    if (!raw) continue;
    const sub = JSON.parse(raw);

    // Manual/test send  - always fire
    if (forcePayload !== null && forcePayload !== undefined) {
      try {
        await sendWebPush(sub, null, env);
      } catch (e) {
        if (e.message && e.message.includes('410')) await env.ABLTY_KV.delete(key);
        errors.push(e.message);
      }
      continue;
    }

    // Cron send - primer check first
    const isPrimer = isEveningPrimerWindow(sub, nowUtc);
    if (isPrimer) {
      const primerKey = 'primer:' + getTodayStr(sub.utcOffset || 0) + ':' + key;
      const alreadySent = await env.ABLTY_KV.get(primerKey);
      if (alreadySent) { skipped++; continue; }
      try {
        await sendWebPush(sub, null, env, true);
        await env.ABLTY_KV.put(primerKey, '1', { expirationTtl: 86400 });
        sent++;
      } catch (e) {
        if (e.message && e.message.includes('410')) await env.ABLTY_KV.delete(key);
        errors.push(e.message);
      }
      continue;
    }

    // Regular send
    const shouldFire = await shouldSendNow(sub, key, nowUtc, env);
    if (!shouldFire) { skipped++; continue; }

    try {
      await sendWebPush(sub, null, env, false);

      const lastKey = 'last:' + key;
      await env.ABLTY_KV.put(lastKey, String(nowUtc), { expirationTtl: 86400 * 2 });

      const countKey = 'sends:' + getTodayStr(sub.utcOffset || 0) + ':' + key;
      const current = parseInt(await env.ABLTY_KV.get(countKey) || '0', 10);
      await env.ABLTY_KV.put(countKey, String(current + 1), { expirationTtl: 86400 * 2 });

      sent++;
    } catch (e) {
      if (e.message && e.message.includes('410')) await env.ABLTY_KV.delete(key);
      errors.push(e.message);
    }
  }

  return { sent, skipped, total: keys.length, errors };
}

async function shouldSendNow(sub, subKey, nowUtcMs, env) {
  const freq = sub.frequency || 9;
  const utcOffset = sub.utcOffset || 0;
  const localMs = nowUtcMs + utcOffset * 60000;
  const localDate = new Date(localMs);
  const localHour = localDate.getUTCHours();
  const localMin = localDate.getUTCMinutes();

  let bedHour = sub.bedtimeHour || 11;
  const bedMin = sub.bedtimeMin || 0;
  const bedAmpm = sub.bedtimeAmpm || 'PM';
  if (bedAmpm === 'PM' && bedHour !== 12) bedHour += 12;
  if (bedAmpm === 'AM' && bedHour === 12) bedHour = 0;
  const bedtimeMinutes = bedHour * 60 + bedMin;

  const windowStartMinutes = 7 * 60;
  const currentMinutes = localHour * 60 + localMin;
  const primerCutoff = bedtimeMinutes - 30;
  const postMidnightBedtime = bedtimeMinutes < windowStartMinutes;

  let inActiveWindow;
  if (!postMidnightBedtime) {
    inActiveWindow = currentMinutes >= windowStartMinutes && currentMinutes < primerCutoff;
  } else {
    inActiveWindow = currentMinutes >= windowStartMinutes || currentMinutes < primerCutoff;
  }
  if (!inActiveWindow) return false;

  let windowMinutes;
  if (!postMidnightBedtime) {
    windowMinutes = primerCutoff - windowStartMinutes;
  } else {
    windowMinutes = (1440 - windowStartMinutes) + Math.max(0, primerCutoff);
  }
  if (windowMinutes <= 0) return false;

  const countKey = 'sends:' + getTodayStr(utcOffset) + ':' + subKey;
  const sentToday = parseInt(await env.ABLTY_KV.get(countKey) || '0', 10);
  if (sentToday >= freq) return false;

  const remaining = freq - sentToday;
  const elapsedMinutes = currentMinutes >= windowStartMinutes
    ? currentMinutes - windowStartMinutes
    : (1440 - windowStartMinutes) + currentMinutes;
  const minutesLeft = Math.max(1, windowMinutes - elapsedMinutes);
  const idealIntervalMinutes = minutesLeft / remaining;

  const lastKey = 'last:' + subKey;
  const lastSent = parseInt(await env.ABLTY_KV.get(lastKey) || '0', 10);
  const minutesSinceLast = lastSent ? (nowUtcMs - lastSent) / 60000 : 999;

  const minGap = Math.max(20, idealIntervalMinutes * 0.5);
  if (minutesSinceLast < minGap) return false;

  const slotsLeft = Math.max(1, minutesLeft / 30);
  const urgency = remaining / slotsLeft;
  if (urgency >= 1.5) return true;

  const progress = (minutesSinceLast - minGap) / (idealIntervalMinutes * 1.5 - minGap);
  const probability = Math.min(1, Math.max(0, progress));
  return Math.random() < probability;
}

function isEveningPrimerWindow(sub, nowUtcMs) {
  const utcOffset = sub.utcOffset || 0;
  const localMs = nowUtcMs + utcOffset * 60000;
  const localDate = new Date(localMs);
  const localHour = localDate.getUTCHours();
  const localMin = localDate.getUTCMinutes();

  let bedHour = sub.bedtimeHour || 11;
  const bedMin = sub.bedtimeMin || 0;
  const bedAmpm = sub.bedtimeAmpm || 'PM';
  if (bedAmpm === 'PM' && bedHour !== 12) bedHour += 12;
  if (bedAmpm === 'AM' && bedHour === 12) bedHour = 0;

  const bedtimeMinutes = bedHour * 60 + bedMin;
  const currentMinutes = localHour * 60 + localMin;
  const primerStart = bedtimeMinutes - 30;
  if (primerStart >= 0) {
    return currentMinutes >= primerStart && currentMinutes < bedtimeMinutes;
  }
  return currentMinutes >= primerStart + 1440 || currentMinutes < bedtimeMinutes;
}

function getTodayStr(utcOffsetMinutes) {
  const d = new Date(Date.now() + utcOffsetMinutes * 60000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

// --- GRADING ------------------------------------------
async function handleGrade(request, env, origin = '') {
  try {
    const body = await request.json();
    const { sketch, notes, targetLabel, target_label, descriptors } = body;
    const label = targetLabel || target_label || '';

    if (!env.GEMINI_API_KEY) return json({ error: 'Missing GEMINI_API_KEY' }, 500, origin);

    const prompt = buildGradingPrompt(notes, label, descriptors);
    const parts = [];
    if (sketch) parts.push({ inline_data: { mime_type: 'image/jpeg', data: sketch } });
    parts.push({ text: prompt });

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      return json({ error: 'Gemini API error', detail: err }, 502, origin);
    }

    const geminiData = await geminiRes.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return json({ error: 'Failed to parse Gemini response', raw: text }, 500, origin);
    }
    return json(parsed, 200, origin);
  } catch (e) {
    return json({ error: e.message }, 500, origin);
  }
}

function buildGradingPrompt(notes, targetLabel, descriptors) {
  return `You are a senior remote viewing analyst trained in the CRV (Coordinate Remote Viewing) methodology. Your job is to fairly and accurately score a viewer's session against a known target.

TARGET: ${targetLabel}
KEY DESCRIPTORS: ${(descriptors || []).join(', ')}

VIEWER'S SKETCH: [sketch image attached  -  analyze it directly]
VIEWER'S IMPRESSIONS: ${notes || '[none]'}

---
SCORING RULES  -  read carefully before grading:

1. SIGNAL vs NOISE: Focus on what the viewer got RIGHT relative to the target's actual qualities. Minor incorrect details do not cancel out correct ones. A session with 5 solid hits and 2 misses is a good session.

2. AOL DEFINITION: Analytical Overlay (AOL) means the viewer tried to NAME or LABEL something (e.g. "I think this is a bridge"). AOL is NOT a penalty  -  it is neutral diagnostic data. If the viewer named something that IS correct (e.g. said "bird" and the target is a bird), that is a HIT, not AOL. Only list as AOL if they named something the data doesn't clearly support, or if they over-interpreted beyond their raw data.

3. DIMENSION WEIGHTS: geometric_form is the most important dimension  -  if the viewer's sketch clearly and unmistakably depicts the correct target subject, geometric_form should score 4-5. spatial_impression is second  -  if the viewer's notes capture environment, scale, or spatial context accurately, spatial_impression should score 4-5. movement_impression and texture_surface are secondary. emotional_tone is tertiary. color_light is the least important  -  missing color data should not significantly drag down an otherwise strong session.

4. SCORING SCALE per dimension (0-5):
   0 = No correspondence
   1 = Vague or accidental match
   2 = Partial match, some correct elements
   3 = Clear match on core quality
   4 = Strong match, specific and accurate
   5 = Exceptional  -  precise and detailed match

   IMPORTANT: When the sketch unmistakably depicts the correct subject (e.g. clearly an elephant when the target is an elephant), geometric_form must be 4 or 5. Do not score it below 4 in this case. When notes correctly identify environment, scale, or spatial setting, spatial_impression must be 4 or 5.

5. WEIGHTED SCORE FORMULA:
   - geometric_form x 3
   - spatial_impression x 2.5
   - texture_surface x 1.5
   - emotional_tone x 1
   - movement_impression x 1.5
   - color_light x 0.5
   Max weighted = 50. overall_score = (weighted_sum / 50 * 100), rounded to nearest integer.

6. CALIBRATION:
   - 55-65%: Viewer correctly identified the subject category and basic shape
   - 65-75%: Also nailed environment, spatial context, scale, or movement
   - 75-85%: Strong match across multiple dimensions including texture or sensory detail
   - 85%+: Exceptional  -  specific verifiable details throughout
   Do not let missing color data or minor noise drag a strong session below the calibration band it deserves.

---
Respond ONLY with valid JSON, no markdown, no preamble:
{
  "dimension_scores": {
    "geometric_form": 0,
    "spatial_impression": 0,
    "texture_surface": 0,
    "emotional_tone": 0,
    "movement_impression": 0,
    "color_light": 0
  },
  "overall_score": 0,
  "summary": "",
  "hits": [],
  "noise": [],
  "aol": []
}
IMPORTANT: overall_score must use the WEIGHTED formula above (max 50). hits should include ALL correct impressions. noise should only include clearly wrong elements.`;
}

// --- WBTB SCHEDULE -----------------------------------
async function handleWBTBSchedule(request, env, origin = '') {
  try {
    const body = await request.json();
    if (!body || !body.endpoint || !body.fireAt) {
      return json({ error: 'Missing endpoint or fireAt' }, 400, origin);
    }
    const duration = Number(body.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      return json({ error: 'Missing or invalid duration' }, 400, origin);
    }
    if (!env.ABLTY_KV) return json({ error: 'KV not bound' }, 500, origin);

    const key = 'wbtb:' + btoa(body.endpoint).slice(0, 40).replace(/[^a-zA-Z0-9]/g, '');
    const alarm = {
      endpoint: body.endpoint,
      keys: body.keys,
      fireAt: body.fireAt,
      duration,
      scheduled: Date.now(),
    };

    const ttlSeconds = Math.ceil(duration * 3600) + 7200;
    await env.ABLTY_KV.put(key, JSON.stringify(alarm), { expirationTtl: ttlSeconds });

    const returnFireAt = body.fireAt + 25 * 60 * 1000;
    const returnKey = 'wbtb-return:' + btoa(body.endpoint).slice(0, 40).replace(/[^a-zA-Z0-9]/g, '');
    const returnAlarm = {
      endpoint: body.endpoint,
      keys: body.keys,
      fireAt: returnFireAt,
      type: 'return',
    };
    await env.ABLTY_KV.put(returnKey, JSON.stringify(returnAlarm), { expirationTtl: ttlSeconds + 2000 });

    return json({ status: 'scheduled', fireAt: body.fireAt, returnFireAt }, 200, origin);
  } catch (e) {
    return json({ error: e.message }, 500, origin);
  }
}

async function handleWBTBCancel(request, env, origin = '') {
  try {
    const body = await request.json();
    if (!body || !body.endpoint) return json({ error: 'Missing endpoint' }, 400, origin);
    if (!env.ABLTY_KV) return json({ error: 'KV not bound' }, 500, origin);
    const key = 'wbtb:' + btoa(body.endpoint).slice(0, 40).replace(/[^a-zA-Z0-9]/g, '');
    const returnKey = 'wbtb-return:' + btoa(body.endpoint).slice(0, 40).replace(/[^a-zA-Z0-9]/g, '');
    await env.ABLTY_KV.delete(key);
    await env.ABLTY_KV.delete(returnKey);
    return json({ status: 'cancelled' }, 200, origin);
  } catch (e) {
    return json({ error: e.message }, 500, origin);
  }
}

async function runWBTBCron(env) {
  if (!env.ABLTY_KV) return;
  const now = Date.now();

  for (const prefix of ['wbtb:', 'wbtb-return:']) {
    try {
      const list = await env.ABLTY_KV.list({ prefix });
      for (const kv of list.keys) {
        try {
          const raw = await env.ABLTY_KV.get(kv.name);
          if (!raw) continue;
          const alarm = JSON.parse(raw);

          if (now < alarm.fireAt) continue;
          if (now > alarm.fireAt + 30 * 60 * 1000) {
            await env.ABLTY_KV.delete(kv.name);
            continue;
          }

          const sub = { endpoint: alarm.endpoint, keys: alarm.keys };
          if (alarm.type === 'return') {
            await sendWBTBReturnPush(sub, env);
          } else {
            await sendWBTBPush(sub, alarm.duration, env);
          }
          await env.ABLTY_KV.delete(kv.name);
        } catch (e) {
          // skip bad entries
        }
      }
    } catch (e) {
      // ignore list errors
    }
  }
}

async function sendWBTBReturnPush(subscription, env) {
  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys?.p256dh;
  const auth = subscription.keys?.auth;
  if (!endpoint || !p256dh || !auth) return;

  const vapidPublic = env.VAPID_PUBLIC_KEY;
  const vapidPrivate = env.VAPID_PRIVATE_KEY;
  const vapidSubject = 'mailto:kayvideoproductions@gmail.com';

  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const now2 = Math.floor(Date.now() / 1000);
  const origin = new URL(endpoint).origin;
  const claims = b64url(JSON.stringify({ aud: origin, exp: now2 + 43200, sub: vapidSubject }));
  const signingInput = `${header}.${claims}`;

  const pubBytes = base64ToBytes(vapidPublic);
  const x = b64url(pubBytes.slice(1, 33));
  const y = b64url(pubBytes.slice(33, 65));
  const d = vapidPrivate;

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, d, key_ops: ['sign'] },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${b64url(sig)}`;
  const msgBody = 'WBTB return. Wake window complete. Return to sleep now.';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapidPublic}`,
      TTL: '3600',
      'Content-Type': 'text/plain',
      'Content-Length': String(new TextEncoder().encode(msgBody).length),
    },
    body: new TextEncoder().encode(msgBody),
  });

  if (!res.ok && res.status !== 201) {
    throw new Error(`WBTB return push failed: ${res.status}`);
  }
}

async function sendWBTBPush(subscription, durationHours, env) {
  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys?.p256dh;
  const auth = subscription.keys?.auth;
  if (!endpoint || !p256dh || !auth) return;

  const vapidPublic = env.VAPID_PUBLIC_KEY;
  const vapidPrivate = env.VAPID_PRIVATE_KEY;
  const vapidSubject = 'mailto:kayvideoproductions@gmail.com';

  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const now2 = Math.floor(Date.now() / 1000);
  const origin = new URL(endpoint).origin;
  const claims = b64url(JSON.stringify({ aud: origin, exp: now2 + 43200, sub: vapidSubject }));
  const signingInput = `${header}.${claims}`;

  const pubBytes = base64ToBytes(vapidPublic);
  const x = b64url(pubBytes.slice(1, 33));
  const y = b64url(pubBytes.slice(33, 65));
  const d = vapidPrivate;

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, d, key_ops: ['sign'] },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${b64url(sig)}`;

  const h = Math.floor(durationHours);
  const m = Math.round((durationHours - h) * 60);
  const durStr = h + (m > 0 ? 'h' + m : 'h');
  const msgBody = 'WBTB wake. ' + durStr + ' sleep complete. Stay awake 20-30 min then return to sleep.';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapidPublic}`,
      TTL: '3600',
      'Content-Type': 'text/plain',
      'Content-Length': String(new TextEncoder().encode(msgBody).length),
    },
    body: new TextEncoder().encode(msgBody),
  });

  if (!res.ok && res.status !== 201) {
    throw new Error(`WBTB push failed: ${res.status}`);
  }
}

// --- SUBSCRIBE ----------------------------------------
async function handleSubscribe(request, env, origin = '') {
  try {
    const sub = await request.json();
    if (!sub || !sub.endpoint) return json({ error: 'Invalid subscription' }, 400, origin);
    if (!env.ABLTY_KV) return json({ error: 'KV namespace not bound' }, 500, origin);

    const key = 'sub:' + btoa(sub.endpoint).slice(0, 40).replace(/[^a-zA-Z0-9]/g, '');
    await env.ABLTY_KV.put(key, JSON.stringify(sub), { expirationTtl: 60 * 60 * 24 * 90 });
    return json({ status: 'subscribed' }, 200, origin);
  } catch (e) {
    return json({ error: e.message }, 500, origin);
  }
}

// --- WEB PUSH (VAPID) ---------------------------------
async function sendWebPush(subscription, payload, env, isPrimer = false) {
  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys?.p256dh;
  const auth = subscription.keys?.auth;
  if (!endpoint || !p256dh || !auth) return;

  const vapidPublic = env.VAPID_PUBLIC_KEY;
  const vapidPrivate = env.VAPID_PRIVATE_KEY;
  const vapidSubject = 'mailto:kayvideoproductions@gmail.com';

  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const now = Math.floor(Date.now() / 1000);
  const origin = new URL(endpoint).origin;
  const claims = b64url(JSON.stringify({ aud: origin, exp: now + 43200, sub: vapidSubject }));
  const signingInput = `${header}.${claims}`;

  const pubBytes = base64ToBytes(vapidPublic);
  const x = b64url(pubBytes.slice(1, 33));
  const y = b64url(pubBytes.slice(33, 65));
  const d = vapidPrivate;

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d, x, y, key_ops: ['sign'] },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${b64url(sig)}`;

  const primerText = 'Tonight you will notice when something feels off.';
  const pushBody = isPrimer ? new TextEncoder().encode(primerText) : null;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapidPublic}`,
      TTL: '86400',
      ...(pushBody
        ? { 'Content-Type': 'text/plain', 'Content-Length': String(pushBody.length) }
        : { 'Content-Length': '0' }),
    },
    ...(pushBody ? { body: pushBody } : {}),
  });

  if (!res.ok && res.status !== 201) {
    const body = await res.text().catch(() => '');
    throw new Error(`Push failed: ${res.status} ${body}`);
  }
}

// --- UTILS --------------------------------------------
function b64url(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let str = '';
  bytes.forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64ToBytes(b64) {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
