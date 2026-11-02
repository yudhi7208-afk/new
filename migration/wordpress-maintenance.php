<?php
/**
 * Plugin Name: PosLoker Scheduled Maintenance
 * Description: Maintenance terjadwal PosLoker pada 2 November 2026, 07.00–08.00 WIB. Tidak mengubah data atau konfigurasi.
 * Version: 1.0.0
 * Author: PosLoker
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

final class PosLoker_Scheduled_Maintenance_20261102 {

	const START_UTC = 1793577600;
	const END_UTC   = 1793581200;

	public static function active_at( $timestamp ) {
		return $timestamp >= self::START_UTC && $timestamp < self::END_UTC;
	}

	public static function target_host( $host ) {
		return 1 === preg_match( '/\A(?:www\.)?posloker\.my\.id(?::[0-9]{1,5})?\z/iD', (string) $host );
	}

	public static function must_block( $now, $host, $script, $admin, $owner, $cli, $cron ) {
		if ( $cli || $cron || ! self::target_host( $host ) || ! self::active_at( $now ) ) {
			return false;
		}
		$script = basename( str_replace( '\\', '/', (string) $script ) );
		if ( 'wp-login.php' === $script ) { return false; }
		// All admin-post handlers, including authenticated payment submissions, stay closed.
		if ( 'admin-post.php' === $script ) { return true; }
		// Keep only the authenticated owner's WordPress management and exports available.
		if ( $admin && $owner ) { return false; }
		return true;
	}

	public static function render() {
		$now = time();
		if ( ! self::must_block(
			$now,
			isset( $_SERVER['HTTP_HOST'] ) ? $_SERVER['HTTP_HOST'] : '',
			isset( $_SERVER['SCRIPT_NAME'] ) ? $_SERVER['SCRIPT_NAME'] : '',
			is_admin(),
			current_user_can( 'manage_options' ),
			defined( 'WP_CLI' ) && WP_CLI,
			defined( 'DOING_CRON' ) && DOING_CRON
		) ) { return; }

		if ( ! defined( 'DONOTCACHEPAGE' ) ) { define( 'DONOTCACHEPAGE', true ); }
		status_header( 503 );
		nocache_headers();
		header( 'Content-Type: text/html; charset=UTF-8' );
		header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0', true );
		header( 'Retry-After: ' . max( 1, self::END_UTC - $now ), true );
		header( 'X-Robots-Tag: noindex, nofollow, noarchive', true );
		header( 'X-Content-Type-Options: nosniff', true );
		header( 'Referrer-Policy: no-referrer', true );
		if ( 'HEAD' === ( isset( $_SERVER['REQUEST_METHOD'] ) ? $_SERVER['REQUEST_METHOD'] : '' ) ) { exit; }
		?>
<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Maintenance Terjadwal — PosLoker</title>
<style>
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#132544;background:#f4f7fb;font-synthesis:none}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(100%,620px);background:#fff;border:1px solid #dce5f1;border-radius:24px;padding:clamp(24px,6vw,48px);box-shadow:0 18px 55px #18304b0d}.brand{font-weight:800;font-size:23px;letter-spacing:-.6px;color:#1455bb}.pill{display:inline-block;margin:26px 0 8px;padding:7px 12px;border-radius:30px;color:#7a4c00;background:#fff2cf;font-size:13px;font-weight:700}h1{font-size:clamp(27px,6vw,38px);line-height:1.2;letter-spacing:-1px;margin:12px 0 18px}p{line-height:1.7;color:#53647c;margin:12px 0}.schedule{margin:24px 0;padding:18px;border-radius:14px;background:#eff5ff;color:#163e7b;font-weight:650}.note{font-size:14px;border-top:1px solid #e4eaf1;padding-top:20px;margin-top:24px}
</style>
</head>
<body><main class="card"><div class="brand">PosLoker</div><div class="pill">Maintenance terjadwal</div><h1>Kami sedang menyiapkan layanan yang lebih baik.</h1><p>Website sementara tidak menerima pesanan selama pemeliharaan sistem.</p><div class="schedule">Senin, 2 November 2026<br>07.00–08.00 WIB</div><p>Silakan kembali setelah pukul 08.00 WIB. Terima kasih atas kesabarannya.</p><p class="note">Sudah melakukan transfer? Jangan melakukan transfer ulang. Simpan bukti pembayaran dan nomor pesanan Anda untuk pemeriksaan setelah layanan tersedia kembali.</p></main></body>
</html>
		<?php
		exit;
	}
}

add_action( 'init', array( 'PosLoker_Scheduled_Maintenance_20261102', 'render' ), -9999 );
