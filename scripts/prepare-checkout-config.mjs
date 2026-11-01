// Prepare public checkout business settings privately; never execute source PHP.
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMysqlDump } from './mysql-dump.mjs';
import { parsePhpSerialized } from './prepare-order-files.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const outputs=path.resolve(repo,'../..','outputs');
const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
function ensure(value,message){if(!value)throw Error(message);}
function inside(p,base){const r=path.relative(base,p);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
function jsonAssignment(html,name){
 const match=new RegExp('var\\s+'+name+'\\s*=\\s*').exec(html);ensure(match,'Public checkout configuration missing');
 let start=match.index+match[0].length,quote=false,escape=false,depth=0;
 for(let i=start;i<html.length;i++){
  const c=html[i];if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quote=false;continue;}
  if(c==='"')quote=true;else if(c==='{'||c==='[')depth++;else if(c==='}'||c===']'){depth--;if(depth===0)return JSON.parse(html.slice(start,i+1));}
 }throw Error('Incomplete public checkout configuration');
}
function decode(value){return value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#0*39;|&apos;/g,"'").replace(/&#(x[a-f0-9]+|[0-9]+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n)));}
try{
 ensure(args.dump&&args['plugin-source']&&args['out-dir'],'Provide private dump, plugin-source and out-dir paths');
 const html=await readFile(path.join(repo,'public/index.html'),'utf8');
 const publicConfig=jsonAssignment(html,'poslokerPayment');
 const cities=new Map();
 for(const option of html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)){
  const attrs=Object.fromEntries([...option[1].matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(m=>[m[1],decode(m[3])]));
  if(!attrs['data-rule']||!attrs.value)continue;
  const city={name:attrs.value,pricingKey:attrs['data-rule']};
  if(cities.has(city.name))ensure(cities.get(city.name).pricingKey===city.pricingKey,'Conflicting city pricing');
  cities.set(city.name,city);
 }
 ensure(cities.size>=40&&publicConfig.pricing?.default,'Incomplete public city catalog');
 const catalog={cities:[...cities.values()],pricing:publicConfig.pricing};
 for(const city of catalog.cities){
  if(!Object.hasOwn(catalog.pricing,city.pricingKey))city.pricingKey='default';
  ensure(Array.isArray(catalog.pricing[city.pricingKey]),'Invalid city rule');
 }
 for(const packages of Object.values(catalog.pricing))for(const item of packages)ensure(typeof item.id==='string'&&typeof item.name==='string'&&Number.isSafeInteger(item.price)&&item.price>=0&&Array.isArray(item.features),'Invalid public package');
 const prefix=args.prefix||'wpjj_';ensure(/^[a-zA-Z0-9_]+$/.test(prefix),'Invalid source prefix');
 const tables=parseMysqlDump(await readFile(args.dump,'utf8'),{includeTables:[prefix+'options']});
 const options=tables.get(prefix+'options');ensure(options,'Missing source options');
 const saved=options.rows.find(r=>r.option_name==='posloker_payment_settings');
 const settings=saved?parsePhpSerialized(saved.option_value):new Map();
 const source=await readFile(args['plugin-source'],'utf8');
 const defaultsText=source.slice(source.indexOf('function posloker_payment_defaults()'),source.indexOf('function posloker_payment_settings()'));
 const defaults=new Map([...defaultsText.matchAll(/'([a-z_]+)'\s*=>\s*(?:'([^']*)'|(\d+))/g)].map(m=>[m[1],m[2]??Number(m[3])]));
 const get=key=>settings.has(key)?settings.get(key):defaults.get(key);
 const payout={bankName:get('bank_name'),bankAccount:get('bank_account'),bankHolder:get('bank_holder'),whatsapp:String(get('whatsapp')).replace(/\D/g,''),maxUploadMb:Number(get('max_upload_mb'))};
 ensure(['bankName','bankAccount','bankHolder','whatsapp'].every(k=>typeof payout[k]==='string'&&payout[k].length>0),'Incomplete payment settings');
 ensure(payout.maxUploadMb>=1&&payout.maxUploadMb<=10,'Invalid proof size');
 let out=path.resolve(args['out-dir']);ensure(!inside(out,repo)&&!inside(out,outputs),'Checkout settings must stay private');
 await mkdir(out,{recursive:true});out=await realpath(out);ensure(!inside(out,repo)&&!inside(out,outputs),'Private directory resolves into public workspace');
 const config={catalog,payout,mode:'preview'};
 const hex=value=>"CAST(X'"+Buffer.from(value,'utf8').toString('hex')+"' AS TEXT)";
 const rows=[['catalog_json',JSON.stringify(catalog)],['payout_json',JSON.stringify(payout)],['mode',JSON.stringify('preview')]];
 const sql=rows.map(([key,value])=>(key==='mode'?'INSERT OR IGNORE':'INSERT')+' INTO commerce_settings(key,value_json) VALUES('+hex(key)+','+hex(value)+');').join(' ');
 ensure(Buffer.byteLength(sql)<70000&&/^[\x20-\x7e]+$/.test(sql),'Config batch exceeds console size');
 await writeFile(path.join(out,'checkout-config.private.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600});
 await writeFile(path.join(out,'checkout-config.private.sql'),sql,{mode:0o600});
 const manifest={cities:cities.size,pricingGroups:Object.keys(catalog.pricing).length,configurationSha256:createHash('sha256').update(JSON.stringify(config)).digest('hex'),sqlBytes:Buffer.byteLength(sql),sourceSavedSettingsFound:Boolean(saved),mode:'preview'};
 await writeFile(path.join(out,'checkout-config-manifest.private.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({cities:manifest.cities,pricingGroups:manifest.pricingGroups,sqlBytes:manifest.sqlBytes,sourceSavedSettingsFound:manifest.sourceSavedSettingsFound,mode:'preview'},null,2));
}catch{console.error('Checkout configuration preparation failed; source values not printed.');process.exitCode=1;}
