# POSI: batas pekerjaan yang disetujui pemilik

Instruksi pemilik 3 November 2026: bangun POSI terisolasi, tanpa perubahan
produksi. Website, formulir, poster, pembayaran, order dan admin harus tetap
independen. Tidak boleh mengubah harga/aturan bisnis, endpoint transaksi,
database produksi, DNS, nameserver, autentikasi atau desain utama.

- Branch `feature/posi-ai-assistant`; jangan merge/push `main` atau deploy
  Worker `new` tanpa persetujuan pemilik yang baru dan eksplisit.
- Worker POSI terpisah; tanpa binding database/berkas/service transaksi.
  Database percakapan pun harus terpisah bila nanti diperlukan.
- Default `POSI_ENABLED=false`; saat OFF tidak ada widget atau request AI.
- AI boleh gagal. Checkout tidak boleh menunggu request/inisialisasi POSI.
- Tidak ada submit otomatis, perubahan nominal/status/order, atau akses
  pelanggan lain. Pemesan tetap menekan persetujuan dan kirim sendiri.
- Desain gratis memakai Teks Materi (`adText`), bukan Caption. Jangan
  menambah aturan wajib yang tidak ada pada validator existing.
- Pengisian draft memerlukan persetujuan; penggantian isi memerlukan
  persetujuan khusus dan pemeriksaan bahwa isinya belum berubah.
- Semua pengujian order/unggahan menggunakan lingkungan dummy terisolasi.
  Jangan membuat order dummy pada produksi atau mengirim WhatsApp.
- Jangan menyimpan percakapan/PII atau menambahkan pelacak pengunjung.
- Sebelum produksi: bukti regresi, katalog aktual tervalidasi, uji gagal,
  perangkat fisik, rollback teruji dan persetujuan pemilik diperlukan.

Konfigurasi staging ini tidak memberikan izin aktivasi POSI bagi pelanggan.

Arahan pemilik 5 November 2026: POSI bersembunyi pada awal kunjungan dan
baru menawarkan bantuan kecil saat pengunjung berlama-lama tanpa kemajuan.
Jangan memasang launcher/chat yang terus muncul. Sapaan “Halo, ada yang bisa
saya bantu?” memakai suara yang diizinkan browser atau bunyi lembut; sediakan
mute/tutup dan jangan menghalangi formulir. Sertakan panduan memasang, cek
order pribadi dan pengingat konfirmasi tanpa membaca data pelanggan lain.
