import { constants, createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK_OUTPUTS = path.resolve(REPO, '..', '..', 'outputs');
const PROOF_DIRECTORY = 'posloker-payment-proofs';
const SCHEMA = path.join(REPO, 'migrations', '0002_order_files.sql');
const FILE_KEYS = [
  '_posloker_proof_path', '_posloker_proof_name', '_posloker_proof_mime',
  '_posloker_materials', '_posloker_material_path', '_posloker_material_name', '_posloker_material_mime',
];
const BATCH_LIMIT = 65 * 1024;
class OrderFilePreparationError extends Error {}
function ensure(condition, message) { if (!condition) throw new OrderFilePreparationError(message); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
function integer(value) {
  ensure((typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && /^\d+$/.test(value)), 'Invalid source identifier');
  const number = Number(value);
  ensure(Number.isSafeInteger(number) && number >= 0, 'Invalid source identifier');
  return number;
}
function inside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function privateDirectory(directory) {
  const resolved = path.resolve(directory);
  ensure(!inside(resolved, REPO) && !inside(resolved, TASK_OUTPUTS), 'Private file artifacts must stay outside the repository and outputs');
  return resolved;
}

// PHP serialized values are parsed as UTF-8 bytes, never evaluated. Maps retain
// PHP array insertion order without exposing object properties or prototypes.
export function parsePhpSerialized(text) {
  ensure(typeof text === 'string', 'Invalid serialized material metadata');
  const input = Buffer.from(text, 'utf8');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let offset = 0, nodes = 0;
  function take(expected) {
    const bytes = Buffer.from(expected);
    ensure(input.subarray(offset, offset + bytes.length).equals(bytes), 'Invalid serialized material syntax');
    offset += bytes.length;
  }
  function number(delimiter, signed = false) {
    const end = input.indexOf(delimiter.charCodeAt(0), offset);
    ensure(end !== -1, 'Incomplete serialized material metadata');
    const value = input.subarray(offset, end).toString('ascii');
    ensure((signed ? /^-?\d+$/ : /^\d+$/).test(value), 'Invalid serialized material length or integer');
    const result = Number(value);
    ensure(Number.isSafeInteger(result), 'Serialized material integer is out of range');
    offset = end + 1;
    return result;
  }
  function value(depth = 0) {
    ensure(depth <= 64 && ++nodes <= 100000 && offset < input.length, 'Serialized material structure exceeds safe limits');
    const type = String.fromCharCode(input[offset++]);
    if (type === 'N') { take(';'); return null; }
    take(':');
    if (type === 'i') return number(';', true);
    if (type === 'b') {
      const boolean = number(';');
      ensure(boolean === 0 || boolean === 1, 'Invalid serialized boolean');
      return boolean === 1;
    }
    if (type === 's') {
      const length = number(':');
      take('"');
      ensure(offset + length <= input.length, 'Invalid serialized UTF-8 byte length');
      let result;
      try { result = decoder.decode(input.subarray(offset, offset + length)); }
      catch { throw new OrderFilePreparationError('Invalid serialized UTF-8 string'); }
      offset += length;
      take('";');
      return result;
    }
    ensure(type === 'a', 'Unsupported serialized material type; objects are forbidden');
    const length = number(':');
    ensure(length <= 100000, 'Serialized material array is too large');
    take('{');
    const result = new Map();
    for (let i = 0; i < length; i++) {
      const key = value(depth + 1);
      ensure(typeof key === 'string' || (typeof key === 'number' && Number.isSafeInteger(key)), 'Invalid serialized array key');
      ensure(!result.has(key), 'Duplicate serialized array key');
      result.set(key, value(depth + 1));
    }
    take('}');
    return result;
  }
  const result = value();
  ensure(offset === input.length, 'Unexpected serialized material suffix');
  return result;
}

export function normalizeReferencePath(value) {
  ensure(typeof value === 'string' && value.length > 0, 'Missing private file path');
  ensure(!/[\x00-\x1f\x7f\\:?#]/.test(value) && !/%(?:2e|2f|5c)/i.test(value), 'Unsafe private file path');
  ensure(!path.posix.isAbsolute(value) && !path.win32.isAbsolute(value), 'Absolute or external private file paths are forbidden');
  const pieces = value.split('/');
  ensure(pieces.length > 1 && pieces[0] === PROOF_DIRECTORY && pieces.every(piece => piece && piece !== '.' && piece !== '..'), 'Private file path escapes its protected directory');
  ensure(pieces.every(piece => !/[. ]$/.test(piece) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(piece)), 'Unsafe private file path component');
  return pieces.join('/');
}

export function collectOrderFileReferences(metaRows) {
  ensure(Array.isArray(metaRows), 'Invalid source file metadata');
  const groups = new Map();
  for (const row of [...metaRows].sort((a, b) => integer(a.order_id) - integer(b.order_id) || integer(a.source_meta_id) - integer(b.source_meta_id))) {
    if (!FILE_KEYS.includes(row.meta_key)) continue;
    const id = integer(row.order_id);
    if (!groups.has(id)) groups.set(id, new Map());
    if (!groups.get(id).has(row.meta_key)) groups.get(id).set(row.meta_key, row.meta_value);
  }
  const refs = [];
  for (const [order_id, values] of groups) {
    const field = key => values.get('_posloker_' + key) ?? '';
    const add = (kind, position, file) => {
      ensure(typeof file.name === 'string' && typeof file.mime === 'string', 'Invalid private file name or MIME metadata');
      refs.push({ order_id, kind, position, source_path: normalizeReferencePath(file.path), original_name: file.name, mime: file.mime });
    };
    if (field('proof_path')) add('proof', 0, { path: field('proof_path'), name: field('proof_name'), mime: field('proof_mime') });
    const serialized = field('materials');
    let materials = new Map();
    if (serialized !== '') {
      materials = parsePhpSerialized(serialized);
      ensure(materials instanceof Map, 'Material metadata must contain a PHP array');
    }
    if (materials.size) {
      let position = 0;
      for (const entry of materials.values()) {
        ensure(entry instanceof Map && typeof entry.get('path') === 'string', 'Invalid serialized material entry');
        add('material', position++, { path: entry.get('path'), name: entry.get('name') ?? '', mime: entry.get('mime') ?? '' });
      }
    } else if (field('material_path')) {
      add('material', 0, { path: field('material_path'), name: field('material_name'), mime: field('material_mime') });
    }
  }
  return refs;
}

async function actualDirectory(directory, label) {
  const info = await lstat(directory);
  ensure(info.isDirectory() && !info.isSymbolicLink(), label + ' must be a real directory, not a symlink');
  const resolved = await realpath(directory);
  privateDirectory(resolved);
  return resolved;
}
async function resolveReference(sourceRoot, proofRoot, relative) {
  const pieces = normalizeReferencePath(relative).split('/');
  let current = sourceRoot;
  for (const [index, piece] of pieces.entries()) {
    current = path.join(current, piece);
    let info;
    try { info = await lstat(current); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    ensure(!info.isSymbolicLink(), 'Private file symlinks are forbidden');
    ensure(index === pieces.length - 1 ? info.isFile() : info.isDirectory(), 'Invalid private file type');
  }
  const resolved = await realpath(current);
  ensure(inside(resolved, proofRoot) && resolved !== proofRoot, 'Private file path escapes its protected directory');
  return resolved;
}
async function inventoryFiles(proofRoot) {
  const files = new Set();
  const ignored = new Set(['.htaccess', 'index.php', 'web.config']);
  async function visit(directory, prefix = '') {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name;
      const absolute = path.join(directory, entry.name);
      ensure(!entry.isSymbolicLink(), 'Private source inventory contains a symlink');
      if (entry.isDirectory()) await visit(absolute, relative + '/');
      else {
        ensure(entry.isFile(), 'Private source inventory contains a special file');
        if (!prefix && ignored.has(entry.name)) continue;
        const normalized = normalizeReferencePath(PROOF_DIRECTORY + '/' + relative);
        ensure(inside(await realpath(absolute), proofRoot), 'Private source inventory escapes its protected directory');
        files.add(normalized);
      }
    }
  }
  await visit(proofRoot);
  return files;
}
async function digestFile(filename) {
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filename)) { digest.update(chunk); bytes += chunk.length; }
  ensure(Number.isSafeInteger(bytes), 'Private file size exceeds safe range');
  return { sha256: digest.digest('hex'), byte_count: bytes };
}
function safeExtension(ref) {
  const mimeExtensions = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['application/pdf', 'pdf'], ['video/mp4', 'mp4']]);
  const byMime = mimeExtensions.get(ref.mime.toLowerCase());
  if (byMime) return byMime;
  const extension = path.posix.extname(ref.source_path).slice(1).toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'mp4'].includes(extension) ? (extension === 'jpeg' ? 'jpg' : extension) : 'bin';
}
function asciiLiteral(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') { ensure(Number.isSafeInteger(value), 'Invalid order-file integer'); return String(value); }
  ensure(typeof value === 'string', 'Invalid order-file SQL value');
  return "CAST(X'" + Buffer.from(value, 'utf8').toString('hex') + "' AS TEXT)";
}
function statementsFor(rows) {
  return rows.map(row => {
    const keys = Object.keys(row);
    const sql = 'INSERT INTO "order_files" (' + keys.map(key => '"' + key + '"').join(',') + ') VALUES (' + keys.map(key => asciiLiteral(row[key])).join(',') + ');';
    ensure(Buffer.byteLength(sql) < BATCH_LIMIT, 'An order-file statement exceeds the private import batch limit');
    return sql;
  });
}
function validateSql(schema, statements, rows, runs) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE migration_runs (id TEXT PRIMARY KEY); CREATE TABLE orders (source_post_id INTEGER PRIMARY KEY,migration_run_id TEXT NOT NULL REFERENCES migration_runs(id));');
    for (const run of new Set(runs.values())) db.prepare('INSERT INTO migration_runs(id) VALUES (?)').run(run);
    for (const [id, run] of runs) db.prepare('INSERT INTO orders(source_post_id,migration_run_id) VALUES (?,?)').run(id, run);
    db.exec(schema);
    db.exec(statements.join(''));
    ensure(db.prepare('PRAGMA quick_check').all().every(row => row.quick_check === 'ok'), 'Order-file SQL integrity validation failed');
    ensure(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'Order-file SQL foreign key validation failed');
    const actual = db.prepare('SELECT * FROM order_files ORDER BY id').all();
    const expected = [...rows].sort((a, b) => a.id.localeCompare(b.id));
    ensure(canonical(actual) === canonical(expected), 'Order-file SQL round-trip values differ');
    for (const { row_sha256, ...content } of actual) ensure(sha256(canonical(content)) === row_sha256, 'Order-file row checksum validation failed');
  } finally { db.close(); }
}

