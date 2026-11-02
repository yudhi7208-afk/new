# Kesiapan pengalihan PosLoker

Keputusan pengguna: **sistem, database, berkas, dan pengelolaan Cloudflare
harus siap dipakai sebelum nameserver dipindahkan**. Website WordPress lama
tetap beroperasi selama persiapan. Proyek `new` hanya untuk PosLoker.

Pengalihan yang diminta pengguna sedang dijalankan pada 2 November 2026.
Cloudflare sudah `live`, guard penulisan WordPress aktif, dan nameserver
registrar telah disimpan sekitar 07.24–07.25 WIB. Delegasi induk dan zona
Cloudflare sudah aktif. HTTPS apex/`www` lulus pada kedua IP edge aktual;
domain resmi lulus 51/51 pemeriksaan HTTP. Maintenance sumber berakhir
pukul 08.00 WIB dan plugin dijadikan inactive melalui WP-CLI.
Masuk pemilik pada hostname resmi serta uji kirim/terima email tetap
memerlukan penerimaan pemilik. Penyimpanan nameserver memindahkan delegasi
DNS setelah propagasi; cache resolver dapat belum seragam. Nameserver dan
binding tetap di Cloudflare sesuai klarifikasi terakhir pengguna; rencana
fallback DNS sementara tidak diterapkan. Pesanan tetap hanya di Cloudflare.

Pada 08.00–08.01 WIB, pemeriksaan HTTPS langsung ke hosting lama juga lulus:
beranda 200, `www` 301, tanpa maintenance. GET checkout lama memberikan 302
ke Workers dan probe POST kosong handler lama ditolak 409. Tidak ada data
pelanggan, unggahan, transfer, atau pesan yang dikirim oleh pemeriksaan itu.

## Bukti persiapan per 2 November 2026

Bukti berikut berasal dari snapshot dan pengujian yang sudah diverifikasi.
Jurnal rinci, waktu pengambilan, serta hasil yang memuat data privat disimpan
di luar repository. Guard handover sudah menghentikan penulisan pesanan/
status WordPress melalui jalur yang didukung; write lock diverifikasi.
Sampel processlist sebelum ekspor menunjukkan nol koneksi lain dan nol
koneksi aktif milik pengguna database sumber. Ini belum membuktikan status
semua request PHP yang sudah berjalan atau direct SQL di luar hook
WordPress. Site Health sumber kemudian menunjukkan PHP web 8.4.27,
SAPI LiteSpeed, batas waktu PHP 30 detik dan input 60 detik. Sampel proses
akun menunjukkan satu proses LiteSpeed PHP, nol dengan path PosLoker.
Ini bukti pendamping; tidak membuktikan riwayat setiap request lama atau
menjadikan batas CPU PHP sebagai batas seluruh waktu I/O.
Maintenance publik 07.00–08.00 WIB berakhir
otomatis, sedangkan guard tetap aktif sesudahnya. Ini bukan sinkronisasi
dua arah; Cloudflare menjadi penerima penulisan baru.

