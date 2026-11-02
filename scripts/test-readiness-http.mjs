import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PAGE_DEFAULTS } from '../src/public-content-defaults.mjs';

// Anonymous public smoke only: no owner credentials, cookies, order creation,
// file uploads, messages, DNS changes, or redirects followed by this client.
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  assert.ok(['--origin', '--expect-mode'].includes(key) && value && !options.has(key), 'Use --origin and optional --expect-mode preview|live.');
  options.set(key, value);
}
let target;
try { target = new URL(options.get('--origin') || 'http://127.0.0.1:8788/'); }
catch { throw new Error('The readiness origin is invalid.'); }
const local = target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && /^\d+$/.test(target.port);
const remote = target.protocol === 'https:' && ['new.yudhi7208.workers.dev', 'posloker.my.id'].includes(target.hostname) && !target.port;
assert.ok((local || remote) && target.pathname === '/' && !target.username && !target.password && !target.search && !target.hash,
  'This smoke test only permits a local HTTP origin, https://new.yudhi7208.workers.dev or https://posloker.my.id.');
const expectedMode = options.get('--expect-mode') || 'preview';
assert.ok(['preview', 'live'].includes(expectedMode), 'Expected mode must be explicitly preview or live.');
const expectedIndex = target.origin === 'https://posloker.my.id' && expectedMode === 'live';
const origin = target.origin;
const manifest = JSON.parse(await readFile(new URL('../docs/migration-manifest.json', import.meta.url), 'utf8'));
assert.ok(manifest.pages.length === 51 && new Set(manifest.pages).size === 51 &&
  manifest.pages.every(path => /^\/(?:area\/(?:[a-z0-9-]+\/)?)?$/.test(path)), 'The smoke test requires the complete known 51-page public manifest.');
const defaults = new Map(PAGE_DEFAULTS.map(page => [page.path, page]));
let phase = 'anonymous session';
let checkedPages = 0;
let failedPage = '';

class SmokeCheckError extends Error {}
function check(value, message) { if (!value) throw new SmokeCheckError(message); }
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object'
  ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const equal = (left, right) => canonical(left) === canonical(right);
