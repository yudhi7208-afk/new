export const QUICK_OPTIONS = Object.freeze([
  'Pasang Lowongan', 'Cara Mengisi Formulir', 'Keuntungan PosLoker',
  'Harga dan Paket', 'Bantuan Desain Gratis', 'Hubungi Admin',
]);

export function safeContext(snapshot = {}) {
  const result = { page: ['home', 'packages', 'checkout', 'form', 'receipt'].includes(snapshot.page) ? snapshot.page : 'home' };
  for (const key of ['city', 'packageId']) {
    if (typeof snapshot[key] === 'string' && snapshot[key].length <= 100) result[key] = snapshot[key];
  }
  if ([1, 2, 3].includes(snapshot.step)) result.step = snapshot.step;
  return result;
}

export function safeContactUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'wa.me' && /^\/\d{10,15}\/?$/.test(url.pathname) && !url.username && !url.password && !url.search && !url.hash ? url.href : '';
  } catch { return ''; }
}

export function validDraft(value) {
  return typeof value?.adText === 'string' && value.adText.trim().length > 0 && value.adText.length <= 2000
    && Object.keys(value).every(key => key === 'adText') ? { adText: value.adText } : null;
}

export function localAnswer(message) {
  const text = message.toLowerCase();
  if (/desain|poster|teks materi/.test(text)) return 'Belum punya poster? Tuliskan informasi lowongan di kolom Teks Materi, bukan Caption. Cantumkan posisi, lokasi, persyaratan, dan cara melamar sesuai informasi Anda. Jangan menambahkan data yang belum pasti.';
  if (/harga|paket|biaya|kota|instagram|facebook/.test(text)) return 'Harga dan kanal mengikuti pilihan kota serta paket resmi di website. Periksa daftar paket dan ringkasan order yang tampil. Saya tidak dapat memastikan harga saat layanan bantuan sedang tidak terhubung.';
  if (/manfaat|keuntungan/.test(text)) return 'PosLoker membantu penyebaran lowongan melalui kanal yang tersedia sesuai paket. Anda dapat memilih kota, menyiapkan materi, dan mengirim pemesanan. Jumlah pelamar atau hasil rekrutmen tidak dijamin.';
  if (/admin|hubungi|kontak/.test(text)) return 'Anda dapat menghubungi admin melalui tombol WhatsApp resmi pada website. Jangan kirim kata sandi, bukti transfer, atau data pribadi ke chat POSI.';
  if (/bayar|transfer|konfirmasi|kode unik/.test(text)) return 'Ikuti nominal dan kode unik pada ringkasan order. Setelah transfer, lengkapi formulir dan bukti, lalu tekan Kirim konfirmasi & materi sendiri. Jika sudah transfer, jangan membayar ulang; hubungi admin bila perlu.';
  if (/formulir|mengisi/.test(text)) return 'Isi nama dan WhatsApp pada formulir. Siapkan bukti transfer jika paket berbayar, lalu unggah poster atau isi Teks Materi. Periksa ringkasan dan tekan tombol kirim sendiri. Saya bisa memandu satu kolom setiap langkah.';
  return 'Pilih kota dan paket di website terlebih dahulu. Sesudah Checkout, periksa ringkasan order. Anda tetap dapat melanjutkan formulir meski POSI sedang tidak terhubung. Mau dibantu memahami Teks Materi?';
}

export async function requestReply({ apiBase, message, context, fetcher = fetch, timeoutMs = 10000, signal }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetcher(new URL('/api/posi/chat', apiBase || globalThis.location?.origin).href, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ message, context: safeContext(context) }), credentials: 'omit', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: controller.signal,
    });
    if (!response.ok) throw new Error('Layanan bantuan tidak tersedia.');
    const value = await response.json();
    if (typeof value?.reply !== 'string' || value.reply.length > 4000 || !value.reply.trim()) throw new Error('Respons tidak valid.');
    const contactUrl = safeContactUrl(value.contact?.whatsappUrl);
    return { reply: value.reply, source: value.source, draft: validDraft(value.draft), contact: contactUrl ? { whatsappUrl: contactUrl } : null };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
