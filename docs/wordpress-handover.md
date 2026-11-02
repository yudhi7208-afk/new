# Pengalihan penerimaan pesanan WordPress

Kode pada `migration/wordpress-handover.php` adalah artefak persiapan, bukan
bagian Worker atau aset publik. Kode ini **belum dipasang atau diaktifkan di
hosting lama**. Website lama tetap menerima pesanan selama persiapan.
Nameserver, DNS, database sumber, dan berkas sumber tidak diubah oleh
persiapan ini. Pengguna tetap menentukan kapan pengalihan dijalankan.

## Tujuan dan batas

Setelah diaktifkan, halaman biasa WordPress tetap dapat dilayani. Checkout
lama menuju `https://new.yudhi7208.workers.dev/pembayaran/`; penerimaan
pesanan dan pengelolaannya hanya berlangsung di Cloudflare. Tujuan ini tetap
agar klien yang masih memakai DNS lama tidak kembali ke hosting sumber.
Jangan mengarahkan hostname Workers itu kembali ke domain utama selama
propagasi, karena bisa menghasilkan putaran redirect.

Guard disiapkan berdasarkan PosLoker Pembayaran sumber versi 1.2.19:

- Pengiriman `admin_post_posloker_submit_payment` dan versi `nopriv` dicegat
  sebelum handler menyimpan bukti/materi.
- Perubahan status melalui `admin_post_posloker_payment_status`, portal PIN,
  penulisan post/meta, arsip/pulihkan, dan penghapusan post pesanan ditolak
  setelah pengalihan. Post dan meta milik jenis konten lain tetap mengikuti
  perilaku WordPress sebelumnya.
- GET/HEAD checkout meneruskan hanya kota dan ID paket yang lolos validasi.
  Body POST, unggahan, nonce, kontak pelanggan, dan parameter tambahan tidak
  diteruskan. Formulir lama mendapat respons 409 tanpa cache dan petunjuk
  pemeriksaan pesanan; pelanggan yang sudah transfer tidak diminta membayar
  lagi.
- Tautan konfirmasi lama meneruskan ID pesanan dan kapabilitas asli pada
  fragment `#key=...`. Tautan portal/bukti/materi/caption hanya menuju admin
  Cloudflare dengan ID pesanan; token lama tidak menjadi akses berkas publik.
- Plugin tidak menghapus pesanan, mengubah metadata historis, memindahkan
  berkas, melakukan sinkronisasi, mengganti nama domain, atau mengubah DNS.