const decode = value => value.replace(/&#(x[\da-f]+|\d+);/gi, (_, number) => String.fromCodePoint(number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number)))
  .replace(/&(amp|quot|apos|lt|gt|nbsp|mdash|ndash);/g, (_, name) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', mdash: '—', ndash: '–' })[name]);
const normalize = value => value.replace(/\s+/g, ' ').trim();
const plain = value => normalize(decode(value.replace(/<[^>]*>/g, '')));
const slug = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function attribute(attributes, name) { return decode(attributes.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"', 'i'))?.[1] || ''); }
async function request(path, method = 'GET', body) {
  check(path.startsWith('/') && !path.startsWith('//'), 'Only paths on the selected origin may be requested.');
  const headers = { Accept: 'application/json, text/html;q=0.9, */*;q=0.8' };
  if (method === 'POST') { headers.Origin = origin; headers['Sec-Fetch-Site'] = 'same-origin'; headers['Content-Type'] = 'application/json'; }
  return fetch(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(20000) });
}
async function json(response, status) {
  check(response.status === status, 'An anonymous API returned an unexpected status.');
  try { return await response.json(); } catch { throw new SmokeCheckError('An anonymous API returned invalid JSON.'); }
}
function scriptConfig(html, name) {
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match => attribute(match[1], 'data-posloker-config') === name);
  check(blocks.length === 1, 'A public page is missing one unique runtime configuration marker.');
  const assignment = blocks[0][2].match(new RegExp('^\\s*var\\s+' + name + '\\s*=\\s*([\\s\\S]+);\\s*$'));
  check(assignment, 'The public runtime assignment is incomplete.');
  try { return JSON.parse(assignment[1]); } catch { throw new SmokeCheckError('Public runtime JSON is invalid.'); }
}
function privatePayoutKeys(value) {
  return value && typeof value === 'object' && Object.entries(value).some(([key, child]) => ['bankName', 'bankAccount', 'bankHolder', 'maxUploadMb'].includes(key) || privatePayoutKeys(child));
}
function nodesOfType(value, type, result = []) {
  if (value && typeof value === 'object') {
    if (value['@type'] === type) result.push(value);
    for (const child of Object.values(value)) nodesOfType(child, type, result);
  }
  return result;
}
function structuredData(html, required) {
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match => attribute(match[1], 'type') === 'application/ld+json');
  check(!required || blocks.length > 0, 'A public page is missing its declared structured data.');
  try { return blocks.map(match => JSON.parse(match[2])); } catch { throw new SmokeCheckError('Public structured data is invalid JSON.'); }
}
async function withConcurrency(items, limit, operation) {
  let index = 0, failure;
  const results = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failure && index < items.length) {
      const current = index++;
      try { await operation(items[current]); }
      catch (error) { failure = error; failedPage = items[current]; throw error; }
    }
  }));
  if (results.some(result => result.status === 'rejected')) throw failure;
}
function checkIndexPolicy(response, html) {
  const directive = expectedIndex ? 'index' : 'noindex';
  const pattern = new RegExp('(?:^|[,\\s])' + directive + '(?:$|[,\\s])', 'i');
  check(pattern.test(response.headers.get('X-Robots-Tag') || ''), 'The public response has an unexpected indexing header.');
  const robots = [...html.matchAll(/<meta\b([^>]*)>/gi)].find(match => attribute(match[1], 'name').toLowerCase() === 'robots');
  check(robots && pattern.test(attribute(robots[1], 'content')), 'The public HTML has an unexpected indexing directive.');
  check(expectedIndex || !/(?:^|[,\s])index(?:$|[,\s])/i.test(attribute(robots[1], 'content')), 'A preview page must not also declare index.');
}
async function redirect(path, expectedPath, expectedQuery = {}, expectedFragment = {}) {
  const response = await request(path);
  check(response.status === 302, 'A legacy URL must redirect without being followed by the smoke client.');
  let destination;
  try { destination = new URL(response.headers.get('Location')); } catch { throw new SmokeCheckError('A legacy redirect has no valid destination.'); }
  check(destination.origin === origin && destination.pathname === expectedPath, 'A legacy redirect must stay on the selected Worker origin.');
  check(equal([...destination.searchParams], Object.entries(expectedQuery)) && equal([...new URLSearchParams(destination.hash.slice(1))], Object.entries(expectedFragment)), 'A legacy redirect retained an unexpected query or capability parameter.');
  check(response.headers.get('Referrer-Policy') === 'no-referrer' && response.headers.get('Cache-Control')?.includes('no-store'), 'A legacy redirect must not cache or forward its referrer.');
}

