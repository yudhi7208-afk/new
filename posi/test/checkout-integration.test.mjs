import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFixture } from '../scripts/local-fixture.mjs';

test('original checkout remains independent for all isolated POSI failure scenarios', { timeout: 60000 }, async t => {
  const app = await createFixture();
  t.after(() => app.close());
  let completed = 0;
  for (const mode of ['off', 'on', 'ai-error', 'slow', 'config-error', 'missing-widget']) {
    await t.test(mode, async () => {
      app.setMode(mode);
      const testAddress = { 'CF-Connecting-IP': `192.0.2.${completed + 1}` };
      const sessionResponse = await app.dispatch(new Request(app.origin + '/api/checkout/session', { headers: testAddress }));
      assert.equal(sessionResponse.status, 200);
      const session = await sessionResponse.json();
      const cookie = sessionResponse.headers.get('set-cookie').split(';')[0];
      const headers = { ...testAddress, Origin: app.origin, Cookie: cookie, 'X-CSRF-Token': session.csrfToken };
      const quoteResponse = await app.dispatch(new Request(app.origin + '/api/checkout/quote', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ city: 'Medan', packageId: 'komplit' }) }));
      assert.equal(quoteResponse.status, 200);
      const { quote } = await quoteResponse.json();
      assert.equal(quote.baseAmount, 10000);
      // The optional chat starts independently; checkout submission never awaits it.
      const chat = app.dispatch(new Request(app.origin + '/api/posi/chat', { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Boleh bantu saya memahami ini?', context: { page: 'form', step: 2 } }) }));
      const form = new FormData();
      for (const [key, value] of Object.entries({ quoteId: quote.id, csrfToken: session.csrfToken, idempotencyKey: randomUUID(), customerName: 'Pemesan Sintetis', whatsapp: '6280000000000', email: '', adText: 'Teks milik pengguna, harus tetap utuh.', caption: 'Caption pengguna terpisah.', notes: '', website: '', consent: '1' })) form.set(key, value);
      const pdf = new Blob(['%PDF-1.7\nSYNTHETIC ONLY - NO TRANSFER\n%%EOF'], { type: 'application/pdf' });
      form.set('proof', pdf, 'bukti-dummy.pdf'); form.append('materials', pdf, 'poster-dummy.pdf');
      const response = await app.dispatch(new Request(app.origin + '/api/checkout/submit', { method: 'POST', headers, body: form }));
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.match(result.order.id, /^cf_[a-f0-9]{32}$/);
      assert.equal(result.order.amount, quote.amount);
      assert.equal(result.order.city, 'Medan'); assert.equal(result.order.packageName, quote.packageName);
      const row = await app.db.prepare('SELECT ad_text,caption,base_amount,amount FROM commerce_orders WHERE id=?').bind(result.order.id).first();
      assert.equal(row.ad_text, 'Teks milik pengguna, harus tetap utuh.');
      assert.equal(row.caption, 'Caption pengguna terpisah.'); assert.equal(row.amount, quote.amount);
      const chatResponse = await chat;
      if (mode === 'off' || mode === 'config-error') assert.equal(chatResponse.status, 503);
      else assert.equal(chatResponse.status, 200);
      completed++;
    });
  }
  await t.test('existing validation rejects missing name, consent and required payment proof', async () => {
    app.setMode('on');
    const sr = await app.dispatch(new Request(app.origin + '/api/checkout/session'));
    const s = await sr.json(), cookie = sr.headers.get('set-cookie').split(';')[0];
    const headers = { 'CF-Connecting-IP': '192.0.2.200', Origin: app.origin, Cookie: cookie, 'X-CSRF-Token': s.csrfToken };
    const qr = await app.dispatch(new Request(app.origin + '/api/checkout/quote', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ city: 'Medan', packageId: 'komplit' }) }));
    const { quote } = await qr.json();
    for (const missing of ['customerName', 'consent', 'proof']) {
      const form = new FormData();
      for (const [k, v] of Object.entries({ quoteId: quote.id, csrfToken: s.csrfToken, idempotencyKey: randomUUID(), customerName: 'Dummy', whatsapp: '6280000000000', email: '', adText: '', caption: '', notes: '', website: '', consent: '1' })) form.set(k, v);
      form.set('proof', new Blob(['%PDF-1.7\nDUMMY\n%%EOF'], { type: 'application/pdf' }), 'dummy.pdf');
      form.delete(missing);
      const response = await app.dispatch(new Request(app.origin + '/api/checkout/submit', { method: 'POST', headers, body: form }));
      assert.equal(response.status, 400, missing);
    }
  });
  assert.deepEqual(await app.summary(), { orders: completed, files: completed * 2 });
});
