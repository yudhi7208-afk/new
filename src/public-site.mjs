import { PAGE_DEFAULTS, DATA_DEFAULTS, PAYMENT_DEFAULTS, SITE_DEFAULTS } from './public-content-defaults.mjs';
import { readBusinessSettings } from './admin-business.mjs';
import { PRIMARY_ORIGIN, siteMode, canIndex } from './site-policy.mjs';

const pages = new Map(PAGE_DEFAULTS.map(page => [page.path, page]));
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const scriptJson = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const currency = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

export function pageDefault(pathname) { return pages.get(pathname) || null; }
export function effectivePublicContent(page, overrides = {}) {
  const content = { ...page };
  for (const field of ['title', 'description', 'heading', 'intro']) {
    if (overrides[field] !== null && overrides[field] !== undefined) {
      if (typeof overrides[field] !== 'string') throw new Error('Invalid public content.');
      content[field] = overrides[field];
    }
  }
  return content;
}
export function publicPackages(catalog, cityName) {
  const city = catalog.cities.find(city => city.name === cityName);
  return city ? catalog.pricing[city.pricingKey] || catalog.pricing.default || [] : [];
}
export function paymentPricing(catalog) {
  const result = { default: catalog.pricing.default || [] };
  for (const city of catalog.cities) {
    const slug = city.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    result[slug] = publicPackages(catalog, city.name);
  }
  return result;
}
export function packageCards(city, packages) {
  return packages.map(item => '<article class="city-package-card">' +
    (item.badge ? '<small>' + escape(item.badge) + '</small>' : '') +
    '<h3>' + escape(item.name) + '</h3><strong>' + escape(currency.format(item.price)) + '</strong><ul>' +
    item.features.map(feature => '<li>' + escape(feature) + '</li>').join('') + '</ul>' +
    '<a class="button button--full" href="/pembayaran/?' + escape(new URLSearchParams({ city, package: item.id }).toString()) + '">Order Sekarang →</a></article>').join('');
}
function contactList(site) {
  return (site.contactEmail ? '<li><a href="mailto:' + escape(site.contactEmail) + '">' + escape(site.contactEmail) + '</a></li>' : '') +
    (site.instagramUrl ? '<li><a href="' + escape(site.instagramUrl) + '" target="_blank" rel="noopener noreferrer">Instagram</a></li>' : '') +
    (site.facebookUrl ? '<li><a href="' + escape(site.facebookUrl) + '" target="_blank" rel="noopener noreferrer">Facebook</a></li>' : '');
}
export function publicStructuredData(page, content, settings) {
  const data = structuredClone(page.structuredData);
  const packages = publicPackages(settings.catalog, page.label);
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value['@type'] === 'Organization') value.telephone = '+' + settings.payout.whatsapp;
    if (value['@type'] === 'Service') {
      value.name = content.heading; value.description = content.description;
      value.offers = packages.map(item => ({ '@type': 'Offer', name: item.name, price: String(item.price), priceCurrency: 'IDR', availability: 'https://schema.org/InStock', url: 'https://posloker.my.id' + page.path }));
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') Array.isArray(child) ? child.forEach(visit) : visit(child);
  }
  visit(data);
  return data;
}
export function rewritePublicHtml(asset, page, content, settings, { index = false, live = false } = {}) {
  const site = { ...SITE_DEFAULTS, ...settings.site };
  const data = { ...DATA_DEFAULTS, pricing: settings.catalog.pricing, whatsapp: settings.payout.whatsapp, paymentUrl: '/pembayaran/' };
  const payment = { ...PAYMENT_DEFAULTS, pricing: paymentPricing(settings.catalog), currentCity: page.path.startsWith('/area/') && page.path !== '/area/' ? page.label : '', checkoutUrl: '/pembayaran/', confirmationUrl: '/pembayaran/', autoWhatsapp: false };
  const rewriter = new HTMLRewriter()
    .on('meta[name="robots"]', { element: el => el.setAttribute('content', index ? 'index, follow' : 'noindex, nofollow') })
    .on('link[rel="canonical"]', { element: el => el.setAttribute('href', PRIMARY_ORIGIN + page.path) })
    .on('meta[property="og:url"]', { element: el => el.setAttribute('content', PRIMARY_ORIGIN + page.path) })
    .on('title', { element: el => el.setInnerContent(content.title) })
    .on('meta[name="description"],meta[property="og:description"],meta[name="twitter:description"]', { element: el => el.setAttribute('content', content.description) })
    .on('meta[property="og:title"],meta[name="twitter:title"]', { element: el => el.setAttribute('content', content.title) })
    .on('script[data-posloker-config="poslokerData"]', { element: el => el.setInnerContent('var poslokerData = ' + scriptJson(data) + ';', { html: true }) })
    .on('script[data-posloker-config="poslokerPayment"]', { element: el => el.setInnerContent('var poslokerPayment = ' + scriptJson(payment) + ';', { html: true }) })
    .on('script[type="application/ld+json"]', { element: el => el.setInnerContent(scriptJson(publicStructuredData(page, content, settings)), { html: true }) })
    .on('option[data-rule]', { element(el) {
      const city = settings.catalog.cities.find(city => city.name === el.getAttribute('value'));
      if (city) el.setAttribute('data-rule', city.pricingKey);
    } })
    .on('[data-site-contact-list]', { element: el => el.setInnerContent(contactList(site), { html: true }) })
    .on('a[href^="https://wa.me/"],a[href^="https://api.whatsapp.com/"]', { element(el) {
      const previous = new URL(el.getAttribute('href'));
      const target = new URL('https://wa.me/' + settings.payout.whatsapp);
      if (previous.searchParams.has('text')) target.searchParams.set('text', previous.searchParams.get('text'));
      el.setAttribute('href', target.href);
    } });
  // The service mode is shared by both origins; live receipts remain usable
  // on workers.dev without falsely describing real transactions as simulation.
  if (live) rewriter.on('.migration-preview', { element: el => el.remove() });
  // Preserve source emphasis while fields have their original values.
  if (content.heading !== page.heading) rewriter.on(page.selectors.heading, { element: el => el.setInnerContent(content.heading) });
  if (content.intro !== page.intro) rewriter.on(page.selectors.intro, { element: el => el.setInnerContent(content.intro) });
  if (page.path.startsWith('/area/') && page.path !== '/area/') rewriter.on('.city-package-grid', { element: el => el.setInnerContent(packageCards(page.label, publicPackages(settings.catalog, page.label)), { html: true }) });
  return rewriter.transform(asset);
}
export async function handlePublicSite(request, env, url) {
  const page = pageDefault(url.pathname);
  if (!page) return null;
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Metode tidak diizinkan.', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const assetHeaders = new Headers(request.headers);
  assetHeaders.delete('If-None-Match'); assetHeaders.delete('If-Modified-Since');
  const asset = await env.ASSETS.fetch(new Request(request.url, { method: 'GET', headers: assetHeaders }));
  if (asset.status !== 200 || !asset.headers.get('content-type')?.includes('text/html')) return asset;
  try {
    const mode = await siteMode(env), index = canIndex(url, mode);
    const settings = await readBusinessSettings(env.CUSTOMER_DB);
    const saved = await env.CUSTOMER_DB.prepare('SELECT data_json FROM page_content WHERE path=?').bind(page.path).first();
    const content = effectivePublicContent(page, saved ? JSON.parse(saved.data_json) : {});
    const response = rewritePublicHtml(asset, page, content, settings, { index, live: mode === 'live' });
    const headers = new Headers(response.headers);
    headers.delete('Content-Length'); headers.delete('ETag'); headers.delete('Last-Modified');
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    // Override the static asset's fail-closed preview header only for known
    // public pages on the HTTPS primary origin after live mode is enabled.
    headers.set('X-Robots-Tag', index ? 'index, follow' : 'noindex, nofollow');
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
  } catch {
    // Never silently display stale prices when operational settings cannot load.
    return new Response('Layanan sedang diperbarui. Silakan coba beberapa saat lagi.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '30', 'X-Robots-Tag': 'noindex, nofollow' } });
  }
}
