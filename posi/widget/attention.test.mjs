import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttentionPolicy } from './attention.mjs';

test('POSI remains dormant until visible dwell and inactivity thresholds both pass', () => {
  let time = 0; const policy = createAttentionPolicy({ now: () => time });
  assert.equal(policy.eligible(), false);
  time = 59999; assert.equal(policy.eligible(), false);
  policy.progress(); time = 60000; assert.equal(policy.eligible(), false);
  time = 85000; assert.equal(policy.eligible(), true);
});
test('background tab time cannot trigger an offer on return', () => {
  let time = 0; const policy = createAttentionPolicy({ now: () => time });
  time = 20000; policy.visibility(false); time = 620000; policy.eligible({ visible: false }); policy.visibility(true);
  assert.equal(policy.eligible(), false);
  time += 39999; assert.equal(policy.eligible(), false);
  time++; assert.equal(policy.eligible(), true);
});
test('typing, payment dialog, important controls and completed orders suppress the offer', () => {
  let time = 0; const policy = createAttentionPolicy({ now: () => time }); time = 60000;
  assert.equal(policy.eligible({ blocked: true }), false);
  assert.equal(policy.eligible({ completed: true }), false);
  assert.equal(policy.eligible(), true);
});
test('one offer per session survives reload and dismiss, with no PII in storage', () => {
  const values = new Map(); const storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  let time = 0; const policy = createAttentionPolicy({ now: () => time, storage }); time = 60000;
  assert.equal(policy.eligible(), true); policy.markOffered(); assert.equal(policy.eligible(), false);
  const next = createAttentionPolicy({ now: () => time, storage }); time += 60000;
  assert.equal(next.eligible(), false); assert.deepEqual([...values.values()], ['1']);
});
test('blocked storage and attempts to lower thresholds do not break the website or trigger early', () => {
  let time = 0; const policy = createAttentionPolicy({ now: () => time, dwellMs: 1, idleMs: 1, storage: { getItem() { throw Error(); }, setItem() { throw Error(); } } });
  time = 2000; assert.equal(policy.eligible(), false); time = 60000; assert.equal(policy.eligible(), true);
  assert.doesNotThrow(() => policy.markOffered()); assert.equal(policy.eligible(), false);
});
