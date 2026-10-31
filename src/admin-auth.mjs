const COOKIE_NAME = '__Host-posloker-admin';
const SESSION_SECONDS = 8 * 60 * 60;
const RATE_SECONDS = 15 * 60;
const ITERATIONS = 100000;
const MAX_BODY_BYTES = 4096;
const encoder = new TextEncoder();
const HEX_256 = /^[a-f0-9]{64}$/;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Referrer-Policy': 'no-referrer',
      ...headers,
    },
  });
}

function database(env) {
  if (!env.CUSTOMER_DB?.prepare || !env.CUSTOMER_DB?.batch) {
    throw new HttpError(503, 'Akses admin belum siap.');
  }
  return env.CUSTOMER_DB;
}

function now() { return Math.floor(Date.now() / 1000); }
function hex(bytes) { return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
function unhex(value) {
  if (!HEX_256.test(value)) throw new HttpError(503, 'Konfigurasi admin belum siap.');
  return Uint8Array.from(value.match(/../g), pair => parseInt(pair, 16));
}
function randomToken() { return hex(crypto.getRandomValues(new Uint8Array(32))); }
async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
function sameHash(left, right) {
  if (!HEX_256.test(left) || !HEX_256.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < 64; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: ITERATIONS }, key, 256));
}
function owner(user) { return { id: user.id, email: user.email }; }
function cookie(value, maxAge = SESSION_SECONDS) {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`;
}
function sessionToken(request) {
  const values = (request.headers.get('Cookie') || '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(COOKIE_NAME + '='));
  if (values.length !== 1) return null;
  const token = values[0].slice(COOKIE_NAME.length + 1);
  return HEX_256.test(token) ? token : null;
}

function assertTransport(request) {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new HttpError(403, 'Gunakan HTTPS untuk mengakses admin.');
  }
}

function assertPostOrigin(request) {
  assertTransport(request);
  if (request.method !== 'POST') throw new HttpError(405, 'Metode tidak diizinkan.');
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if (origin !== new URL(request.url).origin || (site && site !== 'same-origin')) {
    throw new HttpError(403, 'Permintaan harus berasal dari halaman admin ini.');
  }
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Gunakan formulir admin yang tersedia.');
  }
}

export function assertMutation(request, session) {
  assertPostOrigin(request);
  const expected = session?.csrfToken ?? session?.session?.csrfToken;
  const submitted = request.headers.get('X-CSRF-Token') || '';
  if (!expected || !sameHash(submitted, expected)) throw new HttpError(403, 'Sesi formulir berakhir. Muat ulang halaman.');
}

async function body(request) {
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    throw new HttpError(413, 'Isian terlalu panjang.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Isian formulir tidak lengkap.');
  let length = 0;
  const chunks = [];
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, 'Isian terlalu panjang.');
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new HttpError(400, 'Isian formulir tidak valid.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Isian formulir tidak valid.');
  return value;
}

function normalizedEmail(email) {
  if (typeof email !== 'string') return null;
  const value = email.trim().toLowerCase();
  return value.length <= 254 && /^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(value) ? value : null;
}

async function rateLimit(request, db) {
  const current = now();
  const window = Math.floor(current / RATE_SECONDS) * RATE_SECONDS;
  const setup = await db.prepare('SELECT token_hash FROM admin_setup WHERE id = 1').first();
  if (!setup || !HEX_256.test(setup.token_hash)) throw new HttpError(503, 'Aktivasi admin belum disiapkan.');
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  const globalKey = await digest('global:' + setup.token_hash);
  const global = await db.prepare('SELECT window_start,attempts FROM admin_rate_limits WHERE bucket_hash=?').bind(globalKey).first();
  if (global && global.window_start === window && global.attempts >= 50) {
    throw new HttpError(429, 'Percobaan masuk dibatasi. Silakan tunggu hingga 15 menit.');
  }
  const buckets = [
    { key: await digest('address:' + setup.token_hash + ':' + address), limit: 5 },
    { key: globalKey, limit: 50 },
  ];
  for (const bucket of buckets) {
    const row = await db.prepare(`INSERT INTO admin_rate_limits(bucket_hash,window_start,attempts) VALUES(?,?,1)
      ON CONFLICT(bucket_hash) DO UPDATE SET
      attempts=CASE WHEN admin_rate_limits.window_start=excluded.window_start THEN admin_rate_limits.attempts+1 ELSE 1 END,
      window_start=excluded.window_start RETURNING attempts`).bind(bucket.key, window).first();
    if (!row || !Number.isSafeInteger(row.attempts) || row.attempts > bucket.limit) {
      throw new HttpError(429, 'Percobaan masuk dibatasi. Silakan tunggu hingga 15 menit.');
    }
  }
  // Bounded housekeeping never resets an active attempt counter.
  await db.prepare('DELETE FROM admin_rate_limits WHERE bucket_hash IN (SELECT bucket_hash FROM admin_rate_limits WHERE window_start < ? LIMIT 100)')
    .bind(window - RATE_SECONDS).run();
}

async function createSession(db, user) {
  const token = randomToken();
  const csrfToken = randomToken();
  const createdAt = now();
  await db.batch([
    db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(createdAt),
    db.prepare('INSERT INTO admin_sessions(token_hash,user_id,csrf_token,created_at,expires_at) VALUES(?,?,?,?,?)')
      .bind(await digest(token), user.id, csrfToken, createdAt, createdAt + SESSION_SECONDS),
  ]);
  return json({ authenticated: true, user: owner(user), csrfToken }, 200, { 'Set-Cookie': cookie(token) });
}

export async function requireAdmin(request, env) {
  assertTransport(request);
  const token = sessionToken(request);
  if (!token) return null;
  const db = database(env);
  const tokenHash = await digest(token);
  const row = await db.prepare(`SELECT u.id,u.email,s.csrf_token,s.expires_at FROM admin_sessions s
    JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(tokenHash, now()).first();
  if (!row) return null;
  if (row.id !== 1 || !HEX_256.test(row.csrf_token) || !Number.isSafeInteger(row.expires_at)) {
    throw new HttpError(503, 'Sesi admin tidak valid.');
  }
  const session = { tokenHash, csrfToken: row.csrf_token, expiresAt: row.expires_at };
  return { user: owner(row), session, csrfToken: session.csrfToken };
}

