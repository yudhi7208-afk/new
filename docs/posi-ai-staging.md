# Aktivasi Workers AI POSI — 3 November 2026

Workers AI nyata diaktifkan dan diuji **hanya** pada Worker
`new-posi-staging`, sesuai permintaan pemilik. Website produksi dan branch
`main` tidak diubah. Pratinjau:
https://new-posi-staging.yudhi7208.workers.dev/

## Implementasi

- Binding `AI` memakai model allowlist `@cf/meta/llama-3.2-3b-instruct`.
  Model contoh lama pada fondasi telah dihentikan; model pengganti diperiksa
  pada [dokumentasi model resmi](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/).
- Model menerima pesan sebagai data tidak tepercaya dan menghasilkan satu
  intent JSON Schema. Parser menerima objek/string JSON yang tepat dan
  menolak properti tambahan, output bebas, serta tool call. Model tidak
  mempunyai tool transaksi atau akses database/order/file pelanggan.
- Pertanyaan yang sudah cocok FAQ tidak memanggil AI. Untuk pertanyaan
  bebas, AI mengenali maksud; jawaban bisnis tetap dipilih dari panduan
  terkontrol. Harga tetap tunduk snapshot dan total checkout server.
- Permintaan bantuan yang salah diklasifikasikan sebagai draft tidak
  menghasilkan draft yang bisa diisikan. POSI meminta rincian pekerjaan
  dahulu. Draft eksplisit tetap melalui tinjauan dan persetujuan pengguna.
- Permintaan bicara dengan petugas dapat menampilkan tautan kontak resmi
  melalui respons semantik, tanpa harus mengetik kata “admin”. POSI tidak
  membuka WhatsApp atau mengirim pesan sendiri.
- Widget menampilkan “Asisten AI PosLoker” dan halaman sandbox memberi
  indikator AI aktif. Kedua flag di file konfigurasi tetap default OFF;
  staging yang diuji memakai override ON.

## Batas pemakaian dan privasi

Namespace Durable Object SQLite baru, khusus POSI, mengatur reservasi global
sebelum inference. Penyimpanan hanya satu record `{day, used}`. Tidak ada
isi percakapan, IP, identitas, atau data transaksi yang disimpan di counter.
Tidak ada binding D1/R2/service produksi yang ditambahkan.

`POSI_AI_DAILY_LIMIT=100`: maksimum100 percobaan/hari UTC untuk seluruh
lokasi, reset07.00 WIB. Nilai konfigurasi di atas100 dibatasi100; nilai invalid
menolak AI. Reservasi atomik tetap terpakai jika model gagal; tidak ada
retry/refund otomatis. Counter gagal/timeout/habis menahan AI dan memberi
fallback; checkout tidak menunggu POSI.

Batas lain: pesan1.200 karakter, JSON4KiB, output96 token dengan batas kode
32–192, request20/menit per hash IP, inference10/menit per lokasi, timeout
budget1 detik/model8 detik/widget10 detik, circuit breaker setelah3 kegagalan.
Counter adalah batas pemanggilan POSI, bukan batas tagihan seluruh akun.
[Harga Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/)
dan [penyimpanan Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
ditinjau sebelum aktivasi. Tidak ada upgrade paket atau pembelian kredit.

## Bukti pengujian

`npm test --prefix posi`: **63 tes lulus, 0 gagal**. Termasuk:

- Model JSON object/string, properti tambahan/tool yang ditolak, timeout,
  quota, error, circuit breaker dan batas token.
- Budget tidak ada/gagal/habis mencegah inference; FAQ tetap berfungsi.
- 101 reservasi bersamaan menghasilkan tepat100 izin, UTC rollover, restart,
  data rusak dan tanggal/limit dari request yang tidak dipercaya.
- Runtime SQLite Durable Object Miniflare nyata membatasi8 request bersamaan
  menjadi3 izin pada konfigurasi cap3.
- Checkout asli dengan D1/R2 dalam memori tetap menyimpan6 order dan12 file
  dummy pada enam skenario POSI. Validator, harga, adText dan caption utuh.
- Byte seluruh berkas produksi tetap identik dengan dasar `d8ed838`.

Build/dry-run berhasil. Bundle terakhir47,16KiB / gzip10,33KiB, startup2ms.

Skrip `node posi/scripts/test-ai-staging.mjs` menjalankan maksimum3 inference
nyata pada origin staging tetap. Setiap pertanyaan di bawah terlebih dahulu
dipastikan tidak cocok regex FAQ. API membuktikan `source:ai`, bukan hanya
flag aktif:

| Pertanyaan sintetis | Hasil model nyata | Waktu satu sampel |
| --- | --- | --- |
| Saya cuma memiliki tulisan, gambarnya belum ada. Bisa dibantu? | Panduan desain gratis di Teks Materi, bukan Caption; tanpa draft otomatis |429ms |
| Kenapa aku perlu memakai jasa kalian untuk mencari tenaga kerja? | Manfaat layanan, tanpa jaminan pelamar/hasil |356ms |
| Boleh ngobrol dengan petugas sungguhan? | Bantuan admin dengan kontak resmi |276ms |

Skrip juga memeriksa pembayaran melalui aturan, penolakan perubahan status
pembayaran, dan origin produksi403. Ini sampel pengujian, bukan jaminan latensi
atau ketepatan seluruh pertanyaan. Percobaan pertama menemukan pertanyaan
gambar dianggap draft; prompt diperbaiki, guard server ditambahkan, lalu
pengujian makna diperketat dan diulang sampai hasil di atas lulus.

Browser staging diuji dengan pertanyaan bebas bantuan petugas dan manfaat.
Kontak admin muncul, jawaban manfaat tampil, sedangkan Teks Materi dan
Caption tetap kosong. Tidak ada WhatsApp/order produksi yang dikirim.

## Versi dan rollback

Versi AI aktif sehat: `f471a30e-39cf-457d-8db8-a65458ebbdeb`.
Versi OFF aman yang kompatibel namespace budget:
`18ea9e1a-dfdc-49c6-ad2e-bdbbc9756c4d`.

Keduanya mempunyai class `PosiAiBudget`. Rollback ke versi OFF benar-benar
dijalankan dengan konfigurasi POSI: config `enabled:false` dan chat503.
Sesudah itu rollback ke versi AI aktif sehat berhasil. Tidak ada perubahan
namespace/migrasi order atau penghapusan counter pada proses tersebut.
Jangan memakai versi sebelum penambahan class budget sebagai target rollback.

```powershell
npx wrangler rollback 18ea9e1a-dfdc-49c6-ad2e-bdbbc9756c4d --config posi/wrangler.jsonc --message "Nonaktifkan POSI staging" --yes
```

Semua deployment manual memakai `posi/wrangler.jsonc`. Tidak menjalankan
deploy Worker `new`, mengubah DNS/nameserver, atau push `main`.

## Batas tahap ini

Aktivasi model ini menyediakan pemahaman intent dengan jawaban terkontrol;
belum merupakan percakapan generatif bebas atau asisten dengan memori lintas
pesan. Panel admin POSI, sinkronisasi katalog operasional, aset3D final dan
uji perangkat fisik masih mengikuti gerbang rilis pada `posi/README.md`.
Integrasi produksi, termasuk pemasangan flag OFF, tetap memerlukan
persetujuan pemilik yang baru dan eksplisit.
