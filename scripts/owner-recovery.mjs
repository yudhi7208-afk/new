import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile, chmod, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { emitKeypressEvents } from 'node:readline';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const REPO = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const OUTPUTS = path.resolve(REPO, '..', '..', 'outputs');
const HEX = /^[a-f0-9]{64}$/;
const ITERATIONS = 100000;
export const RECOVERY_AUDIT_PATH = '/operator/owner-recovery';
const sha = value => createHash('sha256').update(value).digest('hex');
const textSql = value => "CAST(X'" + Buffer.from(value, 'utf8').toString('hex') + "' AS TEXT)";
const run = promisify(execFile);

export class OwnerRecoveryError extends Error {}
function ensure(value, message) { if (!value) throw new OwnerRecoveryError(message); }
function privatePath(value) {
  const resolved = path.resolve(value);
  const inside = directory => {
    const relative = path.relative(directory, resolved);
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
  };
  ensure(!inside(REPO) && !inside(OUTPUTS), 'Lokasi privat harus berada di luar repository dan folder outputs.');
  return resolved;
}
function validateOwner(owner) {
  ensure(owner && owner.id === 1 && typeof owner.email === 'string' && owner.email.length <= 254 &&
    /^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(owner.email) &&
    HEX.test(owner.password_salt) && HEX.test(owner.password_hash) && owner.password_iterations === ITERATIONS &&
    Number.isSafeInteger(owner.created_at) && owner.created_at > 0, 'Snapshot pemilik tidak valid atau versi autentikasi tidak didukung.');
}
function label(value, max, name) {
  ensure(typeof value === 'string' && value.trim().length >= 3 && value.length <= max && !/[\u0000-\u001f\u007f<>]/.test(value), name + ' harus berupa teks biasa sepanjang 3–' + max + ' karakter.');
  return value.trim();
}
const fingerprint = owner => sha(owner.password_salt + ':' + owner.password_hash + ':' + owner.password_iterations);

