(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const fields = ['title', 'description', 'heading', 'intro'];
  const contentInputs = { title: 'pageTitle', description: 'pageDescription', heading: 'pageHeading', intro: 'pageIntro' };
  const contentLabels = { title: 'Judul halaman', description: 'Deskripsi hasil pencarian', heading: 'Judul utama', intro: 'Teks pembuka' };
  const payoutFields = { bankName: 'Nama bank', bankAccount: 'Nomor rekening', bankHolder: 'Nama pemilik rekening', whatsapp: 'WhatsApp pengelola', maxUploadMb: 'Batas bukti transfer' };
  const siteFields = { contactEmail: 'Email kontak', instagramUrl: 'Tautan Instagram', facebookUrl: 'Tautan Facebook' };
  const state = { authenticated: false, csrfToken: '', epoch: 0, business: null, draft: null, pages: [], pageDrafts: new Map(), pagePath: '', events: [], pending: null, saving: false, staleBusiness: false, stalePages: new Set() };
  let toastTimer;

  function node(tag, className, value) { const el = document.createElement(tag); if (className) el.className = className; if (value !== undefined) el.textContent = String(value); return el; }
  function errorIn(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
  function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000); }
  const clone = value => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
  const groupName = key => key === 'default' ? 'Harga umum' : String(key).replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  function date(value) { const d = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(d); }
  function normalizedWhatsapp(value) { let result = value.trim().replace(/[\s()+-]/g, ''); if (/^0\d+$/.test(result)) result = '62' + result.slice(1); else if (/^8\d+$/.test(result)) result = '62' + result; return result; }
  function displayValue(value) { return value === '' || value === null || value === undefined ? 'Kosong' : Array.isArray(value) ? value.join('\n') : String(value); }
  function currentPage() { return state.pages.find(page => page.path === state.pagePath); }
  function currentDraft() { return state.pageDrafts.get(state.pagePath); }

  async function api(path, options = {}) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    const headers = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.method && options.method !== 'GET' && state.csrfToken) headers['X-CSRF-Token'] = state.csrfToken;
    try {
      const response = await fetch(path, { method: options.method || 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
      let data; try { data = await response.json(); } catch { throw new Error('Server belum dapat memberikan respons. Silakan coba lagi.'); }
      if (!response.ok) {
        if (response.status === 401) showLogin('Sesi Anda sudah berakhir. Silakan masuk kembali.');
        throw Object.assign(new Error(typeof data?.error === 'string' ? data.error : 'Permintaan belum berhasil.'), { status: response.status });
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Waktu tunggu habis. Periksa koneksi, lalu coba lagi.');
      if (error instanceof TypeError) throw new Error('Tidak dapat terhubung. Periksa koneksi Anda.');
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function clearPrivateState() {
    state.epoch++; state.authenticated = false; state.csrfToken = ''; state.business = null; state.draft = null; state.pages = []; state.pageDrafts.clear(); state.pagePath = ''; state.events = []; state.contentEvents = []; state.pending = null; state.staleBusiness = false; state.stalePages.clear();
    for (const id of [...Object.keys(payoutFields), ...Object.keys(siteFields), ...Object.values(contentInputs), 'changeReason']) $(id).value = '';
    for (const id of ['citySelect', 'cityGroupSelect', 'priceGroupSelect', 'pageSelect', 'packageEditors', 'businessEvents', 'reviewChanges']) $(id).replaceChildren();
    for (const id of ['groupCities', 'businessChanged', 'contentChanged']) $(id).textContent = '';
    for (const id of ['businessError', 'contentError', 'reviewError']) errorIn(id);
    $('pagePreviewLink').href = '/'; $('toast').hidden = true; clearTimeout(toastTimer);
    if ($('reviewDialog').open) $('reviewDialog').close();
    $('settingsView').hidden = true; $('logoutButton').hidden = true;
  }

  function showLogin(message = '') { clearPrivateState(); $('globalStatus').hidden = true; $('loadErrorView').hidden = true; $('loginMessage').textContent = message || 'Gunakan akun admin PosLoker untuk membuka pengaturan ini.'; $('loginView').hidden = false; }
  function showLoadError(error) { clearPrivateState(); $('globalStatus').hidden = true; $('loginView').hidden = true; $('loadErrorView').hidden = false; $('loadErrorMessage').textContent = error.message; }

  async function loadAll() {
    clearPrivateState(); const epoch = state.epoch;
    $('loginView').hidden = true; $('loadErrorView').hidden = true; $('globalStatus').hidden = false; $('globalStatus').textContent = 'Memuat pengaturan website…';
    const session = await api('/api/admin/session');
    if (epoch !== state.epoch) return;
    if (!session.authenticated) { showLogin(); return; }
    if (!/^[a-f0-9]{64}$/.test(session.csrfToken || '')) throw new Error('Sesi formulir belum siap. Muat ulang halaman.');
    state.authenticated = true; state.csrfToken = session.csrfToken;
    const [business, content] = await Promise.all([api('/api/admin/business'), api('/api/admin/content')]);
    if (epoch !== state.epoch || !state.authenticated) return;
    acceptBusiness(business); acceptContent(content); renderEvents();
    $('globalStatus').hidden = true; $('settingsView').hidden = false; $('logoutButton').hidden = false;
  }

  function acceptBusiness(result) {
    if (!Number.isSafeInteger(result?.revision) || !Array.isArray(result?.catalog?.cities) || !result.catalog.cities.length || !result.catalog.pricing || !result.payout || !result.site) throw new Error('Pengaturan bisnis belum lengkap.');
    state.business = clone(result); state.draft = { catalog: clone(result.catalog), payout: clone(result.payout), site: clone(result.site) }; state.staleBusiness = false;
    renderBusiness(); errorIn('businessError'); $('reviewBusinessButton').disabled = false;
  }

  function renderBusiness() {
    const catalog = state.draft.catalog, oldCity = $('citySelect').value, oldGroup = $('priceGroupSelect').value;
    $('citySelect').replaceChildren();
    for (const city of catalog.cities) { const option = node('option', '', city.name); option.value = city.name; $('citySelect').append(option); }
    if (catalog.cities.some(city => city.name === oldCity)) $('citySelect').value = oldCity;
    for (const id of ['cityGroupSelect', 'priceGroupSelect']) {
      $(id).replaceChildren();
      for (const key of Object.keys(catalog.pricing)) { const option = node('option', '', groupName(key)); option.value = key; $(id).append(option); }
    }
    const city = catalog.cities.find(city => city.name === $('citySelect').value);
    $('cityGroupSelect').value = city.pricingKey;
    $('priceGroupSelect').value = Object.hasOwn(catalog.pricing, oldGroup) ? oldGroup : city.pricingKey;
    for (const key of Object.keys(payoutFields)) $(key).value = state.draft.payout[key] ?? (key === 'maxUploadMb' ? 10 : '');
    for (const key of Object.keys(siteFields)) $(key).value = state.draft.site[key] || '';
    renderPackages(); updateBusinessIndicator();
  }

  function packageField(card, label, value, options, onInput) {
    const wrapper = node('div', 'field'), id = 'pkg-' + $('priceGroupSelect').selectedIndex + '-' + options.index + '-' + options.key;
    const labelEl = node('label', '', label); labelEl.htmlFor = id;
    const input = node(options.multiline ? 'textarea' : 'input'); input.id = id;
    if (options.multiline) input.rows = 5; else input.type = options.type || 'text';
    if (options.maxLength) input.maxLength = options.maxLength;
    if (options.required) input.required = true;
    if (options.type === 'number') { input.min = '0'; input.max = '1000000000'; input.step = '1'; input.inputMode = 'numeric'; }
    input.value = value ?? ''; input.addEventListener('input', () => { onInput(input.value); updateBusinessIndicator(); });
    wrapper.append(labelEl, input);
    if (options.hint) { const hint = node('small', '', options.hint); hint.id = id + '-hint'; input.setAttribute('aria-describedby', hint.id); wrapper.append(hint); }
    card.append(wrapper);
  }

  function renderPackages() {
    const key = $('priceGroupSelect').value, catalog = state.draft.catalog;
    const cities = catalog.cities.filter(city => city.pricingKey === key).map(city => city.name);
    $('groupCities').textContent = cities.length ? `Harga kelompok ini digunakan oleh ${cities.length} kota: ${cities.join(', ')}. Perubahan paket berlaku untuk semua kota tersebut.` : 'Kelompok ini belum dipakai oleh kota mana pun.';
    $('packageEditors').replaceChildren();
    catalog.pricing[key].forEach((item, index) => {
      const card = node('div', 'package-card'); card.append(node('h3', '', item.name));
      packageField(card, 'Nama paket', item.name, { index, key: 'name', maxLength: 150, required: true }, value => { item.name = value; });
      packageField(card, 'Harga paket (Rp)', item.price, { index, key: 'price', type: 'number', required: true, hint: 'Isi 0 untuk paket gratis. Kode unik pembayaran ditambahkan saat pemesanan.' }, value => { item.price = value === '' ? null : Number(value); });
      packageField(card, 'Label pilihan paket', item.badge || '', { index, key: 'badge', maxLength: 80, hint: 'Opsional, misalnya label rekomendasi.' }, value => { if (value || Object.hasOwn(item, 'badge')) item.badge = value; });
      packageField(card, 'Manfaat paket', item.features.join('\n'), { index, key: 'features', multiline: true, maxLength: 9029, hint: 'Satu manfaat per baris. Maksimal 30 baris dan 300 karakter per baris.' }, value => { item.features = value.split('\n').map(line => line.trim()).filter(Boolean); });
      $('packageEditors').append(card);
    });
  }

  function collectBusinessInputs() {
    if (!state.draft) return;
    for (const key of Object.keys(payoutFields)) state.draft.payout[key] = key === 'maxUploadMb' ? Number($(key).value) : key === 'whatsapp' ? normalizedWhatsapp($(key).value) : $(key).value.trim();
    for (const key of Object.keys(siteFields)) state.draft.site[key] = $(key).value.trim();
  }

  function businessChanges() {
    if (!state.business || !state.draft) return [];
    const changes = [], before = state.business, after = state.draft;
    for (const city of after.catalog.cities) { const old = before.catalog.cities.find(value => value.name === city.name); if (old?.pricingKey !== city.pricingKey) changes.push({ label: 'Kelompok harga · ' + city.name, before: groupName(old?.pricingKey), after: groupName(city.pricingKey) }); }
    for (const [key, packages] of Object.entries(after.catalog.pricing)) packages.forEach(item => {
      const old = before.catalog.pricing[key]?.find(value => value.id === item.id);
      for (const [field, label] of [['name', 'Nama paket'], ['price', 'Harga'], ['badge', 'Label paket'], ['features', 'Manfaat']]) if (!equal(old?.[field] ?? (field === 'badge' ? '' : null), item[field] ?? (field === 'badge' ? '' : null))) changes.push({ label: `${groupName(key)} · ${old?.name || item.name} · ${label}`, before: field === 'price' ? money(old?.[field]) : old?.[field], after: field === 'price' ? money(item[field]) : item[field] });
    });
    for (const [key, label] of Object.entries(payoutFields)) if ((before.payout[key] ?? (key === 'maxUploadMb' ? 10 : '')) !== after.payout[key]) changes.push({ label, before: key === 'maxUploadMb' ? `${before.payout[key] ?? 10} MB` : before.payout[key], after: key === 'maxUploadMb' ? `${after.payout[key]} MB` : after.payout[key] });
    for (const [key, label] of Object.entries(siteFields)) if ((before.site[key] || '') !== after.site[key]) changes.push({ label, before: before.site[key], after: after.site[key] });
    return changes;
  }

  function updateBusinessIndicator() { collectBusinessInputs(); const count = businessChanges().length; $('businessChanged').textContent = count ? `${count} perubahan belum disimpan.` : 'Belum ada perubahan.'; }

  function acceptContent(result) {
    if (!Array.isArray(result?.pages) || !result.pages.length || result.pages.some(page => typeof page.path !== 'string' || !Number.isSafeInteger(page.revision))) throw new Error('Daftar halaman belum siap.');
    const oldPath = state.pagePath;
    state.pages = clone(result.pages); state.contentEvents = clone(result.events || []); state.pageDrafts.clear(); state.stalePages.clear();
    $('pageSelect').replaceChildren();
    for (const page of state.pages) { const option = node('option', '', page.label || (page.path === '/' ? 'Beranda' : page.path)); option.value = page.path; $('pageSelect').append(option); }
    state.pagePath = state.pages.some(page => page.path === oldPath) ? oldPath : state.pages[0].path;
    $('pageSelect').value = state.pagePath; renderContent(); errorIn('contentError');
  }

  function ensurePageDraft(page) {
    if (!state.pageDrafts.has(page.path)) state.pageDrafts.set(page.path, { values: Object.fromEntries(fields.map(key => [key, page[key] ?? ''])), restoreFields: new Set() });
    return state.pageDrafts.get(page.path);
  }

  function renderContent() {
    const page = currentPage(); if (!page) return;
    const draft = ensurePageDraft(page);
    for (const key of fields) $(contentInputs[key]).value = draft.values[key];
    if (/^\/(?:[a-z0-9-]+\/)*$/.test(page.path)) { $('pagePreviewLink').href = page.path; $('pagePreviewLink').hidden = false; } else $('pagePreviewLink').hidden = true;
    $('reviewContentButton').disabled = state.stalePages.has(page.path);
    errorIn('contentError', state.stalePages.has(page.path) ? 'Halaman ini sudah diubah pada tab lain. Draf Anda tetap terlihat; muat ulang halaman sebelum menyimpan lagi.' : '');
    updateContentIndicator();
  }

  function contentPayload(page = currentPage(), draft = currentDraft()) {
    const payload = { path: page.path, expectedRevision: page.revision };
    for (const key of fields) payload[key] = draft.restoreFields.has(key) || !draft.values[key].trim() ? null : draft.values[key] === (page[key] ?? '') ? (page.overrides?.[key] ?? null) : draft.values[key].trim();
    return payload;
  }

  function contentChanges(page = currentPage(), draft = currentDraft()) {
    if (!page || !draft) return [];
    const changes = [];
    for (const key of fields) {
      const restoring = draft.restoreFields.has(key) || !draft.values[key].trim();
      const old = page[key] ?? '', next = restoring ? (page.defaults?.[key] ?? '') : draft.values[key].trim();
      if (old !== next || (restoring && page.overrides?.[key] !== null && page.overrides?.[key] !== undefined)) changes.push({ label: contentLabels[key] + (restoring ? ' · kembali ke bawaan' : ''), before: old, after: next });
    }
    return changes;
  }

  function updateContentIndicator() { const count = contentChanges().length; $('contentChanged').textContent = count ? `${count} perubahan pada halaman ini belum disimpan.` : 'Belum ada perubahan.'; }
  function anyDirty() { if (businessChanges().length) return true; return state.pages.some(page => state.pageDrafts.has(page.path) && contentChanges(page, state.pageDrafts.get(page.path)).length); }

  function acceptSavedContent(result, path) {
    if (!result.pages?.some(page => page.path === path)) throw new Error('Perubahan tersimpan, tetapi halaman terbaru belum dapat dimuat. Muat ulang data.');
    // A draft on another page keeps its original revision so later edits still
    // detect a concurrent save instead of overwriting it with an old draft.
    state.pages = result.pages.map(page => {
      const previous = state.pages.find(value => value.path === page.path), draft = state.pageDrafts.get(page.path);
      if (page.path !== path && previous && draft && contentChanges(previous, draft).length) return previous;
      state.pageDrafts.delete(page.path);
      return clone(page);
    });
    state.contentEvents = clone(result.events || []); state.pageDrafts.delete(path); state.stalePages.delete(path); renderContent();
  }

  function renderEvents() {
    const all = [...(state.business?.events || []), ...(state.contentEvents || [])], seen = new Set();
    const events = all.filter(event => { const key = event.id ?? `${event.scope}:${event.path}:${event.revision}:${event.createdAt}`; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).slice(0, 20);
    $('businessEvents').replaceChildren();
    if (!events.length) { $('businessEvents').append(node('li', 'events-empty', 'Belum ada perubahan pengaturan dari panel ini.')); return; }
    for (const event of events) {
      const li = node('li'), page = state.pages.find(page => page.path === event.path);
      li.append(node('strong', '', event.scope === 'content' ? 'Konten diperbarui · ' + (page?.label || event.path || 'Halaman') : 'Paket atau pembayaran diperbarui'));
      li.append(node('span', 'event-time', [date(event.createdAt), event.actor].filter(Boolean).join(' · ')));
      if (event.reason) li.append(node('p', '', event.reason));
      $('businessEvents').append(li);
    }
  }

  function review(type, payload, changes) {
    if (!changes.length) { toast('Tidak ada perubahan untuk disimpan.'); return; }
    state.pending = { type, payload: clone(payload) };
    $('reviewTitle').textContent = type === 'business' ? 'Simpan pengaturan bisnis?' : 'Simpan perubahan halaman?';
    $('reviewDescription').textContent = type === 'business' ? 'Periksa semua perubahan paket, pembayaran, dan kontak berikut. Perubahan berlaku untuk penawaran baru di Cloudflare.' : 'Periksa perubahan pada halaman ' + (currentPage()?.label || state.pagePath) + '. Tata letak dan gambar tetap dipertahankan.';
    $('reviewChanges').replaceChildren();
    for (const change of changes) {
      const card = node('div', 'review-change'), dl = node('dl'); card.append(node('strong', '', change.label));
      dl.append(node('dt', '', 'Semula'), node('dd', '', displayValue(change.before)), node('dt', '', 'Menjadi'), node('dd', 'change-after', displayValue(change.after))); card.append(dl); $('reviewChanges').append(card);
    }
    $('changeReason').value = ''; errorIn('reviewError'); $('reviewChanges').tabIndex = 0; $('reviewChanges').setAttribute('aria-label', 'Ringkasan perubahan'); $('reviewTitle').tabIndex = -1; $('reviewDialog').showModal(); $('reviewTitle').focus();
  }

  function validateBusiness() {
    for (const [key, packages] of Object.entries(state.draft.catalog.pricing)) for (const item of packages) {
      if (!item.name.trim() || item.name.length > 150 || !Number.isSafeInteger(item.price) || item.price < 0 || item.price > 1000000000 || item.features.length > 30 || item.features.some(value => value.length > 300)) throw new Error('Periksa nama, harga, dan manfaat paket pada kelompok ' + groupName(key) + '.');
    }
    if (!/^\d{10,15}$/.test(state.draft.payout.whatsapp)) throw new Error('Gunakan nomor WhatsApp 10–15 angka dengan kode negara.');
  }

  $('citySelect').addEventListener('change', () => { const city = state.draft?.catalog.cities.find(city => city.name === $('citySelect').value); if (!city) return; $('cityGroupSelect').value = city.pricingKey; $('priceGroupSelect').value = city.pricingKey; renderPackages(); });
  $('cityGroupSelect').addEventListener('change', () => { const city = state.draft?.catalog.cities.find(city => city.name === $('citySelect').value); if (!city) return; city.pricingKey = $('cityGroupSelect').value; $('priceGroupSelect').value = city.pricingKey; renderPackages(); updateBusinessIndicator(); });
  $('priceGroupSelect').addEventListener('change', () => { if (state.draft) renderPackages(); });
  for (const key of [...Object.keys(payoutFields), ...Object.keys(siteFields)]) $(key).addEventListener('input', updateBusinessIndicator);
  $('businessForm').addEventListener('submit', event => {
    event.preventDefault(); if (!state.authenticated || !state.draft || state.staleBusiness || state.saving) return;
    collectBusinessInputs(); errorIn('businessError');
    try { validateBusiness(); review('business', { expectedRevision: state.business.revision, ...state.draft }, businessChanges()); } catch (error) { errorIn('businessError', error.message); }
  });
  $('pageSelect').addEventListener('change', () => { state.pagePath = $('pageSelect').value; renderContent(); });
  for (const key of fields) $(contentInputs[key]).addEventListener('input', () => { const draft = currentDraft(); if (!draft) return; draft.values[key] = $(contentInputs[key]).value; draft.restoreFields.delete(key); updateContentIndicator(); });
  $('restoreContentButton').addEventListener('click', () => { const page = currentPage(), draft = currentDraft(); if (!page || !draft) return; for (const key of fields) { draft.values[key] = page.defaults?.[key] ?? page[key] ?? ''; draft.restoreFields.add(key); } renderContent(); });
  $('contentForm').addEventListener('submit', event => { event.preventDefault(); if (!state.authenticated || !currentPage() || state.stalePages.has(state.pagePath) || state.saving) return; errorIn('contentError'); review('content', contentPayload(), contentChanges()); });
  $('cancelReviewButton').addEventListener('click', () => $('reviewDialog').close());
  $('reviewDialog').addEventListener('cancel', event => { if (state.saving) event.preventDefault(); });
  $('reviewDialog').addEventListener('close', () => { state.pending = null; $('changeReason').value = ''; $('reviewChanges').replaceChildren(); errorIn('reviewError'); });
  $('reviewForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.pending || !state.authenticated || state.saving) return;
    const reason = $('changeReason').value.trim(); if (reason.length < 3 || reason.length > 500) { errorIn('reviewError', 'Tuliskan alasan perubahan sepanjang 3–500 karakter.'); return; }
    const pending = clone(state.pending), epoch = state.epoch; state.saving = true; $('confirmSaveButton').disabled = true; $('cancelReviewButton').disabled = true; $('confirmSaveButton').textContent = 'Menyimpan…'; errorIn('reviewError');
    try {
      const saved = await api('/api/admin/' + (pending.type === 'business' ? 'business' : 'content'), { method: 'PUT', body: { ...pending.payload, reason } });
      if (epoch !== state.epoch || !state.authenticated) return;
      if (pending.type === 'business') acceptBusiness(saved);
      else acceptSavedContent(saved, pending.payload.path);
      if (epoch !== state.epoch || !state.authenticated) return;
      $('reviewDialog').close(); renderEvents(); toast('Perubahan berhasil disimpan di Cloudflare.');
    } catch (error) {
      if (epoch !== state.epoch || !state.authenticated) return;
      if (error.status === 409) {
        $('reviewDialog').close();
        if (pending.type === 'business') { state.staleBusiness = true; $('reviewBusinessButton').disabled = true; errorIn('businessError', 'Pengaturan sudah diubah pada tab lain. Draf Anda tetap terlihat; muat ulang data sebelum menyimpan lagi.'); }
        else { state.stalePages.add(pending.payload.path); renderContent(); }
      } else errorIn('reviewError', error.message + ' Jika hasil penyimpanan belum pasti, muat ulang data sebelum mengulangi perubahan.');
    } finally { state.saving = false; $('confirmSaveButton').disabled = false; $('cancelReviewButton').disabled = false; $('confirmSaveButton').textContent = 'Ya, simpan perubahan'; }
  });
  $('reloadBusinessButton').addEventListener('click', async () => {
    if (state.saving || (businessChanges().length && !confirm('Muat ulang pengaturan bisnis dan buang draf perubahan yang belum disimpan?'))) return;
    const epoch = state.epoch; $('reloadBusinessButton').disabled = true; $('businessFieldset').disabled = true;
    try { const result = await api('/api/admin/business'); if (epoch !== state.epoch || !state.authenticated) return; acceptBusiness(result); renderEvents(); toast('Pengaturan terbaru dimuat.'); }
    catch (error) { if (epoch === state.epoch && state.authenticated) errorIn('businessError', error.message); }
    finally { $('reloadBusinessButton').disabled = false; $('businessFieldset').disabled = false; }
  });
  $('reloadContentButton').addEventListener('click', async () => {
    if (state.saving || (contentChanges().length && !confirm('Muat ulang halaman ini dan buang draf perubahan yang belum disimpan?'))) return;
    const epoch = state.epoch, path = state.pagePath; $('reloadContentButton').disabled = true; $('contentFieldset').disabled = true;
    try {
      const result = await api('/api/admin/content'); if (epoch !== state.epoch || !state.authenticated) return;
      acceptSavedContent(result, path); renderEvents(); toast('Isi halaman terbaru dimuat.');
    } catch (error) { if (epoch === state.epoch && state.authenticated) errorIn('contentError', error.message); }
    finally { $('reloadContentButton').disabled = false; $('contentFieldset').disabled = false; }
  });
  $('retryButton').addEventListener('click', () => { loadAll().catch(error => { if ($('loginView').hidden) showLoadError(error); }); });
  $('logoutButton').addEventListener('click', async () => {
    if (state.saving || (anyDirty() && !confirm('Keluar dan buang draf perubahan yang belum disimpan?'))) return;
    $('logoutButton').disabled = true;
    try { await api('/api/admin/logout', { method: 'POST', body: {} }); showLogin('Anda sudah keluar dari admin.'); }
    catch (error) { if (state.authenticated) toast(error.message); }
    finally { $('logoutButton').disabled = false; }
  });
  addEventListener('beforeunload', event => { if (state.authenticated && anyDirty()) { event.preventDefault(); event.returnValue = ''; } });
  addEventListener('pagehide', () => { clearPrivateState(); });
  addEventListener('pageshow', event => { if (event.persisted) loadAll().catch(error => { if ($('loginView').hidden) showLoadError(error); }); });
  loadAll().catch(error => { if ($('loginView').hidden) showLoadError(error); });
})();
