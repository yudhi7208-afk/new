// Preview-only bridge, audited against the current vanilla checkout HTML.
// This module is NOT imported by production checkout. No request or submission API.
import { ownReceiptLink } from '../widget/navigation.mjs';
export const FIELD_MAP = Object.freeze({
  customerName: { id: 'customerName', label: 'Nama pemesan' },
  whatsapp: { id: 'customerWhatsapp', label: 'Nomor WhatsApp' },
  email: { id: 'customerEmail', label: 'Email' },
  adText: { id: 'adText', label: 'Teks Materi', maxLength: 2000 },
  caption: { id: 'caption', label: 'Caption' },
  notes: { id: 'notes', label: 'Catatan' },
  proofInput: { id: 'proofInput', label: 'Bukti transfer' },
  materialsInput: { id: 'materialsInput', label: 'Poster atau materi' },
});

export function createCheckoutAdapter(doc = document, location = globalThis.location) {
  let highlighted, timer;
  const visible = el => Boolean(el && !el.disabled && !el.closest('[hidden]'));
  function field(key) { return FIELD_MAP[key] && doc.getElementById(FIELD_MAP[key].id); }
  function snapshot() {
    const page = location.pathname.startsWith('/pembayaran') ? 'checkout' : 'home';
    const step = visible(doc.getElementById('receiptStep')) ? 3 : visible(doc.getElementById('confirmationStep')) ? 2 : 1;
    const query = new URLSearchParams(location.search);
    return { page: step === 3 ? 'receipt' : page, step, city: query.get('city') || undefined,
      packageId: query.get('package') || undefined,
      fields: { adText: { available: visible(field('adText')) && !doc.getElementById('orderFields')?.disabled && !field('adText')?.readOnly, value: field('adText')?.value || '' } } };
  }
  function clear() {
    if (highlighted) { highlighted.style.outline = highlighted.dataset.posiOldOutline || ''; highlighted.style.outlineOffset = highlighted.dataset.posiOldOffset || ''; delete highlighted.dataset.posiOldOutline; delete highlighted.dataset.posiOldOffset; }
    highlighted = null; clearTimeout(timer);
  }
  function highlight(key) {
    const el = field(key); if (!visible(el)) return { ok: false, error: 'Buka tahap Isi konfirmasi terlebih dahulu.' };
    clear(); highlighted = el; el.dataset.posiOldOutline = el.style.outline; el.dataset.posiOldOffset = el.style.outlineOffset;
    el.style.outline = '3px solid #d59b00'; el.style.outlineOffset = '4px';
    el.scrollIntoView({ behavior: 'auto', block: 'center' }); el.focus({ preventScroll: true });
    timer = setTimeout(clear, 7000); return { ok: true };
  }
  function applyDraft({ field: key, value, consent, overwrite = false, expectedValue } = {}) {
    if (key !== 'adText' || consent !== true || typeof value !== 'string' || !value.trim() || value.length > 2000) return { ok: false, error: 'Draft memerlukan persetujuan dan hanya dapat mengisi Teks Materi.' };
    const el = field(key);
    if (!visible(el) || el.readOnly || doc.getElementById('orderFields')?.disabled) return { ok: false, error: 'Formulir belum dapat diisi.' };
    // Compare-and-set: a draft cannot overwrite typing done after the approval view opened.
    if (typeof expectedValue !== 'string' || el.value !== expectedValue) return { ok: false, error: 'Teks Materi berubah. Periksa ulang draft sebelum menyetujui.' };
    if (el.value.trim() && overwrite !== true) return { ok: false, error: 'Teks Materi sudah terisi. Persetujuan penggantian diperlukan.' };
    el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    highlight(key); return { ok: true };
  }
  function guide(action) {
    if (FIELD_MAP[action]) return highlight(action);
    if (action === 'packages' || action === 'order') {
      const target = doc.getElementById('pilih-paket');
      if (target) { target.scrollIntoView({ behavior: 'auto', block: 'start' }); return { ok: true }; }
    }
    return { ok: false, error: 'Gunakan tombol di halaman untuk melanjutkan; POSI tidak mengirim pesanan.' };
  }
  function shouldYield() {
    const width = doc.documentElement?.clientWidth, height = doc.defaultView?.innerHeight;
    if (!width || !height) return false;
    // A conservative reserved rectangle includes the mascot, label and restore
    // button. Hide optional UI when an actual order control enters that space.
    const area = { left: width - 340, right: width, top: height - 380, bottom: height - 35 };
    return ['continueButton', 'submitButton', 'retrySubmitButton', 'renewSessionButton', 'refreshQuoteButton', 'whatsappButton', 'consent'].some(id => {
      const el = doc.getElementById(id);
      if (!visible(el) || !el.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.left < area.right && rect.right > area.left && rect.top < area.bottom && rect.bottom > area.top;
    });
  }
  function receiptLink() {
    if (!visible(doc.getElementById('receiptStep')) || !location.href || !location.origin) return '';
    return ownReceiptLink(location.href, location.origin);
  }
  return Object.freeze({ snapshot, highlight, applyDraft, guide, shouldYield, receiptLink, destroy: clear });
}
