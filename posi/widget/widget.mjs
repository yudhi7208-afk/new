import { QUICK_OPTIONS, safeContext, safeContactUrl, validDraft, localAnswer, requestReply } from './helpers.mjs';

const DEFAULT_GREETING = 'Halo! 👋 Saya POSI, asisten PosLoker. Mau pasang lowongan tetapi masih bingung? Saya bantu satu langkah setiap kali, ya!';
const GUIDE = [
  ['customerName', 'Isi nama pemesan sesuai data Anda.'],
  ['whatsapp', 'Isi nomor WhatsApp yang dapat dihubungi.'],
  ['proofInput', 'Jika paket berbayar dan sudah transfer, unggah bukti melalui formulir. Jangan kirim bukti ke chat ini.'],
  ['materialsInput', 'Unggah poster yang tersedia. Belum punya poster? Anda bisa mengisi Teks Materi pada langkah berikutnya.'],
  ['adText', 'Untuk bantuan desain gratis, tuliskan rincian lowongan di Teks Materi, bukan Caption.'],
  ['caption', 'Caption adalah teks pendamping posting. Kolom ini opsional; materi desain tetap di Teks Materi.'],
];

export function mountPosi(options = {}) {
  if (options.enabled !== true || options.config?.enabled !== true || !globalThis.document?.body) return { enabled: false, destroy() {} };
  const document = globalThis.document;
  const existing = document.getElementById('posi-assistant');
  if (existing) return { enabled: false, destroy() {} };
  const host = document.createElement('div');
  host.id = 'posi-assistant'; host.dataset.state = 'idle';
  const root = host.attachShadow({ mode: 'open' });
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = new URL('./widget.css', import.meta.url).href;
  root.append(stylesheet);
  const shell = document.createElement('div');
  // Static, author-owned shell only. All messages, configuration and drafts use textContent/value.
  shell.innerHTML = `<aside class="bubble" hidden aria-label="Sapaan POSI"><button type="button" aria-label="Tutup sapaan POSI">×</button><p>Halo, saya POSI! Perlu bantuan mengisi pesanan?</p></aside>
    <button class="launcher" type="button" aria-label="Buka bantuan POSI" aria-expanded="false" aria-controls="posi-panel"><img alt="" width="63" height="67"><span class="launcher-label">POSI<small>Siap membantu Anda</small></span></button>
    <button class="restore" type="button" hidden aria-label="Tampilkan kembali bantuan POSI">Bantuan POSI</button>
    <section class="panel" id="posi-panel" aria-label="Bantuan POSI" hidden>
      <header class="heading"><img class="avatar" alt="Robot POSI" width="48" height="52"><div class="heading-copy"><h2>POSI</h2><small>Asisten ramah PosLoker</small></div><button class="icon-button minimize" type="button" aria-label="Minimalkan POSI">−</button><button class="icon-button close" type="button" aria-label="Tutup panel POSI">×</button></header>
      <div class="conversation" role="log" aria-label="Percakapan bantuan" aria-live="polite" aria-relevant="additions text"></div>
      <p class="status" role="status"></p>
      <form class="composer"><label class="sr-only" for="posi-message">Pertanyaan untuk POSI</label><div class="composer-row"><textarea id="posi-message" rows="2" maxlength="1200" placeholder="Tulis pertanyaan Anda…" required></textarea><button class="send" type="submit" aria-label="Kirim pertanyaan ke POSI">Kirim</button></div><p class="privacy">Chat ini tidak mengirim pesanan. Jangan tulis kata sandi, bukti transfer, atau data pribadi. Percakapan tidak disimpan oleh POSI.</p></form>
      <div class="utility"><button class="guide-start" type="button">Panduan formulir</button><button class="hide-button" type="button">Sembunyikan robot</button></div>
    </section>`;
  root.append(shell);
  const $ = selector => root.querySelector(selector);
  const launcher = $('.launcher'), panel = $('.panel'), restore = $('.restore'), bubble = $('.bubble');
  const conversation = $('.conversation'), composer = $('.composer'), input = $('textarea'), status = $('.status'), send = $('.send');
  for (const image of root.querySelectorAll('img')) image.src = new URL('./mascot.svg', import.meta.url).href;
  let destroyed = false, pending = false, hidden = false, fieldFocused = false, requestController = null, guideIndex = 0, guideCard = null;
  const timers = new Set();
  const schedule = (fn, delay) => { const id = setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, delay); timers.add(id); return id; };
  const adapter = options.adapter || {};
  if (options.config.aiEnabled === true) $('.heading-copy small').textContent = 'Asisten AI PosLoker';
  function snapshot() { try { return adapter.snapshot?.() || {}; } catch { return {}; } }
  function state(value) { host.dataset.state = value; }
  function restState() { const current = snapshot(); state(current.step === 3 || current.page === 'receipt' ? 'success' : 'idle'); }
  function line(text, kind = '') {
    const node = document.createElement('p'); node.className = `message ${kind}`.trim();
    const speaker = document.createElement('span'); speaker.className = 'speaker'; speaker.textContent = kind === 'user' ? 'Anda' : 'POSI';
    node.append(speaker, document.createTextNode(String(text).slice(0, 4000))); conversation.append(node);
    // Keep bounded memory; no persistent transcript or whole form values are collected.
    while (conversation.childElementCount > 36) conversation.firstElementChild.remove();
    conversation.scrollTop = conversation.scrollHeight;
    return node;
  }
  function syncVisibility() {
    const dialogOpen = Boolean(document.querySelector('dialog[open]'));
    let yieldToPage = false;
    try { yieldToPage = adapter.shouldYield?.() === true; } catch { /* Optional page adapter cannot block checkout. */ }
    launcher.hidden = hidden || !panel.hidden || fieldFocused || dialogOpen || yieldToPage;
    restore.hidden = !hidden || !panel.hidden || fieldFocused || dialogOpen || yieldToPage;
    if (dialogOpen || fieldFocused || hidden || !panel.hidden || yieldToPage) bubble.hidden = true;
    if (dialogOpen && !panel.hidden) close(false);
  }
  function open() {
    if (destroyed || document.querySelector('dialog[open]')) return;
    hidden = false; fieldFocused = false; bubble.hidden = true; panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true'); syncVisibility(); input.focus({ preventScroll: true });
    state('greeting'); schedule(restState, 1800);
  }
  function close(focus = true) {
    panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); syncVisibility();
    if (focus && !launcher.hidden) launcher.focus({ preventScroll: true });
  }
  function hide() { hidden = true; close(false); syncVisibility(); if (!restore.hidden) restore.focus({ preventScroll: true }); }
  function makeButton(label, handler, className = '') {
    const button = document.createElement('button'); button.type = 'button'; button.className = className; button.textContent = label;
    button.addEventListener('click', handler); return button;
  }
  function offerContact() {
    const url = safeContactUrl(options.config.contact?.whatsappUrl);
    if (!url) return;
    const link = document.createElement('a'); link.className = 'contact';
    link.textContent = 'Buka WhatsApp admin ↗'; link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    conversation.append(link); conversation.scrollTop = conversation.scrollHeight;
  }
  function offerNavigation() {
    if (typeof adapter.guide !== 'function') return;
    const actions = document.createElement('div'); actions.className = 'actions';
    actions.append(makeButton('Tunjukkan pilihan kota & paket', async () => {
      try {
        const outcome = await adapter.guide('packages');
        if (outcome?.ok === false) { status.textContent = 'Pilihan paket belum tersedia di halaman ini. Anda dapat membuka halaman utama secara manual.'; return; }
        close(false); state('guiding');
      } catch { status.textContent = 'Anda tetap dapat memilih kota dan paket langsung pada website.'; }
    }, 'primary'));
    conversation.append(actions); conversation.scrollTop = conversation.scrollHeight;
  }
  function fieldEntry(current, key) {
    const entry = current.fields?.[key];
    return typeof entry === 'string' ? { value: entry, available: true } : entry && typeof entry === 'object' ? entry : { value: '', available: false };
  }
  function offerDraft(value) {
    const draft = validDraft(value); if (!draft) return;
    const card = document.createElement('section'); card.className = 'draft'; card.setAttribute('aria-label', 'Draf Teks Materi');
    const title = document.createElement('h3'); title.textContent = 'Periksa draf Teks Materi';
    const explanation = document.createElement('p'); explanation.textContent = 'Pastikan setiap informasi benar. POSI hanya dapat mengisi Teks Materi setelah Anda menyetujui. Caption dan data lain tidak diubah.';
    const edit = document.createElement('textarea'); edit.value = draft.adText; edit.maxLength = 2000; edit.rows = 5; edit.setAttribute('aria-label', 'Draf Teks Materi untuk diperiksa');
    const result = document.createElement('p'); result.setAttribute('role', 'status');
    const actions = document.createElement('div'); actions.className = 'actions';
    const apply = makeButton('Setujui isi Teks Materi', async () => {
      const current = fieldEntry(snapshot(), 'adText');
      if (!edit.value.trim() || edit.value.length > 2000) { result.textContent = 'Isi draf dengan 1–2.000 karakter terlebih dahulu.'; return; }
      if (!current.available || typeof adapter.applyDraft !== 'function') { result.textContent = 'Buka tahap Isi konfirmasi terlebih dahulu. Anda juga dapat menyalin draf ini sendiri ke Teks Materi.'; return; }
      if (current.value) {
        if (card.querySelector('.overwrite')) card.querySelector('.overwrite').remove();
        const warning = document.createElement('div'); warning.className = 'overwrite';
        const label = document.createElement('p'); label.textContent = 'Teks Materi sudah berisi data. Periksa isi saat ini sebelum menyetujui penggantian:';
        const old = document.createElement('pre'); old.textContent = current.value;
        const overwriteActions = document.createElement('div'); overwriteActions.className = 'actions';
        overwriteActions.append(makeButton('Ya, ganti isi lama', () => commit(current.value, true), 'primary'), makeButton('Pertahankan isi lama', () => { warning.remove(); result.textContent = 'Isi lama dipertahankan.'; }));
        warning.append(label, old, overwriteActions); card.insertBefore(warning, actions);
        result.textContent = 'Belum ada data formulir yang diubah.'; return;
      }
      await commit(current.value || '', false);
    }, 'primary');
    async function commit(expectedValue, overwrite) {
      apply.disabled = true;
      try {
        const outcome = await adapter.applyDraft({ field: 'adText', value: edit.value, consent: true, overwrite, expectedValue });
        if (outcome?.ok !== true) throw new Error('Isi formulir mungkin berubah atau belum tersedia. Periksa kembali sebelum mencoba.');
        result.textContent = 'Teks Materi telah diisi. Periksa formulir dan ringkasan sebelum menekan tombol kirim sendiri.';
        for (const action of card.querySelectorAll('button')) action.disabled = true;
        edit.readOnly = true; state('success');
      } catch { result.textContent = 'Draf belum diisikan. Periksa formulir lalu setujui kembali jika masih sesuai.'; apply.disabled = false; state('error'); }
      schedule(restState, 1800);
    }
    actions.append(apply, makeButton('Batal', () => card.remove()));
    card.append(title, explanation, edit, result, actions); conversation.append(card); conversation.scrollTop = conversation.scrollHeight;
  }
  async function ask(message) {
    if (pending || destroyed) return;
    const text = message.trim(); if (!text || text.length > 1200) return;
    line(text, 'user'); input.value = ''; pending = true; send.disabled = true; state('thinking'); status.textContent = 'POSI sedang menyiapkan bantuan. Formulir tetap bisa digunakan.';
    requestController = new AbortController();
    try {
      const answer = await requestReply({ apiBase: options.apiBase, message: text, context: safeContext(snapshot()), fetcher: options.fetcher, timeoutMs: options.timeoutMs, signal: requestController.signal });
      if (destroyed) return;
      line(answer.reply); state('talking');
      if (answer.draft) offerDraft(answer.draft);
      if (answer.contact?.whatsappUrl || /admin|kontak|hubungi/i.test(text)) offerContact();
      if (/pasang lowongan|harga dan paket/i.test(text)) offerNavigation();
    } catch {
      if (destroyed) return;
      line(`Layanan AI belum terhubung. ${localAnswer(text)}`, 'fallback'); state('error');
      if (/admin|kontak|hubungi/i.test(text)) offerContact();
      if (/pasang lowongan|harga dan paket/i.test(text)) offerNavigation();
    } finally {
      if (!destroyed) { pending = false; send.disabled = false; status.textContent = ''; schedule(restState, 1800); }
      requestController = null;
    }
  }
  function showGuide(index = 0) {
    if (guideCard?.isConnected) guideCard.remove();
    const current = snapshot();
    if (current.page !== 'form' && current.step !== 2) {
      line('Panduan kolom tersedia saat tahap Isi konfirmasi terbuka. Pilih kota dan paket, tekan Checkout, lalu periksa ringkasan sebelum melanjutkan.');
      offerNavigation();
      return;
    }
    guideIndex = index;
    const [field, instruction] = GUIDE[guideIndex];
    guideCard = document.createElement('section'); guideCard.className = 'guide';
    const title = document.createElement('h3'); title.textContent = `Panduan ${guideIndex + 1}/${GUIDE.length}`;
    const text = document.createElement('p'); text.textContent = instruction;
    const actions = document.createElement('div'); actions.className = 'actions';
    const locate = () => {
      try {
        const result = adapter.highlight?.(field);
        if (result?.ok === false) { status.textContent = 'Kolom ini belum tersedia atau tidak dibutuhkan untuk paket Anda.'; return; }
        state('guiding'); close(false);
      } catch { status.textContent = 'Anda tetap dapat menemukan kolom tersebut langsung pada formulir.'; }
    };
    actions.append(makeButton('Sorot kolom', locate, 'primary'), makeButton('Ulangi', () => { text.textContent = instruction; locate(); }), makeButton(guideIndex === GUIDE.length - 1 ? 'Selesai' : 'Lanjut', () => {
      if (guideIndex === GUIDE.length - 1) { guideCard.remove(); line('Periksa semua data dan ringkasan. Anda tetap harus menyetujui serta menekan tombol kirim sendiri.'); state('success'); }
      else showGuide(guideIndex + 1);
    }), makeButton('Lewati', () => { guideCard.remove(); state('idle'); }));
    guideCard.append(title, text, actions); conversation.append(guideCard); conversation.scrollTop = conversation.scrollHeight;
  }
  line(typeof options.config.greeting === 'string' ? options.config.greeting.slice(0, 800) : DEFAULT_GREETING);
  const quick = document.createElement('div'); quick.className = 'quick-options'; quick.setAttribute('aria-label', 'Pilihan bantuan cepat');
  for (const option of QUICK_OPTIONS) quick.append(makeButton(option, () => ask(option)));
  conversation.append(quick);
  launcher.addEventListener('click', open); restore.addEventListener('click', open);
  $('.minimize').addEventListener('click', () => close()); $('.close').addEventListener('click', () => close());
  $('.hide-button').addEventListener('click', hide); $('.guide-start').addEventListener('click', () => showGuide());
  bubble.querySelector('button').addEventListener('click', () => { bubble.hidden = true; });
  composer.addEventListener('submit', event => { event.preventDefault(); event.stopPropagation(); ask(input.value); });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
  function pageFocus(event) {
    const target = event.target;
    if (target === host || !target?.matches?.('input,textarea,select,[contenteditable="true"]')) return;
    fieldFocused = true; if (!panel.hidden) close(false); syncVisibility();
  }
  function pageBlur() { schedule(() => { fieldFocused = document.activeElement !== host && Boolean(document.activeElement?.matches?.('input,textarea,select,[contenteditable="true"]')); syncVisibility(); }, 0); }
  function pageScroll(event) {
    // Scrolling the existing page clears the optional panel out of the way.
    // A shadow-internal conversation scroll is retargeted to host and stays open.
    if (!panel.hidden && event.target !== host && !root.contains(event.target)) close(false);
    syncVisibility();
  }
  function viewport() {
    host.style.setProperty('--posi-vh', `${globalThis.visualViewport?.height || globalThis.innerHeight}px`);
    // CSS 100vw includes a classic desktop scrollbar; fixed-position offsets do
    // not. Use the actual layout width so a full-width mobile panel keeps both
    // borders visible on Windows as well as phones with overlay scrollbars.
    host.style.setProperty('--posi-vw', `${document.documentElement.clientWidth || globalThis.innerWidth}px`);
    syncVisibility();
  }
  document.addEventListener('focusin', pageFocus); document.addEventListener('focusout', pageBlur);
  document.addEventListener('scroll', pageScroll, true);
  globalThis.visualViewport?.addEventListener('resize', viewport); globalThis.addEventListener('resize', viewport);
  const observer = new MutationObserver(records => { if (records.some(record => record.target?.tagName === 'DIALOG')) syncVisibility(); });
  observer.observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });
  const resizeObserver = globalThis.ResizeObserver ? new ResizeObserver(viewport) : null;
  resizeObserver?.observe(document.documentElement);
  viewport(); document.body.append(host); syncVisibility(); restState();
  let greeted = false;
  try { greeted = sessionStorage.getItem('posi-greeted-v1') === '1'; } catch { /* Storage can be blocked. */ }
  if (!greeted) schedule(() => {
    try { sessionStorage.setItem('posi-greeted-v1', '1'); } catch { /* No storage requirement. */ }
    if (!hidden && panel.hidden && !fieldFocused && !document.querySelector('dialog[open]')) { bubble.hidden = false; syncVisibility(); state('greeting'); schedule(() => { bubble.hidden = true; restState(); }, 8500); }
  }, Math.max(2000, options.greetingDelayMs || 4500));
  return { enabled: true, aiEnabled: options.config.aiEnabled === true, open, close, hide, show() { hidden = false; syncVisibility(); }, destroy() {
    if (destroyed) return;
    destroyed = true; requestController?.abort(); for (const timer of timers) clearTimeout(timer); timers.clear(); observer.disconnect(); resizeObserver?.disconnect();
    document.removeEventListener('focusin', pageFocus); document.removeEventListener('focusout', pageBlur);
    document.removeEventListener('scroll', pageScroll, true);
    globalThis.visualViewport?.removeEventListener('resize', viewport); globalThis.removeEventListener('resize', viewport); host.remove();
  } };
}
