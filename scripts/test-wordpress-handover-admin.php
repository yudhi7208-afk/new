<?php
// Real PHP CLI. Reuse the core's isolated WordPress/wpdb doubles and all 120
// guard checks, then exercise the optional owner UI without hosting access.
ob_start();
require __DIR__ . '/test-wordpress-handover.php';
$core_result = ob_get_clean();

$admin_allowed = true;
$admin_user = 31;
$admin_nonce_valid = true;
$admin_nonce_action = '';
$admin_transients = array();
$admin_menu = null;
function current_user_can( $capability ) { global $admin_allowed; return $admin_allowed && 'manage_options' === $capability; }
function get_current_user_id() { global $admin_user; return $admin_user; }
function admin_url( $path = '' ) { return 'https://source.example/wp-admin/' . $path; }
function wp_parse_url( $url ) { return parse_url( $url ); }
function add_management_page( ...$args ) { global $admin_menu; $admin_menu = $args; }
function get_transient( $key ) { global $admin_transients; return isset( $admin_transients[ $key ] ) ? $admin_transients[ $key ] : false; }
function set_transient( $key, $value, $ttl ) { global $admin_transients; $admin_transients[ $key ] = $value; return true; }
function delete_transient( $key ) { global $admin_transients; unset( $admin_transients[ $key ] ); return true; }
function check_admin_referer( $action ) {
	global $admin_nonce_valid, $admin_nonce_action;
	$admin_nonce_action = $action;
	if ( ! $admin_nonce_valid ) { wp_die( 'Invalid test nonce.', '', array( 'response' => 403 ) ); }
	return 1;
}
function wp_safe_redirect( $url, $status = 302 ) { throw new Handover_Redirect( $url, $status ); }
function esc_attr( $value ) { return esc_html( $value ); }
function wp_nonce_field( $action ) { echo '<input name="_wpnonce" value="synthetic-' . esc_attr( $action ) . '">'; }
function submit_button( $label, $type ) { echo '<button>' . esc_html( $label ) . '</button>'; }

require __DIR__ . '/../migration/wordpress-handover-admin/posloker-cloudflare-handover.php';

function reset_admin( $enabled = false ) {
	global $admin_allowed, $admin_user, $admin_nonce_valid, $admin_nonce_action, $admin_transients;
	reset_case( $enabled );
	$admin_allowed = true; $admin_user = 31; $admin_nonce_valid = true; $admin_nonce_action = ''; $admin_transients = array();
	unset( $_SERVER['HTTP_ORIGIN'], $_SERVER['HTTP_REFERER'], $_SERVER['HTTP_SEC_FETCH_SITE'] );
	$_SERVER['REQUEST_METHOD'] = 'POST';
	$_SERVER['HTTP_ORIGIN'] = 'https://source.example';
	$_SERVER['HTTP_SEC_FETCH_SITE'] = 'same-origin';
	$_POST = array( 'operation' => 'verify' );
}
function admin_blocked( $status ) {
	global $wpdb;
	$before = $wpdb->updates;
	try { PosLoker_Cloudflare_Handover_Admin::submit(); }
	catch ( Handover_Die $error ) {
		check( $error->status === $status, 'Unexpected owner UI refusal status.' );
		check( $before === $wpdb->updates, 'Refused owner request must not change flag.' );
		return;
	}
	throw new RuntimeException( 'Expected owner UI refusal.' );
}
function admin_submit( $result ) {
	try { PosLoker_Cloudflare_Handover_Admin::submit(); }
	catch ( Handover_Redirect $response ) {
		check( 303 === $response->status && admin_url( 'tools.php?page=posloker-cloudflare-handover&result=' . $result ) === $response->url, 'Owner success must redirect locally with safe status only.' );
		return;
	}
	throw new RuntimeException( 'Expected owner UI success redirect.' );
}
function stamp_preflight() { global $admin_transients, $admin_user; $admin_transients[ 'posloker_handover_pf_' . $admin_user ] = time(); }

