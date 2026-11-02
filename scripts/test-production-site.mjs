import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { PAGE_DEFAULTS } from '../src/public-content-defaults.mjs';

// A fresh, fully local Workers runtime with synthetic D1 settings only. No
// command arguments, credentials, remote bindings, DNS or existing databases.
assert.equal(process.argv.length, 2, 'This isolated test accepts no target or database arguments.');
const root = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({ absWorkingDir: root, entryPoints: ['src/worker.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' });
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-10-30',
  d1Databases: ['CUSTOMER_DB'], r2Buckets: ['CUSTOMER_FILES'],
  assets: { directory: fileURLToPath(new URL('../public/', import.meta.url)), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true } },
}));
const primary = 'https://posloker.my.id', preview = 'https://new.yudhi7208.workers.dev';
const catalog = { cities: PAGE_DEFAULTS.filter(page => page.path.startsWith('/area/') && page.path !== '/area/').map(page => ({ name: page.label, pricingKey: 'default' })), pricing: { default: [{ id: 'contoh', name: 'Paket Contoh', price: 10000, features: ['Contoh sintetis'] }] } };
const payout = { bankName: 'BANK SINTETIS', bankAccount: 'TEST-ONLY', bankHolder: 'Contoh Sintetis', whatsapp: '6280000000000', maxUploadMb: 1 };
const fetch = (origin, path, init = {}) => mf.dispatchFetch(origin + path, { redirect: 'manual', ...init });
const checkNoIndex = response => assert.match(response.headers.get('X-Robots-Tag') || '', /noindex/);