| Bagian | Bukti yang sudah ada | Yang masih harus ditutup |
| --- | --- | --- |
| Halaman publik | Pemeriksaan HTTP 51/51 halaman pada Workers dan domain resmi lulus, termasuk harga, kartu paket, data terstruktur, canonical, robots/sitemap, serta kebijakan indeks tiap hostname. Domain resmi diuji langsung ke edge Cloudflare dengan TLS/SNI valid karena cache lokal masih lama. | Penerimaan pemilik dan pengamatan selama propagasi. |
| Data historis | SQL/WXR final setelah source freeze cocok dengan 16 pesanan, 15 profil kontak konservatif, 394 metadata, dan 32 referensi berkas di tujuan. Tambahan/perubahan/penghapusan nol; tidak perlu impor ulang. Profil kontak bukan hitungan orang unik. | Pertahankan checkpoint dan guard; ekspor kembali target setelah perubahan operasional. |
| D1 dan pemulihan | Skema sampai `0008_receipt_access.sql`; pembacaan kembali 23 tabel cocok. Backup aktual dipulihkan ke SQLite terisolasi: seluruh nilai cocok, integritas lulus, dan 0 pelanggaran foreign key. | Ekspor ulang setelah perubahan berikutnya dan verifikasi versi Worker cadangan yang kompatibel. |
| R2 dan pemulihan | 29 objek privat (27 historis dan 2 contoh native), 14.055.050 byte. Backup dan salinan pemulihan cocok. Pada checkpoint frozen, SHA-256/ukuran seluruh 32 jalur sumber cocok dengan 27 objek historis yang sudah tersimpan; tidak ada delta berkas. | Bucket tetap privat; pertahankan backup dan objek setelah penulisan baru. |
| Checkout pelanggan | Uji browser paket berbayar/gratis sebagai tamu pada lebar 390 piksel dalam mode nyata **lokal terisolasi** lulus. Ringkasan tetap terbuka setelah sesi checkout uji kedaluwarsa. Simulasi gratis Cloudflare juga lulus, termasuk fragment dan pemuatan ulang. Cloudflare kini `live`; guard WordPress aktif. Tidak ada transfer/pesan yang dikirim dalam pengujian. | Verifikasi checkout/ringkasan pada domain resmi setelah aktivasi. |
| Admin dan pengaturan | Uji browser 390 piksel untuk arsip/pulihkan, unduhan byte-exact, penyimpanan harga/konten, dan pemulihan bawaan lulus. Di Worker Cloudflare akhir, akun pemilik berhasil memuat 49 kota, 16 kelompok harga, dan 51 halaman; arsip/pulihkan pada pesanan simulasi lulus. Pengujian admin, bisnis, legacy, migrasi, dan checkout lulus. | Pemilik masuk kembali serta memeriksa domain resmi ketika hostname dialihkan. |
| Handover sumber | MU-plugin sudah dipasang dan aktif. Preflight WP-CLI/PHP dan write lock lulus; sampel processlist database menunjukkan nol koneksi lain/aktif sebelum ekspor terakhir. Opsi guard aktif juga terverifikasi dalam SQL final. | Guard tetap aktif setelah maintenance publik berakhir; sampel database tidak menggantikan inspeksi request PHP lama/direct SQL di luar hook. |
| Domain dan email | Nameserver, delegasi induk dan zona aktif di Cloudflare. Nilai sembilan record nonweb cocok pada kedua nameserver (18/18 pemeriksaan). MX/SPF serta host mail/alias layanan tetap DNS-only ke hosting lama; TLS SMTP/IMAP lulus 4/4. HTTPS apex/`www` lulus 12/12 pemeriksaan pada kedua edge, termasuk home/robots/sitemap. | Masuk pemilik, pemeriksaan cache jaringan pengguna, serta kirim/terima dan autentikasi email bersama pemilik. |

Kode aplikasi `6d94253` sudah dipush dan build Cloudflare berhasil; target
Workers `live` lulus 51/51 halaman. Konfigurasi rute apex/`www`, retensi
`workers.dev`, dan panduan pemulihan operator pada `a1eeea2` telah dipush;
build Cloudflare berhasil. Pemeriksaan
akses anonim, pengalihan lama, serta ringkasan historis memakai kapabilitas
sumber asli lulus. Ringkasan historis tidak menampilkan kontak atau kuncinya.
Sesudah simulasi akhir, pesanan native berjumlah tiga dan semuanya berlabel
uji; dua lampiran native dan seluruh snapshot sumber tetap terpisah.
Cadangan akhir 23 tabel dipulihkan kembali dan cocok seluruh nilainya.
Pembacaan pasca-`live` juga dipulihkan dan diperiksa: snapshot sumber,
pesanan/berkas/audit native, autentikasi admin, pengaturan bisnis, dan
overlay tetap sama. Perubahan hanya mode serta sesi/counter sementara
yang sesuai aktivitas pemeriksaan HTTP; katalog 29 objek tetap utuh.

