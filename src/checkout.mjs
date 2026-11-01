import { HttpError, requireAdmin } from './admin-auth.mjs';

// Public checkout contains no source customer data or runtime settings.
const COOKIE = '__Host-posloker-checkout';
const HOUR = 3600;
const MIB = 1024 * 1024;
const MATERIAL_BYTES = 10 * MIB;
const BODY_BYTES = 20 * MIB + 128 * 1024;
const TOKEN = /^[a-f0-9]{64}$/;
const ORDER_ID = /^cf_[a-f0-9]{32}$/;
const QUOTE_ID = /^quote_[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const enc = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);
const random = (bytes = 32) => [...crypto.getRandomValues(new Uint8Array(bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof bytes === 'string' ? enc.encode(bytes) : bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
const rows = result => result?.results || [];
function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive', ...extra,
  } });
}
function database(env) {
  if (!env.CUSTOMER_DB?.prepare || !env.CUSTOMER_DB?.batch) throw new HttpError(503, 'Pemesanan belum siap.');
  return env.CUSTOMER_DB;
}
function transport(request) {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new HttpError(403, 'Gunakan HTTPS untuk melanjutkan.');
}
function origin(request) {
  transport(request);
  if (request.method !== 'POST') throw new HttpError(405, 'Metode tidak diizinkan.');
  if (request.headers.get('Origin') !== new URL(request.url).origin ||
    (request.headers.has('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin')) throw new HttpError(403, 'Muat formulir pada website ini.');
}
function csrf(value, session) {
  if (typeof value !== 'string' || !TOKEN.test(value) || value !== session.csrf_token) throw new HttpError(403, 'Sesi formulir berakhir. Muat ulang halaman.');
}
async function readBody(request, limit) {
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new HttpError(413, 'Ukuran formulir terlalu besar.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Formulir belum lengkap.');
  const chunks = []; let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, 'Ukuran formulir terlalu besar.'); }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
