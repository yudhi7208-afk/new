<?php
/**
 * Plugin Name: PosLoker Cloudflare Handover — Owner Tools
 * Description: Guard pesanan dan kontrol pengalihan khusus administrator. Aktivasi plugin tidak mengaktifkan pengalihan.
 * Version: 1.1.0
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }
if ( ! class_exists( 'PosLoker_Cloudflare_Handover', false ) ) {
	$posloker_handover_core = __DIR__ . '/includes/wordpress-handover.php';
	if ( ! is_file( $posloker_handover_core ) ) { $posloker_handover_core = dirname( __DIR__ ) . '/wordpress-handover.php'; }
	require_once $posloker_handover_core;
	unset( $posloker_handover_core );
}

final class PosLoker_Cloudflare_Handover_Admin {
	const PAGE = 'posloker-cloudflare-handover';
	const ACTION = 'posloker_cloudflare_handover_control';
	const TTL = 600;

	public static function boot() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		// No nopriv action, REST endpoint, activation mutation, or public control.
		add_action( 'admin_post_' . self::ACTION, array( __CLASS__, 'submit' ) );
	}

	public static function menu() {
		add_management_page( 'PosLoker Cloudflare Handover', 'PosLoker Handover', 'manage_options', self::PAGE, array( __CLASS__, 'page' ) );
	}

	private static function authorize() {
		if ( ! current_user_can( 'manage_options' ) ) { wp_die( 'Hanya administrator yang dapat mengelola pengalihan.', 'Akses ditolak', array( 'response' => 403 ) ); }
		if ( ! method_exists( 'PosLoker_Cloudflare_Handover', 'operate' ) ) { wp_die( 'Versi inti handover tidak cocok. Jangan aktifkan pengalihan; perbarui paket secara utuh.', 'Konfigurasi belum siap', array( 'response' => 503 ) ); }
	}

	private static function preflight_key() { return 'posloker_handover_pf_' . get_current_user_id(); }
	private static function verified() {
		$stamp = get_transient( self::preflight_key() );
		return is_int( $stamp ) && $stamp >= time() - self::TTL && $stamp <= time();
	}
	private static function origin( $url, $is_origin = false ) {
		if ( ! is_string( $url ) || '' === $url ) { return false; }
		$parts = wp_parse_url( $url );
		if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) || isset( $parts['user'] ) || isset( $parts['pass'] ) || ! in_array( strtolower( $parts['scheme'] ), array( 'http', 'https' ), true ) ) { return false; }
		if ( $is_origin && ( isset( $parts['query'] ) || isset( $parts['fragment'] ) || ( isset( $parts['path'] ) && '' !== $parts['path'] && '/' !== $parts['path'] ) ) ) { return false; }
		$scheme = strtolower( $parts['scheme'] );
		return $scheme . '://' . strtolower( $parts['host'] ) . ':' . ( isset( $parts['port'] ) ? (int) $parts['port'] : ( 'https' === $scheme ? 443 : 80 ) );
	}
	private static function same_origin() {
		$expected = self::origin( admin_url( 'admin-post.php' ) );
		if ( ! $expected ) { return false; }
		if ( isset( $_SERVER['HTTP_SEC_FETCH_SITE'] ) && 'same-origin' !== $_SERVER['HTTP_SEC_FETCH_SITE'] ) { return false; }
		if ( isset( $_SERVER['HTTP_ORIGIN'] ) ) { return $expected === self::origin( $_SERVER['HTTP_ORIGIN'], true ); }
		return isset( $_SERVER['HTTP_REFERER'] ) && $expected === self::origin( $_SERVER['HTTP_REFERER'] );
	}

	public static function submit() {
		self::authorize();
		nocache_headers();
		if ( ! isset( $_SERVER['REQUEST_METHOD'] ) || 'POST' !== strtoupper( $_SERVER['REQUEST_METHOD'] ) || ! self::same_origin() ) { wp_die( 'Gunakan formulir pada halaman Tools dari situs ini.', 'Permintaan ditolak', array( 'response' => 403 ) ); }
		$operation = isset( $_POST['operation'] ) && is_string( $_POST['operation'] ) ? $_POST['operation'] : '';
		if ( ! in_array( $operation, array( 'verify', 'enable', 'disable' ), true ) ) { wp_die( 'Operasi tidak valid.', 'Permintaan ditolak', array( 'response' => 400 ) ); }
		check_admin_referer( self::ACTION . '_' . $operation );
		if ( 'verify' !== $operation && ! self::verified() ) { wp_die( 'Jalankan Verifikasi lock terlebih dahulu; hasil berlaku sepuluh menit.', 'Preflight diperlukan', array( 'response' => 409 ) ); }
		if ( 'enable' === $operation && ( ! isset( $_POST['cloudflare_ready'] ) || '1' !== $_POST['cloudflare_ready'] ) ) { wp_die( 'Pastikan checkout Cloudflare menerima pesanan nyata dan rekonsiliasi akhir siap.', 'Konfirmasi diperlukan', array( 'response' => 409 ) ); }
		if ( 'disable' === $operation && ( ! isset( $_POST['rollback_reconciled'] ) || '1' !== $_POST['rollback_reconciled'] ) ) { wp_die( 'Hentikan penulisan Cloudflare dan selesaikan rekonsiliasi balik sebelum membuka WordPress.', 'Konfirmasi diperlukan', array( 'response' => 409 ) ); }
		// One use, including failed operations. An old successful preflight must
		// never remain available after a newer failed lock/configuration check.
		delete_transient( self::preflight_key() );
		try {
			$state = PosLoker_Cloudflare_Handover::operate( 'verify' === $operation ? 'status' : $operation, true );
			if ( 'verify' === $operation ) {
				set_transient( self::preflight_key(), time(), self::TTL );
				if ( ! self::verified() ) { throw new UnexpectedValueException( 'Hasil preflight belum dapat disimpan. Ulangi verifikasi.' ); }
			}
		} catch ( UnexpectedValueException $error ) { wp_die( esc_html( $error->getMessage() ), 'Pengalihan belum dapat diverifikasi', array( 'response' => 503 ) ); }
		wp_safe_redirect( admin_url( 'tools.php?page=' . self::PAGE . '&result=' . rawurlencode( $operation . '-' . $state ) ), 303 );
		exit;
	}

	private static function form( $operation, $label, $confirmation = '' ) {
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '"><input type="hidden" name="action" value="' . esc_attr( self::ACTION ) . '"><input type="hidden" name="operation" value="' . esc_attr( $operation ) . '">';
		wp_nonce_field( self::ACTION . '_' . $operation );
		if ( $confirmation ) { echo '<p><label><input type="checkbox" required name="' . esc_attr( 'enable' === $operation ? 'cloudflare_ready' : 'rollback_reconciled' ) . '" value="1"> ' . esc_html( $confirmation ) . '</label></p>'; }
		submit_button( $label, 'verify' === $operation ? 'secondary' : 'primary' );
		echo '</form>';
	}

	public static function page() {
		self::authorize();
		nocache_headers();
		try { $state = PosLoker_Cloudflare_Handover::operate( 'status', false ); }
		catch ( UnexpectedValueException $error ) { wp_die( esc_html( $error->getMessage() ), 'Konfigurasi belum siap', array( 'response' => 503 ) ); }
		echo '<div class="wrap"><h1>PosLoker Cloudflare Handover</h1><p><strong>Status tersimpan: ' . esc_html( $state ) . '</strong></p><p>Tujuan tetap: <code>' . esc_html( PosLoker_Cloudflare_Handover::TARGET ) . '</code>. Aktivasi plugin saja tidak mengubah status ini.</p>';
		echo '<p>Verifikasi lock harus lulus sebelum mengaktifkan. Pengaktifan menunggu lock penulisan pesanan yang memuat guard, membaca flag langsung dari database, lalu menyimpan dan memverifikasi flag di dalam lock yang sama.</p><p>Permintaan PHP yang dimulai sebelum plugin aktif tidak memuat guard. Periksa proses dan batas waktu hosting, kemudian lakukan backup, delta, dan rekonsiliasi akhir; timer saja bukan bukti seluruh penulisan telah berhenti. SQL langsung di luar WordPress tidak tercakup.</p>';
		self::form( 'verify', 'Verifikasi lock (tanpa mengubah flag)' );
		if ( self::verified() ) {
			echo '<p><strong>Lock dan pembacaan flag terverifikasi; berlaku sepuluh menit untuk pengguna ini.</strong></p>';
			if ( 'disabled' === $state ) { self::form( 'enable', 'Aktifkan handover ke Cloudflare', 'Checkout Cloudflare siap menerima pesanan nyata; guard sumber telah dimuat dan pemeriksaan akhir serta delta akan dilakukan sebelum DNS dipindah.' ); }
			else { self::form( 'disable', 'Nonaktifkan handover (rollback)', 'Cloudflare sudah berhenti menerima penulisan dan rekonsiliasi balik selesai; WordPress boleh menerima penulisan kembali.' ); }
		}
		echo '<p>Setelah enabled, formulir pesanan lama ditolak dan tautan pembayaran lama menuju Cloudflare. Halaman umum dan baca/ekspor administrator tetap tersedia, kecuali dibatasi plugin maintenance terpisah. Pertahankan workers.dev selama propagasi dan sesi pelanggan masih memerlukannya.</p></div>';
	}
}

PosLoker_Cloudflare_Handover_Admin::boot();
