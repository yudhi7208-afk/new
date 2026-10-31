import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { parseMysqlDump } from './mysql-dump.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK_OUTPUTS = path.resolve(REPO, '..', '..', 'outputs');
const SCHEMA = path.join(REPO, 'migrations', '0001_customer_data.sql');
const hash = value => createHash('sha256').update(value).digest('hex');
class MigrationPreparationError extends Error {}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const hashed = row => ({ ...row, row_sha256: hash(canonical(row)) });
function ensure(condition, code) { if (!condition) throw new MigrationPreparationError(code); }
function integer(value, field) {
  ensure((typeof value === 'number' && Number.isSafeInteger(value)) ||
    (typeof value === 'string' && /^[+-]?\d+$/.test(value)), 'Missing or invalid integer field: ' + field);
  const result = Number(value);
  ensure(Number.isSafeInteger(result), 'Integer field exceeds safe range: ' + field);
  return result;
}
function normalizedName(value) { return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); }
export function normalizedPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.startsWith('0') ? '62' + digits.slice(1) : digits.startsWith('8') ? '62' + digits : digits;
}
function normalizedEmail(value) { return String(value ?? '').normalize('NFKC').trim().toLowerCase(); }
export function contactIdentity(name, phone, email, sourceId) {
  const identity = { name: normalizedName(name), phone: normalizedPhone(phone), email: normalizedEmail(email) };
  if (!identity.phone && !identity.email) identity.sourceId = sourceId;
  return { identity, sha256: hash(canonical(identity)) };
}

function xmlEntities(value) {
  return value.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (all, hex, dec, named) => {
    if (hex || dec) return String.fromCodePoint(Number.parseInt(hex || dec, hex ? 16 : 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named.toLowerCase()];
  });
}
// A small token reader for WXR validation, including CDATA containing XML-like text.
export function readWxrOrders(xml) {
  const stack = [], result = [];
  let item = null, meta = null;
  const text = value => {
    const name = stack.at(-1);
    if (!item) return;
    if (name === 'wp:post_id') item.id = (item.id || '') + value;
    else if (name === 'wp:status') item.status = (item.status || '') + value;
    else if (meta && name === 'wp:meta_key') meta.key = (meta.key || '') + value;
    else if (meta && name === 'wp:meta_value') meta.value = (meta.value || '') + value;
  };
  for (const token of xml.matchAll(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<[^>]+>|[^<]+/g)) {
    const value = token[0];
    if (value.startsWith('<![CDATA[')) { text(value.slice(9, -3)); continue; }
    if (!value.startsWith('<')) { text(xmlEntities(value)); continue; }
    if (/^<\?|^<!/.test(value)) continue;
    const closing = value.startsWith('</');
    const name = value.match(/^<\/?([^\s/>]+)/)?.[1];
    ensure(Boolean(name), 'Invalid WXR tag');
    if (closing) {
      ensure(stack.pop() === name, 'Unbalanced WXR tags');
      if (name === 'wp:postmeta' && item) { item.meta.push({ key: meta.key || '', value: meta.value || '' }); meta = null; }
      if (name === 'item') { result.push(item); item = null; }
    } else if (!value.endsWith('/>')) {
      stack.push(name);
      if (name === 'item') item = { id: '', status: '', meta: [] };
      if (name === 'wp:postmeta' && item) meta = {};
    }
  }
  ensure(stack.length === 0 && !item, 'Incomplete WXR document');
  return result;
}

