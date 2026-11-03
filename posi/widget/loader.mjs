/** Opt-in bootstrap. Do not include in production until owner approval. */
export async function bootPosi(options = {}) {
  const inactive = { enabled: false, destroy() {} };
  // The flag is deliberately strict: strings, missing values and 'false' do not opt in.
  if (options.enabled !== true) return inactive;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const endpoint = new URL('/api/posi/config', options.apiBase || globalThis.location?.origin);
    if (!['http:', 'https:'].includes(endpoint.protocol)) return inactive;
    const response = await (options.fetcher || fetch)(endpoint.href, {
      signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) return inactive;
    const config = await response.json();
    if (config?.enabled !== true) return inactive;
    const { mountPosi } = await (options.importWidget || (() => import('./widget.mjs')))();
    return mountPosi({ ...options, config });
  } catch {
    // A broken optional assistant must never prevent the page from starting.
    return inactive;
  } finally { clearTimeout(timer); }
}
