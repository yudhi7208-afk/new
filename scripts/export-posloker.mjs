import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Export public pages only. WordPress order handlers and customer data stay on
// the existing hosting until the backend is migrated separately.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const CACHE = process.env.POSLOKER_EXPORT_CACHE || path.join(ROOT, '.cache', 'posloker-source');
const SOURCE = 'https://posloker.my.id';
const assets = new Map();
const pagePaths = new Set(['/', '/area/']);
const pages = new Map();
const hashes = {};

function destination(directory, pathname) {
  const result = path.resolve(directory, '.' + decodeURIComponent(pathname));
  if (!result.startsWith(path.resolve(directory) + path.sep)) throw new Error('Unsafe path: ' + pathname);
  return result;
}

async function save(filename, content) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, content);
}

async function download(url) {
  const key = createHash('sha256').update(url).digest('hex');
  const cacheFile = path.join(CACHE, key);
  try { return await readFile(cacheFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36 PosLokerMigration/1.0' },
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const content = Buffer.from(await response.arrayBuffer());
  await save(cacheFile, content);
  return content;
}

async function parallel(items, operation) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) await operation(queue.shift());
  }));
}

function assetUrl(value, base = SOURCE) {
  if (!value || /^(?:data:|#)/i.test(value)) return value;
  const url = new URL(value, base);
  let local;
  if (url.origin === SOURCE && url.pathname.startsWith('/wp-content/')) local = url.pathname;
  else if (url.hostname === 'fonts.googleapis.com') local = '/assets/fonts/manrope.css';
  else if (url.hostname === 'fonts.gstatic.com') local = '/assets/fonts/' + path.posix.basename(url.pathname);
  else return value;
  if (!assets.has(url.href)) assets.set(url.href, local);
  return local;
}

function attributes(tag, names, callback) {
  return tag.replace(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g, (all, name, quote, value) =>
    names.includes(name.toLowerCase()) ? `${name}=${quote}${callback(value, name.toLowerCase())}${quote}` : all);
}

function transform(html, pathname) {
  // Tracker events and WP emoji/runtime discovery are unnecessary for this preview.
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (all, attrs, body) =>
    /posloker-insights|wp-emoji-settings|type=["']speculationrules/.test(attrs) ||
    body.includes('wpEmojiSettingsSupports') ? '' : all);
  html = html.replace(/<link\b[^>]*>/gi, tag => {
    if (/rel=["'](?:alternate|https:\/\/api\.w\.org\/|EditURI)["']/.test(tag)) return '';
    return attributes(tag, ['href'], value => assetUrl(value));
  });
  html = html.replace(/<meta\b[^>]*name=["']robots["'][^>]*>/gi,
    '<meta name="robots" content="noindex, nofollow">');
  html = html.replace(/<a\b[^>]*>/gi, tag => attributes(tag, ['href'], value => {
    const url = new URL(value.replaceAll('&amp;', '&'), SOURCE + pathname);
    if (url.origin === SOURCE && pagePaths.has(url.pathname)) {
      return (url.pathname + url.search + url.hash).replaceAll('&', '&amp;');
    }
    return value;
  }));
  html = html.replace(/<(?:img|source|script)\b[^>]*>/gi, tag => attributes(tag, ['src', 'srcset'], (value, name) => {
    if (name === 'srcset') return value.split(',').map(part => {
      const [url, ...size] = part.trim().split(/\s+/);
      return [assetUrl(url), ...size].join(' ');
    }).join(', ');
    return assetUrl(value);
  }));
  html = html.replace(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/g,
    (all, quote, value) => `url(${quote}${assetUrl(value)}${quote})`);
  if (/<form\b[^>]*(?:method=["']post["']|action=["'][^"']*admin-post)/i.test(html)) {
    throw new Error('A backend form must not be exported: ' + pathname);
  }
  html = html.replace('</head>', '<link rel="stylesheet" href="/assets/preview.css">\n</head>');
  html = html.replace(/(<body\b[^>]*>)/i, '$1\n<aside class="migration-preview" aria-label="Informasi pratinjau">' +
    '<strong>Pratinjau PosLoker</strong><span>Pesanan dan pembayaran dilanjutkan di ' +
    '<a href="https://posloker.my.id/">situs utama</a>.</span></aside>');
  return html.replace(/\r\n?/g, '\n').replace(/[\t ]+$/gm, '');
}

// The directory is the authoritative public list; exclude feeds and any backend.
const area = (await download(SOURCE + '/area/')).toString('utf8');
for (const match of area.matchAll(/<a\b[^>]*class=["'][^"']*location-card[^"']*["'][^>]*>/g)) {
  const href = match[0].match(/href=["']([^"']+)["']/)?.[1];
  if (!href) continue;
  const url = new URL(href, SOURCE);
  if (url.origin === SOURCE && /^\/area\/[a-z0-9-]+\/$/.test(url.pathname)) pagePaths.add(url.pathname);
}
if (pagePaths.size < 3) throw new Error('No city pages discovered. Check the public source before exporting.');
pages.set('/area/', area);
await parallel([...pagePaths].filter(p => p !== '/area/'), async pathname => {
  const html = (await download(SOURCE + pathname)).toString('utf8');
  if (!html.includes('posloker-premium')) throw new Error('Unexpected source page: ' + pathname);
  pages.set(pathname, html);
});
for (const pathname of [...pagePaths].sort()) {
  const html = transform(pages.get(pathname), pathname);
  await save(destination(PUBLIC, pathname + 'index.html'), html);
}

// Stylesheets may introduce font or image dependencies, so walk each new batch.
const completed = new Set();
while (completed.size < assets.size) {
  const batch = [...assets].filter(([url]) => !completed.has(url));
  await parallel(batch, async ([url, local]) => {
    let data = await download(url);
    if (local.endsWith('.css')) {
      const css = data.toString('utf8').replace(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/g,
        (all, quote, value) => `url(${quote}${assetUrl(value, url)}${quote})`);
      data = Buffer.from(css);
    }
    if (/\.(?:css|js|svg)$/.test(local)) {
      data = Buffer.from(data.toString('utf8').replace(/\r\n?/g, '\n').replace(/[\t ]+$/gm, '').trimEnd() + '\n');
    }
    await save(destination(PUBLIC, local), data);
    hashes[local] = createHash('sha256').update(data).digest('hex');
    completed.add(url);
  });
}

const manifest = {
  source: SOURCE,
  exportedAt: new Date().toISOString(),
  mode: 'Public static preview; orders and payment remain on the original hosting',
  cityCount: pagePaths.size - 2,
  pageCount: pagePaths.size,
  assetCount: completed.size,
  pages: [...pagePaths].sort(),
  assets: Object.fromEntries(Object.entries(hashes).sort()),
};
await save(path.join(ROOT, 'docs', 'migration-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ pages: manifest.pageCount, cities: manifest.cityCount, assets: manifest.assetCount }));