export function buildCustomerSnapshot(tables, { prefix = 'wpjj_', sourceSha256, snapshotAt, preparedAt, dumpCompletedAt = null }) {
  const posts = tables.get(prefix + 'posts')?.rows;
  const metadata = tables.get(prefix + 'postmeta')?.rows;
  ensure(Array.isArray(posts) && Array.isArray(metadata), 'Required WordPress tables are missing');
  const selectedPosts = posts.filter(p => p.post_type === 'posloker_order').sort((a, b) => integer(a.ID, 'post ID') - integer(b.ID, 'post ID'));
  ensure(selectedPosts.length > 0, 'No PosLoker orders found');
  const ids = new Set(selectedPosts.map(p => integer(p.ID, 'post ID')));
  ensure(ids.size === selectedPosts.length, 'Duplicate source order IDs');
  const selectedMeta = metadata.map((row, position) => ({ ...row, source_position: position }))
    .filter(row => ids.has(integer(row.post_id, 'meta post ID')))
    .sort((a, b) => integer(a.meta_id, 'meta ID') - integer(b.meta_id, 'meta ID'));
  ensure(new Set(selectedMeta.map(m => integer(m.meta_id, 'meta ID'))).size === selectedMeta.length, 'Duplicate source metadata IDs');
  const byOrder = new Map(selectedPosts.map(p => [integer(p.ID, 'post ID'), []]));
  for (const row of selectedMeta) byOrder.get(integer(row.post_id, 'meta post ID')).push(row);
  const runId = 'wordpress_' + sourceSha256;
  const customers = new Map(), orders = [], orderMeta = [], sourceRows = new Map();
  let duplicateMetaKeys = 0, historicalAmountDiscrepancies = 0;
  for (const post of selectedPosts) {
    const id = integer(post.ID, 'post ID'), meta = byOrder.get(id);
    const first = key => meta.find(m => m.meta_key === key)?.meta_value ?? null;
    const name = first('_posloker_customer'), phone = first('_posloker_whatsapp'), email = first('_posloker_email');
    const identity = contactIdentity(name, phone, email, id);
    const customerId = 'contact_' + identity.sha256;
    if (!customers.has(customerId)) customers.set(customerId, hashed({
      id: customerId, migration_run_id: runId, identity_sha256: identity.sha256,
      display_name: name, whatsapp: phone, email,
      normalized_name: identity.identity.name, normalized_whatsapp: identity.identity.phone,
      normalized_email: identity.identity.email, first_source_post_id: id,
    }));
    const base = integer(first('_posloker_base_amount'), 'base amount');
    const code = integer(first('_posloker_unique_code'), 'unique code');
    const amount = integer(first('_posloker_amount'), 'total amount');
    if (base + code !== amount) historicalAmountDiscrepancies++;
    const rawPost = canonical(post), sourcePostHash = hash(rawPost);
    const order = hashed({
      source_post_id: id, migration_run_id: runId, customer_id: customerId,
      order_number: first('_posloker_order_number'), post_status: post.post_status,
      business_status: first('_posloker_status'), customer_name_original: name,
      whatsapp_original: phone, email_original: email, city: first('_posloker_city'),
      package_id: first('_posloker_package_id'), package_name: first('_posloker_package_name'),
      base_amount: base, unique_code: code, amount,
      ordered_at_local: post.post_date, ordered_at_gmt: post.post_date_gmt,
      modified_at_local: post.post_modified, raw_post_json: rawPost, source_post_sha256: sourcePostHash,
    });
    ensure(typeof order.post_status === 'string' && typeof order.ordered_at_local === 'string' &&
      typeof order.ordered_at_gmt === 'string' && typeof order.modified_at_local === 'string', 'Required source order fields are missing');
    orders.push(order);
    const seen = new Set();
    for (const row of meta) {
      if (seen.has(row.meta_key)) duplicateMetaKeys++;
      seen.add(row.meta_key);
      orderMeta.push(hashed({
        source_meta_id: integer(row.meta_id, 'meta ID'), migration_run_id: runId,
        order_id: id, source_position: row.source_position, meta_key: row.meta_key,
        meta_value: row.meta_value,
      }));
    }
    sourceRows.set(id, { post, meta: meta.map(m => ({ key: m.meta_key, value: m.meta_value })) });
  }
  const customerRows = [...customers.values()].sort((a, b) => a.id.localeCompare(b.id));
  orderMeta.sort((a, b) => a.source_meta_id - b.source_meta_id);
  const rowHashes = {
    customers: customerRows.map(r => [r.id, r.row_sha256]),
    orders: orders.map(r => [r.source_post_id, r.row_sha256]),
    order_meta: orderMeta.map(r => [r.source_meta_id, r.row_sha256]),
  };
  const run = {
    id: runId, source_sha256: sourceSha256, source_prefix: prefix, source_snapshot_at: snapshotAt,
    source_dump_completed_at: dumpCompletedAt, prepared_at: preparedAt, order_count: orders.length,
    contact_profile_count: customerRows.length, meta_count: orderMeta.length, validation_sha256: hash(canonical(rowHashes)),
  };
  return { run, customers: customerRows, orders, orderMeta, rowHashes, sourceRows, duplicateMetaKeys, historicalAmountDiscrepancies };
}

