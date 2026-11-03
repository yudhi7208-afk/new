# Validasi POSI tahap pertama — 3 November 2026

Status: fondasi dan pratinjau terisolasi, **bukan rilis produksi**.
Branch `feature/posi-ai-assistant`; dasar `d8ed838`.

## Hasil otomatis

`npm test --prefix posi`: **48 tes lulus, 0 gagal**.

- Backend: flag, origin/CORS tanpa credential, blok origin produksi, limit
  request/input/stream, model/token allowlist, injection, harga snapshot dan
  kedaluwarsa, draft tanpa data karangan, timeout/error/kuota/model tidak ada,
  circuit breaker dan larangan meneruskan endpoint checkout/admin.
- Adapter: persetujuan boolean, hanya Teks Materi, persetujuan overwrite
  terpisah, compare-and-set saat ketikan berubah, batas 2.000 karakter,
  field disabled/hidden/read-only, event input/change, consent order tetap
  tidak dicentang, tanpa submit atau perubahan caption/pembayaran.
- Loader/widget: OFF nol fetch/import/DOM; gagal config tidak melempar ke
  checkout; konteks tanpa data form/receipt; timeout membatalkan request
  opsional; FAQ offline dan tautan kontak dibatasi.
- Isolasi: hash setiap berkas produksi yang dilindungi sama dengan dasar;
  tidak ada bootstrap POSI pada entry produksi; konfigurasi staging tanpa
  binding order/R2/service atau route domain produksi.
- Integrasi menjalankan **Worker checkout asli** dalam Miniflare D1/R2
  memori. Enam mode: OFF, ON, API AI gagal, lambat 1,5 detik, config gagal,
  widget tidak tersedia. Masing-masing menyimpan satu order dummy beserta
  bukti dan poster PDF dummy: total 6 order / 12 berkas. Harga, pilihan,
  adText dan caption tetap utuh. Validasi nama, consent dan bukti wajib
  tetap menolak input kurang. Tidak ada order dummy produksi.

`npm run test:checkout` serta `npm run test:admin`: lulus, mencakup validasi
server, idempotensi, unggahan privat, receipt, autentikasi, CSRF, status dan
konflik revisi. `npm run build --prefix posi` dan Wrangler deploy dry-run
konfigurasi POSI lulus; bundle Worker 41,27KiB / gzip 8,49KiB, startup 1–2ms,
aset preview 12 berkas termasuk konfigurasi header lokal. Tidak ada
framework/dependensi runtime tambahan.

## Pemeriksaan browser

Browser aplikasi dengan viewport desktop/tablet/HP, bukan perangkat fisik.

| Pemeriksaan | Hasil |
| --- | --- |
| Dialog pembayaran existing terbuka | Widget ada tetapi launcher tersembunyi; dialog tetap independen |
| Tutup dialog dan buka POSI | Panel nonmodal terbuka, tanpa backdrop atau scroll-lock |
| Fokus field formulir | Panel mengecil dan launcher disembunyikan selama input aktif |
| Draft saat field berisi | Isi lama utuh setelah klik pertama; baru berubah sesudah “Ya, ganti isi lama” |
| Setelah penerapan draft | Hanya adText berubah; caption dan consent order tidak berubah |
| Kirim order berbayar dummy dengan bukti+poster | Receipt berhasil dan tombol WhatsApp tampil; WhatsApp tidak dibuka/dikirim |
| Reload receipt dummy | Receipt kembali tersedia, tanpa kebutuhan POSI |
| Client flag OFF, order gratis dummy | Widget tidak ada; order berhasil, nominal Rp0 dan tombol WhatsApp tampil |
| Lima viewport | 1366×768, 820×1180, 390×844, 320×568, 844×390: panel di dalam layar, tombol tutup terlihat, tanpa overflow horizontal |
| Hide/restore, tutup dan Escape | Berfungsi di pratinjau Cloudflare |
| FAQ desain gratis remote staging | Menjelaskan Teks Materi, bukan Caption |

Ditemukan panel mobile awal terpotong scrollbar Windows. Diperbaiki dengan
lebar viewport dari `document.documentElement.clientWidth` dan ResizeObserver;
lima ukuran diuji ulang dengan panel benar-benar terbuka. CSS
`prefers-reduced-motion` mematikan animasi. Keyboard virtual Android/iPhone
dan browser fisik lain belum diuji.

## Staging dan rollback teruji

Worker **new-posi-staging**:
https://new-posi-staging.yudhi7208.workers.dev/

1. Versi sehat `97d2f329-6545-4689-a5ca-8549c8a7086e` diterbitkan manual
   dengan override `POSI_ENABLED=true`; `POSI_AI_ENABLED=false`, tanpa
   binding AI/database/R2/order.
2. Deploy konfigurasi default OFF menghasilkan versi
   `9e9e2c7a-6035-4af3-ad9a-9ffe37593623`.
   GET config menghasilkan `enabled:false`; POST chat status503.
3. `wrangler rollback` dengan konfigurasi POSI mengembalikan versi sehat
   `97d2f329-6545-4689-a5ca-8549c8a7086e`. Pemeriksaan ulang:
   `enabled:true`, `aiEnabled:false`, chat200 dan FAQ desain benar.

Sesudah aturan mengalah terhadap tombol penting ditambahkan dan seluruh
48 tes lulus, versi akhir staging diterbitkan manual:
`65051216-c4ff-4b2c-96ed-839d25a46100`. Versi rollback yang diuji di atas
tetap tersedia sebagai fallback; perubahan akhir hanya adapter/UI staging.

Rollback dilakukan **hanya Worker staging**. Worker produksi `new` tetap
versi `0968fc7c-0108-407c-8ef0-844346b0e144` pada pemeriksaan awal.
Homepage produksi GET200 tanpa widget/loader POSI. DNS/nameserver, order,
harga, admin, pembayaran dan source hosting tidak diubah.

## Git dan auto build

Dashboard Cloudflare diperiksa baca-saja sebelum push: production branch
`main`, deploy command `npx wrangler deploy`; Previews Base memakai
`npx wrangler preview`, preview builds ON, dan **No connected bindings**.
Branch fitur bukan cabang produksi. Konfigurasi dashboard tidak diubah.
[Dokumentasi branch build](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
menjelaskan perbedaan production/preview;
[isolasi resource](https://developers.cloudflare.com/workers/previews/resources/)
menjelaskan preview tidak mengambil alih domain produksi. POSI tetap
diterbitkan manual menggunakan konfigurasi Worker tersendiri; jangan
menganggap preview generik Worker transaksi sebagai demo POSI atau mengisinya
dengan data pelanggan.

## Batas klaim dan gerbang rilis

Inference AI nyata belum dilakukan: jawaban remote memakai aturan; jalur
Workers AI diuji dengan mock. Kegagalan layanan lambat pada integrasi 1,5 detik
membuktikan ketidakbergantungan submit, sedangkan ambang timeout frontend diuji
terpisah dengan mock. Tidak ada bukti semua jaringan/perangkat 100% aman.

Belum ada panel admin POSI/statistik bantuan, sinkronisasi harga operasional,
hook form resmi atau aset 3D final. Harga snapshot tidak boleh dianggap harga
aktif produksi. Rate limiter per lokasi tidak membentuk batas tagihan global.
Semua ini harus dilengkapi/ditinjau sebelum pemilik menyetujui pemasangan
produksi, termasuk pemasangan dengan flag OFF. Tidak ada persetujuan aktivasi
pelanggan yang diasumsikan dari tugas tahap pertama ini.
