import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { assertPrivateOutput, canonical } from './prepare-customer-migration.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BATCH_BYTES = 70000;
const MAX_STATEMENT_BYTES = 95 * 1024;
const TABLES = [
  { name: 'migration_runs', key: 'id', columns: ['id', 'source_sha256', 'source_prefix', 'source_snapshot_at', 'source_dump_completed_at', 'prepared_at', 'order_count', 'contact_profile_count', 'meta_count', 'validation_sha256'] },
  { name: 'customers', key: 'id', columns: ['id', 'migration_run_id', 'identity_sha256', 'display_name', 'whatsapp', 'email', 'normalized_name', 'normalized_whatsapp', 'normalized_email', 'first_source_post_id', 'row_sha256'] },
  { name: 'orders', key: 'source_post_id', columns: ['source_post_id', 'migration_run_id', 'customer_id', 'order_number', 'post_status', 'business_status', 'customer_name_original', 'whatsapp_original', 'email_original', 'city', 'package_id', 'package_name', 'base_amount', 'unique_code', 'amount', 'ordered_at_local', 'ordered_at_gmt', 'modified_at_local', 'raw_post_json', 'source_post_sha256', 'row_sha256'] },
  { name: 'order_meta', key: 'source_meta_id', columns: ['source_meta_id', 'migration_run_id', 'order_id', 'source_position', 'meta_key', 'meta_value', 'row_sha256'] },
];
const sha256 = value => createHash('sha256').update(value).digest('hex');
class ConsoleMigrationError extends Error {}
function ensure(condition, message) { if (!condition) throw new ConsoleMigrationError(message); }
const identifier = value => '"' + value + '"';

export function consoleLiteral(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    ensure(Number.isSafeInteger(value), 'An integer cannot be represented exactly');
    return String(value);
  }
  ensure(typeof value === 'string', 'An unsupported database value was encountered');
  // Even embedded NUL, newlines, quotes and backslashes survive a single-line UI.
  return "CAST(X'" + Buffer.from(value, 'utf8').toString('hex') + "' AS TEXT)";
}

function validateStatement(statement) {
  ensure(!/[\r\n]/.test(statement) && /^[\x00-\x7f]*$/.test(statement), 'Console SQL must be ASCII and single-line');
  ensure(Buffer.byteLength(statement) < MAX_STATEMENT_BYTES, 'A statement exceeds the D1 statement limit');
}

export function splitBatches(statements, limit = MAX_BATCH_BYTES) {
  const result = [];
  let current = [], bytes = 0;
  for (const statement of statements) {
    validateStatement(statement.sql);
    const statementBytes = Buffer.byteLength(statement.sql);
    ensure(statementBytes < limit, 'A statement cannot fit within the console batch limit');
    const addition = statementBytes + (current.length ? 1 : 0);
    if (bytes + addition >= limit) {
      result.push(current); current = []; bytes = 0;
    }
    current.push(statement);
    bytes += statementBytes + (current.length > 1 ? 1 : 0);
  }
  if (current.length) result.push(current);
  return result;
}

function schemaStatements(schema) {
  // This checked-in schema has no semicolons in strings; source data is never split.
  const text = schema.replace(/^\s*--[^\r\n]*/gm, '');
  return text.split(';').map(s => s.trim()).filter(Boolean).map(statement => {
    ensure(/^(?:CREATE\s+(?:TABLE|INDEX)\b|PRAGMA\s+foreign_keys\s*=\s*ON\b)/i.test(statement), 'Unexpected schema statement');
    const sql = statement.replace(/\s+/g, ' ') + ';';
    validateStatement(sql);
    return { sql, table: null };
  });
}

function integrity(db) {
  ensure(db.prepare('PRAGMA quick_check').all().every(row => row.quick_check === 'ok'), 'Database integrity check failed');
  ensure(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'Foreign key validation failed');
}

function readSnapshot(db) {
  integrity(db);
  return Object.fromEntries(TABLES.map(table => {
    const actualColumns = db.prepare('PRAGMA table_info(' + identifier(table.name) + ')').all().map(row => row.name);
    ensure(canonical(actualColumns) === canonical(table.columns), 'Unexpected source database columns');
    return [table.name, db.prepare('SELECT ' + table.columns.map(identifier).join(',') + ' FROM ' +
      identifier(table.name) + ' ORDER BY ' + identifier(table.key)).all().map(row => ({ ...row }))];
  }));
}