Flag dibaca langsung dari database, melewati cache opsi WordPress. Setiap
permintaan yang akan menulis pesanan mengambil advisory lock per situs dan
menahannya sampai PHP selesai. Perintah aktivasi memakai lock yang sama:
permintaan yang sudah memegang lock menyelesaikan penulisannya terlebih
dahulu; permintaan berikutnya membaca flag yang baru dan ditolak. Lock
MySQL terikat koneksi, bukan commit transaksi; guard memeriksa kepemilikannya
lagi jika koneksi hilang. Lihat [dokumentasi locking functions MySQL](https://dev.mysql.com/doc/refman/8.4/en/locking-functions.html).

Ini berlaku untuk penulisan melalui jalur WordPress yang sudah memasang
guard. SQL langsung, perubahan oleh operator database, atau kode lain yang
melewati hook tidak ikut dilindungi. Hentikan pekerjaan semacam itu pada
waktu pengalihan dan tetap lakukan pencocokan terakhir. Database harus
menyediakan `GET_LOCK`, `IS_USED_LOCK`, `CONNECTION_ID`, dan `RELEASE_LOCK`;
kegagalan memperoleh lock menolak operasi dengan 503, tidak membuka jalur
penulisan tanpa perlindungan.

## Persiapan sebelum waktu pengalihan

1. Tuntaskan penerimaan Cloudflare, termasuk pembayaran manual, harga,
   unggahan, ringkasan, admin, akses pemilik, dan cadangan/pemulihan. Simpan
   backup sumber dan tujuan secara privat. Inventaris DNS/email diselesaikan
   secara terpisah sesuai [daftar kesiapan](cutover-readiness.md).
2. Pada waktu persiapan yang disetujui operator, salin artefak ke satu file
   top-level `wp-content/mu-plugins/posloker-cloudflare-handover.php` pada
   instalasi PosLoker yang benar. Bandingkan checksum file terpasang dengan
   commit yang ditinjau. Jangan pasang pada proyek/instalasi lain atau
   meninggalkan dua versi MU-plugin sekaligus.
3. Opsi `posloker_cloudflare_handover` yang belum ada berarti **disabled**.
   Pemasangan tidak menjalankan perintah aktivasi. Periksa bahwa tidak ada
   opsi enabled dari percobaan sebelumnya sebelum pemasangan.
4. Jalankan WP-CLI pada direktori WordPress yang benar:

   ```sh
   wp posloker handover status --verify-lock
   ```

   Hasil yang diharapkan sebelum pengalihan adalah
   `disabled; write-lock verified`. Perintah ini memeriksa kemampuan lock
   lalu melepasnya, tanpa mengubah flag. Bila command, lock, PHP, atau
   database gagal, berhenti dan perbaiki sebelum pengalihan. Penggunaan
   WP-CLI mengikuti [dokumentasi resminya](https://developer.wordpress.org/cli/commands/).
5. Pastikan guard sudah dimuat oleh permintaan sumber sebelum aktivasi.
   PHP yang sudah berjalan **sebelum file dipasang** tidak mempunyai hook
   baru dan tidak otomatis ikut menunggu lock. Tinjau proses/log hosting,
   permintaan yang sedang berjalan, serta checkpoint sumber. Lamanya tidur
   atau dua angka hitungan yang kebetulan sama bukan bukti tunggal bahwa
   tidak ada commit tertunda.
6. Periksa pengiriman lama dan pembayaran yang belum dikonfirmasi. Pelanggan
   tidak boleh diminta melakukan transfer kedua. Catat kasus yang memerlukan
   pencocokan manual oleh pemilik sebelum menghasilkan pesanan pengganti.

Guard disabled menambahkan koordinasi lock pada permintaan penulisan
pesanan, tetapi tidak menolak penulisan normal. Periksa latensi dan satu
alur sumber setelah pemasangan; jangan menganggap uji PHP lokal sebagai
pengganti preflight pada server MySQL/WordPress hosting yang sebenarnya.

## Alternatif kontrol pemilik jika WP-CLI tidak tersedia

Wrapper pada `migration/wordpress-handover-admin/posloker-cloudflare-handover.php`
dapat dikemas sebagai plugin WordPress biasa bersama inti yang identik di
`includes/wordpress-handover.php`. Paket tidak menyertakan kredensial, akses
publik, atau aktivasi flag otomatis. MU-plugin dan WP-CLI tetap menjadi jalur
utama bila tersedia; jangan memasang salinan inti lama dan baru bersamaan.

Setelah plugin biasa dipasang dan diaktifkan, buka **Tools → PosLoker Handover**
dengan akun yang mempunyai `manage_options`. Halaman membaca status terbaru
tanpa mengubah flag. Jalankan **Verifikasi lock**; hasil disimpan khusus
pengguna tersebut selama sepuluh menit. Setelah checkout nyata Cloudflare
siap, centang konfirmasi lalu **Aktifkan handover**. Perubahan memakai metode
inti yang sama dengan CLI: lock, baca flag langsung, simpan, verifikasi,
lepas lock. Preflight dikonsumsi oleh percobaan perubahan dan harus diulang
setelah kegagalan. Kontrol memerlukan POST asal yang sama, nonce per operasi,
dan hak administrator; tidak ada handler `nopriv`.

Jangan menonaktifkan atau menghapus plugin biasa selama handover enabled:
WordPress memerlukan guard tersebut pada setiap permintaan. Batas permintaan
PHP sebelum pemasangan dan SQL langsung tetap sama. Rollback hanya boleh
melalui tombol konfirmasi setelah Cloudflare berhenti menulis dan data
balik selesai dicocokkan. Uji PHP nyata lokal mencakup 120 pemeriksaan inti
dan 71 pemeriksaan tambahan kontrol pemilik; ini belum membuktikan preflight
hosting atau mengaktifkan apa pun.

## Eksekusi hanya pada waktu pengalihan yang disetujui

1. Pastikan endpoint checkout Workers sudah siap untuk pelanggan dan bisa
   dijangkau langsung tanpa domain yang masih memakai DNS lama. Aktifkan
   mode penerimaan nyata Cloudflare hanya pada tahap pengalihan yang
   disetujui, setelah pengujian pada lingkungan terisolasi lulus.
2. Hentikan perubahan source oleh operator, pekerjaan impor, dan penulisan
   langsung. Jalankan command berikut di WordPress:

   ```sh
   wp posloker handover enable --yes
   wp posloker handover status --verify-lock
   ```

   `--yes` adalah konfirmasi operator bahwa target Cloudflare sudah siap.
   Tanpa flag itu, WP-CLI meminta konfirmasi interaktif. Perintah enable
   menunggu lock maksimal 10 detik, menyimpan flag di bawah lock, membaca
   ulang hasilnya dari database, kemudian melepas lock. Bila timeout atau
   hasil command belum pasti, periksa status dahulu; jangan membuka sumber
   atau mengulang perubahan secara buta.
3. Buktikan GET checkout menuju target yang benar, POST lama ditolak sebelum
   pemrosesan, sumber lain tetap dapat dibaca, dan pesanan baru hanya masuk
   ke D1. Uji dengan data contoh dan jangan melakukan transfer untuk tes.
   Pertahankan hostname Workers dapat dijangkau selama propagasi. Cookie
   sesi tidak dipindahkan antar-host; jangan melakukan redirect global atas
   tautan ringkasan Workers yang sudah diberikan kepada pelanggan.
4. Ambil backup sumber terakhir setelah penulisan guard berhenti. Rekonsiliasi
   ID sumber, post/status, semua metadata, nominal, dan berkas; pertahankan
   audit serta status kerja Cloudflare. Periksa kembali sumber untuk commit
   tertunda atau penulisan yang melewati guard. Tinjau konflik dan pesanan
   parsial, bukan hanya jumlah record.
5. Setelah hasil cocok dan pencatatan satu sumber penulisan terbukti, jalankan
   pergantian nameserver/rute/TLS yang disetujui. Pertahankan email dan
   record DNS lain sesuai inventaris. Lanjutkan uji domain, sumber yang
   masih terkena cache DNS, dan pengamatan transaksi.

Jangan mengaktifkan opsi lewat SQL atau `wp option update` biasa: cara itu
tidak memperoleh lock penguras permintaan dan dapat melewati jaminan
koordinasi command. Plugin sendiri tidak melakukan perubahan apa pun pada
Cloudflare; perubahan mode, rekonsiliasi data, domain, dan DNS adalah langkah
operator terpisah yang harus dibuktikan hasilnya.

## Jika perlu membatalkan pengalihan

Perintah berikut **membuka penulisan WordPress lagi** dan tidak memindahkan
pesanan dari D1 ke sumber:

```sh
wp posloker handover disable --yes
```

Jangan menjalankannya selagi Cloudflare masih menerima pesanan. Tahan
penulisan target, simpan backup terbaru, selesaikan rekonsiliasi balik,
pastikan hanya WordPress yang akan menerima transaksi, lalu konfirmasi
disable. Mengembalikan nameserver saja tidak cukup. Flag dan data sumber
tidak otomatis dihapus pada saat disable; command membaca ulang hasilnya
untuk memastikan perubahan benar-benar tersimpan.

## Bukti pengujian artefak

Pengujian 2 November 2026 memakai PHP CLI 8.2.12 yang sudah tersedia secara
lokal, tanpa memulai layanan XAMPP atau mengunduh/memasang PHP baru:

```powershell
& 'C:\xampp\php\php.exe' -l migration/wordpress-handover.php
& 'C:\xampp\php\php.exe' scripts/test-wordpress-handover.php
```

Lint dan harness PHP lulus. Harness menjalankan kode plugin pada proses PHP
nyata dengan WordPress/wpdb sintetis: default disabled, urutan hook sebelum
upload, rute dan parameter, token pada fragment, isolasi jenis konten,
post/meta/trash/delete, flag uncached, kegagalan lock/koneksi/commit, dan
command berkonfirmasi. Harness tidak memakai kredensial, pelanggan, MySQL
hosting, WordPress aktif, atau Cloudflare. Preflight dan pengamatan sumber
sebenarnya tetap menjadi syarat sebelum aktivasi.
