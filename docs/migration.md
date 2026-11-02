# Perpindahan PosLoker ke Cloudflare

Endpoint Workers adalah `new.yudhi7208.workers.dev`. Pengalihan yang
disetujui pengguna sedang berlangsung pada 2 November 2026. Checkout
Cloudflare sudah `live`; guard sumber telah menghentikan penulisan
pesanan/status WordPress. Maintenance publik terjadwal 07.00–08.00 WIB
berakhir otomatis, tetapi guard handover tetap aktif setelahnya.
Nameserver registrar tersimpan sekitar 07.24–07.25 WIB dan tetap Cloudflare.
Zona dan HTTPS apex/`www` sudah aktif; pemeriksaan domain resmi 51/51
halaman lulus. Maintenance sumber berakhir pukul 08.00 WIB dan plugin
sudah dinonaktifkan. Masuk pemilik pada hostname resmi serta uji email
tetap memerlukan penerimaan pemilik. Hosting/email lama dan backup
tetap dipertahankan.

## Halaman publik dan checkout

- HTML beranda, direktori area, halaman kota, gambar, logo, CSS, JavaScript,
  dan font tersedia sebagai aset statis.
- Navigasi, pencarian kota, filter wilayah, pilihan paket, dan kalkulator
  harga mempertahankan data katalog sumber saat ekspor.
- Tautan pemesanan membuka `/pembayaran/` pada Worker yang sama.
  Checkout memakai katalog D1 berisi 49 kota dan 16 kelompok harga; server
  memeriksa kota/paket dan menetapkan nominal serta kode unik.
- Alur baru mencakup penawaran, formulir pelanggan, unggahan bukti/materi
  ke R2 privat, penyimpanan pesanan D1, ringkasan dengan tautan pribadi, dan
  tombol WhatsApp yang dibuka serta dikirim sendiri oleh pengguna.

Mode `live` menerima penawaran dan pesanan tamu. Mode `preview` tetap
tersedia untuk lingkungan uji terisolasi dan memerlukan pemilik. Pesanan
simulasi lama tetap `is_test=1` dan **SIMULASI**; ringkasannya tetap
memerlukan pemilik. Penawaran/pengiriman memakai sesi checkout; ringkasan
baru memakai kapabilitas fragment. Aplikasi tidak mengirim WhatsApp,
notifikasi, atau publikasi secara otomatis.

Host `workers.dev` tetap `noindex`. Kebijakan domain resmi dibedakan dari
endpoint tersebut; admin, API, checkout, dan ringkasan privat tetap tidak
untuk pengindeksan. Verifikasi responsnya setelah zona aktif.
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

Ekspor SQL/WXR final setelah freeze cocok dengan 16 pesanan, 15 profil
kontak konservatif, 394 metadata, dan 32 referensi berkas di tujuan. Tidak
ada perubahan atau tambahan sehingga tidak ada impor ulang. Pemeriksaan
langsung pada hosting mencocokkan SHA-256/ukuran seluruh 32 jalur sumber
dengan 27 objek historis R2. Tujuh opsi bisnis/tema dan tiga baris konten
publik tetap sama; satu opsi baru adalah guard handover yang disengaja.

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
Guard pengalihan sumber pada [panduan handover](wordpress-handover.md)
sudah dipasang dan aktif pada hosting lama; write lock diverifikasi.
Sampel processlist database sebelum ekspor menunjukkan nol koneksi lain
dan nol koneksi aktif milik pengguna database sumber. Sampel ini tidak
membuktikan status seluruh request PHP yang sudah berjalan atau direct SQL
di luar hook WordPress; lihat batas bukti pada daftar kesiapan.

Ekspor memakai cache lokal `.cache/posloker-source`. Untuk snapshot publik
baru, gunakan direktori cache baru melalui `POSLOKER_EXPORT_CACHE`, lalu
periksa perubahan halaman dan harga. Konfigurasi harga D1 perlu disiapkan
ulang secara terpisah bila katalog berubah.

Statistik PosLoker / PosLoker Insights dihapus dari WordPress sesuai
keputusan pengguna. Pelacak pengunjung tidak dipasang atau dimigrasikan ke
Cloudflare; ekspor ulang tetap membuang skrip tersebut.

## Penyelesaian pengalihan domain

Rekonsiliasi final sumber dan berkas telah lulus. Pemeriksaan 51/51 halaman
Workers dalam mode `live` lulus. Setelah Cloudflare menyatakan zona aktif,
periksa HTTPS dan rute apex/`www`, canonical/robots, masuk pemilik dengan
akun yang sama, checkout/ringkasan, dan kirim/terima email. Pemulihan pemilik
tersedia melalui [helper operator offline yang diuji](owner-recovery.md);
akun produksi tidak direset saat pengalihan.

Zona tujuan mempertahankan nilai 18/18 record non-web yang diperiksa;
record ACME tambahan Cloudflare dan TTL 300 merupakan perubahan platform
yang diharapkan. Host email dan alias layanan tetap DNS-only menuju
hosting lama. Jangan menonaktifkan guard atau hosting/email sumber hanya
karena nameserver sudah disimpan. Propagasi, TLS, dan penerimaan domain
resmi masih perlu bukti terpisah.
