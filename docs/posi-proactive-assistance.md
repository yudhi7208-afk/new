# POSI hadir saat dibutuhkan — 5 November 2026

Implementasi ini berlaku pada staging `new-posi-staging` di branch
`feature/posi-ai-assistant`. Tidak ada perubahan Worker `new`, website
produksi, order, database pelanggan, pembayaran, harga, admin atau DNS.

## Perilaku

POSI tidak menampilkan maskot, launcher tetap, sapaan cepat atau panel chat
saat halaman baru dibuka. Kebijakan lokal memeriksa waktu pada tab aktif:
minimal60 detik di halaman dan minimal25 detik tanpa kemajuan/aktivitas.
Klik, keyboard, isian, perubahan pilihan, scrolling dan pergantian tahap
mengulang jeda aktivitas. Waktu tab latar tidak dihitung.

Pemicu adalah perkiraan kebutuhan bantuan berdasarkan jeda, bukan deteksi
perasaan/kebingungan. Tidak ada rekaman perilaku yang dikirim atau disimpan.
Tidak ada request AI selama menunggu atau ketika sapaan muncul.

Tawaran tidak muncul saat field aktif/keyboard digunakan, dialog pembayaran
terbuka, kontrol order berada di area yang berpotensi tertutup, atau receipt
berhasil sudah terlihat. Saat layak, satu kartu kecil menampilkan robot dan
“Halo, ada yang bisa saya bantu?” dengan pilihan Ya, bantu saya / Nanti saja,
tutup dan Dengarkan sapaan. Tidak ada backdrop, modal, perubahan fokus atau
scroll-lock. Panel bantuan dibuka setelah pengunjung menyetujuinya.

Tawaran berhenti sesudah20 detik. Penolakan/tutup menyembunyikan POSI.
Tidak ada pengulangan otomatis pada sesi yang sama; sessionStorage hanya
menyimpan tanda1. Bantuan tetap dapat dibuka manual lewat tombol biasa pada
demo, tanpa floating launcher. Tidak ada reset sesi melalui query URL.

## Suara

Suara hanya dipersiapkan setelah interaksi nyata pengguna. Sapaan tetap:
“Halo, ada yang bisa saya bantu?” memakai voice Indonesia lokal bila tersedia;
jika tidak, tiga nada sine pendek dan lembut dipakai sebagai bunyi notifikasi
original, tanpa unduhan audio atau layanan TTS eksternal. Isi chat dan form
tidak dibaca ke suara. Tidak ada mikrofon atau izin notifikasi browser.

Browser dapat memblokir audio atau tidak menyediakan voice Indonesia. Sapaan
teks selalu tersedia dan tombol Dengarkan sapaan memberi interaksi langsung.
Kontrol Suara aktif/mati tersedia pada panel; mute menghentikan suara milik
POSI dan pilihan disimpan hanya untuk sesi. Tab tidak aktif atau field/dialog
aktif menahan/menghentikan audio. Error audio tidak memengaruhi checkout.

## Tautan dan konfirmasi

Respons model/aturan hanya mengembalikan ID allowlist. URL ditentukan kode
browser, bukan model atau input pengguna. Panduan staging:

- `/panduan/#cara-memasang`
- `/panduan/#cek-order`
- `/panduan/#konfirmasi-pembayaran`

Panduan memasang memuat tautan publik yang ada: website utama `/#cara-kerja`
dan `/#pilih-paket`. Klik tautan tidak mengirim order. Panduan pembayaran
meminta kembali ke tab pemesanan yang sama agar total/kode unik tidak berubah.
Pengingat menggunakan kalimat bersyarat: setelah transfer, lengkapi bukti dan
tekan Kirim konfirmasi & materi sampai berhasil; paket gratis tidak transfer.
Receipt yang sudah berhasil tidak diingatkan untuk transfer/submit ulang.

Saat receipt sendiri sedang terbuka pada fixture checkout, adapter dapat
memberi tautan pribadi dari URL halaman itu sendiri untuk Cek order.
Origin/path/order ID/fragment key harus sesuai format. Capability hanya berada
di browser dan tidak masuk request AI, log, knowledge base atau storage POSI.
Tanpa receipt aktif, tautan mengarah panduan menemukan ringkasan atau admin
resmi; tidak ada pencarian data pelanggan atau tautan dashboard admin.

## Pengujian dan batas

Unit/integrasi mencakup ambang waktu, tab latar, pengetikan/modal/receipt,
sekali per sesi, storage diblokir, audio sebelum gesture/mute/voice/fallback,
allowlist tautan, privasi receipt, dan pengingat setelah order selesai.
Suite tetap menjalankan checkout asli dengan database/berkas dalam memori.

Browser QA memeriksa DOM benar-benar tersembunyi pada awal halaman,
penawaran dengan waktu nyata, dismiss, bantuan manual, tautan, suara yang
diminta melalui UI, dan tata letak responsif. Hasil suara yang benar-benar
terdengar bergantung volume, mode senyap, voice dan autoplay perangkat;
pengujian API audio tidak membuktikan seluruh perangkat fisik berbunyi.

Aturan ini belum dipasang pada domain produksi. Pemasangan produksi tetap
memerlukan persetujuan pemilik sesuai batas zero disruption. Rollback staging
dapat memakai versi sehat sebelumnya yang memiliki class `PosiAiBudget`.

## Hasil verifikasi

- Suite lengkap: 77 tes lulus, 0 gagal. Build dan dry-run lulus; bundle
  Worker 49,42KiB / gzip 10,90KiB. Semua berkas produksi identik dengan dasar.
- Enam skenario checkout asli dengan database memori tetap berhasil;
  pengingat dan pemicu tidak menjadi dependensi submit.
- Smoke test staging memakai tiga pertanyaan bebas (`source:ai`) dan
  pertanyaan pembayaran/cek order (`source:rules`), semua lulus. Origin
  produksi tetap403 dan tidak ada tool transaksi atau URL model yang dipakai.
- Browser lokal: pada40 detik masih tersembunyi; pada sekitar72 detik kartu
  tawaran terlihat, panel tetap tertutup. Kartu menghilang sendiri setelah
  batas tampil20 detik. Bantuan manual dan tautan panduan berfungsi.
- Toggle mute berubah ke Suara mati; tombol Coba sapaan suara menghasilkan
  status permintaan suara/notifikasi berhasil. Tidak diklaim suara terdengar
  pada seluruh perangkat; periksa volume/mode senyap dan dukungan voice.
- Browser Cloudflare staging: setelah69 detik dengan `adText` tetap aktif,
  tidak ada tawaran/panel. Setelah keluar dari field dan melewati jeda25 detik,
  tawaran muncul pada viewport390×844 di dalam layar, tanpa overflow. Klik
  Nanti saja menyembunyikan kartu, panel dan robot; field tidak diubah.

Versi staging: `101c69be-d6ec-4e24-bb63-680f9e662856`.
Fallback kompatibel budget: `f471a30e-39cf-457d-8db8-a65458ebbdeb`.
