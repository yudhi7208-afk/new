import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { assertMutation, handleAuth, HttpError, requireAdmin } from '../src/admin-auth.mjs';

// Synthetic credentials, bootstrap tokens, and addresses only. This test never
// reads a source backup, customer database, private manifest, or production D1.
const schema = await readFile(new URL('../migrations/0003_admin.sql', import.meta.url), 'utf8');
const ORIGIN = 'https://admin.example.test';
const TOKEN = 'a'.repeat(64);
const PASSWORD = 'Synthetic passphrase 7!';
const EMAIL = 'owner@example.test';
const sha = value => createHash('sha256').update(value).digest('hex');
const realNow = Date.now;
let clock = 1793491200000;
Date.now = () => clock;

class LocalStatement {
  constructor(owner, sql, values = []) { this.owner = owner; this.sql = sql; this.values = values; }
  bind(...values) { return new LocalStatement(this.owner, this.sql, values); }
  execute() {
    const statement = this.owner.sqlite.prepare(this.sql);
    if (statement.columns().length) {
      const results = statement.all(...this.values).map(row => ({ ...row }));
      const changes = this.owner.sqlite.prepare('SELECT changes() AS n').get().n;
      return { success: true, results, meta: { changes } };
    }
    const result = statement.run(...this.values);
    return { success: true, results: [], meta: { changes: result.changes } };
  }
  async first(column) { const row = this.execute().results[0] ?? null; return column ? row?.[column] ?? null : row; }
  async run() { return this.execute(); }
  async all() { return this.execute(); }
}
class LocalD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(schema);
    this.beforeBatch = null;
  }
  prepare(sql) { return new LocalStatement(this, sql); }
  async batch(statements) {
    this.beforeBatch?.();
    this.beforeBatch = null;
    this.sqlite.exec('BEGIN');
    try { const results = statements.map(statement => statement.execute()); this.sqlite.exec('COMMIT'); return results; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  close() { this.sqlite.close(); }
}
const opened = [];
function fixture(expiresOffset = 86400) {
  const db = new LocalD1(); opened.push(db);
  db.sqlite.prepare('INSERT INTO admin_setup(id,token_hash,expires_at) VALUES(1,?,?)')
    .run(sha(TOKEN), Math.floor(clock / 1000) + expiresOffset);
  return { CUSTOMER_DB: db };
}
function request(path, data, options = {}) {
  const origin = options.origin ?? ORIGIN;
  const headers = new Headers({ 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': options.ip ?? '203.0.113.7', 'Sec-Fetch-Site': 'same-origin' });
  if (options.cookie) headers.set('Cookie', options.cookie);
  if (options.csrf) headers.set('X-CSRF-Token', options.csrf);
  if (options.headers) for (const [key, value] of Object.entries(options.headers)) {
    if (value === null) headers.delete(key); else headers.set(key, value);
  }
  return new Request((options.urlOrigin || ORIGIN) + path, {
    method: options.method || (data === undefined ? 'GET' : 'POST'), headers,
    body: data === undefined ? undefined : typeof data === 'string' ? data : JSON.stringify(data),
  });
}
const setupData = (extra = {}) => ({ token: TOKEN, email: EMAIL, password: PASSWORD, passwordConfirm: PASSWORD, ...extra });
const cookieOf = response => response.headers.get('Set-Cookie').split(';')[0];
const api = (env, path, data, options) => handleAuth(request(path, data, options), env);
async function rejectsStatus(action, status) {
  await assert.rejects(action, error => error instanceof HttpError && error.status === status);
}
async function configured() {
  const env = fixture();
  const response = await api(env, '/api/admin/setup', setupData());
  assert.equal(response.status, 200);
  return { env, response, cookie: cookieOf(response), result: await response.json() };
}

try {
  const env = fixture();
  assert.equal(await handleAuth(request('/api/other'), {}), null);
  await rejectsStatus(() => api({}, '/api/admin/session'), 503);
  for (const path of ['/api/admin/login', '/api/admin/setup', '/api/admin/logout']) {
    await rejectsStatus(() => api(env, path), 405);
  }
  await rejectsStatus(() => api(env, '/api/admin/session', {}), 405);
  const initial = await api(env, '/api/admin/session');
  assert.deepEqual(await initial.json(), { authenticated: false, setupRequired: true, setupAvailable: true });
  assert.match(initial.headers.get('Cache-Control'), /no-store/);
  assert.equal(initial.headers.get('X-Content-Type-Options'), 'nosniff');
  const unprepared = new LocalD1(); opened.push(unprepared);
  assert.deepEqual(await (await api({ CUSTOMER_DB: unprepared }, '/api/admin/session')).json(),
    { authenticated: false, setupRequired: true, setupAvailable: false });
  await rejectsStatus(() => api({ CUSTOMER_DB: unprepared }, '/api/admin/login', { email: EMAIL, password: PASSWORD }), 503);

  for (const options of [
    { origin: 'https://attacker.example.test' },
    { headers: { Origin: null } },
    { headers: { 'Sec-Fetch-Site': 'same-site' } },
    { urlOrigin: 'http://admin.example.test', origin: 'http://admin.example.test' },
  ]) await rejectsStatus(() => api(env, '/api/admin/setup', setupData(), options), 403);
  assert.equal(env.CUSTOMER_DB.sqlite.prepare('SELECT count(*) n FROM admin_rate_limits').get().n, 0,
    'Cross-origin or plaintext requests cannot write authentication counters');
  await rejectsStatus(() => api(env, '/api/admin/setup', setupData(), { headers: { 'Content-Type': 'text/plain' } }), 415);
  await rejectsStatus(() => api(env, '/api/admin/setup', '{bad json'), 400);
  await rejectsStatus(() => api(env, '/api/admin/setup', ' '.repeat(5000)), 413);
  await rejectsStatus(() => api(env, '/api/admin/setup', []), 400);
  await rejectsStatus(() => api(env, '/api/admin/setup', setupData({ passwordConfirm: 'wrong' })), 400);
  await rejectsStatus(() => api(env, '/api/admin/setup', setupData({ token: 'b'.repeat(64) })), 403);
  assert.equal(env.CUSTOMER_DB.sqlite.prepare('SELECT count(*) n FROM admin_users').get().n, 0);

  const { env: live, response, cookie: activeCookie, result } = await configured();
  assert.deepEqual(result.user, { id: 1, email: EMAIL });
  assert.match(result.csrfToken, /^[a-f0-9]{64}$/);
  assert.equal(result.authenticated, true);
  const issuedCookie = response.headers.get('Set-Cookie');
  for (const flag of ['__Host-posloker-admin=', 'Path=/', 'Max-Age=28800', 'Secure', 'HttpOnly', 'SameSite=Strict']) {
    assert.ok(issuedCookie.includes(flag));
  }
  const storedOwner = live.CUSTOMER_DB.sqlite.prepare('SELECT * FROM admin_users').get();
  assert.notEqual(storedOwner.password_hash, PASSWORD);
  assert.equal(storedOwner.password_iterations, 100000);
  assert.match(storedOwner.password_salt, /^[a-f0-9]{64}$/);
  const storedSession = live.CUSTOMER_DB.sqlite.prepare('SELECT * FROM admin_sessions').get();
  const rawSession = activeCookie.split('=')[1];
  assert.equal(storedSession.token_hash, sha(rawSession));
  assert.notEqual(storedSession.token_hash, rawSession);
  assert.ok(!JSON.stringify(storedOwner).includes(PASSWORD));
  assert.equal(live.CUSTOMER_DB.sqlite.prepare('SELECT consumed_at FROM admin_setup').get().consumed_at, Math.floor(clock / 1000));
  await rejectsStatus(() => api(live, '/api/admin/setup', setupData()), 409);
  assert.equal(live.CUSTOMER_DB.sqlite.prepare('SELECT count(*) n FROM admin_users').get().n, 1);

  const auth = await requireAdmin(request('/api/admin/orders', undefined, { cookie: activeCookie }), live);
  assert.equal(auth.user.email, EMAIL);
  assert.equal(auth.session.tokenHash, sha(rawSession));
  assert.equal(auth.csrfToken, result.csrfToken);
  assert.equal(await requireAdmin(request('/api/admin/orders'), live), null);
  assert.equal(await requireAdmin(request('/api/admin/orders', undefined, { cookie: '__Host-posloker-admin=bad' }), live), null);
  assert.equal(await requireAdmin(request('/api/admin/orders', undefined, { cookie: '__Host-posloker-admin=' + 'f'.repeat(64) }), live), null);
  assert.equal(await requireAdmin(request('/api/admin/orders', undefined, { cookie: activeCookie + '; ' + activeCookie }), live), null);
  const sessionResponse = await api(live, '/api/admin/session', undefined, { cookie: activeCookie });
  const sessionBody = await sessionResponse.json();
  assert.equal(sessionBody.authenticated, true);
  assert.equal(sessionBody.setupRequired, false);
  assert.deepEqual(Object.keys(sessionBody.user).sort(), ['email', 'id']);

  assert.throws(() => assertMutation(request('/api/admin/orders/1', {}, { cookie: activeCookie }), auth.session), error => error.status === 403);
  assert.throws(() => assertMutation(request('/api/admin/orders/1', {}, { cookie: activeCookie, csrf: 'e'.repeat(64) }), auth.session), error => error.status === 403);
  assert.throws(() => assertMutation(request('/api/admin/orders/1', {}, { origin: 'https://attacker.example.test', csrf: result.csrfToken }), auth.session), error => error.status === 403);
  assert.doesNotThrow(() => assertMutation(request('/api/admin/orders/1', {}, { cookie: activeCookie, csrf: result.csrfToken }), auth.session));
  await rejectsStatus(() => api(live, '/api/admin/logout', {}, { cookie: activeCookie }), 403);
  assert.ok(await requireAdmin(request('/api/admin/orders', undefined, { cookie: activeCookie }), live));
  const logout = await api(live, '/api/admin/logout', {}, { cookie: activeCookie, csrf: result.csrfToken });
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal(await requireAdmin(request('/api/admin/orders', undefined, { cookie: activeCookie }), live), null);
  await rejectsStatus(() => api(live, '/api/admin/logout', {}, { cookie: activeCookie, csrf: result.csrfToken }), 401);

  const login = await api(live, '/api/admin/login', { email: ' OWNER@EXAMPLE.TEST ', password: PASSWORD }, { ip: '203.0.113.20' });
  assert.equal(login.status, 200);
  const loginCookie = cookieOf(login);
  assert.notEqual(loginCookie, activeCookie, 'Logging in must generate a fresh random session');
  clock += 8 * 60 * 60 * 1000 + 1000;
  assert.equal(await requireAdmin(request('/api/admin/orders', undefined, { cookie: loginCookie }), live), null);

  const expired = fixture(-1);
  await rejectsStatus(() => api(expired, '/api/admin/setup', setupData()), 403);
  assert.equal(expired.CUSTOMER_DB.sqlite.prepare('SELECT count(*) n FROM admin_users').get().n, 0);
  const racingExpiry = fixture();
  racingExpiry.CUSTOMER_DB.beforeBatch = () => racingExpiry.CUSTOMER_DB.sqlite.prepare('UPDATE admin_setup SET expires_at=?').run(Math.floor(clock / 1000) - 1);
  await rejectsStatus(() => api(racingExpiry, '/api/admin/setup', setupData()), 409);
  assert.equal(racingExpiry.CUSTOMER_DB.sqlite.prepare('SELECT count(*) n FROM admin_users').get().n, 0,
    'Expiry must be rechecked by the atomic owner insertion after password hashing');
  assert.equal(racingExpiry.CUSTOMER_DB.sqlite.prepare('SELECT consumed_at FROM admin_setup').get().consumed_at, null);

  const racing = fixture();
  const attempts = await Promise.allSettled([
    api(racing, '/api/admin/setup', setupData(), { ip: '203.0.113.30' }),
    api(racing, '/api/admin/setup', setupData({ email: 'other@example.test' }), { ip: '203.0.113.31' }),
  ]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1, 'Only one concurrent bootstrap request may create an owner');
  const rejected = attempts.find(item => item.status === 'rejected');
  assert.equal(rejected.reason.status, 409);
  assert.equal(racing.CUSTOMER_DB.sqlite.prepare('SELECT count(*) n FROM admin_users').get().n, 1);
  assert.equal(racing.CUSTOMER_DB.sqlite.prepare('SELECT count(*) n FROM admin_sessions').get().n, 1);

  const limited = await configured();
  for (let index = 0; index < 5; index++) {
    await rejectsStatus(() => api(limited.env, '/api/admin/login', { email: EMAIL, password: 'wrong' }, { ip: '203.0.113.50' }), 401);
  }
  await rejectsStatus(() => api(limited.env, '/api/admin/login', { email: EMAIL, password: PASSWORD }, { ip: '203.0.113.50' }), 429);
  const globalBucket = sha('global:' + sha(TOKEN));
  const globalAttempts = limited.env.CUSTOMER_DB.sqlite.prepare('SELECT attempts FROM admin_rate_limits WHERE bucket_hash=?').get(globalBucket).attempts;
  for (let index = 0; index < 55; index++) {
    await rejectsStatus(() => api(limited.env, '/api/admin/login', { email: EMAIL, password: PASSWORD }, { ip: '203.0.113.50' }), 429);
  }
  assert.equal(limited.env.CUSTOMER_DB.sqlite.prepare('SELECT attempts FROM admin_rate_limits WHERE bucket_hash=?').get(globalBucket).attempts,
    globalAttempts, 'A blocked IP must not consume the global login budget');
  assert.equal((await api(limited.env, '/api/admin/login', { email: EMAIL, password: PASSWORD }, { ip: '203.0.113.51' })).status, 200,
    'An IP that exceeded its limit cannot deny another admin address its available login budget');
  const counters = limited.env.CUSTOMER_DB.sqlite.prepare('SELECT * FROM admin_rate_limits').all();
  assert.ok(!JSON.stringify(counters).includes('203.0.113.50'), 'Rate counters must not store raw IP addresses');
  assert.ok(counters.every(row => /^[a-f0-9]{64}$/.test(row.bucket_hash)));
  clock += 15 * 60 * 1000;
  assert.equal((await api(limited.env, '/api/admin/login', { email: EMAIL, password: PASSWORD }, { ip: '203.0.113.50' })).status, 200);
  limited.env.CUSTOMER_DB.sqlite.exec('DELETE FROM admin_rate_limits');
  for (let index = 1; index <= 50; index++) {
    await rejectsStatus(() => api(limited.env, '/api/admin/login', { email: 'invalid', password: 'wrong' }, { ip: '198.51.100.' + index }), 401);
  }
  await rejectsStatus(() => api(limited.env, '/api/admin/login', { email: EMAIL, password: PASSWORD }, { ip: '198.51.100.100' }), 429);
  assert.equal(limited.env.CUSTOMER_DB.sqlite.prepare('SELECT count(*) n FROM admin_rate_limits').get().n, 51,
    'The global cap must reject a new address before allocating another per-IP bucket');
  assert.equal(limited.env.CUSTOMER_DB.sqlite.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  assert.equal(limited.env.CUSTOMER_DB.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);

  console.log('Synthetic admin authentication checks passed: one-time/expired/concurrent bootstrap, password hashing, private hashed sessions, strict Origin/CSRF/HTTPS, logout/replay/expiry, and persistent atomic per-IP/global limits.');
} finally {
  Date.now = realNow;
  for (const db of opened) db.close();
}
