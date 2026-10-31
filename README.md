# Website Project

Repository untuk pengembangan website menggunakan OpenAI Codex, GitHub, dan Cloudflare Workers.

Website percobaan responsif menggunakan Cloudflare Workers Static Assets. File
`public/index.html` disajikan langsung tanpa build atau skrip Worker tambahan.

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
aset `./public`. Proyek ini tidak menggunakan database, autentikasi pengguna,
atau domain khusus.