Rekonsiliasi final sumber lulus dan guard jalur penulisan WordPress aktif.
Bukti proses sumber memiliki batas yang dijelaskan di atas. Domain/TLS
sudah diperiksa terpisah; hasil tersebut tidak menggantikan uji email. Pemilik
memakai akun yang sudah ada; aktivasi akun baru tidak dibuka kembali.
Helper [pemulihan operator offline](owner-recovery.md) telah diuji pada
data sintetis; akun produksi tidak direset saat pengalihan.

Pemeriksaan PageSpeed seluler pada pratinjau tidak menggantikan uji formulir
dan admin di ponsel. Skor SEO pratinjau terpengaruh pembatasan pengindeksan
yang sengaja dipasang.

## Batas sistem yang harus dipahami

- Editor konten mengatur judul tab, deskripsi, judul utama, dan teks pembuka
  halaman yang sudah tersedia. Editor ini bukan seluruh WordPress CMS atau
  pembuat halaman bebas; tidak menyediakan unggahan tema/plugin, HTML bebas,
  atau penambahan halaman/kota baru.
- Editor bisnis mengatur kelompok harga kota, nama/harga/fitur/label paket,
  pembayaran, batas bukti, dan kontak yang didukung. ID paket, daftar kota,
  serta kelompok yang tersedia dipertahankan. Harga dan pembayaran pada
  penawaran lama tidak diganti oleh perubahan pengaturan baru.
- Pengelolaan pesanan tidak memublikasikan lowongan atau mengirim WhatsApp
  maupun email secara otomatis. Pembayaran diperiksa oleh pengelola;
  persetujuan status bukan integrasi verifikasi bank.
- Akun admin adalah akun pemilik Cloudflare tersendiri. Belum ada reset
  kata sandi mandiri. Jalur pemulihan operator offline sudah tersedia dan
  diuji; akun produksi tidak direset. Jangan menghapus pemilik, sesi, atau
  audit untuk membuka aktivasi ulang. Cookie sesi tidak dipindahkan antar
  hostname: pemilik masuk kembali pada domain resmi dengan akun yang sama,
  bukan mengaktifkan akun baru.
- WordPress dan Cloudflare tidak melakukan sinkronisasi dua arah. Sumber
  final WordPress sudah dibekukan dan cocok dengan tujuan; Cloudflare
  menerima penulisan baru. Bila status kerja historis sudah
  diubah di Cloudflare, rekonsiliasi harus mempertahankan perubahan itu dan
  meninjau konflik dengan sumber.

## Bukti penerimaan dan pemeriksaan lanjutan

Semua butir berikut perlu bukti lulus pada versi yang akan dipakai. Catat
commit/deploy, lingkungan, waktu, hasil, dan penguji pada jurnal privat.
Jangan menaruh data pelanggan, rekening, token, kata sandi, dump, atau bukti
transfer asli di Git maupun tangkapan layar yang dibagikan.

- [x] Pemeriksaan HTTP Workers 51/51 halaman serta katalog/harga/konten
  publik lulus. Perubahan pengaturan diuji pada lingkungan terisolasi.
- [x] Uji pelanggan tanpa sesi admin pada mode nyata lokal terisolasi:
  paket berbayar/gratis, berkas contoh, ringkasan, dan tampilan 390 piksel
  lulus. Ringkasan berkunci juga diuji setelah sesi checkout lokal berakhir.
  Tidak ada transfer atau pesan otomatis; produksi kini `live` setelah
  pengalihan yang disetujui, sedangkan data simulasi tetap berlabel uji.
- [x] Uji admin/bisnis lokal dan browser 390 piksel lulus, termasuk unduhan,
  arsip/pulihkan, perubahan harga/konten dan pemulihan bawaan. Backend
  menolak konflik revisi; akun pemilik pada Workers memuat katalog serta
  halaman dan berhasil mengarsipkan/memulihkan pesanan simulasi.
- [x] Pengujian backend sintetis dan HTTP lokal untuk akses anonim,
  asal permintaan lain, sesi/CSRF, dan kerahasiaan ringkasan lulus. Nomor
  atau ID pesanan saja tidak memberikan akses; kunci tautan bersifat privat.
