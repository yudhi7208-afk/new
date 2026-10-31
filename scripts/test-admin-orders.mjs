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

let failAudit = false;
class Statement {
  constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.sql, args); }
  execute() {
    if (failAudit && /INSERT INTO order_admin_events/.test(this.sql)) throw new Error('Synthetic audit storage failure');
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
const env = {
  CUSTOMER_DB: {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  },
  CUSTOMER_FILES: { async get(key) { r2Reads++; assert.equal(key,digest+'.txt'); return { size:fileBody.length, body:fileBody }; } },
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
  assert.equal(data.total,2); assert.deepEqual(data.summary,{total:2,pending:1,approved:1,rejected:0});
  assert.ok(data.orders.every(o => !('whatsapp' in o) && !('email' in o) && !('raw_post_json' in o)));
  assert.equal((await (await call(get('/api/admin/orders?trash=1'))).json()).total,1);
  assert.equal((await (await call(get('/api/admin/orders?status=approved'))).json()).orders[0].id,102);
  assert.equal((await (await call(get('/api/admin/orders?q='+encodeURIComponent("100%_\\'")))).json()).total,1,'Search must treat wildcard and SQL syntax as literal text');
  assert.equal((await (await call(get('/api/admin/orders?page=2'))).json()).orders.length,0);
  await assert.rejects(call(get('/api/admin/orders?status=anything')),e=>e.status===400);
  await assert.rejects(call(get('/api/admin/orders?page=-1')),e=>e.status===400);
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
  const file = await call(get('/api/admin/files/'+fileId));
  assert.equal(Buffer.from(await file.arrayBuffer()).compare(fileBody),0);
  assert.match(file.headers.get('Content-Disposition'),/^attachment;/);
  assert.ok(!file.headers.get('Content-Disposition').includes('\r'));
  assert.equal(file.headers.get('Content-Type'),'application/octet-stream');
  assert.equal(r2Reads,1);
  const anonymousFile = await worker.fetch(get('/api/admin/files/'+fileId),env);
  assert.equal(anonymousFile.status,401); assert.equal(r2Reads,1,'Anonymous requests cannot reach R2');
  const anonymousOrders = await worker.fetch(get('/api/admin/orders'),env);
  assert.equal(anonymousOrders.status,401);
  assert.equal(anonymousOrders.headers.get('Cache-Control'),'private, no-store, max-age=0');
  assert.ok(!(await anonymousOrders.text()).includes('Example Customer'));
  const shell = await worker.fetch(get('/admin/'),env);
  assert.equal(shell.headers.get('X-Frame-Options'),'DENY');
  assert.ok(shell.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));
  assert.equal(await (await worker.fetch(get('/'),env)).text(),'Synthetic public asset');
  assert.equal(JSON.stringify(['orders','customers','order_meta','migration_runs','order_files'].map(t => sqlite.prepare('SELECT * FROM '+t).all())),immutableBefore,'Admin changes must leave every migrated source table unchanged');
  console.log('Synthetic admin desk checks passed: literal search, pagination, field allowlist, CSRF, private downloads, immutable snapshot, atomic audit rollback, revision conflicts and concurrent update protection.');
} finally { sqlite.close(); }
