(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const orderId = new URLSearchParams(location.search).get('order') || '';
  const capability = new URLSearchParams(location.hash.slice(1)).get('key') || '';
  const labels = { pending: 'Menunggu verifikasi', approved: 'Lunas', rejected: 'Ditolak' };
  let loading = false;
  // The existing capability stays in the fragment for reload/bookmark support.
  // It is never sent in a request URL, persisted in storage, or copied to links.
  async function loadReceipt() {
    if (loading) return;
    $('receiptView').hidden = true; $('receiptError').hidden = true; $('retryReceipt').hidden = true;
    if (!/^[1-9]\d{0,14}$/.test(orderId) || capability.length < 16 || capability.length > 256 || !/^[\x21-\x7e]+$/.test(capability)) {
      $('receiptStatus').textContent = '';
      $('receiptError').textContent = 'Tautan pesanan belum lengkap. Buka kembali tautan asli yang diterima setelah membuat pesanan.';
      $('receiptError').hidden = false; return;
    }
    loading = true; $('receiptStatus').textContent = 'Memeriksa tautan pesanan…';
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/legacy/receipt', { method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ orderId, key: capability }) });
      let result;
      try { result = await response.json(); } catch { throw new Error('Ringkasan belum dapat diperiksa. Coba lagi setelah beberapa saat.'); }
      if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'Ringkasan pesanan belum tersedia.');
      const order = result.order;
      if (!order || !Object.hasOwn(labels, order.status) || !Number.isSafeInteger(order.amount) || order.amount < 0) throw new Error('Ringkasan belum dapat diperiksa. Coba lagi setelah beberapa saat.');
      $('orderNumber').textContent = order.number || 'Pesanan PosLoker'; $('orderCity').textContent = order.city || '—'; $('orderPackage').textContent = order.packageName || '—';
      $('orderAmount').textContent = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(order.amount);
      $('orderState').textContent = labels[order.status]; $('orderState').className = 'status-badge status-' + order.status;
      $('receiptStatus').textContent = 'Ringkasan pesanan ditemukan.'; $('receiptView').hidden = false;
    } catch (error) {
      $('receiptStatus').textContent = '';
      $('receiptError').textContent = error.name === 'AbortError' || error instanceof TypeError ? 'Belum dapat terhubung. Periksa koneksi lalu coba kembali.' : error.message;
      $('receiptError').hidden = false; $('retryReceipt').hidden = false;
    } finally { clearTimeout(timeout); loading = false; }
  }
  $('retryReceipt').addEventListener('click', loadReceipt);
  loadReceipt();
})();
