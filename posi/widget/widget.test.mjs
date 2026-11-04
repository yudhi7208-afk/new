import test from 'node:test';
import assert from 'node:assert/strict';
import { bootPosi } from './loader.mjs';
import { safeContext, safeContactUrl, validDraft, localAnswer, requestReply } from './helpers.mjs';

test('feature flag OFF produces zero fetch/import/DOM dependency', async () => {
  for (const enabled of [undefined, false, 'false', 'true', 1]) {
    let calls = 0;
    const result = await bootPosi({ enabled, fetcher() { calls++; throw new Error(); }, importWidget() { calls++; throw new Error(); } });
    assert.equal(result.enabled, false); assert.equal(calls, 0); result.destroy();
  }
});
test('server feature OFF never imports widget or starts AI', async () => {
  let imports = 0;
  const result = await bootPosi({ enabled: true, apiBase: 'https://preview.example', fetcher: async () => Response.json({ enabled: false }), importWidget() { imports++; } });
  assert.equal(imports, 0); assert.equal(result.enabled, false);
});
test('failed optional config request does not throw into checkout', async () => {
  for (const fetcher of [async () => { throw new Error('offline'); }, async () => new Response('', { status: 503 }), async () => new Response('<html>not json')]) {
    const result = await bootPosi({ enabled: true, apiBase: 'https://preview.example', fetcher });
    assert.equal(result.enabled, false);
  }
});
test('enabled widget imports only after successful explicit opt-in config', async () => {
  const sequence = [];
  const result = await bootPosi({ enabled: true, apiBase: 'https://preview.example', fetcher: async () => { sequence.push('config'); return Response.json({ enabled: true }); }, importWidget: async () => { sequence.push('import'); return { mountPosi(options) { assert.equal(options.config.enabled, true); return { enabled: true }; } }; } });
  assert.deepEqual(sequence, ['config', 'import']); assert.equal(result.enabled, true);
});
test('request context strips personal fields, receipts and full URLs', () => {
  assert.deepEqual(safeContext({ page: 'form', step: 2, city: 'Medan', packageId: 'ig', email: 'secret@example.test', order: 'cf_secret', fields: { adText: 'private' }, url: 'https://example/?key=secret' }), { page: 'form', city: 'Medan', packageId: 'ig', step: 2 });
  assert.deepEqual(safeContext({ page: '/admin/?order=secret', step: 9, city: 'x'.repeat(101) }), { page: 'home' });
});
test('contact links only allow official plain wa.me numbers, no arbitrary actions', () => {
  assert.equal(safeContactUrl('https://wa.me/6281234567890'), 'https://wa.me/6281234567890');
  for (const value of ['javascript:alert(1)', 'https://evil.example/6281234567890', 'https://wa.me.evil.example/6281234567890', 'https://wa.me/6281234567890?text=secret', 'https://user:pass@wa.me/6281234567890', 'http://wa.me/6281234567890']) assert.equal(safeContactUrl(value), '');
});
test('draft accepts Teks Materi only, never caption/payment/customer changes', () => {
  assert.deepEqual(validDraft({ adText: 'Guru matematika, Medan.' }), { adText: 'Guru matematika, Medan.' });
  for (const value of [null, { adText: '' }, { adText: 'x'.repeat(2001) }, { adText: 'Lowongan', caption: 'ubah' }, { adText: 'Lowongan', amount: 0 }]) assert.equal(validDraft(value), null);
});
test('offline rules distinguish material from caption and never invent prices', () => {
  assert.match(localAnswer('Bantuan Desain Gratis'), /Teks Materi, bukan Caption/);
  assert.doesNotMatch(localAnswer('Harga dan Paket Medan'), /Rp|\d/);
  assert.match(localAnswer('Pembayaran'), /sendiri/);
});
test('chat POST transmits minimum context with no credentials/history/form contents', async () => {
  let captured;
  const response = await requestReply({ apiBase: 'https://preview.example', message: 'Apa isi Teks Materi?', context: { page: 'form', step: 2, fields: { adText: 'private' }, customerName: 'private' }, fetcher: async (url, init) => { captured = { url, init }; return Response.json({ reply: 'Isi rincian lowongan.', source: 'rules', draft: { adText: 'Supplied text' } }); } });
  assert.equal(captured.url, 'https://preview.example/api/posi/chat'); assert.equal(captured.init.credentials, 'omit');
  assert.deepEqual(JSON.parse(captured.init.body), { message: 'Apa isi Teks Materi?', context: { page: 'form', step: 2 } });
  assert.deepEqual(response.draft, { adText: 'Supplied text' });
});
test('chat timeout aborts optional AI request and rejects independently', async () => {
  const started = Date.now();
  await assert.rejects(requestReply({ apiBase: 'https://preview.example', message: 'Bantu', context: {}, timeoutMs: 15, fetcher: async (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })) }), /timeout/);
  assert.ok(Date.now() - started < 1000);
});

test('AI requests for human help preserve only a validated contact suggestion', async () => {
  for (const url of ['https://wa.me/6280000000000', 'https://attacker.example/', 'javascript:alert(1)']) {
    const response = await requestReply({ apiBase: 'https://preview.example', message: 'Boleh bicara dengan petugas?', context: {}, fetcher: async () => Response.json({ reply: 'Silakan hubungi petugas.', source: 'ai', contact: { whatsappUrl: url } }) });
    assert.equal(response.contact?.whatsappUrl || null, url.startsWith('https://wa.me/') ? url : null);
  }
});

test('AI or server output cannot supply an executable URL in help links', async () => {
  const answer = await requestReply({ apiBase: 'https://preview.example', message: 'Cek order', context: {}, fetcher: async () => Response.json({ reply: 'Buka panduan.', links: [{ id: 'check-order' }, { id: 'confirm-payment', href: 'javascript:alert(1)' }, { id: '/admin/' }] }) });
  assert.deepEqual(answer.links, ['check-order']);
});
