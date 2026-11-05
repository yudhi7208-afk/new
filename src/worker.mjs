import { handleAuth, requireAdmin, HttpError } from './admin-auth.mjs';
import { handleOrders, json } from './admin-orders.mjs';
import { handleCheckout } from './checkout.mjs';
import { handleBusiness } from './admin-business.mjs';
import { handlePublicSite } from './public-site.mjs';
import { handleLegacyReceipt } from './legacy-receipt.mjs';
import { PRIMARY_ORIGIN, WWW_HOST, handleSiteMetadata } from './site-policy.mjs';

export function protect(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function oldFormResponse() {
  return protect(new Response('<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Formulir telah diperbarui — PosLoker</title><link rel="stylesheet" href="/assets/fonts/manrope.css"><link rel="stylesheet" href="/checkout/checkout.css"></head><body><header class="header"><a class="brand" href="/">PosLoker</a></header><main class="page"><section class="panel"><h1>Formulir telah diperbarui.</h1><p>Pengiriman dari formulir lama ini belum diproses di Cloudflare.</p><p>Jika sudah melakukan transfer atau pernah mengirim pesanan, jangan membayar ulang atau membuat pesanan pengganti sebelum pengelola memeriksa pesanan Anda.</p><p>Hubungi pengelola melalui informasi kontak pada website dengan menyertakan nomor pesanan atau bukti transfer yang sudah ada.</p><p><a class="button" href="/pembayaran/">Buka halaman pemesanan</a></p><p><a href="/">Lihat kontak PosLoker</a> · <a href="/admin/">Masuk admin</a></p></section></main></body></html>', { status: 409, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === WWW_HOST || (url.hostname === new URL(PRIMARY_ORIGIN).hostname && url.protocol !== 'https:')) {
      // Do not forward in-flight multipart uploads, CSRF tokens or credentials
      // to another origin. A fresh GET starts checkout on the primary host.
      if (!['GET', 'HEAD'].includes(request.method)) return protect(json({ error: 'Muat ulang halaman pada https://posloker.my.id sebelum mengirim formulir.' }, 405));
      const target = new URL(PRIMARY_ORIGIN);
      target.pathname = url.pathname; target.search = url.search;
      // A missing fragment in Location deliberately preserves the browser's
      // existing receipt capability fragment across this same-site redirect.
      return protect(Response.redirect(target.href, 301));
    }
    const metadata = await handleSiteMetadata(request, env, url);
    if (metadata) return metadata;
    const oldAdminPath = /^\/wp-admin(?:\/|$)/.test(url.pathname) || url.pathname === '/wp-login.php';
    const oldAdminQuery = ['posloker_manage', 'posloker_proof', 'posloker_material', 'posloker_caption'].find(key => url.searchParams.has(key));
    if (oldAdminPath || (url.pathname === '/' && oldAdminQuery)) {
      if (url.pathname === '/wp-admin/admin-post.php' && request.method === 'POST') return oldFormResponse();
      if (!['GET', 'HEAD'].includes(request.method)) return protect(json({ error: 'Buka panel admin Cloudflare untuk melanjutkan.' }, 405));
      const candidate = oldAdminQuery === 'posloker_manage' ? url.searchParams.get('order') : url.searchParams.get(oldAdminQuery);
      const target = new URL('/admin/', url.origin);
      if (/^(?:[1-9]\d{0,14}|cf_[a-f0-9]{32})$/.test(candidate || '')) target.searchParams.set('order', candidate);
      return protect(Response.redirect(target.href, 302));
    }
    if (['/admin', '/pembayaran', '/konfirmasi-pembayaran'].includes(url.pathname)) {
      if (!['GET', 'HEAD'].includes(request.method)) return protect(json({ error: 'Muat ulang halaman sebelum melanjutkan.' }, 405));
      return protect(Response.redirect(url.origin + url.pathname + '/' + url.search, 302));
    }
    if (url.pathname.startsWith('/konfirmasi-pembayaran/')) {
      if (!['GET', 'HEAD'].includes(request.method)) return protect(json({ error: 'Metode tidak diizinkan.' }, 405));
      if (url.pathname === '/konfirmasi-pembayaran/' && url.searchParams.has('key')) {
        const target = new URL('/konfirmasi-pembayaran/', url.origin);
        if (/^[1-9]\d{0,14}$/.test(url.searchParams.get('order') || '')) target.searchParams.set('order', url.searchParams.get('order'));
        const key = url.searchParams.get('key') || '';
        if (key.length >= 16 && key.length <= 256 && !/[^\x21-\x7e]/.test(key)) target.hash = new URLSearchParams({ key }).toString();
        return protect(Response.redirect(target.href, 302));
      }
      return protect(await env.ASSETS.fetch(request));
    }
    if (url.pathname.startsWith('/api/legacy/')) {
      try { return protect(await handleLegacyReceipt(request, env, url) || json({ error: 'Halaman tidak ditemukan.' }, 404)); }
      catch (error) { return protect(json({ error: error instanceof HttpError ? error.message : 'Ringkasan belum dapat dibuka.' }, error instanceof HttpError ? error.status : 503)); }
    }
    if (url.pathname.startsWith('/pembayaran/') || url.pathname.startsWith('/checkout/')) {
      if (!['GET', 'HEAD'].includes(request.method)) return protect(json({ error: 'Metode tidak diizinkan.' }, 405));
      return protect(await env.ASSETS.fetch(request));
    }
    if (url.pathname.startsWith('/api/checkout/')) {
      try {
        return protect(await handleCheckout(request, env, url) || json({ error: 'Halaman tidak ditemukan.' }, 404));
      } catch (error) {
        return protect(json({ error: error instanceof HttpError ? error.message : 'Pemesanan belum siap. Coba lagi nanti.' }, error instanceof HttpError ? error.status : 503));
      }
    }
    if (url.pathname.startsWith('/admin/')) {
      if (!['GET', 'HEAD'].includes(request.method)) return protect(json({ error: 'Metode tidak diizinkan.' }, 405));
      return protect(await env.ASSETS.fetch(request));
    }
    if (url.pathname === '/api/admin' || url.pathname.startsWith('/api/admin/')) {
      try {
        const authResponse = await handleAuth(request, env, url);
        if (authResponse) return protect(authResponse);
        const auth = await requireAdmin(request, env);
        if (!auth) throw new HttpError(401, 'Silakan masuk sebagai admin.');
        return protect(await handleBusiness(request, env, url, auth) || await handleOrders(request, env, url, auth));
      } catch (error) {
        // Never expose database errors, SQL, source values, or stack traces.
        return protect(json({ error: error instanceof HttpError ? error.message : 'Layanan admin belum siap. Coba lagi nanti.' }, error instanceof HttpError ? error.status : 503));
      }
    }
    return await handlePublicSite(request, env, url) || env.ASSETS.fetch(request);
  },
};
