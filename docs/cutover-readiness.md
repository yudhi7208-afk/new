# Kesiapan pengalihan PosLoker

Keputusan pengguna: **sistem, database, berkas, dan pengelolaan Cloudflare
harus siap dipakai sebelum nameserver dipindahkan**. Website WordPress lama
tetap beroperasi selama persiapan. Proyek `new` hanya untuk PosLoker.

Dokumen ini adalah daftar penerimaan dan prosedur pengalihan, bukan
pernyataan bahwa semua tahap sudah lulus. Perubahan nameserver memindahkan
pengelolaan DNS; aplikasi, data, rute Worker, dan email tetap memerlukan
konfigurasi yang benar. Domain, DNS, mode transaksi nyata, serta penghentian
penulisan di WordPress hanya diubah pada tahap pengalihan setelah permintaan
eksplisit pengguna.

## Bukti persiapan per 2 November 2026

Bukti berikut berasal dari snapshot dan pengujian yang sudah diverifikasi.
Jurnal rinci, waktu pengambilan, serta hasil yang memuat data privat disimpan
di luar repository. WordPress tetap menerima pesanan; ini bukan replikasi
langsung atau jaminan bahwa transaksi setelah snapshot sudah tersalin.

| Bagian | Bukti yang sudah ada | Yang masih harus ditutup |
| --- | --- | --- |
| Halaman publik | 51 halaman sumber beserta konten/harganya tetap sesuai. Pemeriksaan HTTP 51/51 halaman pada Worker Cloudflare yang diterbitkan lulus, termasuk harga, kartu paket, data terstruktur, serta perlindungan pratinjau. | Pemeriksaan ulang pada domain resmi saat pengalihan. |
| Data historis | Snapshot terakhir: 16 pesanan, 15 profil kontak konservatif, 394 metadata, dan 32 referensi berkas. Pembacaan kembali seluruh kolom dan relasi cocok. Profil kontak bukan hitungan orang unik. | Cadangan serta pencocokan terakhir setelah penulisan sumber dihentikan pada waktu pengalihan. |
| D1 dan pemulihan | Skema sampai `0008_receipt_access.sql`; pembacaan kembali 23 tabel cocok. Backup aktual dipulihkan ke SQLite terisolasi: seluruh nilai cocok, integritas lulus, dan 0 pelanggaran foreign key. | Ekspor ulang setelah perubahan berikutnya; verifikasi versi Worker cadangan dan prosedur pemulihan akses operator. |
| R2 dan pemulihan | 29 objek privat (27 historis dan 2 contoh native), 14.055.050 byte. Unduhan terautentikasi, backup, dan salinan pemulihan cocok SHA-256 serta ukurannya. | Ambil delta berkas yang masuk sesudah snapshot; bucket tetap privat. |
| Checkout pelanggan | Uji browser paket berbayar/gratis sebagai tamu pada lebar 390 piksel dalam mode nyata **lokal terisolasi** lulus. Ringkasan tetap terbuka setelah sesi checkout uji kedaluwarsa. Simulasi gratis pada versi Cloudflare akhir juga lulus, termasuk kunci fragment, pemuatan ulang, serta ketiadaan kunci pada WhatsApp; tidak ada transfer/pesan yang dikirim. | Produksi tetap `preview` sampai pengalihan; verifikasi domain resmi dan penulisan tunggal pada waktu pengalihan. |
| Admin dan pengaturan | Uji browser 390 piksel untuk arsip/pulihkan, unduhan byte-exact, penyimpanan harga/konten, dan pemulihan bawaan lulus. Di Worker Cloudflare akhir, akun pemilik berhasil memuat 49 kota, 16 kelompok harga, dan 51 halaman; arsip/pulihkan pada pesanan simulasi lulus. Pengujian admin, bisnis, legacy, migrasi, dan checkout lulus. | Pemilik masuk kembali serta memeriksa domain resmi ketika hostname dialihkan. |
| Handover sumber | Artefak PHP pengalihan ber-lock lulus lint dan 120 pengujian runtime sintetis. | Belum dipasang/diaktifkan. Preflight WordPress/MySQL hosting, permintaan lama, dan satu sumber penulisan harus dibuktikan sebelum aktivasi. |
| Domain dan email | Inventaris 12 record valid tersimpan privat; 24/24 kelompok nama/jenis cocok pada dua nameserver otoritatif. Lookup DS berhasil dan tidak menemukan DS terpublikasi. Tidak ada perubahan DNS atau nameserver. MX, alias mail, dan satu alias layanan masih bergantung pada apex. | Terapkan rencana host layanan DNS-only yang tetap menuju hosting lama, tinjau SPF/klien email, DNSSEC/DS, rute domain/TLS, dan uji domain/email saat pengalihan. |

