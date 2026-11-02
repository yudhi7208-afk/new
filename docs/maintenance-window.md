# Maintenance sumber pada 2 November 2026

Pengguna meminta maintenance website asli pukul 07.00–08.00 WIB dan
mengizinkan penggantian nameserver selama periode itu setelah data/DNS siap.
Kode yang dipasang tersimpan pada `migration/wordpress-maintenance.php`.
Pada WordPress sumber, kode dipasang sebagai plugin standar
`posloker-scheduled-maintenance/posloker-scheduled-maintenance.php`.

Rentang UTC tetap adalah 2026-11-02T00:00:00Z sampai sebelum
2026-11-02T01:00:00Z. Pemeriksaan memakai timestamp UTC sehingga tidak
bergantung pada zona waktu WordPress. Plugin otomatis berhenti membatasi
akses pukul 08.00 WIB; tidak memerlukan cron atau proses laptop yang aktif.
Jadwal ini khusus tanggal tersebut, bukan maintenance harian.

Pada pukul 08.00 WIB halaman sumber telah dibaca kembali tanpa maintenance.
Operator kemudian menonaktifkan plugin melalui WP-CLI dan membaca kembali
status `inactive`; guard handover tetap `enabled; write-lock verified`.
Nameserver dan binding tetap Cloudflare. Tidak ada fallback DNS sementara
atau pergantian nameserver kedua.

Dalam jendela itu, domain sumber PosLoker memberikan 503, Retry-After dan
halaman maintenance responsif. Frontend, REST, admin-post termasuk pesanan
pemilik, serta AJAX publik ditutup. Login dan pengelolaan/ekspor admin
berkemampuan manage_options tetap tersedia. Plugin tidak mengubah pesanan,
database, opsi bisnis, kredensial atau situs lain. PosLoker Cache sumber
dinonaktifkan dan cache dibersihkan agar tidak melewati maintenance/guard.

Maintenance sementara ini terpisah dari MU-plugin handover. Guard handover
tetap enabled setelah pukul 08.00, sehingga berakhirnya maintenance tidak
membuka penerimaan pesanan WordPress lagi. Cloudflare berada dalam mode
live. Ikuti [runbook handover](wordpress-handover.md) bila perlu pemulihan;
jangan membuka dua sistem penulis.

PHP lint dan 29 pengujian batas tanggal/waktu, host, metode dan akses admin
lulus melalui `scripts/test-wordpress-maintenance.php`. Tampilan publik
sumber dan checkout telah dibaca kembali sebagai 503 saat maintenance aktif.