export function buildRecoveryPlan(owner, { password, passwordConfirm, operator, reason, timestamp = Math.floor(Date.now() / 1000), ttlSeconds = 900 } = {}) {
  validateOwner(owner);
  ensure(typeof password === 'string' && password.length >= 15 && password.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(password) && password === passwordConfirm, 'Gunakan kata sandi baru 15–128 karakter yang sama pada kedua isian.');
  operator = label(operator, 100, 'Identitas operator'); reason = label(reason, 300, 'Alasan');
  ensure(Number.isSafeInteger(timestamp) && timestamp > 0 && Number.isSafeInteger(ttlSeconds) && ttlSeconds >= 60 && ttlSeconds <= 3600, 'Masa berlaku pemulihan harus 1–60 menit.');
  const salt = randomBytes(32).toString('hex');
  const hash = pbkdf2Sync(password, Buffer.from(salt, 'hex'), ITERATIONS, 32, 'sha256').toString('hex');
  ensure(hash !== owner.password_hash, 'Kredensial pengganti belum siap.');
  const id = randomUUID(), expiresAt = timestamp + ttlSeconds;
  const previousFingerprint = fingerprint(owner), nextFingerprint = fingerprint({ password_salt: salt, password_hash: hash, password_iterations: ITERATIONS });
  const auditReason = 'Pemulihan akses pemilik melalui operator ' + operator + ': ' + reason;
  ensure(auditReason.length <= 500, 'Catatan audit terlalu panjang.');
  const previous = JSON.stringify({ action: 'owner_recovery', credentialFingerprint: previousFingerprint });
  const next = JSON.stringify({ action: 'owner_recovery', credentialFingerprint: nextFingerprint, operator, preparedAt: timestamp, expiresAt });
  const oldMatch = `id=1 AND email=${textSql(owner.email)} AND password_salt=${textSql(owner.password_salt)} AND password_hash=${textSql(owner.password_hash)} AND password_iterations=${ITERATIONS} AND created_at=${owner.created_at}`;
  const newMatch = `id=1 AND email=${textSql(owner.email)} AND password_salt=${textSql(salt)} AND password_hash=${textSql(hash)} AND password_iterations=${ITERATIONS} AND created_at=${owner.created_at}`;
  const event = `EXISTS(SELECT 1 FROM business_admin_events WHERE id=${textSql(id)} AND scope='business' AND path=${textSql(RECOVERY_AUDIT_PATH)} AND admin_id=1)`;
  const statements = [
    `INSERT INTO business_admin_events(id,scope,path,admin_id,previous_json,next_json,reason,revision,created_at) SELECT ${textSql(id)},'business',${textSql(RECOVERY_AUDIT_PATH)},1,${textSql(previous)},${textSql(next)},${textSql(auditReason)},COALESCE((SELECT MAX(revision) FROM business_admin_events WHERE scope='business' AND path=${textSql(RECOVERY_AUDIT_PATH)}),0)+1,unixepoch() FROM admin_users WHERE ${oldMatch} AND unixepoch()>=${timestamp - 60} AND unixepoch()<=${expiresAt} AND NOT EXISTS(SELECT 1 FROM business_admin_events WHERE id=${textSql(id)})`,
    `UPDATE admin_users SET password_salt=${textSql(salt)},password_hash=${textSql(hash)},password_iterations=${ITERATIONS} WHERE ${oldMatch} AND ${event} AND changes()=1`,
    // A stale/expired/replayed plan must abort the WHOLE D1 batch, not leave a
    // misleading audit event or revoke sessions created by a newer recovery.
    "SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('OWNER_RECOVERY_CONFLICT','$') END AS owner_recovery_guard",
    `DELETE FROM admin_sessions WHERE user_id=1 AND EXISTS(SELECT 1 FROM admin_users WHERE ${newMatch}) AND ${event}`,
    `SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM admin_sessions WHERE user_id=1) AND EXISTS(SELECT 1 FROM admin_users WHERE ${newMatch}) AND ${event} THEN 1 ELSE json_extract('OWNER_RECOVERY_VERIFY_FAILED','$') END AS owner_recovery_verified`,
  ];
  const sql = statements.join(';\n') + ';\n';
  return { statements, sql, verificationSql: `SELECT ${event} AS audit_recorded,(SELECT COUNT(*) FROM admin_sessions WHERE user_id=1) AS active_owner_sessions,EXISTS(SELECT 1 FROM admin_users WHERE ${newMatch}) AS credential_matches;\n`, manifest: {
    format: 'posloker-owner-recovery-v1', operationId: id, ownerId: 1, operator, reason,
    preparedAt: timestamp, expiresAt, previousCredentialFingerprint: previousFingerprint,
    nextCredentialFingerprint: nextFingerprint, sqlSha256: sha(sql),
    requirements: 'Execute every statement in one atomic D1 batch. Never apply statements separately.',
  } };
}

export async function readOwnerSnapshot(filename) {
  const resolved = privatePath(await realpath(privatePath(filename)));
  ensure((await stat(resolved)).isFile(), 'Database snapshot privat tidak ditemukan.');
  const db = new DatabaseSync(resolved, { readOnly: true });
  try {
    // Read authentication identity only; never select customer/order records.
    const owners = db.prepare('SELECT id,email,password_salt,password_hash,password_iterations,created_at FROM admin_users ORDER BY id LIMIT 2').all();
    ensure(owners.length === 1, 'Snapshot harus berisi tepat satu pemilik yang sudah aktif.');
    validateOwner(owners[0]);
    return { ...owners[0] };
  } finally { db.close(); }
}

async function protectDirectory(directory) {
  await chmod(directory, 0o700);
  if (process.platform === 'win32') {
    const identity = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
    const sid = identity.stdout.match(/S-1-(?:\d+-)+\d+/)?.[0];
    ensure(sid, 'Identitas Windows untuk izin berkas tidak ditemukan.');
    // New directory: remove inherited grants before any credential hashes are
    // written. Its files inherit access for this Windows user only.
    await run('icacls.exe', [directory, '/inheritance:r', '/grant:r', '*' + sid + ':(OI)(CI)F'], { windowsHide: true });
  } else ensure(((await stat(directory)).mode & 0o777) === 0o700, 'Izin direktori privat tidak dapat dibatasi.');
}
export async function writeRecoveryPlan(plan, outputDirectory) {
  let base = privatePath(outputDirectory);
  await mkdir(base, { recursive: true, mode: 0o700 });
  base = privatePath(await realpath(base));
  const directory = privatePath(path.join(base, 'owner-recovery-' + plan.manifest.operationId));
  await mkdir(directory, { mode: 0o700 });
  await protectDirectory(directory);
  const files = [['owner-recovery.private.sql', plan.sql], ['verify-owner-recovery.private.sql', plan.verificationSql], ['owner-recovery.private.json', JSON.stringify(plan.manifest, null, 2) + '\n']];
  for (const [name, body] of files) {
    const filename = path.join(directory, name);
    await writeFile(filename, body, { flag: 'wx', mode: 0o600 }); await chmod(filename, 0o600);
    if (process.platform !== 'win32') ensure(((await stat(filename)).mode & 0o777) === 0o600, 'Izin berkas privat tidak dapat dibatasi.');
  }
  return directory;
}

