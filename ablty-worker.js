// ABLTY Cloudflare Worker
// Routes:
//   POST /rv-assign       - Assign blind RV target/TRN
//   POST /grade           - AI grading via Gemini
//   POST /tag-dream       - Dream tag extraction via Gemini
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

const RV_ASSIGN_TTL_SECONDS = 60 * 60 * 2; // 2 hours
const RV_CATEGORIES = new Set(['all', 'animals', 'objects', 'structures', 'landscapes']);

// Server-side RV target pool (kept off client for protocol integrity).
const RV_TARGET_POOL = [
  // ANIMALS
  { id:'T001', src:'targets/6047-5129.jpg',  label:'Aquatic Predator', category:'animals',    descriptors:['streamlined','underwater','blue','predator','fins','movement'] },
  { id:'T002', src:'targets/2847-5031.jpg',  label:'Arid Wanderer',    category:'animals',    descriptors:['large','single form','dunes','warm tones','isolation','arid'] },
  { id:'T003', src:'targets/6193-8420.jpg',  label:'Swamp Predator',   category:'animals',    descriptors:['reptile','flat','dark water','textured','still','low profile'] },
  { id:'T004', src:'targets/3756-1294.jpg',  label:'Wading Form',      category:'animals',    descriptors:['pink','curved neck','water','thin legs','standing','soft'] },
  { id:'T005', src:'targets/9042-6371.jpg',  label:'Elevated Hunter',  category:'animals',    descriptors:['bird','perched','brown','feathers','claws','alert'] },
  { id:'T006', src:'targets/5518-2983.jpg',  label:'Drifting Bell',    category:'animals',    descriptors:['translucent','glowing','underwater','tendrils','dark blue','floating'] },
  { id:'T007', src:'targets/7284-4056.jpg',  label:'Display Plumage',  category:'animals',    descriptors:['radial','blue-green','fan','eye pattern','symmetrical','ornate'] },
  { id:'T008', src:'targets/1639-7812.jpg',  label:'Arctic Mass',      category:'animals',    descriptors:['white','large','ice','standing','fur','cold'] },
  { id:'T009', src:'targets/4907-3265.jpg',  label:'Crossing Giant',   category:'animals',    descriptors:['large','water','splashing','tusks','grey','powerful'] },
  { id:'T010', src:'targets/8321-5749.jpg',  label:'Surface Breach',   category:'animals',    descriptors:['massive','ocean','airborne','spray','dark','curved'] },
  // OBJECTS
  { id:'T011', src:'targets/2163-9047.jpg',  label:'Stemmed Vessel',   category:'objects',    descriptors:['glass','transparent','stem','dark liquid','bar','bokeh'] },
  { id:'T012', src:'targets/7836-4512.jpg',  label:'Vertical Stack',   category:'objects',    descriptors:['tall','cylindrical','vertical','metallic','dark sky','launch pad'] },
  { id:'T013', src:'targets/3271-8064.jpg',  label:'Suspended Light',  category:'objects',    descriptors:['warm glow','dark','hanging','ornate','wood','night'] },
  { id:'T014', src:'targets/9458-2317.jpg',  label:'Hollow Instrument',category:'objects',    descriptors:['curved','wooden','strings','f-holes','case','brown'] },
  { id:'T015', src:'targets/1847-6093.jpg',  label:'Heat Vessel',      category:'objects',    descriptors:['round','metallic','handle','stove','kitchen','warm light'] },
  { id:'T016', src:'targets/6024-3851.jpg',  label:'Corroded Anchor',  category:'objects',    descriptors:['rust','curved','heavy','beach','wet sand','metal'] },
  { id:'T017', src:'targets/4382-7619.jpg',  label:'Navigation Tool',  category:'objects',    descriptors:['circular','brass','old map','directional','ornate','parchment'] },
  { id:'T018', src:'targets/5093-7241.jpg',  label:'Key Cluster',      category:'objects',    descriptors:['metal','multiple','ring','serrated','wood surface','small'] },
  { id:'T018b',src:'targets/5490-1738.jpg',  label:'Carousel Form',    category:'objects',    descriptors:['ornate','painted horse','pole','lights','warm tones','decorative'] },
  // STRUCTURES
  { id:'T019', src:'targets/8073-5246.jpg',  label:'Dome Observatory', category:'structures', descriptors:['dome','night sky','stars','glowing','isolated','round'] },
  { id:'T020', src:'targets/2956-8130.jpg',  label:'Night Wheel',      category:'structures', descriptors:['circular','lit','radial spokes','carnival','dark sky','colorful'] },
  { id:'T021', src:'targets/5714-3089.jpg',  label:'Signal Array',     category:'structures', descriptors:['dish','white','concave','angled','mechanical','open sky'] },
  { id:'T022', src:'targets/3628-9471.jpg',  label:'Hilltop Fortress', category:'structures', descriptors:['stone','towers','battlements','green hill','medieval','blue sky'] },
  { id:'T023', src:'targets/7195-4302.jpg',  label:'Sacred Interior',  category:'structures', descriptors:['arched ceiling','stained glass','light rays','stone','pews','tall'] },
  { id:'T024', src:'targets/9067-1548.jpg',  label:'Spanning Structure',category:'structures', descriptors:['cables','towers','water below','orange','horizontal','linear'] },
  { id:'T025', src:'targets/7163-2548.jpg',  label:'Vertical Beacon',  category:'structures', descriptors:['tower','cylindrical','isolated','storm','light beam','stone'] },
  // LANDSCAPES
  { id:'T026', src:'targets/4821-9037.jpg',  label:'Cascading Water',  category:'landscapes', descriptors:['flowing','vertical drop','mist','green','movement','rainforest'] },
  { id:'T027', src:'targets/4531-7826.jpg',  label:'Urban Horizon',    category:'landscapes', descriptors:['skyscrapers','sunset','orange sky','city','street','silhouette'] },
  { id:'T028', src:'targets/1293-6047.jpg',  label:'Coastal Shore',    category:'landscapes', descriptors:['palm trees','turquoise water','white sand','tropical','sunny','island'] },
  { id:'T029', src:'targets/6840-2193.jpg',  label:'Dark Wetland',     category:'landscapes', descriptors:['cypress trees','hanging moss','still water','dark','misty','roots'] },
  { id:'T030', src:'targets/3847-6120.jpg',  label:'Frozen Lake',      category:'landscapes', descriptors:['ice','reflective','pine trees','snow','blue sky','flat'] },
  { id:'T031', src:'targets/5962-8347.jpg',  label:'Lava Crater',      category:'landscapes', descriptors:['orange glow','circular','dark rock','smoke','heat','molten'] },
  { id:'T032', src:'targets/2419-7083.jpg',  label:'Arctic Expanse',   category:'landscapes', descriptors:['ice shards','white','vast','jagged peaks','cold','overcast'] },
  { id:'T033', src:'targets/7530-1648.jpg',  label:'Layered Canyon',   category:'landscapes', descriptors:['red rock','layered','vast','warm tones','carved','cliffs'] },
  { id:'T034', src:'targets/9184-3725.jpg',  label:'Storm Coast',      category:'landscapes', descriptors:['black rock','waves crashing','spray','grey sky','rough','violent'] },
  { id:'T035', src:'targets/6371-4908.jpg',  label:'Sand Dunes',       category:'landscapes', descriptors:['rippled sand','beige','open sky','soft curves','minimal','arid'] },
  { id:'T036', src:'targets/1758-9034.jpg',  label:'Summit Cloud',     category:'landscapes', descriptors:['snow peak','triangular','clouds','grey-blue','cold','high altitude'] },
];

