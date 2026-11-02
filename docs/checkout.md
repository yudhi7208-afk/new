# Checkout PosLoker di Cloudflare

Halaman `/pembayaran/` menyalin alur pemilihan paket, informasi pembayaran,
formulir pelanggan, unggahan, dan ringkasan pesanan ke Worker proyek `new`.
Penyimpanan memakai D1 dan R2 privat. Pada pengalihan yang disetujui
2 November 2026, mode Cloudflare sudah `live` dan guard pesanan/status
WordPress sudah aktif. Maintenance publik lama terjadwal 07.00–08.00 WIB
berakhir otomatis; guard penulisan tetap aktif setelahnya.

Dalam `live`, pengunjung dapat melihat katalog serta membuat penawaran
dan pesanan tanpa sesi admin. Dalam `preview`, hanya pemilik
yang sudah masuk ke `/admin/` pada origin yang sama dapat meminta penawaran,
mengirim simulasi, dan membaca ringkasan. Server memeriksa akses ini;
mengaktifkan tombol lewat browser tidak melewati pembatasan.
Seluruh pesanan baru preview ditandai `is_test=1` dan **SIMULASI**.
Pesanan simulasi yang sudah ada tetap uji setelah perubahan mode.
Nameserver tetap Cloudflare; zona, HTTPS apex/`www`, serta pemeriksaan
domain resmi 51/51 halaman sudah lulus. Masuk pemilik dan uji kirim/terima
email domain tetap memerlukan penerimaan pemilik.

## Alur yang tersedia

1. Buka `/pembayaran/`, pilih kota dan paket. Katalog saat disiapkan berisi
   49 kota dan 16 kelompok harga. Harga pada tampilan publik adalah salinan
   katalog; server D1 menjadi acuan penawaran saat checkout.
2. Pelanggan menerima penawaran dari server; pada `preview` pemilik harus
   masuk terlebih dahulu. Harga dasar, paket,
   fitur, dan pengaturan pembayaran disimpan pada penawaran. Paket berbayar
   mendapat kode 1–99 dan total harga dasar ditambah kode tersebut. Paket
   gratis tetap memiliki harga dasar, kode, dan total nol.
3. Isi nama/kontak, teks lowongan, caption, catatan, persetujuan, serta berkas
   yang sesuai. Paket berbayar memerlukan bukti transfer; pada pengujian
   terisolasi gunakan berkas contoh dan jangan melakukan transfer. Server
   memvalidasi isian, jenis/isi berkas, ukuran, dan sesi; nilai harga atau
   kode dari formulir tidak dipercaya.
4. Pengiriman menyimpan pesanan, referensi berkas, dan kejadian pembuatan.
   Idempotency key serta klaim pengiriman mencegah percobaan yang sama
   membuat pesanan ganda. Ulangi data yang sama bila hasil belum pasti;
   jangan membuat pesanan pengganti untuk melewati penguncian.
5. Ringkasan menampilkan nomor, kota, paket, nominal, dan status. Pesanan baru
   memberikan tautan pribadi dengan kunci pada fragment `#key=...`, sehingga
   dapat dibuka kembali setelah sesi checkout berakhir. Nomor/ID saja tidak
   memberikan akses. Ringkasan simulasi selalu memerlukan pemilik, termasuk
   setelah mode layanan berubah menjadi live.
6. Tombol WhatsApp membuka pesan siap isi. Pengguna sendiri memilih untuk
   membuka dan mengirimnya. Aplikasi maupun agen tidak otomatis mengirim
   pesan, email, notifikasi, atau memublikasikan lowongan.

Sesi checkout berlaku paling lama satu jam. Penawaran berakhir paling lambat
bersamaan dengan sesi. Total berbayar direservasi dalam mode yang sama;
reservasi pesanan yang tersimpan diperpanjang sampai 24 jam setelah
penyimpanan. Reservasi preview dan live dipisahkan. Ini bukan verifikasi
bank otomatis: status pembayaran tetap diperiksa oleh pemilik.

Kunci ringkasan diturunkan dari rahasia sesi asal dan ID pesanan; database
menyimpan hanya hash kunci. Pengiriman ulang idempoten menghasilkan kunci
yang sama. Browser mengirim kunci melalui body JSON ke
`POST /api/checkout/receipt`, tanpa menaruhnya di query, WhatsApp, atau
penyimpanan browser. Respons hanya berisi ringkasan dan tombol WhatsApp;
kontak pelanggan, catatan, bukti, serta materi tetap tidak tersedia melalui
tautan ini. Simpan tautannya secara privat. Pesanan arsip menolak akses.
Pesanan uji lama dengan hash NULL tetap memakai jalur sesi asal selama sesi
itu berlaku. Tautan WordPress lama ditangani terpisah di
`/konfirmasi-pembayaran/` dengan validasi kapabilitas sumber dan DTO minimal.

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

Panel juga menyediakan arsip/pulihkan dengan alasan serta audit, dan
`/admin/business.html` untuk pengaturan harga, pembayaran, kontak, dan isi
dasar 51 halaman. Halaman publik dirender memakai konfigurasi D1 yang sama
dengan checkout; harga lama, penawaran lama, dan snapshot sumber tetap utuh.

## Konfigurasi privat

Terapkan seluruh migrasi berurutan sampai `0008_receipt_access.sql` setelah
snapshot, berkas, dan admin. `0005` membuat `commerce_settings` dengan mode
awal `preview`; `0006` menambahkan pengaturan/konten/audit, `0007` arsip
reversibel, dan `0008` hash kunci ringkasan.
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
mode database yang sudah terisi berubah. Gunakan mode D1 `preview` pada
lingkungan pengujian terisolasi. Produksi telah beralih ke `live` melalui
prosedur pengalihan yang disetujui, bukan dengan menjalankan ulang impor.
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

Ekspor final SQL/WXR setelah guard sumber aktif cocok dengan target:
16 pesanan, 15 profil kontak, 394 metadata, dan 32 referensi berkas. Seluruh
32 jalur sumber cocok SHA-256/ukuran dengan 27 objek historis; tidak ada
impor tambahan. Cloudflare menerima penulisan baru secara terpisah dari
snapshot dan simulasi lama. Tetap pertahankan guard, hosting/email lama,
dan backup. Setelah zona aktif, verifikasi checkout serta ringkasan pada
domain resmi; hasil Workers tidak menggantikan bukti domain/TLS tersebut.