try {
	$before = $checks;
	reset_admin();
	check( 0 === $wpdb->updates && null === $wpdb->option, 'Loading owner wrapper must not enable handover.' );
	check( isset( $hooks['admin_post_posloker_cloudflare_handover_control'] ) && ! isset( $hooks['admin_post_nopriv_posloker_cloudflare_handover_control'] ), 'Only authenticated owner handler may be registered.' );
	do_action( 'admin_menu' );
	check( 'manage_options' === $admin_menu[2], 'Tools menu must require manage_options.' );

	reset_admin(); $admin_allowed = false; admin_blocked( 403 );
	reset_admin(); $_SERVER['REQUEST_METHOD'] = 'GET'; admin_blocked( 403 );
	reset_admin(); $admin_nonce_valid = false; admin_blocked( 403 );
	reset_admin(); $_POST['operation'] = 'delete'; admin_blocked( 400 );
	foreach ( array( 'https://evil.example', 'null', 'https://source.example.evil.example', 'http://source.example', 'https://source.example:8443', 'https://user@source.example', 'https://source.example/path', array( 'invalid' ) ) as $origin ) {
		reset_admin(); $_SERVER['HTTP_ORIGIN'] = $origin; $_SERVER['HTTP_REFERER'] = admin_url( 'tools.php' ); admin_blocked( 403 );
	}
	reset_admin(); $_SERVER['HTTP_SEC_FETCH_SITE'] = 'cross-site'; admin_blocked( 403 );
	reset_admin(); unset( $_SERVER['HTTP_ORIGIN'] ); admin_blocked( 403 );
	reset_admin(); unset( $_SERVER['HTTP_ORIGIN'] ); $_SERVER['HTTP_REFERER'] = 'https://evil.example/'; admin_blocked( 403 );

	reset_admin();
	admin_submit( 'verify-disabled' );
	check( 0 === $wpdb->updates && ! $wpdb->held && null === $wpdb->option, 'Verified preflight must release drain lock and keep flag disabled.' );
	check( 'posloker_cloudflare_handover_control_verify' === $admin_nonce_action, 'Nonce must be bound to verification operation.' );
	check( time() === get_transient( 'posloker_handover_pf_31' ), 'Successful preflight must be owner scoped.' );
	check( 0 === strpos( $wpdb->queries[0][0], 'SELECT GET_LOCK' ), 'Preflight must execute actual core lock acquisition.' );

	reset_admin(); unset( $_SERVER['HTTP_ORIGIN'] ); $_SERVER['HTTP_REFERER'] = admin_url( 'tools.php?page=posloker-cloudflare-handover' );
	admin_submit( 'verify-disabled' );
	reset_admin(); $_SERVER['HTTP_ORIGIN'] = 'https://SOURCE.example:443'; admin_submit( 'verify-disabled' );
	reset_admin(); $_POST = array( 'operation' => 'enable', 'cloudflare_ready' => '1' ); admin_blocked( 409 );
	reset_admin(); stamp_preflight(); $_POST['operation'] = 'enable'; admin_blocked( 409 );
	reset_admin(); stamp_preflight(); $admin_transients['posloker_handover_pf_31'] = time() - 601; $_POST = array( 'operation' => 'enable', 'cloudflare_ready' => '1' ); admin_blocked( 409 );
	reset_admin(); stamp_preflight(); $admin_user = 32; $_POST = array( 'operation' => 'enable', 'cloudflare_ready' => '1' ); admin_blocked( 409 );

	reset_admin(); stamp_preflight(); $_POST = array( 'operation' => 'enable', 'cloudflare_ready' => '1', 'target' => 'https://evil.example', 'enabled' => '0' );
	admin_submit( 'enable-enabled' );
	check( json_decode( $wpdb->option, true ) === array( 'enabled' => true, 'target' => PosLoker_Cloudflare_Handover::TARGET ), 'UI must use core fixed target; submitted overrides ignored.' );
	check( ! $wpdb->held && false === get_transient( 'posloker_handover_pf_31' ), 'Successful operation must release lock and consume preflight.' );
	check( 'posloker_cloudflare_handover_control_enable' === $admin_nonce_action, 'Enable must use a different operation-bound nonce.' );
	$queries = array_column( $wpdb->queries, 0 );
	check( 0 === strpos( $queries[0], 'SELECT GET_LOCK' ) && in_array( 'SELECT RELEASE_LOCK(%s)', $queries, true ), 'UI enable must use same drain lock and fresh flag operation as CLI.' );

	reset_admin(); stamp_preflight(); $wpdb->lock_available = false; $_POST = array( 'operation' => 'enable', 'cloudflare_ready' => '1' ); admin_blocked( 503 );
	check( false === get_transient( 'posloker_handover_pf_31' ) && null === $wpdb->option, 'Busy lock must invalidate prior preflight and leave disabled flag unchanged.' );
	reset_admin(); stamp_preflight(); $wpdb->option_error = true; $_POST = array( 'operation' => 'enable', 'cloudflare_ready' => '1' ); admin_blocked( 503 );
	check( ! $wpdb->held && false === get_transient( 'posloker_handover_pf_31' ), 'DB read failure must release lock and consume preflight.' );
	reset_admin(); stamp_preflight(); $wpdb->option = '{"enabled":true,"target":"https://evil.example"}'; $_POST = array( 'operation' => 'enable', 'cloudflare_ready' => '1' ); admin_blocked( 503 );
	check( ! $wpdb->held, 'Invalid flag must release lock.' );
	reset_admin(); stamp_preflight(); $wpdb->fail_update = true; $_POST = array( 'operation' => 'enable', 'cloudflare_ready' => '1' );
	try { PosLoker_Cloudflare_Handover_Admin::submit(); throw new RuntimeException( 'Failed flag commit was accepted.' ); }
	catch ( Handover_Die $error ) { check( 503 === $error->status && null === $wpdb->option && ! $wpdb->held, 'Unverified commit must stay disabled and release lock.' ); }

	reset_admin( true ); stamp_preflight(); $_POST['operation'] = 'disable'; admin_blocked( 409 );
	$_POST['rollback_reconciled'] = '1'; admin_submit( 'disable-disabled' );
	check( false === json_decode( $wpdb->option, true )['enabled'] && ! $wpdb->held, 'Confirmed rollback uses shared operation and releases lock.' );

	reset_admin(); $_SERVER['REQUEST_METHOD'] = 'GET'; ob_start(); PosLoker_Cloudflare_Handover_Admin::page(); $html = ob_get_clean();
	check( false !== strpos( $html, 'Status tersimpan: disabled' ) && false === strpos( $html, 'Aktifkan handover ke Cloudflare' ), 'GET tools view must show status, withhold enable before preflight.' );
	check( 0 === $wpdb->updates && ! $wpdb->held && 1 === count( $wpdb->queries ), 'Status view must perform only fresh read, no flag mutation or lock.' );
	stamp_preflight(); ob_start(); PosLoker_Cloudflare_Handover_Admin::page(); $html = ob_get_clean();
	check( false !== strpos( $html, 'Aktifkan handover ke Cloudflare' ) && false !== strpos( $html, 'cloudflare_ready' ), 'Successful preflight must reveal explicit readiness confirmation.' );
	check( false !== strpos( $html, 'posloker_cloudflare_handover_control_enable' ), 'Rendered enable form must include operation-bound nonce.' );

	PosLoker_Cloudflare_Handover::release_lock();
	echo $core_result;
	echo 'WordPress handover owner UI PHP checks passed: ' . ( $checks - $before ) . " additional checks; owner capability, nonce, same origin, preflight, one-use confirmation, shared lock and fixed target.\n";
} catch ( Throwable $error ) {
	PosLoker_Cloudflare_Handover::release_lock();
	fwrite( STDERR, 'WordPress handover owner UI PHP check failed: ' . $error->getMessage() . "\n" );
	exit( 1 );
}
