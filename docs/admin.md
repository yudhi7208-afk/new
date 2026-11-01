# Panel admin PosLoker di Cloudflare

Alamat panel adalah `/admin/` pada Worker proyek `new`. Panel menggabungkan
snapshot pesanan WordPress dan pesanan native Cloudflare, beserta berkas
privat R2. Halaman masuk dapat dibuka tanpa sesi; daftar pelanggan, pesanan,
dan unduhan memerlukan sesi admin valid.

**WordPress asal tetap melayani transaksi pelanggan.** Checkout
`/pembayaran/` di Cloudflare masih mode `preview`: pengunjung dapat melihat
katalog, tetapi hanya pemilik yang masuk dapat membuat penawaran, mengirim
pesanan simulasi, dan membaca ringkasan pada sesi browser checkout yang sama.
Semua pesanan baru pratinjau ditandai `is_test=1` dan **SIMULASI**;
**jangan melakukan transfer**.

Pesanan WordPress baru belum otomatis masuk ke Cloudflare. Perubahan status
atau catatan pada panel Cloudflare juga tidak dikirim kembali ke WordPress.
Domain, DNS, dan hosting lama belum dialihkan atau dihentikan.

Dokumen ini menjelaskan implementasi dan pengoperasian panel. Status
penerapan skema, aktivasi pemilik, dan deploy harus diperiksa oleh operator
pada lingkungan tujuan sebelum panel dipakai.

## Aktivasi pemilik pertama

Panel mendukung satu pemilik. Tidak ada pendaftaran publik dan PIN atau
kata sandi WordPress tidak disalin sebagai kredensial baru.

1. Operator menerapkan skema `0003_admin.sql`, `0004_order_admin.sql`, dan
   `0005_checkout.sql` pada D1 tujuan, setelah skema snapshot dan katalog
   berkas tersedia. Daftar gabungan memerlukan tabel checkout meskipun belum
   ada pesanan Cloudflare.
2. Operator membuat token acak 32 byte (64 karakter hex), lalu menyimpan
   SHA-256 token pada satu record `admin_setup` dengan `id=1`, `expires_at` maksimal 24 jam
   setelah pembuatan, dan `consumed_at=NULL`. Nilai waktu memakai detik Unix.
3. Operator menyerahkan tautan aktivasi privat kepada pemilik. Token berada
   pada fragment URL, bukan query string; jangan menaruh token di Git,
   halaman publik, log, tangkapan layar, atau dokumentasi.
4. Pemilik membuka tautan HTTPS, mengisi email dan kata sandi 15–128 karakter,
   mengulangi kata sandi, lalu mengirim formulir sendiri.
   Jika membuka alamat panel biasa tanpa token di fragment, halaman tetap
   menampilkan aktivasi selama pemilik belum terbentuk. Masukkan kode aktivasi
   privat pada kolom yang tersedia; email dan kata sandi baru dipilih pemilik.
5. Aktivasi yang berhasil membuat pemilik dan mengonsumsi token secara
   atomik. Tautan yang sama tidak dapat membuat akun kedua.

Jangan membagikan tautan aktivasi kepada pelanggan. Token hanya memberikan
akses aktivasi sebelum pemilik terbentuk dan sebelum masa berlakunya habis.
Setelah aktif, gunakan halaman masuk biasa `/admin/` dengan email dan kata
sandi yang dibuat pemilik.

## Masuk dan keluar

Kata sandi disimpan sebagai hasil PBKDF2-SHA-256 dengan salt acak, bukan
teks asli. Token sesi acak juga hanya disimpan sebagai hash pada D1.
Cookie sesi memakai `Secure`, `HttpOnly`, dan `SameSite=Strict`; sesi
kedaluwarsa setelah delapan jam. Tombol **Keluar** mencabut sesi browser itu.

Percobaan autentikasi dibatasi secara persisten: hingga lima percobaan per
alamat dalam jendela 15 menit, dengan batas gabungan 50 percobaan. Alamat
yang sudah dibatasi tidak menghabiskan kuota masuk gabungan. Setelah
mencapai batas, tunggu hingga jendelanya berakhir. Counter memakai hash
alamat, bukan alamat IP mentah.

## Mengelola pesanan

- Gunakan daftar terbaru, pencarian nomor/nama/kota, filter status, dan
  halaman berikutnya untuk menemukan pesanan. Filter sumber memisahkan
  **WordPress** dan **Cloudflare**; keduanya juga memiliki badge sumber.
