// Loopback-only, in-memory checkout integration. No credentials, cloud writes or AI calls.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { build } from '../../node_modules/esbuild/lib/main.js';
import { Miniflare, convertV4MiniflareOptions } from '../../node_modules/miniflare/dist/src/index.js';
import { createPosiWorker } from '../src/worker.mjs';

const root = new URL('../../', import.meta.url);
export const syntheticCatalog = {
  cities: [{ name: 'Medan', pricingKey: 'default' }, { name: 'Jakarta', pricingKey: 'default' }],
  pricing: { default: [
    { id: 'gratis', name: 'Paket Gratis Contoh', price: 0, features: ['Data sintetis'] },
    { id: 'komplit', name: 'Paket Berbayar Contoh', price: 10000, features: ['Data sintetis'] },
    { id: 'komplit-plus', name: 'Komplit PLUS Contoh', price: 20000, features: ['Data sintetis'] },
  ] },
};
export async function createFixture({ port = 8790, listen = false } = {}) {
  const bundled = await build({ absWorkingDir: fileURLToPath(root), entryPoints: ['src/worker.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-10-30', host: '127.0.0.1', port: 0,
    d1Databases: ['CUSTOMER_DB'], r2Buckets: ['CUSTOMER_FILES'],
    assets: { directory: fileURLToPath(new URL('public/', root)), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true } },
  }));
  const db = await mf.getD1Database('CUSTOMER_DB');
  for (const name of ['0001_customer_data.sql', '0002_order_files.sql', '0003_admin.sql', '0004_order_admin.sql', '0005_checkout.sql', '0006_business_admin.sql', '0007_order_archive.sql', '0008_receipt_access.sql']) {
    const sql = (await readFile(new URL('migrations/' + name, root), 'utf8')).replace(/^--.*$/gm, '');
    for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  const payout = { bankName: 'BANK CONTOH', bankAccount: 'TEST-ACCOUNT', bankHolder: 'DATA SINTETIS', whatsapp: '6280000000000', maxUploadMb: 1 };
  await db.batch([
    db.prepare('INSERT INTO admin_setup VALUES(1,?,?,?)').bind('c'.repeat(64), 1, 1),
    db.prepare('INSERT INTO commerce_settings VALUES(?,?)').bind('catalog_json', JSON.stringify(syntheticCatalog)),
    db.prepare('INSERT INTO commerce_settings VALUES(?,?)').bind('payout_json', JSON.stringify(payout)),
    db.prepare("UPDATE commerce_settings SET value_json='\"live\"' WHERE key='mode'"),
  ]);
  const origin = `http://127.0.0.1:${port}`;
  const knowledge = { productionVerified: false, generatedAt: new Date().toISOString(), catalog: syntheticCatalog, contact: { url: 'https://wa.me/6280000000000' } };
  let mode = 'on';
  const posi = createPosiWorker({ knowledge, timeoutMs: 150 });
  async function dispatch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/posi/')) {
      if (mode === 'config-error') return new Response('Synthetic unavailable', { status: 503 });
      if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 1500));
      return posi.fetch(request, { POSI_ENABLED: mode === 'off' ? 'false' : 'true', POSI_AI_ENABLED: ['ai-error', 'slow'].includes(mode) ? 'true' : 'false', POSI_ALLOWED_ORIGINS: origin,
        POSI_AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
        POSI_AI_BUDGET: { idFromName: value => value, get: () => ({ fetch: async () => new Response(JSON.stringify({ allowed: true }), { headers: { 'Content-Type': 'application/json' } }) }) },
        AI: { run: async () => { throw Error('Synthetic AI outage'); } },
      });
    }
    if (url.pathname.startsWith('/widget/') || url.pathname.startsWith('/preview/')) {
      if (mode === 'missing-widget' && url.pathname.startsWith('/widget/')) return new Response('Synthetic missing widget', { status: 404 });
      const path = url.pathname.slice(1);
      if (path.includes('..') || !/^(widget|preview)\/[a-zA-Z0-9_.\/-]+$/.test(path)) return new Response('Not found', { status: 404 });
      try {
        const bytes = await readFile(new URL('posi/' + path, root));
        return new Response(bytes, { headers: { 'Content-Type': path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript', 'Cache-Control': 'no-store' } });
      } catch { return new Response('Not found', { status: 404 }); }
    }
    const response = await mf.dispatchFetch(request.url, { method: request.method, headers: request.headers, ...(request.body ? { body: request.body, duplex: 'half' } : {}) });
    const headers = new Headers(response.headers);
    // Mirror copies only: assistant is appended to the synthetic local response.
    if (request.method === 'GET' && headers.get('content-type')?.includes('text/html') && !url.pathname.startsWith('/admin/')) {
      const html = await response.text();
      headers.delete('content-length'); headers.delete('etag');
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'");
      return new Response(html.replace('</body>', '<script type="module" src="/preview/checkout-bootstrap.mjs"></script></body>'), { status: response.status, headers });
    }
    return new Response(response.body, { status: response.status, headers });
  }
  const server = listen ? createServer(async (req, res) => {
    try {
      const request = new Request(origin + req.url, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: req, duplex: 'half' } : {}) });
      const response = await dispatch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(503); res.end('Local test unavailable'); }
  }) : null;
  if (server) await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    origin, dispatch, db,
    setMode(value) { if (!['on', 'off', 'ai-error', 'slow', 'config-error', 'missing-widget'].includes(value)) throw Error('Invalid fixture mode'); mode = value; },
    async summary() { return { orders: await db.prepare('SELECT count(*) n FROM commerce_orders').first('n'), files: await db.prepare('SELECT count(*) n FROM commerce_files').first('n') }; },
    async close() { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await mf.dispose(); },
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fixture = await createFixture({ listen: true });
  console.log(JSON.stringify({ ready: true, origin: fixture.origin, data: 'memory-only synthetic', commands: ['on', 'off', 'ai-error', 'slow', 'config-error', 'missing-widget', 'summary', 'stop'] }));
  const rl = createInterface({ input: process.stdin }); let queue = Promise.resolve();
  rl.on('line', line => { queue = queue.then(async () => {
    const command = line.trim();
    if (command === 'stop') { await fixture.close(); rl.close(); return; }
    if (command === 'summary') console.log(JSON.stringify(await fixture.summary()));
    else { fixture.setMode(command); console.log(JSON.stringify({ mode: command })); }
  }).catch(error => console.error(error.message)); });
  process.on('SIGINT', async () => { await fixture.close(); process.exit(0); });
}
