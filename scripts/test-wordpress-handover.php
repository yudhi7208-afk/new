<?php
// Real PHP execution with an isolated WordPress/wpdb test double. No source
// hosting, customer database, filesystem uploads, credentials, or DNS is used.
if ( PHP_SAPI !== 'cli' ) { exit( 1 ); }
define( 'ABSPATH', __DIR__ . '/synthetic-wordpress/' );
define( 'DB_NAME', 'synthetic_handover_database' );
define( 'WP_CLI', true );

class Handover_Die extends RuntimeException {
	public $status;
	public function __construct( $message, $status ) { parent::__construct( $message ); $this->status = $status; }
}
class Handover_Redirect extends RuntimeException {
	public $url;
	public $status;
	public function __construct( $url, $status ) { parent::__construct( 'redirect' ); $this->url = $url; $this->status = $status; }
}
class Handover_CLI_Error extends RuntimeException {}
class Handover_DB {
	public $prefix = 'synthetic_';
	public $options = 'synthetic_options';
	public $posts = 'synthetic_posts';
	public $postmeta = 'synthetic_postmeta';
	public $last_error = '';
	public $option = null;
	public $option_error = false;
	public $lock_available = true;
	public $held = false;
	public $queries = array();
	public $types = array( 7 => 'posloker_order', 8 => 'post', 9 => 'page' );
	public $meta_ids = array( 101 => 7, 102 => 8 );
	public $updates = 0;
	public $fail_update = false;
	public function prepare( $sql, ...$args ) { return array( $sql, $args ); }
	public function get_var( $query ) {
		list( $sql, $args ) = $query;
		$this->queries[] = $query; $this->last_error = '';
		if ( 0 === strpos( $sql, 'SELECT GET_LOCK' ) ) { if ( ! $this->lock_available ) { return '0'; } $this->held = true; return '1'; }
		if ( 0 === strpos( $sql, 'SELECT RELEASE_LOCK' ) ) { $this->held = false; return '1'; }
		if ( 0 === strpos( $sql, 'SELECT IS_USED_LOCK' ) ) { return $this->held ? '1' : '0'; }
		if ( 0 === strpos( $sql, 'SELECT option_value' ) ) { if ( $this->option_error ) { $this->last_error = 'synthetic database failure'; return null; } return $this->option; }
		if ( 0 === strpos( $sql, 'SELECT pm.post_id' ) ) { return 'shared_order_key' === $args[1] ? 7 : null; }
		if ( 0 === strpos( $sql, 'SELECT post_id' ) ) { return isset( $this->meta_ids[ $args[0] ] ) ? $this->meta_ids[ $args[0] ] : null; }
		throw new RuntimeException( 'Unexpected synthetic SQL shape.' );
	}
}
class WP_CLI {
	public static $command;
	public static $messages = array();
	public static $confirmations = 0;
	public static function add_command( $name, $callback ) { self::$command = array( $name, $callback ); }
	public static function confirm( $message, $args ) { self::$confirmations++; if ( empty( $args['yes'] ) ) { throw new Handover_CLI_Error( 'Confirmation required.' ); } }
	public static function error( $message ) { throw new Handover_CLI_Error( $message ); }
	public static function log( $message ) { self::$messages[] = $message; }
	public static function success( $message ) { self::$messages[] = $message; }
}

