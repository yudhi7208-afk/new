# Pratinjau PosLoker di Cloudflare Workers

Salinan halaman publik `https://posloker.my.id` untuk meninjau perpindahan ke
Cloudflare Workers Static Assets. Target pratinjau adalah
`https://new.yudhi7208.workers.dev`; domain dan hosting asal tidak diubah.

Beranda, direktori area, 49 halaman kota, gambar, CSS, JavaScript, dan font
berasal dari `public/`. Worker menampilkan harga, kontak, dan perubahan
konten yang didukung dari D1. Halaman publik, kalkulator, kartu paket,
data terstruktur, dan checkout memakai katalog harga yang sama.

Kode pratinjau memuat checkout `/pembayaran/`: pilihan kota/paket, harga dan
kode unik dari server, formulir pelanggan, unggahan privat, serta ringkasan
pesanan dan tombol WhatsApp manual. Katalog D1 memuat 49 kota dan 16 kelompok
harga. **Checkout masih mode simulasi: jangan melakukan transfer.** Pengunjung
dapat melihat katalog; hanya pemilik yang masuk ke admin dapat membuat
penawaran, mengirim simulasi, dan membuka ringkasannya. Pesanan baru
pratinjau diberi `is_test=1` dan label **SIMULASI**. Pesanan baru dapat
dibuka kembali melalui tautan pribadi berkunci fragment setelah sesi
checkout berakhir; selama simulasi tetap memerlukan pemilik. Kunci tidak
ditaruh di query atau pesan WhatsApp.

Salinan pelanggan dan riwayat WordPress disimpan privat di D1
`new-posloker-customers` melalui `CUSTOMER_DB`. Bukti dan materi sumber
sudah disalin ke R2 privat `new-posloker-customer-files`, binding
`CUSTOMER_FILES`; isi objek serta katalog D1 sudah dicocokkan dengan sumber.
Pesanan Cloudflare baru disimpan terpisah dari snapshot historis.
Panel `/admin/` menggabungkan keduanya dengan penanda sumber, riwayat
perubahan, arsip/pulihkan, dan unduhan privat yang memerlukan sesi admin.
Halaman `/admin/business.html` mengelola harga, pembayaran, kontak, serta
judul/deskripsi/teks pembuka halaman yang tersedia. Snapshot dan ID historis
dipertahankan; perubahan admin memakai revisi serta audit. Tautan ringkasan
WordPress lama juga didukung tanpa membuka berkas pelanggan ke publik.

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
Status bukti pengujian, gerbang penerbitan, dan persiapan domain/email ada
di [daftar kesiapan pengalihan](docs/cutover-readiness.md). Artefak pengalihan
penulisan WordPress beserta prosedur preflight ada di
[panduan handover](docs/wordpress-handover.md); artefak itu belum dipasang
atau diaktifkan pada hosting lama.

## Pedoman pengelolaan proyek

Keputusan pengguna: **satu website satu proyek** agar mudah dikelola.
Repository dan Worker `new` khusus PosLoker; website lain dibuat sebagai
proyek terpisah. Biaya mengikuti pemakaian setiap layanan.
Pedoman ini juga disimpan di [AGENTS.md](AGENTS.md) untuk pekerjaan berikutnya.

## Persiapan

Gunakan Node.js 24 untuk menjalankan proyek beserta alat SQLite dan
pengujiannya, lalu instal dependensi sesuai lockfile:

```sh
npm ci
```

## Jalankan secara lokal

```sh
npx wrangler dev
```

Panel admin berada di `/admin/`. Sebelum digunakan, terapkan migrasi skema
admin dan siapkan aktivasi pemilik sekali pakai sesuai panduan admin.
Terapkan skema secara berurutan sampai `0008_receipt_access.sql`; checkout
juga memerlukan konfigurasi bisnis privat pada D1. Lihat panduan checkout
dan admin. Pertahankan mode `preview` pada Worker tujuan selama persiapan.
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
npm run test:checkout
npm run test:business
npm run test:legacy
```

Pengujian integrasi HTTP/browser memerlukan Worker lokal terisolasi yang
skema dan data contohnya sudah disiapkan. Bukti pengujian lokal dan
penerbitan tujuan dicatat terpisah pada daftar kesiapan; hasil lokal tidak
mengaktifkan transaksi nyata atau mengalihkan domain.

Dump database, SQL berisi pelanggan, SQLite lokal, bukti transfer, dan hasil
verifikasi disimpan di folder kerja privat di luar repository dan `public/`.
