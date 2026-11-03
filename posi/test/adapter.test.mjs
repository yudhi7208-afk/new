import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckoutAdapter, FIELD_MAP } from '../preview/checkout-adapter.mjs';

function fixture(t, options = {}) {
  const calls = [];
  const make = (id, extra = {}) => ({
    id, value: '', disabled: false, readOnly: false, hidden: false,
    style: { outline: '', outlineOffset: '' }, dataset: {},
    closest(selector) { assert.equal(selector, '[hidden]'); return this.hidden || options.hiddenForm ? this : null; },
    focus(settings) { calls.push({ type: 'focus', id, settings }); },
    scrollIntoView(settings) { calls.push({ type: 'scroll', id, settings }); },
    dispatchEvent(event) { calls.push({ type: 'event', id, event: event.type, bubbles: event.bubbles }); return true; },
    ...extra,
  });
  const elements = Object.fromEntries([
    ...Object.values(FIELD_MAP).map(field => [field.id, make(field.id)]),
    ['orderFields', make('orderFields')],
    ['receiptStep', make('receiptStep', { hidden: true })],
    ['confirmationStep', make('confirmationStep')],
    ['pilih-paket', make('pilih-paket')],
    ['consent', make('consent', { checked: false })],
    ['submitButton', make('submitButton', { click() { throw Error('POSI must not click submit'); } })],
  ]);
  const doc = {
    documentElement: { clientWidth: 390 },
    defaultView: { innerHeight: 844 },
    getElementById: id => elements[id] || null,
  };
  const adapter = createCheckoutAdapter(doc, { pathname: '/pembayaran/', search: '?city=Medan&package=ig' });
  t.after(() => adapter.destroy());
  return { adapter, elements, calls };
}

test('draft cannot change form without explicit boolean consent', t => {
  const { adapter, elements, calls } = fixture(t);
  for (const consent of [undefined, false, 'true', 1]) {
    assert.equal(adapter.applyDraft({ field: 'adText', value: 'Guru Matematika di Medan', consent, expectedValue: '' }).ok, false);
  }
  assert.equal(elements.adText.value, '');
  assert.equal(calls.length, 0);
});

test('approved draft writes Teks Materi only and announces ordinary input/change', t => {
  const { adapter, elements, calls } = fixture(t);
  elements.caption.value = 'Caption pelanggan';
  const text = 'Dibutuhkan Guru Matematika kelas 8 SMP di Medan.';
  assert.deepEqual(adapter.applyDraft({ field: 'adText', value: text, consent: true, expectedValue: '' }), { ok: true });
  assert.equal(elements.adText.value, text);
  assert.equal(elements.caption.value, 'Caption pelanggan');
  assert.equal(elements.consent.checked, false, 'draft approval must not grant order consent');
  assert.deepEqual(calls.filter(call => call.type === 'event'), [
    { type: 'event', id: 'adText', event: 'input', bubbles: true },
    { type: 'event', id: 'adText', event: 'change', bubbles: true },
  ]);
  assert.ok(calls.some(call => call.type === 'focus' && call.id === 'adText'));
});

test('existing text requires separate overwrite approval', t => {
  const { adapter, elements } = fixture(t);
  elements.adText.value = 'Teks lama milik pelanggan';
  const draft = { field: 'adText', value: 'Teks pengganti yang ditinjau', consent: true, expectedValue: elements.adText.value };
  assert.equal(adapter.applyDraft(draft).ok, false);
  assert.equal(adapter.applyDraft({ ...draft, overwrite: 'true' }).ok, false);
  assert.equal(elements.adText.value, 'Teks lama milik pelanggan');
  assert.equal(adapter.applyDraft({ ...draft, overwrite: true }).ok, true);
  assert.equal(elements.adText.value, draft.value);
});

test('compare-and-set protects typing made after draft was reviewed', t => {
  const { adapter, elements, calls } = fixture(t);
  const reviewed = 'Teks saat dialog persetujuan dibuka';
  elements.adText.value = 'Pelanggan sudah memperbaiki teks sendiri';
  assert.equal(adapter.applyDraft({ field: 'adText', value: 'Draft lama', consent: true, overwrite: true, expectedValue: reviewed }).ok, false);
  assert.equal(elements.adText.value, 'Pelanggan sudah memperbaiki teks sendiri');
  assert.equal(calls.length, 0);
  assert.equal(adapter.applyDraft({ field: 'adText', value: 'Draft', consent: true, overwrite: true }).ok, false);
});

