import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUTS = path.resolve(REPO, '..', '..', 'outputs');
const SCHEMA = path.join(REPO, 'migrations', '0002_order_files.sql');
const COLUMNS = ['id', 'order_id', 'migration_run_id', 'kind', 'position', 'source_path', 'original_name', 'mime', 'storage_key', 'sha256', 'byte_count', 'missing', 'row_sha256'];
const CHECKS = ['logical_refs', 'dangling_orders', 'dangling_migration_runs', 'mismatched_migration_runs'];
const SUMMARY = ['logicalRefs', 'uniqueObjects', 'uniqueBytes', 'missingFiles', 'orphanFiles'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
class OrderFileVerificationError extends Error {}
function ensure(condition, message) { if (!condition) throw new OrderFileVerificationError(message); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const identifier = name => '"' + name + '"';
const sorted = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id));
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const checksum = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
function exactKeys(value, keys, error) {
  ensure(object(value) && canonical(Object.keys(value).sort()) === canonical([...keys].sort()), error);
}

function validateRow(row) {
  exactKeys(row, COLUMNS, 'Order-file row columns differ');
  ensure(typeof row.id === 'string' && row.id.length > 0 && nonnegativeInteger(row.order_id) && row.order_id > 0 &&
    typeof row.migration_run_id === 'string' && row.migration_run_id.length > 0 &&
    ['proof', 'material'].includes(row.kind) && nonnegativeInteger(row.position) &&
    typeof row.source_path === 'string' && row.source_path.length > 0 &&
    (typeof row.original_name === 'string' || row.original_name === null) &&
    (typeof row.mime === 'string' || row.mime === null) && [0, 1].includes(row.missing), 'Order-file row types differ');
  if (row.missing === 1) ensure(row.storage_key === null && row.sha256 === null && row.byte_count === null, 'Missing order-file metadata is inconsistent');
  else ensure(typeof row.storage_key === 'string' && row.storage_key.startsWith(row.sha256 + '.') &&
    checksum(row.sha256) && nonnegativeInteger(row.byte_count), 'Present order-file metadata is inconsistent');
  const { row_sha256, ...content } = row;
  ensure(checksum(row_sha256) && sha256(canonical(content)) === row_sha256, 'Order-file row checksum differs');
}

function validateManifest(manifest) {
  ensure(object(manifest) && manifest.version === 1 && Array.isArray(manifest.refs) && Array.isArray(manifest.objects), 'Invalid private order-file manifest');
  exactKeys(manifest.summary, SUMMARY, 'Private order-file summary fields differ');
  ensure(SUMMARY.every(key => nonnegativeInteger(manifest.summary[key])), 'Private order-file summary types differ');
  const ids = new Set(), positions = new Set(), expectedObjects = new Map(), missingPaths = new Set();
  for (const row of manifest.refs) {
    validateRow(row);
    const position = canonical([row.order_id, row.kind, row.position]);
    ensure(!ids.has(row.id) && !positions.has(position), 'Private manifest contains duplicate order-file references');
    ids.add(row.id); positions.add(position);
    if (row.missing) missingPaths.add(row.source_path);
    else {
      const content = { storage_key: row.storage_key, sha256: row.sha256, byte_count: row.byte_count };
      ensure(!expectedObjects.has(row.storage_key) || canonical(expectedObjects.get(row.storage_key)) === canonical(content), 'Private object metadata differs between references');
      expectedObjects.set(row.storage_key, content);
    }
  }
  const declared = new Map(), hashes = new Set();
  for (const entry of manifest.objects) {
    exactKeys(entry, ['storage_key', 'sha256', 'byte_count'], 'Private object manifest columns differ');
    ensure(typeof entry.storage_key === 'string' && checksum(entry.sha256) && nonnegativeInteger(entry.byte_count) &&
      !declared.has(entry.storage_key) && !hashes.has(entry.sha256), 'Private object manifest contains invalid or duplicate objects');
    declared.set(entry.storage_key, entry); hashes.add(entry.sha256);
  }
  const byKey = map => [...map.values()].sort((a, b) => a.storage_key.localeCompare(b.storage_key));
  ensure(canonical(byKey(declared)) === canonical(byKey(expectedObjects)), 'Private object manifest does not match file references');
  const total = [...declared.values()].reduce((sum, entry) => sum + entry.byte_count, 0);
  ensure(Number.isSafeInteger(total) && manifest.summary.logicalRefs === manifest.refs.length &&
    manifest.summary.uniqueObjects === declared.size && manifest.summary.uniqueBytes === total &&
    manifest.summary.missingFiles === missingPaths.size, 'Private order-file inventory counts differ');
  return manifest;
}

