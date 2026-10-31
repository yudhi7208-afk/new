# Pratinjau PosLoker di Cloudflare Workers

Salinan halaman publik `https://posloker.my.id` untuk meninjau perpindahan ke
Cloudflare Workers Static Assets. Target pratinjau adalah
`https://new.yudhi7208.workers.dev`; domain dan hosting asal tidak diubah.

Beranda, direktori area, 49 halaman kota, gambar, CSS, JavaScript, dan font
berjalan dari `public/`. Pencarian kota, filter wilayah, dan pilihan paket
mempertahankan perilaku serta data harga situs asal saat ekspor.

**Pesanan dan pembayaran masih dilanjutkan di situs asal.** Handler PHP,
data pelanggan, upload bukti, dan dashboard WordPress belum dipindahkan.
Lihat [catatan migrasi](docs/migration.md) dan [manifest ekspor](docs/migration-manifest.json).

## Persiapan

Gunakan Node.js 22 atau lebih baru yang masih didukung Cloudflare, lalu instal
dependensi sesuai lockfile:

```sh
npm ci
```

## Jalankan secara lokal

```sh
npx wrangler dev
```

## Validasi konfigurasi

```sh
npx wrangler deploy --dry-run
```

## Deploy ke Cloudflare

Masuk ke akun Cloudflare yang memiliki izin Workers:

```sh
npx wrangler login
npx wrangler deploy
```

Untuk CI, gunakan `CLOUDFLARE_API_TOKEN` dan `CLOUDFLARE_ACCOUNT_ID` sebagai
environment variable. Jangan simpan kredensial di repository.

Nama Worker adalah `new`, tanggal kompatibilitas `2026-10-30`, dan direktori
aset `./public`. Tidak ada database, autentikasi aplikasi, atau domain khusus
ditambahkan.

## Memperbarui salinan publik

```sh
npm run export:posloker
```

Ekspor hanya membaca halaman publik dan menyimpan cache di `.cache/`.
Gunakan direktori cache baru melalui `POSLOKER_EXPORT_CACHE` untuk mengambil
snapshot yang lebih baru. Periksa perubahan harga dan halaman sebelum deploy.
