import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { compareOrderFiles, verificationQuery } from './order-files-console-tools.mjs';

// Synthetic data only. No customer database, dump, manifest, or uploaded file is
// opened by these tests. Build hashes independently of the verifier under test.
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const sha = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
function withChecksum(row) {
  const { row_sha256: ignored, ...fields } = row;
  return { ...fields, row_sha256: sha(canonical(fields)) };
}
const payload = Buffer.from('Synthetic proof object bytes.\n');
const objectHash = sha(payload);
const object = { storage_key: objectHash + '.pdf', sha256: objectHash, byte_count: payload.length };
const refs = [
  withChecksum({
    id: 'synthetic-file-1', order_id: 101, migration_run_id: 'synthetic-run', kind: 'proof', position: 0,
    source_path: 'posloker-payment-proofs/bukti-É😀.pdf', original_name: 'Bukti É😀 "quote"; NUL\0.pdf',
    mime: 'application/pdf', ...object, missing: 0,
  }),
  withChecksum({
    id: 'synthetic-file-2', order_id: 102, migration_run_id: 'synthetic-run', kind: 'material', position: 0,
    source_path: 'posloker-payment-proofs/missing.png', original_name: 'Synthetic missing.png', mime: 'image/png',
    storage_key: null, sha256: null, byte_count: null, missing: 1,
  }),
];
const manifest = {
  version: 1,
  refs,
  objects: [object],
  summary: { logicalRefs: 2, uniqueObjects: 1, uniqueBytes: payload.length, missingFiles: 1, orphanFiles: 2 },
};
const checks = { logical_refs: 2, dangling_orders: 0, dangling_migration_runs: 0, mismatched_migration_runs: 0 };
const direct = { order_files: clone(refs), checks: clone(checks) };
const expectedKeys = [...Object.keys(manifest.summary), 'fullRowComparisonPassed', 'rowChecksumsPassed',
  'foreignKeyChecksPassed', 'validationSha256'].sort();

function assertSafeResult(result) {
  assert.deepEqual(Object.keys(result).sort(), expectedKeys, 'Verification must return only safe counters and validation status');
  for (const [key, value] of Object.entries(manifest.summary)) assert.equal(result[key], value);
  assert.equal(result.fullRowComparisonPassed, true);
  assert.equal(result.rowChecksumsPassed, true);
  assert.equal(result.foreignKeyChecksPassed, true);
  assert.match(result.validationSha256, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes('synthetic-file-1'));
  assert.ok(!JSON.stringify(result).includes(refs[0].original_name));
}

const first = compareOrderFiles(manifest, direct);
assertSafeResult(first);
const query = verificationQuery();
assert.match(query, /^[\x20-\x7e]+$/, 'Console verification SQL must be printable ASCII on one line');
assert.match(query, /\bSELECT\b/i);
assert.match(query, /\border_files_snapshot\b/i);