// This query contains schema identifiers only, never source names or paths.
// The result cell itself is private and must be saved outside the checkout.
export function verificationQuery() {
  const jsonRow = 'json_object(' + COLUMNS.flatMap(column => ["'" + column + "'", identifier(column)]).join(',') + ')';
  const rows = '(SELECT ' + COLUMNS.map(identifier).join(',') + ' FROM "order_files" ORDER BY "id")';
  const checks = [
    "'logical_refs'", '(SELECT count(*) FROM "order_files")',
    "'dangling_orders'", '(SELECT count(*) FROM "order_files" AS f LEFT JOIN "orders" AS o ON o.source_post_id=f.order_id WHERE o.source_post_id IS NULL)',
    "'dangling_migration_runs'", '(SELECT count(*) FROM "order_files" AS f LEFT JOIN "migration_runs" AS r ON r.id=f.migration_run_id WHERE r.id IS NULL)',
    "'mismatched_migration_runs'", '(SELECT count(*) FROM "order_files" AS f LEFT JOIN "orders" AS o ON o.source_post_id=f.order_id WHERE o.migration_run_id IS NOT f.migration_run_id)',
  ];
  const query = 'SELECT json_object(\'order_files\',json((SELECT json_group_array(' + jsonRow + ') FROM ' + rows + ')),\'checks\',json_object(' + checks.join(',') + ')) AS order_files_snapshot;';
  ensure(/^[\x20-\x7e]+$/.test(query) && !/[\r\n]/.test(query) && Buffer.byteLength(query) < 70000, 'Verification query must be ASCII on one line below 70 KB');
  return query;
}

function decodeRemote(input) {
  let result = input;
  for (let depth = 0; depth < 12; depth++) {
    if (typeof result === 'string') {
      try { result = JSON.parse(result); }
      catch { throw new OrderFileVerificationError('Remote result is not valid snapshot JSON'); }
      continue;
    }
    if (Array.isArray(result)) {
      ensure(result.length === 1, 'Remote query result must contain exactly one snapshot cell');
      result = result[0]; continue;
    }
    if (object(result) && Object.hasOwn(result, 'order_files_snapshot')) {
      exactKeys(result, ['order_files_snapshot'], 'Remote snapshot cell has unexpected columns');
      result = result.order_files_snapshot; continue;
    }
    if (object(result) && (Object.hasOwn(result, 'result') || Object.hasOwn(result, 'results'))) {
      ensure(result.success !== false && (!Array.isArray(result.errors) || result.errors.length === 0), 'Remote query reported a failure');
      ensure(!(Object.hasOwn(result, 'result') && Object.hasOwn(result, 'results')), 'Remote query result is ambiguous');
      result = Object.hasOwn(result, 'result') ? result.result : result.results; continue;
    }
    break;
  }
  exactKeys(result, ['order_files', 'checks'], 'Remote snapshot has unexpected fields');
  return result;
}

export function compareOrderFiles(manifestInput, remoteInput) {
  const manifest = validateManifest(manifestInput), remote = decodeRemote(remoteInput);
  ensure(Array.isArray(remote.order_files) && remote.order_files.length === manifest.refs.length, 'Remote order-file row count differs');
  exactKeys(remote.checks, CHECKS, 'Remote foreign key check fields differ');
  ensure(CHECKS.every(key => nonnegativeInteger(remote.checks[key])) && remote.checks.logical_refs === manifest.refs.length &&
    remote.checks.dangling_orders === 0 && remote.checks.dangling_migration_runs === 0 && remote.checks.mismatched_migration_runs === 0,
  'Remote order-file foreign key checks failed');
  const seen = new Set();
  for (const row of remote.order_files) {
    validateRow(row);
    ensure(!seen.has(row.id), 'Remote order-file rows have duplicate identifiers');
    seen.add(row.id);
  }
  ensure(canonical(sorted(remote.order_files)) === canonical(sorted(manifest.refs)), 'Remote full order-file row values differ');
  return {
    ...manifest.summary, fullRowComparisonPassed: true, rowChecksumsPassed: true, foreignKeyChecksPassed: true,
    validationSha256: sha256(canonical(sorted(remote.order_files))),
  };
}