async function writePrivateArtifact(output, name, content) {
  const filename = path.join(output, name);
  try {
    const info = await lstat(filename);
    ensure(info.isFile() && !info.isSymbolicLink(), 'Private output artifacts cannot be symlinks or special files');
    const existing = await realpath(filename);
    ensure(inside(existing, output), 'Private output artifact escapes its directory');
    privateDirectory(existing);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(filename, content, { mode: 0o600 });
}

export async function prepareOrderFiles({ customerDatabase, sourceRoot, outputDirectory }) {
  ensure(customerDatabase && sourceRoot && outputDirectory, 'Provide the private database, extracted source root, and output directory');
  const databasePath = await realpath(path.resolve(customerDatabase));
  privateDirectory(databasePath);
  const extractedRoot = await actualDirectory(path.resolve(sourceRoot), 'Extracted source root');
  const proofRoot = await actualDirectory(path.join(extractedRoot, PROOF_DIRECTORY), 'Extracted proof directory');
  let output = privateDirectory(outputDirectory);
  ensure(!inside(output, extractedRoot) && !inside(extractedRoot, output), 'Source files and prepared output must use separate directories');
  const db = new DatabaseSync(databasePath, { readOnly: true });
  let meta;
  try {
    meta = db.prepare('SELECT m.source_meta_id,m.order_id,m.meta_key,m.meta_value,o.migration_run_id FROM order_meta AS m JOIN orders AS o ON o.source_post_id=m.order_id WHERE m.meta_key IN (' + FILE_KEYS.map(() => '?').join(',') + ') ORDER BY m.order_id,m.source_meta_id').all(...FILE_KEYS);
  } finally { db.close(); }
  const refs = collectOrderFileReferences(meta), sourceFiles = await inventoryFiles(proofRoot);
  const runs = new Map();
  for (const row of meta) {
    ensure(typeof row.migration_run_id === 'string' && row.migration_run_id.length > 0, 'Missing source migration provenance');
    ensure(!runs.has(row.order_id) || runs.get(row.order_id) === row.migration_run_id, 'Inconsistent source migration provenance');
    runs.set(row.order_id, row.migration_run_id);
  }
  const observed = new Map(), objects = new Map(), missing = new Set(), rows = [];
  for (const ref of refs) {
    let file = observed.get(ref.source_path);
    if (!observed.has(ref.source_path)) {
      const absolute = await resolveReference(extractedRoot, proofRoot, ref.source_path);
      file = absolute ? { absolute, ...await digestFile(absolute) } : null;
      observed.set(ref.source_path, file);
    }
    if (!file) missing.add(ref.source_path);
    let object = null;
    if (file) {
      object = objects.get(file.sha256);
      if (!object) {
        object = { storage_key: file.sha256 + '.' + safeExtension(ref), sha256: file.sha256, byte_count: file.byte_count, source_path: ref.source_path, absolute: file.absolute };
        objects.set(file.sha256, object);
      }
    }
    const content = {
      id: 'file_' + sha256(canonical(ref)), order_id: ref.order_id, migration_run_id: runs.get(ref.order_id),
      kind: ref.kind, position: ref.position, source_path: ref.source_path, original_name: ref.original_name, mime: ref.mime,
      storage_key: object?.storage_key ?? null, sha256: file?.sha256 ?? null, byte_count: file?.byte_count ?? null, missing: file ? 0 : 1,
    };
    rows.push({ ...content, row_sha256: sha256(canonical(content)) });
  }
  const summary = {
    logicalRefs: rows.length, uniqueObjects: objects.size,
    uniqueBytes: [...objects.values()].reduce((sum, object) => sum + object.byte_count, 0),
    missingFiles: missing.size, orphanFiles: [...sourceFiles].filter(file => !observed.has(file)).length,
  };
  ensure(Number.isSafeInteger(summary.uniqueBytes), 'Total private file size exceeds safe range');
  const statements = statementsFor(rows), schema = await readFile(SCHEMA, 'utf8');
  validateSql(schema, statements, rows, runs);
  await mkdir(output, { recursive: true });
  output = privateDirectory(await realpath(output));
  ensure(!inside(output, extractedRoot) && !inside(extractedRoot, output), 'Source files and prepared output must use separate directories');
  const staging = path.join(output, 'r2-upload');
  await mkdir(staging, { recursive: true });
  const stageRoot = await actualDirectory(staging, 'Private R2 staging directory');
  ensure(inside(stageRoot, output), 'Private R2 staging directory escapes its output');
  const expectedKeys = new Set([...objects.values()].map(object => object.storage_key));
  for (const entry of await readdir(stageRoot, { withFileTypes: true })) ensure(entry.isFile() && !entry.isSymbolicLink() && expectedKeys.has(entry.name), 'R2 staging contains unrelated files; use a new private output directory');
  for (const object of objects.values()) {
    const source = await resolveReference(extractedRoot, proofRoot, object.source_path);
    ensure(Boolean(source), 'A referenced source file disappeared during staging');
    const target = path.join(stageRoot, object.storage_key);
    try { await copyFile(source, target, constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await lstat(target);
    ensure(info.isFile() && !info.isSymbolicLink(), 'Private R2 staged file is not a regular file');
    const copied = await digestFile(target);
    ensure(copied.sha256 === object.sha256 && copied.byte_count === object.byte_count, 'Private R2 staged file checksum differs');
  }
  const batches = [];
  let current = '';
  for (const statement of statements) {
    if (current && Buffer.byteLength(current + statement) >= BATCH_LIMIT) { batches.push(current); current = ''; }
    current += statement;
  }
  if (current) batches.push(current);
  const batchFiles = [];
  for (let i = 0; i < batches.length; i++) {
    const name = 'order-files-batch-' + String(i + 1).padStart(4, '0') + '.sql';
    await writePrivateArtifact(output, name, batches[i]);
    batchFiles.push({ file: name, byte_count: Buffer.byteLength(batches[i]), sha256: sha256(batches[i]) });
  }
  const data = statements.join('');
  await writePrivateArtifact(output, 'order-files.sql', data);
  const manifest = {
    version: 1, prepared_at: new Date().toISOString(), status: 'Prepared locally; no R2 upload has occurred', summary,
    schema_sha256: sha256(schema), data_sql_sha256: sha256(data), sql_batches: batchFiles,
    refs: rows, objects: [...objects.values()].map(({ absolute, source_path, ...object }) => object),
  };
  await writePrivateArtifact(output, 'order-files-manifest.private.json', JSON.stringify(manifest, null, 2) + '\n');
  return summary;
}

function cliArguments(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    ensure(['--database', '--source-root', '--out-dir'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--'), 'Invalid private order-file arguments');
    values[argv[i]] = argv[i + 1];
  }
  ensure(values['--database'] && values['--source-root'] && values['--out-dir'], 'Usage: node scripts/prepare-order-files.mjs --database <private.sqlite> --source-root <extracted-root> --out-dir <private-prepared-directory>');
  return { customerDatabase: values['--database'], sourceRoot: values['--source-root'], outputDirectory: values['--out-dir'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await prepareOrderFiles(cliArguments(process.argv.slice(2))), null, 2)); }
  catch (error) {
    console.error('Order-file preparation failed: ' + (error instanceof OrderFilePreparationError ? error.message : 'Source extraction or private processing is unavailable; no source values printed'));
    process.exitCode = 1;
  }
}
