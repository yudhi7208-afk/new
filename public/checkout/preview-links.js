// Public navigation only. Customer data and credentials never enter this file.
(() => {
  'use strict';
  function localCheckout(value) {
    const url = new URL(value, location.origin);
    if (![location.origin, 'https://posloker.my.id'].includes(url.origin) || !['/pembayaran/', '/pembayaran', '/konfirmasi-pembayaran/'].includes(url.pathname)) return null;
    const target = new URL('/pembayaran/', location.origin);
    for (const key of ['city', 'package']) if (url.searchParams.has(key)) target.searchParams.set(key, url.searchParams.get(key));
    return target.pathname + target.search;
  }
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = localCheckout(anchor.getAttribute('href'));
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation(); location.assign(target);
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    if (!window.poslokerData && window.poslokerPayment) window.poslokerData = { pricing: window.poslokerPayment.pricing, paymentUrl: '/pembayaran/' };
    if (window.poslokerData) window.poslokerData.paymentUrl = '/pembayaran/';
    if (window.poslokerPayment) { window.poslokerPayment.checkoutUrl = '/pembayaran/'; window.poslokerPayment.confirmationUrl = '/pembayaran/'; }
    for (const anchor of document.querySelectorAll('a[href]')) {
      const target = localCheckout(anchor.getAttribute('href'));
      if (target) anchor.setAttribute('href', target);
    }
  }, { once: true });
})();