async function readJson(request) {
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim() !== 'application/json') throw new HttpError(415, 'Formulir tidak valid.');
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 4096)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Formulir tidak valid.'); }
}
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (required && !value.trim())) throw new HttpError(400, 'Isian formulir tidak valid atau terlalu panjang.');
  return value.trim();
}
function simpleText(value, max, required = false) {
  const clean = text(value, max, required);
  if (/[\r\n]/.test(clean)) throw new HttpError(400, 'Isian formulir tidak valid.');
  return clean;
}
function phone(value) {
  const original = simpleText(value, 30, true);
  if (!/^[+\d\s()-]+$/.test(original)) throw new HttpError(400, 'Nomor WhatsApp tidak valid.');
  let number = original.replace(/\D/g, '');
  if (number.startsWith('0')) number = '62' + number.slice(1);
  else if (number.startsWith('8')) number = '62' + number;
  if (!/^\d{10,15}$/.test(number)) throw new HttpError(400, 'Nomor WhatsApp tidak valid.');
  return number;
}
function email(value) {
  const clean = simpleText(value, 254);
  if (clean && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new HttpError(400, 'Alamat email tidak valid.');
  return clean;
}
async function config(db) {
  const entries = rows(await db.prepare('SELECT key,value_json FROM commerce_settings').all());
  const map = new Map();
  try { for (const row of entries) map.set(row.key, JSON.parse(row.value_json)); }
  catch { throw new HttpError(503, 'Pengaturan pemesanan belum siap.'); }
  const catalog = map.get('catalog_json'), payout = map.get('payout_json'), mode = map.get('mode') ?? 'preview';
  if (!catalog || !Array.isArray(catalog.cities) || !catalog.cities.length || !catalog.pricing || typeof catalog.pricing !== 'object' ||
    !payout || !['preview', 'live'].includes(mode)) throw new HttpError(503, 'Pengaturan pemesanan belum siap.');
  for (const city of catalog.cities) {
    if (!city || typeof city.name !== 'string' || typeof city.pricingKey !== 'string') throw new HttpError(503, 'Daftar paket belum siap.');
    const packages = cityPackages(catalog, city);
    if (!Array.isArray(packages)) throw new HttpError(503, 'Daftar paket belum siap.');
    if (!packages.length || new Set(packages.map(item => item.id)).size !== packages.length || packages.some(item => !item ||
      typeof item.id !== 'string' || typeof item.name !== 'string' || !Number.isSafeInteger(item.price) || item.price < 0 || item.price > 1000000000 ||
      !Array.isArray(item.features) || item.features.some(feature => typeof feature !== 'string'))) throw new HttpError(503, 'Daftar paket belum siap.');
  }
  if (new Set(catalog.cities.map(city => city.name)).size !== catalog.cities.length ||
    ['bankName','bankAccount','bankHolder','whatsapp'].some(key => typeof payout[key] !== 'string') || !/^\d{10,15}$/.test(payout.whatsapp)) throw new HttpError(503, 'Pengaturan pembayaran belum siap.');
  const uploadMb = payout.maxUploadMb ?? 10;
  if (!Number.isSafeInteger(uploadMb) || uploadMb < 1 || uploadMb > 10) throw new HttpError(503, 'Batas unggahan belum siap.');
  return { catalog, payout, preview: mode !== 'live', limits: { proofMaxBytes: uploadMb * MIB, materialsMaxBytes: MATERIAL_BYTES, materialsMaxFiles: 10, videoMaxBytes: MATERIAL_BYTES } };
}
function cityPackages(catalog, city) {
  // WordPress uses the default tariff when a city has no dedicated price table.
  return Object.hasOwn(catalog.pricing, city.pricingKey) ? catalog.pricing[city.pricingKey]
    : Object.hasOwn(catalog.pricing, 'default') ? catalog.pricing.default : null;
}
async function rate(request, db, scope, ipLimit, globalLimit) {
  const setup = await db.prepare('SELECT token_hash FROM admin_setup WHERE id=1').first();
  if (!setup || !TOKEN.test(setup.token_hash)) throw new HttpError(503, 'Pemesanan belum siap.');
  const window = Math.floor(now() / 900) * 900;
  const globalKey = await sha(scope + ':global:' + setup.token_hash);
  const global = await db.prepare('SELECT attempts,window_start FROM checkout_rate_limits WHERE bucket_hash=?').bind(globalKey).first();
  if (global?.window_start === window && global.attempts >= globalLimit) throw new HttpError(429, 'Permintaan sedang dibatasi. Coba lagi setelah beberapa saat.');
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  for (const [key, limit] of [[await sha(scope + ':address:' + setup.token_hash + ':' + address), ipLimit], [globalKey, globalLimit]]) {
    const counter = await db.prepare(`INSERT INTO checkout_rate_limits(bucket_hash,window_start,attempts) VALUES(?,?,1)
      ON CONFLICT(bucket_hash) DO UPDATE SET attempts=CASE WHEN checkout_rate_limits.window_start=excluded.window_start THEN checkout_rate_limits.attempts+1 ELSE 1 END,
      window_start=excluded.window_start RETURNING attempts`).bind(key, window).first();
    if (!counter || counter.attempts > limit) throw new HttpError(429, 'Permintaan sedang dibatasi. Coba lagi setelah beberapa saat.');
  }
  await db.prepare('DELETE FROM checkout_rate_limits WHERE bucket_hash IN (SELECT bucket_hash FROM checkout_rate_limits WHERE window_start<? LIMIT 100)').bind(window - 900).run();
}
async function sessionOf(request, db) {
  const candidates = (request.headers.get('Cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(COOKIE + '='));
  if (candidates.length !== 1) return null;
  const raw = candidates[0].slice(COOKIE.length + 1);
  if (!TOKEN.test(raw)) return null;
  return db.prepare('SELECT token_hash,csrf_token,expires_at FROM checkout_sessions WHERE token_hash=? AND expires_at>?').bind(await sha(raw), now()).first();
}
async function getSession(request, env, db, settings) {
  let session = await sessionOf(request, db); let cookie;
  if (!session) {
    await rate(request, db, 'session', 20, 500);
    const raw = random();
    session = { token_hash: await sha(raw), csrf_token: random(), expires_at: now() + HOUR };
    await db.prepare('INSERT INTO checkout_sessions(token_hash,csrf_token,created_at,expires_at) VALUES(?,?,?,?)').bind(session.token_hash, session.csrf_token, now(), session.expires_at).run();
    cookie = `${COOKIE}=${raw}; Path=/; Max-Age=${HOUR}; Secure; HttpOnly; SameSite=Strict`;
  }
  return json({ csrfToken: session.csrf_token, catalog: settings.catalog, payment: {
    bankName: settings.payout.bankName, bankAccount: settings.payout.bankAccount, bankHolder: settings.payout.bankHolder,
    whatsapp: settings.payout.whatsapp, limits: settings.limits,
  }, preview: settings.preview, canSubmit: !settings.preview || Boolean(await requireAdmin(request, env)) }, 200, cookie ? { 'Set-Cookie': cookie } : {});
}
function selectedPackage(settings, cityName, packageId) {
  const city = settings.catalog.cities.find(city => city.name === cityName);
  const selected = city && cityPackages(settings.catalog, city)?.find(item => item.id === packageId);
  if (!selected) throw new HttpError(400, 'Kota atau paket tidak valid.');
  return selected;
}
function quoteDto(quote) {
  return { id: quote.id, city: quote.city, packageId: quote.package_id, packageName: quote.package_name, baseAmount: quote.base_amount, uniqueCode: quote.unique_code, amount: quote.amount, expiresAt: quote.expires_at };
}
async function createQuote(request, db, session, settings) {
  csrf(request.headers.get('X-CSRF-Token'), session);
  const input = await readJson(request);
  if (Object.keys(input).some(key => !['city','packageId'].includes(key))) throw new HttpError(400, 'Pilihan paket tidak valid.');
  const city = simpleText(input.city, 100, true), packageId = simpleText(input.packageId, 100, true);
  const selected = selectedPackage(settings, city, packageId);
  await rate(request, db, 'quote', 20, 200);
  const starting = crypto.getRandomValues(new Uint8Array(1))[0] % 99;
  for (let attempt = 0; attempt < (selected.price ? 99 : 1); attempt++) {
    const unique = selected.price ? (starting + attempt) % 99 + 1 : 0;
    const quote = { id: 'quote_' + random(16), city, package_id: selected.id, package_name: selected.name,
      base_amount: selected.price, unique_code: unique, amount: selected.price + unique, expires_at: Math.min(now() + HOUR, session.expires_at) };
    const statements = [db.prepare(`INSERT INTO checkout_quotes(id,session_hash,city,package_id,package_name,features_json,payout_json,base_amount,unique_code,amount,is_test,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(quote.id, session.token_hash, city, selected.id, selected.name, JSON.stringify(selected.features), JSON.stringify(settings.payout), selected.price, unique, quote.amount, settings.preview ? 1 : 0, now(), quote.expires_at)];
    if (selected.price) {
      const slot = (settings.preview ? 'preview:' : 'live:') + quote.amount;
      statements.unshift(db.prepare('DELETE FROM checkout_code_reservations WHERE slot_key=? AND expires_at<=?').bind(slot, now()));
      statements.push(db.prepare('INSERT INTO checkout_code_reservations(slot_key,quote_id,expires_at) VALUES(?,?,?)').bind(slot, quote.id, quote.expires_at));
    }
    try { await db.batch(statements); return json({ quote: quoteDto(quote), preview: settings.preview }); }
    catch (error) {
      if (selected.price && String(error?.message || '').includes('checkout_code_reservations.slot_key')) continue;
      throw error;
    }
  }
  throw new HttpError(409, 'Kode pembayaran sedang penuh. Silakan coba lagi nanti.');
}
function fileType(bytes) {
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['image/jpeg', 'jpg'];
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value) && ascii(12,16) === 'IHDR') return ['image/png','png'];
  if (bytes.length >= 20 && ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP' && ['VP8 ','VP8L','VP8X'].includes(ascii(12,16))) return ['image/webp','webp'];
  if (bytes.length >= 12 && ascii(0,5) === '%PDF-' && ascii(Math.max(0,bytes.length - 1024),bytes.length).includes('%%EOF')) return ['application/pdf','pdf'];
  if (bytes.length >= 24 && ascii(4,8) === 'ftyp') {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (size >= 16 && size <= bytes.length && /^(isom|iso[2-6]|mp4[12]|avc1|dash|M4V |MSNV)$/.test(ascii(8,12))) return ['video/mp4','mp4'];
  }
  throw new HttpError(400, 'Jenis atau isi berkas tidak sesuai. Gunakan JPG, PNG, WebP, PDF, atau video MP4 yang diizinkan.');
}
function isFile(value) { return value && typeof value !== 'string' && typeof value.arrayBuffer === 'function' && typeof value.name === 'string'; }
function cleanFileName(name) { return name.replace(/[\r\n\u0000-\u001f\u007f/\\]/g, '_').slice(0,180) || 'berkas'; }
async function checkedFile(file, kind, position, max, video = false) {
  if (!isFile(file) || file.size < 1 || file.size > max) throw new HttpError(400, 'Berkas kosong atau melewati batas ukuran.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) throw new HttpError(400, 'Berkas tidak lengkap.');
  const [mime, extension] = fileType(bytes);
  const sourceExtension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if ((video ? mime !== 'video/mp4' : mime === 'video/mp4') ||
    !((extension === 'jpg' && ['jpg','jpeg'].includes(sourceExtension)) || sourceExtension === extension) ||
    (file.type && file.type.toLowerCase() !== mime)) throw new HttpError(400, 'Ekstensi, jenis, dan isi berkas harus sesuai.');
  return { id: 'cf_file_' + random(16), kind, position, originalName: cleanFileName(file.name), mime, extension, bytes, sha256: await sha(bytes) };
}
async function readForm(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!/^multipart\/form-data\s*;/i.test(type)) throw new HttpError(415, 'Gunakan formulir unggahan yang tersedia.');
  try { return await new Response(await readBody(request, BODY_BYTES), { headers: { 'Content-Type': type } }).formData(); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Formulir unggahan tidak valid.'); }
}
function formValue(form, key, max, required = false) {
  const values = form.getAll(key);
  if (values.length > 1 || values.some(value => typeof value !== 'string')) throw new HttpError(400, 'Isian formulir berulang atau tidak valid.');
  return text(values[0] ?? '', max, required);
}
function singleFile(form, key) {
  const values = form.getAll(key).filter(file => !(isFile(file) && file.size === 0 && !file.name));
  if (values.length > 1 || values.some(value => !isFile(value))) throw new HttpError(400, 'Berkas tidak valid.');
  return values[0] ?? null;
}
async function validateFiles(form, quote, limits) {
  const proof = singleFile(form, 'proof'), video = singleFile(form, 'video');
  const materials = form.getAll('materials').filter(file => !(isFile(file) && file.size === 0 && !file.name));
  if (materials.some(file => !isFile(file)) || materials.length + (video ? 1 : 0) > 10 ||
    materials.reduce((sum, file) => sum + file.size, 0) + (video?.size || 0) > MATERIAL_BYTES) throw new HttpError(400, 'Materi dan video maksimal 10 berkas dengan total 10 MB.');
  if (quote.base_amount > 0 && !proof) throw new HttpError(400, 'Bukti transfer wajib dipilih.');
  if (video && quote.package_id !== 'komplit-plus') throw new HttpError(400, 'Video MP4 hanya untuk paket Komplit PLUS.');
  const checked = [];
  if (proof) checked.push(await checkedFile(proof, 'proof', 0, limits.proofMaxBytes));
  for (let index = 0; index < materials.length; index++) checked.push(await checkedFile(materials[index], 'material', index, MATERIAL_BYTES));
  if (video) checked.push(await checkedFile(video, 'material', materials.length, MATERIAL_BYTES, true));
  return checked;
}
function receiptOrder(order) {
  return { id: order.id, orderNumber: order.order_number, status: order.status, city: order.city, packageName: order.package_name, amount: order.amount, isTest: Boolean(order.is_test) };
}
function whatsappUrl(order, payout) {
  const message = [order.is_test ? 'SIMULASI POSLOKER — jangan transfer.' : 'Konfirmasi pesanan PosLoker.',
    'Pesanan: ' + order.order_number, 'Kota: ' + order.city, 'Paket: ' + order.package_name,
    'Total: Rp' + order.amount.toLocaleString('id-ID'), 'Mohon periksa melalui panel admin.'].join('\n');
  return 'https://wa.me/' + payout.whatsapp + '?text=' + encodeURIComponent(message);
}
async function receipt(db, session, id) {
  const order = await db.prepare('SELECT o.*,q.payout_json FROM commerce_orders o JOIN checkout_quotes q ON q.id=o.quote_id WHERE o.id=? AND o.session_hash=?').bind(id, session.token_hash).first();
  if (!order) throw new HttpError(404, 'Pesanan tidak ditemukan pada sesi ini.');
  return json({ order: receiptOrder(order), whatsappUrl: whatsappUrl(order, JSON.parse(order.payout_json)) });
}
function jakartaDate(seconds) { return new Date(seconds * 1000 + 7 * 3600000).toISOString().slice(0,19).replace('T',' '); }
async function previousSubmission(db, session, key, quoteId) {
  return db.prepare('SELECT claim_id,state,order_id FROM checkout_submissions WHERE session_hash=? AND (idempotency_key=? OR quote_id=?) LIMIT 1').bind(session.token_hash, key, quoteId).first();
}
async function removeOwnUploads(env, keys) {
  let complete = true;
  for (const key of keys) { try { await env.CUSTOMER_FILES.delete(key); } catch { complete = false; } }
  return complete;
}
async function submit(request, env, db, session, settings) {
  await rate(request, db, 'submit', 5, 50);
  const form = await readForm(request);
  const allowed = ['quoteId','csrfToken','idempotencyKey','customerName','whatsapp','email','adText','caption','notes','proof','materials','video','consent','website'];
  if ([...form.keys()].some(key => !allowed.includes(key))) throw new HttpError(400, 'Isian formulir tidak diizinkan.');
  csrf(formValue(form, 'csrfToken', 64, true), session);
  if (request.headers.has('X-CSRF-Token')) csrf(request.headers.get('X-CSRF-Token'), session);
  const quoteId = formValue(form, 'quoteId', 38, true), idempotency = formValue(form, 'idempotencyKey', 36, true);
  if (!QUOTE_ID.test(quoteId) || !UUID.test(idempotency)) throw new HttpError(400, 'Sesi pesanan tidak valid.');
  const old = await previousSubmission(db, session, idempotency, quoteId);
  if (old) {
    if (old.state === 'complete') return receipt(db, session, old.order_id);
    throw new HttpError(409, 'Pesanan sedang disimpan. Tunggu sebentar lalu coba kembali.');
  }
  const quote = await db.prepare('SELECT * FROM checkout_quotes WHERE id=? AND session_hash=? AND expires_at>? AND consumed_at IS NULL').bind(quoteId, session.token_hash, now()).first();
  if (!quote || Boolean(quote.is_test) !== settings.preview) throw new HttpError(410, 'Pilihan pesanan berakhir atau berubah. Pilih paket kembali.');
  if (formValue(form, 'consent', 10, true) !== '1' || formValue(form, 'website', 200)) throw new HttpError(400, 'Periksa persetujuan dan isian formulir.');
  const customerName = simpleText(formValue(form, 'customerName', 120, true), 120, true);
  const whatsapp = phone(formValue(form, 'whatsapp', 30, true)), contactEmail = email(formValue(form, 'email', 254));
  const adText = formValue(form, 'adText', 2000), caption = formValue(form, 'caption', 500), notes = formValue(form, 'notes', 500);
  const files = await validateFiles(form, quote, settings.limits);
  if (!env.CUSTOMER_FILES?.put || !env.CUSTOMER_FILES?.delete) throw new HttpError(503, 'Penyimpanan berkas belum siap.');
  const claimId = random(16), orderId = 'cf_' + random(16), timestamp = now();
  const claim = await db.prepare(`INSERT INTO checkout_submissions(session_hash,idempotency_key,quote_id,claim_id,state,created_at)
    SELECT ?,?,?,?,'processing',? FROM checkout_quotes WHERE id=? AND session_hash=? AND expires_at>? AND consumed_at IS NULL
    ON CONFLICT DO NOTHING RETURNING claim_id`).bind(session.token_hash, idempotency, quoteId, claimId, timestamp, quoteId, session.token_hash, now()).first();
  if (!claim || claim.claim_id !== claimId) {
    const concurrent = await previousSubmission(db, session, idempotency, quoteId);
    if (concurrent?.state === 'complete') return receipt(db, session, concurrent.order_id);
    if (concurrent) throw new HttpError(409, 'Pesanan sedang disimpan. Tunggu sebentar lalu coba kembali.');
    throw new HttpError(410, 'Sesi pesanan berakhir. Pilih paket kembali.');
  }
  const uploaded = []; let persistenceAttempted = false;
  try {
    for (const file of files) {
      file.key = `private/commerce/${orderId}/${file.id}.${file.extension}`;
      // Remember before put: a storage write may succeed before its response is interrupted.
      uploaded.push(file.key);
      await env.CUSTOMER_FILES.put(file.key, file.bytes, { httpMetadata: { contentType: file.mime }, customMetadata: { sha256: file.sha256 } });
    }
    const localDate = jakartaDate(timestamp), month = localDate.slice(0,7).replace('-','');
    const number = (quote.is_test ? 'CF-TEST-' : 'CF-') + month + '-' + orderId.slice(3,19).toUpperCase();
    const statements = [db.prepare(`INSERT INTO commerce_orders(id,order_number,quote_id,session_hash,idempotency_key,customer_name,whatsapp,email,city,package_id,package_name,features_json,base_amount,unique_code,amount,ad_text,caption,notes,status,post_status,ordered_at_local,created_at,revision,admin_note,updated_at,is_test)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','publish',?,?,0,'',?,? FROM checkout_quotes
      WHERE id=? AND session_hash=? AND expires_at>? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM checkout_submissions WHERE claim_id=? AND state='processing') RETURNING id`)
      .bind(orderId, number, quoteId, session.token_hash, idempotency, customerName, whatsapp, contactEmail, quote.city, quote.package_id, quote.package_name, quote.features_json,
        quote.base_amount, quote.unique_code, quote.amount, adText, caption, notes, localDate, timestamp, timestamp, quote.is_test, quoteId, session.token_hash, now(), claimId)];
    for (const file of files) statements.push(db.prepare(`INSERT INTO commerce_files(id,order_id,kind,position,original_name,mime,storage_key,sha256,byte_count,created_at)
      SELECT ?,id,?,?,?,?,?,?,?,? FROM commerce_orders WHERE id=?`).bind(file.id, file.kind, file.position, file.originalName, file.mime, file.key, file.sha256, file.bytes.length, timestamp, orderId));
    statements.push(db.prepare(`INSERT INTO commerce_events(id,order_id,admin_id,action,previous_status,status,previous_note,note,reason,revision,created_at)
      SELECT ?,id,NULL,'created','','pending','','',?,0,? FROM commerce_orders WHERE id=?`).bind(crypto.randomUUID(), quote.is_test ? 'Pesanan simulasi dibuat' : 'Pesanan baru dibuat', timestamp, orderId));
    statements.push(db.prepare('UPDATE checkout_quotes SET consumed_at=? WHERE id=? AND EXISTS(SELECT 1 FROM commerce_orders WHERE id=?)').bind(timestamp, quoteId, orderId));
    statements.push(db.prepare('UPDATE checkout_code_reservations SET expires_at=? WHERE quote_id=? AND EXISTS(SELECT 1 FROM commerce_orders WHERE id=?)').bind(timestamp + 24 * HOUR, quoteId, orderId));
    statements.push(db.prepare("UPDATE checkout_submissions SET state='complete',order_id=? WHERE claim_id=? AND state='processing' AND EXISTS(SELECT 1 FROM commerce_orders WHERE id=?)").bind(orderId, claimId, orderId));
    persistenceAttempted = true;
    const saved = await db.batch(statements);
    if (rows(saved[0])[0]?.id !== orderId || saved.at(-1)?.meta?.changes !== 1) throw new HttpError(410, 'Sesi pesanan berakhir sebelum tersimpan. Pilih paket kembali.');
    return receipt(db, session, orderId);
  } catch (error) {
    if (persistenceAttempted) {
      // Do not destroy files after an ambiguous commit. A same-key retry can recover it.
      let saved;
      try { saved = await db.prepare('SELECT state,order_id FROM checkout_submissions WHERE claim_id=?').bind(claimId).first(); }
      catch { throw new HttpError(503, 'Status penyimpanan belum dapat dipastikan. Coba kembali dengan formulir yang sama.'); }
      if (saved?.state === 'complete' && saved.order_id === orderId) return receipt(db, session, orderId);
      if (!saved || saved.state !== 'processing') throw new HttpError(503, 'Status penyimpanan perlu diperiksa. Jangan membuat pesanan lain dahulu.');
    }
    const cleanupClaimId = random(16);
    let cancelled;
    try {
      // Rotating the nonce atomically revokes every still-pending writer's old
      // claim without opening a gap for a second upload of the same quote.
      cancelled = await db.prepare(`UPDATE checkout_submissions SET claim_id=? WHERE claim_id=? AND state='processing'
        AND NOT EXISTS(SELECT 1 FROM commerce_orders WHERE quote_id=checkout_submissions.quote_id AND session_hash=checkout_submissions.session_hash)
        RETURNING claim_id`).bind(cleanupClaimId, claimId).first();
    } catch { throw new HttpError(503, 'Status penyimpanan belum dapat dipastikan. Coba kembali dengan formulir yang sama.'); }
    if (!cancelled || cancelled.claim_id !== cleanupClaimId) {
      const committed = await db.prepare('SELECT state,order_id FROM checkout_submissions WHERE claim_id=?').bind(claimId).first();
      if (committed?.state === 'complete' && committed.order_id === orderId) return receipt(db, session, orderId);
      throw new HttpError(503, 'Status penyimpanan perlu diperiksa. Jangan membuat pesanan lain dahulu.');
    }
    if (!(await removeOwnUploads(env, uploaded))) {
      // Retain the claim if cleanup failed so retrying cannot upload duplicate copies.
      throw new HttpError(503, 'Penyimpanan perlu diperiksa admin. Jangan membuat pesanan lain dahulu.');
    }
    await db.prepare("DELETE FROM checkout_submissions WHERE claim_id=? AND state='processing'").bind(cleanupClaimId).run();
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'Pesanan belum tersimpan. Silakan coba kembali.');
  }
}

export async function handleCheckout(request, env, url = new URL(request.url)) {
  if (!url.pathname.startsWith('/api/checkout/')) return null;
  transport(request);
  const db = database(env), settings = await config(db);
  if (url.pathname === '/api/checkout/session') {
    if (request.method !== 'GET') throw new HttpError(405, 'Metode tidak diizinkan.');
    return getSession(request, env, db, settings);
  }
  // During migration, only the owner may simulate orders or upload objects.
  // Public checkout is enabled explicitly by the operator's live-mode cutover.
  if (settings.preview && !(await requireAdmin(request, env))) throw new HttpError(401, 'Masuk sebagai admin untuk mencoba pemesanan pratinjau.');
  const session = await sessionOf(request, db);
  if (!session) throw new HttpError(401, 'Sesi pemesanan berakhir. Muat ulang halaman.');
  const receiptMatch = url.pathname.match(/^\/api\/checkout\/orders\/(cf_[a-f0-9]{32})$/);
  if (receiptMatch) {
    if (request.method !== 'GET') throw new HttpError(405, 'Metode tidak diizinkan.');
    if (!ORDER_ID.test(receiptMatch[1])) throw new HttpError(404, 'Pesanan tidak ditemukan.');
    return receipt(db, session, receiptMatch[1]);
  }
  if (['/api/checkout/quote','/api/checkout/submit'].includes(url.pathname)) {
    origin(request);
    if (url.pathname.endsWith('/quote')) return createQuote(request, db, session, settings);
    return submit(request, env, db, session, settings);
  }
  throw new HttpError(404, 'Halaman pemesanan tidak ditemukan.');
}
