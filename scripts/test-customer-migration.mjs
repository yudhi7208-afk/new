import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseMysqlDump, sqlStatements } from './mysql-dump.mjs';
import { assertPrivateOutput, buildCustomerSnapshot, canonical, compareWxr, contactIdentity, dataSql, readWxrOrders, validateDatabase } from './prepare-customer-migration.mjs';
const q = String.fromCharCode(96);
const table = name => q + name + q;
const schemaSql = await readFile(new URL('../migrations/0001_customer_data.sql', import.meta.url), 'utf8');

const statements = [...sqlStatements("-- comment;\nCREATE TABLE " + table('t') + " (" + table('id') + " int, " + table('value') + " text); /* hidden ; */ INSERT INTO " + table('t') + " VALUES (1,'a; INSERT INTO x VALUES (9); -- literal'),(2,'b');")];
assert.equal(statements.length, 2, 'Semicolons/comments inside strings must not split statements');
const parsed = parseMysqlDump("CREATE TABLE " + table('t') + " (" + table('id') + " bigint, " + table('value') + " text, " + table('optional') + " text, PRIMARY KEY (" + table('id') + "));\n" +
  "INSERT INTO " + table('t') + " VALUES (0,'quote\\' slash\\\\ newline\\n return\\r tab\\t NUL\\0 utf8 \\\"É😀\\\"',NULL),(2,'a''b; /* literal */', 'a:1:{i:0;s:4:\"x;()\";}');");
assert.deepEqual(parsed.get('t').rows[0], { id: 0, value: 'quote\' slash\\ newline\n return\r tab\t NUL\0 utf8 "É😀"', optional: null });
assert.equal(parsed.get('t').rows[1].optional, 'a:1:{i:0;s:4:"x;()";}');
assert.equal(parsed.get('t').rows[1].value, "a'b; /* literal */");
assert.throws(() => parseMysqlDump('CREATE TABLE t (id bigint); INSERT INTO t VALUES (9007199254740993);'), /safe conversion range/);
assert.throws(() => parseMysqlDump("CREATE TABLE t (v text); INSERT INTO t VALUES (NOW());"), /Unsupported/);
assert.throws(() => parseMysqlDump("CREATE TABLE t (v text); INSERT INTO t VALUES ('unterminated);"), /Unterminated/);
const precise = parseMysqlDump('CREATE TABLE t (v decimal(30,10)); INSERT INTO t VALUES (12345678901234567890.1234567890);');
assert.equal(precise.get('t').rows[0].v, '12345678901234567890.1234567890');
assert.equal(contactIdentity(' Example  Employer ', '0812-0000', 'A@EXAMPLE.TEST', 1).sha256,
  contactIdentity('example employer', '+62 8120000', 'a@example.test', 2).sha256);
assert.notEqual(contactIdentity('Employer A', '0812', '', 1).sha256, contactIdentity('Employer B', '0812', '', 2).sha256);
assert.notEqual(contactIdentity('Employer A', '0812', 'a@example.test', 1).sha256, contactIdentity('Employer A', '0812', 'b@example.test', 2).sha256);
assert.notEqual(contactIdentity('No Contact', '', '', 1).sha256, contactIdentity('No Contact', '', '', 2).sha256);

