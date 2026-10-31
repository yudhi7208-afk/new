# Pratinjau perpindahan PosLoker

Target saat ini adalah `new.yudhi7208.workers.dev`. Domain dan hosting WordPress
asal tidak diubah.

## Sudah dipindahkan

- HTML publik beranda, direktori area, dan seluruh halaman kota yang terdaftar.
- Gambar, logo, stylesheet, JavaScript tampilan, dan font disimpan di `public/`.
- Navigasi publik, pencarian kota, filter wilayah, pemilih paket, dan kalkulator
  harga berjalan dari aset statis. Harga disalin dari sumber saat ekspor.
- Banner menandai versi pratinjau. Robots dan `X-Robots-Tag` mencegah pratinjau
  diindeks mesin pencari sebelum domain siap.

Daftar halaman dan checksum aset ada di `migration-manifest.json`.

## Tetap pada hosting asal

Pemesanan, pembayaran, konfirmasi pembayaran, serta unggahan bukti dan materi
tetap diarahkan ke `https://posloker.my.id`. Halaman transaksi tidak diekspor:
kode unik, nonce WordPress, dan handler PHP harus dibuat oleh server asal.
Tracker statistik WordPress tidak dijalankan dari pratinjau.

Salinan pelanggan, pesanan, dan seluruh metadata terkait sudah dipindahkan ke
D1 privat `new-posloker-customers` melalui binding `CUSTOMER_DB`. Hasil impor
dicocokkan seluruh kolomnya dengan snapshot sumber. Data ini tidak berada di
repository maupun direktori aset publik.

Ini masih pratinjau aplikasi: handler PHP, akses staf, dan proses unggahan
perlu diadaptasi sebelum transaksi dilayani dari Worker. Situs WordPress
masih menjadi sumber pesanan baru; lakukan rekonsiliasi delta menjelang
cutover. Domain dan DNS belum diubah.

Lihat [panduan data pelanggan](customer-data-migration.md) untuk persiapan
privat, pemeriksaan, dan batas snapshot. Pemindahan berkas privat ke R2
memerlukan aktivasi penyimpanan yang terpisah dari database.

## Ekspor ulang dan deploy

```sh
npm ci
node scripts/export-posloker.mjs
npx wrangler deploy --dry-run
npx wrangler deploy
```

Ekspor menggunakan cache lokal `.cache/posloker-source` agar tidak mengambil
ulang sumber yang sama. Untuk snapshot baru gunakan direktori cache baru lewat
environment variable `POSLOKER_EXPORT_CACHE`.

## Tahap backend berikutnya

Backup tema `posloker-premium`, plugin `posloker-payment`, database sumber,
dan berkas terkait sudah disiapkan di folder kerja privat. Pisahkan rahasia
dan data pelanggan dari Git. Adaptasikan handler pemesanan, kode unik,
akses staf, unggahan, dan notifikasi pada backend baru.
Domain baru dialihkan setelah fungsi tersebut diuji dan disetujui.
