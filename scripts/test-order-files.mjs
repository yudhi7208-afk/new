import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { collectOrderFileReferences, parsePhpSerialized, prepareOrderFiles } from './prepare-order-files.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TEMP_PARENT = path.resolve(ROOT, '..');
const TEMP_PREFIX = 'order-file-synthetic-';
const fileSchema = await readFile(new URL('../migrations/0002_order_files.sql', import.meta.url), 'utf8');
const proofPrefix = 'posloker-payment-proofs/';
const hash = data => createHash('sha256').update(data).digest('hex');

function php(value) {
  if (value === null) return 'N;';
  if (typeof value === 'boolean') return `b:${Number(value)};`;
  if (typeof value === 'number') return `i:${value};`;
  if (typeof value === 'string') return `s:${Buffer.byteLength(value, 'utf8')}:"${value}";`;
  if (value instanceof Map) return `a:${value.size}:{${[...value].map(([k, v]) => php(k) + php(v)).join('')}}`;
  throw new Error('Unsupported synthetic fixture type');
}

const unicode = 'É😀 "quoted"; } NUL\0';
const parsed = parsePhpSerialized(php(new Map([
  [8, unicode], [2, new Map([['path', proofPrefix + 'materi-É😀.png']])], ['flag', true], ['none', null], ['negative', -7],
])));
assert.ok(parsed instanceof Map, 'Every PHP array must remain an insertion-ordered Map');
assert.deepEqual([...parsed.keys()], [8, 2, 'flag', 'none', 'negative']);
assert.equal(parsed.get(8), unicode);
assert.ok(parsed.get(2) instanceof Map);
assert.equal(parsed.get(2).get('path'), proofPrefix + 'materi-É😀.png');
assert.equal(parsed.get('flag'), true);
assert.equal(parsed.get('none'), null);
assert.equal(parsed.get('negative'), -7);
assert.equal(parsePhpSerialized('b:0;'), false);
assert.equal(parsePhpSerialized('i:0;'), 0);
assert.equal(parsePhpSerialized('s:2:"É";'), 'É');
assert.equal(parsePhpSerialized('s:4:"😀";'), '😀');
assert.equal(parsePhpSerialized('a:0:{}').size, 0);
for (const invalid of [
  's:1:"É";', 's:3:"😀";', 'a:2:{i:0;s:1:"x";}', 'a:0:{i:0;N;}',
  'N;junk', 'b:2;', 'O:8:"stdClass":0:{}', 'R:1;', 'i:9007199254740993;',
]) assert.throws(() => parsePhpSerialized(invalid), undefined, 'Malformed/unsupported serialized data must fail closed');