export function compareWxr(snapshot, wxrOrders) {
  ensure(wxrOrders.length === snapshot.orders.length, 'WXR/SQL order counts differ; refresh the source snapshots');
  const seen = new Set();
  for (const item of wxrOrders) {
    const id = integer(item.id, 'WXR post ID');
    ensure(!seen.has(id), 'Duplicate WXR order ID'); seen.add(id);
    const source = snapshot.sourceRows.get(id);
    ensure(Boolean(source), 'WXR/SQL order IDs differ; refresh the source snapshots');
    ensure(item.status === source.post.post_status, 'WXR/SQL post statuses differ');
    // WordPress WXR omits the transient editor lock; retain it in SQL/D1.
    const sorted = values => values.filter(row => row.key !== '_edit_lock').map(canonical).sort();
    ensure(canonical(sorted(item.meta)) === canonical(sorted(source.meta)), 'WXR/SQL metadata differ; refresh the source snapshots');
  }
  return true;
}

export function sqliteLiteral(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') { ensure(Number.isSafeInteger(value), 'Invalid SQLite integer'); return String(value); }
  ensure(typeof value === 'string', 'Unsupported SQLite value type');
  if (value.includes('\0')) return "CAST(X'" + Buffer.from(value).toString('hex') + "' AS TEXT)";
  return "'" + value.replaceAll("'", "''") + "'";
}
export function dataSql(snapshot) {
  const lines = ['-- PRIVATE CUSTOMER DATA: do not commit, publish, or place in public/.'];
  for (const [table, rows] of [['migration_runs', [snapshot.run]], ['customers', snapshot.customers], ['orders', snapshot.orders], ['order_meta', snapshot.orderMeta]]) {
    for (const row of rows) {
      const fields = Object.keys(row);
      const statement = 'INSERT INTO "' + table + '" (' + fields.map(f => '"' + f + '"').join(',') + ') VALUES (' + fields.map(f => sqliteLiteral(row[f])).join(',') + ');';
      ensure(Buffer.byteLength(statement) < 95 * 1024, 'A generated SQL statement exceeds the D1 safety limit');
      lines.push(statement);
    }
  }
  return lines.join('\n') + '\n';
}
function grouped(rows, field) {
  const groups = {};
  for (const row of rows) { const value = row[field] ?? '(missing)'; groups[value] = (groups[value] || 0) + 1; }
  return groups;
}
export function safeSummary(snapshot) {
  const sum = field => {
    const total = snapshot.orders.reduce((n, row) => n + row[field], 0);
    ensure(Number.isSafeInteger(total), 'Aggregate amount exceeds safe range'); return total;
  };
  return {
    orders: snapshot.orders.length, contactProfiles: snapshot.customers.length, orderMeta: snapshot.orderMeta.length,
    postStatuses: grouped(snapshot.orders, 'post_status'), businessStatuses: grouped(snapshot.orders, 'business_status'),
    amounts: { base: sum('base_amount'), uniqueCode: sum('unique_code'), total: sum('amount') },
    duplicateMetaKeys: snapshot.duplicateMetaKeys, historicalAmountDiscrepancies: snapshot.historicalAmountDiscrepancies,
    snapshotAt: snapshot.run.source_snapshot_at,
  };
}
export function validateDatabase(db, snapshot) {
  ensure(db.prepare('PRAGMA quick_check').all().every(row => row.quick_check === 'ok'), 'SQLite integrity check failed');
  ensure(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'Foreign key validation failed');
  for (const [table, expected, key] of [['customers', snapshot.customers, 'id'], ['orders', snapshot.orders, 'source_post_id'], ['order_meta', snapshot.orderMeta, 'source_meta_id']]) {
    const actual = db.prepare('SELECT * FROM "' + table + '"').all();
    ensure(actual.length === expected.length, 'Imported row count differs for ' + table);
    const expectedRows = new Map(expected.map(row => [row[key], canonical(row)]));
    for (const row of actual) {
      const { row_sha256: rowHash, ...content } = row;
      ensure(hash(canonical(content)) === rowHash && expectedRows.get(row[key]) === canonical(row), 'Imported row checksum differs for ' + table);
    }
  }
  for (const order of db.prepare('SELECT raw_post_json,source_post_sha256 FROM orders').all()) {
    ensure(hash(order.raw_post_json) === order.source_post_sha256, 'Source post checksum differs after import');
  }
  const run = db.prepare('SELECT * FROM migration_runs').all();
  ensure(run.length === 1 && canonical(run[0]) === canonical(snapshot.run), 'Migration provenance differs');
  const aggregate = db.prepare('SELECT count(*) AS orders,sum(base_amount) AS base,sum(unique_code) AS uniqueCode,sum(amount) AS total FROM orders').get();
  const summary = safeSummary(snapshot);
  ensure(aggregate.orders === summary.orders && aggregate.base === summary.amounts.base &&
    aggregate.uniqueCode === summary.amounts.uniqueCode && aggregate.total === summary.amounts.total, 'Imported amount totals differ');
  return { quickCheck: 'ok', foreignKeyViolations: 0, rowChecksumsVerified: true, sourcePostChecksumsVerified: true };
}

