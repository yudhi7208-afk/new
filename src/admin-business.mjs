import { HttpError, assertMutation } from './admin-auth.mjs';
import { json as responseJson } from './admin-orders.mjs';
import { PAGE_DEFAULTS, SITE_DEFAULTS } from './public-content-defaults.mjs';

const CONTENT_FIELDS = ['title', 'description', 'heading', 'intro'];
const CONTENT_LIMITS = { title: 150, description: 320, heading: 250, intro: 3000 };
const BODY_LIMIT = 128 * 1024;
const TOKEN_KEY = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const pageDefaults = new Map(PAGE_DEFAULTS.map(page => [page.path, page]));
const rows = result => result?.results || [];
const seconds = () => Math.floor(Date.now() / 1000);
const json = (value, status = 200) => responseJson(value, status, {
  'Cache-Control': 'private, no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
});

function object(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function fail(message = 'Pengaturan tidak valid. Periksa isian Anda.') { throw new HttpError(400, message); }
function keys(value, permitted) {
  if (!object(value) || Object.keys(value).some(key => !permitted.includes(key))) fail('Field pengaturan tidak diizinkan.');
}
function plain(value, max, required = false, multiline = false) {
  if (typeof value !== 'string' || value.length > max || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
      (!multiline && /[\r\n]/.test(value)) || (required && !value.trim())) fail('Isian harus berupa teks biasa dengan panjang yang sesuai.');
  return value.trim();
}
function sameSet(left, right) {
  return left.length === right.length && new Set(left).size === left.length && new Set(right).size === right.length && left.every(value => right.includes(value));
}
function catalogValue(value, baseline) {
  keys(value, ['cities', 'pricing']);
  if (!Array.isArray(value.cities) || !value.cities.length || value.cities.length > 100 || !object(value.pricing)) fail('Katalog kota dan paket belum lengkap.');
  const groupKeys = Object.keys(value.pricing);
  if (!groupKeys.length || groupKeys.length > 100 || groupKeys.some(key => !TOKEN_KEY.test(key)) ||
      !sameSet(groupKeys, Object.keys(baseline.pricing))) fail('Kelompok harga tidak boleh ditambahkan atau dihapus melalui formulir ini.');
  const names = value.cities.map(city => city?.name);
  if (!sameSet(names, baseline.cities.map(city => city.name))) fail('Daftar kota sumber harus dipertahankan.');
  const cities = value.cities.map(city => {
    keys(city, ['name', 'pricingKey']);
    const name = plain(city.name, 100, true), pricingKey = plain(city.pricingKey, 100, true);
    if (!Object.hasOwn(value.pricing, pricingKey)) fail('Setiap kota harus memakai kelompok harga yang tersedia.');
    return { name, pricingKey };
  });
  const pricing = Object.create(null);
  for (const group of groupKeys) {
    const packages = value.pricing[group], original = baseline.pricing[group];
    if (!Array.isArray(packages) || !packages.length || packages.length > 20 || !Array.isArray(original) ||
        !sameSet(packages.map(item => item?.id), original.map(item => item.id))) fail('ID dan daftar paket sumber harus dipertahankan.');
    pricing[group] = packages.map(item => {
      keys(item, ['id', 'name', 'price', 'features', 'badge']);
      if (!TOKEN_KEY.test(item.id) || !Number.isSafeInteger(item.price) || item.price < 0 || item.price > 1000000000 ||
          !Array.isArray(item.features) || item.features.length > 30) fail('Harga atau fitur paket tidak valid.');
      const next = { id: item.id, name: plain(item.name, 150, true), price: item.price,
        features: item.features.map(feature => plain(feature, 300, true)) };
      if (Object.hasOwn(item, 'badge')) next.badge = plain(item.badge, 80);
      return next;
    });
  }
  return { cities, pricing };
}
function payoutValue(value) {
  keys(value, ['bankName', 'bankAccount', 'bankHolder', 'whatsapp', 'maxUploadMb']);
  let whatsapp = plain(value.whatsapp, 30, true);
  if (!/^[+\d\s()-]+$/.test(whatsapp)) fail('Nomor WhatsApp tidak valid.');
  whatsapp = whatsapp.replace(/\D/g, '');
  if (whatsapp.startsWith('0')) whatsapp = '62' + whatsapp.slice(1);
  else if (whatsapp.startsWith('8')) whatsapp = '62' + whatsapp;
  if (!/^\d{10,15}$/.test(whatsapp) || !Number.isSafeInteger(value.maxUploadMb) || value.maxUploadMb < 1 || value.maxUploadMb > 10) fail('Nomor WhatsApp atau batas unggahan tidak valid.');
  return { bankName: plain(value.bankName, 100, true), bankAccount: plain(value.bankAccount, 80, true),
    bankHolder: plain(value.bankHolder, 200, true), whatsapp, maxUploadMb: value.maxUploadMb };
}
function siteValue(value) {
  keys(value, ['contactEmail', 'instagramUrl', 'facebookUrl']);
  const contactEmail = plain(value.contactEmail, 254);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) fail('Alamat email kontak tidak valid.');
  const link = (value, domain) => {
    const clean = plain(value, 500);
    if (!clean) return '';
    let url;
    try { url = new URL(clean); } catch { fail('Alamat media sosial tidak valid.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || ![domain, 'www.' + domain].includes(url.hostname)) fail('Gunakan alamat HTTPS Instagram atau Facebook yang sesuai.');
    return url.href;
  };
  return { contactEmail, instagramUrl: link(value.instagramUrl, 'instagram.com'), facebookUrl: link(value.facebookUrl, 'facebook.com') };
}
function overridesValue(value) {
  keys(value, CONTENT_FIELDS);
  const result = {};
  for (const field of CONTENT_FIELDS) result[field] = value[field] === null ? null : plain(value[field], CONTENT_LIMITS[field], true, field === 'intro');
  return result;
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function validRevision(value) { if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) fail('Revisi pengaturan tidak valid.'); return value; }
function reasonValue(value) { const reason = plain(value, 500, true, true); if (reason.length < 3) fail('Alasan perubahan minimal 3 karakter.'); return reason; }
function dbOf(env) {
  if (!env.CUSTOMER_DB?.prepare || !env.CUSTOMER_DB?.batch) throw new HttpError(503, 'Pengaturan admin belum siap.');
  return env.CUSTOMER_DB;
}
function owner(auth) { if (auth?.user?.id !== 1) throw new HttpError(401, 'Silakan masuk sebagai pemilik.'); }
function assertPut(request, auth) {
  if (request.method !== 'PUT') throw new HttpError(405, 'Metode tidak diizinkan.');
  // Reuse the existing header/transport/CSRF guard without consuming the PUT
  // body; only this explicit settings route maps its mutation method to POST.
  assertMutation(new Request(request.url, { method: 'POST', headers: request.headers }), auth);
}
async function inputJson(request) {
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > BODY_LIMIT)) throw new HttpError(413, 'Isian pengaturan terlalu besar.');
  const reader = request.body?.getReader();
  if (!reader) fail('Isian pengaturan belum lengkap.');
  const chunks = []; let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > BODY_LIMIT) { await reader.cancel(); throw new HttpError(413, 'Isian pengaturan terlalu besar.'); }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); if (!object(value)) fail(); return value; }
  catch (error) { if (error instanceof HttpError) throw error; fail('Isian pengaturan tidak valid.'); }
}
async function rawBusiness(db) {
  const results = await db.batch([
    db.prepare("SELECT key,value_json FROM commerce_settings WHERE key IN ('catalog_json','payout_json')"),
    db.prepare('SELECT revision,site_json,updated_at AS updatedAt FROM business_admin_state WHERE id=1'),
  ]);
  const values = new Map(rows(results[0]).map(row => [row.key, row.value_json])), state = rows(results[1])[0];
  if (!state || !Number.isSafeInteger(state.revision)) throw new HttpError(503, 'Skema pengaturan admin belum siap.');
  let catalog, payout, site;
  try {
    catalog = JSON.parse(values.get('catalog_json')); payout = JSON.parse(values.get('payout_json'));
    site = siteValue(state.site_json === null ? SITE_DEFAULTS : JSON.parse(state.site_json));
    // Stored configuration must satisfy the same public-checkout limits.
    catalogValue(catalog, catalog); payoutValue(payout);
  } catch { throw new HttpError(503, 'Katalog atau pengaturan pembayaran belum siap.'); }
  return { revision: state.revision, updatedAt: state.updatedAt, catalog, payout, site,
    rawCatalog: values.get('catalog_json'), rawPayout: values.get('payout_json'), rawSite: state.site_json };
}
export async function readBusinessSettings(db) {
  const current = await rawBusiness(db);
  return { revision: current.revision, updatedAt: current.updatedAt, catalog: current.catalog, payout: current.payout, site: current.site };
}
function pageDto(base, stored) {
  const defaults = Object.fromEntries(CONTENT_FIELDS.map(field => [field, base[field] || '']));
  let overrides = Object.fromEntries(CONTENT_FIELDS.map(field => [field, null]));
  if (stored) {
    try { overrides = overridesValue(JSON.parse(stored.data_json)); }
    catch { throw new HttpError(503, 'Konten halaman belum siap.'); }
  }
  return { path: base.path, label: base.label || base.path, ...Object.fromEntries(CONTENT_FIELDS.map(field => [field, overrides[field] ?? defaults[field]])),
    defaults, overrides, revision: stored?.revision || 0, updatedAt: stored?.updated_at || 0 };
}
export async function readPageContent(db) {
  const stored = new Map(rows(await db.prepare('SELECT path,data_json,revision,updated_at FROM page_content').all()).map(row => [row.path, row]));
  return PAGE_DEFAULTS.map(base => pageDto(base, stored.get(base.path)));
}
async function events(db, scope) {
  return rows(await db.prepare(`SELECT e.id,e.scope,e.path,u.email AS actor,e.reason,e.revision,e.created_at AS createdAt
    FROM business_admin_events e JOIN admin_users u ON u.id=e.admin_id WHERE e.scope=? ORDER BY e.created_at DESC,e.rowid DESC LIMIT 20`).bind(scope).all());
}
async function businessView(db) { return { ...await readBusinessSettings(db), events: await events(db, 'business') }; }
async function contentView(db) { return { pages: await readPageContent(db), events: await events(db, 'content') }; }
async function saveBusiness(request, db, auth) {
  assertPut(request, auth);
  const input = await inputJson(request); keys(input, ['expectedRevision', 'catalog', 'payout', 'site', 'reason']);
  const expected = validRevision(input.expectedRevision), reason = reasonValue(input.reason), current = await rawBusiness(db);
  if (current.revision !== expected) throw new HttpError(409, 'Pengaturan sudah berubah. Muat ulang sebelum menyimpan.');
  const catalog = catalogValue(input.catalog, current.catalog), payout = payoutValue(input.payout), site = siteValue(input.site);
  const previous = { catalog: current.catalog, payout: current.payout, site: current.site }, next = { catalog, payout, site };
  if (canonical(previous) === canonical(next)) return json({ saved: true, unchanged: true, ...await businessView(db) });
  const changeId = crypto.randomUUID(), revision = expected + 1, at = seconds();
  const result = await db.batch([
    db.prepare(`INSERT INTO business_admin_events(id,scope,path,admin_id,previous_json,next_json,reason,revision,created_at)
      SELECT ?,'business','',?,?,?,?,revision+1,? FROM business_admin_state
      WHERE id=1 AND revision=?
      AND EXISTS(SELECT 1 FROM commerce_settings WHERE key='catalog_json' AND value_json=?)
      AND EXISTS(SELECT 1 FROM commerce_settings WHERE key='payout_json' AND value_json=?)
      AND ((site_json IS NULL AND ? IS NULL) OR site_json=?)`).bind(changeId, auth.user.id, JSON.stringify(previous), JSON.stringify(next), reason, at, expected, current.rawCatalog, current.rawPayout, current.rawSite, current.rawSite),
    db.prepare(`UPDATE commerce_settings SET value_json=? WHERE key='catalog_json'
      AND EXISTS(SELECT 1 FROM business_admin_events WHERE id=? AND scope='business' AND revision=?)`).bind(JSON.stringify(catalog), changeId, revision),
    db.prepare(`UPDATE commerce_settings SET value_json=? WHERE key='payout_json'
      AND EXISTS(SELECT 1 FROM business_admin_events WHERE id=? AND scope='business' AND revision=?)`).bind(JSON.stringify(payout), changeId, revision),
    db.prepare(`UPDATE business_admin_state SET revision=revision+1,site_json=?,updated_at=?,updated_by=? WHERE id=1 AND revision=?
      AND EXISTS(SELECT 1 FROM business_admin_events WHERE id=? AND scope='business' AND revision=business_admin_state.revision+1)
      RETURNING revision`).bind(JSON.stringify(site), at, auth.user.id, expected, changeId),
  ]);
  if (result[0]?.meta?.changes !== 1 || result[1]?.meta?.changes !== 1 || result[2]?.meta?.changes !== 1 || rows(result[3])[0]?.revision !== revision) throw new HttpError(409, 'Pengaturan sudah berubah. Muat ulang sebelum menyimpan.');
  return json({ saved: true, ...await businessView(db) });
}
async function saveContent(request, db, auth) {
  assertPut(request, auth);
  const input = await inputJson(request); keys(input, ['path', 'expectedRevision', ...CONTENT_FIELDS, 'reason']);
  const base = pageDefaults.get(input.path);
  if (!base) fail('Halaman tidak tersedia untuk pengelolaan konten.');
  const expected = validRevision(input.expectedRevision), reason = reasonValue(input.reason);
  const overrides = overridesValue(Object.fromEntries(CONTENT_FIELDS.map(field => [field, input[field]])));
  const stored = await db.prepare('SELECT path,data_json,revision,updated_at FROM page_content WHERE path=?').bind(base.path).first();
  const current = pageDto(base, stored);
  if (current.revision !== expected) throw new HttpError(409, 'Konten sudah berubah. Muat ulang sebelum menyimpan.');
  if (canonical(current.overrides) === canonical(overrides)) return json({ saved: true, unchanged: true, ...await contentView(db) });
  const changeId = crypto.randomUUID(), revision = expected + 1, at = seconds(), nextJson = JSON.stringify(overrides);
  const result = await db.batch([
    db.prepare(`INSERT INTO business_admin_events(id,scope,path,admin_id,previous_json,next_json,reason,revision,created_at)
      SELECT ?,'content',?,?,?,?,?,?,? WHERE COALESCE((SELECT revision FROM page_content WHERE path=?),0)=?
      AND ((? IS NULL AND NOT EXISTS(SELECT 1 FROM page_content WHERE path=?)) OR
        EXISTS(SELECT 1 FROM page_content WHERE path=? AND data_json=?))`).bind(changeId, base.path, auth.user.id, JSON.stringify(current.overrides), nextJson, reason, revision, at,
        base.path, expected, stored?.data_json ?? null, base.path, base.path, stored?.data_json ?? null),
    db.prepare(`INSERT INTO page_content(path,data_json,revision,updated_at,updated_by)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM business_admin_events WHERE id=? AND scope='content' AND path=? AND revision=?)
      ON CONFLICT(path) DO UPDATE SET data_json=excluded.data_json,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by
      WHERE page_content.revision=? RETURNING revision`).bind(base.path, nextJson, revision, at, auth.user.id, changeId, base.path, revision, expected),
  ]);
  if (result[0]?.meta?.changes !== 1 || rows(result[1])[0]?.revision !== revision) throw new HttpError(409, 'Konten sudah berubah. Muat ulang sebelum menyimpan.');
  return json({ saved: true, ...await contentView(db) });
}
export async function handleBusiness(request, env, url, auth) {
  if (!['/api/admin/business', '/api/admin/content'].includes(url.pathname)) return null;
  owner(auth);
  const db = dbOf(env);
  if (url.pathname === '/api/admin/business') {
    if (request.method === 'GET') return json(await businessView(db));
    return saveBusiness(request, db, auth);
  }
  if (request.method === 'GET') return json(await contentView(db));
  return saveContent(request, db, auth);
}
