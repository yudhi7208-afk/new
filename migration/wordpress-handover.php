<?php
/**
 * Plugin Name: PosLoker Cloudflare Handover
 * Description: Guard pengalihan pesanan satu arah. Tidak aktif sampai diaktifkan operator pada waktu pengalihan.
 * Version: 1.0.0
 * Requires PHP: 7.4
 *
 * Prepared only: do not install or enable as part of preview deployment.
 * Install as a must-use plugin before the approved handover so requests have
 * loaded these guards before the shared write lock is drained.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

final class PosLoker_Cloudflare_Handover {

	const OPTION = 'posloker_cloudflare_handover';
	const TARGET = 'https://new.yudhi7208.workers.dev';
	const PRIORITY = -PHP_INT_MAX;
	private static $locked = false;
	private static $shutdown_registered = false;

	public static function boot() {
		// Register even while disabled. A request already executing must re-check
		// the uncached flag when it first reaches an order write.
		add_action( 'init', array( __CLASS__, 'route' ), self::PRIORITY );
		foreach ( array( 'admin_post_posloker_submit_payment', 'admin_post_nopriv_posloker_submit_payment', 'admin_post_posloker_payment_status' ) as $hook ) {
			add_action( $hook, array( __CLASS__, 'guard_request' ), self::PRIORITY );
		}
		add_filter( 'wp_insert_post_data', array( __CLASS__, 'guard_post_data' ), self::PRIORITY, 4 );
		add_action( 'pre_post_update', array( __CLASS__, 'guard_post_id' ), self::PRIORITY, 2 );
		add_action( 'before_delete_post', array( __CLASS__, 'guard_post_id' ), self::PRIORITY, 2 );
		foreach ( array( 'pre_delete_post', 'pre_trash_post', 'pre_untrash_post' ) as $hook ) {
			add_filter( $hook, array( __CLASS__, 'guard_post_operation' ), self::PRIORITY, 3 );
		}
		foreach ( array( 'add_post_metadata', 'update_post_metadata', 'delete_post_metadata' ) as $hook ) {
			add_filter( $hook, array( __CLASS__, 'guard_metadata' ), self::PRIORITY, 5 );
		}
		foreach ( array( 'update_post_metadata_by_mid', 'delete_post_metadata_by_mid' ) as $hook ) {
			add_filter( $hook, array( __CLASS__, 'guard_metadata_id' ), self::PRIORITY, 4 );
		}
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::add_command( 'posloker handover', array( __CLASS__, 'command' ) );
		}
	}

	private static function lock_name() {
		global $wpdb;
		// Database/site identity must match in web PHP and WP-CLI even when
		// their filesystem paths use different symlinks or mount points.
		$database = defined( 'DB_NAME' ) ? DB_NAME : '';
		return 'posloker_handover_' . substr( hash( 'sha256', $database . '|' . $wpdb->prefix . '|' . $wpdb->options ), 0, 32 );
	}

	private static function acquire_lock() {
		global $wpdb;
		if ( self::$locked ) {
			// A reconnect drops MySQL connection locks. Never trust a PHP flag
			// after the database connection has changed or lost its lock.
			$owned = $wpdb->get_var( $wpdb->prepare( 'SELECT IS_USED_LOCK(%s) = CONNECTION_ID()', self::lock_name() ) );
			if ( '1' === (string) $owned && ! $wpdb->last_error ) { return; }
			self::$locked = false;
		}
		$result = $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', self::lock_name(), 10 ) );
		if ( '1' !== (string) $result || $wpdb->last_error ) {
			self::stop( 503, self::TARGET . '/pembayaran/', 'Pengelolaan pesanan sedang diselaraskan. Kiriman ini belum dapat dilanjutkan. Periksa pesanan sebelum mencoba kembali.' );
		}
		self::$locked = true;
		if ( ! self::$shutdown_registered ) {
			register_shutdown_function( array( __CLASS__, 'release_lock' ) );
			self::$shutdown_registered = true;
		}
	}

	public static function release_lock() {
		global $wpdb;
		if ( self::$locked ) {
			$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', self::lock_name() ) );
			self::$locked = false;
		}
	}

	private static function configuration() {
		global $wpdb;
		// get_option() may return an earlier value from the request or object
		// cache; this read must observe the activation committed by the operator.
		$raw = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s LIMIT 1", self::OPTION ) );
		if ( $wpdb->last_error ) { return 'unavailable'; }
		if ( null === $raw ) { return 'disabled'; }
		if ( ! is_string( $raw ) || strlen( $raw ) > 2048 ) { return 'invalid'; }
		$value = json_decode( $raw, true );
		if ( ! is_array( $value ) && preg_match( '/^a:\d+:/', $raw ) ) {
			$value = @unserialize( $raw, array( 'allowed_classes' => false ) );
		}
		if ( ! is_array( $value ) || array_diff( array_keys( $value ), array( 'enabled', 'target' ) ) || ! isset( $value['enabled'] ) || ! is_bool( $value['enabled'] ) ) { return 'invalid'; }
		if ( false === $value['enabled'] ) { return 'disabled'; }
		return isset( $value['target'] ) && self::TARGET === $value['target'] ? 'enabled' : 'invalid';
	}

	private static function enabled() {
		$state = self::configuration();
		if ( 'invalid' === $state || 'unavailable' === $state ) {
			self::stop( 503, self::TARGET . '/pembayaran/', 'Status pengalihan belum dapat dipastikan. Jangan mengirim atau membayar ulang sebelum menghubungi pengelola.' );
		}
		return 'enabled' === $state;
	}

	private static function headers() {
		nocache_headers();
		header( 'Cache-Control: private, no-store, max-age=0' );
		header( 'Referrer-Policy: no-referrer' );
		header( 'X-Robots-Tag: noindex, nofollow, noarchive' );
		header( 'X-Content-Type-Options: nosniff' );
	}

	private static function stop( $status, $target, $message = '' ) {
		self::headers();
		if ( ! $message ) { $message = 'Formulir atau pengelolaan lama sudah ditutup. Jika sudah transfer, jangan transfer ulang; periksa pesanan dan hubungi pengelola untuk mencocokkan pembayaran.'; }
		wp_die( '<p>' . esc_html( $message ) . '</p><p><a href="' . esc_url( $target ) . '">Buka PosLoker di Cloudflare</a></p>', 'Pengalihan PosLoker', array( 'response' => $status, 'back_link' => false ) );
		exit;
	}

	private static function order_id( $value ) {
		return is_scalar( $value ) && preg_match( '/^[1-9]\d{0,14}$/', (string) $value ) ? (string) $value : '';
	}

	private static function admin_url( $id = '' ) {
		return self::TARGET . '/admin/' . ( $id ? '?order=' . rawurlencode( $id ) : '' );
	}

	private static function checkout_url() {
		$query = array();
		if ( isset( $_GET['city'] ) && is_string( $_GET['city'] ) ) {
			$city = wp_unslash( $_GET['city'] );
			if ( preg_match( "/^[\p{L}\p{N} .'\-]{1,100}$/u", $city ) ) { $query['city'] = $city; }
		}
		if ( isset( $_GET['package'] ) && is_string( $_GET['package'] ) && preg_match( '/^[a-z0-9][a-z0-9_-]{0,79}$/', $_GET['package'] ) ) { $query['package'] = $_GET['package']; }
		return self::TARGET . '/pembayaran/' . ( $query ? '?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 ) : '' );
	}

	private static function redirect( $url ) {
		self::headers();
		// External destination is built only from TARGET and encoded allowlisted
		// fields. Never replay a POST body, upload, nonce, or customer contact.
		wp_redirect( $url, 302, 'PosLoker Cloudflare Handover' );
		exit;
	}

	public static function route() {
		$path = isset( $_SERVER['REQUEST_URI'] ) ? parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH ) : '';
		$path = is_string( $path ) ? rtrim( $path, '/' ) : '';
		$is_checkout = '/pembayaran' === $path;
		$is_receipt = '/konfirmasi-pembayaran' === $path;
		$admin_key = null;
		foreach ( array( 'posloker_manage', 'posloker_proof', 'posloker_material', 'posloker_caption' ) as $name ) {
			if ( isset( $_GET[ $name ] ) ) { $admin_key = $name; break; }
		}
		if ( ! $is_checkout && ! $is_receipt && null === $admin_key ) { return; }
		$method = isset( $_SERVER['REQUEST_METHOD'] ) ? strtoupper( $_SERVER['REQUEST_METHOD'] ) : 'GET';
		if ( ! in_array( $method, array( 'GET', 'HEAD' ), true ) ) {
			self::acquire_lock();
			if ( self::enabled() ) { self::stop( 409, null !== $admin_key ? self::admin_url() : self::TARGET . '/pembayaran/' ); }
			return;
		}
		if ( ! self::enabled() ) { return; }
		if ( null !== $admin_key ) {
			$id = self::order_id( 'posloker_manage' === $admin_key ? ( isset( $_GET['order'] ) ? $_GET['order'] : '' ) : $_GET[ $admin_key ] );
			self::redirect( self::admin_url( $id ) );
		}
		if ( $is_receipt ) {
			$id = self::order_id( isset( $_GET['order'] ) ? $_GET['order'] : '' );
			$key = isset( $_GET['key'] ) && is_string( $_GET['key'] ) ? wp_unslash( $_GET['key'] ) : '';
			$url = self::TARGET . '/konfirmasi-pembayaran/' . ( $id ? '?order=' . rawurlencode( $id ) : '' );
			if ( $id && strlen( $key ) >= 16 && strlen( $key ) <= 256 && ! preg_match( '/[^\x21-\x7e]/', $key ) ) { $url .= '#key=' . rawurlencode( $key ); }
			self::redirect( $url );
		}
		self::redirect( self::checkout_url() );
	}

	private static function guard_write( $id = '' ) {
		self::acquire_lock();
		if ( self::enabled() ) { self::stop( 409, $id ? self::admin_url( $id ) : self::TARGET . '/pembayaran/' ); }
	}

	public static function guard_request() {
		self::guard_write( self::order_id( isset( $_GET['order_id'] ) ? $_GET['order_id'] : '' ) );
	}

	private static function is_order( $id ) { return $id && 'posloker_order' === get_post_type( $id ); }

	public static function guard_post_data( $data, $postarr, $unsanitized = array(), $update = false ) {
		$id = isset( $postarr['ID'] ) ? self::order_id( $postarr['ID'] ) : '';
		$parent = isset( $data['post_parent'] ) ? self::order_id( $data['post_parent'] ) : '';
		if ( 'posloker_order' === ( isset( $data['post_type'] ) ? $data['post_type'] : '' ) || self::is_order( $id ) || self::is_order( $parent ) ) { self::guard_write( $id ); }
		return $data;
	}

	public static function guard_post_id( $id, $unused = null ) {
		if ( self::is_order( $id ) ) { self::guard_write( self::order_id( $id ) ); }
	}

	public static function guard_post_operation( $value, $post, $unused = null ) {
		if ( is_object( $post ) && 'posloker_order' === $post->post_type ) { self::guard_write( self::order_id( $post->ID ) ); }
		return $value;
	}

	public static function guard_metadata( $check, $id, $key, $value, $delete_all = false ) {
		global $wpdb;
		if ( $delete_all ) {
			// A global metadata deletion has no object ID. Take the shared lock
			// before resolving its scope so new order metadata cannot appear
			// between the scope check and the eventual WordPress DELETE.
			self::acquire_lock();
			$affected = $wpdb->get_var( $wpdb->prepare( "SELECT pm.post_id FROM {$wpdb->postmeta} pm INNER JOIN {$wpdb->posts} p ON p.ID=pm.post_id WHERE p.post_type=%s AND pm.meta_key=%s LIMIT 1", 'posloker_order', $key ) );
			if ( $wpdb->last_error ) { self::stop( 503, self::admin_url(), 'Cakupan perubahan belum dapat dipastikan. Hubungi pengelola.' ); }
			if ( $affected ) { self::guard_write( self::order_id( $affected ) ); }
		} elseif ( self::is_order( $id ) ) { self::guard_write( self::order_id( $id ) ); }
		return $check;
	}

	public static function guard_metadata_id( $check, $meta_id, $value = null, $key = null ) {
		global $wpdb;
		$id = $wpdb->get_var( $wpdb->prepare( "SELECT post_id FROM {$wpdb->postmeta} WHERE meta_id=%d LIMIT 1", $meta_id ) );
		if ( $wpdb->last_error ) { self::stop( 503, self::admin_url(), 'Cakupan perubahan belum dapat dipastikan. Hubungi pengelola.' ); }
		if ( self::is_order( $id ) ) { self::guard_write( self::order_id( $id ) ); }
		return $check;
	}

	/** Manage the prepared handover. No command runs automatically. */
	public static function command( $args, $assoc ) {
		$operation = isset( $args[0] ) ? $args[0] : 'status';
		if ( count( $args ) > 1 || ! in_array( $operation, array( 'status', 'enable', 'disable' ), true ) || array_diff( array_keys( $assoc ), array( 'yes', 'verify-lock' ) ) ) { WP_CLI::error( 'Gunakan: wp posloker handover status [--verify-lock] | enable --yes | disable --yes' ); }
		if ( 'status' === $operation ) {
			if ( isset( $assoc['verify-lock'] ) ) { self::acquire_lock(); }
			$state = self::configuration();
			self::release_lock();
			if ( ! in_array( $state, array( 'disabled', 'enabled' ), true ) ) { WP_CLI::error( 'Status pengalihan tidak valid atau database tidak dapat dibaca.' ); }
			WP_CLI::log( 'PosLoker handover: ' . $state . ( isset( $assoc['verify-lock'] ) ? '; write-lock verified' : '' ) );
			return;
		}
		WP_CLI::confirm( 'enable' === $operation ? 'Aktifkan hanya setelah checkout Cloudflare siap menerima pesanan nyata. Ini menutup penulisan pesanan WordPress. Lanjutkan?' : 'Nonaktifkan hanya setelah Cloudflare tidak lagi menerima pesanan dan rekonsiliasi balik selesai. Ini membuka penulisan WordPress kembali. Lanjutkan?', $assoc );
		try {
			self::acquire_lock();
			// Read inside the shared lock, then commit and verify uncached state.
			if ( in_array( self::configuration(), array( 'invalid', 'unavailable' ), true ) ) { WP_CLI::error( 'Status pengalihan sebelumnya tidak dapat dipastikan.' ); }
			$value = wp_json_encode( array( 'enabled' => 'enable' === $operation, 'target' => self::TARGET ) );
			wp_cache_delete( self::OPTION, 'options' );
			wp_cache_delete( 'alloptions', 'options' );
			update_option( self::OPTION, $value, false );
			$expected = 'enable' === $operation ? 'enabled' : 'disabled';
			if ( $expected !== self::configuration() ) { WP_CLI::error( 'Penyimpanan pengalihan belum dapat diverifikasi.' ); }
		} finally { self::release_lock(); }
		WP_CLI::success( 'PosLoker handover: ' . $expected . '. Periksa hasil dan lanjutkan rekonsiliasi sesuai runbook.' );
	}
}

PosLoker_Cloudflare_Handover::boot();