function insertStatements(snapshot) {
  return TABLES.flatMap(table => snapshot[table.name].map(row => ({
    table: table.name,
    sql: 'INSERT INTO ' + identifier(table.name) + ' (' + table.columns.map(identifier).join(',') + ') VALUES (' +
      table.columns.map(column => consoleLiteral(row[column])).join(',') + ');',
  })));
}

export function verificationQuery() {
  const parts = TABLES.flatMap(table => {
    const object = 'json_object(' + table.columns.flatMap(column => ["'" + column + "'", identifier(column)]).join(',') + ')';
    const orderedRows = '(SELECT ' + table.columns.map(identifier).join(',') + ' FROM ' + identifier(table.name) +
      ' ORDER BY ' + identifier(table.key) + ')';
    return ["'" + table.name + "'", 'json((SELECT json_group_array(' + object + ') FROM ' + orderedRows + '))'];
  });
  const query = 'SELECT json_object(' + parts.join(',') + ') AS migration_snapshot;';
  validateStatement(query);
  return query;
}

function safeCounts(snapshot) {
  return {
    migrationRuns: snapshot.migration_runs.length,
    contactProfiles: snapshot.customers.length,
    orders: snapshot.orders.length,
    orderMeta: snapshot.order_meta.length,
  };
}

function decodeRemote(input) {
  let result = input;
  for (let i = 0; i < 4; i++) {
    if (typeof result === 'string') { result = JSON.parse(result); continue; }
    if (Array.isArray(result) && result.length === 1 && result[0]?.migration_snapshot !== undefined) {
      result = result[0].migration_snapshot; continue;
    }
    if (result && typeof result === 'object' && result.migration_snapshot !== undefined) {
      result = result.migration_snapshot; continue;
    }
    break;
  }
  ensure(result && !Array.isArray(result) && typeof result === 'object', 'Remote result is not a snapshot JSON object');
  ensure(canonical(Object.keys(result).sort()) === canonical(TABLES.map(table => table.name).sort()), 'Remote result has unexpected tables');
  return result;
}

export function compareSnapshots(expected, remoteInput) {
  const remote = decodeRemote(remoteInput);
  for (const table of TABLES) {
    const rows = remote[table.name], expectedRows = expected[table.name];
    ensure(Array.isArray(rows) && rows.length === expectedRows.length, 'Remote row count differs for ' + table.name);
    const keys = new Set();
    for (const row of rows) {
      ensure(row && !Array.isArray(row) && typeof row === 'object', 'Remote row has an invalid shape');
      ensure(canonical(Object.keys(row).sort()) === canonical([...table.columns].sort()), 'Remote columns differ for ' + table.name);
      ensure(!keys.has(row[table.key]), 'Remote rows have duplicate identifiers');
      keys.add(row[table.key]);
    }
    const sortRows = values => [...values].sort((a, b) => {
      const left = a[table.key], right = b[table.key];
      return typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
    });
    ensure(canonical(sortRows(rows)) === canonical(sortRows(expectedRows)), 'Remote full-row values differ for ' + table.name);
  }
  return { ...safeCounts(expected), fullRowComparisonPassed: true };
}

async function privateFile(filename) {
  ensure(filename, 'A private input file is required');
  return assertPrivateOutput(await realpath(path.resolve(filename)));
}

