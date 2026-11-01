import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { handleOrders } from '../src/admin-orders.mjs';
import worker from '../src/worker.mjs';

// This desk test opens synthetic records only. Never load the private snapshot.
const sqlite = new DatabaseSync(':memory:');
for (const file of ['0001_customer_data.sql', '0002_order_files.sql']) sqlite.exec(await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8'));
sqlite.exec("CREATE TABLE admin_users(id INTEGER PRIMARY KEY,email TEXT);INSERT INTO admin_users VALUES(1,'admin@example.test');");
sqlite.exec(await readFile(new URL('../migrations/0004_order_admin.sql', import.meta.url), 'utf8'));
sqlite.exec(await readFile(new URL('../migrations/0005_checkout.sql', import.meta.url), 'utf8'));
sqlite.prepare('INSERT INTO migration_runs VALUES(?,?,?,?,?,?,?,?,?,?)').run('synthetic-run','hash','wp_','2026-01-01T00:00:00Z',null,'2026-01-01T00:00:00Z',3,1,4,'hash');
sqlite.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('synthetic-customer','synthetic-run','identity','Example Customer','0800000000','customer@example.test','example','0800000000','customer@example.test',101,'hash');
const orderColumns = ['source_post_id','migration_run_id','customer_id','order_number','post_status','business_status','customer_name_original','whatsapp_original','email_original','city','package_id','package_name','base_amount','unique_code','amount','ordered_at_local','ordered_at_gmt','modified_at_local','raw_post_json','source_post_sha256','row_sha256'];
for (const [id, postStatus, status, name] of [[101,'publish','pending','Example Customer'],[102,'publish','approved',"Example 100%_\\' Customer"],[103,'trash','pending','Example Archived']]) {
  sqlite.prepare('INSERT INTO orders(' + orderColumns.join(',') + ') VALUES(' + orderColumns.map(() => '?').join(',') + ')').run(id,'synthetic-run','synthetic-customer','PL-TEST-'+id,postStatus,status,name,'0800000000','customer@example.test','Kota Contoh','pkg','Paket Contoh',100000,17,100017,'2026-01-01 07:00:00','2026-01-01 00:00:00','2026-01-01 07:00:00','{"never":"EXCLUDED_RAW_POST"}','hash','hash');
}
for (const [id,key,value] of [[1,'_posloker_ad_text','<script>synthetic ad</script>'],[2,'_posloker_ad_caption','Unicode É😀 caption'],[3,'_posloker_notes','Customer note'],[4,'_posloker_public_token','EXCLUDED_SOURCE_BEARER']]) {
  sqlite.prepare('INSERT INTO order_meta VALUES(?,?,?,?,?,?,?)').run(id,'synthetic-run',101,id,key,value,'hash');
}
const fileBody = Buffer.from('Synthetic private attachment bytes.');
const digest = createHash('sha256').update(fileBody).digest('hex');
const fileId = 'file_' + 'a'.repeat(64);
sqlite.prepare('INSERT INTO order_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(fileId,101,'synthetic-run','proof',0,'EXCLUDED_PRIVATE_SOURCE_PATH','Example\r\nÉ😀".txt','text/plain',digest+'.txt',digest,fileBody.length,0,'b'.repeat(64));
const immutableBefore = JSON.stringify(['orders','customers','order_meta','migration_runs','order_files'].map(t => sqlite.prepare('SELECT * FROM '+t).all()));

const nativeId = 'cf_' + '1'.padStart(32,'0'), nativeFileId = 'cf_file_' + '2'.repeat(32);
const nativeKey = 'private/commerce/' + nativeId + '/' + nativeFileId + '.pdf';
const nativeBody = Buffer.from('Synthetic native attachment É😀.');
const nativeDigest = createHash('sha256').update(nativeBody).digest('hex');
const nativeIds = [];
// Twenty-two active native orders cross the page boundary with the two old
// orders; all dates deliberately differ from the legacy local/GMT timestamps.
const nativeColumns = ['id','order_number','quote_id','session_hash','idempotency_key','customer_name','whatsapp','email','city','package_id','package_name','features_json','base_amount','unique_code','amount','ad_text','caption','notes','status','post_status','ordered_at_local','created_at','revision','admin_note','updated_at','updated_by','is_test'];
for (let index = 1; index <= 23; index++) {
  const id = 'cf_' + index.toString(16).padStart(32,'0');
  nativeIds.push(id);
  const created = 1767312000 + index;
  const status = index === 2 ? 'rejected' : index === 23 ? 'approved' : 'pending';
  const name = index === 2 ? "Native 100%_\\' Customer" : 'Native Customer ' + index;
  const session = 'EXCLUDED_CHECKOUT_SESSION_'+index;
  sqlite.prepare('INSERT INTO checkout_sessions VALUES(?,?,?,?)').run(session,'c'.repeat(64),created,created+3600);
  sqlite.prepare('INSERT INTO checkout_quotes(id,session_hash,city,package_id,package_name,features_json,payout_json,base_amount,unique_code,amount,is_test,created_at,expires_at,consumed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('quote-'+index,session,'Kota Native','pkg','Paket Native','[]','{}',125000,18,125018,index===2?0:1,created,created+3600,created);
  sqlite.prepare('INSERT INTO commerce_orders(' + nativeColumns.join(',') + ') VALUES(' + nativeColumns.map(() => '?').join(',') + ')').run(id,'CF-TEST-'+index,'quote-'+index,session,'idem-'+index,name,'0800000000','native@example.test','Kota Native','pkg','Paket Native','[]',125000,18,125018,'Native ad <script>','Native É😀 caption','Native customer note',status,index===23?'trash':'publish','2026-01-02 07:00:00',created,0,'',created,null,index===2?0:1);
  sqlite.prepare("INSERT INTO commerce_events(id,order_id,admin_id,action,previous_status,status,previous_note,note,reason,revision,created_at) VALUES(?,?,NULL,'created','',?,'','','Checkout dibuat',0,?)").run('created-'+index,id,status,created);
}
assert.equal(nativeIds[0],nativeId);
sqlite.prepare('INSERT INTO commerce_files(id,order_id,kind,position,original_name,mime,storage_key,sha256,byte_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(nativeFileId,nativeId,'proof',0,'Native\r\nÉ😀".pdf','application/pdf',nativeKey,nativeDigest,nativeBody.length,1767312001);
const nativeFixedColumns = nativeColumns.filter(column => !['status','revision','admin_note','updated_at','updated_by'].includes(column));
const nativeFixedBefore = JSON.stringify(sqlite.prepare('SELECT ' + nativeFixedColumns.join(',') + ' FROM commerce_orders ORDER BY id').all());
const nativeFilesBefore = JSON.stringify(sqlite.prepare('SELECT * FROM commerce_files ORDER BY id').all());

let failAudit = false;
let failNativeUpdate = false;
class Statement {
  constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.sql, args); }
  execute() {
    if (failAudit && /INSERT INTO (order_admin_events|commerce_events)/.test(this.sql)) throw new Error('Synthetic audit storage failure');
    if (failNativeUpdate && /UPDATE commerce_orders SET/.test(this.sql)) throw new Error('Synthetic native state storage failure');
    const before = sqlite.prepare('SELECT total_changes() AS n').get().n;
    const stmt = sqlite.prepare(this.sql);
    const results = stmt.columns().length ? stmt.all(...this.args).map(r => ({...r})) : (stmt.run(...this.args), []);
    return { results, success: true, meta: { changes: sqlite.prepare('SELECT total_changes() AS n').get().n - before } };
  }
  async first(column) { const row = this.execute().results[0] || null; return column && row ? row[column] : row; }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
}
let r2Reads = 0;
const storedObjects = new Map([[digest+'.txt',fileBody],[nativeKey,nativeBody]]);
const env = {
  CUSTOMER_DB: {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  },
  CUSTOMER_FILES: { async get(key) { r2Reads++; const body = storedObjects.get(key); assert.ok(body,'Only an expected private storage key may be requested'); return { size:body.length, body }; } },
  ASSETS: { async fetch() { return new Response('Synthetic public asset'); } },
};
const origin = 'https://admin.example.test';
const csrf = 'c'.repeat(64);
const auth = { user:{id:1,email:'admin@example.test'}, session:{csrfToken:csrf}, csrfToken:csrf };
const get = path => new Request(origin+path);
const post = (path, body, extra = {}) => new Request(origin+path,{ method:'POST',headers:{ Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf,...extra },body:JSON.stringify(body) });
const call = request => handleOrders(request,env,new URL(request.url),auth);
try {
  let data = await (await call(get('/api/admin/orders'))).json();
  assert.equal(data.total,24); assert.deepEqual(data.summary,{total:24,pending:22,approved:1,rejected:1});
  assert.equal(data.orders.length,20);
  const nextPage = await (await call(get('/api/admin/orders?page=2'))).json();
  assert.equal(nextPage.orders.length,4);
  assert.equal(new Set([...data.orders,...nextPage.orders].map(o=>o.id)).size,24,'Combined pagination may not skip or repeat either source');
  assert.ok(nextPage.orders.some(o=>o.id===101));
  assert.ok(data.orders.every(o=>o.source==='cloudflare' && typeof o.id==='string' && typeof o.isTest==='boolean'));
  assert.ok(nextPage.orders.some(o=>o.source==='wordpress' && typeof o.id==='number' && o.isTest===false));
  assert.ok(data.orders.every(o => !('whatsapp' in o) && !('email' in o) && !('raw_post_json' in o)));
  assert.equal((await (await call(get('/api/admin/orders?trash=1'))).json()).total,2);
  assert.equal((await (await call(get('/api/admin/orders?status=approved'))).json()).orders[0].id,102);
  assert.equal((await (await call(get('/api/admin/orders?q='+encodeURIComponent("100%_\\'")))).json()).total,2,'Search must treat wildcard and SQL syntax as literal text across both sources');
  data = await (await call(get('/api/admin/orders?source=wordpress'))).json();
  assert.equal(data.total,2); assert.deepEqual(data.summary,{total:2,pending:1,approved:1,rejected:0});
  data = await (await call(get('/api/admin/orders?source=cloudflare&status=rejected'))).json();
  assert.equal(data.total,1); assert.equal(data.orders[0].isTest,false); assert.equal(data.summary.total,22,'Status filter preserves counts for the selected source');
  assert.equal((await (await call(get('/api/admin/orders?source=cloudflare&q='+encodeURIComponent("100%_\\'")))).json()).total,1);
  assert.equal((await (await call(get('/api/admin/orders?page=3'))).json()).orders.length,0);
  await assert.rejects(call(get('/api/admin/orders?status=anything')),e=>e.status===400);
  await assert.rejects(call(get('/api/admin/orders?page=-1')),e=>e.status===400);
  await assert.rejects(call(get('/api/admin/orders?source=invalid')),e=>e.status===400);
  data = await (await call(get('/api/admin/orders/101'))).json();
  assert.equal(data.order.caption,'Unicode É😀 caption');
  assert.equal(data.files[0].url,'/api/admin/files/'+fileId);
  assert.ok(!JSON.stringify(data).includes('EXCLUDED_'),'Raw source metadata, tokens and paths cannot leak through detail');
  const payload = {status:'approved',adminNote:'Verified synthetic payment',reason:'Bukti contoh diperiksa',expectedRevision:0};
  await assert.rejects(call(post('/api/admin/orders/101',payload,{'X-CSRF-Token':'wrong'})),e=>e.status===403);
  await assert.rejects(call(post('/api/admin/orders/101',payload,{Origin:'https://evil.example.test'})),e=>e.status===403);
  await assert.rejects(call(post('/api/admin/orders/101',{...payload,amount:1})),e=>e.status===400);
  failAudit = true;
  await assert.rejects(call(post('/api/admin/orders/101',payload)));
  failAudit = false;
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM order_admin_state').get().n,0,'Audit failure must roll back working state');
  data = await (await call(post('/api/admin/orders/101',payload))).json();
  assert.equal(data.order.status,'approved'); assert.equal(data.order.revision,1);
  assert.equal(data.order.amount,100017,'Historical amount remains fixed');
  assert.equal(data.events.length,1); assert.equal(data.events[0].reason,payload.reason);
  await assert.rejects(call(post('/api/admin/orders/101',payload)),e=>e.status===409);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM order_admin_events').get().n,1,'A stale retry must not create an audit event');
  await assert.rejects(call(post('/api/admin/orders/103',payload)),e=>e.status===409);
  const outcomes = await Promise.allSettled([
    call(post('/api/admin/orders/101',{...payload,status:'rejected',reason:'Perubahan satu',expectedRevision:1})),
    call(post('/api/admin/orders/101',{...payload,status:'pending',reason:'Perubahan dua',expectedRevision:1})),
  ]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1,'Only one concurrent revision may win');
  assert.equal(outcomes.find(r=>r.status==='rejected').reason.status,409);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM order_admin_events').get().n,2);

  data = await (await call(get('/api/admin/orders/'+nativeId))).json();
  assert.equal(data.order.source,'cloudflare'); assert.equal(data.order.isTest,true); assert.equal(data.order.revision,0);
  assert.equal(data.order.caption,'Native É😀 caption'); assert.equal(data.order.notes,'Native customer note');
  assert.equal(data.files[0].url,'/api/admin/files/'+nativeFileId);
  assert.equal(data.events.length,1); assert.equal(data.events[0].action,'created'); assert.equal(data.events[0].actor,null,'System checkout event must survive the missing admin actor');
  assert.ok(!JSON.stringify(data).includes('EXCLUDED_') && !JSON.stringify(data).includes('private/commerce/'),'Checkout sessions and R2 keys cannot leak through native detail');
  const nativePath = '/api/admin/orders/'+nativeId;
  const nativePayload = {...payload,adminNote:'Native admin note'};
  await assert.rejects(call(post(nativePath,nativePayload,{'X-CSRF-Token':'wrong'})),e=>e.status===403);
  await assert.rejects(call(post(nativePath,{...nativePayload,isTest:false})),e=>e.status===400);
  failAudit = true;
  await assert.rejects(call(post(nativePath,nativePayload)));
  failAudit = false;
  assert.equal(sqlite.prepare('SELECT revision FROM commerce_orders WHERE id=?').get(nativeId).revision,0,'Native audit failure must leave its order unchanged');
  failNativeUpdate = true;
  await assert.rejects(call(post(nativePath,nativePayload)));
  failNativeUpdate = false;
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM commerce_events WHERE order_id=?').get(nativeId).n,1,'Native state failure must roll back the already inserted audit event');
  data = await (await call(post(nativePath,nativePayload))).json();
  assert.equal(data.order.revision,1); assert.equal(data.order.status,'approved'); assert.equal(data.order.amount,125018);
  assert.equal(data.events.length,2); assert.equal(data.events[0].actor,'admin@example.test');
  assert.equal(data.events[0].reason,nativePayload.reason);
  await assert.rejects(call(post(nativePath,nativePayload)),e=>e.status===409);
  const unchanged = await (await call(post(nativePath,{...nativePayload,expectedRevision:1}))).json();
  assert.equal(unchanged.unchanged,true); assert.equal(sqlite.prepare('SELECT count(*) AS n FROM commerce_events WHERE order_id=?').get(nativeId).n,2);
  await assert.rejects(call(post('/api/admin/orders/'+nativeIds[22],nativePayload)),e=>e.status===409);
  const nativeOutcomes = await Promise.allSettled([
    call(post(nativePath,{...nativePayload,status:'rejected',reason:'Native change one',expectedRevision:1})),
    call(post(nativePath,{...nativePayload,status:'pending',reason:'Native change two',expectedRevision:1})),
  ]);
  assert.equal(nativeOutcomes.filter(r=>r.status==='fulfilled').length,1,'Only one native concurrent revision may win');
  assert.equal(nativeOutcomes.find(r=>r.status==='rejected').reason.status,409);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM commerce_events WHERE order_id=?').get(nativeId).n,3);
  assert.deepEqual(sqlite.prepare('SELECT revision FROM commerce_events WHERE order_id=? ORDER BY revision').all(nativeId).map(row=>row.revision),[0,1,2]);
  await assert.rejects(call(get('/api/admin/orders/cf_'+ 'G'.repeat(32))),e=>e.status===404);

  const file = await call(get('/api/admin/files/'+fileId));
  assert.equal(Buffer.from(await file.arrayBuffer()).compare(fileBody),0);
  assert.match(file.headers.get('Content-Disposition'),/^attachment;/);
  assert.ok(!file.headers.get('Content-Disposition').includes('\r'));
  assert.equal(file.headers.get('Content-Type'),'application/octet-stream');
  assert.equal(file.headers.get('Cache-Control'),'private, no-store, max-age=0');
  assert.equal(r2Reads,1);
  const nativeDownload = await call(get('/api/admin/files/'+nativeFileId));
  assert.equal(Buffer.from(await nativeDownload.arrayBuffer()).compare(nativeBody),0);
  assert.match(nativeDownload.headers.get('Content-Disposition'),/^attachment;/);
  assert.ok(!nativeDownload.headers.get('Content-Disposition').includes('\r'));
  assert.equal(nativeDownload.headers.get('Content-Type'),'application/octet-stream');
  assert.equal(nativeDownload.headers.get('Cache-Control'),'private, no-store, max-age=0');
  const nativeHead = await call(new Request(origin+'/api/admin/files/'+nativeFileId,{method:'HEAD'}));
  assert.equal(await nativeHead.text(),''); assert.equal(nativeHead.headers.get('Content-Length'),String(nativeBody.length));
  const readsBeforeRejections = r2Reads;
  for (const invalidKey of ['https://evil.example.test/file.pdf','private/commerce/../'+nativeFileId+'.pdf','private/commerce/'+nativeIds[1]+'/'+nativeFileId+'.pdf','private/commerce/'+nativeId+'/'+nativeFileId+'.html']) {
    sqlite.prepare('UPDATE commerce_files SET storage_key=? WHERE id=?').run(invalidKey,nativeFileId);
    await assert.rejects(call(get('/api/admin/files/'+nativeFileId)),e=>e.status===503);
  }
  sqlite.prepare('UPDATE commerce_files SET storage_key=? WHERE id=?').run(nativeKey,nativeFileId);
  assert.equal(r2Reads,readsBeforeRejections,'Rejected native storage paths must never reach R2');
  storedObjects.set(nativeKey,Buffer.from('wrong-size'));
  await assert.rejects(call(get('/api/admin/files/'+nativeFileId)),e=>e.status===503);
  storedObjects.set(nativeKey,nativeBody);
  const readsBeforeAnonymous = r2Reads;
  const anonymousFile = await worker.fetch(get('/api/admin/files/'+fileId),env);
  assert.equal(anonymousFile.status,401); assert.equal(r2Reads,readsBeforeAnonymous,'Anonymous requests cannot reach legacy R2');
  assert.equal((await worker.fetch(get('/api/admin/files/'+nativeFileId),env)).status,401);
  assert.equal((await worker.fetch(get(nativePath),env)).status,401);
  assert.equal(r2Reads,readsBeforeAnonymous,'Anonymous requests cannot reach native R2');
  const anonymousOrders = await worker.fetch(get('/api/admin/orders'),env);
  assert.equal(anonymousOrders.status,401);
  assert.equal(anonymousOrders.headers.get('Cache-Control'),'private, no-store, max-age=0');
  assert.ok(!(await anonymousOrders.text()).includes('Example Customer'));
  const shell = await worker.fetch(get('/admin/'),env);
  assert.equal(shell.headers.get('X-Frame-Options'),'DENY');
  assert.ok(shell.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));
  assert.equal(await (await worker.fetch(get('/'),env)).text(),'Synthetic public asset');
  assert.equal(JSON.stringify(['orders','customers','order_meta','migration_runs','order_files'].map(t => sqlite.prepare('SELECT * FROM '+t).all())),immutableBefore,'Admin changes must leave every migrated source table unchanged');
  assert.equal(JSON.stringify(sqlite.prepare('SELECT ' + nativeFixedColumns.join(',') + ' FROM commerce_orders ORDER BY id').all()),nativeFixedBefore,'Native admin updates may only change status, note, revision and audit actor/time');
  assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM commerce_files ORDER BY id').all()),nativeFilesBefore);
  assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
  console.log('Synthetic admin desk checks passed: unified sources and pagination, literal search and filters, safe source/test DTOs, CSRF, legacy/native private downloads, immutable snapshots and checkout fields, bidirectional atomic audit rollback, revision conflicts and concurrent update protection.');
} finally { sqlite.close(); }
