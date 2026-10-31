# Migrasi data pelanggan privat

Database tujuan proyek ini adalah D1 `new-posloker-customers`, binding
`CUSTOMER_DB`. Aset website tetap berada di `public/`; data pelanggan tidak
tersedia melalui API tanpa autentikasi. Panel `/admin/` menggunakan API
terlindungi untuk membaca salinan pesanan dan mencatat perubahan admin.
Akses administrasi database tetap mengikuti akun Cloudflare dan izin
binding Worker.

Berkas pesanan berada di bucket R2 privat `new-posloker-customer-files`,
binding `CUSTOMER_FILES`. Akses publik bucket dinonaktifkan; tidak ada
domain publik atau akses `r2.dev`. Endpoint unduhan admin memeriksa sesi
sebelum mengakses berkas; tidak ada tautan unduhan pelanggan tanpa autentikasi.
Snapshot berkas sudah diunduh kembali melalui akses terautentikasi dan
dibandingkan ukuran byte serta SHA-256-nya dengan manifest sumber.
Katalog D1 sudah dicocokkan seluruh kolom, checksum baris, dan relasinya
dengan pesanan serta snapshot.

## Cakupan snapshot

Sumber WordPress menyimpan pesanan sebagai post type `posloker_order` dan
postmeta, bukan tabel akun pelanggan tersendiri. Impor mempertahankan:

- ID dan nomor pesanan asli, status post termasuk trash, dan status pembayaran.
- Identitas pelanggan per pesanan, harga historis, tanggal, dan data materi.
- Semua metadata mentah beserta ID sumbernya, termasuk field berulang.
- Provenance snapshot dan checksum seluruh baris untuk rekonsiliasi.

Profil kontak diturunkan secara konservatif dari kombinasi nama, WhatsApp,
dan email. Jumlah profil kontak bukan klaim jumlah orang unik.

WordPress/PHP, sesi staf, PIN, dan kredensial sumber bukan implementasi
backend baru. Pesanan baru masih masuk ke hosting asal sampai proses
cutover terpisah selesai. Salinan ini bukan replikasi database langsung.

## Status kerja admin

Skema `0003_admin.sql` menambahkan autentikasi pemilik dan
`0004_order_admin.sql` menambahkan status kerja serta riwayat audit.
Perubahan panel disimpan pada `order_admin_state` dan `order_admin_events`;
tabel snapshot sumber tidak diubah. Status efektif memakai status kerja
jika ada, lalu status snapshot. Penyimpanan memakai pemeriksaan revisi
agar perubahan yang lebih baru tidak tertimpa.

Audit mencatat pelaku, waktu, alasan, serta status dan catatan sebelum/sesudah.
Pesanan berstatus trash tetap dapat ditinjau sebagai arsip dan tidak dapat
diubah dari panel. Perubahan ini hanya berlaku pada salinan Cloudflare,
tanpa penulisan balik ke WordPress. Rekonsiliasi delta berikutnya perlu
mempertimbangkan status kerja dan riwayat tersebut sebelum cutover.

Token aktivasi, kata sandi, hash kredensial, sesi, dan hasil pembacaan API
yang berisi pelanggan tetap privat. Panduan aktivasi ada di
[panduan admin](admin.md).

## Lokasi privat

Cadangan sumber dan artefak berisi pelanggan harus berada di direktori
kerja privat di luar checkout Git dan direktori `outputs`. Alat persiapan
menolak lokasi keluaran di repository maupun `outputs`.

Contoh perintah berikut hanya menyiapkan snapshot lokal; tidak mengunggah
data dan tidak mengubah hosting sumber:

```sh
node scripts/prepare-customer-migration.mjs --input ../private-posloker/source/posloker-mysql.sql --wxr ../private-posloker/source/orders-wxr.xml --out-dir ../private-posloker/prepared --prefix wpjj_
node scripts/customer-console-tools.mjs build --database ../private-posloker/prepared/customer-data.sqlite --out-dir ../private-posloker/prepared/console
```

Gunakan Node.js 24. SQL skema di `migrations/` tidak memuat data pelanggan.
SQL data, SQLite lokal, manifest rinci, dan hasil pembacaan remote tetap
privat. Cadangan `wp-config.php` tidak boleh disalin ke Worker atau Git.

## Pemeriksaan

Konversi membaca literal SQL tanpa mengeksekusi dump MySQL. Nilai integer,
teks Unicode, string PHP serialized, baris baru, dan duplikat metadata
dipertahankan. Batch konsol memakai literal hex agar input satu baris tidak
mengubah isi teks. Setiap batch dibatasi di bawah 70 KB.

Impor dilakukan ke database baru. Setelahnya, baca kembali seluruh kolom
empat tabel inti dan simpan JSON-nya secara privat, lalu jalankan:

```sh
node scripts/customer-console-tools.mjs verify --database ../private-posloker/prepared/customer-data.sqlite --remote ../private-posloker/prepared/remote.json
```

Bandingkan semua nilai baris, jumlah record, status, nominal, ID sumber,
integritas SQLite, dan hubungan foreign key. Metadata sumber sementara
`_edit_lock` tetap disimpan walaupun tidak disertakan ekspor WXR.

Jangan menjalankan ulang INSERT snapshot ke database yang sudah terisi.
Skema ini untuk impor awal; sinkronisasi berikutnya memerlukan proses delta
yang memeriksa perubahan dan konflik berdasarkan ID sumber.

## Berkas pesanan

Alat `prepare-order-files.mjs` menginventarisasi bukti dan materi hanya yang
dirujuk pesanan, mempertahankan urutan, nama/MIME asli, ukuran, dan SHA-256.
Duplikasi field legacy tidak membuat referensi materi ganda. Berkas orphan
dipertahankan pada backup dan tidak otomatis diunggah atau dihapus.

```sh
node scripts/prepare-order-files.mjs --database ../private-posloker/prepared/customer-data.sqlite --source-root ../private-posloker/source/order-files --out-dir ../private-posloker/prepared
```

Staging R2 dan manifest berkas tetap privat. R2 sudah aktif untuk proyek
ini, dan bucket harus tetap privat, tanpa domain publik atau `r2.dev`.
Skema `0002_order_files.sql` menyimpan katalog berkas yang sudah diimpor
serta diperiksa pada database tujuan.

Setelah katalog diimpor, baca kembali seluruh kolom `order_files` dan periksa
hubungannya dengan pesanan dan snapshot. Siapkan kueri Console satu baris,
simpan sel JSON `order_files_snapshot` secara privat, lalu bandingkan:

```sh
node scripts/order-files-console-tools.mjs build --manifest ../private-posloker/prepared/order-files-manifest.private.json --out-dir ../private-posloker/prepared
node scripts/order-files-console-tools.mjs verify --manifest ../private-posloker/prepared/order-files-manifest.private.json --remote ../private-posloker/prepared/order-files-remote.json
```

Pemeriksaan katalog membandingkan semua nilai dan checksum baris. Isi objek
R2 diverifikasi terpisah dengan mengunduh ulang melalui akses privat lalu
mencocokkan setiap kunci objek, ukuran byte, dan SHA-256 dengan staging.
Pemeriksaan snapshot saat ini sudah lulus untuk katalog dan isi objek.

Untuk sinkronisasi berikutnya, ambil snapshot/delta sumber yang baru dan
ulang kedua pemeriksaan tersebut. Jangan menganggap penambahan binding
sebagai pemindahan handler PHP atau replikasi pesanan baru: checkout,
unggahan baru, dan administrasi WordPress tetap menggunakan hosting asal
sampai adaptasi backend dan cutover terpisah selesai.
