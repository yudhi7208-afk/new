# Pratinjau perpindahan PosLoker

Target pratinjau adalah `new.yudhi7208.workers.dev`. Website WordPress lama
tetap beroperasi dan melayani pelanggan. Domain, DNS, dan hosting asal belum
diubah. Implementasi checkout Cloudflare masih untuk simulasi pemilik,
bukan pengalihan transaksi pelanggan.

## Halaman publik dan checkout

- HTML beranda, direktori area, halaman kota, gambar, logo, CSS, JavaScript,
  dan font tersedia sebagai aset statis.
- Navigasi, pencarian kota, filter wilayah, pilihan paket, dan kalkulator
  harga mempertahankan data katalog sumber saat ekspor.
- Tautan pemesanan pratinjau membuka `/pembayaran/` pada Worker yang sama.
  Checkout memakai katalog D1 berisi 49 kota dan 16 kelompok harga; server
  memeriksa kota/paket dan menetapkan nominal serta kode unik.
- Alur baru mencakup penawaran, formulir pelanggan, unggahan bukti/materi
  ke R2 privat, penyimpanan pesanan D1, ringkasan dengan tautan pribadi, dan
  tombol WhatsApp yang dibuka serta dikirim sendiri oleh pengguna.

Mode yang disiapkan adalah `preview`. Pengunjung dapat melihat katalog,
tetapi penawaran, pengiriman, dan ringkasan memerlukan pemilik yang sudah
masuk ke admin. Penawaran/pengiriman memakai sesi checkout; ringkasan baru
memakai kapabilitas fragment dan tetap memerlukan pemilik untuk simulasi.
Pesanan pratinjau selalu
ditandai `is_test=1` dan **SIMULASI**. Gunakan data dan berkas contoh;
**jangan melakukan transfer**. Tidak ada pesan WhatsApp, notifikasi, atau
publikasi otomatis dari simulasi ini.

Banner, robots, dan `X-Robots-Tag` tetap menandai pratinjau serta mencegah
pengindeksan. Jangan menghapus `noindex` pada tahap simulasi.
Daftar halaman dan checksum aset ada di `migration-manifest.json`.
Rincian alur, konfigurasi, dan pemulihan ada di [panduan checkout](checkout.md).

## Snapshot historis privat

Salinan pelanggan, pesanan, dan seluruh metadata terkait sudah dipindahkan
ke D1 privat `new-posloker-customers` melalui binding `CUSTOMER_DB`.
Hasil impor dicocokkan seluruh kolomnya dengan snapshot sumber. Data ini
tidak berada di repository maupun direktori aset publik.

Bukti dan materi sumber sudah disalin ke R2 privat
`new-posloker-customer-files`, binding `CUSTOMER_FILES`. Semua objek dibaca
kembali melalui akses privat; ukuran byte dan SHA-256-nya cocok dengan
staging sumber. Katalog `order_files` di D1 juga dicocokkan seluruh kolom,
checksum baris, dan hubungan pesanan/snapshot-nya.

Bucket tidak memiliki domain publik atau akses `r2.dev`. Unduhan berkas
memerlukan sesi admin. Pesanan Cloudflare baru memakai tabel
`commerce_orders`, `commerce_files`, dan `commerce_events`; snapshot
WordPress beserta ID, nomor, metadata mentah, dan checksum asal dipertahankan.

## Panel admin

Panel `/admin/` menyediakan masuk pemilik, daftar dan pencarian pesanan,
filter status/arsip/sumber, detail, unduhan privat, serta perubahan status
dan catatan dengan riwayat audit. Daftar menggabungkan pesanan WordPress
dan Cloudflare dengan penanda sumber; pesanan percobaan memiliki badge
**SIMULASI**. Aktivasi pertama memakai token sekali pakai; pemilik memilih
kata sandinya sendiri.

Status kerja historis disimpan terpisah dari snapshot. Pesanan native
Cloudflare memiliki status kerja dan riwayatnya sendiri. Pemeriksaan revisi
menolak penimpaan perubahan yang lebih baru.

Panel Cloudflare tidak menulis balik ke WordPress. Pesanan, berkas, atau
perubahan baru di WordPress belum otomatis direplikasi. Lihat
[panduan data pelanggan](customer-data-migration.md) dan
[panduan admin](admin.md).

## Ekspor ulang dan deploy

```sh
npm ci
node scripts/export-posloker.mjs
npm run test:migration
npm run test:admin
npm run test:business
npm run test:legacy
node scripts/test-checkout.mjs
npx wrangler deploy --dry-run
npx wrangler deploy
```

Checkout dan panel lengkap memerlukan migrasi sampai `0008_receipt_access.sql` serta konfigurasi privat D1
sebelum diuji pada lingkungan tujuan. Perintah deploy tidak mengalihkan
domain atau mengaktifkan mode layanan nyata dengan sendirinya.

Pengaturan bisnis dan isi dasar halaman tersedia di `/admin/business.html`.
Harga, kontak, konfigurasi kalkulator, kartu paket, dan data terstruktur
halaman kota menggunakan D1. Arsip/pulihkan pesanan tidak mengubah snapshot.
Tautan admin dan ringkasan WordPress lama ditangani melalui rute kompatibel.
Guard pengalihan sumber tersedia sebagai [artefak terpisah](wordpress-handover.md),
belum dipasang atau diaktifkan pada hosting lama.

Ekspor memakai cache lokal `.cache/posloker-source`. Untuk snapshot publik
baru, gunakan direktori cache baru melalui `POSLOKER_EXPORT_CACHE`, lalu
periksa perubahan halaman dan harga. Konfigurasi harga D1 perlu disiapkan
ulang secara terpisah bila katalog berubah.

Statistik PosLoker / PosLoker Insights dihapus dari WordPress sesuai
keputusan pengguna. Pelacak pengunjung tidak dipasang atau dimigrasikan ke
Cloudflare; ekspor ulang tetap membuang skrip tersebut.

## Sebelum pengalihan domain

Selesaikan pemeriksaan browser dan pengujian alur gratis/berbayar,
unggahan, ringkasan, WhatsApp manual, dan pengelolaan admin. Periksa pula
penolakan akses anonim, pesanan ganda, serta kegagalan database/penyimpanan.
Pengujian kode tidak berarti transaksi pelanggan sudah dialihkan.

Menjelang pengalihan, ambil backup sumber terbaru dan rekonsiliasi delta
pesanan, status, metadata, serta berkas yang masuk ke WordPress setelah
snapshot. Pertahankan perubahan kerja admin Cloudflare dan pisahkan data
simulasi dari riwayat transaksi nyata.

Mode `live`, pengalihan domain/DNS, penyesuaian tautan/canonical, dan perubahan
SEO/`noindex` hanya dilakukan setelah pengujian, rekonsiliasi terakhir, dan
permintaan pengalihan eksplisit pengguna. Hosting lama tetap berjalan
selama proses tersebut. Jangan menganggap snapshot yang sudah diverifikasi
sebagai replikasi langsung atau seluruh migrasi telah selesai melayani pelanggan.
