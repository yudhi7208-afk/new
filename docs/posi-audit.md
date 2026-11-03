# Audit fondasi POSI — 3 November 2026

Audit ini membaca kode repository pada dasar `d8ed838`, sebelum implementasi
POSI di branch `feature/posi-ai-assistant`. Tidak ada akses isi database produksi,
berkas pelanggan, perubahan harga, kiriman order produksi, atau perubahan DNS.
Instruksi pemilik pada 3 November 2026 mengharuskan POSI dikembangkan terisolasi
dan melarang penerbitan produksi tanpa persetujuan baru yang eksplisit.

## Arsitektur yang ditemukan

Proyek menggunakan JavaScript ESM, HTML/CSS, dan JavaScript browser tanpa
framework. Dependensi pengembangan utama adalah Wrangler 4.156.0; alat uji
menggunakan Node.js 24. `public/` berisi ekspor WordPress yang dipertahankan,
51 halaman publik (beranda, direktori area, 49 kota), aset tema/plugin,
checkout baru, serta panel admin. PHP pada `migration/` adalah alat handover
hosting lama, bukan runtime Cloudflare.

`wrangler.jsonc` menerbitkan Worker produksi **new**, entry `src/worker.mjs`,
tanggal kompatibilitas `2026-10-30`, aset `public/`, dan custom domain apex/`www`.
Binding `CUSTOMER_DB` memakai D1 pesanan/pengaturan PosLoker; `CUSTOMER_FILES`
memakai R2 privat. Tidak ditemukan binding Workers AI atau API POSI pada dasar
audit. Tidak ada workflow GitHub Actions yang ditemukan pada checkout dasar;
Cloudflare Builds merupakan konfigurasi eksternal, sehingga ketiadaan workflow
tidak membuktikan push branch aman untuk penerbitan.

| Komponen | Sumber dan fungsi |
| --- | --- |
| Router | `src/worker.mjs`; mengarahkan halaman, checkout, admin, dan receipt lama |
| Halaman publik | `src/public-site.mjs`; `HTMLRewriter` mengganti harga, kontak, isi, metadata dari pengaturan D1 |
| Pemesanan | `src/checkout.mjs`, `public/pembayaran/index.html`, `public/checkout/checkout.js` dan `.css` |
| Pengelolaan order | `src/admin-orders.mjs`, `public/admin/admin.js` |
| Login pemilik | `src/admin-auth.mjs`; sesi cookie HttpOnly/Secure, CSRF, pemeriksaan origin |
| Pengaturan bisnis | `src/admin-business.mjs`, `/admin/business.html`; katalog, pembayaran, kontak dan isi halaman memakai revisi/audit |
| Receipt WordPress | `src/legacy-receipt.mjs`, `/konfirmasi-pembayaran/` |

## Alur pemesanan yang harus tetap independen

1. Beranda/halaman kota menawarkan pemilihan kota dan paket; wizard
   `#pl-order-wizard` membuat tautan Checkout. Kalkulator tema memakai
   `[data-order-button]`; kartu layanan memakai `[data-service-card]`.
2. Checkout membuka `/pembayaran/?city=…&package=…`. Browser mengambil
   `GET /api/checkout/session` untuk katalog, akses, batas unggah, dan token.
   Pilihan diperiksa terhadap katalog; tidak ada penggantian diam-diam ke paket
   lain bila parameter tidak valid.
3. `POST /api/checkout/quote` menerima pilihan kota/paket dan menghasilkan
   penawaran serta kode unik dari server. Tahap **Cek order** menampilkan
   `#orderSummary`. Paket berbayar membuka instruksi `#paymentDialog`.
   Paket dengan harga nol tidak memerlukan transfer/kode unik.
4. Pengunjung menekan `#continueButton`, mengisi formulir, memeriksa data dan
   persetujuan, lalu menekan `#submitButton` sendiri.
5. `POST /api/checkout/submit` memakai multipart, sesi, CSRF dan idempotency key.
   Server memvalidasi ulang penawaran, data, dan isi berkas; menyimpan order D1
   serta unggahan R2 privat. Retry tidak membuat key baru secara otomatis.
6. Receipt `#receiptStep` menampilkan hasil dan `#whatsappButton`. Tautan
   WhatsApp disiapkan server; pengunjung membuka dan mengirim pesan sendiri.
   Receipt dapat dibuka kembali melalui capability privat pada fragment URL.

POSI tidak boleh membaca cookie/token, receipt capability, bukti transfer,
unggahan, data order pelanggan lain, atau membungkus/mengganti endpoint di atas.

## Pemetaan formulir aktual

Formulir adalah `#orderForm`, fieldset `#orderFields`. State checkout berada
di dalam IIFE, bukan API publik. Belum ada antarmuka/event resmi untuk asisten.
Pemetaan ID di bawah adalah kontrak DOM yang ditemukan, bukan izin untuk
mengubah seluruh field.