let sourceMetaId = 1;
const meta = [];
function add(orderId, key, value) {
  meta.push({ order_id: orderId, source_meta_id: sourceMetaId++, meta_key: key, meta_value: value });
}
const materialEntries = new Map([
  [8, new Map([['path', proofPrefix + 'materi-É😀.png'], ['name', 'Materi É😀.png'], ['mime', 'image/png']])],
  [2, new Map([['path', proofPrefix + 'again.pdf'], ['name', 'Duplicate bytes.pdf'], ['mime', 'application/pdf']])],
]);
add(101, '_posloker_materials', php(materialEntries));
add(101, '_posloker_proof_path', proofPrefix + 'proof-A.pdf');
add(101, '_posloker_proof_name', 'Bukti É😀.pdf');
add(101, '_posloker_proof_mime', 'application/pdf');
add(101, '_posloker_material_path', proofPrefix + 'legacy-ignored.pdf');
add(101, '_posloker_material_name', 'Ignored legacy.pdf');
add(101, '_posloker_material_mime', 'application/pdf');
add(102, '_posloker_proof_path', proofPrefix + 'missing.pdf');
add(102, '_posloker_proof_name', 'Missing proof.pdf');
add(102, '_posloker_proof_mime', 'application/pdf');
add(102, '_posloker_materials', 'a:0:{}');
add(102, '_posloker_material_path', proofPrefix + 'missing.pdf');
add(102, '_posloker_material_name', 'Missing legacy material.pdf');
add(102, '_posloker_material_mime', 'application/pdf');
const refs = collectOrderFileReferences([...meta].reverse());
assert.deepEqual(refs.map(r => [r.order_id, r.kind, r.position, r.source_path]), [
  [101, 'proof', 0, proofPrefix + 'proof-A.pdf'],
  [101, 'material', 0, proofPrefix + 'materi-É😀.png'],
  [101, 'material', 1, proofPrefix + 'again.pdf'],
  [102, 'proof', 0, proofPrefix + 'missing.pdf'],
  [102, 'material', 0, proofPrefix + 'missing.pdf'],
], 'Order/kind sorting must preserve material insertion order, not integer key order');
assert.equal(refs[0].original_name, 'Bukti É😀.pdf');
assert.equal(refs[1].mime, 'image/png');
assert.ok(!refs.some(r => r.source_path.endsWith('legacy-ignored.pdf')));
assert.equal(collectOrderFileReferences(meta.filter(r => r.order_id === 102 && r.meta_key !== '_posloker_materials')).filter(r => r.kind === 'material').length, 1,
  'Missing materials metadata must also use the legacy fallback');

const baseline = `PRAGMA foreign_keys=ON;
  CREATE TABLE migration_runs(id TEXT PRIMARY KEY);
  CREATE TABLE orders(source_post_id INTEGER PRIMARY KEY, migration_run_id TEXT NOT NULL REFERENCES migration_runs(id));
  CREATE TABLE order_meta(source_meta_id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(source_post_id), meta_key TEXT, meta_value TEXT);
  INSERT INTO migration_runs VALUES ('synthetic-run');
  INSERT INTO orders VALUES (101,'synthetic-run'),(102,'synthetic-run');`;
