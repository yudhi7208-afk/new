# Checkout PosLoker di Cloudflare

Halaman `/pembayaran/` menyalin alur pemilihan paket, informasi pembayaran,
formulir pelanggan, unggahan, dan ringkasan pesanan ke Worker proyek `new`.
Penyimpanan baru memakai D1 dan R2 privat. Ini masih **mode simulasi
(`preview`): jangan melakukan transfer**. WordPress lama tetap melayani
pelanggan; domain, DNS, dan hosting lama belum diubah.

Pengunjung dapat melihat katalog kota/paket. Dalam preview, hanya pemilik
yang sudah masuk ke `/admin/` pada origin yang sama dapat meminta penawaran,
mengirim simulasi, dan membaca ringkasan. Server memeriksa akses ini;
mengaktifkan tombol lewat browser tidak melewati pembatasan.
Seluruh pesanan baru preview ditandai `is_test=1` dan **SIMULASI**.

## Alur yang tersedia

1. Buka `/pembayaran/`, pilih kota dan paket. Katalog saat disiapkan berisi
   49 kota dan 16 kelompok harga. Harga pada tampilan publik adalah salinan
   katalog; server D1 menjadi acuan penawaran saat checkout.
2. Pemilik yang masuk menerima penawaran dari server. Harga dasar, paket,
   fitur, dan pengaturan pembayaran disimpan pada penawaran. Paket berbayar
   mendapat kode 1–99 dan total harga dasar ditambah kode tersebut. Paket
   gratis tetap memiliki harga dasar, kode, dan total nol.
3. Isi nama/kontak, teks lowongan, caption, catatan, persetujuan, serta berkas
   contoh. Paket berbayar memerlukan contoh bukti transfer. Server
   memvalidasi isian, jenis/isi berkas, ukuran, dan sesi; nilai harga atau
   kode dari formulir tidak dipercaya.
4. Pengiriman menyimpan pesanan, referensi berkas, dan kejadian pembuatan.
   Idempotency key serta klaim pengiriman mencegah percobaan yang sama
   membuat pesanan ganda. Ulangi data yang sama bila hasil belum pasti;
   jangan membuat pesanan pengganti untuk melewati penguncian.
5. Ringkasan menampilkan nomor, kota, paket, nominal, dan status. Ringkasan
   terikat sesi browser checkout pembuatnya, bukan tautan publik yang dapat
   dibuka hanya dengan mengetahui nomor/ID. Dalam preview, sesi pemilik
   juga tetap diperlukan.
6. Tombol WhatsApp membuka pesan siap isi. Pengguna sendiri memilih untuk
   membuka dan mengirimnya. Aplikasi maupun agen tidak otomatis mengirim
   pesan, email, notifikasi, atau memublikasikan lowongan.

Sesi checkout berlaku paling lama satu jam. Penawaran berakhir paling lambat
bersamaan dengan sesi. Total berbayar direservasi dalam mode yang sama;
reservasi pesanan yang tersimpan diperpanjang sampai 24 jam setelah
penyimpanan. Reservasi preview dan live dipisahkan. Ini bukan verifikasi
bank otomatis: status pembayaran tetap diperiksa oleh pemilik.

## Berkas dan panel admin

Bukti menerima JPG, PNG, WebP, atau PDF, dengan batas dari konfigurasi privat
(1–10 MiB). Materi gambar/PDF dan video digabung maksimal 10 berkas dan
10 MiB; MP4 hanya untuk paket Komplit PLUS. Server memeriksa ekstensi, MIME,
signature berkas, dan ukuran, lalu menghitung SHA-256.

Objek baru disimpan di namespace `private/commerce/` dalam R2
`CUSTOMER_FILES`. Bucket tetap tanpa akses publik/`r2.dev`; unduhan
memerlukan API admin terautentikasi. Halaman ringkasan tidak memberikan
tautan publik ke objek.

Pesanan baru memakai `commerce_orders`, berkas pada `commerce_files`, dan
kejadian/audit pada `commerce_events`. Tabel tersebut terpisah dari
snapshot WordPress `orders`, `order_meta`, dan `order_files`. Nomor
simulasi memakai awalan `CF-TEST-`; nomor historis tidak diubah.