| Label/kegunaan | ID | `name` | Aturan kode existing |
| --- | --- | --- | --- |
| Nama lengkap | `customerName` | `customerName` | Wajib; HTML maks.100, server maks.120 karakter, satu baris |
| WhatsApp | `customerWhatsapp` | `whatsapp` | Wajib; HTML maks.20, server maks.30; normalisasi 0/8 menjadi 62, hasil 10–15 digit |
| Email | `customerEmail` | `email` | Opsional; HTML maks.150, server maks.254, format email bila diisi |
| Bukti transfer | `proofInput` | `proof` | Wajib untuk penawaran berbayar; tidak diwajibkan paket harga nol |
| Poster/materi | `materialsInput` | `materials` | Opsional, banyak berkas gambar/PDF |
| Video Reel | `videoInput` | `video` | Opsional, satu MP4, hanya paket `komplit-plus` |
| Teks materi lowongan | `adText` | `adText` | Opsional menurut validator existing, maksimal2.000 karakter |
| Caption | `caption` | `caption` | Opsional, maksimal500 karakter; memiliki penghitung input |
| Catatan | `notes` | `notes` | Opsional, maksimal500 karakter |
| Persetujuan pemesan | `consent` | `consent` | Wajib dicentang sendiri; server menerima nilai `1` |
| Honeypot | `website` | `website` | Harus kosong; tersembunyi dari pengguna |

ID tombol penting adalah `continueButton`, `backToPackageButton`,
`submitButton`, `retrySubmitButton`, `renewSessionButton`, dan
`refreshQuoteButton`. POSI tidak diberi kemampuan menekan tombol-tombol
tersebut, mencentang `consent`, memilih/mengunggah berkas, mengisi honeypot,
atau mengubah harga/kota/paket.

Validator berkas pada browser dan server mengizinkan JPG/JPEG, PNG, WebP,
PDF. Server memeriksa signature, ekstensi, MIME dan ukuran. Materi termasuk
video maksimal10 berkas dengan total10MiB; batas bukti mengikuti penawaran
yang menyimpan pengaturan saat dibuat (konfigurasi dapat1–10MiB). POSI tidak
mengubah batas atau memberi jaminan bahwa berkas pasti diterima.

### Teks Materi dan layanan desain

HTML `#adTextTitle` berbunyi **Materi dalam bentuk teks**, dengan petunjuk
“Belum punya poster? Tuliskan rincian lowongan yang ingin dibuatkan desainnya.”
Kolom `#caption` terpisah untuk caption posting. Materi desain harus masuk
`adText`, **bukan** `caption`.

Aturan **layanan desain gratis cukup melalui Teks Materi** adalah instruksi
bisnis pemilik yang baru diberikan pada tugas POSI. Salinan FAQ lama hanya
menyebut layanan desain dapat ditambahkan, dan validator existing tidak
mewajibkan `adText` ataupun berkas materi. Karena itu POSI boleh menjelaskan
aturan pemilik dan membantu membuat draft berdasarkan informasi pengunjung,
tetapi tidak menambah syarat wajib, mengubah validasi, atau menganggap paket
publikasi berharga nol sama dengan layanan desain gratis. Jangan menambahkan
informasi lowongan yang belum diberikan pengguna.

## Pengetahuan paket, kota, harga dan kontak

Sumber operasional adalah D1 `commerce_settings`: `catalog_json`,
`payout_json`, dan `mode`. `src/checkout.mjs` memvalidasinya; halaman publik
memakai `readBusinessSettings()` dari `src/admin-business.mjs`. Katalog berupa
`{cities:[{name,pricingKey}],pricing:{group:[{id,name,price,features,badge?}]}}`.
Kota memakai kelompoknya atau `default` menurut aturan existing. Nilai
penawaran server tetap menjadi satu-satunya nominal transfer yang berlaku.

`src/public-content-defaults.mjs` serta variabel `poslokerData`/
`poslokerPayment` dalam ekspor HTML adalah **snapshot**, bukan bukti harga D1
terkini. Snapshot memiliki49 kota dan16 kelompok harga. Contoh snapshot Medan:
`ig` Rp15.000; `ig-story` Rp17.500; `ig-fb` Rp20.000;
`ig-fb-story` Rp25.000; `komplit` Rp35.000; `komplit-plus` Rp50.000.
Contoh ini tidak boleh disajikan sebagai harga produksi terkini tanpa
sinkronisasi tervalidasi. Fitur kanal pada snapshot mencakup Instagram Feed,
Story, Carousel, Reel sesuai paket, Facebook Page dan Facebook Group lokal.
Tidak semua paket/kota menyediakan setiap kanal.

POSI tahap awal harus mencantumkan sumber/tanggal snapshot atau menolak
menyebut harga ketika data tidak tersedia/kedaluwarsa; model AI tidak boleh
menentukan harga, promosi, followers, jangkauan atau jaminan hasil rekrutmen.
Saat rilis produksi kelak, pengetahuan harga/kota/kontak perlu sinkronisasi
publik baca-saja yang disetujui; jangan menambahkan binding database order ke
Worker POSI untuk memudahkan pengambilan data.

