/**
 * Local simulation: import worker, stub KV, exercise routes.
 * Run: node scripts/test-ablty-worker.mjs
 */
import crypto from 'node:crypto';
import worker from '../ablty-worker.js';

class MemoryKV {
  constructor(map = new Map()) {
    this._m = map;
  }
  async get(k) {
    return this._m.get(k) ?? null;
  }
  async put(k, v, _opts) {
    this._m.set(k, v);
  }
  async delete(k) {
    this._m.delete(k);
  }
  async list({ prefix }) {
    const keys = [...this._m.keys()]
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({ name }));
    return { keys };
  }
}

function makeStripeSignature(secret, rawBody, t = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${t}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${t},v1=${sig}`;
}

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`OK  ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${e?.message || e}`);
  }
}

const USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// --- scenarios ---
await runCase('stripe-webhook: missing signature returns 400', async () => {
  const env = {
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_KEY: 'svc',
    ABLTY_KV: new MemoryKV(),
  };
  const req = new Request('https://worker/stripe-webhook', {
    method: 'POST',
    body: '{}',
    headers: { 'Content-Type': 'application/json' },
  });
  const res = await worker.fetch(req, env, {});
  const j = await res.json();
  if (res.status !== 400 || !j.error) throw new Error(`expected 400, got ${res.status} ${JSON.stringify(j)}`);
});

await runCase('stripe-webhook: valid signature + subscription.updated ignored (no tier change)', async () => {
  const secret = 'whsec_testsecret';
  const body = JSON.stringify({
    id: 'evt_1',
    type: 'customer.subscription.updated',
    data: { object: { customer: 'cus_x', metadata: { supabase_user_id: USER_ID } } },
  });
  const env = {
    STRIPE_WEBHOOK_SECRET: secret,
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_KEY: 'svc',
    ABLTY_KV: new MemoryKV(),
  };
  let patchCalled = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/rest/v1/profiles')) {
      patchCalled = true;
      return new Response(null, { status: 204 });
    }
    return origFetch(url, init);
  };
  try {
    const req = new Request('https://worker/stripe-webhook', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': makeStripeSignature(secret, body),
      },
    });
    const res = await worker.fetch(req, env, {});
    const j = await res.json();
    if (res.status !== 200 || j.received !== true) throw new Error(`bad response ${res.status} ${JSON.stringify(j)}`);
    if (patchCalled) throw new Error('should not PATCH profiles for non-tier events');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runCase('stripe-webhook: customer object (expanded) should still resolve + store KV', async () => {
  const secret = 'whsec_testsecret2';
  const body = JSON.stringify({
    id: 'evt_2',
    type: 'customer.subscription.created',
    data: {
      object: {
        customer: { id: 'cus_expand', object: 'customer' },
        metadata: { supabase_user_id: USER_ID },
      },
    },
  });
  const kv = new MemoryKV();
  const env = {
    STRIPE_WEBHOOK_SECRET: secret,
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_KEY: 'svc',
    ABLTY_KV: kv,
  };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  try {
    const req = new Request('https://worker/stripe-webhook', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': makeStripeSignature(secret, body),
      },
    });
    const res = await worker.fetch(req, env, {});
    if (!res.ok) throw new Error(`webhook failed ${res.status} ${await res.text()}`);
    const stored = await kv.get('stripe_customer:cus_expand');
    if (stored !== USER_ID) throw new Error(`KV missing customer map: got ${stored}`);
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runCase('wbtb-schedule: missing duration returns 400', async () => {
  const env = { ABLTY_KV: new MemoryKV() };
  const body = {
    endpoint: 'https://example.com/push',
    fireAt: Date.now() + 60000,
    keys: { p256dh: 'x', auth: 'y' },
  };
  const req = new Request('https://worker/wbtb-schedule', {
    method: 'POST',
    headers: { Origin: 'https://ablty.app', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
});

await runCase('wbtb-schedule: valid duration uses finite expirationTtl', async () => {
  let lastPutOpts;
  const kv = {
    async get() {
      return null;
    },
    async put(_k, _v, opts) {
      lastPutOpts = opts;
    },
    async delete() {},
    async list() {
      return { keys: [] };
    },
  };
  const env = { ABLTY_KV: kv };
  const body = {
    endpoint: 'https://example.com/push',
    fireAt: Date.now() + 60000,
    duration: 2,
    keys: { p256dh: 'x', auth: 'y' },
  };
  const req = new Request('https://worker/wbtb-schedule', {
    method: 'POST',
    headers: { Origin: 'https://ablty.app', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  if (!res.ok) throw new Error(`expected 200, got ${res.status}`);
  if (!lastPutOpts || !Number.isFinite(lastPutOpts.expirationTtl)) {
    throw new Error(`expected finite expirationTtl, got ${JSON.stringify(lastPutOpts)}`);
  }
});

await runCase('stripe-webhook: uppercase v1 hex should still verify', async () => {
  const secret = 'whsec_hexcase';
  const rawBody = JSON.stringify({
    id: 'evt_hex',
    type: 'checkout.session.completed',
    data: { object: { customer: 'cus_hex', client_reference_id: USER_ID } },
  });
  const t = Math.floor(Date.now() / 1000);
  const signedPayload = `${t}.${rawBody}`;
  const sigLower = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  const sigUpper = sigLower.toUpperCase();
  const env = {
    STRIPE_WEBHOOK_SECRET: secret,
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_KEY: 'svc',
    ABLTY_KV: new MemoryKV(),
  };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  try {
    const req = new Request('https://worker/stripe-webhook', {
      method: 'POST',
      body: rawBody,
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': `t=${t},v1=${sigUpper}`,
      },
    });
    const res = await worker.fetch(req, env, {});
    if (!res.ok) throw new Error(`expected 200, got ${res.status} ${await res.text()}`);
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runCase('ping without Origin works', async () => {
  const res = await worker.fetch(new Request('https://worker/ping'), {}, {});
  const j = await res.json();
  if (j.status !== 'ok') throw new Error(String(JSON.stringify(j)));
});

console.log('--- done ---');