Panel `/admin/` menggabungkan kedua sumber dengan filter dan badge
**WordPress**/**Cloudflare**, ditambah badge **SIMULASI** untuk pesanan
percobaan. Detail, unduhan, perubahan status/catatan, riwayat, dan pemeriksaan
revisi tersedia tanpa mengubah snapshot sumber.

## Konfigurasi privat

Terapkan `migrations/0005_checkout.sql` setelah migrasi snapshot, berkas,
dan admin. Skema membuat `commerce_settings` dengan mode awal `preview`.
Katalog, pengaturan pembayaran, serta batas bukti diisi melalui konfigurasi
D1; nilai rekening/kontak aktual tidak ditulis pada HTML, Git, atau panduan.

Contoh berikut menyiapkan artefak lokal dari backup privat, tanpa
mengeksekusi PHP atau mengubah hosting asal. Sesuaikan lokasi backup:

```sh
node scripts/prepare-checkout-config.mjs --dump ../private-posloker/source/posloker-mysql.sql --plugin-source ../private-posloker/source/code/plugins/posloker-payment/posloker-payment.php --out-dir ../private-posloker/prepared/checkout --prefix wpjj_
```

Alat membaca katalog halaman publik dan pengaturan pembayaran sumber,
lalu menghasilkan `checkout-config.private.json`,
`checkout-config.private.sql`, serta manifest privat di luar repository
dan `outputs`. SQL disiapkan untuk input Console satu baris; jangan
menyalin isinya ke dokumentasi, log publik, atau tangkapan layar.
Penerapan SQL dilakukan operator melalui akses D1 yang sah.

SQL konfigurasi merupakan impor awal, bukan perintah pembaruan berulang.
Entri mode memakai `INSERT OR IGNORE`; menjalankan alat tidak menjamin
mode database yang sudah terisi berubah. Periksa bahwa nilai mode D1 tetap
`preview` sebelum pengujian. Jangan mengaktifkan `live` saat persiapan.
Jika katalog sumber berubah, siapkan dan tinjau konfigurasi baru secara
terpisah; ekspor HTML tidak otomatis memperbarui D1.

## Rekonsiliasi pengiriman yang belum pasti

Respons terputus tidak membuktikan commit D1 gagal. Pengunggahan R2 juga
dapat berhasil sebelum responsnya terputus. Kode membaca ulang status
pengiriman, mempertahankan berkas ketika commit ambigu, dan memakai nonce
klaim untuk mencegah penulis tertunda membuat pesanan setelah pembersihan.
Jika pembersihan tidak berhasil, klaim `checkout_submissions` dapat tetap
`processing` agar percobaan berikutnya tidak mengunggah salinan ganda.

Untuk operator:

1. Pertahankan data percobaan dan idempotency key yang sama. Minta pengguna
   tidak membuat pesanan lain. Pengiriman ulang manual dengan data yang
   sama dapat memulihkan hasil commit yang sudah lengkap.
2. Bila tetap terkunci, periksa secara privat `checkout_submissions`,
   `checkout_quotes`, `commerce_orders`, `commerce_files`, dan
   `commerce_events`. Cocokkan sesi, penawaran, klaim/nonce, status
   pengiriman, referensi pesanan, serta apakah penulis masih dapat berjalan.
3. Cocokkan keadaan D1 dengan manifest objek privat R2: kunci objek,
   referensi pesanan, ukuran, dan SHA-256. Simpan hasil pemeriksaan di luar
   Git/`public`/`outputs`. Periksa objek yang mungkin sudah tertulis
   meskipun respons unggah gagal.
4. Tentukan pemulihan hanya setelah hasil commit dan kepemilikan setiap
   objek terbukti. Catat keputusan operator dan hasil verifikasi.

**Jangan membuka kunci, mengganti nonce, menghapus klaim/objek, atau
mereset status secara buta maupun otomatis.** Masa tunggu saja tidak
membuktikan tidak ada commit/penulis tertunda. Tidak ada tombol pemulihan
otomatis untuk kasus ambigu; jangan menghapus berkas pesanan yang ternyata
sudah berhasil disimpan.

## Pengujian dan pengalihan layanan

```sh
node scripts/test-checkout.mjs
npm run test:admin
npx wrangler deploy --dry-run
```

Pengujian memakai data sintetis, termasuk validasi harga/kode, isolasi
preview, sesi/CSRF, batas/signature berkas, ringkasan privat, pengiriman
bersamaan, respons commit hilang, kegagalan pembersihan, dan penulisan D1
tertunda sebelum/sesudah pembatalan klaim. Lakukan juga pemeriksaan browser
gratis/berbayar, tampilan seluler, akses pemilik/anonim, unduhan, dan WhatsApp
manual pada lingkungan tujuan.

WordPress yang tetap berjalan belum otomatis direplikasi. Menjelang
pengalihan, perbarui backup sumber dan rekonsiliasi pesanan/status/berkas
terakhir serta perubahan kerja admin Cloudflare. Pisahkan simulasi dari
transaksi nyata. Mode `live`, domain/DNS, penyesuaian tautan/canonical, dan
SEO/`noindex` hanya diubah setelah pengujian lengkap, rekonsiliasi terakhir,
dan permintaan pengalihan eksplisit pengguna. Jangan menghentikan hosting
lama pada tahap simulasi ini.