Bantuan resmi ditemukan pada tautan footer `Bantuan via WhatsApp`, dengan
origin `https://wa.me/`. Runtime mengganti nomor sesuai `payout.whatsapp` dan
menggunakan nilai yang sama pada pesan hasil order. Email/Instagram/Facebook
berasal dari pengaturan situs (`SITE_DEFAULTS` sebagai fallback). Pengetahuan
POSI hanya boleh memakai kontak publik yang tervalidasi; nomor rekening,
session/CSRF/receipt key, dan isi pelanggan tidak dimasukkan knowledge base.
Tautan detail pesanan di WhatsApp mengarah `/admin/?order=…` pada domain resmi
dan tetap memerlukan login pemilik.

## Batas integrasi yang aman

* Buat Worker dan direktori POSI terpisah; jangan mengubah `src/worker.mjs`,
  `wrangler.jsonc` produksi, `public/`, migrasi order, atau pola URL existing
  pada tahap pertama. Worker POSI tidak mempunyai binding D1/R2 order maupun
  service binding ke Worker transaksi.
* Default frontend dan backend `POSI_ENABLED=false`. Saat OFF, loader berhenti
  sebelum import widget, membuat DOM, atau meminta konfigurasi/AI. Kegagalan
  POSI tidak masuk ke promise/rantai validasi atau submit checkout.
* Uji integrasi pada salinan lokal/staging dengan database serta pembayaran
  sintetis. Adapter versi pertama hanya boleh menawarkan highlight dan
  draft `adText`; periksa ID, tipe, panjang, tahap terlihat dan enabled.
  Memakai ID eksplisit merupakan kompromi yang diaudit karena belum ada API
  form resmi. Rilis mendatang sebaiknya menambah hook terbatas di aplikasi
  setelah mendapat persetujuan; jangan mengakses state privat via scraping.
* Tampilkan draft, minta persetujuan khusus untuk menerapkan, dan minta
  persetujuan penggantian bila field sudah berisi. Tolak penerapan jika field
  berubah sejak ditinjau. Memasukkan draft tidak berarti persetujuan order.
* Widget memakai Shadow DOM/namespacing, panel nonmodal tanpa backdrop,
  scroll-lock, `inert`, atau global `preventDefault` pada formulir. Tombol
  close/hide, fokus keyboard, safe-area dan reduced-motion perlu diuji.
  Panel tidak boleh menyembunyikan kontrol pengiriman saat pelanggan mengisi.
* Kebijakan `protect()` pada halaman checkout/admin memakai CSP
  `script-src 'self'; style-src 'self'; connect-src 'self'`. Widget/API
  beda-origin belum akan bekerja di produksi dengan CSP tersebut. Rencana
  penerbitan kelak memerlukan keputusan pemilik dan perubahan CSP yang sempit,
  bukan wildcard/`unsafe-inline` atau melemahkan kebijakan admin.
* Backend hanya menerima pesan/konteks terbatas; rendering teks, timeout,
  limit ukuran/token, CORS allowlist, pembatasan permintaan dan fallback FAQ.
  Tidak ada tool untuk submit/status/order/pembayaran maupun riwayat chat
  permanen. Konten pengguna dianggap tidak tepercaya.

## Tahap pertama dan gerbang berikutnya

Hasil yang dituju tahap pertama adalah audit, kontrak adapter, komponen
maskot SVG original, widget, backend modular, feature flag OFF, fixture dummy,
serta uji kegagalan terisolasi. Ini bukan pernyataan POSI sudah aktif atau
layak dilepas ke semua pelanggan.

Panel konfigurasi POSI terautentikasi, statistik agregat POSI, sinkronisasi
pengetahuan operasional, pembatasan biaya pada tingkat akun, uji model AI
remote dan pengujian perangkat fisik perlu bukti tersendiri sebelum rilis.
Statistik yang diminta pada tugas ini dibatasi bantuan POSI; pedoman proyek
tetap melarang menghidupkan pelacak pengunjung/PosLoker Insights lama.

Sebelum produksi wajib ada hasil order dummy ketika POSI OFF/ON/error/lambat,
unggahan poster, validasi native/server, konfirmasi overwrite, keyboard/mobile,
hide/close dan rollback. Emulasi viewport tidak membuktikan Android/iPhone
fisik atau seluruh browser. Jangan menyatakan semua skenario sudah lulus
hanya dari unit test backend.

Branch fitur tidak boleh digabung/push ke `main` atau memicu penerbitan Worker
**new**. Sebelum push branch, periksa konfigurasi Cloudflare Builds eksternal
atau tahan push bila efek deployment belum dapat dipastikan. Staging harus
memakai nama Worker tersendiri tanpa domain produksi. Penerbitan produksi
dengan flag OFF, aktivasi internal, kemudian aktivasi pelanggan merupakan
keputusan terpisah setelah bukti uji dan persetujuan pemilik.
