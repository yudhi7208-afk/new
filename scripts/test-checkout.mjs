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
const schemas = await Promise.all(['0003_admin.sql','0005_checkout.sql','0008_receipt_access.sql'].map(name => readFile(new URL('../migrations/' + name, import.meta.url), 'utf8')));
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
function assertAdminOrderLink(result) {
  const message = new URL(result.whatsappUrl).searchParams.get('text');
  const links = message.match(/https:\/\/[^\s]+/g) || [];
  assert.equal(links.length, 1, 'WhatsApp includes one owner order link');
  const link = new URL(links[0]);
  assert.equal(link.origin, 'https://posloker.my.id');
  assert.equal(link.pathname, '/admin/');
  assert.deepEqual([...link.searchParams], [['order', result.order.id]]);
  assert.equal(link.hash, '', 'Owner links do not carry receipt capabilities');
  if (result.receiptKey) assert.ok(!message.includes(result.receiptKey));
}

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

  // Editing operational limits must not change the terms of an active quote.
  const mediumPdf = () => new File([Buffer.from('%PDF-1.7\n'), new Uint8Array(2 * 1024 * 1024), Buffer.from('\n%%EOF')], 'synthetic-medium-proof.pdf', { type: 'application/pdf' });
  const changedLimit = fixture(), limitUser = await session(changedLimit), oneMbQuote = await quote(changedLimit, limitUser);
  changedLimit.CUSTOMER_DB.sqlite.prepare("UPDATE commerce_settings SET value_json=? WHERE key='payout_json'").run(JSON.stringify({ ...settings.payout, maxUploadMb: 3 }));
  await rejected(() => api(changedLimit, '/api/checkout/submit', form(limitUser, oneMbQuote, {}, { proof: mediumPdf() }), limitUser), 400);
  assert.equal(changedLimit.CUSTOMER_FILES.puts, 0, 'Increasing the current limit cannot broaden a previously issued quote');
  const threeMbQuote = await quote(changedLimit, limitUser);
  changedLimit.CUSTOMER_DB.sqlite.prepare("UPDATE commerce_settings SET value_json=? WHERE key='payout_json'").run(JSON.stringify({ ...settings.payout, maxUploadMb: 1 }));
  const retainedTerms = await (await api(changedLimit, '/api/checkout/submit', form(limitUser, threeMbQuote, {}, { proof: mediumPdf() }), limitUser)).json();
  assert.ok(retainedTerms.order.id, 'Reducing the current limit cannot invalidate the larger limit promised by an active quote');
  assert.equal(changedLimit.CUSTOMER_FILES.puts, 1);
  for (const payoutSnapshot of ['null', '{broken', JSON.stringify({ maxUploadMb: 0 }), JSON.stringify({ maxUploadMb: 11 }), JSON.stringify({ maxUploadMb: '3' })]) {
    const invalidSnapshot = fixture(), snapshotUser = await session(invalidSnapshot), snapshotQuote = await quote(invalidSnapshot, snapshotUser);
    invalidSnapshot.CUSTOMER_DB.sqlite.prepare('UPDATE checkout_quotes SET payout_json=? WHERE id=?').run(payoutSnapshot, snapshotQuote.id);
    await rejected(() => api(invalidSnapshot, '/api/checkout/submit', form(snapshotUser, snapshotQuote), snapshotUser), 503);
    assert.equal(invalidSnapshot.CUSTOMER_FILES.puts, 0, 'Invalid saved quote terms must fail before file storage');
    assert.equal(count(invalidSnapshot, 'checkout_submissions'), 0);
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
  assert.match(saved.receiptKey, /^[a-f0-9]{64}$/);
  const rawOwnerToken = owner.cookie.split(';')[0].split('=')[1];
  assert.equal(saved.receiptKey, sha('posloker:receipt:v1\u0000' + rawOwnerToken + '\u0000' + saved.order.id));
  assert.equal(persisted.receipt_token_hash, sha(saved.receiptKey), 'Only a hash of the scoped receipt capability is stored');
  assert.notEqual(saved.receiptKey, rawOwnerToken);
  assert.notEqual(saved.receiptKey, persisted.receipt_token_hash);
  assert.ok(!JSON.stringify(saved).includes('synthetic@example.test'));
  assert.ok(!JSON.stringify(saved).includes('Synthetic Employer'));
  assert.ok(!JSON.stringify(saved).includes('private/commerce/'));
  assert.match(saved.whatsappUrl, /^https:\/\/wa\.me\/620000000000\?text=/);
  assert.ok(decodeURIComponent(saved.whatsappUrl).includes('SIMULASI'));
  assert.ok(!decodeURIComponent(saved.whatsappUrl).includes('synthetic@example.test'));
  assert.ok(!saved.whatsappUrl.includes(saved.receiptKey), 'Receipt capabilities must never enter WhatsApp links');
  assertAdminOrderLink(saved);
  const repeat = await api(good, '/api/checkout/submit', form(owner, selected, { idempotencyKey: idem }), owner);
  const repeatedReceipt = await repeat.json();
  assert.equal(repeatedReceipt.order.id, saved.order.id);
  assert.equal(repeatedReceipt.receiptKey, saved.receiptKey, 'A completed retry recovers the same durable capability');
  assert.equal(repeatedReceipt.whatsappUrl, saved.whatsappUrl);
  assert.equal(good.CUSTOMER_FILES.puts, 3, 'A completed same-key retry cannot upload a second copy');
  const receipt = await api(good, '/api/checkout/orders/' + saved.order.id, undefined, owner);
  const sessionReceipt = await receipt.json();
  assert.equal(sessionReceipt.order.id, saved.order.id);
  assert.equal(sessionReceipt.receiptKey, saved.receiptKey);
  assert.equal(sessionReceipt.whatsappUrl, saved.whatsappUrl);
  const foreign = await session(good, '203.0.113.70');
  await rejected(() => api(good, '/api/checkout/orders/' + saved.order.id, undefined, foreign), 404);
  await rejected(() => api(good, '/api/checkout/orders/' + saved.order.id), 401);
  await rejected(() => api(good, '/api/checkout/orders/' + saved.order.id, undefined, { cookie: owner.cookie.split(';')[0] }), 401,
    'Preview receipts require the owner admin session as well as checkout ownership');
  await rejected(() => api(good, '/api/checkout/submit', form(foreign, selected), foreign), 410);

  const gratis = fixture(), gratisUser = await session(gratis), gratisQuote = await quote(gratis, gratisUser, 'Gratis Sintetis');
  const gratisSaved = await (await api(gratis, '/api/checkout/submit', form(gratisUser, gratisQuote), gratisUser)).json();
  assert.equal(gratisSaved.order.amount, 0); assert.equal(gratis.CUSTOMER_FILES.puts, 0);
  assertAdminOrderLink(gratisSaved);
  const live = fixture('live'), liveUser = await session(live, '203.0.113.91', false), liveQuote = await quote(live, liveUser, 'Gratis Sintetis');
  assert.equal(liveUser.body.preview, false); assert.equal(liveUser.body.canSubmit, true);
  const liveSaved = await (await api(live, '/api/checkout/submit', form(liveUser, liveQuote), liveUser)).json();
  assert.equal(liveSaved.order.isTest, false); assert.match(liveSaved.order.orderNumber, /^CF-\d{6}-/);
  assert.ok(!decodeURIComponent(liveSaved.whatsappUrl).includes('SIMULASI'));
  assertAdminOrderLink(liveSaved);

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

  // A bookmark authorizes only its minimal receipt, independently of the
  // one-hour checkout cookie/quote. A simulation still requires its owner.
  const receiptPath = '/api/checkout/receipt';
  const previewCapability = { orderId: saved.order.id, key: saved.receiptKey };
  await rejected(() => api(good, receiptPath, previewCapability), 401);
  const previewDurable = await (await api(good, receiptPath, previewCapability, { cookie: adminCookie })).json();
  assert.equal(previewDurable.order.id, saved.order.id, 'An owner can reopen a simulation after its checkout session expires');
  await rejected(() => api(good, '/api/checkout/orders/' + saved.order.id, undefined, owner), 401);
  good.CUSTOMER_DB.sqlite.prepare("UPDATE commerce_settings SET value_json='\"live\"' WHERE key='mode'").run();
  await rejected(() => api(good, receiptPath, previewCapability), 401, 'Going live cannot make simulation receipts public');
  assert.equal((await (await api(good, receiptPath, previewCapability, { cookie: adminCookie })).json()).order.isTest, true);
  good.CUSTOMER_DB.sqlite.prepare("UPDATE commerce_settings SET value_json='\"preview\"' WHERE key='mode'").run();

  const durable = fixture('live'), durableUser = await session(durable, '203.0.113.110', false);
  const durableQuote = await quote(durable, durableUser), durableSaved = await (await api(durable, '/api/checkout/submit', form(durableUser, durableQuote), durableUser)).json();
  const durableSecondQuote = await quote(durable, durableUser, 'Gratis Sintetis');
  const durableSecond = await (await api(durable, '/api/checkout/submit', form(durableUser, durableSecondQuote), durableUser)).json();
  const capability = { orderId: durableSaved.order.id, key: durableSaved.receiptKey };
  assert.notEqual(durableSaved.receiptKey, durableSecond.receiptKey, 'Each order gets its own scoped capability');
  const crossSession = await session(durable, '203.0.113.111', false);
  const wrongSessionKey = sha('posloker:receipt:v1\u0000' + crossSession.cookie.split(';')[0].split('=')[1] + '\u0000' + durableSaved.order.id);
  await rejected(() => api(durable, receiptPath, { ...capability, key: wrongSessionKey }, crossSession), 404);
  await rejected(() => api(durable, receiptPath, { ...capability, orderId: durableSecond.order.id }), 404);
  const durableSnapshot = JSON.stringify(['commerce_orders','commerce_files','commerce_events','checkout_quotes','checkout_sessions'].map(table => durable.CUSTOMER_DB.sqlite.prepare('SELECT * FROM '+table).all()));
  const firstDurableResponse = await api(durable, receiptPath, capability, { ip: '203.0.113.112' });
  assert.equal(firstDurableResponse.headers.get('Set-Cookie'), null);
  assert.equal(firstDurableResponse.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  assert.equal(firstDurableResponse.headers.get('Referrer-Policy'), 'no-referrer');
  const minimal = await firstDurableResponse.json();
  assertAdminOrderLink(minimal);
  assert.equal(minimal.whatsappUrl, durableSaved.whatsappUrl);
  assert.deepEqual(Object.keys(minimal).sort(), ['order','whatsappUrl']);
  assert.deepEqual(Object.keys(minimal.order).sort(), ['amount','city','id','isTest','orderNumber','packageName','status']);
  const minimalJson = JSON.stringify(minimal);
  for (const secret of [durableSaved.receiptKey, 'receipt_token_hash', 'customer_name', 'Synthetic Employer', 'synthetic@example.test', '6281234567890', 'private/commerce/', durableUser.csrf]) assert.ok(!minimalJson.includes(secret));
  assert.equal(JSON.stringify(['commerce_orders','commerce_files','commerce_events','checkout_quotes','checkout_sessions'].map(table => durable.CUSTOMER_DB.sqlite.prepare('SELECT * FROM '+table).all())), durableSnapshot, 'Receipt reads cannot mutate orders, quotes, sessions, files or audits');
  for (const [bodyChange, options, expected] of [
    [capability, { method:'GET' }, 405], [capability, { headers:{Origin:'https://evil.example.test'} }, 403],
    [capability, { headers:{'Sec-Fetch-Site':'cross-site'} }, 403], [capability, { urlOrigin:'http://checkout.example.test' }, 403],
    [capability, { headers:{'Content-Type':'text/plain'} }, 415], [capability, { headers:{'Content-Length':'5000'} }, 413],
    [{...capability,extra:true}, {}, 400], [{...capability,key:'A'.repeat(64)}, {}, 400],
    [{...capability,orderId:'not-an-order'}, {}, 400], ['x'.repeat(4097), {}, 413],
  ]) {
    if (options.method === 'GET') await rejected(() => api(durable, receiptPath, undefined, options), expected);
    else await rejected(() => api(durable, receiptPath, bodyChange, options), expected);
  }
  await rejected(() => api(durable, receiptPath+'?key='+durableSaved.receiptKey, capability), 400);
  const wrongErrors = await Promise.allSettled([
    api(durable, receiptPath, {...capability,key:'0'.repeat(64)}, {ip:'203.0.113.113'}),
    api(durable, receiptPath, {...capability,orderId:'cf_'+'0'.repeat(32)}, {ip:'203.0.113.114'}),
  ]);
  assert.ok(wrongErrors.every(result => result.status === 'rejected' && result.reason.status === 404));
  durable.CUSTOMER_DB.sqlite.prepare("UPDATE commerce_orders SET post_status='trash' WHERE id=?").run(durableSaved.order.id);
  await assert.rejects(() => api(durable, receiptPath, capability, {ip:'203.0.113.115'}), error=>error.status===404 && error.message===wrongErrors[0].reason.message);
  durable.CUSTOMER_DB.sqlite.prepare("UPDATE commerce_orders SET post_status='publish' WHERE id=?").run(durableSaved.order.id);
  clock += 3600 * 1000 + 1000;
  await rejected(() => api(durable, '/api/checkout/orders/'+durableSaved.order.id, undefined, durableUser), 401);
  await rejected(() => api(durable, '/api/checkout/submit', form(durableUser, durableQuote), durableUser), 401);
  const expiredDurable = await (await api(durable, receiptPath, capability, {ip:'203.0.113.116'})).json();
  assert.equal(expiredDurable.order.id, durableSaved.order.id);
  assert.equal(expiredDurable.order.isTest, false);
  durable.CUSTOMER_DB.sqlite.prepare("DELETE FROM commerce_settings WHERE key='catalog_json'").run();
  assert.equal((await (await api(durable, receiptPath, capability, {ip:'203.0.113.117'})).json()).order.id, durableSaved.order.id,
    'A historical receipt does not depend on today’s catalog configuration');
  durable.CUSTOMER_DB.sqlite.prepare("INSERT INTO commerce_settings(key,value_json) VALUES('catalog_json',?)").run(JSON.stringify(settings.catalog));

  const oldReceipt = fixture(), oldUser = await session(oldReceipt), oldQuote = await quote(oldReceipt, oldUser, 'Gratis Sintetis');
  const oldSaved = await (await api(oldReceipt, '/api/checkout/submit', form(oldUser, oldQuote), oldUser)).json();
  oldReceipt.CUSTOMER_DB.sqlite.prepare('UPDATE commerce_orders SET receipt_token_hash=NULL WHERE id=?').run(oldSaved.order.id);
  const oldSessionReceipt = await (await api(oldReceipt, '/api/checkout/orders/'+oldSaved.order.id, undefined, oldUser)).json();
  assert.equal(oldSessionReceipt.order.id, oldSaved.order.id);
  assert.ok(!Object.hasOwn(oldSessionReceipt, 'receiptKey'), 'Existing NULL-token orders keep their original session-only access');
  await rejected(() => api(oldReceipt, receiptPath, {orderId:oldSaved.order.id,key:oldSaved.receiptKey}, {cookie:adminCookie}), 404);
  assert.throws(()=>oldReceipt.CUSTOMER_DB.sqlite.prepare("UPDATE commerce_orders SET receipt_token_hash='invalid' WHERE id=?").run(oldSaved.order.id));

  const receiptLimited = fixture('live'), receiptLimitedUser = await session(receiptLimited, '203.0.113.120', false), receiptLimitedQuote = await quote(receiptLimited, receiptLimitedUser, 'Gratis Sintetis');
  const receiptLimitedSaved = await (await api(receiptLimited, '/api/checkout/submit', form(receiptLimitedUser, receiptLimitedQuote), receiptLimitedUser)).json();
  const limitedCapability = {orderId:receiptLimitedSaved.order.id,key:receiptLimitedSaved.receiptKey};
  for (let index=0;index<20;index++) await api(receiptLimited, receiptPath, limitedCapability, {ip:'203.0.113.121'});
  const limitedBefore = JSON.stringify(receiptLimited.CUSTOMER_DB.sqlite.prepare('SELECT * FROM checkout_rate_limits ORDER BY bucket_hash').all());
  for (let index=0;index<10;index++) await rejected(()=>api(receiptLimited, receiptPath, limitedCapability, {ip:'203.0.113.121'}),429);
  assert.equal(JSON.stringify(receiptLimited.CUSTOMER_DB.sqlite.prepare('SELECT * FROM checkout_rate_limits ORDER BY bucket_hash').all()),limitedBefore,'Blocked receipt callers cannot keep writing or consume the global budget');
  for (let index=20;index<200;index++) await api(receiptLimited,receiptPath,limitedCapability,{ip:'198.51.100.'+(Math.floor(index/20)+1)});
  const globallyFullCount=count(receiptLimited,'checkout_rate_limits');
  await rejected(()=>api(receiptLimited,receiptPath,limitedCapability,{ip:'198.51.100.250'}),429);
  assert.equal(count(receiptLimited,'checkout_rate_limits'),globallyFullCount,'A globally blocked receipt request cannot allocate another address bucket');

  for (const fixtureDb of fixtures) {
    assert.equal(fixtureDb.sqlite.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.equal(fixtureDb.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
  }
  console.log('Synthetic checkout checks passed: server catalog/price/code reservations, preview isolation, hashed sessions/CSRF, upload magic/limits, durable scoped receipts after session expiry, no receipt-key sharing/leaks, bounded receipt access, idempotent concurrent submission, owned cleanup, ambiguous-commit recovery, and D1 integrity.');
} finally { Date.now = originalNow; for (const db of fixtures) db.sqlite.close(); }