export function readMasked(prompt, input = process.stdin, output = process.stdout) {
  ensure(input.isTTY && output.isTTY && typeof input.setRawMode === 'function', 'Gunakan terminal interaktif privat; kata sandi tidak diterima dari argumen, pipe, atau lingkungan.');
  return new Promise((resolve, reject) => {
    let value = '', finished = false;
    const wasRaw = Boolean(input.isRaw), wasPaused = input.isPaused();
    emitKeypressEvents(input); output.write(prompt); input.setRawMode(true); input.resume();
    function finish(error) {
      if (finished) return; finished = true;
      input.removeListener('keypress', onKey); input.setRawMode(wasRaw);
      if (wasPaused) input.pause(); output.write('\n');
      if (error) { value = ''; reject(error); } else resolve(value);
    }
    function onKey(character, key = {}) {
      if ((key.ctrl && ['c', 'd'].includes(key.name)) || key.name === 'escape') return finish(new OwnerRecoveryError('Pemulihan dibatalkan sebelum artefak dibuat.'));
      if (['return', 'enter'].includes(key.name)) return finish();
      if (key.name === 'backspace') {
        if (value) { const characters = [...value]; characters.pop(); value = characters.join(''); output.write('\b \b'); }
        return;
      }
      if (!character || key.ctrl || key.meta || /[\u0000-\u001f\u007f]/.test(character) || character.startsWith('\u001b') || value.length + character.length > 128) return;
      value += character; output.write('*'.repeat([...character].length));
    }
    input.on('keypress', onKey);
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('node scripts/owner-recovery.mjs --database PRIVATE.sqlite --out-dir PRIVATE_DIR --operator LABEL --reason REASON\nKata sandi baru dimasukkan dua kali melalui prompt terminal tersamar. Alat hanya membuat SQL privat; tidak menghubungi atau menulis Cloudflare.'); return;
  }
  const options = new Map();
  ensure(args.length === 8, 'Gunakan --database, --out-dir, --operator, dan --reason; jangan memasukkan kata sandi pada argumen.');
  for (let i = 0; i < args.length; i += 2) {
    ensure(['--database', '--out-dir', '--operator', '--reason'].includes(args[i]) && args[i + 1] && !options.has(args[i]), 'Argumen pemulihan tidak valid.');
    options.set(args[i], args[i + 1]);
  }
  ensure(process.stdin.isTTY && process.stdout.isTTY, 'Gunakan terminal interaktif privat; kata sandi tidak diterima dari argumen, pipe, atau lingkungan.');
  const owner = await readOwnerSnapshot(options.get('--database'));
  let password = '', passwordConfirm = '';
  try {
    password = await readMasked('Kata sandi BARU pemilik (15–128 karakter): ');
    passwordConfirm = await readMasked('Ulangi kata sandi baru: ');
    const plan = buildRecoveryPlan(owner, { password, passwordConfirm, operator: options.get('--operator'), reason: options.get('--reason') });
    password = ''; passwordConfirm = '';
    const directory = await writeRecoveryPlan(plan, options.get('--out-dir'));
    console.log('Artefak pemulihan privat dibuat di: ' + directory + '\nBerlaku 15 menit. Belum ada perubahan pada akun atau Cloudflare. Terapkan seluruh SQL dalam SATU batch atomik sesuai docs/owner-recovery.md.');
  } finally { password = ''; passwordConfirm = ''; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof OwnerRecoveryError ? error.message : 'Persiapan pemulihan gagal; nilai kredensial dan detail database tidak dicetak.'); process.exitCode = 1; });
}