function database(filename, rows) {
  const db = new DatabaseSync(filename);
  try {
    db.exec(baseline);
    const insert = db.prepare('INSERT INTO order_meta VALUES (?,?,?,?)');
    for (const row of rows) insert.run(row.source_meta_id, row.order_id, row.meta_key, row.meta_value);
  } finally { db.close(); }
}
async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full));
    else result.push(full);
  }
  return result;
}
async function verifyPrivateSql(directory, minimumBatches = 1) {
  const sql = await readFile(path.join(directory, 'order-files.sql'), 'utf8');
  const manifestText = await readFile(path.join(directory, 'order-files-manifest.private.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  assert.match(sql, /^[\x20-\x7e]+$/, 'Private data SQL must be printable ASCII on one line');
  assert.ok(manifest.sql_batches.length >= minimumBatches);
  const batches = [];
  for (const batch of manifest.sql_batches) {
    assert.equal(path.basename(batch.file), batch.file);
    const content = await readFile(path.join(directory, batch.file), 'utf8');
    const bytes = Buffer.byteLength(content);
    assert.match(content, /^[\x20-\x7e]+$/, 'Every private Console batch must be ASCII on one line');
    assert.ok(bytes < 70000, 'Every private Console batch must remain strictly below 70 KB');
    assert.equal(bytes, batch.byte_count);
    assert.equal(hash(content), batch.sha256);
    batches.push(content);
  }
  assert.equal(batches.join(''), sql, 'Private batches must reconstruct the complete SQL without loss');
  assert.equal(hash(sql), manifest.data_sql_sha256);
  return { sql, manifestText };
}

const scratch = await mkdtemp(path.join(TEMP_PARENT, TEMP_PREFIX));
let skippedSymlink = false;
let usedJunction = false;
try {
  const sourceRoot = path.join(scratch, 'source');
  const proofs = path.join(sourceRoot, 'posloker-payment-proofs');
  await mkdir(proofs, { recursive: true });
  const shared = Buffer.from('%PDF-1.7\nSynthetic proof bytes only.\n%%EOF\n');
  const design = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3j8AAAAASUVORK5CYII=', 'base64');
  await writeFile(path.join(proofs, 'proof-A.pdf'), shared);
  await writeFile(path.join(proofs, 'again.pdf'), shared);
  await writeFile(path.join(proofs, 'materi-É😀.png'), design);
  await writeFile(path.join(proofs, 'orphan.pdf'), '%PDF-1.7\nSynthetic unreferenced bytes.\n');
  for (const gate of ['.htaccess', 'index.php', 'web.config']) await writeFile(path.join(proofs, gate), 'synthetic gate only');
  const customerDatabase = path.join(scratch, 'synthetic.sqlite');
  database(customerDatabase, meta);
  const outputDirectory = path.join(scratch, 'prepared');
  const summary = await prepareOrderFiles({ customerDatabase, sourceRoot, outputDirectory });
  assert.deepEqual(summary, {
    logicalRefs: 5, uniqueObjects: 2, uniqueBytes: shared.length + design.length, missingFiles: 1, orphanFiles: 1,
  }, 'Safe summary must count unique missing paths and deduplicated object bytes');
  const { sql, manifestText: manifest } = await verifyPrivateSql(outputDirectory);
  assert.ok(manifest.includes(hash(shared)) && manifest.includes(hash(design)));
  assert.ok(manifest.includes('Materi É😀.png'), 'Unicode original names must survive private inventory');
  const staged = await walk(path.join(outputDirectory, 'r2-upload'));
  assert.equal(staged.length, 2, 'Duplicate payload bytes must produce one staged object');
  assert.ok(staged.every(f => /^[a-f0-9]{64}\.[a-z0-9]+$/.test(path.basename(f))), 'Staged names must not expose customer names or paths');
  const check = new DatabaseSync(':memory:');
  try {
    check.exec(baseline); check.exec(fileSchema); check.exec(sql);
    const rows = check.prepare('SELECT * FROM order_files ORDER BY order_id, CASE kind WHEN \'proof\' THEN 0 ELSE 1 END, position').all();
    assert.equal(rows.length, 5);
    assert.equal(rows[1].original_name, 'Materi É😀.png');
    assert.equal(rows[1].position, 0);
    assert.ok(rows.every(row => row.migration_run_id === 'synthetic-run'));
    assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.row_sha256)));
    for (const row of rows) {
      if (row.missing) {
        assert.equal(row.storage_key, null); assert.equal(row.sha256, null); assert.equal(row.byte_count, null);
      } else {
        const bytes = await readFile(path.join(outputDirectory, 'r2-upload', row.storage_key));
        assert.equal(hash(bytes), row.sha256, 'Every staged object must match its recorded checksum');
        assert.equal(bytes.length, row.byte_count);
        assert.ok(row.storage_key.startsWith(row.sha256 + '.'));
      }
    }
    assert.equal(rows[0].storage_key, rows[2].storage_key, 'Logical references to duplicate bytes must share the object');
    assert.equal(check.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.throws(() => check.exec("UPDATE order_files SET order_id=999 WHERE id=(SELECT id FROM order_files LIMIT 1)"), /FOREIGN KEY/);
    assert.throws(() => check.exec("UPDATE order_files SET missing=1 WHERE missing=0"), /CHECK/);
    assert.throws(() => check.exec("UPDATE order_files SET position=-1"), /CHECK/);
    assert.throws(() => check.exec("UPDATE order_files SET kind='public'"), /CHECK/);
  } finally { check.close(); }

  // Enough Unicode metadata to force several Console batches, without customer
  // data or extra payloads. Byte-identical referenced files still stage once.
  const manyMaterials = new Map(Array.from({ length: 80 }, (_, index) => [index,
    new Map([['path', proofPrefix + 'proof-A.pdf'], ['name', 'Synthetic É😀 name '.repeat(12) + index + '.pdf'], ['mime', 'application/pdf']]),
  ]));
  const largeDb = path.join(scratch, 'multiple-batches.sqlite');
  database(largeDb, [{ order_id:101, source_meta_id:1, meta_key:'_posloker_materials', meta_value:php(manyMaterials) }]);
  const largeOutput = path.join(scratch, 'multiple-batches');
  const largeSummary = await prepareOrderFiles({ customerDatabase:largeDb, sourceRoot, outputDirectory:largeOutput });
  assert.equal(largeSummary.logicalRefs, 80);
  assert.equal(largeSummary.uniqueObjects, 1);
  await verifyPrivateSql(largeOutput, 2);

  let unsafeIndex = 0;
  for (const unsafePath of [
    '../outside.pdf', proofPrefix + '../outside.pdf', proofPrefix + './proof-A.pdf',
    'posloker-payment-proofs\\proof-A.pdf', '/absolute.pdf', 'C:/absolute.pdf',
    'https://example.test/proof.pdf', 'different-root/proof.pdf',
  ]) {
    const badDatabase = path.join(scratch, `bad-${unsafeIndex}.sqlite`);
    database(badDatabase, [{ order_id:101, source_meta_id:1, meta_key:'_posloker_proof_path', meta_value:unsafePath }]);
    await assert.rejects(() => prepareOrderFiles({ customerDatabase:badDatabase, sourceRoot,
      outputDirectory:path.join(scratch, `bad-output-${unsafeIndex++}`) }), undefined, 'Unsafe source paths must fail closed');
  }
  const outside = path.join(scratch, 'outside.pdf');
  await writeFile(outside, shared);
  try { await symlink(outside, path.join(proofs, 'linked.pdf'), 'file'); }
  catch (error) {
    if (!['EPERM','EACCES','ENOTSUP'].includes(error.code)) throw error;
    // Windows file symlinks may require a privilege that directory junctions
    // do not. A synthetic junction still exercises the reparse-point guard.
    const outsideDirectory = path.join(scratch, 'outside-directory');
    await mkdir(outsideDirectory);
    await writeFile(path.join(outsideDirectory, 'junction-proof.pdf'), shared);
    try {
      await symlink(outsideDirectory, path.join(proofs, 'linked-directory'), 'junction');
      usedJunction = true;
    } catch (junctionError) {
      if (!['EPERM','EACCES','ENOTSUP'].includes(junctionError.code)) throw junctionError;
      skippedSymlink = true;
    }
  }
  if (!skippedSymlink) {
    const linkedDb = path.join(scratch, 'symlink.sqlite');
    const linkedPath = usedJunction ? 'linked-directory/junction-proof.pdf' : 'linked.pdf';
    database(linkedDb, [{ order_id:101, source_meta_id:1, meta_key:'_posloker_proof_path', meta_value:proofPrefix+linkedPath }]);
    await assert.rejects(() => prepareOrderFiles({ customerDatabase:linkedDb, sourceRoot,
      outputDirectory:path.join(scratch,'symlink-output') }), undefined, 'Symlinks must never pull files outside the proof directory');
  }
} finally {
  const resolved = path.resolve(scratch);
  if (!resolved.startsWith(TEMP_PARENT + path.sep) || !path.basename(resolved).startsWith(TEMP_PREFIX)) throw new Error('Unsafe synthetic scratch cleanup target');
  await rm(resolved, { recursive:true, force:true });
}
console.log('Synthetic order-file checks passed: PHP UTF-8 lengths, insertion order, legacy fallback, deduplication, missing/orphan inventory, checksums, FKs, traversal guards' +
  ', and ASCII Console batches below 70 KB' + (skippedSymlink ? '; link guard check skipped because this OS denied both symlink and junction creation.' :
    (usedJunction ? ', including the Windows junction guard.' : ', including the symlink guard.')));
