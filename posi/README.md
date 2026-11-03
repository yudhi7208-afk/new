# POSI — fondasi terisolasi

Tahap pertama, 3 November 2026. **POSI belum terpasang di website produksi.**
Worker transaksi `new`, seluruh `public/`, `src/`, migrasi dan konfigurasi root
tetap identik dengan commit dasar `d8ed83858c602125d7ddd9189cc032ed191bff44`.
Branch kerja: `feature/posi-ai-assistant`.

Pratinjau: https://new-posi-staging.yudhi7208.workers.dev/

Pratinjau Cloudflare adalah contoh formulir bantuan, tanpa penerimaan order,
unggahan atau pembayaran. Uji checkout asli dilakukan secara lokal dengan
D1/R2 dalam memori dan pengaturan pembayaran sintetis. Tidak ada database
pelanggan yang disalin, dibaca, atau ditulis oleh POSI.

## Berkas dan arsitektur

| Area baru | Isi |
| --- | --- |
| `docs/posi-audit.md` | Arsitektur existing, field, sumber data dan batas integrasi |
| `posi/AGENTS.md` | Batas zero disruption dari pemilik |
| `posi/src/worker.mjs` | API config/chat, flag, CORS, limit, fallback dan aset staging |
| `posi/src/knowledge.mjs` | FAQ/aturan, harga referensi, desain dan draft |
| `posi/src/ai.mjs` | Adapter Workers AI opsional, timeout, validasi intent dan circuit breaker |
| `posi/knowledge/catalog.json` | Snapshot publik repository, bukan harga operasional produksi |
| `posi/widget/` | Loader, chat Shadow DOM, CSS, maskot SVG original dan unit test |
| `posi/preview/` | Contoh formulir, adapter terbatas dan bootstrap lokal |
| `posi/scripts/` | Build aset preview, pembuat snapshot dan fixture checkout asli |
| `posi/test/` | Uji keamanan, adapter, isolasi serta integrasi order dummy |
| `posi/wrangler.jsonc`, `posi/package.json`, `posi/.gitignore` | Konfigurasi dan perintah terpisah |

Tidak ada berkas existing produksi yang diubah. Alur:
widget → API Worker POSI → aturan/knowledge → klasifikasi AI opsional →
jawaban teks atau draft. Tidak ada tool pembayaran/order maupun binding
`CUSTOMER_DB`, `CUSTOMER_FILES`, service binding, KV, atau database percakapan.

## Yang bekerja pada tahap ini

- Robot SVG orisinal putih/biru/kuning, animasi ringan/reduced-motion.
  Ini placeholder 2D yang mudah diganti aset 3D, bukan render WebGL.
- Sapaan kecil sekali per sesi; panel dibuka pengguna, dapat ditutup,
  diminimalkan/disembunyikan, Escape, keyboard dan ARIA.
- FAQ Indonesia, bantuan desain gratis, manfaat tanpa janji hasil,
  panduan bertahap/highlight, kontak WhatsApp melalui klik pengguna.
- Referensi kota/paket dari snapshot repository; diberi label staging.
  Sesudah 24 jam nominal ditahan sampai snapshot diperbarui. Total server
  checkout selalu menjadi acuan; tidak ada harga yang dibuat model.
- Draft hanya berasal dari teks pengguna. `adText` terpisah dari `caption`.
  Persetujuan isi dan overwrite terpisah; compare-and-set melindungi ketikan
  yang berubah. Tidak mencentang consent order atau menekan submit.
- Flag frontend OFF berhenti sebelum fetch/import/DOM. Backend OFF menolak
  chat. Config timeout 3,5 detik, chat 9 detik, inference 8 detik, tanpa retry
  otomatis. Kegagalan chat memberi FAQ lokal dan tidak mengunci formulir.
- Batas pesan 1.200 karakter/JSON 4KiB, CORS origin tepat, tanpa credential
  frontend, tanpa history persisten/log aplikasi, output memakai textContent.
  Konteks hanya page/city/packageId/step, tanpa isi form/token/receipt.
- Rate limit request dan inference terpisah. Circuit breaker inference
  terbuka setelah 3 kegagalan selama 60 detik. AI hanya mengembalikan intent
  dalam allowlist; tidak bisa mengeksekusi tool atau menghasilkan fakta harga.

## Konfigurasi Cloudflare

Nama Worker staging `new-posi-staging`, tanpa custom domain/routes dan tanpa
storage order. Aset dibuat ke `.preview-public/` yang diabaikan Git.

