import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { handleLegacyReceipt } from '../src/legacy-receipt.mjs';

// Every record and receipt capability in this test is synthetic.
const origin = 'https://receipt.example.test';
const originalTime = Date.now;
let clock = Date.UTC(2026,0,2,0,0,0);
Date.now = () => clock;
const setupHash = 'a'.repeat(64);
const firstToken = 'b'.repeat(48); // Actual source generation: random_bytes(24).
const oldStyleToken = 'Bcd3'.repeat(8); // Also retain bounded older capabilities.
const specialToken = 'Legacy%+capability&with=signs!';
const sha = value => createHash('sha256').update(value).digest('hex');

class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db,this.sql,values); }
  async first() { return this.db.prepare(this.sql).get(...this.values) || null; }
  async run() { return { success:true,meta:{changes:Number(this.db.prepare(this.sql).run(...this.values).changes)} }; }
}
async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0001_customer_data.sql','0002_order_files.sql','0003_admin.sql','0004_order_admin.sql','0005_checkout.sql','0007_order_archive.sql']) sqlite.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
  sqlite.prepare('INSERT INTO admin_setup(id,token_hash,expires_at,consumed_at) VALUES(1,?,?,?)').run(setupHash,2,2);
  sqlite.prepare('INSERT INTO admin_users(email,password_hash,password_salt,password_iterations,created_at) VALUES(?,?,?,?,?)').run('owner@example.test','c'.repeat(64),'d'.repeat(64),100000,1);
  sqlite.prepare('INSERT INTO migration_runs VALUES(?,?,?,?,?,?,?,?,?,?)').run('test-run','hash','wp_','2026-01-01T00:00:00Z',null,'2026-01-01T00:00:00Z',4,1,5,'hash');
  sqlite.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('test-customer','test-run','identity','EXCLUDED_CUSTOMER_NAME','0800000000','excluded@example.test','example','0800000000','excluded@example.test',101,'hash');
  const columns = ['source_post_id','migration_run_id','customer_id','order_number','post_status','business_status','customer_name_original','whatsapp_original','email_original','city','package_id','package_name','base_amount','unique_code','amount','ordered_at_local','ordered_at_gmt','modified_at_local','raw_post_json','source_post_sha256','row_sha256'];
  for (const [id,postStatus,status] of [[101,'publish','pending'],[102,'trash','approved'],[103,'private','rejected'],[104,'publish','pending']]) {
    sqlite.prepare('INSERT INTO orders('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(id,'test-run','test-customer','PL-TEST-'+id,postStatus,status,'EXCLUDED_CUSTOMER_NAME','0800000000','excluded@example.test','Kota Contoh','pkg','Paket Contoh',10000,17,10017,'2026-01-01 07:00:00','2026-01-01 00:00:00','2026-01-01 07:00:00','{"secret":"EXCLUDED_RAW_POST"}','hash','hash');
  }
  for (const [metaId,orderId,key,value] of [[1,101,'_posloker_public_token',firstToken],[2,102,'_posloker_public_token','e'.repeat(48)],[3,103,'_posloker_public_token',oldStyleToken],[4,103,'_posloker_public_token','f'.repeat(64)],[5,104,'_posloker_public_token',specialToken]]) {
    sqlite.prepare('INSERT INTO order_meta VALUES(?,?,?,?,?,?,?)').run(metaId,'test-run',orderId,metaId,key,value,'hash');
  }
  const env = { CUSTOMER_DB:{prepare(sql){return new Statement(sqlite,sql);}} };
  return {sqlite,env};
}
function request(input, options = {}) {
  const headers = {Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':options.ip || '203.0.113.1',...options.headers};
  return new Request((options.origin || origin)+'/api/legacy/receipt',{method:options.method || 'POST',headers,body:options.method==='GET'?undefined:options.raw ?? JSON.stringify(input)});
}
const call = (env,input,options) => handleLegacyReceipt(request(input,options),env);
const rejection = (env,input,status,options) => assert.rejects(call(env,input,options),error=>error.status===status);

const databases = [];
try {
  const {sqlite,env} = await fixture(); databases.push(sqlite);
  const sourceTables = ['orders','customers','order_meta','migration_runs','order_files'];
  const snapshot = JSON.stringify(sourceTables.map(table=>sqlite.prepare('SELECT * FROM '+table).all()));
  const response = await call(env,{orderId:'101',key:firstToken});
  assert.equal(response.status,200);
  const result = await response.json();
  assert.deepEqual(result,{order:{number:'PL-TEST-101',city:'Kota Contoh',packageName:'Paket Contoh',amount:10017,status:'pending'}});
  assert.equal(response.headers.get('Cache-Control'),'private, no-store, max-age=0');
  assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
  assert.match(response.headers.get('X-Robots-Tag'),/noindex/);
  assert.equal(response.headers.get('Set-Cookie'),null); assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
  assert.equal(JSON.stringify(result).includes('EXCLUDED'),false);
  assert.equal(JSON.stringify(result).includes(firstToken),false);
  assert.deepEqual(Object.keys(result.order).sort(),['amount','city','number','packageName','status'].sort());
  const wrong = await Promise.allSettled([
    call(env,{orderId:101,key:'0'.repeat(48)},{ip:'203.0.113.2'}),
    call(env,{orderId:999,key:firstToken},{ip:'203.0.113.3'}),
    call(env,{orderId:102,key:'e'.repeat(48)},{ip:'203.0.113.4'}),
  ]);
  assert.ok(wrong.every(value=>value.status==='rejected' && value.reason.status===404));
  assert.equal(new Set(wrong.map(value=>value.reason.message)).size,1,'Invalid token, missing order and archived order must use the same generic error');
  assert.equal((await (await call(env,{orderId:103,key:oldStyleToken},{ip:'203.0.113.5'})).json()).order.status,'rejected');
  await rejection(env,{orderId:103,key:'f'.repeat(64)},404,{ip:'203.0.113.6'});
  await rejection(env,{orderId:103,key:oldStyleToken.toLowerCase()},404,{ip:'203.0.113.7'});
  assert.equal((await (await call(env,{orderId:104,key:specialToken},{ip:'203.0.113.8'})).json()).order.number,'PL-TEST-104');

  sqlite.prepare('INSERT INTO order_admin_state(order_id,status,admin_note,revision,updated_at,updated_by,last_change_id,post_status) VALUES(?,?,?,?,?,?,?,?)').run(101,'approved','EXCLUDED_INTERNAL_NOTE',1,1,1,'test-change','private');
  assert.equal((await (await call(env,{orderId:101,key:firstToken},{ip:'203.0.113.9'})).json()).order.status,'approved','Receipt must show the effective Cloudflare working status');
  sqlite.prepare("UPDATE order_admin_state SET post_status='trash' WHERE order_id=101").run();
  await rejection(env,{orderId:101,key:firstToken},404,{ip:'203.0.113.10'});
  sqlite.prepare("UPDATE order_admin_state SET post_status='private' WHERE order_id=101").run();
  assert.equal((await (await call(env,{orderId:101,key:firstToken},{ip:'203.0.113.11'})).json()).order.status,'approved');

  const invalidForms = [null,[],{}, {orderId:0,key:firstToken},{orderId:'101 OR 1=1',key:firstToken},{orderId:101,key:'short'},{orderId:101,key:'a'.repeat(257)}, {orderId:101,key:'a'.repeat(47)+'\n'},{orderId:101,key:firstToken,customer:true}];
  for (const form of invalidForms) await rejection(env,form,400);
  await rejection(env,{orderId:101,key:firstToken},403,{headers:{Origin:'https://evil.example.test'}});
  await rejection(env,{orderId:101,key:firstToken},403,{headers:{'Sec-Fetch-Site':'cross-site'}});
  await rejection(env,{orderId:101,key:firstToken},415,{headers:{'Content-Type':'text/plain'}});
  await rejection(env,{orderId:101,key:firstToken},405,{method:'GET'});
  await rejection(env,{orderId:101,key:firstToken},403,{origin:'http://receipt.example.test',headers:{Origin:'http://receipt.example.test'}});
  await rejection(env,null,400,{raw:'{broken'});
  await rejection(env,null,413,{raw:JSON.stringify({orderId:101,key:'a'.repeat(3000)})});
  await rejection(env,{orderId:101,key:firstToken},413,{headers:{'Content-Length':'999999'}});
  await rejection(env,{orderId:101,key:firstToken},413,{headers:{'Content-Length':'not-a-size'}});
  const withoutDb = handleLegacyReceipt(request({orderId:101,key:firstToken}),{});
  await assert.rejects(withoutDb,error=>error.status===503);
  assert.equal(JSON.stringify(sourceTables.map(table=>sqlite.prepare('SELECT * FROM '+table).all())),snapshot,'Legacy receipt reads must never change migrated customer/source/file rows');

  const limited = await fixture(); databases.push(limited.sqlite);
  for (let index=0; index<10; index++) await rejection(limited.env,{orderId:101,key:'0'.repeat(48)},404);
  const globalKey = sha('legacy-receipt:global:'+setupHash);
  const beforeGlobal = limited.sqlite.prepare('SELECT attempts FROM checkout_rate_limits WHERE bucket_hash=?').get(globalKey).attempts;
  const beforeRows = limited.sqlite.prepare('SELECT count(*) AS n FROM checkout_rate_limits').get().n;
  for (let index=0; index<20; index++) await rejection(limited.env,{orderId:101,key:firstToken},429);
  assert.equal(limited.sqlite.prepare('SELECT attempts FROM checkout_rate_limits WHERE bucket_hash=?').get(globalKey).attempts,beforeGlobal,'A limited IP cannot exhaust the remaining global budget');
  assert.equal(limited.sqlite.prepare('SELECT count(*) AS n FROM checkout_rate_limits').get().n,beforeRows,'Limited retries cannot allocate fresh buckets');
  assert.equal((await (await call(limited.env,{orderId:101,key:firstToken},{ip:'203.0.113.200'})).json()).order.number,'PL-TEST-101');
  clock += 901000;
  assert.equal((await call(limited.env,{orderId:101,key:firstToken})).status,200,'A new rate window restores access without allocating a timestamp-named bucket');
  assert.equal(limited.sqlite.prepare('SELECT count(*) AS n FROM checkout_rate_limits').get().n,beforeRows+1);

  const capped = await fixture(); databases.push(capped.sqlite);
  for (let index=0;index<200;index++) await call(capped.env,{orderId:101,key:firstToken},{ip:'198.51.100.'+(Math.floor(index/10)+1)});
  const rowsAtCap = capped.sqlite.prepare('SELECT count(*) AS n FROM checkout_rate_limits').get().n;
  await rejection(capped.env,{orderId:101,key:firstToken},429,{ip:'198.51.100.200'});
  assert.equal(capped.sqlite.prepare('SELECT count(*) AS n FROM checkout_rate_limits').get().n,rowsAtCap,'A globally capped caller cannot create new address buckets');
  assert.equal(capped.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
  console.log('Synthetic legacy receipt checks passed: source capabilities, exact first-token comparison, minimal DTO/privacy headers, generic rejection, working status/archive visibility, bounded same-origin JSON and persistent per-address/global limits.');
} finally {
  for (const database of databases) database.close();
  Date.now = originalTime;
}
