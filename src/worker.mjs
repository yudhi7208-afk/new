import { handleAuth, requireAdmin, HttpError } from './admin-auth.mjs';
import { handleOrders, json } from './admin-orders.mjs';

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/admin') return protect(Response.redirect(url.origin + '/admin/', 302));
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
        return protect(await handleOrders(request, env, url, auth));
      } catch (error) {
        // Never expose database errors, SQL, source values, or stack traces.
        return protect(json({ error: error instanceof HttpError ? error.message : 'Layanan admin belum siap. Coba lagi nanti.' }, error instanceof HttpError ? error.status : 503));
      }
    }
    return env.ASSETS.fetch(request);
  },
};
