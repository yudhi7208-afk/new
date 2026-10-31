# Pratinjau PosLoker di Cloudflare Workers

Salinan halaman publik `https://posloker.my.id` untuk meninjau perpindahan ke
Cloudflare Workers Static Assets. Target pratinjau adalah
`https://new.yudhi7208.workers.dev`; domain dan hosting asal tidak diubah.

Beranda, direktori area, 49 halaman kota, gambar, CSS, JavaScript, dan font
berjalan dari `public/`. Pencarian kota, filter wilayah, dan pilihan paket
mempertahankan perilaku serta data harga situs asal saat ekspor.

**Pesanan dan pembayaran masih dilanjutkan di situs asal.** Salinan data
pelanggan dan riwayat pesanan disimpan privat di D1 `new-posloker-customers`
melalui binding `CUSTOMER_DB`. Bukti dan materi yang dirujuk pesanan sudah
disalin ke R2 privat `new-posloker-customer-files`, binding `CUSTOMER_FILES`.
Isi objek sudah diunduh kembali melalui akses privat dan dicocokkan ukuran
serta SHA-256-nya; katalog D1 juga sudah diperiksa seluruh kolom dan relasinya.
Tidak ada endpoint publik yang menyajikan data atau berkas pelanggan.
Handler PHP, alur unggahan baru, dan dashboard WordPress masih perlu
diadaptasi sebelum pengalihan trafik.
Lihat [catatan migrasi](docs/migration.md) dan [manifest ekspor](docs/migration-manifest.json).
Alur persiapan dan validasi data ada di [panduan data pelanggan](docs/customer-data-migration.md).

## Persiapan

Gunakan Node.js 22 atau lebih baru yang masih didukung Cloudflare, lalu instal
dependensi sesuai lockfile:

```sh
npm ci
```

## Jalankan secara lokal

```sh
npx wrangler dev
```

## Validasi konfigurasi

```sh
npx wrangler deploy --dry-run
```

## Deploy ke Cloudflare

Masuk ke akun Cloudflare yang memiliki izin Workers:

```sh
npx wrangler login
npx wrangler deploy
```

Untuk CI, gunakan `CLOUDFLARE_API_TOKEN` dan `CLOUDFLARE_ACCOUNT_ID` sebagai
environment variable. Jangan simpan kredensial di repository.

Nama Worker adalah `new`, tanggal kompatibilitas `2026-10-30`, dan direktori
aset `./public`. Database D1 memakai akses akun/binding Cloudflare; data
pelanggan tidak disajikan oleh halaman statis. Bucket R2 tetap privat tanpa
domain publik atau akses `r2.dev`. Domain khusus belum diubah.

## Memperbarui salinan publik

```sh
npm run export:posloker
```

Ekspor hanya membaca halaman publik dan menyimpan cache di `.cache/`.
Gunakan direktori cache baru melalui `POSLOKER_EXPORT_CACHE` untuk mengambil
snapshot yang lebih baru. Periksa perubahan harga dan halaman sebelum deploy.

## Alat migrasi data privat

Gunakan Node.js 24 untuk menjalankan alat persiapan dan pemeriksaan berbasis
SQLite. Pengujian memakai data sintetis:

```sh
npm run test:migration
```

Dump database, SQL berisi pelanggan, SQLite lokal, bukti transfer, dan hasil
verifikasi disimpan di folder kerja privat di luar repository dan `public/`.
