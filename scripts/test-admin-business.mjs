import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { handleBusiness, readBusinessSettings, readPageContent } from '../src/admin-business.mjs';
import { PAGE_DEFAULTS, SITE_DEFAULTS } from '../src/public-content-defaults.mjs';

// Real SQLite and synthetic settings only; never open the migration snapshot.
const sqlite = new DatabaseSync(':memory:');
for (const file of ['0001_customer_data.sql', '0002_order_files.sql', '0003_admin.sql', '0004_order_admin.sql', '0005_checkout.sql', '0006_business_admin.sql']) {
  sqlite.exec(await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8'));
}
sqlite.prepare('INSERT INTO admin_users VALUES(?,?,?,?,?,?)').run(1, 'owner@example.test', 'a'.repeat(64), 'b'.repeat(64), 100000, 1000);

const catalog = {
  cities: [{ name: 'Kota Satu', pricingKey: 'default' }, { name: 'Kota Dua', pricingKey: 'promo' }],
  pricing: {
    default: [{ id: 'ig', name: 'Paket IG', price: 10000, features: ['Satu unggahan'], badge: 'Pilihan' }, { id: 'komplit-plus', name: 'Paket Plus', price: 30000, features: ['Materi video'] }],
    promo: [{ id: 'gratis', name: 'Paket Gratis', price: 0, features: ['Unggahan contoh'] }],
  },
};
const payout = { bankName: 'Bank Contoh', bankAccount: '1234567890', bankHolder: 'Pemilik Contoh', whatsapp: '6280000000000', maxUploadMb: 5 };
const site = { contactEmail: 'kontak@example.test', instagramUrl: 'https://www.instagram.com/posloker.test/', facebookUrl: 'https://www.facebook.com/posloker.test/' };
sqlite.prepare('INSERT INTO commerce_settings VALUES(?,?)').run('catalog_json', JSON.stringify(catalog));
sqlite.prepare('INSERT INTO commerce_settings VALUES(?,?)').run('payout_json', JSON.stringify(payout));
sqlite.prepare('INSERT INTO checkout_sessions VALUES(?,?,?,?)').run('synthetic-session', 'c'.repeat(64), 1000, 4600);
sqlite.prepare(`INSERT INTO checkout_quotes(id,session_hash,city,package_id,package_name,features_json,payout_json,base_amount,unique_code,amount,is_test,created_at,expires_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('synthetic-quote', 'synthetic-session', 'Kota Satu', 'ig', 'Paket IG', '["Satu unggahan"]', JSON.stringify(payout), 10000, 15, 10015, 1, 1000, 4600);
const tablesToPreserve = ['migration_runs', 'customers', 'orders', 'order_meta', 'order_files', 'checkout_quotes', 'checkout_sessions', 'commerce_orders', 'commerce_files', 'commerce_events'];
const preserved = () => JSON.stringify(tablesToPreserve.map(table => sqlite.prepare('SELECT * FROM ' + table).all()));
const originalData = preserved();
const originalMode = sqlite.prepare("SELECT value_json FROM commerce_settings WHERE key='mode'").get().value_json;
let failOn = null;
let beforeMutation = null;
class Statement {
  constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.sql, args); }
  execute() {
    if (failOn?.test(this.sql)) throw new Error('Synthetic settings storage failure');
    const before = sqlite.prepare('SELECT total_changes() AS n').get().n, statement = sqlite.prepare(this.sql);
    const results = statement.columns().length ? statement.all(...this.args).map(row => ({ ...row })) : (statement.run(...this.args), []);
    return { results, success: true, meta: { changes: sqlite.prepare('SELECT total_changes() AS n').get().n - before } };
  }
  async first(column) { const result = this.execute().results[0] || null; return result && column ? result[column] : result; }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
}
const db = {
  prepare(sql) { return new Statement(sql); },
  async batch(statements) {
    if (beforeMutation && statements.some(statement => /INSERT INTO business_admin_events/.test(statement.sql))) {
      const operation = beforeMutation; beforeMutation = null; operation();
    }
    sqlite.exec('BEGIN IMMEDIATE');
    try { const result = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const env = { CUSTOMER_DB: db };
const origin = 'https://admin.example.test', csrf = 'c'.repeat(64);
const auth = { user: { id: 1, email: 'owner@example.test' }, session: { csrfToken: csrf }, csrfToken: csrf };
const get = path => new Request(origin + path);
const put = (path, body, extra = {}) => new Request(origin + path, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...extra }, body: JSON.stringify(body) });
const call = (request, currentAuth = auth) => handleBusiness(request, env, new URL(request.url), currentAuth);
const businessPath = '/api/admin/business', contentPath = '/api/admin/content';
const data = response => response.json();
const expectedError = (promise, status) => assert.rejects(promise, error => error.status === status);
const bodyFor = async () => {
  const current = await readBusinessSettings(db);
  return { expectedRevision: current.revision, catalog: current.catalog, payout: current.payout, site: current.site, reason: 'Pemeriksaan pengaturan contoh' };
};
const snapshotAdmin = () => JSON.stringify(['business_admin_state', 'business_admin_events', 'commerce_settings', 'page_content'].map(table => sqlite.prepare('SELECT * FROM ' + table).all()));

try {
  assert.equal(await call(get('/api/admin/not-business')), null);
  await expectedError(call(get(businessPath), null), 401);
  await expectedError(call(get(contentPath), { ...auth, user: { id: 2 } }), 401);
  const initial = await data(await call(get(businessPath)));
  assert.equal(initial.revision, 0); assert.deepEqual(initial.catalog, catalog); assert.deepEqual(initial.payout, payout);
  assert.deepEqual(initial.site, SITE_DEFAULTS); assert.deepEqual(initial.events, []);
  const initialPages = await data(await call(get(contentPath)));
  assert.equal(initialPages.pages.length, PAGE_DEFAULTS.length);
  assert.equal(initialPages.pages.length, 51);
  assert.ok(initialPages.pages.every(page => page.revision === 0 && !('selectors' in page) && !('structuredData' in page)));
  assert.ok(initialPages.pages.every(page => Object.values(page.overrides).every(value => value === null)));
  assert.equal((await call(get(businessPath))).headers.get('Cache-Control'), 'private, no-store, max-age=0');
  const baseline = await bodyFor();
  for (const [headers, status] of [
    [{ 'X-CSRF-Token': '' }, 403], [{ 'X-CSRF-Token': 'x'.repeat(64) }, 403],
    [{ Origin: 'https://evil.example.test' }, 403], [{ 'Sec-Fetch-Site': 'cross-site' }, 403],
    [{ 'Content-Type': 'text/plain' }, 415], [{ 'Content-Length': String(128 * 1024 + 1) }, 413],
  ]) await expectedError(call(put(businessPath, baseline, headers)), status);
  await expectedError(call(new Request(origin + businessPath, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: '{}' })), 405);
  await expectedError(call(new Request('http://admin.example.test' + businessPath, { method: 'PUT', headers: { Origin: 'http://admin.example.test', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(baseline) })), 403);
  await expectedError(call(put(businessPath, { ...baseline, reason: 'a'.repeat(129 * 1024) })), 413);
  const unchanged = await data(await call(put(businessPath, baseline)));
  assert.equal(unchanged.unchanged, true); assert.equal(unchanged.revision, 0);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM business_admin_events').get().n, 0);

  const cases = [
    body => { body.mode = 'live'; },
    body => { body.expectedRevision = -1; },
    body => { body.reason = ' x '; },
    body => { body.catalog.cities.pop(); },
    body => { body.catalog.cities[0].pricingKey = 'missing'; },
    body => { body.catalog.cities.push(body.catalog.cities[0]); },
    body => { body.catalog.pricing.extra = []; },
    body => { body.catalog.pricing.default[0].id = 'new-id'; },
    body => { body.catalog.pricing.default[0].price = 1.2; },
    body => { body.catalog.pricing.default[0].price = 1000000001; },
    body => { body.catalog.pricing.default[0].name = '<script>bad</script>'; },
    body => { body.catalog.pricing.default[0].features = Array(31).fill('Feature'); },
    body => { body.catalog.pricing.default[0].features = ['x'.repeat(301)]; },
    body => { body.catalog.pricing.default[0].badge = 'x'.repeat(81); },
    body => { body.payout.whatsapp = 'javascript:1'; },
    body => { body.payout.maxUploadMb = 11; },
    body => { body.payout.maxUploadMb = 0; },
    body => { body.payout.bankHolder = '<img src=x>'; },
    body => { body.site.contactEmail = 'not-email'; },
    body => { body.site.instagramUrl = 'javascript:alert(1)'; },
    body => { body.site.instagramUrl = 'https://instagram.com.evil.example.test/'; },
    body => { body.site.instagramUrl = 'https://user:pass@instagram.com/'; },
    body => { body.site.facebookUrl = 'http://facebook.com/'; },
    body => { body.site.facebookUrl = 'https://facebook.com:444/'; },
  ];
  for (const mutate of cases) {
    const body = structuredClone(baseline); mutate(body);
    await expectedError(call(put(businessPath, body)), 400);
  }
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM business_admin_events').get().n, 0, 'Rejected mutations do not create audit events');
  const desired = structuredClone(baseline);
  desired.catalog.pricing.default[0].price = 12500;
  desired.catalog.pricing.default[0].name = 'Paket Contoh É😀';
  desired.catalog.pricing.default[0].features.push('Caption contoh');
  desired.catalog.cities[1].pricingKey = 'default';
  desired.payout.bankAccount = '0987654321'; desired.payout.whatsapp = '080000000000'; desired.payout.maxUploadMb = 3;
  desired.site = site;
  for (const failure of [/INSERT INTO business_admin_events/, /UPDATE commerce_settings SET value_json=.*WHERE key='payout_json'/s, /UPDATE business_admin_state SET/]) {
    const before = snapshotAdmin(); failOn = failure;
    await assert.rejects(call(put(businessPath, desired)));
    failOn = null; assert.equal(snapshotAdmin(), before, 'A settings/audit failure must roll back the entire mutation');
  }
  let changed = await data(await call(put(businessPath, desired)));
  assert.equal(changed.revision, 1); assert.equal(changed.catalog.pricing.default[0].price, 12500);
  assert.equal(changed.payout.whatsapp, '6280000000000');
  assert.equal(changed.site.contactEmail, site.contactEmail);
  assert.equal(changed.events.length, 1); assert.equal(changed.events[0].reason, desired.reason);
  assert.equal(changed.events[0].actor, 'owner@example.test');
  assert.ok(!('previous_json' in changed.events[0]) && !('next_json' in changed.events[0]), 'Audit summary does not return historic payout JSON');
  const audit = sqlite.prepare("SELECT previous_json,next_json FROM business_admin_events WHERE scope='business'").get();
  assert.equal(JSON.parse(audit.previous_json).payout.bankAccount, payout.bankAccount);
  assert.equal(JSON.parse(audit.next_json).payout.bankAccount, desired.payout.bankAccount);
  await expectedError(call(put(businessPath, desired)), 409);
  const concurrentA = await bodyFor(), concurrentB = structuredClone(concurrentA);
  concurrentA.payout.bankName = 'Bank Pilihan Satu'; concurrentB.payout.bankName = 'Bank Pilihan Dua';
  const outcomes = await Promise.allSettled([call(put(businessPath, concurrentA)), call(put(businessPath, concurrentB))]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(outcome => outcome.status === 'rejected').reason.status, 409);
  assert.equal(sqlite.prepare('SELECT revision FROM business_admin_state').get().revision, 2);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM business_admin_events WHERE scope='business'").get().n, 2);

  const external = await bodyFor(); external.payout.bankName = 'Do not overwrite operator edit';
  beforeMutation = () => sqlite.prepare("UPDATE commerce_settings SET value_json=? WHERE key='payout_json'").run(JSON.stringify({ ...external.payout, bankName: 'Operator direct edit' }));
  await expectedError(call(put(businessPath, external)), 409);
  assert.equal((await readBusinessSettings(db)).payout.bankName, 'Operator direct edit');
  const externalSite = await bodyFor(); externalSite.payout.bankName = 'Another edit';
  beforeMutation = () => sqlite.prepare('UPDATE business_admin_state SET site_json=?').run(JSON.stringify({ ...site, contactEmail: 'operator@example.test' }));
  await expectedError(call(put(businessPath, externalSite)), 409);
  assert.equal((await readBusinessSettings(db)).site.contactEmail, 'operator@example.test');
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM business_admin_events WHERE scope='business'").get().n, 2);

  const target = initialPages.pages.find(page => page.path === '/') || initialPages.pages[0];
  const content = { path: target.path, expectedRevision: 0, title: 'Judul Uji É😀', description: 'Deskripsi publik contoh', heading: 'Selamat datang contoh', intro: 'Paragraf satu.\nParagraf dua.', reason: 'Uji perubahan konten publik' };
  for (const mutate of [
    body => { body.path = '/api/admin/'; }, body => { body.path = '/area/../admin/'; },
    body => { body.title = '<script>bad</script>'; }, body => { body.description = 'x'.repeat(321); },
    body => { body.intro = '\u0000'; }, body => { body.extra = 'not allowed'; },
  ]) { const bad = structuredClone(content); mutate(bad); await expectedError(call(put(contentPath, bad)), 400); }
  await expectedError(call(put(contentPath, content, { 'X-CSRF-Token': '' })), 403);
  failOn = /INSERT INTO page_content/;
  const beforeContentFailure = snapshotAdmin(); await assert.rejects(call(put(contentPath, content))); failOn = null;
  assert.equal(snapshotAdmin(), beforeContentFailure, 'Content persistence failure must roll back its audit');
  let pageResponse = await data(await call(put(contentPath, content)));
  let page = pageResponse.pages.find(page => page.path === target.path);
  assert.equal(page.title, content.title); assert.equal(page.intro, content.intro); assert.equal(page.revision, 1);
  assert.deepEqual(page.defaults, target.defaults); assert.equal(page.overrides.heading, content.heading);
  await expectedError(call(put(contentPath, content)), 409);
  const contentOutcomes = await Promise.allSettled([
    call(put(contentPath, { ...content, expectedRevision: 1, heading: 'One concurrent title' })),
    call(put(contentPath, { ...content, expectedRevision: 1, heading: 'Another concurrent title' })),
  ]);
  assert.equal(contentOutcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  assert.equal(contentOutcomes.find(outcome => outcome.status === 'rejected').reason.status, 409);
  const restore = { ...content, expectedRevision: 2, title: null, description: null, heading: null, intro: null, reason: 'Pulihkan konten sumber' };
  pageResponse = await data(await call(put(contentPath, restore)));
  page = pageResponse.pages.find(page => page.path === target.path);
  assert.equal(page.title, target.defaults.title); assert.equal(page.heading, target.defaults.heading);
  assert.equal(page.revision, 3); assert.ok(Object.values(page.overrides).every(value => value === null));
  assert.equal((await data(await call(put(contentPath, { ...restore, expectedRevision: 3 })))).unchanged, true);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM business_admin_events WHERE scope='content'").get().n, 3);
  assert.equal((await readPageContent(db)).length, 51);
  assert.equal(preserved(), originalData, 'Settings/content edits preserve imported records, checkout sessions and quote snapshots');
  assert.equal(sqlite.prepare("SELECT value_json FROM commerce_settings WHERE key='mode'").get().value_json, originalMode, 'No settings endpoint may change checkout preview/live mode');
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  console.log('Synthetic business/content checks passed: owner access, same-origin CSRF, strict full catalog/payout/site validation, immutable catalog IDs, safe 51-page text overrides/restoration, bounded bodies, atomic audit rollback, concurrent revision protection, operator-edit conflicts, unchanged quote/source data and mode.');
} finally { sqlite.close(); }