const schema = await readFile(new URL('../migrations/0002_order_files.sql', import.meta.url), 'utf8');
const db = new DatabaseSync(':memory:');
try {
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE migration_runs(id TEXT PRIMARY KEY);
    CREATE TABLE orders(source_post_id INTEGER PRIMARY KEY, migration_run_id TEXT NOT NULL REFERENCES migration_runs(id));
    INSERT INTO migration_runs VALUES ('synthetic-run'),('synthetic-other');
    INSERT INTO orders VALUES (101,'synthetic-run'),(102,'synthetic-run');`);
  db.exec(schema);
  const columns = Object.keys(refs[0]);
  const insert = db.prepare('INSERT INTO order_files (' + columns.map(key => '"' + key + '"').join(',') + ') VALUES (' + columns.map(() => '?').join(',') + ')');
  for (const ref of refs) insert.run(...columns.map(key => ref[key]));
  const aliasRow = db.prepare(query).get();
  assert.equal(typeof aliasRow.order_files_snapshot, 'string');
  const roundTrip = JSON.parse(aliasRow.order_files_snapshot);
  assert.deepEqual(roundTrip.checks, checks);
  assert.equal(roundTrip.order_files.length, 2);
  assert.equal(roundTrip.order_files.find(row => row.id === refs[0].id).original_name, refs[0].original_name,
    'SQLite JSON must preserve Unicode, quotes, and embedded NUL bytes');
  assert.ok(roundTrip.order_files.find(row => row.id === refs[1].id).storage_key === null,
    'Missing storage metadata must remain JSON null, not the string null');
  for (const input of [
    direct, JSON.stringify(direct), aliasRow, [aliasRow],
    { results: [aliasRow] }, { result: [{ results: [aliasRow] }] },
    { result: [{ results: [aliasRow] }], success: true },
  ]) {
    const result = compareOrderFiles(manifest, input);
    assertSafeResult(result);
    assert.equal(result.validationSha256, first.validationSha256, 'Transport wrappers must not change verification identity');
  }
  const reordered = clone(direct);
  reordered.order_files.reverse();
  assert.equal(compareOrderFiles(manifest, reordered).validationSha256, first.validationSha256,
    'Remote row ordering is not evidence of data corruption');

  // Independent query checks must detect a valid FK that belongs to the wrong
  // migration run, not merely confirm the run exists somewhere in the database.
  db.prepare('UPDATE order_files SET migration_run_id=? WHERE id=?').run('synthetic-other', refs[0].id);
  let invalid = JSON.parse(db.prepare(query).get().order_files_snapshot);
  assert.equal(invalid.checks.mismatched_migration_runs, 1);
  assert.throws(() => compareOrderFiles(manifest, invalid));
  db.prepare('UPDATE order_files SET migration_run_id=? WHERE id=?').run('synthetic-run', refs[0].id);

  // Simulate historical corruption with FK enforcement disabled, then verify
  // that the SQL reports both dangling relationship classes explicitly.
  db.exec('PRAGMA foreign_keys=OFF;');
  db.prepare('UPDATE order_files SET order_id=? WHERE id=?').run(999, refs[0].id);
  invalid = JSON.parse(db.prepare(query).get().order_files_snapshot);
  assert.equal(invalid.checks.dangling_orders, 1);
  assert.throws(() => compareOrderFiles(manifest, invalid));
  db.prepare('UPDATE order_files SET order_id=? WHERE id=?').run(101, refs[0].id);
  db.prepare('UPDATE order_files SET migration_run_id=? WHERE id=?').run('missing-run', refs[0].id);
  invalid = JSON.parse(db.prepare(query).get().order_files_snapshot);
  assert.equal(invalid.checks.dangling_migration_runs, 1);
  assert.throws(() => compareOrderFiles(manifest, invalid));
} finally { db.close(); }

function rejectRemote(label, mutate) {
  const input = clone(direct);
  mutate(input);
  assert.throws(() => compareOrderFiles(manifest, input), undefined, label);
}
rejectRemote('Changed field with stale row checksum must fail', input => { input.order_files[0].original_name = 'Changed'; });
rejectRemote('Recomputed attacker row checksum must not bypass full row comparison', input => {
  input.order_files[0] = withChecksum({ ...input.order_files[0], original_name: 'Changed with new checksum' });
});
rejectRemote('Duplicate rows must fail', input => { input.order_files.push(clone(input.order_files[0])); input.checks.logical_refs++; });
rejectRemote('Missing rows must fail', input => { input.order_files.pop(); input.checks.logical_refs--; });
rejectRemote('Extra rows must fail', input => {
  input.order_files.push(withChecksum({ ...input.order_files[0], id: 'unexpected-file' })); input.checks.logical_refs++;
});
rejectRemote('Missing columns must fail', input => { delete input.order_files[0].source_path; });
rejectRemote('Extra columns must fail', input => { input.order_files[0].unexpected_column = 'unexpected'; });
rejectRemote('Numeric strings must not be silently coerced', input => {
  input.order_files[0] = withChecksum({ ...input.order_files[0], byte_count: String(input.order_files[0].byte_count) });
});
rejectRemote('Order IDs must retain their numeric type', input => {
  input.order_files[0] = withChecksum({ ...input.order_files[0], order_id: '101' });
});
rejectRemote('Missing marker must retain its numeric type', input => {
  input.order_files[1] = withChecksum({ ...input.order_files[1], missing: '1' });
});
rejectRemote('Null storage must not become the string null', input => {
  input.order_files[1] = withChecksum({ ...input.order_files[1], storage_key: 'null' });
});
for (const key of ['dangling_orders', 'dangling_migration_runs', 'mismatched_migration_runs']) {
  rejectRemote('Any failed relationship check must fail: ' + key, input => { input.checks[key] = 1; });
  rejectRemote('Relationship checks require numeric zero: ' + key, input => { input.checks[key] = '0'; });
  rejectRemote('Missing relationship checks must fail: ' + key, input => { delete input.checks[key]; });
}
rejectRemote('Logical reference count must match actual rows', input => { input.checks.logical_refs = 9; });
rejectRemote('Extra check columns must not be ignored', input => { input.checks.unexpected_check = 0; });
assert.throws(() => compareOrderFiles(manifest, { checks }), undefined, 'Aggregate checks alone do not prove row equality');
assert.throws(() => compareOrderFiles(manifest, { order_files: refs }), undefined, 'Rows alone do not prove FK checks passed');
assert.throws(() => compareOrderFiles(manifest, { results: [] }), undefined, 'An empty Console response is not a verified snapshot');

const damagedManifest = clone(manifest);
damagedManifest.refs[0].original_name = 'Manifest was corrupted';
const matchingDamagedRows = { order_files: clone(damagedManifest.refs), checks };
assert.throws(() => compareOrderFiles(damagedManifest, matchingDamagedRows), undefined,
  'Matching local/remote corruption still requires valid row checksums');
for (const key of ['logicalRefs', 'uniqueObjects', 'uniqueBytes', 'missingFiles']) {
  const wrongSummary = clone(manifest); wrongSummary.summary[key]++;
  assert.throws(() => compareOrderFiles(wrongSummary, direct), undefined, 'Manifest summary must agree with inventory: ' + key);
}
const wrongObject = clone(manifest); wrongObject.objects[0].byte_count++;
assert.throws(() => compareOrderFiles(wrongObject, direct), undefined, 'Object inventory must agree with referenced rows');
const duplicateObject = clone(manifest); duplicateObject.objects.push(clone(duplicateObject.objects[0]));
assert.throws(() => compareOrderFiles(duplicateObject, direct), undefined, 'Duplicate object inventory entries must fail');
const unknownVersion = clone(manifest); unknownVersion.version = 99;
assert.throws(() => compareOrderFiles(unknownVersion, direct), undefined, 'Unknown manifest versions must fail closed');

const sentinel = 'SYNTHETIC_INPUT_MUST_NOT_APPEAR_IN_ERRORS';
assert.throws(() => compareOrderFiles(manifest, sentinel), error => !error.message.includes(sentinel),
  'Invalid JSON must fail without echoing input contents');
console.log('Synthetic order-file Console verification passed: ASCII SQLite JSON roundtrip, all columns/types, Unicode/NUL, wrappers, full row checksums, object inventory, and explicit FK checks.');