- Pesanan percobaan Cloudflare memiliki badge **SIMULASI** pada daftar dan
  detail. Status simulasi bukan bukti pembayaran atau transaksi pelanggan nyata.
- Pilih pesanan untuk melihat kontak, paket, nominal historis, kode unik,
  materi teks, caption, catatan asal, bukti, dan berkas materi yang tersedia.
- Unduh bukti atau materi melalui tombol berkas pada panel. Bucket R2
  tetap privat; tautan API tersebut memerlukan sesi admin aktif.
- Pilih status **Menunggu Verifikasi**, **Lunas**, atau **Ditolak**, isi
  catatan admin dan alasan perubahan, lalu simpan setelah pemeriksaan.
- Tinjau riwayat perubahan pada detail pesanan. Pesanan arsip/trash dapat
  ditinjau, tetapi tidak dapat diedit.

Perubahan status/catatan pesanan WordPress tersimpan pada tabel kerja
terpisah. Snapshot beserta checksum dan metadata aslinya dipertahankan.
Pesanan Cloudflare menggunakan `commerce_orders`, berkas pada
`commerce_files`, dan riwayat pada `commerce_events`. Setiap perubahan
mencatat pelaku, waktu, alasan, nilai sebelum/sesudah, dan revisi.
Jika pesanan sudah diubah melalui tab lain, penyimpanan ditolak; muat ulang
detail sebelum mencoba kembali agar perubahan terbaru tidak tertimpa.

## Mencoba checkout

Masuk sebagai pemilik, lalu buka `/pembayaran/` pada browser dan origin yang
sama. Gunakan data serta berkas contoh. Server memeriksa harga dan kode unik;
setelah pengiriman berhasil, periksa ringkasan, badge **SIMULASI**, detail,
unduhan privat, serta riwayat pada panel.

Ringkasan checkout terikat sesi browser pembuatnya dan memerlukan sesi
pemilik selama preview. Nomor/URL pesanan saja tidak memberikan akses.
Tombol WhatsApp membuka pesan yang sudah disiapkan; pemilik memilih sendiri
apakah mengirimnya. Simulasi tidak mengirim pesan, notifikasi, atau publikasi
otomatis. Rincian batas berkas dan alur ada di [panduan checkout](checkout.md).

## Catatan operator dan pemulihan

API `/api/admin/` memeriksa autentikasi sebelum membaca data pesanan atau
R2. Perubahan data memerlukan asal permintaan yang sama, JSON, dan token
CSRF dari sesi. Respons admin memakai kebijakan tanpa cache dan tidak
boleh disimpan dalam aset publik atau artefak keluaran yang dapat dibagikan.

Jika tautan aktivasi kedaluwarsa **dan pemilik belum terbentuk**, operator
dapat mengganti record bootstrap dengan token acak baru dan masa berlaku
baru melalui akses D1 yang sah. Periksa bahwa `admin_users` masih kosong
sebelum membuat token pengganti. Jangan menerbitkan token yang masih aktif
berulang kali untuk menangani kesalahan kata sandi biasa.

Jika pemilik sudah terbentuk, tautan bootstrap tidak dapat mendaftarkan
pemilik pengganti. Jangan menghapus pengguna, sesi, snapshot, atau audit
untuk membuka pendaftaran kembali. Belum ada reset kata sandi mandiri;
pemulihan akses memerlukan prosedur operator yang terkontrol dan teruji.

Jika pengiriman checkout belum dapat dipastikan atau record
`checkout_submissions` tertahan pada `processing`, jangan membuka kunci,
menghapus klaim/objek, atau mereset nonce secara otomatis. Periksa hasil
commit D1 dan manifest objek privat R2 sebelum tindakan pemulihan. Ikuti
[rekonsiliasi checkout](checkout.md#rekonsiliasi-pengiriman-yang-belum-pasti);
jangan membuat pesanan baru untuk melewati penguncian.

Menjelang cutover, rekonsiliasi perubahan WordPress dan status kerja
Cloudflare berdasarkan ID sumber serta perbarui backup sumber terakhir.
Uji penerimaan pesanan, nominal/kode unik, unggahan, ringkasan, WhatsApp
manual, dan akses admin. Mode layanan nyata, domain/DNS, serta perubahan
SEO/`noindex` baru dilakukan setelah pengujian dan permintaan pengalihan
eksplisit pengguna; sampai itu WordPress tetap berjalan.
