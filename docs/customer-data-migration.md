# Migrasi data pelanggan privat

Database tujuan proyek ini adalah D1 `new-posloker-customers`, binding
`CUSTOMER_DB`. Aset website tetap berada di `public/`; tidak ada endpoint
publik yang membaca tabel pelanggan. Akses administrasi database mengikuti
akun Cloudflare dan izin binding Worker.

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

Staging R2 dan manifest berkas tetap privat. Aktivasi R2 dan persetujuan
ketentuan langganannya diperlukan sebelum transfer berkas; bucket harus
tetap private, tanpa domain publik atau `r2.dev`. Skema `0002_order_files.sql`
disiapkan untuk katalog berkas setelah penyimpanan tersebut siap.