- [x] Pengujian backend sintetis untuk pengiriman ulang/bersamaan dan
  gangguan D1/R2 lulus, termasuk hasil commit yang belum pasti dan
  kepemilikan berkas. Pemulihan mengikuti [panduan checkout](checkout.md).
- [x] Pengujian admin, bisnis, legacy, migrasi, dan checkout serta build
  aplikasi `6d94253` lulus. Hasil otomatis tetap dibedakan dari penerimaan
  pemilik pada domain resmi.
- [x] Apex/`www` dan TLS lulus pada kedua IP edge aktual; domain resmi
  51/51 halaman lulus, termasuk canonical/robots/sitemap dan perlindungan
  API anonim. Pengujian memakai SNI/validasi sertifikat, tanpa mengubah DNS OS.
- [ ] Masuk pemilik dan penerimaan browser checkout/ringkasan pada hostname
  resmi bersama pemilik setelah cache jaringan pengguna beralih.
- [ ] Verifikasi kirim/terima dan autentikasi email domain bersama pemilik.
  TLS port email yang lulus tidak menggantikan uji pesan tersebut.

## Cadangan, ekspor, dan latihan pemulihan

- [x] SQL/WXR sumber terakhir diambil setelah guard aktif; sampel koneksi
  database menunjukkan nol koneksi lain/aktif. Sumber inti dan 32 jalur
  unggahan cocok dengan tujuan. Backup, checksum, waktu, dan identitas
  sumber tersimpan privat.
- [x] Backup aktual D1 sampai skema v8 memuat 23 tabel dan sudah dibaca
  kembali seluruh kolomnya. Hash autentikasi, sesi, konfigurasi, pelanggan,
  serta audit tetap privat. Cadangan WordPress tidak menggantikan backup D1.
- [x] Manifest dan backup seluruh 29 objek R2 yang dirujuk snapshot telah
  dicocokkan kunci, ukuran, dan SHA-256. Berkas sumber tetap utuh; objek
  tanpa rujukan tidak dihapus sebagai bagian pengujian.
- [x] Backup D1 aktual dipulihkan ke SQLite privat baru dan cocok seluruh
  nilai, dengan integritas lulus serta 0 pelanggaran foreign key. Backup
  R2 disalin ke lokasi pemulihan terpisah dan cocok 29/29 objek. Latihan
  ini tidak menimpa sumber atau database/bucket produksi.
- [x] Helper pemulihan akses pemilik offline dan prosedurnya tersedia serta
  diuji pada data sintetis. Akun produksi tidak direset. Jika pemulihan
  diperlukan, pemilik memasukkan kredensial baru sendiri; pendaftaran
  publik tetap tertutup dan rahasia tidak disimpan di repository.
- [ ] Uji kembali versi Worker yang akan menjadi cadangan, dengan skema D1
  terkini. Mengembalikan kode tidak otomatis mengembalikan database/R2.

Tanda selesai pada bagian backup berlaku untuk checkpoint yang tercatat.
SQL/WXR final setelah freeze dan pencocokan seluruh jalur berkas sudah
lulus. Ambil ulang backup target setelah perubahan berikutnya; jangan
mengulang INSERT sumber yang sudah cocok.

## Persiapan DNS dan email

Inventaris zona lengkap harus disalin dari penyedia yang berwenang dan
dibandingkan dengan zona tujuan. Pemindaian DNS otomatis Cloudflare tidak
dijamin menemukan seluruh record. Tinjau pula rencana DNSSEC/DS pada
registrar sebelum pergantian nameserver, mengikuti prosedur penyedia.
Lihat [panduan full setup Cloudflare](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/).

