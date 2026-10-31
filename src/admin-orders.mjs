import { HttpError, assertMutation } from './admin-auth.mjs';

const STATUSES = ['pending', 'approved', 'rejected'];
const EFFECTIVE_STATUS = "COALESCE(s.status,CASE WHEN o.business_status IN ('pending','approved','rejected') THEN o.business_status ELSE 'pending' END)";
const FROM = ' FROM orders o LEFT JOIN order_admin_state s ON s.order_id=o.source_post_id ';
const SUMMARY_COLUMNS = `o.source_post_id AS id,o.order_number AS orderNumber,o.customer_name_original AS customerName,o.city,o.package_name AS packageName,o.amount,${EFFECTIVE_STATUS} AS status,o.post_status AS postStatus,o.ordered_at_local AS orderedAt,COALESCE(s.revision,0) AS revision`;

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders } });
}
function idFrom(value) {
  if (!/^[1-9]\d{0,14}$/.test(value)) throw new HttpError(404, 'Pesanan tidak ditemukan.');
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new HttpError(404, 'Pesanan tidak ditemukan.');
  return id;
}
function resultRows(result) { return result.results || []; }
async function listOrders(env, url) {
  const search = url.searchParams.get('q') || '';
  const status = url.searchParams.get('status') || 'all';
  const pageValue = url.searchParams.get('page') || '1';
  const trash = url.searchParams.get('trash') || '0';
  if (search.length > 100 || !['all', ...STATUSES].includes(status) || !/^[1-9]\d{0,5}$/.test(pageValue) || !['0', '1'].includes(trash)) {
    throw new HttpError(400, 'Filter pesanan tidak valid.');
  }
  const page = Number(pageValue), pageSize = 20;
  const clauses = [trash === '1' ? "o.post_status='trash'" : "o.post_status<>'trash'"];
  const args = [];
  if (search) {
    const pattern = '%' + search.replace(/[\\%_]/g, c => '\\' + c) + '%';
    clauses.push("(o.order_number LIKE ? ESCAPE '\\' OR o.customer_name_original LIKE ? ESCAPE '\\' OR o.city LIKE ? ESCAPE '\\')");
    args.push(pattern, pattern, pattern);
  }
  const summaryWhere = ' WHERE ' + clauses.join(' AND ');
  const summaryArgs = [...args];
  if (status !== 'all') { clauses.push(EFFECTIVE_STATUS + '=?'); args.push(status); }
  const where = ' WHERE ' + clauses.join(' AND ');
  const db = env.CUSTOMER_DB;
  const responses = await db.batch([
    db.prepare('SELECT ' + SUMMARY_COLUMNS + FROM + where + ' ORDER BY o.source_post_id DESC LIMIT ? OFFSET ?').bind(...args, pageSize, (page - 1) * pageSize),
    db.prepare('SELECT count(*) AS total' + FROM + where).bind(...args),
    db.prepare(`SELECT count(*) AS total,COALESCE(sum(${EFFECTIVE_STATUS}='pending'),0) AS pending,COALESCE(sum(${EFFECTIVE_STATUS}='approved'),0) AS approved,COALESCE(sum(${EFFECTIVE_STATUS}='rejected'),0) AS rejected` + FROM + summaryWhere).bind(...summaryArgs),
    db.prepare('SELECT source_snapshot_at AS sourceSnapshotAt FROM migration_runs ORDER BY prepared_at DESC LIMIT 1'),
  ]);
  return json({ orders: resultRows(responses[0]), total: resultRows(responses[1])[0].total, summary: resultRows(responses[2])[0], page, pageSize, migration: resultRows(responses[3])[0] || null });
}
async function orderRow(db, id) {
  return db.prepare('SELECT ' + SUMMARY_COLUMNS + `,o.whatsapp_original AS whatsapp,o.email_original AS email,o.base_amount AS baseAmount,o.unique_code AS uniqueCode,COALESCE(s.admin_note,'') AS adminNote` + FROM + ' WHERE o.source_post_id=?').bind(id).first();
}
async function orderDetail(env, id) {
  const db = env.CUSTOMER_DB;
  const order = await orderRow(db, id);
  if (!order) throw new HttpError(404, 'Pesanan tidak ditemukan.');
  // Display only the business fields the desk needs. Raw metadata includes
  // source bearer tokens and paths, which must never be returned to clients.
  const responses = await db.batch([
    db.prepare("SELECT meta_key,meta_value FROM order_meta WHERE order_id=? AND meta_key IN ('_posloker_ad_text','_posloker_ad_caption','_posloker_notes') ORDER BY source_meta_id").bind(id),
    db.prepare('SELECT id,kind,position,original_name AS name,mime,byte_count AS bytes,missing FROM order_files WHERE order_id=? ORDER BY kind,position').bind(id),
    db.prepare('SELECT e.created_at AS at,e.action,e.status,e.note,e.reason,e.revision,u.email AS actor FROM order_admin_events e JOIN admin_users u ON u.id=e.admin_id WHERE e.order_id=? ORDER BY e.created_at DESC,e.revision DESC LIMIT 100').bind(id),
  ]);
  const meta = new Map();
  for (const row of resultRows(responses[0])) if (!meta.has(row.meta_key)) meta.set(row.meta_key, row.meta_value);
  Object.assign(order, { adText: meta.get('_posloker_ad_text') || '', caption: meta.get('_posloker_ad_caption') || '', notes: meta.get('_posloker_notes') || '' });
  const files = resultRows(responses[1]).map(file => ({ ...file, url: file.missing ? null : '/api/admin/files/' + encodeURIComponent(file.id) }));
  return json({ order, files, events: resultRows(responses[2]) });
}
async function requestJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Formulir belum lengkap.');
  let bytes = 0; const chunks = [];
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    bytes += item.value.length;
    if (bytes > 32768) { await reader.cancel(); throw new HttpError(413, 'Formulir terlalu besar.'); }
    chunks.push(item.value);
  }
  const combined = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(combined)); }
  catch { throw new HttpError(400, 'Formulir tidak valid.'); }
}
async function updateOrder(request, env, auth, id) {
  assertMutation(request, auth.session);
  const input = await requestJson(request);
  if (!input || Array.isArray(input) || !STATUSES.includes(input.status) || typeof input.adminNote !== 'string' || input.adminNote.length > 5000 ||
    typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.length > 500 || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new HttpError(400, 'Isi status, catatan, dan alasan perubahan dengan benar.');
  }
  if (Object.keys(input).some(key => !['status', 'adminNote', 'expectedRevision', 'reason'].includes(key))) throw new HttpError(400, 'Field perubahan tidak diizinkan.');
  const current = await orderRow(env.CUSTOMER_DB, id);
  if (!current) throw new HttpError(404, 'Pesanan tidak ditemukan.');
  if (current.postStatus === 'trash') throw new HttpError(409, 'Pesanan arsip tidak dapat diubah.');
  if (current.revision !== input.expectedRevision) throw new HttpError(409, 'Pesanan sudah berubah. Muat ulang sebelum menyimpan.');
  if (current.status === input.status && current.adminNote === input.adminNote) return json({ saved: true, order: current, unchanged: true });
  const db = env.CUSTOMER_DB, now = Math.floor(Date.now() / 1000), changeId = crypto.randomUUID();
  const nextRevision = input.expectedRevision + 1;
  const results = await db.batch([
    db.prepare(`INSERT INTO order_admin_state(order_id,status,admin_note,revision,updated_at,updated_by,last_change_id)
      SELECT o.source_post_id,?,?,1,?,?,? FROM orders o
      WHERE o.source_post_id=? AND o.post_status<>'trash' AND COALESCE((SELECT revision FROM order_admin_state WHERE order_id=o.source_post_id),0)=?
      ON CONFLICT(order_id) DO UPDATE SET status=excluded.status,admin_note=excluded.admin_note,revision=order_admin_state.revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by,last_change_id=excluded.last_change_id
      WHERE order_admin_state.revision=? RETURNING revision`).bind(input.status, input.adminNote, now, auth.user.id, changeId, id, input.expectedRevision, input.expectedRevision),
    db.prepare(`INSERT INTO order_admin_events(id,order_id,admin_id,action,previous_status,status,previous_note,note,reason,revision,created_at)
      SELECT ?,order_id,?,'update',?,status,?,admin_note,?,revision,updated_at FROM order_admin_state WHERE order_id=? AND last_change_id=?`).bind(changeId, auth.user.id, current.status, current.adminNote, input.reason.trim(), id, changeId),
  ]);
  if (resultRows(results[0])[0]?.revision !== nextRevision || results[1].meta?.changes !== 1) throw new HttpError(409, 'Pesanan sudah berubah. Muat ulang sebelum menyimpan.');
  return orderDetail(env, id);
}
function attachmentName(name) {
  const clean = (typeof name === 'string' ? name : 'berkas').replace(/[\r\n\u0000-\u001f\u007f/\\]/g, '_').slice(0, 180) || 'berkas';
  // Unpaired Unicode surrogates cannot be encoded into RFC 5987 headers.
  const wellFormed = clean.toWellFormed();
  const fallback = wellFormed.replace(/[^A-Za-z0-9._ -]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(wellFormed).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}
async function downloadFile(request, env, fileId) {
  const file = await env.CUSTOMER_DB.prepare('SELECT storage_key,original_name,byte_count,sha256,missing FROM order_files WHERE id=?').bind(fileId).first();
  if (!file || file.missing || !file.storage_key) throw new HttpError(404, 'Berkas tidak tersedia.');
  if (!/^[a-f0-9]{64}\.[a-z0-9]+$/.test(file.storage_key) || !file.storage_key.startsWith(file.sha256 + '.')) throw new HttpError(503, 'Berkas belum siap.');
  if (!env.CUSTOMER_FILES) throw new HttpError(503, 'Penyimpanan belum siap.');
  const object = await env.CUSTOMER_FILES.get(file.storage_key);
  if (!object || object.size !== file.byte_count) throw new HttpError(503, 'Salinan berkas belum sesuai.');
  return new Response(request.method === 'HEAD' ? null : object.body, { headers: {
    'Content-Type': 'application/octet-stream', 'Content-Disposition': attachmentName(file.original_name), 'Content-Length': String(object.size),
    'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff',
  } });
}
export async function handleOrders(request, env, url, auth) {
  const path = url.pathname;
  if (path === '/api/admin/orders' && request.method === 'GET') return listOrders(env, url);
  const orderMatch = path.match(/^\/api\/admin\/orders\/([1-9]\d{0,14})$/);
  if (orderMatch) {
    const id = idFrom(orderMatch[1]);
    if (request.method === 'GET') return orderDetail(env, id);
    if (request.method === 'POST') return updateOrder(request, env, auth, id);
    throw new HttpError(405, 'Metode tidak diizinkan.');
  }
  const fileMatch = path.match(/^\/api\/admin\/files\/(file_[a-f0-9]{64})$/);
  if (fileMatch && ['GET', 'HEAD'].includes(request.method)) return downloadFile(request, env, fileMatch[1]);
  throw new HttpError(404, 'Halaman tidak ditemukan.');
}
