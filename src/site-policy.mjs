import { PAGE_DEFAULTS } from './public-content-defaults.mjs';

// This project serves PosLoker only. Never infer a canonical origin from Host.
export const PRIMARY_ORIGIN = 'https://posloker.my.id';
export const WWW_HOST = 'www.posloker.my.id';

export async function siteMode(env) {
  const row = await env.CUSTOMER_DB.prepare("SELECT value_json FROM commerce_settings WHERE key='mode'").first();
  const mode = row ? JSON.parse(row.value_json) : 'preview';
  if (!['preview', 'live'].includes(mode)) throw new Error('Invalid site mode.');
  return mode;
}

export function canIndex(url, mode) { return url.origin === PRIMARY_ORIGIN && mode === 'live'; }

export async function handleSiteMetadata(request, env, url) {
  if (!['/robots.txt', '/sitemap.xml', '/wp-sitemap.xml'].includes(url.pathname)) return null;
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' };
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Metode tidak diizinkan.', { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  try {
    const index = canIndex(url, await siteMode(env));
    if (url.pathname === '/robots.txt') {
      headers['Content-Type'] = 'text/plain; charset=utf-8';
      const body = index ? 'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /checkout/\nDisallow: /pembayaran\nDisallow: /konfirmasi-pembayaran\nDisallow: /wp-admin\nDisallow: /wp-login.php\nSitemap: ' + PRIMARY_ORIGIN + '/sitemap.xml\n' : 'User-agent: *\nDisallow: /\n';
      return new Response(request.method === 'HEAD' ? null : body, { headers });
    }
    if (!index) return new Response(request.method === 'HEAD' ? null : 'Halaman tidak ditemukan.', { status: 404, headers });
    headers['Content-Type'] = 'application/xml; charset=utf-8';
    const body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      PAGE_DEFAULTS.map(page => '<url><loc>' + PRIMARY_ORIGIN + page.path + '</loc></url>').join('\n') + '\n</urlset>\n';
    return new Response(request.method === 'HEAD' ? null : body, { headers });
  } catch {
    return new Response(request.method === 'HEAD' ? null : 'Layanan sedang diperbarui.', { status: 503, headers: { ...headers, 'Retry-After': '30' } });
  }
}
