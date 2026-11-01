(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const labels = { pending: 'Menunggu verifikasi', approved: 'Lunas', rejected: 'Ditolak' };
  const state = { authenticated: false, csrfToken: '', user: null, page: 1, pages: 1, query: '', status: 'all', trash: false, selectedId: null, order: null, stale: false, listTicket: 0, detailTicket: 0, authEpoch: 0, pendingSave: null };
  // Activation secrets are kept only in memory, never in persistent browser storage.
  let setupToken = (new URLSearchParams(location.hash.slice(1)).get('setup') || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(setupToken)) setupToken = '';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  let toastTimer, savingOrder = false;

  const text = (id, value, fallback = '—') => { $(id).textContent = value === undefined || value === null || value === '' ? fallback : String(value); };
  function errorIn(id, message) { $(id).textContent = message || ''; $(id).hidden = !message; }
  function toast(message) { clearTimeout(toastTimer); text('toast', message); $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
  const currency = value => Number.isSafeInteger(Number(value)) ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value)) : '—';
  function date(value) {
    if (!value) return '—';
    const local = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/);
    if (local) {
      const month = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][Number(local[2]) - 1];
      return `${Number(local[3])} ${month || local[2]} ${local[1]} · ${local[4]}.${local[5]}`;
    }
    const parsed = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
    return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(parsed);
  }
  function bytes(value) { const n = Number(value); if (!Number.isFinite(n) || n < 0) return ''; return n < 1000 ? `${n} B` : n < 1e6 ? `${(n / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} KB` : `${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB`; }
  function badge(element, status) { element.className = 'status-badge' + (Object.hasOwn(labels, status) ? ' status-' + status : ''); element.textContent = labels[status] || 'Belum ditentukan'; }
  function node(tag, className, content) { const element = document.createElement(tag); if (className) element.className = className; if (content !== undefined && content !== null) element.textContent = String(content); return element; }
  function busy(button, active, label) { button.disabled = active; button.textContent = active ? 'Memproses…' : label; }

  async function api(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const headers = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.csrfToken && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrfToken;
    try {
      const response = await fetch(path, { method: options.method || 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
      let result;
      try { result = await response.json(); } catch { throw Object.assign(new Error('Server belum dapat memberikan respons. Silakan coba lagi.'), { status: response.status }); }
      if (!response.ok) {
        if (response.status === 401 && state.authenticated) showLogin('Sesi Anda sudah berakhir. Silakan masuk kembali.');
        const message = typeof result?.error === 'string' ? result.error : typeof result?.message === 'string' ? result.message : 'Permintaan belum berhasil. Silakan coba lagi.';
        throw Object.assign(new Error(message), { status: response.status });
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Waktu tunggu habis. Periksa koneksi, lalu coba lagi.');
      if (error instanceof TypeError) throw new Error('Tidak dapat terhubung. Periksa koneksi Anda.');
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function clearDetail() {
    state.detailTicket++;
    state.order = null; state.selectedId = null; state.pendingSave = null; state.stale = false;
    $('detailView').hidden = true; $('detailPlaceholder').hidden = false;
    $('workspace').classList.remove('has-detail');
    for (const id of ['detailHeading', 'detailDate', 'detailCustomer', 'detailWhatsapp', 'detailEmail', 'detailCity', 'detailPackage', 'detailBaseAmount', 'detailUniqueCode', 'detailAmount', 'sourceNotes']) text(id, '', '');
    $('detailStatus').textContent = ''; $('filesList').replaceChildren(); $('eventsList').replaceChildren();
    $('adText').value = ''; $('caption').value = ''; $('adminNote').value = ''; $('changeReason').value = '';
    $('conflictNotice').hidden = true; errorIn('detailError', ''); errorIn('confirmError', '');
    if ($('confirmDialog').open) $('confirmDialog').close();
    document.querySelectorAll('.is-selected').forEach(element => element.classList.remove('is-selected'));
  }

  function clearPrivateState() {
    state.authEpoch++; state.listTicket++; clearDetail();
    state.authenticated = false; state.csrfToken = ''; state.user = null;
    state.query = ''; state.status = 'all'; state.page = 1; state.pages = 1; state.trash = false;
    $('ordersBody').replaceChildren(); $('accountEmail').textContent = ''; $('snapshotDate').textContent = '';
    for (const id of ['statTotal', 'statPending', 'statApproved', 'statRejected']) text(id, '—');
    $('searchInput').value = ''; $('statusFilter').value = 'all'; $('visibilityFilter').value = 'active';
    errorIn('listError', ''); $('toast').hidden = true; clearTimeout(toastTimer);
  }

  function showLogin(message = '', setupRequired = false, setupAvailable = true) {
    clearPrivateState();
    $('globalStatus').hidden = true; $('dashboardView').hidden = true; $('logoutButton').hidden = true; $('authView').hidden = false;
    $('loginPassword').value = ''; $('setupPassword').value = ''; $('setupPasswordConfirm').value = '';
    $('loginForm').hidden = false; $('setupForm').hidden = true; $('authNotice').hidden = true; $('retrySessionButton').hidden = true;
    text('authTitle', 'Masuk ke ruang admin'); text('authDescription', 'Gunakan akun pengelola PosLoker untuk panel ini.'); errorIn('authError', message);
    $('setupButton').disabled = false;
    if (setupRequired) {
      $('loginForm').hidden = true; $('setupForm').hidden = false;
      $('setupCodeField').hidden = Boolean(setupToken); $('setupCode').required = !setupToken;
      text('authTitle', 'Aktifkan akun admin'); text('authDescription', 'Buat akun pemilik untuk mengelola pesanan PosLoker di Cloudflare.');
      text('authNotice', setupAvailable ? 'Akun admin belum dibuat. Gunakan tautan aktivasi khusus atau masukkan kode aktivasi pemilik. Buat kata sandi baru minimal 15 karakter.' : 'Akun admin belum dibuat, tetapi aktivasi belum tersedia atau sudah kedaluwarsa. Mintalah tautan atau kode aktivasi baru dari pemilik situs.'); $('authNotice').hidden = false;
      $('setupButton').disabled = !setupAvailable;
    } else {
      const hadActivation = Boolean(setupToken || $('setupCode').value);
      setupToken = '';
      $('setupCode').value = ''; $('setupCode').required = false;
      if (hadActivation) { text('authNotice', 'Aktivasi tidak tersedia atau sudah selesai. Silakan masuk dengan akun admin Anda.'); $('authNotice').hidden = false; }
    }
  }

  function showSessionError(error) {
    clearPrivateState();
    $('globalStatus').hidden = true; $('dashboardView').hidden = true; $('logoutButton').hidden = true; $('authView').hidden = false;
    $('loginForm').hidden = true; $('setupForm').hidden = true; $('authNotice').hidden = true; $('retrySessionButton').hidden = false;
    $('loginPassword').value = ''; $('setupPassword').value = ''; $('setupPasswordConfirm').value = '';
    text('authTitle', 'Status akun belum dapat diperiksa'); text('authDescription', 'Periksa koneksi, lalu coba kembali untuk melanjutkan aktivasi atau masuk.');
    errorIn('authError', error.message);
  }

  async function loadSession() {
    const session = await api('/api/admin/session');
    if (!session.authenticated) { showLogin('', Boolean(session.setupRequired), session.setupAvailable !== false); return; }
    clearPrivateState(); state.authenticated = true; state.csrfToken = session.csrfToken || ''; state.user = session.user || {};
    setupToken = ''; $('setupCode').value = ''; $('loginPassword').value = ''; $('setupPassword').value = ''; $('setupPasswordConfirm').value = '';
    $('globalStatus').hidden = true; $('authView').hidden = true; $('dashboardView').hidden = false; $('logoutButton').hidden = false;
    text('accountEmail', session.user?.email || 'Admin PosLoker');
    const snapshot = session.migration?.sourceSnapshotAt;
    text('snapshotDate', snapshot ? 'Snapshot sumber: ' + date(snapshot) : 'Salinan awal migrasi · belum tersinkron otomatis', '');
    await loadOrders();
  }

  async function authenticate(event, setup) {
    event.preventDefault();
    const button = setup ? $('setupButton') : $('loginButton');
    const label = setup ? 'Aktifkan akun admin →' : 'Masuk ke admin →';
    errorIn('authError', '');
    const password = $(setup ? 'setupPassword' : 'loginPassword').value;
    const payload = { email: $(setup ? 'setupEmail' : 'loginEmail').value.trim(), password };
    if (setup) {
      if (password.length < 15) { errorIn('authError', 'Gunakan kata sandi dengan minimal 15 karakter.'); return; }
      if (password !== $('setupPasswordConfirm').value) { errorIn('authError', 'Kedua kata sandi belum sama. Silakan periksa kembali.'); $('setupPasswordConfirm').focus(); return; }
      const token = (setupToken || $('setupCode').value.trim()).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(token)) { errorIn('authError', 'Masukkan kode aktivasi pemilik yang terdiri dari 64 karakter huruf a–f dan angka 0–9, atau buka tautan aktivasi khusus.'); $('setupCodeField').hidden = false; $('setupCode').required = true; $('setupCode').focus(); return; }
      payload.token = token; payload.passwordConfirm = $('setupPasswordConfirm').value;
    }
    busy(button, true, label);
    try {
      await api(setup ? '/api/admin/setup' : '/api/admin/login', { method: 'POST', body: payload });
      if (setup) { setupToken = ''; $('setupCode').value = ''; }
      await loadSession();
      if (state.authenticated && setup) toast('Akun admin aktif. Selamat datang di PosLoker.');
    } catch (error) { errorIn('authError', error.message); }
    finally { $(setup ? 'setupPassword' : 'loginPassword').value = ''; if (setup) $('setupPasswordConfirm').value = ''; busy(button, false, label); }
  }

  function renderLoading() {
    $('ordersBody').replaceChildren();
    const row = node('tr', 'loading-row'), cell = node('td', '', 'Memuat pesanan…'); cell.colSpan = 4; row.append(cell); $('ordersBody').append(row);
    $('listEmpty').hidden = true; $('previousButton').disabled = true; $('nextButton').disabled = true;
  }

  async function loadOrders() {
    if (!state.authenticated) return;
    const ticket = ++state.listTicket, epoch = state.authEpoch;
    renderLoading(); errorIn('listError', '');
    const query = new URLSearchParams({ q: state.query, status: state.status, page: String(state.page), trash: state.trash ? '1' : '0' });
    try {
      const result = await api('/api/admin/orders?' + query);
      if (ticket !== state.listTicket || epoch !== state.authEpoch || !state.authenticated) return;
      const orders = Array.isArray(result.orders) ? result.orders : [];
      state.page = Number(result.page) || 1; state.pages = Math.max(1, Math.ceil((Number(result.total) || 0) / (Number(result.pageSize) || 20)));
      $('ordersBody').replaceChildren();
      for (const order of orders) {
        const row = node('tr'); if (String(order.id) === String(state.selectedId)) row.className = 'is-selected';
        row.dataset.orderId = String(order.id);
        const customerCell = node('td');
        const open = node('button', 'order-open', order.orderNumber || 'Pesanan #' + order.id); open.type = 'button'; open.addEventListener('click', () => loadDetail(order.id, true));
        customerCell.append(open, node('span', 'order-name', order.customerName || 'Tanpa nama'), node('span', 'order-meta', [order.city, date(order.orderedAt)].filter(Boolean).join(' · ')));
        const amountCell = node('td', 'order-amount', currency(order.amount));
        const statusCell = node('td'), status = node('span'); badge(status, order.status); statusCell.append(status);
        const arrowCell = node('td'), arrow = node('button', 'row-arrow', '›'); arrow.type = 'button'; arrow.setAttribute('aria-label', 'Lihat rincian ' + (order.orderNumber || 'pesanan')); arrow.addEventListener('click', () => loadDetail(order.id, true)); arrowCell.append(arrow);
        row.append(customerCell, amountCell, statusCell, arrowCell); $('ordersBody').append(row);
      }
      $('listEmpty').hidden = orders.length !== 0;
      const scope = state.trash ? 'Pesanan di sampah' : state.query ? 'Sesuai pencarian' : 'Pesanan aktif';
      text('statScope', scope); $('statsGrid').setAttribute('aria-label', 'Ringkasan ' + scope.toLowerCase());
      if (result.migration?.sourceSnapshotAt) text('snapshotDate', 'Snapshot sumber: ' + date(result.migration.sourceSnapshotAt));
      text('listCount', `${Number(result.total) || 0} pesanan ${state.trash ? 'di sampah' : 'ditemukan'}`);
      text('pageLabel', `Halaman ${state.page} dari ${state.pages}`);
      $('previousButton').disabled = state.page <= 1; $('nextButton').disabled = state.page >= state.pages;
      if (result.summary) for (const [key, id] of [['total', 'statTotal'], ['pending', 'statPending'], ['approved', 'statApproved'], ['rejected', 'statRejected']]) text(id, Number(result.summary[key]) || 0);
    } catch (error) {
      if (ticket !== state.listTicket || epoch !== state.authEpoch || !state.authenticated) return;
      $('ordersBody').replaceChildren(); errorIn('listError', error.message); text('listCount', 'Daftar belum berhasil dimuat.'); text('pageLabel', '');
    }
  }

  function renderFiles(files) {
    $('filesList').replaceChildren();
    if (!files.length) { $('filesList').append(node('p', 'no-files', 'Belum ada berkas yang terkait dengan pesanan ini.')); return; }
    for (const file of files) {
      let safeUrl = null;
      if (!file.missing && typeof file.url === 'string') {
        try { const url = new URL(file.url, location.origin); if (url.origin === location.origin && url.pathname.startsWith('/api/admin/')) safeUrl = url.href; } catch { /* No unsafe fallback URL. */ }
      }
      const card = node(safeUrl ? 'a' : 'div', 'file-card' + (file.missing ? ' file-missing' : ''));
      if (safeUrl) { card.href = safeUrl; card.target = '_blank'; card.rel = 'noreferrer noopener'; }
      const icon = node('span', 'file-icon', file.kind === 'proof' ? '▤' : '▧'); icon.setAttribute('aria-hidden', 'true');
      const info = node('span', 'file-info');
      info.append(node('span', 'file-kind', file.kind === 'proof' ? 'BUKTI TRANSFER' : 'MATERI PESANAN'), node('span', 'file-name', file.name || 'Berkas pesanan'), node('span', 'file-size', file.missing ? 'Berkas belum tersedia pada salinan migrasi.' : [bytes(file.bytes), safeUrl ? 'Unduh berkas privat' : 'Unduhan belum tersedia'].filter(Boolean).join(' · ')));
      card.append(icon, info);
      if (safeUrl) { const download = node('span', 'file-download-icon', '↓'); download.setAttribute('aria-hidden', 'true'); card.append(download); }
      $('filesList').append(card);
    }
  }

  function renderEvents(events) {
    $('eventsList').replaceChildren();
    if (!events.length) { const empty = node('li', 'events-empty', 'Belum ada perubahan dari panel Cloudflare.'); $('eventsList').append(empty); return; }
    for (const event of events) {
      const item = node('li');
      const title = event.action === 'status_changed' ? 'Status diubah menjadi ' + (labels[event.status] || 'status lain') : event.action === 'note_updated' ? 'Catatan internal diperbarui' : 'Pesanan diperbarui' + (labels[event.status] ? ' · ' + labels[event.status] : '');
      item.append(node('span', 'event-title', title), node('span', 'event-time', [date(event.at), event.actor].filter(Boolean).join(' · ')));
      if (event.reason) item.append(node('p', 'event-note', 'Alasan: ' + event.reason));
      if (event.note) item.append(node('p', 'event-note', 'Catatan: ' + event.note));
      $('eventsList').append(item);
    }
  }

  async function loadDetail(id, focus = false) {
    if (!state.authenticated) return;
    const epoch = state.authEpoch; clearDetail();
    state.selectedId = id; const ticket = ++state.detailTicket;
    $('detailPlaceholder').hidden = true; $('detailView').hidden = false; $('workspace').classList.add('has-detail');
    text('detailHeading', 'Memuat pesanan…'); $('orderFieldset').disabled = true;
    document.querySelectorAll('[data-order-id]').forEach(row => row.classList.toggle('is-selected', row.dataset.orderId === String(id)));
    if (focus && matchMedia('(max-width: 820px)').matches) $('detailPanel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    try {
      const result = await api('/api/admin/orders/' + encodeURIComponent(id));
      if (ticket !== state.detailTicket || epoch !== state.authEpoch || !state.authenticated) return;
      const order = result.order; if (!order || String(order.id) !== String(id)) throw new Error('Rincian pesanan belum tersedia.');
      state.order = order; state.stale = false;
      text('detailHeading', order.orderNumber || 'Pesanan #' + order.id); text('detailDate', date(order.orderedAt)); badge($('detailStatus'), order.status);
      for (const [key, target] of [['customerName', 'detailCustomer'], ['whatsapp', 'detailWhatsapp'], ['email', 'detailEmail'], ['city', 'detailCity'], ['packageName', 'detailPackage']]) text(target, order[key]);
      text('detailBaseAmount', currency(order.baseAmount)); text('detailUniqueCode', Number.isSafeInteger(Number(order.uniqueCode)) ? String(Number(order.uniqueCode)) : '—'); text('detailAmount', currency(order.amount));
      $('adText').value = order.adText || ''; $('caption').value = order.caption || ''; $('sourceNotes').textContent = order.notes || ''; $('sourceNotesSection').hidden = !order.notes;
      $('adminNote').value = order.adminNote || ''; $('orderStatus').value = Object.hasOwn(labels, order.status) ? order.status : 'pending';
      $('detailTrash').hidden = order.postStatus !== 'trash'; $('orderFieldset').disabled = order.postStatus === 'trash'; $('saveOrderButton').disabled = false;
      renderFiles(Array.isArray(result.files) ? result.files : []); renderEvents(Array.isArray(result.events) ? result.events : []);
      if (focus) $('detailHeading').focus({ preventScroll: true });
    } catch (error) {
      if (ticket !== state.detailTicket || epoch !== state.authEpoch || !state.authenticated) return;
      text('detailHeading', 'Rincian belum tersedia'); errorIn('detailError', error.message);
    }
  }

  $('loginForm').addEventListener('submit', event => authenticate(event, false));
  $('setupForm').addEventListener('submit', event => authenticate(event, true));
  $('retrySessionButton').addEventListener('click', async () => {
    busy($('retrySessionButton'), true, 'Periksa status akun kembali');
    try { await loadSession(); } catch (error) { showSessionError(error); }
    finally { busy($('retrySessionButton'), false, 'Periksa status akun kembali'); }
  });
  $('logoutButton').addEventListener('click', async () => {
    const button = $('logoutButton'); busy(button, true, 'Keluar');
    try { await api('/api/admin/logout', { method: 'POST', body: {} }); setupToken = ''; $('setupCode').value = ''; showLogin(); }
    catch (error) { if (state.authenticated) toast(error.message); }
    finally { busy(button, false, 'Keluar'); }
  });
  $('filterForm').addEventListener('submit', event => { event.preventDefault(); state.query = $('searchInput').value.trim(); state.page = 1; loadOrders(); });
  $('statusFilter').addEventListener('change', () => { state.status = $('statusFilter').value; state.page = 1; loadOrders(); });
  $('visibilityFilter').addEventListener('change', () => { state.trash = $('visibilityFilter').value === 'trash'; state.page = 1; clearDetail(); loadOrders(); });
  $('refreshButton').addEventListener('click', () => loadOrders());
  $('previousButton').addEventListener('click', () => { if (state.page > 1) { state.page--; loadOrders(); } });
  $('nextButton').addEventListener('click', () => { if (state.page < state.pages) { state.page++; loadOrders(); } });
  $('closeDetailButton').addEventListener('click', clearDetail);
  $('reloadDetailButton').addEventListener('click', () => { if (state.selectedId !== null) loadDetail(state.selectedId, true); });
  $('copyCaptionButton').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('caption').value); toast('Caption berhasil disalin.'); }
    catch { $('caption').focus(); $('caption').select(); toast('Pilih teks caption lalu salin secara manual.'); }
  });
  $('orderForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!state.order || state.order.postStatus === 'trash' || state.stale) return;
    const status = $('orderStatus').value, adminNote = $('adminNote').value.trim();
    if (!Object.hasOwn(labels, status)) return;
    const changed = status !== state.order.status;
    if (!changed && adminNote === (state.order.adminNote || '')) { toast('Tidak ada perubahan untuk disimpan.'); return; }
    state.pendingSave = { status, adminNote, expectedRevision: state.order.revision, orderId: state.order.id };
    text('confirmDescription', changed ? 'Status pembayaran akan menjadi “' + labels[status] + '”. Perubahan hanya berlaku di Cloudflare dan tercatat di riwayat.' : 'Catatan internal akan diperbarui pada salinan Cloudflare.');
    $('reasonField').hidden = false; $('changeReason').required = true; $('changeReason').value = ''; $('paidConfirmation').hidden = !(changed && status === 'approved'); errorIn('confirmError', '');
    $('confirmDialog').showModal(); $('changeReason').focus();
  });
  $('cancelConfirmButton').addEventListener('click', () => $('confirmDialog').close());
  $('confirmDialog').addEventListener('cancel', event => { if (savingOrder) event.preventDefault(); });
  $('confirmDialog').addEventListener('close', () => { state.pendingSave = null; $('changeReason').value = ''; errorIn('confirmError', ''); });
  $('confirmForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.pendingSave || !state.authenticated || savingOrder) return;
    const save = { ...state.pendingSave }, reason = $('changeReason').value.trim();
    if (reason.length < 3 || reason.length > 500) { errorIn('confirmError', 'Tuliskan alasan perubahan sepanjang 3–500 karakter.'); $('changeReason').focus(); return; }
    const epoch = state.authEpoch; savingOrder = true; busy($('confirmSaveButton'), true, 'Ya, simpan'); $('cancelConfirmButton').disabled = true; errorIn('confirmError', '');
    try {
      await api('/api/admin/orders/' + encodeURIComponent(save.orderId), { method: 'POST', body: { status: save.status, adminNote: save.adminNote, expectedRevision: save.expectedRevision, reason } });
      if (epoch !== state.authEpoch || !state.authenticated) return;
      $('confirmDialog').close(); await Promise.all([loadDetail(save.orderId), loadOrders()]); toast('Perubahan pesanan berhasil disimpan.');
    } catch (error) {
      if (epoch !== state.authEpoch || !state.authenticated) return;
      if (error.status === 409) { $('confirmDialog').close(); state.stale = true; $('saveOrderButton').disabled = true; $('conflictNotice').hidden = false; }
      else errorIn('confirmError', error.message);
    } finally { savingOrder = false; busy($('confirmSaveButton'), false, 'Ya, simpan'); $('cancelConfirmButton').disabled = false; }
  });
  // A restored page must revalidate its server session before showing customer data.
  addEventListener('pagehide', () => { if (state.authenticated) { clearPrivateState(); $('dashboardView').hidden = true; } });
  addEventListener('pageshow', event => { if (event.persisted) { $('authView').hidden = true; $('globalStatus').hidden = false; text('globalStatus', 'Memeriksa sesi…'); loadSession().catch(showSessionError); } });

  loadSession().catch(showSessionError);
})();