// Returns CORS headers for a given request origin
function getCORS(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature, Authorization',
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
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Allow actual localhost during development (exact hostname match)
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1';
  } catch (e) {
    return false;
  }
}

function sanitizeRVCategory(category) {
  return RV_CATEGORIES.has(category) ? category : 'all';
}

function pickRVTarget(category) {
  const safeCategory = sanitizeRVCategory(category);
  const filtered = safeCategory === 'all'
    ? RV_TARGET_POOL
    : RV_TARGET_POOL.filter((t) => t.category === safeCategory);
  const pool = filtered.length ? filtered : RV_TARGET_POOL;
  return pool[Math.floor(Math.random() * pool.length)];
}

function getTargetTRN(target) {
  const src = String(target?.src || '');
  return src.replace(/^targets\//, '').replace(/\.(jpg|jpeg|png|webp)$/i, '');
}

function publicTarget(target) {
  return {
    id: target.id,
    src: target.src,
    label: target.label,
    category: target.category,
    trn: getTargetTRN(target),
  };
}

function assignmentKey(id) {
  return 'rv_assign:' + id;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAssignmentId() {
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch (e) {
    const rand = Math.random().toString(36).slice(2);
    return Date.now().toString(36) + rand;
  }
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

    if (url.pathname === '/tag-dream' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rateLimitKey = 'ratelimit:tagdream:' + ip + ':' + new Date().toISOString().slice(0, 10);
      const current = parseInt(await env.ABLTY_KV.get(rateLimitKey) || '0', 10);
      if (current >= 200) {
        return json([], 200, origin);
      }
      await env.ABLTY_KV.put(rateLimitKey, String(current + 1), { expirationTtl: 86400 });
      return handleTagDream(request, env, origin);
    }

    if (url.pathname === '/rv-assign' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rateLimitKey = 'ratelimit:rvassign:' + ip + ':' + new Date().toISOString().slice(0, 10);
      const current = parseInt(await env.ABLTY_KV.get(rateLimitKey) || '0', 10);
      if (current >= 200) {
        return json({ error: 'rate_limit', message: 'Too many target requests. Try again later.' }, 429, origin);
      }
      await env.ABLTY_KV.put(rateLimitKey, String(current + 1), { expirationTtl: 86400 });

      // Free-tier daily limit (2/day) — premium users bypass
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const isPremium = token ? await checkPremiumTier(token, env) : false;
      if (!isPremium) {
        const dailyKey = 'rvdaily:' + ip + ':' + new Date().toISOString().slice(0, 10);
        const dailyCount = parseInt(await env.ABLTY_KV.get(dailyKey) || '0', 10);
        if (dailyCount >= 2) {
          return json({ error: 'daily_limit', message: 'Free tier allows 2 RV sessions per day. Upgrade to Premium for unlimited sessions.' }, 429, origin);
        }
        await env.ABLTY_KV.put(dailyKey, String(dailyCount + 1), { expirationTtl: 86400 });
      }

      return handleRVAssign(request, env, origin);
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
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rlKey = 'ratelimit:wbtbcancel:' + ip + ':' + new Date().toISOString().slice(0, 10);
      const count = parseInt(await env.ABLTY_KV.get(rlKey) || '0', 10);
      if (count >= 30) return json({ error: 'rate_limit' }, 429, origin);
      await env.ABLTY_KV.put(rlKey, String(count + 1), { expirationTtl: 86400 });
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

  // Single-request lookup using Supabase admin email filter
  const u = new URL(env.SUPABASE_URL + '/auth/v1/admin/users');
  u.searchParams.set('filter', needle);
  u.searchParams.set('per_page', '10');

  const res = await fetch(u.toString(), { headers });
  if (!res.ok) return '';
  const payload = await res.json().catch(() => ({}));
  const users = payload?.users || [];
  const match = users.find((u2) => String(u2?.email || '').toLowerCase() === needle);
  if (match?.id) return match.id;

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

async function checkPremiumTier(accessToken, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return false;
  try {
    // Verify token and get user ID
    const userRes = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + accessToken,
      },
    });
    if (!userRes.ok) return false;
    const user = await userRes.json();
    if (!user?.id) return false;

    // Check KV cache first (avoids DB round-trip on repeat requests)
    const cacheKey = 'tier:' + user.id;
    const cached = await env.ABLTY_KV.get(cacheKey);
    if (cached === 'premium') return true;
    if (cached === 'free') return false;

    // Look up tier in profiles table
    const profileUrl = new URL(env.SUPABASE_URL + '/rest/v1/profiles');
    profileUrl.searchParams.set('id', 'eq.' + user.id);
    profileUrl.searchParams.set('select', 'tier');
    const profileRes = await fetch(profileUrl.toString(), {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY,
      },
    });
    if (!profileRes.ok) return false;
    const profiles = await profileRes.json();
    const tier = profiles?.[0]?.tier || 'free';

    // Cache for 5 minutes
    if (env.ABLTY_KV) {
      await env.ABLTY_KV.put(cacheKey, tier, { expirationTtl: 300 });
    }
    return tier === 'premium';
  } catch (e) {
    return false;
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

  const minGap = Math.max(30, idealIntervalMinutes * 0.5);
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
async function handleRVAssign(request, env, origin = '') {
  try {
    if (!env.ABLTY_KV) return json({ error: 'KV not bound' }, 500, origin);
    const body = await request.json().catch(() => ({}));
    const selectedCategory = sanitizeRVCategory(String(body?.category || 'all'));
    const target = pickRVTarget(selectedCategory);
    if (!target) return json({ error: 'No targets available' }, 500, origin);

    const assignmentId = createAssignmentId();
    const trn = getTargetTRN(target);
    const payload = {
      targetId: target.id,
      trn,
      category: target.category,
      issuedAt: Date.now(),
    };
    await env.ABLTY_KV.put(
      assignmentKey(assignmentId),
      JSON.stringify(payload),
      { expirationTtl: RV_ASSIGN_TTL_SECONDS }
    );
    return json({
      assignment_id: assignmentId,
      trn,
      category: target.category,
      expires_in: RV_ASSIGN_TTL_SECONDS,
    }, 200, origin);
  } catch (e) {
    return json({ error: e.message || 'Failed to assign target' }, 500, origin);
  }
}

function buildGradingFailure(target, message) {
  return {
    grading_failed: true,
    grading_error: String(message || 'AI grading unavailable'),
    dimension_scores: null,
    overall_score: null,
    summary: 'AI grading is temporarily unavailable. Your session was saved successfully.',
    hits: [],
    noise: [],
    aol: [],
    target: publicTarget(target),
  };
}

async function handleGrade(request, env, origin = '') {
  try {
    if (!env.ABLTY_KV) return json({ error: 'KV not bound' }, 500, origin);
    if (!env.GEMINI_API_KEY) return json({ error: 'Missing GEMINI_API_KEY' }, 500, origin);
    const body = await request.json();
    const assignmentIdRaw = String(body?.assignment_id || '').trim();
    const assignmentId = assignmentIdRaw.replace(/[^a-zA-Z0-9]/g, '');
    const retryTargetId = String(body?.target_id || '').trim();

    let target = null;
    let consumeAssignment = false;

    if (assignmentId) {
      // Normal flow: look up assignment from KV
      const assignmentRaw = await env.ABLTY_KV.get(assignmentKey(assignmentId));
      if (!assignmentRaw) {
        return json({ error: 'Assignment expired. Start a new RV session.' }, 410, origin);
      }

      let assignment;
      try {
        assignment = JSON.parse(assignmentRaw);
      } catch (e) {
        await env.ABLTY_KV.delete(assignmentKey(assignmentId));
        return json({ error: 'Invalid assignment record' }, 500, origin);
      }

      target = RV_TARGET_POOL.find((t) => t.id === assignment?.targetId);
      if (!target) {
        await env.ABLTY_KV.delete(assignmentKey(assignmentId));
        return json({ error: 'Assigned target not found' }, 500, origin);
      }

      const requestedTrn = String(body?.trn || '').trim();
      const targetTrn = getTargetTRN(target);
      if (requestedTrn && requestedTrn !== targetTrn) {
        await env.ABLTY_KV.delete(assignmentKey(assignmentId));
        return json({ error: 'TRN mismatch. Start a new RV session.' }, 400, origin);
      }
      consumeAssignment = true;
    } else if (retryTargetId) {
      // Retry flow: look up target directly by ID (assignment expired or consumed)
      target = RV_TARGET_POOL.find((t) => t.id === retryTargetId);
      if (!target) {
        return json({ error: 'Target not found' }, 400, origin);
      }
    } else {
      return json({ error: 'Missing assignment_id or target_id' }, 400, origin);
    }

    const sketch = String(body?.sketch || '');
    if (!sketch || sketch.length < 100 || sketch.length > 5 * 1024 * 1024) {
      return json({ error: 'Missing or invalid sketch payload' }, 400, origin);
    }
    const notes = body?.notes;

    const prompt = buildGradingPrompt(notes, target.label, target.descriptors);
    const parts = [];
    // Gemini REST API expects camelCase fields for inline image parts.
    if (sketch) parts.push({ inlineData: { mimeType: 'image/jpeg', data: sketch } });
    parts.push({ text: prompt });

    let geminiRes = null;
    let geminiErrText = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      geminiRes = await fetch(
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
      if (geminiRes.ok) break;
      geminiErrText = ((await geminiRes.text().catch(() => '')) || '').slice(0, 500);
      console.warn('[GRADE] Gemini non-OK attempt', attempt + 1, geminiRes.status, geminiErrText);
      const transient = geminiRes.status === 429 || geminiRes.status === 500 || geminiRes.status === 502 || geminiRes.status === 503 || geminiRes.status === 504;
      if (!transient || attempt === 2) break;
      await sleep((attempt + 1) * 450);
    }

    if (!geminiRes || !geminiRes.ok) {
      const status = geminiRes ? geminiRes.status : 0;
      const reason = status === 429
        ? 'Gemini API quota exceeded'
        : `Gemini API error (${status || 'no response'})`;
      return json(buildGradingFailure(target, reason), 200, origin);
    }

    const geminiData = await geminiRes.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return json(buildGradingFailure(target, 'Failed to parse Gemini response'), 200, origin);
    }
    if (!parsed || typeof parsed !== 'object') {
      return json(buildGradingFailure(target, 'Invalid grading payload'), 200, origin);
    }
    // Only consume assignment after successful grading so retries work.
    if (consumeAssignment) await env.ABLTY_KV.delete(assignmentKey(assignmentId));
    parsed.target = publicTarget(target);
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
  "score_reasoning": "",
  "summary": "",
  "hits": [],
  "noise": [],
  "aol": []
}
SCORE REASONING: In "score_reasoning", write 1-2 sentences explaining which specific dimensions held the score back and what kind of impressions would push it higher. Frame it as forward-looking coaching, not criticism. Example: "Spatial context and color data were minimal this session. Adding environmental details like scale, setting, or lighting in your impressions would strengthen these dimensions." Do NOT repeat the summary. Do NOT mention the word "dimension" or score numbers. Keep it plain-language and actionable.
IMPORTANT: overall_score must use the WEIGHTED formula above (max 50). hits should include ALL correct impressions. noise should only include clearly wrong elements.`;
}

async function handleTagDream(request, env, origin = '') {
  try {
    if (!env.GEMINI_API_KEY) return json([], 200, origin);

    const body = await request.json().catch(() => ({}));
    const dreamText = String(body?.body || '').trim();
    if (!dreamText || dreamText.length > 10000) return json([], 200, origin);

    const prompt = [
      'You are a dream analysis assistant. Extract a list of recurring symbolic elements from the following dream description.',
      'Return only a JSON array of short lowercase noun or verb strings, maximum 8 items, no explanations, no markdown.',
      'Example output: ["water","running","school","stranger"]',
      '',
      'Dream description:',
      dreamText,
    ].join('\n');

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    if (!geminiRes.ok) return json([], 200, origin);

    const geminiData = await geminiRes.json().catch(() => ({}));
    const text = String(geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (!text) return json([], 200, origin);

    const cleaned = text.replace(/```json|```/gi, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return json([], 200, origin);

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return json([], 200, origin);

    const deduped = [];
    const seen = new Set();
    for (const raw of parsed) {
      const tag = String(raw || '').trim().toLowerCase();
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      deduped.push(tag);
      if (deduped.length >= 8) break;
    }
    return json(deduped, 200, origin);
  } catch (e) {
    return json([], 200, origin);
  }
}

// --- WBTB SCHEDULE -----------------------------------
async function handleWBTBSchedule(request, env, origin = '') {
  try {
    const body = await request.json();
    if (!body || !body.endpoint || !body.fireAt) {
      return json({ error: 'Missing endpoint or fireAt' }, 400, origin);
    }
    const duration = Number(body.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 12) {
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
            console.log('[WBTB] expired alarm, deleting:', kv.name);
            await env.ABLTY_KV.delete(kv.name);
            continue;
          }

          console.log('[WBTB] firing alarm:', kv.name, 'type:', alarm.type || 'wake');
          const sub = { endpoint: alarm.endpoint, keys: alarm.keys };
          if (alarm.type === 'return') {
            await sendWBTBReturnPush(sub, env);
          } else {
            await sendWBTBPush(sub, alarm.duration, env);
          }
          await env.ABLTY_KV.delete(kv.name);
          console.log('[WBTB] alarm sent and deleted:', kv.name);
        } catch (e) {
          console.error('[WBTB] alarm error for', kv.name, ':', e.message);
        }
      }
    } catch (e) {
      console.error('[WBTB] list error for prefix', prefix, ':', e.message);
    }
  }
}

async function sendWBTBReturnPush(subscription, env) {
  const msgBody = 'WBTB return. Wake window complete. Return to sleep now.';
  await sendVapidPush(subscription, env, {
    bodyText: msgBody,
    ttl: '3600',
    errorPrefix: 'WBTB return push failed',
  });
}

async function sendWBTBPush(subscription, durationHours, env) {
  const h = Math.floor(durationHours);
  const m = Math.round((durationHours - h) * 60);
  const durStr = h + (m > 0 ? 'h' + m : 'h');
  const msgBody = 'WBTB wake. ' + durStr + ' sleep complete. Stay awake 20-30 min then return to sleep.';
  await sendVapidPush(subscription, env, {
    bodyText: msgBody,
    ttl: '3600',
    errorPrefix: 'WBTB push failed',
  });
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
  const primerText = 'Tonight you will notice when something feels off.';
  if (isPrimer) {
    await sendVapidPush(subscription, env, {
      bodyText: primerText,
      ttl: '86400',
      errorPrefix: 'Push failed',
    });
    return;
  }
  await sendVapidPush(subscription, env, {
    bodyText: null,
    ttl: '86400',
    errorPrefix: 'Push failed',
  });
}

// --- WEB PUSH ENCRYPTION (RFC 8291 aes128gcm) ----------
async function encryptPushPayload(plaintext, p256dhB64, authB64) {
  const uaPublic = base64ToBytes(p256dhB64);
  const authSecret = base64ToBytes(authB64);

  // Generate ephemeral ECDH key pair
  const asKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const asPublicRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', asKeyPair.publicKey)
  );

  // Import subscriber's p256dh public key
  const uaKey = await crypto.subtle.importKey(
    'raw', uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, []
  );

  // ECDH shared secret
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaKey },
      asKeyPair.privateKey,
      256
    )
  );

  // Derive IKM: HKDF(salt=authSecret, ikm=ecdhSecret, info="WebPush: info\0" || uaPublic || asPublic)
  const authInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'),
    uaPublic,
    asPublicRaw
  );
  const ikm = await hkdfDerive(ecdhSecret, authSecret, authInfo, 32);

  // Random salt for content encryption
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Derive content encryption key (16 bytes) and nonce (12 bytes)
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const cek = await hkdfDerive(ikm, salt, cekInfo, 16);
  const nonce = await hkdfDerive(ikm, salt, nonceInfo, 12);

  // Pad plaintext with 0x02 delimiter (final record)
  const padded = concatBytes(plaintext, new Uint8Array([2]));

  // Encrypt with AES-128-GCM
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, padded)
  );

  // Build aes128gcm payload: salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext
  const header = new Uint8Array(86);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  header.set(asPublicRaw, 21);

  return concatBytes(header, ciphertext);
}

async function hkdfDerive(ikm, salt, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info },
      key,
      length * 8
    )
  );
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}

async function sendVapidPush(subscription, env, opts = {}) {
  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys?.p256dh;
  const auth = subscription.keys?.auth;
  if (!endpoint || !p256dh || !auth) return;

  const vapidPublic = env.VAPID_PUBLIC_KEY;
  const vapidPrivate = env.VAPID_PRIVATE_KEY;
  const vapidSubject = 'mailto:abltyapp@gmail.com';

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
  const bodyText = typeof opts.bodyText === 'string' ? opts.bodyText : null;
  const ttl = opts.ttl || '86400';
  const errorPrefix = opts.errorPrefix || 'Push failed';

  let pushBody = null;
  const pushHeaders = {
    Authorization: `vapid t=${jwt}, k=${vapidPublic}`,
    TTL: ttl,
    'Content-Length': '0',
  };

  if (bodyText) {
    const plaintext = new TextEncoder().encode(bodyText);
    const encrypted = await encryptPushPayload(plaintext, p256dh, auth);
    pushBody = encrypted;
    pushHeaders['Content-Type'] = 'application/octet-stream';
    pushHeaders['Content-Encoding'] = 'aes128gcm';
    pushHeaders['Content-Length'] = String(encrypted.byteLength);
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: pushHeaders,
    ...(pushBody ? { body: pushBody } : {}),
  });

  if (!res.ok && res.status !== 201) {
    const body = await res.text().catch(() => '');
    throw new Error(`${errorPrefix}: ${res.status} ${body}`);
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
