# Pedoman proyek yang disetujui pengguna

Disimpan pada 1 November 2026.

- Terapkan prinsip **satu website satu proyek** agar mudah dikelola.
- Repository `yudhi7208-afk/new` dan Worker `new` khusus untuk PosLoker.
- Website lain dibuat sebagai proyek terpisah; jangan digabungkan ke proyek ini.
- Biaya mengikuti pemakaian setiap layanan.
- Website WordPress lama tetap beroperasi selama penyalinan ke Cloudflare.
  Sistem, database, berkas, dan pengelolaan Cloudflare harus disiapkan serta
  diuji sebelum nameserver dipindahkan; pengalihan domain adalah tahap akhir.
  Jangan mengalihkan domain/DNS atau menghentikan hosting lama sebelum
  seluruh alur migrasi lengkap, diuji, dan pengguna meminta pengalihan.
- Statistik PosLoker / PosLoker Insights tidak diperlukan. Jangan memasang,
  mengaktifkan, mengekspor, atau memigrasikan pelacak statistik pengunjung
  ke Cloudflare kecuali pengguna meminta kembali.

Batasi perubahan pada proyek PosLoker ini. Jangan mengubah proyek lain.
