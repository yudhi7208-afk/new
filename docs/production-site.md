# Domain produksi PosLoker

Domain utama aplikasi adalah `https://posloker.my.id`. Routing hostname
Cloudflare/TLS dan perubahan nameserver tetap langkah operator tersendiri;
kode ini tidak membuat zona, mengubah DNS, atau mengaktifkan transaksi nyata.

`www.posloker.my.id` harus terhubung ke Worker yang sama. Permintaan GET/HEAD
diarahkan 301 ke apex dengan path/query dipertahankan. Header Location tidak
menetapkan fragment baru sehingga browser mempertahankan fragment kunci
ringkasan yang sudah ada. POST/PUT dan mutasi lain ditolak 405 tanpa redirect;
jangan meneruskan unggahan atau token dari origin lama ke origin baru.
`run_worker_first=true` memastikan kebijakan ini berlaku juga pada aset,
robots, dan sitemap. Rute Custom Domain apex dan www harus diverifikasi
operator sebelum nameserver dipindahkan. Kedua binding dan endpoint
`workers.dev` dicatat eksplisit di `wrangler.jsonc`. Delegasi zona dan
sertifikat HTTPS tetap diperiksa sesudah zona diaktifkan; DNS zona pending
belum membuktikan domain dapat melayani pelanggan.

Publikasi mengikuti nilai `commerce_settings.mode` yang sama dengan checkout:

| Origin dan mode | Halaman publik | robots dan sitemap |
| --- | --- | --- |
| HTTPS apex, `live` | `index, follow`; banner simulasi dihapus | robots mengizinkan publik, membatasi jalur privat, serta menunjuk sitemap 51 halaman |
| HTTPS apex, `preview` | `noindex, nofollow`; banner simulasi tampil | seluruh crawling ditolak; sitemap 404 |
| workers.dev, mode apa pun | selalu `noindex, nofollow`; banner simulasi hanya saat `preview` | seluruh crawling ditolak; sitemap 404 |

Canonical, Open Graph URL dan data terstruktur tetap memakai apex. Admin,
API, checkout, ringkasan dan berkas privat selalu tanpa indeks/cache privat.
Pengaturan mode yang tidak valid atau tidak tersedia menghasilkan 503
tanpa membuka pengindeksan. Aset statis tetap memakai `_headers` noindex.
Endpoint Workers tetap menerima checkout nyata ketika mode `live` agar
tautan handover dan ringkasan lama di hostname itu tidak putus. Cookie
checkout/admin tetap khusus hostname; pemilik masuk kembali di domain resmi.

Jalankan pengujian mode/domain pada runtime lokal terisolasi:

```powershell
npm run test:production
```

Sesudah deploy dan routing aktif, smoke baca-anonim hanya menargetkan
origin yang sudah ditetapkan. Mode live membuat sesi checkout biasa,
tanpa penawaran, pesanan, unggahan, perubahan pengaturan atau pesan:

```powershell
node scripts/test-readiness-http.mjs --origin https://posloker.my.id --expect-mode live
node scripts/test-readiness-http.mjs --origin https://new.yudhi7208.workers.dev --expect-mode live
```

Uji pula www, HTTPS, halaman publik, ringkasan privat dan masuk pemilik
melalui browser pada domain sebenarnya. Pengujian lokal tidak membuktikan
sertifikat, delegasi DNS, propagasi atau kesiapan kotak email.