| Record/layanan | Yang dipertahankan atau diverifikasi |
| --- | --- |
| NS dan delegasi | Nameserver saat ini, nameserver tujuan, TTL, serta subdomain yang didelegasikan. |
| A, AAAA, CNAME | Domain utama, `www`, subdomain layanan, dan status proxy yang sesuai. Jangan menyalin hanya alamat website utama. |
| MX | Prioritas dan tujuan penerima email lama, kecuali ada migrasi email terpisah. |
| A/AAAA/CNAME server email | Host yang dirujuk MX, SMTP/IMAP/webmail, dan ketergantungan layanan email. |
| SPF | TXT pengirim email yang sah; jangan membuat record SPF kedua atau menghapus pengirim yang masih dipakai. |
| DKIM dan DMARC | Semua selector DKIM dan record `_dmarc`, termasuk nilai dan kebijakan yang sudah berlaku. |
| Record lain | Verifikasi layanan, SRV, CAA, wildcard, serta subdomain yang memang masih digunakan. |

Email tetap memerlukan penyedia email/SMTP. Pindah website ke Workers tidak
memindahkan kotak surat. Pertahankan MX beserta record autentikasinya dan
gunakan DNS-only untuk host server email; uji kirim/terima dengan pemilik
serta hasil autentikasinya. Jika email masih di hosting lama, hosting itu
tetap diperlukan sampai ada keputusan migrasi email tersendiri. Lihat
[panduan record email Cloudflare](https://developers.cloudflare.com/dns/manage-dns-records/how-to/email-records/).

Nilai DNS lengkap disimpan pada catatan operasional privat. Pemeriksaan
NS/MX/TXT/A baca-saja belum membuktikan semua subdomain, selector DKIM,
DMARC, dan layanan email telah terinventarisasi.

## Saat pengalihan: satu sistem penerima pesanan

MU-plugin dan command ber-lock pada [panduan handover WordPress](wordpress-handover.md)
sudah dipasang dan diaktifkan pada hosting sumber. Preflight hosting,
write lock, ekspor final, dan pencocokan sumber serta seluruh jalur berkas
lulus; sampel processlist database menunjukkan nol koneksi lain/aktif.
Sampel itu tidak membuktikan status setiap request PHP lama atau direct SQL
di luar hook. Guard tidak berakhir bersama maintenance publik 07.00–08.00
WIB. Langkah berikut adalah prosedur untuk
menjaga penerima pesanan tunggal dan menyelesaikan penerimaan domain.

1. Tetapkan waktu, penanggung jawab, batas penerimaan, alamat Cloudflare
   yang sudah diuji, dan jalur kembali. Selesaikan penerimaan sistem dan
   persiapan zona sebelum meminta pergantian nameserver. Sebagian verifikasi
   domain/TLS akhir baru dapat dibuktikan ketika zona/rute aktif; jangan
   menyamakan lulus pratinjau dengan lulus domain produksi.
2. Siapkan perlakuan untuk formulir/penawaran lama, pembayaran yang belum
   dikonfirmasi, dan pengiriman yang responsnya belum pasti. Jangan meminta
   pelanggan membayar lagi atau membuat pesanan pengganti sebelum memeriksa
   apakah pesanan pertama tersimpan.
3. Pada waktu pengalihan yang disetujui, pastikan checkout Cloudflare sudah
   menerima pelanggan pada endpoint Workers yang diuji, lalu gunakan
   command handover untuk menghentikan penerbitan penawaran serta penulisan
   pesanan/status di WordPress. Formulir lama yang melakukan POST harus
   ditolak sebelum penulisan, dengan pesan jelas bahwa data belum dikirim,
   petunjuk mencoba alur Cloudflare, dan respons sementara tanpa cache.
   Jangan melakukan redirect 307/308 atau meneruskan POST multipart/token
   WordPress secara buta ke API Cloudflare.
4. Permintaan GET ke checkout lama dapat diarahkan ke titik masuk Cloudflare
   yang sudah terbukti dapat dijangkau. Hindari redirect ke URL yang masih
   kembali ke hosting lama selama propagasi, agar tidak terjadi putaran.
   Penanganan nomor/token pesanan historis harus diuji terpisah; jangan
   mengubah tautan privat menjadi tautan berkas publik.
5. Periksa permintaan sumber yang sudah berjalan sebelum penghentian.
   Pastikan tidak ada commit tertunda yang terlewat, kemudian ambil cadangan
   terakhir dan catat batas snapshot. Lamanya menunggu saja bukan bukti
   tidak ada penulisan yang masih berjalan.
6. Rekonsiliasi pesanan, perubahan status, metadata, harga historis, dan
   berkas terakhir berdasarkan ID sumber. Bandingkan seluruh nilai,
   relasi, ukuran, serta SHA-256. Tinjau konflik dengan status kerja/audit
   Cloudflare secara eksplisit; jangan menimpa salinan atau memasukkan
   ulang seluruh INSERT secara buta. Pisahkan simulasi dari pesanan nyata.
7. Setelah data cocok, verifikasi kembali bahwa hanya Cloudflare yang
   menerima pesanan. Pesanan native yang masuk selama rekonsiliasi tetap
   disimpan terpisah; perubahan dan audit yang sah tidak boleh tertimpa
   impor historis. WordPress dapat melayani halaman lama atau petunjuk
   perpindahan, tetapi tidak menjadi penerima pesanan kedua. DNS yang belum
   seragam tidak boleh membuat dua sistem menulis.
8. Terapkan nameserver, rute domain, dan TLS sesuai rencana. Verifikasi apex
   dan `www` secara terpisah karena Custom Domain Worker cocok pada hostname
   tertentu; uji sertifikat serta redirect yang dipilih. Lihat
   [Custom Domains Workers](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
9. Perbarui URL publik, canonical, data terstruktur, sitemap bila tersedia,
   robots, dan kebijakan pengindeksan untuk domain utama. Halaman publik
   produksi boleh diindeks setelah siap; `workers.dev` tetap pratinjau
   `noindex`. Admin, API, checkout/ringkasan privat tetap `noindex`, tanpa
   cache privat yang bocor. R2 tetap tanpa domain publik atau `r2.dev`.
10. Buktikan penerimaan pesanan dan alur admin pada domain resmi, lalu
    periksa resolusi dari beberapa jaringan/resolver. Pantau kesalahan
    layanan dan pesanan tanpa memasang Statistik PosLoker atau pelacak
    pengunjung. Pertahankan sumber, cadangan, serta layanan email lama
    sampai masa pengamatan dan keputusan pemulihan selesai.

## Jika pengalihan harus dibatalkan

Sumber penulisan harus ditetapkan kembali sebelum transaksi dibuka. Sekadar
mengembalikan nameserver tidak memindahkan pesanan baru dari D1 ke WordPress.

- **Sebelum Cloudflare menerima pesanan nyata:** tahan penulisan Cloudflare,
  pastikan tidak ada commit yang belum pasti, dan periksa sumber WordPress
  terakhir. Setelah rute/DNS yang diperlukan pulih, buka kembali hanya
  WordPress sebagai penerima pesanan. Simpan bukti percobaan pengalihan.
- **Setelah Cloudflare menerima pesanan nyata:** hentikan penulisan baru
  terlebih dahulu dan simpan ekspor D1/R2 beserta audit terakhir. Utamakan
  pemulihan versi Worker yang kompatibel dengan database terkini bila itu
  memulihkan layanan. Bila harus kembali ke WordPress, siapkan dan verifikasi
  impor pesanan/status/berkas Cloudflare yang belum ada di sumber; proses
  balik ini belum otomatis tersedia. Jangan membuka WordPress untuk menulis
  sebelum hasil rekonsiliasi benar dan Cloudflare tidak lagi menulis.
- Pertahankan snapshot, audit, objek R2, dan kedua cadangan. Jangan menghapus
  data atau mengembalikan database lama untuk membuat angka terlihat cocok.
  Tinjau ulang DNSSEC, rute, TLS, dan email sesuai perubahan yang benar-benar
  sudah dilakukan.

Pengalihan dapat dinyatakan siap hanya setelah semua penerimaan yang
relevan memiliki bukti dan rencana penulisan tunggal/pemulihan sudah diuji.
Pemeriksaan domain setelah aktivasi dan pencocokan data terakhir tetap
menjadi bagian eksekusi pengalihan, bukan pekerjaan yang diasumsikan selesai
oleh perubahan nameserver.