$wpdb = new Handover_DB();
$hooks = array();
$nocache_count = 0;
function add_filter( $name, $callback, $priority = 10, $accepted = 1 ) { global $hooks; $hooks[ $name ][] = array( $priority, $callback, $accepted ); }
function add_action( $name, $callback, $priority = 10, $accepted = 1 ) { add_filter( $name, $callback, $priority, $accepted ); }
function do_action( $name, ...$args ) {
	global $hooks;
	$items = isset( $hooks[ $name ] ) ? $hooks[ $name ] : array();
	usort( $items, function( $a, $b ) { return $a[0] <=> $b[0]; } );
	foreach ( $items as $item ) { call_user_func_array( $item[1], array_slice( $args, 0, $item[2] ) ); }
}
function apply_filters( $name, $value, ...$args ) {
	global $hooks;
	$items = isset( $hooks[ $name ] ) ? $hooks[ $name ] : array();
	usort( $items, function( $a, $b ) { return $a[0] <=> $b[0]; } );
	foreach ( $items as $item ) { $value = call_user_func_array( $item[1], array_slice( array_merge( array( $value ), $args ), 0, $item[2] ) ); }
	return $value;
}
function get_post_type( $id ) { global $wpdb; return isset( $wpdb->types[ $id ] ) ? $wpdb->types[ $id ] : false; }
function nocache_headers() { global $nocache_count; $nocache_count++; }
function wp_die( $message, $title = '', $args = array() ) { throw new Handover_Die( $message, $args['response'] ); }
function wp_redirect( $url, $status = 302, $by = '' ) { throw new Handover_Redirect( $url, $status ); }
function wp_unslash( $value ) { return stripslashes( $value ); }
function esc_html( $value ) { return htmlspecialchars( $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ); }
function esc_url( $value ) { return htmlspecialchars( $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' ); }
function wp_json_encode( $value ) { return json_encode( $value ); }
function wp_cache_delete( $key, $group ) { return true; }
function update_option( $key, $value, $autoload = null ) {
	global $wpdb;
	$wpdb->updates++;
	if ( ! $wpdb->fail_update ) { $wpdb->option = $value; }
	return ! $wpdb->fail_update;
}

require __DIR__ . '/../migration/wordpress-handover.php';

$checks = 0;
function check( $condition, $message ) { global $checks; if ( ! $condition ) { throw new RuntimeException( $message ); } $checks++; }
function reset_case( $enabled = false ) {
	global $wpdb, $nocache_count;
	PosLoker_Cloudflare_Handover::release_lock();
	$wpdb->option = $enabled ? json_encode( array( 'enabled' => true, 'target' => PosLoker_Cloudflare_Handover::TARGET ) ) : null;
	$wpdb->option_error = false; $wpdb->lock_available = true; $wpdb->held = false; $wpdb->queries = array(); $wpdb->updates = 0; $wpdb->fail_update = false;
	$nocache_count = 0; $_GET = array(); $_POST = array(); $_FILES = array();
	$_SERVER['REQUEST_URI'] = '/'; $_SERVER['REQUEST_METHOD'] = 'GET';
}
function blocked( $callback, $expected = 409 ) {
	global $nocache_count;
	try { $callback(); } catch ( Handover_Die $error ) {
		check( $error->status === $expected, 'Unexpected blocked status.' );
		check( $nocache_count > 0, 'Blocked response must disable caching.' );
		check( false === strpos( $error->getMessage(), 'PRIVATE_POST_SENTINEL' ), 'POST data must not be reflected.' );
		return;
	}
	throw new RuntimeException( 'Expected mutation refusal.' );
}
function redirect_result( $expected ) {
	try { do_action( 'init' ); } catch ( Handover_Redirect $response ) {
		check( 302 === $response->status && $expected === $response->url, 'Unexpected fixed-origin redirect.' );
		return;
	}
	throw new RuntimeException( 'Expected a safe GET redirect.' );
}

try {
	check( 'posloker handover' === WP_CLI::$command[0], 'Operator command must be registered.' );
	foreach ( array( 'init', 'admin_post_posloker_submit_payment', 'admin_post_nopriv_posloker_submit_payment', 'admin_post_posloker_payment_status', 'wp_insert_post_data', 'update_post_metadata', 'pre_delete_post' ) as $hook ) {
		check( isset( $hooks[ $hook ] ) && $hooks[ $hook ][0][0] < 0, 'Guard must register before the saved source plugin.' );
	}

	reset_case();
	$_SERVER['REQUEST_URI'] = '/pembayaran/?city=Palembang';
	do_action( 'init' );
	$data = array( 'post_type' => 'posloker_order', 'post_title' => 'Synthetic' );
	check( $data === apply_filters( 'wp_insert_post_data', $data, array() ), 'Disabled plugin must preserve source writes.' );
	check( $wpdb->held, 'Disabled source write must hold the request-wide drain lock.' );
	PosLoker_Cloudflare_Handover::release_lock();
	check( ! $wpdb->held, 'Shutdown release must free the lock.' );

	reset_case( true );
	$_SERVER['REQUEST_URI'] = '/ordinary-page/';
	do_action( 'init' );
	check( count( $wpdb->queries ) === 0, 'Unrelated public pages must not query the handover flag.' );
	check( null === apply_filters( 'update_post_metadata', null, 8, 'ordinary', 'value' ), 'Other-post metadata must remain writable.' );
	check( $data = apply_filters( 'wp_insert_post_data', array( 'post_type' => 'post' ), array( 'ID' => 8 ) ), 'Other posts must remain writable.' );
	check( ! $wpdb->held, 'Other-post writes must not take the order lock.' );

	reset_case( true );
	$_SERVER['REQUEST_URI'] = '/pembayaran/?extra=drop';
	$_GET = array( 'city' => 'Tangerang Selatan', 'package' => 'komplit-plus', 'key' => 'DROP', 'email' => 'PRIVATE_POST_SENTINEL', 'redirect' => 'https://invalid.example' );
	redirect_result( PosLoker_Cloudflare_Handover::TARGET . '/pembayaran/?city=Tangerang%20Selatan&package=komplit-plus' );
	$_GET = array( 'city' => array( 'wrong' ), 'package' => "ig\r\nLocation: bad" );
	redirect_result( PosLoker_Cloudflare_Handover::TARGET . '/pembayaran/' );

	reset_case( true );
	$_SERVER['REQUEST_URI'] = '/konfirmasi-pembayaran/';
	$_SERVER['REQUEST_METHOD'] = 'HEAD';
	$capability = 'Legacy-Key-With-Specials+&=;!';
	$_GET = array( 'order' => '123', 'key' => $capability, 'sent' => '1', 'customer' => 'DROP' );
	redirect_result( PosLoker_Cloudflare_Handover::TARGET . '/konfirmasi-pembayaran/?order=123#key=' . rawurlencode( $capability ) );
	$_GET = array( 'order' => '123', 'key' => "bad\ncapability-value" );
	redirect_result( PosLoker_Cloudflare_Handover::TARGET . '/konfirmasi-pembayaran/?order=123' );

	foreach ( array( 'posloker_manage', 'posloker_proof', 'posloker_material', 'posloker_caption' ) as $parameter ) {
		reset_case( true );
		$_GET = array( $parameter => 'posloker_manage' === $parameter ? '1' : '123', 'order' => '123', 'key' => 'DROP' );
		redirect_result( PosLoker_Cloudflare_Handover::TARGET . '/admin/?order=123' );
	}

	foreach ( array( '/pembayaran/', '/konfirmasi-pembayaran/', '/?posloker_manage=1' ) as $path ) {
		reset_case( true ); $_SERVER['REQUEST_URI'] = $path; $_SERVER['REQUEST_METHOD'] = 'POST'; $_POST = array( 'customer' => 'PRIVATE_POST_SENTINEL' );
		if ( false !== strpos( $path, 'posloker_manage' ) ) { $_GET['posloker_manage'] = '1'; }
		blocked( function() { do_action( 'init' ); } );
	}

	$uploads = 0;
	add_action( 'admin_post_nopriv_posloker_submit_payment', function() use ( &$uploads ) { $uploads++; }, 10 );
	reset_case( true ); $_FILES['payment_proof'] = array( 'tmp_name' => 'PRIVATE_POST_SENTINEL' );
	blocked( function() { do_action( 'admin_post_nopriv_posloker_submit_payment' ); } );
	check( 0 === $uploads, 'Submit refusal must happen before source upload handling.' );
	reset_case(); do_action( 'admin_post_nopriv_posloker_submit_payment' );
	check( 1 === $uploads, 'Disabled source upload handler must still run.' );

	reset_case( true );
	blocked( function() { do_action( 'admin_post_posloker_payment_status' ); } );
	blocked( function() { apply_filters( 'wp_insert_post_data', array( 'post_type' => 'posloker_order' ), array() ); } );
	blocked( function() { apply_filters( 'wp_insert_post_data', array( 'post_type' => 'revision', 'post_parent' => 7 ), array() ); } );
	blocked( function() { do_action( 'pre_post_update', 7, array() ); } );
	foreach ( array( 'pre_delete_post', 'pre_trash_post', 'pre_untrash_post' ) as $hook ) {
		blocked( function() use ( $hook ) { apply_filters( $hook, null, (object) array( 'ID' => 7, 'post_type' => 'posloker_order' ), false ); } );
	}
	blocked( function() { do_action( 'before_delete_post', 7, (object) array( 'ID' => 7 ) ); } );
	foreach ( array( 'add_post_metadata', 'update_post_metadata', 'delete_post_metadata' ) as $hook ) {
		blocked( function() use ( $hook ) { apply_filters( $hook, null, 7, '_posloker_status', 'approved' ); } );
	}
	blocked( function() { apply_filters( 'delete_post_metadata', null, 0, 'shared_order_key', '', true ); } );
	check( null === apply_filters( 'delete_post_metadata', null, 0, 'other_key', '', true ), 'Bulk removal without source-order rows must remain unchanged.' );
	foreach ( array( 'update_post_metadata_by_mid', 'delete_post_metadata_by_mid' ) as $hook ) {
		blocked( function() use ( $hook ) { apply_filters( $hook, null, 101, 'approved', '_posloker_status' ); } );
		check( null === apply_filters( $hook, null, 102, 'value', 'other' ), 'Other-post metadata-by-ID must remain unchanged.' );
	}

	reset_case();
	apply_filters( 'wp_insert_post_data', array( 'post_type' => 'posloker_order' ), array() );
	$wpdb->option = json_encode( array( 'enabled' => true, 'target' => PosLoker_Cloudflare_Handover::TARGET ) );
	blocked( function() { apply_filters( 'update_post_metadata', null, 7, 'fresh_flag', 'value' ); } );
	check( count( array_filter( $wpdb->queries, function( $query ) { return 0 === strpos( $query[0], 'SELECT option_value' ); } ) ) === 2, 'The activation flag must be read fresh for each write guard.' );
	reset_case();
	apply_filters( 'wp_insert_post_data', array( 'post_type' => 'posloker_order' ), array() );
	$wpdb->held = false; // Simulate a lost/reconnected mysqli connection.
	$wpdb->option = json_encode( array( 'enabled' => true, 'target' => PosLoker_Cloudflare_Handover::TARGET ) );
	blocked( function() { apply_filters( 'update_post_metadata', null, 7, 'after_reconnect', 'value' ); } );
	check( count( array_filter( $wpdb->queries, function( $query ) { return 0 === strpos( $query[0], 'SELECT GET_LOCK' ); } ) ) === 2, 'A lost connection lock must be reacquired before checking the current flag.' );
	$first_lock = array_values( array_filter( $wpdb->queries, function( $query ) { return 0 === strpos( $query[0], 'SELECT GET_LOCK' ); } ) )[0];
	check( strlen( $first_lock[1][0] ) <= 64, 'The per-site MySQL lock name must fit the server limit.' );
	reset_case();
	$wpdb->option = serialize( array( 'enabled' => true, 'target' => PosLoker_Cloudflare_Handover::TARGET ) );
	blocked( function() { do_action( 'admin_post_posloker_submit_payment' ); } );

	foreach ( array( array( 'enabled' => true, 'target' => 'https://invalid.example' ), array( 'enabled' => 'true', 'target' => PosLoker_Cloudflare_Handover::TARGET ), (object) array( 'enabled' => true ) ) as $bad ) {
		reset_case(); $wpdb->option = serialize( $bad );
		blocked( function() { do_action( 'admin_post_posloker_submit_payment' ); }, 503 );
	}
	reset_case(); $wpdb->option_error = true;
	blocked( function() { do_action( 'admin_post_posloker_submit_payment' ); }, 503 );
	reset_case(); $wpdb->lock_available = false;
	blocked( function() { do_action( 'admin_post_posloker_submit_payment' ); }, 503 );
	check( $wpdb->updates === 0, 'Lock failure must not mutate the flag.' );

	reset_case();
	PosLoker_Cloudflare_Handover::command( array( 'status' ), array( 'verify-lock' => true ) );
	check( ! $wpdb->held && $wpdb->updates === 0, 'Status preflight must release its lock without changing the flag.' );
	try { PosLoker_Cloudflare_Handover::command( array( 'enable' ), array() ); throw new RuntimeException( 'Missing confirmation was accepted.' ); } catch ( Handover_CLI_Error $expected ) {}
	check( $wpdb->updates === 0, 'Unconfirmed command must not change the flag.' );
	$enable_start = count( $wpdb->queries );
	PosLoker_Cloudflare_Handover::command( array( 'enable' ), array( 'yes' => true ) );
	check( json_decode( $wpdb->option, true ) === array( 'enabled' => true, 'target' => PosLoker_Cloudflare_Handover::TARGET ) && ! $wpdb->held, 'Enable must verify the fixed target and release the shared lock.' );
	$queries = array_column( array_slice( $wpdb->queries, $enable_start ), 0 );
	check( 0 === strpos( $queries[0], 'SELECT GET_LOCK' ) && in_array( 'SELECT RELEASE_LOCK(%s)', $queries, true ), 'Enable must acquire and release the shared drain lock.' );
	PosLoker_Cloudflare_Handover::command( array( 'disable' ), array( 'yes' => true ) );
	check( false === json_decode( $wpdb->option, true )['enabled'] && ! $wpdb->held, 'Confirmed disable must verify persisted state.' );
	reset_case(); $wpdb->fail_update = true;
	try { PosLoker_Cloudflare_Handover::command( array( 'enable' ), array( 'yes' => true ) ); throw new RuntimeException( 'Unverified activation succeeded.' ); } catch ( Handover_CLI_Error $expected ) {}
	check( ! $wpdb->held, 'Failed configuration commit must release the drain lock.' );
	reset_case(); $wpdb->lock_available = false;
	blocked( function() { PosLoker_Cloudflare_Handover::command( array( 'enable' ), array( 'yes' => true ) ); }, 503 );
	check( $wpdb->updates === 0 && null === $wpdb->option, 'Busy in-flight lock must prevent activation until drained.' );

	PosLoker_Cloudflare_Handover::release_lock();
	echo 'WordPress handover PHP checks passed: ' . $checks . " checks; safe routes, fresh flag, pre-upload guards, source-order freeze, shared drain lock, confirmed commands, failure handling.\n";
} catch ( Throwable $error ) {
	PosLoker_Cloudflare_Handover::release_lock();
	fwrite( STDERR, 'WordPress handover PHP check failed: ' . $error->getMessage() . "\n" );
	exit( 1 );
}
