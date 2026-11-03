// Repository public content only. Never reads operational settings or customer data.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { DATA_DEFAULTS } from '../../src/public-content-defaults.mjs';

const root = new URL('../../', import.meta.url);
const html = await readFile(new URL('public/index.html', root), 'utf8');
const cities = [...html.matchAll(/<option\b[^>]*value="([^"]+)"[^>]*data-rule="([^"]+)"[^>]*>/g)]
  .map(([, name, pricingKey]) => ({ name, pricingKey }));
if (!cities.length || new Set(cities.map(x => x.name)).size !== cities.length) throw Error('Cannot map public city options safely.');
const artifact = {
  schemaVersion: 1,
  source: 'repository-public-defaults',
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  generatedAt: new Date().toISOString(),
  productionVerified: false,
  notice: 'Referensi staging dari repository; harga aktif mengikuti ringkasan checkout, bukan snapshot ini.',
  catalog: { cities, pricing: DATA_DEFAULTS.pricing },
  contact: { url: `https://wa.me/${DATA_DEFAULTS.whatsapp}` },
};
await mkdir(new URL('../knowledge/', import.meta.url), { recursive: true });
await writeFile(new URL('../knowledge/catalog.json', import.meta.url), JSON.stringify(artifact, null, 2) + '\n');
console.log(JSON.stringify({ source: artifact.source, productionVerified: false, cities: cities.length }));
