# POSI — fondasi terisolasi

Fondasi dan aktivasi AI staging, 3 November 2026.
**Workers AI dan chat tetap hanya di staging.** Pemberitahuan meeting sementara
sudah dinonaktifkan dan dihapus pada 5 November 2026 karena meeting selesai.
Dasar produksi yang disetujui kini `545b5593737c090c5f4c11aa30fe844e41cb6cd6`;
lihat [catatan pemberitahuan](../docs/posi-posting-notice-20261105.md).
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
| `posi/src/budget.mjs` | Counter harian global khusus AI, tanpa percakapan atau data pelanggan |
| `posi/knowledge/catalog.json` | Snapshot publik repository, bukan harga operasional produksi |
| `posi/widget/` | Loader, chat Shadow DOM, CSS, maskot SVG original dan unit test |
| `posi/preview/` | Contoh formulir, adapter terbatas dan bootstrap lokal |
| `posi/scripts/` | Build aset preview, pembuat snapshot dan fixture checkout asli |
| `posi/test/` | Uji keamanan, adapter, isolasi serta integrasi order dummy |
| `posi/wrangler.jsonc`, `posi/package.json`, `posi/.gitignore` | Konfigurasi dan perintah terpisah |

AI tetap terisolasi dari pengumuman sementara yang disetujui tersebut. Alur AI:
widget → API Worker POSI → aturan/knowledge → klasifikasi AI opsional →
jawaban teks atau draft. Tidak ada tool pembayaran/order maupun binding
`CUSTOMER_DB`, `CUSTOMER_FILES`, service binding, KV, atau database percakapan.
Durable Object `POSI_AI_BUDGET` yang terpisah hanya menyimpan hari UTC dan
jumlah reservasi AI; tidak dapat membaca atau menulis transaksi.

## Yang bekerja pada tahap ini

- Robot SVG orisinal putih bersih dengan aksen biru dan kuning, animasi ringan/reduced-motion.
  Ini placeholder 2D yang mudah diganti aset 3D, bukan render WebGL.
- POSI bersembunyi pada awal kunjungan. Setelah60 detik pada tab aktif dan
  25 detik tanpa aktivitas/kemajuan, satu tawaran kecil muncul per sesi.
  Tidak menyela isian aktif, dialog pembayaran, kontrol order, atau receipt
  selesai. Panel bantuan baru terbuka jika pengguna menerima atau meminta
  bantuan manual; tutup/penolakan mengembalikan POSI ke keadaan tersembunyi.
- Sapaan “Halo, ada yang bisa saya bantu?” memakai suara Indonesia lokal
  atau tiga nada lembut original bila browser mengizinkan setelah interaksi.
  Mute tersedia, tanpa mikrofon atau izin notifikasi. Tidak ada suara/request
  AI saat halaman dimuat atau selama menunggu.
- FAQ Indonesia, bantuan desain gratis, manfaat tanpa janji hasil,
  panduan bertahap/highlight, kontak WhatsApp melalui klik pengguna.
- Tautan cara memasang, cek order dan konfirmasi tersedia dalam respons serta
  panduan `/panduan/`. Cek order pribadi hanya memakai capability halaman
  receipt sendiri melalui adapter browser; capability tidak dikirim ke AI.
  Pengingat pembayaran bersyarat dan tidak meminta transfer/submit ulang
  setelah receipt berhasil. POSI tidak melakukan pencarian data pelanggan.
- Referensi kota/paket dari snapshot repository; diberi label staging.
  Sesudah 24 jam nominal ditahan sampai snapshot diperbarui. Total server
  checkout selalu menjadi acuan; tidak ada harga yang dibuat model.
- Draft hanya berasal dari teks pengguna. `adText` terpisah dari `caption`.
  Persetujuan isi dan overwrite terpisah; compare-and-set melindungi ketikan
  yang berubah. Tidak mencentang consent order atau menekan submit.
- Flag frontend OFF berhenti sebelum fetch/import/DOM. Backend OFF menolak
  chat. Config timeout 3,5 detik, chat 10 detik, inference 8 detik, tanpa retry
  otomatis. Kegagalan chat memberi FAQ lokal dan tidak mengunci formulir.
- Batas pesan 1.200 karakter/JSON 4KiB, CORS origin tepat, tanpa credential
  frontend, tanpa history persisten/log aplikasi, output memakai textContent.
  Konteks hanya page/city/packageId/step, tanpa isi form/token/receipt.
- Rate limit request dan inference terpisah. Circuit breaker inference
  terbuka setelah 3 kegagalan selama 60 detik. AI hanya mengembalikan intent
  dalam allowlist; tidak bisa mengeksekusi tool atau menghasilkan fakta harga.
