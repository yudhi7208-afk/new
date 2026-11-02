(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { catalog: null, payment: null, csrfToken: '', preview: true, canSubmit: false, quote: null, quoteTicket: 0, quoteExpired: false, submitting: false, uncertain: false, attempt: null, idempotencyKey: crypto.randomUUID(), receiptId: null, receiptKey: '', step: 1 };
  const initial = new URLSearchParams(location.search);
  let quoteTimer;
  let paymentDialogShown = false, paymentDialogReturnFocus = null;
  const money = value => Number.isSafeInteger(Number(value)) ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value)) : '—';
  const text = (id, value, fallback = '—') => { $(id).textContent = value === undefined || value === null || value === '' ? fallback : String(value); };
  function message(id, value) { $(id).textContent = value || ''; $(id).hidden = !value; }
  function element(tag, className, value) { const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = String(value); return node; }
  function size(value) { const n = Number(value); return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toLocaleString('id-ID', { maximumFractionDigits: 1 })} KB` : `${(n / 1048576).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB`; }
  function slug(value) { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function expiry(value) { const time = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : new Date(value).getTime(); return Number.isFinite(time) ? time : 0; }
  function notice(messageText) { text('toast', messageText); $('toast').hidden = false; setTimeout(() => { $('toast').hidden = true; }, 5000); }

  async function api(path, { method = 'GET', body, upload = false } = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), upload ? 60000 : 20000);
    const headers = { Accept: 'application/json' };
    if (method !== 'GET' && state.csrfToken) headers['X-CSRF-Token'] = state.csrfToken;
    if (body !== undefined && !upload) headers['Content-Type'] = 'application/json';
    try {
      const response = await fetch(path, { method, body: body === undefined ? undefined : upload ? body : JSON.stringify(body), headers, credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
      let result;
      try { result = await response.json(); } catch { throw Object.assign(new Error('Respons server belum dapat dibaca. Silakan coba kembali.'), { status: response.status, uncertain: upload }); }
      if (!response.ok) {
        const detail = typeof result?.error === 'string' ? result.error : typeof result?.message === 'string' ? result.message : 'Permintaan belum berhasil. Silakan coba kembali.';
        throw Object.assign(new Error(detail), { status: response.status, code: result?.code, uncertain: upload && (response.status >= 500 || response.status === 408 || response.status === 409) });
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw Object.assign(new Error(upload ? 'Waktu tunggu pengiriman habis. Hasilnya belum dapat dipastikan.' : 'Waktu tunggu habis. Periksa koneksi lalu coba lagi.'), { uncertain: upload });
      if (error instanceof TypeError) throw Object.assign(new Error('Koneksi terputus. Periksa jaringan Anda.'), { uncertain: upload });
      throw error;
    } finally { clearTimeout(timer); }
  }

  function selectedCity() { return state.catalog?.cities.find(city => city.name === $('citySelect').value); }
  function packagesForCity() { const city = selectedCity(); return city ? state.catalog.pricing[city.pricingKey] || state.catalog.pricing.default || [] : []; }
  function selectedPackage() { return packagesForCity().find(item => item.id === $('packageSelect').value); }
  function validLimits() {
    const limits = state.payment?.limits;
    return limits && ['proofMaxBytes', 'materialsMaxBytes', 'materialsMaxFiles', 'videoMaxBytes'].every(key => Number.isSafeInteger(limits[key]) && limits[key] > 0);
  }
  function closePaymentDialog({ restoreFocus = true } = {}) {
    const dialog = $('paymentDialog');
    if (!dialog.open) return;
    const target = paymentDialogReturnFocus;
    paymentDialogReturnFocus = null;
    dialog.close();
    $('paymentReminderSlot').prepend($('paymentReminder'));
    document.documentElement.classList.remove('payment-dialog-open');
    if (restoreFocus && target?.isConnected && !target.disabled && !target.closest('[hidden]')) target.focus({ preventScroll: true });
  }
  function openPaymentDialog() {
    const dialog = $('paymentDialog');
    if ($('showPaymentInstructionsButton').hidden || dialog.open || typeof dialog.showModal !== 'function') return;
    paymentDialogReturnFocus = document.activeElement !== document.body ? document.activeElement : $('citySelect');
    $('paymentDialogContent').append($('paymentReminder'));
    document.documentElement.classList.add('payment-dialog-open');
    try {
      dialog.showModal(); paymentDialogShown = true; dialog.scrollTop = 0;
      $('paymentDialogTitle').focus({ preventScroll: true });
    } catch {
      $('paymentReminderSlot').prepend($('paymentReminder'));
      document.documentElement.classList.remove('payment-dialog-open');
      paymentDialogReturnFocus = null;
    }
  }
  function renderPaymentGuidance() {
    const quote = state.quote;
    const current = Boolean(quote && !state.quoteExpired && expiry(quote.expiresAt) > Date.now());
    const paid = Boolean(current && quote.baseAmount > 0);
    const showReminder = !state.preview && state.canSubmit && paid && state.step === 1 && !state.submitting && !state.uncertain && !$('checkoutLayout').hidden;
    $('paymentReminder').hidden = !showReminder;
    text('paymentReminderAmount', showReminder ? money(quote.amount) : '—');
    const dialogEligible = showReminder && $('quoteLoading').hidden && $('bootStatus').hidden && $('pageError').hidden && $('quoteError').hidden;
    $('showPaymentInstructionsButton').hidden = !dialogEligible || typeof $('paymentDialog').showModal !== 'function';
    if (!dialogEligible) closePaymentDialog({ restoreFocus: false });
    else if (!paymentDialogShown) openPaymentDialog();
    $('copyAmountButton').hidden = state.preview || !paid || state.step === 3 || state.submitting || state.uncertain;
    $('copyBankButton').hidden = state.preview || !paid || state.step === 3 || state.submitting || state.uncertain;
    if (state.preview) text('summaryAmountHint', 'Jangan melakukan transfer pada halaman simulasi.');
    else if (!quote) text('summaryAmountHint', 'Periksa penawaran terbaru sebelum melakukan transfer.');
    else if (!current) text('summaryAmountHint', 'Penawaran berakhir. Jangan transfer berdasarkan nominal lama. Jika sudah transfer, jangan membayar ulang; hubungi pengelola.');
    else if (quote.baseAmount === 0) text('summaryAmountHint', 'Paket gratis: tidak perlu transfer atau kode unik.');
    else text('summaryAmountHint', 'Nominal harus sama, termasuk kode unik untuk verifikasi.');
    if (!state.preview) text('modeNotice', quote?.baseAmount === 0 ? 'Paket gratis tidak memerlukan transfer. Periksa kembali data dan materi sebelum dikirim.' : 'Periksa kembali data dan materi sebelum dikirim. Konfirmasi pembayaran akan diperiksa secara manual.');
  }
  function renderMode() {
    $('previewBanner').hidden = !state.preview; $('previewTag').hidden = !state.preview; $('summaryTestBadge').hidden = !state.preview; $('receiptTestBadge').hidden = !state.preview;
    $('bankWarning').hidden = !state.preview; $('receiptWarning').hidden = !state.preview; $('accessNotice').hidden = !state.preview || state.canSubmit;
    $('copyBankButton').hidden = state.preview; $('copyAmountButton').hidden = state.preview;
    document.title = state.preview ? 'Simulasi Pemesanan — PosLoker' : 'Pemesanan — PosLoker';
    text('bankDescription', state.preview ? 'Referensi alur pembayaran pada website utama.' : 'Transfer tepat sesuai nominal dan kode unik yang tertera.');
    text('bankReferenceLabel', state.preview ? 'REFERENSI REKENING' : 'REKENING TUJUAN');
    text('instruction1', state.preview ? 'Di website utama, periksa kota, paket, dan nominal sebelum membayar.' : 'Pastikan kota dan paket sudah benar sebelum melakukan transfer.');
    text('instruction2', state.preview ? 'Pada simulasi ini, lewati transfer dan siapkan contoh bukti pembayaran.' : 'Transfer tepat sesuai total pembayaran, termasuk kode unik, ke rekening yang tertera.');
    text('instruction3', state.preview ? 'Lanjutkan untuk menguji pengiriman data dan materi ke Cloudflare.' : 'Lanjutkan untuk mengirim bukti transfer dan materi lowongan.');
    text('freeDescription', state.preview ? 'Materi tetap akan diperiksa oleh pengelola. Di halaman ini, semua pesanan merupakan simulasi.' : 'Materi akan diperiksa oleh tim PosLoker sebelum dipublikasikan.');
    text('confirmationDescription', state.preview ? 'Gunakan data dan berkas contoh untuk simulasi.' : 'Lengkapi data pemesan dan unggah materi lowongan Anda.');
    text('modeNotice', state.preview ? 'Pesanan dari halaman ini diberi label Simulasi dan hanya tersimpan di Cloudflare. Tidak ada publikasi atau pesan WhatsApp otomatis.' : 'Periksa kembali data dan materi sebelum dikirim. Konfirmasi pembayaran akan diperiksa secara manual.');
    text('proofTitle', state.preview ? 'Contoh bukti transfer *' : 'Bukti transfer *');
    text('proofChoiceLabel', state.preview ? 'Pilih contoh bukti transfer' : 'Pilih bukti transfer');
    text('proofChoiceHint', state.preview ? 'Gunakan berkas contoh tanpa data pribadi sebenarnya.' : 'Pastikan nominal, tanggal, dan tujuan transfer terbaca.');
    text('consentText', state.preview ? 'Saya sudah memeriksa data dan memahami bahwa ini hanya simulasi migrasi, tanpa melakukan transfer.' : 'Saya memastikan data dan materi yang dikirim sudah benar.');
    text('summaryAmountLabel', state.preview ? 'Nominal referensi' : 'Total pembayaran');
    text('summaryAmountHint', state.preview ? 'Jangan melakukan transfer pada halaman simulasi.' : 'Nominal harus sama, termasuk kode unik untuk verifikasi.');
    text('receiptAmountLabel', state.preview ? 'Nominal referensi' : 'Total pembayaran');
    text('receiptTitle', state.preview ? 'Simulasi pesanan berhasil.' : 'Pesanan berhasil dikirim.');
    text('receiptDescription', state.preview ? 'Data telah diterima di Cloudflare dan dapat diperiksa melalui panel pengelola.' : 'Materi dan konfirmasi Anda akan diperiksa oleh tim PosLoker.');
    text('newOrderButton', state.preview ? 'Mulai simulasi baru →' : 'Buat pesanan baru →');
    text('whatsappButton', state.preview ? 'Buka WhatsApp secara manual ↗' : 'Konfirmasi lewat WhatsApp ↗');
    $('customerName').placeholder = state.preview ? 'Nama untuk simulasi' : 'Nama lengkap Anda';
    updateButtons();
  }
  function setStep(step) {
    state.step = step;
    for (let n = 1; n <= 3; n++) {
      const item = $('stepItem' + n); item.classList.toggle('is-current', n === step); item.classList.toggle('is-done', n < step);
      if (n === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
    }
    $('checkoutLayout').hidden = step === 3; $('packageStep').hidden = step !== 1; $('confirmationStep').hidden = step !== 2; $('receiptStep').hidden = step !== 3;
    renderPaymentGuidance();
  }
  function clearAttempt() { state.attempt = null; state.uncertain = false; state.idempotencyKey = crypto.randomUUID(); $('uncertainNotice').hidden = true; $('expiredNotice').hidden = true; }
  function updateButtons() {
    const valid = Boolean(state.canSubmit && state.quote && !state.quoteExpired && !state.submitting && !state.uncertain);
    $('continueButton').disabled = !valid; $('submitButton').disabled = !valid;
    $('citySelect').disabled = state.submitting || state.uncertain; $('packageSelect').disabled = state.submitting || state.uncertain;
    $('orderFields').disabled = !state.canSubmit || state.submitting || state.uncertain;
    $('backToPackageButton').disabled = state.submitting || state.uncertain;
    $('retrySubmitButton').disabled = !state.canSubmit || state.submitting; $('renewSessionButton').disabled = state.submitting;
    $('refreshQuoteButton').disabled = !state.canSubmit || state.submitting; $('checkAccessButton').disabled = state.submitting;
    text('submitButton', state.submitting ? (state.preview ? 'Mengirim simulasi…' : 'Mengirim pesanan…') : (state.preview ? 'Simulasikan pesanan →' : 'Kirim konfirmasi & materi →'));
    renderPaymentGuidance();
  }
  function updateExpiry() {
    if (!state.quote) { text('quoteExpiry', '', ''); return; }
    state.quoteExpired = expiry(state.quote.expiresAt) <= Date.now();
    $('quoteExpiry').classList.toggle('expired', state.quoteExpired);
    if (state.quoteExpired) {
      text('quoteExpiry', 'Penawaran berakhir. Perbarui sebelum melanjutkan.');
      if (!state.uncertain && !state.submitting) { $('refreshQuoteButton').hidden = false; if (state.step === 2) $('expiredNotice').hidden = false; }
    } else text('quoteExpiry', 'Berlaku hingga ' + new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(expiry(state.quote.expiresAt))) + ' WIB');
    updateButtons();
  }
  function renderPackageFeatures() {
    $('packageFeatures').replaceChildren();
    const item = selectedPackage();
    const features = Array.isArray(item?.features) ? item.features.filter(value => typeof value === 'string') : [];
    for (const feature of features) $('packageFeatures').append(element('li', '', feature));
    if (!features.length) $('packageFeatures').append(element('li', '', 'Layanan mengikuti paket yang dipilih.'));
  }
  function fillPackages(preferred = '') {
    $('packageSelect').replaceChildren();
    for (const item of packagesForCity()) { const option = element('option', '', item.name + ' · ' + money(item.price)); option.value = item.id; $('packageSelect').append(option); }
    if (packagesForCity().some(item => item.id === preferred)) $('packageSelect').value = preferred;
    renderPackageFeatures();
  }
  function configureUploads() {
    const limits = state.payment.limits, plus = state.quote.packageId === 'komplit-plus', free = state.quote.baseAmount === 0;
    $('proofSection').hidden = free; $('proofInput').required = !free; $('proofInput').disabled = free;
    if (free) { $('proofInput').value = ''; renderChosen('proofInput', 'proofFiles', 'clearProofButton'); }
    $('videoSection').hidden = !plus; $('videoInput').disabled = !plus;
    if (!plus) { $('videoInput').value = ''; renderChosen('videoInput', 'videoFiles', 'clearVideoButton'); }
    text('proofHint', 'JPG, PNG, WebP, atau PDF; maksimal ' + size(limits.proofMaxBytes) + '.' + (state.preview ? ' Gunakan contoh bukti untuk simulasi.' : ''));
    text('materialsHint', 'Maksimal ' + limits.materialsMaxFiles + ' berkas gambar/PDF' + (plus ? ' dan video' : '') + ' dengan total ukuran ' + size(limits.materialsMaxBytes) + '.');
    text('videoHint', 'Satu video MP4; maksimal ' + size(limits.videoMaxBytes) + '. Jumlah dan ukuran video termasuk dalam batas seluruh materi.');
  }
  function renderQuote() {
    const quote = state.quote;
    for (const [id, key] of [['summaryCity', 'city'], ['summaryPackage', 'packageName']]) text(id, quote[key]);
    text('summaryBase', money(quote.baseAmount)); text('summaryCode', quote.baseAmount === 0 ? 'Tidak ada · gratis' : String(quote.uniqueCode).padStart(2, '0')); text('summaryAmount', money(quote.amount));
    const free = quote.baseAmount === 0; $('bankSection').hidden = free; $('freeSection').hidden = !free;
    configureUploads(); updateExpiry(); clearInterval(quoteTimer); quoteTimer = setInterval(updateExpiry, 1000);
  }
  async function requestQuote({ resetAttempt = true } = {}) {
    const city = selectedCity(), item = selectedPackage(); if (!city || !item || state.submitting || state.uncertain) return;
    if (!state.canSubmit) { state.quote = null; text('summaryCity', city.name); text('summaryPackage', item.name); for (const id of ['summaryBase', 'summaryCode', 'summaryAmount']) text(id, '—'); updateButtons(); return; }
    const ticket = ++state.quoteTicket;
    state.quote = null; state.quoteExpired = false; clearInterval(quoteTimer); if (resetAttempt) clearAttempt();
    message('quoteError', ''); message('submissionError', ''); $('quoteLoading').hidden = false; $('bankSection').hidden = true; $('freeSection').hidden = true; $('refreshQuoteButton').hidden = true;
    for (const id of ['summaryBase', 'summaryCode', 'summaryAmount']) text(id, '—'); text('summaryCity', city.name); text('summaryPackage', item.name); text('quoteExpiry', '', ''); updateButtons();
    try {
      const result = await api('/api/checkout/quote', { method: 'POST', body: { city: city.name, packageId: item.id } });
      if (ticket !== state.quoteTicket) return;
      const quote = result.quote;
      if (result.preview !== state.preview || !quote || quote.city !== city.name || quote.packageId !== item.id || !quote.id || !expiry(quote.expiresAt) || ![quote.baseAmount, quote.uniqueCode, quote.amount].every(Number.isSafeInteger)) throw new Error('Penawaran dari server belum dapat digunakan. Muat ulang halaman.');
      state.quote = quote; renderQuote();
    } catch (error) {
      if (ticket !== state.quoteTicket) return;
      message('quoteError', error.message); $('refreshQuoteButton').hidden = false;
      if ([401, 403].includes(error.status)) { $('expiredNotice').hidden = false; if (state.preview) { state.canSubmit = false; $('accessNotice').hidden = false; text('quoteError', 'Akses simulasi belum tersedia. Masuk ke admin lalu pilih “Periksa akses kembali”.'); } }
    } finally { if (ticket === state.quoteTicket) { $('quoteLoading').hidden = true; updateButtons(); } }
  }

  async function loadSession({ retainSelection = false } = {}) {
    // A session/catalog refresh must not leave an earlier amount inviting a
    // transfer while its replacement request is pending or has failed.
    ++state.quoteTicket; state.quote = null; state.quoteExpired = false; clearInterval(quoteTimer);
    for (const id of ['summaryBase', 'summaryCode', 'summaryAmount']) text(id, '—');
    text('quoteExpiry', '', ''); $('quoteLoading').hidden = true; $('bankSection').hidden = true; $('freeSection').hidden = true; updateButtons();
    const previousCity = retainSelection ? $('citySelect').value : initial.get('city') || '', previousPackage = retainSelection ? $('packageSelect').value : initial.get('package') || '';
    const result = await api('/api/checkout/session');
    if (typeof result.preview !== 'boolean' || typeof result.canSubmit !== 'boolean') throw new Error('Status akses pemesanan belum tersedia. Silakan coba kembali.');
    if ((result.canSubmit && (typeof result.csrfToken !== 'string' || !/^[a-f0-9]{64}$/.test(result.csrfToken))) || !Array.isArray(result.catalog?.cities) || !result.catalog.cities.length || !result.catalog.pricing || !result.payment) throw new Error('Daftar kota dan paket belum tersedia. Silakan coba kembali.');
    state.csrfToken = result.canSubmit ? result.csrfToken : ''; state.catalog = result.catalog; state.payment = result.payment; state.preview = result.preview; state.canSubmit = result.canSubmit;
    if (!validLimits()) throw new Error('Aturan unggah belum tersedia. Silakan coba kembali setelah pengaturan selesai.');
    $('citySelect').replaceChildren();
    for (const city of state.catalog.cities) { const option = element('option', '', city.name); option.value = city.name; $('citySelect').append(option); }
    const match = state.catalog.cities.find(city => city.name === previousCity || slug(city.name) === slug(previousCity));
    if (match) $('citySelect').value = match.name;
    fillPackages(previousPackage);
    text('bankName', state.payment.bankName, 'Referensi bank'); text('bankAccount', state.payment.bankAccount, 'Belum diatur'); text('bankHolder', state.payment.bankHolder, 'Belum diatur');
    renderMode();
  }
  async function boot() {
    message('pageError', ''); $('bootStatus').hidden = false; $('retryBootButton').hidden = true; $('checkoutLayout').hidden = true; $('receiptStep').hidden = true;
    renderPaymentGuidance();
    try {
      const requestedOrder = initial.get('order');
      const fragment = new URLSearchParams(location.hash.slice(1));
      if (fragment.has('key')) {
        const key = fragment.get('key');
        if (!/^cf_[a-f0-9]{32}$/.test(requestedOrder || '') || !/^[a-f0-9]{64}$/.test(key || '')) throw new Error('Tautan ringkasan pesanan tidak lengkap atau tidak valid.');
        state.receiptKey = key;
        // A durable receipt must not allocate or depend on a checkout session.
        await loadReceipt(requestedOrder);
      } else {
        state.receiptKey = '';
        await loadSession();
        if (requestedOrder) { if (!/^cf_[a-f0-9]{32}$/.test(requestedOrder)) throw new Error('Nomor referensi pesanan tidak valid.'); await loadReceipt(requestedOrder); }
        else { setStep(1); await requestQuote(); }
      }
    } catch (error) { message('pageError', error.message); $('retryBootButton').hidden = false; if (state.receiptKey && error.status === 401) $('accessNotice').hidden = false; }
    finally { $('bootStatus').hidden = true; renderPaymentGuidance(); }
  }

  function renderChosen(inputId, listId, clearId) {
    const files = Array.from($(inputId).files || []); $(listId).replaceChildren();
    for (const file of files) { const row = element('div', 'chosen-file'); row.append(element('span', '', file.name), element('span', '', size(file.size))); $(listId).append(row); }
    $(clearId).hidden = !files.length;
  }
  function validFile(file, extensions, types, max, label) {
    const extension = file.name.toLowerCase().split('.').pop();
    if (!extensions.includes(extension) || (file.type && !types.includes(file.type))) throw new Error(label + ' memiliki jenis berkas yang tidak didukung.');
    if (file.size <= 0) throw new Error(label + ' kosong. Pilih berkas lain.');
    if (file.size > max) throw new Error(label + ' melewati batas ' + size(max) + '.');
  }
  function validateFiles() {
    const limits = state.payment.limits, plus = state.quote?.packageId === 'komplit-plus', proof = $('proofInput').files?.[0], images = Array.from($('materialsInput').files || []), video = plus ? $('videoInput').files?.[0] : null;
    if (state.quote.baseAmount > 0 && !proof) throw new Error('Pilih contoh bukti transfer untuk paket berbayar.');
    if (proof && !$('proofInput').disabled) validFile(proof, ['jpg', 'jpeg', 'png', 'webp', 'pdf'], ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], limits.proofMaxBytes, 'Bukti transfer');
    if (images.length + (video ? 1 : 0) > limits.materialsMaxFiles) throw new Error('Jumlah materi dan video maksimal ' + limits.materialsMaxFiles + ' berkas.');
    for (const file of images) validFile(file, ['jpg', 'jpeg', 'png', 'webp', 'pdf'], ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], limits.materialsMaxBytes, 'Materi gambar/PDF');
    if (video) validFile(video, ['mp4'], ['video/mp4'], limits.videoMaxBytes, 'Video Reel');
    if (images.reduce((total, file) => total + file.size, video?.size || 0) > limits.materialsMaxBytes) throw new Error('Total ukuran materi dan video maksimal ' + size(limits.materialsMaxBytes) + '.');
    return { proof: $('proofInput').disabled ? null : proof, images, video };
  }
  function buildAttempt() {
    if (!state.canSubmit) throw new Error('Masuk ke admin lalu periksa akses kembali untuk mencoba simulasi.');
    if (!state.quote || state.quoteExpired) throw new Error('Penawaran berakhir. Perbarui sesi dan penawaran sebelum mengirim.');
    if (!$('customerName').value.trim()) throw new Error('Isi nama pemesan terlebih dahulu.');
    if ($('customerWhatsapp').value.replace(/\D/g, '').length < 10) throw new Error('Periksa nomor WhatsApp; gunakan nomor yang lengkap.');
    if (!$('consent').checked) throw new Error('Centang persetujuan simulasi setelah memeriksa data.');
    const files = validateFiles(), form = new FormData();
    form.append('quoteId', state.quote.id); form.append('csrfToken', state.csrfToken); form.append('idempotencyKey', state.idempotencyKey);
    for (const [key, id] of [['customerName', 'customerName'], ['whatsapp', 'customerWhatsapp'], ['email', 'customerEmail'], ['adText', 'adText'], ['caption', 'caption'], ['notes', 'notes'], ['website', 'website']]) form.append(key, $(id).value.trim());
    form.append('consent', '1'); if (files.proof) form.append('proof', files.proof); for (const file of files.images) form.append('materials', file); if (files.video) form.append('video', files.video);
    return form;
  }
  async function submitOrder(retry = false) {
    if (state.submitting || !state.canSubmit) return; message('submissionError', '');
    if (!retry) {
      updateExpiry();
      try { state.attempt = buildAttempt(); } catch (error) { message('submissionError', error.message); return; }
    }
    if (!state.attempt) return;
    state.submitting = true; updateButtons();
    try {
      const result = await api('/api/checkout/submit', { method: 'POST', body: state.attempt, upload: true });
      renderReceipt(result);
    } catch (error) {
      message('submissionError', error.message);
      if (error.uncertain) { state.uncertain = true; $('uncertainNotice').hidden = false; $('expiredNotice').hidden = true; }
      else if ([401, 403, 410].includes(error.status) || error.code === 'quote_expired') { state.attempt = null; state.quoteExpired = true; $('expiredNotice').hidden = false; if (state.preview && [401, 403].includes(error.status)) { state.canSubmit = false; $('accessNotice').hidden = false; } }
      // Keep the same idempotency key on every failed attempt; never retry automatically.
    } finally { state.submitting = false; updateButtons(); }
  }
  function safeWhatsapp(value) {
    if (typeof value !== 'string' || !value) return null;
    try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'wa.me' && /^\/\d+$/.test(url.pathname) && !url.username && !url.password ? url.href : null; } catch { return null; }
  }
  function renderReceipt(result) {
    const order = result?.order;
    if (!order || !order.id || order.isTest !== state.preview) throw Object.assign(new Error('Hasil pesanan belum dapat dipastikan. Hubungi pengelola sebelum mencoba lagi.'), { uncertain: true });
    if (typeof order.id !== 'string' || !/^cf_[a-f0-9]{32}$/.test(order.id) || (result.receiptKey !== undefined && (typeof result.receiptKey !== 'string' || !/^[a-f0-9]{64}$/.test(result.receiptKey)))) throw Object.assign(new Error('Tautan ringkasan belum dapat dipastikan. Hubungi pengelola sebelum mencoba lagi.'), { uncertain: true });
    if (result.receiptKey) state.receiptKey = result.receiptKey;
    else if (state.receiptId && state.receiptId !== order.id) state.receiptKey = '';
    if (state.receiptKey) text('receiptDescription', (state.preview ? 'Data telah diterima di Cloudflare dan dapat diperiksa melalui panel pengelola.' : 'Materi dan konfirmasi Anda akan diperiksa oleh tim PosLoker.') + ' Simpan tautan halaman ini untuk memeriksa status nanti. Tautan ini bersifat pribadi.');
    state.receiptId = order.id; clearInterval(quoteTimer); state.attempt = null; state.uncertain = false; state.quote = null; state.idempotencyKey = crypto.randomUUID();
    $('orderForm').reset(); for (const values of [['proofInput', 'proofFiles', 'clearProofButton'], ['materialsInput', 'materialFiles', 'clearMaterialsButton'], ['videoInput', 'videoFiles', 'clearVideoButton']]) renderChosen(...values);
    text('captionCount', '0 / 500 karakter'); text('receiptNumber', order.orderNumber); text('receiptCity', order.city); text('receiptPackage', order.packageName); text('receiptAmount', money(order.amount));
    text('receiptStatus', ({ pending: 'Menunggu verifikasi', approved: 'Lunas', rejected: 'Ditolak' })[order.status] || 'Menunggu verifikasi');
    const whatsapp = safeWhatsapp(result.whatsappUrl); $('whatsappButton').hidden = !whatsapp; $('whatsappHint').hidden = !whatsapp;
    if (whatsapp) $('whatsappButton').href = whatsapp; else $('whatsappButton').removeAttribute('href');
    // The capability is a fragment only: never a server query, storage value,
    // WhatsApp message or external link. Keeping it supports later bookmarks.
    history.replaceState(null, '', '/pembayaran/?order=' + encodeURIComponent(order.id) + (state.receiptKey ? '#key=' + state.receiptKey : ''));
    message('pageError', ''); message('submissionError', ''); $('bootStatus').hidden = true; $('retryBootButton').hidden = true;
    setStep(3); $('receiptTitle').focus({ preventScroll: true });
    if (matchMedia('(max-width: 760px)').matches) $('receiptStep').scrollIntoView({ behavior: 'auto', block: 'start' });
  }
  async function loadReceipt(id) {
    const result = state.receiptKey ? await api('/api/checkout/receipt', { method: 'POST', body: { orderId: id, key: state.receiptKey } }) : await api('/api/checkout/orders/' + encodeURIComponent(id));
    if (typeof result?.order?.isTest !== 'boolean') throw new Error('Ringkasan pesanan belum dapat dibaca.');
    state.preview = result.order.isTest; state.canSubmit = true; renderMode(); renderReceipt(result);
  }
  async function renewSession() {
    if (state.submitting || state.uncertain) return; $('renewSessionButton').disabled = true;
    try { await loadSession({ retainSelection: true }); clearAttempt(); setStep(1); await requestQuote(); if (state.quote) notice('Sesi diperbarui. Periksa kota, paket, dan nominal sebelum melanjutkan.'); }
    catch (error) { message('submissionError', error.message); }
    finally { $('renewSessionButton').disabled = false; updateButtons(); }
  }

  $('showPaymentInstructionsButton').addEventListener('click', openPaymentDialog);
  $('closePaymentDialogButton').addEventListener('click', () => closePaymentDialog());
  $('acknowledgePaymentButton').addEventListener('click', () => closePaymentDialog());
  $('paymentDialog').addEventListener('cancel', event => { event.preventDefault(); closePaymentDialog(); });
  $('citySelect').addEventListener('change', () => { fillPackages(); requestQuote(); });
  $('packageSelect').addEventListener('change', () => { renderPackageFeatures(); requestQuote(); });
  $('refreshQuoteButton').addEventListener('click', async () => { try { await loadSession({ retainSelection: true }); await requestQuote(); } catch (error) { message('quoteError', error.message); } });
  $('continueButton').addEventListener('click', () => { updateExpiry(); if (!state.quote || state.quoteExpired) return; setStep(2); $('confirmationTitle').focus({ preventScroll: true }); $('confirmationStep').scrollIntoView({ behavior: 'auto', block: 'start' }); });
  $('backToPackageButton').addEventListener('click', () => { if (!state.submitting && !state.uncertain) { setStep(1); ($('paymentReminder').hidden ? $('packageStep') : $('paymentReminder')).scrollIntoView({ behavior: 'auto', block: 'start' }); } });
  $('orderForm').addEventListener('submit', event => { event.preventDefault(); submitOrder(); });
  $('retrySubmitButton').addEventListener('click', () => submitOrder(true));
  $('renewSessionButton').addEventListener('click', renewSession);
  $('checkAccessButton').addEventListener('click', async () => { $('checkAccessButton').disabled = true; try { const receiptId = state.receiptId || initial.get('order'); if (state.receiptKey && receiptId) await loadReceipt(receiptId); else { await loadSession({ retainSelection: true }); if (state.canSubmit && !state.uncertain) { if (receiptId) await loadReceipt(receiptId); else await requestQuote(); } } } catch (error) { message('pageError', error.message); } finally { $('checkAccessButton').disabled = false; } });
  $('retryBootButton').addEventListener('click', boot);
  $('caption').addEventListener('input', () => text('captionCount', $('caption').value.length + ' / 500 karakter'));
  for (const [input, list, clear] of [['proofInput', 'proofFiles', 'clearProofButton'], ['materialsInput', 'materialFiles', 'clearMaterialsButton'], ['videoInput', 'videoFiles', 'clearVideoButton']]) {
    $(input).addEventListener('change', () => { renderChosen(input, list, clear); message('submissionError', ''); });
    $(clear).addEventListener('click', () => { $(input).value = ''; renderChosen(input, list, clear); });
  }
  $('refreshReceiptButton').addEventListener('click', async () => { if (!state.receiptId) return; $('refreshReceiptButton').disabled = true; try { await loadReceipt(state.receiptId); notice('Status pesanan diperbarui.'); } catch (error) { message('pageError', error.message); } finally { $('refreshReceiptButton').disabled = false; } });
  $('newOrderButton').addEventListener('click', async () => {
    clearAttempt(); state.receiptId = null; state.receiptKey = ''; $('orderForm').reset(); history.replaceState(null, '', '/pembayaran/'); initial.delete('order');
    message('pageError', ''); setStep(1); try { await loadSession({ retainSelection: true }); await requestQuote(); } catch (error) { message('pageError', error.message); }
  });
  $('copyBankButton').addEventListener('click', async () => { if (state.preview || !state.payment?.bankAccount) return; try { await navigator.clipboard.writeText(String(state.payment.bankAccount)); notice('Nomor rekening disalin.'); } catch { notice('Pilih nomor rekening lalu salin secara manual.'); } });
  $('copyAmountButton').addEventListener('click', async () => { if (state.preview || !state.quote) return; try { await navigator.clipboard.writeText(String(state.quote.amount)); notice('Total pembayaran disalin.'); } catch { notice('Pilih total pembayaran lalu salin secara manual.'); } });
  addEventListener('pagehide', () => { clearInterval(quoteTimer); state.attempt = null; state.csrfToken = ''; state.receiptKey = ''; $('orderForm').reset(); });
  addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  boot();
})();