function inside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function privatePath(filename) {
  const absolute = path.resolve(filename);
  ensure(!inside(absolute, REPO) && !inside(absolute, OUTPUTS), 'Private verification artifacts must stay outside the repository and outputs');
  return absolute;
}
async function privateFile(filename) {
  ensure(typeof filename === 'string' && filename.length > 0, 'A private verification input file is required');
  return privatePath(await realpath(path.resolve(filename)));
}
async function outputDirectory(directory) {
  let output = privatePath(directory);
  await mkdir(output, { recursive: true });
  output = privatePath(await realpath(output));
  ensure((await lstat(output)).isDirectory(), 'Private verification output is not a directory');
  return output;
}
async function privateWrite(directory, name, content, inputs = []) {
  const filename = path.join(directory, name);
  ensure(!inputs.includes(filename), 'Verification output cannot replace a source input');
  try {
    const info = await lstat(filename);
    ensure(info.isFile() && !info.isSymbolicLink(), 'Private verification output cannot be a symlink or special file');
    const actual = privatePath(await realpath(filename));
    ensure(inside(actual, directory) && !inputs.includes(actual), 'Private verification output escapes its directory');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(filename, content, { mode: 0o600 });
}
async function readManifest(filename) {
  const location = await privateFile(filename), bytes = await readFile(location);
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); }
  catch { throw new OrderFileVerificationError('Private file manifest is not valid JSON'); }
  validateManifest(manifest);
  return { location, bytes, manifest };
}
function localQueryRoundtrip(manifest, schema) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE migration_runs(id TEXT PRIMARY KEY); CREATE TABLE orders(source_post_id INTEGER PRIMARY KEY,migration_run_id TEXT NOT NULL REFERENCES migration_runs(id));');
    const runs = new Set(), orders = new Map();
    for (const row of manifest.refs) {
      runs.add(row.migration_run_id);
      ensure(!orders.has(row.order_id) || orders.get(row.order_id) === row.migration_run_id, 'Private file references have inconsistent migration provenance');
      orders.set(row.order_id, row.migration_run_id);
    }
    for (const run of runs) db.prepare('INSERT INTO migration_runs(id) VALUES(?)').run(run);
    for (const [id, run] of orders) db.prepare('INSERT INTO orders(source_post_id,migration_run_id) VALUES(?,?)').run(id, run);
    db.exec(schema);
    const statement = db.prepare('INSERT INTO order_files(' + COLUMNS.map(identifier).join(',') + ') VALUES(' + COLUMNS.map(() => '?').join(',') + ')');
    for (const row of manifest.refs) statement.run(...COLUMNS.map(column => row[column]));
    return compareOrderFiles(manifest, db.prepare(verificationQuery()).get());
  } finally { db.close(); }
}
function safeResult(result) {
  const { validationSha256, ...safe } = result;
  return safe;
}

export async function buildVerificationArtifacts(options) {
  const { location, bytes, manifest } = await readManifest(options.manifest);
  const schema = await readFile(SCHEMA, 'utf8');
  ensure(manifest.schema_sha256 === sha256(schema), 'Checked-in order-file schema differs from the private manifest');
  const local = localQueryRoundtrip(manifest, schema), query = verificationQuery();
  const output = await outputDirectory(options['out-dir'] || path.dirname(location));
  const queryFile = 'order-files-verification-query.sql';
  await privateWrite(output, queryFile, query, [location]);
  const report = {
    version: 1, status: 'Query prepared and locally validated; remote import has not been verified', prepared_at: new Date().toISOString(),
    source_manifest_sha256: sha256(bytes), expected_rows_sha256: local.validationSha256, counts: manifest.summary,
    query: { file: queryFile, byte_count: Buffer.byteLength(query), sha256: sha256(query) },
    local_validation: safeResult(local), remote_verification_performed: false, r2_verification_performed: false,
  };
  await privateWrite(output, 'order-files-verification-manifest.private.json', JSON.stringify(report, null, 2) + '\n', [location]);
  return { ...manifest.summary, localQueryRoundtripPassed: true, rowChecksumsPassed: true, queryAsciiSingleLine: true };
}

export async function verifyRemoteFile(options) {
  const { location, bytes, manifest } = await readManifest(options.manifest);
  const remotePath = await privateFile(options.remote), remoteBytes = await readFile(remotePath);
  let remote;
  try { remote = JSON.parse(remoteBytes.toString('utf8')); }
  catch { throw new OrderFileVerificationError('Remote verification file is not valid JSON'); }
  const result = compareOrderFiles(manifest, remote);
  const output = await outputDirectory(options['out-dir'] || path.dirname(location));
  const report = {
    version: 1, verified_at: new Date().toISOString(), source_manifest_sha256: sha256(bytes),
    remote_file_sha256: sha256(remoteBytes), ...result,
    verification_scope: 'Complete order_files rows and SQL foreign-key reference checks; R2 object bytes were not queried',
    r2_verification_performed: false,
  };
  await privateWrite(output, 'order-files-verification-result.private.json', JSON.stringify(report, null, 2) + '\n', [location, remotePath]);
  return safeResult(result);
}

function argumentsFor(argv) {
  const [mode, ...rest] = argv, options = {};
  ensure(['build', 'verify'].includes(mode), 'Use build or verify');
  for (let i = 0; i < rest.length; i += 2) {
    ensure(['--manifest', '--remote', '--out-dir'].includes(rest[i]) && rest[i + 1] && !rest[i + 1].startsWith('--'), 'Invalid order-file verification arguments');
    options[rest[i].slice(2)] = rest[i + 1];
  }
  ensure(options.manifest && (mode !== 'verify' || options.remote), 'Provide --manifest and, for verify, --remote');
  return { mode, options };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { mode, options } = argumentsFor(process.argv.slice(2));
    console.log(JSON.stringify(await (mode === 'build' ? buildVerificationArtifacts(options) : verifyRemoteFile(options)), null, 2));
  } catch (error) {
    console.error('Order-file verification failed: ' + (error instanceof OrderFileVerificationError ? error.message : 'Private processing failed; no source values printed'));
    process.exitCode = 1;
  }
}
