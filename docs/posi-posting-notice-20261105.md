# Informasi jadwal posting POSI — 5 November 2026

Pemilik menyetujui pemasangan produksi pada 5 November 2026 untuk informasi
meeting: order masuk mulai diposting pukul 12.00 WIB / 13.00 WITA / 14.00 WIT.
Ini hanya pengumuman sementara, bukan aktivasi chatbot AI pada produksi.

`POSI_NOTICE_ENABLED` dianggap OFF bila tidak disediakan. Konfigurasi produksi
menetapkan `true` untuk aktivasi yang disetujui ini; aktivasi berlaku hanya
pada 5 November 2026, sebelum 12.00 WIB. Worker berhenti menyisipkan informasi
pada saat itu; halaman terbuka menghapusnya berdasarkan sisa waktu dari server.
Tidak ada injeksi ke admin, API, CSS, JavaScript, respons error atau mutasi.

Atas permintaan lanjutan pemilik, informasi tampil sebagai pop-up kuning
nonmodal, tanpa backdrop, scroll-lock atau perubahan fokus. Pop-up mencari
pojok layar yang tidak menutupi kontrol formulir/tombol kirim; bila tidak ada
ruang, ia menunggu. Pop-up bersembunyi saat dialog pembayaran atau isian aktif.
Tombol Saya mengerti, tutup, Escape, atau klik di luar menutup pop-up tanpa
mencegah aksi asli halaman. Maskot putih menunduk dan merapatkan tangan, dengan dukungan
prefers-reduced-motion. Tombol tutup berlaku untuk sesi. Bunyi tiga nada lembut
hanya setelah interaksi yang diizinkan browser atau tombol Dengarkan notifikasi;
interaksi formulir/tombol/link tidak memicu bunyi otomatis. Tidak ada izin
notifikasi sistem, mikrofon, AI, database atau request pihak ketiga.

Tidak ada perubahan harga, katalog, endpoint/order, validasi, unggahan, D1,
R2, autentikasi, DNS atau nameserver. Jika modul gagal, pop-up tidak dibuka;
checkout tidak menunggu modul. Flag OFF mengembalikan respons asli.

Perubahan pop-up lulus enam uji penempatan untuk menghindari tombol kirim,
23 pemeriksaan jadwal/flag, dan browser lokal desktop/lebar CSS 375px. Pop-up
muat di dalam layar, tombol Saya mengerti/tutup berfungsi, dialog existing
tidak ditumpuk, dan satu order dummy tetap mencapai receipt tanpa membuka WA.

Rollback produksi sebelum pemasangan: `0968fc7c-0108-407c-8ef0-844346b0e144`.
Rollback kode dapat mengembalikan versi tersebut; flag juga dapat dimatikan
dengan deployment `--var POSI_NOTICE_ENABLED:false --keep-vars`. Tidak ada
migrasi atau perubahan data yang perlu dibatalkan.

Pengujian: `node scripts/test-posi-notice.mjs`, `npm run test:production`,
`npm run test:checkout`, dan regresi POSI checkout sintetis. Pengujian browser
memakai fixture memori lokal di port 8792; jangan mengirim order dummy produksi.

Hasil sebelum rilis: 23 pemeriksaan jadwal/flag/isolasi respons lulus, 51
halaman publik lulus, checkout server lulus, dan delapan regresi checkout POSI
lulus. Browser lokal pada desktop dan lebar CSS 375px menampilkan informasi
tanpa overflow. Tutup dan pemutaran notifikasi diuji tanpa error console.
Satu order sintetis pada fixture lokal berhasil mencapai receipt dan tautan
WhatsApp; tautan tersebut tidak dikirim. Tidak diklaim sebagai uji perangkat
Android fisik atau bukti suara terdengar pada semua perangkat.

Rilis produksi: commit main `e3df67b`, Worker versi
`f5d8db7d-c493-4472-a5ea-9f25f3b4b387`. Sesudah rilis, pemeriksaan baca-anonim
pada domain asli lulus 51/51 halaman dan aturan harga/SEO/akses. Beranda,
halaman kota dan pembayaran memuat pemberitahuan; admin tidak. Ketiga aset
pemberitahuan identik dengan lokal. Browser pada domain asli menampilkan
informasi, waktu WIB, maskot dan tombol tanpa error console.
