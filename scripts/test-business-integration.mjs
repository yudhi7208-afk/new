import assert from 'node:assert/strict';
import { PAGE_DEFAULTS } from '../src/public-content-defaults.mjs';

// This integration test mutates and restores a dedicated LOCAL fixture. It
// deliberately cannot target Cloudflare, a domain, HTTPS, or a redirect.
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--origin'), 'Use --origin http://127.0.0.1:PORT only.');
let target;
try { target = new URL(args[1] || 'http://127.0.0.1:8788/'); } catch { throw new Error('A local test origin is required.'); }
assert.ok(target.protocol === 'http:' && target.hostname === '127.0.0.1' && /^\d+$/.test(target.port) &&
  target.pathname === '/' && !target.username && !target.password && !target.search && !target.hash,
  'This test refuses every target except an explicit http://127.0.0.1:PORT origin.');
const origin = target.origin;
const cookies = new Map();
let adminCsrf;
let originalBusiness, originalContent;
let ownedBusinessRevision, ownedContentRevision;
let contentPath;
let phase = 'local fixture preflight';
let restorePhase = 'settings snapshot';

function rememberCookies(response) {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0], split = pair.indexOf('=');
    if (split > 0) cookies.set(pair.slice(0, split), pair.slice(split + 1));
  }
}
async function request(path, { method = 'GET', body, csrf = adminCsrf, authenticated = true, headers: extra = {} } = {}) {
  assert.ok(path.startsWith('/') && !path.startsWith('//'), 'Only same-origin test paths are permitted.');
  const headers = new Headers(extra);
  if (authenticated && cookies.size) headers.set('Cookie', [...cookies].map(([key, value]) => key + '=' + value).join('; '));
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('Origin', origin); headers.set('Sec-Fetch-Site', 'same-origin');
    headers.set('Content-Type', 'application/json');
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  const response = await fetch(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error' });
  if (authenticated) rememberCookies(response);
  return response;
}
async function jsonResponse(response, expected = 200, label = 'Local API') {
  assert.equal(response.status, expected, label + ' returned an unexpected status.');
  let value;
  try { value = await response.json(); } catch { throw new Error(label + ' did not return valid JSON.'); }
  return value;
}
async function json(path, options, status = 200) { return jsonResponse(await request(path, options), status, path); }
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object'
  ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const equal = (left, right) => canonical(left) === canonical(right);
const decode = value => value.replace(/&#(x[\da-f]+|\d+);/gi, (_, number) => String.fromCodePoint(number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number)))
  .replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, name) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[name]);
const plain = value => decode(value.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const slug = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function scriptBlocks(html) { return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]; }
function config(html, name) {
  const scripts = scriptBlocks(html).filter(match => match[1].includes('data-posloker-config="' + name + '"'));
  assert.equal(scripts.length, 1, 'Exactly one expected public configuration script must render.');
  const assignment = scripts[0][2].match(new RegExp('^\\s*var\\s+' + name + '\\s*=\\s*([\\s\\S]+);\\s*$'));
  assert.ok(assignment, 'Public configuration must have a complete assignment.');
  try { return JSON.parse(assignment[1]); } catch { throw new Error('A public configuration script contains invalid JSON.'); }
}
function structuredData(html) {
  const scripts = scriptBlocks(html).filter(match => /type="application\/ld\+json"/.test(match[1]));
  assert.ok(scripts.length > 0, 'Public structured data must remain present.');
  try { return scripts.map(match => JSON.parse(match[2])); } catch { throw new Error('Public structured data contains invalid JSON.'); }
}
function valuesWithType(input, type, result = []) {
  if (input && typeof input === 'object') {
    if (input['@type'] === type) result.push(input);
    for (const value of Object.values(input)) valuesWithType(value, type, result);
  }
  return result;
}
function hasPrivatePayoutKeys(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => ['bankName', 'bankAccount', 'bankHolder', 'maxUploadMb'].includes(key) || hasPrivatePayoutKeys(child));
}
function contentBody(page, values, reason) { return { path: page.path, expectedRevision: page.revision, ...values, reason }; }
function businessBody(value, reason) {
  return { expectedRevision: value.revision, catalog: structuredClone(value.catalog), payout: structuredClone(value.payout), site: structuredClone(value.site), reason };
}
async function html(path, headers) {
  const response = await request(path, { authenticated: false, headers });
  assert.equal(response.status, 200, 'A rendered local public page must return 200.');
  assert.ok(!response.headers.has('ETag') && !response.headers.has('Last-Modified'), 'Dynamic public content must not reuse the static asset validators.');
  assert.ok(response.headers.get('Cache-Control')?.includes('no-store'), 'Dynamic public content must be fresh.');
  return response.text();
}
async function saveBusiness(body) {
  const result = await json('/api/admin/business', { method: 'PUT', body });
  ownedBusinessRevision = result.revision;
  return result;
}
async function saveContent(body) {
  const result = await json('/api/admin/content', { method: 'PUT', body });
  const selected = result.pages.find(page => page.path === contentPath);
  assert.ok(selected, 'The edited page must remain in the content list.');
  ownedContentRevision = selected.revision;
  return selected;
}
async function restore() {
  // Never overwrite an independent local operator's newer revision.
  if (originalContent && ownedContentRevision !== undefined) {
    restorePhase = 'content revision check';
    const current = (await json('/api/admin/content')).pages.find(page => page.path === contentPath);
    assert.ok(current && current.revision === ownedContentRevision, 'Content restoration stopped because another local writer changed its revision.');
    restorePhase = 'content restore';
    await saveContent(contentBody(current, originalContent.overrides, 'Pulihkan konten setelah pengujian lokal'));
    const restored = (await json('/api/admin/content')).pages.find(page => page.path === contentPath);
    assert.ok(equal(restored.overrides, originalContent.overrides), 'The original local content overrides must be restored exactly.');
  }
  if (originalBusiness && ownedBusinessRevision !== undefined) {
    restorePhase = 'business revision check';
    const current = await json('/api/admin/business');
    assert.ok(current.revision === ownedBusinessRevision, 'Business restoration stopped because another local writer changed its revision.');
    restorePhase = 'business restore';
    await saveBusiness({ ...businessBody(originalBusiness, 'Pulihkan pengaturan setelah pengujian lokal'), expectedRevision: current.revision });
    const restored = await json('/api/admin/business');
    assert.ok(equal(restored.catalog, originalBusiness.catalog) && equal(restored.payout, originalBusiness.payout) && equal(restored.site, originalBusiness.site),
      'The original local catalog, payout and contact settings must be restored exactly.');
  }
}

