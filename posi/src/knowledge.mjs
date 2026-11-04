import snapshot from '../knowledge/catalog.json' with { type: 'json' };

export const INTENTS = Object.freeze(['packages', 'design', 'form', 'steps', 'benefits', 'admin', 'draft', 'payment', 'check-order', 'unknown']);
export const QUICK_REPLIES = Object.freeze(['Cara Memasang', 'Cek Order', 'Konfirmasi Pembayaran', 'Cara Mengisi Formulir', 'Harga dan Paket', 'Bantuan Desain Gratis', 'Hubungi Admin']);
export const DEFAULT_GREETING = 'Halo! 👋 Saya POSI, asisten PosLoker. Bingung memasang lowongan? Saya bantu satu langkah setiap kali, ya.';
export const FALLBACK = 'Bantuan AI sedang tidak tersedia. Formulir tetap dapat digunakan. Pilih bantuan di bawah atau hubungi admin; jangan kirim kata sandi atau bukti transfer melalui chat ini.';

function normal(value) { return String(value || '').normalize('NFKC').toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
export function safeContact(knowledge = snapshot) {
  const value = knowledge?.contact?.url;
  return typeof value === 'string' && /^https:\/\/wa\.me\/\d{10,15}$/.test(value) ? { whatsappUrl: value } : null;
}
export function catalogView(knowledge = snapshot, context = {}, message = '', now = Date.now()) {
  const data = knowledge?.catalog;
  if (!data || !Array.isArray(data.cities) || !data.pricing || typeof data.pricing !== 'object') return null;
  const named = normal(context.city);
  const text = ' ' + normal(message) + ' ';
  const city = data.cities.find(item => item && typeof item.name === 'string' && named && normal(item.name) === named) ||
    [...data.cities].filter(item => typeof item?.name === 'string').sort((a, b) => b.name.length - a.name.length).find(item => text.includes(' ' + normal(item.name) + ' '));
  if (!city) return { cities: data.cities.map(item => item?.name).filter(value => typeof value === 'string'), city: null, packages: [] };
  const items = Object.hasOwn(data.pricing, city.pricingKey) ? data.pricing[city.pricingKey] : data.pricing.default;
  const packages = Array.isArray(items) ? items.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && Number.isSafeInteger(item.price) && item.price >= 0 && Array.isArray(item.features)) : [];
  const generated = Date.parse(knowledge.generatedAt);
  const fresh = Number.isFinite(generated) && now >= generated - 300000 && now - generated < 86400000;
  return { city: city.name, packages, fresh, verified: knowledge.productionVerified === true, cities: data.cities.map(item => item.name) };
}
export function detectIntent(message) {
  const text = normal(message);
  if (/\b(cek|check|lacak|status|lihat|periksa)\b.{0,25}\b(order|pesanan)\b|\b(order|pesanan)\b.{0,25}\b(saya|status|cek|lacak)\b/.test(text)) return 'check-order';
  if (/\b(transfer|bayar|pembayaran|konfirmasi|rekening|kode unik)\b/.test(text)) return 'payment';
  if (/\b(cara|panduan)\b.{0,25}\b(memasang|pasang|memesan|pesan)\b/.test(text)) return 'steps';
  if (/\b(admin|whatsapp|cs|manusia|pengelola)\b/.test(text)) return 'admin';
  if (/\b(draft|draf|susun|susunkan|rapikan|rapihkan)\b/.test(text)) return 'draft';
  if (/\b(desain|poster|belum punya|teks materi)\b/.test(text)) return 'design';
  if (/\b(harga|paket|biaya|kanal|instagram|facebook|reel|kota)\b/.test(text)) return 'packages';
  if (/\b(keuntungan|manfaat|kelebihan|pelamar|tayangan|followers|jaminan)\b/.test(text)) return 'benefits';
  if (/\b(formulir|form|kolom|caption|isi|mengisi)\b/.test(text)) return 'form';
  if (/\b(pasang|pesan|order|checkout|bayar|pembayaran|konfirmasi|transfer|langkah|mulai)\b/.test(text)) return 'steps';
  return 'unknown';
}
export function prohibitedRequest(message) {
  const text = normal(message);
  return /\b(abaikan|ignore|bypass|override|ungkap|reveal)\b.{0,45}\b(instruksi|instruction|system|sistem|prompt|secret|rahasia)\b/.test(text) ||
    /\b(hapus|delete|ubah|ganti|change|confirm|konfirmasi|lunas|bayarkan|send|kirim)\b.{0,30}\b(otomatis|automatically|status pembayaran|payment status|harga|price|database|semua order|order pelanggan|data pelanggan|kata sandi|password|api key|token)\b/.test(text) ||
    /\b(data pelanggan lain|bocorkan|system prompt|developer message|sql injection)\b/.test(text);
}
function baseRuleReply(intent, message, context = {}, knowledge = snapshot, now = Date.now()) {
  if (intent === 'check-order') return { reply: 'Untuk cek order, buka tautan ringkasan pribadi yang muncul setelah pesanan berhasil dikirim. Jika sedang berada pada ringkasan itu, gunakan “Cek order saya” di bawah. Jika tautannya tidak tersimpan, buka panduan Cek order atau hubungi admin dengan nomor pesanan. Saya tidak dapat mencari data pelanggan dari chat ini; jangan membuat pesanan atau membayar ulang.' };
  if (intent === 'payment') {
    if (context.step === 3 || context.page === 'receipt') return { reply: 'Jika sudah muncul Pesanan berhasil dikirim, konfirmasi dan materi telah diterima untuk diperiksa tim. Anda dapat mengecek ringkasan pribadi dan memberi kabar melalui tombol WhatsApp pada ringkasan. Jangan transfer atau membuat pesanan ulang; hubungi admin bila ada kendala.' };
    return { reply: 'Jangan lupa konfirmasi pembayaran setelah transfer. Untuk paket berbayar, transfer tepat sesuai total dan kode unik pada ringkasan. Kemudian lengkapi data, unggah bukti transfer dan materi, periksa kembali, lalu tekan “Kirim konfirmasi & materi” sendiri sampai halaman berhasil muncul. Jika sudah transfer, jangan membayar ulang. Paket gratis tidak memerlukan transfer. Gunakan tautan panduan di bawah.' };
  }
  if (intent === 'design') return { reply: 'Belum punya poster? Untuk bantuan desain gratis, tuliskan informasi lowongan di kolom Teks Materi (Materi dalam bentuk teks), bukan Caption. Cantumkan posisi, persyaratan, lokasi, dan cara melamar sesuai informasi Anda. Materi tidak saya kirim otomatis.' };
  if (intent === 'form') return { reply: 'Isi Nama lengkap dan Nomor WhatsApp terlebih dahulu. Untuk desain poster, gunakan Teks Materi, bukan Caption. Ikuti tanda wajib pada formulir; bukti transfer dibutuhkan untuk paket berbayar. Periksa ringkasan, lalu Anda sendiri yang menekan Kirim konfirmasi & materi.' };
  if (intent === 'benefits') return { reply: 'PosLoker membantu menyebarkan lowongan melalui kanal yang tersedia sesuai kota dan paket. Anda dapat menyiapkan materi teks untuk bantuan desain. Jumlah pelamar, tayangan, dan hasil rekrutmen tidak dijamin; ketentuan publikasi mengikuti paket dan pemeriksaan tim.' };
  if (intent === 'admin') return { reply: 'Anda bisa menghubungi admin melalui tombol WhatsApp. Tinjau pesan sebelum mengirim; POSI tidak mengirim pesan otomatis.', contact: safeContact(knowledge) };
  if (intent === 'steps') {
    if (context.step === 3 || context.page === 'receipt') return { reply: 'Jika halaman berhasil sudah tampil, periksa nomor pesanan. Tombol WhatsApp dapat Anda gunakan sendiri untuk memberi kabar kepada admin. Jika sudah transfer atau kirim pesanan, jangan membayar atau memesan ulang; minta admin memeriksa terlebih dahulu.' };
    if (context.step === 2 || context.page === 'form') return { reply: 'Sekarang lengkapi data pemesan dan materi. Unggah bukti transfer jika diwajibkan. Setelah memeriksa isi formulir dan ringkasan, centang persetujuan lalu tekan Kirim konfirmasi & materi sendiri.' };
    if (context.step === 1 || context.page === 'checkout') return { reply: 'Periksa kota, paket, total pembayaran, dan kode unik pada Ringkasan pesanan. Untuk paket berbayar, ikuti informasi transfer yang tampil. Sesudah itu tekan Lanjut isi konfirmasi. Saya tidak dapat mengubah nominal atau memeriksa pembayaran.' };
    return { reply: 'Mulai dari Pilih Kota pada website, lalu pilih paket yang tersedia dan tekan Checkout. Kita periksa ringkasan pesanan pada langkah berikutnya, ya.' };
  }
  if (intent === 'packages') {
    const view = catalogView(knowledge, context, message, now);
    if (!view || !view.city) return { reply: 'Paket dan kanal berbeda menurut kota. Sebutkan kota tujuan terlebih dahulu, ya. Harga yang berlaku tetap mengikuti ringkasan order dari server saat Checkout.' };
    if (!view.packages.length || !view.fresh) return { reply: 'Referensi paket untuk ' + view.city + ' perlu diperbarui. Lihat daftar paket dan harga pada website, lalu periksa Ringkasan pesanan saat Checkout. Saya tidak menebak nominal pembayaran.' };
    const items = context.packageId ? view.packages.filter(item => item.id === context.packageId) : view.packages;
    if (!items.length) return { reply: 'Paket yang Anda sebutkan tidak ada dalam referensi kota ' + view.city + '. Pilih paket yang tersedia di website; saya tidak mengganti pilihan Anda.' };
    const prefix = view.verified ? 'Referensi paket ' : 'Referensi staging, belum diverifikasi dengan konfigurasi produksi: ';
    return { reply: prefix + view.city + '\n' + items.map(item => item.name + ': Rp ' + new Intl.NumberFormat('id-ID').format(item.price) + ' — ' + item.features.filter(value => typeof value === 'string').join(', ')).join('\n') + '\nHarga berlaku dan kode unik tetap mengikuti Ringkasan pesanan dari server saat Checkout.' };
  }
  if (intent === 'draft') {
    const raw = message.replace(/^\s*(?:tolong\s+)?(?:buatkan|buat|susunkan|susun|rapikan|rapihkan)?\s*(?:draft|draf|teks materi)?\s*(?:lowongan)?\s*[:\-]?\s*/i, '').trim();
    if (raw.length < 15 || /^(draft|draf|susun|susunkan|rapikan|rapihkan|buatkan|teks materi|lowongan|tolong|saya|ya| )+$/i.test(raw)) return { reply: 'Tuliskan informasi lowongan yang Anda miliki: posisi, lokasi kerja, persyaratan, dan cara melamar. Saya tidak akan menambahkan informasi yang belum Anda berikan.' };
    return { reply: 'Berikut draft berdasarkan teks Anda saja. Periksa dan lengkapi informasi yang belum ada, lalu setujui sebelum dimasukkan ke Teks Materi. Caption, harga, paket, dan pengiriman pesanan tidak saya ubah.', draft: { adText: raw.slice(0, 1200) } };
  }
  return { reply: 'Saya dapat membantu paket, cara mengisi formulir, desain gratis, dan tahapan pemesanan PosLoker. Pilih satu bantuan di bawah, ya.', suggestions: [...QUICK_REPLIES] };
}

export function ruleReply(intent, message, context = {}, knowledge = snapshot, now = Date.now()) {
  const answer = baseRuleReply(intent, message, context, knowledge, now);
  const ids = intent === 'check-order' ? ['check-order', 'confirm-payment']
    : intent === 'payment' ? ['confirm-payment', 'check-order']
    : ['steps', 'form', 'design', 'packages'].includes(intent) ? ['how-to-order', 'confirm-payment'] : ['how-to-order', 'check-order'];
  return { ...answer, links: ids.map(id => ({ id })) };
}
