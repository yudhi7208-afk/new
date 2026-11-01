import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { handleCheckout } from '../src/checkout.mjs';
import { HttpError } from '../src/admin-auth.mjs';

// Synthetic settings, contacts, and file bytes only. No production data/files.
const ORIGIN = 'https://checkout.example.test';
const settings = {
  catalog: { cities: [{ name: 'Kota Sintetis', pricingKey: 'paid' }, { name: 'Gratis Sintetis', pricingKey: 'free' }], pricing: {
    paid: [{ id: 'singkat', name: 'Singkat', price: 10000, features: ['Poster'] }, { id: 'komplit-plus', name: 'Komplit PLUS', price: 15000, features: ['Video'] }],
    free: [{ id: 'singkat', name: 'Singkat Gratis', price: 0, features: ['Poster'] }],
  } },
  payout: { bankName: 'BANK TEST', bankAccount: 'TEST-ACCOUNT', bankHolder: 'SYNTHETIC ONLY', whatsapp: '620000000000', maxUploadMb: 1 },
};
const schemas = await Promise.all(['0003_admin.sql','0005_checkout.sql'].map(name => readFile(new URL('../migrations/' + name, import.meta.url), 'utf8')));
const sha = value => createHash('sha256').update(value).digest('hex');
const adminToken = 'c'.repeat(64);
const adminCookie = '__Host-posloker-admin=' + adminToken;
const originalNow = Date.now;
let clock = 1793491200000;
Date.now = () => clock;
class Statement {
  constructor(owner, sql, values = []) { this.owner = owner; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.owner, this.sql, values); }
  execute() {
    if (this.owner.failReconcile && this.sql.startsWith('SELECT state,order_id FROM checkout_submissions WHERE claim_id=')) throw Error('Synthetic read failure');
    const cancelling = this.sql.startsWith('UPDATE checkout_submissions SET claim_id=');
    if (cancelling && this.owner.pendingPersist && this.owner.flushBeforeCancellation) this.owner.flushPending();
    const stmt = this.owner.sqlite.prepare(this.sql);
    if (stmt.columns().length) {
      const result = { success: true, results: stmt.all(...this.values).map(row => ({ ...row })), meta: { changes: this.owner.sqlite.prepare('SELECT changes() n').get().n } };
      if (cancelling && this.owner.pendingPersist) this.owner.flushPending();
      return result;
    }
    const result = stmt.run(...this.values);
    return { success: true, results: [], meta: { changes: result.changes } };
  }
  async first(column) { const row = this.execute().results[0] ?? null; return column ? row?.[column] ?? null : row; }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
}
class DB {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec(schemas.join('\n')); this.failPersist = false; this.commitThenThrow = false; this.failReconcile = false; this.deferPersist = false; this.pendingPersist = null; this.flushBeforeCancellation = false; }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    const saving = statements.some(stmt => stmt.sql.startsWith('INSERT INTO commerce_orders'));
    if (saving && this.deferPersist) {
      this.pendingPersist = () => this.executeBatch(statements, true);
      throw Error('Synthetic persistence still pending after transport error');
    }
    const results = this.executeBatch(statements, saving);
    if (saving && this.commitThenThrow) throw Error('Synthetic lost commit response');
    return results;
  }
  flushPending() { const callback = this.pendingPersist; this.pendingPersist = null; this.pendingPersistResult = callback(); }
  executeBatch(statements, saving) {
    this.sqlite.exec('BEGIN');
    let results;
    try {
      results = statements.map((statement, index) => { const result = statement.execute(); if (saving && this.failPersist && index === 0) throw Error('Synthetic write failure'); return result; });
      this.sqlite.exec('COMMIT');
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
    return results;
  }
}
class Bucket {
  constructor() { this.objects = new Map(); this.deleted = []; this.puts = 0; this.failPut = 0; this.beforePut = null; this.failDelete = false; }
  async put(key, bytes, options) {
    this.puts++;
    if (this.beforePut) { const callback = this.beforePut; this.beforePut = null; await callback(); }
    this.objects.set(key, { bytes: new Uint8Array(bytes), options });
    if (this.failPut === this.puts) throw Error('Synthetic interrupted upload');
  }
  async delete(key) { if (this.failDelete) throw Error('Synthetic cleanup failure'); this.deleted.push(key); this.objects.delete(key); }
}
const fixtures = [];
function fixture(mode = 'preview') {
  const db = new DB(); fixtures.push(db);
  db.sqlite.prepare('INSERT INTO admin_setup(id,token_hash,expires_at) VALUES(1,?,?)').run(sha('Synthetic bootstrap'), Math.floor(clock / 1000) + 86400);
  const insert = db.sqlite.prepare('INSERT OR REPLACE INTO commerce_settings(key,value_json) VALUES(?,?)');
  insert.run('catalog_json', JSON.stringify(settings.catalog)); insert.run('payout_json', JSON.stringify(settings.payout));
  insert.run('mode', JSON.stringify(mode));
  db.sqlite.prepare('INSERT INTO admin_users(id,email,password_salt,password_hash,password_iterations,created_at) VALUES(1,?,?,?,?,?)')
    .run('owner@example.test', 'a'.repeat(64), 'b'.repeat(64), 100000, Math.floor(clock / 1000));
  db.sqlite.prepare('INSERT INTO admin_sessions(token_hash,user_id,csrf_token,created_at,expires_at) VALUES(?,1,?,?,?)')
    .run(sha(adminToken), 'd'.repeat(64), Math.floor(clock / 1000), Math.floor(clock / 1000) + 28800);
  return { CUSTOMER_DB: db, CUSTOMER_FILES: new Bucket() };
}
function req(path, body, options = {}) {
  const headers = new Headers({ Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': options.ip || '203.0.113.8' });
  if (options.cookie) headers.set('Cookie', options.cookie);
  if (options.csrf) headers.set('X-CSRF-Token', options.csrf);
  if (body && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
  for (const [name, value] of Object.entries(options.headers || {})) {
    if (value === null) headers.delete(name); else headers.set(name, value);
  }
  return new Request((options.urlOrigin || ORIGIN) + path, { method: options.method || (body === undefined ? 'GET' : 'POST'), headers,
    body: body === undefined ? undefined : body instanceof FormData || typeof body === 'string' ? body : JSON.stringify(body) });
}
const api = (env, path, body, options) => handleCheckout(req(path, body, options), env);
async function rejected(action, status) { await assert.rejects(action, error => error instanceof HttpError && error.status === status); }
async function session(env, ip = '203.0.113.8', authenticated = true) {
  const response = await api(env, '/api/checkout/session', undefined, { ip, cookie: authenticated ? adminCookie : undefined });
  assert.equal(response.status, 200);
  const body = await response.json();
  const checkoutCookie = response.headers.get('Set-Cookie')?.split(';')[0] || '';
  return { cookie: [checkoutCookie, authenticated ? adminCookie : ''].filter(Boolean).join('; '), csrf: body.csrfToken, ip, body };
}
async function quote(env, user, city = 'Kota Sintetis', packageId = 'singkat') {
  return (await (await api(env, '/api/checkout/quote', { city, packageId }, user)).json()).quote;
}
const pdfBytes = Buffer.from('%PDF-1.7\nSynthetic test only.\n%%EOF');
const pdf = () => new File([pdfBytes], 'synthetic-proof.pdf', { type: 'application/pdf' });
const mp4Bytes = Buffer.concat([Buffer.from([0,0,0,24]), Buffer.from('ftypisom'), Buffer.from([0,0,0,0]), Buffer.from('isommp42')]);
const mp4 = () => new File([mp4Bytes], 'synthetic-video.mp4', { type: 'video/mp4' });
function form(user, selected, extras = {}, files = {}) {
  const data = new FormData();
  const fields = { quoteId: selected.id, csrfToken: user.csrf, idempotencyKey: randomUUID(), customerName: 'Synthetic Employer', whatsapp: '081234567890', email: 'synthetic@example.test',
    adText: 'Synthetic vacancy\nNo real customer data.', caption: 'Synthetic caption', notes: '', consent: '1', website: '', ...extras };
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  if (selected.baseAmount > 0 && !Object.hasOwn(files, 'proof')) data.append('proof', pdf());
  for (const [key, value] of Object.entries(files)) if (value !== null) {
    for (const file of Array.isArray(value) ? value : [value]) data.append(key, file);
  }
  return data;
}
const count = (env, table) => env.CUSTOMER_DB.sqlite.prepare('SELECT count(*) n FROM ' + table).get().n;

try {
  assert.equal(await handleCheckout(req('/api/other'), {}), null);
  await rejected(() => api({}, '/api/checkout/session'), 503);
  const env = fixture(), user = await session(env);
  assert.equal(user.body.preview, true);
  assert.equal(user.body.canSubmit, true);
  assert.equal(user.body.payment.limits.proofMaxBytes, 1024 * 1024);
  assert.equal(user.body.payment.limits.materialsMaxFiles, 10);
  assert.ok(!JSON.stringify(user.body).includes('Synthetic bootstrap'));
  assert.match(user.csrf, /^[a-f0-9]{64}$/);
  const rawToken = user.cookie.split(';')[0].split('=')[1];
  assert.equal(env.CUSTOMER_DB.sqlite.prepare('SELECT token_hash FROM checkout_sessions').get().token_hash, sha(rawToken));
  const existingSession = await api(env, '/api/checkout/session', undefined, user);
  assert.equal(existingSession.headers.get('Set-Cookie'), null);
  assert.equal((await existingSession.json()).csrfToken, user.csrf);
  const previewAnonymous = fixture(), anon = await session(previewAnonymous, '203.0.113.90', false);
  assert.equal(anon.body.preview, true); assert.equal(anon.body.canSubmit, false);
  assert.equal(anon.body.csrfToken, ''); assert.equal(anon.cookie, '');
  for (let index = 0; index < 60; index++) {
    const readOnly = await api(previewAnonymous, '/api/checkout/session');
    assert.equal(readOnly.headers.get('Set-Cookie'), null);
    assert.equal((await readOnly.json()).canSubmit, false);
  }
  assert.equal(count(previewAnonymous, 'checkout_sessions'), 0, 'Anonymous preview catalog requests cannot allocate checkout sessions');
  assert.equal(count(previewAnonymous, 'checkout_rate_limits'), 0, 'Anonymous preview catalog requests cannot write rate counters');
  await rejected(() => quote(previewAnonymous, anon), 401);
  await rejected(() => api(previewAnonymous, '/api/checkout/submit', new FormData(), anon), 401);
  assert.equal(count(previewAnonymous, 'checkout_quotes'), 0);
  assert.equal(previewAnonymous.CUSTOMER_FILES.puts, 0);
  await rejected(() => api(env, '/api/checkout/session', {}), 405);
  await rejected(() => api(env, '/api/checkout/quote', { city: 'Kota Sintetis', packageId: 'singkat' }), 401);
  await rejected(() => api(env, '/api/checkout/quote', { city: 'Kota Sintetis', packageId: 'singkat' }, { ...user, csrf: 'a'.repeat(64) }), 403);
  await rejected(() => api(env, '/api/checkout/quote', { city: 'Kota Sintetis', packageId: 'singkat' }, { ...user, headers: { Origin: 'https://evil.example.test' } }), 403);
  await rejected(() => api(env, '/api/checkout/quote', { city: 'Kota Sintetis', packageId: 'singkat', amount: 1 }, user), 400);
  await rejected(() => quote(env, user, 'Unknown', 'singkat'), 400);
  const first = await quote(env, user), second = await quote(env, user);
  assert.equal(first.baseAmount, 10000);
  assert.ok(first.uniqueCode >= 1 && first.uniqueCode <= 99);
  assert.equal(first.amount, first.baseAmount + first.uniqueCode);
  assert.notEqual(first.uniqueCode, second.uniqueCode, 'Active paid quotes must reserve distinct payment codes');
  const free = await quote(env, user, 'Gratis Sintetis');
  assert.equal(free.amount, 0); assert.equal(free.uniqueCode, 0);
  assert.equal(count(env, 'checkout_code_reservations'), 2);
  const fallback = fixture();
  const fallbackCatalog = structuredClone(settings.catalog);
  fallbackCatalog.cities.push({ name: 'Default Sintetis', pricingKey: 'missing-specific-city' });
  fallbackCatalog.pricing.default = [{ id: 'singkat', name: 'Default', price: 7000, features: ['Default tariff'] }];
  fallback.CUSTOMER_DB.sqlite.prepare("UPDATE commerce_settings SET value_json=? WHERE key='catalog_json'").run(JSON.stringify(fallbackCatalog));
  const fallbackUser = await session(fallback), fallbackQuote = await quote(fallback, fallbackUser, 'Default Sintetis');
  assert.equal(fallbackQuote.baseAmount, 7000, 'A city without dedicated tariff uses the WordPress-compatible default table');

  for (const [changes, fileChanges, status] of [
    [{ consent: '' }, {}, 400], [{ website: 'robot' }, {}, 400], [{ caption: 'x'.repeat(501) }, {}, 400],
    [{ whatsapp: '+abc123' }, {}, 400], [{ csrfToken: 'b'.repeat(64) }, {}, 403],
  ]) {
    const isolated = fixture(), who = await session(isolated), selected = await quote(isolated, who);
    await rejected(() => api(isolated, '/api/checkout/submit', form(who, selected, changes, fileChanges), who), status);
    assert.equal(isolated.CUSTOMER_FILES.puts, 0); assert.equal(count(isolated, 'commerce_orders'), 0);
  }
  const invalidFiles = [
    { proof: null },
    { proof: new File(['<script>bad</script>'], 'proof.pdf', { type: 'application/pdf' }) },
    { proof: new File([pdfBytes], 'proof.php', { type: 'application/pdf' }) },
    { proof: new File([pdfBytes], 'proof.pdf', { type: 'image/png' }) },
    { proof: new File([new Uint8Array(1024 * 1024 + 1)], 'large.pdf', { type: 'application/pdf' }) },
    { materials: Array.from({ length: 11 }, pdf) },
    { materials: [new File([new Uint8Array(6 * 1024 * 1024)], 'one.pdf', { type: 'application/pdf' }), new File([new Uint8Array(6 * 1024 * 1024)], 'two.pdf', { type: 'application/pdf' })] },
    { video: mp4() },
    { materials: new File([mp4Bytes], 'video.mp4', { type: 'video/mp4' }) },
  ];
  for (const changedFiles of invalidFiles) {
    const isolated = fixture(), who = await session(isolated), selected = await quote(isolated, who);
    await rejected(() => api(isolated, '/api/checkout/submit', form(who, selected, {}, changedFiles), who), 400);
    assert.equal(isolated.CUSTOMER_FILES.puts, 0, 'All fields/files must validate before any storage upload');
    assert.equal(count(isolated, 'checkout_submissions'), 0);
  }

  const good = fixture(), owner = await session(good), selected = await quote(good, owner, 'Kota Sintetis', 'komplit-plus');
  const idem = randomUUID();
  const goodResponse = await api(good, '/api/checkout/submit', form(owner, selected, { idempotencyKey: idem }, { materials: pdf(), video: mp4() }), owner);
  const saved = await goodResponse.json();
  assert.equal(saved.order.isTest, true); assert.equal(saved.order.status, 'pending');
  assert.match(saved.order.id, /^cf_[a-f0-9]{32}$/); assert.match(saved.order.orderNumber, /^CF-TEST-/);
  assert.equal(good.CUSTOMER_FILES.objects.size, 3);
  assert.equal(count(good, 'commerce_orders'), 1); assert.equal(count(good, 'commerce_events'), 1);
  assert.equal(count(good, 'commerce_files'), 3);
  const storedFiles = good.CUSTOMER_DB.sqlite.prepare('SELECT * FROM commerce_files').all();
  for (const file of storedFiles) {
    assert.equal(file.storage_key, `private/commerce/${saved.order.id}/${file.id}.${file.mime === 'video/mp4' ? 'mp4' : 'pdf'}`);
    const bytes = good.CUSTOMER_FILES.objects.get(file.storage_key).bytes;
    assert.equal(file.sha256, sha(bytes)); assert.equal(file.byte_count, bytes.length);
  }
  const persisted = good.CUSTOMER_DB.sqlite.prepare('SELECT * FROM commerce_orders').get();
  assert.equal(persisted.whatsapp, '6281234567890'); assert.equal(persisted.customer_name, 'Synthetic Employer');
  assert.equal(persisted.revision, 0); assert.equal(persisted.status, 'pending');
  assert.ok(!JSON.stringify(saved).includes('synthetic@example.test'));
  assert.ok(!JSON.stringify(saved).includes('Synthetic Employer'));
  assert.ok(!JSON.stringify(saved).includes('private/commerce/'));
  assert.match(saved.whatsappUrl, /^https:\/\/wa\.me\/620000000000\?text=/);
  assert.ok(decodeURIComponent(saved.whatsappUrl).includes('SIMULASI'));
  assert.ok(!decodeURIComponent(saved.whatsappUrl).includes('synthetic@example.test'));
  const repeat = await api(good, '/api/checkout/submit', form(owner, selected, { idempotencyKey: idem }), owner);
  assert.equal((await repeat.json()).order.id, saved.order.id);
  assert.equal(good.CUSTOMER_FILES.puts, 3, 'A completed same-key retry cannot upload a second copy');
  const receipt = await api(good, '/api/checkout/orders/' + saved.order.id, undefined, owner);
  assert.equal((await receipt.json()).order.id, saved.order.id);
  const foreign = await session(good, '203.0.113.70');
  await rejected(() => api(good, '/api/checkout/orders/' + saved.order.id, undefined, foreign), 404);
  await rejected(() => api(good, '/api/checkout/orders/' + saved.order.id), 401);
  await rejected(() => api(good, '/api/checkout/orders/' + saved.order.id, undefined, { cookie: owner.cookie.split(';')[0] }), 401,
    'Preview receipts require the owner admin session as well as checkout ownership');
  await rejected(() => api(good, '/api/checkout/submit', form(foreign, selected), foreign), 410);

  const gratis = fixture(), gratisUser = await session(gratis), gratisQuote = await quote(gratis, gratisUser, 'Gratis Sintetis');
  const gratisSaved = await (await api(gratis, '/api/checkout/submit', form(gratisUser, gratisQuote), gratisUser)).json();
  assert.equal(gratisSaved.order.amount, 0); assert.equal(gratis.CUSTOMER_FILES.puts, 0);
  const live = fixture('live'), liveUser = await session(live, '203.0.113.91', false), liveQuote = await quote(live, liveUser, 'Gratis Sintetis');
  assert.equal(liveUser.body.preview, false); assert.equal(liveUser.body.canSubmit, true);
  const liveSaved = await (await api(live, '/api/checkout/submit', form(liveUser, liveQuote), liveUser)).json();
  assert.equal(liveSaved.order.isTest, false); assert.match(liveSaved.order.orderNumber, /^CF-\d{6}-/);
  assert.ok(!decodeURIComponent(liveSaved.whatsappUrl).includes('SIMULASI'));

  const sessionLimited = fixture('live');
  for (let index = 0; index < 20; index++) await session(sessionLimited, '203.0.113.100', false);
  await rejected(() => session(sessionLimited, '203.0.113.100', false), 429);
  assert.equal(count(sessionLimited, 'checkout_sessions'), 20);
  const quotesLimited = fixture(), limitedUser = await session(quotesLimited);
  for (let index = 0; index < 20; index++) await quote(quotesLimited, limitedUser, 'Gratis Sintetis');
  const salt = sha('Synthetic bootstrap'), globalQuoteBucket = sha('quote:global:' + salt);
  const globalBefore = quotesLimited.CUSTOMER_DB.sqlite.prepare('SELECT attempts FROM checkout_rate_limits WHERE bucket_hash=?').get(globalQuoteBucket).attempts;
  for (let index = 0; index < 55; index++) await rejected(() => quote(quotesLimited, limitedUser, 'Gratis Sintetis'), 429);
  assert.equal(quotesLimited.CUSTOMER_DB.sqlite.prepare('SELECT attempts FROM checkout_rate_limits WHERE bucket_hash=?').get(globalQuoteBucket).attempts, globalBefore,
    'A quote-limited IP cannot consume the remaining global request budget');
  assert.ok((await quote(quotesLimited, { ...limitedUser, ip: '203.0.113.101' }, 'Gratis Sintetis')).id);
  const globallyLimited = fixture(), globalUser = await session(globallyLimited);
  for (let index = 0; index < 200; index++) await quote(globallyLimited, { ...globalUser, ip: '198.51.100.' + (Math.floor(index / 20) + 1) }, 'Gratis Sintetis');
  await rejected(() => quote(globallyLimited, { ...globalUser, ip: '198.51.100.200' }, 'Gratis Sintetis'), 429);
  assert.equal(count(globallyLimited, 'checkout_quotes'), 200);

  const uploadFailure = fixture(), uploadUser = await session(uploadFailure), uploadQuote = await quote(uploadFailure, uploadUser);
  uploadFailure.CUSTOMER_FILES.failPut = 2;
  await rejected(() => api(uploadFailure, '/api/checkout/submit', form(uploadUser, uploadQuote, {}, { materials: pdf() }), uploadUser), 503);
  assert.equal(uploadFailure.CUSTOMER_FILES.objects.size, 0, 'An interrupted storage response must clean its own possibly-written object');
  assert.equal(count(uploadFailure, 'commerce_orders'), 0); assert.equal(count(uploadFailure, 'checkout_submissions'), 0);
  const cleanupFailure = fixture(), cleanupUser = await session(cleanupFailure), cleanupQuote = await quote(cleanupFailure, cleanupUser);
  cleanupFailure.CUSTOMER_FILES.failPut = 1; cleanupFailure.CUSTOMER_FILES.failDelete = true;
  const cleanupIdem = randomUUID();
  await rejected(() => api(cleanupFailure, '/api/checkout/submit', form(cleanupUser, cleanupQuote, { idempotencyKey: cleanupIdem }), cleanupUser), 503);
  assert.equal(count(cleanupFailure, 'checkout_submissions'), 1, 'Failed cleanup must retain the rotated claim for operator reconciliation');
  assert.equal(cleanupFailure.CUSTOMER_DB.sqlite.prepare('SELECT state FROM checkout_submissions').get().state, 'processing');
  await rejected(() => api(cleanupFailure, '/api/checkout/submit', form(cleanupUser, cleanupQuote, { idempotencyKey: cleanupIdem }), cleanupUser), 409);
  assert.equal(cleanupFailure.CUSTOMER_FILES.puts, 1, 'An uncleaned claim cannot create duplicate uploaded objects');
  const dbFailure = fixture(), dbUser = await session(dbFailure), dbQuote = await quote(dbFailure, dbUser);
  dbFailure.CUSTOMER_DB.failPersist = true;
  await rejected(() => api(dbFailure, '/api/checkout/submit', form(dbUser, dbQuote), dbUser), 503);
  assert.equal(dbFailure.CUSTOMER_FILES.objects.size, 0); assert.equal(count(dbFailure, 'commerce_orders'), 0);
  assert.equal(count(dbFailure, 'commerce_files'), 0); assert.equal(count(dbFailure, 'checkout_submissions'), 0);
  const lostResponse = fixture(), lostUser = await session(lostResponse), lostQuote = await quote(lostResponse, lostUser);
  lostResponse.CUSTOMER_DB.commitThenThrow = true;
  const recovered = await (await api(lostResponse, '/api/checkout/submit', form(lostUser, lostQuote), lostUser)).json();
  assert.ok(recovered.order.id); assert.equal(count(lostResponse, 'commerce_orders'), 1);
  assert.equal(lostResponse.CUSTOMER_FILES.objects.size, 1); assert.equal(lostResponse.CUSTOMER_FILES.deleted.length, 0,
    'A successful commit with an interrupted response cannot delete saved files');
  const ambiguous = fixture(), ambiguousUser = await session(ambiguous), ambiguousQuote = await quote(ambiguous, ambiguousUser);
  ambiguous.CUSTOMER_DB.commitThenThrow = true; ambiguous.CUSTOMER_DB.failReconcile = true;
  const ambiguousIdem = randomUUID();
  await rejected(() => api(ambiguous, '/api/checkout/submit', form(ambiguousUser, ambiguousQuote, { idempotencyKey: ambiguousIdem }), ambiguousUser), 503);
  assert.equal(ambiguous.CUSTOMER_FILES.objects.size, 1); assert.equal(ambiguous.CUSTOMER_FILES.deleted.length, 0);
  ambiguous.CUSTOMER_DB.failReconcile = false;
  assert.ok((await (await api(ambiguous, '/api/checkout/submit', form(ambiguousUser, ambiguousQuote, { idempotencyKey: ambiguousIdem }), ambiguousUser)).json()).order.id);
  assert.equal(ambiguous.CUSTOMER_FILES.puts, 1);
  for (const commitFirst of [false, true]) {
    const pending = fixture(), pendingUser = await session(pending), pendingQuote = await quote(pending, pendingUser);
    pending.CUSTOMER_DB.deferPersist = true; pending.CUSTOMER_DB.flushBeforeCancellation = commitFirst;
    const attempt = () => api(pending, '/api/checkout/submit', form(pendingUser, pendingQuote), pendingUser);
    if (commitFirst) {
      assert.ok((await (await attempt()).json()).order.id);
      assert.equal(count(pending, 'commerce_orders'), 1); assert.equal(pending.CUSTOMER_FILES.objects.size, 1);
      assert.equal(pending.CUSTOMER_FILES.deleted.length, 0, 'A pending commit that wins cancellation retains its files');
    } else {
      await rejected(attempt, 503);
      assert.equal(count(pending, 'commerce_orders'), 0); assert.equal(count(pending, 'commerce_files'), 0);
      assert.equal(pending.CUSTOMER_FILES.objects.size, 0); assert.equal(count(pending, 'checkout_submissions'), 0);
      assert.equal(pending.CUSTOMER_DB.pendingPersistResult[0].results.length, 0,
        'Cancelling the processing claim before cleanup prevents a delayed batch from creating an order with deleted files');
    }
  }

  const concurrent = fixture(), concurrentUser = await session(concurrent), concurrentQuote = await quote(concurrent, concurrentUser);
  let releaseUpload, enteredUpload;
  const entered = new Promise(resolve => { enteredUpload = resolve; });
  const release = new Promise(resolve => { releaseUpload = resolve; });
  concurrent.CUSTOMER_FILES.beforePut = async () => { enteredUpload(); await release; };
  const concurrentIdem = randomUUID();
  const firstSubmit = api(concurrent, '/api/checkout/submit', form(concurrentUser, concurrentQuote, { idempotencyKey: concurrentIdem }), concurrentUser);
  await entered;
  await rejected(() => api(concurrent, '/api/checkout/submit', form(concurrentUser, concurrentQuote, { idempotencyKey: concurrentIdem }), concurrentUser), 409);
  assert.equal(concurrent.CUSTOMER_FILES.puts, 1);
  releaseUpload();
  assert.equal((await firstSubmit).status, 200); assert.equal(count(concurrent, 'commerce_orders'), 1);

  const expired = fixture(), expiredUser = await session(expired), expiredQuote = await quote(expired, expiredUser);
  clock += 3600 * 1000 + 1000;
  await rejected(() => api(expired, '/api/checkout/submit', form(expiredUser, expiredQuote), expiredUser), 401);
  assert.equal(expired.CUSTOMER_FILES.puts, 0);
  for (const fixtureDb of fixtures) {
    assert.equal(fixtureDb.sqlite.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.equal(fixtureDb.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
  }
  console.log('Synthetic checkout checks passed: server catalog/price/code reservations, preview isolation, hashed sessions/CSRF, upload magic/limits, private receipts, idempotent concurrent submission, owned cleanup, ambiguous-commit recovery, and D1 integrity.');
} finally { Date.now = originalNow; for (const db of fixtures) db.sqlite.close(); }
