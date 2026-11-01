import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function decode(value) {
  return value.replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)))
    .replace(/&(amp|quot|apos|lt|gt|nbsp|mdash|ndash);/g, (_, n) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', mdash: '—', ndash: '–' })[n]);
}
const plain = value => decode(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());

export async function preparePublicContent() {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'docs/migration-manifest.json'), 'utf8'));
  const pages = [];
  let data, payment, site;
  for (const pathname of manifest.pages) {
    const filename = path.join(ROOT, 'public', pathname, 'index.html');
    let html = await readFile(filename, 'utf8');
    const title = plain(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
    const description = decode(html.match(/<meta name="description" content="([^"]*)"/i)?.[1] || '');
    const kind = pathname === '/' ? 'home' : pathname === '/area/' ? 'directory' : 'city';
    const hero = html.slice(html.indexOf(kind === 'home' ? '<div class="hero-copy">' : kind === 'directory' ? '<section class="page-hero' : '<div class="location-hero__copy">'));
    const heading = plain(hero.match(/<h1>([\s\S]*?)<\/h1>/i)?.[1] || '');
    const intro = plain(hero.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
    if (!title || !heading || !intro) throw new Error('Public content is incomplete: ' + pathname);
    const structuredData = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)?.[1] || '{}');
    const selectors = kind === 'home' ? { heading: '.hero-copy h1', intro: '.hero-lead' } : kind === 'directory' ? { heading: '.page-hero h1', intro: '.page-hero p' } : { heading: '.location-hero__copy h1', intro: '.location-hero__copy p' };
    const label = kind === 'home' ? 'Beranda' : kind === 'directory' ? 'Direktori kota' : heading.replace(/^Jasa Posting Lowongan Kerja\s+/i, '');
    pages.push({ path: pathname, label, title, description, heading, intro, selectors, structuredData });
    html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (whole, attributes, body) => {
      const match = body.match(/\bvar (poslokerData|poslokerPayment)\s*=\s*(\{[^\n]*\});/);
      if (!match) return whole;
      const value = JSON.parse(match[2]);
      if (pathname === '/') { if (match[1] === 'poslokerData') data = value; else payment = value; }
      const cleaned = attributes.replace(/\sdata-posloker-config="[^"]*"/g, '');
      return `<script${cleaned} data-posloker-config="${match[1]}">${body}</script>`;
    });
    html = html.replace(/(<h2>Hubungi<\/h2>\s*<ul)([^>]*>)/i, (_, open, attributes) => open + ' data-site-contact-list' + attributes.replace(/\sdata-site-contact-list(?:="[^"]*")?/g, ''));
    if (pathname === '/') {
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => decode(m[1]));
      site = {
        contactEmail: (hrefs.find(h => h.startsWith('mailto:')) || 'mailto:').slice(7),
        instagramUrl: hrefs.find(h => /^https:\/\/(?:www\.)?instagram\.com\//.test(h)) || '',
        facebookUrl: hrefs.find(h => /^https:\/\/(?:www\.)?facebook\.com\//.test(h)) || '',
      };
    }
    await writeFile(filename, html);
  }
  if (!data?.pricing || !payment?.pricing || pages.length !== 51) throw new Error('Unexpected public source catalogue.');
  const content = '// Generated from public assets only; contains no customer data or credentials.\n' +
    `export const PAGE_DEFAULTS = ${JSON.stringify(pages, null, 2)};\n` +
    `export const DATA_DEFAULTS = ${JSON.stringify(data, null, 2)};\n` +
    `export const PAYMENT_DEFAULTS = ${JSON.stringify(payment, null, 2)};\n` +
    `export const SITE_DEFAULTS = ${JSON.stringify(site, null, 2)};\n`;
  await writeFile(path.join(ROOT, 'src/public-content-defaults.mjs'), content);
  const runtimePath = '/wp-content/themes/posloker-premium/assets/js/main.js';
  const runtimeFile = path.join(ROOT, 'public', runtimePath);
  let runtime = await readFile(runtimeFile, 'utf8');
  runtime = runtime.replace(/\t\tObject\.keys\(pricing\)\.forEach\(function \(cityRule\) \{\n[\s\S]*?\n\t\t\}\);\n/, '\t\t// Package features follow the saved business catalogue.\n');
  if (runtime.includes("features.push('Instagram Carousel hingga 10 slide')")) throw new Error('Unexpected legacy catalogue mutation.');
  await writeFile(runtimeFile, runtime);
  manifest.assets[runtimePath] = createHash('sha256').update(runtime).digest('hex');
  await writeFile(path.join(ROOT, 'docs/migration-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { pages: pages.length, globals: ['poslokerData', 'poslokerPayment'] };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await preparePublicContent()));
