import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { buildRecoveryPlan, readOwnerSnapshot, writeRecoveryPlan, readMasked, RECOVERY_AUDIT_PATH, OwnerRecoveryError } from './owner-recovery.mjs';
import { handleAuth, requireAdmin } from '../src/admin-auth.mjs';

// Synthetic identities/passwords/rows and a fresh local runtime only. No
// production snapshot, Cloudflare account, customer data, or network target.
assert.equal(process.argv.length, 2, 'The synthetic recovery test accepts no arguments.');
const originalPassword = 'Synthetic old owner passphrase 2026!';
const newPassword = 'Synthetic new owner passphrase 2026!';
const salt = 'a'.repeat(64);
const owner = { id: 1, email: 'owner@example.test', password_salt: salt,
  password_hash: pbkdf2Sync(originalPassword, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex'), password_iterations: 100000, created_at: 1793491200 };
const options = { password: newPassword, passwordConfirm: newPassword, operator: 'Operator sintetis', reason: 'Latihan pemulihan akses lokal' };
const schemas = await Promise.all(['0003_admin.sql', '0005_checkout.sql', '0006_business_admin.sql'].map(name => readFile(new URL('../migrations/' + name, import.meta.url), 'utf8')));
const originalEvents = [['preserved-event', 'business', '', 1, '{}', '{}', 'Riwayat harus tetap utuh', 1, 1793491201]];
const seedStatements = [
  ['INSERT INTO admin_users VALUES(?,?,?,?,?,?)', Object.values(owner)],
  ['INSERT INTO admin_setup VALUES(1,?,?,?)', ['b'.repeat(64), 1793491201, 1793491200]],
  ['INSERT INTO admin_sessions VALUES(?,?,?,?,?)', ['c'.repeat(64), 1, 'd'.repeat(64), 1793491200, 9999999999]],
  ['INSERT INTO admin_sessions VALUES(?,?,?,?,?)', ['e'.repeat(64), 1, 'f'.repeat(64), 1793491200, 9999999999]],
  ['INSERT INTO business_admin_events VALUES(?,?,?,?,?,?,?,?,?)', originalEvents[0]],
];
function fixture(filename = ':memory:') {
  const db = new DatabaseSync(filename); for (const schema of schemas) db.exec(schema);
  db.exec("CREATE TABLE unrelated_customer_marker(id INTEGER PRIMARY KEY,value TEXT NOT NULL); INSERT INTO unrelated_customer_marker VALUES(1,'SYNTHETIC UNCHANGED');");
  for (const [sql, args] of seedStatements) db.prepare(sql).run(...args);
  return db;
}
const rows = (db, table) => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all().map(row => ({ ...row }));
const preservedTables = ['admin_setup', 'admin_rate_limits', 'commerce_settings', 'business_admin_state', 'page_content', 'unrelated_customer_marker'];
const preserve = db => JSON.stringify(preservedTables.map(table => rows(db, table)));
function apply(db, plan) {
  db.exec('BEGIN IMMEDIATE');
  try { for (const statement of plan.statements) db.prepare(statement).all(); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  execute() {
    const statement = this.db.prepare(this.sql);
    const results = statement.columns().length ? statement.all(...this.values).map(row => ({ ...row })) : (statement.run(...this.values), []);
    return { success: true, results, meta: { changes: this.db.prepare('SELECT changes() n').get().n } };
  }
  async first() { return this.execute().results[0] || null; }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
}
const binding = db => ({ prepare: sql => new Statement(db, sql), async batch(statements) {
  db.exec('BEGIN'); try { const result = statements.map(statement => statement.execute()); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
} });
const loginRequest = password => new Request('https://admin.example.test/api/admin/login', { method: 'POST', headers: { Origin: 'https://admin.example.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: owner.email, password }) });
const base = await mkdtemp(path.join(tmpdir(), 'posloker-owner-recovery-synthetic-'));
const mf = new Miniflare(convertV4MiniflareOptions({ name: 'synthetic-recovery', modules: true, script: 'export default {fetch(){return new Response("local fixture");}}', compatibilityDate: '2026-10-30', d1Databases: ['TEST_DB'] }));
try {
  const plan = buildRecoveryPlan(owner, options);
  assert.equal(plan.statements.length, 5); assert.equal(plan.manifest.ownerId, 1);
  assert.equal(plan.manifest.expiresAt - plan.manifest.preparedAt, 900);
  assert.ok(!plan.sql.includes(newPassword) && !plan.sql.includes(originalPassword) && !JSON.stringify(plan.manifest).includes(owner.password_hash));
  const otherPlan = buildRecoveryPlan(owner, options);
  assert.notEqual(otherPlan.manifest.nextCredentialFingerprint, plan.manifest.nextCredentialFingerprint, 'Each plan generates a new random salt.');
  const db = fixture();
  try {
    const unchanged = preserve(db); apply(db, plan);
    const changed = rows(db, 'admin_users')[0];
    assert.equal(changed.id, owner.id); assert.equal(changed.email, owner.email); assert.equal(changed.created_at, owner.created_at);
    assert.equal(changed.password_hash, pbkdf2Sync(newPassword, Buffer.from(changed.password_salt, 'hex'), 100000, 32, 'sha256').toString('hex'));
    assert.equal(rows(db, 'admin_sessions').length, 0); assert.equal(preserve(db), unchanged);
    assert.deepEqual(rows(db, 'business_admin_events').find(row => row.id === 'preserved-event'), Object.fromEntries(['id','scope','path','admin_id','previous_json','next_json','reason','revision','created_at'].map((key, index) => [key, originalEvents[0][index]])));
    const event = rows(db, 'business_admin_events').find(row => row.id === plan.manifest.operationId);
    assert.equal(event.path, RECOVERY_AUDIT_PATH); assert.equal(event.admin_id, 1); assert.equal(event.revision, 1);
    assert.match(event.reason, /^Pemulihan akses pemilik melalui operator /);
    assert.ok(!event.previous_json.includes(owner.password_hash) && !event.next_json.includes(changed.password_hash) && !event.next_json.includes(changed.password_salt));
    assert.deepEqual({ ...db.prepare(plan.verificationSql).get() }, { audit_recorded: 1, active_owner_sessions: 0, credential_matches: 1 });
    const env = { CUSTOMER_DB: binding(db) };
    await assert.rejects(handleAuth(loginRequest(originalPassword), env), error => error.status === 401);
    const loggedIn = await handleAuth(loginRequest(newPassword), env); assert.equal(loggedIn.status, 200);
    const cookie = loggedIn.headers.get('Set-Cookie').split(';', 1)[0];
    assert.equal((await requireAdmin(new Request('https://admin.example.test/admin/', { headers: { Cookie: cookie } }), env)).user.id, 1);
    // Replaying the old SQL must neither erase the new session nor create a
    // second audit event. A second independently prepared stale plan also fails.
    const sessions = JSON.stringify(rows(db, 'admin_sessions')), events = JSON.stringify(rows(db, 'business_admin_events'));
    for (const stale of [plan, otherPlan]) { assert.throws(() => apply(db, stale), /malformed JSON/); assert.equal(JSON.stringify(rows(db, 'admin_sessions')), sessions); assert.equal(JSON.stringify(rows(db, 'business_admin_events')), events); }
    const beforeSecondRecovery = preserve(db);
    const second = buildRecoveryPlan(changed, { ...options, operator: "Operator'); DELETE FROM admin_users;--" });
    apply(db, second);
    assert.equal(rows(db, 'admin_users').length, 1); assert.equal(rows(db, 'admin_sessions').length, 0);
    assert.equal(rows(db, 'business_admin_events').find(row => row.id === second.manifest.operationId).revision, 2, 'Legitimate later recoveries keep their own monotonic audit history.');
    assert.equal(preserve(db), beforeSecondRecovery, 'Recovery does not edit operational settings/source data.');
  } finally { db.close(); }
  for (const conflict of [
    db => db.prepare('UPDATE admin_users SET email=? WHERE id=1').run('other@example.test'),
    db => db.prepare('UPDATE admin_users SET password_hash=? WHERE id=1').run('f'.repeat(64)),
    db => db.prepare('UPDATE admin_users SET password_salt=? WHERE id=1').run('f'.repeat(64)),
    db => db.prepare('UPDATE admin_users SET created_at=created_at+1 WHERE id=1').run(),
  ]) {
    const db = fixture(); try { conflict(db); const before = JSON.stringify(['admin_users','admin_sessions','business_admin_events'].map(table => rows(db, table))); assert.throws(() => apply(db, plan), /malformed JSON/); assert.equal(JSON.stringify(['admin_users','admin_sessions','business_admin_events'].map(table => rows(db, table))), before); } finally { db.close(); }
  }
  for (const timestamp of [Math.floor(Date.now() / 1000) - 1000, Math.floor(Date.now() / 1000) + 120]) {
    const db = fixture(); try { const timed = buildRecoveryPlan(owner, { ...options, timestamp }); const before = JSON.stringify(['admin_users','admin_sessions','business_admin_events'].map(table => rows(db, table))); assert.throws(() => apply(db, timed), /malformed JSON/); assert.equal(JSON.stringify(['admin_users','admin_sessions','business_admin_events'].map(table => rows(db, table))), before); } finally { db.close(); }
  }
  for (const trigger of [
    "CREATE TRIGGER fail_recovery_update BEFORE UPDATE ON admin_users BEGIN SELECT RAISE(ABORT,'synthetic update failure'); END;",
    "CREATE TRIGGER fail_recovery_delete BEFORE DELETE ON admin_sessions BEGIN SELECT RAISE(ABORT,'synthetic revoke failure'); END;",
    "CREATE TRIGGER ignore_recovery_delete BEFORE DELETE ON admin_sessions BEGIN SELECT RAISE(IGNORE); END;",
  ]) {
    const db = fixture(); try { db.exec(trigger); const before = JSON.stringify(['admin_users','admin_sessions','business_admin_events'].map(table => rows(db, table))); assert.throws(() => apply(db, plan)); assert.equal(JSON.stringify(['admin_users','admin_sessions','business_admin_events'].map(table => rows(db, table))), before, 'Credential/audit/session failures roll back together.'); } finally { db.close(); }
  }
  for (const value of [{ password: 'short' }, { passwordConfirm: 'different password' }, { password: 'x'.repeat(129), passwordConfirm: 'x'.repeat(129) }, { operator: 'x\nunsafe' }, { reason: '<html>' }, { ttlSeconds: 0 }, { ttlSeconds: 3601 }]) assert.throws(() => buildRecoveryPlan(owner, { ...options, ...value }), OwnerRecoveryError);
  for (const value of [{ id: 2 }, { password_iterations: 1 }, { password_hash: 'not-hex' }, { email: 'invalid' }]) assert.throws(() => buildRecoveryPlan({ ...owner, ...value }, options), OwnerRecoveryError);
  const snapshot = path.join(base, 'synthetic.sqlite'); fixture(snapshot).close();
  assert.deepEqual(await readOwnerSnapshot(snapshot), owner);
  await assert.rejects(readOwnerSnapshot(fileURLToPath(new URL('../package.json', import.meta.url))), OwnerRecoveryError);
  await assert.rejects(writeRecoveryPlan(plan, fileURLToPath(new URL('../private/', import.meta.url))), OwnerRecoveryError);
  const destination = await writeRecoveryPlan(plan, base);
  assert.deepEqual((await readdir(destination)).sort(), ['owner-recovery.private.json','owner-recovery.private.sql','verify-owner-recovery.private.sql']);
  assert.equal(await readFile(path.join(destination, 'owner-recovery.private.sql'), 'utf8'), plan.sql);
  if (process.platform !== 'win32') {
    assert.equal((await stat(destination)).mode & 0o777, 0o700);
    for (const name of await readdir(destination)) assert.equal((await stat(path.join(destination, name))).mode & 0o777, 0o600);
  }
  const cli = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./owner-recovery.mjs', import.meta.url)), '--help']);
  assert.match(cli.stdout, /prompt terminal tersamar/);
  await assert.rejects(promisify(execFile)(process.execPath, [fileURLToPath(new URL('./owner-recovery.mjs', import.meta.url)), '--database', snapshot, '--out-dir', base, '--operator', options.operator, '--reason', options.reason]), error => { assert.match(error.stderr, /terminal interaktif privat/); assert.ok(!error.stderr.includes(owner.password_hash) && !error.stderr.includes(originalPassword)); return true; });
  class TtyInput extends EventEmitter { isTTY = true; isRaw = false; paused = true; setRawMode(value) { this.isRaw = value; } isPaused() { return this.paused; } resume() { this.paused = false; } pause() { this.paused = true; } }
  const tty = new TtyInput(), output = { isTTY: true, text: '', write(value) { this.text += value; } };
  const masked = readMasked('Sandi: ', tty, output);
  tty.emit('keypress', 'secret', {}); tty.emit('keypress', '', { name: 'backspace' }); tty.emit('keypress', '!', {}); tty.emit('keypress', '\r', { name: 'return' });
  assert.equal(await masked, 'secre!'); assert.ok(!output.text.includes('secret') && !output.text.includes('!')); assert.equal(tty.isRaw, false); assert.equal(tty.paused, true);
  const cancelled = readMasked('Sandi: ', tty, output); tty.emit('keypress', '', { ctrl: true, name: 'c' }); await assert.rejects(cancelled, OwnerRecoveryError); assert.equal(tty.isRaw, false);

  // Real local D1 batch exercises changes(), JSON failure guards and atomic
  // rollback with the same runtime used by Wrangler, without a live binding.
  const local = await mf.getD1Database('TEST_DB');
  for (const schema of schemas) for (const statement of schema.replace(/^--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean)) await local.prepare(statement).run();
  for (const [sql, args] of seedStatements) await local.prepare(sql).bind(...args).run();
  const actual = await local.batch(plan.statements.map(sql => local.prepare(sql)));
  assert.equal(actual[0].meta.changes, 1); assert.equal(actual[1].meta.changes, 1); assert.equal(actual[3].meta.changes, 2);
  assert.equal((await local.prepare('SELECT COUNT(*) n FROM admin_sessions').first()).n, 0);
  await assert.rejects(local.batch(plan.statements.map(sql => local.prepare(sql))), /malformed JSON/);
  assert.equal((await local.prepare('SELECT COUNT(*) n FROM business_admin_events').first()).n, 2);
  const localOwner = await local.prepare('SELECT * FROM admin_users WHERE id=1').first();
  const failingPlan = buildRecoveryPlan(localOwner, options);
  await local.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?,?)').bind('1'.repeat(64), 1, '2'.repeat(64), 1793491200, 9999999999).run();
  await local.prepare("CREATE TRIGGER fail_recovery_revoke BEFORE DELETE ON admin_sessions BEGIN SELECT RAISE(ABORT,'synthetic local D1 revoke failure'); END").run();
  await assert.rejects(local.batch(failingPlan.statements.map(sql => local.prepare(sql))), /synthetic local D1 revoke failure/);
  assert.equal((await local.prepare('SELECT password_hash FROM admin_users WHERE id=1').first()).password_hash, localOwner.password_hash);
  assert.equal((await local.prepare('SELECT COUNT(*) n FROM admin_sessions').first()).n, 1);
  assert.equal((await local.prepare('SELECT COUNT(*) n FROM business_admin_events').first()).n, 2, 'Real local D1 rolls back audit and credentials when revocation fails.');
  console.log('Synthetic owner-recovery checks passed: masked TTY-only password input, private output permissions, exact identity/CAS and expiry/replay guards, atomic credential/session/audit rollback, preserved identity/history/data, real login compatibility and local D1 batch. No live credentials changed.');
} finally {
  await mf.dispose();
  // The random path is verified before removing only this synthetic fixture.
  const resolved = path.resolve(base), prefix = path.resolve(tmpdir()) + path.sep;
  assert.ok(resolved.startsWith(prefix) && path.basename(resolved).startsWith('posloker-owner-recovery-synthetic-'));
  await rm(resolved, { recursive: true, force: true });
}
