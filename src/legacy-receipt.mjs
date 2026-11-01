import { HttpError } from './admin-auth.mjs';

// Preserve an existing WordPress receipt capability without minting new tokens,
// restoring public file links, or returning the customer's private details.
const encoder = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);
const keyIsValid = value => typeof value === 'string' && value.length >= 16 && value.length <= 256 && /^[\x21-\x7e]+$/.test(value);
async function digest(value) { return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
async function hash(value) { return [...await digest(value)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
async function sameCapability(actual, expected) {
  const [a, b] = await Promise.all([digest(actual), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < 32; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}
function json(value) {
  return new Response(JSON.stringify(value), { headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY',
  } });
}
function transport(request) {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new HttpError(403, 'Gunakan HTTPS untuk membuka ringkasan pesanan.');
  if (request.method !== 'POST') throw new HttpError(405, 'Metode tidak diizinkan.');
  if (request.headers.get('Origin') !== url.origin ||
    (request.headers.has('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin')) throw new HttpError(403, 'Buka tautan pesanan pada website ini.');
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'Permintaan tidak valid.');
}
async function body(request) {
  const limit = 2048, length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new HttpError(413, 'Permintaan terlalu besar.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Tautan pesanan tidak valid.');
  const parts = []; let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, 'Permintaan terlalu besar.'); }
    parts.push(part.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  let input;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new HttpError(400, 'Tautan pesanan tidak valid.'); }
  if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(key => !['orderId','key'].includes(key)) || !keyIsValid(input.key) ||
    !['string','number'].includes(typeof input.orderId) || !/^[1-9]\d{0,14}$/.test(String(input.orderId))) throw new HttpError(400, 'Tautan pesanan tidak valid.');
  const orderId = Number(input.orderId);
  if (!Number.isSafeInteger(orderId)) throw new HttpError(400, 'Tautan pesanan tidak valid.');
  return { orderId, key: input.key };
}
async function limitReads(request, db) {
  const setup = await db.prepare('SELECT token_hash FROM admin_setup WHERE id=1').first();
  if (!setup || !/^[a-f0-9]{64}$/.test(setup.token_hash)) throw new HttpError(503, 'Ringkasan pesanan belum siap.');
  const windowStart = Math.floor(now() / 900) * 900;
  const globalKey = await hash('legacy-receipt:global:' + setup.token_hash);
  const global = await db.prepare('SELECT attempts,window_start FROM checkout_rate_limits WHERE bucket_hash=?').bind(globalKey).first();
  if (global?.window_start === windowStart && global.attempts >= 200) throw new HttpError(429, 'Permintaan dibatasi. Coba lagi setelah beberapa saat.');
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  const addressKey = await hash('legacy-receipt:address:' + setup.token_hash + ':' + address);
  for (const [bucket, limit] of [[addressKey,10],[globalKey,200]]) {
    // A stable bucket is reused across windows. An already limited caller
    // cannot keep writing counters or consume the remaining global budget.
    const counter = await db.prepare(`INSERT INTO checkout_rate_limits(bucket_hash,window_start,attempts) VALUES(?,?,1)
      ON CONFLICT(bucket_hash) DO UPDATE SET attempts=CASE WHEN checkout_rate_limits.window_start=excluded.window_start THEN checkout_rate_limits.attempts+1 ELSE 1 END,window_start=excluded.window_start
      WHERE checkout_rate_limits.window_start<>excluded.window_start OR checkout_rate_limits.attempts<? RETURNING attempts`).bind(bucket, windowStart, limit).first();
    if (!counter || counter.attempts > limit) throw new HttpError(429, 'Permintaan dibatasi. Coba lagi setelah beberapa saat.');
  }
  await db.prepare('DELETE FROM checkout_rate_limits WHERE bucket_hash IN (SELECT bucket_hash FROM checkout_rate_limits WHERE window_start<? LIMIT 100)').bind(windowStart - 900).run();
}

export async function handleLegacyReceipt(request, env, url = new URL(request.url)) {
  if (url.pathname !== '/api/legacy/receipt') return null;
  transport(request);
  const input = await body(request), db = env.CUSTOMER_DB;
  if (!db?.prepare) throw new HttpError(503, 'Ringkasan pesanan belum siap.');
  await limitReads(request, db);
  const row = await db.prepare(`SELECT o.order_number AS number,o.city,o.package_name AS packageName,o.amount,
    COALESCE(s.status,CASE WHEN o.business_status IN ('pending','approved','rejected') THEN o.business_status ELSE 'pending' END) AS status,
    COALESCE(s.post_status,o.post_status) AS postStatus,
    substr((SELECT meta_value FROM order_meta WHERE order_id=o.source_post_id AND meta_key='_posloker_public_token' ORDER BY source_meta_id LIMIT 1),1,257) AS receiptKey
    FROM orders o LEFT JOIN order_admin_state s ON s.order_id=o.source_post_id WHERE o.source_post_id=?`).bind(input.orderId).first();
  const expected = keyIsValid(row?.receiptKey) ? row.receiptKey : 'unavailable-receipt-capability';
  const matched = await sameCapability(input.key, expected);
  if (!row || !keyIsValid(row.receiptKey) || !matched || row.postStatus === 'trash') throw new HttpError(404, 'Tautan pesanan tidak tersedia atau tidak valid.');
  if (!Number.isSafeInteger(row.amount) || row.amount < 0 || !['pending','approved','rejected'].includes(row.status)) throw new HttpError(503, 'Ringkasan pesanan belum siap.');
  return json({ order: { number: row.number, city: row.city, packageName: row.packageName, amount: row.amount, status: row.status } });
}