| Nama | Default / penggunaan |
| --- | --- |
| `POSI_ENABLED` | `false`; override `true` hanya pada pratinjau staging saat ini |
| `POSI_AI_ENABLED` | `false`; inference nyata belum diaktifkan |
| `POSI_ALLOWED_ORIGINS` | Loopback dan origin Worker staging tepat; origin produksi ditolak |
| `POSI_GREETING` | Opsional, maksimal 300 karakter; fallback sapaan Indonesia |
| `POSI_AI_MODEL` | `@cf/meta/llama-3.1-8b-instruct`, allowlist server |
| `POSI_AI_MAX_TOKENS` | 96; server membatasi 32–192 token |
| `POSI_RATE_LIMITER` | Binding platform, 20 request/60 detik per hash IP |
| `POSI_AI_RATE_LIMITER` | Binding platform, 10 inference/60 detik per lokasi Cloudflare |
| `AI` | Binding Workers AI opsional; sengaja belum dipasang |

Tidak dibutuhkan API key frontend. Binding Workers AI memakai akun Cloudflare;
jika kelak memakai provider eksternal, key hanya lewat Cloudflare Secrets.
Lihat [binding Workers AI](https://developers.cloudflare.com/workers-ai/configuration/bindings/).
Rate limit platform bersifat perkiraan per lokasi, **bukan batas biaya bulanan
global**; lihat [batas rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

Untuk tahap AI nyata berikutnya: tinjau model/biaya/kuota, pasang
`"ai": { "binding": "AI" }` pada konfigurasi POSI staging saja, lalu set
`POSI_AI_ENABLED=true` di staging dan jalankan uji inference nyata. Jangan
menjalankan konfigurasi produksi atau memberi binding database transaksi.
Saat ini jawaban demo menggunakan aturan; integrasi AI diuji dengan mock.

## Perintah pengembangan dari root repository

```powershell
npm ci
npm test --prefix posi
npm run test:checkout
npm run test:admin
npm run build --prefix posi
npx wrangler deploy --config posi/wrangler.jsonc --dry-run
npm run dev --prefix posi
```

Fixture membuka loopback `http://127.0.0.1:8790/`; contoh checkout:
`/pembayaran/?city=Medan&package=komplit`. Mode stdin `on`, `off`, `ai-error`,
`slow`, `config-error`, `missing-widget`, `summary`, `stop`. Tambahkan
`&posiOff` untuk client flag OFF. Semua data hilang saat proses dihentikan.
Jangan memasukkan data pelanggan sebenarnya. Port 8787/website lain tidak disentuh.

Penerbitan manual **hanya staging** setelah pengujian:

```powershell
npm run build --prefix posi
npx wrangler deploy --config posi/wrangler.jsonc --var POSI_ENABLED:true
```

Jangan menjalankan `npm run deploy` root untuk pekerjaan POSI. Jangan push
`main`. Sebelum push branch fitur, periksa kebijakan eksternal Cloudflare
Builds agar tidak memicu deployment Worker transaksi. Commit tidak menjadi
izin penerbitan produksi.

## Rollback dan tahap berikutnya

Kill switch staging: jalankan deploy dengan konfigurasi POSI default (kedua
flag OFF), verifikasi `/api/posi/config` memberi `enabled:false`; formulir
independen tetap dapat diisi. Untuk rollback versi staging yang telah diuji:

```powershell
npx wrangler rollback <ID_VERSI_POSI_SEBELUMNYA> --config posi/wrangler.jsonc --message "Rollback POSI staging" --yes
```

Catat ID versi sehat dari hasil deploy dan uji ulang config, asset, FAQ serta
form sandbox setelah rollback. Jangan memakai ID versi Worker `new`.
POSI tidak mempunyai migrasi sehingga rollback tidak membatalkan data order.
Produksi saat ini tidak perlu rollback karena tidak dimodifikasi.

Belum selesai untuk rilis pelanggan: inference AI nyata, sinkronisasi katalog
operasional baca-saja, hook form resmi, panel admin konfigurasi POSI/FAQ/model/
limit, statistik bantuan agregat, anggaran biaya akun, pengujian Android/iPhone
fisik dan persetujuan pemilik. Tidak ada pelacak pengunjung yang dipasang.
CSS/connect CSP produksi juga perlu rancangan sempit sebelum integrasi;
kelonggaran style inline pada sandbox tidak diterapkan ke produksi.

Rilis produksi kelak harus mendapat persetujuan baru: integrasi dengan flag
OFF → regresi order staging → aktivasi internal → peluncuran bertahap.
Lihat `docs/posi-validation.md` untuk hasil dan batas bukti tahap pertama.
