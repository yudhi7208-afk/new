# Pemulihan akses pemilik melalui operator

Jalur ini untuk pemilik yang sudah terbentuk dan kehilangan kata sandi.
Tidak ada endpoint reset publik, pendaftaran ulang, email otomatis, atau
perubahan akun saat helper dijalankan. Email, ID pemilik, tanggal pembuatan,
pesanan, berkas, pengaturan, bootstrap dan seluruh riwayat dipertahankan.
Operator tetap memerlukan akses Cloudflare/D1 yang sah; artefak ini bukan
pengganti otorisasi operator dan tidak dapat dipakai oleh pelanggan.

## Persiapan privat

1. Pastikan permintaan datang dari pemilik yang berhak. Catat identitas
   operator dan alasan pemulihan. Siapkan cadangan D1/R2 terkini serta
   jalur masuk Cloudflare operator yang masih bekerja.
2. Ambil snapshot D1 terbaru ke SQLite privat di luar Git dan `outputs`.
   Gunakan hasil backup yang sudah diperiksa. Helper membuka SQLite hanya
   baca dan memilih enam kolom identitas/autentikasi `admin_users`, tanpa
   membaca data pelanggan atau pesanan. Snapshot harus memiliki tepat satu
   pemilik aktif (`id=1`) dan format autentikasi saat ini.
3. Buka terminal privat pada komputer pemilik. Pemilik sendiri mengetik
   kata sandi baru 15–128 karakter dua kali melalui prompt tersamar.
   Jangan mengirim kata sandi melalui chat, argumen shell, variabel
   lingkungan, pipe, rekaman terminal, atau tangkapan layar. Tutup perekam
   layar/terminal sebelum mulai. Jangan mengirim kredensial kepada operator.

Contoh berikut hanya berisi path privat dan label operator, tanpa kata sandi:

```powershell
node scripts/owner-recovery.mjs --database "C:\Privat\PosLoker\backup-terbaru.sqlite" --out-dir "C:\Privat\PosLoker\pemulihan" --operator "Operator PosLoker" --reason "Pemilik kehilangan kata sandi"
```

Helper menolak input non-TTY, argumen kata sandi, lokasi di repository atau
`outputs`, snapshot tanpa pemilik, dan versi hash yang tidak didukung.
Satu direktori operasi baru dibuat dengan izin 0700; SQL/manifest baru
memakai 0600. Pada Windows, ACL direktori menghapus izin warisan dan hanya
memberi akses kepada pengguna Windows yang menjalankan helper sebelum
hash kredensial ditulis. Berkas mewarisi ACL privat tersebut. Jangan
memindahkannya ke folder bersama, unggahan publik, atau repository.

## Tinjau dan terapkan satu batch

Artefak berlaku 15 menit. Sebelum penerapan, operator meninjau manifest
privat dan mencocokkan `sqlSha256` terhadap berkas
`owner-recovery.private.sql`. Manifest hanya memuat fingerprint kredensial,
ID operasi, operator, alasan, dan waktu; tidak memuat kata sandi.
SQL tetap sensitif karena memuat salt/hash kredensial lama dan pengganti.
Jangan menyalin SQL atau hasil backup ke chat/log yang dibagikan.

Terapkan **seluruh isi `owner-recovery.private.sql` sebagai satu batch
atomik** pada D1 `new-posloker-customers`. Gunakan satu permintaan query D1
dengan seluruh SQL, atau satu pemanggilan `D1Database.batch()` oleh operator
yang sudah berotorisasi. Jangan menjalankan pernyataan satu per satu,
memecah file menjadi permintaan berbeda, atau menambah `BEGIN/COMMIT` ke D1.
API D1 menerima pernyataan dipisahkan titik koma sebagai satu batch;
kegagalan dalam batch membatalkan seluruh urutannya.
Lihat [API query D1](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
dan [transaksi batch D1](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

Lima pernyataan SQL tersebut:

1. Membuat audit pemulihan hanya jika ID/email/salt/hash/iterasi/tanggal
   pembuatan masih tepat sama dengan snapshot dan belum kedaluwarsa.
2. Mengganti salt/hash pemilik yang sama, hanya untuk klaim audit tadi.
3. Menggagalkan seluruh batch bila perbandingan gagal, artefak dipakai ulang,
   atau snapshot sudah berubah. Pesan `malformed JSON` pada guard adalah
   penolakan yang disengaja; jangan melewati guard tersebut.
4. Mencabut seluruh sesi admin milik pemilik pada semua hostname/browser.
5. Memastikan identitas/kredensial pengganti sesuai dan tidak ada sesi lama.
   Jika verifikasi gagal, seluruh perubahan ikut dibatalkan.

Audit tersimpan pada `business_admin_events`, scope `business`, path
`/operator/owner-recovery`, dengan alasan pemulihan yang jelas dan
fingerprint sebelum/sesudah. Revisi jalur audit ini berdiri sendiri;
revisi maupun isi pengaturan bisnis tidak berubah. Log pengaturan saat ini
memakai label jenis bisnis yang umum; baca alasan audit untuk membedakan
pemulihan akses. ID pelaku tetap pemilik `1` dan identitas operator juga
tercatat pada alasan/JSON; tidak ada pengguna baru atau penghapusan audit.

## Periksa hasil dan akhiri

Sebelum pemilik masuk kembali, jalankan isi
`verify-owner-recovery.private.sql` sebagai query baca privat. Hasil yang
diharapkan: `audit_recorded=1`, `credential_matches=1`, dan
`active_owner_sessions=0`. Query ini tidak mengembalikan hash atau token.
Jika respons penerapan hilang atau belum pasti, lakukan verifikasi terlebih
dahulu; jangan menghapus audit, mereset bootstrap, atau mengulang pemulihan
secara buta. Artefak lama sengaja ditolak bila dipakai ulang dan tidak
mencabut sesi yang dibuat sesudah pemulihan sebelumnya.

Pemilik kemudian membuka `/admin/` pada domain resmi dan mengetik email
akun yang sama serta kata sandi baru sendiri. Pastikan daftar pesanan,
berkas dan pengaturan dapat dibuka. Cookie lama tidak berlaku. Kegagalan
login tetap mengikuti pembatasan autentikasi biasa; helper tidak menghapus
counter atau menonaktifkan pembatasan.

Catat hasil dan waktu pada jurnal privat, simpan manifest/audit sesuai
kebijakan cadangan privat, lalu amankan atau musnahkan SQL sensitif sesuai
kebijakan penyimpanan lokal. Jangan menghapus pemilik/sesi/data untuk
membuka aktivasi baru. Jika snapshot berubah atau artefak habis masa
berlaku, ambil snapshot baru dan ulangi persiapan dengan persetujuan pemilik.

## Bukti latihan

```powershell
node scripts/test-owner-recovery.mjs
```

Pengujian hanya memakai identitas/kata sandi sintetis, SQLite baru, direktori
sementara privat, dan D1 lokal Miniflare baru. Pengujian mencakup kecocokan
hash terhadap login aplikasi, pencabutan semua sesi, pemeliharaan identitas
dan riwayat/data lain, input TTY tersamar, penolakan pipe, izin keluaran,
konflik snapshot, expiry/replay, kegagalan update/revoke, serta rollback
batch D1 lokal. Pengujian tidak mengganti kata sandi pemilik produksi.