async function setupOwner(request, db) {
  const input = await body(request);
  await rateLimit(request, db);
  const existing = await db.prepare('SELECT id FROM admin_users WHERE id=1').first();
  if (existing) throw new HttpError(409, 'Admin sudah dibuat. Silakan masuk.');
  const email = normalizedEmail(input.email);
  if (!email || typeof input.password !== 'string' || input.password.length < 15 || input.password.length > 128 ||
    input.password !== input.passwordConfirm) {
    throw new HttpError(400, 'Gunakan email valid dan kata sandi 15–128 karakter yang sama pada kedua isian.');
  }
  if (typeof input.token !== 'string' || !HEX_256.test(input.token)) throw new HttpError(403, 'Tautan aktivasi tidak berlaku.');
  const tokenHash = await digest(input.token);
  const current = now();
  const setup = await db.prepare('SELECT token_hash,expires_at,consumed_at FROM admin_setup WHERE id=1').first();
  if (!setup || setup.consumed_at !== null || setup.expires_at <= current || !sameHash(setup.token_hash, tokenHash)) {
    throw new HttpError(403, 'Tautan aktivasi tidak berlaku atau sudah kedaluwarsa.');
  }
  const salt = randomToken();
  const hash = await passwordHash(input.password, salt);
  const results = await db.batch([
    db.prepare(`INSERT INTO admin_users(id,email,password_salt,password_hash,password_iterations,created_at)
      SELECT 1,?,?,?,?,? FROM admin_setup WHERE id=1 AND token_hash=? AND expires_at>? AND consumed_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM admin_users WHERE id=1) RETURNING id,email`)
      .bind(email, salt, hash, ITERATIONS, current, tokenHash, now()),
    db.prepare(`UPDATE admin_setup SET consumed_at=? WHERE id=1 AND consumed_at IS NULL
      AND EXISTS(SELECT 1 FROM admin_users WHERE id=1 AND email=? AND password_hash=?)`).bind(current, email, hash),
  ]);
  const user = results[0]?.results?.[0];
  if (!user || results[1]?.meta?.changes !== 1) throw new HttpError(409, 'Aktivasi sudah digunakan. Silakan masuk.');
  return createSession(db, user);
}

async function login(request, db) {
  const input = await body(request);
  await rateLimit(request, db);
  const email = normalizedEmail(input.email);
  if (!email || typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 128) {
    throw new HttpError(401, 'Email atau kata sandi tidak benar.');
  }
  const user = await db.prepare('SELECT id,email,password_salt,password_hash,password_iterations FROM admin_users WHERE email=? AND id=1')
    .bind(email).first();
  const salt = user?.password_salt ?? '0'.repeat(64);
  if (user && user.password_iterations !== ITERATIONS) throw new HttpError(503, 'Konfigurasi admin belum siap.');
  const hash = await passwordHash(input.password, salt);
  if (!user || !sameHash(user.password_hash, hash)) throw new HttpError(401, 'Email atau kata sandi tidak benar.');
  return createSession(db, user);
}

export async function handleAuth(request, env, url = new URL(request.url)) {
  if (!['/api/admin/session', '/api/admin/setup', '/api/admin/login', '/api/admin/logout'].includes(url.pathname)) return null;
  assertTransport(request);
  const db = database(env);
  if (url.pathname === '/api/admin/session') {
    if (request.method !== 'GET') throw new HttpError(405, 'Metode tidak diizinkan.');
    const current = await requireAdmin(request, env);
    if (current) return json({ authenticated: true, user: current.user, csrfToken: current.csrfToken, setupRequired: false, setupAvailable: false });
    const configured = await db.prepare('SELECT id FROM admin_users WHERE id=1').first();
    const setup = await db.prepare('SELECT expires_at,consumed_at FROM admin_setup WHERE id=1').first();
    return json({ authenticated: false, setupRequired: !configured, setupAvailable: !configured && Boolean(setup && setup.consumed_at === null && setup.expires_at > now()) });
  }
  assertPostOrigin(request);
  if (url.pathname === '/api/admin/setup') return setupOwner(request, db);
  if (url.pathname === '/api/admin/login') return login(request, db);
  const current = await requireAdmin(request, env);
  if (!current) throw new HttpError(401, 'Silakan masuk kembali.');
  assertMutation(request, current.session);
  await db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(current.session.tokenHash).run();
  return json({ authenticated: false }, 200, { 'Set-Cookie': cookie('', 0) });
}