function inside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
export function assertPrivateOutput(directory) {
  const resolved = path.resolve(directory);
  ensure(!inside(resolved, REPO) && !inside(resolved, TASK_OUTPUTS), 'Customer artifacts must be outside the repository and user-facing outputs');
  return resolved;
}
function args(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    ensure(['--input', '--out-dir', '--prefix', '--wxr', '--snapshot-at'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--'), 'Invalid migration arguments');
    values[argv[i].slice(2)] = argv[i + 1];
  }
  ensure(values.input && values['out-dir'], 'Usage: node scripts/prepare-customer-migration.mjs --input <private.sql> --out-dir <private-directory> [--wxr <private.xml>] [--prefix wpjj_] [--snapshot-at ISO-date]');
  return values;
}
export async function prepareMigration(options) {
  const input = await realpath(path.resolve(options.input));
  let output = assertPrivateOutput(options['out-dir']);
  ensure(!inside(input, REPO) && !inside(input, TASK_OUTPUTS), 'Source customer data must be outside the repository and user-facing outputs');
  const prefix = options.prefix || 'wpjj_';
  ensure(/^[A-Za-z0-9_]+$/.test(prefix), 'Invalid source table prefix');
  const sourceBytes = await readFile(input), source = sourceBytes.toString('utf8');
  const snapshotAt = options['snapshot-at'] || (await stat(input)).mtime.toISOString();
  ensure(Number.isFinite(Date.parse(snapshotAt)), 'Invalid snapshot timestamp');
  let tables;
  try { tables = parseMysqlDump(source, { includeTables: [prefix + 'posts', prefix + 'postmeta'] }); }
  catch { throw new MigrationPreparationError('Source SQL parsing failed; review the private source format'); }
  const snapshot = buildCustomerSnapshot(tables, {
    prefix, sourceSha256: hash(sourceBytes), snapshotAt, preparedAt: new Date().toISOString(),
    dumpCompletedAt: source.match(/^-- Dump completed on (.+)$/m)?.[1]?.trim() || null,
  });
  let wxrCompared = false;
  if (options.wxr) {
    const wxrPath = await realpath(path.resolve(options.wxr));
    ensure(!inside(wxrPath, REPO) && !inside(wxrPath, TASK_OUTPUTS), 'WXR customer data must remain private');
    wxrCompared = compareWxr(snapshot, readWxrOrders(await readFile(wxrPath, 'utf8')));
  }
  const schema = await readFile(SCHEMA, 'utf8'), sql = dataSql(snapshot);
  await mkdir(output, { recursive: true });
  output = assertPrivateOutput(await realpath(output));
  const tempDatabase = path.join(output, '.customer-data-' + randomUUID() + '.sqlite');
  const db = new DatabaseSync(tempDatabase);
  let checks;
  try { db.exec(schema); db.exec(sql); checks = validateDatabase(db, snapshot); } finally { db.close(); }
  const summary = { ...safeSummary(snapshot), ...checks, wxrCompared };
  const manifest = {
    sourceSha256: snapshot.run.source_sha256, runId: snapshot.run.id,
    schemaSha256: hash(schema), dataSqlSha256: hash(sql), validationSha256: snapshot.run.validation_sha256,
    summary, rowHashes: snapshot.rowHashes,
  };
  await writeFile(path.join(output, 'customer-data.sql'), sql, { mode: 0o600 });
  await writeFile(path.join(output, 'schema.sql'), schema);
  await writeFile(path.join(output, 'validation-manifest.private.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  await writeFile(path.join(output, 'summary.safe.json'), JSON.stringify(summary, null, 2) + '\n');
  await rename(tempDatabase, path.join(output, 'customer-data.sqlite'));
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await prepareMigration(args(process.argv.slice(2))), null, 2)); }
  catch (error) {
    const detail = error instanceof MigrationPreparationError ? error.message : 'Unexpected processing error; no source values printed';
    console.error('Migration preparation failed: ' + detail);
    process.exitCode = 1;
  }
}
