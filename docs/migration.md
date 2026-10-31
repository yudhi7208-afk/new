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

Ini merupakan pemindahan tampilan publik, belum migrasi seluruh aplikasi.
Tidak ada database, autentikasi aplikasi, data pelanggan, token pembayaran,
atau domain khusus ditambahkan ke Worker.

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

Ambil backup tema `posloker-premium`, plugin `posloker-payment`, konfigurasi
terkait, serta struktur data dari hosting milik pengguna. Pisahkan rahasia dan
data pelanggan dari Git. Petakan handler pemesanan, kode unik, unggahan, dan
notifikasi sebelum menentukan kebutuhan penyimpanan/layanan backend.
Domain baru dialihkan setelah fungsi tersebut diuji dan disetujui.