test('field allowlist forbids changing caption, customer data, consent, payment and submit', t => {
  const { adapter, elements, calls } = fixture(t);
  const forbidden = ['caption', 'customerName', 'whatsapp', 'email', 'notes', 'proofInput', 'materialsInput', 'consent', 'submitButton', 'amount', 'city', 'packageId', '__proto__', 'constructor'];
  for (const field of forbidden) assert.equal(adapter.applyDraft({ field, value: 'Bukan izin', consent: true, overwrite: true, expectedValue: '' }).ok, false, field);
  for (const element of Object.values(elements)) assert.equal(element.value, '', element.id);
  assert.equal(elements.consent.checked, false);
  assert.equal(calls.length, 0);
  for (const action of ['submit', 'submitButton', 'payment', 'approvePayment', 'deleteOrder']) assert.equal(adapter.guide(action).ok, false, action);
});

test('invalid or overlong draft never truncates or changes the field', t => {
  const { adapter, elements } = fixture(t);
  for (const value of ['', '   ', null, {}, 'x'.repeat(2001)]) assert.equal(adapter.applyDraft({ field: 'adText', value, consent: true, expectedValue: '' }).ok, false);
  assert.equal(elements.adText.value, '');
  assert.equal(adapter.applyDraft({ field: 'adText', value: 'x'.repeat(2000), consent: true, expectedValue: '' }).ok, true);
  assert.equal(elements.adText.value.length, 2000);
});

test('disabled, read-only, missing or hidden form fails closed', t => {
  const { adapter, elements, calls } = fixture(t);
  const draft = { field: 'adText', value: 'Materi', consent: true, expectedValue: '' };
  elements.adText.disabled = true;
  assert.equal(adapter.applyDraft(draft).ok, false);
  elements.adText.disabled = false; elements.adText.readOnly = true;
  assert.equal(adapter.applyDraft(draft).ok, false);
  elements.adText.readOnly = false; elements.orderFields.disabled = true;
  assert.equal(adapter.applyDraft(draft).ok, false);
  elements.orderFields.disabled = false; elements.adText.hidden = true;
  assert.equal(adapter.applyDraft(draft).ok, false);
  delete elements.adText;
  assert.equal(adapter.applyDraft(draft).ok, false);
  assert.equal(calls.length, 0);
  const hidden = fixture(t, { hiddenForm: true });
  assert.equal(hidden.adapter.applyDraft(draft).ok, false);
});

test('snapshot describes current stage and public selection, not token or customer fields', t => {
  const { adapter, elements } = fixture(t);
  elements.customerName.value = 'Data tidak boleh ikut konteks';
  assert.deepEqual(adapter.snapshot(), { page: 'checkout', step: 2, city: 'Medan', packageId: 'ig', fields: { adText: { available: true, value: '' } } });
  elements.confirmationStep.hidden = true;
  assert.equal(adapter.snapshot().step, 1);
  elements.receiptStep.hidden = false;
  assert.equal(adapter.snapshot().page, 'receipt');
});

test('highlight cleanup restores previous outline and changes no form value', t => {
  const { adapter, elements } = fixture(t);
  elements.adText.style.outline = '1px solid blue';
  elements.adText.style.outlineOffset = '2px';
  assert.equal(adapter.highlight('adText').ok, true);
  assert.equal(elements.adText.value, '');
  adapter.destroy();
  assert.equal(elements.adText.style.outline, '1px solid blue');
  assert.equal(elements.adText.style.outlineOffset, '2px');
});

test('optional widget yields only when a visible order control overlaps its reserved space', t => {
  const { adapter, elements, calls } = fixture(t);
  elements.adText.value = 'Materi yang harus tetap utuh';
  elements.caption.value = 'Caption milik pelanggan';
  let rect = { left: 20, right: 370, top: 720, bottom: 775, width: 350, height: 55 };
  elements.submitButton.getBoundingClientRect = () => rect;
  assert.equal(adapter.shouldYield(), true, '390×844 submit button intersects bottom-right reserved area');
  rect = { left: 20, right: 370, top: 400, bottom: 455, width: 350, height: 55 };
  assert.equal(adapter.shouldYield(), false, 'submit button outside reserved area leaves widget available');
  rect = { left: 20, right: 370, top: 720, bottom: 775, width: 350, height: 55 };
  elements.submitButton.hidden = true;
  assert.equal(adapter.shouldYield(), false, 'hidden order control must not suppress widget');
  assert.equal(elements.adText.value, 'Materi yang harus tetap utuh');
  assert.equal(elements.caption.value, 'Caption milik pelanggan');
  assert.equal(elements.consent.checked, false);
  assert.deepEqual(calls, [], 'geometry checks must not dispatch, focus, scroll or submit');
});
