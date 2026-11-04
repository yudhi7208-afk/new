import test from 'node:test';
import assert from 'node:assert/strict';
import { safeHelpIds, helpLink, ownReceiptLink } from '../widget/navigation.mjs';
import { safeContext } from '../widget/helpers.mjs';
import { createCheckoutAdapter } from '../preview/checkout-adapter.mjs';
const origin = 'https://new-posi-staging.yudhi7208.workers.dev';
const privateUrl = origin + '/pembayaran/?order=cf_' + 'a'.repeat(32) + '#key=' + 'b'.repeat(64);
test('only fixed help identifiers can become navigable links', () => {
  assert.deepEqual(safeHelpIds([{ id: 'check-order' }, { id: 'how-to-order' }, { id: 'check-order' }, { id: 'confirm-payment', href: 'javascript:alert(1)' }, { id: 'admin' }]), ['check-order', 'how-to-order']);
  assert.equal(helpLink('admin', { origin }), null);
  assert.equal(helpLink('confirm-payment', { origin }).href, origin + '/panduan/#konfirmasi-pembayaran');
  assert.equal(helpLink('check-order', { origin }).href, origin + '/panduan/#cek-order');
});
test('only the current origin receipt capability can be linked, never arbitrary customer or admin URLs', () => {
  assert.equal(ownReceiptLink(privateUrl, origin), privateUrl);
  for (const url of [privateUrl.replace(origin, 'https://attacker.example'), privateUrl.replace('/pembayaran/', '/admin/'), privateUrl.split('#')[0], privateUrl + '&secret=x', privateUrl.replace('?order=', '?key=x&order='), 'javascript:alert(1)']) assert.equal(ownReceiptLink(url, origin), '');
  const result = helpLink('check-order', { origin, receiptUrl: privateUrl }); assert.equal(result.private, true); assert.equal(result.href, privateUrl);
  assert.doesNotMatch(helpLink('confirm-payment', { origin, receiptUrl: privateUrl }).href, /key|cf_/);
  assert.deepEqual(safeContext({ page: 'receipt', receiptUrl: privateUrl, fields: { adText: 'private' } }), { page: 'receipt' });
});

test('the adapter exposes a receipt link only after its own receipt is visible', () => {
  let receiptVisible = false;
  const doc = { getElementById: id => id === 'receiptStep' ? { closest: () => receiptVisible ? null : {} } : null };
  const location = new URL(privateUrl), adapter = createCheckoutAdapter(doc, location);
  assert.equal(adapter.receiptLink(), ''); receiptVisible = true; assert.equal(adapter.receiptLink(), privateUrl);
  location.pathname = '/admin/'; assert.equal(adapter.receiptLink(), ''); adapter.destroy();
});
