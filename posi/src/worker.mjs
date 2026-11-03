import snapshot from '../knowledge/catalog.json' with { type: 'json' };
import { DEFAULT_GREETING, FALLBACK, QUICK_REPLIES, safeContact, detectIntent, prohibitedRequest, ruleReply } from './knowledge.mjs';
import { createClassifier } from './ai.mjs';
import { reserveAiBudget } from './budget.mjs';
export { PosiAiBudget } from './budget.mjs';

const MAX_BYTES = 4096;
const MAX_MESSAGE = 1200;
const PAGES = new Set(['home', 'packages', 'checkout', 'form', 'receipt']);
const BLOCKED_ORIGINS = new Set(['https://posloker.my.id', 'https://www.posloker.my.id', 'https://new.yudhi7208.workers.dev']);
function enabled(value) { return value === true || value === 'true'; }
function allowedOrigins(env) {
  const values = (env.POSI_ALLOWED_ORIGINS || 'http://127.0.0.1:8788,http://localhost:8788,http://127.0.0.1:8789,http://localhost:8789,http://127.0.0.1:8790,http://localhost:8790,https://new-posi-staging.yudhi7208.workers.dev').split(',');
  return new Set(values.map(value => value.trim()).filter(value => {
    try { const url = new URL(value); return url.origin === value && !BLOCKED_ORIGINS.has(value) && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))); } catch { return false; }
  }));
}
function response(body, status, origin, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'Vary': 'Origin',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}), ...headers,
  } });
}
async function readInput(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw Object.assign(new Error('Gunakan JSON.'), { status: 415 });
  const length = Number(request.headers.get('content-length'));
  if (length > MAX_BYTES) throw Object.assign(new Error('Pesan terlalu panjang.'), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('Pesan belum diisi.'), { status: 400 });
  let total = 0; const chunks = [];
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; total += value.byteLength; if (total > MAX_BYTES) { await reader.cancel(); throw Object.assign(new Error('Pesan terlalu panjang.'), { status: 413 }); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  let input;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw Object.assign(new Error('Format pesan tidak valid.'), { status: 400 }); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['message', 'context'].includes(key)) || typeof input.message !== 'string' || !input.message.trim() || input.message.length > MAX_MESSAGE || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input.message)) throw Object.assign(new Error('Pesan tidak valid atau melebihi 1.200 karakter.'), { status: 400 });
  const context = input.context ?? {};
  if (!context || typeof context !== 'object' || Array.isArray(context) || Object.keys(context).some(key => !['page', 'city', 'packageId', 'step'].includes(key)) || (context.page !== undefined && !PAGES.has(context.page)) || (context.step !== undefined && ![1, 2, 3].includes(context.step)) || ['city', 'packageId'].some(key => context[key] !== undefined && (typeof context[key] !== 'string' || !/^[\p{L}\p{N} ._\-]{1,100}$/u.test(context[key])))) throw Object.assign(new Error('Konteks halaman tidak valid.'), { status: 400 });
  return { message: input.message.trim(), context };
}
async function bucketKey(request) {
  // No raw IP or chat data is logged or persisted. Keys expire in the platform
  // limiter. No user-supplied X-Forwarded-For is trusted.
  const input = 'posi-staging-v1:' + (request.headers.get('CF-Connecting-IP') || 'local');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export function createPosiWorker({ knowledge = snapshot, now = Date.now, timeoutMs = 8000 } = {}) {
  const classify = createClassifier({ now, timeoutMs });
  const localRates = new Map();
  async function rateAllowed(request, env) {
    const key = await bucketKey(request);
    if (env.POSI_RATE_LIMITER?.limit) {
      try { return (await env.POSI_RATE_LIMITER.limit({ key })).success === true; } catch { return false; }
    }
    // Local development only: a deployed staging Worker must have a platform
    // binding and cannot silently fall back to per-isolate rate limiting.
    if (!['localhost', '127.0.0.1'].includes(new URL(request.url).hostname)) return false;
    const minute = Math.floor(now() / 60000); const entry = localRates.get(key);
    if (!entry || entry.minute !== minute) {
      if (localRates.size >= 1024) localRates.clear();
      localRates.set(key, { minute, count: 1 }); return true;
    }
    return ++entry.count <= 20;
  }
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url), origin = request.headers.get('Origin');
      const permitted = origin && allowedOrigins(env).has(origin) ? origin : null;
      if (origin && !permitted) return response({ error: 'Origin tidak diizinkan.' }, 403, null);
      if (request.method === 'OPTIONS') {
        if (!permitted) return response({ error: 'Origin diperlukan.' }, 403, null);
        return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': permitted, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '300', 'Vary': 'Origin' } });
      }
      if (url.pathname === '/api/posi/config') {
        if (request.method !== 'GET') return response({ error: 'Metode tidak diizinkan.' }, 405, permitted, { Allow: 'GET' });
        const on = enabled(env.POSI_ENABLED);
        const greeting = typeof env.POSI_GREETING === 'string' && env.POSI_GREETING.length <= 300 ? env.POSI_GREETING : DEFAULT_GREETING;
        return response({ enabled: on, version: 'posi-phase1', ...(on ? { greeting, contact: safeContact(knowledge), suggestions: [...QUICK_REPLIES], aiEnabled: enabled(env.POSI_AI_ENABLED), knowledge: { productionVerified: knowledge.productionVerified === true, generatedAt: knowledge.generatedAt || null } } : {}) }, 200, permitted);
      }
      if (url.pathname !== '/api/posi/chat') {
        // Only isolated preview assets are served here. Unknown API paths never
        // proxy to any checkout, admin, production Worker or origin.
        if (!url.pathname.startsWith('/api/') && ['GET', 'HEAD'].includes(request.method) && env.ASSETS?.fetch) {
          const asset = await env.ASSETS.fetch(request);
          const headers = new Headers(asset.headers);
          headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
          headers.set('Referrer-Policy', 'no-referrer');
          headers.set('X-Content-Type-Options', 'nosniff');
          headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
          return new Response(asset.body, { status: asset.status, headers });
        }
        return response({ error: 'Halaman tidak ditemukan.' }, 404, permitted);
      }
      if (request.method !== 'POST') return response({ error: 'Metode tidak diizinkan.' }, 405, permitted, { Allow: 'POST' });
      if (!permitted) return response({ error: 'Origin diperlukan.' }, 403, null);
      if (!enabled(env.POSI_ENABLED)) return response({ error: 'POSI nonaktif.', reply: FALLBACK, source: 'fallback' }, 503, permitted);
      if (!(await rateAllowed(request, env))) return response({ error: 'Terlalu banyak permintaan. Coba sebentar lagi.', reply: FALLBACK, source: 'fallback' }, 429, permitted, { 'Retry-After': '60' });
      try {
        const { message, context } = await readInput(request);
        if (prohibitedRequest(message)) return response({ reply: 'Saya hanya membantu penjelasan dan draft materi. Saya tidak dapat mengubah harga, pembayaran, order, data pelanggan, atau konfigurasi admin. Anda tetap mengirim pesanan sendiri melalui formulir.', source: 'rules', suggestions: [...QUICK_REPLIES] }, 200, permitted);
        let intent = detectIntent(message), source = 'rules';
        if (intent === 'unknown' && enabled(env.POSI_AI_ENABLED)) {
          let aiAllowed = false;
          try { aiAllowed = Boolean(env.POSI_AI_RATE_LIMITER?.limit && (await env.POSI_AI_RATE_LIMITER.limit({ key: 'posi-staging-ai-global' })).success); } catch { /* fail closed; FAQ remains available */ }
          if (aiAllowed && await reserveAiBudget(env)) { const interpreted = await classify(message, env); if (interpreted) { intent = interpreted; source = 'ai'; } else source = 'fallback'; }
          else source = 'fallback';
        }
        // An inferred intent is not evidence that a support question contains
        // actual vacancy material. Ask for details instead of copying that
        // question into an applicable form draft. Explicit draft requests keep
        // their existing rule-based preview and approval flow.
        if (source === 'ai' && intent === 'draft') return response({
          reply: 'Saya bisa membantu menyusun Teks Materi. Apa posisi pekerjaan dan lokasi kerjanya? Setelah itu kita lengkapi persyaratan serta cara melamar dari informasi Anda. Materi desain ditempatkan di Teks Materi, bukan Caption.',
          source,
        }, 200, permitted);
        const answer = ruleReply(intent, message, context, knowledge, now());
        return response({ ...answer, source, ...(source === 'fallback' && intent === 'unknown' ? { reply: FALLBACK + '\n' + answer.reply } : {}) }, 200, permitted);
      } catch (error) {
        return response({ error: error?.status ? error.message : 'Bantuan sementara tidak tersedia.', reply: FALLBACK, source: 'fallback' }, error?.status || 503, permitted);
      }
    },
  };
}
export default createPosiWorker();
