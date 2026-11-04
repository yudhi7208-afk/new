// Model responses select identifiers, never executable URLs or receipt tokens.
export const HELP_LINKS = Object.freeze({
  'how-to-order': { label: 'Cara memasang lowongan', href: '/panduan/#cara-memasang' },
  'check-order': { label: 'Cek order saya', href: '/panduan/#cek-order' },
  'confirm-payment': { label: 'Konfirmasi pembayaran', href: '/panduan/#konfirmasi-pembayaran' },
});
export function safeHelpIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 6).filter(item => item && typeof item === 'object' && Object.keys(item).length === 1 && Object.hasOwn(HELP_LINKS, item.id)).map(item => item.id))];
}
export function ownReceiptLink(candidate, origin) {
  try {
    const url = new URL(candidate, origin);
    if (url.origin !== origin || url.username || url.password || url.pathname !== '/pembayaran/') return '';
    if ([...url.searchParams.keys()].join(',') !== 'order' || !/^cf_[a-f0-9]{32}$/.test(url.searchParams.get('order') || '')) return '';
    const hash = new URLSearchParams(url.hash.slice(1));
    if ([...hash.keys()].join(',') !== 'key' || !/^[a-f0-9]{64}$/.test(hash.get('key') || '')) return '';
    return url.href;
  } catch { return ''; }
}
export function helpLink(id, { origin = globalThis.location?.origin, receiptUrl } = {}) {
  if (!Object.hasOwn(HELP_LINKS, id)) return null;
  const item = HELP_LINKS[id];
  const receipt = id === 'check-order' && receiptUrl ? ownReceiptLink(receiptUrl, origin) : '';
  return { ...item, href: receipt || new URL(item.href, origin).href, private: Boolean(receipt) };
}