async function run() {
  await json('/api/admin/business', { authenticated: false }, 401);
  // These are the established synthetic LOCAL fixture credentials, never a
  // production account. The strict origin/redirect guard runs before this call.
  const login = await json('/api/admin/login', { method: 'POST', body: { email: 'admin@example.test', password: 'Contoh-Admin-Lokal-2026' }, csrf: undefined });
  assert.ok(login.authenticated === true && login.user?.email === 'admin@example.test' && /^[a-f0-9]{64}$/.test(login.csrfToken), 'The dedicated synthetic local owner must be active.');
  adminCsrf = login.csrfToken;
  originalBusiness = await json('/api/admin/business');
  const pageList = (await json('/api/admin/content')).pages;
  assert.ok(originalBusiness.catalog.cities.length === 49 && pageList.length === 51, 'The local fixture must contain the complete public city catalogue.');
  const city = originalBusiness.catalog.cities.find(city => city.name === 'Tangerang') || originalBusiness.catalog.cities[0];
  const pageDefault = PAGE_DEFAULTS.find(page => page.label === city.name && page.path.startsWith('/area/'));
  assert.ok(pageDefault, 'A source city page must match the selected catalog city.');
  contentPath = pageDefault.path;
  originalContent = pageList.find(page => page.path === contentPath);
  assert.ok(originalContent, 'The target city must have an editable local page.');
  const alternative = Object.keys(originalBusiness.catalog.pricing).find(key => key === 'default' && key !== city.pricingKey) || Object.keys(originalBusiness.catalog.pricing).find(key => key !== city.pricingKey);
  assert.ok(alternative, 'The fixture must offer another existing pricing group.');

  phase = 'business settings update and rendered catalogue';
  const desired = businessBody(originalBusiness, 'Uji integrasi katalog lokal');
  desired.catalog.cities.find(item => item.name === city.name).pricingKey = alternative;
  const selectedPackage = desired.catalog.pricing[alternative][0];
  selectedPackage.name = 'Paket "Simulasi" & Aman'; selectedPackage.price = 12345;
  selectedPackage.features = ['Fitur "kutip" & aman']; selectedPackage.badge = 'Uji & pratinjau';
  desired.payout.whatsapp = '6280000000000';
  desired.site = { contactEmail: 'simulasi@example.test', instagramUrl: 'https://www.instagram.com/posloker.simulasi/', facebookUrl: 'https://www.facebook.com/posloker.simulasi/' };
  let changed = await saveBusiness(desired);
  assert.ok(changed.revision === originalBusiness.revision + 1, 'A business save must advance its revision.');
  const unchanged = await saveBusiness(businessBody(changed, 'Uji simpan tanpa perubahan'));
  assert.ok(unchanged.unchanged === true && unchanged.revision === changed.revision, 'A no-op must not advance its revision.');
  await json('/api/admin/business', { method: 'PUT', body: desired }, 409);
  const cityHtml = await html(contentPath, { 'If-None-Match': '"stale-static-asset"', 'If-Modified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT' });
  const data = config(cityHtml, 'poslokerData'), payment = config(cityHtml, 'poslokerPayment');
  assert.ok(data.pricing[alternative][0].price === 12345 && payment.pricing[slug(city.name)][0].id === selectedPackage.id && payment.pricing[slug(city.name)][0].price === 12345,
    'Both runtime configurations must follow the edited city pricing group.');
  assert.ok(!hasPrivatePayoutKeys(data) && !hasPrivatePayoutKeys(payment), 'Private payout fields must not enter public configuration scripts.');
  assert.ok(data.whatsapp === desired.payout.whatsapp && cityHtml.includes('mailto:simulasi@example.test') && cityHtml.includes(desired.site.instagramUrl) && cityHtml.includes(desired.site.facebookUrl), 'Public contact fields must follow the settings save.');
  assert.ok(cityHtml.includes('https://wa.me/' + desired.payout.whatsapp), 'Public WhatsApp links must follow the current setting.');
  const cards = [...cityHtml.matchAll(/<article\b[^>]*class="city-package-card"[^>]*>([\s\S]*?)<\/article>/gi)];
  const card = cards.find(match => plain(match[1].match(/<h3>([\s\S]*?)<\/h3>/i)?.[1] || '') === selectedPackage.name);
  assert.ok(card && plain(card[1].match(/<strong>([\s\S]*?)<\/strong>/i)?.[1] || '').replace(/\s/g, '') === 'Rp12.345', 'A server-rendered city card must show the current price and name.');
  const href = decode(card[1].match(/href="([^"]*)"/i)?.[1] || ''), orderLink = new URL(href, origin);
  assert.ok(orderLink.origin === origin && orderLink.pathname === '/pembayaran/' && orderLink.searchParams.get('city') === city.name && orderLink.searchParams.get('package') === selectedPackage.id,
    'Server-rendered order links must use the remapped city package ID.');
  const offers = structuredData(cityHtml).flatMap(value => valuesWithType(value, 'Offer'));
  assert.ok(offers.some(offer => offer.name === selectedPackage.name && offer.price === '12345'), 'Structured data must use the edited package price.');
  assert.ok(cityHtml.indexOf('data-posloker-config="poslokerPayment"') < cityHtml.indexOf('src="/wp-content/plugins/posloker-payment/assets/frontend.js"') &&
    cityHtml.indexOf('data-posloker-config="poslokerData"') < cityHtml.indexOf('src="/wp-content/themes/posloker-premium/assets/js/main.js"'), 'Runtime globals must be assigned before their consumer scripts.');
  const homeHtml = await html('/');
  const option = [...homeHtml.matchAll(/<option\b([^>]*)>/gi)].find(match => decode(match[1].match(/\bvalue="([^"]*)"/i)?.[1] || '') === city.name);
  assert.ok(option && decode(option[1].match(/\bdata-rule="([^"]*)"/i)?.[1] || '') === alternative, 'The homepage calculator must use the edited city rule.');
  const mainJs = await (await request('/wp-content/themes/posloker-premium/assets/js/main.js', { authenticated: false })).text();
  assert.ok(!/features\.push\(\s*(['"])Instagram Carousel hingga 10 slide\1/.test(mainJs), 'The old calculator must not reinsert a feature removed by the owner.');

  phase = 'checkout quote uses the edited server price';
  const checkoutSession = await json('/api/checkout/session');
  assert.ok(checkoutSession.preview === true && checkoutSession.canSubmit === true, 'The local checkout must remain an owner-only preview.');
  const quote = await json('/api/checkout/quote', { method: 'POST', csrf: checkoutSession.csrfToken, body: { city: city.name, packageId: selectedPackage.id } });
  assert.ok(quote.preview === true && quote.quote.baseAmount === 12345 && quote.quote.packageName === selectedPackage.name && quote.quote.amount > 12345 && quote.quote.amount <= 12444,
    'An actual Worker checkout quote must use the edited authoritative price.');

  phase = 'business revision conflict';
  const revisionA = businessBody(changed, 'Uji perubahan bersamaan satu'), revisionB = businessBody(changed, 'Uji perubahan bersamaan dua');
  revisionA.catalog.pricing[alternative][0].badge = 'Pilihan A'; revisionB.catalog.pricing[alternative][0].badge = 'Pilihan B';
  const businessResponses = await Promise.all([request('/api/admin/business', { method: 'PUT', body: revisionA }), request('/api/admin/business', { method: 'PUT', body: revisionB })]);
  assert.ok(businessResponses.filter(response => response.status === 200).length === 1 && businessResponses.filter(response => response.status === 409).length === 1, 'Only one business update may win an identical revision.');
  changed = await jsonResponse(businessResponses.find(response => response.status === 200));
  ownedBusinessRevision = changed.revision;

  phase = 'plain content edits, unsafe input rejection and script integrity';
  const contentValues = { title: 'Judul "Uji" & Aman É😀', description: 'Deskripsi "kutip" & aman.', heading: 'Lowongan "Simulasi" & contoh', intro: 'Teks biasa & kutip "aman".\nBaris kedua É😀.' };
  let edited = await saveContent(contentBody(originalContent, contentValues, 'Uji teks konten lokal'));
  const editedHtml = await html(contentPath);
  assert.ok(plain(editedHtml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '') === contentValues.title, 'HTML title text must safely preserve quotes, ampersands and Unicode.');
  assert.ok(plain(editedHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '') === contentValues.heading, 'The edited heading must render as text.');
  assert.ok(editedHtml.includes('Teks biasa &amp; kutip') && !editedHtml.includes('Teks biasa & kutip'), 'Content ampersands must be encoded in HTML.');
  config(editedHtml, 'poslokerData'); config(editedHtml, 'poslokerPayment'); structuredData(editedHtml);
  const attack = { ...contentValues, title: '</script><img src=x onerror=alert(1)>' };
  await json('/api/admin/content', { method: 'PUT', body: contentBody(edited, attack, 'Uji penolakan markup') }, 400);
  const afterRejected = (await json('/api/admin/content')).pages.find(page => page.path === contentPath);
  assert.ok(afterRejected.revision === edited.revision && afterRejected.title === contentValues.title, 'Rejected markup must not change content or revision.');
  await json('/api/admin/content', { method: 'PUT', body: contentBody(originalContent, contentValues, 'Uji revisi lama') }, 409);
  const contentResponses = await Promise.all([
    request('/api/admin/content', { method: 'PUT', body: contentBody(edited, { ...contentValues, heading: 'Pilihan judul satu' }, 'Uji konten bersamaan satu') }),
    request('/api/admin/content', { method: 'PUT', body: contentBody(edited, { ...contentValues, heading: 'Pilihan judul dua' }, 'Uji konten bersamaan dua') }),
  ]);
  assert.ok(contentResponses.filter(response => response.status === 200).length === 1 && contentResponses.filter(response => response.status === 409).length === 1, 'Only one content update may win an identical revision.');
  const winningContent = await jsonResponse(contentResponses.find(response => response.status === 200));
  edited = winningContent.pages.find(page => page.path === contentPath); ownedContentRevision = edited.revision;

  phase = 'null overrides restore source content';
  const restoredDefault = await saveContent(contentBody(edited, { title: null, description: null, heading: null, intro: null }, 'Uji pemulihan konten sumber'));
  const restoredHtml = await html(contentPath, { 'If-None-Match': '"old-version"' });
  assert.ok(plain(restoredHtml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '') === pageDefault.title &&
    plain(restoredHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '') === pageDefault.heading, 'Null overrides must restore the original source title and heading.');
  assert.ok(Object.values(restoredDefault.overrides).every(value => value === null), 'Restoration must keep explicit null source defaults.');
  config(restoredHtml, 'poslokerData'); config(restoredHtml, 'poslokerPayment'); structuredData(restoredHtml);
  const noChange = await saveContent(contentBody(restoredDefault, restoredDefault.overrides, 'Uji pemulihan tanpa perubahan'));
  assert.ok(noChange.revision === restoredDefault.revision, 'An unchanged content save must not advance the revision.');
}

let failed = false;
try { await run(); }
catch { failed = true; console.error('Local business integration failed during: ' + phase + '. No settings, contacts, cookies or credentials were printed.'); }
finally {
  try { await restore(); }
  catch { failed = true; console.error('Local fixture restoration needs attention during: ' + restorePhase + '. No values were printed and an independent writer’s newer revision was not overwritten.'); }
  if (adminCsrf) {
    try { await json('/api/admin/logout', { method: 'POST', body: {} }); }
    catch { failed = true; console.error('The synthetic local owner test session could not be closed.'); }
  }
}
if (failed) process.exitCode = 1;
else console.log('Local real-Worker integration passed: pricing/group remapping, rendered cards/globals/JSON-LD/contacts, authoritative checkout quote, safe content edits/rejection/restoration, revision conflicts, fresh conditional requests, and exact original business/content restoration.');
