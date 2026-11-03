import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PosiAiBudget, reserveAiBudget } from '../src/budget.mjs';

const ENDPOINT = 'https://posi-budget.internal/reserve';
const epoch = Date.parse('2026-11-03T23:59:59.900Z');
const request = (options = {}) => new Request(ENDPOINT, { method: 'POST', ...options });

function storageFixture() {
  let values = new Map(), queue = Promise.resolve();
  return {
    snapshot() { return [...values].map(([key, value]) => [key, structuredClone(value)]); },
    corrupt(value) { values.set('daily-budget-v1', value); },
    transaction(callback) {
      const job = queue.then(async () => {
        const transaction = new Map(structuredClone([...values]));
        const result = await callback({
          async get(key) { return structuredClone(transaction.get(key)); },
          async put(key, value) { transaction.set(key, structuredClone(value)); },
        });
        values = transaction; return result;
      });
      queue = job.catch(() => {}); return job;
    },
  };
}
function object(storage, env = {}, now = () => epoch) {
  return new PosiAiBudget({ storage }, env, { now });
}

test('daily budget admits exactly 100 concurrent reservations and stores aggregates only', async () => {
  const storage = storageFixture(), budget = object(storage);
  const responses = await Promise.all(Array.from({ length: 101 }, () => budget.fetch(request())));
  assert.equal(responses.filter(response => response.status === 200).length, 100);
  assert.equal(responses.filter(response => response.status === 429).length, 1);
  assert.deepEqual(storage.snapshot(), [['daily-budget-v1', { day: '2026-11-03', used: 100 }]]);
});

test('UTC rollover replaces the only row and restart cannot reset the current day', async () => {
  let time = epoch;
  const storage = storageFixture(), env = { POSI_AI_DAILY_LIMIT: '1' };
  let budget = object(storage, env, () => time);
  assert.equal((await budget.fetch(request())).status, 200);
  budget = object(storage, env, () => time);
  assert.equal((await budget.fetch(request())).status, 429);
  time += 200;
  assert.equal((await budget.fetch(request())).status, 200);
  assert.deepEqual(storage.snapshot(), [['daily-budget-v1', { day: '2026-11-04', used: 1 }]]);
  time = epoch;
  assert.equal((await budget.fetch(request())).status, 429, 'clock rollback must not reopen yesterday');
});

test('daily configured caps clamp at 100; invalid values fail closed without writes', async () => {
  for (const value of ['', '0', '-1', '1.5', ' 10', 'NaN', null, false, Infinity, 0, -1, 1.2]) {
    const storage = storageFixture();
    assert.equal((await object(storage, { POSI_AI_DAILY_LIMIT: value }).fetch(request())).status, 503, String(value));
    assert.deepEqual(storage.snapshot(), []);
  }
  const storage = storageFixture(), budget = object(storage, { POSI_AI_DAILY_LIMIT: '999999' });
  for (let n = 0; n < 100; n++) assert.equal((await budget.fetch(request())).status, 200);
  assert.equal((await budget.fetch(request())).status, 429);
});

test('malformed internal requests cannot select a date, count, limit or reset action', async () => {
  const storage = storageFixture(), budget = object(storage);
  assert.equal((await budget.fetch(new Request(ENDPOINT))).status, 405);
  assert.equal((await budget.fetch(new Request(ENDPOINT + '?reset=true', { method: 'POST' }))).status, 404);
  assert.equal((await budget.fetch(new Request('https://attacker.example/reserve', { method: 'POST' }))).status, 404);
  assert.equal((await budget.fetch(request({ body: '{"day":"2099-01-01","used":0,"limit":999}' }))).status, 400);
  assert.deepEqual(storage.snapshot(), []);
});

test('corrupt or unavailable storage refuses reservations and leaks no internal details', async () => {
  for (const value of [{ day: '2026-11-03', used: -1 }, { day: '2026-11-03', used: 2, message: 'PII must not be accepted' }, { day: 'invalid', used: 0 }, { day: '2026-02-31', used: 0 }, null]) {
    const storage = storageFixture(); storage.corrupt(value);
    const response = await object(storage).fetch(request());
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { allowed: false });
  }
  const failing = { transaction: async () => { throw Error('private database details'); } };
  const response = await object(failing).fetch(request());
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { allowed: false });
});

test('reservation client uses one fixed namespace object and bodyless internal request', async () => {
  const seen = [];
  const env = { POSI_AI_BUDGET: {
    idFromName(name) { seen.push(name); return 'one-object'; },
    get(id) { seen.push(id); return { async fetch(req) { seen.push({ url: req.url, method: req.method, body: req.body }); return new Response('{"allowed":true}'); } }; },
  } };
  assert.equal(await reserveAiBudget(env), true);
  assert.deepEqual(seen, ['posi-ai-daily-v1', 'one-object', { url: ENDPOINT, method: 'POST', body: null }]);
});

test('reservation client fails closed on missing, failed, malformed or timed-out budget', async () => {
  assert.equal(await reserveAiBudget({}), false);
  for (const fetch of [
    async () => { throw Error('private provider details'); },
    async () => new Response('{"allowed":true}', { status: 429 }),
    async () => new Response('{"allowed":"true"}'),
    async () => new Response('{"allowed":true,"used":0}'),
    async () => new Response('invalid JSON'),
    async () => new Response('null'),
    async () => new Promise(() => {}),
  ]) {
    assert.equal(await reserveAiBudget({ POSI_AI_BUDGET: { idFromName: () => 'fixed', get: () => ({ fetch }) } }, { timeoutMs: 5 }), false);
  }
});

test('actual SQLite Durable Object runtime enforces an atomic shared cap', { timeout: 30000 }, async t => {
  const [{ build }, { Miniflare, convertV4MiniflareOptions }] = await Promise.all([
    import('../../node_modules/esbuild/lib/main.js'),
    import('../../node_modules/miniflare/dist/src/index.js'),
  ]);
  const result = await build({ stdin: {
    contents: "export { PosiAiBudget } from './src/budget.mjs'; import { reserveAiBudget } from './src/budget.mjs'; export default { async fetch(request, env) { return new Response(JSON.stringify({ allowed: await reserveAiBudget(env) }), { headers: {'Content-Type':'application/json'} }); } };",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'budget-runtime-test.mjs',
  }, bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: result.outputFiles[0].text, compatibilityDate: '2026-10-30',
    durableObjects: { POSI_AI_BUDGET: { className: 'PosiAiBudget', useSQLite: true } },
    bindings: { POSI_AI_DAILY_LIMIT: '3' },
  }));
  t.after(() => mf.dispose());
  const responses = await Promise.all(Array.from({ length: 8 }, async () => (await mf.dispatchFetch('http://localhost/reserve')).json()));
  assert.equal(responses.filter(value => value.allowed).length, 3);
  assert.equal(responses.filter(value => !value.allowed).length, 5);
});
