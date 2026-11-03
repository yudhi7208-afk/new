import { mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises';

// Creates only ignored staging assets; never writes to public/ or production source.
const base = new URL('../', import.meta.url), dest = new URL('.preview-public/', base);
await mkdir(new URL('preview/', dest), { recursive: true });
await cp(new URL('widget/', base), new URL('widget/', dest), { recursive: true, filter: p => !p.endsWith('.test.mjs') });
await copyFile(new URL('preview/demo.html', base), new URL('index.html', dest));
for (const file of ['demo.css', 'demo.mjs']) await copyFile(new URL('preview/' + file, base), new URL(file, dest));
await copyFile(new URL('preview/checkout-adapter.mjs', base), new URL('preview/checkout-adapter.mjs', dest));
await writeFile(new URL('_headers', dest), "/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\n");
const loader = await readFile(new URL('widget/loader.mjs', dest), 'utf8');
if (!loader.includes('bootPosi')) throw Error('Widget loader missing.');
console.log('Isolated POSI preview assets prepared. Production assets unchanged.');