- Model nyata memahami maksud pertanyaan bebas yang belum cocok dengan FAQ
  kata kunci. Jawaban bisnis tetap dipilih dari panduan terkontrol. Pertanyaan
  bantuan tidak dijadikan draft lowongan; POSI meminta informasi pekerjaan
  dahulu. Draft eksplisit tetap ditinjau dan disetujui pengguna.
- Maksimal 100 reservasi AI per hari UTC (reset 07.00 WIB). Counter atomik
  bersama seluruh lokasi; kegagalan juga memakan satu slot dan tidak diulang.
  Jika counter tidak tersedia atau habis, FAQ dan formulir tetap berjalan.

## Konfigurasi Cloudflare

Nama Worker staging `new-posi-staging`, tanpa custom domain/routes dan tanpa
storage order. Aset dibuat ke `.preview-public/` yang diabaikan Git.

| Nama | Default / penggunaan |
| --- | --- |
| `POSI_ENABLED` | `false`; override `true` hanya pada pratinjau staging saat ini |
| `POSI_AI_ENABLED` | `false` dalam file; override `true` hanya staging yang diuji |
| `POSI_ALLOWED_ORIGINS` | Loopback dan origin Worker staging tepat; origin produksi ditolak |
| `POSI_GREETING` | Opsional, maksimal 300 karakter; fallback sapaan Indonesia |
| `POSI_AI_MODEL` | `@cf/meta/llama-3.2-3b-instruct`, allowlist server |
| `POSI_AI_MAX_TOKENS` | 96; server membatasi 32–192 token |
| `POSI_AI_DAILY_LIMIT` | 100 percobaan/hari, batas keras maksimum100 |
| `POSI_RATE_LIMITER` | Binding platform, 20 request/60 detik per hash IP |
| `POSI_AI_RATE_LIMITER` | Binding platform, 10 inference/60 detik per lokasi Cloudflare |
| `AI` | Binding Workers AI terpasang hanya pada Worker POSI |
| `POSI_AI_BUDGET` | Binding Durable Object SQLite `PosiAiBudget`, satu counter agregat |

Tidak dibutuhkan API key frontend. Binding Workers AI memakai akun Cloudflare;
jika kelak memakai provider eksternal, key hanya lewat Cloudflare Secrets.
Lihat [binding Workers AI](https://developers.cloudflare.com/workers-ai/configuration/bindings/).
Rate limit platform bersifat perkiraan per lokasi, **bukan batas biaya bulanan
global**; lihat [batas rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
Counter terpisah membatasi jumlah pemanggilan AI secara global. Ini bukan
batas tagihan seluruh akun, sebab layanan Cloudflare lain memiliki pemakaian
sendiri. Tidak ada percakapan yang disimpan.

Binding `"ai": { "binding": "AI" }` dan migrasi namespace counter khusus
POSI telah dipasang. Model lama pada fondasi diganti dengan
[Llama3.2 3B](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/).
Gunakan dua flag ON hanya melalui konfigurasi POSI staging. Jangan memberi
binding database transaksi. Uji jarak jauh hanya memakai pertanyaan sintetis:

```powershell
node posi/scripts/test-ai-staging.mjs
```

Skrip ini dibatasi ke satu origin staging, maksimum3 inference nyata, dan
memeriksa `source:ai`, makna jawaban, serta penolakan origin produksi.

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

Untuk mengaktifkan model pada staging yang sudah lulus pengujian:

```powershell
npx wrangler deploy --config posi/wrangler.jsonc --var POSI_ENABLED:true --var POSI_AI_ENABLED:true
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
Migrasi `posi-ai-budget-v1` hanya membuat namespace counter POSI; tidak ada
migrasi database order. Gunakan versi rollback yang sudah mengekspor class
`PosiAiBudget` (versi OFF aman: `18ea9e1a-dfdc-49c6-ad2e-bdbbc9756c4d`),
agar kompatibel dengan namespace counter. Counter tidak direset saat rollback.
Produksi saat ini tidak perlu rollback karena tidak dimodifikasi.

Belum selesai untuk rilis pelanggan: sinkronisasi katalog
operasional baca-saja, hook form resmi, panel admin konfigurasi POSI/FAQ/model/
limit, statistik bantuan agregat, anggaran biaya akun, pengujian Android/iPhone
fisik dan persetujuan pemilik. Tidak ada pelacak pengunjung yang dipasang.
CSS/connect CSP produksi juga perlu rancangan sempit sebelum integrasi;
kelonggaran style inline pada sandbox tidak diterapkan ke produksi.

Rilis produksi kelak harus mendapat persetujuan baru: integrasi dengan flag
OFF → regresi order staging → aktivasi internal → peluncuran bertahap.
Lihat `docs/posi-validation.md` untuk hasil dan batas bukti tahap pertama.
Hasil aktivasi model nyata dicatat dalam `docs/posi-ai-staging.md`.
Perubahan bantuan proaktif dan tautan 5 November dicatat pada
`docs/posi-proactive-assistance.md`.