try {
  const db = await mf.getD1Database('CUSTOMER_DB');
  for (const name of ['0001_customer_data.sql', '0002_order_files.sql', '0003_admin.sql', '0004_order_admin.sql', '0005_checkout.sql', '0006_business_admin.sql', '0007_order_archive.sql', '0008_receipt_access.sql']) {
    const sql = (await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8')).replace(/^--.*$/gm, '');
    for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  await db.batch([
    db.prepare('INSERT INTO admin_setup(id,token_hash,expires_at,consumed_at) VALUES(1,?,?,?)').bind('c'.repeat(64), 1, 1),
    db.prepare('INSERT INTO commerce_settings VALUES(?,?)').bind('catalog_json', JSON.stringify(catalog)),
    db.prepare('INSERT INTO commerce_settings VALUES(?,?)').bind('payout_json', JSON.stringify(payout)),
  ]);
  const setMode = mode => db.prepare("UPDATE commerce_settings SET value_json=? WHERE key='mode'").bind(JSON.stringify(mode)).run();
  for (const origin of [primary, preview]) {
    const response = await fetch(origin, '/');
    assert.equal(response.status, 200, 'Preview home must render: ' + await response.clone().text());
    checkNoIndex(response);
    const html = await response.text();
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(html, /<aside class="migration-preview"/);
    assert.match(await (await fetch(origin, '/robots.txt')).text(), /^User-agent: \*\nDisallow: \/\n$/);
    assert.equal((await fetch(origin, '/sitemap.xml')).status, 404);
  }
  await setMode('live');
  for (const page of PAGE_DEFAULTS) {
    const response = await fetch(primary, page.path);
    assert.equal(response.status, 200, 'Every primary public page is available.');
    assert.equal(response.headers.get('X-Robots-Tag'), 'index, follow');
    assert.ok(!response.headers.has('ETag') && response.headers.get('Cache-Control')?.includes('no-store'));
    const html = await response.text();
    assert.match(html, /<meta name="robots" content="index, follow">/);
    assert.ok(html.includes('<link rel="canonical" href="' + primary + page.path + '"'));
    if (html.includes('property="og:url"')) assert.ok(html.includes('property="og:url" content="' + primary + page.path + '"'));
    assert.ok(!html.includes('<aside class="migration-preview"') && !html.includes('Checkout Cloudflare hanya simulasi.'));
    assert.ok(!html.includes(payout.bankAccount) && !html.includes(payout.bankHolder), 'Private bank data does not enter the public page.');
  }
  const robots = await fetch(primary, '/robots.txt');
  const robotsText = await robots.text();
  assert.match(robotsText, /^User-agent: \*\nAllow: \/\n/);
  for (const path of ['/admin', '/api/', '/checkout/', '/pembayaran', '/konfirmasi-pembayaran', '/wp-admin', '/wp-login.php']) assert.ok(robotsText.includes('Disallow: ' + path + '\n'));
  assert.ok(robotsText.endsWith('Sitemap: ' + primary + '/sitemap.xml\n'));
  for (const path of ['/sitemap.xml', '/wp-sitemap.xml']) {
    const response = await fetch(primary, path); assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type'), /application\/xml/);
    const locations = [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    assert.deepEqual(locations, PAGE_DEFAULTS.map(page => primary + page.path));
    assert.equal(locations.length, 51);
  }
  const previewHome = await fetch(preview, '/'); checkNoIndex(previewHome);
  const previewHtml = await previewHome.text(); assert.match(previewHtml, /content="noindex, nofollow"/);
  assert.ok(!previewHtml.includes('Checkout Cloudflare hanya simulasi.'));
  assert.match(await (await fetch(preview, '/robots.txt')).text(), /^User-agent: \*\nDisallow: \/\n$/);
  assert.equal((await fetch(preview, '/sitemap.xml')).status, 404);
  const httpRedirect = await fetch('http://posloker.my.id', '/area/jakarta/?example=1');
  assert.equal(httpRedirect.status, 301); assert.equal(httpRedirect.headers.get('Location'), primary + '/area/jakarta/?example=1'); checkNoIndex(httpRedirect);
  checkNoIndex(await fetch('https://posloker.my.id.evil.test', '/'));
  for (const origin of [primary, preview]) {
    const sessionResponse = await fetch(origin, '/api/checkout/session'); checkNoIndex(sessionResponse);
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json();
    assert.equal(session.preview, false); assert.equal(session.canSubmit, true);
    assert.match(session.csrfToken, /^[a-f0-9]{64}$/); assert.ok(sessionResponse.headers.has('Set-Cookie'));
    for (const path of ['/admin/', '/pembayaran/?order=cf_' + 'a'.repeat(32), '/konfirmasi-pembayaran/?order=999', '/checkout/checkout.js']) checkNoIndex(await fetch(origin, path));
    const anonymous = await fetch(origin, '/api/admin/orders'); assert.equal(anonymous.status, 401); checkNoIndex(anonymous);
    const receipt = await fetch(origin, '/api/checkout/receipt', { method: 'POST', headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: 'cf_' + 'a'.repeat(32), key: 'b'.repeat(64) }) });
    assert.equal(receipt.status, 404, 'A live receipt endpoint remains reachable on both origins.'); checkNoIndex(receipt);
  }
  for (const path of ['/', '/area/jakarta/?example=1', '/pembayaran/?order=cf_' + 'a'.repeat(32), '/konfirmasi-pembayaran/?order=999&key=synthetic-key', '//evil.test/path', '/assets/preview.css']) {
    const response = await fetch('https://www.posloker.my.id', path); assert.equal(response.status, 301);
    const location = new URL(response.headers.get('Location'));
    assert.equal(location.origin, primary); assert.equal(location.pathname, new URL('https://www.posloker.my.id' + path).pathname);
    assert.equal(location.search, new URL('https://www.posloker.my.id' + path).search);
    assert.equal(location.hash, '', 'An absent Location fragment permits browser receipt-fragment inheritance.');
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer'); checkNoIndex(response);
    assert.equal((await fetch('https://www.posloker.my.id', path, { method: 'HEAD' })).status, 301);
    for (const method of ['POST', 'PUT']) {
      const rejected = await fetch('https://www.posloker.my.id', path, { method, body: 'synthetic-never-forward' });
      assert.equal(rejected.status, 405); assert.ok(!rejected.headers.has('Location')); checkNoIndex(rejected);
      assert.ok(!(await rejected.text()).includes('synthetic-never-forward'));
    }
  }
  for (const path of ['/robots.txt', '/sitemap.xml']) {
    const head = await fetch(primary, path, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
    const post = await fetch(primary, path, { method: 'POST' }); assert.equal(post.status, 405); assert.ok(!post.headers.has('Location'));
  }
  // Run the ordinary anonymous HTTP smoke against this fresh local runtime,
  // proving its live branch without accepting any remote test target.
  const localOrigin = (await mf.ready).origin;
  const smoke = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./test-readiness-http.mjs', import.meta.url)), '--origin', localOrigin, '--expect-mode', 'live'], { cwd: root, timeout: 60000, maxBuffer: 10000 });
  assert.match(smoke.stdout, /Readiness HTTP checks passed: 51\/51/);
  await setMode('invalid');
  for (const path of ['/', '/robots.txt', '/sitemap.xml']) {
    const failed = await fetch(primary, path); assert.equal(failed.status, 503); checkNoIndex(failed);
  }
  console.log('Isolated production-site checks passed: 51 live primary pages, canonical/robots/sitemap, preview noindex, private routes, both-origin live checkout, safe www redirects/mutation rejection and fail-closed mode.');
} finally { await mf.dispose(); }
