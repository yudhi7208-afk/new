# Panel admin PosLoker di Cloudflare

Alamat panel adalah `/admin/` pada Worker proyek `new`. Panel mengelola
salinan pesanan di D1 dan berkas privat R2. Halaman masuk dapat dibuka tanpa
sesi; daftar pelanggan, pesanan, dan unduhan memerlukan sesi admin valid.

**Pesanan dan pembayaran baru masih diproses WordPress asal.** Pesanan baru
tersebut belum otomatis masuk ke salinan Cloudflare. Perubahan status atau
catatan pada panel Cloudflare juga tidak dikirim kembali ke WordPress.
Domain dan alur checkout belum dialihkan.

Dokumen ini menjelaskan implementasi dan pengoperasian panel. Status
penerapan skema, aktivasi pemilik, dan deploy harus diperiksa oleh operator
pada lingkungan tujuan sebelum panel dipakai.

## Aktivasi pemilik pertama

Panel mendukung satu pemilik. Tidak ada pendaftaran publik dan PIN atau
kata sandi WordPress tidak disalin sebagai kredensial baru.

1. Operator menerapkan skema `0003_admin.sql` dan `0004_order_admin.sql`
   pada D1 tujuan, setelah skema snapshot dan katalog berkas tersedia.
2. Operator membuat token acak 32 byte (64 karakter hex), lalu menyimpan
   SHA-256 token pada satu record `admin_setup` dengan `id=1`, `expires_at` maksimal 24 jam
   setelah pembuatan, dan `consumed_at=NULL`. Nilai waktu memakai detik Unix.
3. Operator menyerahkan tautan aktivasi privat kepada pemilik. Token berada
   pada fragment URL, bukan query string; jangan menaruh token di Git,
   halaman publik, log, tangkapan layar, atau dokumentasi.
4. Pemilik membuka tautan HTTPS, mengisi email dan kata sandi 15–128 karakter,
   mengulangi kata sandi, lalu mengirim formulir sendiri.
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
  halaman berikutnya untuk menemukan pesanan.
- Pilih pesanan untuk melihat kontak, paket, nominal historis, kode unik,
  materi teks, caption, catatan asal, bukti, dan berkas materi yang tersedia.
- Unduh bukti atau materi melalui tombol berkas pada panel. Bucket R2
  tetap privat; tautan API tersebut memerlukan sesi admin aktif.
- Pilih status **Menunggu Verifikasi**, **Lunas**, atau **Ditolak**, isi
  catatan admin dan alasan perubahan, lalu simpan setelah pemeriksaan.
- Tinjau riwayat perubahan pada detail pesanan. Pesanan arsip/trash dapat
  ditinjau, tetapi tidak dapat diedit.

Perubahan status dan catatan tersimpan pada tabel kerja terpisah. Snapshot
WordPress beserta checksum dan metadata aslinya dipertahankan. Setiap
perubahan mencatat pelaku, waktu, alasan, nilai sebelum/sesudah, dan revisi.
Jika pesanan sudah diubah melalui tab lain, penyimpanan ditolak; muat ulang
detail sebelum mencoba kembali agar perubahan terbaru tidak tertimpa.

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

Menjelang cutover, rekonsiliasi perubahan WordPress dan status kerja
Cloudflare berdasarkan ID sumber. Uji penerimaan pesanan, pembayaran,
unggahan baru, notifikasi, dan akses admin sebelum mengalihkan domain.
