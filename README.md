# Pratinjau PosLoker di Cloudflare Workers

Salinan halaman publik `https://posloker.my.id` untuk meninjau perpindahan ke
Cloudflare Workers Static Assets. Target pratinjau adalah
`https://new.yudhi7208.workers.dev`; domain dan hosting asal tidak diubah.

Beranda, direktori area, 49 halaman kota, gambar, CSS, JavaScript, dan font
berjalan dari `public/`. Pencarian kota, filter wilayah, dan pilihan paket
mempertahankan perilaku serta data harga situs asal saat ekspor.

Kode pratinjau memuat checkout `/pembayaran/`: pilihan kota/paket, harga dan
kode unik dari server, formulir pelanggan, unggahan privat, serta ringkasan
pesanan dan tombol WhatsApp manual. Katalog D1 memuat 49 kota dan 16 kelompok
harga. **Checkout masih mode simulasi: jangan melakukan transfer.** Pengunjung
dapat melihat katalog; hanya pemilik yang masuk ke admin dapat membuat
penawaran, mengirim simulasi, dan membuka ringkasannya pada sesi browser yang
sama. Pesanan baru pratinjau diberi `is_test=1` dan label **SIMULASI**.

Salinan pelanggan dan riwayat WordPress disimpan privat di D1
`new-posloker-customers` melalui `CUSTOMER_DB`. Bukti dan materi sumber
sudah disalin ke R2 privat `new-posloker-customer-files`, binding
`CUSTOMER_FILES`; isi objek serta katalog D1 sudah dicocokkan dengan sumber.
Pesanan Cloudflare baru disimpan terpisah dari snapshot historis.
Panel `/admin/` menggabungkan keduanya dengan penanda sumber, riwayat
perubahan, dan unduhan privat yang memerlukan sesi admin.

**WordPress lama tetap melayani pelanggan.** Domain, DNS, dan hosting lama
belum diubah. Pesanan WordPress yang masuk berikutnya tidak otomatis
direplikasi ke Cloudflare. Mode layanan nyata baru diaktifkan setelah
pengujian lengkap, pembaruan backup/delta terakhir, rekonsiliasi, dan
permintaan pengalihan eksplisit dari pengguna. Aturan `noindex` pratinjau
tetap berlaku sampai tahap tersebut.
Lihat [catatan migrasi](docs/migration.md) dan [manifest ekspor](docs/migration-manifest.json).
Alur persiapan dan validasi data ada di [panduan data pelanggan](docs/customer-data-migration.md).
Aktivasi pemilik dan pengoperasian panel ada di [panduan admin](docs/admin.md).
Alur simulasi, konfigurasi privat, dan pemulihan checkout ada di
[panduan checkout](docs/checkout.md).

## Pedoman pengelolaan proyek

Keputusan pengguna: **satu website satu proyek** agar mudah dikelola.
Repository dan Worker `new` khusus PosLoker; website lain dibuat sebagai
proyek terpisah. Biaya mengikuti pemakaian setiap layanan.
Pedoman ini juga disimpan di [AGENTS.md](AGENTS.md) untuk pekerjaan berikutnya.

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

Panel admin berada di `/admin/`. Sebelum digunakan, terapkan migrasi skema
admin dan siapkan aktivasi pemilik sekali pakai sesuai panduan admin.
Checkout memerlukan `0005_checkout.sql` dan konfigurasi bisnis pada D1;
lihat panduan checkout. Pertahankan mode `preview`.
Jangan memakai data pelanggan produksi untuk pengujian lokal.

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
npm run test:admin
node scripts/test-checkout.mjs
```

Dump database, SQL berisi pelanggan, SQLite lokal, bukti transfer, dan hasil
verifikasi disimpan di folder kerja privat di luar repository dan `public/`.