Kode aplikasi [c4ff0cf](https://github.com/yudhi7208-afk/new/commit/c4ff0cf98ce6ed151d05d696d10b57ba93a2041f)
sudah dipush dan build Cloudflare berhasil. Pemeriksaan target 51/51 halaman,
akses anonim, pengalihan lama, serta ringkasan historis memakai kapabilitas
sumber asli lulus. Ringkasan historis tidak menampilkan kontak atau kuncinya.
Sesudah simulasi akhir, pesanan native berjumlah tiga dan semuanya berlabel
uji; dua lampiran native dan seluruh snapshot sumber tetap terpisah.
Cadangan akhir 23 tabel dipulihkan kembali dan cocok seluruh nilainya.

Penerbitan aplikasi ini tidak menjalankan pengalihan. Hasil lokal dan
pratinjau tidak menandai seluruh gerbang domain, hosting, dan penulisan
tunggal selesai. Pemilik memakai akun yang sudah ada; aktivasi akun baru
tidak dibuka kembali.

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
  kata sandi mandiri. Jalur pemulihan operator yang aman harus disepakati
  dan diuji sebelum siap operasi; jangan menghapus pemilik, sesi, atau
  audit untuk membuka aktivasi ulang. Cookie sesi tidak dipindahkan antar
  hostname: pemilik masuk kembali pada domain resmi dengan akun yang sama,
  bukan mengaktifkan akun baru.
- WordPress dan Cloudflare belum melakukan sinkronisasi dua arah. Selama
  persiapan, WordPress menjadi acuan pesanan nyata; Cloudflare dipakai
  untuk pemeriksaan salinan dan simulasi. Bila status kerja historis sudah
  diubah di Cloudflare, rekonsiliasi harus mempertahankan perubahan itu dan
  meninjau konflik dengan sumber.

## Penerimaan sistem sebelum nameserver

Semua butir berikut perlu bukti lulus pada versi yang akan dipakai. Catat
commit/deploy, lingkungan, waktu, hasil, dan penguji pada jurnal privat.
Jangan menaruh data pelanggan, rekening, token, kata sandi, dump, atau bukti
transfer asli di Git maupun tangkapan layar yang dibagikan.

- [ ] Seluruh halaman dan rute penting merespons benar; tidak ada gambar,
  font, tombol, tautan pemesanan, atau konten yang hilang. Perubahan konten,
  harga, kelompok kota, dan kontak tampil konsisten pada halaman publik,
  kalkulator, data terstruktur, serta penawaran server.
- [ ] Uji ponsel dan desktop: paket gratis/berbayar, pengubahan kota/paket,
  isian wajib, teks/caption, bukti, gambar/PDF, dan MP4 untuk paket yang
  mendukungnya. Uji batas ukuran/jumlah/jenis berkas dan pesan penolakannya.
- [x] Uji pelanggan tanpa sesi admin pada mode nyata lokal terisolasi:
  paket berbayar/gratis, berkas contoh, ringkasan, dan tampilan 390 piksel
  lulus. Ringkasan berkunci juga diuji setelah sesi checkout lokal berakhir.
  Tidak ada transfer atau pesan otomatis; mode produksi tetap `preview`.
- [ ] Uji admin: masuk/keluar, sesi kedaluwarsa, pencarian/filter/halaman,
  unduhan privat, status/catatan/alasan, arsip/pulihkan, pengaturan bisnis,
  isi halaman, dan riwayat. Dua tab yang mengubah revisi sama harus menolak
  penimpaan; draf tidak boleh diam-diam memakai revisi baru.
- [x] Pengujian backend sintetis dan HTTP lokal untuk akses anonim,
  asal permintaan lain, sesi/CSRF, dan kerahasiaan ringkasan lulus. Nomor
  atau ID pesanan saja tidak memberikan akses; kunci tautan bersifat privat.
- [x] Pengujian backend sintetis untuk pengiriman ulang/bersamaan dan
  gangguan D1/R2 lulus, termasuk hasil commit yang belum pasti dan
  kepemilikan berkas. Pemulihan mengikuti [panduan checkout](checkout.md).
- [ ] Seluruh pemeriksaan kode yang relevan dan deploy uji lulus. Pisahkan
  hasil pemeriksaan otomatis dari uji browser dan penerimaan pemilik.
- [ ] Kebutuhan operasional pada batas sistem di atas telah diterima atau
  dilengkapi. Jangan menyebut seluruh WordPress CMS sudah dipindahkan.

## Cadangan, ekspor, dan latihan pemulihan

- [ ] Ambil cadangan WordPress terbaru: database, kode/konfigurasi yang
  diperlukan, unggahan pesanan, serta berkas sumber lain yang dipertahankan.
  Simpan privat beserta checksum, waktu pengambilan, dan identitas sumber.
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
- [ ] Uji pemulihan akses pemilik dan konfigurasi layanan. Pemilik sendiri
  memasukkan kredensial baru bila diperlukan. Jangan membuka pendaftaran
  publik atau menyimpan rahasia di repository.
- [ ] Uji kembali versi Worker yang akan menjadi cadangan, dengan skema D1
  terkini. Mengembalikan kode tidak otomatis mengembalikan database/R2.

Tanda selesai pada bagian backup berlaku untuk checkpoint yang tercatat.
Ambil ulang ekspor dan delta berkas setelah ada perubahan serta tepat
sebelum pengalihan, kemudian ulangi pencocokannya.

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

Artefak MU-plugin dan command ber-lock sudah disiapkan serta diuji secara
lokal pada [panduan handover WordPress](wordpress-handover.md). Artefak ini
**belum dipasang atau diaktifkan pada hosting sumber**. Preflight hosting,
pengurasan permintaan, dan pencocokan terakhir tetap harus dibuktikan saat
pengalihan. Saat ini WordPress tetap menerima pesanan seperti biasa.

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
