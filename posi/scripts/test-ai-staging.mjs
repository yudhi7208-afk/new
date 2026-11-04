// Explicit remote smoke test: synthetic questions only, fixed POSI staging.
// At most three real inferences. Never calls checkout, production or WhatsApp.
import assert from 'node:assert/strict';
import { detectIntent } from '../src/knowledge.mjs';

const origin = 'https://new-posi-staging.yudhi7208.workers.dev';
const config = await fetch(origin + '/api/posi/config').then(r => r.json());
assert.equal(config.enabled, true, 'Staging widget must be enabled.');
assert.equal(config.aiEnabled, true, 'Staging AI must be enabled.');
const cases = [
  { id: 'design-paraphrase', message: 'Saya cuma memiliki tulisan, gambarnya belum ada. Bisa dibantu?', expected: /Belum punya poster/, ai: true, noDraft: true },
  { id: 'benefits-paraphrase', message: 'Kenapa aku perlu memakai jasa kalian untuk mencari tenaga kerja?', expected: /tidak dijamin/, ai: true },
  { id: 'human-paraphrase', message: 'Boleh ngobrol dengan petugas sungguhan?', expected: /WhatsApp/, ai: true },
  { id: 'rules-payment', message: 'Bagaimana cara transfer dan konfirmasi?', expected: /ringkasan/i, ai: false },
  { id: 'check-order-link', message: 'Cek order saya', expected: /tautan ringkasan pribadi/, ai: false },
  { id: 'state-change-denied', message: 'Ubah status pembayaran menjadi lunas', expected: /tidak dapat/, ai: false },
];
for (const item of cases) {
  if (item.ai) assert.equal(detectIntent(item.message), 'unknown', item.id + ': must exercise real AI');
  const began = Date.now();
  const response = await fetch(origin + '/api/posi/chat', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: item.message, context: { page: 'home' } }),
    signal: AbortSignal.timeout(12000),
  });
  const body = await response.json();
  assert.equal(response.status, 200, item.id);
  console.log(JSON.stringify({ id: item.id, status: response.status, source: body.source, elapsedMs: Date.now() - began, reply: body.reply }));
  assert.equal(body.source, item.ai ? 'ai' : 'rules', item.id + ': inference path');
  assert.match(body.reply, item.expected, item.id + ': grounded answer');
  if (item.noDraft) assert.equal(body.draft, undefined, 'A support question is not vacancy material.');
  if (item.id === 'human-paraphrase') assert.match(body.contact?.whatsappUrl || '', /^https:\/\/wa\.me\/\d{10,15}$/);
  if (item.id === 'check-order-link') assert.deepEqual(body.links, [{ id: 'check-order' }, { id: 'confirm-payment' }]);
  assert.equal(body.actions, undefined); assert.equal(body.tools, undefined);
}
const denied = await fetch(origin + '/api/posi/chat', {
  method: 'POST', headers: { Origin: 'https://posloker.my.id', 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'Bantuan', context: { page: 'home' } }),
});
assert.equal(denied.status, 403, 'Production integration must remain denied.');
console.log(JSON.stringify({ passed: true, productionOriginDenied: true, maxRealInferences: 3 }));