async function run() {
  const sessionResponse = await request('/api/checkout/session');
  const session = await json(sessionResponse, 200);
  check(session.preview === (expectedMode === 'preview'), 'The Worker is not in the expected checkout mode.');
  check(Array.isArray(session.catalog?.cities) && session.catalog.cities.length === 49 && session.catalog.pricing && typeof session.catalog.pricing === 'object', 'The public checkout catalog is incomplete.');
  check(sessionResponse.headers.get('Cache-Control')?.includes('no-store'), 'The checkout session response must not be cached.');
  if (expectedMode === 'preview') {
    check(session.canSubmit === false && session.csrfToken === '' && !sessionResponse.headers.has('Set-Cookie'), 'An anonymous preview visitor must not receive submission access, a CSRF token, or a new cookie.');
  } else {
    // Explicit live mode behaves like one ordinary anonymous visit;
    // it creates no quote/order and does not reuse or print the ephemeral cookie.
    check(session.canSubmit === true && /^[a-f0-9]{64}$/.test(session.csrfToken) && sessionResponse.headers.has('Set-Cookie'), 'An anonymous live session must be ready for checkout.');
  }

  phase = 'public pages';
  await withConcurrency(manifest.pages, 3, async path => {
    const response = await request(path);
    check(response.status === 200 && response.headers.get('Content-Type')?.includes('text/html'), 'A manifest page did not return HTML 200.');
    check(response.headers.get('Cache-Control')?.includes('no-store') && !response.headers.has('ETag'), 'A public page did not use the current dynamic renderer.');
    const html = await response.text();
    checkIndexPolicy(response, html);
    const canonicalLink = [...html.matchAll(/<link\b([^>]*)>/gi)].find(match => attribute(match[1], 'rel') === 'canonical');
    check(canonicalLink && attribute(canonicalLink[1], 'href') === 'https://posloker.my.id' + path, 'A public page has an unexpected canonical URL.');
    check(expectedMode === 'preview' ? html.includes('<aside class="migration-preview"') : !html.includes('<aside class="migration-preview"'), 'The simulation banner does not match the service mode.');
    check(plain(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || ''), 'A public page has no title.');
    const description = [...html.matchAll(/<meta\b([^>]*)>/gi)].find(match => attribute(match[1], 'name').toLowerCase() === 'description');
    check(description && normalize(attribute(description[1], 'content')), 'A public page has no meta description.');
    const data = scriptConfig(html, 'poslokerData'), payment = scriptConfig(html, 'poslokerPayment');
    check(equal(data.pricing, session.catalog.pricing) && data.paymentUrl === '/pembayaran/' && payment.checkoutUrl === '/pembayaran/', 'A page runtime catalog differs from the authoritative checkout catalog.');
    check(!privatePayoutKeys(data) && !privatePayoutKeys(payment), 'Private payout properties were included in public runtime JSON.');
    for (const city of session.catalog.cities) {
      const packages = session.catalog.pricing[city.pricingKey] || session.catalog.pricing.default;
      check(Array.isArray(packages) && equal(payment.pricing[slug(city.name)], packages), 'A city runtime alias does not follow the configured pricing group.');
    }
    check(html.indexOf('data-posloker-config="poslokerPayment"') < html.indexOf('src="/wp-content/plugins/posloker-payment/assets/frontend.js"') &&
      html.indexOf('data-posloker-config="poslokerData"') < html.indexOf('src="/wp-content/themes/posloker-premium/assets/js/main.js"'), 'A runtime configuration is assigned after its consumer script.');
    const page = defaults.get(path);
    check(page, 'A public page is missing its known source mapping.');
    // The source directory has no JSON-LD block; preserve that valid absence.
    const schema = structuredData(html, Object.keys(page.structuredData || {}).length > 0);
    if (path.startsWith('/area/') && path !== '/area/') {
      const city = session.catalog.cities.find(city => city.name === page.label);
      check(city, 'A city page is missing from the checkout catalog.');
      const packages = session.catalog.pricing[city.pricingKey] || session.catalog.pricing.default;
      const cards = [...html.matchAll(/<article\b[^>]*class="city-package-card"[^>]*>([\s\S]*?)<\/article>/gi)];
      check(cards.length === packages.length && payment.currentCity === city.name, 'A city page has an unexpected number of package cards.');
      const offers = schema.flatMap(value => nodesOfType(value, 'Offer'));
      for (const item of packages) {
        const card = cards.find(match => {
          const link = new URL(decode(match[1].match(/href="([^"]*)"/i)?.[1] || ''), origin);
          return link.searchParams.get('package') === item.id;
        });
        check(card, 'A city package name is absent from the rendered cards.');
        check(plain(card[1].match(/<h3>([\s\S]*?)<\/h3>/i)?.[1] || '') === normalize(item.name), 'A rendered package name differs from the current catalog.');
        const amount = plain(card[1].match(/<strong>([\s\S]*?)<\/strong>/i)?.[1] || '').replace(/\s/g, '');
        const expected = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(item.price).replace(/\s/g, '');
        check(amount === expected, 'A rendered package price differs from the checkout price.');
        const link = new URL(decode(card[1].match(/href="([^"]*)"/i)?.[1] || ''), origin);
        check(link.origin === origin && link.pathname === '/pembayaran/' && link.searchParams.get('city') === city.name && link.searchParams.get('package') === item.id, 'A city order link contains the wrong package or destination.');
        const features = [...card[1].matchAll(/<li>([\s\S]*?)<\/li>/gi)].map(match => plain(match[1]));
        check(equal(features, item.features.map(normalize)), 'A city feature list differs from the configured package.');
        check(offers.some(offer => offer.name === item.name && offer.price === String(item.price)), 'A structured offer differs from the configured price.');
      }
    } else if (path === '/') {
      const options = [...html.matchAll(/<option\b([^>]*)>/gi)];
      for (const city of session.catalog.cities) {
        const option = options.find(match => attribute(match[1], 'value') === city.name);
        check(option && attribute(option[1], 'data-rule') === city.pricingKey, 'A public calculator does not use the current city pricing group.');
      }
    }
    checkedPages++;
  });

  phase = 'robots and sitemap publication';
  const robotsResponse = await request('/robots.txt');
  check(robotsResponse.status === 200 && robotsResponse.headers.get('Cache-Control')?.includes('no-store'), 'Robots policy must be served dynamically without cache.');
  const robotsText = await robotsResponse.text();
  if (expectedIndex) {
    check(/^User-agent: \*\nAllow: \/\n/.test(robotsText) && robotsText.includes('Sitemap: https://posloker.my.id/sitemap.xml\n'), 'The live primary robots policy must publish the canonical sitemap.');
  } else check(robotsText === 'User-agent: *\nDisallow: /\n', 'A preview origin must disallow indexing.');
  const sitemapResponse = await request('/sitemap.xml');
  check(sitemapResponse.status === (expectedIndex ? 200 : 404), 'The sitemap must be published only on the live primary origin.');
  if (expectedIndex) {
    const locations = [...(await sitemapResponse.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    check(equal([...locations].sort(), manifest.pages.map(path => 'https://posloker.my.id' + path).sort()), 'The canonical sitemap must contain exactly the known public pages.');
  }

  phase = 'anonymous administration and private-file guards';
  for (const path of ['/api/admin/orders', '/api/admin/business', '/api/admin/content', '/api/admin/files/file_' + 'f'.repeat(64)]) {
    const response = await request(path);
    const body = await json(response, 401);
    check(Object.keys(body).length === 1 && typeof body.error === 'string' && !response.headers.has('Set-Cookie'), 'Anonymous private routes must return only a generic login error.');
  }
  phase = 'legacy redirects';
  await redirect('/wp-admin/', '/admin/');
  await redirect('/wp-login.php?key=synthetic-query-must-drop', '/admin/');
  await redirect('/?posloker_manage=1&order=999&key=synthetic-query-must-drop&extra=drop', '/admin/', { order: '999' });
  for (const key of ['posloker_proof', 'posloker_material', 'posloker_caption']) {
    await redirect('/?' + key + '=999&key=synthetic-query-must-drop', '/admin/', { order: '999' });
  }
  const capability = 'synthetic-smoke-invalid-capability';
  await redirect('/konfirmasi-pembayaran/?order=999&key=' + capability + '&extra=drop', '/konfirmasi-pembayaran/', { order: '999' }, { key: capability });
  phase = 'rejected legacy mutations';
  for (const path of ['/admin', '/pembayaran', '/konfirmasi-pembayaran', '/?posloker_manage=1&order=999']) {
    const response = await request(path, 'POST', {});
    check(response.status === 405 && !response.headers.has('Location'), 'A legacy/no-slash mutation must be rejected without a redirect.');
  }
  // One invalid read capability checks the migrated read schema without seeing
  // a real order. The server may count this read in its normal rate limiter.
  phase = 'invalid legacy receipt capability';
  const oldPost = await request('/wp-admin/admin-post.php?action=posloker_submit_payment', 'POST', { customerName: 'synthetic-do-not-echo' });
  const oldPostHtml = await oldPost.text();
  check(oldPost.status === 409 && !oldPost.headers.has('Location') && oldPost.headers.get('Cache-Control')?.includes('no-store') && oldPostHtml.includes('jangan membayar ulang') && !oldPostHtml.includes('synthetic-do-not-echo'), 'Old checkout submissions must stop with clear non-repayment guidance and must not forward or echo form data.');
  const invalidReceipt = await json(await request('/api/legacy/receipt', 'POST', { orderId: '999', key: capability }), 404);
  check(Object.keys(invalidReceipt).length === 1 && typeof invalidReceipt.error === 'string', 'An invalid receipt capability must return only a generic error.');
  phase = 'final mode and catalog consistency';
  const finalSession = await json(await request('/api/checkout/session'), 200);
  check(finalSession.preview === session.preview && equal(finalSession.catalog, session.catalog), 'The checkout mode or catalog changed during the smoke check.');
}

try {
  await run();
  console.log('Readiness HTTP checks passed: ' + checkedPages + '/51 public pages, current pricing/configuration/cards/structured data, canonical/indexing/robots/sitemap, anonymous access guards, safe legacy redirects and rejected legacy mutations. Mode: ' + expectedMode + '.');
} catch (error) {
  const detail = error instanceof SmokeCheckError ? error.message : 'Unexpected transport or runtime failure.';
  console.error('Readiness HTTP checks failed during: ' + phase + (failedPage ? ' (' + failedPage + ')' : '') + '. Check: ' + detail + ' No settings, payout details, capability values or response bodies were printed.');
  process.exitCode = 1;
}
