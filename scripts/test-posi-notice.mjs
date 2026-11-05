import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { NOTICE_START, NOTICE_END } from '../src/posi-notice.mjs';

// Fixed-clock synthetic response only: never accepts remote URLs or credentials.
assert.equal(process.argv.length, 2);
const original = '<!doctype html><html><head><title>Fixture</title></head><body><main><form><input name="customerName" value="Synthetic unchanged"><button type="submit">Kirim order</button></form></main></body></html>';
const bundle = await build({ write: false, bundle: true, format: 'esm', platform: 'browser', stdin: {
  resolveDir: fileURLToPath(new URL('../', import.meta.url)), contents: `import { withPosiNotice } from './src/posi-notice.mjs';
  export default { fetch(request) { const options = new URL(request.url).searchParams;
  const response = new Response(${JSON.stringify(original)}, { status: Number(options.get('status') || 200), headers: { 'Content-Type': options.get('type') || 'text/html', ETag: 'synthetic', 'Cache-Control': 'max-age=3600' } });
  return withPosiNotice(response, request, { POSI_NOTICE_ENABLED: options.get('flag') || 'false' }, Number(options.get('now'))); } };`,
} });
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-30' }));
let checks = 0;
async function render({ now = NOTICE_START + 1000, flag = 'true', path = '/', type, status, method = 'GET' } = {}) {
  const url = new URL(path, 'http://localhost');
  url.search = new URLSearchParams({ now: String(now), flag, ...(type ? { type } : {}), ...(status ? { status } : {}) });
  const response = await runtime.dispatchFetch(url, { method });
  return { response, html: await response.text() };
}
try {
  for (const options of [{ flag: 'false' }, { flag: 'invalid' }, { now: NOTICE_START - 1 }, { now: NOTICE_END }, { now: NOTICE_END + 86400000 }, { path: '/admin/' }, { path: '/api/admin/orders' }, { path: '/checkout/checkout.js' }, { type: 'application/json' }, { status: 404 }, { method: 'POST' }]) {
    const { html } = await render(options); assert.equal(html, original); checks++;
  }
  for (const now of [NOTICE_START, NOTICE_END - 1]) {
    for (const path of ['/', '/area/medan/', '/pembayaran/', '/konfirmasi-pembayaran/']) {
      const { response, html } = await render({ now, path });
      assert.equal((html.match(/id="posi-service-notice"/g) || []).length, 1);
      assert.ok(html.includes('5 NOVEMBER 2026') && html.includes('12.00 WIB') && html.includes('13.00 WITA') && html.includes('14.00 WIT'));
      assert.ok(html.includes('<form><input name="customerName" value="Synthetic unchanged"><button type="submit">Kirim order</button></form>'));
      assert.match(html, /data-remaining-ms="\d+"/);
      assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(response.headers.get('ETag'), null);
      checks++;
    }
  }
  const head = await render({ method: 'HEAD' }); assert.ok(!head.html.includes('posi-service-notice')); checks++;
  assert.equal(new Date(NOTICE_END).toISOString(), '2026-11-05T05:00:00.000Z');
  for (const [timeZone, expected] of [['Asia/Jakarta', '12:00'], ['Asia/Makassar', '13:00'], ['Asia/Jayapura', '14:00']]) {
    assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(NOTICE_END), expected);
    checks++;
  }
  console.log(`POSI temporary notice checks passed: ${checks}, including exact expiry, all Indonesian time zones, OFF/private/error bypass and unchanged form.`);
} finally { await runtime.dispose(); }