const posts = [
  { ID: 10, post_type: 'posloker_order', post_status: 'publish', post_date: '2026-01-01 10:00:00', post_date_gmt: '2026-01-01 03:00:00', post_modified: '2026-01-01 10:00:00', post_title: 'Synthetic only' },
  { ID: 11, post_type: 'posloker_order', post_status: 'trash', post_date: '2026-01-02 10:00:00', post_date_gmt: '2026-01-02 03:00:00', post_modified: '2026-01-02 10:00:00', post_title: 'Synthetic archived' },
  { ID: 12, post_type: 'page', post_status: 'publish' },
];
let sequence = 1;
const meta = [];
function add(postId, key, value) { meta.push({ meta_id: sequence++, post_id: postId, meta_key: key, meta_value: value }); }
for (const id of [10, 11]) {
  add(id, '_posloker_customer', 'Synthetic Employer');
  add(id, '_posloker_whatsapp', id === 10 ? '08120000' : '+628120000');
  add(id, '_posloker_email', 'person@example.test');
  add(id, '_posloker_order_number', 'SYNTHETIC-' + id);
  add(id, '_posloker_status', id === 10 ? 'pending' : 'approved');
  add(id, '_posloker_base_amount', id === 10 ? '0' : '10000');
  add(id, '_posloker_unique_code', id === 10 ? '0' : '7');
  add(id, '_posloker_amount', id === 10 ? '0' : '10007');
}
add(10, '_posloker_notes', 'line one\nline two\0');
add(10, '_posloker_notes', 'second value must survive');
add(10, '_posloker_materials', 'a:1:{i:0;a:1:{s:4:"name";s:8:"É😀.jpg";}}');
add(10, '_edit_lock', '1000000000:1');
add(12, 'ignored', 'not an order');
const sourceTables = new Map([['wpjj_posts', { rows: posts }], ['wpjj_postmeta', { rows: meta }]]);
const snapshot = buildCustomerSnapshot(sourceTables, {
  sourceSha256: 'a'.repeat(64), snapshotAt: '2026-01-03T00:00:00.000Z', preparedAt: '2026-01-03T01:00:00.000Z',
});
assert.equal(snapshot.orders.length, 2);
assert.equal(snapshot.customers.length, 1, 'Equivalent complete contact tuples may share a profile');
assert.equal(snapshot.orders[0].amount, 0, 'A free order is not missing data');
assert.equal(snapshot.orders[1].post_status, 'trash');
assert.equal(snapshot.orders[1].amount, 10007);
assert.equal(snapshot.duplicateMetaKeys, 1);
assert.equal(snapshot.orderMeta.filter(row => row.meta_key === '_posloker_notes').length, 2);
const db = new DatabaseSync(':memory:');
db.exec(schemaSql); db.exec(dataSql(snapshot));
assert.equal(validateDatabase(db, snapshot).rowChecksumsVerified, true);
assert.equal(db.prepare('SELECT count(*) AS n FROM order_meta WHERE meta_key = ?').get('_posloker_notes').n, 2);
db.prepare('UPDATE orders SET amount=1 WHERE source_post_id=10').run();
assert.throws(() => validateDatabase(db, snapshot), /checksum/);
db.close();
const missing = new Map([['wpjj_posts', { rows: posts }], ['wpjj_postmeta', { rows: meta.filter(row => !(row.post_id === 10 && row.meta_key === '_posloker_amount')) }]]);
assert.throws(() => buildCustomerSnapshot(missing, { sourceSha256: 'b', snapshotAt: 'x', preparedAt: 'x' }), /Missing or invalid integer/);

const wxr = '<rss xmlns:wp="http://wordpress.org/export/1.2/"><channel>' + snapshot.orders.map(order => {
  const values = snapshot.sourceRows.get(order.source_post_id).meta.filter(row => row.key !== '_edit_lock');
  return '<item><wp:post_id>' + order.source_post_id + '</wp:post_id><wp:status>' + order.post_status + '</wp:status>' +
    values.map(row => '<wp:postmeta><wp:meta_key><![CDATA[' + row.key + ']]></wp:meta_key><wp:meta_value><![CDATA[' +
      row.value.replaceAll(']]>', ']]]]><![CDATA[>') + ']]></wp:meta_value></wp:postmeta>').join('') + '</item>';
}).join('') + '</channel></rss>';
assert.equal(compareWxr(snapshot, readWxrOrders(wxr)), true);
assert.equal(snapshot.orderMeta.filter(row => row.meta_key === '_edit_lock').length, 1, 'WXR exclusion must not drop the source SQL lock metadata');
assert.throws(() => compareWxr(snapshot, readWxrOrders(wxr.replace('SYNTHETIC-10', 'CHANGED-10'))), /metadata differ/);
assert.equal(readWxrOrders('<rss><item><wp:post_id>1</wp:post_id><wp:status>publish</wp:status><wp:postmeta><wp:meta_key>key</wp:meta_key><wp:meta_value><![CDATA[</item>]]]]><![CDATA[> & literal]]></wp:meta_value></wp:postmeta></item></rss>')[0].meta[0].value, '</item>]]> & literal');
assert.throws(() => assertPrivateOutput(fileURLToPath(new URL('../public/secret', import.meta.url))), /outside the repository/);
assert.equal(typeof canonical(snapshot.run), 'string');
console.log('Synthetic migration checks passed: SQL escaping/precision, conservative contact grouping, zero amounts, trash, duplicate metadata, WXR CDATA, checksum corruption detection.');
