import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../public/pembayaran/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/checkout/checkout.js', import.meta.url), 'utf8');
const qrPath = '/checkout/qris-nusa-digital-20261124.jpg';
const quote = { id: 'example', city: 'Medan', packageId: 'komplit', packageName: 'Paket Komplit', baseAmount: 35000, uniqueCode: 7, amount: 35007, expiresAt: Date.now() + 90000 };
const wait = () => new Promise(resolve => setImmediate(resolve));

async function load({ preview = false, baseAmount = 35000, canSubmit = true, expire = false, selected = true } = {}) {
  const els = new Map([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(([tag, id]) => {
    const attrs = new Map(), handlers = {};
    return [id, {
      hidden: /\shidden\b/.test(tag), classList: { add(){}, remove(){}, toggle(){} }, dataset: {}, handlers,
      addEventListener(type, callback) { handlers[type] = callback; }, focus(){}, scrollIntoView(){}, replaceChildren(){}, showModal(){ this.open = true; }, close(){ this.open = false; },
      setAttribute(name, value) { attrs.set(name,value); }, removeAttribute(name) { attrs.delete(name); }, hasAttribute(name) { return attrs.has(name); },
      get src(){ return attrs.get('src'); }, set src(value){attrs.set('src',value);},
      get href(){ return attrs.get('href'); }, set href(value){attrs.set('href',value);}
    }];
  }));
  const $ = id => { assert.ok(els.has(id), 'Missing checkout element: '+id); return els.get(id); };
  $('qrisImage').dataset.src = qrPath;
  const written = [];
  const body = { classList: { toggle(){} } };
  let tick, time = Date.now();
  class TestDate extends Date { static now() { return time; } }
  const price = baseAmount === 0 ? { baseAmount:0, uniqueCode:0, amount:0 } : { baseAmount };
  runInNewContext(script,{
    document: { getElementById:$, body, activeElement:body, documentElement:{classList:{add(){},remove(){}}} },
    navigator: { clipboard: { async writeText(value){written.push(value);} } }, location: { search:selected?'?city=Medan&package=komplit':'', hash:'' },
    crypto, Intl, URLSearchParams, AbortController, Date:TestDate, clearTimeout(){}, clearInterval(){}, setTimeout(){}, setInterval(callback){tick=callback;}, addEventListener(){},
    async fetch(path) {
      if (path === '/api/checkout/session') return Response.json({ preview, canSubmit, csrfToken:'a'.repeat(64), catalog:{cities:[{name:'Medan',pricingKey:'medan'}],pricing:{medan:[{id:'komplit',name:'Paket Komplit'}]}},payment:{limits:{proofMaxBytes:10,materialsMaxBytes:10,materialsMaxFiles:10,videoMaxBytes:10}} });
      assert.equal(path,'/api/checkout/quote');
      return Response.json({ preview, quote:{ ...quote,...price,expiresAt:expire?Date.now()-10000:quote.expiresAt } });
    },
  });
  await wait();
  assert.equal($('pageError').hidden,true,$('pageError').textContent);
  assert.equal($('quoteError').hidden,true,$('quoteError').textContent);
  return { $, written, expireQuote() { time=quote.expiresAt+1; tick(); } };
}

const paid = await load();
assert.equal(paid.$('qrisCard').hidden,false);
assert.equal(paid.$('qrisImage').src,qrPath);
assert.equal(paid.$('downloadQris').href,qrPath);
assert.match(paid.$('qrisAmount').textContent,/35\.007/);
assert.equal(paid.$('paymentDialog').open,true);
await paid.$('copyQrisAmountButton').handlers.click();
assert.deepEqual(paid.written,['35007']);
paid.$('acknowledgePaymentButton').handlers.click();
paid.$('continueButton').handlers.click();
assert.equal(paid.$('qrisCard').hidden,true);
assert.equal(paid.$('downloadQris').href,undefined);
assert.equal(paid.$('proofInput').required,true);

const elapsed = await load();
elapsed.expireQuote();
assert.equal(elapsed.$('qrisCard').hidden,true);
assert.equal(elapsed.$('downloadQris').href,undefined);
assert.equal(elapsed.$('paymentDialog').open,false);
await elapsed.$('copyAmountButton').handlers.click();
assert.deepEqual(elapsed.written,[]);

for (const options of [{preview:true},{expire:true},{baseAmount:0},{selected:false},{canSubmit:false}]) {
  const { $, written } = await load(options);
  assert.equal($('qrisCard').hidden,true);
  assert.equal($('downloadQris').href,undefined);
  assert.equal($('qrisImage').src,undefined);
  await $('copyQrisAmountButton').handlers.click();
  assert.deepEqual(written,[]);
  assert.notEqual($('paymentDialog').open,true);
  if (options.baseAmount === 0) assert.equal($('proofInput').required,false);
}
console.log('QRIS checkout UI checks passed: valid paid quotes only, exact amount copy, proof required, and QR hidden in free/preview/expired/unselected states.');