export async function buildConsoleArtifacts(options) {
  const expectedPath = await privateFile(options.database);
  let out = assertPrivateOutput(options['out-dir']);
  await mkdir(out, { recursive: true });
  out = assertPrivateOutput(await realpath(out));
  const schemaPath = path.resolve(options.schema || path.join(REPO, 'migrations', '0001_customer_data.sql'));
  ensure(schemaPath === path.join(REPO, 'migrations', '0001_customer_data.sql'), 'Use the checked-in customer schema');
  const schema = schemaStatements(await readFile(schemaPath, 'utf8'));
  const expectedDb = new DatabaseSync(expectedPath, { readOnly: true });
  let expected;
  try { expected = readSnapshot(expectedDb); } finally { expectedDb.close(); }
  const batches = [
    ...splitBatches(schema).map(batch => ({ phase: 'schema', statements: batch })),
    ...splitBatches(insertStatements(expected)).map(batch => ({ phase: 'data', statements: batch })),
  ];
  const probe = new DatabaseSync(':memory:');
  probe.exec('PRAGMA foreign_keys=ON;');
  let verified;
  try {
    for (const batch of batches) probe.exec(batch.statements.map(s => s.sql).join(' '));
    verified = compareSnapshots(expected, readSnapshot(probe));
    const queryResult = JSON.parse(probe.prepare(verificationQuery()).get().migration_snapshot);
    compareSnapshots(expected, queryResult);
  } finally { probe.close(); }
  const manifest = { batchByteLimitExclusive: MAX_BATCH_BYTES, counts: safeCounts(expected), batches: [], localValidation: verified };
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i], filename = String(i + 1).padStart(3, '0') + '-' + batch.phase + '.sql';
    const sql = batch.statements.map(s => s.sql).join(' ');
    ensure(Buffer.byteLength(sql) < MAX_BATCH_BYTES, 'Console batch is too large');
    const rows = {};
    for (const statement of batch.statements) if (statement.table) rows[statement.table] = (rows[statement.table] || 0) + 1;
    await writeFile(path.join(out, filename), sql, { mode: 0o600 });
    manifest.batches.push({ filename, phase: batch.phase, statements: batch.statements.length, bytes: Buffer.byteLength(sql), sha256: sha256(sql), rows });
  }
  const query = verificationQuery();
  await writeFile(path.join(out, 'verification-query.sql'), query, { mode: 0o600 });
  manifest.verificationQuery = { filename: 'verification-query.sql', bytes: Buffer.byteLength(query), sha256: sha256(query) };
  await writeFile(path.join(out, 'manifest.private.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  return manifest;
}

export async function verifyRemoteFile(options) {
  const database = await privateFile(options.database), remoteFile = await privateFile(options.remote);
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const expected = readSnapshot(db);
    const remote = JSON.parse(await readFile(remoteFile, 'utf8'));
    return { ...compareSnapshots(expected, remote), expectedIntegrity: 'ok', expectedForeignKeyViolations: 0 };
  } finally { db.close(); }
}

export function selfTest() {
  const values = ["O'Reilly \"quoted\" \\ slash\r\nnext\tline\0😀 É -- not SQL", '', 'NULL', null, 0, 9007199254740991];
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE cases (id INTEGER PRIMARY KEY,value);');
    const statements = values.map((value, index) => ({ sql: 'INSERT INTO cases(id,value) VALUES(' + index + ',' + consoleLiteral(value) + ');', table: 'cases' }));
    const batches = splitBatches(statements, 240);
    ensure(batches.length > 1, 'Synthetic batch splitting was not exercised');
    for (const batch of batches) db.exec(batch.map(s => s.sql).join(' '));
    const actual = db.prepare('SELECT value FROM cases ORDER BY id').all().map(row => row.value);
    ensure(canonical(actual) === canonical(values), 'Synthetic single-line roundtrip failed');
    ensure(statements.every(s => !/[\r\n]/.test(s.sql) && /^[\x00-\x7f]+$/.test(s.sql)), 'Synthetic SQL contains non-ASCII or line breaks');
    let rejected = false;
    try { splitBatches([{ sql: 'a'.repeat(240), table: null }], 240); } catch { rejected = true; }
    ensure(rejected, 'Oversize single statements must fail');
  } finally { db.close(); }
  return { syntheticSingleLineRoundtrip: 'passed', asciiOnly: true, quoteBackslashNewlineNullUnicodePreserved: true, batchLimitChecked: true };
}

function parseArgs(argv) {
  const [mode, ...rest] = argv, options = {};
  ensure(['build', 'verify', 'self-test'].includes(mode), 'Use build, verify, or self-test');
  for (let i = 0; i < rest.length; i += 2) {
    ensure(['--database', '--schema', '--out-dir', '--remote'].includes(rest[i]) && rest[i + 1] && !rest[i + 1].startsWith('--'), 'Invalid console-tool arguments');
    options[rest[i].slice(2)] = rest[i + 1];
  }
  if (mode === 'build') ensure(options.database && options['out-dir'], 'Build requires --database and --out-dir');
  if (mode === 'verify') ensure(options.database && options.remote, 'Verify requires --database and --remote');
  return { mode, options };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { mode, options } = parseArgs(process.argv.slice(2));
    const result = mode === 'build' ? await buildConsoleArtifacts(options) : mode === 'verify' ? await verifyRemoteFile(options) : selfTest();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Console migration tool failed: ' + (error instanceof ConsoleMigrationError ? error.message : 'Unexpected processing error; no source values printed'));
    process.exitCode = 1;
  }
}
